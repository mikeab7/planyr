/* NEW-1 (parcel outlines lag the map when zooming) — a FRAME-BY-FRAME instrument. Drives the real app (Map → Select parcels) over the synthetic
 * Davidson service (ui-audit/lib/davidsonWideMock.mjs) and, on every animation frame of a real Leaflet zoom, measures how far the painted parcel
 * line sits from where the LOT'S CORNER truly is.
 *
 *   VITE_SUPABASE_URL="https://x.supabase.co" VITE_SUPABASE_ANON_KEY="dummy" npx vite build
 *   npx vite preview --port 4188 --strictPort &
 *   node ui-audit/verify-parcel-zoom-lock.mjs [--shots]
 *
 * THE ORACLE is Leaflet's own marker: a 1-px divIcon marker is put on a lot's corner, and Leaflet animates markers with the same zoom clock
 * as every tile (CSS transition on the marker's transform), so its on-screen rect at any frame IS where the corner is. The reading per frame is the
 * distance (screen px) from that point to the NEAREST painted parcel-line pixel on the parcel tile canvases (the canvas's getBoundingClientRect
 * gives its live, CSS-transformed rect, so a canvas that is not riding the zoom reads as far away). A lot corner has line pixels ON it, so a locked line
 * reads ≤ ~2 px; a line that lags reads as the size of its lag. "no ink within 80 px" is reported as null (the line is gone — a blank, not a lag).
 *
 * KNOWN-GOOD ARM (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6): before any zoom, at rest, the corner must read ≤ 2.5 px (else the instrument cannot see the effect
 * and the run is VOID). FOREGROUND-OR-VOID: assertMeasurable first. Frames come from a rAF loop in the page, never from timers. */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { CULVERT, DAVIDSON_URL, answerQuery, metaBody, lotAtCell } from "./lib/davidsonWideMock.mjs";
import { b64urlDecode } from "../src/shared/gis/gisProxyCore.js";

const BASE = process.env.BASE_URL || "http://localhost:4188/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const SHOTS = process.argv.includes("--shots");
const TRACE = process.argv.includes("--trace");
const BLANK_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const CORS = { "access-control-allow-origin": "*" };
const LOCKED_PX = 2.5; // a line is "locked" to its corner when painted ink is within this many screen px of it

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 880 } })).newPage();
await assertMeasurable(page, "verify-parcel-zoom-lock");
const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
await page.addInitScript(`(() => { try {
  window.__PLANYR_E2E = true;
  localStorage.setItem("planarfit:sites:v1", ${JSON.stringify(JSON.stringify({ s_wide: { id: "s_wide", groupId: "s_wide", site: "Wide Verify Site", name: "Plan 1", status: "active", origin: { lat: CULVERT.lat, lon: CULVERT.lng }, county: "tn_davidson", parcels: [], els: [], updatedAt: Date.now() } }))});
  localStorage.removeItem("planarfit:currentSite:v1");
} catch (e) {} })();`);

const state = { delayMs: 0 };
await page.route("**/*", async (r) => {
  const req = r.request(); const url = new URL(req.url());
  const isRelay = url.pathname.startsWith("/api/gis-cache/svc/");
  const isDirect = url.host === "services2.arcgis.com" && url.pathname.includes("/HdTo6HJqh92wn4D8/");
  if (isRelay || isDirect) {
    let service = DAVIDSON_URL, tail = "";
    if (isRelay) { const segs = url.pathname.split("/").filter(Boolean); service = b64urlDecode(segs[3]); tail = segs.slice(4).join("/"); }
    else tail = url.pathname.replace(/^.*\/FeatureServer\/0\/?/, "");
    if (service !== DAVIDSON_URL) return r.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: "{}" });
    if (tail === "") return r.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: metaBody() });
    if (tail === "query") {
      const p = req.method() === "POST" ? new URLSearchParams(req.postData() || "") : url.searchParams;
      if (state.delayMs) await new Promise((res) => setTimeout(res, state.delayMs));
      const a = answerQuery(p);
      try { return await r.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: a.body }); } catch (_) { return undefined; }
    }
  }
  if (/\/(MapServer|FeatureServer)\//i.test(req.url())) {
    if (/\/query/i.test(url.pathname)) return r.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify({ objectIdFieldName: "OBJECTID", features: [] }) });
    return r.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify({ name: "x", fields: [{ name: "OBJECTID", type: "esriFieldTypeOID" }] }) });
  }
  if (/\.(png|jpe?g)(\?|$)/i.test(url.pathname) || /arcgisonline|tile|basemaps/i.test(url.host)) return r.fulfill({ status: 200, contentType: "image/png", body: BLANK_PNG });
  return r.continue();
});

