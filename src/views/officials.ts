import { loadIndex, type TopRow } from '../data';
import { esc, title, personName, hrefPerson, posLabel } from '../util';
import { crumbs, loading, failed } from './shared';

export async function officials(root: HTMLElement, q: URLSearchParams) {
    loading(root);
    try {
        const index = await loadIndex();
        const provinceName = (slug: string) => { for (const r of index.regions) for (const p of r.provinces) if (p.slug === slug) return p.name; return slug; };
        const tab = (['wins', 'runs', 'losses'] as const).includes(q.get('by') as 'wins') ? q.get('by') as 'wins' | 'runs' | 'losses' : 'wins';
        const rows: TopRow[] = index.top[tab];
        root.innerHTML = `<div class="page">${crumbs([{ label: 'Philippines', href: '/map' }, { label: 'Repeat politicians' }])}
  <div class="page-h"><div><h1>Officials search</h1><div class="mono mute">${index.totals.persons.toLocaleString('en-US')} people who ran for local office between ${index.years[0]} and ${index.years[index.years.length - 1]}; ${index.totals.repeat.toLocaleString('en-US')} ran more than once.</div></div></div>
  <form class="searchform" id="dirsearch"><input type="search" name="q" placeholder="Find an official by surname, or “Surname, First name”" autocomplete="off"><button class="btn" type="submit">Search</button></form>
  <div class="page-h"><h2 style="margin:0">Repeat politicians <small class="mono mute">top 100</small></h2>
  <div class="seg tabs"><a href="/officials?by=wins" aria-pressed="${tab === 'wins'}">Most wins</a><a href="/officials?by=runs" aria-pressed="${tab === 'runs'}">Most runs</a><a href="/officials?by=losses" aria-pressed="${tab === 'losses'}">Most losses</a></div></div>
  <table class="list"><thead><tr><th class="num">#</th><th>Name</th><th>Province</th><th class="num">Runs</th><th class="num">Won</th><th class="num">Lost</th><th>Years</th><th>Highest office</th></tr></thead><tbody>
  ${rows.map((t, i) => `<tr><td class="num mute">${i + 1}</td><td><a href="${hrefPerson(t[5], t[0])}"><b>${esc(personName(t[1], t[2], t[3], t[4]))}</b></a></td><td>${esc(title(provinceName(t[5])))}</td><td class="num">${t[6]}</td><td class="num">${t[7]}</td><td class="num">${t[6] - t[7]}</td><td class="mono mute">${t[8]}–${t[9]}</td><td class="mute">${t[10] ? esc(posLabel(t[10])) : '—'}</td></tr>`).join('')}</tbody></table>
  <p class="note">A "run" is one candidacy in one election. People are matched across elections by name within a province, so a politician who moved provinces appears twice.</p></div>`;
        root.querySelector<HTMLFormElement>('#dirsearch')!.addEventListener('submit', e => { e.preventDefault(); const v = root.querySelector<HTMLInputElement>('#dirsearch input')!.value.trim(); history.pushState(null, '', `/search?q=${encodeURIComponent(v)}`); dispatchEvent(new PopStateEvent('popstate')); });
    } catch (e) { failed(root, e); }
}
