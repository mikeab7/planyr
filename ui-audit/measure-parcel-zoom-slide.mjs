/* NEW-1 (B2426464 ×2) — do the parcel outlines stay ON THE IMAGERY through a zoom, frame by frame, as the screen shows it?
 *
 *   VITE_SUPABASE_URL="https://x.supabase.co" VITE_SUPABASE_ANON_KEY="dummy" npx vite build
 *   npx vite preview --port 4188 --strictPort &
 *   node ui-audit/measure-parcel-zoom-slide.mjs [--dpr 1,2,2.68] [--only wheel] [--trace] [--shots]
 *   BASE_URL=https://planyr.io/ node ui-audit/measure-parcel-zoom-slide.mjs --live   (signed in as the test account; Map home only)
 *
 * WHY A NEW INSTRUMENT. #2513's harness (verify-parcel-zoom-lock) read the parcel canvas and a Leaflet marker through getBoundingClientRect
 * on the main thread and reported ≤ 1.2 px — and the owner still saw the lines jump. That reading can only ever say "two Leaflet layers agree
 * about where they are"; it cannot see the PICTURE. This one reads the picture:
 *   · THE ORACLE IS THE IMAGERY ITSELF. Every basemap tile is generated here: white, with every lot's boundary painted into it as a RED band
 *     at the lot's true position. A locked outline sits in the middle of a red band on every frame; a sliding one sits beside it.
 *   · THE FRAMES ARE THE COMPOSITED ONES. CDP Page.startScreencast hands back what the compositor drew, at its own rate, including the
 *     compositor-driven CSS zoom transition — never a main-thread layout read.
 *   · THE GESTURES ARE THE REAL INPUTS: the +/− buttons (clicked), one mouse-wheel notch, a fast burst of notches, a trackpad two-finger
 *     scroll (a stream of small deltas), a trackpad pinch (ctrl + small deltas), a double-click, a two-finger touch pinch, and a pan.
 * The lots (served by this harness at the Davidson service URL) are 300 ft squares 1,000 ft apart, so nothing but a lot's own outline is ever
 * within reach of its band. Lot numbers (DOM labels, not lines) are hidden by CSS so their ink cannot be read as a line.
 *
 * Per frame: every outline crossing on a set of scan lines through the view → signed offset (CSS px) from its band's centre. Per gesture:
 * the worst offset over all frames, the frames read, and how many frames carried outline ink with no band within reach.
 * KNOWN-GOOD ARM: at rest the worst offset must be ≤ 1.5 CSS px on ≥ 8 crossings, or the run is VOID (exit 2).
 * FOREGROUND-OR-VOID: assertMeasurable before anything. */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { DAVIDSON_URL, metaBody } from "./lib/davidsonWideMock.mjs";
import { b64urlDecode } from "../src/shared/gis/gisProxyCore.js";
import { encodeRgbPng } from "./lib/fakeTile.mjs";
import { decodePng } from "./lib/pngDiff.mjs";
import { readFrame } from "./lib/lineLockScan.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const LIVE = process.argv.includes("--live");
const BASE = process.env.BASE_URL || (LIVE ? "https://planyr.io/" : "http://localhost:4188/");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const TRACE = process.argv.includes("--trace");
const SHOTS = process.argv.includes("--shots");
const ONLY = arg("--only", null);
const DEBUG = process.argv.includes("--debug");
const DUMP = process.argv.includes("--dump");
const LEVELS = process.argv.includes("--levels"); // diagnostic: per-rAF, where every GridLayer level puts one fixed point (map-pane px)
const DPRS = String(arg("--dpr", "1,2")).split(",").map(Number);
const LIMIT_PX = Number(arg("--limit", "2")); // CSS px; a line is "on the imagery" within this
const CORS = { "access-control-allow-origin": "*" };
const SCAN_LINES = 21; // per direction, across the measured window

