import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { existsSync } from 'node:fs';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import { loadWorkerModules, d1Adapter } from '../scripts/lib/worker-modules.mjs';

const modules = await loadWorkerModules();
after(modules.cleanup);
const worker = modules.index.default;
const publicDir = new URL('../public/', import.meta.url);
const manifest = JSON.parse(gunzipSync(await readFile(new URL('data/snapshots/manifest.json.gz', publicDir))));
const readSnapshot = async file => JSON.parse(gunzipSync(await readFile(new URL(`data/snapshots/${file}`, publicDir)))).data;
const databasePath = new URL('../data/dynasty.sqlite', import.meta.url).pathname;
const realSqlite = existsSync(databasePath) ? new DatabaseSync(databasePath, { readOnly: true }) : null;
const realDb = realSqlite ? d1Adapter(realSqlite) : null;
after(() => realSqlite?.close());

function fixture() {
    const state = { queries: 0, overrides: new Map(), assets: [] };
    globalThis.caches = { default: { async match() {}, async put() {} } }; // Every request is cold.
    globalThis.HTMLRewriter = class {
        content = [];
        on(selector, handler) {
            handler.element({ setInnerContent: value => this.content.push(value), setAttribute() {}, append: value => this.content.push(value) });
            return this;
        }
        transform(response) { return new Response(this.content.join('\n'), { headers: response.headers }); }
    };
    const env = {
        STATIC_DATA: '1', WORKER_VERSION: { id: 'test-static' }, CACHE_VERSION: '1',
        DB: { prepare() { state.queries++; throw new Error('D1 must not be queried'); } },
        ASSETS: { async fetch(request) {
            const route = new URL(request.url).pathname;
            state.assets.push(route);
            if (state.overrides.has(route)) return state.overrides.get(route).clone();
            if (!route.startsWith('/data/')) return new Response('<main id="view"></main>', { headers: { 'content-type': 'text/html' } });
            try {
                return new Response(await readFile(new URL(route.slice(1), publicDir)), { headers: { 'content-type': route.endsWith('.xml') ? 'application/xml' : 'application/gzip' } });
            } catch { return new Response('Not found', { status: 404 }); }
        } },
    };
    async function request(route, init) {
        const pending = [];
        const response = await worker.fetch(new Request(`https://dynasties.bettergov.ph${route}`, init), env, { waitUntil(value) { pending.push(value); } });
        await Promise.all(pending);
        return response;
    }
    return { state, request, env };
}

test('common REST endpoints work on a cold cache with D1 disabled', async () => {
    const f = fixture();
    for (const route of ['/api/v1/stats', '/api/v1/coverage', '/api/v1/places', '/api/v1/places/Cebu', '/api/v1/places/cebu/cebu', '/api/v1/national/2025', '/api/v1/national/2025/provinces/cebu', '/api/v1/persons?sort=wins&limit=10', '/api/v1/persons?sort=runs&province=Cebu']) {
        const response = await f.request(route);
        assert.equal(response.status, 200, route);
        assert.equal(response.headers.get('x-result-cache'), 'STATIC', route);
        assert.equal(response.headers.get('x-data-source'), 'static', route);
        const payload = await response.json();
        assert.equal(payload.meta.data_vintage, manifest.built);
        assert.ok(payload.data);
    }
    assert.equal(f.state.queries, 0);
});

test('snapshot payloads retain the existing query results and requested leaderboard limit', { skip: !realDb }, async () => {
    const f = fixture();
    for (const [route, operation, args] of [
        ['/api/v1/stats', 'stats', []],
        ['/api/v1/coverage', 'coverage', []],
        ['/api/v1/places/cebu', 'province', ['cebu']],
        ['/api/v1/places/cebu/cebu', 'town', ['cebu', 'cebu']],
        ['/api/v1/national/2025/provinces/cebu', 'national', [2025, 'cebu']],
        ['/api/v1/persons?sort=losses&limit=7', 'persons', [{ sort: 'losses', limit: 7 }]],
    ]) {
        const expected = JSON.parse(JSON.stringify(await modules.api.dataApi[operation](realDb, ...args)));
        assert.deepEqual((await (await f.request(route)).json()).data, expected, route);
    }
    assert.equal(f.state.queries, 0);
});

