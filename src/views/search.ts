import { loadIndex, loadSnapshotPeople, type SnapshotPeopleRow } from '../data';
import { esc, key, title, personName, hrefPerson, hrefProvince, hrefTown, posLabel } from '../util';
import { loading, failed, crumbs } from './shared';

interface ApiPlace { type: 'province' | 'city'; name: string; slug: string; province_slug: string | null }
interface Hit { id: string; name: string; prov: string; provSlug: string; runs: number; wins: number; years: string; top: string }

export async function searchPeople(q: string, provinceName: (slug: string) => string): Promise<Hit[]> {
    // Generated shards are the primary source, so browser searches never query D1.
    const k = key(q);
    let last = k, first = '';
    if (q.includes(',')) [last, first] = q.split(',').map(s => key(s)) as [string, string];
    else if (k.includes(' ')) { const t = k.split(' '); last = t[t.length - 1]!; first = t.slice(0, -1).join(' '); }
    const letters = new Set([last[0], first[0]].filter((x): x is string => !!x).map(letter => /[A-Z]/.test(letter) ? letter : '_'));
    const rows = (await Promise.all([...letters].map(L => loadSnapshotPeople(L)))).flat();
    const match = (r: SnapshotPeopleRow) => { const L = key(r[1]), F = key(r[2]); return (L.startsWith(last) && (!first || F.startsWith(first))) || (first && L.startsWith(first) && F.startsWith(last)); };
    const hits = rows.filter(match).sort((a, b) => b[7] - a[7] || b[6] - a[6]).slice(0, 50)
        .map(r => ({ id: r[0], name: personName(r[1], r[2], r[3], r[4]), prov: provinceName(r[5]), provSlug: r[5], runs: r[6], wins: r[7], years: `${r[10]}–${r[8]}`, top: r[9] }));
    return hits;
}

export async function search(root: HTMLElement, q: URLSearchParams) {
    const query = (q.get('q') ?? '').trim();
    const crumbsHtml = crumbs([{ label: 'Officials search', href: '/officials' }, { label: 'Search' }]);
    root.innerHTML = `<div class="page">${crumbsHtml}<h1>Search</h1><form class="searchform" id="searchform"><input type="search" name="q" value="${esc(query)}" placeholder="Surname, or “Surname, First name”" autocomplete="off" autofocus><button class="btn" type="submit">Search</button></form><div id="results"></div></div>`;
    const results = root.querySelector<HTMLElement>('#results')!;
    if (query.length < 2) { results.innerHTML = '<p class="mute">Type at least two letters of a surname. Examples: <a href="/search?q=marcos">Marcos</a>, <a href="/search?q=duterte,%20sara">Duterte, Sara</a>, <a href="/search?q=cebu">Cebu</a>.</p>'; return; }
    loading(results, 'searching…');
    try {
        const index = await loadIndex();
        const provinceName = (slug: string) => { for (const r of index.regions) for (const p of r.provinces) if (p.slug === slug) return p.name; return slug; };
        const hits = await searchPeople(query, provinceName);
        const kq = key(query).toLowerCase().replace(/ /g, '-');
        const localPlaces: ApiPlace[] = index.regions.flatMap(r => r.provinces.flatMap(p => [...(p.slug.includes(kq) ? [{ type: 'province' as const, name: p.name, slug: p.slug, province_slug: null }] : []), ...p.cities.filter(c => c.slug.includes(kq)).map(c => ({ type: 'city' as const, name: c.name, slug: c.slug, province_slug: p.slug }))])).slice(0, 10);
        results.innerHTML = `${localPlaces.length ? `<h2>Places</h2><div class="tiles">${localPlaces.map(p => `<a class="tile" href="${p.type === 'province' ? hrefProvince(p.slug) : hrefTown(p.province_slug!, p.slug)}"><b>${esc(title(p.name))}</b><span class="mono">${p.type === 'city' ? title(provinceName(p.province_slug!)) : 'province'}</span></a>`).join('')}</div>` : ''}
    <h2>People <small class="mono mute">${hits.length}${hits.length === 50 ? '+' : ''} matches</small></h2>
    ${hits.length ? `<table class="list"><thead><tr><th>Name</th><th>Province</th><th class="num">Runs</th><th class="num">Won</th><th>Years</th><th>Highest office</th></tr></thead><tbody>${hits.map(h => `<tr><td><a href="${hrefPerson(h.provSlug, h.id)}"><b>${esc(h.name)}</b></a></td><td>${esc(title(h.prov))}</td><td class="num">${h.runs}</td><td class="num">${h.wins}</td><td class="mono mute">${esc(h.years)}</td><td class="mute">${h.top ? esc(posLabel(h.top)) : '—'}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No one by that name. Try just the surname.</div>'}`;
    } catch (e) { failed(results, e); }
    root.querySelector<HTMLFormElement>('#searchform')!.addEventListener('submit', e => { e.preventDefault(); const v = (root.querySelector<HTMLInputElement>('input[name=q]')!.value).trim(); history.pushState(null, '', `/search?q=${encodeURIComponent(v)}`); dispatchEvent(new PopStateEvent('popstate')); });
}
