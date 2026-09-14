const ENT: Record<string, string> = { NTILDE: 'Ñ', AMP: '&', APOS: "'", QUOT: '"', NBSP: ' ', EACUTE: 'É', OACUTE: 'Ó', AACUTE: 'Á', IACUTE: 'Í', UACUTE: 'Ú', UUML: 'Ü' };

/** Undo the HTML-entity mangling found in the 2010 vote file ("BARO&AMP;NTILDE;A"). */
export function decodeEntities(s: string): string {
    return s
        .replace(/&(?:AMP;)+([A-Z]+);/gi, (m, name: string) => ENT[name.toUpperCase()] ?? m)
        .replace(/&([A-Z]+);/gi, (m, name: string) => ENT[name.toUpperCase()] ?? m)
        .replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(+n));
}

/** Display form: entities decoded, upper case, single spaces. */
export function clean(s: string): string {
    return decodeEntities(s ?? '').normalize('NFC').toUpperCase().replace(/`/g, "'").replace(/\s+/g, ' ').trim();
}

/** Matching key: diacritics and punctuation removed. */
export function key(s: string): string {
    return clean(s).normalize('NFD').replace(/\p{M}/gu, '').replace(/Ñ/g, 'N')
        .replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const SUFFIXES = new Set(['JR', 'SR', 'II', 'III', 'IV', 'V']);
export const isSuffix = (s: string) => SUFFIXES.has(key(s));

/** Split a first-name field into given name(s) and a generational suffix. */
export function splitFirst(first: string): { first: string; suffix: string } {
    let f = clean(first);
    f = f.replace(/^MA\.?\s+/, 'MARIA ').replace(/^MA\.?$/, 'MARIA');
    const toks = f.replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    let suffix = '';
    while (toks.length > 1 && SUFFIXES.has(toks[toks.length - 1]!)) suffix = toks.pop()!;
    return { first: toks.join(' '), suffix };
}

export function slug(s: string): string {
    return key(s).toLowerCase().replace(/ /g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'x';
}

export const POSCODE: Record<string, string> = {
    'GOVERNOR': 'gov', 'VICE GOVERNOR': 'vgov', 'PROVINCIAL BOARD MEMBER': 'board', 'MEMBER, HOUSE OF REPRESENTATIVES': 'rep',
    'MAYOR': 'mayor', 'VICE MAYOR': 'vmayor', 'COUNCILOR': 'coun',
    'ARMM REGIONAL GOVERNOR': 'armm-gov', 'ARMM REGIONAL VICE GOVERNOR': 'armm-vgov', 'ARMM ASSEMBLYMAN': 'armm-asm',
    'BARMM MEMBER OF PARLIAMENT': 'barmm-mp', 'BARMM PARTY REPRESENTATIVE': 'barmm-party',
};
export const PROVINCE_LEVEL = new Set(['GOVERNOR', 'VICE GOVERNOR', 'PROVINCIAL BOARD MEMBER', 'MEMBER, HOUSE OF REPRESENTATIVES', 'ARMM REGIONAL GOVERNOR', 'ARMM REGIONAL VICE GOVERNOR', 'ARMM ASSEMBLYMAN', 'BARMM MEMBER OF PARLIAMENT', 'BARMM PARTY REPRESENTATIVE']);
export const NATIONAL = new Set(['SENATOR', 'PRESIDENT', 'VICE PRESIDENT', 'PARTY LIST']);
export const POSORDER = ['GOVERNOR', 'VICE GOVERNOR', 'MEMBER, HOUSE OF REPRESENTATIVES', 'PROVINCIAL BOARD MEMBER', 'MAYOR', 'VICE MAYOR', 'COUNCILOR'];
export const posRank = (p: string) => { const i = POSORDER.indexOf(p); return i < 0 ? POSORDER.length : i; };

/** Provinces renamed between elections: old name -> current name. */
export const PROVINCE_ALIAS: Record<string, string> = { 'COMPOSTELA VALLEY': 'DAVAO DE ORO' };
