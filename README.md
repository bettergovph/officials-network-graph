## Dynasties: Philippine Local Election Winners, 2016-2025

Surname blocs among elected Philippine local officials, built from the 2016, 2019, 2022 and 2025 election winners.

A *bloc* is the set of officials in one province who carry a surname as their last name or middle name. Blocs are ranked by size so potential political dynasties can be spotted at a glance. Three views share one set of controls (year, region or province scope, minimum bloc size, surname search):

- **Atlas**: a map where each province bubble is sized by the number of officials in blocs and colored by their share of the province's seats.
- **Network**: a force-directed graph linking provinces, surnames, officials and cities.
- **Ledger**: a sortable table of every bloc with seats, share, highest post, parties, votes and poverty incidence.

Clicking a surname anywhere opens a detail panel listing each official, their posts by year, linked surnames in the same province, and the same surname in other provinces.

View the project at [https://officials.bettergov.ph](https://officials.bettergov.ph).

This project uses [Node.js](https://nodejs.org), [TypeScript](http://www.typescriptlang.org/), [D3](https://d3js.org/), [Leaflet](https://leafletjs.com/) with [OpenStreetMap](https://www.openstreetmap.org/) tiles, and [Vite](https://vite.dev).

### Installation and Build

1. Install Node.js/NPM
2. Type ```npm install``` in console.
3. Type ```npm run build``` in console.
4. Type ```npx vite``` in console. It will give a localhost address you can test locally on.

### Deployment
This repository is configured for Cloudflare Workers Static Assets via ```wrangler.jsonc```.

```bash
npm run deploy
```

The Cloudflare deployment serves the Vite build output from ```./dist``` and uses SPA fallback handling for direct route loads.

### Data Sources

- 2016-2025 Election Data: [Open Halalan: The Philippine National and Local Election Dataset](https://robertrleung.github.io/OpenHalalan/)
- Poverty Data: [Philippine Statistics Authority](https://openstat.psa.gov.ph/PXWeb/pxweb/en/DB/DB__1E__FY/?tablelist=true)
- 2004-2016 data from the [Ateneo Policy Center (APC) Political Dynasty Dataset](https://www.inclusivedemocracy.ph/data-and-infographics) remains in `public/` but is not used by the current views, since it lacks the middle-name and vote fields the bloc model depends on.

