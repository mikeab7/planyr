#!/usr/bin/env node
/* perf-bundle-audit — the CI-gated half of the standing performance budget (NEW-8).
 *
 * WHAT IT CHECKS, and why this half is the one that gates a merge:
 * bundle weight is the only performance metric that is fully DETERMINISTIC. It falls out
 * of the build with no browser, no network, and no CPU-contention noise, so a breach is
 * unambiguously attributable to the pull request that caused it. The runtime half (frame
 * time, heap, tiles — ui-audit/perf-harness.mjs) is measured in a real browser and is too
 * sensitive to CI-runner load to gate a merge on; see docs/PERF-BUDGETS.md.
 *
 * The number that matters is NOT "how big is each chunk" — it is "how much JS does a
 * given ROUTE have to download before it works". That needs the chunk graph, which Vite
 * emits at dist/.vite/manifest.json (build.manifest, vite.config.js): per chunk, `imports`
 * are STATIC dependencies (the browser must have them before the chunk can evaluate, and
 * Vite emits modulepreload hints for them) and `dynamicImports` are lazy ones (fetched
 * only when that import() actually runs). A route's cost is therefore the transitive
 * closure over `imports` only, starting from the entry plus the route's own chunk.
 *
 * The siteRouteChunks + siteRouteAllowlist budgets are the REGRESSION GUARD for NEW-9:
 * before that fix, a boot-time idle prefetch warmed every workspace, so a plain Site route
 * pulled all 11 chunks (~805 KB of JS it never executes). Because that prefetch was a
 * runtime import() rather than a static edge, no size-per-chunk table would have caught
 * it — but the allowlist does, by name, the moment a foreign chunk reappears on the route.
 *
 *   node ui-audit/perf-bundle-audit.mjs           # human report; exit 1 on a ceiling breach
 *   node ui-audit/perf-bundle-audit.mjs --json    # machine-readable
 *
 * Run it after `npm run build`. Requires dist/.vite/manifest.json.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const DIST = join(ROOT, "dist");
const MANIFEST = join(DIST, ".vite", "manifest.json");
const BUDGETS = join(HERE, "perf-budgets.json");

const JSON_OUT = process.argv.includes("--json");

if (!existsSync(MANIFEST)) {
  console.error(`✗ ${MANIFEST} not found — run \`npm run build\` first.`);
  console.error("  (If the manifest is missing from a fresh build, check that build.manifest is still true in vite.config.js.)");
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const budgets = JSON.parse(readFileSync(BUDGETS, "utf8"));

/* Chunk stem = the file name with Vite's content hash and extension stripped, so budgets
 * can name a chunk stably ("SitePlannerApp") across rebuilds that re-hash it. */
