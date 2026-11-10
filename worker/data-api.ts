/// <reference types="@cloudflare/workers-types" />
// Query implementations shared by the Worker and the offline snapshot generator.
import { ApiError, keyOf, slugOf, clampInt } from './params';

const POSITIONS = ['GOVERNOR', 'VICE GOVERNOR', 'MEMBER, HOUSE OF REPRESENTATIVES', 'PROVINCIAL BOARD MEMBER', 'MAYOR', 'VICE MAYOR', 'COUNCILOR'];
const POS_ALIAS: Record<string, string> = { gov: 'GOVERNOR', governor: 'GOVERNOR', vgov: 'VICE GOVERNOR', 'vice governor': 'VICE GOVERNOR', rep: 'MEMBER, HOUSE OF REPRESENTATIVES', representative: 'MEMBER, HOUSE OF REPRESENTATIVES', congressman: 'MEMBER, HOUSE OF REPRESENTATIVES', house: 'MEMBER, HOUSE OF REPRESENTATIVES', board: 'PROVINCIAL BOARD MEMBER', 'board member': 'PROVINCIAL BOARD MEMBER', mayor: 'MAYOR', vmayor: 'VICE MAYOR', 'vice mayor': 'VICE MAYOR', councilor: 'COUNCILOR', councillor: 'COUNCILOR' };

const normPosition = (p: string | undefined | null) => { if (!p) return null; const k = p.trim().toLowerCase(); const v = POS_ALIAS[k] ?? (POSITIONS.includes(p.toUpperCase()) ? p.toUpperCase() : null); if (!v) throw new ApiError(400, `unknown position "${p}"; use one of ${POSITIONS.join(', ')}`); return v; };

// ---------- data access (shared by REST and MCP) ----------
const PERSON_COLS = 'p.id, p.display_name, p.last_name, p.first_name, p.middle_name, p.suffix, p.sex, p.runs, p.wins, p.first_year, p.last_year, p.top_position, pr.name AS province, pr.slug AS province_slug';
const CAND_COLS = 'c.year, c.position, c.party, c.votes, c.rank, c.won, c.ballot_name, c.match AS match_confidence, c.link AS vote_link, c.contest_id, pr.name AS province, pr.slug AS province_slug, ci.name AS city, ci.slug AS city_slug, k.district, k.seats, k.candidates, k.total_votes, k.margin, k.uncontested';
const CONTEST_COLS = 'k.id, k.year, k.position, k.district, k.seats, k.candidates, k.total_votes, k.last_winner_votes, k.runner_up_votes, k.margin, k.uncontested, k.complete, pr.name AS province, pr.slug AS province_slug, ci.name AS city, ci.slug AS city_slug';

type Row = Record<string, unknown>;
async function all(db: D1Database, sql: string, ...binds: unknown[]): Promise<Row[]> { return (await db.prepare(sql).bind(...binds).all<Row>()).results; }
async function first(db: D1Database, sql: string, ...binds: unknown[]): Promise<Row | null> { return db.prepare(sql).bind(...binds).first<Row>(); }

