import { defineConfig } from "vite";

// Minimal Vite config — Vite handles TypeScript and ESM dependencies out of the box
export default defineConfig({
  root: ".",
  base: '/officials_network_graph/',
  build: {
    outDir: "dist",
    assetsDir: './assets',
    emptyOutDir: true
  }
});
