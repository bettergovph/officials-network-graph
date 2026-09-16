import { loadIndex } from '../data';
import { esc, fmt, title, regionLabel, hrefProvince, hrefTown } from '../util';
import { loading, failed } from './shared';

/** Regional: national totals and one expandable table, region rows opening into their provinces. */
export async function regional(root: HTMLElement, q: URLSearchParams) {
    loading(root);
    try {
        const index = await loadIndex();
        const latest = index.years[index.years.length - 1]!;
        const open = new Set((q.get('open') ?? location.hash.replace(/^#/, '')).split(',').filter(Boolean));
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
    <p>Every candidate for local office since ${index.years[0]}, by region, province and town. Expand a region to see its provinces, and a province to see its towns and House districts; open a town for its contests. Seats and candidates are for ${latest}; people are counted since ${index.years[0]}. Looking for a person? Use <a href="/officials">officials search</a>.</p>
    <div class="stats wide"><div class="stat"><b>${fmt(index.totals.persons)}</b><span>people</span></div><div class="stat"><b>${fmt(index.totals.candidacies)}</b><span>candidacies</span></div><div class="stat"><b>${fmt(index.totals.contests)}</b><span>contests</span></div><div class="stat"><b>${index.regions.length}</b><span>regions · ${index.totals.provinces} provinces</span></div><div class="stat"><b>${fmt(index.totals.cities)}</b><span>cities &amp; towns</span></div><div class="stat"><b>${index.years.length}</b><span>elections</span></div></div></section>
  <div class="table-tools"><button class="linkbtn" id="expand-all" type="button">Expand all</button><button class="linkbtn" id="collapse-all" type="button">Collapse all</button></div>
  <table class="list regions" id="regions"><thead><tr><th></th><th>Region / province / town</th><th class="num">Provinces</th><th class="num">Towns</th><th class="num">Seats</th><th class="num">Candidates</th><th class="num">People</th><th class="num">Poverty</th></tr></thead><tbody>
  ${rows.map(({ r, seats, cands, persons, towns, poverty }) => {
        const isOpen = open.has(r.slug);
        return `<tr class="region-row" data-region="${esc(r.slug)}" aria-expanded="${isOpen}"><td class="tog"><button type="button" class="toggle" aria-label="Expand ${esc(regionLabel(r.name))}">${isOpen ? '−' : '+'}</button></td><td><b>${esc(regionLabel(r.name))}</b></td><td class="num">${r.provinces.length}</td><td class="num">${towns}</td><td class="num">${fmt(seats)}</td><td class="num">${fmt(cands)}</td><td class="num">${fmt(persons)}</td><td class="num">${poverty == null ? '–' : poverty.toFixed(1) + '%'}</td></tr>`
            + r.provinces.map(p => { const y = p.years[String(latest)]; return `<tr class="province-row" data-region="${esc(r.slug)}" data-province="${esc(p.slug)}" aria-expanded="false"${isOpen ? '' : ' hidden'}><td class="tog"><button type="button" class="toggle small" aria-label="Expand ${esc(title(p.name))}">+</button></td><td><a href="${hrefProvince(p.slug)}">${esc(title(p.name))}</a></td><td class="num mute">–</td><td class="num">${p.cities.length}</td><td class="num">${fmt(y?.seats)}</td><td class="num">${fmt(y?.candidacies)}</td><td class="num">${fmt(p.persons)}</td><td class="num">${p.poverty != null ? p.poverty + '%' : '–'}</td></tr>`
                + p.cities.map(c => `<tr class="town-row" data-region="${esc(r.slug)}" data-province="${esc(p.slug)}" hidden><td></td><td><a href="${hrefTown(p.slug, c.slug)}">${esc(title(c.name))}</a>${c.district ? ` <small class="mono mute">${esc(c.district)}</small>` : ''}</td><td class="num mute">–</td><td class="num mute">–</td><td class="num">${fmt(c.seats)}</td><td class="num">${fmt(c.candidacies)}</td><td class="num mute">–</td><td class="num mute">–</td></tr>`).join(''); }).join('');
    }).join('')}</tbody></table>
  <p class="note">Regions follow each province's assignment in the latest election. Region poverty is the unweighted average of its provinces from the PSA.</p></div>`;
        const table = root.querySelector<HTMLTableElement>('#regions')!;
        const setOpen = (slug: string, on: boolean) => {
            const head = table.querySelector<HTMLElement>(`tr.region-row[data-region="${slug}"]`); if (!head) return;
            head.setAttribute('aria-expanded', String(on)); head.querySelector('.toggle')!.textContent = on ? '−' : '+';
            table.querySelectorAll<HTMLElement>(`tr.province-row[data-region="${slug}"]`).forEach(tr => { tr.hidden = !on; if (!on) { tr.setAttribute('aria-expanded', 'false'); tr.querySelector('.toggle')!.textContent = '+'; } });
            if (!on) table.querySelectorAll<HTMLElement>(`tr.town-row[data-region="${slug}"]`).forEach(tr => { tr.hidden = true; });
            if (on) open.add(slug); else open.delete(slug);
            history.replaceState(null, '', location.pathname + (open.size ? `?open=${[...open].join(',')}` : ''));
        };
        const setProvinceOpen = (prov: string, on: boolean) => {
            const head = table.querySelector<HTMLElement>(`tr.province-row[data-province="${prov}"]`); if (!head) return;
            head.setAttribute('aria-expanded', String(on)); head.querySelector('.toggle')!.textContent = on ? '−' : '+';
            table.querySelectorAll<HTMLElement>(`tr.town-row[data-province="${prov}"]`).forEach(tr => { tr.hidden = !on; });
        };
        table.addEventListener('click', e => {
            const t = e.target as HTMLElement;
            if (t.closest('a')) return;
            const prow = t.closest<HTMLElement>('tr.province-row');
            if (prow) { setProvinceOpen(prow.dataset['province']!, prow.getAttribute('aria-expanded') !== 'true'); return; }
            const head = t.closest<HTMLElement>('tr.region-row');
            if (!head) return;
            const slug = head.dataset['region']!; setOpen(slug, head.getAttribute('aria-expanded') !== 'true');
        });
        root.querySelector('#expand-all')!.addEventListener('click', () => rows.forEach(({ r }) => setOpen(r.slug, true)));
        root.querySelector('#collapse-all')!.addEventListener('click', () => rows.forEach(({ r }) => setOpen(r.slug, false)));
        if (open.size) table.querySelector<HTMLElement>(`tr.region-row[data-region="${[...open][0]}"]`)?.scrollIntoView({ block: 'start' });
    } catch (e) { failed(root, e); }
}
