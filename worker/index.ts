/// <reference types="@cloudflare/workers-types" />
/**
 * Dynasties API (REST, /api/v1) and MCP server (/mcp) on Cloudflare Workers + D1.
 * Every other path is served from the static Vite build (ASSETS binding, SPA fallback).
 * Read-only. Responses carry the data vintage and the source citation.
 */
import { renderPage, sitemap, robots } from './seo';
import { ResultCache } from './cache';
import { ApiError, clampInt } from './params';
import { dataApi } from './data-api';
import { apiSnapshot } from './snapshots';

export interface Env {
    DB: D1Database;
    ASSETS: Fetcher;
    WORKER_VERSION?: { id: string };
    CACHE_VERSION?: string;
    STATIC_DATA?: string;
}

const VERSION = '1.0.0';
const API_HOST = 'officials.bettergov.ph'; // API and MCP live here; the site lives on SITE_HOST. The workers.dev host serves both.
const SITE_HOST = 'dynasties.bettergov.ph';
const API_BASE = `https://${API_HOST}`;
const SOURCE = 'Leung, Robert R. Open Halalan: The Philippine National and Local Election Dataset. https://robertrleung.github.io/OpenHalalan/';
const LICENSE = 'Derived data CC0 1.0 by BetterGov.ph; cite Open Halalan for election results and PSA for poverty incidence.';
const DOCS = 'https://dynasties.bettergov.ph/developers';
// ---------- vintage (from the built index shard, cached per isolate) ----------
let vintage: { built: string; years: number[] } | null = null;
async function getVintage(env: Env): Promise<{ built: string; years: number[] }> {
    if (vintage) return vintage;
    try {
        const res = await env.ASSETS.fetch(new Request('https://assets.local/data/index.json.gz'));
        const body = res.headers.get('content-encoding') === 'gzip' ? res.body : res.body!.pipeThrough(new DecompressionStream('gzip'));
        const idx = JSON.parse(await new Response(body).text()) as { built: string; years: number[] };
        vintage = { built: idx.built, years: idx.years };
    } catch { return { built: 'unknown', years: [] }; }
    return vintage;
}

async function resultCache(url: URL, env: Env, ctx: ExecutionContext): Promise<ResultCache> {
    const v = await getVintage(env);
    // Missing release metadata disables caching instead of sharing an unsafe fallback key.
    const revision = env.WORKER_VERSION?.id && v.built !== 'unknown'
        ? JSON.stringify([env.WORKER_VERSION.id, env.CACHE_VERSION ?? '1', v.built]) : null;
    return new ResultCache(url.origin, revision, ctx);
}

// One cache entry per data operation and parsed arguments, independent of REST/MCP
// envelopes, query-string ordering, and unused query parameters. Keep internal method
// calls on dataApi so an assembled result needs only one cache lookup on a hit.
function cachedApi(cache: ResultCache, env: Env): typeof dataApi {
    return new Proxy(dataApi, {
        get(target, property, receiver) {
            const method = Reflect.get(target, property, receiver);
            if (typeof method !== 'function') return method;
            return async (...args: unknown[]) => {
                if (env.STATIC_DATA === '1') {
                    const snapshot = await apiSnapshot(env.ASSETS, String(property), args.slice(1));
                    if (snapshot) { cache.markStatic(); return snapshot.data; }
                }
                return cache.json(String(property), args.slice(1), async () => Reflect.apply(method, target, args));
            };
        },
    });
}

// ---------- REST ----------
const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=3600, s-maxage=86400', 'access-control-allow-origin': '*', 'access-control-expose-headers': 'x-result-cache, x-data-source', 'access-control-allow-headers': 'content-type, accept, mcp-session-id, mcp-protocol-version' };
async function envelope(env: Env, data: unknown, status = 200) {
    const v = await getVintage(env);
    return new Response(JSON.stringify({ data, meta: { api_version: VERSION, data_vintage: v.built, elections: v.years, source: SOURCE, license: LICENSE, docs: DOCS } }), { status, headers: HEADERS });
}
const errorResponse = (e: unknown) => { const status = e instanceof ApiError ? e.status : 500; return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e), status }), { status, headers: { ...HEADERS, 'cache-control': 'no-store' } }); };

