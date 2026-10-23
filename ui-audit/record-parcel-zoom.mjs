/* NEW-1 (V1882768 / B2426464 ×4) — short REAL-SPEED screen recordings of Select parcels through every kind of zoom, for the owner to watch.
 *
 *   node ui-audit/record-parcel-zoom.mjs --live https://planyr.io --out DIR [--dpr 1,2]
 *
 * Signed in as the test account (the one shared helper), Map home only — no project opened or edited; /version.json read in the same run and
 * burned into the file name. Davidson TN around 20 Culvert St, Nashville, real Esri imagery, Select parcels on. One clip per gesture family:
 * mouse wheel (in, then out), trackpad-style scroll (in, then out), the +/− buttons (in, then out).
 * The frames are the COMPOSITED ones (CDP screencast) with the compositor's own timestamps, and each frame is held in the video for exactly
 * the time until the next one — so the clip plays at real speed, not at whatever rate frames happened to arrive. H.264 MP4.
 * At pixel ratio 2 the clip is the centre of the map at native device pixels (no downscale — the point is to see the lines' crispness).
 * Headless Chromium on a software compositor: real speed, but not the owner's GPU. FOREGROUND-OR-VOID: assertMeasurable first. */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = (arg("--live", null) || "https://planyr.io").replace(/\/$/, "");
const OUT = arg("--out", "ui-audit/screenshots/parcel-zoom-recordings");
const DPRS = String(arg("--dpr", "1,2")).split(",").map(Number);
const SPOT = { lat: 36.1376, lng: -86.75346, z: 17.4 }; // 20 Culvert St, Nashville
fs.mkdirSync(OUT, { recursive: true });

for (const dpr of DPRS) {
  const { browser, context, page } = await openSignedIn({ base: BASE, viewport: { width: 1440, height: 900 }, contextOptions: { deviceScaleFactor: dpr, hasTouch: true }, initScripts: [[() => { window.__PLANYR_E2E = true; }]] });
  await assertMeasurable(page, "record-parcel-zoom");
  const ver = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null));
  const build = String((ver && (ver.build || ver.commit)) || "unknown").slice(0, 7);
  console.log(`dpr ${dpr}: planyr.io build ${build}`);
  const sleep = (ms) => page.waitForTimeout(ms);
  const waitFor = async (fn, ms = 15000) => { const t = Date.now(); let v; while (Date.now() - t < ms) { v = await fn(); if (v) return v; await sleep(200); } return v; };
  await page.goto(`${BASE}/?cb=${Date.now()}#/map`, { waitUntil: "domcontentloaded" });
  await waitFor(() => page.evaluate(() => !!window.__mapFinderMap), 20000);
  await sleep(2500);
  const setView = async (z) => {
    for (let i = 0; i < 20; i++) {
      await page.evaluate(([a, b, zz]) => window.__mapFinderMap.setView([a, b], zz, { animate: false }), [SPOT.lat, SPOT.lng, z]); await sleep(1000);
      if (await page.evaluate(([zz]) => Math.abs(window.__mapFinderMap.getZoom() - zz) < 0.01, [z])) return;
    }
  };
  await setView(SPOT.z);
  await page.locator('[data-testid="map-toolbar-select-parcels"]').first().click();
  const settled = async () => { await waitFor(() => page.evaluate(() => { const d = window.__mapParcelDisplay && window.__mapParcelDisplay(); return d && d.layers.every((l) => !l.wide || l.wide.loading === 0) && [...document.querySelectorAll(".leaflet-tile-pane img.leaflet-tile")].every((i) => i.complete); }), 20000); await sleep(1200); };
  await settled();
  const box = await page.evaluate(() => { const r = window.__mapFinderMap.getContainer().getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const cdp = await context.newCDPSession(page);
  let frames = [], recording = false;
  cdp.on("Page.screencastFrame", (f) => { cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {}); if (recording) frames.push({ t: f.metadata.timestamp, data: f.data }); });
  const center = async () => page.mouse.move(cx, cy);
  const wheel = async (dy, n = 1, gap = 0) => { await center(); for (let i = 0; i < n; i++) { await page.mouse.wheel(0, dy); if (gap) await sleep(gap); } };
  const stream = async (dy, n, gap) => { await center(); for (let i = 0; i < n; i++) { await page.mouse.wheel(0, dy); await sleep(gap); } };
  const btn = (sel) => page.locator(sel).first().click();

  async function clip(name, steps) {
    await setView(SPOT.z); await settled(); await center();
    frames = []; recording = true;
    await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1, maxWidth: Math.round(1440 * dpr), maxHeight: Math.round(900 * dpr) });
    await sleep(900);
    for (const s of steps) { await s(); await sleep(1700); }
    // a still frame at the end so the last frame has a duration
    await page.mouse.move(cx + 1, cy); await sleep(300);
    recording = false; await cdp.send("Page.stopScreencast");
    const dir = fs.mkdtempSync(path.join(OUT, ".frames-")); const list = [];
    frames.forEach((f, i) => { const p = path.join(dir, `${String(i).padStart(4, "0")}.png`); fs.writeFileSync(p, Buffer.from(f.data, "base64")); const next = frames[i + 1]; list.push(`file '${path.resolve(p)}'`, `duration ${next ? Math.max(0.001, next.t - f.t).toFixed(4) : 0.5}`); });
    list.push(`file '${path.resolve(path.join(dir, `${String(frames.length - 1).padStart(4, "0")}.png`))}'`);
    fs.writeFileSync(path.join(dir, "list.txt"), list.join("\n"));
    const file = path.join(OUT, `davidson-20-culvert-st-${name}-pixel-ratio-${dpr}-build-${build}.mp4`);
    const vf = dpr > 1 ? `crop=${1440}:${900}:(in_w-1440)/2:(in_h-900)/2,fps=60` : "fps=60"; // pr 2: the map's centre at native device px
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", path.join(dir, "list.txt"), "-vf", vf, "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-pix_fmt", "yuv420p", "-movflags", "+faststart", file]);
    fs.rmSync(dir, { recursive: true, force: true });
    const secs = frames.length ? frames[frames.length - 1].t - frames[0].t : 0;
    console.log(`  ${file}  ${frames.length} frames over ${secs.toFixed(1)} s  ${(fs.statSync(file).size / 1e6).toFixed(2)} MB`);
  }
  await clip("mouse-wheel-in-then-out", [() => wheel(-100), () => wheel(100)]);
  await clip("trackpad-scroll-in-then-out", [() => stream(-8, 6, 16), () => stream(8, 6, 16)]);
  await clip("plus-minus-buttons-in-then-out", [() => btn(".leaflet-control-zoom-in"), () => btn(".leaflet-control-zoom-out")]);
  await browser.close();
}
