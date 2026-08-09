#!/usr/bin/env node
/* zoom-reraster-arms — WHAT DOES B749's 8192 px RE-RASTER COST, AND DOES IT EVEN FIRE? (NEW-1)
 *
 * ⛔ THIS INSTRUMENT FIXES NOTHING. The deliverable is a NUMBER per arm — and, before any number,
 * PROOF that the path ran at all.
 *
 * ── THE MISS IT ANSWERS ─────────────────────────────────────────────────────────────────────────
 * A PDF-backed sheet overlay does not stay on the raster it loaded with. Once on-screen
 * magnification passes ~1.5× the base raster's own pixels, `SitePlanner.jsx` re-renders that PDF
 * PAGE at a higher device scale — capped at an 8192 px long edge — on the MAIN THREAD, PNG-encodes
 * it, and swaps it in. The gate is `overlayDocs.has(id) || storageKey.endsWith(".pdf")`.
 *
 * The owner's real Bain overlay is page 1 of a PDF (`pdfBacked: true`, storage key tail
 * `…14mmzcgq.pdf`), 1728 × 2592 pt at opacity 0.55 and 1.5° of rotation, and BOTH of his Bain plans
 * carry the same file. So the path is live on his plans.
 *
 * And it has never run in any arm of any battery in this program, for a structural reason:
 * `raster-arms.mjs` PANS, `annotation-arms.mjs` PANS, `session-axes.mjs` PANS. A pan holds `ppf`
 * constant, so it cannot cross a magnification gate. Sixty-plus runs of null results, none of which
 * were about this.
 *
 * ── THE ARMS, one variable each (lib/planFixture.mjs `RERASTER_ARMS`) ───────────────────────────
 *   below          the stepped zoom, entirely UNDER the gate      ← the path must NOT fire
 *   across         the stepped zoom that CROSSES it               ← the path under test
 *   across-hidden  that sweep with the overlay hidden             ← removes the overlay entirely
 *   across-image   that sweep with an equivalent NON-PDF raster   ← isolates the PDF RE-RASTER from
 *                                                                   ordinary raster cost: identical
 *                                                                   pixels, opacity, rotation and
 *                                                                   footprint, only the PDF backing
 *                                                                   removed
 * On BOTH real Bain fixtures (`--plan bain,quiddity`), which share the one physical overlay.
 *
 * ── HOW THE PATH IS MADE REACHABLE, and why that is itself a finding ────────────────────────────
 * After a reload — which is every time the owner opens a saved plan — `overlayDocs` is empty and
 * the Tier-2 path's ONE source of bytes is `downloadOverlayBytes(storageKey)`, i.e. Supabase
 * Storage. `lib/planFixture.mjs`'s seeder never emitted a `storageKey` at all, so the gate was shut
 * in every arm ever run (see the `pdfStorage` note there). This harness opts in, and serves the
 * bytes from an intercepted route — a REAL, VALID PDF at his real page size (lib/sheetPdf.mjs),
 * synthetic linework, never his drawing.
 *
 * ⛔ THAT REQUIRES A BUILD WITH SUPABASE CONFIGURED. With no config the client returns null WITHOUT
 * ISSUING A REQUEST, the path dies silently, and the overlay stays on screen looking perfectly
 * correct — the exact "beautiful false null" this program keeps nearly shipping. The harness
 * therefore counts the storage fetches it served and FAULTS an arm that saw none. Build with:
 *
 *   VITE_SUPABASE_URL=https://fixture-storage.invalid VITE_SUPABASE_ANON_KEY=fixture-anon npm run build
 *   npx vite preview --port 4173 &
 *   xvfb-run -a --server-args="-screen 0 1600x1000x24" node ui-audit/zoom-reraster-arms.mjs --fake-tiles
 *
 * Nothing real is contacted: that host does not resolve and every request to it is fulfilled or
 * aborted by the route handler.
 *
 * ── WHAT IS MEASURED, AND SEPARATELY ────────────────────────────────────────────────────────────
 *   • re-raster COUNT and SIZE — from `URL.createObjectURL`, patched page-side. The count is the
 *     headline: a duration budget passes the moment a re-raster that should not happen merely gets
 *     cheaper.
 *   • MAIN-THREAD work — `Performance.getMetrics` (script + layout + style), reported explicitly on
 *     its own, because that metric could not tell Bain from Goose Creek at 5/10, p = 1.000, and a
 *     null there is not a null.
 *   • LONG TASKS — the p100 main-thread block. A 44-megapixel raster on the main thread is a freeze,
 *     and a freeze is what the owner actually feels; a mean frame time hides it.
 *   • PAINT / RASTER / DECODE / COMPOSITE / LAYERIZE — `lib/rasterCost.mjs`'s trace buckets, kept
 *     separated, so a compositing effect and a main-thread effect cannot be confused.
 *
 * ⚠ HEADED, ON A REAL X SERVER — a hidden tab starves rAF and the numbers become a measurement of
 * the tab's visibility (the B1086 trap).
 *
 * Never exits non-zero on a measurement. It DOES exit non-zero when an arm could not be
 * established — a re-raster that silently never fired is not a fast arm, it is a broken one.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fakeTilePng, parseTileUrl } from "./lib/fakeTile.mjs";
import { pngDataUrl, megapixels } from "./lib/synthRaster.mjs";
import { cachedRaster } from "./lib/fixtureSeeding.mjs";
import {
  fixtureCensus, fixtureSeed, rasterIdbPlan, idbPutInPage, fixtureStorageKey,
  specDecodedBytes, paintedRasters, RERASTER_ARMS, rerasterArmFixture, rerasterBudget,
} from "./lib/planFixture.mjs";
import { bucketTrace, median, decodeFault, noiseFloorPct } from "./lib/rasterCost.mjs";
import {
  rerasterFault, pdfDeliveryFault, rerasterPlan, rerasterCount, peakRasterBytes,
  measuredThresholdPpf, capPpf, magnificationAt, overlayBaseScale, rasterAtScale, rungsInBand,
  RERASTER_SETTLE_MS, MAX_RERASTER_DIM,
} from "./lib/rerasterProbe.mjs";
import { sheetPdfBytes } from "./lib/sheetPdf.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE_URL || "http://localhost:4173/").replace(/\/?$/, "/");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const num = (f, d) => { const v = Number(arg(f, NaN)); return Number.isFinite(v) ? v : d; };
const JSON_OUT = process.argv.includes("--json");
const FAKE_TILES = process.argv.includes("--fake-tiles");
const DPR = num("--dpr", 2.15);
const CPU = num("--cpu-throttle", 1);
const REPS = num("--reps", 3);
const STROKES = num("--strokes", 2000);
const CONTINUOUS = process.argv.includes("--continuous");
/* ⛔ `--assert` IS THE BROWSER HALF OF THE B749 GUARD; the CI-runnable half is
 * test/overlayRerasterCount.test.js. Neither substitutes for the other — the unit test proves the
 * ladder and the cache are transparent, but only a real browser driving a real wheel gesture can
 * see how many times the app ACTUALLY re-rendered the page. Three cost classes in this programme
 * have returned unnoticed, so the count is asserted, not admired. */
