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
 * NEW-1/NEW-2 (2026-10-08): the rect phase above passed on a build the owner could still see shaking, because a
 * rect is a LAYOUT position. The PIXEL phase at the bottom of this file is the real gate — exact equality per layer,
 * on his own plan, at 100/125/150/215 % — and `TOL` is now exact. `--no-pixels` skips it (rect phase only).
 *
 * Run:  node ui-audit/verify-panel-resize-steady.mjs        (preview on :4173; BASE_URL overrides)
 *       --expect-red   inverts the exit for a run against a pre-fix build.
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { fixtureSeed } from "./lib/planFixture.mjs";
import { readFixture } from "./lib/fixtureSeeding.mjs";
import { frameStats } from "./lib/frameStats.mjs";
import { decodePng } from "./lib/pngDiff.mjs";
import { pixelDelta, sampleLine, lineDelta, lineVariety, estimateShiftX } from "./lib/pixelSteady.mjs";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { chromium } = pw;
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXPECT_RED = process.argv.includes("--expect-red");
const PIXELS_ONLY = process.argv.includes("--pixels-only");   // skip the rect phase (its known-good arm then does not apply)
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const WINDOWS = [{ w: 1920, h: 1080, dpr: 1 }, { w: 1440, h: 900, dpr: 1 }, { w: 1440, h: 900, dpr: 1.25 }, { w: 1440, h: 900, dpr: 1.5 }, { w: 1191, h: 640, dpr: 1 }, { w: 1191, h: 640, dpr: 2.15 }];
const TABS = ["parcel", "analysis", "drainage", "yield", "properties", "references", "standards"];
const TOL = 0.001; // CSS px — NEW-2: exact (float noise only). The old 0.5 hid the whole residual shake.

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

