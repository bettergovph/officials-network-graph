/**
 * Build the Dynasty dataset from the OpenHalalan releases.
 *
 *   node --experimental-strip-types scripts/build-data.ts
 *
 * Inputs  (downloaded into data/raw/ when missing):
 *   NLE_Winners_2004-2025.csv         every local winner, 2001-2025
 *   NLE_Vote_Counts_2007-2025.csv.gz  every candidate with votes, 2010-2025
 * Outputs:
 *   data/dynasty.sqlite               full relational database (db/schema.sql)
 *   data/d1/*.sql                     same data as chunked INSERTs for Cloudflare D1
 *   public/data/**                    gzipped shards the web app loads on demand
 *   docs/coverage.md                  what the sources cover and how well they join
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DatabaseSync } from 'node:sqlite';
import { readCSV, csvEscape } from './lib/csv.ts';
import { clean, key, splitFirst, slug, isSuffix, POSCODE, PROVINCE_LEVEL, NATIONAL, posRank, PROVINCE_ALIAS } from './lib/names.ts';

const RAW = 'data/raw';
const SOURCES = [
    { file: 'NLE_Winners_2004-2025.csv', url: 'https://github.com/RobertRLeung/OpenHalalan/releases/download/data-latest/NLE_Winners_2004-2025.csv' },
    { file: 'NLE_Vote_Counts_2007-2025.csv.gz', url: 'https://github.com/RobertRLeung/OpenHalalan/releases/download/data-latest/NLE_Vote_Counts_2007-2025.csv.gz' },
];
const WINNERS = path.join(RAW, SOURCES[0]!.file);
const VOTES = path.join(RAW, SOURCES[1]!.file);
const PUB = 'public/data';
const SQLITE = 'data/dynasty.sqlite';
const D1DIR = 'data/d1';
const FIRST_VOTE_YEAR = 2010;
const SENATE_SEATS = 12;

type Conf = 'exact' | 'strong' | 'weak' | 'new';
type Link = 'exact' | 'surname' | 'prefix' | 'winner-only' | 'votes-only' | 'inferred';

interface Cand {
    year: number; prov: string; city: string; district: string; position: string; unitKey: string;
    last: string; first: string; middle: string; suffix: string; title: string; party: string; sex: string;
    lastKey: string; firstKey: string; midKey: string;
    votes: number | null; won: boolean; ballot: string; link: Link;
    contest?: Contest; pid?: string; rank?: number | null; conf?: Conf;
}
interface Contest {
    id: string; year: number; prov: string; city: string; district: string; position: string;
    cands: Cand[]; seats: number; total: number | null; lastWinner: number | null; runnerUp: number | null;
    margin: number | null; uncontested: boolean; complete: boolean;
    unitKey: string; towns: string[]; townsYear: number | null; // district membership (towns that vote in it)
}
interface Person {
    id: string; last: string; first: string; middle: string; suffix: string; sex: string;
    lastKey: string; firstKey: string; midKey: string; prov: string; cities: Set<string>; cands: Cand[];
}
interface VoteCand { // aggregated vote row, pre-link
    year: number; prov: string; city: string; district: string; position: string; unitKey: string;
    last: string; first: string; suffix: string; middle: string; party: string; title: string; ballot: string; votes: number;
    lastKey: string; firstKey: string; midKey: string; linked: boolean;
}

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
const provName = (p: string) => PROVINCE_ALIAS[clean(p)] ?? clean(p);

// ---------- 0. sources ----------
async function ensureRaw() {
    fs.mkdirSync(RAW, { recursive: true });
    for (const s of SOURCES) {
        const dest = path.join(RAW, s.file);
        if (fs.existsSync(dest) && fs.statSync(dest).size > 0) continue;
        log('downloading', s.url);
        const res = await fetch(s.url);
        if (!res.ok || !res.body) throw new Error(`download failed ${res.status} ${s.url}`);
        await pipeline(Readable.fromWeb(res.body as never), fs.createWriteStream(dest));
    }
}

// ---------- 1. winners ----------
interface WinnerRow { year: number; region: string; prov: string; city: string; position: string; unitKey: string; last: string; first: string; middle: string; suffix: string; title: string; party: string; sex: string; lastKey: string; firstKey: string; midKey: string }
async function loadWinners(): Promise<{ rows: WinnerRow[]; regionOf: Map<string, string> }> {
    const rows: WinnerRow[] = [];
    const regionByYear = new Map<string, [number, string]>();
    for await (const r of readCSV(WINNERS)) {
        const position = clean(r['Position']!);
        if (NATIONAL.has(position) || !r['Province']) continue;
        const year = +r['Year']!;
        const prov = provName(r['Province']!);
        const region = clean(r['Region']!);
        let { first, suffix } = splitFirst(r['First Name']!);
        const last = clean(r['Last Name']!);
        let middle = clean(r['Middle Name']!);
        if (isSuffix(middle)) { suffix = suffix || key(middle); middle = ''; }
        rows.push({
            year, region, prov, city: PROVINCE_LEVEL.has(position) ? '' : clean(r['City']!), position, unitKey: '',
            last, first, middle, suffix, title: clean(r['Title']!), party: clean(r['Party']!), sex: clean(r['Sex']!),
            lastKey: key(last), firstKey: key(first), midKey: key(middle),
        });
        if (region) { const cur = regionByYear.get(prov); if (!cur || cur[0] < year) regionByYear.set(prov, [year, region]); }
    }
    const regionOf = new Map([...regionByYear].map(([p, [, r]]) => [p, r]));
    return { rows, regionOf };
}

// ---------- 2. vote counts ----------
/**
 * District races name their unit in raw_position: "CEBU - FIRST LEGDIST" (province district) or
 * "CEBU - CITY OF CEBU - FIRST LEGDIST" (a city's own district). Returns the city part, normalised, or ''.
 */
