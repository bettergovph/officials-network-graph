import type { Contest, CandRow, ProvShard } from '../data';
import { esc, fmt, pct, title, posLabel, personName, hrefPerson, hrefTown, hrefProvince, posRank, sexMark, PROVINCE_LEVEL, districtLabel, ordinalRank } from '../util';

export const crumbs = (items: { label: string; href?: string }[]) =>
    `<nav class="crumbs">${items.map(i => i.href ? `<a href="${i.href}">${esc(i.label)}</a>` : `<span>${esc(i.label)}</span>`).join('<i>/</i>')}</nav>`;

export const loading = (root: HTMLElement, what = 'loading…') => { root.innerHTML = `<div class="page"><div class="empty mono">${esc(what)}</div></div>`; };
export const failed = (root: HTMLElement, err: unknown) => { root.innerHTML = `<div class="page"><div class="empty"><b>Could not load this page</b>${esc(err instanceof Error ? err.message : String(err))}</div></div>`; };

export function personLink(shard: ProvShard, pid: string, provSlug: string, full = false): string {
    const p = shard.persons[pid];
    if (!p) return `<span>${esc(pid)}</span>`;
    const home = p[7] || provSlug;
    const name = full ? personName(p[0], p[1], p[2], p[3]) : personName(p[0], p[1], '', p[3]);
    return `<a class="pname" href="${hrefPerson(home, pid)}">${esc(name)}</a>`;
}

export function resultBadge(cand: CandRow, k: Contest): string {
    if (cand[3]) return k.uncontested ? '<span class="badge won">Unopposed</span>' : cand[6] === 'inferred' ? '<span class="badge won" title="Winner inferred from vote counts">Won</span>' : '<span class="badge won">Won</span>';
    return '<span class="badge lost">Lost</span>';
}

export const contestTitle = (k: Contest) => `${posLabel(k.position)}${k.city && PROVINCE_LEVEL.has(k.position) ? ` · ${title(k.city)}` : ''}${k.district ? ` · ${districtLabel(k.district)}` : ''}`;

export function candidateTable(k: Contest, shard: ProvShard, provSlug: string): string {
    const rows = [...k.c].sort((a, b) => (b[3] - a[3]) || ((b[2] ?? -1) - (a[2] ?? -1)) || ((a[4] ?? 99) - (b[4] ?? 99)));
    const hasVotes = rows.some(r => r[2] != null);
    return `<table class="cands"><thead><tr><th class="num">#</th><th>Candidate</th><th>Party</th>${hasVotes ? '<th class="num">Votes</th><th class="num">Share</th>' : ''}<th>Result</th></tr></thead><tbody>${rows.map(r => {
        const p = shard.persons[r[0]];
        return `<tr class="${r[3] ? 'won' : ''}"><td class="num mute">${r[4] ?? '–'}</td><td>${personLink(shard, r[0], provSlug)}${p ? ' ' + sexMark(p[4]) : ''}${p && p[5] > 1 ? `<small class="mute"> · ${p[6]}/${p[5]} won</small>` : ''}</td><td class="mute">${esc(r[1] || '—')}</td>${hasVotes ? `<td class="num">${fmt(r[2])}</td><td class="num mute">${k.total ? pct((r[2] ?? 0) / k.total) : '–'}</td>` : ''}<td>${resultBadge(r, k)}</td></tr>`;
    }).join('')}</tbody></table>`;
}

export function contestFacts(k: Contest): string {
    const bits: string[] = [];
    bits.push(`${k.seats} seat${k.seats === 1 ? '' : 's'}`);
    bits.push(`${k.c.length} candidate${k.c.length === 1 ? '' : 's'}`);
    if (k.total != null) bits.push(`${fmt(k.total)} votes`);
    if (k.uncontested) bits.push('<b>unopposed</b>');
    else if (k.margin != null && k.total) bits.push(`margin ${fmt(k.margin)} (${pct(k.margin / k.total)})`);
    if (!k.complete && k.c.some(c => c[2] == null)) bits.push('<span title="Some candidates have no vote count in the source">partial votes</span>');
    return `<div class="facts-line mono">${bits.join(' · ')}</div>`;
}

export function contestCard(k: Contest, shard: ProvShard, provSlug: string, opts: { place?: boolean } = {}): string {
    const place = opts.place ? (k.city ? `<a href="${hrefTown(provSlug, slugOf(shard, k.city), k.year)}">${esc(title(k.city))}</a>` : `<a href="${hrefProvince(provSlug, k.year)}">${esc(title(shard.name))}</a>`) : '';
    return `<section class="card contest" id="${esc(k.id)}"><div class="card-h"><h3>${contestTitle(k)}${place ? ` <small class="mute">· ${place}</small>` : ''}</h3>${contestFacts(k)}</div>${candidateTable(k, shard, provSlug)}</section>`;
}

const slugCache = new WeakMap<ProvShard, Map<string, string>>();
export function slugOf(shard: ProvShard, city: string): string {
    let m = slugCache.get(shard);
    if (!m) { m = new Map(); slugCache.set(shard, m); }
    let s = m.get(city);
    if (!s) { s = city.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/Ñ/g, 'N').replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase().replace(/ /g, '-'); m.set(city, s); }
    return s;
}

export const sortContests = (a: Contest, b: Contest) => posRank(a.position) - posRank(b.position) || a.position.localeCompare(b.position) || ordinalRank(a.district) - ordinalRank(b.district) || a.city.localeCompare(b.city);
/** Contests elected per legislative district (representatives, board members), incl. a city's own districts. */
const DISTRICT_POSITIONS = new Set(['MEMBER, HOUSE OF REPRESENTATIVES', 'PROVINCIAL BOARD MEMBER']);
export const isDistrictRace = (k: Contest) => DISTRICT_POSITIONS.has(k.position) || (PROVINCE_LEVEL.has(k.position) && (!!k.district || !!k.towns));
/** Member towns of a district contest: its own city, or the towns that vote in it. */
export const districtTowns = (k: Contest) => k.city ? [k.city] : (k.towns ?? []);

export function winnersOf(k: Contest, shard: ProvShard, provSlug: string): string {
    const w = k.c.filter(c => c[3]);
    if (!w.length) return '<span class="mute">—</span>';
    return w.map(c => personLink(shard, c[0], provSlug)).join(', ');
}
