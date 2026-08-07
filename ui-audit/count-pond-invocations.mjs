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
import { fixtureSeed, bainPairArmFixture } from "./lib/planFixture.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const DIST = join(ROOT, "dist-probe");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const JSON_OUT = process.argv.includes("--json");
const ARM = String(arg("--arm", "quiddity"));
const PORT = Number(arg("--port", 4179));

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
const fixture = bainPairArmFixture(QUIDDITY, ORIGINAL, ARM);
const pondCount = fixture.els.filter((e) => e.type === "pond").length;
const vertexTotal = fixture.els.filter((e) => e.type === "pond").reduce((s, e) => s + e.points.length, 0);

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
await ctx.addInitScript(fixtureSeed(fixture, { id: "pond-invocations-site" }));
await ctx.route(/^https?:\/\//, (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
const page = await ctx.newPage();
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
const MUST_BE_ZERO = ["offsetInward", "maxInwardOffset", "volumeBetween", "pondElevations", "stageTable", "areaAtElev"];
const MUST_BE_PRESENT = ["pondStageModel", "usablePondVolume", "interiorFitter"];

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
  console.log(`\n✅ a pan recomputed NO pond geometry — ${pondCount} pond(s), ${vertexTotal} ring vertices, untouched.`);
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
