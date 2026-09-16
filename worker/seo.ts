/// <reference types="@cloudflare/workers-types" />
/**
 * Per-URL SEO for the single-page app: the Worker rewrites index.html with a real title, description,
 * canonical link, JSON-LD and a server-rendered summary (with crawlable links) for people, provinces,
 * towns and national results, and serves sitemaps and robots.txt from D1.
 */
import type { Env } from './index';

const SITE = 'https://dynasties.bettergov.ph';
const BRAND = 'Dynasties by BetterGov.ph';
const DEFAULT_DESC = 'The political map of the Philippines: every candidate for local office since 2001, who won, who lost, who keeps coming back, and which surnames hold the seats in every province and town.';
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const title = (s: string) => (s ?? '').toLowerCase().replace(/(^|[\s\-,.'(])(\S)/g, (_m, a: string, b: string) => a + b.toUpperCase()).replace(/\bNcr\b/g, 'NCR').replace(/\bDe\b/g, 'de').replace(/\bDel\b/g, 'del').replace(/\b(Ii|Iii|Iv|Jr|Sr)\b/g, m => m.toUpperCase());
const POS: Record<string, string> = { 'MEMBER, HOUSE OF REPRESENTATIVES': 'Representative', 'PROVINCIAL BOARD MEMBER': 'Board Member' };
const posLabel = (p: string) => POS[p] ?? title(p);
type Row = Record<string, unknown>;

interface Seo { title: string; description: string; canonical: string; jsonld?: unknown; body?: string; noindex?: boolean; status?: number }

async function seoFor(url: URL, db: D1Database): Promise<Seo> {
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const canonical = SITE + path + (path === '/regional' && url.search ? url.search : '');
    const base: Seo = { title: `${BRAND}: the political map of the Philippines, 2001–2025`, description: DEFAULT_DESC, canonical };
    let m: RegExpMatchArray | null;
    if (['/', '/atlas', '/network', '/ledger', '/dynasties'].includes(path)) {
        return { ...base, canonical: SITE + '/', jsonld: [{ '@context': 'https://schema.org', '@type': 'WebSite', name: 'Dynasties', url: SITE, publisher: { '@type': 'Organization', name: 'BetterGov.ph', url: 'https://bettergov.ph' }, potentialAction: { '@type': 'SearchAction', target: `${SITE}/search?q={q}`, 'query-input': 'required name=q' } }, { '@context': 'https://schema.org', '@type': 'Dataset', name: 'Dynasties: Philippine local election candidates and winners, 2001–2025', description: DEFAULT_DESC, url: SITE, license: 'https://creativecommons.org/publicdomain/zero/1.0/', creator: { '@type': 'Organization', name: 'BetterGov.ph' }, isBasedOn: 'https://robertrleung.github.io/OpenHalalan/', temporalCoverage: '2001/2025', spatialCoverage: 'Philippines', distribution: [{ '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: 'https://officials.bettergov.ph/api/v1' }] }], body: `<div class="page"><h1>Political dynasties in the Philippines, 2001–2025</h1><p>${esc(DEFAULT_DESC)}</p><p><a href="/regional">Browse regions, provinces and towns</a> · <a href="/officials">Search officials</a> · <a href="/national">National results</a> · <a href="/about">About and sources</a></p></div>` };
    }
    if (path === '/regional' || path === '/map' || path === '/regions') {
        const provs = await db.prepare(`SELECT p.name, p.slug, r.name AS region FROM provinces p JOIN regions r ON r.id = p.region_id ORDER BY r.name, p.name`).all<Row>();
        return { ...base, canonical: SITE + '/regional', title: `Regions, provinces and towns of the Philippines: elections 2001–2025 · ${BRAND}`, description: 'Every region, province and town in the Philippines with its elected officials, candidates, votes and contests for every local election from 2001 to 2025.', body: `<div class="page"><h1>Regions and provinces</h1><ul>${provs.results.map(p => `<li><a href="/province/${esc(p['slug'])}">${esc(title(String(p['name'])))}</a> (${esc(String(p['region']))})</li>`).join('')}</ul></div>` };
    }
    if ((m = path.match(/^\/province\/([^/]+)$/))) {
        const p = await db.prepare(`SELECT p.id, p.name, p.slug, p.poverty, r.name AS region FROM provinces p JOIN regions r ON r.id = p.region_id WHERE p.slug = ?1`).bind(m[1]).first<Row>();
        if (!p) return { ...base, noindex: true, status: 404, title: `Province not found · ${BRAND}` };
        const [towns, gov, stats] = await Promise.all([
            db.prepare(`SELECT name, slug FROM cities WHERE province_id = ?1 ORDER BY name`).bind(p['id']).all<Row>(),
            db.prepare(`SELECT c.year, pe.display_name, pe.id AS pid FROM candidacies c JOIN persons pe ON pe.id = c.person_id WHERE c.province_id = ?1 AND c.position = 'GOVERNOR' AND c.won = 1 ORDER BY c.year DESC`).bind(p['id']).all<Row>(),
            db.prepare(`SELECT COUNT(DISTINCT person_id) people, COUNT(*) candidacies, MIN(year) y0, MAX(year) y1 FROM candidacies WHERE province_id = ?1`).bind(p['id']).first<Row>(),
        ]);
        const name = title(String(p['name']));
        const desc = `${name} (${String(p['region'])}): ${towns.results.length} cities and towns, ${Number(stats?.['people']).toLocaleString('en-US')} people who ran for local office ${stats?.['y0']}–${stats?.['y1']}. Governors, mayors, representatives, board members and councilors with votes and results.`;
        return { ...base, title: `${name} elections 2001–2025: governors, mayors, representatives · ${BRAND}`, description: desc, jsonld: { '@context': 'https://schema.org', '@type': 'AdministrativeArea', name, url: canonical, containedInPlace: { '@type': 'AdministrativeArea', name: String(p['region']) } }, body: `<div class="page"><h1>${esc(name)}</h1><p>${esc(desc)}</p><h2>Governors</h2><ul>${gov.results.map(g => `<li>${g['year']}: <a href="/person/${esc(p['slug'])}/${esc(g['pid'])}">${esc(title(String(g['display_name'])))}</a></li>`).join('')}</ul><h2>Cities and towns</h2><ul>${towns.results.map(t => `<li><a href="/province/${esc(p['slug'])}/${esc(t['slug'])}">${esc(title(String(t['name'])))}</a></li>`).join('')}</ul></div>` };
    }
    if ((m = path.match(/^\/province\/([^/]+)\/([^/]+)$/))) {
        const c = await db.prepare(`SELECT c.id, c.name, c.slug, p.name AS province, p.slug AS pslug, r.name AS region FROM cities c JOIN provinces p ON p.id = c.province_id JOIN regions r ON r.id = p.region_id WHERE p.slug = ?1 AND c.slug = ?2`).bind(m[1], m[2]).first<Row>();
        if (!c) return { ...base, noindex: true, status: 404, title: `Town not found · ${BRAND}` };
        const mayors = await db.prepare(`SELECT c.year, c.position, pe.display_name, pe.id AS pid FROM candidacies c JOIN persons pe ON pe.id = c.person_id WHERE c.city_id = ?1 AND c.position IN ('MAYOR','VICE MAYOR') AND c.won = 1 ORDER BY c.year DESC, c.position`).bind(c['id']).all<Row>();
        const name = title(String(c['name'])), prov = title(String(c['province']));
        const desc = `${name}, ${prov}: mayors, vice mayors and councilors elected from 2001 to 2025 with votes, margins and results, plus the representative and board seats the town votes for.`;
        return { ...base, title: `${name}, ${prov}: election results 2001–2025 · ${BRAND}`, description: desc, jsonld: { '@context': 'https://schema.org', '@type': 'City', name, url: canonical, containedInPlace: { '@type': 'AdministrativeArea', name: prov } }, body: `<div class="page"><h1>${esc(name)}, <a href="/province/${esc(c['pslug'])}">${esc(prov)}</a></h1><p>${esc(desc)}</p><h2>Mayors and vice mayors</h2><ul>${mayors.results.map(g => `<li>${g['year']} ${esc(posLabel(String(g['position'])))}: <a href="/person/${esc(c['pslug'])}/${esc(g['pid'])}">${esc(title(String(g['display_name'])))}</a></li>`).join('')}</ul></div>` };
    }
    if ((m = path.match(/^\/person\/([^/]+)\/([^/]+)$/))) {
        const p = await db.prepare(`SELECT p.*, pr.name AS province, pr.slug AS pslug FROM persons p JOIN provinces pr ON pr.id = p.home_province_id WHERE p.id = ?1`).bind(m[2]).first<Row>();
        if (!p) return { ...base, noindex: true, status: 404, title: `Person not found · ${BRAND}` };
        const cands = await db.prepare(`SELECT c.year, c.position, c.party, c.votes, c.won, ci.name AS city, k.district FROM candidacies c JOIN contests k ON k.id = c.contest_id LEFT JOIN cities ci ON ci.id = c.city_id WHERE c.person_id = ?1 ORDER BY c.year`).bind(m[2]).all<Row>();
        const name = title(String(p['display_name'])), prov = title(String(p['province']));
        const top = p['top_position'] ? posLabel(String(p['top_position'])) : 'candidate';
        const desc = `${name}, ${prov}: ${p['runs']} run${p['runs'] === 1 ? '' : 's'} for local office ${p['first_year']}–${p['last_year']}, ${p['wins']} won. Highest office: ${top}. Full election record with votes, parties and results.`;
        return { ...base, title: `${name} (${prov}) – election record · ${BRAND}`, description: desc, jsonld: { '@context': 'https://schema.org', '@type': 'Person', name, url: canonical, jobTitle: top, homeLocation: { '@type': 'AdministrativeArea', name: prov }, affiliation: [...new Set(cands.results.map(c => String(c['party'])).filter(Boolean))].map(n => ({ '@type': 'Organization', name: n })) }, body: `<div class="page"><h1>${esc(name)}</h1><p>${esc(desc)}</p><ul>${cands.results.map(c => `<li>${c['year']}: ${esc(posLabel(String(c['position'])))}${c['district'] ? ' · ' + esc(title(String(c['district']))) + ' district' : ''}, ${esc(c['city'] ? title(String(c['city'])) : prov)}${c['party'] ? ' (' + esc(String(c['party'])) + ')' : ''}${c['votes'] != null ? ', ' + Number(c['votes']).toLocaleString('en-US') + ' votes' : ''} – ${c['won'] ? 'won' : 'lost'}</li>`).join('')}</ul><p><a href="/province/${esc(p['pslug'])}">${esc(prov)}</a></p></div>` };
    }
    if ((m = path.match(/^\/national(?:\/(\d{4}))?$/))) {
        const year = m[1] ?? '2025';
        const rows = await db.prepare(`SELECT position, name, party, votes FROM national_candidates WHERE year = ?1 AND won = 1 ORDER BY position, rank`).bind(+year).all<Row>();
        return { ...base, canonical: `${SITE}/national/${year}`, title: `${year} Philippine national election results: president, vice president, senators · ${BRAND}`, description: `Official vote totals for the ${year} Philippine national election: president, vice president, the twelve winning senators and party-list groups, with each province's share.`, body: `<div class="page"><h1>${esc(year)} national election results</h1><ul>${rows.results.map(r => `<li>${esc(posLabel(String(r['position'])))}: ${esc(title(String(r['name'])))}${r['party'] ? ' (' + esc(String(r['party'])) + ')' : ''}, ${Number(r['votes']).toLocaleString('en-US')} votes</li>`).join('')}</ul></div>` };
    }
    if (path === '/officials' || path === '/people') return { ...base, canonical: SITE + '/officials', title: `Officials search: every Philippine local politician since 2001 · ${BRAND}`, description: 'Search 175,000 people who ran for governor, mayor, representative, board member or councilor in the Philippines since 2001, and see who keeps winning, running and losing.' };
    if (path === '/search') return { ...base, noindex: true, title: `Search · ${BRAND}` };
    if (path === '/about') return { ...base, title: `About Dynasties: sources, method and BetterGov.ph · ${BRAND}`, description: 'How Dynasties is built: Open Halalan election results, PSA poverty data, PSGC boundaries, how people are matched across elections, and the caveats to keep in mind.' };
    if (path === '/developers' || path === '/api-docs') return { ...base, canonical: SITE + '/developers', title: `API and MCP server for Philippine election data · ${BRAND}`, description: 'A free read-only JSON API and Model Context Protocol server for Philippine local election data 2001–2025: candidates, winners, contests, surname blocs and national results.' };
    return { ...base, noindex: true, status: 404, title: `Page not found · ${BRAND}` };
}

export async function renderPage(request: Request, env: Env, url: URL): Promise<Response> {
    const res = await env.ASSETS.fetch(request);
    if (!(res.headers.get('content-type') ?? '').includes('text/html')) return res;
    let seo: Seo;
    try { seo = await seoFor(url, env.DB); } catch { seo = { title: `${BRAND}`, description: DEFAULT_DESC, canonical: SITE + url.pathname }; }
    const head = [`<link rel="canonical" href="${esc(seo.canonical)}">`, `<meta name="twitter:card" content="summary_large_image">`, `<meta name="twitter:title" content="${esc(seo.title)}">`, `<meta name="twitter:description" content="${esc(seo.description)}">`, seo.jsonld ? `<script type="application/ld+json">${JSON.stringify(seo.jsonld).replace(/</g, '\\u003c')}</script>` : ''].join('');
    const out = new HTMLRewriter()
        .on('title', { element(e) { e.setInnerContent(seo.title); } })
        .on('meta[name="description"]', { element(e) { e.setAttribute('content', seo.description); } })
        .on('meta[property="og:title"]', { element(e) { e.setAttribute('content', seo.title); } })
        .on('meta[property="og:description"]', { element(e) { e.setAttribute('content', seo.description); } })
        .on('meta[property="og:url"]', { element(e) { e.setAttribute('content', seo.canonical); } })
        .on('meta[name="robots"]', { element(e) { e.setAttribute('content', seo.noindex ? 'noindex, follow' : 'index, follow'); } })
        .on('head', { element(e) { e.append(head, { html: true }); } })
        .on('main#view', { element(e) { if (seo.body) e.setInnerContent(seo.body, { html: true }); } })
        .transform(res);
    const h = new Headers(out.headers); h.set('cache-control', 'public, max-age=600, s-maxage=3600'); h.set('vary', 'accept-encoding');
    return new Response(out.body, { status: seo.status ?? out.status, headers: h });
}

const PERSONS_PER_SITEMAP = 40000;
const xml = (body: string) => new Response(`<?xml version="1.0" encoding="UTF-8"?>\n${body}`, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=86400' } });
export async function sitemap(url: URL, env: Env, vintage: string): Promise<Response | null> {
    const db = env.DB;
    if (url.pathname === '/sitemap.xml') {
        const n = Number((await db.prepare(`SELECT COUNT(*) n FROM persons`).first<Row>())?.['n'] ?? 0);
        const files = ['/sitemap-pages.xml', ...Array.from({ length: Math.ceil(n / PERSONS_PER_SITEMAP) }, (_, i) => `/sitemap-persons-${i + 1}.xml`)];
        return xml(`<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${files.map(f => `<sitemap><loc>${SITE}${f}</loc><lastmod>${vintage}</lastmod></sitemap>`).join('')}</sitemapindex>`);
    }
    if (url.pathname === '/sitemap-pages.xml') {
        const provs = await db.prepare(`SELECT slug FROM provinces ORDER BY slug`).all<Row>();
        const towns = await db.prepare(`SELECT c.slug, p.slug AS pslug FROM cities c JOIN provinces p ON p.id = c.province_id ORDER BY p.slug, c.slug`).all<Row>();
        const years = await db.prepare(`SELECT DISTINCT year FROM national_candidates ORDER BY year`).all<Row>();
        const urls = ['/', '/regional', '/officials', '/national', '/about', '/developers', ...years.results.map(y => `/national/${y['year']}`), ...provs.results.map(p => `/province/${p['slug']}`), ...towns.results.map(t => `/province/${t['pslug']}/${t['slug']}`)];
        return xml(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(u => `<url><loc>${SITE}${u}</loc><lastmod>${vintage}</lastmod></url>`).join('')}</urlset>`);
    }
    const m = url.pathname.match(/^\/sitemap-persons-(\d+)\.xml$/);
    if (m) {
        const page = Math.max(1, +m[1]!);
        const rows = await db.prepare(`SELECT p.id, pr.slug FROM persons p JOIN provinces pr ON pr.id = p.home_province_id ORDER BY p.rowid LIMIT ?1 OFFSET ?2`).bind(PERSONS_PER_SITEMAP, (page - 1) * PERSONS_PER_SITEMAP).all<Row>();
        if (!rows.results.length) return null;
        return xml(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${rows.results.map(r => `<url><loc>${SITE}/person/${r['slug']}/${r['id']}</loc><lastmod>${vintage}</lastmod></url>`).join('')}</urlset>`);
    }
    return null;
}
export const robots = () => new Response(`User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /mcp\nDisallow: /search\n\nSitemap: ${SITE}/sitemap.xml\n`, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=86400' } });