const ASSERT = process.argv.includes("--assert");
const ARMS = String(arg("--arms", Object.keys(RERASTER_ARMS).join(","))).split(",").map((s) => s.trim()).filter(Boolean);
const PLANS = String(arg("--plan", "bain,quiddity")).split(",").map((s) => s.trim()).filter(Boolean);
const CACHE = join(HERE, ".raster-cache");
const SITE_ID = "zoom-reraster-site";

/* The owner's two real Bain plans. They share ONE physical PDF overlay — same id, same page size,
 * same opacity, same 1.5° rotation — which is the whole force of running both: a difference between
 * them cannot be a difference in the overlay. */
const FIXTURES = {
  bain: JSON.parse(readFileSync(join(HERE, "fixtures", "bain-concept-original.json"), "utf8")),
  quiddity: JSON.parse(readFileSync(join(HERE, "fixtures", "bain-quiddity.json"), "utf8")),
};

/* The bytes served for the overlay's storage key. Generated once — the same PDF for every arm and
 * every rep, so a difference between arms cannot be a difference in the source document. */
const SHEET_PDF = sheetPdfBytes({ wPt: 1728, hPt: 2592, strokes: STROKES, seed: 749 });

/* ---- The gesture -------------------------------------------------------------------------------
 * ONE WHEEL NOTCH IS EXACTLY 1.12× (`SitePlanner.jsx`'s `onWheel`), and the effect keeps an existing
 * hi-res only while its scale is within 10% of the wanted one. 1.12 > 1.10, so **every single wheel
 * notch inside the un-capped band is a full re-raster.** That is not a hypothesis this harness
 * tests; it is arithmetic off the app's own two constants, and the harness measures what it costs.
 *
 * The steps DWELL past the effect's 260 ms settle debounce by default, and then wait for the raster
 * to actually land. That is the honest regime for the gesture the owner performs — a wheel notch,
 * a look, another notch — and it is the WORSE of the two regimes, because a continuous flick
 * collapses the whole sweep into one settle. `--continuous` measures that other regime instead, and
 * the report always says which one ran.
 */
