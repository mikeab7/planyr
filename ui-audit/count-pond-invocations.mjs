#!/usr/bin/env node
/* count-pond-invocations — HOW MANY TIMES does the pond stack run during ONE PAN? (B227888)
 *
 * ⛔ THE OWNER'S QUESTION, and it reframes what a correct fix is: *"I don't really understand how
 * a static pond, how the calculation should slow anything down at all. And you can give me the
 * reason, but I still don't think it should."*
 *
 * He is right, and the consequence is that MAGNITUDE is the wrong headline. A pond's interior, its
 * stage-storage curve and its flood facts are functions of (ring, det, criteria) and of nothing
 * about the view; a pan is a pure translation at constant scale (B1440). So the number that
 * settles this is not milliseconds — it is CALLS PER POND PER GESTURE. Anything above one is not
 * "expensive", it is work that should not be happening, and the fix is a memo keyed on the model,
 * not a faster algorithm.
 *
 * This drives the real Bain quiddity fixture through the standard neutral pan on a PROBE BUILD
 * (`PLANYR_PROBE=1`, inert in production — see scripts/vite-plugin-recompute-probe.mjs) and prints
 * the call count of every pond-path function, ranked.
 *
 *   node ui-audit/count-pond-invocations.mjs --build
 *   ... --arm simple-ponds        # the 7-point arm, for the per-vertex read
 *   ... --assert                  # exit 1 if any pond function exceeds ONE call per pond
 *   ... --json
 *
 * ⛔ `--assert` IS THE BROWSER HALF OF THE GUARD, and the CI-runnable half is
 * `test/pondViewIndependence.test.js`. Neither substitutes for the other: the unit test proves the
 * memo is transparent and that a repeat costs nothing, but it cannot see the RENDER PASS that was
 * asking 156 times — that only exists in a real browser driving a real gesture. This programme has
 * three cases on record of a cost class returning unnoticed, so the count is asserted, not admired.
 */
import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { fixtureSeed, bainPairArmFixture, withLayerArm, LAYER_ARMS, OWNER_SCENE } from "./lib/planFixture.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const DIST = join(ROOT, "dist-probe");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const JSON_OUT = process.argv.includes("--json");
const ARM = String(arg("--arm", "quiddity"));
/* ⛔ B265538 — THE LAYER ARM DEFAULTS TO HIS FOUR, NOT TO ZERO. This battery, like every other one
 * in the repo, used to run with no map layers mounted at all, while the tab he reports the symptom
 * in carries `ly 4`. B1435 measured per-frame cost as elements × panels × LAYERS, so a battery at
 * ly 0 benchmarks a lighter scene than the one under investigation. `--layers none` restores the
 * old arm for a controlled A/B; see the standing note in lib/planFixture.mjs for what a mounted
 * layer can and cannot reproduce with every GIS host blocked. */
const LAYERS = String(arg("--layers", "owner-4"));
const PORT = Number(arg("--port", 4179));
if (!LAYER_ARMS[LAYERS]) { console.error(`unknown --layers arm "${LAYERS}" (have: ${Object.keys(LAYER_ARMS).join(", ")})`); process.exit(2); }

/* Every module whose functions are a pure function of the pond model. A call count above one per
 * pond, per gesture, on any of these is the finding. */
const POND_FILES = /pond|inwardBerm|labelFitLadder|stageStorage|ringMath|polygonSplit|buildability/i;

if (process.argv.includes("--build")) {
  process.stderr.write("  · building probe bundle (PLANYR_PROBE=1)…\n");
  const r = spawnSync("npx", ["vite", "build", "--outDir", "dist-probe"], {
    cwd: ROOT, env: { ...process.env, PLANYR_PROBE: "1" }, stdio: ["ignore", "ignore", "inherit"],
  });
  if (r.status !== 0) { console.error("probe build failed"); process.exit(2); }
}
if (!existsSync(join(DIST, "index.html"))) {
  console.error(`No probe build at ${DIST}. Re-run with --build.`);
  process.exit(2);
}

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".wasm": "application/wasm" };
const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const f = join(DIST, p);
  if (!f.startsWith(DIST) || !existsSync(f)) { res.writeHead(404); return res.end(); }
  const ext = p.slice(p.lastIndexOf("."));
  res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream" });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(PORT, r));
const BASE = `http://localhost:${PORT}/`;