/* ── the synthetic county: 300 ft lots on a 1,000 ft pitch around 20 Culvert St ──────────────────────────────────────────────────── */
const C0 = { lat: 36.1376, lng: -86.75346 };
const FT = 0.3048, kx = 111320 * Math.cos((C0.lat * Math.PI) / 180), ky = 110574;
const LOT_FT = 300, PITCH_FT = 1000, N = 40;
const lotAt = (i, j) => {
  const x0 = i * PITCH_FT * FT, y0 = j * PITCH_FT * FT, w = LOT_FT * FT;
  const lng = (x) => C0.lng + x / kx, lat = (y) => C0.lat + y / ky;
  const ring = [[lng(x0), lat(y0)], [lng(x0 + w), lat(y0)], [lng(x0 + w), lat(y0 + w)], [lng(x0), lat(y0 + w)], [lng(x0), lat(y0)]];
  return { id: (i + 1000) * 10000 + (j + 1000), ring, box: [lng(x0), lat(y0), lng(x0 + w), lat(y0 + w)], centre: [lat(y0 + w / 2), lng(x0 + w / 2)], area: LOT_FT * LOT_FT };
};
const LOTS = []; for (let i = -N; i <= N; i++) for (let j = -N; j <= N; j++) LOTS.push(lotAt(i, j));
function answer(p) {
  const g = p.get("geometry"); let env = null, pt = null;
  if (g) { if (g.trim().startsWith("{")) { const j = JSON.parse(g); if ("xmin" in j) env = [j.xmin, j.ymin, j.xmax, j.ymax]; else if ("x" in j) pt = [j.x, j.y]; } else { const a = g.split(",").map(Number); if (a.length === 4) env = a; else pt = a; } }
  const m = /Shape__Area\s*>=\s*([0-9.]+)/i.exec(p.get("where") || ""); const min = m ? Number(m[1]) : 0;
  let hits = LOTS.filter((l) => l.area >= min);
  if (env) hits = hits.filter((l) => !(l.box[0] > env[2] || l.box[2] < env[0] || l.box[1] > env[3] || l.box[3] < env[1]));
  else if (pt) hits = hits.filter((l) => pt[0] >= l.box[0] && pt[0] <= l.box[2] && pt[1] >= l.box[1] && pt[1] <= l.box[3]);
  if (p.get("returnCountOnly") === "true") return JSON.stringify({ count: hits.length });
  const geo = p.get("returnGeometry") !== "false";
  if ((p.get("f") || "json") === "geojson") return JSON.stringify({ type: "FeatureCollection", features: hits.map((l) => ({ type: "Feature", id: l.id, properties: { OBJECTID: l.id, STANPAR: `S${l.id}`, Shape__Area: l.area }, geometry: geo ? { type: "Polygon", coordinates: [l.ring] } : null })) });
  return JSON.stringify({ objectIdFieldName: "OBJECTID", geometryType: "esriGeometryPolygon", spatialReference: { wkid: 4326 }, fields: [{ name: "OBJECTID", type: "esriFieldTypeOID", alias: "OBJECTID" }], features: hits.map((l) => ({ attributes: { OBJECTID: l.id, STANPAR: `S${l.id}`, Shape__Area: l.area }, ...(geo ? { geometry: { rings: [l.ring] } } : {}) })) });
}

/* ── the imagery: white tiles with every lot's boundary as a RED band at its true position ──────────────────────────────────────────── */
const BAND_IMG_PX = 16; // band width in TILE-IMAGE px (a retina tile draws at half size, so ~8 CSS px)
const merc = (lng, lat, z) => { const W = 256 * 2 ** z; const s = Math.sin((lat * Math.PI) / 180); return [((lng + 180) / 360) * W, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * W]; };
const tileCache = new Map();
function imageryTile(z, x, y) {
  const key = `${z}/${x}/${y}`; if (tileCache.has(key)) return tileCache.get(key);
  const ox = x * 256, oy = y * 256, h = BAND_IMG_PX / 2;
  const segs = []; // [x0,y0,x1,y1] in tile px
  for (const l of LOTS) {
    const [ax, ay] = merc(l.box[0], l.box[3], z), [bx, by] = merc(l.box[2], l.box[1], z);
    if (bx < ox - h || ax > ox + 256 + h || by < oy - h || ay > oy + 256 + h) continue;
    segs.push([ax - ox, ay - oy, bx - ox, by - oy]);
  }
  const png = encodeRgbPng(256, 256, (row, col, p, raw) => {
    const cx = col + 0.5, cy = row + 0.5; let red = false;
    for (const [x0, y0, x1, y1] of segs) {
      const inX = cx >= x0 - h && cx <= x1 + h, inY = cy >= y0 - h && cy <= y1 + h;
      if (!inX || !inY) continue;
      if (Math.abs(cx - x0) <= h || Math.abs(cx - x1) <= h || Math.abs(cy - y0) <= h || Math.abs(cy - y1) <= h) { red = true; break; }
    }
    raw[p] = 255; raw[p + 1] = red ? 0 : 255; raw[p + 2] = red ? 0 : 255;
  });
  tileCache.set(key, png); return png;
}

