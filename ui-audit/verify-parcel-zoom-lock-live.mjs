/* NEW-1 (parcel outlines lag the map when zooming, then snap into place a second later) — the REAL-COUNTY twin of verify-parcel-zoom-lock.mjs.
 *
 *   Live:   node ui-audit/verify-parcel-zoom-lock-live.mjs --live https://planyr.io     (signs in as the test account; reads /version.json; Map home only — no project is opened or edited)
 *   Local:  vite preview --port 4188 --strictPort, then node ui-audit/verify-parcel-zoom-lock-live.mjs   (no relay in `vite preview`: tiles fall back to the county directly)
 *
 * For Davidson TN (20 Culvert St, Nashville) and Harris TX (Katy) the page is flown to the county at the CLOSE stage, Select parcels is turned on, and the view is
 * walked OUT through mid and wide and back IN, by the +/- buttons (animated), by a mouse-wheel notch, and by a drag. A rAF loop reads, on EVERY frame of every gesture and
 * for 3 s after it, how much line is painted on the parcel tile canvases that cover the viewport. Two readings:
 *   BLANK FRAME   no parcel line is painted anywhere in the viewport although lines were there before the gesture — the owner's "the lines go away and come back a second
 *                 later". This is the property that failed (on a real county server it lasts as long as the county's answer takes).
 *   ON-LINE       a marker is put (via Leaflet, which animates it with the tiles' own zoom clock) on a pixel that was ON a line at rest; the distance from it to the nearest
 *                 painted line pixel must stay small through the zoom — the lines ride the animation. (Weaker than the mock twin's lot corner — a real county has no known
 *                 corner and a neighbouring line can be nearer — so it can only under-report a drift, never invent one.)
 * KNOWN-GOOD ARM: at rest the viewport must hold painted line (else the run is VOID: the place has no lots at this stage, or the county did not answer).
 * FOREGROUND-OR-VOID: assertMeasurable first; frames come from rAF, never from timers. */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const LIVE = process.argv.includes("--live") ? process.argv[process.argv.indexOf("--live") + 1] : null;
