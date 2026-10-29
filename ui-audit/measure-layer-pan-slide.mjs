/* NEW-1 — does a server-drawn GIS layer (FEMA NFHL) stay ON THE GROUND while the Site Planner map is panned / zoomed, frame by frame,
 * as the compositor drew it?  (owner report 2026-10-29: "the FEMA flood zones move separately from the basemap while I pan")
 *
 *   VITE_SUPABASE_URL="https://x.supabase.co" VITE_SUPABASE_ANON_KEY="dummy" npx vite build
 *   npx vite preview --port 4189 --strictPort &
 *   node ui-audit/measure-layer-pan-slide.mjs [--dpr 1,2] [--only pan] [--delay 1500] [--trace] [--crops DIR] [--expect-red]
 *   BASE_URL=https://planyr.io/ node ui-audit/measure-layer-pan-slide.mjs --live   (signed in as the test account)
 *
 * THE ORACLE IS THE IMAGERY (same technique as measure-parcel-zoom-slide.mjs, whose reader this reuses): every basemap tile is generated
 * here — white with a RED band on a fixed Web-Mercator grid. The FEMA service is stubbed with a picture-by-construction: each /export is
 * drawn for the bbox it was ASKED for, with a thin PURPLE line exactly on that same grid — vertical lines for sublayer 28 (the zone fills,
 * hosted in the map's own area pane) and horizontal lines for sublayer 27 (the boundaries, hosted in the map-top host above the plan).
 * A layer that stays glued to the ground puts every purple line in the middle of a red band on every frame; one that slides sits beside it.
 * Vertical lines are therefore a reading of the AREA role, horizontal lines of the LINE role — reported separately.
 *
 * THE FRAMES ARE THE COMPOSITED ONES (CDP Page.startScreencast), never a main-thread getBoundingClientRect.
 * KNOWN-GOOD ARM: at rest the worst offset must be ≤ 1.5 CSS px on ≥ 8 crossings in BOTH orientations, or the run is VOID (exit 2).
 * FOREGROUND-OR-VOID: assertMeasurable before anything. */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { encodeRgbPng } from "./lib/fakeTile.mjs";
import { decodePng } from "./lib/pngDiff.mjs";
import { readFrame } from "./lib/lineLockScan.mjs";
import { profileCrossing, judgeCrossing, cropPng } from "./lib/slideCrop.mjs";
import { b64urlDecode } from "../src/shared/gis/gisProxyCore.js";
import { lngLatToFeet } from "../src/workspaces/site-planner/lib/mapLock.js";
import { openSignedIn } from "./lib/signedInSession.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const LIVE = process.argv.includes("--live");
const BASE = process.env.BASE_URL || (LIVE ? "https://planyr.io/" : "http://localhost:4189/");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const TRACE = process.argv.includes("--trace");
const ONLY = arg("--only", null);
const REAL = process.argv.includes("--real"); // no stubs: the real imagery and the real FEMA export — frames are saved for a human to read (no oracle exists in real pixels)
const FRAMES_DIR = arg("--frames", "/tmp/claude-0/shots/real");
const CROPS = arg("--crops", null);
const DPRS = String(arg("--dpr", "1,2")).split(",").map(Number);
const LIMIT_PX = Number(arg("--limit", "2"));
const DELAY_MS = Number(arg("--delay", "0")); // the FEMA export's latency — the real host takes seconds
const EXPECT_RED = process.argv.includes("--expect-red"); // a pre-fix build must FAIL; exit 0 only if it does
const CORS = { "access-control-allow-origin": "*" };
const SCAN_LINES = 21;
const ROLES = ["area", "line", ...(process.argv.includes("--svg") ? ["svgX", "svgY"] : [])];

/* ── the ground: a Mercator grid every GRID_M metres, in both axes ─────────────────────────────────────────────────────────────────── */
const R = 6378137, GRID_M = 330, ORG = Math.PI * R;
const SUGAR_LAND = { lat: 29.6197, lon: -95.6349 };
const BAND_IMG_PX = 16, FEMA_LINE_PX = 4;

/* ── the imagery tile: white with the red grid ─────────────────────────────────────────────────────────────────────────────────────── */
const tileCache = new Map();
function imageryTile(z, x, y) {
  const key = `${z}/${x}/${y}`; if (tileCache.has(key)) return tileCache.get(key);
  const W = 2 * ORG, mPerPx = W / (256 * 2 ** z); // metres per tile px
  const x0m = -ORG + x * 256 * mPerPx, y0m = ORG - y * 256 * mPerPx; // tile NW corner in 3857 metres
  const h = (BAND_IMG_PX / 2) * mPerPx;
  const STEP = WITH_SVG ? GRID_M / 2 : GRID_M; // --svg: the plan's own parcel edges sit on the in-between lines, so tiles carry both
  const near = (v) => { const r = ((v % STEP) + STEP) % STEP; return Math.min(r, STEP - r) <= h; };
  const png = encodeRgbPng(256, 256, (row, col, p, raw) => {
    const mx = x0m + (col + 0.5) * mPerPx, my = y0m - (row + 0.5) * mPerPx;
    const red = near(mx) || near(my);
    raw[p] = 255; raw[p + 1] = red ? 0 : 255; raw[p + 2] = red ? 0 : 255;
  });
  tileCache.set(key, png); return png;
}