/* ── one browser at one device-pixel ratio ─────────────────────────────────────────────────────────────────────────────────────────── */
async function runAtDpr(dpr) {
  const ctxOpts = { deviceScaleFactor: dpr, hasTouch: true };
  let browser, context, page, liveBuild = null;
  if (LIVE) {
    // signed in as the test account (the one shared helper); the E2E flag exposes the map handle the probe reads — read-only
    ({ browser, context, page, build: liveBuild } = await openSignedIn({ base: BASE.replace(/\/$/, ""), viewport: { width: 1440, height: 900 }, contextOptions: ctxOpts, initScripts: [[() => { window.__PLANYR_E2E = true; }]] }));
    console.log(`live: signed in, planyr.io build ${liveBuild && (liveBuild.build || liveBuild.commit || JSON.stringify(liveBuild))}`);
  } else {
    browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
    context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...ctxOpts }); page = await context.newPage();
  }
  await assertMeasurable(page, "measure-parcel-zoom-slide"); // per pixel ratio: each run opens its own tab
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.addInitScript(`(() => { try {
    window.__PLANYR_E2E = true;
    ${LIVE ? "" : `localStorage.setItem("planarfit:sites:v1", ${JSON.stringify(JSON.stringify({ s_slide: { id: "s_slide", groupId: "s_slide", site: "Zoom Slide Site", name: "Plan 1", status: "active", origin: { lat: C0.lat, lon: C0.lng }, county: "tn_davidson", parcels: [], els: [], updatedAt: Date.now() } }))});
    localStorage.removeItem("planarfit:currentSite:v1");`}
  } catch (e) {} })();`);
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
      if (tail === "query") { const p = req.method() === "POST" ? new URLSearchParams(req.postData() || "") : url.searchParams; try { return await r.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: answer(p) }); } catch (_) { return undefined; } }
    }
    const tm = /World_Imagery\/MapServer\/tile\/(\d+)\/(\d+)\/(\d+)/.exec(url.pathname);
    if (tm) return r.fulfill({ status: 200, headers: CORS, contentType: "image/png", body: imageryTile(+tm[1], +tm[3], +tm[2]) });
    if (/\/(MapServer|FeatureServer)\//i.test(req.url())) {
      if (/\/query/i.test(url.pathname)) return r.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify({ objectIdFieldName: "OBJECTID", features: [] }) });
      return r.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify({ name: "x", fields: [{ name: "OBJECTID", type: "esriFieldTypeOID" }] }) });
    }
    if (/\.(pbf|mvt)(\?|$)/i.test(url.pathname) || /tiles\.|basemaps|nationalmap|tile\.openstreetmap/i.test(url.host)) return r.fulfill({ status: 404, headers: CORS, body: "" });
    return r.continue();
  });
  const sleep = (ms) => page.waitForTimeout(ms);
  const waitFor = async (fn, ms = 8000) => { const t = Date.now(); let v; while (Date.now() - t < ms) { v = await fn(); if (v) return v; await sleep(150); } return v; };
  await page.goto(BASE + (LIVE ? `?cb=${Date.now()}` : "") + "#/site", { waitUntil: "domcontentloaded" }); // live: a real navigation, so the routes above serve this load
  await sleep(LIVE ? 4000 : 1500);
  if (!LIVE) {
    const row = page.locator('div[title*="Open site"]').filter({ hasText: "Zoom Slide Site" }).first();
    await row.hover(); await row.locator('[aria-label="Show on map"]').click(); await sleep(1000);
  }
  await waitFor(() => page.evaluate(() => !!window.__mapFinderMap), 15000);
  await page.addStyleTag({ content: ".planyr-lot-no,.leaflet-marker-pane,.leaflet-shadow-pane{display:none!important}" });
  const home = lotAt(0, 0);
  const setView = (z) => page.evaluate(([a, b, zz]) => window.__mapFinderMap.setView([a, b], zz, { animate: false }), [home.centre[0], home.centre[1], z]);
  await setView(17.4); await sleep(500);
  await page.locator('[data-testid="map-toolbar-select-parcels"]').first().click(); await sleep(1800);
  const disp = () => page.evaluate(() => { const d = window.__mapParcelDisplay && window.__mapParcelDisplay(); return d ? d.layers.find((l) => /HdTo6HJqh92wn4D8/.test(l.url || "")) || null : null; });
  const settled = async () => { await waitFor(async () => { const d = await disp(); return d && (!d.wide || d.wide.loading === 0); }, 9000); await sleep(900); };

  const cdp = await context.newCDPSession(page);
  let frames = [], recording = false;
  cdp.on("Page.screencastFrame", (f) => { cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {}); if (recording) frames.push({ t: f.metadata.timestamp, data: f.data }); });
  const box = await page.evaluate(() => { const r = window.__mapFinderMap.getContainer().getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  // the measured window: clear of the Sites card (left), the Imagery & Layers card (right), the toolbar (top) and the zoom/scale chrome (bottom)
  const X0 = box.x + 270, X1 = box.x + box.w - 410, Y0 = box.y + 150, Y1 = box.y + box.h - 110;
  /* Scan positions are computed from the frame's OWN width: CDP hands back frames at CSS resolution on some builds whatever the pixel
   * ratio (measured: 1440 wide at deviceScaleFactor 2), so offsets are reported in CSS px — the unit the owner's eye is calibrated to. */
  const read = (img) => {
    const k = img.width / 1440;
    const rows = [], cols = [];
    for (let i = 0; i < SCAN_LINES; i++) { rows.push(Math.round((Y0 + ((Y1 - Y0) * (i + 0.5)) / SCAN_LINES) * k)); cols.push(Math.round((X0 + ((X1 - X0) * (i + 0.5)) / SCAN_LINES) * k)); }
    const r = readFrame(img, { rows, cols, bandPx: (BAND_IMG_PX / (dpr > 1 ? 2 : 1)) * k, maxPx: 40 * k, xRange: [Math.round(X0 * k), Math.round(X1 * k)], yRange: [Math.round(Y0 * k), Math.round(Y1 * k)], debug: DEBUG });
    if (r.worst != null) { r.worst /= k; r.median /= k; }
    return r;
  };
  async function snapOne() {
    const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
    return read(decodePng(Buffer.from(shot.data, "base64")));
  }

  if (SHOTS) { const s = await cdp.send("Page.captureScreenshot", { format: "png" }); (await import("node:fs")).writeFileSync(`ui-audit/screenshots/parcel-zoom-slide-rest-dpr${dpr}.png`, Buffer.from(s.data, "base64")); }
  const rest = await snapOne();
  if (DEBUG) console.log(JSON.stringify(rest.dbg), JSON.stringify(rest.pairs));
  console.log(`\n=== dpr ${dpr} ===\nKNOWN-GOOD ARM at rest (close stage): ${rest.crossings} crossings, worst ${rest.worst == null ? "—" : rest.worst.toFixed(2)} px, unpaired ${rest.unpaired}`);
  if (!rest.crossings || rest.crossings < 8 || rest.worst > 1.5) { console.log("❌ VOID — the instrument cannot see the outlines on the imagery at rest"); await browser.close(); return { dpr, void: true }; }

  const results = [];
  /* `drawn`: the gesture starts AND ends inside the zoom range where outlines are drawn (wide stage and closer), so a frame showing imagery
   * and no outline is a DROPOUT and fails the run; a gesture that leaves the range (a long zoom-out) only reports the count. */
  async function gesture(label, action, { hold = 1600, drawn = true } = {}) {
    if (ONLY && !label.includes(ONLY)) return;
    if (LEVELS) { const { install } = await import("/tmp/claude-0/levels.mjs"); await page.evaluate(install.replace("__P__", `${home.ring[0][1]}, ${home.ring[0][0]}`)); await page.evaluate(() => window.__lv.start()); }
    frames = []; recording = true;
    await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1, maxWidth: Math.round(1440 * dpr), maxHeight: Math.round(900 * dpr) }); // full DEVICE resolution — the default shrinks to CSS px
    await sleep(120);
    await action();
    await sleep(hold);
    recording = false; await cdp.send("Page.stopScreencast");
    if (LEVELS) { const rows = await page.evaluate(() => window.__lv.stop()); for (const r of rows.filter((r) => { const v = r.L.filter((l) => l.tiles && l.vis > 0 && !l.hid); const xs = v.map((l) => l.x); return xs.length && Math.max(...xs) - Math.min(...xs) > 3; }).slice(0, 12)) console.log(`   ${String(r.t).padStart(5)}ms z${r.z}${r.anim ? "*" : " "} ` + r.L.filter((l) => l.tiles).map((l) => `${l.id}@${l.z}${l.hid ? "H" : ""} (${l.x},${l.y}) s${l.s} n${l.tiles} v${l.vis}`).join(" | ")); }
    const per = frames.map((f) => ({ t: f.t, r: read(decodePng(Buffer.from(f.data, "base64"))) }));
    const t0 = per.length ? per[0].t : 0;
    const read_ = per.filter((p) => p.r.crossings);
    const worst = read_.reduce((m, p) => Math.max(m, p.r.worst), 0);
    const off = per.filter((p) => p.r.crossings && p.r.worst > LIMIT_PX).length;
    const lost = per.filter((p) => p.r.unpaired > 0).length;
    const blank = per.filter((p) => !p.r.inkRuns && p.r.bands).length; // imagery on screen, no outline on it
    const bare = per.filter((p) => p.r.overBare > 0).length; // an outline over bare map (imagery not loaded there yet) — reported, not a slide
    const row = { dpr, label, frames: per.length, worstPx: Number(worst.toFixed(1)), framesOff: off, framesUnpaired: lost, framesNoOutline: blank, framesOverBare: bare, drawn };
    results.push(row);
    console.log(`  ${label.padEnd(46)} frames ${String(per.length).padStart(3)}  worst ${String(row.worstPx).padStart(5)} px  off>${LIMIT_PX} ${String(off).padStart(3)}  ink-off-band ${String(lost).padStart(3)}  no-outline ${String(blank).padStart(3)}${drawn ? "" : " (leaves the drawn range)"}  over-bare-map ${String(bare).padStart(3)}`);
    if (TRACE) console.log("    " + per.map((p) => `${Math.round((p.t - t0) * 1000)}ms:${p.r.worst == null ? "-" : p.r.worst.toFixed(1)}/${p.r.crossings}${p.r.unpaired ? "u" + p.r.unpaired : ""}`).join(" "));
    if (DUMP) { const fs = await import("node:fs"); fs.mkdirSync("/tmp/claude-0/frames", { recursive: true }); frames.forEach((f, i) => fs.writeFileSync(`/tmp/claude-0/frames/${label.replace(/\W+/g, "_")}-${String(i).padStart(3, "0")}-${Math.round((f.t - t0) * 1000)}ms.png`, Buffer.from(f.data, "base64"))); }
    if (SHOTS && per.length) {
      const fs = await import("node:fs"); const slug = label.replace(/\W+/g, "_");
      const wi = per.indexOf(per.reduce((a, b) => ((b.r.worst || 0) > (a.r.worst || 0) ? b : a)));
      if (per[wi].r.worst > LIMIT_PX) fs.writeFileSync(`ui-audit/screenshots/parcel-zoom-slide-dpr${dpr}-${slug}-worst.png`, Buffer.from(frames[wi].data, "base64"));
      const bi = per.findIndex((p) => p.r.unpaired > 0 || (!p.r.inkRuns && p.r.bands));
      if (bi >= 0) fs.writeFileSync(`ui-audit/screenshots/parcel-zoom-slide-dpr${dpr}-${slug}-lost.png`, Buffer.from(frames[bi].data, "base64"));
    }
    await settled();
  }
  const btn = (sel) => page.locator(sel).first().click();
  const center = async () => page.mouse.move(cx, cy);
  const wheel = async (dy, n = 1, gap = 0) => { await center(); for (let i = 0; i < n; i++) { await page.mouse.wheel(0, dy); if (gap) await sleep(gap); } };
  const stream = async (dy, n, gap, ctrl) => { await center(); if (ctrl) await page.keyboard.down("Control"); for (let i = 0; i < n; i++) { await page.mouse.wheel(0, dy); await sleep(gap); } if (ctrl) await page.keyboard.up("Control"); };
  const touchPinch = async (spread) => {
    const a0 = 60, a1 = a0 + spread, steps = 14;
    const pts = (d) => [{ x: cx - d, y: cy, id: 1 }, { x: cx + d, y: cy, id: 2 }];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts(a0) });
    for (let i = 1; i <= steps; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pts(a0 + ((a1 - a0) * i) / steps) }); await sleep(16); }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  const reset = async (z) => { await setView(z); await settled(); };

  await reset(17.4);
  await gesture("button − close→mid", () => btn(".leaflet-control-zoom-out"));
  await gesture("button − mid→wide", () => btn(".leaflet-control-zoom-out"));
  await gesture("button + wide→mid", () => btn(".leaflet-control-zoom-in"));
  await gesture("button + mid→close", () => btn(".leaflet-control-zoom-in"));
  await gesture("button + close→deeper", () => btn(".leaflet-control-zoom-in"));
  await reset(17.4);
  await gesture("wheel notch out", () => wheel(100));
  await gesture("wheel notch in", () => wheel(-100));
  await gesture("wheel flick out (5 notches)", () => wheel(100, 5, 25), { hold: 2200, drawn: false });
  await reset(15.4); // zoom IN from the wide stage, through mid, into close: every frame should carry outlines
  await gesture("wheel flick in (5 notches)", () => wheel(-100, 5, 25), { hold: 2200 });
  await reset(17.4);
  await gesture("trackpad scroll out (6 × small)", () => stream(8, 6, 16), { hold: 1800, drawn: false });
  await reset(15.4);
  await gesture("trackpad scroll in (6 × small)", () => stream(-8, 6, 16), { hold: 1800 });
  await reset(17.4);
  await gesture("trackpad pinch out (ctrl, 25 × small)", () => stream(4, 25, 16, true), { hold: 1600 });
  await gesture("trackpad pinch in (ctrl, 25 × small)", () => stream(-4, 25, 16, true), { hold: 1600 });
  await reset(16.4);
  await gesture("double-click zoom in", async () => { await page.mouse.dblclick(cx + 3, cy + 3); });
  await reset(17.4);
  await gesture("touch pinch out", () => touchPinch(-45));
  await gesture("touch pinch in", () => touchPinch(90));
  await reset(17.4);
  await gesture("pan drag", async () => { await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 220, cy + 70, { steps: 14 }); await page.mouse.up(); });
  if (errs.length) console.log(`  page errors: ${errs.slice(0, 2).join(" | ")}`);
  await browser.close();
  return { dpr, results, build: liveBuild };
}

const all = [];
for (const d of DPRS) all.push(await runAtDpr(d));
const flat = all.flatMap((r) => r.results || []);
const voided = all.filter((r) => r.void).length;
const bad = flat.filter((r) => r.worstPx > LIMIT_PX || r.framesUnpaired > 0 || (r.drawn && r.framesNoOutline > 0));
console.log(`\n${voided ? `❌ VOID at ${voided} pixel ratio(s)\n` : ""}${bad.length ? `❌ ${bad.length}/${flat.length} gestures had a frame where an outline was more than ${LIMIT_PX} CSS px off its imagery line, had no band near it, or (inside the drawn range) was missing altogether` : `✅ every frame of every gesture: outlines within ${LIMIT_PX} CSS px of the imagery, and never missing inside the drawn range`}`);
console.log("JSON " + JSON.stringify(flat));
process.exit(voided ? 2 : bad.length ? 1 : 0);