function parseUnit(rawPosition: string): string {
    const m = clean(rawPosition).match(/^(.*)\s-\s([A-ZÑ]+)\s(LEGDIST|PROVDIST)$/);
    if (!m) return '';
    const parts = m[1]!.split(' - ');
    if (parts.length < 2) return '';
    return key(parts.slice(1).join(' - ')).replace(/^CITY OF /, '').replace(/ CITY$/, '').trim();
}
export type Membership = Map<string, Set<string>>; // year|prov|position|unitKey|district -> towns
interface NatCand { year: number; position: string; name: string; party: string; votes: number; byProv: Map<string, number> }
async function loadVotes(regionOf: Map<string, string>) {
    const local = new Map<string, VoteCand>();
    const national = new Map<string, NatCand>();
    const perCityRaces = new Set<string>(), totalRaces = new Set<string>();
    const membership: Membership = new Map();
    let n = 0;
    for await (const r of readCSV(VOTES)) {
        n++;
        if (n % 500000 === 0) log(`  ${n} vote rows`);
        const year = +r['year']!;
        if (year < FIRST_VOTE_YEAR || !/^\d+$/.test(r['votes']!)) continue;
        const votes = +r['votes']!;
        const position = clean(r['position']!);
        const prov = provName(r['province']!);
        if (r['is_national_race'] === 'True') {
            const name = clean(r['candidate_name']!), party = clean(r['party']!);
            const k = `${year}|${position}|${name}`;
            let c = national.get(k);
            if (!c) { c = { year, position, name, party, votes: 0, byProv: new Map() }; national.set(k, c); }
            c.votes += votes;
            if (prov && regionOf.has(prov)) c.byProv.set(prov, (c.byProv.get(prov) ?? 0) + votes);
            continue;
        }
        if (!prov) continue;
        const provLevel = PROVINCE_LEVEL.has(position);
        const rawCity = clean(r['city']!);
        const unitKey = provLevel ? parseUnit(r['raw_position']!) : '';
        const district = clean(r['district']!);
        if (provLevel && rawCity && district) (membership.get(`${year}|${prov}|${position}|${unitKey}|${district}`) ?? membership.set(`${year}|${prov}|${position}|${unitKey}|${district}`, new Set()).get(`${year}|${prov}|${position}|${unitKey}|${district}`)!).add(rawCity);
        // 2010 reports province races both as a province total (blank city) and per town; keep the two apart so the totals can win below.
        if (provLevel && rawCity) perCityRaces.add(`${year}|${prov}|${position}`); else if (provLevel) totalRaces.add(`${year}|${prov}|${position}`);
        const city = provLevel ? '' : rawCity;
        let { first, suffix } = splitFirst(r['first_name']!);
        const last = clean(r['last_name']!);
        let middle = clean(r['middle_name']!);
        if (isSuffix(middle)) { suffix = suffix || key(middle); middle = ''; }
        const lastKey = key(last), firstKey = key(first), midKey = key(middle);
        const k = `${year}|${prov}|${city}|${district}|${position}|${unitKey}|${lastKey}|${firstKey}|${midKey}|${suffix}` + (provLevel ? `|${rawCity ? 'c' : 't'}` : '');
        let c = local.get(k);
        if (!c) {
            c = { year, prov, city, district, position, unitKey, last, first, suffix, middle, party: clean(r['party']!), title: clean(r['title']!), ballot: clean(r['candidate_name']!), votes: 0, lastKey, firstKey, midKey, linked: false };
            local.set(k, c);
        }
        c.votes += votes;
    }
    // Where a province race has official totals, drop the per-town breakdown of the same race.
    let dropped = 0;
    for (const [k, c] of local) {
        if (k.endsWith('|c') && totalRaces.has(`${c.year}|${c.prov}|${c.position}`)) { local.delete(k); dropped++; }
    }
    log(`  ${n} vote rows read: ${local.size} local candidacies (${dropped} per-town duplicates of province totals dropped), ${national.size} national candidacies, ${membership.size} district memberships`);
    return { local: [...local.values()], national: [...national.values()], membership };
}

// ---------- 2b. town-name variants ----------
/** Explicit canonical spellings where the automatic rule would pick the wrong one. */
const CITY_CANON: Record<string, string> = { 'STO TOMAS': 'SANTO TOMAS', 'STO NINO': 'SANTO NIÑO', 'STA CRUZ': 'SANTA CRUZ', 'STA MARIA': 'SANTA MARIA' };
const cityNorm = (s: string) => key(s).replace(/\b(CITY OF|CITY|MUNICIPALITY OF|CAPITAL)\b/g, '').replace(/[^A-Z]/g, '');
function lev(a: string, b: string): number {
    const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0]![j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length]![b.length]!;
}
/**
 * The sources spell some towns differently in different years ("KABUGAO CAPITAL" / "KABUGAO", "KALOOKAN" / "CALOOCAN").
 * Two names in one province that never appear in the same election and look alike are the same town:
 * a name that extends another collapses to the shorter one; spelling variants take the latest election's form.
 */
function cityAliases(rows: { prov: string; city: string; year: number }[]): Map<string, string> {
    const years = new Map<string, Set<number>>();
    for (const r of rows) if (r.city) (years.get(`${r.prov}|${r.city}`) ?? years.set(`${r.prov}|${r.city}`, new Set()).get(`${r.prov}|${r.city}`)!).add(r.year);
    const byProv = new Map<string, { city: string; years: Set<number>; norm: string }[]>();
    for (const [k, ys] of years) { const [prov, city] = k.split('|') as [string, string]; (byProv.get(prov) ?? byProv.set(prov, []).get(prov)!).push({ city, years: ys, norm: cityNorm(city) }); }
    const alias = new Map<string, string>();
    for (const [prov, list] of byProv) {
        for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
            const a = list[i]!, b = list[j]!;
            if ([...a.years].some(y => b.years.has(y))) continue;
            const prefix = a.norm.length > 4 && b.norm.length > 4 && (a.norm.startsWith(b.norm) || b.norm.startsWith(a.norm));
            const similar = a.norm === b.norm || prefix || (a.norm.length > 4 && b.norm.length > 4 && lev(a.norm, b.norm) <= 2);
            if (!similar) continue;
            let keep: typeof a, drop: typeof a;
            if (prefix && a.norm !== b.norm) [keep, drop] = a.norm.length < b.norm.length ? [a, b] : [b, a];
            else [keep, drop] = Math.max(...a.years) > Math.max(...b.years) ? [a, b] : [b, a];
            const target = CITY_CANON[keep.city] && [a, b].some(x => x.city === CITY_CANON[keep.city]) ? CITY_CANON[keep.city]! : keep.city;
            for (const x of [a, b]) if (x.city !== target) alias.set(`${prov}|${x.city}`, target);
        }
    }
    // resolve chains (KALOOCAN -> KALOOKAN -> CALOOCAN)
    for (const [k, v] of alias) { let t = v, guard = 0; while (alias.has(`${k.split('|')[0]}|${t}`) && guard++ < 5) t = alias.get(`${k.split('|')[0]}|${t}`)!; alias.set(k, t); }
    return alias;
}

