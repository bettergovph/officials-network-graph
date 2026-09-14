// Surname-bloc analysis (atlas / network / ledger). Mounted as a route; state survives remounts.
import 'leaflet/dist/leaflet.css';
import * as d3 from 'd3';
import * as L from 'leaflet';
import { fetchText, loadIndex } from '../data';
import { title, regionLabel, POSORDER, POSSHORT, slug, hrefPerson, el } from '../util';

interface Row { region: string; province: string; city: string; district: string; position: string; last_name: string; first_name: string; middle_name: string; title: string; party: string; votes: string; sex: string; person_id: string; year: string }
interface Person { key: string; first_name: string; middle_name: string; last_name: string; title: string; person_id: string; terms: Row[] }
type Via = 'surname' | 'middle';
interface Member extends Person { via: Via }
interface Cluster { id: string; sur: string; prov: string; region: string; n: number; nmid: number; members: Member[]; keys: Set<string>; terms: number; share: number; votes: number; parties: string[]; top: string; poverty: number | null; years: string[]; related: string[]; elsewhere: Cluster[] }
interface Province { name: string; region: string; sur: Record<string, Set<string>>; mid: Record<string, Set<string>>; people: Record<string, Person>; total: number; dyn: number; share: number; clusters: Cluster[]; poverty: number | null }
type Dir = 'atlas' | 'network' | 'ledger';
type SortKey = 'sur' | 'prov' | 'n' | 'nmid' | 'terms' | 'share' | 'votes' | 'top' | 'pov';
type NodeType = 'p' | 's' | 'f' | 'c';
type LinkType = 'ps' | 'sf' | 'fc' | 'pc' | 'ss';
interface GNode extends d3.SimulationNodeDatum { id: string; t: NodeType; label: string; r: number; x: number; y: number; prov?: string; c?: Cluster; via?: Via }
interface GLink extends d3.SimulationLinkDatum<GNode> { t: LinkType }

