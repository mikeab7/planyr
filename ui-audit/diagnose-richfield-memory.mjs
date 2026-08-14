#!/usr/bin/env node
/* diagnose-richfield-memory — WHERE DOES RICHFIELD'S MEMORY GO, AND IS IT EVER GIVEN BACK? (B519904)
 *
 *   node ui-audit/diagnose-richfield-memory.mjs [--rounds N] [--arm visible|hidden|nopdf] [--snapshots]
 *
 * ⛔ WHY THIS EXISTS RATHER THAN ONE MORE PASS OF `session-growth`. The owner recorded Richfield as
 * slow on 2026-08-14 and then reported the decisive half himself: *"it became slow after a while,
 * also chrome is saying the planyr tab now runs closer to 600 - 700 mb"*, and *"it seemed to speed
 * up after i hid the overlay image"*. His own in-app captures agree — 16 s into the session the JS
 * heap was already 296 MB and by 12.4 minutes of interacting the tab had spent 33.8 s in long tasks
 * and dropped 1,754 frames. The repo's INTENDED ceiling is 160 MB of JS heap
 * (`ui-audit/perf-budgets.json` → `runtime.peakHeapMB.ceiling`, measured 134.6 MB).
 *
 * ⛔ AND THE ONE THING EVERY EXISTING INSTRUMENT HERE IS BLIND TO. `performance.memory` and CDP's
 * `JSHeapUsedSize` report the JS HEAP. A 5851 × 8192 decoded PNG is not on the JS heap — it is a
 * renderer image buffer — so a leak made of DECODED RASTERS is invisible to every heap number this
 * repo prints, and `perf-budgets.json` says so in as many words ("decoded tile bitmaps and GPU
 * memory are invisible here — the owner observed ~555MB for the tab while the JS heap peaked at
 * 134.6MB"). That note has been sitting there describing exactly this defect. So this harness reads
 * the RENDERER PROCESS RSS out of /proc alongside the JS heap, and reports them as two separate
 * series that must never be summed or conflated. If the JS heap is flat and RSS climbs, the leak is
 * pixels, and no amount of heap-snapshot diffing will ever name it.
 *
 * THE THREE ARMS, and the discriminator each one provides:
 *   • `visible`  — the owner's case. The knockout sheet overlay is on screen the whole run.
 *   • `hidden`   — the same plan with that one overlay hidden. This is his relief, measured. It
 *                  answers the question he actually asked: does hiding FREE the buffers, or merely
 *                  stop drawing them? Flat RSS = freed. RSS that stays high = his relief was
 *                  reduced per-frame work, not reclaimed memory, and that is a SECOND finding.
 *   • `nopdf`    — the same overlay with its PDF backing removed, so the Tier-2 re-raster path can
 *                  never run. It isolates "raster cost in general" from "the re-raster path".
 *
 * THE CYCLE IS HIS, NOT A SYNTHETIC ONE. His counter track recorded ppf 0.03 → 0.15 → 0.72 → 0.21 →
 * 0.12 inside fourteen seconds. On this overlay the hi-res gate sits at ppf ≈ 0.536
 * (`chooseOverlayRasterScale`: baseScale 4500/3024 = 1.488, upgrade at 1.5× ⇒ want > 2.232 ⇒ ppf >
 * 2.232/4.1667), so that sweep crosses the gate and falls back below it repeatedly — which is the
 * one thing that makes the re-raster path run more than once. The cycle reproduces it.
 *
 * ⛔ AND IT COUNTS BLOB URLS FROM INSIDE THE PAGE, because "the cache is bounded" is a claim about
 * code and this is a measurement of behaviour. `URL.createObjectURL` / `revokeObjectURL` are
 * wrapped at init, so the run reports minted, revoked, and STILL LIVE. A bounded LRU that revokes
 * on eviction shows live ≤ 3 per overlay forever; anything else is the accumulator, named.
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFixture, cachedRaster } from "./lib/fixtureSeeding.mjs";
import { fixtureSeed, rasterIdbPlan, idbPutInPage, fixtureCensus, fixtureStorageKey } from "./lib/planFixture.mjs";
import { pngDataUrl } from "./lib/synthRaster.mjs";
import { sheetPdfBytes } from "./lib/sheetPdf.mjs";
import { fakeTilePng, parseTileUrl } from "./lib/fakeTile.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
/* ⛔ B1439 — an undisposed ElementHandle is a strong GC root that retains the whole tree above the
 * element, which silently inflates every memory reading taken afterwards. In a harness whose entire
 * purpose is measuring retention that is not a style point, it is a contaminated instrument. */
