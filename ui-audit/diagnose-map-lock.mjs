/* NEW-1 + NEW-5 headless gate — does the drawing stay welded to the basemap across a long
 * out-and-back pan, and does viewport culling leave the drawing (and the export) intact?
 *
 * This is the sandbox-runnable half of the live measurement. External tile hosts are
 * egress-blocked here so no aerial IMAGE ever paints — but the Leaflet map object itself is
 * fully live, and the lock is a property of its centre/zoom versus the SVG transform, not of
 * whether pixels arrived. So we can measure the exact thing the live session measured:
 *
 *   • drive a long north pan and back, then compare the basemap's centre + zoom, and the
 *     drawn geometry's own screen coordinates, against where they started. Before the fix
 *     the map came back short (measured live: -4.3 ft per ~89,000 ft excursion, cumulative,
 *     and the zoom didn't fully restore either: 13.5678 → 13.5652 → 13.5677).
 *   • confirm culling never blanks the drawing, and that what it hides comes back.
 *
 * ── WHY THIS FILE GREW A POSITION HALF (NEW-1, after the V478 live pass) ─────────────────
 * The live pass found the accumulation criterion PASSING decisively — a round trip repeated
 * twice returned identical to the hundredth of a foot — but reported a CONSTANT ~36.5 ft
 * latitude residual that this gate did not catch, because every assertion here was about
 * SCALE ("the basemap sits at exactly the drawing's scale at start, far and back") and none
 * was about POSITION. That gap is now closed: an out-and-back gesture must return the
 * drawing to within a STATED epsilon of its starting lock, and the epsilon is committed
 * below rather than left implicit.
 *
 * ── WHAT THE 36.5 ft ACTUALLY WAS (adjudicated here so nobody re-chases it) ──────────────
 * It is a REAL, BOUNDED quantisation, and its size is ONE SCREEN PIXEL — not 36 feet. The
 * live probe was zoomed out to ~36.7 ft per screen pixel, which is the only reason a
 * one-pixel offset reads as 36.5 ft. The error is constant in PIXELS, so it shrinks with
 * the zoom: at a working site zoom it is inches, and it can never put a pond over a freeway.
 *
 * Mechanism, measured here, both directions:
 *   • A pure PAN is exactly lossless and does not move the registration AT ALL. A mouse drag
 *     moves the view by whole pixels, so the pan the basemap needs is a whole number and
 *     Leaflet's rounding is the identity. Replaying the live harness — 4 x 300 px drags out,
 *     settle, 4 back, twice — returns 0.000 ft, as does an exactly-symmetric programmatic
 *     out-and-back. So the live residual did NOT come from the panning.
 *   • A ZOOM commit does move it. Leaflet can only place the basemap on whole screen pixels
 *     (`_getNewPixelOrigin` ends in `._round()`, the map pane's position is integer, and
 *     `panBy` rounds its offset), while the drawing's offsets are arbitrary floats. Every
 *     `setView` therefore re-snaps the basemap onto a fresh whole-pixel grid and the
 *     registration hops to a new sub-pixel remainder — measured wandering between 0.25 and
 *     0.74 px across repeated zoom commits, never growing.
 * So: bounded by half a pixel at any instant, and by a whole pixel between two instants.
 * That is Leaflet's floor, not a model disagreement, and it is deliberately NOT compensated:
 * the only ways to remove it are to leave a permanent fractional transform on the tile wrap
 * (which resamples — i.e. softens — the aerial, the one thing B1049/V483 forbade buying
 * anything with) or to nudge the drawing's own view offsets (which would destroy the
 * exactly-reversible pan this whole item exists to guarantee). A sub-pixel offset is a
 * better outcome than either. What we DO owe it is a committed bound, which is what the
 * epsilon below is.
 *
 * Run: node ui-audit/diagnose-map-lock.mjs   (vite preview must be on :4173)
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

/* ── THE COMMITTED EPSILONS ───────────────────────────────────────────────────────────────
 * LOCK_EPSILON_PX — how far the drawing may sit from the imagery, in SCREEN PIXELS, at any
 * instant or between any two instants. One pixel: Leaflet's integer map pane quantises the
 * basemap at half a pixel per axis, so two moments can differ by a whole one. Anything past
 * that is a real model disagreement — the class the NEW-1 fix closed, which grew without
 * bound (it reached +0.52% of scale, i.e. hundreds of feet, over a long excursion).
 * Deliberately expressed in PIXELS, not feet: the quantisation is a pixel-domain effect, so
 * a feet threshold would be meaningless at one zoom and vacuous at another. The feet
 * equivalent is printed alongside every reading so the number stays legible.
 *
 * PAN_EPSILON_PX — a PURE PAN has no rounding to do at all (whole-pixel gestures), so an
 * out-and-back pan must return EXACTLY. This is the tight one, and it is the assertion the
 * original defect would have failed: it lost a few feet every single excursion. */