async function rest(url: URL, env: Env, cache: ResultCache): Promise<Response> {
    const api = cachedApi(cache, env);
    const db = env.DB, q = url.searchParams;
    const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
    const v1 = parts[0] === 'v1'; if (v1) parts.shift();
    const [head, a, b, c] = parts;
    const page = clampInt(q.get('page'), 1, 1, 100000), limit = clampInt(q.get('limit'), 50, 1, 200);
    if (!head) return envelope(env, { name: 'Dynasties API', endpoints: ['/api/v1/stats', '/api/v1/coverage', '/api/v1/places', '/api/v1/places/{province}', '/api/v1/places/{province}/{town}', '/api/v1/contests?year&province&town&position&district&candidates=1&page&limit', '/api/v1/contests/{id}', '/api/v1/persons?q=&province', '/api/v1/persons?province&min_runs&sort=wins|runs|losses&page', '/api/v1/persons/{id}', '/api/v1/national/{year}', '/api/v1/national/{year}/provinces/{province}', '/api/v1/blocs?year|all&province&region&min&surname&members=1&page', '/api/v1/blocs/{id}', '/api/v1/compare?province&town&position&district', 'POST /mcp (Model Context Protocol, streamable HTTP)'], base_url: API_BASE, site: `https://${SITE_HOST}` });
    switch (head) {
        case 'stats': return envelope(env, await api.stats(db));
        case 'coverage': return envelope(env, await api.coverage(db));
        case 'places': return envelope(env, !a ? await api.places(db) : !b ? await api.province(db, a) : await api.town(db, a, b));
        case 'contests': return envelope(env, a ? await api.contest(db, a) : await api.contests(db, { year: q.get('year'), province: q.get('province'), town: q.get('town'), position: q.get('position'), district: q.get('district'), page, limit, withCandidates: q.get('candidates') === '1' }));
        case 'persons': if (a) return envelope(env, await api.person(db, a)); if (q.get('q')) return envelope(env, { persons: await api.searchPersons(db, q.get('q')!, q.get('province'), limit) }); return envelope(env, await api.persons(db, { province: q.get('province'), min_runs: q.get('min_runs'), sort: q.get('sort'), page, limit }));
        case 'national': if (!a) throw new ApiError(400, 'year required'); return envelope(env, await api.national(db, clampInt(a, 0, 1900, 2100), b === 'provinces' && c ? c : null));
        case 'blocs': return envelope(env, a ? await api.bloc(db, clampInt(a, 0, 1, 1e9)) : await api.blocs(db, { year: q.get('year'), province: q.get('province'), region: q.get('region'), min: q.get('min'), surname: q.get('surname'), page, limit, withMembers: q.get('members') === '1' }));
        case 'compare': if (!q.get('province') || !q.get('position')) throw new ApiError(400, 'province and position required'); return envelope(env, await api.compare(db, { province: q.get('province')!, town: q.get('town'), position: q.get('position')!, district: q.get('district') }));
        // legacy routes used by the site
        case 'search': { const s = q.get('q') ?? ''; if (s.trim().length < 2) return new Response(JSON.stringify({ persons: [], places: [] }), { headers: HEADERS }); const persons = await api.searchPersons(db, s, null, clampInt(q.get('limit'), 20, 1, 50)); const places = await api.searchPlaces(db, s); return new Response(JSON.stringify({ persons, places }), { headers: HEADERS }); }
        case 'person': if (!a) throw new ApiError(400, 'id required'); return new Response(JSON.stringify(await api.person(db, a)), { headers: HEADERS });
        case 'contest': if (!a) throw new ApiError(400, 'id required'); return new Response(JSON.stringify(await api.contest(db, a)), { headers: HEADERS });
        case 'place': if (!a) throw new ApiError(400, 'province required'); { const r = await api.contests(db, { province: a, town: b, year: q.get('year'), page: 1, limit: 200, withCandidates: true }); return new Response(JSON.stringify(r), { headers: HEADERS }); }
        default: throw new ApiError(404, 'route not found');
    }
}

