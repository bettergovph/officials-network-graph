import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import ts from 'typescript';

// Compile the real Worker for Node using the project's existing TypeScript dependency.
// Runtime bindings are replaced below; no dev server or remote D1 calls are needed.
const output = await mkdtemp(path.join(tmpdir(), 'dynasty-cache-test-'));
after(() => rm(output, { recursive: true, force: true }));
for (const name of await readdir(new URL('../worker/', import.meta.url))) {
    if (!name.endsWith('.ts')) continue;
    const source = await readFile(new URL(`../worker/${name}`, import.meta.url), 'utf8');
    const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } });
    await writeFile(path.join(output, name.replace(/\.ts$/, '.mjs')), outputText.replace(/from '(\.\/[^']+)'/g, "from '$1.mjs'"));
}

class MemoryCache {
    entries = new Map();
    now = 0;
    failRead = false;
    failWrite = false;
    async match(request) {
        if (this.failRead) throw new Error('cache unavailable');
        const entry = this.entries.get(request.url);
        return entry && entry.expires > this.now ? entry.response.clone() : undefined;
    }
    async put(request, response) {
        if (this.failWrite) throw new Error('cache unavailable');
        const cc = response.headers.get('cache-control');
        const ttl = Number(/s-maxage=(\d+)/.exec(cc)?.[1] ?? /max-age=(\d+)/.exec(cc)?.[1]);
        assert.ok(ttl > 0);
        this.entries.set(request.url, { response: response.clone(), expires: this.now + ttl });
    }
}

let sequence = 0;
async function fixture() {
    const worker = (await import(`${pathToFileURL(path.join(output, 'index.mjs')).href}?test=${sequence++}`)).default;
    const cache = new MemoryCache();
    globalThis.caches = { default: cache };
    // SEO content generation still runs; only the Cloudflare streaming HTML primitive is stubbed.
    globalThis.HTMLRewriter = class {
        on() { return this; }
        transform(response) { return response; }
    };
    const state = { queries: [], failDb: false, failVintage: false, built: '2026-09-14' };
    const env = {
        WORKER_VERSION: { id: 'release-1' }, CACHE_VERSION: '1',
        ASSETS: { async fetch(request) {
            if (new URL(request.url).pathname === '/data/index.json.gz') {
                if (state.failVintage) return new Response('unavailable', { status: 503 });
                return new Response(gzipSync(JSON.stringify({ built: state.built, years: [2025] })));
            }
            return new Response('<html><head></head><body><main id="view"></main></body></html>', { headers: { 'content-type': 'text/html' } });
        } },
        DB: { prepare(sql) {
            let args = [];
            const query = () => {
                state.queries.push({ sql, args });
                if (state.failDb) throw new Error('D1 unavailable');
                return [{ id: args[0] ?? 'example', name: 'CEBU', slug: 'cebu', region: 'Region VII', year: 2025, n: 1 }];
            };
            return {
                bind(...values) { args = values; return this; },
                async all() { return { results: query() }; },
                async first() { return query()[0]; },
            };
        } },
    };
    async function request(route, init) {
        const pending = [];
        const response = await worker.fetch(new Request(`https://dynasties.bettergov.ph${route}`, init), env, { waitUntil(p) { pending.push(p); } });
        await Promise.all(pending);
        return response;
    }
    const rpc = (id, name, args = {}) => request('/mcp', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }),
    });
    return { cache, env, state, request, rpc };
}

test('REST results are reused by MCP without retaining RPC ids', async () => {
    const f = await fixture();
    const first = await f.request('/api/v1/coverage');
    assert.equal(first.headers.get('x-result-cache'), 'MISS');
    const data = (await first.json()).data;
    for (const id of [42, 'another-caller']) {
        const response = await f.rpc(id, 'get_coverage');
        assert.equal(response.headers.get('x-result-cache'), 'HIT');
        assert.equal(response.headers.get('cache-control'), 'no-store');
        const body = await response.json();
        assert.equal(body.id, id);
        assert.deepEqual(body.result.structuredContent.data, data);
    }
    assert.equal(f.state.queries.length, 1);
});

