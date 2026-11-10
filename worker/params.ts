export class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) { super(message); this.status = status; }
}
export const keyOf = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/Ñ/g, 'N').replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
export const slugOf = (s: string) => keyOf(s).toLowerCase().replace(/ /g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
export const clampInt = (v: string | number | null | undefined, def: number, min: number, max: number) => { const n = typeof v === 'number' ? v : parseInt(v ?? '', 10); return Math.min(max, Math.max(min, Number.isFinite(n) ? n : def)); };