// ---------- MCP (streamable HTTP, stateless, JSON responses) ----------
const TOOLS = [
    { name: 'search_officials', description: 'Find Philippine local politicians by surname or "Surname, First name". Returns ids to use with get_official. Results include runs, wins, active years and highest office.', inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Surname, or "Surname, First name"' }, province: { type: 'string', description: 'Optional province name or slug to narrow the search' }, limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 } }, required: ['query'] } },
    { name: 'get_official', description: 'Full election record of one politician: every candidacy 2001-2025 with place, party, votes, rank, result and match confidence, plus the surname blocs they belong to.', inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Person id from search_officials' } }, required: ['id'] } },
    { name: 'list_contests', description: 'Races in a province or town, optionally for one year or position. Town queries include the district seats (representative, board member) the town votes in. Set candidates=true to include every candidate with votes and result.', inputSchema: { type: 'object', properties: { province: { type: 'string' }, town: { type: 'string' }, year: { type: 'integer' }, position: { type: 'string', description: 'governor, vice governor, representative, board member, mayor, vice mayor, councilor' }, candidates: { type: 'boolean', default: false }, page: { type: 'integer', default: 1 }, limit: { type: 'integer', default: 50, maximum: 200 } }, required: ['province'] } },
    { name: 'get_contest', description: 'One race with all its candidates, votes, shares, winner(s), margin and, for district seats, the member towns. Give the contest id, or year + province + position with optional town and district.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, year: { type: 'integer' }, province: { type: 'string' }, town: { type: 'string' }, position: { type: 'string' }, district: { type: 'string', description: 'FIRST, SECOND, ..., LONE' } } } },
    { name: 'get_blocs', description: 'Surname blocs: officials in one province who share a surname as last or middle name. This is the dynasty analysis. Filter by province or region, election year or "all", minimum members (rule), or surname. Shared surnames signal, not prove, kinship; say so when reporting.', inputSchema: { type: 'object', properties: { province: { type: 'string' }, region: { type: 'string' }, year: { type: 'string', description: 'Election year, or "all" for 2001-2025 combined', default: '2025' }, min_members: { type: 'integer', default: 2, minimum: 2 }, surname: { type: 'string' }, members: { type: 'boolean', description: 'Include member lists', default: false }, limit: { type: 'integer', default: 25, maximum: 100 } } } },
    { name: 'compare_elections', description: 'Who held a seat across elections: the winners of one position in a province or town for every election, and who won it more than once. Answers "who keeps coming back" questions.', inputSchema: { type: 'object', properties: { province: { type: 'string' }, town: { type: 'string' }, position: { type: 'string' }, district: { type: 'string' } }, required: ['province', 'position'] } },
    { name: 'get_national_results', description: 'President, vice president, senate and party-list totals for an election year, nationally or for one province.', inputSchema: { type: 'object', properties: { year: { type: 'integer' }, province: { type: 'string' } }, required: ['year'] } },
    { name: 'get_coverage', description: 'What the data covers per election and its known gaps (which years have votes, how people are matched). Check this before quoting numbers for 2001-2013.', inputSchema: { type: 'object', properties: {} } },
];
async function callTool(env: Env, name: string, a: Record<string, unknown>, api: typeof dataApi): Promise<unknown> {
    const db = env.DB; const str = (k: string) => (a[k] == null ? null : String(a[k]));
    switch (name) {
        case 'search_officials': return { persons: await api.searchPersons(db, str('query') ?? '', str('province'), clampInt(a['limit'] as number, 20, 1, 50)) };
        case 'get_official': return api.person(db, str('id') ?? '');
        case 'list_contests': return api.contests(db, { province: str('province'), town: str('town'), year: str('year'), position: str('position'), page: clampInt(a['page'] as number, 1, 1, 100000), limit: clampInt(a['limit'] as number, 50, 1, 200), withCandidates: a['candidates'] === true });
        case 'get_contest': { if (a['id']) return api.contest(db, String(a['id'])); if (!a['year'] || !a['province'] || !a['position']) throw new ApiError(400, 'give id, or year + province + position'); const r = await api.contests(db, { year: str('year'), province: str('province'), town: str('town'), position: str('position'), district: str('district'), page: 1, limit: 5, withCandidates: true }); if (!r.contests.length) throw new ApiError(404, 'no such contest'); return r.contests.length === 1 ? r.contests[0] : { note: 'several contests match; pass district or town to narrow', contests: r.contests }; }
        case 'get_blocs': return api.blocs(db, { year: str('year') ?? '2025', province: str('province'), region: str('region'), min: a['min_members'] as number, surname: str('surname'), page: 1, limit: clampInt(a['limit'] as number, 25, 1, 100), withMembers: a['members'] === true });
        case 'compare_elections': return api.compare(db, { province: str('province') ?? '', town: str('town'), position: str('position') ?? '', district: str('district') });
        case 'get_national_results': return api.national(db, clampInt(a['year'] as number, 0, 1900, 2100), str('province'));
        case 'get_coverage': return api.coverage(db);
        default: throw new ApiError(404, `unknown tool ${name}`);
    }
}
type JsonRpc = { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: Record<string, unknown> };
async function mcp(request: Request, env: Env, cache: ResultCache): Promise<Response> {
    const api = cachedApi(cache, env);
    const mcpHeaders = { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-expose-headers': 'x-result-cache, x-data-source', 'access-control-allow-headers': 'content-type, accept, mcp-session-id, mcp-protocol-version', 'cache-control': 'no-store' };
    if (request.method === 'GET') return new Response(JSON.stringify({ name: 'dynasties', transport: 'streamable-http', note: 'POST JSON-RPC 2.0 here. Server-sent events are not used.' }), { status: 405, headers: mcpHeaders });
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: mcpHeaders });
    let body: JsonRpc | JsonRpc[];
    try { body = await request.json() as JsonRpc | JsonRpc[]; } catch { return new Response(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }), { status: 400, headers: mcpHeaders }); }
    const v = await getVintage(env);
    const handle = async (m: JsonRpc): Promise<Record<string, unknown> | null> => {
        const reply = (result: unknown) => ({ jsonrpc: '2.0', id: m.id ?? null, result });
        const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id: m.id ?? null, error: { code, message } });
        try {
            switch (m.method) {
                case 'initialize': return reply({ protocolVersion: (m.params?.['protocolVersion'] as string) ?? '2025-03-26', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'dynasties', title: 'Dynasties: Philippine election data by BetterGov.ph', version: VERSION }, instructions: `Philippine local election data 2001-${v.years[v.years.length - 1] ?? 2025}: every candidate, winner, and surname bloc by region, province and town, plus national results. Data vintage ${v.built}. Source: ${SOURCE}. Cite Open Halalan for election figures. Surname blocs indicate shared names, not proven kinship. Votes exist only from 2010; call get_coverage for gaps.` });
                case 'notifications/initialized': case 'notifications/cancelled': return null;
                case 'ping': return reply({});
                case 'tools/list': return reply({ tools: TOOLS });
                case 'tools/call': {
                    const name = String(m.params?.['name'] ?? ''), args = (m.params?.['arguments'] as Record<string, unknown>) ?? {};
                    try { const data = await callTool(env, name, args, api); const payload = { data, source: SOURCE, data_vintage: v.built }; return reply({ content: [{ type: 'text', text: JSON.stringify(payload) }], structuredContent: payload }); }
                    catch (e) { return reply({ content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }], isError: true }); }
                }
                default: return fail(-32601, `method not found: ${m.method}`);
            }
        } catch (e) { return fail(-32603, e instanceof Error ? e.message : String(e)); }
    };
    if (Array.isArray(body)) { const out = (await Promise.all(body.map(handle))).filter(Boolean); return out.length ? new Response(JSON.stringify(out), { headers: mcpHeaders }) : new Response(null, { status: 202, headers: mcpHeaders }); }
    const out = await handle(body);
    return out ? new Response(JSON.stringify(out), { headers: mcpHeaders }) : new Response(null, { status: 202, headers: mcpHeaders });
}

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);
        if (request.method === 'OPTIONS' && (url.pathname.startsWith('/api') || url.pathname === '/mcp')) return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type, accept, mcp-session-id, mcp-protocol-version', 'access-control-max-age': '86400' } });
        if (url.pathname === '/mcp' || url.pathname === '/mcp/') {
            const cache = await resultCache(url, env, ctx);
            return cache.annotate(await mcp(request, env, cache));
        }
        if (url.hostname === API_HOST && !url.pathname.startsWith('/api')) {
            // The API host has no pages: its root is the endpoint index, everything else goes to the site.
            if (url.pathname === '/' || url.pathname === '') {
                const cache = await resultCache(url, env, ctx);
                return cache.annotate(await rest(new URL('/api/v1', url), env, cache));
            }
            return Response.redirect(`https://${SITE_HOST}${url.pathname}${url.search}`, 302);
        }
        if (!url.pathname.startsWith('/api')) {
            if (url.pathname === '/robots.txt') return robots();
            if (url.pathname.startsWith('/sitemap')) {
                try {
                    const produce = async () => (await sitemap(url, env, (await getVintage(env)).built)) ?? new Response('not found', { status: 404 });
                    if (request.method !== 'GET') return await produce();
                    const cache = await resultCache(url, env, ctx);
                    return await cache.response('sitemap', url.pathname, produce);
                } catch (e) { return errorResponse(e); }
            }
            // Pages: rewrite index.html per URL with title, description, canonical, JSON-LD and a crawlable summary.
            if (request.method === 'GET' && !url.pathname.startsWith('/data/') && !url.pathname.startsWith('/assets/') && !/\.[a-z0-9]{2,5}$/i.test(url.pathname)) {
                const cache = await resultCache(url, env, ctx);
                // Preserve query parameters: some page metadata includes the query string.
                return cache.response('html', url.pathname + url.search, () => renderPage(request, env, url));
            }
            return env.ASSETS.fetch(request);
        }
        if (request.method !== 'GET') return errorResponse(new ApiError(405, 'method not allowed'));
        try {
            const cache = await resultCache(url, env, ctx);
            return cache.annotate(await rest(url, env, cache));
        } catch (e) { return errorResponse(e); }
    },
} satisfies ExportedHandler<Env>;
