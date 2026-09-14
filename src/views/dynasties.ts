// Surname-bloc analysis (atlas / network / ledger). Mounted as a route; state survives remounts.
import 'leaflet/dist/leaflet.css';
import * as d3 from 'd3';
import * as L from 'leaflet';
import type { FeatureCollection, Feature, Geometry } from 'geojson';
import { fetchText, loadIndex, type IndexData } from '../data';
import { title, regionLabel, POSORDER, POSSHORT, slug, hrefPerson, el } from '../util';

interface Row { region: string; province: string; city: string; district: string; position: string; last_name: string; first_name: string; middle_name: string; title: string; party: string; votes: string; sex: string; person_id: string; year: string }
interface Person { key: string; first_name: string; middle_name: string; last_name: string; title: string; person_id: string; terms: Row[] }
type Via = 'surname' | 'middle';
interface Member extends Person { via: Via }
interface Cluster { id: string; sur: string; prov: string; region: string; n: number; nmid: number; members: Member[]; keys: Set<string>; terms: number; share: number; votes: number; parties: string[]; top: string; poverty: number | null; years: string[]; related: string[]; elsewhere: Cluster[] }
interface Province { name: string; region: string; sur: Record<string, Set<string>>; mid: Record<string, Set<string>>; people: Record<string, Person>; total: number; dyn: number; share: number; clusters: Cluster[]; poverty: number | null; covered: Set<string> }
interface GeoProps { name: string; slug: string | null; region?: string; label?: string }
type Dir = 'atlas' | 'network' | 'ledger';
type SortKey = 'sur' | 'prov' | 'n' | 'nmid' | 'terms' | 'share' | 'votes' | 'top' | 'pov';
type NodeType = 'r' | 'p' | 's' | 'f' | 'c';
type LinkType = 'rp' | 'ps' | 'sf' | 'fc' | 'pc' | 'ss';
interface GNode extends d3.SimulationNodeDatum { id: string; t: NodeType; label: string; r: number; x: number; y: number; prov?: string; region?: string; c?: Cluster; via?: Via }
interface GLink extends d3.SimulationLinkDatum<GNode> { t: LinkType }

const POVALIAS: Record<string, string> = { "TAWI TAWI": "TAWI-TAWI", "MAGUINDANAO DEL SUR": "MAGUINDANAO", "MAGUINDANAO DEL NORTE": "MAGUINDANAO", "DAVAO DE ORO": "COMPOSTELA VALLEY", "NCR FIRST DISTRICT": "NCR, CITY OF MANILA, FIRST DISTRICT", "NCR SECOND DISTRICT": "NCR, SECOND DISTRICT", "NCR THIRD DISTRICT": "NCR, THIRD DISTRICT", "NCR FOURTH DISTRICT": "NCR, FOURTH DISTRICT" };
const EXCLUDED = new Set(['SENATOR', 'PRESIDENT', 'VICE PRESIDENT']);

const fmt = d3.format(','), pct = d3.format('.0%'), pct1 = d3.format('.1%');
const posIdx = (p: string) => { const i = POSORDER.indexOf(p); return i < 0 ? POSORDER.length : i; };
const stored = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const store = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
const DIRS: Dir[] = ['atlas', 'network', 'ledger'];

// Every visit starts on the latest election and the whole country (deep links can override).
const S = { dir: 'atlas' as Dir, tab: 'blocs' as 'blocs' | 'regions', year: '', region: '', province: '', town: '', min: 2, q: '', sel: null as string | null, sort: { k: 'n' as SortKey, asc: false }, limit: 150 };
/** Whole-country scope is fine on the atlas for one election; the graph and ledger build every bloc at once. */
const heavy = (dir = S.dir, region = S.region, year = S.year) => region === '' && (dir !== 'atlas' || year === 'all');
let INDEX: IndexData | null = null;
let YEARS: number[] = [];
let ALL: Row[] = [], ROWS: Row[] = [];
const loadedYears = new Set<number>();
let POV: Record<string, number> = {};
let PROV: Record<string, Province> = {};
let CL: Cluster[] = [], CLBY: Record<string, Cluster> = {};
let base: Promise<void> | null = null;

const pkey = (r: Row) => r.person_id || r.first_name + '|' + r.middle_name + '|' + r.last_name;
const latest = (p: Person): Row => p.terms[0]!;
const rank = (p: Person) => Math.min(...p.terms.map(t => posIdx(t.position)));
const topPosition = (p: Person) => [...p.terms].sort((a, b) => posIdx(a.position) - posIdx(b.position))[0]!.position;

function parseCSV(text: string): Record<string, string>[] {
    const lines = text.trim().split(/\r?\n/);
    const P = (l: string) => { const r: string[] = []; let c = '', q = false; for (let i = 0; i < l.length; i++) { const ch = l[i]; if (ch === '"' && q && l[i + 1] === '"') { c += '"'; i++; } else if (ch === '"') q = !q; else if (ch === ',' && !q) { r.push(c.trim()); c = ''; } else c += ch; } r.push(c.trim()); return r; };
    const h = P(lines[0] ?? '');
    return lines.slice(1).filter(l => l.trim()).map(l => { const v = P(l); const o: Record<string, string> = {}; h.forEach((k, i) => { o[k] = v[i] ?? ''; }); return o; });
}

async function loadBase() {
    INDEX = await loadIndex();
    YEARS = INDEX.years;
    const pov = await fetch('/poverty.json').then(r => r.json() as Promise<{ provinces: { province: string; poverty: number }[] }[]>);
    for (const reg of pov) for (const p of reg.provinces) POV[p.province] = p.poverty;
}
/** Winners are loaded one election at a time; "All" pulls every year. */
async function ensureYears(years: number[]) {
    const need = years.filter(y => !loadedYears.has(y));
    if (!need.length) return;
    const csvs = await Promise.all(need.map(y => fetchText(`/data/winners/${y}.csv.gz`)));
    csvs.forEach((t, i) => {
        const y = need[i]!;
        for (const o of parseCSV(t)) {
            const r: Row = { region: o['region'] ?? '', province: o['province'] ?? '', city: o['city'] ?? '', district: o['district'] ?? '', position: o['position'] ?? '', last_name: o['last_name'] ?? '', first_name: o['first_name'] ?? '', middle_name: o['middle_name'] ?? '', title: o['title'] ?? '', party: o['party'] ?? '', votes: o['votes'] ?? '', sex: o['sex'] ?? '', person_id: o['person_id'] ?? '', year: String(y) };
            if (r.region && r.province && !EXCLUDED.has(r.position)) ALL.push(r);
        }
        loadedYears.add(y);
    });
}
const yearsNeeded = () => S.year === 'all' ? YEARS : [Number(S.year)];
function busy(msg: string | null) {
    const spin = document.getElementById('spin'); if (!spin) return;
    spin.hidden = !msg; spin.classList.remove('err'); if (msg) spin.textContent = msg;
}

