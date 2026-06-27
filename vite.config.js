import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

// PDF.js (v6) renders correctly only when it can fetch its support assets at runtime:
// substitute fonts (non-embedded text), CMaps (CID/CJK fonts), an ICC profile (CMYK
// colour), and the WASM image decoders (JBIG2 scanned B&W, OpenJPEG/JPX scans). These
// ship as on-disk folders in pdfjs-dist/ and are NOT in the worker bundle. This plugin
// exposes them at `<base>pdfjs/<folder>/…` — served straight from node_modules in dev,
// emitted into the build output for production — so getDocument's *Url options resolve
// (see src/workspaces/doc-review/lib/pdf.js). Sourcing from node_modules keeps them in
// lock-step with the installed pdfjs-dist version (no committed, drift-prone copies).
const PDFJS_ASSET_DIRS = ["standard_fonts", "cmaps", "iccs", "wasm"];
function pdfjsAssets() {
  const pdfjsRoot = path.dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
  const MIME = { ".wasm": "application/wasm", ".js": "text/javascript", ".mjs": "text/javascript",
    ".bcmap": "application/octet-stream", ".pfb": "application/octet-stream", ".icc": "application/octet-stream" };
  return {
    name: "pdfjs-assets",
    // Dev: stream each requested file out of node_modules/pdfjs-dist.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const reqPath = (req.url || "").split("?")[0];
        const hit = reqPath.match(/\/pdfjs\/([^/]+)\/(.+)$/);
        if (!hit || !PDFJS_ASSET_DIRS.includes(hit[1])) return next();
        const rel = path.normalize(`${hit[1]}/${decodeURIComponent(hit[2])}`);
        if (rel.startsWith("..")) return next();
        const file = path.join(pdfjsRoot, rel);
        fs.readFile(file, (err, buf) => {
          if (err) return next();
          res.setHeader("Content-Type", MIME[path.extname(file)] || "application/octet-stream");
          res.end(buf);
        });
      });
    },
    // Build: emit every file under each folder into <outDir>/pdfjs/<folder>/ verbatim
    // (explicit fileName → no content hashing, so pdf.js's `${url}${name}` paths hold).
    generateBundle() {
      for (const dir of PDFJS_ASSET_DIRS) {
        const abs = path.join(pdfjsRoot, dir);
        let names = [];
        try { names = fs.readdirSync(abs); } catch { continue; }
        for (const name of names) {
          const f = path.join(abs, name);
          if (!fs.statSync(f).isFile()) continue;
          this.emitFile({ type: "asset", fileName: `pdfjs/${dir}/${name}`, source: fs.readFileSync(f) });
        }
      }
    },
  };
}

// Build identifier (short git SHA, timestamp fallback) baked into the bundle so the
// error-telemetry rows (B279) can be traced back to the exact deploy that produced them.
const BUILD_ID = (() => {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString().trim() || String(Date.now());
  } catch {
    return String(Date.now());
  }
})();

// Most Esri ArcGIS services (ArcGIS Online + ArcGIS Server 10.1+) send permissive
// CORS headers, so the county parcel lookup normally works with direct browser
// fetches. If a particular county server blocks CORS, uncomment the matching proxy
// entry below and point that county's URL in src/lib/counties.js at the local path
// (e.g. "/gis-harris/HCAD/Parcels/MapServer/0").
export default defineConfig(({ command }) => ({
  // Absolute (root) asset paths. Production is Cloudflare Pages served at the domain
  // root (planyr.io) — root-absolute /assets/… URLs resolve identically on every page
  // and avoid the relative-path ambiguity that made a missing chunk easy to mis-serve
  // (B451). The retired GitHub Pages subfolder deploy is the only thing that needed the
  // old relative "./" base; set PLANYR_BASE if a subpath build is ever resurrected.
  base: command === "build" ? (process.env.PLANYR_BASE || "/") : "/",
  // Compile-time constant for error telemetry (B279); read via a typeof guard in
  // src/shared/telemetry/clientErrors.js (falls back to "dev" under dev/test).
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [
    react(),
    pdfjsAssets(),
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
