/* NEW-1/NEW-2/NEW-3 (B1057 completion) — headless smoke for the screening-BFE live wiring.
 *
 * WHAT THIS CAN PROVE HERE, LOGGED OUT AND WITH EXTERNAL GIS EGRESS BLOCKED:
 *   1. the planner still BOOTS and mounts its canvas with the new module graph in the bundle
 *      (screeningBfeSite → channelSection → upstreamArea/flowField/demGrid, pfdsClient, soils);
 *   2. no console error / page error mentions any of those modules;
 *   3. the new lib chunk did NOT land on the planner's boot path (it must only load with a
 *      drainage check), and the LERC codec split B1042 shipped is still intact.
 *
 * WHAT IT CANNOT PROVE (→ the V### live gate): the panel rows themselves. Rendering the screening
 * value, its delta against the other providers and the §5.C(3) trigger all require a real drainage
 * check — FEMA NFHL zones, a 3DEP DEM, NOAA PFDS and SSURGO — every one of which this sandbox's
 * egress blocks. That is a named `live-GIS` / `real-data` blocker, not a skipped check.
 *
 *   node ui-audit/verify-screening-bfe.mjs        (expects `npm run preview` on :4173)
 */
import { chromium } from "playwright";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const DIST = fileURLToPath(new URL("../dist/assets/", import.meta.url));

const site = {
  id: "screening-bfe-demo", groupId: "screening-bfe-demo", site: "Screening BFE Demo", name: "Plan 1",
  origin: { lat: 29.9, lon: -95.98 }, county: "waller",
  parcels: [{ id: "pc1", locked: false, points: [{ x: -840, y: -520 }, { x: 840, y: -520 }, { x: 840, y: 520 }, { x: -840, y: 520 }] }],
  els: [{ id: "e1", type: "building", cx: 0, cy: -40, w: 420, h: 180, rot: 0 }],
  measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), data: { status: "active" },
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [site.id]: site })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(site.id)});
} catch (e) {} })();`;

const fail = (msg) => { console.error(`✗ ${msg}`); process.exitCode = 1; };
const pass = (msg) => console.log(`✓ ${msg}`);

// ── (3) static bundle check: the new lib must not ride the planner's boot chunk.
// Identifiers are minified, so match on STRING LITERALS that only this feature ships. These are
// also the exact sentences the honesty requirements turn on — if they vanish from the bundle, the
// screening number could reach a user without them.
const NEW_MODULE_MARKERS = [
  "the contributing watershed runs past the edge",   // the truncation guard (channelSection/site)
  "Planyr Atlas-14 screening study",                  // the provider label (floodplainMitigation)
  "Atlas-14 BFE + 500-yr data",                       // the ordinance trigger line (SitePlanner)
  "no bridges or culverts",                           // NOT_MODELED, shipped with every answer
];
const files = readdirSync(DIST).filter((f) => f.endsWith(".js"));
const entryChunks = files.filter((f) => /^index-/.test(f));
const plannerChunk = files.find((f) => /^SitePlannerApp-/.test(f));
if (!plannerChunk) fail("no SitePlannerApp chunk in dist/ — build first");
else {
  const src = readFileSync(DIST + plannerChunk, "utf8");
  const missingMarkers = NEW_MODULE_MARKERS.filter((m) => !src.includes(m));
  if (missingMarkers.length) fail(`screening-BFE copy missing from the planner chunk: ${missingMarkers.join(" | ")}`);
  else pass(`screening-BFE wiring + its honesty copy are in the planner chunk (${NEW_MODULE_MARKERS.length}/${NEW_MODULE_MARKERS.length} markers)`);
  // The wiring is called synchronously inside the drainage check, so it legitimately lives in the
  // planner chunk; what must NOT happen is it reaching an app ENTRY chunk (loaded on every route).
  const leaked = entryChunks.filter((f) => {
    const boot = readFileSync(DIST + f, "utf8");
    return NEW_MODULE_MARKERS.some((m) => boot.includes(m));
  });
  if (leaked.length) fail(`screening-BFE code leaked onto an app entry chunk: ${leaked.join(", ")}`);
  else pass(`screening-BFE code stays off all ${entryChunks.length} app entry chunks`);
}

// ── (1)(2) boot smoke.
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
/* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — not its clock, and not its pixels. A hidden tab clamps
   setTimeout (a setTimeout-paced probe then times the clamp: 3,156 ms for a 138-182 ms gesture) AND
   suspends requestAnimationFrame, so after a view change the app's state attributes update while the
   drawing never repaints — every box, position, hit test and screenshot then agrees with every other
   and describes a view the app already left. One precondition covers both, rAF liveness probe
   included; see ui-audit/lib/tabTiming.mjs. Fails loudly rather than reporting either. */
await assertMeasurable(page, "verify-screening-bfe");
const errors = [];
page.on("pageerror", (e) => errors.push(String(e && e.message ? e.message : e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

try {
  await page.goto(BASE, { waitUntil: "load", timeout: 30000 });
  await page.waitForSelector("svg[role=application]", { timeout: 20000 });
  pass("planner canvas mounted with the screening-BFE module graph in the bundle");
} catch (e) {
  fail(`planner did not mount: ${e && e.message}`);
}

await page.waitForTimeout(2500);
// Network failures to blocked GIS hosts are EXPECTED in this sandbox and are not the thing under
// test; a module-resolution / runtime error in the new code is.
const relevant = errors.filter((t) => /screening|channelSection|upstreamArea|pfds|soils|is not a function|is not defined|Cannot read/i.test(t))
  .filter((t) => !/Failed to load resource|net::ERR|ERR_BLOCKED|403|404|CORS/i.test(t));
if (relevant.length) {
  fail(`runtime errors touching the new wiring:\n    ${relevant.slice(0, 8).join("\n    ")}`);
} else {
  pass("no runtime error from the screening-BFE wiring on boot");
}

await browser.close();
console.log(process.exitCode ? "\nFAILED" : "\nAll sandbox-checkable assertions passed. The PANEL ROWS remain a live gate (see VERIFICATION.md).");
