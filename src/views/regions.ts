import { loadIndex } from '../data';
import { esc, fmt, regionLabel, hrefRegion, hrefProvince, title } from '../util';
import { crumbs, loading, failed } from './shared';

export async function regions(root: HTMLElement) {
    loading(root);
    try {
        const index = await loadIndex();
        const latest = index.years[index.years.length - 1]!;
        const rows = index.regions.map(r => {
            const seats = r.provinces.reduce((s, p) => s + (p.years[String(latest)]?.seats ?? 0), 0);
            const cands = r.provinces.reduce((s, p) => s + (p.years[String(latest)]?.candidacies ?? 0), 0);
            const persons = r.provinces.reduce((s, p) => s + p.persons, 0);
            const towns = r.provinces.reduce((s, p) => s + p.cities.length, 0);
            const pov = r.provinces.filter(p => p.poverty != null);
            const poverty = pov.length ? pov.reduce((s, p) => s + (p.poverty ?? 0), 0) / pov.length : null;
            return { r, seats, cands, persons, towns, poverty };
        });
        root.innerHTML = `<div class="page">${crumbs([{ label: 'Philippines', href: '/map' }, { label: 'Regions' }])}
  <div class="page-h"><div><h1>Regions</h1><div class="mono mute">${index.regions.length} regions · ${index.totals.provinces} provinces · ${fmt(index.totals.cities)} cities and towns · seats and candidates for ${latest}</div></div></div>
  <table class="list"><thead><tr><th>Region</th><th>Provinces</th><th class="num">Towns</th><th class="num">Seats</th><th class="num">Candidates</th><th class="num">People since ${index.years[0]}</th><th class="num">Avg poverty</th></tr></thead><tbody>
  ${rows.map(({ r, seats, cands, persons, towns, poverty }) => `<tr><td><a href="${hrefRegion(r.slug)}"><b>${esc(regionLabel(r.name))}</b></a></td><td class="mute">${r.provinces.map(p => `<a href="${hrefProvince(p.slug)}">${esc(title(p.name))}</a>`).join(', ')}</td><td class="num">${towns}</td><td class="num">${fmt(seats)}</td><td class="num">${fmt(cands)}</td><td class="num">${fmt(persons)}</td><td class="num">${poverty == null ? '–' : poverty.toFixed(1) + '%'}</td></tr>`).join('')}</tbody></table>
  <p class="note">Regions follow each province's assignment in the latest election. Poverty incidence is the unweighted average of the region's provinces from the PSA.</p></div>`;
    } catch (e) { failed(root, e); }
}