async function findProvince(db: D1Database, ref: string): Promise<Row> {
    const p = await first(db, `SELECT p.id, p.name, p.slug, p.poverty, r.name AS region, r.slug AS region_slug FROM provinces p JOIN regions r ON r.id = p.region_id WHERE p.slug = ?1 OR p.name = ?2`, slugOf(ref), keyOf(ref));
    if (!p) throw new ApiError(404, `province "${ref}" not found`);
    return p;
}
async function findCity(db: D1Database, provinceId: number, ref: string): Promise<Row> {
    const c = await first(db, `SELECT id, name, slug FROM cities WHERE province_id = ?1 AND (slug = ?2 OR name = ?3)`, provinceId, slugOf(ref), keyOf(ref));
    if (!c) throw new ApiError(404, `town "${ref}" not found in that province`);
    return c;
}
async function contestCandidacies(db: D1Database, ids: string[]): Promise<Map<string, Row[]>> {
    const out = new Map<string, Row[]>();
    for (let i = 0; i < ids.length; i += 50) {
        const chunk = ids.slice(i, i + 50);
        const rows = await all(db, `SELECT c.contest_id, c.person_id, p.display_name, p.sex, p.runs, p.wins, c.party, c.votes, c.rank, c.won, c.ballot_name, c.match AS match_confidence, c.link AS vote_link FROM candidacies c JOIN persons p ON p.id = c.person_id WHERE c.contest_id IN (${chunk.map(() => '?').join(',')}) ORDER BY c.rank IS NULL, c.rank, c.won DESC`, ...chunk);
        for (const r of rows) (out.get(r['contest_id'] as string) ?? out.set(r['contest_id'] as string, []).get(r['contest_id'] as string)!).push(r);
    }
    return out;
}
async function districtTowns(db: D1Database, ids: string[]): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    for (let i = 0; i < ids.length; i += 50) {
        const chunk = ids.slice(i, i + 50);
        for (const r of await all(db, `SELECT d.contest_id, c.name FROM district_towns d JOIN cities c ON c.id = d.city_id WHERE d.contest_id IN (${chunk.map(() => '?').join(',')}) ORDER BY c.name`, ...chunk)) (out.get(r['contest_id'] as string) ?? out.set(r['contest_id'] as string, []).get(r['contest_id'] as string)!).push(r['name'] as string);
    }
    return out;
}

