## Network Graph of Elected Philippine Officials, 2004-2016

A network graph visualization of regional elected Philippine officials from 2004-2016.

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

