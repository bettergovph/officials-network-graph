## Dynasties: the political map of the Philippines, 2001-2025

Every candidate for local office in the Philippines since 2001, who won, who lost, who keeps coming back, and which surnames hold the seats. Browse by region, province and town, look up a politician, or open the surname-bloc analysis.

View the project at [https://officials.bettergov.ph](https://officials.bettergov.ph).

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
- The site is a Vite + TypeScript single-page app (`src/`) using [D3](https://d3js.org/) and [Leaflet](https://leafletjs.com/) with OpenStreetMap tiles. Pages read the static shards; search uses the API when deployed and falls back to a static index otherwise.
- `worker/index.ts` is a Cloudflare Worker serving the built site and a small JSON API over D1 (`/api/search`, `/api/person/:id`, `/api/contest/:id`, `/api/place/:province[/:city]`, `/api/persons`, `/api/stats`).

### Development

```bash
npm install
npm run data        # download sources, build data/dynasty.sqlite, data/d1, public/data, docs/coverage.md, then boundaries (~2 min)
npm run dev         # Vite dev server (static pages work; /api falls back to the static index)
npm run check       # type-check the app and the worker
npm run preview     # production build served by wrangler dev, with the API
```

### Deployment

Cloudflare Workers with static assets and a D1 database named `dynasty`, configured in `wrangler.jsonc`. With `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` set:

```bash
npm run d1:import   # load data/d1/*.sql into D1 (drops and recreates the tables)
npm run deploy      # build and deploy the worker
```

### Data Sources

- 2001-2025 winners and 2010-2025 candidates and votes: [Open Halalan: The Philippine National and Local Election Dataset](https://robertrleung.github.io/OpenHalalan/)
- Poverty incidence: [Philippine Statistics Authority](https://openstat.psa.gov.ph/PXWeb/pxweb/en/DB/DB__1E__FY/?tablelist=true)
- Boundaries: [philippines-json-maps](https://github.com/faeldon/philippines-json-maps) (PSGC 2023), derived from PSA and OpenStreetMap data
