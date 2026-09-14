import { loadIndex, loadProvince, loadNational, findProvince, type IndexData, type PlaceProvince, type Contest } from '../data';
import { esc, fmt, pct, title, regionLabel, hrefProvince, hrefTown, hrefRegion, hrefPerson, yearTabs, posLabel, personName, POSORDER } from '../util';
import { crumbs, loading, failed, contestCard, sortContests, winnersOf, slugOf } from './shared';

const provinceCard = (p: PlaceProvince, year: number) => {
    const y = p.years[String(year)];
    return `<a class="tile" href="${hrefProvince(p.slug)}"><b>${esc(title(p.name))}</b><span class="mono">${p.cities.length} towns · ${fmt(y?.seats ?? p.seats)} seats${p.poverty != null ? ` · poverty ${p.poverty}%` : ''}</span></a>`;
};

export async function home(root: HTMLElement) {
    loading(root);
    try {
        const index = await loadIndex();
        const latest = index.years[index.years.length - 1]!;
        const nat = await loadNational(latest).catch(() => null);
        const senators = nat?.races['SENATOR']?.filter(r => r[4]).slice(0, 12) ?? [];
        const pres = nat?.races['PRESIDENT']?.[0], vp = nat?.races['VICE PRESIDENT']?.[0];
        root.innerHTML = `<div class="page">
  <section class="hero"><div class="kicker">Philippines · ${index.years[0]}–${latest}</div><h1>The political map</h1>
    <p>Every candidate for local office since ${index.years[0]}, who won, who lost, and who keeps coming back. Browse by region, province and town, or look up a name.</p>
    <div class="stats wide"><div class="stat"><b>${fmt(index.totals.persons)}</b><span>people</span></div><div class="stat"><b>${fmt(index.totals.candidacies)}</b><span>candidacies</span></div><div class="stat"><b>${fmt(index.totals.contests)}</b><span>contests</span></div><div class="stat"><b>${fmt(index.totals.repeat)}</b><span>ran more than once</span></div><div class="stat"><b>${fmt(index.totals.cities)}</b><span>cities &amp; towns</span></div><div class="stat"><b>${index.years.length}</b><span>elections</span></div></div>
    <div class="actions"><a class="btn" href="/search">Search a politician</a><a class="btn ghost" href="/dynasties">Surname blocs</a><a class="btn ghost" href="/people">Repeat politicians</a><a class="btn ghost" href="/national/${latest}">National results</a></div></section>
  ${nat ? `<section><div class="sec-h"><h2>${latest} national results</h2><a class="more-link" href="/national/${latest}">all races</a></div><div class="grid3">
    ${pres ? `<div class="card pad"><div class="kicker">President</div><b class="big">${esc(title(pres[0]))}</b><span class="mono mute">${esc(pres[1])} · ${fmt(pres[2])} votes</span></div>` : ''}
    ${vp ? `<div class="card pad"><div class="kicker">Vice President</div><b class="big">${esc(title(vp[0]))}</b><span class="mono mute">${esc(vp[1])} · ${fmt(vp[2])} votes</span></div>` : ''}
    <div class="card pad${pres || vp ? '' : ' span'}"><div class="kicker">Senators elected</div><ol class="plain${pres || vp ? '' : ' cols3'}">${senators.map(s => `<li>${esc(title(s[0]))} <span class="mono mute">${esc(s[1])}</span></li>`).join('')}</ol></div></div></section>` : ''}
  <section><div class="sec-h"><h2>Regions and provinces</h2><span class="mono mute">seats in ${latest}</span></div>
    ${index.regions.map(r => `<div class="region-block"><h3><a href="${hrefRegion(r.slug)}">${esc(regionLabel(r.name))}</a> <small class="mono mute">${r.provinces.length} provinces</small></h3><div class="tiles">${r.provinces.map(p => provinceCard(p, latest)).join('')}</div></div>`).join('')}</section>
  <section><div class="sec-h"><h2>Most elected</h2><a class="more-link" href="/people">full list</a></div><div class="grid3">${index.top.wins.slice(0, 9).map(t => `<a class="card pad person-card" href="${hrefPerson(t[5], t[0])}"><b>${esc(personName(t[1], t[2], '', t[4]))}</b><span class="mono mute">${t[7]} wins in ${t[6]} runs · ${t[8]}–${t[9]}</span><span class="mute">${esc(posLabel(t[10]))} · ${esc(title(provinceName(index, t[5])))}</span></a>`).join('')}</div></section>
</div>`;
    } catch (e) { failed(root, e); }
}