const LOCK_EPSILON_PX = 1.0;
const PAN_EPSILON_PX = 0.001;

// A wide plan — elements spread far enough that a pan genuinely takes some off screen.
const els = [];
for (let i = 0; i < 60; i++) {
  els.push({ id: `e${i}`, type: "building", cx: (i % 10) * 900 - 4000, cy: Math.floor(i / 10) * 700 - 2000, w: 420, h: 180, rot: 0 });
}
const site = {
  id: "lock-demo", groupId: "lock-demo", site: "Lock Demo", name: "Plan 1",
  origin: { lat: 29.786, lon: -95.83 }, county: "harris",
  parcels: [{ id: "pc1", locked: false, points: [{ x: -440, y: -160 }, { x: 440, y: -160 }, { x: 440, y: 300 }, { x: -440, y: 300 }] }],
  els, measures: [], callouts: [], markups: [], settings: {}, underlay: null,
  updatedAt: Date.now(), data: { status: "active" },
};
const seed = `(() => { try {
  window.__PLANYR_E2E = true;
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [site.id]: site })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(site.id)});
} catch (e) {} })();`;

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
/* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — not its clock, and not its pixels. A hidden tab clamps
   setTimeout (a setTimeout-paced probe then times the clamp: 3,156 ms for a 138-182 ms gesture) AND
   suspends requestAnimationFrame, so after a view change the app's state attributes update while the
   drawing never repaints — every box, position, hit test and screenshot then agrees with every other
   and describes a view the app already left. One precondition covers both, rAF liveness probe
   included; see ui-audit/lib/tabTiming.mjs. Fails loudly rather than reporting either. */
await assertMeasurable(page, "diagnose-map-lock");
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(BASE, { waitUntil: "load" });
await page.waitForSelector("svg[role=application]", { timeout: 20000 });
await page.waitForTimeout(2500);

const svg = page.locator("svg[role=application]");
const box = await svg.boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

/* THE SCALE MEASUREMENT.
   "Locked to the imagery" is one statement: the basemap's zoom must be exactly the zoom at
   which its pixels-per-foot equals the drawing's — and that must hold at EVERY latitude the
   map is panned to, because the drawing's pixels-per-foot does not change when you pan.
   The pre-fix code re-derived the basemap's zoom at the PANNED-TO latitude while the drawing
   stayed put, so the two disagreed more and more the further north you went (measured live:
   +0.18% at the far position; this harness measured +0.52% over a longer excursion), and the
   round trip came back short by a few feet every time.

   The drawing's own scale is read off the rendered parcel, whose north edge is 880 ft by
   construction. Everything else comes from Leaflet's public API. Zooming OUT first is what
   makes the excursion long: one drag then covers tens of thousands of feet. */
const FT_PER_DEG = 365223, LAT0 = site.origin.lat, LON0 = site.origin.lon;
const expectedZoom = (ppf) => Math.log2((ppf * FT_PER_DEG * Math.cos((LAT0 * Math.PI) / 180)) / (256 / 360));

