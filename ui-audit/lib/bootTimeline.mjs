/* bootTimeline — where do the four seconds between "the page looks ready" and "the canvas answers
 * a drag" actually go? (NEW-1 of the speed program's phase 3, 2026-07-31)
 *
 * THE NUMBER THIS EXISTS TO EXPLAIN. Phase 2 measured time-to-first-drag at 4x throttle: 4.4–4.9 s,
 * while first-contentful-paint lands under a second. So the app LOOKS ready roughly four seconds
 * before it IS ready, and that gap is the largest single number in the whole speed program —
 * bigger than every frame-time finding put together. Nothing in this repo could say what is in it.
 *
 * WHAT THIS DOES, AND THE TWO HALVES IT KEEPS SEPARATE. A boot is a sequence of WALL-CLOCK
 * segments, and inside each of them the main thread is either doing named work or idle. Reporting
 * only one of those halves is how a boot investigation goes wrong:
 *
 *   1. THE SPINE — exact, in-page timestamps of boot's real boundaries (document response, first
 *      paint, the canvas element existing, the canvas being drawn, the press being delivered, the
 *      drag being serviced). These are events, not estimates: consecutive segments sum EXACTLY to
 *      time-to-first-drag with nothing left over, so a segment can never hide a remainder.
 *   2. THE ATTRIBUTION — a CPU sample profile across that same window, resolved through the build's
 *      SOURCE MAPS (ui-audit/lib/sourceMapIndex.mjs) so a sample lands on `lib/roadGeometry.js` or
 *      `node_modules/react-dom` rather than on `SitePlannerApp-BxMJopPJ.js:7`. Idle is a phase like
 *      any other, because "the main thread was free and we were waiting" is the single most likely
 *      answer and the one a busy-only profile cannot express.
 *
 * ⛔ THE RULE THIS MODULE IS BUILT AROUND: NOTHING MAY HIDE IN A REMAINDER. Every sample that no
 * rule can name is charged to an explicit UNATTRIBUTED row carrying its own milliseconds and its
 * top contributors by name — never folded into a neighbouring bucket, and never silently dropped.
 * A four-second gap with an honest 900 ms "we do not know what this is" line is worth more than a
 * tidy table that adds up because something was rounded into the phase next door.
 *
 * ⚠ WHAT IT CANNOT SEE, stated rather than routed around:
 *   • This sandbox blocks every external host. Runs use `--no-tiles`, so basemap tiles, GIS services
 *     and Supabase are ABSENT, not slow. That makes the measured window a LOWER BOUND on the
 *     owner's — and it also means anything found here is local work that his machine pays too.
 *   • A sample profile is statistical. At the default 250 µs interval a 50 ms phase is ~200 samples,
 *     which is plenty; a 2 ms phase is 8 samples and should not be read as precise.
 *   • Source-map resolution needs a `--sourcemap` build. Without one the attribution degrades to
 *     CHUNK granularity and says so loudly in its own output (never silently).
 */

import { makeSourceLookup } from "./sourceMapIndex.mjs";

/* ---- Phase rules ---------------------------------------------------------------------------
 * Ordered, first match wins, matched against the SOURCE-MAP-RESOLVED path. The order matters:
 * the specific library and subsystem rules must precede the catch-alls, or everything under
 * src/workspaces/site-planner/ collapses into one row and the table says nothing.
 */
