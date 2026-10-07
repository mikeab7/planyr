/* verify-panel-resize-steady — dragging the docked left panel must not SHAKE the map (B2154768).
 *
 * Follow-up to B2174224 / verify-panel-resize-scale (which proves the SCALE never changes). This proves
 * the POSITION never moves: during a slow real grip drag we record, on EVERY animation frame, the
 * screen rect of (a) one fixed SVG element and (b) one fixed Leaflet basemap tile, and assert
 *   · each stays put (a ground point outside the panel keeps its screen position) — max frame-to-frame
 *     and total excursion from the first frame,
 *   · the two never move relative to each other (zero drift: element.x − tile.x is constant),
 *   · no hop on release (the first frames after pointerup equal the last frame of the drag).
 * KNOWN-GOOD ARM (DRIVER-SCROLL §6): a reading with NO drag at all (idle frames) must report zero
 * movement on any build; if it does not, the instrument is broken and the run is VOID.
 *
 * Run:  node ui-audit/verify-panel-resize-steady.mjs        (preview on :4173; BASE_URL overrides)
 *       --expect-red   inverts the exit for a run against a pre-fix build.
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { fixtureSeed } from "./lib/planFixture.mjs";
import { readFixture } from "./lib/fixtureSeeding.mjs";
import { frameStats } from "./lib/frameStats.mjs";

const { chromium } = pw;
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXPECT_RED = process.argv.includes("--expect-red");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const WINDOWS = [{ w: 1920, h: 1080, dpr: 1 }, { w: 1440, h: 900, dpr: 1 }, { w: 1440, h: 900, dpr: 1.25 }, { w: 1440, h: 900, dpr: 1.5 }, { w: 1191, h: 640, dpr: 1 }];
const TABS = ["parcel", "analysis", "drainage", "yield", "properties", "references", "standards"];
const TOL = 0.5;   // CSS px — sub-half-pixel is rounding, not a shake

const seed = fixtureSeed(readFixture("sylvestri"), { id: "verify-panel-steady", name: "Concept D", site: "Silvestri" });
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
let fail = 0, measured = 0, knownGood = null;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };

/* In the page: start a per-rAF recorder over ONE fixed element + ONE fixed tile (held by reference). */
const startRec = () => {
  const svg = document.querySelector('[data-testid="planner-canvas"]');
  // el-tier: one fixed ELEMENT is the yardstick (its screen rect), not a census of plan contents.
  const el = [...svg.querySelectorAll("[data-el-id]")].map((n) => [n, n.getBoundingClientRect()]).filter(([, q]) => q.width > 0)
    .sort((a, b) => b[1].width * b[1].height - a[1].width * a[1].height)[0]?.[0];
  const cont = [...document.querySelectorAll(".leaflet-container")].find((c) => c.getBoundingClientRect().width > 0);
  const tiles = cont ? [...cont.querySelectorAll("img.leaflet-tile")].filter((t) => t.getBoundingClientRect().width > 0) : [];
  // the tile nearest the canvas centre keeps its place even as the container shrinks
  const tile = tiles.sort((a, b) => Math.abs(a.getBoundingClientRect().left - 900) - Math.abs(b.getBoundingClientRect().left - 900))[0];
  window.__rec = { frames: [], run: true, el, tile };
  const tick = () => {
    const R = window.__rec; if (!R.run) return;
    const e = R.el.getBoundingClientRect(), t = R.tile ? R.tile.getBoundingClientRect() : null;
    const p = document.querySelector('[data-testid="left-menu-panel"]')?.getBoundingClientRect();
    R.frames.push({ ex: e.left, ey: e.top, ew: e.width, tx: t && t.left, ty: t && t.top, tw: t && t.width, pr: p ? p.right : 0, T: performance.now() });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return { hasEl: !!el, hasTile: !!tile };
};
const stopRec = () => { window.__rec.run = false; return window.__rec.frames; };

async function slowDrag(page, from, to) {
  const grip = page.locator('[title="Drag to resize"]').first();
  const b = await grip.boundingBox();
  const y = b.y + b.height / 2, x0 = b.x + b.width / 2;
  await page.mouse.move(x0, y);
  await page.mouse.down();
  const steps = 60;
  for (let i = 1; i <= steps; i++) { await page.mouse.move(x0 + ((to - from) * i) / steps + 0.37, y); await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); }
  const releaseAt = await page.evaluate(() => window.__rec.frames.length);
  await page.mouse.up();
  await page.evaluate(() => new Promise((r) => setTimeout(r, 300)));
  return releaseAt;
}

