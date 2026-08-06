/* bootTail — WHAT IS THE APP DOING FOR THE TWO SECONDS AFTER THE CANVAS IS ALREADY DRAWN?
 * (NEW-1 of the speed program's phase 4, 2026-08-06.)
 *
 * THE NUMBER THIS EXISTS TO EXPLAIN, and why it is now the largest unexplained one.
 * B1431 attributed navigation → first drag and B1442 then removed the drainage auto-check from
 * the boot path ENTIRELY and re-measured: with nothing fetched on open, the app still spends
 * **2,216 ms working after the canvas is drawn**, 98–99% busy. The owner's words are the shape of
 * it: *"it immediately loads super fast, and then literally three seconds later it's lagging
 * again."* The drainage pass was the prime suspect and it is not the cliff.
 *
 * ⛔ THIS MODULE FIXES NOTHING. It is the instrument behind a BREAKDOWN. Every rule here exists to
 * stop a tidy table being mistaken for an explanation.
 *
 * THE THREE THINGS IT KEEPS SEPARATE, because conflating any two of them is how a tail gets
 * "explained" twice:
 *
 *   1. THE WINDOW — canvas-drawn → SETTLED. B1431's spine ended at the first drag, which is a
 *      DRIVER-CHOSEN moment, not a property of the app; the tail is the app's own. "Settled" here
 *      is defined by OBSERVED SILENCE (`settlePoint`): the last moment anything happened, followed
 *      by an unbroken quiet run. A run that never goes quiet inside the ceiling is reported as
 *      NOT SETTLED with its reason — never rounded down to the ceiling and presented as a tail.
 *   2. THE ATTRIBUTION — a CPU sample profile over exactly that window, resolved through the
 *      build's source maps, with everything no rule can name charged to an explicit UNATTRIBUTED
 *      row. B1431 got that to 0.8%; that is the standard this holds to.
 *   3. THE LEDGER — WHEN each candidate landed. An attribution says a phase cost 300 ms; it cannot
 *      say the layers arrived at 1.4 s. Candidates are hypotheses to KILL, and killing one needs a
 *      timestamp: a layer that never becomes visible, an IndexedDB store that is never opened and
 *      a Supabase fetch that never fires are all REFUTATIONS, and each is worth more than another
 *      phase row.
 *
 * ⚠ WHAT IT CANNOT SEE, stated rather than routed around:
 *   • This sandbox blocks every external host. Aerial tiles are served LOCALLY by the fake-tile
 *     shim (lib/fakeTile.mjs) so decode and texture upload are real, but GIS services and Supabase
 *     are ABSENT, not slow — so the tail measured here is a LOWER BOUND on the owner's.
 *   • This container has 4 cores; the owner's machine has 28. Parallel-friendly work (raster,
 *     decode, GC) is relatively DEARER here, main-thread-serial work is comparable.
 *   • A sample profile is statistical: at 250 µs a 50 ms phase is ~200 samples and a 2 ms phase is
 *     8. Small rows are not precise and are not presented as if they were.
 */

/* ---- 1. THE WINDOW -----------------------------------------------------------------------------
 *
 * "Settled" cannot be a fixed wait, because a fixed wait answers a question about the harness. It
 * is defined here as: the last ACTIVITY event after which nothing at all happened for `quietMs`.
 * Activity is deliberately over-inclusive — a React commit, any DOM mutation, a long task, a
 * network response, an IndexedDB read — because a window that ends while one of those is still
 * firing is not a tail, it is a truncation.
 */
export const DEFAULT_QUIET_MS = 750;

/**
 * @param events    [{tMs, kind, name?}] — activity events, any order.
 * @param from      window start (ms, page clock). Events at or before this are ignored.
 * @param observedTo the last moment the harness was actually watching. A gap that runs to here is
 *                  only a settle if it is at least `quietMs` long — otherwise we simply stopped
 *                  looking, which is not the same thing and must never be reported as one.
 */