/* THE POSITION MEASUREMENT (the V478(a) gap).
   Two independent readings, both taken in the MAP CONTAINER's pixel frame:

   `lockErrPx` — the instantaneous "is the drawing on the imagery" number. For a handful of
   feet points we compute where the drawing puts them (feet x ppf + offset) and where the
   basemap puts the same lat/lng, and take the worst disagreement. This is `lockOffsetPx`
   from lib/mapLock.js, but measured against the LIVE Leaflet map instead of the pure model,
   so it sees the quantisation the pure test cannot.

   `probes` — the live session's own technique, kept because it is the criterion as written:
   for each on-screen drawn element, the lat/lng the BASEMAP assigns at that element's screen
   centre. Anchored by GEOMETRY SIGNATURE (the `d`/`points`/`x,y,w` attribute), never by a
   held DOM reference — B1047's culling removes and RE-CREATES off-screen elements, so a held
   reference goes stale mid-excursion and yields garbage. (Learned the hard way live; written
   down here so the next harness does not rediscover it.)

   ⚠ FRAME: the SVG and the Leaflet container are SEPARATE boxes and are NOT coincident — in
   this layout they differ by a few hundred pixels. Comparing an SVG-local coordinate with a
   container-local one without adding that delta reads as a huge constant "error" that is
   pure frame mismatch. `DX/DY` below is that delta. Do not remove it. */
const read = () => page.evaluate(([lat0, lon0, ftPerDeg]) => {
  const m = window.__geoMap;
  const s = document.querySelector("svg[role=application]");
  if (!m || !s || !window.__plannerView) return null;
  const v = window.__plannerView.get();
  const sr = s.getBoundingClientRect(), mr = m.getContainer().getBoundingClientRect();
  const DX = sr.left - mr.left, DY = sr.top - mr.top;

  const R2D = 180 / Math.PI, D2R = Math.PI / 180;
  const mercDeg = (lat) => R2D * Math.log(Math.tan(Math.PI / 4 + lat * D2R / 2));
  const invMercDeg = (mm) => R2D * (2 * Math.atan(Math.exp(mm * D2R)) - Math.PI / 2);
  const k = ftPerDeg * Math.cos(lat0 * D2R);
  const feetToLL = (pt) => [invMercDeg(mercDeg(lat0) - pt.y / k), lon0 + pt.x / k];

  // Instantaneous lock error: drawing vs basemap, same feet point, same frame.
  let lockErrPx = 0;
  for (const pt of [{ x: 0, y: 0 }, { x: 2500, y: 1800 }, { x: -4000, y: -2200 }]) {
    const drawn = { x: pt.x * v.ppf + v.offX + DX, y: pt.y * v.ppf + v.offY + DY };
    const onMap = m.latLngToContainerPoint(feetToLL(pt));
    lockErrPx = Math.max(lockErrPx, Math.hypot(onMap.x - drawn.x, onMap.y - drawn.y));
  }

  // Per-element geo probes, anchored by geometry signature (see the note above). The
  // signature must be UNIQUE to be an anchor: a `rect` laid out by a transform carries no
  // x/y attribute, so a naive signature degenerates to the same string for many elements and
  // the harness silently compares element A against element B — which reads as a large,
  // perfectly constant "residual" that is pure mis-anchoring. Anything ambiguous is dropped.
  const cand = [];
  for (const el of s.querySelectorAll("polygon[points], polyline[points], path[d], rect[x][y]")) {
    const geo = el.getAttribute("points") || el.getAttribute("d") ||
      `${el.getAttribute("x")},${el.getAttribute("y")},${el.getAttribute("width")},${el.getAttribute("height")}`;
    const b = el.getBoundingClientRect();
    if (!b.width || b.left < sr.left + 5 || b.right > sr.right - 5 || b.top < sr.top + 5 || b.bottom > sr.bottom - 5) continue;
    cand.push({ sig: `${el.tagName}|${geo}`, b });
  }
  const seen = new Map();
  for (const c of cand) seen.set(c.sig, (seen.get(c.sig) || 0) + 1);
  const probes = [];
  for (const c of cand) {
    if (seen.get(c.sig) !== 1) continue;
    const ll = m.containerPointToLatLng([c.b.left + c.b.width / 2 - mr.left, c.b.top + c.b.height / 2 - mr.top]);
    probes.push({ sig: c.sig, lat: ll.lat, lng: ll.lng, w: c.b.width });
    if (probes.length >= 6) break;
  }

  const pc = s.querySelector('[data-testid="parcel-outline"]');
  let edgePx = null;
  if (pc) {
    const p = pc.getAttribute("points").split(" ").map((q) => q.split(",").map(Number));
    edgePx = Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]); // the 880 ft north edge
  }
  const c = m.getCenter();
  return { lat: c.lat, lng: c.lng, zoom: m.getZoom(), edgePx, drawn: s.querySelectorAll("g").length, lockErrPx, probes, ppf: v.ppf, offX: v.offX, offY: v.offY };
}, [LAT0, LON0, FT_PER_DEG]);