const WHEEL_FACTOR = 1.12;
const SWEEPS = {
  /* Chosen against the MEASURED threshold, not a guessed one: `below` ends under it with a margin,
   * `across` starts under it and ends past the 8192 px cap, so the sweep covers the whole band in
   * which the wanted scale is still moving. `below` and `across` are the same number of notches, so
   * those two arms differ in zoom RANGE and in nothing else about the gesture.
   *
   * `dirs` is the notch sequence: −1 zooms in, +1 out. `outback` exists because a zoom sweep is out
   * AND BACK by definition — the old code revoked the hi-res the moment the view dropped below the
   * gate, so every return trip paid the whole raster again, and no single-direction sweep can see
   * that. */
  below: { startPpf: 0.30, dirs: Array(8).fill(-1) },
  across: { startPpf: 0.55, dirs: Array(8).fill(-1) },
  outback: { startPpf: 0.55, dirs: [...Array(6).fill(-1), ...Array(6).fill(1), ...Array(6).fill(-1)] },
};

const READ_VIEW_PPF = `(() => { const s = document.querySelector('[data-testid="planner-canvas"]');
  return s ? Number(s.getAttribute("data-view-ppf")) : null; })()`;

/* Read back every <image> the planner rendered and PROVE it decoded — `decodeFault`'s input. An
 * SVGImageElement has no `naturalWidth`/`complete`, so decoding is proven with `decode()` and the
 * intrinsic size is read out of the element's OWN bytes (the PNG IHDR). */
const READ_IMAGES = `(async () => {
  const svg = document.querySelector('[data-testid="planner-canvas"]');
  if (!svg) return [];
  const ihdr = (href) => {
    const i = String(href || "").indexOf("base64,");
    if (i < 0) return { w: 0, h: 0 };
    try {
      const b = atob(String(href).slice(i + 7, i + 7 + 64));
      const be = (o) => (b.charCodeAt(o) << 24 | b.charCodeAt(o + 1) << 16 | b.charCodeAt(o + 2) << 8 | b.charCodeAt(o + 3)) >>> 0;
      return { w: be(16), h: be(20) };
    } catch (_) { return { w: 0, h: 0 }; }
  };
  const out = [];
  for (const im of svg.querySelectorAll("image")) {
    const href = (im.href && im.href.baseVal) || im.getAttribute("href") || "";
    let decoded = false;
    try { await im.decode(); decoded = true; } catch (_) {}
    const d = ihdr(href);
    out.push({ decoded, intrinsicW: d.w, intrinsicH: d.h, blob: href.startsWith("blob:") });
  }
  return out;
})()`;

/* ---- PAGE-SIDE INSTRUMENT ----------------------------------------------------------------------
 * ⛔ WHY `URL.createObjectURL` AND NOT A SCREENSHOT OR A DOM WATCH. `rasterizePageHiRes` encodes the
 * hi-res canvas to a Blob and hands back an object URL; the app then swaps that URL onto the
 * <image> and revokes the previous one. Patching the mint is the one place that sees EVERY
 * re-raster — including one that was produced and then immediately revoked because the user zoomed
 * back out while it rendered (`rasterizePageHiRes`'s own bail path), which a DOM watch would miss
 * entirely and which costs exactly as much as one that lands.
 *
 * The blob's `size` is the encoded PNG length; its first 24 bytes carry the IHDR, so the RASTER'S
 * REAL PIXEL DIMENSIONS are read out of the bytes the app produced rather than restated from the
 * prediction. That is the same discipline `READ_IMAGES` applies to the DOM.
 */
function installProbe() {
  window.__rr = { blobs: [], revoked: 0, longTasks: [] };
  const origCreate = URL.createObjectURL.bind(URL);
  const origRevoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = function (obj) {
    const url = origCreate(obj);
    try {
      if (obj && typeof obj.size === "number" && /^image\//.test(obj.type || "")) {
        const rec = { url, bytes: obj.size, type: obj.type, t: performance.now(), w: 0, h: 0 };
        window.__rr.blobs.push(rec);
        obj.slice(0, 32).arrayBuffer().then((buf) => {
          const v = new DataView(buf);
          if (buf.byteLength >= 24) { rec.w = v.getUint32(16); rec.h = v.getUint32(20); }
        }).catch(() => {});
      }
    } catch (_) {}
    return url;
  };
  URL.revokeObjectURL = function (url) { try { window.__rr.revoked++; } catch (_) {} return origRevoke(url); };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__rr.longTasks.push({ t: e.startTime, ms: e.duration });
    }).observe({ entryTypes: ["longtask"] });
  } catch (_) {}
}