export const PHASE_RULES = [
  { phase: "React render & commit", re: /node_modules\/(react-dom|react|scheduler)\// },
  { phase: "Basemap (Leaflet / Esri)", re: /node_modules\/(leaflet|esri-leaflet|@terraformer)/ },
  { phase: "Geometry vendor (Clipper)", re: /node_modules\/clipper-lib/ },
  { phase: "Supabase client", re: /node_modules\/@supabase/ },
  { phase: "Other vendor", re: /node_modules\// },
  { phase: "Site geometry (roads · ponds · contours)", re: /site-planner\/lib\/(roadGeometry|roadNet|roads|pondContours|pondLedger|pond|contour|dissolve|clip|geom|terrain|detentionRules|floodplainMitigation|mhfd)/i },
  { phase: "Model load & normalisation", re: /site-planner\/lib\/(siteModel|elementRows|elementSync|assemblyIntegrity|storage|localDb|parcelSnapshot|sitesRepo|cloud|migrat|rowsTo)/i },
  { phase: "Label layout & collision", re: /site-planner\/lib\/(labelLayout|labelFit|boundaryLabels|calloutLayout|polylabel|screenDeclutter|measureLabel)/i },
  { phase: "GIS layers, fetches & basemap wiring", re: /site-planner\/lib\/(layers|layer[A-Z]|gis|arcgis|basemaps|vectorLayers|vectorOverlay|evidenceLayers|mapStack|mapChromeStack|mapLock|mapSymbols|tile|parcelQuery|counties|jurisdiction|flood[A-Z]|fema|ebfe|wse|demGrid|elevation)/i },
  { phase: "Planner render body (SitePlanner.jsx)", re: /site-planner\/SitePlanner\.jsx/ },
  { phase: "Map finder (MapFinder.jsx)", re: /site-planner\/MapFinder\.jsx/ },
  { phase: "Planner app & panels", re: /site-planner\// },
  { phase: "App shell & routing", re: /src\/(app|main|shared)\// },
  { phase: "Other app code", re: /(^|\/)src\// },
];

/* V8's own pseudo-frames. Each is a real, named answer and none of them may be swept into
 * UNATTRIBUTED: "(idle)" is the whole question this instrument was built to ask, and "(program)"
 * is where script PARSE + COMPILE lands, which is exactly one of the phases the brief names. */
export const V8_FRAMES = new Map([
  ["(idle)", "idle — main thread free"],
  ["(program)", "V8 (program) — parse / compile / VM"],
  ["(garbage collector)", "garbage collection"],
  ["(root)", "idle — main thread free"],
]);

/** Native frames carry no url. They are real work (DOM writes, layout, style) and get their own row. */
export const NATIVE_PHASE = "browser native (DOM · layout · style)";
export const UNATTRIBUTED = "UNATTRIBUTED";

/**
 * Which phase does one profile call frame belong to?
 * @param frame  {functionName, url, lineNumber, columnNumber}
 * @param source the source-map-resolved path, or null when unresolved
 */
export function phaseForFrame(frame, source) {
  const fn = frame?.functionName || "";
  if (V8_FRAMES.has(fn)) return V8_FRAMES.get(fn);
  if (source) {
    for (const rule of PHASE_RULES) if (rule.re.test(source)) return rule.phase;
    return UNATTRIBUTED;
  }
  if (!frame?.url) return NATIVE_PHASE;         // setAttribute, getBoundingClientRect, …
  return UNATTRIBUTED;                          // in a chunk, but no source map could name it
}

/**
 * Aggregate a CDP CPU profile into phases, in milliseconds.
 *
 * `resolve(frame)` returns the resolved source path (or null). Kept as an injected function so
 * this stays pure and the source-map IO lives in the caller.
 *
 * Returns per-phase totals, the explicit UNATTRIBUTED detail, and the sample TIMELINE (one entry
 * per sample: monotonic µs + phase) so the caller can cross-tab phases against the wall spine.
 */
export function attributeProfile(profile, resolve, { window: win = null } = {}) {
  const byId = new Map((profile?.nodes || []).map((n) => [n.id, n]));
  const byPhase = new Map();
  const unattributedDetail = new Map();
  const timeline = [];
  const samples = profile?.samples || [];
  const deltas = profile?.timeDeltas || [];
  let t = profile?.startTime || 0;
  let totalUs = 0;
  for (let i = 0; i < samples.length; i++) {
    const dt = deltas[i] || 0;
    t += dt;
    if (win && (t < win.fromUs || t > win.toUs)) continue;
    const node = byId.get(samples[i]);
    if (!node) continue;
    const frame = node.callFrame || {};
    const source = resolve ? resolve(frame) : null;
    const phase = phaseForFrame(frame, source);
    byPhase.set(phase, (byPhase.get(phase) || 0) + dt);
    totalUs += dt;
    timeline.push({ tUs: t, phase });
    if (phase === UNATTRIBUTED) {
      const key = `${frame.functionName || "(anonymous)"}  ${(frame.url || "").split("/").pop()}:${(frame.lineNumber || 0) + 1}`;
      unattributedDetail.set(key, (unattributedDetail.get(key) || 0) + dt);
    }
  }
  const ms = (us) => +(us / 1000).toFixed(1);
  const phases = [...byPhase.entries()]
    .map(([phase, us]) => ({ phase, ms: ms(us), pct: totalUs ? +((us / totalUs) * 100).toFixed(1) : 0 }))
    .sort((a, b) => b.ms - a.ms);
  return {
    totalMs: ms(totalUs),
    samples: timeline.length,
    phases,
    unattributed: [...unattributedDetail.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
      .map(([fn, us]) => ({ fn, ms: ms(us) })),
    timeline,
  };
}

/* ---- The wall spine ---------------------------------------------------------------------------
 * Boot's real boundaries. Segments are consecutive PAIRS OF MEASURED MARKS, so they sum EXACTLY
 * from navigation start to time-to-first-drag with nothing left over — the property that stops a
 * remainder hiding in a bucket.
 *
 * ⚠ ORDERED BY MEASUREMENT, NOT BY EXPECTATION, and that is deliberate. The harness's
 * time-to-first-drag definition presses as soon as the canvas ELEMENT exists, which on a slow boot
 * is well before the canvas has finished drawing — so "canvas drawn" genuinely can land after "the
 * press was delivered". A spine that assumed the pretty order would silently emit a negative
 * segment or, worse, a plausible positive one in the wrong place.
 */
export const MARK_LABELS = {
  responseEnd: "HTML received",
  firstScript: "first app script starts",
  fcp: "first contentful paint",
  canvasExists: "planner canvas element exists",
  canvasDrawn: "canvas finished drawing (node count settled)",
  pointerDown: "the press is DELIVERED to the page",
  pointerUp: "the release is delivered",
  dragServiced: "drag serviced — a committed frame (TIME TO FIRST DRAG)",
};

export function spineSegments(marks) {
  const present = Object.entries(MARK_LABELS)
    .map(([mark, label]) => ({ mark, label, at: marks?.[mark] }))
    .filter((m) => Number.isFinite(m.at))
    .sort((a, b) => a.at - b.at);
  const out = [];
  let prev = 0, prevLabel = "navigation start";
  for (const m of present) {
    out.push({ mark: m.mark, from: prevLabel, to: m.label, fromMs: +prev.toFixed(1), at: +m.at.toFixed(1), ms: +Math.max(0, m.at - prev).toFixed(1) });
    prev = m.at; prevLabel = m.label;
  }
  const missing = Object.keys(MARK_LABELS).filter((k) => !Number.isFinite(marks?.[k]));
  return { segments: out, missing };
}

/* ---- Network -------------------------------------------------------------------------------- */
export function classifyRequest(url, base = "") {
  const u = String(url || "");
  if (base && u.startsWith(base)) {
    if (/\.js(\?|$)/.test(u)) return "app JS chunk";
    if (/\.css(\?|$)/.test(u)) return "app CSS";
    if (/\.(png|jpe?g|svg|webp|woff2?)(\?|$)/.test(u)) return "app asset";
    return "app (other)";
  }
  if (/(arcgisonline|services\.arcgis|server\.arcgisonline|basemaps|tile\.openstreetmap)/i.test(u)) return "basemap tiles";
  if (/(supabase\.co|supabase\.in)/i.test(u)) return "Supabase";
  if (/(arcgis|fema|msc\.fema|noaa|usgs|epa\.gov|hcad|fbcad|geogims|nationalmap|hazards)/i.test(u)) return "GIS services";
  if (/fonts\.(googleapis|gstatic)/i.test(u)) return "webfont";
  return "other external";
}

/** Roll a list of {url, startMs, endMs, failed} into per-category counts and wall spans. */
export function networkSummary(requests, base = "") {
  const byCat = new Map();
  for (const r of requests) {
    const cat = classifyRequest(r.url, base);
    const c = byCat.get(cat) || { category: cat, count: 0, failed: 0, firstMs: Infinity, lastMs: 0, bytes: 0 };
    c.count++;
    if (r.failed) c.failed++;
    if (Number.isFinite(r.startMs)) c.firstMs = Math.min(c.firstMs, r.startMs);
    if (Number.isFinite(r.endMs)) c.lastMs = Math.max(c.lastMs, r.endMs);
    c.bytes += r.bytes || 0;
    byCat.set(cat, c);
  }
  return [...byCat.values()]
    .map((c) => ({ ...c, firstMs: Number.isFinite(c.firstMs) ? +c.firstMs.toFixed(0) : null, lastMs: +c.lastMs.toFixed(0) }))
    .sort((a, b) => b.count - a.count);
}

/* ---- Cross-tab: what was the thread doing DURING each spine segment? --------------------------
 * The two halves only become an explanation when they are laid over each other. "3.1 s idle" is a
 * fact; "3.1 s idle AFTER the canvas was drawn and BEFORE the press was delivered" names the
 * culprit. Requires the profile's monotonic clock to be aligned with the page clock; the caller
 * measures that alignment and its uncertainty, and this refuses to report when it is too loose.
 */
export const MAX_ALIGNMENT_UNCERTAINTY_MS = 120;

export function crossTab(timeline, segments, { monoZeroUs, uncertaintyMs }) {
  if (!Number.isFinite(monoZeroUs)) return { rows: null, why: "the profile clock could not be aligned to the page clock" };
  if (uncertaintyMs > MAX_ALIGNMENT_UNCERTAINTY_MS) {
    return { rows: null, why: `the profile↔page clock alignment is only good to ±${Math.round(uncertaintyMs)} ms, which is too loose to attribute segments this short` };
  }
  const rows = [];
  for (const s of segments) {
    const from = s.fromMs, to = s.at;
    const byPhase = new Map();
    for (const p of timeline) {
      const ms = p.tUs / 1000 - monoZeroUs / 1000;
      if (ms < from || ms >= to) continue;
      byPhase.set(p.phase, (byPhase.get(p.phase) || 0) + 1);
    }
    const total = [...byPhase.values()].reduce((a, b) => a + b, 0) || 1;
    const span = Math.max(0, to - from);
    rows.push({
      ...s,
      phases: [...byPhase.entries()]
        .map(([phase, n]) => ({ phase, ms: +((n / total) * span).toFixed(1), pct: +((n / total) * 100).toFixed(1) }))
        .sort((a, b) => b.ms - a.ms),
    });
  }
  return { rows, why: null };
}

/* ---- In-page instrumentation ------------------------------------------------------------------
 * Installed as an init script BEFORE navigation. Deliberately tiny and allocation-light: this runs
 * during the very window it measures, so an expensive observer would move the number it reports.
 * A rAF loop (one already runs for frame sampling) reads two cheap live values per frame; a
 * MutationObserver over the whole document during boot was rejected for exactly that reason.
 */
export function bootMarksScript() {
  return () => {
    const B = { marks: {}, growth: [], longTasks: [] };
    window.__boot = B;
    const mark = (k) => { if (B.marks[k] == null) B.marks[k] = performance.now(); };
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) if (e.name === "first-contentful-paint") B.marks.fcp = e.startTime;
      }).observe({ type: "paint", buffered: true });
    } catch (_) { /* paint timing is optional */ }
    try {
      new PerformanceObserver((l) => { for (const e of l.getEntries()) B.longTasks.push({ start: +e.startTime.toFixed(1), dur: +e.duration.toFixed(1) }); })
        .observe({ type: "longtask", buffered: true });
    } catch (_) { /* long-task timing is optional */ }
    addEventListener("pointerdown", () => mark("pointerDown"), { capture: true, once: true });
    addEventListener("pointerup", () => mark("pointerUp"), { capture: true, once: true });
    let svg = null, settleFrom = 0, lastN = -1;
    const tick = () => {
      const t = performance.now();
      if (!svg) {
        svg = document.querySelector('svg[role=application]');
        if (svg) mark("canvasExists");
      }
      if (svg) {
        const n = svg.getElementsByTagName("*").length;
        if (B.growth.length < 4000) B.growth.push([+t.toFixed(0), n]);
        // "Drawn" = the canvas node count has held still for 250 ms at a non-trivial size. A single
        // frame's count is not a settle: the tree grows in several commits (chrome, then elements,
        // then labels), and calling the first of them "drawn" would put the rest in the next segment.
        if (n !== lastN || n < 50) { lastN = n; settleFrom = t; }
        else if (t - settleFrom > 250) mark("canvasDrawn");
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
}

/** Read the marks back out, folding in navigation + resource timing. Runs in the page. */
export function bootReadScript() {
  return () => {
    const B = window.__boot || { marks: {}, growth: [], longTasks: [] };
    const nav = performance.getEntriesByType("navigation")[0] || null;
    const firstScript = performance.getEntriesByType("resource")
      .filter((r) => r.initiatorType === "script" || /\.js(\?|$)/.test(r.name))
      .reduce((min, r) => Math.min(min, r.startTime), Infinity);
    return {
      marks: {
        ...B.marks,
        responseEnd: nav ? nav.responseEnd : null,
        firstScript: Number.isFinite(firstScript) ? firstScript : null,
        domContentLoaded: nav ? nav.domContentLoadedEventEnd : null,
        loadEvent: nav ? nav.loadEventEnd : null,
      },
      growth: B.growth,
      longTasks: B.longTasks,
      resources: performance.getEntriesByType("resource").map((r) => ({
        url: r.name, startMs: r.startTime, endMs: r.responseEnd, bytes: r.transferSize || 0,
        kind: r.initiatorType,
      })),
      canvasNodes: (() => { const s = document.querySelector('svg[role=application]'); return s ? s.getElementsByTagName("*").length : 0; })(),
      documentNodes: document.getElementsByTagName("*").length,
    };
  };
}

/* ---- Source maps -------------------------------------------------------------------------------
 * Read every `dist/assets/*.js.map` a `--sourcemap` build left behind and return a resolver keyed
 * by chunk basename. Missing maps are NOT an error and NOT a silent degradation: the caller is
 * handed `mapped:false` and prints the attribution as chunk-level with the reason attached.
 */
export async function loadSourceMaps(distDir) {
  const { readdir, readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const dir = join(distDir, "assets");
  let names = [];
  try { names = (await readdir(dir)).filter((f) => f.endsWith(".js.map")); } catch (_) { return { lookups: new Map(), count: 0 }; }
  const lookups = new Map();
  const broken = [];
  for (const name of names) {
    try {
      const map = JSON.parse(await readFile(join(dir, name), "utf8"));
      lookups.set(name.replace(/\.map$/, ""), makeSourceLookup(map));
    } catch (e) {
      /* LOUD-FAILURE. An unreadable map degrades ONE chunk's attribution, and the caller has to be
       * able to say which and why — a silent skip here once turned a missing import into "no source
       * maps found", which reads exactly like "you forgot to build with --sourcemap" and cost a
       * debugging round. Never swallow this. */
      broken.push({ name, why: e.message });
    }
  }
  return { lookups, count: lookups.size, broken };
}

/** frame → resolved source path, or null. Pure given the lookups. */
export function makeFrameResolver(lookups) {
  return (frame) => {
    if (!frame?.url) return null;
    const file = frame.url.split("/").pop().split("?")[0];
    const lookup = lookups.get(file);
    if (!lookup) return null;
    return lookup(frame.lineNumber || 0, frame.columnNumber || 0);
  };
}

/* ---- The run -----------------------------------------------------------------------------------
 * ONE boot, measured end to end. A fresh browser CONTEXT per run, because the thing being measured
 * IS the first load: a reused context carries a warm HTTP cache, a warm V8 code cache and a
 * populated IndexedDB, and would answer a different question every run.
 *
 * INTERLEAVING is the caller's job (`--reps`, arms alternating) — the same discipline every phase
 * of this program has used, because this container's warm-up drift is larger than most of the
 * effects being looked for.
 */
export async function runBootTimeline(browser, opts) {
  const {
    base, seed, sampleUs = 250, cpuThrottle = 1, dpr = 1, noTiles = true,
    distDir, arm = "baseline", drawnCeilingMs = 20000,
  } = opts;
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: dpr });
  await ctx.addInitScript(() => performance.setResourceTimingBufferSize(3000));
  await ctx.addInitScript(seed);
  await ctx.addInitScript(bootMarksScript());
  const page = await ctx.newPage();
  const failed = [];
  page.on("requestfailed", (r) => failed.push({ url: r.url(), failed: true }));
  if (noTiles) await page.route(/^https?:\/\//, (r) => (r.request().url().startsWith(base) ? r.continue() : r.abort()));

  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Performance.enable");
  if (cpuThrottle > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuThrottle });
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: sampleUs });
  await cdp.send("Profiler.start");

  /* `waitUntil: "commit"` — not "load". The window under investigation STARTS at navigation and the
   * load event lands in the middle of it; waiting for load would hand control back after the part
   * we are trying to see. */
  await page.goto(base, { waitUntil: "commit" });
  await page.waitForSelector("svg[role=application]", { timeout: 60_000 });

  /* THE GESTURE IS THE HARNESS'S, DELIBERATELY UNCHANGED — pressed at the canvas centre through
   * CDP the instant the element exists, then a committed animation frame. That IS the definition of
   * time-to-first-drag this whole item exists to explain, and changing it here (a nicer press point,
   * an in-page dispatch that skips the input queue) would explain a number nobody measured. */
  const boxEl = await page.locator("svg[role=application]").boundingBox();
  const cx = boxEl.x + boxEl.width / 2, cy = boxEl.y + boxEl.height / 2;
  const viewOf = () => page.evaluate(() => {
    const s = document.querySelector('[data-testid="planner-canvas"]');
    return s ? `${s.getAttribute("data-view-offx")}|${s.getAttribute("data-view-offy")}|${s.getAttribute("data-view-ppf")}` : null;
  });
  const viewBefore = await viewOf();
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 40, cy + 30, { steps: 4 });
  await page.mouse.up();
  const ttfd = await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => {
    const t = performance.now();
    if (window.__boot) window.__boot.marks.dragServiced = t;
    res(t);
  })));
  const viewAfter = await viewOf();

  /* Let the canvas finish drawing if it has not, so the "canvas drawn" mark exists even when it
   * lands after the press — the spine orders by measurement and reports it wherever it fell. This
   * wait is AFTER time-to-first-drag is already stamped, so it cannot inflate it. */
  await page.waitForFunction(() => window.__boot?.marks?.canvasDrawn != null, { timeout: drawnCeilingMs }).catch(() => null);

  /* CLOCK ALIGNMENT — BY A BURN MARKER IN THE PROFILE ITSELF, not by a round trip.
   *
   * The profile's timestamps are Chrome's monotonic clock in µs; the marks are `performance.now()`
   * ms since this document's time origin. Pairing them by reading both over CDP sounds obvious and
   * MEASURED BADLY: each read queues behind whatever the main thread is doing, and even taking the
   * tightest of eight probes the pairing was only good to ±390 ms — far too loose to attribute a
   * 300 ms segment, so the cross-tab suppressed itself every run (correctly, but uselessly).
   *
   * Instead, put an event in BOTH clocks at once: burn the CPU in a uniquely-named function. It
   * appears in the profile by name (page-evaluated source is not minified) and it records its own
   * `performance.now()` bounds. One anchor, no round trip, and the residual error is one sampling
   * interval rather than a scheduling delay. It runs AFTER time-to-first-drag is stamped, so it
   * cannot inflate the number it exists to explain. */
  const burn = await page.evaluate((ms) => {
    const t0 = performance.now();
    function __bootTimelineClockMark() { let n = 0; const end = performance.now() + ms; while (performance.now() < end) n++; return n; }
    __bootTimelineClockMark();
    return { t0, t1: performance.now() };
  }, 80);
  const { profile } = await cdp.send("Profiler.stop");

  /* Find the marker's samples and pin the two clocks to each other. If it is not in the profile
   * (an interval too coarse to catch it, a profiler that stopped early) the cross-tab is SUPPRESSED
   * with its reason rather than computed from a guessed offset. */
  const markIds = new Set((profile.nodes || []).filter((n) => n.callFrame?.functionName === "__bootTimelineClockMark").map((n) => n.id));
  let markFromUs = Infinity, markToUs = -Infinity, tt = profile.startTime || 0;
  for (let i = 0; i < (profile.samples || []).length; i++) {
    tt += (profile.timeDeltas || [])[i] || 0;
    if (!markIds.has(profile.samples[i])) continue;
    if (tt < markFromUs) markFromUs = tt;
    if (tt > markToUs) markToUs = tt;
  }
  const found = Number.isFinite(markFromUs) && markToUs > markFromUs;
  const monoZeroUs = found ? markFromUs - burn.t0 * 1000 : NaN;
  /* The marker's own width in each clock should agree. What they disagree by IS the uncertainty —
   * measured, not asserted, and dominated by the sampling interval. */
  const uncertaintyMs = found
    ? +Math.abs((markToUs - markFromUs) / 1000 - (burn.t1 - burn.t0)).toFixed(1) + sampleUs / 1000
    : Infinity;

  const read = await page.evaluate(bootReadScript());
  const visibility = await page.evaluate(() => document.visibilityState);
  const { lookups, count: mapCount, broken = [] } = distDir ? await loadSourceMaps(distDir) : { lookups: new Map(), count: 0 };
  const resolve = makeFrameResolver(lookups);
  const attribution = attributeProfile(profile, resolve);
  const { segments, missing } = spineSegments({ ...read.marks, dragServiced: ttfd });
  const cross = crossTab(attribution.timeline, segments, {
    monoZeroUs, uncertaintyMs,
  });
  const network = networkSummary(
    [...read.resources.map((r) => ({ ...r, failed: false })), ...failed],
    base
  );

  await ctx.close();
  return {
    arm, ttfdMs: +ttfd.toFixed(0), visibility, viewMoved: viewBefore !== viewAfter,
    sourceMaps: { chunks: mapCount, mapped: mapCount > 0, broken },
    marks: read.marks, segments, missingMarks: missing,
    attribution: { totalMs: attribution.totalMs, samples: attribution.samples, phases: attribution.phases, unattributed: attribution.unattributed },
    crossTab: cross,
    alignment: { uncertaintyMs, markerFound: found, markerWidthMs: found ? +((markToUs - markFromUs) / 1000).toFixed(1) : null, burnMs: +(burn.t1 - burn.t0).toFixed(1) },
    network,
    longTasks: read.longTasks,
    growth: read.growth,
    canvasNodes: read.canvasNodes,
    documentNodes: read.documentNodes,
  };
}
