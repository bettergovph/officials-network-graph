import { loadIndex, loadNational } from '../data';
import { esc, fmt, pct, title, yearTabs } from '../util';
import { crumbs, loading, failed } from './shared';

const NAT_YEARS = [2010, 2013, 2016, 2019, 2022, 2025];

export async function national(root: HTMLElement, yearParam?: string) {
    loading(root);
    try {
        const index = await loadIndex();
        const years = NAT_YEARS.filter(y => index.years.includes(y));
        const year = years.includes(Number(yearParam)) ? Number(yearParam) : years[years.length - 1]!;
        const data = await loadNational(year);
        const race = (pos: string, label: string, limit?: number) => {
            const rows = data.races[pos] ?? [];
            if (!rows.length) return '';
            const total = rows.reduce((s, r) => s + r[2], 0);
            const shown = limit ? rows.slice(0, limit) : rows;
            return `<section class="card contest"><div class="card-h"><h3>${esc(label)}</h3><div class="facts-line mono">${rows.length} candidates · ${fmt(total)} votes${limit && rows.length > limit ? ` · showing ${limit}` : ''}</div></div>
      <table class="cands"><thead><tr><th class="num">#</th><th>Candidate</th><th>Party</th><th class="num">Votes</th><th class="num">Share</th><th>Result</th></tr></thead><tbody>${shown.map(r => `<tr class="${r[4] ? 'won' : ''}"><td class="num mute">${r[3]}</td><td><b>${esc(title(r[0]))}</b></td><td class="mute">${esc(r[1] || '—')}</td><td class="num">${fmt(r[2])}</td><td class="num mute">${pct(r[2] / total)}</td><td>${r[4] ? '<span class="badge won">Won</span>' : pos === 'PARTY LIST' ? '' : '<span class="badge lost">Lost</span>'}</td></tr>`).join('')}</tbody></table></section>`;
        };
        root.innerHTML = `<div class="page">${crumbs([{ label: 'Philippines', href: '/map' }, { label: 'National results' }])}
  <div class="page-h"><div><h1>National results</h1><div class="mono mute">Votes summed from the town-level counts. Senators: top 12 win. Party list seats are not derived here.</div></div>${yearTabs(years, year, y => `/national/${y}`)}</div>
  ${race('PRESIDENT', 'President')}${race('VICE PRESIDENT', 'Vice President')}${race('SENATOR', 'Senator')}${race('PARTY LIST', 'Party list', 40)}
  ${!Object.keys(data.races).length ? '<div class="empty">No national race in this year\'s data.</div>' : ''}</div>`;
    } catch (e) { failed(root, e); }
}
