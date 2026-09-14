// Loaders for the generated shards under /data (see scripts/build-data.ts).

export interface PlaceCity { name: string; slug: string }
export interface PlaceProvince { name: string; slug: string; poverty: number | null; cities: PlaceCity[]; seats: number; candidacies: number; persons: number; years: Record<string, { seats: number; candidacies: number }> }
export interface PlaceRegion { name: string; slug: string; provinces: PlaceProvince[] }
export type TopRow = [id: string, last: string, first: string, middle: string, suffix: string, prov: string, runs: number, wins: number, firstYear: number, lastYear: number, top: string];
export interface IndexData {
    years: number[]; built: string;
    totals: { persons: number; candidacies: number; contests: number; provinces: number; cities: number; repeat: number };
    top: { wins: TopRow[]; runs: TopRow[]; losses: TopRow[] };
    regions: PlaceRegion[];
}
export type CandRow = [pid: string, party: string, votes: number | null, won: 0 | 1, rank: number | null, conf: string, link: string];
export interface Contest { id: string; year: number; city: string; district: string; position: string; seats: number; total: number | null; margin: number | null; uncontested: boolean; complete: boolean; c: CandRow[] }
export type PersonRow = [last: string, first: string, middle: string, suffix: string, sex: string, runs: number, wins: number, home: string];
export type NatRow = [name: string, party: string, votes: number, won: 0 | 1];
export interface ProvShard { name: string; slug: string; region: string; poverty: number | null; contests: Contest[]; persons: Record<string, PersonRow>; national: Record<string, Record<string, NatRow[]>> }
export type PeopleRow = [id: string, last: string, first: string, middle: string, suffix: string, prov: string, runs: number, wins: number, lastYear: number, top: string];
export interface NationalData { year: number; races: Record<string, [name: string, party: string, votes: number, rank: number, won: 0 | 1][]> }

export async function fetchText(url: string): Promise<string> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} loading ${url}`);
    if (url.endsWith('.gz') && res.headers.get('content-encoding') !== 'gzip') {
        // Raw gzip bytes: the server did not flag the encoding, so decompress here.
        if (!res.body) throw new Error(`No body for ${url}`);
        return new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).text();
    }
    return res.text();
}

const cache = new Map<string, Promise<unknown>>();
function cached<T>(url: string): Promise<T> {
    let p = cache.get(url) as Promise<T> | undefined;
    if (!p) { p = fetchText(url).then(t => JSON.parse(t) as T); p.catch(() => cache.delete(url)); cache.set(url, p); }
    return p;
}

export const loadIndex = () => cached<IndexData>('/data/index.json.gz');
export const loadProvince = (slug: string) => cached<ProvShard>(`/data/prov/${slug}.json.gz`);
export const loadPeople = (letter: string) => cached<PeopleRow[]>(`/data/people/${letter}.json.gz`);
export const loadNational = (year: number | string) => cached<NationalData>(`/data/national/${year}.json.gz`);

export function findProvince(index: IndexData, slug: string): { region: PlaceRegion; province: PlaceProvince } | null {
    for (const region of index.regions) for (const province of region.provinces) if (province.slug === slug) return { region, province };
    return null;
}

/** Candidacies of one person inside a province shard, oldest first. */
export function personCandidacies(shard: ProvShard, pid: string): { contest: Contest; cand: CandRow }[] {
    const out: { contest: Contest; cand: CandRow }[] = [];
    for (const contest of shard.contests) for (const cand of contest.c) if (cand[0] === pid) out.push({ contest, cand });
    return out.sort((a, b) => a.contest.year - b.contest.year);
}

/** Try the D1-backed API; returns null when it is unavailable (e.g. plain Vite dev server). */
export async function api<T>(path: string): Promise<T | null> {
    try {
        const res = await fetch(path, { headers: { accept: 'application/json' } });
        if (!res.ok || !(res.headers.get('content-type') ?? '').includes('application/json')) return null;
        return await res.json() as T;
    } catch { return null; }
}