const CENT: Record<string, [number, number]> = { "ABRA": [17.6, 120.8], "AGUSAN DEL NORTE": [9.0, 125.5], "AGUSAN DEL SUR": [8.4, 125.9], "AKLAN": [11.7, 122.3], "ALBAY": [13.2, 123.6], "ANTIQUE": [11.2, 122.0], "APAYAO": [18.1, 121.1], "AURORA": [15.8, 121.6], "BASILAN": [6.5, 122.1], "BATAAN": [14.7, 120.4], "BATANES": [20.4, 121.9], "BATANGAS": [13.9, 121.1], "BENGUET": [16.5, 120.7], "BILIRAN": [11.6, 124.5], "BOHOL": [9.8, 124.2], "BUKIDNON": [8.0, 125.0], "BULACAN": [14.9, 120.9], "CAGAYAN": [18.0, 121.7], "CAMARINES NORTE": [14.2, 122.8], "CAMARINES SUR": [13.6, 123.3], "CAMIGUIN": [9.2, 124.7], "CAPIZ": [11.4, 122.7], "CATANDUANES": [13.8, 124.2], "CAVITE": [14.3, 120.9], "CEBU": [10.3, 123.9], "COTABATO": [7.2, 124.8], "DAVAO DE ORO": [7.7, 126.1], "DAVAO DEL NORTE": [7.6, 125.7], "DAVAO DEL SUR": [6.9, 125.4], "DAVAO OCCIDENTAL": [6.3, 125.6], "DAVAO ORIENTAL": [7.1, 126.4], "DINAGAT ISLANDS": [10.1, 125.6], "EASTERN SAMAR": [11.6, 125.4], "GUIMARAS": [10.6, 122.6], "IFUGAO": [16.8, 121.2], "ILOCOS NORTE": [18.2, 120.7], "ILOCOS SUR": [17.3, 120.5], "ILOILO": [11.0, 122.6], "ISABELA": [17.0, 121.9], "KALINGA": [17.4, 121.4], "LA UNION": [16.6, 120.4], "LAGUNA": [14.2, 121.3], "LANAO DEL NORTE": [8.0, 123.9], "LANAO DEL SUR": [7.8, 124.3], "LEYTE": [11.0, 124.8], "MAGUINDANAO": [7.0, 124.4], "MAGUINDANAO DEL NORTE": [7.2, 124.3], "MAGUINDANAO DEL SUR": [6.8, 124.5], "MARINDUQUE": [13.4, 122.0], "MASBATE": [12.3, 123.6], "MISAMIS OCCIDENTAL": [8.4, 123.7], "MISAMIS ORIENTAL": [8.7, 125.0], "MOUNTAIN PROVINCE": [17.1, 121.1], "NEGROS OCCIDENTAL": [10.4, 123.0], "NEGROS ORIENTAL": [9.6, 123.0], "NORTHERN SAMAR": [12.4, 124.7], "NUEVA ECIJA": [15.6, 121.0], "NUEVA VIZCAYA": [16.3, 121.1], "OCCIDENTAL MINDORO": [12.9, 120.9], "ORIENTAL MINDORO": [13.0, 121.4], "PALAWAN": [9.8, 118.7], "PAMPANGA": [15.1, 120.6], "PANGASINAN": [15.9, 120.3], "QUEZON": [14.0, 122.1], "QUIRINO": [16.3, 121.6], "RIZAL": [14.6, 121.2], "ROMBLON": [12.6, 122.3], "SAMAR": [12.0, 125.0], "SARANGANI": [5.9, 125.1], "SHARIFF KABUNSUAN": [7.2, 124.2], "SIQUIJOR": [9.2, 123.6], "SORSOGON": [12.9, 124.0], "SOUTH COTABATO": [6.3, 124.8], "SOUTHERN LEYTE": [10.3, 125.1], "SULTAN KUDARAT": [6.5, 124.4], "SULU": [6.0, 121.0], "SURIGAO DEL NORTE": [9.7, 125.5], "SURIGAO DEL SUR": [8.7, 126.1], "TARLAC": [15.5, 120.6], "TAWI TAWI": [5.1, 120.0], "ZAMBALES": [15.4, 120.1], "ZAMBOANGA DEL NORTE": [8.4, 123.0], "ZAMBOANGA DEL SUR": [7.8, 123.3], "ZAMBOANGA SIBUGAY": [7.6, 122.6], "NCR FIRST DISTRICT": [14.59, 120.98], "NCR SECOND DISTRICT": [14.68, 121.05], "NCR THIRD DISTRICT": [14.66, 120.96], "NCR FOURTH DISTRICT": [14.5, 121.04], "SPECIAL GEOGRAPHIC AREA": [7.05, 124.6] };
const POVALIAS: Record<string, string> = { "TAWI TAWI": "TAWI-TAWI", "MAGUINDANAO DEL SUR": "MAGUINDANAO", "MAGUINDANAO DEL NORTE": "MAGUINDANAO", "DAVAO DE ORO": "COMPOSTELA VALLEY", "NCR FIRST DISTRICT": "NCR, CITY OF MANILA, FIRST DISTRICT", "NCR SECOND DISTRICT": "NCR, SECOND DISTRICT", "NCR THIRD DISTRICT": "NCR, THIRD DISTRICT", "NCR FOURTH DISTRICT": "NCR, FOURTH DISTRICT" };
const EXCLUDED = new Set(['SENATOR', 'PRESIDENT', 'VICE PRESIDENT']);

const fmt = d3.format(','), pct = d3.format('.0%'), pct1 = d3.format('.1%');
const posIdx = (p: string) => { const i = POSORDER.indexOf(p); return i < 0 ? POSORDER.length : i; };
const stored = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const store = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
const DIRS: Dir[] = ['atlas', 'network', 'ledger'];

