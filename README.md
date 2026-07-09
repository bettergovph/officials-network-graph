## Network Graph of Elected Philippine Officials, 2004-2016

A network graph visualization of regional elected Philippine officials from 2004-2016.

Can be used to spot potential political dynasties at a glance by looking at the surname (red) nodes by size. Surname node sizes are proportional to the number of elected individual officials with the same surnames in a region.

This project uses [Node.js](https://nodejs.org), [TypeScript](http://www.typescriptlang.org/), [Sigma.js](https://www.sigmajs.org/), and [Vite](https://vite.dev).

### Installation and Build

1. Install Node.js/NPM
2. Type ```npm install``` in console.
3. Change ```base: '/officials_network_graph/'``` in vite.config.ts to your remote server relative path.
4. Type ```npm run build``` in console.
5. Type ```npx vite``` in console. It will give a localhost address you can test locally on.

### Deployment
Upload the contents of the ```./dist``` folder to your server.