test('MCP fills results for REST and legacy person endpoints', async () => {
    const f = await fixture();
    await f.rpc(1, 'get_official', { id: 'person-1' });
    const reads = f.state.queries.length;
    assert.equal(reads, 3);
    for (const route of ['/api/v1/persons/person-1', '/api/person/person-1']) {
        const response = await f.request(route);
        assert.equal(response.headers.get('x-result-cache'), 'HIT');
    }
    assert.equal(f.state.queries.length, reads);
    await f.request('/api/person/person-2');
    assert.equal(f.state.queries.length, reads + 3);
});

test('parsed arguments ignore query order, unused parameters and equivalent numeric defaults', async () => {
    const f = await fixture();
    await f.request('/api/v1/persons?q=marcos&limit=50');
    const hit = await f.request('/api/v1/persons?unused=random&limit=050&q=marcos');
    assert.equal(hit.headers.get('x-result-cache'), 'HIT');
    assert.equal(f.state.queries.length, 1);
    await f.rpc(2, 'search_officials', { query: 'marcos', limit: 50 });
    assert.equal(f.state.queries.length, 1);
    await f.request('/api/v1/persons?q=marcos&limit=20');
    await f.request('/api/v1/persons?q=duterte&limit=50');
    assert.equal(f.state.queries.length, 3);
});

test('legacy search caches both people and place lookups', async () => {
    const f = await fixture();
    const first = await f.request('/api/search?q=marcos');
    const next = await f.request('/api/search?q=marcos');
    assert.equal(next.headers.get('x-result-cache'), 'HIT');
    assert.deepEqual(await first.json(), await next.json());
    assert.equal(f.state.queries.length, 2);
});

test('assembled bloc results retain member lists and skip all their queries on a hit', async () => {
    const f = await fixture();
    const first = await f.request('/api/v1/blocs?members=1&year=2025');
    const data = await first.json();
    assert.equal(data.data.blocs[0].members_list.length, 1);
    assert.equal(f.state.queries.length, 2);
    const next = await f.request('/api/v1/blocs?year=2025&members=1');
    assert.equal(next.headers.get('x-result-cache'), 'HIT');
    assert.deepEqual(await next.json(), data);
    assert.equal(f.state.queries.length, 2);
});

test('different data vintages do not reuse an existing cache entry', async () => {
    const first = await fixture();
    await first.request('/api/v1/stats');
    const next = await fixture();
    globalThis.caches.default = first.cache;
    next.state.built = '2026-11-03';
    assert.equal((await next.request('/api/v1/stats')).headers.get('x-result-cache'), 'MISS');
    assert.equal(next.state.queries.length, 1);
    assert.equal(first.cache.entries.size, 2);
});

test('result entries expire and are isolated by deployment and cache version', async () => {
    const f = await fixture();
    await f.request('/api/v1/stats');
    f.cache.now += 86401;
    assert.equal((await f.request('/api/v1/stats')).headers.get('x-result-cache'), 'MISS');
    f.env.CACHE_VERSION = '2';
    await f.request('/api/v1/stats');
    f.env.WORKER_VERSION.id = 'release-2';
    await f.request('/api/v1/stats');
    assert.equal(f.state.queries.length, 4);
});

test('D1 errors are not cached, including MCP tool errors', async () => {
    const f = await fixture();
    f.state.failDb = true;
    const rest = await f.request('/api/v1/coverage');
    assert.equal(rest.status, 500);
    assert.equal(rest.headers.get('cache-control'), 'no-store');
    assert.equal((await (await f.rpc(1, 'get_coverage')).json()).result.isError, true);
    assert.equal(f.cache.entries.size, 0);
    f.state.failDb = false;
    assert.equal((await f.request('/api/v1/coverage')).status, 200);
    assert.equal(f.state.queries.length, 3);
});

