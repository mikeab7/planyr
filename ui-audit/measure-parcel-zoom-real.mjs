/* NEW-1 (V1882768 / B2426464 ×4) — do the parcel outlines stay ON THE REAL IMAGERY through a zoom, frame by frame, over real counties?
 *
 *   node ui-audit/measure-parcel-zoom-real.mjs --live https://planyr.io [--dpr 1,2] [--only wheel] [--crops DIR] [--county davidson|harris]
 *
 * The twin of measure-parcel-zoom-slide.mjs for the place the owner actually zooms: real Esri imagery, real county parcels (Davidson TN around
 * 20 Culvert St, Nashville; Harris TX, Katy), nothing mocked. Signed in as the test account (the one shared helper), Map home only — no
 * project is opened or edited. /version.json is read in the same run.
 * There is no red band painted into real imagery, so the imagery itself is the oracle (lib/imageryRegister.mjs): per composited frame
 * (CDP screencast), the transform that maps the REST frame's imagery onto this frame's imagery is found by correlation, the rest frame's
 * outline pixels are carried through it, and the distance to this frame's nearest outline pixel is the slide (CSS px).
 * KNOWN-GOOD ARM: two rest frames must register at scale 1 (± 0.002) with the outline ≤ 1 px median, or the county is VOID.
 * A frame whose imagery does not register (NCC < 0.5 — e.g. a new imagery level still loading) is counted, never judged.
 * FOREGROUND-OR-VOID: assertMeasurable before anything. */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { decodePng } from "./lib/pngDiff.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { fitImagery, outlinePoints, outlineOffset, persistentOutline } from "./lib/imageryRegister.mjs";
import { cropPng } from "./lib/slideCrop.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = (arg("--live", null) || process.env.BASE_URL || "https://planyr.io").replace(/\/$/, "");
const DPRS = String(arg("--dpr", "1,2")).split(",").map(Number);
const ONLY = arg("--only", null);
const CROPS = arg("--crops", null);
const ONLY_COUNTY = arg("--county", null);
const LIMIT_PX = Number(arg("--limit", "2"));
const CASES = [
  { key: "davidson", name: "Davidson TN — 20 Culvert St, Nashville", lat: 36.1376, lng: -86.75346, close: 17.4 },
  { key: "harris", name: "Harris TX — Katy", lat: 29.813, lng: -95.81, close: 17.0 },
].filter((c) => !ONLY_COUNTY || c.key === ONLY_COUNTY);

