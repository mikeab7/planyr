import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

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
  plugins: [react()],
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