const emptyGrab = async (dy) => {
  // Leave room for the whole drag INSIDE the viewport (a drag that runs off the edge is
  // clamped and moves the view by far less than asked), and land on empty canvas (a press on
  // a building drags the building, not the view).
  const yFracs = dy > 0 ? [0.12, 0.06, 0.2] : [0.88, 0.94, 0.8];
  for (const fx of [0.08, 0.92, 0.5]) for (const fy of yFracs) {
    const x = Math.round(box.x + box.width * fx), y = Math.round(box.y + box.height * fy);
    const onCanvas = await page.evaluate(([px, py]) => {
      const el = document.elementFromPoint(px, py);
      return !!el && (el.tagName === "svg" || el.getAttribute("role") === "application");
    }, [x, y]);
    if (onCanvas) return { x, y };
  }
  return null;
};
const pan = async (dy) => {
  const g = await emptyGrab(dy);
  if (!g) return false;
  await page.keyboard.down("Space");
  await page.mouse.move(g.x, g.y); await page.mouse.down();
  await page.mouse.move(g.x, g.y + dy, { steps: 6 }); await page.mouse.up();
  await page.keyboard.up("Space");
  await page.waitForTimeout(700); // let the basemap commit (~160 ms debounce) settle
  return true;
};

// Zoom OUT so a single drag covers real ground. The wheel is the planner's zoom gesture.
await page.mouse.move(cx, cy);
for (let i = 0; i < 28; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(25); }
await page.waitForTimeout(900);

/* The excursion has to be LONG. A model disagreement between the drawing's frame and the
 * basemap's grows with distance from the site origin, so a short hop can leave a genuine
 * defect sitting right on top of the one-pixel quantisation floor and indistinguishable from
 * it — verified: re-injecting the original mixed model put the far-position lock error at
 * exactly 1.00 px over a single ~25,000 ft drag, which the epsilon would not have caught.
 * Four drags out reaches ~98,000 ft, the scale of the live repro, where the same defect
 * reads ~4 px and is unmistakable. */
const STEP = Math.round(box.height * 0.6), LEGS = 4;
const start = await read();
if (!start || !start.edgePx) { console.log("SETUP FAILED — no parcel on screen to read the drawing's scale from"); await browser.close(); process.exit(2); }
for (let i = 0; i < LEGS; i++) {
  if (!(await pan(STEP))) { console.log("SETUP FAILED — no empty canvas to grab for a pan"); await browser.close(); process.exit(2); }
}
const far = await read();
for (let i = 0; i < LEGS; i++) {
  if (!(await pan(-STEP))) { console.log("SETUP FAILED — could not pan back"); await browser.close(); process.exit(2); }
}
const end = await read();

const ppfDrawn = start.edgePx / 880;                 // constant across a pure pan
const want = expectedZoom(ppfDrawn);
const travelledFt = Math.abs(far.lat - start.lat) * FT_PER_DEG;
const zoomErr = (s) => s.zoom - want;
const scalePct = (s) => (Math.pow(2, zoomErr(s)) - 1) * 100;
const ftPerPx = 1 / start.ppf;
const px = (ft) => ft * start.ppf;

/* Position return, in the frame the epsilon is stated in. Both readings are reported: the
 * map centre (what the live session logged) and the drawn elements themselves (the criterion
 * as written). A probe whose signature changed is reported rather than silently skipped —
 * a silent skip is how a culling-stale harness reads as a pass. */
