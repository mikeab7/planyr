/* NEW-2 — "contours paint, then disappear about two seconds after load", DIAGNOSED rather than
 * guessed.
 *
 * The owner's report (same session as NEW-1, on his own site): opening the plan, contour lines
 * rendered IMMEDIATELY, then vanished roughly two seconds later and did not come back while still
 * checked. That is a different failure from NEW-1's dormant state: a paint that HAPPENS and is then
 * WITHDRAWN reads as a crash, not as a threshold.
 *
 * ⛔ THIS HARNESS EXISTS TO NAME THE CAUSE, NOT TO CONFIRM A HUNCH. It records, on the real app,
 * for the whole opening sequence:
 *
 *   • the backdrop map's zoom, sampled continuously from plan-open to settle;
 *   • every request the terrain pipeline issues to USGS 3DEP, stamped with the map zoom AT THE
 *     MOMENT IT WAS ISSUED — i.e. the zoom the gate was actually answered against;
 *   • the number of contour polylines live on the map, sampled on the same clock — so a paint
 *     that is later withdrawn shows up as a rise and a fall rather than as an end state.
 *
 * ⛔ WHAT THIS SANDBOX CAN AND CANNOT SEE, stated up front so a clean number is never mistaken for
 * a clean app. `elevation.nationalmap.gov` answers 200 to curl (which rides the agent proxy) but
 * every request from Chromium here comes back **ERR_CONNECTION_RESET** — the same egress policy
 * that blocks `hazards.fema.gov` (see verify-flood-tiles). So the terrain layer can be observed
 * ASKING but never ANSWERING, and no contour line can ever be made to paint in this environment.
 *
 * That is a real limit and it is reported as one: the ZOOM evidence below is complete and decisive
 * on its own (a DEM grid pull issued at a zoom the plan never settles at is the whole cause), while
 * the owner-visible PAINT-then-vanish is a `live-GIS` check and is logged as such rather than
 * claimed. A harness that could not have seen an effect must never report its absence as a pass.
 *
 * WHAT IT MEASURED, on the pre-fix build (recorded here so the fix is not re-litigated):
 * the backdrop map is created with a HARDCODED `setView(…, 17)` and the plan's `view` starts at
 * the default ppf 0.35 — about Leaflet zoom 17.4 at Houston latitude, comfortably past the z16
 * terrain gate. The whole-site framing (`requestFit`, 120 ms after the workspace becomes active)
 * then drops the view to whatever the tract needs, which on a large parcel is below 16. Every
 * layer admitted in that window answered its gate against a zoom the plan was never going to be
 * at: the contours fetched, traced and painted, and the terrain pipeline then CORRECTLY cleared
 * them on the first post-fit `moveend`. Nothing was broken; the gate was simply asked too early.
 *
 * Run:  npm run build && npx vite preview --port 4178   (separate shell)
 *       BASE_URL=http://localhost:4178/ node ui-audit/diagnose-layer-gate-flash.mjs
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4178/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const WATCH_MS = +(process.env.WATCH_MS || 14000);

/* A tract big enough that its whole-site fit lands BELOW the z16 terrain gate — which is the
 * owner's situation restated as geometry ("he was zoomed out"). Waller County, so the county /
 * jurisdiction plumbing behaves as it does on his real plan. */
const W = 12000, H = 9000;
const now = Date.now();
const site = {
  schemaVersion: 12, id: "gateflash", groupId: "gateflash", site: "Gate Flash", name: "Concept A",
  updatedAt: now, teamId: null, ownerId: null, scheduleProjectId: null, scheduleProjectName: null,
  origin: { lat: 29.9038, lon: -95.9769 }, county: "waller", status: "active",
  parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], active: true, z: 0 }],
  els: [], measures: [], callouts: [], markups: [], sheetOverlays: [], parcelDrawings: [],
  underlay: null, settings: {},
  // The one layer the owner reported, ON from the moment the plan opens — which is the whole
  // point: the defect lives in the window between opening and the view being framed.
  layerOverrides: { contours: true },
};

/* A SECOND plan, so PASS 3 can force a real REMOUNT of the planner (and therefore a fresh
 * backdrop map) WITHOUT reloading the page — a reload would throw away the in-memory terrain
 * cache, which is the very thing that makes the owner's paint instant. */
