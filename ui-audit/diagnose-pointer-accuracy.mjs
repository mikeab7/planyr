/* NEW-2 — is the point I place where I clicked? Measured against an INDEPENDENT ground truth.
 *
 * THE REPORT (owner, 2026-07-29): "sometimes when I place points — for a measurement or
 * drawing something — it seems like my pointer is off … five, ten, fifteen feet off from
 * where I'm actually clicking." Measured live on his machine the same night, against the
 * basemap tile grid: about ONE CSS PIXEL of constant offset, repeatable to a hundredth of a
 * foot, pointing a different way at each zoom. One pixel is a couple of feet zoomed in and
 * ten-plus feet at the overview zoom real layout happens at — so "sub-pixel" is the wrong
 * frame for it, and this harness exists so nobody has to argue about that again.
 *
 * ── THE GROUND TRUTH (why this harness can be believed) ──────────────────────────────────
 * Every basemap tile carries its own z/x/y in its URL, and its rendered rectangle is
 * readable from the DOM. Web Mercator says exactly which lat/lng any point inside that
 * rectangle is. So the truth for a screen pixel is computed from the TILE GRID — not from
 * Leaflet's projection helpers and not from the app's own conversion, either of which would
 * make the measurement circular. Basemap registration error (is Esri's imagery itself
 * correctly georeferenced?) does not enter: we are asking whether the app agrees with the
 * grid it is drawing on, which is the only frame a user's click can mean.
 *
 * ── WHAT IT MEASURES, BOTH DIRECTIONS ────────────────────────────────────────────────────
 *  1. the READOUT path — move the pointer to a screen pixel, read the lat/lng the app
 *     reports for it (raw, via the E2E probe: at the accuracy asserted here the chip's
 *     rounded decimals are the same order as the error).
 *  2. the PLACEMENT path — actually draw a Length measurement with two real clicks and check
 *     where its first vertex LANDED. This is the owner's actual complaint, and it was never
 *     measured before: the readout being right does not prove a placed point is.
 * Both are asserted at zoom 16 / 17 / 18, at device pixel ratio 1, 2 and 2.15 (his machine
 * runs 2.15 — a fix verified only at 1 or 2 will look correct and still be wrong for him),
 * plus a deliberately FRACTIONAL canvas width, which is the state a fractional ratio puts
 * the layout in and the state that exposes the container-centre half of the defect.
 *
 * The residual is reported in CSS pixels AND in feet at each zoom, so the overview-zoom case
 * is explicit rather than something the reader has to convert in their head.
 *
 * TEETH: each case also prints the compensation the app APPLIED (`data-reg-dx/dy` on the
 * canvas). That number IS the error that would be left without the fix — so a run
 * simultaneously shows the residual is gone and that there was something real to remove.
 *
 * Run:  npm run build && npx vite preview --port 4173 &   then   node ui-audit/diagnose-pointer-accuracy.mjs
 *       BASE_URL=… to point elsewhere. Exit code 1 on any failing criterion.
 */
import { chromium } from "playwright";
import { lngLatToFeet, zoomToPpf, ftPerDeg } from "../src/workspaces/site-planner/lib/mapLock.js";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || undefined;

/* THE COMMITTED CRITERION — a quarter of a CSS pixel, the target the owner set. Deliberately
 * in pixels: the defect is a pixel-domain quantisation, so a feet threshold would be
 * meaningless at one zoom and vacuous at another. The feet equivalent is printed alongside
 * every reading so the number stays legible. */
const RESIDUAL_MAX_PX = 0.25;

// The Tsakiris tract (Waller County) — the coordinates of the report.
const LAT0 = 29.77938, LON0 = -95.89503;
const SITE = {
  schemaVersion: 12, id: "pointer-accuracy", groupId: "pointer-accuracy",
  site: "Pointer Accuracy", name: "Pointer Accuracy",
  updatedAt: 1783000000000, teamId: null, ownerId: null,
  scheduleProjectId: null, scheduleProjectName: null,
  origin: { lat: LAT0, lon: LON0 }, county: "waller", status: "active",
  parcels: [{ id: "p1", points: [{ x: -660, y: -660 }, { x: 660, y: -660 }, { x: 660, y: 660 }, { x: -660, y: 660 }], active: true, z: 0 }],
  underlay: null, sheetOverlays: [], parcelDrawings: [], settings: { snap: false }, els: [],
  measures: [], callouts: [], markups: [],
};
const seed = `(() => { try {
  window.__PLANYR_E2E = true;
  localStorage.setItem('planarfit:sites:v1', ${JSON.stringify(JSON.stringify({ [SITE.id]: SITE }))});
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(SITE.id)});
} catch (e) {} })();`;

/* ── Web Mercator, from the tile grid ──────────────────────────────────────────────────── */
const tileToLatLng = (z, tx, ty) => {
  const n = Math.pow(2, z);
  const lng = (tx / n) * 360 - 180;
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n)));
  return { lat, lng };
};

