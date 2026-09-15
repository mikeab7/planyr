/* B1619792 — closes the one gap B1614544's own live-verify (V1149440, PASSED 2026-09-15) left open.
 *
 * THE GAP. `ui-audit/verify-grid-view-scale.mjs` proved the FIX (buildingGrid.gridLinesVisible(ppf))
 * is correct by seeding two building ELEMENTS straight into localStorage — `{ type: "building", w,
 * h, dock: "none" }` — and reading the rendered grid. That is the right tool for proving the MODEL
 * logic, and it passed on production. It never drove the actual "Building" tool through a real
 * click-drag, so it could not answer the question a session chasing this item's live-verify got
 * stuck on: does a building someone actually DRAWS through the UI carry a grid at all, or only a
 * seeded rectangle? (The dispatch brief that opened this item found a hand-drawn polygon shows NO
 * grid at any zoom and could not tell, without reading the code, whether that was the reported bug
 * persisting or an unrelated, always-true limitation.)
 *
 * THE ANSWER, confirmed by reading SitePlanner.jsx before writing this harness (AUDIT-FIRST):
 * THREE building shapes exist, and only two ever draw a grid —
 *   1. An ordinary rectangle (drag the Building tool once, never reshaped) — grid gated on
 *      `gridLinesVisible(ppf)` alone (SitePlanner.jsx ~L29897, the plain `el.w`/`el.h` branch).
 *   2. A rectangle RESHAPED via the footprint-edit tool (`el.footEdit`, e.g. bumping a corner in or
 *      out) — same gate, clipped to the now-irregular outline (~L29475, the `buildingChrome` /
 *      `frameBBox` branch).
 *   3. A building drawn as a free-form polygon FROM SCRATCH (click each vertex, never started as a
 *      rectangle) — has no dock frame to hang a grid or dock doors on, so it renders fill-only,
 *      by design, "no regression — parity requirement" per the code's own comment (~L29473). This
 *      has ALWAYS been true — B1614544 never touched it and never could have caused it.
 * So: draw case 1 (the ordinary Building tool drag) twice, at two very different drag sizes, and
 * prove they flip their grids together — the same property verify-grid-view-scale.mjs already
 * proved for seeded data, now proved for a REAL drawn building reaching the REAL rendering path.
 *
 * RECIPE (also written up in docs/REFERENCE.md's "Playwright / ui-audit in the sandbox" section,
 * under the B1619792 heading — read that before re-deriving this by hand):
 *   1. Open the built app, switch to the Site Planner tab, click "Draw" (map-toolbar-draw) to start
 *      a blank, unsigned "this device" plan — no sign-in, no parcel lookup needed.
 *   2. Click the "Building" tool button, then click-drag ONE small rectangle on the canvas.
 *   3. Click "Building" again, click-drag a MUCH larger rectangle elsewhere on the canvas (never a
 *      free-form polygon click-path — that is case 3 above and never carries a grid).
 *   4. Zoom in (mouse wheel, centered anywhere near both buildings) and confirm interior column
 *      lines appear on BOTH at the same notch, never one before the other.
 *   5. File ▾ → Export PNG/PDF and confirm the exported sheet shows the same grid the canvas did.
 *
 * Run: node ui-audit/verify-grid-real-draw.mjs [--base=https://planyr.io]
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { GRID_MIN_PPF } from "../src/workspaces/site-planner/lib/buildingGrid.js";

const argBase = (process.argv.find((a) => a.startsWith("--base=")) || "").split("=")[1];
const BASE = (argBase || process.env.BASE_URL || "https://planyr.io").replace(/\/$/, "");
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const GRID_LINE = "#6b7480";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

let fail = 0;
const ok = (label, cond, detail) => { console.log(`  ${cond ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`); if (!cond) fail++; };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
// Read-only E2E hook (window.__plannerView) — never alters app behavior, gated the same way every
// e2e spec in this repo already gates it. Used ONLY to re-center the view between checks and to read
// back the live view; the grid decision itself is read straight off the rendered DOM, same as
// verify-grid-view-scale.mjs.
await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
const page = await ctx.newPage();
await assertMeasurable(page, "verify-grid-real-draw");

console.log(`== Reading served build ==`);
await page.goto(BASE + "/", { waitUntil: "load" });

// ── Step 1: open Site Planner, start a blank throwaway "this device" plan ──────────────────────
const tab = page.getByTestId("module-tab-site-planner").filter({ visible: true });
await tab.waitFor({ state: "visible", timeout: 20000 });
await tab.click();
await page.getByTestId("map-toolbar-draw").first().click();
const canvas = page.getByTestId("planner-canvas");
await canvas.waitFor({ state: "visible", timeout: 15000 });
await page.waitForTimeout(600);

const chunks2 = await page.evaluate(() => performance.getEntriesByType("resource").map((r) => r.name).filter((n) => /SitePlannerApp/.test(n)));
console.log(`  SitePlannerApp chunk (in planner, same observation as the checks below): ${chunks2[0] || "unknown"}`);

const rawCur = () => page.evaluate(() => {
  const raw = localStorage.getItem("planarfit:currentSite:v1") || "";
  try { return JSON.parse(raw); } catch { return raw; } // real app stores a bare string; seeded fixtures store JSON
});
const planName = await page.evaluate((cur) => {
  const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const rec = map[cur] || Object.values(map)[0];
  return rec ? (rec.site || rec.name || rec.id) : null;
}, await rawCur());
const planId = await rawCur();
console.log(`  Throwaway plan: "${planName}" (id ${planId}) — local "this device" storage only, never pushed to the cloud.`);

// ── Step 2: draw two REAL buildings via the actual Building tool (click + drag), very different
// drag sizes, both comfortably inside the viewport so a modest zoom sweep keeps both on screen. ──
const box = await canvas.boundingBox();
const elsCount = () => page.evaluate(() => {
  const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const raw = localStorage.getItem("planarfit:currentSite:v1") || "";
  let cur; try { cur = JSON.parse(raw); } catch { cur = raw; }
  return (map[cur]?.els || []).filter((e) => e.type === "building" && !e.attachedTo && !e.dogEar).length;
});
async function pollUntil(fn, want, timeoutMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if ((await fn()) >= want) return true;
    await page.waitForTimeout(150);
  }
  return false;
}
async function dragBuilding(x0f, y0f, x1f, y1f, expectCount) {
  await page.getByRole("button", { name: /^Building$/ }).first().click();
  const x0 = box.x + box.width * x0f, y0 = box.y + box.height * y0f;
  const x1 = box.x + box.width * x1f, y1 = box.y + box.height * y1f;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 6 });
  await page.mouse.move(x1, y1, { steps: 8 });
  await page.mouse.up();
  const settled = await pollUntil(elsCount, expectCount);
  ok(`building #${expectCount} committed to the model`, settled, `els count reached ${expectCount}`);
}

console.log("\n== Drawing a SMALL building (real Building-tool drag) ==");
await dragBuilding(0.30, 0.30, 0.42, 0.40, 1);
console.log("== Drawing a LARGE building (real Building-tool drag, far bigger footprint) ==");
await dragBuilding(0.52, 0.20, 0.86, 0.62, 2);
await page.getByRole("button", { name: /^Select V$/ }).click().catch(() => {});
await page.waitForTimeout(300);

const model = await page.evaluate(() => {
  const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const raw = localStorage.getItem("planarfit:currentSite:v1") || "";
  let cur; try { cur = JSON.parse(raw); } catch { cur = raw; }
  const rec = map[cur];
  return (rec?.els || []).filter((e) => e.type === "building" && !e.attachedTo && !e.dogEar)
    .map((e) => ({ id: e.id, w: e.w, h: e.h, hasPoints: !!e.points, footEdit: !!e.footEdit, dock: e.dock || "cross" }));
});
console.log("  Drawn buildings:", JSON.stringify(model));
ok("exactly two ordinary (non-freehand) buildings were drawn", model.length === 2 && model.every((m) => !m.hasPoints && !m.footEdit),
  model.map((m) => `${m.id}: ${Math.round(m.w)}×${Math.round(m.h)}ft`).join(", "));
const bySize = [...model].sort((a, b) => (a.w * a.h) - (b.w * b.h));
const small = bySize[0], large = bySize[1];
ok("the two drawn buildings are very different sizes", large && small && (large.w * large.h) > (small.w * small.h) * 4,
  small && large ? `small ${Math.round(small.w * small.h)} sf vs large ${Math.round(large.w * large.h)} sf` : "missing");

// ── Step 3: sweep view scale across GRID_MIN_PPF using the E2E view hook (the same proven
// methodology verify-grid-view-scale.mjs uses), scoped per building by its OWN data-el-id — robust
// to screen position, so the two real buildings need not sit at any particular place on screen. ──
const gridCountFor = (id) => page.evaluate(([elId, hex]) =>
  [...document.querySelectorAll(`[data-el-id="${elId}"] line`)].filter((l) => (l.getAttribute("stroke") || "").toLowerCase() === hex).length,
  [id, GRID_LINE]);

// Re-read cx/cy (not fetched above to keep the drawn-shape assertion minimal).
const withPos = await page.evaluate(() => {
  const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const raw = localStorage.getItem("planarfit:currentSite:v1") || "";
  let cur; try { cur = JSON.parse(raw); } catch { cur = raw; }
  const rec = map[cur];
  return (rec?.els || []).filter((e) => e.type === "building" && !e.attachedTo && !e.dogEar).map((e) => ({ id: e.id, cx: e.cx, cy: e.cy, w: e.w, h: e.h }));
});
const smallPos = withPos.find((e) => e.id === small.id), largePos = withPos.find((e) => e.id === large.id);
const midX = (smallPos.cx + largePos.cx) / 2, midY = (smallPos.cy + largePos.cy) / 2;

console.log(`\n== ppf sweep across GRID_MIN_PPF (${GRID_MIN_PPF.toFixed(3)}) — real drawn buildings, scoped by data-el-id ==`);
const lo = GRID_MIN_PPF * 0.5, hi = GRID_MIN_PPF * 1.6, steps = 24;
let mixedFrames = 0, sawOn = false, sawOff = false, transitionPpf = null, prevOn = null;
for (let i = 0; i <= steps; i++) {
  const ppf = lo + ((hi - lo) * i) / steps;
  await page.evaluate(([x, y, p]) => window.__plannerView.centerOn(x, y, p), [midX, midY, ppf]);
  await page.waitForTimeout(110);
  const sCount = await gridCountFor(small.id);
  const lCount = await gridCountFor(large.id);
  const mixed = (sCount === 0) !== (lCount === 0);
  if (mixed) { mixedFrames++; console.log(`  ppf ${ppf.toFixed(3)}: MIXED small=${sCount} large=${lCount}`); }
  const on = sCount > 0 || lCount > 0;
  if (on) sawOn = true; else sawOff = true;
  if (prevOn === false && on === true) transitionPpf = ppf;
  prevOn = on;
}
ok("real drawn buildings: never a mixed frame across the sweep", mixedFrames === 0, `${mixedFrames}/${steps + 1} frames mixed`);
ok("real drawn buildings: sweep covers both a hidden and a shown state", sawOn && sawOff, `on=${sawOn} off=${sawOff}`);
if (transitionPpf != null) console.log(`  (transition observed near ppf ${transitionPpf.toFixed(3)})`);

// ── Step 4: ONE pass with a REAL mouse-wheel zoom gesture (not the hook) — closes the loop from
// actual product input to actual rendered output, at least once, for both buildings together. ────
console.log("\n== One real wheel-zoom gesture (not the E2E hook) confirms the same transition ==");
await page.evaluate(([x, y, p]) => window.__plannerView.centerOn(x, y, p), [midX, midY, GRID_MIN_PPF * 0.55]);
await page.waitForTimeout(200);
const preS = await gridCountFor(small.id), preL = await gridCountFor(large.id);
ok("below the gate before the real wheel gesture: neither building shows a grid", preS === 0 && preL === 0, `small=${preS} large=${preL}`);
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
let sAfter = 0, lAfter = 0, notch = 0;
for (; notch < 40; notch++) {
  await page.mouse.wheel(0, -100); // one real notch, zoom IN (negative deltaY)
  await page.waitForTimeout(70);
  sAfter = await gridCountFor(small.id);
  lAfter = await gridCountFor(large.id);
  if (sAfter > 0 || lAfter > 0) break;
}
ok("a real wheel zoom-in eventually reveals the grid on both", sAfter > 0 && lAfter > 0, `after ${notch + 1} notches: small=${sAfter} large=${lAfter}`);
await page.screenshot({ path: OUT + "grid-real-draw-both-visible.png" });

// ── Step 5: export/print parity — the exported sheet must show the same grid the canvas showed. ──
console.log("\n== Export parity: the printed/exported sheet matches the canvas ==");
await page.evaluate(() => {
  window.__exportSvgs = [];
  if (!window.__exportHooked) {
    window.__exportHooked = true;
    const real = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (b) => {
      try { if (b && typeof b.type === "string" && b.type.indexOf("svg") >= 0) b.text().then((t) => window.__exportSvgs.push(t)).catch(() => {}); } catch (e) {}
      return real(b);
    };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { if (this.download) return; return click.call(this); };
  }
});
await page.getByRole("button", { name: "File ▾" }).click();
await page.getByRole("button", { name: "Export PNG" }).click();
for (let i = 0; i < 80 && !(await page.evaluate(() => window.__exportSvgs.length)); i++) await page.waitForTimeout(250);
const svgs = await page.evaluate(() => window.__exportSvgs);
if (!svgs.length) {
  ok("export payload captured", false, "no svg captured — export parity NOT confirmed this run");
} else {
  const svg = svgs[0];
  const hasSmallId = svg.includes(`data-el-id="${small.id}"`), hasLargeId = svg.includes(`data-el-id="${large.id}"`);
  const totalGridLines = [...svg.matchAll(new RegExp(`stroke="${GRID_LINE}"`, "g"))].length;
  ok("exported sheet includes both drawn buildings", hasSmallId && hasLargeId, `small present=${hasSmallId}, large present=${hasLargeId}`);
  ok("exported sheet carries interior grid lines, matching the on-screen state at the export trigger",
    (sAfter > 0 || lAfter > 0) === (totalGridLines > 0),
    `canvas at trigger: small=${sAfter} large=${lAfter} · exported total grid-stroke count=${totalGridLines}`);
}

console.log(`\nThrowaway plan to discard: "${planName}" (id ${planId}) — local "this device" plan on ${BASE}, never synced to the cloud.`);
await browser.close();
console.log(fail === 0 ? "\n✅ ALL REAL-DRAW GRID CHECKS PASSED" : `\n❌ ${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