const provinceName = (index: IndexData, slug: string) => { for (const r of index.regions) for (const p of r.provinces) if (p.slug === slug) return p.name; return slug; };

export async function region(root: HTMLElement, slug: string) {
    loading(root);
    try {
        const index = await loadIndex();
        const r = index.regions.find(x => x.slug === slug);
        if (!r) { failed(root, 'No such region'); return; }
        const latest = index.years[index.years.length - 1]!;
        root.innerHTML = `<div class="page">${crumbs([{ label: 'Philippines', href: '/' }, { label: regionLabel(r.name) }])}
  <h1>${esc(regionLabel(r.name))}</h1>
  <table class="list"><thead><tr><th>Province</th><th class="num">Towns</th><th class="num">Seats ${latest}</th><th class="num">Candidates ${latest}</th><th class="num">People since ${index.years[0]}</th><th class="num">Poverty</th></tr></thead><tbody>
  ${r.provinces.map(p => `<tr><td><a href="${hrefProvince(p.slug)}"><b>${esc(title(p.name))}</b></a></td><td class="num">${p.cities.length}</td><td class="num">${fmt(p.years[String(latest)]?.seats)}</td><td class="num">${fmt(p.years[String(latest)]?.candidacies)}</td><td class="num">${fmt(p.persons)}</td><td class="num">${p.poverty != null ? p.poverty + '%' : '–'}</td></tr>`).join('')}</tbody></table></div>`;
    } catch (e) { failed(root, e); }
}

function pickYear(years: number[], q: URLSearchParams): number {
    const y = Number(q.get('year'));
    return years.includes(y) ? y : years[years.length - 1]!;
}

export async function province(root: HTMLElement, slug: string, q: URLSearchParams) {
    loading(root);
    try {
        const [index, shard] = await Promise.all([loadIndex(), loadProvince(slug)]);
        const found = findProvince(index, slug);
        if (!found) { failed(root, 'No such province'); return; }
        const years = [...new Set(shard.contests.map(k => k.year))].sort();
        const year = pickYear(years, q);
        const ks = shard.contests.filter(k => k.year === year);
        const provLevel = ks.filter(k => !k.city).sort(sortContests);
        const byCity = new Map<string, Contest[]>();
        for (const k of ks) if (k.city) (byCity.get(k.city) ?? byCity.set(k.city, []).get(k.city)!).push(k);
        const winner = (list: Contest[] | undefined, pos: string) => { const k = list?.find(x => x.position === pos); return k ? winnersOf(k, shard, slug) : '<span class="mute">—</span>'; };
        const top = Object.entries(shard.persons).filter(([, p]) => !p[7]).sort((a, b) => b[1][6] - a[1][6] || b[1][5] - a[1][5]).slice(0, 12);
        const nat = shard.national[String(year)];
        const senators = nat?.['SENATOR']?.slice(0, 12) ?? [];
        root.innerHTML = `<div class="page">${crumbs([{ label: 'Philippines', href: '/' }, { label: regionLabel(shard.region), href: hrefRegion(index.regions.find(r => r.name === shard.region)?.slug ?? '') }, { label: title(shard.name) }])}
  <div class="page-h"><div><h1>${esc(title(shard.name))}</h1><div class="mono mute">${esc(regionLabel(shard.region))} · ${found.province.cities.length} cities and towns${shard.poverty != null ? ` · poverty incidence ${shard.poverty}%` : ''} · ${fmt(found.province.persons)} people have run here since ${years[0]}</div></div>${yearTabs(years, year, y => hrefProvince(slug, y))}</div>
  <div class="cols">
    <div class="main">
      <h2>Province-wide races, ${year}</h2>
      ${provLevel.length ? provLevel.map(k => contestCard(k, shard, slug)).join('') : '<div class="empty">No province-wide race in this year\'s data.</div>'}
      <h2>Cities and towns, ${year}</h2>
      <table class="list"><thead><tr><th>Town</th><th>Mayor</th><th>Vice mayor</th><th class="num">Candidates</th></tr></thead><tbody>
      ${found.province.cities.map(c => { const list = byCity.get(c.name); const n = list?.reduce((s, k) => s + k.c.length, 0) ?? 0; return `<tr><td><a href="${hrefTown(slug, c.slug, year)}"><b>${esc(title(c.name))}</b></a></td><td>${winner(list, 'MAYOR')}</td><td>${winner(list, 'VICE MAYOR')}</td><td class="num">${n ? fmt(n) : '<span class="mute">no data</span>'}</td></tr>`; }).join('')}</tbody></table>
    </div>
    <aside class="side">
      <div class="card pad"><div class="kicker">Most elected in ${esc(title(shard.name))}</div><ol class="plain">${top.map(([id, p]) => `<li><a href="${hrefPerson(slug, id)}">${esc(personName(p[0], p[1], '', p[3]))}</a> <span class="mono mute">${p[6]}/${p[5]}</span></li>`).join('')}</ol></div>
      ${senators.length ? `<div class="card pad"><div class="kicker">${year} Senate vote in ${esc(title(shard.name))}</div><ol class="plain">${senators.map(s => `<li>${esc(title(s[0]))} <span class="mono mute">${fmt(s[2])}${s[3] ? '' : ' · lost'}</span></li>`).join('')}</ol>${nat?.['PRESIDENT']?.length ? `<div class="kicker" style="margin-top:12px">President</div><ol class="plain">${nat['PRESIDENT'].slice(0, 3).map(s => `<li>${esc(title(s[0]))} <span class="mono mute">${fmt(s[2])}</span></li>`).join('')}</ol>` : ''}</div>` : ''}
      <div class="card pad"><div class="kicker">Surname blocs</div><a href="/dynasties">Open the dynasty view</a> to see which surnames hold the most seats here.</div>
    </aside></div></div>`;
    } catch (e) { failed(root, e); }
}