/* The tile under a client point, chosen by DEEPEST zoom: the coarse instant-coverage backfill
 * layer sits underneath the sharp one at a much lower z, and reading truth off that would be
 * correct but needlessly imprecise. */
const truthAt = (page, px, py) => page.evaluate(([x, y]) => {
  let best = null;
  for (const t of document.querySelectorAll("img.leaflet-tile")) {
    const m = /\/tile\/(\d+)\/(\d+)\/(\d+)/.exec(t.src || "");
    if (!m) continue;
    const r = t.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) continue;
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
    const z = +m[1];
    if (!best || z > best.z) best = { z, ty: +m[2], tx: +m[3], left: r.left, top: r.top, w: r.width, h: r.height };
  }
  return best;
}, [px, py]);

const truthLatLng = (t, px, py) => tileToLatLng(
  t.z,
  t.tx + (px - t.left) / t.w,
  t.ty + (py - t.top) / t.h,
);

/* ── driving the app ───────────────────────────────────────────────────────────────────── */
async function openPlanner(browser, { dpr, fractional }) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dpr });
  await ctx.addInitScript(seed);
  // The aerial hosts are egress-blocked in the sandbox, and we do not need their PIXELS —
  // only the tile ELEMENTS' URLs and screen rects, which Leaflet sets either way. Fulfilling
  // with a 1×1 transparent PNG keeps every tile a normal loaded tile (no error-tile churn)
  // while the grid geometry stays exactly what production would lay down. Everything else
  // external is aborted so a blocked host can't stall the run.
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");
  await ctx.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.startsWith(BASE) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    if (/\/tile\/\d+\/\d+\/\d+/.test(url)) return route.fulfill({ status: 200, contentType: "image/png", body: PNG });
    return route.abort();
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForSelector("svg[role=application]", { timeout: 30000 });
  if (fractional) {
    // A fractional canvas width is what a fractional device pixel ratio produces in real
    // layout, and it is the state that exposes the container-centre half of the defect (the
    // drawing halves a float width; Leaflet halves the integer clientWidth). Forced here
    // rather than hoped for, because Playwright viewports are whole numbers.
    await page.evaluate(() => {
      const s = document.querySelector("svg[role=application]");
      if (s && s.parentElement) s.parentElement.style.marginRight = "0.37px";
    });
  }
  await page.waitForTimeout(2500);
  return { ctx, page, errors };
}

async function setZoom(page, zoom) {
  const ppf = zoomToPpf(zoom, LAT0);
  await page.evaluate((p) => window.__plannerView.centerOn(0, 0, p), ppf);
  await page.waitForTimeout(700); // past the 160ms basemap commit + the tile pass
  return ppf;
}

const regApplied = (page) => page.evaluate(() => {
  const s = document.querySelector("svg[role=application]");
  return { dx: +(s?.getAttribute("data-reg-dx") || 0), dy: +(s?.getAttribute("data-reg-dy") || 0) };
});

/* Feet offset (east, north) of `got` relative to `want`, in the site's own frame — the frame
 * every drawn coordinate lives in, so this is the error in the units the owner works in. */
const feetDelta = (got, want) => {
  const a = lngLatToFeet(got.lng, got.lat, LON0, LAT0);
  const b = lngLatToFeet(want.lng, want.lat, LON0, LAT0);
  return { east: a.x - b.x, north: -(a.y - b.y) };
};

async function measureReadout(page, box, ppf) {
  // Probe points spread across the canvas: a constant offset shows up everywhere, while a
  // scale error would grow away from the centre — so sampling several points also tells the
  // two apart instead of assuming.
  const pts = [
    { x: Math.round(box.x + box.width * 0.5), y: Math.round(box.y + box.height * 0.5) },
    { x: Math.round(box.x + box.width * 0.28), y: Math.round(box.y + box.height * 0.33) },
    { x: Math.round(box.x + box.width * 0.72), y: Math.round(box.y + box.height * 0.66) },
    { x: Math.round(box.x + box.width * 0.66), y: Math.round(box.y + box.height * 0.25) },
  ];
  const out = [];
  for (const p of pts) {
    const t = await truthAt(page, p.x, p.y);
    if (!t) continue;
    await page.mouse.move(p.x - 3, p.y - 3);
    await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(120);
    const got = await page.evaluate(() => window.__plannerView.cursor());
    if (!got) continue;
    const d = feetDelta({ lat: got.lat, lng: got.lng }, truthLatLng(t, p.x, p.y));
    out.push({ at: p, tileZ: t.z, ft: d, px: { x: d.east * ppf, y: d.north * ppf } });
  }
  return out;
}