const QUIDDITY = JSON.parse(readFileSync(join(HERE, "fixtures", "bain-quiddity.json"), "utf8"));
const ORIGINAL = JSON.parse(readFileSync(join(HERE, "fixtures", "bain-concept-original.json"), "utf8"));
const fixture = withLayerArm(bainPairArmFixture(QUIDDITY, ORIGINAL, ARM), LAYERS);
const pondCount = fixture.els.filter((e) => e.type === "pond").length;
const vertexTotal = fixture.els.filter((e) => e.type === "pond").reduce((s, e) => s + e.points.length, 0);

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
await ctx.addInitScript(fixtureSeed(fixture, { id: "pond-invocations-site" }));
await ctx.route(/^https?:\/\//, (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
const page = await ctx.newPage();
/* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — not its clock, and not its pixels. A hidden tab clamps
   setTimeout (a setTimeout-paced probe then times the clamp: 3,156 ms for a 138-182 ms gesture) AND
   suspends requestAnimationFrame, so after a view change the app's state attributes update while the
   drawing never repaints — every box, position, hit test and screenshot then agrees with every other
   and describes a view the app already left. One precondition covers both, rAF liveness probe
   included; see ui-audit/lib/tabTiming.mjs. Fails loudly rather than reporting either. */
await assertMeasurable(page, "count-pond-invocations");
await page.goto(BASE, { waitUntil: "load" });
await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 60000 });
await page.waitForTimeout(2500);
if (!(await page.evaluate(() => !!window.__VPROBE__))) {
  console.error("⛔ window.__VPROBE__ is absent — this is not a probe build. Re-run with --build.");
  process.exit(2);
}

const press = (await page.evaluate(`(() => {
  const svg = document.querySelector('[data-testid="planner-canvas"]'); if (!svg) return null;
  const r = svg.getBoundingClientRect();
  for (const fy of [0.5, 0.28, 0.72]) for (const fx of [0.28, 0.72, 0.5]) {
    const x = r.left + r.width * fx, y = r.top + r.height * fy;
    if (document.elementFromPoint(x, y) === svg) return { x: Math.round(x), y: Math.round(y) };
  } return null; })()`)) || { x: 500, y: 450 };

await page.evaluate(() => window.__VPROBE__.begin("pan"));
await page.mouse.move(press.x, press.y);
await page.mouse.down();
await page.mouse.move(press.x + 260, press.y + 130, { steps: 20 });
await page.mouse.move(press.x, press.y, { steps: 20 });
await page.mouse.up();
await page.waitForTimeout(150);
const report = await page.evaluate(() => window.__VPROBE__.end());
/* Read the SAME counter the owner's telemetry reports (`perfScene.layersOn`), so the arm's claim
 * about his scene is measured on the page rather than asserted from the fixture. */
const layerCount = await page.evaluate(() => document.querySelectorAll(".leaflet-layer").length);
await browser.close();
server.close();

const pond = report.sites
  .filter((s) => s.kind !== "memo" && POND_FILES.test(s.file))
  .sort((p, q) => q.calls - p.calls);

/* ⛔ THE ASSERTION IS IN TWO HALVES, and it needs both to be a guard rather than a decoration.
 *
 * MUST_BE_ZERO — the GEOMETRY tier: the clipper primitives and everything that reaches them. Their
 * answers are functions of (ring, det) alone, so on a gesture that changes only the view the correct
 * count is not "once per pond", it is NONE AT ALL — the model was resolved when the plan loaded and
 * a pan has no business touching it. Measured at 275,184 `offsetInward` executions per pan before
 * B227888 and zero after.
 *
 * MUST_BE_PRESENT — the cheap composite lookups, which legitimately still run every render (they
 * return a cached object; `pondStageModel` costs 1.5 ms across 252 calls). Requiring them to be
 * OBSERVED is what stops this whole check rotting into a permanent green: if the probe build breaks,
 * the fixture stops carrying ponds, or a rename orphans the names below, MUST_BE_ZERO would be
 * satisfied by an empty report. That is precisely the failure VIEW-INDEPENDENT-ONCE §6 names, and it
 * is why the two halves are asserted together and never separately. */
/* ⛔ B221763 (2026-08-08) — THE LEDGER TIER JOINED `MUST_BE_ZERO`, and `usablePondVolume` MOVED
 * OUT of `MUST_BE_PRESENT` to get there. B236592 made the geometry leaves free but left the render
 * body REBUILDING the ledger entries once per render, so on this same fixture a pan still ran
 * `usablePondVolume`, `incrementalExcavationCf` and `excavationVolume` **254 times** (127 renders ×
 * 2 ponds) and `detentionStorage` **762**. Cheap is not the bar the owner set — *"a pan with no
 * model change must rebuild nothing"* is — so the pass is now gated on `pondLedgerSignature`
 * (`lib/pondLedgerKey.js`) and these three must not run at all. Measured after: 0 · 0 · 0, and
 * `detentionStorage` 762 → 254 (the residue is the providedDetCf loop, a different pass). */
const MUST_BE_ZERO = [
  "offsetInward", "maxInwardOffset", "volumeBetween", "pondElevations", "stageTable", "areaAtElev",
  "usablePondVolume", "incrementalExcavationCf", "excavationVolume",
];
/* `pondLedgerSignature` is the SENTINEL for the ledger half: it is the gate itself, so seeing it
 * run proves the pass was reached and that the three zeros above are real zeros rather than an
 * empty report. Without it, deleting the ponds from the fixture would turn this check permanently
 * green — the exact rot VIEW-INDEPENDENT-ONCE §6 names. */