const sleep = (ms) => page.waitForTimeout(ms);
const waitFor = async (fn, ms = 8000) => { const t = Date.now(); let v; while (Date.now() - t < ms) { v = await fn(); if (v) return v; await sleep(150); } return v; };
const disp = () => page.evaluate(() => { const d = window.__mapParcelDisplay && window.__mapParcelDisplay(); return d ? d.layers.find((l) => /HdTo6HJqh92wn4D8/.test(l.url || "")) || null : null; });
const setView = (la, ln, z) => page.evaluate(([a, b, zz]) => { window.__mapFinderMap.setView([a, b], zz, { animate: false }); }, [la, ln, z]);
async function settled(ms = 9000) { await waitFor(async () => { const d = await disp(); return d && d.wide && d.wide.loading === 0; }, ms); await sleep(700); }

await page.goto(BASE + "#/site", { waitUntil: "domcontentloaded" });
await sleep(1500);
const row = page.locator('div[title*="Open site"]').filter({ hasText: "Wide Verify Site" }).first();
await row.hover(); await row.locator('[aria-label="Show on map"]').click(); await sleep(1200);

// a HUGE lot near the view centre: its corner has no neighbour closer than the 30 ft gap, and it is drawn at every stage
const huge = (() => { let best = null; for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) { const l = lotAtCell(i, j); if (l.kind === "huge") { const d = Math.hypot(i, j); if (!best || d < best.d) best = { l, d }; } } return best.l; })();
const CORNER = [huge.ring[0][1], huge.ring[0][0]]; // [lat, lng] of the SW corner
await setView(huge.centre[0], huge.centre[1], 17.4); await sleep(600);
await page.locator('[data-testid="map-toolbar-select-parcels"]').first().click(); await sleep(1500);

/* In-page probe: one rAF loop, one reading per frame. */
await page.evaluate(([cl]) => {
  const map = window.__mapFinderMap, L = window.L;
  if (!L) throw new Error("window.L is not exposed — the oracle marker cannot be placed");
  const mk = L.marker(cl, { icon: L.divIcon({ className: "zl-oracle", html: '<i style="display:block;width:1px;height:1px;background:red"></i>', iconSize: [1, 1], iconAnchor: [0, 0] }), interactive: false, keyboard: false }).addTo(map);
  const read = () => {
    const el = mk.getElement(); if (!el) return null;
    const r = el.getBoundingClientRect(); const cx = r.left, cy = r.top;
    let best = null, tiles = 0;
    document.querySelectorAll(".leaflet-overlay-pane canvas.leaflet-tile").forEach((c) => {
      if (!c.width) return;
      const b = c.getBoundingClientRect(); if (!b.width) return;
      const op = Number(getComputedStyle(c).opacity); if (op < 0.05) return;
      tiles++;
      const W = 80, x0 = Math.max(b.left, cx - W), x1 = Math.min(b.right, cx + W), y0 = Math.max(b.top, cy - W), y1 = Math.min(b.bottom, cy + W);
      if (x1 <= x0 || y1 <= y0) return;
      const sx = c.width / b.width, sy = c.height / b.height;
      const px0 = Math.floor((x0 - b.left) * sx), py0 = Math.floor((y0 - b.top) * sy), pw = Math.max(1, Math.ceil((x1 - x0) * sx)), ph = Math.max(1, Math.ceil((y1 - y0) * sy));
      const d = c.getContext("2d").getImageData(px0, py0, pw, ph).data;
      for (let yy = 0; yy < ph; yy++) for (let xx = 0; xx < pw; xx++) if (d[(yy * pw + xx) * 4 + 3] > 40) {
        const X = b.left + (px0 + xx) / sx, Y = b.top + (py0 + yy) / sy; const dist = Math.hypot(X - cx, Y - cy);
        if (best == null || dist < best) best = dist;
      }
    });
    const ops = [...document.querySelectorAll('.leaflet-overlay-pane canvas.leaflet-tile')].filter((c) => c.width).map((c) => Number(getComputedStyle(c).opacity).toFixed(1)).join(',');
    return { cx, cy, dist: best, tiles, ops };
  };
  window.__zl = { frames: [], running: false, mk, read,
    start() { this.frames = []; this.running = true; const t0 = performance.now(); const loop = () => { if (!this.running) return; const r = read(); if (r) this.frames.push({ t: Math.round(performance.now() - t0), ...r, z: Math.round(map.getZoom() * 100) / 100 }); requestAnimationFrame(loop); }; requestAnimationFrame(loop); },
    stop() { this.running = false; return this.frames; } };
}, [CORNER]);

