## Network Graph of Elected Philippine Officials, 2004-2025

A network graph visualization of regional elected Philippine officials from 2004-2025.

Can be used to spot potential political dynasties at a glance by looking at the surname (red) nodes by size. Surname node sizes are proportional to the number of elected individual officials with the same surnames in a region.

This project uses [Node.js](https://nodejs.org), [TypeScript](http://www.typescriptlang.org/), [Sigma.js](https://www.sigmajs.org/), and [Vite](https://vite.dev).

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

### To Fix
- Need to turn surname information popup name entry positions into array to list all the years official was elected, not just 1st one.

### Data Sources

- 2004-2016 Election Data: [Ateneo Policy Center (APC) Political Dynasty Dataset](https://www.inclusivedemocracy.ph/data-and-infographics)
- 2019-2025 Election Data: [Open Halalan: The Philippine National and Local Election Dataset](https://robertrleung.github.io/OpenHalalan/)
- Poverty Data: [Philippine Statistics Authority](https://openstat.psa.gov.ph/PXWeb/pxweb/en/DB/DB__1E__FY/?tablelist=true)