async function measurePlacement(page, box, ppf) {
  // A real two-click Length measurement — the owner's actual gesture. Its first vertex is the
  // placed point; where it LANDED (in feet, the frame it is stored in) versus the tile-grid
  // truth for the pixel that was clicked is the whole question.
  const a = { x: Math.round(box.x + box.width * 0.42), y: Math.round(box.y + box.height * 0.58) };
  const b = { x: a.x + 180, y: a.y - 60 };
  const truth = await truthAt(page, a.x, a.y);
  if (!truth) return null;
  const before = await page.evaluate(() => window.__plannerView.measures().length);
  await page.getByRole("button", { name: "Measure modes" }).click();
  await page.getByRole("button", { name: "Length", exact: true }).click();
  await page.mouse.click(a.x, a.y);
  await page.mouse.click(b.x, b.y);
  await page.waitForFunction((n) => window.__plannerView.measures().length > n, before, { timeout: 5000 });
  const m = await page.evaluate(() => window.__plannerView.measures().slice(-1)[0]);
  const pt = (m && (m.a || (m.pts && m.pts[0]))) || null;
  if (!pt) return { error: `measure shape not understood: ${JSON.stringify(m)}` };
  // Where the placed vertex ACTUALLY is, in the site frame, vs where the clicked pixel is.
  const want = lngLatToFeet(truthLatLng(truth, a.x, a.y).lng, truthLatLng(truth, a.x, a.y).lat, LON0, LAT0);
  const ft = { east: pt.x - want.x, north: -(pt.y - want.y) };
  // Put the canvas back to Select and drop the measurement so the next zoom starts clean.
  await page.keyboard.press("Escape");
  return { at: a, ft, px: { x: ft.east * ppf, y: ft.north * ppf } };
}

/* ── the run ───────────────────────────────────────────────────────────────────────────── */
const f3 = (n) => (Math.round(n * 1000) / 1000).toFixed(3);
const cases = [
  { dpr: 1, fractional: false },
  { dpr: 2, fractional: false },
  { dpr: 2.15, fractional: false },
  { dpr: 2.15, fractional: true },
];
const ZOOMS = [16, 17, 18];

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
let failures = 0, checks = 0;
const lines = [];

for (const c of cases) {
  const label = `dpr ${c.dpr}${c.fractional ? " · fractional canvas width" : ""}`;
  const { ctx, page, errors } = await openPlanner(browser, c);
  lines.push(`\n── ${label} ${"─".repeat(Math.max(0, 62 - label.length))}`);
  const reported = await page.evaluate(() => window.devicePixelRatio);
  lines.push(`   devicePixelRatio reported by the page: ${reported}`);
  for (const zoom of ZOOMS) {
    const ppf = await setZoom(page, zoom);
    const ftPerPx = 1 / ppf;
    const box = await page.locator("svg[role=application]").boundingBox();
    const reg = await regApplied(page);
    const readout = await measureReadout(page, box, ppf);
    const placed = await measurePlacement(page, box, ppf);
    lines.push(`   zoom ${zoom}  (1 CSS px = ${f3(ftPerPx)} ft)   compensation applied: dx ${f3(reg.dx)} px · dy ${f3(reg.dy)} px` +
      `  → without the fix the readings below would sit ${f3(Math.hypot(reg.dx, reg.dy))} px = ${f3(Math.hypot(reg.dx, reg.dy) * ftPerPx)} ft out`);
    if (!readout.length) { failures++; lines.push("     READOUT: no tile grid under any probe — cannot measure (FAIL)"); }
    for (const r of readout) {
      checks++;
      const worst = Math.max(Math.abs(r.px.x), Math.abs(r.px.y));
      const ok = worst <= RESIDUAL_MAX_PX;
      if (!ok) failures++;
      lines.push(`     readout  @${r.at.x},${r.at.y}  east ${f3(r.ft.east)} ft · north ${f3(r.ft.north)} ft` +
        `  = ${f3(worst)} px   ${ok ? "ok" : "FAIL"}`);
    }
    if (!placed || placed.error) { failures++; lines.push(`     PLACED POINT: ${placed ? placed.error : "no tile grid under the click"} (FAIL)`); }
    else {
      checks++;
      const worst = Math.max(Math.abs(placed.px.x), Math.abs(placed.px.y));
      const ok = worst <= RESIDUAL_MAX_PX;
      if (!ok) failures++;
      lines.push(`     placed   @${placed.at.x},${placed.at.y}  east ${f3(placed.ft.east)} ft · north ${f3(placed.ft.north)} ft` +
        `  = ${f3(worst)} px   ${ok ? "ok" : "FAIL"}`);
    }
  }
  if (errors.length) { failures++; lines.push(`   page errors: ${errors.slice(0, 3).join(" | ")} (FAIL)`); }
  await ctx.close();
}

await browser.close();

console.log("POINTER ACCURACY — app answer vs basemap tile-grid truth");
console.log(`criterion: every residual ≤ ${RESIDUAL_MAX_PX} CSS px, at every zoom × device pixel ratio`);
console.log(`site: Tsakiris origin ${LAT0}, ${LON0} · 1° of the site frame = ${Math.round(ftPerDeg(LAT0))} ft`);
console.log(lines.join("\n"));
console.log(`\n${failures ? "✗ FAIL" : "✓ PASS"} — ${checks - failures} of ${checks} readings within ${RESIDUAL_MAX_PX} px`);
process.exit(failures ? 1 : 0);
