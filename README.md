## Dynasties: the political map of the Philippines, 2001-2025

Every candidate for local office in the Philippines since 2001, who won, who lost, who keeps coming back, and which surnames hold the seats. Browse by region, province and town, look up a politician, or open the surname-bloc analysis.

View the project at [https://dynasties.bettergov.ph](https://dynasties.bettergov.ph). The API and MCP server answer at [https://officials.bettergov.ph](https://officials.bettergov.ph).

### What is in it

- **National**: presidential, vice presidential, senate and party-list totals per election, plus each province's share on its page.
- **Regional**: national totals, then regions, provinces and towns. Every contest with its candidates, votes, vote share, margin and result.
- **Officials Search**: search, one record per politician with their full election history, and lists of repeat politicians by wins, runs and losses.
- **Dynasties**: surname blocs per province in three views. The atlas colors provinces by the share of their seats held in blocs, draws region outlines, and shows a province's towns when it is focused. It opens on the latest election and one region; loading the whole country or every election is optional because it is heavy.
- **Search**: politicians by surname or "Surname, First name", and places.

A *bloc* is the set of officials in one province who carry a surname as last name or middle name. People are matched across elections by surname, first name and middle name within a province; see [docs/coverage.md](docs/coverage.md) for how well the sources join and the known gaps.

### How it is built

- `scripts/build-data.ts` downloads the two [Open Halalan](https://robertrleung.github.io/OpenHalalan/) releases (winners 2001-2025 and vote counts 2010-2025), links winners to vote rows, resolves people, and writes:
  - `data/dynasty.sqlite`: the full relational database (`db/schema.sql`), not committed;
  - `data/d1/*.sql`: the same data as chunked SQL for Cloudflare D1, not committed;
  - `public/data/**`: gzipped shards the site loads on demand (committed, about 17 MB);
  - `docs/coverage.md`: coverage report.
- `scripts/build-geo.ts` (`npm run geo`, also run by `npm run data`) downloads PSGC 2023 boundaries from [philippines-json-maps](https://github.com/faeldon/philippines-json-maps), matches them to our provinces and towns, simplifies them, and writes `public/data/geo/`.
- The site is a Vite + TypeScript single-page app (`src/`) using [D3](https://d3js.org/) and [Leaflet](https://leafletjs.com/) with OpenStreetMap tiles. Browsing and search read static JSON shards. Server-rendered page summaries also use generated JSON, including every politician's page, so browsing does not query D1 even on a cold edge cache.
- `scripts/build-snapshots.mjs` reads the existing local SQLite database without modifying it and generates `public/data/snapshots/`: API summaries, province/town and national results, first-page leaderboards, browser search records, page summaries, and XML sitemaps. The committed snapshots are deployed with the other static assets. `npm run build` verifies their checksums and source/data versions before bundling.
- `worker/index.ts` is a Cloudflare Worker serving the built site and a small JSON API over D1 (`/api/search`, `/api/person/:id`, `/api/contest/:id`, `/api/place/:province[/:city]`, `/api/persons`, `/api/stats`).

### API and MCP

The same Worker serves a read-only JSON API under `/api/v1` and a Model Context Protocol server at `/mcp`, both over the D1 database, on `officials.bettergov.ph`. See [docs/api.md](docs/api.md) or the site's API & MCP page.

### Development

```bash
npm install
npm run data        # download sources, build data/dynasty.sqlite, data/d1, public/data, docs/coverage.md, then boundaries (~2 min)
npm run data:snapshots # regenerate snapshots from the existing local SQLite database; no downloads or D1 calls
npm run dev         # Vite dev server (browsing and search use static files)
npm run check       # type-check the app and the worker
npm test            # verify result caching and REST/MCP behavior without remote D1 calls
npm run preview     # production build served by wrangler dev, with the API
```

### Deployment

Cloudflare Workers with static assets and a D1 database named `dynasty`, configured in `wrangler.jsonc`. With `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` set:

```bash
npm run d1:import   # load data/d1/*.sql into D1 (drops and recreates the tables)
npm run deploy      # build and deploy the worker
```

With `STATIC_DATA=1`, stable REST/MCP operations, all server-rendered pages, browser search and sitemaps use generated files. Flexible API filters and direct API searches still use D1 with the existing result cache. Snapshots persist until rebuilt; edge cache expiry never causes these static routes to query D1. To publish data changes, update the matching local SQLite database and browser dataset, run `npm run data:snapshots`, include the generated files, and deploy alongside the D1 update. Changing `CACHE_VERSION` alone does not refresh static data. See [static snapshots](docs/api.md#static-snapshots) for coverage and verification headers.

### Data Sources

- 2001-2025 winners and 2010-2025 candidates and votes: [Open Halalan: The Philippine National and Local Election Dataset](https://robertrleung.github.io/OpenHalalan/)
- Poverty incidence: [Philippine Statistics Authority](https://openstat.psa.gov.ph/PXWeb/pxweb/en/DB/DB__1E__FY/?tablelist=true)
- Boundaries: [philippines-json-maps](https://github.com/faeldon/philippines-json-maps) (PSGC 2023), derived from PSA and OpenStreetMap data
