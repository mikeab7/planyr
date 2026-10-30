import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../..", import.meta.url));
export default defineConfig({
  root, plugins: [react()], server: { port: 5198, strictPort: true, open: false },
  build: { outDir: "dist-univer-sandbox", emptyOutDir: true, rollupOptions: { input: fileURLToPath(new URL("./index.html", import.meta.url)) } },
  optimizeDeps: { include: ["@univerjs/presets", "@univerjs/preset-sheets-core"] },
});