// ---------- 3. link winners to vote candidates, build contests ----------
const lastMatches = (a: string, b: string) => a === b || a.split(' ').includes(b) || b.split(' ').includes(a);
const firstCompatible = (a: string, b: string) => {
    if (!a || !b) return false;
    if (a === b) return true;
    const ta = a.split(' ')[0]!, tb = b.split(' ')[0]!;
    if (ta === tb) return true;
    return Math.min(ta.length, tb.length) >= 3 && (ta.startsWith(tb) || tb.startsWith(ta));
};

function buildContests(winners: WinnerRow[], votes: VoteCand[], membership: Membership) {
    const contests = new Map<string, Contest>();
    // A city that owns its own district ("CITY OF CEBU - FIRST LEGDIST") becomes that contest's city.
    const cityNames = new Map<string, string[]>();
    for (const r of [...winners, ...votes]) if (r.city) { const l = cityNames.get(r.prov) ?? cityNames.set(r.prov, []).get(r.prov)!; if (!l.includes(r.city)) l.push(r.city); }
    const cityKeyOf = (n: string) => key(n).replace(/^CITY OF /, '').replace(/ CITY$/, '').trim();
    const unitCity = (prov: string, unitKey: string) => {
        if (!unitKey) return '';
        const names = cityNames.get(prov) ?? [];
        return names.find(n => cityKeyOf(n) === unitKey) ?? names.find(n => cityKeyOf(n).startsWith(unitKey + ' ') || unitKey.startsWith(cityKeyOf(n) + ' ')) ?? names.find(n => cityKeyOf(n).replace(/ /g, '') === unitKey.replace(/ /g, '')) ?? '';
    };
    for (const v of votes) if (v.unitKey) { const c = unitCity(v.prov, v.unitKey); if (c) v.city = c; }
    const contestId = (c: { year: number; prov: string; city: string; district: string; position: string }) =>
        `${c.year}-${slug(c.prov)}-${c.city ? slug(c.city) : '_'}-${c.district ? slug(c.district) : '_'}-${POSCODE[c.position] ?? slug(c.position)}`;
    const getContest = (c: { year: number; prov: string; city: string; district: string; position: string; unitKey: string }) => {
        const id = contestId(c);
        let k = contests.get(id);
        if (!k) { k = { id, year: c.year, prov: c.prov, city: c.city, district: c.district, position: c.position, unitKey: c.unitKey, cands: [], seats: 0, total: null, lastWinner: null, runnerUp: null, margin: null, uncontested: false, complete: false, towns: [], townsYear: null }; contests.set(id, k); }
        return k;
    };
    // vote candidates grouped by race (ignoring district and unit, which the winners file lacks)
    const raceOf = (r: { year: number; prov: string; city: string; position: string }) => `${r.year}|${r.prov}|${PROVINCE_LEVEL.has(r.position) ? '' : r.city}|${r.position}`;
    const byRace = new Map<string, VoteCand[]>();
    for (const v of votes) { const k = raceOf(v); (byRace.get(k) ?? byRace.set(k, []).get(k)!).push(v); }

    const cands: Cand[] = [];
    const linkStats = new Map<number, Record<Link, number>>();
    const bump = (y: number, l: Link) => { const s = linkStats.get(y) ?? linkStats.set(y, { exact: 0, surname: 0, prefix: 0, 'winner-only': 0, 'votes-only': 0, inferred: 0 }).get(y)!; s[l]++; };

    for (const w of winners) {
        const race = w.year >= FIRST_VOTE_YEAR ? byRace.get(raceOf(w)) : undefined;
        let hit: VoteCand | undefined, link: Link = 'winner-only';
        if (race) {
            const open = race.filter(v => !v.linked);
            const exact = open.filter(v => lastMatches(v.lastKey, w.lastKey) && v.firstKey === w.firstKey);
            if (exact.length >= 1) { hit = exact.find(v => v.midKey && w.midKey && (v.midKey === w.midKey || w.midKey.startsWith(v.midKey))) ?? exact[0]; link = 'exact'; }
            else {
                const sameLast = open.filter(v => lastMatches(v.lastKey, w.lastKey));
                if (sameLast.length === 1) { hit = sameLast[0]; link = 'surname'; }
                else if (sameLast.length > 1) { const pref = sameLast.filter(v => firstCompatible(v.firstKey, w.firstKey)); if (pref.length === 1) { hit = pref[0]; link = 'prefix'; } }
            }
        }
        const base = { year: w.year, prov: w.prov, position: w.position, last: w.last, first: w.first, middle: w.middle, suffix: w.suffix, title: w.title, sex: w.sex, lastKey: w.lastKey, firstKey: w.firstKey, midKey: w.midKey, won: true };
        let c: Cand;
        if (hit) {
            hit.linked = true;
            c = { ...base, city: hit.city, district: hit.district, unitKey: hit.unitKey, party: w.party || hit.party, votes: hit.votes, ballot: hit.ballot, link };
            if (!c.middle && hit.middle.length > 2) c.middle = hit.middle, c.midKey = hit.midKey;
        } else {
            // Attach to the race's only contest when there is exactly one; otherwise a district-less contest.
            const districts = race ? [...new Set(race.map(v => `${v.unitKey}|${v.district}|${v.city}`))] : [];
            const only = districts.length === 1 ? districts[0]!.split('|') as [string, string, string] : null;
            c = { ...base, city: only ? only[2] : w.city, district: only ? only[1] : '', unitKey: only ? only[0] : '', party: w.party, votes: null, ballot: '', link };
        }
        bump(w.year, link);
        c.contest = getContest(c); c.contest.cands.push(c); cands.push(c);
    }
    for (const v of votes) {
        if (v.linked) continue;
        const c: Cand = { year: v.year, prov: v.prov, city: v.city, district: v.district, position: v.position, unitKey: v.unitKey, last: v.last, first: v.first, middle: v.middle.length > 2 ? v.middle : '', suffix: v.suffix, title: v.title, party: v.party, sex: '', lastKey: v.lastKey, firstKey: v.firstKey, midKey: v.middle.length > 2 ? v.midKey : '', votes: v.votes, won: false, ballot: v.ballot, link: 'votes-only' };
        bump(v.year, 'votes-only');
        c.contest = getContest(c); c.contest.cands.push(c); cands.push(c);
    }
    // Winners missing from the winners file (about 150 towns in 2013): take the top candidates by votes,
    // using the seat count the same contest has in other elections.
    const seatsSeen = new Map<string, number[]>();
    const raceKey = (k: Contest) => `${k.prov}|${k.city}|${k.district}|${k.position}`;
    for (const k of contests.values()) { const n = k.cands.filter(c => c.won).length; if (n) (seatsSeen.get(raceKey(k)) ?? seatsSeen.set(raceKey(k), []).get(raceKey(k))!).push(n); }
    const SINGLE = new Set(['GOVERNOR', 'VICE GOVERNOR', 'MAYOR', 'VICE MAYOR']);
    const mode = (a: number[]) => [...a.reduce((m, v) => m.set(v, (m.get(v) ?? 0) + 1), new Map<number, number>())].sort((x, y) => y[1] - x[1])[0]![0];
    for (const k of contests.values()) {
        if (k.cands.some(c => c.won)) continue;
        const seen = seatsSeen.get(raceKey(k));
        const n = seen ? mode(seen) : SINGLE.has(k.position) ? 1 : 0;
        if (!n) continue;
        const ranked = k.cands.filter(c => c.votes != null).sort((a, b) => b.votes! - a.votes!);
        if (ranked.length < n) continue;
        for (const c of ranked.slice(0, n)) { c.won = true; c.link = 'inferred'; bump(k.year, 'inferred'); }
    }
    // District membership: the towns whose voters elect this seat. Years without per-town rows borrow the nearest year's.
    const byDistrict = new Map<string, Map<number, string[]>>();
    for (const [mk, towns] of membership) { const [y, prov, position, unitKey, district] = mk.split('|') as [string, string, string, string, string]; const dk = `${prov}|${position}|${unitKey}|${district}`; (byDistrict.get(dk) ?? byDistrict.set(dk, new Map()).get(dk)!).set(+y, [...towns].sort()); }
    for (const k of contests.values()) {
        if (!k.district || !PROVINCE_LEVEL.has(k.position)) continue;
        const years = byDistrict.get(`${k.prov}|${k.position}|${k.unitKey}|${k.district}`);
        if (!years) continue;
        const own = years.get(k.year);
        if (own) { k.towns = own; continue; }
        const nearest = [...years.keys()].sort((a, b) => Math.abs(a - k.year) - Math.abs(b - k.year) || b - a)[0]!;
        k.towns = years.get(nearest)!; k.townsYear = nearest;
    }
    // per-contest facts
    for (const k of contests.values()) {
        k.cands.sort((a, b) => (b.votes ?? -1) - (a.votes ?? -1) || Number(b.won) - Number(a.won) || a.lastKey.localeCompare(b.lastKey));
        k.cands.forEach((c, i) => { c.rank = c.votes == null ? null : i + 1; });
        k.seats = k.cands.filter(c => c.won).length;
        const withVotes = k.cands.filter(c => c.votes != null);
        k.total = withVotes.length ? withVotes.reduce((s, c) => s + c.votes!, 0) : null;
        const winners = withVotes.filter(c => c.won), losers = withVotes.filter(c => !c.won);
        k.lastWinner = winners.length ? Math.min(...winners.map(c => c.votes!)) : null;
        k.runnerUp = losers.length ? Math.max(...losers.map(c => c.votes!)) : null;
        k.margin = k.lastWinner != null && k.runnerUp != null ? k.lastWinner - k.runnerUp : null;
        k.uncontested = withVotes.length > 0 && losers.length === 0;
        k.complete = withVotes.length === k.cands.length && k.seats > 0;
    }
    return { contests: [...contests.values()], cands, linkStats };
}

