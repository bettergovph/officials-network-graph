/**
 * Build boundary shards for the atlas map from faeldon/philippines-json-maps (PSGC 2023, low resolution).
 *
 *   node --experimental-strip-types scripts/build-geo.ts
 *
 * Reads public/data/index.json.gz (from build-data.ts) to attach our province and town slugs to each feature.
 * Outputs public/data/geo/regions.json.gz, provinces.json.gz and cities/<province-slug>.json.gz.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { key, slug } from './lib/names.ts';

const API = 'https://api.github.com/repos/faeldon/philippines-json-maps/contents/2023/geojson';
const RAW = 'https://raw.githubusercontent.com/faeldon/philippines-json-maps/master/2023/geojson';
const CACHE = 'data/raw/geo';
const RES = 'hires'; // keeps 10% of source vertices; lower tiers turn inland provinces into polygons
const PROV_TOL = 0.003, CITY_TOL = 0.0008, REGION_TOL = 0.008; // degrees, ~330 m and ~90 m Douglas-Peucker: sub-pixel at the zooms each layer is shown
const OUT = 'public/data/geo';

interface Feature { type: 'Feature'; properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } }
interface FC { type: 'FeatureCollection'; features: Feature[] }

const PROVINCE_ALIAS: Record<string, string> = {
    'NCR CITY OF MANILA FIRST DISTRICT NOT A PROVINCE': 'NCR FIRST DISTRICT', 'NCR SECOND DISTRICT NOT A PROVINCE': 'NCR SECOND DISTRICT',
    'NCR THIRD DISTRICT NOT A PROVINCE': 'NCR THIRD DISTRICT', 'NCR FOURTH DISTRICT NOT A PROVINCE': 'NCR FOURTH DISTRICT',
};
const SGA_PSGC = 1909900000; // BARMM Special Geographic Area: unnamed in the source

async function fetchJSON<T>(url: string, cacheName: string): Promise<T> {
    fs.mkdirSync(CACHE, { recursive: true });
    const file = path.join(CACHE, cacheName);
    if (!fs.existsSync(file)) {
        const res = await fetch(url, { headers: { 'user-agent': 'dynasty-build' } });
        if (!res.ok) throw new Error(`${res.status} ${url}`);
        fs.writeFileSync(file, await res.text());
    }
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}
async function listDir(dir: string): Promise<string[]> {
    const items = await fetchJSON<{ name: string }[]>(`${API}/${dir}`, `list-${dir.replace(/\//g, '_')}.json`);
    return items.map(i => i.name);
}
const cityClean = (n: string) => key(n).replace(/^CITY OF /, '').replace(/ CITY$/, '').replace(/\(.*?\)/g, '').replace(/\bSTO\b/g, 'SANTO').replace(/\bSTA\b/g, 'SANTA').replace(/\bOZAMIZ\b/, 'OZAMIS').trim();
const writeGz = (file: string, data: unknown) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(data), { level: 9 })); };
type Pt = [number, number];
function dp(points: Pt[], tol: number): Pt[] {
    if (points.length <= 4) return points;
    const sq = tol * tol;
    const keep = new Uint8Array(points.length); keep[0] = 1; keep[points.length - 1] = 1;
    const stack: [number, number][] = [[0, points.length - 1]];
    while (stack.length) {
        const [a, b] = stack.pop()!;
        const [ax, ay] = points[a]!, [bx, by] = points[b]!;
        const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
        let best = -1, bestD = sq;
        for (let i = a + 1; i < b; i++) {
            const [px, py] = points[i]!;
            let d: number;
            if (len2 === 0) d = (px - ax) ** 2 + (py - ay) ** 2;
            else { const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)); d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2; }
            if (d > bestD) { bestD = d; best = i; }
        }
        if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
    }
    const out = points.filter((_, i) => keep[i]);
    if (out.length >= 4) return out;
    // Tiny ring (a small island): keep a minimal closed triangle rather than every vertex.
    const n = points.length - 1;
    return [points[0]!, points[Math.floor(n / 3)]!, points[Math.floor(2 * n / 3)]!, points[0]!];
}
/** Simplify rings and round coordinates to 4 decimals (~11 m). */
const round = (g: Feature['geometry'], tol = 0) => {
    const ring = (r: Pt[]) => (tol ? dp(r, tol) : r).map(([x, y]) => [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4] as Pt);
    const poly = (p: Pt[][]) => p.map(ring).filter((r, i) => i === 0 || r.length >= 4);
    const coords = g.type === 'Polygon' ? poly(g.coordinates as Pt[][]) : g.type === 'MultiPolygon' ? (g.coordinates as Pt[][][]).map(poly) : g.coordinates;
    return { type: g.type, coordinates: coords };
};

