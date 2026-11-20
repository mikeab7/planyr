import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import univerPrune from "../../scripts/vite-plugin-univer-prune.mjs";
const root = fileURLToPath(new URL("../..", import.meta.url));
export default defineConfig({
  root, plugins: [react(), univerPrune()], worker: { plugins: () => [univerPrune()] }, server: { port: 5198, strictPort: true, open: false },
  build: { outDir: "dist-univer-sandbox", emptyOutDir: true, rollupOptions: { input: [fileURLToPath(new URL("./index.html", import.meta.url)), fileURLToPath(new URL("./lazy.html", import.meta.url))] } },
  optimizeDeps: { include: ["@univerjs/presets", "@univerjs/preset-sheets-core"] },
});