function build() {
    ROWS = S.year === 'all' ? ALL : ALL.filter(r => r.year === S.year);
    PROV = {}; CL = []; CLBY = {};
    for (const r of ROWS) {
        let p = PROV[r.province];
        if (!p) p = PROV[r.province] = { name: r.province, region: r.region, sur: {}, mid: {}, people: {}, total: 0, dyn: 0, share: 0, clusters: [], poverty: null, covered: new Set() };
        const k = pkey(r);
        let person = p.people[k];
        if (!person) person = p.people[k] = { key: k, first_name: r.first_name, middle_name: r.middle_name, last_name: r.last_name, title: r.title, person_id: r.person_id, terms: [] };
        person.terms.push(r);
        if (!person.middle_name && r.middle_name) person.middle_name = r.middle_name;
        (p.sur[r.last_name] ??= new Set()).add(k);
        if (r.middle_name && r.middle_name !== r.last_name) (p.mid[r.middle_name] ??= new Set()).add(k);
    }
    for (const p of Object.values(PROV)) {
        for (const person of Object.values(p.people)) person.terms.sort((a, b) => +b.year - +a.year);
        p.total = Object.keys(p.people).length; p.clusters = [];
        const covered = new Set<string>();
        const pv = POV[POVALIAS[p.name] ?? p.name]; p.poverty = pv == null ? null : pv;
        for (const [s, direct] of Object.entries(p.sur)) {
            const keys = new Set(direct); const viaMid: string[] = [];
            for (const k of p.mid[s] ?? []) if (!keys.has(k)) { keys.add(k); viaMid.push(k); }
            if (keys.size < S.min) continue;
            const members: Member[] = [...keys].map(k => ({ ...p.people[k]!, via: (direct.has(k) ? 'surname' : 'middle') as Via }))
                .sort((a, b) => rank(a) - rank(b) || (a.via === b.via ? 0 : a.via === 'surname' ? -1 : 1) || +latest(b).votes - +latest(a).votes);
            const terms = members.flatMap(m => m.terms);
            const c: Cluster = { id: p.name + '|' + s, sur: s, prov: p.name, region: p.region, n: members.length, nmid: viaMid.length, members, keys, terms: terms.length, share: members.length / p.total, votes: d3.sum(members, m => +latest(m).votes || 0), parties: [...new Set(terms.map(t => t.party).filter(Boolean))], top: topPosition(members[0]!), poverty: p.poverty, years: [...new Set(terms.map(t => t.year))].sort(), related: [], elsewhere: [] };
            CL.push(c); CLBY[c.id] = c; p.clusters.push(c); keys.forEach(k => covered.add(k));
        }
        p.covered = covered; p.dyn = covered.size; p.share = p.total ? p.dyn / p.total : 0; p.clusters.sort((a, b) => b.n - a.n);
        for (const c of p.clusters) c.related = p.clusters.filter(o => o !== c && [...o.keys].some(k => c.keys.has(k))).map(o => o.sur);
    }
    const bySur: Record<string, Cluster[]> = {};
    for (const c of CL) (bySur[c.sur] ??= []).push(c);
    for (const c of CL) c.elsewhere = (bySur[c.sur] ?? []).filter(o => o !== c).sort((a, b) => b.n - a.n);
}

const inScope = (c: Cluster) => (!S.region || c.region === S.region) && (!S.province || c.prov === S.province);
const scoped = () => CL.filter(c => inScope(c) && (!S.q || c.sur.includes(S.q))).sort((a, b) => b.n - a.n || b.share - a.share);
const yearLabel = () => S.year !== 'all' ? S.year : `${YEARS[0]}–${YEARS[YEARS.length - 1]}`;
const scopeLabel = () => (S.province ? title(S.province) : S.region ? regionLabel(S.region) : 'Philippines') + ' · ' + yearLabel();
const unit = () => S.year === 'all' ? 'officials' : 'seats';
const perUnit = () => S.year === 'all' ? 'people' : 'seats';
const personHref = (r: Row) => r.person_id ? hrefPerson(slug(r.province), r.person_id) : '';