async function workCounters(cdp) {
  try {
    const m = await cdp.send("Performance.getMetrics");
    const g = {}; for (const { name, value } of m.metrics || []) g[name] = value;
    return {
      script: (g.ScriptDuration || 0) * 1000, layout: (g.LayoutDuration || 0) * 1000,
      recalc: (g.RecalcStyleDuration || 0) * 1000, task: (g.TaskDuration || 0) * 1000,
    };
  } catch (_) { return null; }
}

/* One wheel notch at the canvas centre. Dispatched one event per task through a MessageChannel — the
 * same pump every other zoom instrument here uses, because React 18 batches a whole task's worth of
 * setState and a burst dispatched in one task is ONE zoom, not N. */
const wheelNotch = (page, x, y, dir = -1) => page.evaluate(([delta, cx, cy]) => new Promise((done) => {
  const el = document.querySelector('[data-testid="planner-canvas"]');
  const ch = new MessageChannel();
  ch.port1.onmessage = () => {
    el.dispatchEvent(new WheelEvent("wheel", { deltaY: delta, clientX: cx, clientY: cy, bubbles: true, cancelable: true }));
    done();
  };
  ch.port2.postMessage(0);
}), [dir * 120, x, y]);

/* Dwell until the re-raster a notch may have started has actually LANDED.
 *
 * ⛔ QUIET IS NOT THE SAME AS DONE, and getting that wrong cost this harness a whole run. The first
 * version waited for the BLOB COUNT to stop changing — but a blob only appears at the very END of a
 * re-raster, so a step that had just kicked off a one-second raster looked perfectly quiet, the
 * dwell returned, the next notch arrived while `hiresBusy` still held the overlay's id, and the app
 * SKIPPED that re-raster with no retry. The run reported 1 of a predicted 2 and the shortfall looked
 * like an app finding when it was a harness artefact.
 *
 * So the in-flight signal is LONG TASKS as well as blobs: a 141 MB canvas raster blocks the main
 * thread in multi-hundred-millisecond chunks, and those are observable while it is still running.
 * A step is settled only when NEITHER has moved for `quietMs`, and never before `minMs`. The cap is
 * reported when it is hit, never silently absorbed.
 */
async function settleStep(page, { quietMs = 900, minMs = 1200, capMs = 30000 } = {}) {
  await page.waitForTimeout(RERASTER_SETTLE_MS + 80);
  const t0 = Date.now();
  const read = () => page.evaluate(() => `${window.__rr.blobs.length}|${window.__rr.longTasks.length}`);
  let last = await read();
  let quietSince = Date.now();
  for (;;) {
    await page.waitForTimeout(100);
    const n = await read();
    if (n !== last) { last = n; quietSince = Date.now(); }
    const elapsed = Date.now() - t0;
    if (elapsed >= minMs && Date.now() - quietSince >= quietMs) return { cappedOut: false, ms: elapsed };
    if (elapsed >= capMs) return { cappedOut: true, ms: elapsed };
  }
}