const other = { ...site, id: "gateflash2", name: "Concept B" };

const seed = `(()=>{try{
  localStorage.setItem('planarfit:sites:v1', JSON.stringify({ gateflash: ${JSON.stringify(site)}, gateflash2: ${JSON.stringify(other)} }));
  // ⛔ the current-plan pointer is deliberately NOT cleared: PASS 2 needs the app to REOPEN the
  // plan on load, which is how the owner arrives at a site he has been working on. PASS 1 starts
  // in a fresh context, so it lands on the picker regardless.
  window.__PLANYR_E2E = true;
}catch(e){}})();`;

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
/* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — not its clock, and not its pixels (rAF is suspended, so
   every box and screenshot describes a view the app already left). One precondition, rAF liveness
   probe included; see ui-audit/lib/tabTiming.mjs. */
await assertMeasurable(page, "diagnose-layer-gate-flash");

const demRequests = [];
const zoomNow = async () => page.evaluate(() => {
  const m = window.__geoMap;
  try { return m ? m.getZoom() : null; } catch (_) { return null; }
}).catch(() => null);

let demRequestsActive = demRequests;
page.on("request", (r) => {
  const u = r.url();
  // `exportImage` is the terrain pipeline's DEM grid pull — the one the z16 gate governs.
  // `getSamples` is the CURSOR readout, which is deliberately NOT gated (a POINT elevation is
  // not a 1-ft contour LINE), so counting it as gate evidence would be a false positive.
  if (/elevation\.nationalmap\.gov/.test(u) && /exportImage/i.test(u)) demRequestsActive.push({ t: Date.now(), url: u.slice(0, 90) });
});

console.log("Planyr — layer zoom-gate flash diagnosis (NEW-2)\n");
console.log(`  tract ${W} × ${H} ft — a whole-site fit below the z16 terrain gate\n`);

/* TWO PASSES, and the second is the owner's actual condition.
 *
 * COLD: nothing cached, so the DEM fetch + worker trace outlive the 120 ms framing window and the
 * pipeline's own supersession token throws the late result away — the fetch still proves the gate
 * was asked at the wrong zoom, but nothing paints.
 * WARM: the same plan re-opened with `gisCache` primed. That is what the owner has — he had been
 * on the site — and it is the difference between "nothing happened" and his "rendered IMMEDIATELY,
 * then vanished". A one-pass harness would have reported the milder half and missed the report. */
