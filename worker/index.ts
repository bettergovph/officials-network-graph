/// <reference types="@cloudflare/workers-types" />
/**
 * Dynasty API on Cloudflare Workers + D1.
 * Every other path is served from the static Vite build (ASSETS binding, SPA fallback).
 */
export interface Env { DB: D1Database; ASSETS: Fetcher }

const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=3600, s-maxage=86400', 'access-control-allow-origin': '*' };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: HEADERS });
const notFound = (what: string) => json({ error: `${what} not found` }, 404);
const clampInt = (v: string | null, def: number, max: number) => Math.min(max, Math.max(1, parseInt(v ?? '', 10) || def));
const keyOf = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

const PERSON_COLS = 'p.id, p.display_name, p.last_name, p.first_name, p.middle_name, p.suffix, p.sex, p.runs, p.wins, p.first_year, p.last_year, p.top_position, pr.name AS province, pr.slug AS province_slug';
const CAND_COLS = 'c.year, c.position, c.party, c.votes, c.rank, c.won, c.ballot_name, c.match, c.link, c.contest_id, pr.name AS province, pr.slug AS province_slug, ci.name AS city, ci.slug AS city_slug, k.district, k.seats, k.candidates, k.total_votes, k.margin, k.uncontested';

async function route(url: URL, env: Env): Promise<Response> {
    const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
    const [head, a, b] = parts;
    const db = env.DB;

    if (head === 'stats') {
        const r = await db.prepare(`SELECT (SELECT COUNT(*) FROM persons) persons, (SELECT COUNT(*) FROM candidacies) candidacies, (SELECT COUNT(*) FROM contests) contests, (SELECT COUNT(*) FROM provinces) provinces, (SELECT COUNT(*) FROM cities) cities, (SELECT MIN(year) FROM contests) first_year, (SELECT MAX(year) FROM contests) last_year`).first();
        return json(r);
    }

    if (head === 'search') {
        const q = (url.searchParams.get('q') ?? '').trim();
        const limit = clampInt(url.searchParams.get('limit'), 20, 50);
        if (q.length < 2) return json({ persons: [], places: [] });
        let last = '', first = '';
        if (q.includes(',')) [last, first] = q.split(',').map(s => keyOf(s)) as [string, string];
        else { const t = keyOf(q).split(' '); if (t.length === 1) last = t[0]!; else { last = t[t.length - 1]!; first = t.slice(0, -1).join(' '); } }
        const persons = first
            ? await db.prepare(`SELECT ${PERSON_COLS} FROM persons p JOIN provinces pr ON pr.id = p.home_province_id WHERE (p.last_key LIKE ?1 AND p.first_key LIKE ?2) OR (p.last_key LIKE ?3 AND p.first_key LIKE ?4) ORDER BY p.wins DESC, p.runs DESC LIMIT ?5`)
                .bind(last + '%', first + '%', first + '%', last + '%', limit).all()
            : await db.prepare(`SELECT ${PERSON_COLS} FROM persons p JOIN provinces pr ON pr.id = p.home_province_id WHERE p.last_key LIKE ?1 ORDER BY p.wins DESC, p.runs DESC LIMIT ?2`).bind(last + '%', limit).all();
        const like = '%' + keyOf(q).toLowerCase().replace(/ /g, '-') + '%';
        const places = await db.prepare(`SELECT 'province' AS type, name, slug, NULL AS province_slug FROM provinces WHERE slug LIKE ?1 UNION ALL SELECT 'city', c.name, c.slug, p.slug FROM cities c JOIN provinces p ON p.id = c.province_id WHERE c.slug LIKE ?1 LIMIT 10`).bind(like).all();
        return json({ persons: persons.results, places: places.results });
    }

    if (head === 'person' && a) {
        const person = await db.prepare(`SELECT ${PERSON_COLS} FROM persons p JOIN provinces pr ON pr.id = p.home_province_id WHERE p.id = ?1`).bind(a).first();
        if (!person) return notFound('person');
        const cands = await db.prepare(`SELECT ${CAND_COLS} FROM candidacies c JOIN contests k ON k.id = c.contest_id JOIN provinces pr ON pr.id = c.province_id LEFT JOIN cities ci ON ci.id = c.city_id WHERE c.person_id = ?1 ORDER BY c.year`).bind(a).all();
        return json({ ...person, candidacies: cands.results });
    }

    if (head === 'contest' && a) {
        const contest = await db.prepare(`SELECT k.*, pr.name AS province, pr.slug AS province_slug, ci.name AS city, ci.slug AS city_slug FROM contests k JOIN provinces pr ON pr.id = k.province_id LEFT JOIN cities ci ON ci.id = k.city_id WHERE k.id = ?1`).bind(a).first();
        if (!contest) return notFound('contest');
        const cands = await db.prepare(`SELECT c.person_id, p.display_name, p.sex, p.runs, p.wins, c.party, c.votes, c.rank, c.won, c.ballot_name, c.match, c.link FROM candidacies c JOIN persons p ON p.id = c.person_id WHERE c.contest_id = ?1 ORDER BY c.rank IS NULL, c.rank, c.won DESC`).bind(a).all();
        return json({ ...contest, candidacies: cands.results });
    }

    if (head === 'place' && a) {
        const year = url.searchParams.get('year');
        const prov = await db.prepare(`SELECT p.*, r.name AS region, r.slug AS region_slug FROM provinces p JOIN regions r ON r.id = p.region_id WHERE p.slug = ?1`).bind(a).first<{ id: number }>();
        if (!prov) return notFound('province');
        let city: { id: number } | null = null;
        if (b) { city = await db.prepare(`SELECT * FROM cities WHERE province_id = ?1 AND slug = ?2`).bind(prov.id, b).first<{ id: number }>(); if (!city) return notFound('city'); }
        const where = ['k.province_id = ?1', city ? 'k.city_id = ?2' : '(k.city_id IS NULL OR ?2 IS NULL)', year ? 'k.year = ?3' : '?3 IS NULL'].join(' AND ');
        const contests = await db.prepare(`SELECT k.*, ci.name AS city, ci.slug AS city_slug FROM contests k LEFT JOIN cities ci ON ci.id = k.city_id WHERE ${where} ORDER BY k.year DESC, k.position LIMIT 500`).bind(prov.id, city ? city.id : null, year ? +year : null).all();
        const cands = contests.results.length
            ? await db.prepare(`SELECT c.contest_id, c.person_id, p.display_name, c.party, c.votes, c.rank, c.won FROM candidacies c JOIN persons p ON p.id = c.person_id WHERE c.contest_id IN (${contests.results.map(() => '?').join(',')}) ORDER BY c.rank IS NULL, c.rank`).bind(...contests.results.map(k => (k as { id: string }).id)).all()
            : { results: [] };
        return json({ province: prov, city, contests: contests.results, candidacies: cands.results });
    }

    if (head === 'persons') {
        // browse: /api/persons?province=slug&min_runs=3&sort=wins&page=1
        const limit = clampInt(url.searchParams.get('limit'), 50, 200), page = clampInt(url.searchParams.get('page'), 1, 10000);
        const minRuns = clampInt(url.searchParams.get('min_runs'), 1, 20);
        const sort = url.searchParams.get('sort') === 'runs' ? 'p.runs DESC, p.wins DESC' : 'p.wins DESC, p.runs DESC';
        const prov = url.searchParams.get('province');
        const rows = await db.prepare(`SELECT ${PERSON_COLS} FROM persons p JOIN provinces pr ON pr.id = p.home_province_id WHERE p.runs >= ?1 AND (?2 IS NULL OR pr.slug = ?2) ORDER BY ${sort} LIMIT ?3 OFFSET ?4`).bind(minRuns, prov, limit, (page - 1) * limit).all();
        return json({ page, limit, persons: rows.results });
    }

    return notFound('route');
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);
        if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
        if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);
        try { return await route(url, env); }
        catch (e) { return json({ error: e instanceof Error ? e.message : String(e) }, 500); }
    },
} satisfies ExportedHandler<Env>;