function judge(label, frames, releaseAt, { dragged }) {
  measured++;
  const s = frameStats(frames, releaseAt);
  const ok = (cond, m) => log(cond, `${label}: ${m}`);
  ok(s.elMaxJump <= TOL && s.elExcursion <= TOL, `fixed drawing element stays put (max frame jump ${s.elMaxJump.toFixed(2)}, excursion ${s.elExcursion.toFixed(2)})`);
  if (s.hasTile) ok(s.tileMaxJump <= TOL && s.tileExcursion <= TOL, `basemap tile stays put (max frame jump ${s.tileMaxJump.toFixed(2)}, excursion ${s.tileExcursion.toFixed(2)})`);
  if (s.hasTile) ok(s.relDrift <= TOL, `drawing and aerial never move against each other (max relative drift ${s.relDrift.toFixed(2)})`);
  ok(s.sizeMax <= TOL, `drawing and tile keep their size (max size change ${s.sizeMax.toFixed(2)})`);
  if (dragged) ok(s.releaseHop <= TOL, `no hop on release (${s.releaseHop.toFixed(2)})`);
  return s;
}

for (const win of WINDOWS) {
  const ctx = await browser.newContext({ viewport: { width: win.w, height: win.h }, deviceScaleFactor: win.dpr });
  await ctx.addInitScript(seed);
  await ctx.addInitScript(() => { try { localStorage.setItem("planarfit:leftWidth", "300"); } catch (_) {} });
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-panel-resize-steady");
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}#/project/verify-panel-steady/site`, { waitUntil: "load" });
  await page.waitForTimeout(3000);
  const tag = `${win.w}×${win.h}@${win.dpr}x`;
  for (const tab of win.w === 1440 && win.dpr === 1 ? TABS : ["parcel"]) {
    await page.evaluate((id) => document.querySelector(`[data-rail-tab="${id}"]`)?.click(), tab);
    await page.waitForTimeout(900);
    const st = await page.evaluate(startRec);
    if (!st.hasEl) { log(false, `${tag} ${tab}: no drawn element to track`); continue; }
    if (!st.hasTile) console.log(`  (note) ${tag} ${tab}: no basemap tile in this run (offline aerial) — drawing-only reading`);
    // known-good arm: idle frames, no drag
    if (knownGood === null) {
      await page.evaluate(() => new Promise((r) => setTimeout(r, 600)));
      const idle = await page.evaluate(stopRec);
      const s = frameStats(idle, idle.length);
      knownGood = s.elMaxJump <= TOL && s.tileMaxJump <= TOL;
      console.log(`  known-good (idle, ${idle.length} frames): drawing ${s.elMaxJump.toFixed(2)} tile ${s.tileMaxJump.toFixed(2)}`);
      await page.evaluate(startRec);
    }
    const cur = await page.evaluate(() => document.querySelector('[data-testid="left-menu-panel"]')?.getBoundingClientRect().width ?? 300);
    const wide = Math.min(620, cur + 200), narrow = Math.max(240, cur - 40);
    // wider
    let rel = await slowDrag(page, 0, wide - cur);
    let frames = await page.evaluate(stopRec);
    judge(`${tag} · ${tab} · wider`, frames, rel, { dragged: true });
    // narrower
    await page.evaluate(startRec);
    rel = await slowDrag(page, 0, -(wide - narrow));
    frames = await page.evaluate(stopRec);
    judge(`${tag} · ${tab} · narrower`, frames, rel, { dragged: true });
    // open/close toggle
    await page.evaluate(startRec);
    await page.evaluate((id) => document.querySelector(`[data-rail-tab="${id}"]`)?.click(), tab);
    await page.evaluate(() => new Promise((r) => setTimeout(r, 700)));
    await page.evaluate((id) => document.querySelector(`[data-rail-tab="${id}"]`)?.click(), tab);
    await page.evaluate(() => new Promise((r) => setTimeout(r, 700)));
    frames = await page.evaluate(stopRec);
    judge(`${tag} · ${tab} · open/close toggle`, frames, frames.length, { dragged: false });
  }
  if (errors.length) log(false, `${tag}: page errors: ${errors.slice(0, 2).join(" | ")}`);
  await ctx.close();
}
await browser.close();

if (measured === 0) { console.log("VOID — nothing was measured."); process.exit(2); }
if (knownGood !== true) { console.log("VOID — the known-good (idle) arm moved; the instrument cannot be trusted."); process.exit(2); }
console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${fail} failing check(s) across ${measured} recordings`);
if (EXPECT_RED) { console.log(fail > 0 ? "expected-red arm: instrument sees the shake ✓" : "expected-red arm FAILED TO GO RED"); process.exit(fail > 0 ? 0 : 1); }
process.exit(fail === 0 ? 0 : 1);