const centreReturnPx = (a, b) => px(Math.hypot((b.lat - a.lat) * FT_PER_DEG, (b.lng - a.lng) * FT_PER_DEG * Math.cos((LAT0 * Math.PI) / 180)));
const probeReturn = (a, b) => {
  let worst = 0, matched = 0, stale = 0;
  for (const p of a.probes) {
    const q = b.probes.find((r) => r.sig === p.sig);
    if (!q) { stale++; continue; }
    matched++;
    worst = Math.max(worst, px(Math.hypot((q.lat - p.lat) * FT_PER_DEG, (q.lng - p.lng) * FT_PER_DEG * Math.cos((LAT0 * Math.PI) / 180))));
  }
  return { worstPx: worst, matched, stale };
};

const row = (l, s) => `${l.padEnd(6)} lat ${s.lat.toFixed(6)} · basemap zoom ${s.zoom.toFixed(9)} · needs ${want.toFixed(9)} · basemap is ${scalePct(s) >= 0 ? "+" : ""}${scalePct(s).toFixed(4)}% off the drawing · drawing-vs-imagery ${s.lockErrPx.toFixed(3)} px · drawn <g> ${s.drawn}`;
console.log(`excursion : ${LEGS} drags of ${STEP} px ≈ ${Math.round(travelledFt).toLocaleString()} ft north, then back   (1 px ≈ ${ftPerPx.toFixed(1)} ft at this zoom)`);
console.log(`epsilons  : lock ≤ ${LOCK_EPSILON_PX} px (≈ ${(LOCK_EPSILON_PX * ftPerPx).toFixed(1)} ft here) · pure-pan return ≤ ${PAN_EPSILON_PX} px`);
console.log(row("start", start));
console.log(row("far", far));
console.log(row("end", end));

const r1c = centreReturnPx(start, end), r1p = probeReturn(start, end);
console.log(`round trip: map centre came back ${r1c.toFixed(4)} px (${(r1c * ftPerPx).toFixed(3)} ft) off — live report measured -4.3 ft per excursion, cumulative`);
console.log(`          : drawn elements came back ${r1p.worstPx.toFixed(4)} px (${(r1p.worstPx * ftPerPx).toFixed(3)} ft) off, worst of ${r1p.matched} matched${r1p.stale ? ` (${r1p.stale} stale sig)` : ""}`);
console.log(`zoom      : ${start.zoom.toFixed(9)} → ${far.zoom.toFixed(9)} → ${end.zoom.toFixed(9)}  — live report: 13.5678 → 13.5652 → 13.5677 (did NOT restore)`);
console.log(`culling   : drawn <g> ${start.drawn} → ${far.drawn} (panned away) → ${end.drawn} (back)`);

const fails = [];
if (travelledFt < 10000) fails.push(`excursion too short to be a real test (${Math.round(travelledFt)} ft) — the pan gesture did not drive`);
for (const [k, s] of [["start", start], ["far", far], ["end", end]]) {
  if (Math.abs(zoomErr(s)) > 1e-6) fails.push(`${k}: the basemap is scaled ${scalePct(s).toFixed(4)}% away from the drawing`);
  if (s.lockErrPx > LOCK_EPSILON_PX) fails.push(`${k}: the drawing sits ${s.lockErrPx.toFixed(3)} px off the imagery (epsilon ${LOCK_EPSILON_PX} px)`);
}
if (r1c > PAN_EPSILON_PX) fails.push(`a pure-pan round trip moved the map centre ${r1c.toFixed(4)} px (${(r1c * ftPerPx).toFixed(2)} ft) — a whole-pixel gesture must return EXACTLY`);
if (r1p.worstPx > PAN_EPSILON_PX) fails.push(`a pure-pan round trip moved the drawing ${r1p.worstPx.toFixed(4)} px (${(r1p.worstPx * ftPerPx).toFixed(2)} ft) off the imagery`);
if (!r1p.matched) fails.push("no drawn element could be re-anchored by geometry signature — the position half of this gate did not actually measure anything");
if (Math.abs(end.zoom - start.zoom) > 1e-9) fails.push("zoom did not restore over the round trip");
if (end.drawn < start.drawn) fails.push(`culling did not restore the drawing (${start.drawn} → ${end.drawn})`);

/* ── the live session's own excursion, replayed ───────────────────────────────────────────
 * Four 300 px drags out, settle, four back, twice over — the exact shape that produced the
 * V478 reading. Repeating it twice is what separates a bounded residual from an accumulating
 * one, which was the whole point of criterion (b). */