test('cache read/write failures still return successful database results', async () => {
    const f = await fixture();
    f.cache.failRead = f.cache.failWrite = true;
    for (let i = 0; i < 2; i++) {
        const response = await f.request('/api/v1/stats');
        assert.equal(response.status, 200);
        assert.ok((await response.json()).data);
    }
    assert.equal(f.state.queries.length, 2);
});

test('corrupt cached JSON is replaced by a fresh result', async () => {
    const f = await fixture();
    await f.request('/api/v1/stats');
    [...f.cache.entries.values()][0].response = new Response('invalid json');
    assert.equal((await f.request('/api/v1/stats')).status, 200);
    assert.equal(f.state.queries.length, 2);
    assert.equal((await f.request('/api/v1/stats')).headers.get('x-result-cache'), 'HIT');
});

test('rendered HTML and sitemaps skip D1 on a cache hit', async () => {
    const f = await fixture();
    for (const route of ['/regional', '/sitemap.xml', '/sitemap-pages.xml', '/sitemap-persons-1.xml']) {
        const first = await f.request(route);
        const reads = f.state.queries.length;
        assert.equal(first.headers.get('x-result-cache'), 'MISS');
        const next = await f.request(route);
        assert.equal(next.headers.get('x-result-cache'), 'HIT');
        assert.equal(await next.text(), await first.text());
        assert.equal(f.state.queries.length, reads);
    }
    f.cache.now += 3601;
    assert.equal((await f.request('/regional')).headers.get('x-result-cache'), 'MISS');
    assert.equal((await f.request('/sitemap.xml')).headers.get('x-result-cache'), 'HIT');
});

test('HTML errors, 404s and sitemap failures are not cached', async () => {
    const f = await fixture();
    f.state.failDb = true;
    assert.equal((await f.request('/regional')).headers.get('cache-control'), 'no-store');
    assert.equal((await f.request('/sitemap.xml')).status, 500);
    assert.equal((await f.request('/nonexistent')).status, 404);
    assert.equal(f.cache.entries.size, 0);
    f.state.failDb = false;
    assert.equal((await f.request('/regional')).headers.get('x-result-cache'), 'MISS');
    assert.equal((await f.request('/regional')).headers.get('x-result-cache'), 'HIT');
});

test('unknown data vintage or deployment disables caching; vintage failures can recover', async () => {
    const f = await fixture();
    f.state.failVintage = true;
    assert.equal((await f.request('/api/v1/stats')).headers.get('x-result-cache'), 'BYPASS');
    assert.equal(f.cache.entries.size, 0);
    f.state.failVintage = false;
    assert.equal((await f.request('/api/v1/stats')).headers.get('x-result-cache'), 'MISS');
    delete f.env.WORKER_VERSION;
    assert.equal((await f.request('/api/v1/stats')).headers.get('x-result-cache'), 'BYPASS');
    assert.equal(f.state.queries.length, 3);
});

test('MCP batches keep caller ids and successful results while rejecting unknown tools', async () => {
    const f = await fixture();
    await f.request('/api/v1/coverage');
    const response = await f.request('/mcp', { method: 'POST', body: JSON.stringify([
        { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_coverage' } },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_coverage' } },
        { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'unknown' } },
    ]) });
    const body = await response.json();
    assert.deepEqual(body.map(item => item.id), [1, 2, 3]);
    assert.equal(body[2].result.isError, true);
    assert.equal(f.state.queries.length, 1);
});

test('invalid requests, notifications and static assets do not fill the result cache', async () => {
    const f = await fixture();
    assert.equal((await f.request('/api/v1/stats', { method: 'POST' })).status, 405);
    assert.equal((await f.request('/api/v1/unknown')).status, 404);
    assert.equal((await f.request('/mcp', { method: 'POST', body: '{' })).status, 400);
    assert.equal((await f.request('/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) })).status, 202);
    await f.request('/assets/app.js');
    assert.equal(f.cache.entries.size, 0);
    assert.equal(f.state.queries.length, 0);
});