/* ---- One arm, one rep --------------------------------------------------------------------------- */
async function runArm(browser, planKey, arm, rep) {
  const spec = RERASTER_ARMS[arm];
  /* ⛔ NOT PUT THROUGH `redactPlan`. Both files here are ALREADY redacted fixtures (they carry
   * `_redacted`), and `redactPlan` takes a raw `public.sites` ROW — feeding it a fixture returns a
   * shape with NO `rasters` at all, which is exactly how the first run of this harness measured an
   * arm with no overlay on the page and would have reported it as a clean, fast null. The
   * rerasterFault guard caught it; this comment is so nobody re-adds the call. */
  const fixture = rerasterArmFixture(FIXTURES[planKey], arm);
  const census = fixtureCensus(fixture);
  const sweep = SWEEPS[spec.sweep];

  const overlaySpec = (fixture.rasters || []).find((r) => r.role === "sheetOverlay");
  /* Only an arm that is SUPPOSED to cross the gate must have fetched the PDF. A `below` arm not
   * fetching is the app behaving correctly (it never wants a hi-res, so it never asks for bytes),
   * and faulting it would be the guard contradicting the arm's own design. */
  const pdfExpected = spec.expect === "above" && !!(overlaySpec && overlaySpec.pdfBacked && overlaySpec.visible !== false);

  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: DPR });
  await ctx.addInitScript(fixtureSeed(fixture, { id: SITE_ID, pdfStorage: true }));
  await ctx.addInitScript(installProbe);

  let tilesServed = 0, pdfServed = 0, pdfBytesServed = 0;
  const wantKey = overlaySpec ? fixtureStorageKey(SITE_ID, overlaySpec.id) : null;
  await ctx.route(/^https?:\/\//, (route) => {
    const url = route.request().url();
    if (url.startsWith(BASE)) return route.continue();
    /* The overlay's source PDF. Matched on the SEEDED KEY, not merely on ".pdf", so a request for
     * something else can never be counted as delivery of this overlay's bytes. */
    if (wantKey && url.includes(encodeURI(wantKey))) {
      pdfServed++; pdfBytesServed += SHEET_PDF.length;
      return route.fulfill({
        status: 200,
        headers: { "content-type": "application/pdf", "access-control-allow-origin": "*", "cache-control": "no-store" },
        body: SHEET_PDF,
      });
    }
    if (FAKE_TILES) {
      const t = parseTileUrl(url);
      if (t) { tilesServed++; return route.fulfill({ status: 200, headers: { "content-type": "image/png", "access-control-allow-origin": "*", "cache-control": "no-store" }, body: fakeTilePng(t.z, t.x, t.y) }); }
    }
    return route.abort();
  });

  const page = await ctx.newPage();
  /* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — not its clock, and not its pixels. A hidden tab clamps
     setTimeout (a setTimeout-paced probe then times the clamp: 3,156 ms for a 138-182 ms gesture) AND
     suspends requestAnimationFrame, so after a view change the app's state attributes update while the
     drawing never repaints — every box, position, hit test and screenshot then agrees with every other
     and describes a view the app already left. One precondition covers both, rAF liveness probe
     included; see ui-audit/lib/tabTiming.mjs. Fails loudly rather than reporting either. */
  await assertMeasurable(page, "zoom-reraster-arms");
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Performance.enable").catch(() => {});
  if (CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU }).catch(() => {});

  /* Two navigations, for the reason raster-arms.mjs states: IndexedDB is origin-scoped, so the
   * raster strings cannot be written until a document from this origin exists. */
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  for (const { key, spec: s } of rasterIdbPlan(fixture, SITE_ID)) {
    const r = cachedRaster(s, CACHE);
    const wrote = await page.evaluate(idbPutInPage, { key, value: pngDataUrl(r.png) });
    if (wrote !== true) throw new Error(`IndexedDB write for ${key} did not confirm — the arm cannot be established`);
  }

  await page.reload({ waitUntil: "load" });
  await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 60000 });
  const wantVisible = paintedRasters(fixture);
  if (wantVisible.length) {
    await page.waitForFunction((n) => {
      const svg = document.querySelector('[data-testid="planner-canvas"]');
      return !!svg && [...svg.querySelectorAll("image")].filter((im) => ((im.href && im.href.baseVal) || "").length > 1000).length >= n;
    }, wantVisible.length, { timeout: 45000 }).catch(() => {});
  }
  await page.waitForTimeout(2500); // let boot's deferred work land, so it isn't charged to the gesture

  const images = await page.evaluate(READ_IMAGES);
  const decodeIssue = decodeFault(images.filter((i) => i.decoded), wantVisible);

  const boxEl = await page.locator('[data-testid="planner-canvas"]').boundingBox();
  const cx = boxEl.x + boxEl.width / 2, cy = boxEl.y + boxEl.height / 2;
  await page.mouse.move(cx, cy);

  /* ---- Pre-roll to the sweep's start zoom ------------------------------------------------------
   * The fit zoom is whatever the plan fits at; the sweep must start at a stated ppf so `below` and
   * `across` are comparable. Notch to it, let everything settle, THEN reset the counters — so any
   * re-raster the pre-roll caused (the app may well hold one straight off the fit) is not charged
   * to the sweep. */
  const fitPpf = await page.evaluate(READ_VIEW_PPF);
  let guard = 0;
  for (;;) {
    const ppf = await page.evaluate(READ_VIEW_PPF);
    if (!Number.isFinite(ppf) || guard++ > 60) break;
    const ratio = sweep.startPpf / ppf;
    if (Math.abs(Math.log(ratio) / Math.log(WHEEL_FACTOR)) < 0.5) break;
    await wheelNotch(page, cx, cy, ratio > 1 ? -1 : 1);
    await page.waitForTimeout(140); // let React commit before the next read, or the loop chases a stale ppf
  }
  await settleStep(page, { quietMs: 900, capMs: 25000 });
  const startPpf = await page.evaluate(READ_VIEW_PPF);
  await page.evaluate(() => { window.__rr.blobs.length = 0; window.__rr.revoked = 0; window.__rr.longTasks.length = 0; });

  /* ---- The measured sweep ---------------------------------------------------------------------- */
  const traceEvents = [];
  cdp.on("Tracing.dataCollected", ({ value }) => { if (value) traceEvents.push(...value); });
  await cdp.send("Tracing.start", {
    transferMode: "ReportEvents",
    traceConfig: { includedCategories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.frame", "blink", "cc"] },
  }).catch(() => {});

  const w0 = await workCounters(cdp);
  const tSweep0 = Date.now();
  let cappedOutSteps = 0;
  for (const dir of sweep.dirs) {
    await wheelNotch(page, cx, cy, dir);
    if (CONTINUOUS) await page.waitForTimeout(30);
    else { const s = await settleStep(page); if (s.cappedOut) cappedOutSteps++; }
  }
  if (CONTINUOUS) { const s = await settleStep(page, { quietMs: 900, capMs: 40000 }); if (s.cappedOut) cappedOutSteps++; }
  const sweepMs = Date.now() - tSweep0;
  const w1 = await workCounters(cdp);

  const traced = await new Promise((res) => {
    cdp.once("Tracing.tracingComplete", () => res(true));
    cdp.send("Tracing.end").catch(() => res(false));
    setTimeout(() => res(false), 25000);
  });
  const paint = traced ? bucketTrace(traceEvents) : null;

  await page.waitForTimeout(300); // let the IHDR reads resolve before the census
  const probe = await page.evaluate(() => ({
    blobs: window.__rr.blobs.map((b) => ({ bytes: b.bytes, w: b.w, h: b.h, t: b.t })),
    revoked: window.__rr.revoked,
    longTasks: window.__rr.longTasks.slice(),
  }));
  const endPpf = await page.evaluate(READ_VIEW_PPF);
  const imagesAfter = await page.evaluate(READ_IMAGES);
  await ctx.close();

  /* The prediction the app's OWN decision function makes for the ppfs this sweep actually visited —
   * computed from the measured start zoom, never from the intended one. */
  const visited = sweep.dirs.reduce((acc, d) => { acc.push((acc[acc.length - 1] ?? startPpf) * Math.pow(WHEEL_FACTOR, -d)); return acc; }, []);
  const predicted = overlaySpec && pdfExpected ? rerasterPlan(overlaySpec, visited) : [];
  const predictedCount = rerasterCount(predicted);

  const hiRes = probe.blobs.filter((b) => b.w > 0 && b.h > 0);
  const observed = hiRes.length;
  const expect = spec.expect;

  /* ⛔ THE CONTROL ARM'S OWN INVARIANT, asserted on the zooms the sweep ACTUALLY VISITED rather than
   * on the ones it intended. The fit zoom is whatever the plan fits at and it jitters run to run, so
   * a `below` arm that drifted over the gate would be a control that is not a control — and it would
   * fail silently, because firing is exactly what the other arm is supposed to do. */
  const overGate = spec.sweep === "below" && overlaySpec
    ? visited.filter((p) => magnificationAt(overlaySpec, p) > 1.5).length : 0;

  const faults = [
    decodeIssue,
    overGate ? `${planKey}/${arm}: the "below" sweep drifted OVER the magnification gate on ${overGate} of `
      + `${visited.length} notches (start ${startPpf?.toFixed(3)} px/ft, gate ${measuredThresholdPpf(overlaySpec).toFixed(3)}) — `
      + `this arm is not a control and is SUPPRESSED` : null,
    pdfDeliveryFault({ served: pdfServed, expect: pdfExpected, label: `${planKey}/${arm}` }),
    rerasterFault({ expect, observed, predicted: predictedCount, label: `${planKey}/${arm}` }),
    /* The NET product of the notches, not a monotone assumption — `outback` ends where its
     * direction sequence says it ends, which is not where a one-way sweep of the same length would. */
    (() => {
      const net = Math.pow(WHEEL_FACTOR, -sweep.dirs.reduce((a, b) => a + b, 0));
      return endPpf && startPpf && Math.abs(endPpf / startPpf - net) > 0.15 * net
        ? `${planKey}/${arm}: the sweep did not move the view as specified (${startPpf?.toFixed(3)} → ${endPpf?.toFixed(3)} px/ft, expected ×${net.toFixed(2)}) — SUPPRESSED`
        : null;
    })(),
  ].filter(Boolean);

  const work = w0 && w1 ? {
    mainThreadMs: +((w1.script - w0.script) + (w1.layout - w0.layout) + (w1.recalc - w0.recalc)).toFixed(1),
    scriptMs: +(w1.script - w0.script).toFixed(1),
    layoutMs: +(w1.layout - w0.layout).toFixed(1),
    recalcMs: +(w1.recalc - w0.recalc).toFixed(1),
    taskMs: +(w1.task - w0.task).toFixed(1),
  } : null;

  const lt = probe.longTasks.map((t) => t.ms);
  return {
    plan: planKey, arm, rep, faults,
    sweep: { kind: spec.sweep, regime: CONTINUOUS ? "continuous" : "settled", notches: sweep.dirs.length, dirs: sweep.dirs.join(""), fitPpf, startPpf, endPpf, wheelFactor: WHEEL_FACTOR, cappedOutSteps, sweepMs },
    census,
    pdfServed, pdfBytesServed, tilesServed,
    reraster: {
      observed, predicted: predictedCount,
      megapixels: hiRes.map((b) => +((b.w * b.h) / 1e6).toFixed(2)),
      dims: hiRes.map((b) => `${b.w}×${b.h}`),
      encodedBytes: hiRes.reduce((s, b) => s + b.bytes, 0),
      peakDecodedBytes: hiRes.reduce((m, b) => Math.max(m, b.w * b.h * 4), 0),
      revokedUrls: probe.revoked,
      atCap: hiRes.filter((b) => Math.max(b.w, b.h) >= MAX_RERASTER_DIM - 1).length,
      blobOnCanvas: imagesAfter.filter((i) => i.blob).length,
    },
    work,
    longTasks: { count: lt.length, totalMs: +lt.reduce((a, b) => a + b, 0).toFixed(1), maxMs: +Math.max(0, ...lt).toFixed(1), medianMs: lt.length ? +median(lt).toFixed(1) : 0 },
    paint,
  };
}