console.log(`\nreplay    : the live harness — 4 x 300 px out, settle, 4 back, twice`);
const rep0 = await read();
const trips = [];
for (let t = 0; t < 2; t++) {
  for (let i = 0; i < 4; i++) if (!(await pan(300))) break;
  await page.waitForTimeout(600);
  for (let i = 0; i < 4; i++) if (!(await pan(-300))) break;
  await page.waitForTimeout(600);
  const s = await read();
  const c = centreReturnPx(rep0, s), p = probeReturn(rep0, s);
  trips.push({ c, p });
  console.log(`  trip ${t + 1}   : centre ${c.toFixed(4)} px (${(c * ftPerPx).toFixed(3)} ft) · drawing ${p.worstPx.toFixed(4)} px (${(p.worstPx * ftPerPx).toFixed(3)} ft) off, ${p.matched} matched${p.stale ? ` (${p.stale} stale sig)` : ""}`);
}
for (const [i, t] of trips.entries()) {
  if (t.c > PAN_EPSILON_PX) fails.push(`replay trip ${i + 1}: map centre came back ${t.c.toFixed(4)} px off — a whole-pixel pan excursion must be lossless`);
  if (t.p.worstPx > PAN_EPSILON_PX) fails.push(`replay trip ${i + 1}: the drawing came back ${t.p.worstPx.toFixed(4)} px off the imagery`);
}
if (trips.length === 2 && trips[1].p.worstPx > trips[0].p.worstPx + PAN_EPSILON_PX) {
  fails.push(`the residual ACCUMULATES: ${trips[0].p.worstPx.toFixed(4)} px after one round trip, ${trips[1].p.worstPx.toFixed(4)} px after two`);
}

/* ── the zoom half ────────────────────────────────────────────────────────────────────────
 * Zoom commits are the ONLY thing that moves the registration (see the header). A zoom out
 * and back must leave the drawing on the imagery within the committed epsilon, and must not
 * drift further with each repetition — a bounded re-snap is fine, a growing one is the
 * original defect coming back. */
console.log(`\nzoom trips: wheel out and back, three times — the only path that re-snaps the basemap`);
const z0 = await read();
let worstZoomLock = z0.lockErrPx, worstZoomReturn = 0;
for (let t = 0; t < 3; t++) {
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(30); }
  await page.waitForTimeout(700);
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(30); }
  await page.waitForTimeout(900);
  const s = await read();
  const ret = centreReturnPx(z0, s);
  worstZoomLock = Math.max(worstZoomLock, s.lockErrPx);
  worstZoomReturn = Math.max(worstZoomReturn, ret);
  console.log(`  trip ${t + 1}   : drawing-vs-imagery ${s.lockErrPx.toFixed(3)} px · centre returned ${ret.toFixed(3)} px (${(ret * ftPerPx).toFixed(2)} ft)`);
  if (s.lockErrPx > LOCK_EPSILON_PX) fails.push(`zoom trip ${t + 1}: the drawing sits ${s.lockErrPx.toFixed(3)} px off the imagery (epsilon ${LOCK_EPSILON_PX} px)`);
  if (ret > LOCK_EPSILON_PX) fails.push(`zoom trip ${t + 1}: an out-and-back zoom left the view ${ret.toFixed(3)} px (${(ret * ftPerPx).toFixed(2)} ft) from where it started (epsilon ${LOCK_EPSILON_PX} px)`);
}
console.log(`  worst    : lock ${worstZoomLock.toFixed(3)} px · return ${worstZoomReturn.toFixed(3)} px — both must stay ≤ ${LOCK_EPSILON_PX} px, and must not grow with repetition`);

console.log(`\nerrors    : ${errors.length ? errors.join(" | ") : "none"}`);
if (errors.length) fails.push(`page errors: ${errors.join(" | ")}`);

console.log(fails.length ? "\nFAIL\n - " + fails.join("\n - ") : "\nPASS — the basemap stayed at the drawing's scale AND its position throughout: a pure-pan round trip returned exactly, and the zoom re-snap stayed inside the committed one-pixel bound.");
await browser.close();
process.exit(fails.length ? 1 : 0);