const S = { dir: (DIRS.find(d => d === stored('dyn.dir')) ?? 'atlas') as Dir, year: stored('dyn.year') ?? 'all', region: stored('dyn.region') ?? '', province: '', min: 2, q: '', sel: null as string | null, sort: { k: 'n' as SortKey, asc: false }, limit: 150 };
let YEARS: number[] = [];
let ALL: Row[] = [], ROWS: Row[] = [];
let POV: Record<string, number> = {};
let PROV: Record<string, Province> = {};
let CL: Cluster[] = [], CLBY: Record<string, Cluster> = {};
let loaded: Promise<void> | null = null;

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

async function loadData() {
    const index = await loadIndex();
    YEARS = index.years;
    const [csvs, pov] = await Promise.all([Promise.all(YEARS.map(y => fetchText(`/data/winners/${y}.csv.gz`))), fetch('/poverty.json').then(r => r.json() as Promise<{ provinces: { province: string; poverty: number }[] }[]>)]);
    ALL = csvs.flatMap((t, i) => parseCSV(t).map(o => ({ region: o['region'] ?? '', province: o['province'] ?? '', city: o['city'] ?? '', district: o['district'] ?? '', position: o['position'] ?? '', last_name: o['last_name'] ?? '', first_name: o['first_name'] ?? '', middle_name: o['middle_name'] ?? '', title: o['title'] ?? '', party: o['party'] ?? '', votes: o['votes'] ?? '', sex: o['sex'] ?? '', person_id: o['person_id'] ?? '', year: String(YEARS[i]) })))
        .filter(r => r.region && r.province && !EXCLUDED.has(r.position));
    for (const reg of pov) for (const p of reg.provinces) POV[p.province] = p.poverty;
}

