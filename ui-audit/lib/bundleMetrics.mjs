/* bundleMetrics — the one place that reads a built dist/ and turns it into numbers.
 *
 * Extracted from perf-bundle-audit.mjs (NEW-1) so that THREE consumers compute the exact
 * same values from the exact same graph walk: the CI gate (perf-bundle-audit.mjs), the
 * ratchet step (scripts/perf-ratchet.mjs, which may only lower a baseline it measured
 * itself), and the byte-attribution report (NEW-3). A second, drifting implementation of
 * "what does a route cost" is how a budget quietly stops describing the thing it names.
 *
 * WHAT A ROUTE COSTS. Not "how big is each chunk" but "how much JS does a given ROUTE have
 * to download before it works". That needs the chunk graph, which Vite emits at
 * dist/.vite/manifest.json (build.manifest, vite.config.js): per chunk, `imports` are STATIC
 * dependencies (the browser must have them before the chunk can evaluate, and Vite emits
 * modulepreload hints for them) and `dynamicImports` are lazy ones (fetched only when that
 * import() actually runs). A route's cost is the transitive closure over `imports` only,
 * starting from the entry plus the route's own chunk.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, "..", "..");

/* Each route names its source module AND the chunk stem that module ends up as. Both are
 * needed: Vite keys a lazy chunk by its source path ONLY while that chunk stays a pure
 * facade of that one module. The moment the chunk also has to expose exports to another
 * chunk — which is exactly what happens when a lazily-imported module (B1042's exportSheet)
 * imports back into the planner's chunk — Rollup drops the facade and Vite re-keys the entry
 * by chunk name (`_SitePlannerApp-<hash>.js`, no `src`). The graph is unchanged; only the
 * lookup key is. Resolving by stem as well keeps the route budgets measuring the same thing
 * across that transition. */
export const ROUTE_KEYS = {
  site: { src: "src/workspaces/site-planner/SitePlannerApp.jsx", stem: "SitePlannerApp" },
  review: { src: "src/workspaces/doc-review/DocReview.jsx", stem: "DocReview" },
  library: { src: "src/workspaces/library/Library.jsx", stem: "Library" },
  scheduler: { src: "src/workspaces/scheduler/Scheduler.jsx", stem: "Scheduler" },
  notes: { src: "src/workspaces/notes/Notes.jsx", stem: "Notes" },
  food: { src: "src/workspaces/food/FoodApp.jsx", stem: "FoodApp" },
};

/* Chunk stem = the file name with Vite's content hash and extension stripped, so budgets can
 * name a chunk stably ("SitePlannerApp") across rebuilds that re-hash it.
 *
 * The hash segment is matched at EXACTLY 8 characters, which is what Vite emits, rather than
 * the "8 or more" this used to accept. Greedy-loose matching silently ate the tail of any
 * HYPHENATED chunk name — `map-vendor-BLBG5Rcw.js` came back as the stem "map", and
 * `cjs-interop-…` as "cjs" — which would have gone into the committed allowlist as a pair of
 * nonsense names that stop describing the chunks they guard the moment anyone reads them. */
