import { defineConfig } from "vite";

// Minimal Vite config — Vite handles TypeScript and ESM dependencies out of the box.
// Cloudflare deploys this app at the domain root, so use a root-relative base.
export default defineConfig({
  root: ".",
  base: "/",
  plugins: [],
  build: {
    outDir: "dist",
    assetsDir: "assets",
    emptyOutDir: true
  }
});
