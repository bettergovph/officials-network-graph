import { ApiError, clampInt, slugOf } from './params';
import type { Seo } from './seo';

export const SNAPSHOT_FORMAT = 1;
const ROOT = '/data/snapshots/';
export interface SnapshotManifest {
    format: number;
    built: string;
    api: string[];
    seoPages: Record<string, string>;
    personBuckets: string[];
    sitemaps: string[];
}

// Only successful manifests live in isolate memory. Individual shards remain in Assets,
// avoiding an unbounded in-memory cache when crawlers visit many different politicians.
const manifests = new WeakMap<Fetcher, Promise<SnapshotManifest>>();
async function readJson(assets: Fetcher, file: string): Promise<unknown> {
    const response = await assets.fetch(new Request(`https://assets.local${ROOT}${file}`));
    if (!response.ok || response.headers.get('content-type')?.includes('text/html') || !response.body) {
        throw new ApiError(503, 'Static dataset unavailable; please try again later');
    }
    try {
        const body = response.headers.get('content-encoding') === 'gzip' ? response.body : response.body.pipeThrough(new DecompressionStream('gzip'));
        return await new Response(body).json();
    } catch { throw new ApiError(503, 'Static dataset is invalid; please try again later'); }
}

async function manifest(assets: Fetcher): Promise<SnapshotManifest> {
    let pending = manifests.get(assets);
    if (!pending) {
        pending = readJson(assets, 'manifest.json.gz').then(value => {
            const m = value as SnapshotManifest;
            if (m?.format !== SNAPSHOT_FORMAT || typeof m.built !== 'string' || !Array.isArray(m.api) || !m.seoPages || !Array.isArray(m.personBuckets) || !Array.isArray(m.sitemaps)) {
                throw new ApiError(503, 'Static dataset needs to be rebuilt');
            }
            return m;
        });
        manifests.set(assets, pending);
        pending.catch(() => manifests.delete(assets));
    }
    return pending;
}

async function readData(assets: Fetcher, file: string, m: SnapshotManifest): Promise<unknown> {
    const value = await readJson(assets, file) as { format: number; built: string; data: unknown };
    if (value?.format !== SNAPSHOT_FORMAT || value.built !== m.built || !Object.hasOwn(value, 'data')) {
        throw new ApiError(503, 'Static dataset version mismatch');
    }
    return value.data;
}

export function apiSnapshotPath(operation: string, args: unknown[]): { file: string; limit?: number } | null {
    switch (operation) {
        case 'stats': case 'coverage': case 'places': return { file: `api/${operation}.json.gz` };
        case 'province': return { file: `api/places/${slugOf(String(args[0]))}.json.gz` };
        case 'town': return { file: `api/places/${slugOf(String(args[0]))}/${slugOf(String(args[1]))}.json.gz` };
        case 'national': return { file: `api/national/${args[0]}${args[1] ? '/' + slugOf(String(args[1])) : ''}.json.gz` };
        case 'persons': {
            const f = args[0] as { page?: number; min_runs?: string | number | null; sort?: string; province?: string; limit?: number };
            if (clampInt(f.page, 1, 1, 100000) !== 1 || clampInt(f.min_runs, 1, 1, 30) !== 1) return null;
            const sort = f.sort === 'runs' || f.sort === 'losses' ? f.sort : 'wins';
            return { file: `api/leaders/${sort}/${f.province ? slugOf(f.province) : '_all'}.json.gz`, limit: clampInt(f.limit, 50, 1, 200) };
        }
        default: return null;
    }
}

export async function apiSnapshot(assets: Fetcher, operation: string, args: unknown[]): Promise<{ data: unknown } | null> {
    const route = apiSnapshotPath(operation, args);
    if (!route) return null;
    const m = await manifest(assets);
    if (!m.api.includes(route.file)) throw new ApiError(404, 'No such place or election in the published dataset');
    const data = await readData(assets, route.file, m);
    if (route.limit !== undefined) {
        const rows = data as { persons: unknown[] };
        return { data: { page: 1, limit: route.limit, persons: rows.persons.slice(0, route.limit) } };
    }
    return { data };
}

export async function seoSnapshot(assets: Fetcher, url: URL): Promise<Seo> {
    const m = await manifest(assets);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    let file = m.seoPages[path];
    const person = path.match(/^\/person\/[^/]+\/([a-f0-9]{10})$/);
    if (person) {
        const bucket = person[1]!.slice(0, 3);
        if (m.personBuckets.includes(bucket)) file = `seo/persons/${bucket}.json.gz`;
    }
    if (!file) throw new ApiError(404, 'Page not found');
    const pages = await readData(assets, file, m) as Record<string, Seo>;
    if (!Object.hasOwn(pages, path)) throw new ApiError(404, 'Page not found');
    return pages[path]!;
}

export async function sitemapSnapshot(assets: Fetcher, url: URL): Promise<Response | null> {
    const m = await manifest(assets);
    // Match the legacy numeric page aliases, including leading zeros and page zero.
    const match = url.pathname.match(/^\/sitemap-persons-(\d+)\.xml$/);
    const path = match ? `/sitemap-persons-${Math.max(1, +match[1]!)}.xml` : url.pathname;
    if (!m.sitemaps.includes(path)) return null;
    const response = await assets.fetch(new Request(`https://assets.local${ROOT}sitemaps${path}`));
    if (!response.ok || !response.headers.get('content-type')?.includes('xml')) throw new ApiError(503, 'Static sitemap unavailable');
    return new Response(response.body, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=86400', 'x-data-source': 'static' } });
}