/* ── the FEMA export: drawn for the bbox it was asked for, purple on the SAME grid ─────────────────────────────────────────────────── */
function femaExport(params, sublayer) {
  const [xmin, ymin, xmax, ymax] = params.get("bbox").split(",").map(Number);
  const [w, h] = params.get("size").split(",").map(Number);
  const sr = String(params.get("bboxSR") || "3857");
  const toM = (lon, lat) => [(lon * Math.PI * R) / 180, R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))];
  let bx0 = xmin, by0 = ymin, bx1 = xmax, by1 = ymax;
  if (sr === "4326") { [bx0, by0] = toM(xmin, ymin); [bx1, by1] = toM(xmax, ymax); }
  // esri-leaflet writes the bbox with its y pair in whatever order Leaflet's bounds give it — a real server normalises it, so does this
  [bx0, bx1] = [Math.min(bx0, bx1), Math.max(bx0, bx1)]; [by0, by1] = [Math.min(by0, by1), Math.max(by0, by1)];
  const mPerPxX = (bx1 - bx0) / w, mPerPxY = (by1 - by0) / h, halfX = (FEMA_LINE_PX / 2) * mPerPxX, halfY = (FEMA_LINE_PX / 2) * mPerPxY;
  const near = (v, half) => { const r = ((v % GRID_M) + GRID_M) % GRID_M; return Math.min(r, GRID_M - r) <= half; };
  const vertical = sublayer === "28"; // the zone fills draw the x grid; the boundaries draw the y grid
  const body = encodeRgbaPng(w, h, (row, col) => {
    const mx = bx0 + (col + 0.5) * mPerPxX, my = by1 - (row + 0.5) * mPerPxY;
    return (vertical ? near(mx, halfX) : near(my, halfY)) ? [162, 28, 175, 255] : [0, 0, 0, 0];
  });
  return body;
}
import { deflateSync } from "node:zlib";
const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
const crc32 = (b) => { let c = -1; for (const v of b) c = CRC[(c ^ v) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function encodeRgbaPng(w, h, px) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { const o = y * (w * 4 + 1); raw[o] = 0; for (let x = 0; x < w; x++) { const [r, g, b, a] = px(y, x); const q = o + 1 + x * 4; raw[q] = r; raw[q + 1] = g; raw[q + 2] = b; raw[q + 3] = a; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const WITH_OVERLAY = process.argv.includes("--overlay"); // a placed image, unscaled-looking, 65% opacity, "Behind the plan" — the owner's plan carried one
const WITH_SVG = process.argv.includes("--svg"); // a PLAN element (a parcel with a GREEN edge) laid on the ground grid, read as a third role: does the drawing stay on the imagery too?
const ELS = Number(arg("--els", "0")); // buildings on the plan: more elements = longer React frames (the owner's real plans are heavy)
const CPU = Number(arg("--cpu", "1")); // CDP CPU throttle: a slower machine's frame times
const imgW = 3000, imgH = 2000;
// a REAL raster (decoded bitmap, not vector), nearly transparent with sparse faint dots so no line of ours is read as FEMA ink; --overlay-lines draws GREEN vertical lines instead (they occlude FEMA's lines as they sweep past — an instrument artefact, kept for the relative-motion reader)
const rasterImg = () => "data:image/png;base64," + encodeRgbaPng(imgW, imgH, (row, col) => (process.argv.includes("--overlay-lines") ? ((col % 400) < 8 ? [0, 160, 0, 255] : [0, 0, 0, 0]) : (((row * 7 + col * 13) % 251) === 0 ? [90, 90, 90, 40] : [0, 0, 0, 1]))).toString("base64");
/* RELATIVE MOTION between layers, frame to frame: a pan moves every layer by ONE vector, so the per-frame shift of the red imagery bands, the
 * purple FEMA lines and the green overlay lines must agree. Each colour's mask is projected onto x and y; the shift that best re-aligns the
 * previous frame's profile with this one's is that layer's motion. A layer that lags/leads its neighbours shows as a disagreement. */
const MASKS = {
  imagery: (r, g, b) => r > 200 && g < 110 && b < 110,
  fema: (r, g, b) => r > 90 && g < 135 && b >= 30 && b > g + 15 && r < 230,
  overlay: (r, g, b) => g > r + 60 && g > b + 60,
};
function profiles(img, win, k) {
  const { width, data, channels } = img; const [x0, y0, x1, y1] = win.map((v) => Math.round(v * k));
  const out = {};
  for (const name of Object.keys(MASKS)) out[name] = { px: new Float32Array(x1 - x0), py: new Float32Array(y1 - y0), n: 0 };
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const o = (y * width + x) * channels; const r = data[o], g = data[o + 1], b = data[o + 2]; for (const [name, f] of Object.entries(MASKS)) if (f(r, g, b)) { const P = out[name]; P.px[x - x0]++; P.py[y - y0]++; P.n++; } }
  return out;
}
function bestShift(a, b, max) { // shift s (in b's px) minimising |a[i] - b[i+s]|
  if (!a.length) return null; let best = null, bs = Infinity, tot = 0; for (const v of a) tot += v; if (!tot) return null;
  for (let s = -max; s <= max; s++) { let e = 0, n = 0; for (let i = max; i < a.length - max; i++) { e += Math.abs(a[i] - b[i + s]); n++; } e /= n; if (e < bs) { bs = e; best = s; } }
  return best;
}
const SITE = {
  schemaVersion: 12, id: "layer-slide", groupId: "layer-slide", site: "Layer Slide Site", name: "Layer Slide Site",
  updatedAt: 1783000000000, teamId: null, ownerId: null, origin: LIVE || REAL ? { lat: 29.6232, lon: -95.6240 } : SUGAR_LAND, county: "fortbend", status: "active",
  parcels: WITH_SVG ? [(() => {
    const O = LIVE || REAL ? { lat: 29.6232, lon: -95.6240 } : SUGAR_LAND;
    const mx = (O.lon * Math.PI * R) / 180, my = R * Math.log(Math.tan(Math.PI / 4 + (O.lat * Math.PI) / 360));
    const nx = Math.round(mx / GRID_M), ny = Math.round(my / GRID_M);
    const corner = (cx, cy) => { const xm = (nx + cx) * GRID_M, ym = (ny + cy) * GRID_M; const lon = (xm * 180) / (Math.PI * R), lat = ((2 * Math.atan(Math.exp(ym / R)) - Math.PI / 2) * 180) / Math.PI; return lngLatToFeet(lon, lat, O.lon, O.lat); };
    return { id: "pcSvg", active: true, z: 0, stroke: "#00a000", weight: 3, strokeOpacity: 1, fillOpacity: 0, sbOpacity: 0, sbWeight: 0, points: [corner(-1.5, 1.5), corner(1.5, 1.5), corner(1.5, -1.5), corner(-1.5, -1.5)] };
  })()] : [], underlay: null, parcelDrawings: [], settings: {},
  sheetOverlays: WITH_OVERLAY ? [{ id: "ov1", name: "Concept.png", rotation: 0, opacity: 0.65, locked: false, imgW, imgH, ftPerPx: 0.5, x: -750, y: -500, page: 1, pageCount: 1, unscaled: true, src: rasterImg() }] : [],
  els: Array.from({ length: ELS }, (_, i) => ({ id: `b${i}`, type: "building", cx: (i % 20) * 120 - 1200, cy: Math.floor(i / 20) * 90 - 600, w: 90, h: 60, rot: 0 })),
};

async function runAtDpr(dpr) {
  let browser, context, page, liveBuild = null, cleanup = async () => {};
  const SITE_ID = LIVE ? "zz-layerslide-" + Math.random().toString(36).slice(2, 8) : SITE.id;
  const site = { ...SITE, id: SITE_ID, groupId: SITE_ID, data: { status: "active" }, status: "active" };
  if (LIVE) {
    ({ browser, context, page, build: liveBuild } = await openSignedIn({ base: BASE.replace(/\/$/, ""), viewport: { width: 1440, height: 900 }, contextOptions: { deviceScaleFactor: dpr }, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] }));
    console.log(`live: signed in, planyr.io build ${liveBuild && liveBuild.build}`);
    const ins = await page.evaluate(async (st) => { const { data: u } = await window.pfSupabase.auth.getUser(); const row = { id: st.id, group_id: st.groupId, site: st.site, name: st.name, county: st.county, updated_at: new Date().toISOString(), data: st, user_id: u.user.id }; let r = await window.pfSupabase.from("sites").insert(row); if (r.error && /user_id/.test(String(r.error.message))) { delete row.user_id; r = await window.pfSupabase.from("sites").insert(row); } return r.error ? String(r.error.message) : null; }, site);
    if (ins) throw new Error("could not write the throwaway plan: " + ins);
    // owner rule 15: a test artifact is deleted when the check is done, and the deletion is verified
    cleanup = async () => { const gone = await page.evaluate(async (id) => { try { for (const k of Object.keys(localStorage)) { if (!/^planarfit:sites:/.test(k)) continue; try { const m = JSON.parse(localStorage.getItem(k) || "{}"); if (m && m[id]) { delete m[id]; localStorage.setItem(k, JSON.stringify(m)); } } catch (_) {} } await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id); await window.pfSupabase.from("sites").delete().eq("id", id); const q = await window.pfSupabase.from("sites").select("id").eq("id", id); return { cloudGone: !(q.data && q.data.length) }; } catch (e) { return { error: String(e) }; } }, SITE_ID).catch((e) => ({ error: String(e) })); console.log(`throwaway plan ${SITE_ID} deleted and verified: ${JSON.stringify(gone)}`); };
  } else {
    browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
    context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dpr });
    page = await context.newPage();
  }
  try {
  await assertMeasurable(page, "measure-layer-pan-slide");
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  const asked = { 28: 0, 27: 0 };
  if (!LIVE) await page.addInitScript((s) => { try { window.__PLANYR_E2E = true; localStorage.setItem("planarfit:sites:v1", s); localStorage.removeItem("planarfit:currentSite:v1"); } catch (_) {} }, JSON.stringify({ [SITE.id]: SITE }));
  if (!REAL) await page.route("**/*", async (r) => {
    const req = r.request(); const url = new URL(req.url());
    const tm = /World_Imagery\/MapServer\/tile\/(\d+)\/(\d+)\/(\d+)/.exec(url.pathname);
    if (tm) return r.fulfill({ status: 200, headers: CORS, contentType: "image/png", body: imageryTile(+tm[1], +tm[3], +tm[2]) });
    let service = url.origin + url.pathname, tail = url.pathname;
    if (url.pathname.startsWith("/api/gis-cache/svc/")) { const segs = url.pathname.split("/").filter(Boolean); try { service = b64urlDecode(segs[3]); } catch (_) { service = ""; } tail = "/" + segs.slice(4).join("/"); }
    if (/NFHL\/MapServer/i.test(service) || /hazards\.fema\.gov/i.test(url.host)) {
      if (/\/export$/i.test(tail) || /\/export$/i.test(url.pathname)) {
        const sub = /show:(\d+)/.exec(url.searchParams.get("layers") || "")?.[1] || "28";
        asked[sub] = (asked[sub] || 0) + 1;
        if (DELAY_MS) await new Promise((res) => setTimeout(res, DELAY_MS));
        if (process.argv.includes("--dump-export")) { const b = femaExport(url.searchParams, sub); (await import("node:fs")).writeFileSync(`/tmp/claude-0/shots/export-${sub}.png`, b); console.log("export", sub, url.searchParams.get("bbox"), url.searchParams.get("size")); }
        try { return await r.fulfill({ status: 200, headers: CORS, contentType: "image/png", body: femaExport(url.searchParams, sub) }); } catch (_) { return undefined; }
      }
      return r.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify({ name: "NFHL", currentVersion: 10.9, layers: [{ id: 27 }, { id: 28 }], fullExtent: { xmin: -20037508, ymin: -20037508, xmax: 20037508, ymax: 20037508, spatialReference: { wkid: 102100 } } }) });
    }
    if (/\.(jpg|jpeg)(\?|$)/i.test(url.pathname)) return r.abort();
    if (/\/(MapServer|FeatureServer)\//i.test(req.url())) {
      if (/\/query/i.test(url.pathname)) return r.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify({ objectIdFieldName: "OBJECTID", features: [] }) });
      return r.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify({ name: "x", fields: [{ name: "OBJECTID", type: "esriFieldTypeOID" }] }) });
    }
    return r.continue();
  });
  const sleep = (ms) => page.waitForTimeout(ms);
  if (LIVE) { await page.goto(`${BASE.replace(/\/$/, "")}/?cb=${Date.now()}#/project/${SITE_ID}/site`, { waitUntil: "load" }); }
  else { await page.goto(BASE + "#/site-planner", { waitUntil: "load" }); await page.getByText("Layer Slide Site", { exact: false }).first().click(); }
  await page.getByTestId("planner-canvas").waitFor({ state: "visible", timeout: 25000 });
  await sleep(1500);
  // FEMA on, through the panel row a person ticks
  const { openPlannerLayers, setLayer } = await import("../e2e/lib/layersPanel.js");
  await openPlannerLayers(page); await setLayer(page, "fema", true);
  // --above: FEMA's "Draw above plan" (the fills are LIFTED into a host inside the plan SVG instead of the map under it)
  if (process.argv.includes("--above")) { const { openRowMenu } = await import("../e2e/lib/layersPanel.js"); const menu = await openRowMenu(page, "fema"); await menu.locator('[data-part="above"] input[type="checkbox"]').check({ force: true }); await sleep(1500); }
  // --panel <rail tab id>: a docked left panel open while the map is driven (the owner had the Overlays panel up). The measured window moves right of it.
  const PANEL = arg("--panel", null);
  if (PANEL) { await page.locator(`[data-rail-tab="${PANEL}"]`).first().click(); await sleep(1200); }
  // collapse the card so it is not in the frame
  await page.getByTestId("layers-collapse").first().click({ timeout: 2000 }).catch(() => {});
  const femaSettled = async () => { if (REAL) { await sleep(9000); return; } for (let i = 0; i < 60; i++) { if (asked[28] > 0 && asked[27] > 0) break; await sleep(250); } await sleep(2200 + DELAY_MS); };
  await femaSettled();
  if (process.argv.includes("--dom")) console.log(JSON.stringify(await page.evaluate(() => { const svg = document.querySelector('[data-testid="planner-canvas"]'); const wrap = svg.parentElement; return [...wrap.querySelectorAll("img.leaflet-image-layer")].map((i) => { const r = i.getBoundingClientRect(); return { pane: i.parentElement.className, host: i.closest(".leaflet-container") ? "map" : "topHost", src: i.src.slice(-90), op: getComputedStyle(i).opacity, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), nat: i.naturalWidth + "x" + i.naturalHeight, disp: getComputedStyle(i).display, vis: getComputedStyle(i).visibility }; }); }), null, 1));
  if (process.argv.includes("--chain")) console.log(JSON.stringify(await page.evaluate(() => { const i = document.querySelector("img.leaflet-image-layer[src*='show%3A27']"); const out = []; for (let e = i; e && e !== document.body; e = e.parentElement) { const c = getComputedStyle(e), r = e.getBoundingClientRect(); out.push({ tag: e.tagName + "." + (e.className && e.className.baseVal === undefined ? e.className : "").toString().slice(0, 40), op: c.opacity, z: c.zIndex, ov: c.overflow, disp: c.display, vis: c.visibility, tf: c.transform.slice(0, 40), mix: c.mixBlendMode, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }); } return out; }), null, 0));
  const box = await page.getByTestId("planner-canvas").boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const panelW = PANEL ? await page.evaluate(() => { const el = document.querySelector('[data-testid="left-panel"], [data-left-panel]'); return el ? el.getBoundingClientRect().right : 0; }) : 0;
  if (PANEL) console.log(`panel "${PANEL}" open; its right edge at ${panelW}`);
  const X0 = Math.max(box.x + 260, panelW + 40), X1 = box.x + box.width - 260, Y0 = box.y + 120, Y1 = box.y + box.height - 110;
  const cdp = await context.newCDPSession(page);
  if (CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  let frames = [], recording = false;
  cdp.on("Page.screencastFrame", (f) => { cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {}); if (recording) frames.push({ t: f.metadata.timestamp, data: f.data }); });
  const read = (img, which, wide = false) => {
    // the plan's parcel edges sit near the canvas edge (the planner frames the parcel), so its role is read over the whole canvas box
    const [wx0, wy0, wx1, wy1] = wide ? [box.x + 24, box.y + 24, box.x + box.width - 24, box.y + box.height - 24] : [X0, Y0, X1, Y1];
    const k = img.width / 1440, rows = [], cols = [];
    for (let i = 0; i < SCAN_LINES; i++) { rows.push(Math.round((wy0 + ((wy1 - wy0) * (i + 0.5)) / SCAN_LINES) * k)); cols.push(Math.round((wx0 + ((wx1 - wx0) * (i + 0.5)) / SCAN_LINES) * k)); }
    // rows scan across VERTICAL lines (FEMA sublayer 28 — the area role); columns across HORIZONTAL lines (sublayer 27 — the line role)
    const r = readFrame(img, { rows: which === "area" ? rows : [], cols: which === "line" ? cols : [], bandPx: (BAND_IMG_PX / (dpr > 1 ? 2 : 1)) * k, maxPx: 60 * k, xRange: [Math.round(wx0 * k), Math.round(wx1 * k)], yRange: [Math.round(wy0 * k), Math.round(wy1 * k)] });
    if (r.worst != null) { r.worst /= k; r.median /= k; }
    return r;
  };
  /* roles share the one reader, so each role is read off a copy where the OTHER roles' ink is turned back into band-red and its own is made purple */
  const recolour = (img, mode) => { const out = { ...img, data: Buffer.from(img.data) }; const d = out.data, ch = img.channels; for (let o = 0; o < d.length; o += ch) { const r = d[o], g = d[o + 1], b = d[o + 2]; const green = g > 130 && r < 90 && b < 90, ink = r > 110 && b > 60 && b > g + 15 && g < 140; if (mode === "svg") { if (green) { d[o] = 162; d[o + 1] = 28; d[o + 2] = 175; } else if (ink) { d[o] = 255; d[o + 1] = 0; d[o + 2] = 0; } } else if (green) { d[o] = 255; d[o + 1] = 0; d[o + 2] = 0; } } return out; };
  const both = (img) => {
    const fema = WITH_SVG ? recolour(img, "fema") : img;
    const o = { area: read(fema, "area"), line: read(fema, "line") };
    if (WITH_SVG) { const sv = recolour(img, "svg"); o.svgX = read(sv, "area", true); o.svgY = read(sv, "line", true); }
    return o;
  };
  const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
  if (REAL) {
    // real pixels carry no oracle: save the frames of each gesture for a human to read (crop the same shoreline across frames), and count what the app drew
    const fs = await import("node:fs"); fs.mkdirSync(FRAMES_DIR, { recursive: true }); fs.writeFileSync(`${FRAMES_DIR}/rest-dpr${dpr}.png`, Buffer.from(shot.data, "base64"));
    console.log(`\n=== REAL pixels, dpr ${dpr}: frames of every gesture saved under ${FRAMES_DIR} ===`);
  }
  const rest = REAL ? { area: { crossings: 99, worst: 0 }, line: { crossings: 99, worst: 0 } } : both(decodePng(Buffer.from(shot.data, "base64")));
  console.log(`\n=== dpr ${dpr}${DELAY_MS ? `  (FEMA export latency ${DELAY_MS} ms)` : ""} ===`);
  console.log(`KNOWN-GOOD ARM at rest: area(28) ${rest.area.crossings} crossings worst ${rest.area.worst == null ? "—" : rest.area.worst.toFixed(2)} px · line(27) ${rest.line.crossings} crossings worst ${rest.line.worst == null ? "—" : rest.line.worst.toFixed(2)} px · FEMA exports asked 28:${asked[28]} 27:${asked[27]}`);
  if (CROPS) { (await import("node:fs")).mkdirSync(CROPS, { recursive: true }); (await import("node:fs")).writeFileSync(`${CROPS}/rest-dpr${dpr}.png`, Buffer.from(shot.data, "base64")); }
  const okArm = (a) => a.crossings >= 8 && a.worst <= 1.5;
  if (WITH_SVG) console.log(`  plan parcel edges at rest: x ${rest.svgX.crossings} crossings worst ${rest.svgX.worst == null ? "—" : rest.svgX.worst.toFixed(2)} px · y ${rest.svgY.crossings} crossings worst ${rest.svgY.worst == null ? "—" : rest.svgY.worst.toFixed(2)} px`);
  if (!okArm(rest.area) || !okArm(rest.line) || (WITH_SVG && (rest.svgX.crossings < 4 || rest.svgY.crossings < 4))) { console.log("❌ VOID — the instrument cannot see the FEMA lines on the imagery at rest"); return { dpr, void: true }; }

  const results = [];
  async function gesture(label, action, { hold = 2500 + DELAY_MS } = {}) {
    if (ONLY && !label.includes(ONLY)) return;
    frames = []; recording = true;
    await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1, maxWidth: Math.round(1440 * dpr), maxHeight: Math.round(900 * dpr) });
    await sleep(120); await action(); await sleep(hold);
    recording = false; await cdp.send("Page.stopScreencast");
    if (REAL) { const fs = await import("node:fs"); const t0r = frames.length ? frames[0].t : 0; frames.forEach((f, i) => { if (i % 2 === 0 || i === frames.length - 1) fs.writeFileSync(`${FRAMES_DIR}/dpr${dpr}-${label.replace(/\W+/g, "_")}-${String(i).padStart(3, "0")}-${Math.round((f.t - t0r) * 1000)}ms.png`, Buffer.from(f.data, "base64")); }); console.log(`  ${label.padEnd(40)} ${frames.length} frames over ${frames.length ? Math.round((frames[frames.length - 1].t - t0r) * 1000) : 0} ms`); results.push({ dpr, label, frames: frames.length, area: { worstPx: 0, framesOff: 0, framesUnpaired: 0 }, line: { worstPx: 0, framesOff: 0, framesUnpaired: 0 } }); await sleep(800); return; }
    const per = frames.map((f) => { const img = decodePng(Buffer.from(f.data, "base64")); return { t: f.t, img, ...both(img) }; });
    const t0 = per.length ? per[0].t : 0;
    if (CROPS && process.argv.includes("--allframes")) { const fs = await import("node:fs"); fs.mkdirSync(CROPS, { recursive: true }); frames.forEach((f, i) => fs.writeFileSync(`${CROPS}/all-${label.replace(/\W+/g, "_")}-${String(i).padStart(3, "0")}-${Math.round((f.t - t0) * 1000)}ms.png`, Buffer.from(f.data, "base64"))); }
    const row = { dpr, label, frames: per.length };
    if (process.argv.includes("--relative")) {
      const k0 = per.length ? per[0].img.width / 1440 : 1; let prof = null; const worst = { fema: 0, overlay: 0 }; const trace = [];
      for (const p of per) { const cur = profiles(p.img, [X0, Y0, X1, Y1], k0); if (prof) { const sh = {}; for (const name of Object.keys(MASKS)) { const a = prof[name], b = cur[name]; const dx = a.n > 200 && b.n > 200 ? bestShift(a.px, b.px, Math.round(160 * k0)) : null; const dy = a.n > 200 && b.n > 200 ? bestShift(a.py, b.py, Math.round(160 * k0)) : null; sh[name] = dx == null || dy == null ? null : [dx / k0, dy / k0]; }
        if (sh.imagery) for (const name of ["fema", "overlay"]) if (sh[name]) { const d = Math.max(Math.abs(sh[name][0] - sh.imagery[0]), Math.abs(sh[name][1] - sh.imagery[1])); worst[name] = Math.max(worst[name], d); }
        trace.push(`${Object.entries(sh).map(([n, v]) => `${n[0]}:${v ? v.map((q) => q.toFixed(0)).join(",") : "-"}`).join(" ")}`); } prof = cur; }
      row.relative = worst; console.log(`    relative motion vs imagery, worst per-frame disagreement (CSS px): fema ${worst.fema.toFixed(1)}  overlay ${worst.overlay.toFixed(1)}`); if (TRACE) console.log("      " + trace.join(" | "));
    }
    for (const which of ROLES) {
      const rd = per.filter((p) => p[which].crossings);
      const worst = rd.reduce((m, p) => Math.max(m, p[which].worst), 0);
      const off = per.filter((p) => p[which].crossings && p[which].worst > LIMIT_PX).length;
      const lost = per.filter((p) => p[which].unpaired > 0).length;
      row[which] = { worstPx: Number(worst.toFixed(1)), framesOff: off, framesUnpaired: lost, read: rd.length };
      if (CROPS) for (const [i, p] of per.entries()) {
        if (!(p[which].crossings && p[which].worst > LIMIT_PX && p[which].worstAt)) continue;
        const k = p.img.width / 1440; const j = judgeCrossing(profileCrossing(p.img, p[which].worstAt, { k }), { limit: LIMIT_PX });
        if (i % 4) continue; // a few per gesture is enough to read
        (await import("node:fs")).writeFileSync(`${CROPS}/dpr${dpr}-${label.replace(/\W+/g, "_")}-${which}-f${String(i).padStart(3, "0")}-${p[which].worst.toFixed(1)}px-${j.verdict}.png`, cropPng(p.img, p[which].worstAt, { k }));
      }
    }
    results.push(row);
    console.log(`  ${label.padEnd(34)} frames ${String(per.length).padStart(3)}  AREA(28) worst ${String(row.area.worstPx).padStart(5)} px off>${LIMIT_PX} ${String(row.area.framesOff).padStart(3)} | LINE(27) worst ${String(row.line.worstPx).padStart(5)} px off>${LIMIT_PX} ${String(row.line.framesOff).padStart(3)}${WITH_SVG ? ` | PLAN x ${row.svgX.worstPx} y ${row.svgY.worstPx} px off ${row.svgX.framesOff}/${row.svgY.framesOff}` : ""}`);
    if (TRACE) console.log("    " + per.map((p) => `${Math.round((p.t - t0) * 1000)}ms:${p.area.worst == null ? "-" : p.area.worst.toFixed(0)}/${p.line.worst == null ? "-" : p.line.worst.toFixed(0)}${WITH_SVG ? `/plan ${p.svgX.worst == null ? "-" : p.svgX.worst.toFixed(1)},${p.svgY.worst == null ? "-" : p.svgY.worst.toFixed(1)}` : ""}`).join(" "));
    for (const p of per) p.img = null;
    await sleep(800 + DELAY_MS);
  }
  // --sweep N: N random drags (and an occasional wheel notch, so the zoom is fractional and varied), each read AT REST once settled — the distribution of the leftover offset
  const SWEEP = Number(arg("--sweep", "0"));
  if (SWEEP) {
    let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const rows = [];
    for (let i = 0; i < SWEEP; i++) {
      if (i % 5 === 4) { await page.mouse.move(cx + (rnd() - 0.5) * 300, cy + (rnd() - 0.5) * 200); await page.mouse.wheel(0, rnd() < 0.5 ? -100 : 100); }
      else { const dx = Math.round((rnd() - 0.5) * 520), dy = Math.round((rnd() - 0.5) * 380); await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + dx, cy + dy, { steps: 8 }); await page.mouse.up(); }
      await sleep(900 + DELAY_MS);
      const sh = await cdp.send("Page.captureScreenshot", { format: "png" }); const r = both(decodePng(Buffer.from(sh.data, "base64")));
      const z = await page.evaluate(() => window.__geoMap && window.__geoMap.getZoom());
      rows.push({ i, zoom: z && +z.toFixed(3), area: r.area.worst, line: r.line.worst, nA: r.area.crossings, nL: r.line.crossings });
    }
    for (const r of rows) console.log(`  #${String(r.i).padStart(2)} zoom ${r.zoom}  area(x) ${r.area == null ? "—" : r.area.toFixed(1)} px (${r.nA})  line(y) ${r.line == null ? "—" : r.line.toFixed(1)} px (${r.nL})`);
    const a = rows.map((r) => r.area).filter((v) => v != null), l = rows.map((r) => r.line).filter((v) => v != null);
    console.log(`SWEEP dpr ${dpr}: leftover offset at rest over ${rows.length} settles — area(x) max ${Math.max(...a).toFixed(1)}  line(y) max ${Math.max(...l).toFixed(1)} px; >${LIMIT_PX}px: area ${a.filter((v) => v > LIMIT_PX).length}, line ${l.filter((v) => v > LIMIT_PX).length}`);
    return { dpr, results: [{ dpr, label: "sweep", frames: rows.length, area: { worstPx: Math.max(...a), framesOff: a.filter((v) => v > LIMIT_PX).length, framesUnpaired: 0 }, line: { worstPx: Math.max(...l), framesOff: l.filter((v) => v > LIMIT_PX).length, framesUnpaired: 0 } }], build: liveBuild };
  }
  // --track: a rAF-paced recorder of where the two FEMA images, the imagery tiles and the pane transforms sit (main-thread geometry — a SUPPORTING reading only,
  // it can never replace the frames; FOREGROUND-OR-VOID asserted above), started before the gesture and read after it
  const trackStart = () => page.evaluate(() => { const svg = document.querySelector('[data-testid="planner-canvas"]'); const wrap = svg.parentElement; const rows = []; const t0 = performance.now(); window.__trk = { rows, stop: false }; const tick = () => { const imgs = [...wrap.querySelectorAll("img.leaflet-image-layer")].map((i) => { const r = i.getBoundingClientRect(); return `${/show%3A(\d+)/.exec(i.src)?.[1]}:${r.left.toFixed(1)},${r.top.toFixed(1)} ${r.width.toFixed(0)}x${r.height.toFixed(0)} o${getComputedStyle(i).opacity}`; }); const tile = [...wrap.querySelectorAll("img.leaflet-tile")].filter((t) => /\/tile\/17\//.test(t.src))[0]; const tr = tile && tile.getBoundingClientRect(); const mp = window.__geoMap && window.__geoMap._mapPane; rows.push(`${Math.round(performance.now() - t0)}ms wrapTf=${wrap.firstElementChild && wrap.style.transform ? "G" : "-"} mapPane=${mp && mp.style.transform} tile=${tr ? tr.left.toFixed(1) + "," + tr.top.toFixed(1) : "-"} | ${imgs.join(" | ")}`); if (!window.__trk.stop) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  const trackStop = () => page.evaluate(() => { window.__trk.stop = true; return window.__trk.rows; });
  // drags start OUTSIDE the plan's parcel (a press on a lot selects it, and its selection chrome would then be read as ink)
  const gx = WITH_SVG ? box.x + 150 : cx, gy = WITH_SVG ? cy : cy;
  const drag = (dx, dy, steps = 16) => async () => { await page.mouse.move(gx, gy); await page.mouse.down(); await page.mouse.move(gx + dx, gy + dy, { steps }); await page.mouse.up(); };
  if (process.argv.includes("--track")) { await trackStart(); }
  await gesture("pan drag (slow, 16 steps)", drag(240, 90, 16));
  if (process.argv.includes("--track")) { const rows = await trackStop(); const keep = rows.filter((r, i) => i === 0 || r.replace(/^\d+ms /, "") !== rows[i - 1].replace(/^\d+ms /, "")); console.log(`TRACK ${keep.length} distinct states of ${rows.length} frames:\n` + keep.join("\n")); }
  if (process.argv.includes("--reg")) console.log("REG after pan 1:", JSON.stringify(await page.evaluate(() => { const v = window.__plannerView; const svg = document.querySelector('[data-testid="planner-canvas"]'); return { registration: v && v.registration && v.registration(), dx: svg.getAttribute("data-reg-dx"), dy: svg.getAttribute("data-reg-dy"), ppf: svg.getAttribute("data-view-ppf"), zoom: window.__geoMap && window.__geoMap.getZoom() }; })));
  if (process.argv.includes("--probe")) console.log("PROBE after pan 1:", JSON.stringify(await page.evaluate(() => { const svg = document.querySelector('[data-testid="planner-canvas"]'); const wrap = svg.parentElement; const map = window.__geoMap; const r = (e) => { const b = e.getBoundingClientRect(); return [Math.round(b.left * 100) / 100, Math.round(b.top * 100) / 100]; }; const a = wrap.querySelector("img[src*='show%3A28']"), l = wrap.querySelector("img[src*='show%3A27']"); const lp = wrap.querySelector(".leaflet-gisLine-pane"); const tr = (e) => e && e.style.transform; return { mapPane: tr(map._mapPane), linePaneHost: tr(lp.parentElement), topWrap: tr(lp.parentElement.parentElement), areaImg: r(a), lineImg: r(l), areaImgTf: tr(a), lineImgTf: tr(l), size: map.getSize(), zoom: map.getZoom() }; })));
  await gesture("pan drag (fast flick, 4 steps)", drag(-300, -110, 4));
  if (CROPS) { const sh2 = await cdp.send("Page.captureScreenshot", { format: "png" }); (await import("node:fs")).writeFileSync(`${CROPS}/after-two-drags-dpr${dpr}.png`, Buffer.from(sh2.data, "base64")); }
  await gesture("pan drag back (slow)", drag(60, 20, 30));
  // a PERSON'S drag: moves, stops to look (the 160 ms settle commit fires WHILE the button is still down), moves on, releases
  await gesture("pan drag with pauses (commit mid-drag)", async () => { await page.mouse.move(gx, gy); await page.mouse.down(); for (let i = 0; i < 3; i++) { await page.mouse.move(gx + (i + 1) * 90, gy + (i + 1) * 30, { steps: 6 }); await sleep(420); } await page.mouse.move(gx + 220, gy + 60, { steps: 5 }); await page.mouse.up(); });
  await gesture("touch drag (CDP touch)", async () => { await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: gx, y: gy, id: 1 }] }); for (let i = 1; i <= 16; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: gx + i * 4, y: gy + i * 5, id: 1 }] }); await sleep(16); } await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); });
  await gesture("wheel notch in", async () => { await page.mouse.move(cx, cy); await page.mouse.wheel(0, -100); });
  await gesture("wheel notch out", async () => { await page.mouse.move(cx, cy); await page.mouse.wheel(0, 100); });
  await gesture("pan drag after zoom", drag(-200, 80, 14));
  if (errs.length) console.log(`  page errors: ${errs.slice(0, 2).join(" | ")}`);
  return { dpr, results, build: liveBuild };
  } finally { await cleanup(); await browser.close().catch(() => {}); }
}

const all = [];
for (const d of DPRS) all.push(await runAtDpr(d));
const flat = all.flatMap((r) => r.results || []);
const voided = all.filter((r) => r.void).length;
const bad = flat.filter((r) => ROLES.some((k) => r[k] && (r[k].worstPx > LIMIT_PX || r[k].framesUnpaired > 0)));
console.log(`\n${voided ? `❌ VOID at ${voided} pixel ratio(s) — no verdict for them\n` : ""}${voided && !flat.length ? "" : bad.length ? `❌ ${bad.length}/${flat.length} gestures had a frame where a FEMA line was more than ${LIMIT_PX} CSS px off the ground grid` : `✅ every frame of every gesture: FEMA lines within ${LIMIT_PX} CSS px of the ground grid`}`);
if (REAL) console.log(`\n(--real: no oracle exists in real pixels — frames are saved under ${FRAMES_DIR}; the ✅ above is NOT a verdict, read the frames)`);
console.log("JSON " + JSON.stringify(flat));
process.exit(voided ? 2 : EXPECT_RED ? (bad.length ? 0 : 1) : bad.length ? 1 : 0);