export const dataApi = {
    async stats(db: D1Database) {
        return first(db, `SELECT (SELECT COUNT(*) FROM persons) persons, (SELECT COUNT(*) FROM candidacies) candidacies, (SELECT COUNT(*) FROM contests) contests, (SELECT COUNT(*) FROM regions) regions, (SELECT COUNT(*) FROM provinces) provinces, (SELECT COUNT(*) FROM cities) cities, (SELECT COUNT(*) FROM blocs WHERE scope_year = 0) blocs_all_years, (SELECT MIN(year) FROM contests) first_year, (SELECT MAX(year) FROM contests) last_year`);
    },
    async coverage(db: D1Database) {
        const rows = await all(db, `SELECT year, SUM(won) winners, COUNT(*) candidacies, COUNT(DISTINCT contest_id) contests, COUNT(DISTINCT CASE WHEN city_id IS NOT NULL THEN city_id END) towns, SUM(CASE WHEN won = 1 AND link IN ('exact','surname','prefix') THEN 1 ELSE 0 END) winners_with_votes, SUM(CASE WHEN won = 1 AND link = 'winner-only' THEN 1 ELSE 0 END) winners_without_votes, SUM(CASE WHEN link = 'inferred' THEN 1 ELSE 0 END) winners_inferred_from_votes, SUM(CASE WHEN won = 0 THEN 1 ELSE 0 END) losing_candidates FROM candidacies GROUP BY year ORDER BY year`);
        return { elections: rows, notes: ['Vote counts exist from 2010; 2010 covers about two thirds of towns and 2013 about 90%.', 'People are matched across elections by surname, first name and middle name within a province; match_confidence on each candidacy is exact, strong, weak or new.', 'Before 2010 representatives and board members are recorded without their district.', 'Shared surnames signal, but do not prove, kinship.'] };
    },
    async places(db: D1Database) {
        const regions = await all(db, `SELECT r.id, r.name, r.slug FROM regions r ORDER BY r.name`);
        const provinces = await all(db, `SELECT p.id, p.name, p.slug, p.region_id, p.poverty, (SELECT COUNT(*) FROM cities c WHERE c.province_id = p.id) towns FROM provinces p ORDER BY p.name`);
        return regions.map(r => ({ name: r['name'], slug: r['slug'], provinces: provinces.filter(p => p['region_id'] === r['id']).map(p => ({ name: p['name'], slug: p['slug'], poverty: p['poverty'], towns: p['towns'] })) }));
    },
    async province(db: D1Database, ref: string) {
        const p = await findProvince(db, ref);
        const towns = await all(db, `SELECT c.name, c.slug, (SELECT COUNT(*) FROM candidacies x WHERE x.province_id = c.province_id AND x.city_id = c.id AND x.won = 1) seats_all_years FROM cities c WHERE c.province_id = ?1 ORDER BY c.name`, p['id']);
        const years = await all(db, `SELECT year, COUNT(*) contests, SUM(candidates) candidates, SUM(seats) seats FROM contests WHERE province_id = ?1 GROUP BY year ORDER BY year`, p['id']);
        return { ...p, id: undefined, towns, elections: years };
    },
    async town(db: D1Database, provRef: string, townRef: string) {
        const p = await findProvince(db, provRef); const c = await findCity(db, p['id'] as number, townRef);
        const years = await all(db, `SELECT year, COUNT(*) contests, SUM(candidates) candidates, SUM(seats) seats FROM contests WHERE province_id = ?1 AND city_id = ?2 GROUP BY year ORDER BY year`, p['id'], c['id']);
        const districts = await all(db, `SELECT k.year, k.position, k.district, k.id AS contest_id FROM district_towns d JOIN contests k ON k.id = d.contest_id WHERE d.city_id = ?1 ORDER BY k.year DESC, k.position`, c['id']);
        return { province: { name: p['name'], slug: p['slug'], region: p['region'] }, name: c['name'], slug: c['slug'], elections: years, district_seats: districts };
    },
    async contests(db: D1Database, f: { year?: string | number | null; province?: string | null; town?: string | null; position?: string | null; district?: string | null; page?: number; limit?: number; withCandidates?: boolean }) {
        const where: string[] = [], binds: unknown[] = [];
        if (f.year) { where.push(`k.year = ?${binds.push(clampInt(f.year, 0, 1900, 2100))}`); }
        if (f.province) { const p = await findProvince(db, f.province); where.push(`k.province_id = ?${binds.push(p['id'])}`); if (f.town) { const c = await findCity(db, p['id'] as number, f.town); where.push(`(k.city_id = ?${binds.push(c['id'])} OR k.id IN (SELECT contest_id FROM district_towns WHERE city_id = ?${binds.push(c['id'])}))`); } }
        else if (f.town) throw new ApiError(400, 'town requires province');
        const pos = normPosition(f.position); if (pos) where.push(`k.position = ?${binds.push(pos)}`);
        if (f.district) where.push(`k.district = ?${binds.push(keyOf(f.district))}`);
        if (!where.length) throw new ApiError(400, 'give at least one of year, province, position');
        const limit = clampInt(f.limit, 50, 1, 200), page = clampInt(f.page, 1, 1, 100000);
        const rows = await all(db, `SELECT ${CONTEST_COLS} FROM contests k JOIN provinces pr ON pr.id = k.province_id LEFT JOIN cities ci ON ci.id = k.city_id WHERE ${where.join(' AND ')} ORDER BY k.year DESC, pr.name, ci.name, k.position, k.district LIMIT ?${binds.push(limit)} OFFSET ?${binds.push((page - 1) * limit)}`, ...binds);
        const ids = rows.map(r => r['id'] as string);
        const towns = await districtTowns(db, ids);
        const cands = f.withCandidates ? await contestCandidacies(db, ids) : null;
        return { page, limit, contests: rows.map(r => ({ ...r, district_towns: towns.get(r['id'] as string) ?? undefined, candidates: cands ? cands.get(r['id'] as string) ?? [] : undefined })) };
    },
    async contest(db: D1Database, id: string) {
        const k = await first(db, `SELECT ${CONTEST_COLS} FROM contests k JOIN provinces pr ON pr.id = k.province_id LEFT JOIN cities ci ON ci.id = k.city_id WHERE k.id = ?1`, id);
        if (!k) throw new ApiError(404, `contest "${id}" not found`);
        const [cands, towns] = await Promise.all([contestCandidacies(db, [id]), districtTowns(db, [id])]);
        return { ...k, district_towns: towns.get(id) ?? undefined, candidates: cands.get(id) ?? [] };
    },
    async searchPersons(db: D1Database, q: string, province: string | null, limit: number) {
        if (q.trim().length < 2) throw new ApiError(400, 'query needs at least two characters');
        let last = '', firstN = '';
        if (q.includes(',')) [last, firstN] = q.split(',').map(s => keyOf(s)) as [string, string];
        else { const t = keyOf(q).split(' '); if (t.length === 1) last = t[0]!; else { last = t[t.length - 1]!; firstN = t.slice(0, -1).join(' '); } }
        const provClause = province ? `AND pr.id = ${(await findProvince(db, province))['id']}` : '';
        const sql = firstN
            ? `SELECT ${PERSON_COLS} FROM persons p JOIN provinces pr ON pr.id = p.home_province_id WHERE ((p.last_key LIKE ?1 AND p.first_key LIKE ?2) OR (p.last_key LIKE ?3 AND p.first_key LIKE ?4)) ${provClause} ORDER BY p.wins DESC, p.runs DESC LIMIT ?5`
            : `SELECT ${PERSON_COLS} FROM persons p JOIN provinces pr ON pr.id = p.home_province_id WHERE p.last_key LIKE ?1 ${provClause} ORDER BY p.wins DESC, p.runs DESC LIMIT ?2`;
        return all(db, sql, ...(firstN ? [last + '%', firstN + '%', firstN + '%', last + '%', limit] : [last + '%', limit]));
    },
    async searchPlaces(db: D1Database, q: string) {
        const like = '%' + slugOf(q) + '%';
        return all(db, `SELECT 'province' AS type, name, slug, NULL AS province_slug FROM provinces WHERE slug LIKE ?1 UNION ALL SELECT 'city', c.name, c.slug, p.slug FROM cities c JOIN provinces p ON p.id = c.province_id WHERE c.slug LIKE ?1 LIMIT 10`, like);
    },
    async persons(db: D1Database, f: { province?: string | null; min_runs?: string | number | null; sort?: string | null; page?: number; limit?: number }) {
        const limit = clampInt(f.limit, 50, 1, 200), page = clampInt(f.page, 1, 1, 100000), minRuns = clampInt(f.min_runs, 1, 1, 30);
        const sort = f.sort === 'runs' ? 'p.runs DESC, p.wins DESC' : f.sort === 'losses' ? '(p.runs - p.wins) DESC, p.runs DESC' : 'p.wins DESC, p.runs DESC';
        const prov = f.province ? (await findProvince(db, f.province))['id'] : null;
        const rows = await all(db, `SELECT ${PERSON_COLS} FROM persons p JOIN provinces pr ON pr.id = p.home_province_id WHERE p.runs >= ?1 AND (?2 IS NULL OR pr.id = ?2) ORDER BY ${sort} LIMIT ?3 OFFSET ?4`, minRuns, prov, limit, (page - 1) * limit);
        return { page, limit, persons: rows };
    },
    async person(db: D1Database, id: string) {
        const p = await first(db, `SELECT ${PERSON_COLS} FROM persons p JOIN provinces pr ON pr.id = p.home_province_id WHERE p.id = ?1`, id);
        if (!p) throw new ApiError(404, `person "${id}" not found`);
        const cands = await all(db, `SELECT ${CAND_COLS} FROM candidacies c JOIN contests k ON k.id = c.contest_id JOIN provinces pr ON pr.id = c.province_id LEFT JOIN cities ci ON ci.id = c.city_id WHERE c.person_id = ?1 ORDER BY c.year`, id);
        const blocs = await all(db, `SELECT b.id, b.scope_year, b.surname, b.n, m.via FROM bloc_members m JOIN blocs b ON b.id = m.bloc_id WHERE m.person_id = ?1 ORDER BY b.scope_year DESC, b.n DESC`, id);
        return { ...p, candidacies: cands, blocs };
    },
    async national(db: D1Database, year: number, province: string | null) {
        if (province) {
            const p = await findProvince(db, province);
            const rows = await all(db, `SELECT n.position, n.name, n.party, v.votes AS votes_in_province, n.votes AS votes_national, n.rank AS rank_national, n.won FROM national_province_votes v JOIN national_candidates n ON n.id = v.national_id WHERE n.year = ?1 AND v.province_id = ?2 ORDER BY n.position, v.votes DESC`, year, p['id']);
            if (!rows.length) throw new ApiError(404, `no national results for ${year} in ${p['name']}`);
            return { year, province: p['name'], results: rows };
        }
        const rows = await all(db, `SELECT position, name, party, votes, rank, won FROM national_candidates WHERE year = ?1 ORDER BY position, rank`, year);
        if (!rows.length) throw new ApiError(404, `no national results for ${year}`);
        return { year, results: rows };
    },
    async blocs(db: D1Database, f: { year?: string | number | null; province?: string | null; region?: string | null; min?: string | number | null; surname?: string | null; page?: number; limit?: number; withMembers?: boolean }) {
        const scope = !f.year || String(f.year).toLowerCase() === 'all' ? 0 : clampInt(f.year, 0, 1900, 2100);
        const min = clampInt(f.min, 2, 2, 50), limit = clampInt(f.limit, 50, 1, 200), page = clampInt(f.page, 1, 1, 100000);
        const where = [`b.scope_year = ?1`, `b.n >= ?2`], binds: unknown[] = [scope, min];
        if (f.province) where.push(`b.province_id = ?${binds.push((await findProvince(db, f.province))['id'])}`);
        if (f.region) { const r = await first(db, `SELECT id FROM regions WHERE slug = ?1 OR name = ?2`, slugOf(f.region), keyOf(f.region)); if (!r) throw new ApiError(404, `region "${f.region}" not found`); where.push(`pr.region_id = ?${binds.push(r['id'])}`); }
        if (f.surname) where.push(`b.surname LIKE ?${binds.push(keyOf(f.surname) + '%')}`);
        const rows = await all(db, `SELECT b.id, b.scope_year, b.surname, b.n AS members, b.nmid AS via_middle_name, b.terms, b.share, b.votes, b.top_position, b.parties, b.years, pr.name AS province, pr.slug AS province_slug, r.name AS region FROM blocs b JOIN provinces pr ON pr.id = b.province_id JOIN regions r ON r.id = pr.region_id WHERE ${where.join(' AND ')} ORDER BY b.n DESC, b.share DESC LIMIT ?${binds.push(limit)} OFFSET ?${binds.push((page - 1) * limit)}`, ...binds);
        const out: Row[] = rows.map(r => ({ ...r, scope: r['scope_year'] === 0 ? 'all elections' : r['scope_year'], scope_year: undefined, parties: String(r['parties'] ?? '').split(',').filter(Boolean), years: String(r['years'] ?? '').split(',').filter(Boolean).map(Number) }));
        if (f.withMembers) for (const b of out) b['members_list'] = await this.blocMembers(db, b['id'] as number);
        return { page, limit, scope: scope === 0 ? 'all elections' : scope, min_members: min, blocs: out, note: 'A bloc is officials in one province sharing a surname as last or middle name. Shared surnames signal, but do not prove, kinship.' };
    },
    async blocMembers(db: D1Database, blocId: number) {
        return all(db, `SELECT m.person_id, p.display_name, p.sex, m.via, m.top_position, ci.name AS city, m.votes, p.runs, p.wins FROM bloc_members m JOIN persons p ON p.id = m.person_id LEFT JOIN cities ci ON ci.id = m.city_id WHERE m.bloc_id = ?1 ORDER BY m.via, m.votes DESC`, blocId);
    },
    async bloc(db: D1Database, id: number) {
        const b = await first(db, `SELECT b.*, pr.name AS province, pr.slug AS province_slug, r.name AS region FROM blocs b JOIN provinces pr ON pr.id = b.province_id JOIN regions r ON r.id = pr.region_id WHERE b.id = ?1`, id);
        if (!b) throw new ApiError(404, `bloc ${id} not found`);
        const members = await this.blocMembers(db, id);
        const related = await all(db, `SELECT DISTINCT o.id, o.surname, o.n AS members FROM bloc_members m JOIN bloc_members m2 ON m2.person_id = m.person_id AND m2.bloc_id <> m.bloc_id JOIN blocs o ON o.id = m2.bloc_id WHERE m.bloc_id = ?1 AND o.scope_year = ?2 AND o.province_id = ?3 ORDER BY o.n DESC`, id, b['scope_year'], b['province_id']);
        const elsewhere = await all(db, `SELECT o.id, pr.name AS province, o.n AS members FROM blocs o JOIN provinces pr ON pr.id = o.province_id WHERE o.surname = ?1 AND o.scope_year = ?2 AND o.id <> ?3 ORDER BY o.n DESC LIMIT 20`, b['surname'], b['scope_year'], id);
        return { ...b, scope: b['scope_year'] === 0 ? 'all elections' : b['scope_year'], parties: String(b['parties'] ?? '').split(',').filter(Boolean), years: String(b['years'] ?? '').split(',').filter(Boolean).map(Number), members, linked_surnames: related, same_surname_elsewhere: elsewhere };
    },
    async compare(db: D1Database, f: { province: string; town?: string | null; position: string; district?: string | null }) {
        const p = await findProvince(db, f.province); const pos = normPosition(f.position)!;
        const binds: unknown[] = [p['id'], pos]; let where = 'k.province_id = ?1 AND k.position = ?2';
        if (f.town) { const c = await findCity(db, p['id'] as number, f.town); where += ` AND (k.city_id = ?${binds.push(c['id'])} OR k.id IN (SELECT contest_id FROM district_towns WHERE city_id = ?${binds.push(c['id'])}))`; }
        else if (!['GOVERNOR', 'VICE GOVERNOR'].includes(pos)) where += ' AND k.city_id IS NULL';
        if (f.district) where += ` AND k.district = ?${binds.push(keyOf(f.district))}`;
        const ks = await all(db, `SELECT ${CONTEST_COLS} FROM contests k JOIN provinces pr ON pr.id = k.province_id LEFT JOIN cities ci ON ci.id = k.city_id WHERE ${where} ORDER BY k.year, k.district, ci.name`, ...binds);
        const cands = await contestCandidacies(db, ks.map(k => k['id'] as string));
        const seen = new Map<string, { person_id: string; name: string; years: number[] }>();
        const timeline = ks.map(k => { const winners = (cands.get(k['id'] as string) ?? []).filter(c => c['won']); for (const w of winners) { const e = seen.get(w['person_id'] as string) ?? seen.set(w['person_id'] as string, { person_id: w['person_id'] as string, name: w['display_name'] as string, years: [] }).get(w['person_id'] as string)!; e.years.push(k['year'] as number); } return { year: k['year'], contest_id: k['id'], city: k['city'], district: k['district'], seats: k['seats'], candidates: k['candidates'], margin: k['margin'], uncontested: k['uncontested'], winners: winners.map(w => ({ person_id: w['person_id'], name: w['display_name'], party: w['party'], votes: w['votes'] })) }; });
        return { province: p['name'], town: f.town ?? null, position: pos, timeline, repeat_winners: [...seen.values()].filter(e => e.years.length > 1).sort((a, b) => b.years.length - a.years.length) };
    },
};