import { waitForSelectorReleased } from "./lib/waitRelease.mjs";
import { aggregateSnapshot, diffAggregates } from "./lib/heapSnapshot.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.PLANYR_BASE || "http://127.0.0.1:4173";
const SITE_ID = "smsdrvzr9gzx";
const DPR = 2;

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : dflt;
};
const ROUNDS = Number(arg("rounds", 8));
const ARM = arg("arm", "visible");
const WANT_SNAPSHOTS = process.argv.includes("--snapshots");
/* The CONTROL axis. "Is this Richfield, or is it every plan?" is a question about a DIFFERENT
 * fixture through the identical cycle — so the fixture is a parameter, and the control is a real
 * plan of the owner's that carries no sheet overlay at all. */
const FIXTURE = arg("fixture", "richfield");
/* ⛔ THE EDIT AXIS, and it exists because the first pass of this harness did NOT have it and could
 * not have reproduced what the owner did. His 12.4-minute capture carries `editsSinceLoad: 107` and
 * `planSwitches: 3`; a pan/zoom loop performs neither, so any claim about undo history, per-edit
 * derived structures or selection state made without this flag is a claim about a path that never
 * ran. Real pointer and key input only — a synthetic KeyboardEvent does not mutate the plan
 * (SYNTHETIC-KEYS-DONT-EDIT). */
const EDITS = Number(arg("edits", 0));
/* ⛔ THE DISCRIMINATOR FOR B1121'S RESIDUE. The edit cycle is drag-THEN-undo, so a residue could sit
 * in either half: the COMMIT path (the drag itself) or the RESTORE path (`applySnapshot`). Undo
 * history cannot be the answer on its own — it is capped at 80 frames AND a drag+undo pair nets to
 * zero growth in the ring — so the two paths have to be separated by measurement rather than
 * reasoned about. `--no-undo` drags without undoing; if the slope survives, the residue is in the
 * commit path, and if it vanishes it is in the restore path. */
const NO_UNDO = process.argv.includes("--no-undo");

/* The hi-res gate for THIS overlay, derived rather than hard-coded, so the cycle stays correct if
 * the ladder constants move. Below → base raster; above → the Tier-2 re-raster path. */
const PPF_LOW = 0.12;   // his own counter track
const PPF_HIGH = 0.72;  // his own counter track — comfortably past the ≈0.536 gate

/* ---- in-page probe: blob-URL accounting + long tasks ------------------------------------------ */
function installProbe() {
  window.__PLANYR_E2E = true;
  const live = new Set();
  const st = { minted: 0, revoked: 0, longTasks: 0, longTaskMs: 0 };
  const co = URL.createObjectURL.bind(URL);
  const ro = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (b) => { const u = co(b); st.minted++; live.add(u); return u; };
  URL.revokeObjectURL = (u) => { if (live.delete(u)) st.revoked++; return ro(u); };
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) { st.longTasks++; st.longTaskMs += e.duration; } })
      .observe({ entryTypes: ["longtask"] });
  } catch (_) {}
  window.__mem = {
    read: () => ({ ...st, liveBlobs: live.size }),
    /* The app's own view of what it is holding, read-only. `<image>` hrefs pointing at blob URLs is
     * the DISPLAYED set; the cache behind it is not reachable from here, so this reports what is on
     * the page and the blob counters above report what exists. */
    imagesOnPage: () => [...document.querySelectorAll("image")].map((n) => n.getAttribute("href") || n.getAttribute("xlink:href") || "").filter((h) => h.startsWith("blob:")).length,
    /* ⛔ THE TILE COUNT IS THE OTHER HALF OF THE PICTURE AND IT IS NOT ON THE JS HEAP EITHER. A
     * retina basemap tile is 512 × 512 RGBA ≈ 1 MB decoded, so a few hundred retained tiles is
     * hundreds of megabytes that no heap number will ever show. Counted the way the app's own
     * perf recorder counts them, so the two agree. */
    tiles: () => document.querySelectorAll("img.leaflet-tile").length,
    tileBytesMB: () => {
      let px = 0;
      for (const t of document.querySelectorAll("img.leaflet-tile")) px += (t.naturalWidth || 0) * (t.naturalHeight || 0);
      return +((px * 4) / 1048576).toFixed(1);
    },
  };
}