const rest = async () => page.evaluate(() => window.__zl.read());
const live = await rest();
console.log(`KNOWN-GOOD ARM at rest (close stage): corner→line ${live && live.dist != null ? live.dist.toFixed(2) : "none"} px on ${live && live.tiles} tiles`);
if (!live || live.dist == null || live.dist > LOCKED_PX) { console.log("❌ VOID — the instrument cannot see the line at rest, so no zoom reading means anything"); await browser.close(); process.exit(2); }

const summary = [];
async function run(label, action, { hold = 2200 } = {}) {
  await page.evaluate(() => window.__zl.start());
  await action();
  await sleep(hold);
  const frames = await page.evaluate(() => window.__zl.stop());
  const valid = frames.filter((f) => f.dist != null);
  const worst = valid.reduce((m, f) => Math.max(m, f.dist), 0);
  const blank = frames.filter((f) => f.dist == null).length;
  const last = frames[frames.length - 1];
  // first time after which every reading stays locked
  let lockedAt = null; for (let i = frames.length - 1; i >= 0; i--) { if (frames[i].dist != null && frames[i].dist <= LOCKED_PX) lockedAt = frames[i].t; else break; }
  const firstBad = frames.find((f) => f.dist == null || f.dist > LOCKED_PX);
  const mid = frames.filter((f) => f.dist != null && f.dist > LOCKED_PX);
  const peak = mid.length ? mid.reduce((a, b) => (b.dist > a.dist ? b : a)) : null;
  const row = { label, frames: frames.length, worstPx: Number(worst.toFixed(1)), blankFrames: blank, badFrames: frames.filter((f) => f.dist == null || f.dist > LOCKED_PX).length, finalPx: last && last.dist != null ? Number(last.dist.toFixed(1)) : null, lockedFromMs: lockedAt, firstBadMs: firstBad ? firstBad.t : null, peakAt: peak ? { ms: peak.t, px: Number(peak.dist.toFixed(1)), z: peak.z } : null };
  summary.push(row);
  if (TRACE) console.log(frames.filter((f, i) => i % 2 === 0 && f.t < 900).map((f) => `${f.t}ms z${f.z} d=${f.dist == null ? "-" : f.dist.toFixed(1)} tiles=${f.tiles}${f.ops ? " op=" + f.ops : ""}`).join("\n    "));
  console.log(`  ${label.padEnd(44)} frames ${String(row.frames).padStart(3)}  worst ${String(row.worstPx).padStart(6)} px  blank ${String(blank).padStart(3)}  bad ${String(row.badFrames).padStart(3)}  final ${row.finalPx}  settled-from ${row.lockedFromMs}ms${row.peakAt ? `  (peak ${row.peakAt.px}px @${row.peakAt.ms}ms z${row.peakAt.z})` : ""}`);
  return frames;
}
const zoomBtn = (dz) => page.evaluate((d) => { const m = window.__mapFinderMap; m.setZoom(m.getZoom() + d); }, dz);
const center = () => page.evaluate(() => { const r = window.__mapFinderMap.getContainer().getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
const wheel = async (dy) => { const c = await center(); await page.mouse.move(c.x + 120, c.y - 60); await page.mouse.wheel(0, dy); };
async function reset(z) { await setView(huge.centre[0], huge.centre[1], z); await settled(); }

console.log("— animated zoom via the +/- buttons (Leaflet setZoom, zoomDelta 1) —");
await reset(17.4);
await run("close 17.4 → 16.4 (out, mid) [button]", () => zoomBtn(-1));
await settled();
await run("mid   16.4 → 15.4 (out, wide) [button]", () => zoomBtn(-1));
await settled();
await run("wide  15.4 → 16.4 (in, mid) [button]", () => zoomBtn(+1));
await settled();
await run("mid   16.4 → 17.4 (in, close) [button]", () => zoomBtn(+1));
await settled();
await run("close 17.4 → 18.4 (in, close) [button]", () => zoomBtn(+1));
await settled();
await run("close 18.4 → 17.4 (out, close) [button]", () => zoomBtn(-1));
await settled();
console.log("— mouse-wheel notch (anchored at the pointer) —");
await reset(17.4);
await run("close wheel out (×1)", () => wheel(120));
await settled();
await run("mid   wheel out (×1)", () => wheel(120));
await settled();
await run("wide  wheel in (×1)", () => wheel(-120));
await settled();
await run("mid   wheel in (×1)", () => wheel(-120));
await settled();
console.log("— slow county server (answers after 1.5 s) over GROUND THE WIDE LAYER HAS NEVER FETCHED: the lines must stay up until the next stage's lines arrive —");
const far = (() => { for (let i = 34; i < 44; i++) for (let j = 22; j < 32; j++) { const l = lotAtCell(i, j); if (l.kind === "huge") return l; } })();
await page.evaluate(([cl]) => window.__zl.mk.setLatLng(cl), [[far.ring[0][1], far.ring[0][0]]]);
await setView(far.centre[0], far.centre[1], 17.4);
await waitFor(async () => { const r = await rest(); return r && r.dist != null && r.dist <= LOCKED_PX; }, 8000);
await sleep(600);
state.delayMs = 1500;
await run("close 17.4 → 16.4 (out; mid tiles take 1.5 s)", () => zoomBtn(-1), { hold: 3600 });
await run("mid   16.4 → 15.4 (out; wide tiles take 1.5 s)", () => zoomBtn(-1), { hold: 3600 });
state.delayMs = 0;
await settled();
console.log("— panning (drag) —");
await page.evaluate(([cl]) => window.__zl.mk.setLatLng(cl), [CORNER]);
await reset(17.4);
await run("close drag 200 px", async () => { const c = await center(); await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.mouse.move(c.x + 200, c.y + 60, { steps: 12 }); await page.mouse.up(); }, { hold: 1500 });

if (SHOTS) await page.screenshot({ path: "ui-audit/screenshots/parcel-zoom-lock-after.png" });
const bad = summary.filter((s) => s.worstPx > LOCKED_PX || s.blankFrames > 0);
console.log(errs.length ? `page errors: ${errs.slice(0, 2).join(" | ")}` : "no page errors");
console.log(`\n${bad.length ? `❌ ${bad.length}/${summary.length} gestures had a frame where the line was off its corner by more than ${LOCKED_PX} px (or gone)` : `✅ every frame of every gesture held within ${LOCKED_PX} px`}`);
console.log(JSON.stringify(summary));
await browser.close();
process.exit(bad.length ? 1 : 0);
