import { loadIndex, loadProvince, findProvince, type IndexData, type Contest } from '../data';
import { esc, fmt, title, regionLabel, hrefProvince, hrefTown, hrefRegion, hrefPerson, yearTabs, personName } from '../util';
import { crumbs, loading, failed, contestCard, sortContests, winnersOf, slugOf } from './shared';

const provinceName = (index: IndexData, slug: string) => { for (const r of index.regions) for (const p of r.provinces) if (p.slug === slug) return p.name; return slug; };

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
        root.innerHTML = `<div class="page">${crumbs([{ label: 'Philippines', href: '/regional' }, { label: regionLabel(shard.region), href: hrefRegion(index.regions.find(r => r.name === shard.region)?.slug ?? '') }, { label: title(shard.name) }])}
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
      <div class="card pad"><div class="kicker">Surname blocs</div><a href="/?province=${slug}">Open the dynasty view for ${esc(title(shard.name))}</a> to see which surnames hold the most seats here.</div>
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
        root.innerHTML = `<div class="page">${crumbs([{ label: 'Philippines', href: '/regional' }, { label: regionLabel(shard.region), href: hrefRegion(index.regions.find(r => r.name === shard.region)?.slug ?? '') }, { label: title(shard.name), href: hrefProvince(slug, year) }, { label: title(city.name) }])}
  <div class="page-h"><div><h1>${esc(title(city.name))}</h1><div class="mono mute">${esc(title(shard.name))} · ${esc(regionLabel(shard.region))}</div></div>${yearTabs(years, year, y => hrefTown(slug, citySlug, y))}</div>
  <div class="cols"><div class="main">
    ${ks.length ? ks.map(k => contestCard(k, shard, slug)).join('') : '<div class="empty">No contests recorded for this year.</div>'}
  </div><aside class="side"><div class="card pad"><div class="kicker">Mayors and vice mayors over time</div><table class="list compact"><thead><tr><th>Year</th><th>Mayor</th><th>Vice mayor</th><th class="num">Cands</th></tr></thead><tbody>${history}</tbody></table></div></aside></div></div>`;
    } catch (e) { failed(root, e); }
}