const stemOf = (file) => file.replace(/^assets\//, "").replace(/-[A-Za-z0-9_-]{8,}\.js$/, "").replace(/\.js$/, "");
const sizeOf = (file) => { try { return statSync(join(DIST, file)).size; } catch { return 0; } };

/* Transitive closure over STATIC imports only. Manifest `imports` entries are manifest
 * KEYS (e.g. "index.html", "_hitTest-<hash>.js"), not file paths — resolve each through
 * the manifest before recursing. Cycles are possible, so track visited keys. */
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
const ROUTE_KEYS = {
  site: "src/workspaces/site-planner/SitePlannerApp.jsx",
  review: "src/workspaces/doc-review/DocReview.jsx",
  library: "src/workspaces/library/Library.jsx",
  scheduler: "src/workspaces/scheduler/Scheduler.jsx",
};

const routes = {};
for (const [name, key] of Object.entries(ROUTE_KEYS)) {
  if (!manifest[key]) continue; // a workspace that was renamed/removed simply drops out of the report
  const closure = staticClosure([entryKey, key]);
  routes[name] = {
    chunks: [...closure.keys()].map((f) => ({ file: f, stem: stemOf(f), bytes: closure.get(f) }))
      .sort((a, b) => b.bytes - a.bytes),
    bytes: [...closure.values()].reduce((a, b) => a + b, 0),
  };
}

/* Every emitted JS chunk, for the totals — including ones no route statically reaches
 * (workers, and chunks only ever pulled by a dynamic import). */
const allJs = existsSync(join(DIST, "assets"))
  ? readdirSync(join(DIST, "assets")).filter((f) => f.endsWith(".js")).map((f) => ({ file: `assets/${f}`, stem: stemOf(`assets/${f}`), bytes: sizeOf(`assets/${f}`) }))
  : [];
const totalJsBytes = allJs.reduce((a, c) => a + c.bytes, 0);
const largest = allJs.slice().sort((a, b) => b.bytes - a.bytes)[0] || { stem: "(none)", bytes: 0 };

/* ---- Evaluate against the committed budgets ------------------------------------------- */
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const fmt = (v, unit) => (unit === "bytes" ? kb(v) : `${v}${unit === "chunks" ? "" : ` ${unit}`}`);

const failures = [];   // ceiling breaches — these fail the build
const aboveTarget = []; // knowingly out of budget — reported loudly, never silently passed
const passes = [];

function check(path, value, spec) {
  const { ceiling, target, unit = "bytes" } = spec;
  const row = { metric: path, value, ceiling, target, unit };
  if (value > ceiling) {
    failures.push({ ...row, delta: value - ceiling, pct: ((value / ceiling - 1) * 100) });
  } else if (target != null && value > target) {
    aboveTarget.push({ ...row, gap: value - target, owner: budgets.targetOwner?.[path] || null });
  } else {
    passes.push(row);
  }
}

const b = budgets.bundle;
const site = routes.site;
if (site) {
  check("bundle.siteRouteJsBytes", site.bytes, b.siteRouteJsBytes);
  check("bundle.siteRouteChunks", site.chunks.length, { ...b.siteRouteChunks, unit: "chunks" });
}
check("bundle.totalJsBytes", totalJsBytes, b.totalJsBytes);
check("bundle.largestChunkBytes", largest.bytes, b.largestChunkBytes);

/* The allowlist is a separate, named check: an unexpected chunk on the Site route is
 * reported BY NAME, because "which chunk came back" is the whole diagnosis. */
const allow = new Set(b.siteRouteAllowlist?.allow || []);
const intruders = site ? site.chunks.filter((c) => !allow.has(c.stem)) : [];
if (intruders.length) {
  failures.push({
    metric: "bundle.siteRouteAllowlist",
    value: intruders.map((c) => c.stem).join(", "),
    ceiling: [...allow].join(", "),
    delta: intruders.reduce((a, c) => a + c.bytes, 0),
    unit: "bytes",
    named: intruders,
  });
}

/* ---- Report ---------------------------------------------------------------------------- */
if (JSON_OUT) {
  console.log(JSON.stringify({ routes, totalJsBytes, largest, failures, aboveTarget, passes }, null, 2));
} else {
  console.log("Planyr bundle budget audit (NEW-8)\n");
  for (const [name, r] of Object.entries(routes)) {
    console.log(`  route ${name.padEnd(10)} ${kb(r.bytes).padStart(10)}  across ${r.chunks.length} chunk(s): ${r.chunks.map((c) => c.stem).join(", ")}`);
  }
  console.log(`\n  all JS         ${kb(totalJsBytes).padStart(10)}  across ${allJs.length} chunk(s)`);
  console.log(`  largest chunk  ${kb(largest.bytes).padStart(10)}  ${largest.stem}\n`);

  for (const p of passes) console.log(`  ✓ ${p.metric} — ${fmt(p.value, p.unit)} (ceiling ${fmt(p.ceiling, p.unit)})`);
  for (const a of aboveTarget) {
    console.log(`  ⚠ ${a.metric} — ${fmt(a.value, a.unit)} is within its ${fmt(a.ceiling, a.unit)} ceiling but ABOVE the ${fmt(a.target, a.unit)} target (gap ${fmt(a.gap, a.unit)})`);
    if (a.owner) console.log(`      tracked by: ${a.owner}`);
  }
  for (const f of failures) {
    if (f.named) {
      console.log(`\n  ✗ ${f.metric} — UNEXPECTED CHUNK(S) ON THE SITE ROUTE: ${f.value}`);
      for (const c of f.named) console.log(`      ${c.stem} (+${kb(c.bytes)})`);
      console.log(`      allowed: ${f.ceiling}`);
      console.log("      A route-irrelevant chunk is being pulled on a plain Site load. The usual cause is");
      console.log("      something warming another workspace at boot (the NEW-9 regression), or a new STATIC");
      console.log("      import into the planner of a module that should be behind a dynamic import().");
    } else {
      console.log(`\n  ✗ ${f.metric} — ${fmt(f.value, f.unit)} exceeds the ${fmt(f.ceiling, f.unit)} ceiling by ${fmt(f.delta, f.unit)} (+${f.pct.toFixed(1)}%)`);
    }
  }
  console.log();
  if (failures.length) {
    console.log(`✗ ${failures.length} performance budget breach(es). See docs/PERF-BUDGETS.md.`);
    console.log("  A feature that breaches a budget ships with a matching optimization, or does not ship.");
    console.log("  Raising a ceiling to make this pass requires the same justification as any other product decision.");
  } else {
    console.log(`✓ All bundle budgets within ceiling${aboveTarget.length ? ` (${aboveTarget.length} metric(s) above target — tracked)` : ""}.`);
  }
}

process.exit(failures.length ? 1 : 0);
