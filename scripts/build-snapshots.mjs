import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { loadWorkerModules, d1Adapter } from './lib/worker-modules.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const destination = path.join(root, 'public/data/snapshots');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const indexBytes = await fs.readFile(path.join(root, 'public/data/index.json.gz'));
const index = JSON.parse(gunzipSync(indexBytes));
const sources = ['scripts/build-snapshots.mjs', 'scripts/lib/worker-modules.mjs', 'worker/index.ts', 'worker/data-api.ts', 'worker/seo.ts', 'worker/params.ts', 'worker/snapshots.ts'];
const sourceHash = hash(Buffer.concat(await Promise.all(sources.map(file => fs.readFile(path.join(root, file))))));

if (process.argv.includes('--check')) {
    try {
        const integrity = JSON.parse(await fs.readFile(path.join(destination, 'integrity.json'), 'utf8'));
        if (integrity.sourceHash !== sourceHash || integrity.indexHash !== hash(indexBytes)) throw new Error('Snapshot source or dataset changed');
        for (const [file, expected] of Object.entries(integrity.files)) {
            if (hash(await fs.readFile(path.join(destination, file))) !== expected) throw new Error(`Snapshot mismatch: ${file}`);
        }
        console.log(`Verified ${Object.keys(integrity.files).length} snapshot files (data vintage ${index.built}).`);
    } catch (error) {
        console.error(`${error.message}. Run npm run data:snapshots before building.`);
        process.exitCode = 1;
    }
} else {
    await generate();
}