type Level = 'country' | 'region' | 'province' | 'town' | 'bloc';
function renderCrumbs() {
    const items: { label: string; level: Level }[] = [{ label: 'Philippines', level: 'country' }];
    if (S.region) items.push({ label: regionLabel(S.region), level: 'region' });
    if (S.province) items.push({ label: title(S.province), level: 'province' });
    if (S.town) items.push({ label: title(S.town), level: 'town' });
    const sel = S.sel ? CLBY[S.sel] : undefined;
    if (sel) items.push({ label: title(sel.sur), level: 'bloc' });
    el('crumbs').innerHTML = items.map((it, i) => i === items.length - 1 ? `<span>${it.label}</span>` : `<button type="button" data-level="${it.level}">${it.label}</button>`).join('<i>›</i>');
    el('rankmeta').textContent = yearLabel();
}
function goLevel(level: Level) {
    S.sel = null;
    if (level === 'town') { renderRank(); if (S.dir === 'atlas') void renderMap(); drawGraph(); return; }
    if (level === 'country') { if (heavy(S.dir, '') && !heavy() && !confirm(HEAVY_WARNING)) return; S.region = ''; store('dyn.region', ''); el<HTMLSelectElement>('region').value = ''; setProvince(''); }
    else if (level === 'region') setProvince('');
    else if (level === 'province') setTown('');
}
/** Top panel when a town is selected: its seats, the surnames holding them, and every official. */
function renderTownPanel() {
    const p = PROV[S.province]!;
    const town = S.town;
    const people = Object.values(p.people).filter(q => latest(q).city === town).sort((a, b) => rank(a) - rank(b) || a.last_name.localeCompare(b.last_name));
    const inBloc = people.filter(q => p.covered.has(q.key));
    const blocs = p.clusters.map(c => ({ c, here: c.members.filter(m => latest(m).city === town) })).filter(x => x.here.length).sort((a, b) => b.here.length - a.here.length || b.c.n - a.c.n);
    const label = (r: Person) => { const href = personHref(latest(r)); const t = `${title(r.first_name)} ${title(r.last_name)}`; return href ? `<a href="${href}">${t}</a>` : t; };
    el('stats').innerHTML = `<div class="stat"><b>${people.length}</b><span>${unit()} in ${title(town)}</span></div><div class="stat"><b style="color:${inBloc.length ? 'var(--sur)' : 'inherit'}">${people.length ? pct(inBloc.length / people.length) : '–'}</b><span>held by a surname bloc</span></div><div class="stat"><b>${blocs.length}</b><span>bloc${blocs.length === 1 ? '' : 's'} with seats here</span></div>`;
    el('rankbody').innerHTML = `<div class="tree" style="padding:4px 0 8px">
  ${blocs.length ? `<h4>Surnames with seats here <span style="text-transform:none;letter-spacing:0">(${S.min}+ seats in ${title(p.name)})</span></h4><div class="chips">${blocs.map(({ c, here }) => `<button class="chip" data-id="${c.id}" aria-current="${S.sel === c.id}">${title(c.sur)}<small>${here.length} here · ${c.n} in province</small></button>`).join('')}</div>` : `<div class="empty" style="padding:8px 0"><b>No surname bloc</b>No family name holds ${S.min}+ seats in ${title(p.name)} through officials of ${title(town)}.</div>`}
  <h4>Officials</h4>${people.map(q => `<div class="person" data-via="${p.covered.has(q.key) ? 'surname' : 'none'}"><div class="who">${label(q)}</div><div class="v">${latest(q).votes ? fmt(+latest(q).votes) : '–'}<small>${latest(q).party || '—'}</small></div><div class="what"><b>${title(latest(q).position)}</b>${latest(q).district ? ' · ' + title(latest(q).district) + ' dist.' : ''}${p.covered.has(q.key) ? '' : ' <span class="mute">· no bloc</span>'}</div></div>`).join('') || '<div class="empty">No local officials recorded here for this selection.</div>'}</div>`;
}
/** "Regions" tab: every region with its bloc share; the current region opens into its provinces. Click to scope. */
function renderRegionsPanel() {
    const provs = Object.values(PROV);
    const regions = [...new Set(provs.map(p => p.region))].sort().map(name => {
        const ps = provs.filter(p => p.region === name);
        const seats = d3.sum(ps, p => p.total), dyn = d3.sum(ps, p => p.dyn), blocs = d3.sum(ps, p => p.clusters.length);
        return { name, ps, seats, dyn, blocs, share: seats ? dyn / seats : 0 };
    });
    const seats = d3.sum(regions, r => r.seats), dyn = d3.sum(regions, r => r.dyn);
    el('stats').innerHTML = `<div class="stat"><b>${regions.length}</b><span>regions · ${provs.length} provinces</span></div><div class="stat"><b>${seats ? pct(dyn / seats) : '–'}</b><span>of ${fmt(seats)} ${unit()} in blocs</span></div><div class="stat"><b>${fmt(d3.sum(regions, r => r.blocs))}</b><span>surname blocs (${S.min}+ seats)</span></div>`;
    const maxShare = d3.max(regions, r => r.share) || 1;
    const row = (cls: string, attr: string, label: string, sub: string, share: number, n: number, current: boolean) =>
        `<button class="rk ${cls}" ${attr} aria-current="${current}"><i></i><div class="nm">${label}<small>${sub}</small></div><div class="n">${pct(share)}<small> · ${n} blocs</small></div><div class="bar"><i style="width:${share / maxShare * 100}%"></i></div></button>`;
    el('rankbody').innerHTML = regions.map(r => row('rgn', `data-region="${r.name}"`, regionLabel(r.name), `${r.ps.length} provinces · ${fmt(r.seats)} ${unit()}`, r.share, r.blocs, r.name === S.region && !S.province)
        + (r.name === S.region ? `<div class="sub">${[...r.ps].sort((a, b) => b.share - a.share).map(p => row('prv', `data-province="${p.name}"`, title(p.name), `${fmt(p.total)} ${unit()}${p.poverty != null ? ` · poverty ${p.poverty}%` : ''}`, p.share, p.clusters.length, p.name === S.province)).join('')}</div>` : '')).join('')
        || '<div class="empty">No seats in this election.</div>';
}
function renderRank() {
    renderCrumbs();
    const tabs = document.getElementById('ptabs');
    if (tabs) tabs.hidden = S.dir !== 'network'; // the Blocs / Regions switch belongs to the network view only
    if (S.dir !== 'network') S.tab = 'blocs';
    document.querySelectorAll<HTMLButtonElement>('#ptabs button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset['tab'] === S.tab)));
    if (S.tab === 'regions') { renderRegionsPanel(); return; }
    const c = S.sel ? CLBY[S.sel] : undefined;
    if (c) { renderBlocPanel(c); return; }
    if (S.town && PROV[S.province]) { renderTownPanel(); return; }
    const list = scoped();
    const provs = Object.values(PROV).filter(p => (!S.region || p.region === S.region) && (!S.province || p.name === S.province));
    const seats = d3.sum(provs, p => p.total), dyn = d3.sum(provs, p => p.dyn);
    const first = list[0];
    el('stats').innerHTML = `<div class="stat"><b>${fmt(list.length)}</b><span>surname blocs</span></div><div class="stat"><b>${seats ? pct(dyn / seats) : '–'}</b><span>of ${fmt(seats)} ${unit()}</span></div><div class="stat"><b>${first ? first.n : '–'}</b><span>largest bloc${first ? ' · ' + title(first.sur) : ''}</span></div>`;
    const max = first ? first.n : 1;
    const p = S.province ? PROV[S.province] : undefined;
    const towns = p ? cityStats(p) : null;
    const facts = p && towns ? `<div class="facts-line mono" style="padding:2px 8px 8px">${p.poverty != null ? `poverty ${p.poverty}% · ` : ''}${towns.size} towns · ${[...towns.values()].filter(v => v.dyn === 0).length} without a bloc · click a town on the map</div>` : '';
    el('rankbody').innerHTML = facts + list.slice(0, 60).map((c, i) => `<button class="rk" data-id="${c.id}" aria-current="${S.sel === c.id}"><i>${i + 1}</i><div class="nm">${title(c.sur)}<small>${title(c.prov)}${S.region ? '' : ' · ' + regionLabel(c.region)}</small></div><div class="n">${c.n}<small> ${perUnit()}${c.nmid ? ` <span style="color:var(--amber)">+${c.nmid}m</span>` : ''}</small></div><div class="bar"><i style="width:${c.n / max * 100}%"></i></div></button>`).join('') || `<div class="empty">No surname holds ${S.min}+ seats here.</div>`;
}

function renderTable() {
    const { k, asc } = S.sort;
    const acc: Record<SortKey, (c: Cluster) => string | number> = { sur: c => c.sur, prov: c => c.prov, n: c => c.n, nmid: c => c.nmid, terms: c => c.terms, share: c => c.share, votes: c => c.votes, top: c => posIdx(c.top), pov: c => c.poverty ?? -1 };
    const get = acc[k];
    const list = [...scoped()].sort((a, b) => { const x = get(a), y = get(b); const r = typeof x === 'string' && typeof y === 'string' ? x.localeCompare(y) : Number(x) - Number(y); return asc ? r : -r; });
    el('tablemeta').textContent = `${fmt(list.length)} blocs · ${scopeLabel()}`;
    const H = (key: SortKey, lbl: string, cls = '') => `<th class="${cls}" data-k="${key}" ${k === key ? `aria-sort="${asc ? 'ascending' : 'descending'}"` : ''}>${lbl}</th>`;
    const all = S.year === 'all';
    el('tablebody').innerHTML = `<table><thead><tr>${H('sur', 'Surname')}${H('prov', 'Province')}${H('n', all ? 'People' : 'Seats', 'num')}${H('nmid', 'Via middle', 'num')}${all ? H('terms', 'Terms', 'num') : ''}${H('share', 'Share', 'num')}${H('top', 'Highest post')}<th>Parties</th>${H('votes', 'Votes', 'num')}${H('pov', 'Poverty', 'num')}</tr></thead><tbody>`
        + list.slice(0, S.limit).map(c => `<tr class="row" data-id="${c.id}" aria-current="${S.sel === c.id}"><td><span class="sw" style="background:var(--sur);opacity:${.35 + Math.min(1, c.n / 12) * .65}"></span><b>${title(c.sur)}</b></td><td>${title(c.prov)}<span style="color:var(--mute)"> · ${regionLabel(c.region)}</span></td><td class="num">${c.n}</td><td class="num" style="color:${c.nmid ? 'var(--amber)' : 'var(--faint)'}">${c.nmid || '–'}</td>${all ? `<td class="num">${c.terms}</td>` : ''}<td class="num">${pct1(c.share)}</td><td>${POSSHORT[c.top] ?? c.top}</td><td style="color:var(--mute);max-width:180px;overflow:hidden;text-overflow:ellipsis">${c.parties.join(', ')}</td><td class="num">${fmt(c.votes)}</td><td class="num">${c.poverty == null ? '–' : c.poverty + '%'}</td></tr>`).join('')
        + `</tbody></table>` + (list.length > S.limit ? `<button class="more" id="more">Show ${Math.min(150, list.length - S.limit)} more of ${fmt(list.length)}</button>` : '');
}

/** Top panel when a surname is selected: the bloc's facts, every official carrying it, and related surnames. */
function renderBlocPanel(c: Cluster) {
    const p = PROV[c.prov]!;
    const all = S.year === 'all';
    const posCounts = d3.rollup(c.members, v => v.length, m => topPosition(m));
    const posKeys = POSORDER.filter(k => posCounts.get(k));
    const nm = (r: Person) => { const label = `${title(r.first_name)}${r.middle_name ? ' <span style="color:var(--mute);font-weight:400">' + title(r.middle_name) + '</span>' : ''} ${title(r.last_name)}`; const href = personHref(latest(r)); return (href ? `<a href="${href}">${label}</a>` : label) + (r.title ? ' <small style="color:var(--faint)">' + r.title + '</small>' : ''); };
    el('stats').innerHTML = `<div class="stat"><b>${c.n}</b><span>${perUnit()} · ${pct1(c.share)} of ${p.total} in ${title(c.prov)}</span></div><div class="stat"><b style="color:${c.nmid ? 'var(--amber)' : 'inherit'}">${c.nmid}</b><span>via middle name</span></div><div class="stat"><b>${fmt(c.votes)}</b><span>votes, latest term · ${c.parties.length} ${c.parties.length === 1 ? 'party' : 'parties'}</span></div>`;
    el('rankbody').innerHTML = `<div class="tree" style="padding:4px 0 8px">
  <div class="kicker" style="display:flex;gap:8px"><span>${title(c.prov)} · ${regionLabel(c.region)}${all ? ` · ${c.terms} terms ${c.years.join(', ')}` : ''}</span>${c.poverty != null ? `<span style="margin-left:auto">poverty ${c.poverty}%</span>` : ''}</div>
  <div class="pos">${posKeys.map(k => `<i style="flex:${posCounts.get(k)};opacity:${1 - POSORDER.indexOf(k) * .1}" title="${k}"></i>`).join('')}</div><div class="poslbl">${posKeys.map(k => `<span>${posCounts.get(k)} ${POSSHORT[k] ?? k}</span>`).join('')}</div>
  <h4>Officials</h4>${c.members.map(m => `<div class="person" data-via="${m.via}"><div class="who">${nm(m)}${m.via === 'middle' ? ' <span class="via">via middle name</span>' : ''}</div><div class="v">${latest(m).votes ? fmt(+latest(m).votes) : '–'}<small>${latest(m).party || '—'}</small></div>${m.terms.map(r => `<div class="what">${all ? `<span class="yr">${r.year}</span> ` : ''}<b>${title(r.position)}</b>${r.city ? ' · ' + title(r.city) : ''}${r.district ? ' · ' + title(r.district) + ' dist.' : ''}</div>`).join('')}</div>`).join('')}
  ${c.related.length ? `<h4>Linked surnames <span style="text-transform:none;letter-spacing:0">(share an official, same province)</span></h4><div class="chips">${c.related.map(s => `<button class="chip" data-id="${c.prov + '|' + s}">${title(s)}<small>${CLBY[c.prov + '|' + s]?.n ?? ''}</small></button>`).join('')}</div>` : ''}
  ${c.elsewhere.length ? `<h4>Same surname elsewhere</h4><div class="chips">${c.elsewhere.slice(0, 12).map(o => `<button class="chip" data-id="${o.id}">${title(o.prov)}<small>${o.n}</small></button>`).join('')}</div>` : ''}</div>`;
}

// ----- map (province and town boundaries) -----
let LM: L.Map | null = null, provLayer: L.GeoJSON | null = null, regionLayer: L.GeoJSON | null = null, cityLayer: L.GeoJSON | null = null, labelLayer: L.LayerGroup | null = null;
let cityLayerFor = '', mapLastKey: string | null = null, mapToken = 0;
const geoCache = new Map<string, Promise<FeatureCollection<Geometry, GeoProps>>>();
function loadGeo(path: string) {
    let p = geoCache.get(path);
    if (!p) { p = fetchText(path).then(t => JSON.parse(t) as FeatureCollection<Geometry, GeoProps>); p.catch(() => geoCache.delete(path)); geoCache.set(path, p); }
    return p;
}
const cssVar = (n: string) => getComputedStyle(document.body).getPropertyValue(n).trim();
const COUNTRY_BOUNDS = L.latLngBounds([4.4, 116.5], [21.2, 127]);
/** Share of a province's officials in surname blocs, per town, using each person's latest seat. */
function cityStats(p: Province) {
    const m = new Map<string, { total: number; dyn: number; slug: string }>();
    for (const person of Object.values(p.people)) {
        const city = latest(person).city; if (!city) continue;
        const e = m.get(city) ?? m.set(city, { total: 0, dyn: 0, slug: slug(city) }).get(city)!;
        e.total++; if (p.covered.has(person.key)) e.dyn++;
    }
    return m;
}
async function renderMap() {
    const host = document.querySelector<HTMLElement>('#map .body');
    if (!host || !host.clientWidth || !host.clientHeight) return;
    if (!LM) {
        LM = L.map(host, { center: [12.2, 122.5], zoom: 6, minZoom: 5, maxZoom: 13, zoomControl: true, attributionControl: true, zoomSnap: .5 });
        LM.attributionControl.setPrefix(false);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · boundaries <a href="https://github.com/faeldon/philippines-json-maps">PSGC 2023</a>', subdomains: 'abc' }).addTo(LM);
        labelLayer = L.layerGroup().addTo(LM);
        LM.on('click', () => { if (S.town) setTown(''); else if (S.province) setProvince(''); });
    }
    const map = LM;
    map.invalidateSize();
    const token = ++mapToken;
    const [provinces, regions] = await Promise.all([loadGeo('/data/geo/provinces.json.gz'), loadGeo('/data/geo/regions.json.gz')]);
    if (token !== mapToken || LM !== map) return;
    const ink = cssVar('--ink'), bg = cssVar('--bg'), none = cssVar('--none');
    // share of seats in blocs: green (low) through amber to red (high)
    const ramp = d3.interpolateRgbBasis([cssVar('--win'), cssVar('--amber'), cssVar('--sur')]);
    const col = (t: number) => ramp(Math.max(0, Math.min(1, t)));
    const fill = (dyn: number, t: number) => dyn > 0 ? col(t) : none;
    const provs = Object.values(PROV);
    const maxShare = d3.max(provs, p => p.share) || .5;
    const inReg = (p: Province) => !S.region || p.region === S.region;
    // With a surname selected and no province focused, light up the provinces where that surname holds seats.
    const selCluster = S.sel ? CLBY[S.sel] : undefined;
    const selProvs = new Set(selCluster && !S.province ? [selCluster.prov, ...selCluster.elsewhere.map(o => o.prov)] : []);
    const provStyle = (f: Feature<Geometry, GeoProps> | undefined): L.PathOptions => {
        const p = f ? PROV[f.properties.name] : undefined;
        const sel = !!p && p.name === S.province;
        if (!p) return { color: 'rgba(128,128,128,.35)', weight: .5, fillColor: '#888', fillOpacity: .05 };
        const holds = selProvs.has(p.name);
        const dim = !inReg(p) || (!!S.province && !sel) || (selProvs.size > 0 && !holds && inReg(p));
        return { color: sel || holds ? ink : 'rgba(0,0,0,.55)', weight: sel ? 2.5 : holds ? 2 : .8, fillColor: fill(p.dyn, p.share / maxShare), fillOpacity: dim ? .14 : .72, opacity: dim ? .35 : 1 };
    };
    if (!regionLayer) regionLayer = L.geoJSON(regions, { style: { color: ink, weight: 1.2, fill: false, dashArray: '4 4', opacity: .45 }, interactive: false }).addTo(map);
    if (provLayer) provLayer.setStyle(provStyle);
    else {
        provLayer = L.geoJSON(provinces, {
            style: provStyle,
            onEachFeature: (f, layer) => {
                layer.on('click', e => { L.DomEvent.stop(e); const name = f.properties.name; if (PROV[name]) setProvince(name === S.province ? '' : name); });
                layer.on('mouseover', () => { const p = PROV[f.properties.name]; layer.bindTooltip(p ? `<b>${title(p.name)}</b><br>${p.dyn} of ${p.total} ${unit()} (${pct(p.share)}) in ${p.clusters.length} surname blocs` : `<b>${title(f.properties.name)}</b><br>no seats in this selection`, { direction: 'top', sticky: true }).openTooltip(); });
            },
        }).addTo(map);
    }
    // labels: selected province plus the largest blocs in scope
    labelLayer!.clearLayers();
    const topN = new Set(provs.filter(inReg).sort((a, b) => b.dyn - a.dyn).slice(0, S.region ? 14 : 10).map(p => p.name));
    provLayer.eachLayer(l => {
        const f = (l as L.Polygon).feature as Feature<Geometry, GeoProps> | undefined; if (!f) return;
        const p = PROV[f.properties.name]; if (!p || !inReg(p) || !(topN.has(p.name) || p.name === S.province) || (S.province && p.name !== S.province)) return;
        labelLayer!.addLayer(L.marker((l as L.Polygon).getBounds().getCenter(), { interactive: false, icon: L.divIcon({ className: '', html: `<div class="mlbl">${title(p.name)}</div>`, iconSize: [0, 0] }) }));
    });
    // towns of the focused province
    if (S.province) {
        const p = PROV[S.province]!;
        const stats = cityStats(p);
        const sel = S.sel ? CLBY[S.sel] : undefined;
        const selTowns = new Set(sel && sel.prov === p.name ? sel.members.map(m => slug(latest(m).city)) : []);
        const cityMax = d3.max([...stats.values()], v => v.total ? v.dyn / v.total : 0) || 1;
        const townSlug = S.town ? slug(S.town) : '';
        const cityStyle = (f: Feature<Geometry, GeoProps> | undefined): L.PathOptions => {
            const st = f?.properties.slug ? [...stats.values()].find(v => v.slug === f.properties.slug) : undefined;
            const hl = !!f?.properties.slug && selTowns.has(f.properties.slug);
            const isTown = !!townSlug && f?.properties.slug === townSlug;
            const faded = selTowns.size > 0 && !hl && !isTown; // a surname is selected: towns it does not hold step back
            return { color: isTown ? ink : hl ? ink : bg, weight: isTown ? 3.5 : hl ? 2.5 : .8, opacity: faded ? .5 : .95, fillColor: st ? fill(st.dyn, (st.total ? st.dyn / st.total : 0) / cityMax) : '#888', fillOpacity: !st ? .15 : faded ? .18 : .78 };
        };
        if (cityLayerFor !== S.province) {
            cityLayer?.remove(); cityLayer = null; cityLayerFor = S.province;
            const fc = await loadGeo(`/data/geo/cities/${slug(S.province)}.json.gz`).catch(() => null);
            if (token !== mapToken || LM !== map || !fc) return;
            cityLayer = L.geoJSON(fc, {
                style: cityStyle,
                onEachFeature: (f, layer) => {
                    layer.on('mouseover', () => { const st = f.properties.slug ? [...stats.values()].find(v => v.slug === f.properties.slug) : undefined; layer.bindTooltip(`<b>${title(f.properties.name)}</b><br>${st ? `${st.dyn} of ${st.total} ${unit()} (${pct(st.total ? st.dyn / st.total : 0)}) in surname blocs` : 'no local seats in this selection'}`, { direction: 'top', sticky: true }).openTooltip(); });
                    layer.on('click', e => { L.DomEvent.stop(e); const name = f.properties.name; if (name) setTown(S.town === name ? '' : name); });
                },
            }).addTo(map);
        } else cityLayer?.setStyle(cityStyle);
        cityLayer?.bringToFront();
        const noBloc = [...stats.values()].filter(v => v.dyn === 0).length;
        el('maplegend').innerHTML = `<div><i style="background:${col(1)}"></i>high share of ${unit()} in surname blocs</div><div><i style="background:${col(.5)}"></i>medium</div><div><i style="background:${col(0)}"></i>low</div><div><i style="background:${none}"></i>no surname bloc · ${noBloc} of ${stats.size} towns</div><div><i style="background:transparent;border:2px solid ${ink}"></i>${S.sel ? 'towns where the selected surname holds seats; others faded' : 'click a town for details'}</div>`;
    } else { cityLayer?.remove(); cityLayer = null; cityLayerFor = ''; }
    // camera
    const key = S.province || S.region;
    if (key !== mapLastKey) {
        mapLastKey = key;
        let bounds: L.LatLngBounds | null = null;
        if (S.province) provLayer.eachLayer(l => { const f = (l as L.Polygon).feature as Feature<Geometry, GeoProps> | undefined; if (f?.properties.name === S.province) bounds = (l as L.Polygon).getBounds(); });
        else if (S.region) { const b = L.latLngBounds([]); provLayer.eachLayer(l => { const f = (l as L.Polygon).feature as Feature<Geometry, GeoProps> | undefined; if (f && PROV[f.properties.name]?.region === S.region) b.extend((l as L.Polygon).getBounds()); }); if (b.isValid()) bounds = b; }
        map.flyToBounds(bounds ?? COUNTRY_BOUNDS, { duration: .6, padding: [16, 16], maxZoom: S.province ? 10 : 8 });
    }
    if (!S.province) el('maplegend').innerHTML = `<div><i style="background:${col(1)}"></i>high share of ${unit()} in surname blocs</div><div><i style="background:${col(.5)}"></i>medium</div><div><i style="background:${col(0)}"></i>low</div><div><i style="background:${none}"></i>no surname bloc</div><div><i style="background:transparent;border:1px dashed ${ink};opacity:.6"></i>${S.sel ? 'provinces where the selected surname holds seats; others faded' : 'region boundary · click a province for its towns'}</div>`;
}

// ----- network -----
let sim: d3.Simulation<GNode, GLink> | null = null, gCanvas: HTMLCanvasElement | null = null, gCtx: CanvasRenderingContext2D | null = null;
let gT: d3.ZoomTransform = d3.zoomIdentity, gNodes: GNode[] = [], gLinks: GLink[] = [], gHover: GNode | null = null;
let gZoom: d3.ZoomBehavior<HTMLCanvasElement, unknown> | null = null, autoFit = true;
/** Keep the whole graph in view until the user pans or zooms. */
function fitGraph() {
    if (!gCanvas || !gNodes.length) return;
    const host = gCanvas.parentElement!; const W = host.clientWidth, H = host.clientHeight; if (!W || !H) return;
    // Large graphs fling a few province nodes far out; fit the central 94% so they don't dictate the zoom.
    const q = gNodes.length > 200 ? .03 : 0;
    const xs = gNodes.map(n => n.x).sort((a, b) => a - b), ys = gNodes.map(n => n.y).sort((a, b) => a - b);
    const at = (arr: number[], f: number) => arr[Math.min(arr.length - 1, Math.max(0, Math.round(f * (arr.length - 1))))]!;
    const x0 = at(xs, q) - 6, x1 = at(xs, 1 - q) + 6, y0 = at(ys, q) - 6, y1 = at(ys, 1 - q) + 6;
    // The rank and detail panels float over the canvas on wide screens; fit into the gap between them.
    const cb = gCanvas.getBoundingClientRect();
    const rank = document.getElementById('rank')?.getBoundingClientRect(), det = document.getElementById('detail')?.getBoundingClientRect();
    const insetL = rank && rank.left < cb.left + 40 && rank.right > cb.left ? Math.min(W / 2, rank.right - cb.left + 16) : 0;
    const insetR = det && det.right > cb.right - 40 && det.left < cb.right ? Math.min(W / 2, cb.right - det.left + 16) : 0;
    const availW = Math.max(100, W - insetL - insetR);
    const k = Math.max(.02, Math.min(8, .88 * Math.min(availW / Math.max(1, x1 - x0), H / Math.max(1, y1 - y0))));
    const t = d3.zoomIdentity.translate(-k * (x0 + x1) / 2 + (insetL - insetR) / 2, -k * (y0 + y1) / 2).scale(k);
    if (gZoom) d3.select(gCanvas).call(gZoom.transform, t); else { gT = t; drawGraph(); }
}
function buildGraph() {
    const list = scoped(); const wide = !S.region && !S.province;
    const clusters = wide ? list.filter(c => c.n >= Math.max(S.min, 4)) : list;
    const nodes: GNode[] = [], links: GLink[] = [];
    const pid: Record<string, GNode> = {}, rid: Record<string, GNode> = {}, cid: Record<string, GNode> = {}, sid: Record<string, GNode[]> = {};
    for (const c of clusters) {
        let pn = pid[c.prov];
        if (!pn) {
            pn = pid[c.prov] = { id: 'p|' + c.prov, t: 'p', label: title(c.prov), r: wide ? 4 : 7, prov: c.prov, x: 0, y: 0 }; nodes.push(pn);
            if (!S.province) { // region hubs: click one to scope the graph to that region
                let rn = rid[c.region];
                if (!rn) { rn = rid[c.region] = { id: 'r|' + c.region, t: 'r', label: regionLabel(c.region), r: wide ? 9 : 11, region: c.region, x: 0, y: 0 }; nodes.push(rn); }
                links.push({ source: rn.id, target: pn.id, t: 'rp' });
            }
        }
        const s: GNode = { id: c.id, t: 's', label: title(c.sur), r: Math.sqrt(c.n) * (wide ? 2.2 : 3.2) + 2, c, x: 0, y: 0 };
        nodes.push(s); links.push({ source: pn.id, target: s.id, t: 'ps' }); (sid[c.sur] ??= []).push(s);
        if (!wide) c.members.forEach((m, i) => {
            const n: GNode = { id: c.id + '#' + i, t: 'f', via: m.via, label: title(m.first_name), r: 2.5, x: 0, y: 0 };
            nodes.push(n); links.push({ source: s.id, target: n.id, t: 'sf' });
            const city = latest(m).city;
            if (city) { const k = c.prov + '|' + city; let cn = cid[k]; if (!cn) { cn = cid[k] = { id: 'c|' + k, t: 'c', label: title(city), r: 3.5, prov: c.prov, x: 0, y: 0 }; nodes.push(cn); links.push({ source: pn.id, target: cn.id, t: 'pc' }); } links.push({ source: n.id, target: cn.id, t: 'fc' }); }
        });
    }
    for (const arr of Object.values(sid)) if (arr.length > 1) for (let i = 1; i < arr.length; i++) links.push({ source: arr[0]!.id, target: arr[i]!.id, t: 'ss' });
    gNodes = nodes; gLinks = links;
    if (sim) sim.stop();
    const dist: Record<LinkType, number> = { rp: wide ? 70 : 140, ps: wide ? 30 : 60, sf: 10, fc: 22, pc: wide ? 0 : 90, ss: wide ? 60 : 120 };
    const str: Record<LinkType, number> = { rp: .5, ps: .4, sf: .9, fc: .35, pc: .15, ss: .12 };
    const charge: Record<NodeType, number> = { r: wide ? -900 : -600, p: -260, s: -40, c: -50, f: -6 };
    sim = d3.forceSimulation<GNode>(nodes).force('link', d3.forceLink<GNode, GLink>(links).id(d => d.id).distance(l => dist[l.t]).strength(l => str[l.t])).force('charge', d3.forceManyBody<GNode>().strength(d => charge[d.t])).force('collide', d3.forceCollide<GNode>(d => d.r + 2)).force('center', d3.forceCenter(0, 0)).force('x', d3.forceX<GNode>().strength(.03)).force('y', d3.forceY<GNode>().strength(.03)).alphaDecay(.03).on('tick', () => { if (autoFit) fitGraph(); else drawGraph(); }).on('end', () => { if (autoFit) fitGraph(); });
    autoFit = true;
}
function ensureCanvas() {
    if (gCanvas) return;
    const host = document.querySelector<HTMLElement>('#graph .body'); if (!host) return;
    const canvas = document.createElement('canvas'); host.appendChild(canvas); gCanvas = canvas; gCtx = canvas.getContext('2d');
    gZoom = d3.zoom<HTMLCanvasElement, unknown>().scaleExtent([.02, 8]).on('zoom', e => { gT = e.transform; if (e.sourceEvent) autoFit = false; drawGraph(); });
    d3.select(canvas).call(gZoom).on('dblclick.zoom', () => { autoFit = true; fitGraph(); });
    canvas.addEventListener('mousemove', e => { const n = pick(e); if (n !== gHover) { gHover = n; canvas.style.cursor = n && (n.t === 's' || n.t === 'p' || n.t === 'r') ? 'pointer' : 'default'; drawGraph(); } });
    canvas.addEventListener('click', e => { const n = pick(e); if (!n) return; if (n.t === 's' && n.c) select(n.c.id); else if (n.t === 'p' && n.prov !== undefined) setProvince(n.prov === S.province ? '' : n.prov); else if (n.t === 'r' && n.region !== undefined) setRegion(n.region === S.region ? '' : n.region); });
}
function pick(e: MouseEvent): GNode | null {
    if (!gCanvas) return null;
    const b = gCanvas.getBoundingClientRect();
    const [x, y] = gT.invert([e.clientX - b.left - b.width / 2, e.clientY - b.top - b.height / 2]);
    let best: GNode | null = null, bd = 1e9;
    for (const n of gNodes) { const d = Math.hypot(n.x - x, n.y - y); if (d < Math.max(n.r, 6 / gT.k) + 2 && d < bd) { bd = d; best = n; } }
    return best;
}
function drawGraph() {
    if (!gCanvas || !gCtx || !gCanvas.isConnected) return;
    const host = gCanvas.parentElement!; const W = host.clientWidth, H = host.clientHeight, dpr = devicePixelRatio || 1;
    if (gCanvas.width !== W * dpr || gCanvas.height !== H * dpr) { gCanvas.width = W * dpr; gCanvas.height = H * dpr; gCanvas.style.width = W + 'px'; gCanvas.style.height = H + 'px'; }
    const C = { sur: cssVar('--sur'), prov: cssVar('--prov'), ppl: cssVar('--ppl'), amber: cssVar('--amber'), ink: cssVar('--ink'), bg: cssVar('--bg'), mute: cssVar('--mute') };
    const x = gCtx; x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, W, H); x.translate(W / 2 + gT.x, H / 2 + gT.y); x.scale(gT.k, gT.k);
    const selId = S.sel; const hl = (n: GNode) => n === gHover || (n.t === 's' && n.c?.id === selId);
    x.lineWidth = .6 / gT.k;
    for (const l of gLinks) {
        const a = l.source as GNode, b = l.target as GNode;
        if (l.t === 'ss') { x.setLineDash([4 / gT.k, 3 / gT.k]); x.strokeStyle = C.sur; x.globalAlpha = .55; x.lineWidth = 1 / gT.k; }
        else { x.setLineDash([]); x.lineWidth = .6 / gT.k; x.strokeStyle = l.t === 'rp' ? C.ink : l.t === 'ps' || l.t === 'pc' ? C.prov : l.t === 'fc' ? C.mute : C.ppl; x.globalAlpha = l.t === 'rp' ? .35 : l.t === 'ps' ? .35 : l.t === 'pc' ? .15 : l.t === 'fc' ? .3 : .45; if (l.t === 'rp') x.lineWidth = 1.2 / gT.k; }
        x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke();
    }
    x.setLineDash([]); x.globalAlpha = 1;
    for (const n of gNodes) {
        x.fillStyle = n.t === 's' ? C.sur : n.t === 'r' ? C.ink : n.t === 'p' || n.t === 'c' ? C.prov : n.via === 'middle' ? C.amber : C.ppl;
        x.beginPath(); if (n.t === 'c') { x.globalAlpha = .7; x.rect(n.x - n.r, n.y - n.r, n.r * 2, n.r * 2); } else x.arc(n.x, n.y, n.r, 0, 7);
        x.fill(); x.globalAlpha = 1; if (hl(n)) { x.strokeStyle = C.ink; x.lineWidth = 2 / gT.k; x.stroke(); }
    }
    x.textAlign = 'center'; x.textBaseline = 'top';
    for (const n of gNodes) {
        const show = n.t === 'r' || n.t === 'p' || (n.t === 's' && (n.r * gT.k > 9 || hl(n))) || (n.t === 'f' && gT.k > 3.2) || (n.t === 'c' && (gT.k > 1.6 || hl(n)));
        if (!show) continue;
        const fs = (n.t === 'r' ? 13 : n.t === 'p' ? 10 : n.t === 's' ? 11 : 9) / gT.k;
        x.font = `${n.t === 'f' ? 400 : n.t === 'c' ? 500 : n.t === 'r' ? 700 : 600} ${fs}px ${n.t === 'p' || n.t === 'c' ? '"JetBrains Mono", monospace' : '"Instrument Sans", sans-serif'}`;
        x.fillStyle = C.bg; x.globalAlpha = .7; const w = x.measureText(n.label).width; x.fillRect(n.x - w / 2 - 2 / gT.k, n.y + n.r + 1 / gT.k, w + 4 / gT.k, fs + 3 / gT.k); x.globalAlpha = 1;
        x.fillStyle = n.t === 'p' || n.t === 'c' ? C.prov : n.t === 'f' ? C.mute : C.ink; x.fillText(n.label, n.x, n.y + n.r + 2 / gT.k);
    }
}