export async function town(root: HTMLElement, slug: string, citySlug: string, q: URLSearchParams) {
    loading(root);
    try {
        const [index, shard] = await Promise.all([loadIndex(), loadProvince(slug)]);
        const found = findProvince(index, slug);
        const city = found?.province.cities.find(c => c.slug === citySlug);
        if (!found || !city) { failed(root, 'No such town'); return; }
        const all = shard.contests.filter(k => k.city === city.name);
        const years = [...new Set(all.map(k => k.year))].sort();
        const year = pickYear(years, q);
        const ks = all.filter(k => k.year === year).sort(sortContests);
        const history = years.slice().reverse().map(y => { const list = all.filter(k => k.year === y); const w = (pos: string) => { const k = list.find(x => x.position === pos); return k ? winnersOf(k, shard, slug) : '<span class="mute">—</span>'; }; return `<tr><td><a href="${hrefTown(slug, citySlug, y)}">${y}</a></td><td>${w('MAYOR')}</td><td>${w('VICE MAYOR')}</td><td class="num">${fmt(list.reduce((s, k) => s + k.c.length, 0))}</td></tr>`; }).join('');
        root.innerHTML = `<div class="page">${crumbs([{ label: 'Philippines', href: '/' }, { label: regionLabel(shard.region), href: hrefRegion(index.regions.find(r => r.name === shard.region)?.slug ?? '') }, { label: title(shard.name), href: hrefProvince(slug, year) }, { label: title(city.name) }])}
  <div class="page-h"><div><h1>${esc(title(city.name))}</h1><div class="mono mute">${esc(title(shard.name))} · ${esc(regionLabel(shard.region))}</div></div>${yearTabs(years, year, y => hrefTown(slug, citySlug, y))}</div>
  <div class="cols"><div class="main">
    ${ks.length ? ks.map(k => contestCard(k, shard, slug)).join('') : '<div class="empty">No contests recorded for this year.</div>'}
  </div><aside class="side"><div class="card pad"><div class="kicker">Mayors and vice mayors over time</div><table class="list compact"><thead><tr><th>Year</th><th>Mayor</th><th>Vice mayor</th><th class="num">Cands</th></tr></thead><tbody>${history}</tbody></table></div></aside></div></div>`;
    } catch (e) { failed(root, e); }
}

export { POSORDER };