/* ---- renderer RSS, read from the OS ------------------------------------------------------------
 * ⛔ THE NUMBER THE OWNER IS QUOTING. Chrome's task manager shows process memory; the JS heap is a
 * fraction of it. Summing several renderers would be wrong (the browser process and any helper are
 * not his tab), so this takes the LARGEST renderer, which on a one-tab run is the tab. */
function procCmdline(pid) {
  try { return readFileSync(`/proc/${pid}/cmdline`, "utf8"); } catch (_) { return ""; }
}
function livePids() {
  try { return readdirSync("/proc").filter((d) => /^\d+$/.test(d)); } catch (_) { return []; }
}
function findBrowserPid(exec) {
  for (const pid of livePids()) {
    const cmd = procCmdline(pid);
    if (cmd.includes(exec) && !cmd.includes("--type=")) return pid;
  }
  return null;
}
function rendererRssMB() {
  const all = [];
  for (const pid of livePids()) {
    const cmd = procCmdline(pid);
    if (!cmd.includes("--type=renderer")) continue;
    try {
      const m = /VmRSS:\s+(\d+) kB/.exec(readFileSync(`/proc/${pid}/status`, "utf8"));
      if (m) all.push(+m[1] / 1024);
    } catch (_) {}
  }
  return all.length ? +Math.max(...all).toFixed(1) : null;
}

/* ---- arm shaping ------------------------------------------------------------------------------- */
function armFixture(base, arm) {
  const f = JSON.parse(JSON.stringify(base));
  const sheet = (f.rasters || []).find((r) => r.role === "sheetOverlay");
  /* A control fixture legitimately has no sheet overlay; only the overlay-shaping arms require one,
   * and asking for one of those against a plan that has none is an error rather than a silent
   * no-op arm that would read as a clean null. */
  if (!sheet) {
    if (arm !== "visible") throw new Error(`fixture "${FIXTURE}" has no sheetOverlay — arm "${arm}" cannot be established`);
    return f;
  }
  if (arm === "hidden") sheet.visible = false;
  if (arm === "nopdf") sheet.pdfBacked = false;
  return f;
}