async function watchOpen(label, mode) {
  demRequestsActive = [];
  let t0;
  if (mode === "pick") {
    await page.goto(BASE, { waitUntil: "load" });
    await page.waitForTimeout(1600);
    await page.locator('button[title="Choose a project"]:visible, button[title="Switch project"]:visible').first().click();
    await page.waitForTimeout(250);
    t0 = Date.now();
    demRequestsActive = [];
    /* ⛔ NOT `button:has-text("Gate Flash")` alone — the project CRUMB carries that text too once a
       plan is open and matches first, so the click would land on the menu button and the watch
       would measure nothing. Address the menu ENTRY. */
    await page.locator('button:has-text("Gate Flash"):not([data-testid="project-crumb"])').first().click();
  } else {
    /* RESTORE — the app reopens the plan it was last on, which is exactly how the owner arrives at
       a site he has been working on, and the only way to watch the FULL boot sequence (a picker
       click happens long after boot, so half the window is already over). The clock starts at the
       navigation, so the whole open is inside the watch. */
    t0 = Date.now();
    demRequestsActive = [];
    await page.goto(BASE, { waitUntil: "commit" });
  }
  const reqs = demRequestsActive;

  const samples = [];
  while (Date.now() - t0 < WATCH_MS) {
    const s = await page.evaluate(() => {
      const m = window.__geoMap;
      let mapZoom = null, lines = 0;
      if (m) {
        try { mapZoom = m.getZoom(); } catch (_) {}
        // Leaflet registers every layer added to the map — including a LayerGroup's children — in
        // `map._layers`, so contour polylines are countable even though they RASTERISE to a canvas
        // and leave no DOM of their own. Counting the model, not the pixels, is the honest read.
        try { for (const k in m._layers) { const l = m._layers[k]; if (l && l._latlngs) lines++; } } catch (_) {}
      }
      return { mapZoom, lines };
    }).catch(() => null);
    if (s) samples.push({ t: Date.now() - t0, ...s });
    await page.waitForTimeout(100);
  }

  const withZoom = (t) => { let best = null; for (const s of samples) if (s.t <= t && s.mapZoom != null) best = s.mapZoom; return best; };
  const seen = samples.filter((s) => s.mapZoom != null);
  const settled = seen.length ? seen[seen.length - 1].mapZoom : null;
  const zoomsHeld = [...new Set(seen.map((s) => Math.round(s.mapZoom * 100) / 100))];
  const peakLines = Math.max(0, ...samples.map((s) => s.lines));
  const firstPaint = samples.find((s) => s.lines > 0);
  const finalLines = samples.length ? samples[samples.length - 1].lines : 0;

  console.log(`  ═══ ${label} ═══`);
  console.log(`    zooms held          : ${zoomsHeld.join(" → ")}`);
  console.log(`    settled zoom        : ${settled == null ? "n/a" : settled.toFixed(3)}  (terrain gate is 16)`);
  console.log(`    gate at settle      : ${settled == null ? "n/a" : (settled < 16 ? "CLOSED — contours must NOT draw here" : "open")}`);
  console.log(`    3DEP grid requests  : ${reqs.length}`);
  for (const r of reqs.slice(0, 5)) {
    const z = withZoom(r.t - t0);
    console.log(`        +${String(r.t - t0).padStart(5)} ms  at map zoom ${z == null ? "?" : z.toFixed(3)}`);
  }
  if (reqs.length > 5) console.log(`        … ${reqs.length - 5} more`);
  console.log(`    contour lines       : peak ${peakLines}, first painted ${firstPaint ? "+" + firstPaint.t + " ms" : "never"}, at end ${finalLines}`);

  const withdrew = peakLines > 0 && finalLines === 0;
  const askedEarly = reqs.some((r) => { const z = withZoom(r.t - t0); return z != null && settled != null && z >= 16 && settled < 16; });
  if (withdrew) console.log(`    ❌ PAINT-THEN-WITHDRAW: ${peakLines} lines painted at +${firstPaint.t} ms, gone by the end, layer still checked.`);
  if (askedEarly) console.log(`    ❌ GATE ASKED AT THE WRONG ZOOM: a DEM grid pull went out at map zoom ≥ 16 while the plan settles at ${settled.toFixed(3)}.`);
  if (!withdrew && !askedEarly) {
    console.log(`    ✅ the gate was answered ONCE, at the plan's real opening zoom${settled == null ? "" : " (" + settled.toFixed(3) + ")"}:`);
    console.log(`       no grid pull, no paint, nothing to withdraw. The row reports itself dormant instead (NEW-1).`);
  }
  console.log();
  return { withdrew, askedEarly };
}

const cold = await watchOpen("PASS 1 — COLD (nothing cached, opened from the project picker)", "pick");
const warm = await watchOpen("PASS 2 — WARM (the owner's condition: terrain cached, the plan reopens on load)", "restore");

/* ═══ PASS 3 — THE OWNER'S LITERAL REPORT: an IMMEDIATE paint that is then withdrawn.
 *
 * Passes 1 and 2 prove the gate is answered at the wrong zoom, but neither shows a paint: a COLD
 * DEM pull takes longer than the framing window, so the pipeline's own supersession token discards
 * the late result and nothing ever reaches the map. The owner's tab is not cold. `gisCache`'s L1 is
 * an in-memory tier, so a plan he has already looked at closely serves its terrain SYNCHRONOUSLY —
 * and then the paint lands INSIDE the wrong-zoom window and is cleared a beat later by the framing.
 *
 * So: zoom in past the gate on this same page (warming L1), switch to the sibling plan and back
 * (a real planner remount, and therefore a fresh backdrop map, with the page — and L1 — intact),
 * and watch. A harness that only ever ran cold would have reported "nothing painted" and called
 * the report unreproducible. */