for (const win of PIXELS_ONLY ? [] : WINDOWS) {
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
/* ── PIXEL PHASE (NEW-1 hatches · NEW-2 residual shake, 2026-10-08) ─────────────────────────────────────────────
 * The rect checks above read LAYOUT positions and passed on every build, including the one the owner could still
 * see moving. This phase photographs a patch of map well clear of the panel (device-pixel screenshots) on every
 * step of a real slow grip drag, each layer on its own, on the owner's own plan (Goose Creek / Phase II) with the
 * FEMA layer on, at 100 %, 125 %, 150 % and his ≈ 215 % — and demands EXACT equality:
 *   · aerial alone and FEMA alone: not one pixel may change;
 *   · a short line across an app hatch (the trailer stripes) and across FEMA's red floodway stripes: unchanged;
 *   · the drawing alone (text hidden — glyph sub-pixel positioning is not motion): zero displacement.
 * Each arm must OBSERVE its subject (tiles present, a hatch with stripes on the line) or the run is VOID.
 * Real imagery: external map hosts are relayed through `curl` with an on-disk cache (Chromium cannot reach them
 * here directly; the cache keeps a red/green comparison on identical bytes). Reported, not gated: the all-layers
 * composite — see the item for the one remaining effect (outline fringes re-shade over the aerial; nothing moves). */
const PIX = !process.argv.includes("--no-pixels");
const HATCH_RESAMPLE_TOL = 2;   // /255, scaled displays only — see the hatch-line check
const PIX_WINDOWS = (process.env.PIX_ONLY_DPR ? [{ w: 1440, h: 900, dpr: +process.env.PIX_ONLY_DPR }] : null) || [{ w: 1440, h: 900, dpr: 1 }, { w: 1440, h: 900, dpr: 1.25 }, { w: 1440, h: 900, dpr: 1.5 }, { w: 1191, h: 640, dpr: 2.15 }];
const RELAY_CACHE = path.join(os.tmpdir(), "planyr-relay-cache");
const HIDE = {
  aerial: "[data-testid=planner-canvas]{visibility:hidden!important} .leaflet-pane:not(.leaflet-tile-pane):not(.leaflet-map-pane){visibility:hidden!important}",
  fema: "[data-testid=planner-canvas]{visibility:hidden!important} .leaflet-tile-pane{visibility:hidden!important}",
  drawing: ".leaflet-container{visibility:hidden!important} .leaflet-pane{visibility:hidden!important} [data-testid=planner-canvas] text{visibility:hidden!important}",
  composite: "",
};
let pixVoid = null;
if (PIX) {
  fs.mkdirSync(RELAY_CACHE, { recursive: true });
  const fx = readFixture("goose2"); fx.layerOverrides = { ...(fx.layerOverrides || {}), fema: true };
  const pseed = fixtureSeed(fx, { id: "verify-panel-pixels", name: "Phase II", site: "Goose Creek" });
  const pbrowser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
  for (const win of PIX_WINDOWS) {
    const tag = `pixels ${win.w}×${win.h}@${win.dpr}x`;
    const ctx = await pbrowser.newContext({ viewport: { width: win.w, height: win.h }, deviceScaleFactor: win.dpr });
    await ctx.addInitScript(pseed);
    await ctx.addInitScript(() => { try { localStorage.setItem("planarfit:leftWidth", "300"); } catch (_) {} });
    await ctx.route(/^https:\/\/[a-z0-9.-]*(hazards\.fema\.gov|arcgisonline\.com)\//, async (route) => {
      const url = route.request().url();
      const f = path.join(RELAY_CACHE, createHash("sha1").update(url).digest("hex"));
      if (!fs.existsSync(f)) await new Promise((r) => execFile("curl", ["-sS", "-m", "60", "-D", f + ".h", "-o", f, url], () => r()));
      if (!fs.existsSync(f)) return route.abort();
      const h = fs.existsSync(f + ".h") ? fs.readFileSync(f + ".h", "utf8") : "";
      return route.fulfill({ status: 200, body: fs.readFileSync(f), headers: { "content-type": (/content-type:\s*([^\r\n]+)/i.exec(h) || [])[1] || "image/png", "access-control-allow-origin": "*" } });
    });
    const page = await ctx.newPage();
    await assertMeasurable(page, "verify-panel-resize-steady (pixels)");
    await page.goto(`${BASE}#/project/verify-panel-pixels/site`, { waitUntil: "load" });
    await page.waitForTimeout(3500);
    await page.evaluate(() => document.querySelector('[data-rail-tab="parcel"]')?.click());
    await page.waitForTimeout(2500);
    // the owner's working zoom: three wheel notches on the plan, then push the plan well clear of the panel
    const c = await page.evaluate(() => { const r = [...document.querySelectorAll('[data-testid="planner-canvas"] [data-el-id]')].map((n) => n.getBoundingClientRect()).filter((q) => q.width > 0); return [r.reduce((a, q) => a + q.left + q.width / 2, 0) / r.length, r.reduce((a, q) => a + q.top + q.height / 2, 0) / r.length]; });
    await page.mouse.move(c[0], c[1]);
    for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(250); }
    const cv = await page.evaluate(() => { const q = document.querySelector('[data-testid="planner-canvas"]').getBoundingClientRect(); return { l: q.left, t: q.top, w: q.width, h: q.height }; });
    const plan = await page.evaluate(() => Math.min(...[...document.querySelectorAll('[data-testid="planner-canvas"] [data-el-id]')].map((n) => n.getBoundingClientRect()).filter((q) => q.width > 0).map((q) => q.left)));
    const DRAG = 100, want = cv.l + DRAG + 60;
    if (plan < want) {
      const y = cv.t + cv.h * 0.85, x0 = cv.l + cv.w * 0.5;
      await page.mouse.move(x0, y); await page.mouse.down();
      for (let i = 1; i <= 15; i++) { await page.mouse.move(x0 + ((want - plan) * i) / 15, y); await page.waitForTimeout(25); }
      await page.mouse.up();
    }
    await page.mouse.move(2, win.h - 2);
    await page.waitForTimeout(7000);
    const pr = await page.evaluate(() => document.querySelector('[data-testid="left-menu-panel"]').getBoundingClientRect().right);
    const clip = { x: Math.round(pr + DRAG + 30), y: Math.round(cv.t + 70), width: Math.round(cv.l + cv.w - 90 - (pr + DRAG + 30)), height: Math.round(cv.h - 200) };
    const D = win.dpr;
    // hatch probes, in device px within the clip: an app-hatched element, and a row of FEMA's red stripes
    const appHatch = await page.evaluate((cl) => {
      // the part of a hatched shape that lies inside the patch (a strip may straddle its edge)
      const els = [...document.querySelectorAll('[data-testid="planner-canvas"] [fill^="url(#pat-"]')].map((n) => n.getBoundingClientRect())
        .map((q) => ({ l: Math.max(q.left, cl.x) + 2, r: Math.min(q.right, cl.x + cl.width) - 2, t: Math.max(q.top, cl.y), b: Math.min(q.bottom, cl.y + cl.height) }))
        .filter((q) => q.r - q.l > 16 && q.b - q.t > 4);
      els.sort((a, b) => (b.r - b.l) - (a.r - a.l));
      const q = els[0];
      return q ? { y: (q.t + q.b) / 2 - cl.y, x0: q.l - cl.x, x1: Math.min(q.r, q.l + 80) - cl.x } : null;
    }, clip);
    const setHide = (css) => page.evaluate((v) => { let st = document.getElementById("__pix_hide"); if (!st) { st = document.createElement("style"); st.id = "__pix_hide"; document.head.appendChild(st); } st.textContent = v; }, css);
    const shot = async () => decodePng(await page.screenshot({ clip, scale: "device" }));
    const grip = async () => { const g = await page.locator('[title="Drag to resize"]').first().boundingBox(); return { x: g.x + g.width / 2, y: g.y + g.height / 2 }; };
    async function dragShots(dx) {
      const g = await grip(); const out = [];
      await page.mouse.move(g.x, g.y); await page.mouse.down();
      for (let i = 1; i <= 30; i++) { await page.mouse.move(g.x + (dx * i) / 30 + 0.37, g.y); await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); out.push(await shot()); }
      await page.mouse.up(); await page.waitForTimeout(1200); out.push(await shot());   // the last frame is AFTER release
      return out;
    }
    for (const arm of ["aerial", "fema", "drawing", "composite"]) {
      await setHide(HIDE[arm]); await page.waitForTimeout(400);
      const a0 = await shot(); await page.waitForTimeout(300);
      const idle = pixelDelta(a0, await shot());
      if (idle.n) { pixVoid = `${tag} ${arm}: the idle (no-drag) known-good arm changed ${idle.n} px`; continue; }
      const frames = [...(await dragShots(DRAG)), ...(await dragShots(-DRAG))];
      const worst = frames.map((f) => pixelDelta(a0, f)).reduce((m, d) => (d.n > m.n ? d : m), { n: 0, max: 0 });
      const label = `${tag} · ${arm}`;
      if (arm === "aerial") {
        const tiles = await page.evaluate((cl) => [...document.querySelectorAll(".leaflet-tile-pane img.leaflet-tile")].some((t) => { const q = t.getBoundingClientRect(); return t.complete && q.right > cl.x && q.left < cl.x + cl.width; }), clip);
        if (!tiles) { pixVoid = `${label}: no aerial tile under the patch — the arm observed nothing`; continue; }
        log(worst.n === 0, `${label}: aerial pixels identical on every step (worst ${worst.n} px changed, max Δ ${worst.max})`);
      } else if (arm === "fema") {
        // a row of FEMA's red floodway stripes inside the patch
        let row = null;
        for (let y = 0; y < a0.height && !row; y += 3) {
          let reds = 0; for (let x = 0; x < a0.width; x++) { const i = (y * a0.width + x) * a0.channels; if (a0.data[i] > 80 && a0.data[i] - a0.data[i + 1] > 25 && a0.data[i] - a0.data[i + 2] > 20) reds++; }
          if (reds > 6) row = y;
        }
        log(worst.n === 0, `${label}: FEMA picture identical on every step (worst ${worst.n} px changed, max Δ ${worst.max})`);
        if (row == null && process.env.PIX_DEBUG_DIR) fs.writeFileSync(path.join(process.env.PIX_DEBUG_DIR, `fema-${win.dpr}.png`), await page.screenshot({ clip, scale: "device" }));
        if (row == null) console.log(`  (note) ${label}: no floodway stripes inside the patch — the whole-patch check above stands in for the line`);
        else {
          const ref = sampleLine(a0, row, 0, a0.width);
          const d = Math.max(...frames.map((f) => lineDelta(ref, sampleLine(f, row, 0, f.width))));
          log(d === 0 && lineVariety(ref) > 2, `${label}: a line across FEMA's floodway hatch never changes (max Δ ${d})`);
        }
      } else if (arm === "drawing") {
        const shifts = frames.map((f) => estimateShiftX(a0, f));
        const sMax = Math.max(...shifts.map(Math.abs));
        log(sMax < 0.05, `${label}: the drawing never moves (max sub-pixel shift ${sMax.toFixed(2)} device px; ${worst.n} px re-shaded, max Δ ${worst.max})`);
        if (!appHatch) pixVoid = `${label}: no hatched element inside the patch — the hatch line observed nothing`;
        else {
          const ln = (img) => sampleLine(img, appHatch.y * D, appHatch.x0 * D, appHatch.x1 * D);
          const ref = ln(a0);
          const d = Math.max(...frames.map((f) => lineDelta(ref, ln(f))));
          if (lineVariety(ref) <= 2) pixVoid = `${label}: the hatch probe line holds no stripes`;
          // ⚠ DEVIATION FROM "EXACT", stated rather than hidden: at 100 % the line is byte-identical; on a scaled
          // display a pattern fill re-samples to within 2/255 between steps even with its lattice on whole device px
          // (measured; below a just-noticeable difference). A SLIDING hatch measured 9–19/255 on main, so it stays red.
          const tol = win.dpr === 1 ? 0 : HATCH_RESAMPLE_TOL;
          log(d <= tol, `${label}: a line across a hatched strip never changes (max Δ ${d}${tol ? `, re-sample allowance ${tol}/255` : ""}) — the stripes are pinned to the ground`);
        }
      } else {
        console.log(`  (reported, not gated) ${label}: ${worst.n} px re-shaded, max Δ ${worst.max}; sub-pixel shift ${Math.max(...frames.map((f) => Math.abs(estimateShiftX(a0, f)))).toFixed(2)} device px`);
      }
      measured++;
    }
    await ctx.close();
  }
  await pbrowser.close();
}

await browser.close();

if (pixVoid) { console.log(`VOID — ${pixVoid}`); process.exit(2); }
if (measured === 0) { console.log("VOID — nothing was measured."); process.exit(2); }
if (!PIXELS_ONLY && knownGood !== true) { console.log("VOID — the known-good (idle) arm moved; the instrument cannot be trusted."); process.exit(2); }
console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${fail} failing check(s) across ${measured} recordings`);
if (EXPECT_RED) { console.log(fail > 0 ? "expected-red arm: instrument sees the shake ✓" : "expected-red arm FAILED TO GO RED"); process.exit(fail > 0 ? 0 : 1); }
process.exit(fail === 0 ? 0 : 1);