// ----- wiring -----
function select(id: string) { S.sel = id; S.tab = 'blocs'; renderRank(); el('rankbody').scrollTop = 0; document.querySelectorAll<HTMLElement>('.rk[data-id], .row[data-id]').forEach(e => e.setAttribute('aria-current', String(e.dataset['id'] === id))); drawGraph(); if (S.dir === 'atlas') void renderMap(); }
function setRegion(r: string) {
    if (r === '' && heavy(S.dir, '') && !heavy() && !confirm(HEAVY_WARNING)) return;
    S.region = r; S.province = ''; S.town = ''; S.sel = null;
    el<HTMLSelectElement>('region').value = r; el('provpill').hidden = true; store('dyn.region', r);
    refresh(true);
}
function setTown(t: string) { S.town = t; S.sel = null; if (t) S.tab = 'blocs'; renderRank(); if (S.dir === 'atlas') void renderMap(); }
function setProvince(p: string) {
    S.province = p; S.town = '';
    if (p) { const prov = PROV[p]; if (prov) { S.region = prov.region; el<HTMLSelectElement>('region').value = S.region; } }
    const pill = el('provpill'); pill.hidden = !p; pill.innerHTML = p ? `${title(p)} <button title="clear">×</button>` : '';
    pill.querySelector('button')?.addEventListener('click', () => setProvince(''));
    refresh(true);
}
/** Mirror the scope into the URL (replace, not push) so reloads and remounts keep it. */
const VIEW_PATHS = new Set(['/', '/dynasties', '/atlas', '/network', '/ledger']);
function syncUrl() {
    if (!VIEW_PATHS.has(location.pathname)) return;
    const q = S.province && INDEX ? `?province=${INDEX.regions.flatMap(r => r.provinces).find(p => p.name === S.province)?.slug ?? slug(S.province)}` : S.region && INDEX ? `?region=${INDEX.regions.find(r => r.name === S.region)?.slug ?? slug(S.region)}` : '';
    const path = S.dir === 'atlas' && (location.pathname === '/' || location.pathname === '/dynasties') ? location.pathname : `/${S.dir}`;
    const next = path + q;
    if (next !== location.pathname + location.search) history.replaceState(null, '', next);
}
function refresh(regraph: boolean) {
    syncUrl();
    renderRank(); renderTable();
    if (S.dir === 'atlas') void renderMap();
    if (S.dir === 'network') { ensureCanvas(); if (regraph || !sim) buildGraph(); else drawGraph(); }
    if (S.sel && !CLBY[S.sel]) { S.sel = null; renderRank(); }
}
function setDir(d: Dir) { S.dir = d; document.body.dataset['dir'] = d; if (VIEW_PATHS.has(location.pathname)) history.pushState(null, '', `/${d}` + location.search); document.querySelectorAll<HTMLButtonElement>('#review button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset['dir'] === d))); requestAnimationFrame(() => refresh(true)); }
function clearScope() { S.province = ''; S.town = ''; S.region = ''; el<HTMLSelectElement>('region').value = ''; el('provpill').hidden = true; }
const closestButton = (e: Event) => (e.target as HTMLElement).closest('button');
const onResize = () => { if (S.dir === 'atlas' && LM) LM.invalidateSize(); if (S.dir === 'network') drawGraph(); };

const MARKUP = `<div class="dyn">
<div class="dyn-toolbar">
  <nav id="review" aria-label="Views"><button data-dir="atlas">Atlas</button><button data-dir="network">Network</button><button data-dir="ledger">Ledger</button></nav>
  <div class="ctl"><label>Year</label><div class="seg" id="yearseg"></div></div>
  <div class="ctl"><label>Scope</label><select id="region"><option value="">Whole country</option></select><span id="provpill" class="pill" hidden></span></div>
  <div class="ctl"><label>Rule</label><div class="seg" id="minseg"><button data-min="2" aria-pressed="true">≥2 seats</button><button data-min="3">≥3</button><button data-min="5">≥5</button></div></div>
  <input id="q" type="search" placeholder="Filter surname…" autocomplete="off" aria-label="Filter surname">
</div>
<div class="dyn-main">
  <section class="panel" id="map"><div class="ph"><h2>Where dynasties hold seats</h2><small>color = share of seats in surname blocs · click a province for its towns</small></div><div class="body" style="padding:0"></div><div class="legend" id="maplegend"></div><div class="hint">click a province to focus</div></section>
  <section class="panel" id="graph"><div class="body" style="padding:0"></div><div class="legend"><div><i style="background:var(--ink)"></i>region · click to scope</div><div><i style="background:var(--sur)"></i>surname (size = seats)</div><div><i style="background:var(--sur);width:14px;height:0;border-top:1px dashed var(--sur);border-radius:0"></i>same surname, other province</div><div><i style="background:var(--ppl)"></i>official (surname)</div><div><i style="background:var(--amber)"></i>official (via middle name)</div><div><i style="background:var(--prov)"></i>province</div><div><i style="background:var(--prov);border-radius:0;opacity:.7"></i>city / municipality</div></div><div class="hint">drag · scroll to zoom · double-click to fit · click a region, province or surname</div></section>
  <section class="panel" id="rank"><div class="ph"><nav class="crumbs" id="crumbs" aria-label="Scope"></nav><small class="sp" id="rankmeta"></small></div><div class="seg ptabs" id="ptabs"><button type="button" data-tab="blocs" aria-pressed="true">Blocs</button><button type="button" data-tab="regions">Regions</button></div><div class="stats" id="stats"></div><div class="body" id="rankbody"></div></section>
  <section class="panel" id="table"><div class="ph"><h2>All blocs</h2><small class="sp" id="tablemeta"></small></div><div class="body" id="tablebody"></div></section>
</div>
<div class="dyn-foot"><span>A bloc = officials in one province who carry the surname as last name <em>or</em> middle name. Local posts only. Shared names may not mean kinship. <a href="/about">How this is built</a></span></div>
<div class="spin" id="spin" hidden>loading winners…</div>
</div>`;

const HEAVY_WARNING = 'This builds every surname bloc in the country at once. The atlas copes with one election, but the network graph, the ledger, and all nine elections together can freeze the tab on slower devices.\n\nContinue?';

export function mountDynasties(root: HTMLElement, dir: Dir = 'atlas'): () => void {
    root.innerHTML = MARKUP;
    S.dir = dir;
    document.body.dataset['dir'] = S.dir;
    const dyn = root.querySelector<HTMLElement>('.dyn')!;
    let alive = true;
    const rebuild = async () => {
        busy(`loading ${S.year === 'all' ? `${YEARS.length} elections` : S.year}…`);
        try { await ensureYears(yearsNeeded()); } catch (err) { busy('could not load election data — ' + (err instanceof Error ? err.message : String(err))); document.getElementById('spin')?.classList.add('err'); return; }
        if (!alive) return;
        busy(null); build(); S.limit = 150; refresh(true);
    };
    dyn.querySelector('#review')!.addEventListener('click', e => { const b = closestButton(e); const d = b?.dataset['dir']; if (!d || !DIRS.some(x => x === d)) return; if (heavy(d as Dir) && !heavy() && !confirm(HEAVY_WARNING)) return; setDir(d as Dir); });
    dyn.querySelector('#yearseg')!.addEventListener('click', e => {
        const b = closestButton(e); if (!b || !b.dataset['y']) return;
        if (heavy(S.dir, S.region, b.dataset['y']) && !heavy() && !confirm(HEAVY_WARNING)) return;
        S.year = b.dataset['y']; store('dyn.year', S.year);
        dyn.querySelectorAll<HTMLButtonElement>('#yearseg button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        void rebuild();
    });
    dyn.querySelector<HTMLSelectElement>('#region')!.addEventListener('change', e => {
        const sel = e.target as HTMLSelectElement;
        if (heavy(S.dir, sel.value) && !heavy() && !confirm(HEAVY_WARNING)) { sel.value = S.region; return; }
        S.region = sel.value; S.province = ''; el('provpill').hidden = true; store('dyn.region', S.region); refresh(true);
    });
    dyn.querySelector('#minseg')!.addEventListener('click', e => { const b = closestButton(e); if (!b || !b.dataset['min']) return; S.min = +b.dataset['min']; dyn.querySelectorAll<HTMLButtonElement>('#minseg button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); build(); S.limit = 150; refresh(true); });
    dyn.querySelector<HTMLInputElement>('#q')!.addEventListener('input', e => { S.q = (e.target as HTMLInputElement).value.trim().toUpperCase(); S.limit = 150; refresh(true); });
    dyn.querySelector('#rankbody')!.addEventListener('click', e => {
        const t = e.target as HTMLElement;
        const rg = t.closest<HTMLElement>('.rgn[data-region]'); if (rg) { const r = rg.dataset['region']!; setRegion(r === S.region && !S.province ? '' : r); return; }
        const pv = t.closest<HTMLElement>('.prv[data-province]'); if (pv) { S.tab = 'blocs'; setProvince(pv.dataset['province']!); return; }
        const b = t.closest<HTMLElement>('.rk, .chip'); const c = b?.dataset['id'] ? CLBY[b.dataset['id']] : undefined; if (!c) return; if (!inScope(c)) { clearScope(); refresh(true); } select(c.id);
    });
    dyn.querySelector('#ptabs')!.addEventListener('click', e => { const b = closestButton(e); const tab = b?.dataset['tab']; if (tab === 'blocs' || tab === 'regions') { S.tab = tab; renderRank(); el('rankbody').scrollTop = 0; } });
    dyn.querySelector('#crumbs')!.addEventListener('click', e => { const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-level]'); if (b) goLevel(b.dataset['level'] as Level); });
    dyn.querySelector('#tablebody')!.addEventListener('click', e => { const target = e.target as HTMLElement; const th = target.closest<HTMLElement>('th[data-k]'); if (th) { const k = th.dataset['k'] as SortKey; S.sort = S.sort.k === k ? { k, asc: !S.sort.asc } : { k, asc: k === 'sur' || k === 'prov' }; renderTable(); return; } if (target.closest('#more')) { S.limit += 150; renderTable(); return; } const tr = target.closest<HTMLElement>('tr.row'); if (tr?.dataset['id']) select(tr.dataset['id']); });
    window.addEventListener('resize', onResize);
    const onTheme = () => { if (!ALL.length) return; if (S.dir === 'atlas') { provLayer?.remove(); provLayer = null; regionLayer?.remove(); regionLayer = null; cityLayer?.remove(); cityLayer = null; cityLayerFor = ''; } refresh(false); };
    window.addEventListener('themechange', onTheme);
    (async () => {
        try {
            busy('loading…');
            if (!base) base = loadBase().catch(e => { base = null; throw e; });
            await base;
            if (!alive) return;
            const latest = YEARS[YEARS.length - 1]!;
            if (S.year !== 'all' && !YEARS.some(y => String(y) === S.year)) S.year = String(latest);
            // Deep links from province and person pages: /?province=abra or /?region=region-i
            const q = new URLSearchParams(location.search);
            const provSlug = q.get('province'), regSlug = q.get('region');
            let wantProvince = '';
            for (const r of INDEX!.regions) {
                if (regSlug && r.slug === regSlug) S.region = r.name;
                for (const p of r.provinces) if (provSlug && p.slug === provSlug) { S.region = r.name; wantProvince = p.name; }
            }
            const ys = el('yearseg');
            ys.innerHTML = YEARS.slice().reverse().map(y => `<button data-y="${y}">${y}</button>`).join('') + `<button data-y="all" title="Loads every election">All</button>`;
            ys.querySelectorAll<HTMLButtonElement>('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset['y'] === S.year)));
            const sel = el<HTMLSelectElement>('region');
            const regions = INDEX!.regions.map(r => r.name).sort();
            regions.forEach(r => { const o = document.createElement('option'); o.value = r; o.textContent = regionLabel(r); sel.appendChild(o); });
            if (S.region && !regions.includes(S.region)) S.region = '';
            sel.value = S.region;
            dyn.querySelectorAll<HTMLButtonElement>('#minseg button').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset['min']! === S.min)));
            dyn.querySelectorAll<HTMLButtonElement>('#review button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset['dir'] === S.dir)));
            busy(`loading ${S.year === 'all' ? `${YEARS.length} elections` : S.year}…`);
            await ensureYears(yearsNeeded());
            if (!alive) return;
            busy(null); build();
            if (wantProvince && PROV[wantProvince]) setProvince(wantProvince); else refresh(true);
        } catch (err) {
            busy('could not load election data — ' + (err instanceof Error ? err.message : String(err)));
            document.getElementById('spin')?.classList.add('err');
        }
    })();
    return () => {
        alive = false;
        window.removeEventListener('resize', onResize);
        window.removeEventListener('themechange', onTheme);
        LM?.remove(); LM = null; provLayer = null; regionLayer = null; cityLayer = null; labelLayer = null; cityLayerFor = ''; mapLastKey = null; mapToken++;
        sim?.stop(); sim = null; gCanvas = null; gCtx = null; gHover = null;
        delete document.body.dataset['dir'];
    };
}