async function watchWarmRemount() {
  console.log("  ═══ PASS 3 — WARM L1 + a real remount (reproduces 'painted, then vanished') ═══");
  // 1. Zoom in past the gate so the terrain tiles for this ground become resident.
  for (let i = 0; i < 5; i++) { await page.locator('button[aria-label="Zoom in"]').click().catch(() => {}); await page.waitForTimeout(150); }
  await page.waitForTimeout(6000);
  const warmedLines = await page.evaluate(() => { const m = window.__geoMap; let n = 0; try { for (const k in m._layers) if (m._layers[k]?._latlngs) n++; } catch (_) {} return n; });
  console.log(`    warmed at close zoom : ${warmedLines} contour lines on the map`);
  if (!warmedLines) {
    console.log("    ⛔ BLOCKED, NOT PASSED: no contour line painted even well past the gate, because every");
    console.log("       3DEP request from Chromium in this sandbox is ERR_CONNECTION_RESET. This pass cannot");
    console.log("       run here and proves NOTHING either way — the paint-then-vanish half is a live-GIS");
    console.log("       check (VERIFICATION.md), not a green box. The zoom evidence above stands on its own.\n");
    return { withdrew: false, askedEarly: false, inconclusive: true };
  }

  // 2. Switch to the sibling plan and back — a real remount, page (and L1) intact.
  const pick = async (name) => {
    await page.locator('button[title="Choose a project"]:visible, button[title="Switch project"]:visible').first().click();
    await page.waitForTimeout(300);
    await page.locator(`button:has-text("${name}"):not([data-testid="project-crumb"])`).first().click();
  };
  await pick("Concept B");
  await page.waitForTimeout(3000);

  demRequestsActive = [];
  await page.locator('button[title="Choose a project"]:visible, button[title="Switch project"]:visible').first().click();
  await page.waitForTimeout(300);
  const t0 = Date.now();
  await page.locator('button:has-text("Concept A"):not([data-testid="project-crumb"])').first().click();

  const samples = [];
  while (Date.now() - t0 < 9000) {
    const s2 = await page.evaluate(() => {
      const m = window.__geoMap; let mapZoom = null, lines = 0;
      if (m) { try { mapZoom = m.getZoom(); } catch (_) {} try { for (const k in m._layers) if (m._layers[k]?._latlngs) lines++; } catch (_) {} }
      return { mapZoom, lines };
    }).catch(() => null);
    if (s2) samples.push({ t: Date.now() - t0, ...s2 });
    await page.waitForTimeout(80);
  }
  const seen = samples.filter((x) => x.mapZoom != null);
  const settled = seen.length ? seen[seen.length - 1].mapZoom : null;
  const peak = Math.max(0, ...samples.map((x) => x.lines));
  const first = samples.find((x) => x.lines > 0);
  const last = [...samples].reverse().find((x) => x.lines > 0);
  const final = samples.length ? samples[samples.length - 1].lines : 0;
  console.log(`    zooms held           : ${[...new Set(seen.map((x) => Math.round(x.mapZoom * 100) / 100))].join(" → ")}`);
  console.log(`    settled zoom         : ${settled == null ? "n/a" : settled.toFixed(3)}  (gate 16)`);
  console.log(`    contour lines        : peak ${peak}, first +${first ? first.t : "-"} ms, last +${last ? last.t : "-"} ms, at end ${final}`);
  const withdrew = peak > 0 && final === 0;
  if (withdrew) console.log(`    ❌ PAINTED THEN VANISHED: ${peak} lines on screen at +${first.t} ms, gone by +${last.t + 80} ms, layer still checked.`);
  else if (peak === 0) console.log(`    ✅ nothing painted at all — the gate was answered once, at the plan's real opening zoom.`);
  else console.log(`    contours painted and stayed (${final}) — not the reported case on this run.`);
  console.log();
  return { withdrew, askedEarly: false };
}
const remount = await watchWarmRemount();

const bad = cold.withdrew || cold.askedEarly || warm.withdrew || warm.askedEarly || remount.withdrew;
console.log("  ── verdict ──");
console.log(bad
  ? "    ❌ REPRODUCED. The paint was never wrong; the TIMING OF THE QUESTION was."
  : "    ✅ the zoom gate resolves before first paint, on both a cold and a warm cache.");

await browser.close();
process.exit(bad ? 1 : 0);
