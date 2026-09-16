import { loadIndex, loadProvince, findProvince, type IndexData, type Contest } from '../data';
import { esc, fmt, title, regionLabel, hrefProvince, hrefTown, hrefRegion, hrefPerson, yearTabs, personName, districtLabel, ordinalRank, PROVINCE_LEVEL } from '../util';
import { crumbs, loading, failed, contestCard, sortContests, winnersOf, slugOf, isDistrictRace, districtTowns } from './shared';

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
        const provWide = ks.filter(k => !k.city && !isDistrictRace(k)).sort(sortContests);
        // legislative districts: province districts first (by ordinal), then districts owned by a city
        const groups = new Map<string, { city: string; district: string; contests: Contest[] }>();
        for (const k of ks.filter(k => isDistrictRace(k) && (PROVINCE_LEVEL.has(k.position)))) { const gk = `${k.city}|${k.district}`; (groups.get(gk) ?? groups.set(gk, { city: k.city, district: k.district, contests: [] }).get(gk)!).contests.push(k); }
        const districts = [...groups.values()].sort((a, b) => (a.city ? 1 : 0) - (b.city ? 1 : 0) || a.city.localeCompare(b.city) || ordinalRank(a.district) - ordinalRank(b.district));
        const districtCard = (g: { city: string; district: string; contests: Contest[] }) => {
            const towns = [...new Set(g.contests.flatMap(districtTowns))].sort();
            const borrowed = g.contests.find(k => k.townsYear)?.townsYear;
            const head = g.city ? `${title(g.city)}${g.district ? ' · ' + districtLabel(g.district) : ''}` : g.district ? districtLabel(g.district) : 'Districts not recorded';
            return `<section class="district"><div class="district-h"><h3>${esc(head)}</h3><div class="mono mute">${towns.length ? `${towns.length} town${towns.length === 1 ? '' : 's'}${borrowed ? ` (as of ${borrowed})` : ''}: ${towns.map(t => `<a href="${hrefTown(slug, slugOf(shard, t), year)}">${esc(title(t))}</a>`).join(', ')}` : 'member towns unknown for this year'}</div></div>${g.contests.sort(sortContests).map(k => contestCard(k, shard, slug)).join('')}</section>`;
        };
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
      ${provWide.length ? provWide.map(k => contestCard(k, shard, slug)).join('') : '<div class="empty">No province-wide race in this year\'s data.</div>'}
      <h2>Legislative districts, ${year} <small class="mono mute">representatives and board members</small></h2>
      ${districts.length ? districts.map(districtCard).join('') : '<div class="empty">No district race in this year\'s data.</div>'}
      <h2>Cities and towns, ${year}</h2>
      <table class="list"><thead><tr><th>Town</th><th>District</th><th>Mayor</th><th>Vice mayor</th><th class="num">Candidates</th></tr></thead><tbody>
      ${found.province.cities.map(c => { const list = byCity.get(c.name); const n = list?.filter(k => !PROVINCE_LEVEL.has(k.position)).reduce((s, k) => s + k.c.length, 0) ?? 0; const d = districts.find(g => districtTowns(g.contests[0]!).includes(c.name) && g.contests.some(k => k.position === 'MEMBER, HOUSE OF REPRESENTATIVES')); return `<tr><td><a href="${hrefTown(slug, c.slug, year)}"><b>${esc(title(c.name))}</b></a></td><td class="mute">${d ? (d.city ? title(d.city) + ' · ' : '') + districtLabel(d.district) : '–'}</td><td>${winner(list, 'MAYOR')}</td><td>${winner(list, 'VICE MAYOR')}</td><td class="num">${n ? fmt(n) : '<span class="mute">no data</span>'}</td></tr>`; }).join('')}</tbody></table>
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
        const ks = all.filter(k => k.year === year && !PROVINCE_LEVEL.has(k.position)).sort(sortContests);
        // seats this town votes for beyond its own hall: its own districts, and province districts it belongs to
        const dks = shard.contests.filter(k => k.year === year && isDistrictRace(k) && (k.city === city.name || (!k.city && k.towns?.includes(city.name)))).sort(sortContests);
        const dtowns = [...new Set(dks.flatMap(districtTowns))].filter(t => t !== city.name).sort();
        const history = years.slice().reverse().map(y => { const list = all.filter(k => k.year === y); const w = (pos: string) => { const k = list.find(x => x.position === pos); return k ? winnersOf(k, shard, slug) : '<span class="mute">—</span>'; }; return `<tr><td><a href="${hrefTown(slug, citySlug, y)}">${y}</a></td><td>${w('MAYOR')}</td><td>${w('VICE MAYOR')}</td><td class="num">${fmt(list.reduce((s, k) => s + k.c.length, 0))}</td></tr>`; }).join('');
        root.innerHTML = `<div class="page">${crumbs([{ label: 'Philippines', href: '/regional' }, { label: regionLabel(shard.region), href: hrefRegion(index.regions.find(r => r.name === shard.region)?.slug ?? '') }, { label: title(shard.name), href: hrefProvince(slug, year) }, { label: title(city.name) }])}
  <div class="page-h"><div><h1>${esc(title(city.name))}</h1><div class="mono mute">${esc(title(shard.name))} · ${esc(regionLabel(shard.region))}</div></div>${yearTabs(years, year, y => hrefTown(slug, citySlug, y))}</div>
  <div class="cols"><div class="main">
    <h2>Local government, ${year}</h2>
    ${ks.length ? ks.map(k => contestCard(k, shard, slug)).join('') : '<div class="empty">No contests recorded for this year.</div>'}
    ${dks.length ? `<h2>District seats, ${year} <small class="mono mute">${dtowns.length ? `shared with ${dtowns.length} other town${dtowns.length === 1 ? '' : 's'}: ${dtowns.map(t => `<a href="${hrefTown(slug, slugOf(shard, t), year)}">${esc(title(t))}</a>`).join(', ')}` : 'own district'}</small></h2>${dks.map(k => contestCard(k, shard, slug)).join('')}` : ''}
  </div><aside class="side"><div class="card pad"><div class="kicker">Mayors and vice mayors over time</div><table class="list compact"><thead><tr><th>Year</th><th>Mayor</th><th>Vice mayor</th><th class="num">Cands</th></tr></thead><tbody>${history}</tbody></table></div></aside></div></div>`;
    } catch (e) { failed(root, e); }
}

