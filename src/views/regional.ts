import { loadIndex, type PlaceProvince } from '../data';
import { esc, fmt, title, regionLabel, hrefRegion, hrefProvince } from '../util';
import { loading, failed } from './shared';

const provinceTile = (p: PlaceProvince, year: number) => {
    const y = p.years[String(year)];
    return `<a class="tile" href="${hrefProvince(p.slug)}"><b>${esc(title(p.name))}</b><span class="mono">${p.cities.length} towns · ${fmt(y?.seats ?? p.seats)} seats${p.poverty != null ? ` · poverty ${p.poverty}%` : ''}</span></a>`;
};

/** Regional: national totals, then every region with its stats and province tiles. */
export async function regional(root: HTMLElement) {
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
        root.innerHTML = `<div class="page">
  <section class="hero compact"><div class="kicker">Philippines · ${index.years[0]}–${latest}</div><h1>Regions and provinces</h1>
    <p>Every candidate for local office since ${index.years[0]}, by region, province and town. Looking for a person? Use the <a href="/officials">officials directory</a>. Seats and candidates below are for ${latest}; people are counted since ${index.years[0]}.</p>
    <div class="stats wide"><div class="stat"><b>${fmt(index.totals.persons)}</b><span>people</span></div><div class="stat"><b>${fmt(index.totals.candidacies)}</b><span>candidacies</span></div><div class="stat"><b>${fmt(index.totals.contests)}</b><span>contests</span></div><div class="stat"><b>${index.regions.length}</b><span>regions · ${index.totals.provinces} provinces</span></div><div class="stat"><b>${fmt(index.totals.cities)}</b><span>cities &amp; towns</span></div><div class="stat"><b>${index.years.length}</b><span>elections</span></div></div></section>
  <table class="list regions"><thead><tr><th>Region</th><th class="num">Provinces</th><th class="num">Towns</th><th class="num">Seats</th><th class="num">Candidates</th><th class="num">People</th><th class="num">Avg poverty</th></tr></thead><tbody>
  ${rows.map(({ r, seats, cands, persons, towns, poverty }) => `<tr><td><a href="${hrefRegion(r.slug)}"><b>${esc(regionLabel(r.name))}</b></a></td><td class="num">${r.provinces.length}</td><td class="num">${towns}</td><td class="num">${fmt(seats)}</td><td class="num">${fmt(cands)}</td><td class="num">${fmt(persons)}</td><td class="num">${poverty == null ? '–' : poverty.toFixed(1) + '%'}</td></tr>`).join('')}</tbody></table>
  ${rows.map(({ r, seats, towns, persons }) => `<div class="region-block" id="${esc(r.slug)}"><h3><a href="${hrefRegion(r.slug)}">${esc(regionLabel(r.name))}</a> <small class="mono mute">${r.provinces.length} provinces · ${towns} towns · ${fmt(seats)} seats · ${fmt(persons)} people</small></h3><div class="tiles">${r.provinces.map(p => provinceTile(p, latest)).join('')}</div></div>`).join('')}
  <p class="note">Regions follow each province's assignment in the latest election. Poverty incidence is the unweighted average of the region's provinces from the PSA.</p></div>`;
    } catch (e) { failed(root, e); }
}