export function settlePoint(events, { from, observedTo, quietMs = DEFAULT_QUIET_MS } = {}) {
  const after = (events || [])
    .filter((e) => Number.isFinite(e?.tMs) && e.tMs > from && e.tMs <= observedTo)
    .sort((a, b) => a.tMs - b.tMs);
  if (!after.length) {
    return observedTo - from >= quietMs
      ? { settled: true, settledAtMs: +from.toFixed(1), tailMs: 0, lastEvent: null, events: 0, why: null }
      : { settled: false, settledAtMs: null, tailMs: null, lastEvent: null, events: 0, why: `nothing happened after the canvas was drawn, but the harness only watched for ${Math.round(observedTo - from)} ms — shorter than the ${quietMs} ms quiet run a settle requires` };
  }
  for (let i = 0; i < after.length; i++) {
    const next = i + 1 < after.length ? after[i + 1].tMs : observedTo;
    if (next - after[i].tMs >= quietMs) {
      return {
        settled: true,
        settledAtMs: +after[i].tMs.toFixed(1),
        tailMs: +(after[i].tMs - from).toFixed(1),
        lastEvent: after[i],
        events: i + 1,
        why: null,
      };
    }
  }
  const last = after[after.length - 1];
  return {
    settled: false, settledAtMs: null, tailMs: null, lastEvent: last, events: after.length,
    why: `the page never went quiet for ${quietMs} ms inside the ${Math.round(observedTo - from)} ms observed — the last activity was "${last.kind}" at ${Math.round(last.tMs)} ms, ${Math.round(observedTo - last.tMs)} ms before the harness stopped watching. The tail is AT LEAST ${Math.round(observedTo - from)} ms and this run cannot say how much longer.`,
  };
}

/* ---- 2. THE ATTRIBUTION ------------------------------------------------------------------------
 * `attributeProfile` (lib/bootTimeline.mjs) already does the work and already takes a window. What
 * is added here is the BUSY/IDLE split stated first and the UNATTRIBUTED share stated as a
 * percentage against B1431's 0.8% standard, so a degraded run is visible rather than plausible.
 */
export function tailQuality(attribution, { standardPct = 0.8 } = {}) {
  const rows = attribution?.phases || [];
  const total = rows.reduce((a, r) => a + r.ms, 0);
  const un = rows.find((r) => r.phase === "UNATTRIBUTED");
  const idle = rows.filter((r) => r.phase.startsWith("idle")).reduce((a, r) => a + r.ms, 0);
  const unPct = total ? +((100 * (un?.ms || 0)) / total).toFixed(2) : 0;
  return {
    totalMs: +total.toFixed(1),
    busyMs: +(total - idle).toFixed(1),
    idleMs: +idle.toFixed(1),
    busyPct: total ? +(((total - idle) / total) * 100).toFixed(1) : 0,
    unattributedMs: +(un?.ms || 0).toFixed(1),
    unattributedPct: unPct,
    meetsStandard: unPct <= standardPct,
    standardPct,
  };
}

/* ---- 3. THE LEDGER ------------------------------------------------------------------------------
 * A chronological roll-up of the activity stream, so "what landed between t=1s and t=3s" is a
 * table rather than an inference. Buckets are fixed-width and every bucket in the window is
 * emitted — including empty ones, because a gap is a finding.
 */
export function ledgerBuckets(events, { from, to, bucketMs = 250 } = {}) {
  const n = Math.max(1, Math.ceil((to - from) / bucketMs));
  const out = Array.from({ length: n }, (_, i) => ({
    fromMs: +(from + i * bucketMs).toFixed(0),
    toMs: +Math.min(to, from + (i + 1) * bucketMs).toFixed(0),
    byKind: {}, total: 0, names: [],
  }));
  for (const e of events || []) {
    if (!Number.isFinite(e?.tMs) || e.tMs < from || e.tMs >= to) continue;
    const b = out[Math.min(n - 1, Math.floor((e.tMs - from) / bucketMs))];
    b.byKind[e.kind] = (b.byKind[e.kind] || 0) + (e.count || 1);
    b.total += e.count || 1;
    if (e.name && b.names.length < 6 && !b.names.includes(e.name)) b.names.push(e.name);
  }
  return out;
}

/** First occurrence of each named candidate, or an explicit "never" — a refutation is a result. */
export function firstSightings(events, candidates) {
  return candidates.map((c) => {
    const hit = (events || [])
      .filter((e) => e.kind === c.kind && (!c.match || c.match.test(e.name || "")))
      .sort((a, b) => a.tMs - b.tMs)[0];
    return { candidate: c.label, kind: c.kind, atMs: hit ? +hit.tMs.toFixed(0) : null, name: hit?.name || null,
      verdict: hit ? "OBSERVED" : "NEVER HAPPENED — hypothesis refuted for this run" };
  });
}