// ---------- 4. person resolution ----------
function resolvePersons(cands: Cand[]) {
    const index = new Map<string, Person[]>();
    const persons: Person[] = [];
    const ids = new Set<string>();
    const confStats: Record<Conf, number> = { exact: 0, strong: 0, weak: 0, new: 0 };
    const sorted = [...cands].sort((a, b) => a.year - b.year || Number(b.won) - Number(a.won) || a.lastKey.localeCompare(b.lastKey) || a.firstKey.localeCompare(b.firstKey));
    const midCompatible = (a: string, b: string) => !a || !b || a === b || (a.length === 1 && b.startsWith(a)) || (b.length === 1 && a.startsWith(b));
    const suffixCompatible = (a: string, b: string) => !a || !b || a === b;

    for (const c of sorted) {
        const bucket = index.get(`${c.lastKey}|${c.prov}`) ?? [];
        let best: Person | undefined, bestConf: Conf = 'new';
        const rankOf: Record<Conf, number> = { exact: 3, strong: 2, weak: 1, new: 0 };
        for (const p of bucket) {
            if (!suffixCompatible(p.suffix, c.suffix) || !midCompatible(p.midKey, c.midKey)) continue;
            if (p.cands.some(x => x.year === c.year && x.contest === c.contest)) continue; // two candidacies in one contest are two people
            const bothMid = !!(p.midKey && c.midKey && p.midKey.length > 1 && c.midKey.length > 1);
            const firstExact = p.firstKey === c.firstKey;
            const firstSoft = !firstExact && firstCompatible(p.firstKey, c.firstKey);
            const sameCity = c.city === '' || p.cities.has(c.city) || p.cities.has('');
            let conf: Conf | null = null;
            if (firstExact && bothMid) conf = 'exact';
            else if (firstExact && sameCity) conf = 'strong';
            else if (firstSoft && bothMid) conf = 'strong';
            else if (firstSoft && sameCity && (!p.suffix === !c.suffix)) conf = 'weak';
            if (conf && rankOf[conf] > rankOf[bestConf]) { best = p; bestConf = conf; }
        }
        if (best) {
            best.cands.push(c); best.cities.add(c.city);
            if (!best.middle && c.middle) { best.middle = c.middle; best.midKey = c.midKey; }
            if (!best.sex && c.sex) best.sex = c.sex;
            if (!best.suffix && c.suffix) best.suffix = c.suffix;
            if (c.link !== 'votes-only' && c.first.length > best.first.length && firstCompatible(c.firstKey, best.firstKey)) { best.first = c.first; best.firstKey = c.firstKey; }
            c.pid = best.id; c.conf = bestConf; confStats[bestConf]++;
        } else {
            let id = crypto.createHash('sha1').update(`${c.lastKey}|${c.firstKey}|${slug(c.prov)}|${c.year}|${slug(c.city)}|${POSCODE[c.position] ?? c.position}`).digest('hex').slice(0, 10);
            while (ids.has(id)) id = crypto.createHash('sha1').update(id).digest('hex').slice(0, 10);
            ids.add(id);
            const p: Person = { id, last: c.last, first: c.first, middle: c.middle, suffix: c.suffix, sex: c.sex, lastKey: c.lastKey, firstKey: c.firstKey, midKey: c.midKey, prov: c.prov, cities: new Set([c.city]), cands: [c] };
            persons.push(p); (index.get(`${c.lastKey}|${c.prov}`) ?? index.set(`${c.lastKey}|${c.prov}`, []).get(`${c.lastKey}|${c.prov}`)!).push(p);
            c.pid = id; c.conf = 'new'; confStats.new++;
        }
    }
    return { persons, confStats };
}

