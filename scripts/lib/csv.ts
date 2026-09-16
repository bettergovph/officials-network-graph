import fs from 'node:fs';
import zlib from 'node:zlib';
import readline from 'node:readline';

/** Parse one CSV line, honouring double quotes and doubled-quote escapes. */
export function parseLine(line: string): string[] {
    const out: string[] = [];
    let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"' && q && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') q = !q;
        else if (ch === ',' && !q) { out.push(cur.trim()); cur = ''; }
        else cur += ch;
    }
    out.push(cur.trim());
    return out;
}

/** Stream a (optionally gzipped) CSV file as row objects keyed by header. */
export async function* readCSV(path: string): AsyncGenerator<Record<string, string>> {
    const raw = fs.createReadStream(path);
    const input = path.endsWith('.gz') ? raw.pipe(zlib.createGunzip()) : raw;
    const rl = readline.createInterface({ input, crlfDelay: Infinity });
    let headers: string[] | null = null;
    for await (const line of rl) {
        if (headers === null) { headers = parseLine(line.replace(/^﻿/, '')); continue; }
        if (!line.trim()) continue;
        const v = parseLine(line);
        const o: Record<string, string> = {};
        for (let i = 0; i < headers.length; i++) o[headers[i]!] = v[i] ?? '';
        yield o;
    }
}

export function csvEscape(v: unknown): string {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