async function main() {
    const index = JSON.parse(zlib.gunzipSync(fs.readFileSync('public/data/index.json.gz')).toString()) as { regions: { name: string; slug: string; provinces: { name: string; slug: string; cities: { name: string; slug: string }[] }[] }[] };
    const ours = index.regions.flatMap(r => r.provinces.map(p => ({ ...p, region: r.name })));

    // regions
    const country = await fetchJSON<FC>(`${RAW}/country/${RES}/country.0.1.json`, `country-${RES}.json`);
    const regionKey = (en: string) => { const k = key(en); if (k.includes('NATIONAL CAPITAL')) return 'NATIONAL CAPITAL REGION'; if (k.includes('CORDILLERA')) return 'CORDILLERA ADMINISTRATIVE REGION'; if (k.includes('BANGSAMORO')) return 'BARMM'; if (k.includes('MIMAROPA')) return 'REGION IV B'; const m = k.match(/^REGION ([IVX]+)( A| B)?/); return m ? `REGION ${m[1]}${m[2] ?? ''}` : k; };
    writeGz(`${OUT}/regions.json.gz`, { type: 'FeatureCollection', features: country.features.map(f => ({ type: 'Feature', properties: { name: regionKey(String(f.properties['adm1_en'])), slug: slug(regionKey(String(f.properties['adm1_en']))), psgc: f.properties['adm1_psgc'] }, geometry: round(f.geometry, REGION_TOL) })) });

    // provinces
    const provFeatures: Feature[] = [];
    for (const name of await listDir(`regions/${RES}`)) for (const f of (await fetchJSON<FC>(`${RAW}/regions/${RES}/${name}`, `prov-${RES}-${name}`)).features) provFeatures.push(f);
    const byPsgc = new Map<number, Feature>();
    const provOf = new Map<number, { name: string; slug: string }>();
    const out: Feature[] = [];
    for (const f of provFeatures) {
        const psgc = f.properties['adm2_psgc'] as number;
        byPsgc.set(psgc, f);
        const en = f.properties['adm2_en'] as string | null;
        let k = en ? (PROVINCE_ALIAS[key(en)] ?? key(en)) : psgc === SGA_PSGC ? 'SPECIAL GEOGRAPHIC AREA' : '';
        const isabelaCity = k.startsWith('CITY OF ISABELA'); // "City of Isabela (Not a Province)" sits inside BASILAN in election data
        if (isabelaCity) k = 'BASILAN';
        const ourProv = ours.find(p => key(p.name) === k);
        if (!ourProv) { console.log('  unmatched province feature:', en ?? psgc); continue; }
        provOf.set(psgc, ourProv);
        if (isabelaCity) continue; // drawn inside Basilan's town layer, not as a province
        out.push({ type: 'Feature', properties: { name: ourProv.name, slug: ourProv.slug, region: ourProv.region, psgc }, geometry: round(f.geometry, PROV_TOL) });
    }
    // Pre-2022 MAGUINDANAO = del Norte + del Sur
    const norte = provFeatures.find(f => key(String(f.properties['adm2_en'])) === 'MAGUINDANAO DEL NORTE'), sur = provFeatures.find(f => key(String(f.properties['adm2_en'])) === 'MAGUINDANAO DEL SUR');
    const mag = ours.find(p => p.name === 'MAGUINDANAO');
    if (norte && sur && mag) {
        const polys = (g: Feature['geometry']) => g.type === 'Polygon' ? [g.coordinates] : (g.coordinates as unknown[]);
        out.push({ type: 'Feature', properties: { name: mag.name, slug: mag.slug, region: mag.region, psgc: 0, composite: true }, geometry: round({ type: 'MultiPolygon', coordinates: [...polys(norte.geometry), ...polys(sur.geometry)] }, PROV_TOL) });
    }
    writeGz(`${OUT}/provinces.json.gz`, { type: 'FeatureCollection', features: out });
    console.log(`provinces: ${out.length} features`);

    // cities, one shard per province
    const cityFeatures = new Map<string, Feature[]>(); // our province slug -> features
    let matched = 0, unmatched = 0; const unmatchedNames: string[] = [];
    for (const name of await listDir(`provdists/${RES}`)) {
        const fc = await fetchJSON<FC | { type: string }>(`${RAW}/provdists/${RES}/${name}`, `city-${RES}-${name}`);
        if (!('features' in fc)) continue;
        for (const f of (fc as FC).features) {
            const ourProv = provOf.get(f.properties['adm2_psgc'] as number);
            if (!ourProv || !f.geometry) continue;
            const full = ours.find(p => p.slug === ourProv.slug)!;
            const en = String(f.properties['adm3_en']);
            const c = cityClean(en);
            let city = full.cities.find(x => cityClean(x.name) === c)
                ?? full.cities.find(x => cityClean(x.name).startsWith(c + ' ') || c.startsWith(cityClean(x.name) + ' '))
                ?? full.cities.find(x => cityClean(x.name).replace(/ /g, '') === c.replace(/ /g, ''));
            if (!city) { unmatched++; unmatchedNames.push(`${ourProv.name}: ${en}`); }
            else matched++;
            (cityFeatures.get(ourProv.slug) ?? cityFeatures.set(ourProv.slug, []).get(ourProv.slug)!).push({ type: 'Feature', properties: { name: city?.name ?? en, slug: city?.slug ?? null, label: en, psgc: f.properties['adm3_psgc'] }, geometry: round(f.geometry, CITY_TOL) });
        }
    }
    // Maguindanao (pre-split) towns = both halves
    if (mag) cityFeatures.set(mag.slug, [...(cityFeatures.get(slug('MAGUINDANAO DEL NORTE')) ?? []), ...(cityFeatures.get(slug('MAGUINDANAO DEL SUR')) ?? [])].map(f => { const city = mag.cities.find(x => cityClean(x.name) === cityClean(String(f.properties['label']))) ?? mag.cities.find(x => cityClean(x.name).startsWith(cityClean(String(f.properties['label'])) + ' ')); return { ...f, properties: { ...f.properties, name: city?.name ?? f.properties['label'], slug: city?.slug ?? null } }; }));
    fs.rmSync(`${OUT}/cities`, { recursive: true, force: true });
    for (const [s, feats] of cityFeatures) writeGz(`${OUT}/cities/${s}.json.gz`, { type: 'FeatureCollection', features: feats });
    console.log(`cities: ${matched} matched, ${unmatched} unmatched`);
    if (unmatched) console.log('  ' + unmatchedNames.slice(0, 40).join('\n  '));
}
main().catch(e => { console.error(e); process.exit(1); });
