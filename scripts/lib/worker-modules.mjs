import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// Reuse the production query and SEO functions when building snapshots. This avoids
// maintaining a second implementation of response formats or election calculations.
export async function loadWorkerModules() {
    const output = await mkdtemp(path.join(tmpdir(), 'dynasty-worker-'));
    const cleanup = () => rm(output, { recursive: true, force: true });
    try {
        for (const name of await readdir(new URL('../../worker/', import.meta.url))) {
            if (!name.endsWith('.ts')) continue;
            const source = await readFile(new URL(`../../worker/${name}`, import.meta.url), 'utf8');
            const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } });
            await writeFile(path.join(output, name.replace(/\.ts$/, '.mjs')), outputText.replace(/from '(\.\/[^']+)'/g, "from '$1.mjs'"));
        }
        return {
            index: await import(pathToFileURL(path.join(output, 'index.mjs')).href),
            api: await import(pathToFileURL(path.join(output, 'data-api.mjs')).href),
            seo: await import(pathToFileURL(path.join(output, 'seo.mjs')).href),
            snapshots: await import(pathToFileURL(path.join(output, 'snapshots.mjs')).href),
            cleanup,
        };
    } catch (error) { await cleanup(); throw error; }
}

export function d1Adapter(sqlite) {
    const statements = new Map();
    return { prepare(sql) {
        let statement = statements.get(sql);
        if (!statement) { statement = sqlite.prepare(sql); statements.set(sql, statement); }
        let args = [];
        return {
            bind(...values) { args = values; return this; },
            async all() { return { results: statement.all(...args) }; },
            async first() { return statement.get(...args) ?? null; },
        };
    } };
}