export const stemOf = (file) =>
  file.replace(/^assets\//, "").replace(/-[A-Za-z0-9_-]{8}\.js$/, "").replace(/\.js$/, "");

export const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

/* NEW-3 — which bucket a module id belongs to. The three buckets answer the question a
 * failing budget run has to answer and today cannot: did this PR grow the APP, or did a
 * DEPENDENCY grow underneath it? They are deliberately coarse; a fourth "misc" bucket for
 * virtual/rollup-internal ids keeps the arithmetic honest rather than silently dropping
 * bytes into one of the named three. */
export function bucketOf(moduleId) {
  const id = moduleId.replace(/\\/g, "/");
  if (id.includes("node_modules")) return "vendor";
  if (/(^|\/)src\/(shared|app)\//.test(id)) return "app-shared";
  if (/(^|\/)src\//.test(id)) return "app-route";
  return "misc";
}

/* A vendor module's package name, for the "which dependency grew" line. Handles scopes
 * (@terraformer/arcgis-to-geojson-utils) and nested node_modules (a/node_modules/b → b). */
export function packageOf(moduleId) {
  const id = moduleId.replace(/\\/g, "/");
  const parts = id.split("node_modules/");
  const tail = parts[parts.length - 1];
  const seg = tail.split("/");
  return seg[0]?.startsWith("@") ? `${seg[0]}/${seg[1]}` : seg[0] || tail;
}

/* Load a built dist/. Returns null (never throws) when the build isn't there, so callers can
 * print their own instruction rather than a stack trace. */
export function loadBuild(distDir = join(ROOT, "dist")) {
  const manifestPath = join(distDir, ".vite", "manifest.json");
  if (!existsSync(manifestPath)) return null;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const modulesPath = join(distDir, ".vite", "chunk-modules.json");
  const chunkModules = existsSync(modulesPath) ? JSON.parse(readFileSync(modulesPath, "utf8")) : null;
  return { distDir, manifestPath, manifest, chunkModules };
}

export function measureBundle(build) {
  const { distDir, manifest, chunkModules } = build;
  const sizeOf = (file) => { try { return statSync(join(distDir, file)).size; } catch { return 0; } };

  /* Transitive closure over STATIC imports only. Manifest `imports` entries are manifest
   * KEYS (e.g. "index.html", "_hitTest-<hash>.js"), not file paths — resolve each through the
   * manifest before recursing. Cycles are possible, so track visited keys. */
  function staticClosure(startKeys) {
    const seen = new Set();
    const out = new Map(); // file -> bytes
    const walk = (key) => {
      if (seen.has(key)) return;
      seen.add(key);
      const entry = manifest[key];
      if (!entry) return;
      if (entry.file && entry.file.endsWith(".js")) out.set(entry.file, sizeOf(entry.file));
      for (const dep of entry.imports || []) walk(dep);
    };
    startKeys.forEach(walk);
    return out;
  }

  const entryKey = Object.keys(manifest).find((k) => manifest[k].isEntry) || "index.html";

  /* Resolve a route to its manifest key. Returns null only when the chunk genuinely is not in
   * the build — which the caller treats as a FAILURE, never a quiet omission: a route that
   * silently vanishes from a report takes its allowlist guard with it. */
  const routeKey = ({ src, stem }) => {
    if (manifest[src]) return src;
    return Object.keys(manifest).find((k) => {
      const f = manifest[k].file;
      return f && f.endsWith(".js") && stemOf(f) === stem;
    }) || null;
  };

  const routes = {};
  const missingRoutes = [];
  for (const [name, spec] of Object.entries(ROUTE_KEYS)) {
    const key = routeKey(spec);
    if (!key) { missingRoutes.push({ name, ...spec }); continue; }
    const closure = staticClosure([entryKey, key]);
    routes[name] = {
      chunks: [...closure.keys()].map((f) => ({ file: f, stem: stemOf(f), bytes: closure.get(f) }))
        .sort((a, b) => b.bytes - a.bytes),
      bytes: [...closure.values()].reduce((a, b) => a + b, 0),
    };
  }

  /* Every emitted JS chunk, for the totals — including ones no route statically reaches
   * (workers, and chunks only ever pulled by a dynamic import). */
  const assetsDir = join(distDir, "assets");
  const allJs = existsSync(assetsDir)
    ? readdirSync(assetsDir).filter((f) => f.endsWith(".js"))
      .map((f) => ({ file: `assets/${f}`, stem: stemOf(`assets/${f}`), bytes: sizeOf(`assets/${f}`) }))
    : [];
  const totalJsBytes = allJs.reduce((a, c) => a + c.bytes, 0);
  const largest = allJs.slice().sort((a, b) => b.bytes - a.bytes)[0] || { stem: "(none)", bytes: 0 };

  return { routes, missingRoutes, allJs, totalJsBytes, largest, chunkModules, entryKey };
}

/* ---- NEW-3: byte attribution ------------------------------------------------------------
 * The Vite manifest knows the chunk graph but not what is INSIDE a chunk, so a breach can
 * only ever say "this chunk is 20 KB bigger" — which reads identically for a 20 KB feature
 * and a 20 KB dependency bump. The chunk-modules plugin in vite.config.js writes each chunk's
 * per-module rendered size alongside the manifest; this folds those into buckets.
 *
 * HONEST LIMIT, stated where the numbers are produced: rollup reports `renderedLength`, which
 * is the module's size AFTER tree-shaking and transforms but BEFORE the chunk is minified as
 * a whole. The chunk's real on-disk size is smaller. Every attributed number below is
 * therefore SCALED by (on-disk bytes / summed renderedLength) for that chunk, so the buckets
 * add up to the chunk's actual size. That makes the split proportionally faithful and the
 * totals exact; it does NOT make any single module's number a precise minified size.
 */
export function attributeBytes(measured, { chunkModules } = measured) {
  if (!chunkModules) return null;
  const byChunk = {};
  for (const chunk of measured.allJs) {
    const mods = chunkModules[chunk.file];
    if (!mods) continue;
    const rendered = Object.values(mods).reduce((a, b) => a + b, 0);
    const scale = rendered > 0 ? chunk.bytes / rendered : 0;
    const buckets = { vendor: 0, "app-shared": 0, "app-route": 0, misc: 0 };
    const modules = {};
    for (const [id, len] of Object.entries(mods)) {
      const bytes = Math.round(len * scale);
      buckets[bucketOf(id)] += bytes;
      modules[id] = bytes;
    }
    byChunk[chunk.file] = { stem: chunk.stem, bytes: chunk.bytes, buckets, modules };
  }

  /* Per route: sum the buckets of every chunk on that route's static closure. */
  const byRoute = {};
  for (const [name, r] of Object.entries(measured.routes)) {
    const buckets = { vendor: 0, "app-shared": 0, "app-route": 0, misc: 0 };
    let covered = 0;
    for (const c of r.chunks) {
      const a = byChunk[c.file];
      if (!a) continue;
      covered += c.bytes;
      for (const k of Object.keys(buckets)) buckets[k] += a.buckets[k];
    }
    byRoute[name] = { bytes: r.bytes, covered, buckets };
  }

  /* Flat module → bytes map across the whole build, for the head-to-head diff. */
  const modules = {};
  for (const a of Object.values(byChunk)) {
    for (const [id, bytes] of Object.entries(a.modules)) modules[id] = (modules[id] || 0) + bytes;
  }
  const packages = {};
  for (const [id, bytes] of Object.entries(modules)) {
    if (bucketOf(id) !== "vendor") continue;
    const p = packageOf(id);
    packages[p] = (packages[p] || 0) + bytes;
  }
  return { byChunk, byRoute, modules, packages };
}

/* The portable shape written by --emit-stats and read by --compare. Deliberately small: the
 * headline metrics plus the flat module/package maps, no chunk hashes (which change every
 * build and would make every diff line noise). */
export function statsSnapshot(measured, attribution, meta = {}) {
  return {
    version: 1,
    ...meta,
    metrics: {
      siteRouteJsBytes: measured.routes.site?.bytes ?? null,
      siteRouteChunks: measured.routes.site?.chunks.length ?? null,
      // B266084 — the Notes route rides the snapshot too, so its budget can be attributed
      // between the base ref and the branch like every other banded metric. A base snapshot
      // written before this field existed simply reports `null` and falls back to the
      // un-attributed verdict.
      notesRouteJsBytes: measured.routes.notes?.bytes ?? null,
      // B568400 — the /food route, measured separately forever per the owner's explicit ask
      // that a restaurant tracker never share a metric with (or draw headroom from) the
      // routes that matter to the actual product.
      foodRouteJsBytes: measured.routes.food?.bytes ?? null,
      totalJsBytes: measured.totalJsBytes,
      largestChunkBytes: measured.largest.bytes,
      largestChunkStem: measured.largest.stem,
    },
    routeBuckets: attribution?.byRoute ?? null,
    modules: attribution?.modules ?? null,
    packages: attribution?.packages ?? null,
  };
}

/** Metric units, so a chunk COUNT is never printed as a byte delta. */
export const METRIC_UNITS = {
  siteRouteJsBytes: "bytes",
  notesRouteJsBytes: "bytes",
  foodRouteJsBytes: "bytes",
  totalJsBytes: "bytes",
  largestChunkBytes: "bytes",
  siteRouteChunks: "chunks",
};

/* Diff two snapshots. Returns per-metric deltas plus the modules and packages that moved,
 * biggest mover first — the "WHICH modules grew and by how much" the NEW-3 brief asks for.
 *
 * `attributionComparable` is false when the BASE snapshot has no per-module data — a base ref
 * that predates the chunk-module stats plugin, for instance. In that case the module, package
 * and bucket sections are withheld entirely rather than diffed against nothing: subtracting
 * from an absent base makes every module in the build look like it was added this PR, which is
 * worse than saying nothing at all. */
export function diffSnapshots(base, head, { minBytes = 256, top = 12 } = {}) {
  const metrics = {};
  for (const k of Object.keys(head.metrics || {})) {
    if (typeof head.metrics[k] !== "number") continue;
    const b = base?.metrics?.[k];
    metrics[k] = {
      base: typeof b === "number" ? b : null,
      head: head.metrics[k],
      delta: typeof b === "number" ? head.metrics[k] - b : null,
      unit: METRIC_UNITS[k] || "bytes",
    };
  }
  const attributionComparable = !!(base?.modules && head.modules);
  if (!attributionComparable) return { metrics, attributionComparable, bucketDelta: {}, modules: [], packages: [] };
  const moved = (baseMap, headMap) => {
    const ids = new Set([...Object.keys(baseMap || {}), ...Object.keys(headMap || {})]);
    return [...ids]
      .map((id) => ({ id, base: baseMap?.[id] || 0, head: headMap?.[id] || 0, delta: (headMap?.[id] || 0) - (baseMap?.[id] || 0) }))
      .filter((r) => Math.abs(r.delta) >= minBytes)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, top);
  };
  const bucketDelta = {};
  for (const route of Object.keys(head.routeBuckets || {})) {
    const hb = head.routeBuckets[route]?.buckets || {};
    const bb = base?.routeBuckets?.[route]?.buckets || {};
    bucketDelta[route] = Object.fromEntries(Object.keys(hb).map((k) => [k, (hb[k] || 0) - (bb[k] || 0)]));
  }
  return {
    metrics,
    attributionComparable,
    bucketDelta,
    modules: moved(base?.modules, head.modules),
    packages: moved(base?.packages, head.packages),
  };
}