const BASE = (LIVE || process.env.BASE_URL || "http://localhost:4188/").replace(/\/$/, "");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const CASES = [
  { name: "Davidson TN — 20 Culvert St, Nashville", lat: 36.13760, lng: -86.75346, floor: 17 },
  { name: "Harris TX — Katy", lat: 29.8130, lng: -95.8100, floor: 16 },
];
const LOCKED_PX = 3; // an on-line marker reads within this many screen px of a painted line pixel
let failures = 0;
const expect = (label, cond, extra = "") => { if (!cond) failures++; console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${extra ? ` — ${extra}` : ""}`); };

let browser = null, closeSigned = null, page;
if (LIVE) {
  const { openSignedIn } = await import("./lib/signedInSession.mjs");
  const s = await openSignedIn({ base: BASE, initScripts: [[() => { window.__PLANYR_E2E = true; }, undefined]] });
  closeSigned = s.close; page = s.page; console.log("signed in:", s.proof, "build:", s.build);
} else {
  browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
  page = await (await browser.newContext({ viewport: { width: 1400, height: 880 } })).newPage();
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
}
await assertMeasurable(page, "verify-parcel-zoom-lock-live");
const ver = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null)).catch(() => null);
console.log("version.json:", JSON.stringify(ver));
const errs = []; page.on("pageerror", (e) => errs.push(String(e)));

const sleep = (ms) => page.waitForTimeout(ms);
const waitFor = async (fn, ms = 15000) => { const t = Date.now(); let v; while (Date.now() - t < ms) { v = await fn(); if (v) return v; await sleep(250); } return v; };
const disp = () => page.evaluate(() => { const d = window.__mapParcelDisplay && window.__mapParcelDisplay(); return d ? d.layers : null; });
const idle = async (ms = 20000) => { await waitFor(async () => { const d = await disp(); return d && d.length && d.every((l) => !l.wide || l.wide.loading === 0); }, ms); await sleep(900); };

await page.goto((LIVE ? BASE : BASE) + "/#/map", { waitUntil: "domcontentloaded" });
await sleep(2500);
const selBtn = page.locator('[data-testid="map-toolbar-select-parcels"]').first();
await waitFor(async () => (await selBtn.count()) > 0, 15000);

/* in-page probe */
await page.evaluate(() => {
  const map = window.__mapFinderMap, L = window.L;
  const inkNear = (cx, cy, W) => {
    let best = null, total = 0;
    document.querySelectorAll(".leaflet-overlay-pane canvas.leaflet-tile").forEach((c) => {
      if (!c.width) return;
      const b = c.getBoundingClientRect(); if (!b.width || b.right < 0 || b.bottom < 0 || b.left > innerWidth || b.top > innerHeight) return;
      if (Number(getComputedStyle(c).opacity) < 0.05) return;
      const sx = c.width / b.width, sy = c.height / b.height;
      const x0 = Math.max(b.left, cx == null ? 0 : cx - W), x1 = Math.min(b.right, cx == null ? innerWidth : cx + W), y0 = Math.max(b.top, cy == null ? 0 : cy - W), y1 = Math.min(b.bottom, cy == null ? innerHeight : cy + W);
      if (x1 <= x0 || y1 <= y0) return;
      const px0 = Math.floor((x0 - b.left) * sx), py0 = Math.floor((y0 - b.top) * sy), pw = Math.max(1, Math.ceil((x1 - x0) * sx)), ph = Math.max(1, Math.ceil((y1 - y0) * sy));
      const d = c.getContext("2d").getImageData(px0, py0, pw, ph).data;
      for (let yy = 0; yy < ph; yy += 1) for (let xx = 0; xx < pw; xx += 1) if (d[(yy * pw + xx) * 4 + 3] > 40) {
        total++;
        if (cx != null) { const X = b.left + (px0 + xx) / sx, Y = b.top + (py0 + yy) / sy; const dist = Math.hypot(X - cx, Y - cy); if (best == null || dist < best) best = dist; }
      }
    });
    return { best, total };
  };
  window.__zl = { mk: null, frames: [], running: false,
    pickOnLine() { // an ink pixel near the viewport centre
      const r = map.getContainer().getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      let found = null;
      document.querySelectorAll(".leaflet-overlay-pane canvas.leaflet-tile").forEach((c) => {
        if (!c.width || found) return; const b = c.getBoundingClientRect(); if (cx < b.left || cx > b.right || cy < b.top || cy > b.bottom) return;
        const sx = c.width / b.width, sy = c.height / b.height; const W = 120;
        const x0 = Math.max(b.left, cx - W), y0 = Math.max(b.top, cy - W), x1 = Math.min(b.right, cx + W), y1 = Math.min(b.bottom, cy + W);
        const px0 = Math.floor((x0 - b.left) * sx), py0 = Math.floor((y0 - b.top) * sy), pw = Math.ceil((x1 - x0) * sx), ph = Math.ceil((y1 - y0) * sy);
        const d = c.getContext("2d").getImageData(px0, py0, pw, ph).data; let bd = Infinity, bp = null;
        for (let yy = 0; yy < ph; yy++) for (let xx = 0; xx < pw; xx++) if (d[(yy * pw + xx) * 4 + 3] > 200) { const X = b.left + (px0 + xx) / sx, Y = b.top + (py0 + yy) / sy; const dd = Math.hypot(X - cx, Y - cy); if (dd < bd) { bd = dd; bp = [X, Y]; } }
        if (bp) found = bp;
      });
      if (!found) return null;
      const ll = map.containerPointToLatLng([found[0] - r.left, found[1] - r.top]);
      if (this.mk) this.mk.remove();
      this.mk = L.marker(ll, { icon: L.divIcon({ className: "zl-oracle", html: '<i style="display:block;width:1px;height:1px"></i>', iconSize: [1, 1], iconAnchor: [0, 0] }), interactive: false, keyboard: false }).addTo(map);
      return { x: found[0], y: found[1] };
    },
    read() {
      const all = inkNear(null, null, 0);
      let near = null;
      if (this.mk && this.mk.getElement()) { const rr = this.mk.getElement().getBoundingClientRect(); near = inkNear(rr.left, rr.top, 90).best; }
      return { total: all.total, near };
    },
    start() { this.frames = []; this.running = true; const t0 = performance.now(); const loop = () => { if (!this.running) return; this.frames.push({ t: Math.round(performance.now() - t0), z: Math.round(map.getZoom() * 100) / 100, ...this.read() }); requestAnimationFrame(loop); }; requestAnimationFrame(loop); },
    stop() { this.running = false; return this.frames; } };
});

const summary = [];
async function gesture(label, action, { hold = 3000, oracle = true } = {}) {
  const before = await page.evaluate(() => window.__zl.read());
  await page.evaluate(() => window.__zl.start());
  await action();
  await sleep(hold);
  const frames = await page.evaluate(() => window.__zl.stop());
  const blank = frames.filter((f) => f.total === 0);
  const offLine = oracle ? frames.filter((f) => f.near != null && f.near > LOCKED_PX) : [];
  const worst = oracle ? frames.reduce((m, f) => (f.near != null ? Math.max(m, f.near) : m), 0) : 0;
  const lastBlank = blank.length ? blank[blank.length - 1].t : null;
  const row = { label, frames: frames.length, hadInkBefore: before.total > 0, blankFrames: blank.length, blankMs: blank.length ? lastBlank - blank[0].t : 0, offLineFrames: offLine.length, worstOffLinePx: Number(worst.toFixed(1)) };
  summary.push(row);
  console.log(`  ${label.padEnd(46)} frames ${String(row.frames).padStart(3)}  blank ${String(row.blankFrames).padStart(3)} (${row.blankMs} ms)  off-line frames ${String(row.offLineFrames).padStart(3)} worst ${row.worstOffLinePx} px`);
  if (before.total > 0) expect(`${label}: no frame with the parcel lines gone`, blank.length === 0, `${blank.length} blank frames over ${row.blankMs} ms`);
  else console.log(`    (no line painted before this gesture — blank-frame check skipped, not scored)`);
  return row;
}
const zoomBtn = (dz) => page.evaluate((d) => { const m = window.__mapFinderMap; m.setZoom(m.getZoom() + d); }, dz);
const centre = () => page.evaluate(() => { const r = window.__mapFinderMap.getContainer().getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });

for (const c of CASES) {
  console.log(`\n=== ${c.name} (cutoff ${c.floor}) ===`);
  await page.evaluate(([la, ln, z]) => window.__mapFinderMap.setView([la, ln], z, { animate: false }), [c.lat, c.lng, c.floor + 0.4]);
  await sleep(800);
  if (!((await disp()) || []).length) await selBtn.click(); // Select parcels is already on after the first county
  await idle();
  const rest = await waitFor(async () => (await page.evaluate(() => window.__zl.read())).total > 0, 20000);
  const restRead = await page.evaluate(() => window.__zl.read());
  expect(`KNOWN-GOOD ARM: ${c.name} paints parcel lines at rest (else this county is VOID)`, !!rest && restRead.total > 0, `${restRead.total} line pixels`);
  if (!rest) continue;
  const picked = await page.evaluate(() => window.__zl.pickOnLine());
  expect("an on-line oracle point was found at rest", !!picked, JSON.stringify(picked));
  const oracle = !!picked;
  await gesture("close → mid (out, +/- button)", () => zoomBtn(-1), { oracle });
  await idle();
  await page.evaluate(() => window.__zl.pickOnLine());
  await gesture("mid → wide (out, +/- button)", () => zoomBtn(-1), { oracle });
  await idle();
  await page.evaluate(() => window.__zl.pickOnLine());
  await gesture("wide → mid (in, +/- button)", () => zoomBtn(+1), { oracle });
  await idle();
  await page.evaluate(() => window.__zl.pickOnLine());
  await gesture("mid → close (in, +/- button)", () => zoomBtn(+1), { oracle });
  await idle();
  await page.evaluate(() => window.__zl.pickOnLine());
  await gesture("close → deeper (in, +/- button)", () => zoomBtn(+1), { oracle });
  await idle();
  await page.evaluate(() => window.__zl.pickOnLine());
  await gesture("deeper → close (out, +/- button)", () => zoomBtn(-1), { oracle });
  await idle();
  await page.evaluate(() => window.__zl.pickOnLine());
  await gesture("close → mid (out, mouse-wheel notch)", async () => { const p = await centre(); await page.mouse.move(p.x + 120, p.y - 60); await page.mouse.wheel(0, 120); }, { oracle });
  await idle();
  await page.evaluate(() => window.__zl.pickOnLine());
  await gesture("mid → close (in, mouse-wheel notch)", async () => { const p = await centre(); await page.mouse.move(p.x + 120, p.y - 60); await page.mouse.wheel(0, -120); }, { oracle });
  await idle();
  await page.evaluate(() => window.__zl.pickOnLine());
  await gesture("close drag 200 px", async () => { const p = await centre(); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 200, p.y + 60, { steps: 12 }); await page.mouse.up(); }, { hold: 2000, oracle });
}
expect("no uncaught page errors", errs.length === 0, errs.slice(0, 2).join(" | "));
console.log(JSON.stringify({ build: ver, summary }));
if (closeSigned) await closeSigned(); else if (browser) await browser.close();
console.log(`\n${failures ? `❌ ${failures} FAILED` : "✅ PASS"} — parcel lines stay up through a zoom (real counties)`);
process.exit(failures ? 1 : 0);
