import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";

// Most Esri ArcGIS services (ArcGIS Online + ArcGIS Server 10.1+) send permissive
// CORS headers, so the county parcel lookup normally works with direct browser
// fetches. If a particular county server blocks CORS, uncomment the matching proxy
// entry below and point that county's URL in src/lib/counties.js at the local path
// (e.g. "/gis-harris/HCAD/Parcels/MapServer/0").
export default defineConfig(({ command }) => ({
  // Relative asset paths so the production build works when served from a
  // GitHub Pages subfolder (https://<user>.github.io/<repo>/), while local
  // `npm run dev` still serves from the root.
  base: command === "build" ? "./" : "/",
  plugins: [
    react(),
    // In dev, Vite's SPA fallback would serve the main index.html for /sequence/.
    // This plugin intercepts /sequence/ (and /sequence/index.html) and serves the
    // standalone scheduler HTML directly, matching production Cloudflare behavior.
    {
      name: "serve-sequence-standalone",
      configureServer(server) {
        const file = path.resolve("public/sequence/index.html");
        server.middlewares.use("/sequence", (req, res, next) => {
          const url = req.url ?? "";
          if (url === "/" || url === "" || url === "/index.html") {
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.end(fs.readFileSync(file));
            return;
          }
          next();
        });
      },
    },
  ],
  server: {
    host: true,
    proxy: {
      // "/gis-harris": {
      //   target: "https://www.gis.hctx.net/arcgis/rest/services",
      //   changeOrigin: true,
      //   secure: true,
      //   rewrite: (p) => p.replace(/^\/gis-harris/, ""),
      // },
      // "/gis-fortbend": {
      //   target: "https://gis.fbcad.org/serverarcgis2/rest/services",
      //   changeOrigin: true,
      //   secure: true,
      //   rewrite: (p) => p.replace(/^\/gis-fortbend/, ""),
      // },
    },
  },
}));