/* ⛔ B217539 (2026-08-08) — `interiorFitter` LEFT THIS LIST, and the reason is the same shape as
 * B221763's `usablePondVolume` move above: a fix made it unreachable on a pan, so demanding that
 * the probe SEE it turned a success into a red.
 *
 * WHAT CHANGED. `interiorFitter` is only ever reached from the label COLLISION pass, and that pass
 * now resolves once per distinct question instead of once per frame (`labelLayout.layoutLabels`).
 * On this fixture a pan took it from **262 calls to 0** — the intended win, measured both ways.
 *
 * WHY IT IS NOT SIMPLY MOVED TO `MUST_BE_ZERO`, which would be the stronger-looking choice. The
 * honest count is 0 OR up to 2, not a hard zero: the solver legitimately runs once per call site,
 * and whether either lands inside this probe's gesture window depends on where the window opens.
 * Pinning it to zero would be an assertion that is true most runs and red some runs, and a guard
 * that is intermittently red is worse than no guard — people learn to re-run it.
 *
 * ⛔ THE PROPERTY IS NOT DROPPED, IT MOVED HOUSE. "The label pass was actually reached, and it ran
 * at most once per distinct question" is asserted by `ui-audit/verify-view-independent.mjs`, whose
 * registry carries `labelLayout.js:layoutLabelsSolve` with `max: 2` AND whose never-observed rule
 * fails if the probe cannot see it at all — the same anti-rot contract as this list, applied where
 * the count is deterministic. The two sentinels left here (`pondStageModel`, `pondLedgerSignature`)
 * still make an empty report impossible to pass off as a clean one, which is this list's job. */
const MUST_BE_PRESENT = ["pondStageModel", "pondLedgerSignature"];

if (process.argv.includes("--assert")) {
  const byName = new Map(pond.map((s) => [s.name, s]));
  const ran = MUST_BE_ZERO.filter((n) => (byName.get(n)?.calls || 0) > 0);
  const absent = MUST_BE_PRESENT.filter((n) => !byName.has(n));
  console.log(`\nGEOMETRY — must not run at all on a view-only gesture:`);
  for (const n of MUST_BE_ZERO) console.log(`  ${byName.has(n) ? "✗" : "✓"} ${n.padEnd(20)} ${byName.get(n)?.calls || 0} call(s)`);
  console.log(`\nCACHED LOOKUPS — must be OBSERVED, so an empty report cannot pass as a clean one:`);
  for (const n of MUST_BE_PRESENT) console.log(`  ${byName.has(n) ? "✓" : "✗"} ${n.padEnd(20)} ${byName.has(n) ? `${byName.get(n).calls} call(s), ${byName.get(n).ms} ms` : "NOT OBSERVED"}`);
  if (absent.length) { console.error(`\n⛔ NOT OBSERVED: ${absent.join(", ")} — this probe cannot vouch for a run it never saw, so the zero above proves nothing.`); process.exit(1); }
  if (ran.length) { console.error(`\n⛔ RECURRENCE: ${ran.map((n) => `${n} ran ${byName.get(n).calls}× on a pan`).join(" · ")}`); process.exit(1); }
  const layersOn = layerCount;
  console.log(`\n✅ a pan recomputed NO pond geometry — ${pondCount} pond(s), ${vertexTotal} ring vertices, untouched.`);
  console.log(`   layer arm "${LAYERS}": ${layersOn} Leaflet layer(s) mounted (his measured scene carries ${OWNER_SCENE.layersOn}; every GIS host is blocked here, so a mounted layer never fetches — this is a LOWER bound).`);
  process.exit(0);
}

if (JSON_OUT) console.log(JSON.stringify({ arm: ARM, pondCount, vertexTotal, sites: pond }, null, 2));
else {
  console.log(`\nPOND-STACK INVOCATIONS PER PAN GESTURE — arm "${ARM}", ${pondCount} pond(s), ${vertexTotal} ring vertices`);
  console.log(`(a pond's storage, flood facts and interior fit are functions of the MODEL — the correct count is ${pondCount} per gesture, once each)\n`);
  console.log(`${"function".padEnd(30)}${"file:line".padEnd(34)}${"calls".padStart(9)}${"per pond".padStart(10)}${"ms".padStart(10)}`);
  for (const s of pond.slice(0, 30)) {
    console.log(s.name.slice(0, 29).padEnd(30) + `${s.file}:${s.line}`.slice(-33).padEnd(34)
      + String(s.calls).padStart(9) + (s.calls / pondCount).toFixed(1).padStart(10)
      + (s.truncated ? `${s.ms.toFixed(0)}+` : s.ms.toFixed(1)).padStart(10));
  }
}