/* ---- 4. THE PAN LADDER --------------------------------------------------------------------------
 *
 * ⛔ THE METRIC IS MAIN-THREAD WORK PER GESTURE, NOT A FRAME MEDIAN, and that is not a preference.
 * B1432 reported a ±99.8% floor and was blocked by it in all three regimes; the cause was 16.7 ms
 * display-clock quantisation in the metric itself, so no number of repeats could ever have cleared
 * it. session-axes.mjs fixed it by differencing the renderer's own cumulative counters at
 * microsecond resolution, and reached ±11.1%. The same metric is used here.
 *
 * ⛔ AND THE FLOOR IS COMPUTED WITHOUT A FRAME QUANTUM. `noiseFloor` (lib/longSession.mjs) floors
 * at one frame quantum, which is correct for a frame median and WRONG here: it would impose a
 * 16.7 ms floor on a metric that has no frame grid in it, quietly making a real 20 ms difference
 * unreportable. Same shape, no quantum, and the difference is stated rather than assumed.
 */
export function workNoiseFloor(reps) {
  const v = (reps || []).filter((x) => typeof x === "number" && x > 0);
  if (v.length < 2) return { floorPct: null, why: "fewer than two clean repeats — no floor can be stated" };
  const s = [...v].sort((a, b) => a - b);
  const med = s[Math.floor(s.length / 2)];
  const spread = s[s.length - 1] - s[0];
  return { floorPct: +(((spread / med) * 100)).toFixed(1), median: +med.toFixed(2), min: +s[0].toFixed(2), max: +s[s.length - 1].toFixed(2), n: v.length, why: null };
}