test('MCP consumes snapshots while preserving request ids and transport headers', async () => {
    const f = fixture();
    for (const [id, name, args] of [[1, 'get_coverage', {}], ['second', 'get_national_results', { year: 2025, province: 'Cebu' }]]) {
        const response = await f.request('/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }) });
        const payload = await response.json();
        assert.equal(payload.id, id);
        assert.ok(payload.result.structuredContent.data);
        assert.equal(response.headers.get('x-data-source'), 'static');
        assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    assert.equal(f.state.queries, 0);
});

test('all page categories, including politician pages, render from JSON without D1', async () => {
    const f = fixture();
    const bucket = await readSnapshot(`seo/persons/${manifest.personBuckets[0]}.json.gz`);
    const personRoute = Object.keys(bucket)[0];
    for (const route of ['/', '/regional?year=2025', '/province/cebu', '/province/cebu/cebu', '/national/2025', personRoute, '/search?q=marcos', '/developers']) {
        const response = await f.request(route);
        assert.equal(response.status, 200, route);
        assert.equal(response.headers.get('x-data-source'), 'static');
        assert.ok((await response.text()).includes('Dynasties'));
    }
    assert.equal(f.state.queries, 0);
});

test('generated SEO summaries match the original rendering inputs', { skip: !realDb }, async () => {
    const paths = ['/province/cebu', '/province/cebu/cebu', '/national/2025'];
    for (const prefix of [manifest.personBuckets[0], manifest.personBuckets.at(-1)]) {
        const bucket = await readSnapshot(`seo/persons/${prefix}.json.gz`);
        const route = Object.keys(bucket)[0];
        assert.deepEqual(bucket[route], await modules.seo.seoFor(new URL(route, 'https://dynasties.bettergov.ph'), realDb));
    }
    for (const route of paths) {
        const bucket = await readSnapshot(manifest.seoPages[route]);
        assert.deepEqual(bucket[route], await modules.seo.seoFor(new URL(route, 'https://dynasties.bettergov.ph'), realDb));
    }
});

test('all sitemap files are served from assets even with a cold cache', async () => {
    const f = fixture();
    for (const route of manifest.sitemaps) {
        const response = await f.request(route);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('x-data-source'), 'static');
        assert.match(await response.text(), /<(urlset|sitemapindex) /);
    }
    assert.equal(f.state.queries, 0);
});

test('unknown places, elections, pages and sitemap pages return 404 without D1', async () => {
    const f = fixture();
    for (const route of ['/api/v1/places/nonexistent', '/api/v1/places/cebu/nonexistent', '/api/v1/national/1900', '/province/nonexistent', '/person/cebu/zzzzzzzzzz', '/sitemap-persons-999.xml', '/nonexistent']) {
        assert.equal((await f.request(route)).status, 404, route);
    }
    assert.equal(f.state.queries, 0);
});

test('missing snapshots never fall back to billable D1 queries', async () => {
    const f = fixture();
    f.state.overrides.set('/data/snapshots/api/stats.json.gz', new Response('<html>SPA fallback</html>', { headers: { 'content-type': 'text/html' } }));
    assert.equal((await f.request('/api/v1/stats')).status, 503);
    f.state.overrides.set('/data/snapshots/seo/provinces/cebu.json.gz', new Response('Unavailable', { status: 503 }));
    const page = await f.request('/province/cebu');
    assert.equal(page.status, 503);
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.equal(f.state.queries, 0);
});

test('mismatched snapshot vintages are rejected without using D1', async () => {
    const f = fixture();
    f.state.overrides.set('/data/snapshots/api/stats.json.gz', new Response(gzipSync(JSON.stringify({ format: 1, built: 'outdated', data: {} }))));
    assert.equal((await f.request('/api/v1/stats')).status, 503);
    assert.equal(f.state.queries, 0);
});

test('flexible filters and direct API search retain the existing database path', async () => {
    const f = fixture();
    for (const route of ['/api/v1/persons?page=2', '/api/v1/persons?min_runs=5', '/api/v1/persons?q=marcos']) {
        assert.equal((await f.request(route)).status, 500); // Deliberately disabled D1 was reached.
    }
    assert.equal(f.state.queries, 3);
});

const browserOutput = await mkdtemp(path.join(tmpdir(), 'dynasty-search-test-'));
after(() => rm(browserOutput, { recursive: true, force: true }));
for (const name of ['data', 'util', 'views/shared', 'views/search']) {
    const source = await readFile(new URL(`../src/${name}.ts`, import.meta.url), 'utf8');
    const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } });
    await mkdir(path.dirname(path.join(browserOutput, name)), { recursive: true });
    await writeFile(path.join(browserOutput, `${name}.mjs`), outputText.replace(/from '(\.\.?\/[^']+)'/g, "from '$1.mjs'"));
}
const { searchPeople } = await import(pathToFileURL(path.join(browserOutput, 'views/search.mjs')).href);

test('browser search uses only JSON shards and preserves full election-year ranges', async () => {
    const originalFetch = globalThis.fetch;
    const requested = [];
    globalThis.fetch = async route => {
        requested.push(route);
        assert.match(route, /^\/data\/snapshots\/search\/[A-Z_]\.json\.gz$/);
        return new Response(await readFile(new URL(route.slice(1), publicDir)));
    };
    try {
        for (const query of ['marcos', 'Duterte, Sara', 'Sara Duterte']) {
            const hits = await searchPeople(query, slug => slug);
            assert.ok(hits.length > 0);
            if (realDb) {
                const expected = await modules.api.dataApi.searchPersons(realDb, query, null, 50);
                assert.deepEqual(hits.map(hit => hit.id).sort(), expected.map(person => person.id).sort());
            }
            for (const hit of hits) assert.match(hit.years, /^\d{4}–\d{4}$/);
        }
        assert.ok(requested.length > 0);
        globalThis.fetch = async () => { throw new Error('Unavailable shard'); };
        await assert.rejects(() => searchPeople('Zzzzz', slug => slug), /Unavailable shard/);
    } finally { globalThis.fetch = originalFetch; }
});
