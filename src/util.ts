// Shared formatting and naming helpers for the web app.

export const fmt = (n: number | null | undefined) => n == null ? '–' : n.toLocaleString('en-US');
export const pct = (x: number | null | undefined, digits = 1) => x == null || !isFinite(x) ? '–' : (x * 100).toFixed(digits) + '%';

export function esc(v: unknown): string {
    return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function title(s: string): string {
    return (s ?? '').toLowerCase()
        .replace(/(^|[\s\-,.'(])(\S)/g, (_m, a: string, b: string) => a + b.toUpperCase())
        .replace(/\bNcr\b/g, 'NCR').replace(/\bDe\b/g, 'de').replace(/\bDel\b/g, 'del').replace(/\bDela\b/g, 'dela')
        .replace(/\b(Ii|Iii|Iv|Jr|Sr)\b/g, m => m.toUpperCase());
}

export const regionLabel = (r: string) => (r ?? '').replace(/^REGION /, 'Region ')
    .replace('NATIONAL CAPITAL REGION', 'NCR').replace('CORDILLERA ADMINISTRATIVE REGION', 'CAR')
    .replace('NEGROS ISLAND REGION', 'Negros Island').replace('UNKNOWN', 'Unassigned');

export const POSORDER = ['GOVERNOR', 'VICE GOVERNOR', 'MEMBER, HOUSE OF REPRESENTATIVES', 'PROVINCIAL BOARD MEMBER', 'MAYOR', 'VICE MAYOR', 'COUNCILOR'];
export const POSSHORT: Record<string, string> = { 'GOVERNOR': 'Gov', 'VICE GOVERNOR': 'V-Gov', 'MEMBER, HOUSE OF REPRESENTATIVES': 'Rep', 'PROVINCIAL BOARD MEMBER': 'Board', 'MAYOR': 'Mayor', 'VICE MAYOR': 'V-Mayor', 'COUNCILOR': 'Councilor' };
const POSLABEL: Record<string, string> = { 'MEMBER, HOUSE OF REPRESENTATIVES': 'Representative', 'PROVINCIAL BOARD MEMBER': 'Board Member', 'ARMM REGIONAL GOVERNOR': 'ARMM Regional Governor', 'ARMM REGIONAL VICE GOVERNOR': 'ARMM Regional Vice Governor', 'ARMM ASSEMBLYMAN': 'ARMM Assemblyman', 'BARMM MEMBER OF PARLIAMENT': 'BARMM Member of Parliament', 'BARMM PARTY REPRESENTATIVE': 'BARMM Party Representative', 'PARTY LIST': 'Party List', 'VICE PRESIDENT': 'Vice President' };
export const posLabel = (p: string) => POSLABEL[p] ?? title(p);
export const posRank = (p: string) => { const i = POSORDER.indexOf(p); return i < 0 ? POSORDER.length : i; };
export const PROVINCE_LEVEL = new Set(['GOVERNOR', 'VICE GOVERNOR', 'PROVINCIAL BOARD MEMBER', 'MEMBER, HOUSE OF REPRESENTATIVES', 'ARMM REGIONAL GOVERNOR', 'ARMM REGIONAL VICE GOVERNOR', 'ARMM ASSEMBLYMAN', 'BARMM MEMBER OF PARLIAMENT', 'BARMM PARTY REPRESENTATIVE']);

/** Same key/slug rules as scripts/lib/names.ts so links match generated file names. */
export function key(s: string): string {
    return (s ?? '').normalize('NFC').toUpperCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/Ñ/g, 'N')
        .replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
export const slug = (s: string) => key(s).toLowerCase().replace(/ /g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'x';

export const personName = (last: string, first: string, middle = '', suffix = '') =>
    `${title(first)} ${middle ? title(middle) + ' ' : ''}${title(last)}${suffix ? ' ' + suffix : ''}`.trim();
export const shortName = (last: string, first: string, suffix = '') => `${title(first)} ${title(last)}${suffix ? ' ' + suffix : ''}`;

export const hrefProvince = (p: string, year?: number | string) => `/province/${p}${year ? `?year=${year}` : ''}`;
export const hrefTown = (p: string, c: string, year?: number | string) => `/province/${p}/${c}${year ? `?year=${year}` : ''}`;
export const hrefPerson = (p: string, id: string) => `/person/${p}/${id}`;
export const hrefRegion = (r: string) => `/regional?open=${r}`;

export const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
export const yearTabs = (years: (number | string)[], current: number | string, href: (y: number | string) => string) =>
    `<div class="seg tabs">${years.map(y => `<a href="${href(y)}" aria-pressed="${String(y) === String(current)}">${y}</a>`).join('')}</div>`;
export const sexMark = (s: string) => s === 'F' ? '<span class="tag">F</span>' : s === 'M' ? '<span class="tag">M</span>' : '';