async function run() {
  const base = readFixture(FIXTURE);
  const census = fixtureCensus(base);
  const fixture = armFixture(base, ARM);
  const sheet = (fixture.rasters || []).find((r) => r.role === "sheetOverlay");
  const SHEET_PDF = sheet ? sheetPdfBytes({ wPt: sheet.imgW, hPt: sheet.imgH, strokes: 4000, seed: 11 }) : null;

  /* Headed under xvfb, against the full Chromium the repo's other raster harnesses use. The
   * headless shell is the wrong instrument here: this measures RENDERER PROCESS RSS, and a
   * compositor that never allocates a real texture is exactly the blindness being closed. */
  const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
  const browser = await chromium.launch({
    headless: false, executablePath: EXEC,
    args: ["--no-sandbox", "--js-flags=--expose-gc", "--force-device-scale-factor=" + DPR, "--disable-lcd-text"],
  });
  /* Playwright does not expose the browser process on a `chromium.launch()` handle in this version,
   * so the browser process is found by scanning /proc for the chrome binary that owns renderers.
   * Reported as null rather than guessed if it cannot be identified — a memory series whose source
   * process is unknown is not a measurement. */
  const browserPid = findBrowserPid(EXEC);

  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: DPR });
  await ctx.addInitScript(fixtureSeed(fixture, { id: SITE_ID, pdfStorage: ARM !== "nopdf" }));
  await ctx.addInitScript(installProbe);

  let pdfServed = 0;
  const wantKey = sheet ? fixtureStorageKey(SITE_ID, sheet.id) : null;
  await ctx.route(/^https?:\/\//, (route) => {
    const url = route.request().url();
    if (url.startsWith(BASE)) return route.continue();
    if (wantKey && url.includes(encodeURI(wantKey))) {
      pdfServed++;
      return route.fulfill({ status: 200, headers: { "content-type": "application/pdf", "access-control-allow-origin": "*", "cache-control": "no-store" }, body: SHEET_PDF });
    }
    const t = parseTileUrl(url);
    if (t) return route.fulfill({ status: 200, headers: { "content-type": "image/png", "access-control-allow-origin": "*", "cache-control": "no-store" }, body: fakeTilePng(t.z, t.x, t.y) });
    return route.abort();
  });

  const page = await ctx.newPage();
  await assertMeasurable(page, "diagnose-richfield-memory");
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Performance.enable").catch(() => {});
  await cdp.send("HeapProfiler.enable").catch(() => {});

  /* Two navigations — IndexedDB is origin-scoped, so the raster strings cannot be written until a
   * document from this origin exists. */
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  for (const { key, spec } of rasterIdbPlan(fixture, SITE_ID)) {
    /* `cachedRaster` synthesises a REAL decodable PNG to the fixture's measured parameters and
     * memoises it on disk — every raster gets a distinct seed there, because Chromium caches
     * decoded images by CONTENT and identical bytes would quietly collapse two textures into one. */
    const r = cachedRaster(spec, join(HERE, ".raster-cache"));
    const wrote = await page.evaluate(idbPutInPage, { key, value: pngDataUrl(r.png) });
    if (wrote !== true) throw new Error(`IndexedDB write for ${key} did not confirm`);
  }
  await page.reload({ waitUntil: "load" });
  await waitForSelectorReleased(page, "svg[data-view-ppf]", { timeout: 30000 });
  await assertMeasurable(page, "diagnose-richfield-memory/post-load");

  /* ⛔ PRE-GC AND POST-GC ARE DIFFERENT QUESTIONS AND MUST BOTH BE ANSWERED.
   * The owner's in-app recorder samples `performance.memory.usedJSHeapSize` on a timer with NO
   * forced collection, so what it reports is RETAINED + GARBAGE-NOT-YET-COLLECTED. A harness that
   * collects before every sample reports RETAINED only. Those two numbers can differ by a factor of
   * four on an allocation-heavy path and comparing one against the other is how a sawtooth gets
   * read as a leak. His own counter series settles the point: 472 → 540 → 548 → 345 → **128.72**
   * inside one capture. So this samples BOTH, labels them, and never prints one as the other. */
  const metrics = async () => {
    const m = await cdp.send("Performance.getMetrics").catch(() => ({ metrics: [] }));
    const get = (n) => m.metrics.find((x) => x.name === n)?.value ?? null;
    return {
      jsHeapMB: get("JSHeapUsedSize") != null ? +(get("JSHeapUsedSize") / 1048576).toFixed(1) : null,
      nodes: get("Nodes"), documents: get("Documents"), listeners: get("JSEventListeners"),
    };
  };
  const gc = async () => { await cdp.send("HeapProfiler.collectGarbage").catch(() => {}); await pacedWait(page, 350); };

  const takeSnapshot = async (label) => {
    if (!WANT_SNAPSHOTS) return null;
    const chunks = [];
    const on = (p) => chunks.push(p.chunk);
    cdp.on("HeapProfiler.addHeapSnapshotChunk", on);
    await cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false, treatGlobalObjectsAsRoots: true });
    cdp.off("HeapProfiler.addHeapSnapshotChunk", on);
    const snap = JSON.parse(chunks.join(""));
    mkdirSync(join(HERE, "..", ".perf"), { recursive: true });
    writeFileSync(join(HERE, "..", ".perf", `richfield-${ARM}-${label}.heapsnapshot`), chunks.join(""));
    return aggregateSnapshot(snap);
  };

  const sample = async (label) => {
    const pre = await metrics();          // what HIS recorder would have seen
    await gc();
    const m = await metrics();            // what is actually RETAINED
    const probe = await page.evaluate(() => window.__mem.read());
    const scene = await page.evaluate(() => ({
      blobImagesOnPage: window.__mem.imagesOnPage(),
      tiles: window.__mem.tiles(),
      tileBytesMB: window.__mem.tileBytesMB(),
    }));
    const rss = rendererRssMB();
    return { label, rssMB: rss, heapPreGcMB: pre.jsHeapMB, ...m, ...probe, longTaskMs: +probe.longTaskMs.toFixed(0), ...scene };
  };

  const centerOn = async (ppf) => {
    await page.evaluate((p) => window.__plannerView?.centerOn(0, 0, p), ppf);
    /* The re-raster effect is debounced 260 ms behind zoom settle and then does real work. Give it
     * room, then let the frame loop breathe — paced, never `waitForTimeout` inside a timed section. */
    await pacedWait(page, 1400);
  };

  /* One edit: select a real element with a real press, drag it with real pointer moves, then undo.
   * Drag-then-undo is deliberate — it exercises the undo stack in BOTH directions and leaves the
   * plan where it started, so N rounds are comparable to each other rather than drifting into a
   * different scene. Returns how many undo frames the app actually holds, so a round that silently
   * edited nothing is visible instead of being averaged in as a clean result. */
  const editOnce = async (i) => {
    const spot = await page.evaluate(() => {
      /* el-tier: picking ONE element to drag. This is a targeted pick of a drag target, not a
       * census of plan contents — nothing here counts what the plan holds (COUNT-EVERY-KIND). */
      /* el-tier: picking ONE element to drag — a targeted pick, never a census. */
  const ns = [...document.querySelectorAll("[data-el-id]")];
      if (!ns.length) return null;
      const n = ns[Math.floor(ns.length / 2)];
      const r = n.getBoundingClientRect();
      if (!(r.width > 4 && r.height > 4)) return null;
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (!spot) return false;
    await page.mouse.move(spot.x, spot.y);
    await page.mouse.down();
    for (let k = 1; k <= 6; k++) await page.mouse.move(spot.x + k * 5, spot.y + k * 3);
    await page.mouse.up();
    await pacedWait(page, 90);
    if (!NO_UNDO) { await page.keyboard.press("Control+z"); await pacedWait(page, 90); }
    return true;
  };

  const rows = [];
  await centerOn(PPF_LOW);
  await pacedWait(page, 1200);
  rows.push(await sample("load"));
  const snapA = await takeSnapshot("load");

  for (let r = 1; r <= ROUNDS; r++) {
    await centerOn(PPF_HIGH);   // crosses the hi-res gate → Tier-2 re-raster
    await centerOn(PPF_LOW);    // falls back below it
    await page.mouse.move(700, 450);
    await page.mouse.down();
    for (let i = 0; i < 8; i++) await page.mouse.move(700 + i * 20, 450 + i * 10);
    await page.mouse.up();
    for (let e = 0; e < EDITS; e++) await editOnce(e);
    await pacedWait(page, 250);
    rows.push(await sample(`round-${r}`));
    process.stderr.write(`  round ${r}: rss ${rows.at(-1).rssMB} · heap ${rows.at(-1).jsHeapMB} (pre-gc ${rows.at(-1).heapPreGcMB}) · blobs ${rows.at(-1).liveBlobs} · nodes ${rows.at(-1).nodes}\n`);
  }
  const snapB = await takeSnapshot("end");

  const first = rows[0], last = rows.at(-1);
  const out = {
    arm: ARM, rounds: ROUNDS, fixture: FIXTURE, editsPerRound: EDITS, undoAfterEachEdit: !NO_UNDO, census, pdfServed,
    ppfCycle: [PPF_LOW, PPF_HIGH],
    budgetHeapMB: 160,
    rows,
    delta: {
      rssMB: first.rssMB != null && last.rssMB != null ? +(last.rssMB - first.rssMB).toFixed(1) : null,
      rssPerRoundMB: first.rssMB != null && last.rssMB != null ? +((last.rssMB - first.rssMB) / ROUNDS).toFixed(1) : null,
      jsHeapMB: +(last.jsHeapMB - first.jsHeapMB).toFixed(1),
      heapPreGcMB: +(last.heapPreGcMB - first.heapPreGcMB).toFixed(1),
      nodes: last.nodes - first.nodes,
      listeners: last.listeners - first.listeners,
      liveBlobs: last.liveBlobs - first.liveBlobs,
    },
    snapshotDiff: snapA && snapB ? diffAggregates(snapA, snapB, { minBytes: 65536, limit: 15 }) : null,
  };
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
}

run().catch((e) => { console.error(e); process.exit(1); });