async function runAtDpr(dpr) {
  // a local preview (the positive control: a known-broken build) has no sign-in route — plain Chromium there
  const local = /localhost|127\.0\.0\.1/.test(BASE);
  const { browser, context, page, build } = local
    ? await (async () => { const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] }); const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dpr, hasTouch: true }); await context.addInitScript(() => { window.__PLANYR_E2E = true; }); return { browser, context, page: await context.newPage(), build: null }; })()
    : await openSignedIn({ base: BASE, viewport: { width: 1440, height: 900 }, contextOptions: { deviceScaleFactor: dpr, hasTouch: true }, initScripts: [[() => { window.__PLANYR_E2E = true; }]] });
  await assertMeasurable(page, "measure-parcel-zoom-real");
  const ver = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null));
  console.log(`\n=== dpr ${dpr} === planyr.io build ${ver && (ver.build || ver.commit || JSON.stringify(ver))} (helper read ${build && (build.build || build.commit)})`);
  const sleep = (ms) => page.waitForTimeout(ms);
  const waitFor = async (fn, ms = 15000) => { const t = Date.now(); let v; while (Date.now() - t < ms) { v = await fn(); if (v) return v; await sleep(200); } return v; };
  await page.goto(`${BASE}/?cb=${Date.now()}#/map`, { waitUntil: "domcontentloaded" });
  await waitFor(() => page.evaluate(() => !!window.__mapFinderMap), 20000);
  await sleep(2500);
  await page.addStyleTag({ content: ".planyr-lot-no,.leaflet-marker-pane,.leaflet-shadow-pane{display:none!important}" });
  /* --plant-lag: the POSITIVE CONTROL. The parcel layer's level containers get a CSS transition, so on screen the outlines trail the imagery
   * through a zoom and catch up after — the exact shape of the defect this harness exists to see. A run with it must go RED. */
  if (process.argv.includes("--plant-lag")) await page.addStyleTag({ content: ".leaflet-container .leaflet-zoom-anim .leaflet-overlay-pane .leaflet-tile-container.leaflet-zoom-animated{transition:transform 160ms linear!important}" /* outranks lockstepZoom's transition:none */ });
  const disp = () => page.evaluate(() => { const d = window.__mapParcelDisplay && window.__mapParcelDisplay(); return d ? d.layers : null; });
  const settled = async () => { await waitFor(async () => { const d = await disp(); return d && d.length && d.every((l) => !l.wide || l.wide.loading === 0); }, 20000); await waitFor(() => page.evaluate(() => [...document.querySelectorAll(".leaflet-tile-pane img.leaflet-tile")].every((i) => i.complete)), 15000); await sleep(1200); };
  const box = await page.evaluate(() => { const r = window.__mapFinderMap.getContainer().getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const WIN = [box.x + 270, box.y + 150, box.x + box.w - 410, box.y + box.h - 110];
  const cdp = await context.newCDPSession(page);
  let frames = [], recording = false;
  cdp.on("Page.screencastFrame", (f) => { cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {}); if (recording) frames.push({ t: f.metadata.timestamp, data: f.data }); });
  const shot = async () => decodePng(Buffer.from((await cdp.send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  const results = [];
  let selected = false;

  for (const c of CASES) {
    const setView = async (z) => {
      const t0 = Date.now();
      for (;;) {
        await page.evaluate(([a, b, zz]) => window.__mapFinderMap.setView([a, b], zz, { animate: false }), [c.lat, c.lng, z]); await sleep(1000);
        const ok = await page.evaluate(([a, b, zz]) => { const m = window.__mapFinderMap, q = m.getCenter(); return Math.abs(m.getZoom() - zz) < 0.01 && Math.abs(q.lat - a) < 1e-4 && Math.abs(q.lng - b) < 1e-4; }, [c.lat, c.lng, z]);
        if (ok) return; if (Date.now() - t0 > 20000) throw new Error("measure-parcel-zoom-real: the map would not stay put");
      }
    };
    await setView(c.close);
    if (!selected) { await page.locator('[data-testid="map-toolbar-select-parcels"]').first().click(); selected = true; }
    await settled();
    const k0 = (await shot()).width / 1440;
    const win = WIN.map((v) => v * k0), anchor = [cx * k0, cy * k0];
    // KNOWN-GOOD ARM: two rest frames
    const a = await shot(); await sleep(400); const b = await shot();
    const xa = fitImagery(a, b, { win, anchor, coarse: Math.round(4 * k0), slack: 16 * k0 });
    const oa = outlineOffset(outlinePoints(a, win), b, xa, { win, reach: Math.round(12 * k0) });
    console.log(`${c.name}: KNOWN-GOOD ARM rest→rest scale ${xa.s.toFixed(4)} ncc ${xa.ncc.toFixed(2)}, outline ${oa.n} pts median ${oa.median == null ? "—" : (oa.median / k0).toFixed(2)} px`);
    if (!oa.n || oa.n < 100 || Math.abs(xa.s - 1) > 0.002 || oa.median / k0 > 1) { console.log("  ❌ VOID for this county — no outline at rest, or the imagery does not register to itself"); results.push({ dpr, county: c.key, void: true }); continue; }

    async function gesture(label, action, { hold = 1800, startZ = c.close } = {}) {
      if (ONLY && !label.includes(ONLY)) return;
      await setView(startZ); await settled();
      const before = await shot();
      frames = []; recording = true;
      await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1, maxWidth: Math.round(1440 * dpr), maxHeight: Math.round(900 * dpr) });
      await sleep(120); await action(); await sleep(hold);
      recording = false; await cdp.send("Page.stopScreencast");
      /* The reference is the CLOSER of the two settled views (before / after): every frame then shows that picture at a scale ≤ 1, so the
       * reference's outline stays inside the window on every frame. (Referencing the start of a fast multi-level zoom-IN carried most of its
       * outline off screen and left the late frames unjudgeable.) */
      await settled();
      const zoomIn = label.includes(" in") || label.includes("+");
      const after = await shot();
      const rest = zoomIn ? after : before, other = zoomIn ? before : after;
      // judge only lines drawn at BOTH ends: a stage change drops small lots by design (persistentOutline)
      const xfOther = fitImagery(rest, other, { win, anchor, coarse: Math.round(4 * k0), slack: 40 * k0, sMin: 0.12, sMax: 3.2 });
      const per = persistentOutline(outlinePoints(rest, win, 4000), other, xfOther, { win, tol: 1.5 * k0, reach: Math.round(12 * k0) });
      if (process.argv.includes("--debug-ends")) { const fs = await import("node:fs"); const { encodeRgbPng } = await import("./lib/fakeTile.mjs"); for (const [n, im] of [["rest", rest], ["other", other]]) fs.writeFileSync(`/tmp/claude-0/end-${n}.png`, encodeRgbPng(im.width, im.height, (row, col, p, raw) => { const o = (row * im.width + col) * im.channels; raw[p] = im.data[o]; raw[p + 1] = im.data[o + 1]; raw[p + 2] = im.data[o + 2]; })); console.log("ends", JSON.stringify(xfOther), per.share); }
      if (xfOther.ncc < 0.5 || per.share < 0.25) { console.log(`  ${label.padEnd(34)} ❌ VOID — the two settled ends do not share their lines (kept ${Math.round(per.share * 100)}%, ncc ${xfOther.ncc.toFixed(2)})`); results.push({ dpr, county: c.key, label, void: true }); return; }
      const restOutline = per.kept.length > 1500 ? per.kept.filter((_, i) => i % Math.ceil(per.kept.length / 1500) === 0) : per.kept;
      const t0 = frames.length ? frames[0].t : 0;
      let prev = null, worst = 0, off = 0, unreg = 0, judged = 0, worstFrame = -1; const verdictLines = [];
      for (const [i, f] of frames.entries()) {
        const img = decodePng(Buffer.from(f.data, "base64")); const k = img.width / 1440;
        const w = WIN.map((v) => v * k), an = [cx * k, cy * k];
        const xf = fitImagery(rest, img, { win: w, anchor: an, coarse: Math.round(4 * k), slack: 40 * k, prev, sMin: 0.12, sMax: 3.2 });
        if (xf.ncc < 0.5) { unreg++; prev = null; continue; }
        prev = xf;
        const o = outlineOffset(restOutline, img, xf, { win: w, reach: Math.round(12 * k) });
        if (!o.n || o.n < 40) continue;
        judged++;
        const med = o.median / k;
        if (med > worst) { worst = med; worstFrame = i; }
        if (med > LIMIT_PX) {
          off++;
          if (CROPS) {
            const fs = await import("node:fs"); fs.mkdirSync(CROPS, { recursive: true });
            const name = `${CROPS}/real-${c.key}-dpr${dpr}-${label.replace(/\W+/g, "_")}-f${String(i).padStart(3, "0")}-${med.toFixed(1)}px`;
            fs.writeFileSync(name + "-frame.png", Buffer.from(f.data, "base64"));
            fs.writeFileSync(name + ".json", JSON.stringify({ county: c.key, dpr, gesture: label, frame: i, ms: Math.round((f.t - t0) * 1000), medianPx: med, p90Px: o.p90 / k, xf }, null, 1));
          }
          verdictLines.push(`    frame ${i} (${Math.round((f.t - t0) * 1000)} ms) outline median ${med.toFixed(1)} px, p90 ${(o.p90 / k).toFixed(1)} px off the imagery (scale ${xf.s.toFixed(3)}, ncc ${xf.ncc.toFixed(2)})`);
        }
      }
      const row = { dpr, county: c.key, label, frames: frames.length, judged, unregistered: unreg, worstPx: +worst.toFixed(2), framesOff: off, linesKept: +per.share.toFixed(2) };
      results.push(row);
      console.log(`  ${label.padEnd(34)} lines kept ${String(Math.round(per.share * 100)).padStart(3)}%  frames ${String(frames.length).padStart(3)} judged ${String(judged).padStart(3)} unregistered ${String(unreg).padStart(3)}  worst ${String(row.worstPx).padStart(5)} px  off>${LIMIT_PX} ${off}`);
      for (const l of verdictLines) console.log(l);
    }
    const btn = (sel) => page.locator(sel).first().click();
    const center = async () => page.mouse.move(cx, cy);
    const wheel = async (dy, n = 1, gap = 0) => { await center(); for (let i = 0; i < n; i++) { await page.mouse.wheel(0, dy); if (gap) await sleep(gap); } };
    const stream = async (dy, n, gap, ctrl) => { await center(); if (ctrl) await page.keyboard.down("Control"); for (let i = 0; i < n; i++) { await page.mouse.wheel(0, dy); await sleep(gap); } if (ctrl) await page.keyboard.up("Control"); };
    const touchPinch = async (spread) => {
      const a0 = 60, a1 = a0 + spread, steps = 14; const pts = (d) => [{ x: cx - d, y: cy, id: 1 }, { x: cx + d, y: cy, id: 2 }];
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts(a0) });
      for (let i = 1; i <= steps; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pts(a0 + ((a1 - a0) * i) / steps) }); await sleep(16); }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };
    await gesture("button −", () => btn(".leaflet-control-zoom-out"));
    await gesture("button +", () => btn(".leaflet-control-zoom-in"), { startZ: c.close - 1 });
    await gesture("wheel notch out", () => wheel(100));
    await gesture("wheel notch in", () => wheel(-100), { startZ: c.close - 1 });
    await gesture("wheel flick out (5 notches)", () => wheel(100, 5, 25), { hold: 2400 });
    await gesture("wheel flick in (5 notches)", () => wheel(-100, 5, 25), { hold: 2400, startZ: c.close - 2 });
    await gesture("trackpad scroll out (6 × small)", () => stream(8, 6, 16), { hold: 2000 });
    await gesture("trackpad scroll in (6 × small)", () => stream(-8, 6, 16), { hold: 2000, startZ: c.close - 2 });
    await gesture("trackpad pinch out (ctrl)", () => stream(4, 25, 16, true));
    await gesture("trackpad pinch in (ctrl)", () => stream(-4, 25, 16, true), { startZ: c.close - 1 });
    await gesture("touch pinch out", () => touchPinch(-45));
    await gesture("touch pinch in", () => touchPinch(90), { startZ: c.close - 1 });
  }
  await browser.close();
  return results;
}

const all = [];
for (const d of DPRS) all.push(...(await runAtDpr(d)));
const voided = all.filter((r) => r.void);
const bad = all.filter((r) => !r.void && r.framesOff > 0);
console.log(`\n${voided.length ? `❌ VOID: ${voided.map((v) => `${v.county}@${v.dpr}`).join(", ")}\n` : ""}${bad.length ? `❌ ${bad.length}/${all.length - voided.length} gestures had a frame where the outline sat more than ${LIMIT_PX} CSS px (median) off the real imagery` : `✅ every judged frame of every gesture: the outline within ${LIMIT_PX} CSS px (median) of where the real imagery says it belongs`}`);
console.log("JSON " + JSON.stringify(all));
process.exit(voided.length ? 2 : bad.length ? 1 : 0);