/* ---- Report ------------------------------------------------------------------------------------ */
const fmt = (n, d = 1) => (n == null ? "—" : Number(n).toFixed(d));
const mb = (b) => (b ? `${(b / 1e6).toFixed(0)} MB` : "—");

(async () => {
  const browser = await chromium.launch({ headless: false, executablePath: EXEC, args: ["--force-device-scale-factor=" + DPR, "--disable-lcd-text"] });
  const results = [];
  const errors = [];

  /* The prediction, printed BEFORE any run and computed from the app's own constants — so the
   * measurement is compared against a number that was fixed before it was taken. */
  const ov = (FIXTURES.bain.rasters || []).find((r) => r.role === "sheetOverlay");
  const threshold = measuredThresholdPpf(ov);
  const cap = capPpf(ov);
  const capRaster = rasterAtScale(ov, MAX_RERASTER_DIM / Math.max(ov.imgW, ov.imgH));
  const preface = {
    overlay: `${ov.imgW}×${ov.imgH} pt, ftPerPx ${ov.ftPerPx.toFixed(4)}, opacity ${ov.opacity}, rotation ${ov.rotation}°`,
    baseRasterScale: +overlayBaseScale(ov).toFixed(4),
    measuredThresholdPpf: +threshold.toFixed(4),
    capPpf: +cap.toFixed(4),
    rasterAtCap: `${capRaster.w}×${capRaster.h} (${capRaster.megapixels} MP, ${mb(capRaster.decodedBytes)} decoded)`,
    wheelNotch: WHEEL_FACTOR,
    ladderRungs: rungsInBand(ov),
    note: "one wheel notch is ×1.12. Under the PRE-FIX rule (continuous scale, kept only within 10%) that meant "
      + "every notch in the band was a full re-raster; under the octave ladder the band collapses to the rung count above, "
      + "and a rung already rendered is reused rather than re-rendered.",
    sheetPdf: `${SHEET_PDF.length} bytes, ${STROKES} synthetic strokes — the PAGE SIZE is his, the CONTENT is not`,
  };
  if (!JSON_OUT) {
    console.log(`\nB749 zoom re-raster — the path, before any arm runs`);
    console.log(`  overlay            ${preface.overlay}`);
    console.log(`  base raster scale  ${preface.baseRasterScale} px/pt`);
    console.log(`  gate opens at      ${preface.measuredThresholdPpf} px/ft   ← MEASURED off the app's own decision function`);
    console.log(`  8192px cap at      ${preface.capPpf} px/ft`);
    console.log(`  raster at the cap  ${preface.rasterAtCap}`);
    console.log(`  ladder rungs       ${preface.ladderRungs} between the gate and the cap (a wheel notch is ×${WHEEL_FACTOR}; the pre-fix continuous rule re-rastered on every one)`);
    console.log(`  source PDF         ${preface.sheetPdf}`);
    console.log(`  regime             ${CONTINUOUS ? "continuous (one settle for the whole sweep)" : "settled (dwell past the 260 ms debounce at every notch)"}\n`);
  }

  for (const plan of PLANS) {
    if (!FIXTURES[plan]) { errors.push(`unknown plan "${plan}"`); continue; }
    for (const arm of ARMS) {
      if (!RERASTER_ARMS[arm]) { errors.push(`unknown arm "${arm}"`); continue; }
      for (let rep = 0; rep < REPS; rep++) {
        try {
          const r = await runArm(browser, plan, arm, rep);
          results.push(r);
          if (!JSON_OUT) {
            const f = r.faults.length ? `  ⛔ ${r.faults[0]}` : "";
            console.log(`  ${plan}/${arm} rep${rep}: re-rasters ${r.reraster.observed} (predicted ${r.reraster.predicted}) · `
              + `peak ${mb(r.reraster.peakDecodedBytes)} · main-thread ${fmt(r.work?.mainThreadMs)} ms · `
              + `longtask max ${fmt(r.longTasks.maxMs)} ms · sweep ${fmt(r.sweep.sweepMs / 1000, 1)} s${f}`);
          }
        } catch (e) {
          errors.push(`${plan}/${arm} rep${rep}: ${e.message}`);
          if (!JSON_OUT) console.log(`  ${plan}/${arm} rep${rep}: ⛔ ${e.message}`);
        }
      }
    }
  }
  await browser.close();

  const byArm = new Map();
  for (const r of results) {
    const k = `${r.plan}/${r.arm}`;
    if (!byArm.has(k)) byArm.set(k, []);
    byArm.get(k).push(r);
  }
  const summary = [...byArm.entries()].map(([k, rs]) => {
    const ok = rs.filter((r) => !r.faults.length);
    const src = ok.length ? ok : rs;
    const pick = (f) => src.map(f).filter((v) => Number.isFinite(v));
    return {
      arm: k,
      reps: rs.length, faulted: rs.length - ok.length,
      faults: [...new Set(rs.flatMap((r) => r.faults))],
      rerastersMedian: median(pick((r) => r.reraster.observed)),
      rerastersPredicted: src[0]?.reraster.predicted ?? null,
      peakDecodedBytes: Math.max(0, ...pick((r) => r.reraster.peakDecodedBytes)),
      mainThreadMs: median(pick((r) => r.work?.mainThreadMs)),
      mainThreadNoiseFloorPct: noiseFloorPct(pick((r) => r.work?.mainThreadMs)),
      longTaskMaxMs: median(pick((r) => r.longTasks.maxMs)),
      longTaskTotalMs: median(pick((r) => r.longTasks.totalMs)),
      paintMs: median(pick((r) => r.paint?.paintMs)),
      rasterMs: median(pick((r) => r.paint?.rasterMs)),
      decodeMs: median(pick((r) => r.paint?.decodeMs)),
      compositeMs: median(pick((r) => r.paint?.compositeMs)),
      layerizeMs: median(pick((r) => r.paint?.layerizeMs)),
      sweepMs: median(pick((r) => r.sweep.sweepMs)),
    };
  });

  if (JSON_OUT) {
    console.log(JSON.stringify({ preface, arms: RERASTER_ARMS, summary, results, errors }, null, 2));
  } else {
    console.log(`\n  arm                              re-raster  peak      main-thread  longtask   raster  decode  composite  sweep`);
    console.log(`  ${"-".repeat(112)}`);
    for (const s of summary) {
      console.log(`  ${s.arm.padEnd(30)} ${String(s.rerastersMedian).padStart(5)}/${String(s.rerastersPredicted).padEnd(3)} `
        + `${mb(s.peakDecodedBytes).padStart(7)}  ${fmt(s.mainThreadMs).padStart(9)} ms ${fmt(s.longTaskMaxMs).padStart(7)} ms `
        + `${fmt(s.rasterMs).padStart(6)}  ${fmt(s.decodeMs).padStart(6)}  ${fmt(s.compositeMs).padStart(8)}  ${fmt(s.sweepMs / 1000, 1).padStart(5)} s`);
      for (const f of s.faults) console.log(`      ⛔ ${f}`);
    }
    console.log("");
    if (errors.length) { console.log("  ERRORS"); for (const e of errors) console.log(`   • ${e}`); console.log(""); }
  }

  /* An arm that could not be established is an ERROR, not a measurement. Reporting its beautiful
   * null result is the exact failure this file exists to prevent. */
  const unestablished = summary.filter((s) => s.faulted === s.reps && s.reps > 0);

  /* The gate. Every arm has a stated budget; exceeding it means a re-raster the ladder and the cache
   * were supposed to make unnecessary is happening again. */
  const overBudget = ASSERT
    ? summary.filter((s) => {
      const budget = rerasterBudget(s.arm.split("/")[1]);
      return Number.isFinite(s.rerastersMedian) && s.rerastersMedian > budget;
    })
    : [];
  if (ASSERT && !JSON_OUT) {
    for (const s of overBudget) {
      console.log(`  ⛔ ${s.arm}: ${s.rerastersMedian} re-rasters across the sweep, budget ${rerasterBudget(s.arm.split("/")[1])}`);
    }
    console.log(overBudget.length ? `  ⛔ B749 re-raster budget EXCEEDED\n` : `  ✅ every arm within its re-raster budget\n`);
  }
  if (errors.length || unestablished.length || overBudget.length) process.exit(1);
})();