const displayName = (p: { first: string; middle: string; last: string; suffix: string }) =>
    [p.first, p.middle, p.last, p.suffix].filter(Boolean).join(' ');
const personStats = (p: Person) => {
    const wins = p.cands.filter(c => c.won);
    const years = p.cands.map(c => c.year);
    const top = wins.map(c => c.position).sort((a, b) => posRank(a) - posRank(b))[0] ?? '';
    return { runs: p.cands.length, wins: wins.length, firstYear: Math.min(...years), lastYear: Math.max(...years), top };
};

// ---------- 4b. surname blocs (same rule as the web view, precomputed for the API) ----------
interface BlocRow { scopeYear: number; prov: string; surname: string; n: number; nmid: number; terms: number; share: number; votes: number; top: string; parties: string; years: string; members: { pid: string; via: 'surname' | 'middle'; top: string; city: string; votes: number | null }[] }
function computeBlocs(cands: Cand[], persons: Person[], years: number[]): BlocRow[] {
    const personById = new Map(persons.map(p => [p.id, p]));
    const out: BlocRow[] = [];
    for (const scope of [...years, 0]) {
        const won = cands.filter(c => c.won && (scope === 0 || c.year === scope));
        const byProv = new Map<string, Cand[]>();
        for (const c of won) (byProv.get(c.prov) ?? byProv.set(c.prov, []).get(c.prov)!).push(c);
        for (const [prov, list] of byProv) {
            const people = new Map<string, { pid: string; last: string; middle: string; terms: Cand[] }>();
            for (const c of list) { const p = personById.get(c.pid!)!; const e = people.get(c.pid!) ?? people.set(c.pid!, { pid: c.pid!, last: p.lastKey, middle: p.midKey.length > 1 ? p.midKey : '', terms: [] }).get(c.pid!)!; e.terms.push(c); }
            for (const e of people.values()) e.terms.sort((a, b) => b.year - a.year || posRank(a.position) - posRank(b.position));
            const total = people.size;
            const sur = new Map<string, Set<string>>(), mid = new Map<string, Set<string>>();
            for (const e of people.values()) { (sur.get(e.last) ?? sur.set(e.last, new Set()).get(e.last)!).add(e.pid); if (e.middle && e.middle !== e.last) (mid.get(e.middle) ?? mid.set(e.middle, new Set()).get(e.middle)!).add(e.pid); }
            for (const [surname, direct] of sur) {
                const keys = new Set(direct); let nmid = 0;
                for (const k of mid.get(surname) ?? []) if (!keys.has(k)) { keys.add(k); nmid++; }
                if (keys.size < 2) continue;
                const members = [...keys].map(k => { const e = people.get(k)!; const latest = e.terms[0]!; const top = [...e.terms].sort((a, b) => posRank(a.position) - posRank(b.position))[0]!.position; return { pid: k, via: (direct.has(k) ? 'surname' : 'middle') as 'surname' | 'middle', top, city: latest.city, votes: latest.votes, rank: posRank(top), latestVotes: latest.votes ?? 0, terms: e.terms }; })
                    .sort((a, b) => a.rank - b.rank || (a.via === b.via ? 0 : a.via === 'surname' ? -1 : 1) || b.latestVotes - a.latestVotes);
                const terms = members.flatMap(m => m.terms);
                out.push({ scopeYear: scope, prov, surname: members.find(m => m.via === 'surname') ? personById.get(members.find(m => m.via === 'surname')!.pid)!.last : surname, n: members.length, nmid, terms: terms.length, share: members.length / total, votes: members.reduce((s, m) => s + m.latestVotes, 0), top: members[0]!.top, parties: [...new Set(terms.map(t => t.party).filter(Boolean))].join(','), years: [...new Set(terms.map(t => t.year))].sort().join(','), members: members.map(({ pid, via, top, city, votes }) => ({ pid, via, top, city, votes })) });
            }
        }
    }
    return out;
}

// ---------- 5. outputs ----------
function writeGz(file: string, data: unknown) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, zlib.gzipSync(typeof data === 'string' ? data : JSON.stringify(data), { level: 9 }));
}