function build() {
    ROWS = S.year === 'all' ? ALL : ALL.filter(r => r.year === S.year);
    PROV = {}; CL = []; CLBY = {};
    for (const r of ROWS) {
        let p = PROV[r.province];
        if (!p) p = PROV[r.province] = { name: r.province, region: r.region, sur: {}, mid: {}, people: {}, total: 0, dyn: 0, share: 0, clusters: [], poverty: null };
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
        p.dyn = covered.size; p.share = p.total ? p.dyn / p.total : 0; p.clusters.sort((a, b) => b.n - a.n);
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

function renderRank() {
    const list = scoped();
    const provs = Object.values(PROV).filter(p => (!S.region || p.region === S.region) && (!S.province || p.name === S.province));
    const seats = d3.sum(provs, p => p.total), dyn = d3.sum(provs, p => p.dyn);
    const first = list[0];
    el('stats').innerHTML = `<div class="stat"><b>${fmt(list.length)}</b><span>surname blocs</span></div><div class="stat"><b>${seats ? pct(dyn / seats) : '–'}</b><span>of ${fmt(seats)} ${unit()}</span></div><div class="stat"><b>${first ? first.n : '–'}</b><span>largest bloc${first ? ' · ' + title(first.sur) : ''}</span></div>`;
    el('rankmeta').textContent = scopeLabel();
    const max = first ? first.n : 1;
    el('rankbody').innerHTML = list.slice(0, 60).map((c, i) => `<button class="rk" data-id="${c.id}" aria-current="${S.sel === c.id}"><i>${i + 1}</i><div class="nm">${title(c.sur)}<small>${title(c.prov)}${S.region ? '' : ' · ' + regionLabel(c.region)}</small></div><div class="n">${c.n}<small> ${perUnit()}${c.nmid ? ` <span style="color:var(--amber)">+${c.nmid}m</span>` : ''}</small></div><div class="bar"><i style="width:${c.n / max * 100}%"></i></div></button>`).join('') || `<div class="empty">No surname holds ${S.min}+ seats here.</div>`;
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

function renderDetail() {
    const host = el('detailbody');
    const c = S.sel ? CLBY[S.sel] : undefined;
    if (!c) { host.innerHTML = `<div class="empty"><b>Pick a surname</b>Click a bloc in the list, table, map or graph to see every elected official who carries it, the posts they hold, and related surnames.</div>`; return; }
    const p = PROV[c.prov]!;
    const all = S.year === 'all';
    const posCounts = d3.rollup(c.members, v => v.length, m => topPosition(m));
    const posKeys = POSORDER.filter(k => posCounts.get(k));
    const nm = (r: Person) => { const label = `${title(r.first_name)}${r.middle_name ? ' <span style="color:var(--mute);font-weight:400">' + title(r.middle_name) + '</span>' : ''} ${title(r.last_name)}`; const href = personHref(latest(r)); return (href ? `<a href="${href}">${label}</a>` : label) + (r.title ? ' <small style="color:var(--faint)">' + r.title + '</small>' : ''); };
    host.innerHTML = `<div class="dhead"><div class="kicker"><span>${title(c.prov)} · ${regionLabel(c.region)}</span>${c.poverty != null ? `<span style="margin-left:auto">poverty ${c.poverty}%</span>` : ''}</div><h3>${title(c.sur)}<em>${c.n} ${perUnit()}</em></h3>
  <div class="facts"><div><b>${pct1(c.share)}</b><span>of ${p.total} ${unit()} in province</span></div><div><b style="color:${c.nmid ? 'var(--amber)' : 'inherit'}">${c.nmid}</b><span>via middle name</span></div>${all ? `<div><b>${c.terms}</b><span>terms ${c.years.join(', ')}</span></div>` : ''}<div><b>${fmt(c.votes)}</b><span>votes, latest term</span></div><div><b>${c.parties.length}</b><span>${c.parties.length === 1 ? 'party' : 'parties'}</span></div></div>
  <div class="pos">${posKeys.map(k => `<i style="flex:${posCounts.get(k)};opacity:${1 - POSORDER.indexOf(k) * .1}" title="${k}"></i>`).join('')}</div><div class="poslbl">${posKeys.map(k => `<span>${posCounts.get(k)} ${POSSHORT[k] ?? k}</span>`).join('')}</div></div>
  <div class="body tree" style="padding-top:0"><h4>Officials</h4>${c.members.map(m => `<div class="person" data-via="${m.via}"><div class="who">${nm(m)}${m.via === 'middle' ? ' <span class="via">via middle name</span>' : ''}</div><div class="v">${latest(m).votes ? fmt(+latest(m).votes) : '–'}<small>${latest(m).party || '—'}</small></div>${m.terms.map(r => `<div class="what">${all ? `<span class="yr">${r.year}</span> ` : ''}<b>${title(r.position)}</b>${r.city ? ' · ' + title(r.city) : ''}${r.district ? ' · ' + title(r.district) + ' dist.' : ''}</div>`).join('')}</div>`).join('')}
  ${c.related.length ? `<h4>Linked surnames <span style="text-transform:none;letter-spacing:0">(share an official, same province)</span></h4><div class="chips">${c.related.map(s => `<button class="chip" data-id="${c.prov + '|' + s}">${title(s)}<small>${CLBY[c.prov + '|' + s]?.n ?? ''}</small></button>`).join('')}</div>` : ''}
  ${c.elsewhere.length ? `<h4>Same surname elsewhere</h4><div class="chips">${c.elsewhere.slice(0, 12).map(o => `<button class="chip" data-id="${o.id}">${title(o.prov)}<small>${o.n}</small></button>`).join('')}</div>` : ''}</div>`;
}

// ----- map -----
let LM: L.Map | null = null, lmLayer: L.LayerGroup | null = null, mapLastKey: string | null = null;
const cssVar = (n: string) => getComputedStyle(document.body).getPropertyValue(n).trim();
function renderMap() {
    const host = document.querySelector<HTMLElement>('#map .body');
    if (!host || !host.clientWidth || !host.clientHeight) return;
    if (!LM) {
        LM = L.map(host, { center: [12.2, 122.5], zoom: 6, minZoom: 5, maxZoom: 12, zoomControl: true, attributionControl: true, zoomSnap: .5 });
        LM.attributionControl.setPrefix(false);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', subdomains: 'abc' }).addTo(LM);
        lmLayer = L.layerGroup().addTo(LM);
        LM.on('click', () => { if (S.province) setProvince(''); });
    }
    const map = LM, layer = lmLayer!;
    map.invalidateSize();
    const provs = Object.values(PROV).flatMap(p => { const ll = CENT[p.name]; return ll ? [{ p, ll }] : []; });
    const col = (t: number) => d3.interpolateRgb(cssVar('--sur2'), cssVar('--sur'))(t);
    const maxShare = d3.max(provs, d => d.p.share) || .5;
    const r = d3.scaleSqrt().domain([0, d3.max(provs, d => d.p.dyn) || 1]).range([2000, 42000]);
    const inReg = (p: Province) => !S.region || p.region === S.region;
    const topN = new Set(provs.filter(d => inReg(d.p)).sort((a, b) => b.p.dyn - a.p.dyn).slice(0, S.region ? 14 : 10).map(d => d.p.name));
    layer.clearLayers();
    for (const { p, ll } of provs) {
        const sel = p.name === S.province;
        const circle = L.circle(ll, { radius: r(p.dyn), color: sel ? cssVar('--ink') : 'rgba(0,0,0,.4)', weight: sel ? 2 : 1, fillColor: col(p.share / maxShare), fillOpacity: inReg(p) ? .75 : .12, opacity: inReg(p) ? 1 : .2, className: 'bub' });
        circle.bindTooltip(`<b>${title(p.name)}</b><br>${p.dyn} of ${p.total} ${unit()} (${pct(p.share)}) in ${p.clusters.length} surname blocs`, { direction: 'top', sticky: true });
        circle.on('click', e => { L.DomEvent.stop(e); setProvince(sel ? '' : p.name); });
        layer.addLayer(circle);
        if (inReg(p) && (sel || topN.has(p.name))) layer.addLayer(L.marker(ll, { interactive: false, icon: L.divIcon({ className: '', html: `<div class="mlbl" style="margin-top:-6px">${title(p.name)}</div>`, iconSize: [0, 0] }) }));
    }
    const key = S.province || S.region;
    if (key !== mapLastKey) {
        mapLastKey = key;
        const selLL = S.province ? CENT[S.province] : undefined;
        if (selLL) map.flyTo(selLL, 8.5, { duration: .6 });
        else if (S.region) { const pts = provs.filter(d => inReg(d.p)).map(d => d.ll); if (pts.length) map.flyToBounds(L.latLngBounds(pts).pad(.35), { duration: .6, maxZoom: 8 }); }
        else map.flyTo([12.2, 122.5], 6, { duration: .6 });
    }
    el('maplegend').innerHTML = `<div><i style="background:${col(1)}"></i>high share of ${unit()} in surname blocs</div><div><i style="background:${col(0)}"></i>low share</div>`;
}

// ----- network -----
let sim: d3.Simulation<GNode, GLink> | null = null, gCanvas: HTMLCanvasElement | null = null, gCtx: CanvasRenderingContext2D | null = null;
let gT: d3.ZoomTransform = d3.zoomIdentity, gNodes: GNode[] = [], gLinks: GLink[] = [], gHover: GNode | null = null;
function buildGraph() {
    const list = scoped(); const wide = !S.region && !S.province;
    const clusters = wide ? list.filter(c => c.n >= Math.max(S.min, 4)) : list;
    const nodes: GNode[] = [], links: GLink[] = [];
    const pid: Record<string, GNode> = {}, cid: Record<string, GNode> = {}, sid: Record<string, GNode[]> = {};
    for (const c of clusters) {
        let pn = pid[c.prov];
        if (!pn) { pn = pid[c.prov] = { id: 'p|' + c.prov, t: 'p', label: title(c.prov), r: wide ? 4 : 7, prov: c.prov, x: 0, y: 0 }; nodes.push(pn); }
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
    const dist: Record<LinkType, number> = { ps: wide ? 30 : 60, sf: 10, fc: 22, pc: wide ? 0 : 90, ss: wide ? 60 : 120 };
    const str: Record<LinkType, number> = { ps: .4, sf: .9, fc: .35, pc: .15, ss: .12 };
    const charge: Record<NodeType, number> = { p: -260, s: -40, c: -50, f: -6 };
    sim = d3.forceSimulation<GNode>(nodes).force('link', d3.forceLink<GNode, GLink>(links).id(d => d.id).distance(l => dist[l.t]).strength(l => str[l.t])).force('charge', d3.forceManyBody<GNode>().strength(d => charge[d.t])).force('collide', d3.forceCollide<GNode>(d => d.r + 2)).force('center', d3.forceCenter(0, 0)).force('x', d3.forceX<GNode>().strength(.03)).force('y', d3.forceY<GNode>().strength(.03)).alphaDecay(.03).on('tick', drawGraph);
}
function ensureCanvas() {
    if (gCanvas) return;
    const host = document.querySelector<HTMLElement>('#graph .body'); if (!host) return;
    const canvas = document.createElement('canvas'); host.appendChild(canvas); gCanvas = canvas; gCtx = canvas.getContext('2d');
    d3.select(canvas).call(d3.zoom<HTMLCanvasElement, unknown>().scaleExtent([.15, 8]).on('zoom', e => { gT = e.transform; drawGraph(); })).on('dblclick.zoom', null);
    canvas.addEventListener('mousemove', e => { const n = pick(e); if (n !== gHover) { gHover = n; canvas.style.cursor = n && n.t !== 'f' && n.t !== 'c' ? 'pointer' : 'default'; drawGraph(); } });
    canvas.addEventListener('click', e => { const n = pick(e); if (!n) return; if (n.t === 's' && n.c) select(n.c.id); else if (n.t === 'p' && n.prov !== undefined) setProvince(n.prov === S.province ? '' : n.prov); });
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
        else { x.setLineDash([]); x.lineWidth = .6 / gT.k; x.strokeStyle = l.t === 'ps' || l.t === 'pc' ? C.prov : l.t === 'fc' ? C.mute : C.ppl; x.globalAlpha = l.t === 'ps' ? .35 : l.t === 'pc' ? .15 : l.t === 'fc' ? .3 : .45; }
        x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke();
    }
    x.setLineDash([]); x.globalAlpha = 1;
    for (const n of gNodes) {
        x.fillStyle = n.t === 's' ? C.sur : n.t === 'p' || n.t === 'c' ? C.prov : n.via === 'middle' ? C.amber : C.ppl;
        x.beginPath(); if (n.t === 'c') { x.globalAlpha = .7; x.rect(n.x - n.r, n.y - n.r, n.r * 2, n.r * 2); } else x.arc(n.x, n.y, n.r, 0, 7);
        x.fill(); x.globalAlpha = 1; if (hl(n)) { x.strokeStyle = C.ink; x.lineWidth = 2 / gT.k; x.stroke(); }
    }
    x.textAlign = 'center'; x.textBaseline = 'top';
    for (const n of gNodes) {
        const show = n.t === 'p' || (n.t === 's' && (n.r * gT.k > 9 || hl(n))) || (n.t === 'f' && gT.k > 3.2) || (n.t === 'c' && (gT.k > 1.6 || hl(n)));
        if (!show) continue;
        const fs = (n.t === 'p' ? 10 : n.t === 's' ? 11 : 9) / gT.k;
        x.font = `${n.t === 'f' ? 400 : n.t === 'c' ? 500 : 600} ${fs}px ${n.t === 'p' || n.t === 'c' ? '"JetBrains Mono", monospace' : '"Instrument Sans", sans-serif'}`;
        x.fillStyle = C.bg; x.globalAlpha = .7; const w = x.measureText(n.label).width; x.fillRect(n.x - w / 2 - 2 / gT.k, n.y + n.r + 1 / gT.k, w + 4 / gT.k, fs + 3 / gT.k); x.globalAlpha = 1;
        x.fillStyle = n.t === 'p' || n.t === 'c' ? C.prov : n.t === 'f' ? C.mute : C.ink; x.fillText(n.label, n.x, n.y + n.r + 2 / gT.k);
    }
}

// ----- wiring -----
function select(id: string) { S.sel = id; renderDetail(); document.querySelectorAll<HTMLElement>('.rk[data-id], .row[data-id]').forEach(e => e.setAttribute('aria-current', String(e.dataset['id'] === id))); drawGraph(); }
function setProvince(p: string) {
    S.province = p;
    if (p) { const prov = PROV[p]; if (prov) { S.region = prov.region; el<HTMLSelectElement>('region').value = S.region; } }
    const pill = el('provpill'); pill.hidden = !p; pill.innerHTML = p ? `${title(p)} <button title="clear">×</button>` : '';
    pill.querySelector('button')?.addEventListener('click', () => setProvince(''));
    refresh(true);
}
function refresh(regraph: boolean) {
    renderRank(); renderTable();
    if (S.dir === 'atlas') renderMap();
    if (S.dir === 'network') { ensureCanvas(); if (regraph || !sim) buildGraph(); else drawGraph(); }
    if (S.sel && !CLBY[S.sel]) S.sel = null;
    renderDetail();
}
function setDir(d: Dir) { S.dir = d; document.body.dataset['dir'] = d; store('dyn.dir', d); document.querySelectorAll<HTMLButtonElement>('#review button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset['dir'] === d))); requestAnimationFrame(() => refresh(true)); }
function clearScope() { S.province = ''; S.region = ''; el<HTMLSelectElement>('region').value = ''; el('provpill').hidden = true; }
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
  <section class="panel" id="map"><div class="ph"><h2>Where dynasties hold seats</h2><small>bubble = dynasty seats · color = share of province</small></div><div class="body" style="padding:0"></div><div class="legend" id="maplegend"></div><div class="hint">click a province to focus</div></section>
  <section class="panel" id="graph"><div class="body" style="padding:0"></div><div class="legend"><div><i style="background:var(--sur)"></i>surname (size = seats)</div><div><i style="background:var(--sur);width:14px;height:0;border-top:1px dashed var(--sur);border-radius:0"></i>same surname, other province</div><div><i style="background:var(--ppl)"></i>official (surname)</div><div><i style="background:var(--amber)"></i>official (via middle name)</div><div><i style="background:var(--prov)"></i>province</div><div><i style="background:var(--prov);border-radius:0;opacity:.7"></i>city / municipality</div></div><div class="hint">drag · scroll to zoom · click surname</div></section>
  <section class="panel" id="rank"><div class="ph"><h2>Largest surname blocs</h2><small class="sp" id="rankmeta"></small></div><div class="stats" id="stats"></div><div class="body" id="rankbody"></div></section>
  <section class="panel" id="table"><div class="ph"><h2>All blocs</h2><small class="sp" id="tablemeta"></small></div><div class="body" id="tablebody"></div></section>
  <section class="panel" id="detail"><div id="detailbody" style="display:flex;flex-direction:column;min-height:0;height:100%"></div></section>
</div>
<div class="dyn-foot"><span>A bloc = officials in one province who carry the surname as last name <em>or</em> middle name. Local posts only. Shared names may not mean kinship.</span></div>
<div class="spin" id="spin">loading winners…</div>
</div>`;

export function mountDynasties(root: HTMLElement): () => void {
    root.innerHTML = MARKUP;
    document.body.dataset['dir'] = S.dir;
    const dyn = root.querySelector<HTMLElement>('.dyn')!;
    dyn.querySelector('#review')!.addEventListener('click', e => { const b = closestButton(e); const d = b?.dataset['dir']; if (d && DIRS.some(x => x === d)) setDir(d as Dir); });
    dyn.querySelector('#yearseg')!.addEventListener('click', e => { const b = closestButton(e); if (!b || !b.dataset['y']) return; S.year = b.dataset['y']; store('dyn.year', S.year); dyn.querySelectorAll<HTMLButtonElement>('#yearseg button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); build(); S.limit = 150; refresh(true); });
    dyn.querySelector<HTMLSelectElement>('#region')!.addEventListener('change', e => { S.region = (e.target as HTMLSelectElement).value; S.province = ''; el('provpill').hidden = true; store('dyn.region', S.region); refresh(true); });
    dyn.querySelector('#minseg')!.addEventListener('click', e => { const b = closestButton(e); if (!b || !b.dataset['min']) return; S.min = +b.dataset['min']; dyn.querySelectorAll<HTMLButtonElement>('#minseg button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); build(); S.limit = 150; refresh(true); });
    dyn.querySelector<HTMLInputElement>('#q')!.addEventListener('input', e => { S.q = (e.target as HTMLInputElement).value.trim().toUpperCase(); S.limit = 150; refresh(true); });
    dyn.querySelector('#rankbody')!.addEventListener('click', e => { const b = (e.target as HTMLElement).closest<HTMLElement>('.rk'); if (b?.dataset['id']) select(b.dataset['id']); });
    dyn.querySelector('#detailbody')!.addEventListener('click', e => { const b = (e.target as HTMLElement).closest<HTMLElement>('.chip'); const c = b?.dataset['id'] ? CLBY[b.dataset['id']] : undefined; if (!c) return; if (!inScope(c)) { clearScope(); refresh(true); } select(c.id); });
    dyn.querySelector('#tablebody')!.addEventListener('click', e => { const target = e.target as HTMLElement; const th = target.closest<HTMLElement>('th[data-k]'); if (th) { const k = th.dataset['k'] as SortKey; S.sort = S.sort.k === k ? { k, asc: !S.sort.asc } : { k, asc: k === 'sur' || k === 'prov' }; renderTable(); return; } if (target.closest('#more')) { S.limit += 150; renderTable(); return; } const tr = target.closest<HTMLElement>('tr.row'); if (tr?.dataset['id']) select(tr.dataset['id']); });
    window.addEventListener('resize', onResize);
    let alive = true;
    (async () => {
        try {
            if (!loaded) loaded = loadData().catch(e => { loaded = null; throw e; });
            await loaded;
            if (!alive) return;
            const ys = el('yearseg');
            ys.innerHTML = YEARS.slice().reverse().map(y => `<button data-y="${y}">${y}</button>`).join('') + `<button data-y="all">All</button>`;
            if (S.year !== 'all' && !YEARS.some(y => String(y) === S.year)) S.year = 'all';
            ys.querySelectorAll<HTMLButtonElement>('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset['y'] === S.year)));
            const sel = el<HTMLSelectElement>('region');
            const regions = [...new Set(ALL.map(r => r.region))].sort();
            regions.forEach(r => { const o = document.createElement('option'); o.value = r; o.textContent = regionLabel(r); sel.appendChild(o); });
            if (!regions.includes(S.region)) S.region = '';
            sel.value = S.region;
            dyn.querySelectorAll<HTMLButtonElement>('#minseg button').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset['min']! === S.min)));
            build();
            el('spin').remove();
            dyn.querySelectorAll<HTMLButtonElement>('#review button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset['dir'] === S.dir)));
            refresh(true);
        } catch (err) {
            const spin = document.getElementById('spin'); if (spin) { spin.classList.add('err'); spin.textContent = 'could not load election data — ' + (err instanceof Error ? err.message : String(err)); }
        }
    })();
    return () => {
        alive = false;
        window.removeEventListener('resize', onResize);
        LM?.remove(); LM = null; lmLayer = null; mapLastKey = null;
        sim?.stop(); sim = null; gCanvas = null; gCtx = null; gHover = null;
        delete document.body.dataset['dir'];
    };
}