export const median = (a) => {
  const s = (a || []).filter((x) => typeof x === "number").sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

/**
 * Does the SAME gesture cost more at t=3s than at t=1s?
 * @param rungs [{tSec, workMs:[…]}] — one entry per delay rung, repeats inside.
 * @param floorPct the measured noise floor, in per cent. Without one, nothing is a finding.
 */
export function ladderVerdict(rungs, { floorPct = null, fromSec = 1, toSec = 3 } = {}) {
  const rows = (rungs || []).map((r) => {
    const clean = (r.workMs || []).filter((x) => typeof x === "number" && x > 0);
    return { tSec: r.tSec, n: clean.length, medianMs: median(clean), minMs: clean.length ? Math.min(...clean) : null, maxMs: clean.length ? Math.max(...clean) : null };
  }).sort((a, b) => a.tSec - b.tSec);
  const base = rows.find((r) => r.tSec === fromSec && r.medianMs != null);
  const withDelta = rows.map((r) => ({
    ...r,
    deltaPct: base && r.medianMs != null ? +(((r.medianMs - base.medianMs) / base.medianMs) * 100).toFixed(1) : null,
  }));
  const target = withDelta.find((r) => r.tSec === toSec);
  let answer;
  if (!base || !target || target.deltaPct == null) {
    answer = `CANNOT SAY — the t=${fromSec}s and t=${toSec}s rungs did not both produce a clean measurement.`;
  } else if (floorPct == null) {
    answer = `CANNOT SAY — no noise floor was measured, so ${target.deltaPct > 0 ? "+" : ""}${target.deltaPct}% is a number, not a finding.`;
  } else if (Math.abs(target.deltaPct) <= floorPct) {
    answer = `NO — the same pan at t=${toSec}s costs ${target.deltaPct > 0 ? "+" : ""}${target.deltaPct}% of what it cost at t=${fromSec}s, which is INSIDE the measured ±${floorPct}% floor.`;
  } else {
    answer = `YES — the same pan at t=${toSec}s costs ${target.deltaPct > 0 ? "+" : ""}${target.deltaPct}% of what it cost at t=${fromSec}s, which CLEARS the ±${floorPct}% floor.`;
  }
  return { rows: withDelta, floorPct, answer };
}

/* ---- 5. In-page instrumentation ------------------------------------------------------------------
 *
 * Installed as an init script BEFORE navigation, so it is present before React is. Two of these are
 * REAL counts rather than proxies, deliberately, because the item asked for the actual number:
 *
 *  • REACT COMMITS. React looks for `__REACT_DEVTOOLS_GLOBAL_HOOK__` when it initialises and calls
 *    `onCommitFiberRoot` on EVERY commit. Providing a minimal hook is how DevTools itself counts
 *    them; it is the renderer's own event, not an inference from mutations. If React never injects
 *    (the hook shape changed, a build without the DevTools call), `reactCommits` reports `null` and
 *    says so — it never falls back to a mutation count while still calling itself a commit count.
 *  • INDEXEDDB READS. `IDBObjectStore.prototype.get`/`getAll` are wrapped so a read is recorded with
 *    its store name and completion time. That turns "is parcel-snapshot hydration in the tail?" into
 *    an observation instead of a guess.
 *
 * Everything else (mutations, long tasks, network) is recorded as what it is and labelled as such.
 * ⚠ THE OBSERVER COST IS REAL AND IS DECLARED: a document-wide MutationObserver during the window
 * it measures does add work. It is used because the alternative — inferring commits from frames —
 * is what this instrument exists to stop, and because the same observer is present in every arm, so
 * comparisons between arms are unaffected. Absolute tail numbers carry it; the harness prints how
 * many records it saw so the reader can judge.
 */
export function tailInstrumentScript() {
  return () => {
    const T = {
      events: [], commits: 0, commitHookInstalled: false, reactInjected: false,
      mutationRecords: 0, mutationBatches: 0, idbReads: 0, longTasks: [],
      marks: {}, installed: {}, failed: {},
    };
    window.__tail = T;
    const push = (kind, name, count) => { if (T.events.length < 40000) T.events.push({ tMs: +performance.now().toFixed(1), kind, name: name || null, count: count || 1 }); };
    /* ⛔ LOUD-FAILURE. Every observer below reports whether it INSTALLED. The first run of this
     * instrument had three of them fail silently inside a bare `catch {}` — the MutationObserver
     * because `document.documentElement` is null at document-start — and the output was a
     * perfectly plausible "0 mutation records", which reads as "the app was quiet" and is the
     * single most dangerous thing this instrument could print. An observer that did not install
     * now says so by name, and the harness refuses to call its absence silence. */
    const install = (name, fn) => { try { fn(); T.installed[name] = true; } catch (e) { T.failed[name] = String(e && e.message || e); } };

    /* REACT'S OWN COMMIT EVENT. Must exist before React's module init runs. */
    install("react-commit-hook", () => {
      if (!window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
        let nextId = 1;
        const renderers = new Map();
        window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
          renderers, supportsFiber: true, isDisabled: false,
          inject(renderer) { const id = nextId++; renderers.set(id, renderer); T.reactInjected = true; return id; },
          onCommitFiberRoot() { T.commits++; push("react-commit"); },
          onPostCommitFiberRoot() {},
          onCommitFiberUnmount() {},
          checkDCE() {},
          on() {}, off() {}, sub() { return () => {}; }, emit() {}, getFiberRoots() { return new Set(); },
        };
        T.commitHookInstalled = true;
      }
    });

    /* DOM mutations, batched. Region is recorded because "the canvas re-emitted" and "a panel
     * re-rendered" are different diagnoses.
     * ⚠ OBSERVE `document`, NOT `document.documentElement` — at document-start the <html> element
     * does not exist yet, so observing it throws and the whole observer is lost. `document` is a
     * node and accepts a subtree observation that covers everything added afterwards. */
    install("mutation-observer", () => {
      const region = (n) => {
        let el = n && n.nodeType === 1 ? n : n?.parentElement;
        for (let i = 0; el && i < 12; i++, el = el.parentElement) {
          if (el.matches?.('svg[role=application]')) return "canvas";
          if (el.classList?.contains("leaflet-container") || el.classList?.contains("leaflet-pane")) return "map";
          if (el.getAttribute?.("data-testid")?.startsWith("floating-panel-") || el.getAttribute?.("data-testid") === "left-menu-panel") return "panel";
        }
        return "chrome";
      };
      new MutationObserver((records) => {
        T.mutationBatches++;
        T.mutationRecords += records.length;
        const byRegion = {};
        for (const r of records) { const k = region(r.target); byRegion[k] = (byRegion[k] || 0) + 1; }
        for (const k of Object.keys(byRegion)) push("mutation", k, byRegion[k]);
      }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    });

    install("longtask-observer", () => {
      new PerformanceObserver((l) => { for (const e of l.getEntries()) { T.longTasks.push({ start: +e.startTime.toFixed(1), dur: +e.duration.toFixed(1) }); push("longtask", null); } })
        .observe({ type: "longtask", buffered: true });
    });
    /* ⚠ CLASSIFY THE WHOLE URL, never its last path segment. An ArcGIS tile is `.../13/2145/3410`
     * — no extension, no word "tile" — so a name taken from the tail of the path matched nothing
     * and the first run of this instrument reported "an aerial tile arrived: NEVER HAPPENED" while
     * 246 tiles were being served and 114 were in the DOM. A refutation that is really a broken
     * matcher is worse than no candidate list at all. */
    install("resource-observer", () => {
      const classify = (u) => (
        /supabase\.(co|in)/i.test(u) ? "supabase"
          : /\/tile\/|\/tiles\/|MapServer\/tile|arcgisonline|openstreetmap|basemaps/i.test(u) ? "tile"
            : /arcgis|fema|noaa|usgs|epa\.gov|hcad|fbcad|geogims|nationalmap|hazards/i.test(u) ? "gis"
              : /\.js(\?|$)/.test(u) ? "app-js"
                : /\.css(\?|$)/.test(u) ? "app-css" : "other"
      );
      new PerformanceObserver((l) => { for (const e of l.getEntries()) push("network", classify(e.name || "")); })
        .observe({ type: "resource", buffered: true });
    });

    /* THE CANVAS'S OWN TWO MOMENTS, and keeping them apart is the difference between measuring the
     * tail and measuring nothing.
     *   • FIRST INK — the first frame the plan canvas holds real content. This is the moment the
     *     owner describes as "it immediately loads super fast", and it is the START of his tail.
     *   • NODE COUNT SETTLED — B1431's `canvasDrawn`, which requires 250 ms of a STILL node count.
     *     That definition has a quiet period BUILT INTO IT, so a window that starts there has
     *     already excluded a quarter-second of the work it exists to find. Both are recorded and
     *     both are reported; neither is presented as the other. */
    install("canvas-watch", () => {
      let svg = null, last = -1, settleFrom = 0;
      const tick = () => {
        const t = performance.now();
        if (!svg) svg = document.querySelector("svg[role=application]");
        if (svg) {
          const n = svg.getElementsByTagName("*").length;
          if (n >= 50 && T.marks.canvasInk == null) T.marks.canvasInk = +t.toFixed(1);
          if (n !== last || n < 50) { last = n; settleFrom = t; }
          else if (t - settleFrom > 250 && T.marks.canvasSettled == null) T.marks.canvasSettled = +t.toFixed(1);
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    /* IndexedDB reads, by store. Wrapping the prototype catches every caller including ones that
     * have not been written yet — which is the point: the candidate list must not be a whitelist. */
    install("idb-wrap", () => {
      for (const fn of ["get", "getAll", "getAllKeys", "count"]) {
        const orig = IDBObjectStore.prototype[fn];
        if (typeof orig !== "function") continue;
        IDBObjectStore.prototype[fn] = function (...args) {
          const store = this.name, req = orig.apply(this, args);
          T.idbReads++;
          try { req.addEventListener("success", () => push("idb", `${store}.${fn}`)); } catch (_) {}
          return req;
        };
      }
    });
  };
}

/** Read the tail instrument back out, plus the observables the candidate list needs. Runs in page. */
export function tailReadScript() {
  return () => {
    const T = window.__tail || {};
    const svg = document.querySelector('svg[role=application]');
    /* A LAYER IS COUNTED WHEN IT IS VISIBLE, not when it is configured. The app's overlay state is
     * internal; what a reader can check is the DOM the map actually holds. */
    const leafletLayers = [...document.querySelectorAll(".leaflet-pane > .leaflet-layer, .leaflet-pane > svg, .leaflet-pane > canvas")].length;
    return {
      events: T.events || [],
      marks: T.marks || {},
      installed: T.installed || {},
      /* An observer that did not install is a HOLE IN THE MEASUREMENT and is returned as one. The
       * caller prints it before any number that depends on it. */
      failed: T.failed || {},
      commits: T.commitHookInstalled && T.reactInjected ? T.commits : null,
      commitsWhy: T.commitHookInstalled
        ? (T.reactInjected ? null : "React never called inject() on the DevTools hook — commit count unavailable, and NOT substituted with a mutation count")
        : "a DevTools hook was already present, so this harness did not install its own",
      mutationRecords: T.mutationRecords || 0,
      mutationBatches: T.mutationBatches || 0,
      idbReads: T.idbReads || 0,
      longTasks: T.longTasks || [],
      canvasNodes: svg ? svg.getElementsByTagName("*").length : 0,
      documentNodes: document.getElementsByTagName("*").length,
      leafletLayers,
      leafletTiles: document.querySelectorAll("img.leaflet-tile").length,
      overlayRows: [...document.querySelectorAll('input[type=checkbox]')].filter((b) => b.checked).length,
    };
  };
}

/** The candidate list the item names, expressed as observable first-sightings. */
export const TAIL_CANDIDATES = [
  { label: "a saved GIS/view layer became visible", kind: "layer" },
  { label: "an IndexedDB read completed (parcel snapshot / underlay raster)", kind: "idb" },
  { label: "a Supabase request (auth / cloud site fetch)", kind: "network", match: /^supabase$/ },
  { label: "an aerial tile arrived", kind: "network", match: /^tile$/ },
  { label: "a GIS service request", kind: "network", match: /^gis$/ },
  { label: "a long task (≥50 ms)", kind: "longtask" },
];