async function generate() {
    // Read the existing database through its symlink. Never rebuild or modify the backup.
    const sqlite = new DatabaseSync(path.join(root, 'data/dynasty.sqlite'), { readOnly: true });
    const modules = await loadWorkerModules();
    const { dataApi } = modules.api;
    const { seoFor, sitemap } = modules.seo;
    const { apiSnapshotPath, SNAPSHOT_FORMAT } = modules.snapshots;
    const db = d1Adapter(sqlite);
    const staging = await fs.mkdtemp(path.join(root, 'public/data/.snapshots-'));
    const files = {};
    const manifest = { format: SNAPSHOT_FORMAT, built: index.built, api: [], seoPages: {}, personBuckets: [], sitemaps: [] };
    let totalBytes = 0;
    try {
        for (const table of ['persons', 'candidacies', 'contests', 'provinces', 'cities']) {
            if (sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n !== index.totals[table]) {
                throw new Error(`Local SQLite and published index disagree on ${table}; use the matching dataset`);
            }
        }
        const write = async (file, bytes) => {
            await fs.mkdir(path.dirname(path.join(staging, file)), { recursive: true });
            await fs.writeFile(path.join(staging, file), bytes);
            files[file] = hash(bytes);
            totalBytes += bytes.length;
        };
        const json = async (file, data) => write(file, gzipSync(JSON.stringify({ format: SNAPSHOT_FORMAT, built: index.built, data }), { level: 6 }));
        const api = async (operation, args = []) => {
            const { file } = apiSnapshotPath(operation, args);
            await json(file, await dataApi[operation](db, ...args));
            manifest.api.push(file);
        };
        const seo = async (file, paths) => {
            const pages = {};
            for (const route of paths) pages[route] = await seoFor(new URL(route, 'https://dynasties.bettergov.ph'), db);
            await json(file, pages);
            for (const route of paths) manifest.seoPages[route] = file;
        };
        console.log('Generating API summaries, places, national results and leaderboards from local SQLite…');
        for (const name of ['stats', 'coverage', 'places']) await api(name);
        const provinces = sqlite.prepare('SELECT id, slug FROM provinces ORDER BY slug').all();
        const years = sqlite.prepare('SELECT DISTINCT year FROM national_candidates ORDER BY year').all().map(row => row.year);
        const commonPages = ['/', '/atlas', '/network', '/ledger', '/dynasties', '/regional', '/map', '/regions', '/officials', '/people', '/search', '/about', '/developers', '/api-docs', '/national', ...years.map(year => `/national/${year}`)];
        await seo('seo/pages.json.gz', commonPages);
        for (const year of years) await api('national', [year, null]);
        for (const sort of ['wins', 'runs', 'losses']) await api('persons', [{ sort, page: 1, limit: 200, min_runs: 1 }]);
        for (const province of provinces) {
            const towns = sqlite.prepare('SELECT slug FROM cities WHERE province_id = ? ORDER BY slug').all(province.id);
            await api('province', [province.slug]);
            for (const town of towns) await api('town', [province.slug, town.slug]);
            for (const year of years) {
                try { await api('national', [year, province.slug]); }
                catch (error) { if (error.status !== 404) throw error; }
            }
            for (const sort of ['wins', 'runs', 'losses']) await api('persons', [{ province: province.slug, sort, page: 1, limit: 200, min_runs: 1 }]);
            await seo(`seo/provinces/${province.slug}.json.gz`, [`/province/${province.slug}`, ...towns.map(town => `/province/${province.slug}/${town.slug}`)]);
        }
        // Browser search uses compact records with the full active-year range. Publish
        // empty letter shards too, so a legitimate empty result isn't a missing asset.
        const letters = Object.fromEntries([...'ABCDEFGHIJKLMNOPQRSTUVWXYZ_'].map(letter => [letter, []]));
        for (const p of sqlite.prepare('SELECT p.*, pr.slug AS province_slug FROM persons p JOIN provinces pr ON pr.id=p.home_province_id ORDER BY p.rowid').all()) {
            const letter = /^[A-Z]/.test(p.last_key) ? p.last_key[0] : '_';
            letters[letter].push([p.id, p.last_name, p.first_name, p.middle_name, p.suffix, p.province_slug, p.runs, p.wins, p.last_year, p.top_position, p.first_year]);
        }
        for (const [letter, rows] of Object.entries(letters)) await json(`search/${letter}.json.gz`, rows);
        console.log(`Generated ${manifest.api.length} API snapshots and ${Object.keys(manifest.seoPages).length} common pages. Generating politician summaries…`);
        // 4,096 small shards avoid both 175,000 individual assets and a giant file per province.
        const people = sqlite.prepare('SELECT p.id, pr.slug FROM persons p JOIN provinces pr ON pr.id=p.home_province_id ORDER BY p.id').all();
        let bucket = '', pages = {}, count = 0;
        const flush = async () => {
            if (!bucket) return;
            await json(`seo/persons/${bucket}.json.gz`, pages);
            manifest.personBuckets.push(bucket);
        };
        for (const person of people) {
            const next = person.id.slice(0, 3);
            if (next !== bucket) { await flush(); bucket = next; pages = {}; }
            const route = `/person/${person.slug}/${person.id}`;
            pages[route] = await seoFor(new URL(route, 'https://dynasties.bettergov.ph'), db);
            if (++count % 25000 === 0) console.log(`  ${count.toLocaleString()} politician summaries`);
        }
        await flush();
        for (const route of ['/sitemap.xml', '/sitemap-pages.xml', ...Array.from({ length: Math.ceil(people.length / 40000) }, (_, i) => `/sitemap-persons-${i + 1}.xml`)]) {
            const response = await sitemap(new URL(route, 'https://dynasties.bettergov.ph'), { DB: db }, index.built);
            if (!response?.ok) throw new Error(`Could not generate ${route}`);
            await write(`sitemaps${route}`, Buffer.from(await response.text()));
            manifest.sitemaps.push(route);
        }
        await write('manifest.json.gz', gzipSync(JSON.stringify(manifest), { level: 6 }));
        await fs.writeFile(path.join(staging, 'integrity.json'), JSON.stringify({ sourceHash, indexHash: hash(indexBytes), files }, null, 2) + '\n');
        await fs.rm(destination, { recursive: true, force: true });
        await fs.rename(staging, destination);
        console.log(`Built ${Object.keys(files).length} files, ${(totalBytes / 1024 / 1024).toFixed(1)} MiB; ${people.length.toLocaleString()} politician pages. Data vintage: ${index.built}.`);
    } finally {
        sqlite.close();
        await modules.cleanup();
        await fs.rm(staging, { recursive: true, force: true });
    }
}
