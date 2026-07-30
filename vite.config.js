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

/* NEW-3 — per-chunk module attribution, written next to the manifest as
 * dist/.vite/chunk-modules.json. The Vite manifest knows the chunk GRAPH but nothing about
 * what is INSIDE a chunk, which is why a failing budget run could only ever say "this chunk
 * grew 20 KB" — a sentence that reads identically for a 20 KB feature and a 20 KB dependency
 * bump, and cost a local build to disambiguate every single time. Rollup already has the
 * answer in `chunk.modules`; this just writes it down. Free (no extra parse, no new
 * dependency) and inert at runtime — nothing in the app reads it.
 *
 * Module ids are made CWD-relative on purpose: the base-ref comparison builds the base commit
 * in a separate git worktree, and absolute paths would make every module look like it moved. */
function chunkModuleStats() {
  return {
    name: "chunk-module-stats",
    generateBundle(_options, bundle) {
      const out = {};
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== "chunk" || !fileName.endsWith(".js")) continue;
        const mods = {};
        for (const [id, info] of Object.entries(chunk.modules || {})) {
          const len = info?.renderedLength || 0;
          if (!len) continue;
          const rel = path.isAbsolute(id) ? path.relative(process.cwd(), id) : id;
          mods[rel.replace(/\\/g, "/")] = len;
        }
        out[fileName] = mods;
      }
      this.emitFile({ type: "asset", fileName: ".vite/chunk-modules.json", source: JSON.stringify(out) });
    },
  };
}

/* NEW-2 — the map/geometry vendor closure gets its own chunk.
 *
 * WHAT THIS DOES AND, JUST AS IMPORTANTLY, WHAT IT DOES NOT. It does NOT reduce
 * `siteRouteJsBytes`: the same bytes still download on a Site route, because the planner
 * needs leaflet at first paint and clipper at the road-network dissolve. Anyone reading this
 * as "the planner got lighter" has read it wrong. What it does buy is two real things:
 *   1. `largestChunkBytes` measures the biggest INDIVISIBLE unit the browser must parse and
 *      compile before anything runs. Splitting a 1.7 MB unit into two smaller ones lets that
 *      work interleave instead of blocking as one lump.
 *   2. CACHE INVALIDATION, which is the bigger everyday win. With one chunk, every planner
 *      edit re-hashes the file that also contains leaflet + clipper + esri-leaflet, so a
 *      returning user re-downloads ~310 KB of libraries that did not change. Split out, those
 *      bytes keep their hash across a release and come from cache.
 *
 * Deliberately NARROW. Only the map/geometry closure moves; react/react-dom stay in the
 * shared entry chunk (they are on EVERY route, so a separate chunk would add a request
 * without adding cache stability), and nothing app-owned moves at all. B1064's "do NOT reach
 * for manualChunks" note stands for what it was aimed at — using it to make a route budget
 * LOOK better without making the app faster — which is exactly why the honest limit is stated
 * above rather than claimed away.
 *
 * ⚠ THE TRAP THIS HIT, WRITTEN DOWN SO THE NEXT PERSON DOESN'T PAY FOR IT AGAIN. Rollup's
 * CommonJS interop helper (`\0commonjsHelpers.js`) is shared by every chunk that consumes a
 * CJS dependency. With default chunking it lives in the ENTRY chunk, which every route loads
 * anyway, so it is free. Adding a manual chunk makes that chunk entry-like for the purposes of
 * rollup's dependent-entry grouping, and because the helper is tiny it then gets merged into
 * the new chunk by `experimentalMinChunkSize` — at which point EVERY route statically imports
 * the map vendor chunk to reach a few hundred bytes of interop. Measured: Review 1248.9 →
 * 1557.1 KB, Library 675.1 → 983.3 KB, Scheduler 553.1 → 861.3 KB. That is a straight
 * regression on three routes, and it is invisible unless you look. Pinning the helper to its
 * own `cjs-interop` chunk breaks the merge: the helper stays shared and ~0.3 KB, and the map
 * bytes stay on the routes that actually use a map. */
const MAP_VENDOR = ["leaflet", "esri-leaflet", "clipper-lib", "@terraformer"];
function mapVendorChunk(id) {
  const norm = id.replace(/\\/g, "/");
  // Keep the shared CJS interop helper out of any vendor chunk — see the trap note above.
  if (/commonjsHelpers/.test(norm) && !norm.includes("node_modules")) return "cjs-interop";
  if (!norm.includes("node_modules")) return undefined;
  const after = norm.slice(norm.lastIndexOf("node_modules/") + "node_modules/".length);
  const pkg = after.startsWith("@") ? after.split("/").slice(0, 2).join("/") : after.split("/")[0];
  return MAP_VENDOR.includes(pkg) ? "map-vendor" : undefined;
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
  build: {
    // Emit dist/.vite/manifest.json — the chunk graph (per-chunk `imports` = static deps,
    // `dynamicImports` = lazy deps, plus each chunk's file name). The performance-budget
    // audit (NEW-8, ui-audit/perf-bundle-audit.mjs) walks it to compute what a given ROUTE
    // actually has to download, which is the number a budget should cap — a per-chunk size
    // table can't tell you that. Inert at runtime: nothing in the app reads the manifest,
    // and Cloudflare Pages just serves it as one more static file.
    manifest: true,
    rollupOptions: {
      output: {
        // NEW-2 — see mapVendorChunk above for what this buys and what it does not.
        manualChunks: mapVendorChunk,
      },
    },
  },
  plugins: [
    react(),
    pdfjsAssets(),
    chunkModuleStats(),
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
    // The standalone marketing landing page (public/landing/index.html) is a
    // self-contained document with its own vendored GSAP/Three.js — same standalone
    // model as /sequence/. In dev, Vite's SPA fallback would otherwise serve the main
    // app index.html for a bare "/landing/" directory request; intercept it so the
    // landing page renders. Its assets (/landing/vendor/*) fall through to Vite's
    // static public/ serving. Production (Cloudflare Pages) serves it as a real static
    // file from dist/landing/, so no preview/prod config is needed.
    {
      name: "serve-landing-standalone",
      configureServer(server) {
        const file = path.resolve("public/landing/index.html");
        server.middlewares.use("/landing", (req, res, next) => {
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
