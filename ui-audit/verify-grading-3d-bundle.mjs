/* verify-grading-3d-bundle — NEW-1 (2026-11-11): three.js lives ONLY in the 3D grading viewer's own lazy chunk.
 *
 * Reads the production build (`npm run build` → dist/.vite/manifest.json + dist/assets/*.js) and asserts, from the bytes that actually shipped:
 *   (a) exactly ONE chunk contains three.js (it carries the WebGLRenderer), and it is the Grading3DViewer chunk;
 *   (b) that chunk is a DYNAMIC entry only — no chunk statically imports it, so no route downloads it until the owner presses "View in 3D";
 *   (c) therefore the main entry chunk and the planner chunk (SitePlanner) contain no three.js.
 * It prints the chunk sizes (raw and gzip) for the PR and, when .perf/base-stats.json exists, the Site route's byte delta against the base ref.
 * Size is judged by the existing budget gate (ui-audit/perf-bundle-audit.mjs) — this never raises or edits a limit.
 *   node ui-audit/verify-grading-3d-bundle.mjs */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";

const DIST = new URL("../dist/", import.meta.url).pathname;
const manifestPath = DIST + ".vite/manifest.json";
if (!existsSync(manifestPath)) { console.error("✗ dist/.vite/manifest.json missing — run `npm run build` first"); process.exit(2); }
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const fails = [], notes = [];
const check = (name, ok, extra = "") => (ok ? notes : fails).push(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`);
const kb = (n) => (n / 1024).toFixed(1) + " KB";
const read = (f) => readFileSync(DIST + f);

const entries = Object.entries(manifest);
const viewerKey = entries.find(([k]) => /components\/Grading3DViewer\.jsx$/.test(k));
check("the viewer is a manifest entry", !!viewerKey);
const viewer = viewerKey && viewerKey[1];
check("it is a DYNAMIC entry (loaded only by import())", !!(viewer && viewer.isDynamicEntry));
const staticImporters = entries.filter(([, v]) => (v.imports || []).some((k) => manifest[k] === viewer)).map(([k]) => k);
check("no chunk statically imports it (so no route downloads it up front)", staticImporters.length === 0, staticImporters.join(", "));
const dynImporters = entries.filter(([, v]) => (v.dynamicImports || []).some((k) => manifest[k] === viewer)).map(([k]) => k);
const plannerChunk = entries.find(([, v]) => v.name === "SitePlanner");
check("it is reached by import() from the planner chunk only", dynImporters.length === 1 && !!plannerChunk && dynImporters[0] === plannerChunk[0], dynImporters.join(", "));

// which chunk files carry three.js (the renderer class survives minification as a string via its `type`/`isWebGLRenderer`-style names)
const SIG = [/WebGLRenderer/, /PerspectiveCamera/, /BufferGeometry/];
const files = readdirSync(DIST + "assets").filter((f) => f.endsWith(".js") && !/pdf\.worker/.test(f));
const withThree = files.filter((f) => { const t = read("assets/" + f).toString("utf8"); return SIG.every((re) => re.test(t)); });
check("exactly one chunk contains three.js, and it is the Grading3DViewer chunk", withThree.length === 1 && viewer && withThree[0] === viewer.file.replace(/^assets\//, ""), JSON.stringify(withThree));

const size = (f) => { const b = read(f); return { raw: b.length, gz: gzipSync(b).length }; };
const main = entries.find(([, v]) => v.isEntry);
const planner = entries.find(([, v]) => v.name === "SitePlanner");
const plannerApp = entries.find(([, v]) => v.name === "SitePlannerApp");
const row = (label, v) => { const s = size(v.file); console.log(`  ${label.padEnd(34)} ${kb(s.raw).padStart(10)}  (gzip ${kb(s.gz)})   ${v.file}`); };
console.log("\nChunk sizes (raw, gzip):");
if (main) row("main entry (always loaded)", main[1]);
if (plannerApp) row("SitePlannerApp (Site route)", plannerApp[1]);
if (planner) row("SitePlanner (the plan editor)", planner[1]);
if (viewer) row("Grading3DViewer (three.js, lazy)", viewer);
check("the main entry and the planner chunk carry no three.js", [main, planner, plannerApp].filter(Boolean).every(([, v]) => !SIG.every((re) => re.test(read(v.file).toString("utf8")))));

if (existsSync(new URL("../.perf/base-stats.json", import.meta.url).pathname) && existsSync(new URL("../.perf/head-stats.json", import.meta.url).pathname)) {
  const b = JSON.parse(readFileSync(new URL("../.perf/base-stats.json", import.meta.url), "utf8")).metrics, h = JSON.parse(readFileSync(new URL("../.perf/head-stats.json", import.meta.url), "utf8")).metrics;
  console.log(`\nSite route JS: ${kb(b.siteRouteJsBytes)} → ${kb(h.siteRouteJsBytes)} (${h.siteRouteJsBytes - b.siteRouteJsBytes >= 0 ? "+" : ""}${h.siteRouteJsBytes - b.siteRouteJsBytes} B) · chunks ${b.siteRouteChunks} → ${h.siteRouteChunks}`);
  console.log(`Total JS (all chunks): ${kb(b.totalJsBytes)} → ${kb(h.totalJsBytes)} (+${kb(h.totalJsBytes - b.totalJsBytes)} — the viewer's lazy chunk, downloaded only on "View in 3D")`);
  check("the Site route grew by at most a button and a loader (≤ 2 KB)", h.siteRouteJsBytes - b.siteRouteJsBytes <= 2048, `${h.siteRouteJsBytes - b.siteRouteJsBytes} B`);
  check("the Site route's chunk count is unchanged", h.siteRouteChunks === b.siteRouteChunks, `${b.siteRouteChunks} → ${h.siteRouteChunks}`);
}
console.log("\n" + notes.join("\n"));
if (fails.length) { console.log("\nFAILURES:\n" + fails.join("\n")); process.exit(1); }
console.log("\nverify-grading-3d-bundle: all checks passed");