async function main() {
    const t0 = Date.now();
    await ensureRaw();
    log('reading winners');
    const { rows: winners, regionOf } = await loadWinners();
    log(`  ${winners.length} winners, ${regionOf.size} provinces`);
    log('reading vote counts');
    const { local, national, membership } = await loadVotes(regionOf);
    // One spelling per town: "M LANG" (2004) and "M'LANG" (2010+) share a slug; keep the latest election's form.
    const canon = new Map<string, [number, string]>();
    for (const r of [...winners, ...local]) { if (!r.city) continue; const k = `${r.prov}|${slug(r.city)}`; const cur = canon.get(k); if (!cur || cur[0] < r.year) canon.set(k, [r.year, r.city]); }
    for (const r of [...winners, ...local]) if (r.city) r.city = canon.get(`${r.prov}|${slug(r.city)}`)![1];
    const aliases = cityAliases([...winners, ...local]);
    for (const r of [...winners, ...local]) if (r.city) r.city = aliases.get(`${r.prov}|${r.city}`) ?? r.city;
    for (const [mk, towns] of membership) { const prov = mk.split('|')[1]!; const fixed = new Set([...towns].map(t => { const c = canon.get(`${prov}|${slug(t)}`)?.[1] ?? t; return aliases.get(`${prov}|${c}`) ?? c; })); membership.set(mk, fixed); }
    log(`  ${aliases.size} town-name variants merged`);
    log('linking winners to candidates');
    const { contests, cands, linkStats } = buildContests(winners, local, membership);
    log(`  ${contests.length} contests, ${cands.length} candidacies`);
    log('resolving persons');
    const { persons, confStats } = resolvePersons(cands);
    log(`  ${persons.length} persons`, confStats);

    // places
    const poverty: Record<string, number> = {};
    const POVALIAS: Record<string, string> = { 'TAWI TAWI': 'TAWI-TAWI', 'MAGUINDANAO DEL SUR': 'MAGUINDANAO', 'MAGUINDANAO DEL NORTE': 'MAGUINDANAO', 'DAVAO DE ORO': 'COMPOSTELA VALLEY', 'NCR FIRST DISTRICT': 'NCR, CITY OF MANILA, FIRST DISTRICT', 'NCR SECOND DISTRICT': 'NCR, SECOND DISTRICT', 'NCR THIRD DISTRICT': 'NCR, THIRD DISTRICT', 'NCR FOURTH DISTRICT': 'NCR, FOURTH DISTRICT' };
    if (fs.existsSync('public/poverty.json')) for (const reg of JSON.parse(fs.readFileSync('public/poverty.json', 'utf8')) as { provinces: { province: string; poverty: number }[] }[]) for (const p of reg.provinces) poverty[p.province] = p.poverty;
    const title = (x: string) => x.toLowerCase().replace(/(^|[\s\-,.'(])(\S)/g, (_m, a: string, b: string) => a + b.toUpperCase()).replace(/\bDe\b/g, 'de').replace(/\bDel\b/g, 'del');
    const provs = [...new Set(cands.map(c => c.prov))].sort();
    const regions = [...new Set(provs.map(p => regionOf.get(p) ?? 'UNKNOWN'))].sort();
    const regionId = new Map(regions.map((r, i) => [r, i + 1]));
    const provId = new Map(provs.map((p, i) => [p, i + 1]));
    const cityKey = (prov: string, city: string) => `${prov}|${city}`;
    const cities = [...new Set(cands.filter(c => c.city).map(c => cityKey(c.prov, c.city)))].sort();
    const cityId = new Map(cities.map((c, i) => [c, i + 1]));
    const years = [...new Set(cands.map(c => c.year))].sort();

    // ----- SQLite -----
    log('writing sqlite');
    fs.mkdirSync('data', { recursive: true });
    if (fs.existsSync(SQLITE)) fs.unlinkSync(SQLITE);
    const db = new DatabaseSync(SQLITE);
    db.exec('PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;');
    db.exec(fs.readFileSync('db/schema.sql', 'utf8'));
    const d1: string[][] = []; // chunks of SQL statements for D1
    let chunk: string[] = [];
    const sqlVal = (v: unknown) => v == null ? 'NULL' : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? (v ? '1' : '0') : `'${String(v).replace(/'/g, "''")}'`;
    const insert = (table: string, cols: string[], rows: unknown[][]) => {
        const stmt = db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
        db.exec('BEGIN');
        for (const r of rows) stmt.run(...r.map(v => typeof v === 'boolean' ? (v ? 1 : 0) : v === undefined ? null : v) as (string | number | null)[]);
        db.exec('COMMIT');
        for (let i = 0; i < rows.length; i += 200) {
            chunk.push(`INSERT INTO ${table} (${cols.join(',')}) VALUES ${rows.slice(i, i + 200).map(r => `(${r.map(sqlVal).join(',')})`).join(',')};`);
            if (chunk.length >= 60) { d1.push(chunk); chunk = []; }
        }
    };
    insert('regions', ['id', 'name', 'slug'], regions.map(r => [regionId.get(r), r, slug(r)]));
    insert('provinces', ['id', 'name', 'slug', 'region_id', 'poverty'], provs.map(p => [provId.get(p), p, slug(p), regionId.get(regionOf.get(p) ?? 'UNKNOWN'), poverty[POVALIAS[p] ?? p] ?? null]));
    insert('cities', ['id', 'name', 'slug', 'province_id'], cities.map(c => { const [p, n] = c.split('|') as [string, string]; return [cityId.get(c), n, slug(n), provId.get(p)]; }));
    insert('persons', ['id', 'last_name', 'first_name', 'middle_name', 'suffix', 'sex', 'display_name', 'home_province_id', 'runs', 'wins', 'first_year', 'last_year', 'top_position', 'last_key', 'first_key'],
        persons.map(p => { const s = personStats(p); return [p.id, p.last, p.first, p.middle, p.suffix, p.sex, displayName(p), provId.get(p.prov), s.runs, s.wins, s.firstYear, s.lastYear, s.top, p.lastKey, p.firstKey]; }));
    insert('contests', ['id', 'year', 'province_id', 'city_id', 'district', 'position', 'seats', 'candidates', 'total_votes', 'last_winner_votes', 'runner_up_votes', 'margin', 'uncontested', 'complete'],
        contests.map(k => [k.id, k.year, provId.get(k.prov), k.city ? cityId.get(cityKey(k.prov, k.city)) : null, k.district, k.position, k.seats, k.cands.length, k.total, k.lastWinner, k.runnerUp, k.margin, k.uncontested, k.complete]));
    insert('district_towns', ['contest_id', 'city_id', 'borrowed_year'], contests.flatMap(k => k.towns.map(t => [k.id, cityId.get(cityKey(k.prov, t)) ?? null, k.townsYear]).filter(r => r[1] != null)));
    insert('candidacies', ['id', 'contest_id', 'person_id', 'year', 'province_id', 'city_id', 'position', 'party', 'votes', 'rank', 'won', 'ballot_name', 'match', 'link'],
        cands.map((c, i) => [i + 1, c.contest!.id, c.pid, c.year, provId.get(c.prov), c.city ? cityId.get(cityKey(c.prov, c.city)) : null, c.position, c.party, c.votes, c.rank, c.won, c.ballot, c.conf, c.link]));
    // national
    national.sort((a, b) => a.year - b.year || a.position.localeCompare(b.position) || b.votes - a.votes);
    const natRows: unknown[][] = [], npv: unknown[][] = [];
    let natId = 0; const rankIn = new Map<string, number>();
    for (const n of national) {
        const rk = (rankIn.get(`${n.year}|${n.position}`) ?? 0) + 1; rankIn.set(`${n.year}|${n.position}`, rk);
        const won = n.position === 'SENATOR' ? rk <= SENATE_SEATS : (n.position === 'PRESIDENT' || n.position === 'VICE PRESIDENT') ? rk === 1 : false;
        natId++; natRows.push([natId, n.year, n.position, n.name, n.party, n.votes, rk, won]);
        for (const [p, v] of n.byProv) npv.push([natId, provId.get(p), v]);
    }
    log('computing blocs');
    const blocs = computeBlocs(cands, persons, years);
    log(`  ${blocs.length} blocs, ${blocs.reduce((s, b) => s + b.members.length, 0)} memberships`);
    insert('blocs', ['id', 'scope_year', 'province_id', 'surname', 'n', 'nmid', 'terms', 'share', 'votes', 'top_position', 'parties', 'years'],
        blocs.map((b, i) => [i + 1, b.scopeYear, provId.get(b.prov), b.surname, b.n, b.nmid, b.terms, Math.round(b.share * 1e4) / 1e4, b.votes, b.top, b.parties, b.years]));
    insert('bloc_members', ['bloc_id', 'person_id', 'via', 'top_position', 'city_id', 'votes'],
        blocs.flatMap((b, i) => b.members.map(m => [i + 1, m.pid, m.via, m.top, m.city ? cityId.get(cityKey(b.prov, m.city)) ?? null : null, m.votes])));
    insert('national_candidates', ['id', 'year', 'position', 'name', 'party', 'votes', 'rank', 'won'], natRows);
    insert('national_province_votes', ['national_id', 'province_id', 'votes'], npv);
    if (chunk.length) d1.push(chunk);
    db.close();
    fs.rmSync(D1DIR, { recursive: true, force: true }); fs.mkdirSync(D1DIR, { recursive: true });
    const drops = ['bloc_members', 'blocs', 'national_province_votes', 'national_candidates', 'district_towns', 'candidacies', 'contests', 'persons', 'cities', 'provinces', 'regions'].map(t => `DROP TABLE IF EXISTS ${t};`).join('\n');
    fs.writeFileSync(path.join(D1DIR, '000-schema.sql'), drops + '\n' + fs.readFileSync('db/schema.sql', 'utf8'));
    d1.forEach((c, i) => fs.writeFileSync(path.join(D1DIR, `${String(i + 1).padStart(3, '0')}-data.sql`), c.join('\n') + '\n'));
    log(`  ${d1.length} D1 chunks`);

    // ----- web shards -----
    log('writing web shards');
    for (const d of ['prov', 'people', 'national', 'winners']) fs.rmSync(path.join(PUB, d), { recursive: true, force: true }); // geo/ is build-geo's; leave it
    const byProv = new Map<string, Contest[]>();
    for (const k of contests) (byProv.get(k.prov) ?? byProv.set(k.prov, []).get(k.prov)!).push(k);
    const personById = new Map(persons.map(p => [p.id, p]));
    const natByYear = new Map<number, NatCand[]>();
    for (const n of national) (natByYear.get(n.year) ?? natByYear.set(n.year, []).get(n.year)!).push(n);
    const natRankById = new Map(natRows.map(r => [`${r[1]}|${r[2]}|${r[3]}`, { rank: r[6] as number, won: r[7] as boolean }]));

    const topRow = (q: Person) => { const s = personStats(q); return [q.id, q.last, q.first, q.middle, q.suffix, slug(q.prov), s.runs, s.wins, s.firstYear, s.lastYear, s.top]; };
    const withStats = persons.map(q => ({ q, s: personStats(q) }));
    const index = {
        years, built: new Date().toISOString().slice(0, 10),
        totals: { persons: persons.length, candidacies: cands.length, contests: contests.length, provinces: provs.length, cities: cities.length, repeat: withStats.filter(x => x.s.runs > 1).length },
        top: {
            wins: withStats.sort((a, b) => b.s.wins - a.s.wins || b.s.runs - a.s.runs).slice(0, 100).map(x => topRow(x.q)),
            runs: withStats.sort((a, b) => b.s.runs - a.s.runs || b.s.wins - a.s.wins).slice(0, 100).map(x => topRow(x.q)),
            losses: withStats.sort((a, b) => (b.s.runs - b.s.wins) - (a.s.runs - a.s.wins) || b.s.runs - a.s.runs).slice(0, 100).map(x => topRow(x.q)),
        },
        regions: regions.map(r => ({
            name: r, slug: slug(r),
            provinces: provs.filter(p => (regionOf.get(p) ?? 'UNKNOWN') === r).map(p => {
                const ks = byProv.get(p) ?? [];
                const cs = ks.flatMap(k => k.cands);
                return {
                    name: p, slug: slug(p), poverty: poverty[POVALIAS[p] ?? p] ?? null,
                    cities: cities.filter(c => c.startsWith(p + '|')).map(c => { const n = c.split('|')[1]!; const latest = years[years.length - 1]!; const cs = ks.filter(k => k.year === latest && k.city === n).flatMap(k => k.cands); const rep = ks.find(k => k.year === latest && k.position === 'MEMBER, HOUSE OF REPRESENTATIVES' && (k.city === n || k.towns.includes(n))); return { name: n, slug: slug(n), seats: cs.filter(x => x.won).length, candidacies: cs.length, district: rep ? (rep.city ? `${title(rep.city)} · ${title(rep.district)}` : title(rep.district)) : '' }; }),
                    seats: cs.filter(c => c.won).length, candidacies: cs.length, persons: new Set(cs.map(c => c.pid)).size,
                    years: Object.fromEntries(years.map(y => [y, { seats: cs.filter(c => c.year === y && c.won).length, candidacies: cs.filter(c => c.year === y).length }])),
                };
            }),
        })),
    };
    writeGz(`${PUB}/index.json.gz`, index);

    for (const p of provs) {
        const ks = byProv.get(p) ?? [];
        const pids = new Set(ks.flatMap(k => k.cands.map(c => c.pid!)));
        const shard = {
            name: p, slug: slug(p), region: regionOf.get(p) ?? 'UNKNOWN', poverty: poverty[POVALIAS[p] ?? p] ?? null,
            contests: ks.sort((a, b) => b.year - a.year || a.city.localeCompare(b.city) || posRank(a.position) - posRank(b.position)).map(k => ({
                id: k.id, year: k.year, city: k.city, district: k.district, position: k.position, seats: k.seats, total: k.total, margin: k.margin, uncontested: k.uncontested, complete: k.complete,
                ...(k.towns.length ? { towns: k.towns, ...(k.townsYear ? { townsYear: k.townsYear } : {}) } : {}),
                c: k.cands.map(c => [c.pid, c.party, c.votes, c.won ? 1 : 0, c.rank, c.conf, c.link] as const),
            })),
            persons: Object.fromEntries([...pids].map(id => { const q = personById.get(id)!; const s = personStats(q); return [id, [q.last, q.first, q.middle, q.suffix, q.sex, s.runs, s.wins, q.prov === p ? '' : slug(q.prov)]]; })),
            national: Object.fromEntries(years.filter(y => natByYear.has(y)).map(y => [y, Object.fromEntries(
                ['PRESIDENT', 'VICE PRESIDENT', 'SENATOR', 'PARTY LIST'].map(pos => [pos, (natByYear.get(y) ?? []).filter(n => n.position === pos && n.byProv.has(p)).sort((a, b) => (b.byProv.get(p) ?? 0) - (a.byProv.get(p) ?? 0)).map(n => [n.name, n.party, n.byProv.get(p), natRankById.get(`${y}|${pos}|${n.name}`)?.won ? 1 : 0])]).filter(([, rows]) => (rows as unknown[]).length)
            )])),
        };
        writeGz(`${PUB}/prov/${slug(p)}.json.gz`, shard);
    }
    // people search index, sharded by first letter of surname
    const letters = new Map<string, unknown[][]>();
    for (const q of persons) {
        const s = personStats(q);
        const L = /^[A-Z]/.test(q.lastKey) ? q.lastKey[0]! : '_';
        (letters.get(L) ?? letters.set(L, []).get(L)!).push([q.id, q.last, q.first, q.middle, q.suffix, slug(q.prov), s.runs, s.wins, s.lastYear, s.top]);
    }
    for (const [L, rows] of letters) writeGz(`${PUB}/people/${L}.json.gz`, rows.sort((a, b) => String(a[1]).localeCompare(String(b[1])) || String(a[2]).localeCompare(String(b[2]))));
    // national races per year
    for (const [y, list] of natByYear) {
        writeGz(`${PUB}/national/${y}.json.gz`, { year: y, races: Object.fromEntries(['PRESIDENT', 'VICE PRESIDENT', 'SENATOR', 'PARTY LIST'].map(pos => [pos, list.filter(n => n.position === pos).sort((a, b) => b.votes - a.votes).map(n => { const r = natRankById.get(`${y}|${pos}|${n.name}`)!; return [n.name, n.party, n.votes, r.rank, r.won ? 1 : 0]; })]).filter(([, rows]) => (rows as unknown[]).length)) });
    }
    // winners per year for the dynasties view (same columns as the original OpenHalalan winners files)
    const wcols = ['region', 'province', 'city', 'district', 'position', 'candidate_name', 'last_name', 'first_name', 'middle_name', 'title', 'party', 'votes', 'sex', 'person_id'];
    for (const y of years) {
        const rows = cands.filter(c => c.year === y && c.won).map(c => [regionOf.get(c.prov) ?? '', c.prov, c.city, c.district, c.position, c.ballot || `${c.last}, ${c.first}${c.suffix ? ' ' + c.suffix : ''}`, c.last, c.first + (c.suffix ? ' ' + c.suffix : ''), c.middle, c.title, c.party, c.votes ?? '', c.sex, c.pid]);
        writeGz(`${PUB}/winners/${y}.csv.gz`, [wcols, ...rows].map(r => r.map(csvEscape).join(',')).join('\n') + '\n');
    }

    // ----- coverage report -----
    log('writing coverage report');
    const fmt = (n: number) => n.toLocaleString('en-US');
    const lines: string[] = ['# Data coverage', '', `Built ${index.built} from the OpenHalalan \`data-latest\` release.`, '',
        '## Sources', '', '- `NLE_Winners_2004-2025.csv`: every local winner 2001-2025 (names, party, sex, no votes).', '- `NLE_Vote_Counts_2007-2025.csv.gz`: every candidate with votes, usable from 2010. Province-level races are reported per city and summed here; national races are summed per province.', '',
        '## Per election', '', '| Year | Winners | Candidacies | Contests | Towns | Winners linked to a vote row | Unlinked winners | Winners inferred from votes | Vote-only candidates |', '|---|---|---|---|---|---|---|---|---|'];
    for (const y of years) {
        const s = linkStats.get(y)!; const ks = contests.filter(k => k.year === y); const cs = cands.filter(c => c.year === y);
        const w = cs.filter(c => c.won).length; const linked = s.exact + s.surname + s.prefix;
        lines.push(`| ${y} | ${fmt(w)} | ${fmt(cs.length)} | ${fmt(ks.length)} | ${fmt(new Set(ks.filter(k => k.city).map(k => k.prov + '|' + k.city)).size)} | ${fmt(linked)} (${w ? Math.round(100 * linked / w) : 0}%) | ${fmt(s['winner-only'])} | ${fmt(s.inferred)} | ${fmt(s['votes-only'] - s.inferred)} |`);
    }
    lines.push('', 'Linked = the winner was found among that contest\'s vote rows (exact name, unique surname, or first-name prefix). Unlinked winners keep their seat but have no vote count. Inferred = the winners file has no row for the contest, so the top candidates by votes are marked as winners using the seat count seen in other years. Before 2010 no vote data exists.', '',
        '## Persons', '', `${fmt(persons.length)} persons from ${fmt(cands.length)} candidacies. How each candidacy after a person's first was attached:`, '',
        '| Confidence | Candidacies | Rule |', '|---|---|---|',
        `| exact | ${fmt(confStats.exact)} | same surname, first name and middle name in the same province |`,
        `| strong | ${fmt(confStats.strong)} | same first name in a town already seen, or nickname/prefix with matching middle name |`,
        `| weak | ${fmt(confStats.weak)} | nickname/prefix of first name in a town already seen |`,
        `| new | ${fmt(confStats.new)} | first candidacy of a person |`, '',
        `Repeat politicians (2+ candidacies): ${fmt(persons.filter(p => p.cands.length > 1).length)}. Winners of 5+ elections: ${fmt(persons.filter(p => p.cands.filter(c => c.won).length >= 5).length)}.`, '',
        '## Known gaps', '', '- 2010 vote counts cover about two thirds of towns; 2013 about 90%. Missing towns still list winners, without votes.',
        '- 2025 `rank` in the source is unreliable and is ignored; ranks here are recomputed from votes.', '- Party list rows are organizations, not people, and are only shown as vote totals.',
        '- Representatives and board members are elected per legislative district. From 2010 the vote file names the district and its towns, and a city with its own district (Cebu City, Quezon City, Mandaue) is treated as that city\'s contest. Before 2010 the winners file has no district, so a province\'s representatives sit in one district-less contest and the member towns are borrowed from the nearest later election.',
        '- Two people with the same surname and first name in the same province but different towns are kept separate; nicknames that are not prefixes ("ATTING" for ROBERTO) create separate persons. See `match` on each candidacy.');
    fs.mkdirSync('docs', { recursive: true });
    fs.writeFileSync('docs/coverage.md', lines.join('\n') + '\n');
    log(`done in ${Math.round((Date.now() - t0) / 1000)}s`);
}

main().catch(e => { console.error(e); process.exit(1); });
