/* sessionGrowth — WHAT GROWS ACROSS A SESSION AND IS ZEROED BY A RELOAD? (NEW-2, B1121)
 *
 * ⛔ READ THE SIGNATURE FIRST, BECAUSE IT IS A FILTER AND NOT A FLOURISH.
 *
 * The owner's report has been verbatim-stable for weeks: *"if I reload, it's immediately pretty
 * quick and then, like, give it some panning or zooming or I don't even know, and then, you know,
 * a minute later or two, it's, like, lagging just to go side to side."*
 *
 * That sentence contains TWO facts, and this repo has spent a program's worth of effort on the
 * first while never once using the second:
 *
 *   1. cost RISES with time-in-session   ← every prior instrument measured this
 *   2. cost is RESTORED by a reload      ← nothing has ever measured this, and it EXCLUDES things
 *
 * Fact 2 is the sharper of the two, because it is an ELIMINATOR rather than a detector. A reload
 * destroys the document, the JS heap, the DOM, every listener, every timer, every in-memory cache
 * and the whole React tree. It does NOT destroy localStorage, IndexedDB, the HTTP cache, the V8
 * code cache, the service worker's caches, the GPU process, or anything on a server. So:
 *
 *   ⇒ ANY CANDIDATE THAT SURVIVES A RELOAD CANNOT, BY ITSELF, EXPLAIN THIS SYMPTOM.
 *
 * If the mechanism were "IndexedDB filled up", the page would still be slow after the reload,
 * because the store is still full. He says it is fast. That single observation takes the whole
 * durable-storage family off the table — which is most of the candidates a reasonable person
 * enumerates first, and all of the ones this program's storage work (TIER-BY-REBUILDABILITY,
 * B1427/B1429) has recently made most salient.
 *
 * So every candidate below is measured on TWO axes, and both are required:
 *
 *      GROWS over the session?  ×  ZEROED by a reload?  ⇒  can it explain the symptom?
 *      ─────────────────────────────────────────────────────────────────────────────────
 *      grows  ×  resets    →  ADMISSIBLE — the only quadrant a mechanism can live in
 *      grows  ×  persists  →  EXCLUDED by the owner's own reload observation
 *      flat   ×  either    →  EXONERATED — it does not grow, so it explains no slope
 *
 * ⚠ THE ONE CAVEAT ON THE ELIMINATOR, stated here rather than discovered later. A durable store
 * is excluded as *the mechanism* — not as a *contributor to a constant cost*. A store that is
 * permanently large makes every session slower, including the first minute after a reload, which
 * is complaint (b) of B1121 and is a different item. `admissibility()` says "excluded" and names
 * this, so nobody reads it as "harmless".
 *
 * ── THE SECOND THING THIS FILE EXISTS FOR: A STEP IS NOT A SLOPE ────────────────────────────────
 *
 * The dispatch is explicit — *"a before/after pair cannot distinguish a step from a slope, and the
 * owner's report is explicitly a slope."* Two points fit both models perfectly, so a before/after
 * pair cannot even be asked the question. With a CURVE it becomes decidable, and it matters enormously
 * which one it is:
 *
 *   • a SLOPE is an accumulation. It has no ceiling, it gets worse the longer he works, and the fix
 *     is to bound whatever is accumulating.
 *   • a STEP is a mode change — something switched on and stayed on (a layer fetched, a panel
 *     mounted, a heavier render path taken). It is bounded, it does NOT get worse with time, and
 *     the fix is somewhere else entirely.
 *   • a SAWTOOTH is a cache filling and being dropped. It looks like a slope if you sample it at
 *     the wrong moments and like noise if you sample it at the right ones.
 *
 * `classifyCurve` fits all three and reports which one explains the series best, with the residual
 * of each so the reader can disagree with the verdict by disagreeing with a number.
 *
 * ⛔ AND THE RULE THAT KILLS THE MOST TEMPTING ERROR: A CANDIDATE THAT CORRELATES IS A SUSPECT,
 * NEVER A CONVICTION. Everything in a session rises together — heap, nodes, tiles, listeners, time
 * itself — so with a monotone cost curve, half the registry will correlate at r > 0.9 by
 * construction. `attribute()` therefore reports correlation ALONGSIDE the two-axis admissibility
 * and never instead of it, and its output tops out at "SUSPECT". B1434's rule stands: do not ship a
 * fix against a signal you cannot explain.
 *
 * Pure and dependency-free → unit-tested in test/sessionGrowth.test.js, and shared with
 * ui-audit/session-growth.mjs so the report cannot claim a rule the harness does not apply.
 */

/* ── The enumeration ─────────────────────────────────────────────────────────────────────────────
 *
 * ⛔ DECLARED BEFORE ANY MEASUREMENT, WHICH IS THE POINT. The dispatch asked for the candidates to
 * be enumerated first *"so the sweep is not shaped by whichever one you thought of first."* This
 * list is that pre-registration. It is committed, so a later session can see what was looked for —
 * and, more usefully, what was NOT.
 *
 * Fields:
 *   `id`         — stable key, matches the counter the harness samples.
 *   `family`     — how it is grouped in the report.
 *   `resets`     — "yes" | "no" | "measure". THE PREDICTION, made in advance. "measure" means the
 *                  answer is not obvious from first principles and the harness must go and look.
 *                  A prediction that the run contradicts is the most valuable output here.
 *   `why`        — why this is a plausible mechanism for THIS symptom, not just why it exists.
 *   `observable` — whether the harness can actually see it, and by what means. `null` means it
 *                  cannot, and that is recorded rather than quietly dropped: an unmeasured
 *                  candidate is an open question, not an exonerated one.
 */
export const GROWTH_CANDIDATES = [
  /* ---- In-page: the only quadrant a mechanism can live in ------------------------------------ */
  {
    id: "heapMB", family: "memory", unit: "MB", resets: "yes",
    title: "JS heap in use",
    why: "the broadest in-page accumulator; a rising heap means something is retained, and GC pressure itself costs main-thread time",
    observable: "performance.memory.usedJSHeapSize (needs --enable-precise-memory-info)",
  },
  {
    id: "retainedHeapMB", family: "memory", unit: "MB", resets: "yes",
    title: "Retained heap after a forced collection",
    why: "usedJSHeapSize includes garbage not yet collected, so a rising raw heap can be nothing at all; the retained figure after a forced GC is the one that means something is HELD",
    observable: "CDP HeapProfiler.collectGarbage then Performance.getMetrics JSHeapUsedSize",
  },
  {
    id: "rendererNodes", family: "dom", unit: "nodes", resets: "yes",
    title: "Renderer nodes (live + detached)",
    why: "the renderer-wide node total; if it outruns the live tree the difference is detached DOM, which is the classic accumulate-until-reload leak",
    observable: "CDP Performance.getMetrics Nodes",
  },
  {
    id: "detachedApprox", family: "dom", unit: "nodes", resets: "yes",
    title: "Detached nodes (renderer total − live tree)",
    why: "THE canonical shape of this symptom: a tree removed from the document but still referenced, so style and layout no longer touch it but memory and GC do",
    observable: "CDP Nodes minus an in-page TreeWalker census — an approximation, and labelled as one",
  },
  {
    id: "canvasNodes", family: "dom", unit: "nodes", resets: "yes",
    title: "SVG nodes inside the planner canvas",
    why: "what a pan actually pays for: every node in the canvas is re-styled and re-laid-out per frame, so growth here is growth in the cost of the exact gesture he reports",
    observable: "svg.getElementsByTagName('*').length",
  },
  {
    id: "documentNodes", family: "dom", unit: "nodes", resets: "yes",
    title: "Elements in the live document",
    why: "chrome, panels and portals that mount and never unmount",
    observable: "document.getElementsByTagName('*').length",
  },
  {
    id: "layoutObjects", family: "dom", unit: "objects", resets: "yes",
    title: "Layout objects",
    why: "the renderer's own count of boxes it must lay out; the closest thing to a direct price on 'the page got heavier'",
    observable: "CDP Performance.getMetrics LayoutObjects",
  },
  {
    id: "jsEventListenersCdp", family: "listeners", unit: "listeners", resets: "yes",
    title: "Event listeners (renderer's own count)",
    why: "a listener per gesture that is never removed both retains its closure's captures and adds per-event dispatch work — the textbook slope",
    observable: "CDP Performance.getMetrics JSEventListeners — the independent authority, not the harness's own tally",
  },
  {
    id: "rafLive", family: "loops", unit: "callbacks", resets: "yes",
    title: "Animation-frame callbacks in flight",
    why: "B874's class: a refresh loop that re-arms itself and is never cancelled runs forever and starves every frame after it",
    observable: "wrapped requestAnimationFrame / cancelAnimationFrame",
  },
  {
    id: "timersLive", family: "loops", unit: "timers", resets: "yes",
    title: "Timers outstanding",
    why: "same class as above through setInterval/setTimeout; an interval per mount with no teardown accumulates one wake-up per mount, forever",
    observable: "wrapped setTimeout / setInterval / clear*",
  },
  {
    id: "observersLive", family: "loops", unit: "observers", resets: "yes",
    title: "Observers still connected",
    why: "a ResizeObserver or MutationObserver per mount that is never disconnected keeps firing on a detached target and keeps it alive",
    observable: "subclassed MutationObserver / ResizeObserver / IntersectionObserver / PerformanceObserver",
  },
  {
    id: "tiles", family: "map", unit: "tiles", resets: "yes",
    title: "Basemap tile elements retained",
    why: "B1121's own found-and-fixed defect was an uncapped backfill tile layer; this is the regression guard on that cap under a real mixed session rather than under a unit test",
    observable: "img.leaflet-tile count, per layer",
  },
  {
    id: "tilesLoaded", family: "map", unit: "tiles", resets: "yes",
    title: "Basemap tiles that actually DECODED",
    why: "decoded bitmaps are the memory that heap snapshots cannot see — the wrong-instrument problem this whole item was filed on",
    observable: ".leaflet-tile-loaded count (zero unless --fake-tiles, and reported as zero rather than hidden)",
  },
  {
    id: "compositorLayers", family: "map", unit: "layers", resets: "yes",
    title: "Compositor layers",
    why: "each promoted layer is a texture the compositor must hold and re-composite; growth here costs GPU memory and frame time without touching the JS heap at all",
    observable: "CDP LayerTree",
  },
  {
    id: "featuresDrawn", family: "model", unit: "features", resets: "yes",
    title: "Drawn features actually in the canvas (all five kinds)",
    why: "THE CONTROL. This is load, not a leak — if it rises, the gesture got dearer for an honest reason and the run is measuring B1357's r=0.93 axis instead of an accumulation. NEW-2: counted across el / markup / measure / callout / parcel, because the element-only version it replaced was blind to four fifths of a plan and could read flat while the canvas filled up",
    observable: "distinct [data-feature] keys inside the canvas",
  },
  {
    id: "elementsDrawn", family: "model", unit: "elements", resets: "yes",
    title: "Of those, the ones that are elements",
    why: "tier detail beside the control above — useful for attributing a rise, never the control itself",
    observable: "[data-el-id] count inside the canvas (el-tier: named as the element slice)",
  },
  {
    id: "planSwitches", family: "model", unit: "switches", resets: "yes",
    title: "Plan / revision switches made",
    why: "the driver's own count, so the plan-switch retention question is answered on a session that actually switched plans rather than on a single A→B→A",
    observable: "the harness's own tally, proven by the element count changing",
  },

  /* ---- Durable: excluded as a MECHANISM by the reload observation, measured anyway ------------- */
  {
    id: "localStorageBytes", family: "durable", unit: "KB", resets: "no",
    title: "localStorage in use",
    why: "the small tier (~5 MB hard cap) holding autosave, the version ring and the cloud index. It grows through a session — but it SURVIVES the reload, so it cannot be what the reload fixes. Measured because TIER-BY-REBUILDABILITY makes it the first thing a reader will ask about",
    observable: "sum of key+value lengths",
  },
  {
    id: "idbUsageMB", family: "durable", unit: "MB", resets: "no",
    title: "Origin storage in use (IndexedDB and friends)",
    why: "the large tier: rasters, the GIS cache's persistent half, parcel snapshots. Same exclusion as above, and the same reason to measure it",
    observable: "navigator.storage.estimate().usage",
  },

  /* ---- Named, and NOT observable from outside the app. Recorded rather than dropped ----------- */
  {
    id: "undoDepth", family: "model", unit: "frames", resets: "yes", observable: null,
    title: "Undo / redo history depth",
    why: "an obvious accumulator that rises with edits and dies on reload — the right shape exactly. B1331 measured it at 0.4 MB and found it innocent; nothing has re-measured it since, and it is not reachable from outside the app",
  },
  {
    id: "gisCacheEntries", family: "cache", unit: "entries", resets: "measure", observable: null,
    title: "GIS screening cache, in-memory half",
    why: "grows per fetched layer per view; its persistent half survives a reload and its in-memory half does not, so the two halves land in DIFFERENT quadrants and only one of them is admissible",
  },
  {
    id: "pendingJournalOps", family: "sync", unit: "ops", resets: "no", observable: null,
    title: "Pending-edit journal (cloud sync)",
    why: "ROWS-CANONICAL-ON-SEED's journal accumulates per edit until a flush lands. It persists across a reload by design (that is the data-safety guarantee), which excludes it here — and it is signed-in-only, so this sandbox could not exercise it regardless",
  },
  {
    id: "telemetryBuffer", family: "sync", unit: "events", resets: "yes", observable: null,
    title: "Buffered telemetry events",
    why: "a buffer that fills per interaction and drains on a schedule; if a drain fails it fills forever. Small, but the right shape, and invisible from outside",
  },
];

export const candidateById = (id) => GROWTH_CANDIDATES.find((c) => c.id === id) || null;
/** The candidates the harness can actually sample. The rest are the pre-registered open questions. */
export const observableCandidates = () => GROWTH_CANDIDATES.filter((c) => c.observable);
export const unobservableCandidates = () => GROWTH_CANDIDATES.filter((c) => !c.observable);

/* ── Fits ────────────────────────────────────────────────────────────────────────────────────────
 *
 * Three models, one series, and the winner is whichever leaves the least unexplained. Residual sum
 * of squares is the comparator; each model's parameter count is reported beside it so a reader can
 * see that the step model is being allowed two extra parameters and judge accordingly.
 */

/** Least-squares line through {x, y}. `r` is Pearson's correlation, `rss` the residual sum of squares. */
export function linearFit(points = []) {
  const p = points.filter((q) => Number.isFinite(q?.x) && Number.isFinite(q?.y));
  if (p.length < 2) return null;
  const n = p.length;
  const mx = p.reduce((a, q) => a + q.x, 0) / n;
  const my = p.reduce((a, q) => a + q.y, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const q of p) { sxy += (q.x - mx) * (q.y - my); sxx += (q.x - mx) ** 2; syy += (q.y - my) ** 2; }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  const rss = p.reduce((a, q) => a + (q.y - (intercept + slope * q.x)) ** 2, 0);
  const r = sxx === 0 || syy === 0 ? null : sxy / Math.sqrt(sxx * syy);
  return { slope, intercept, r: r == null ? null : +r.toFixed(4), rss, n, params: 2 };
}

/** The flat model: one parameter, the mean. The null hypothesis every other fit has to beat. */
export function flatFit(points = []) {
  const p = points.filter((q) => Number.isFinite(q?.y));
  if (!p.length) return null;
  const mean = p.reduce((a, q) => a + q.y, 0) / p.length;
  return { mean, rss: p.reduce((a, q) => a + (q.y - mean) ** 2, 0), n: p.length, params: 1 };
}

/**
 * The step model: a mean before a breakpoint and a mean after it, over every breakpoint that leaves
 * at least one point on each side. Returns the best one.
 *
 * ⛔ THE BREAKPOINT IS THE INDEX OF THE FIRST POINT ON THE *AFTER* SIDE — the point at which the
 * new level is first observed. Off-by-one here reports the mode change one checkpoint early and
 * sends the next session hunting in the wrong round.
 */
export function stepFit(points = []) {
  const p = points.filter((q) => Number.isFinite(q?.y));
  if (p.length < 3) return null;
  let best = null;
  for (let k = 1; k < p.length; k++) {
    const a = p.slice(0, k), b = p.slice(k);
    const ma = a.reduce((s, q) => s + q.y, 0) / a.length;
    const mb = b.reduce((s, q) => s + q.y, 0) / b.length;
    const rss = a.reduce((s, q) => s + (q.y - ma) ** 2, 0) + b.reduce((s, q) => s + (q.y - mb) ** 2, 0);
    if (!best || rss < best.rss) {
      best = { at: k, x: p[k].x, before: ma, after: mb, jump: mb - ma, jumpPct: ma === 0 ? null : +(((mb - ma) / Math.abs(ma)) * 100).toFixed(1), rss, n: p.length, params: 3 };
    }
  }
  return best;
}

/* ── The classifier ─────────────────────────────────────────────────────────────────────────── */

/**
 * Which of flat / step / slope / sawtooth best describes this series.
 *
 * `floorPct` is the measured noise floor as a percentage of the first value — the same number every
 * other harness in this repo states, and the classifier REFUSES to name a shape for a series whose
 * whole range fits inside it. That refusal is the single most important branch in this function:
 * a shape fitted to noise is a story, and this program has already paid for four of those.
 *
 * `minImprovement` is how much better (as a fraction of RSS) a two- or three-parameter model must
 * be before it is preferred to the simpler one. Extra parameters ALWAYS fit better; requiring a
 * margin is what stops "step" winning on every series with one noisy point in it.
 */
export function classifyCurve(points = [], { floorPct = null, minImprovement = 0.35 } = {}) {
  const p = points.filter((q) => Number.isFinite(q?.x) && Number.isFinite(q?.y));
  if (p.length < 3) {
    return { shape: "unmeasured", why: `${p.length} usable point(s) — a shape needs at least three, because two points fit a step and a slope equally well and that is the whole question`, points: p.length };
  }
  const ys = p.map((q) => q.y);
  const first = ys[0], last = ys[ys.length - 1];
  const min = Math.min(...ys), max = Math.max(...ys);
  const rangePct = first === 0 ? (max === 0 ? 0 : null) : +(((max - min) / Math.abs(first)) * 100).toFixed(2);
  const netPct = first === 0 ? (last === 0 ? 0 : null) : +(((last - first) / Math.abs(first)) * 100).toFixed(2);

  const base = { points: p.length, first, last, min, max, rangePct, netPct, floorPct };

  if (floorPct != null && rangePct != null && rangePct <= floorPct) {
    return { ...base, shape: "FLAT", why: `the whole series spans ${rangePct}% of its first value, inside the ±${floorPct}% noise floor — nothing here is distinguishable from measurement noise` };
  }

  const flat = flatFit(p), lin = linearFit(p), step = stepFit(p);
  const fits = { flat: flat && { rss: +flat.rss.toFixed(6), params: 1 }, linear: lin && { rss: +lin.rss.toFixed(6), params: 2, slope: +lin.slope.toFixed(6), r: lin.r }, step: step && { rss: +step.rss.toFixed(6), params: 3, at: step.at, x: step.x, jumpPct: step.jumpPct } };

  /* Improvement over the flat null. A model that cannot beat "it is a constant" by the margin is
   * not preferred to it, whatever its RSS. */
  const improves = (fit) => (flat && flat.rss > 0 && fit ? (flat.rss - fit.rss) / flat.rss : 0);
  const linGain = improves(lin), stepGain = improves(step);

  if (linGain < minImprovement && stepGain < minImprovement) {
    /* Nothing explains it. Distinguish "wanders without a trend" from "flat", because a sawtooth is
     * a real and different mechanism — a cache filling and being dropped — and calling it flat
     * would hide it. */
    const shape = rangePct != null && floorPct != null && rangePct > floorPct * 2 ? "SAWTOOTH" : "FLAT";
    return {
      ...base, shape, fits,
      why: shape === "SAWTOOTH"
        ? `the series moves over ${rangePct}% of its first value but neither a slope nor a step explains it (best gain over a constant ${(Math.max(linGain, stepGain) * 100).toFixed(0)}%) — it oscillates, which is what a cache filling and being dropped looks like`
        : `no model beats a constant by the required ${(minImprovement * 100).toFixed(0)}% — this series does not trend`,
    };
  }

  /* Step vs slope. The step model gets one more parameter than the line, so it must beat the line
   * by the margin too — not merely tie it. */
  if (step && lin && step.rss < lin.rss * (1 - minImprovement)) {
    return {
      ...base, shape: "STEP", fits, at: step.at, atX: step.x, jumpPct: step.jumpPct,
      why: `a single level change at checkpoint ${step.x} (${step.jumpPct == null ? "n/a" : step.jumpPct + "%"}) explains this series ${((1 - step.rss / lin.rss) * 100).toFixed(0)}% better than a slope does — this is a MODE CHANGE, not an accumulation: it is bounded and it does not get worse with time`,
    };
  }
  if (lin && linGain >= minImprovement) {
    const dir = lin.slope > 0 ? "rises" : "falls";
    return {
      ...base, shape: lin.slope > 0 ? "SLOPE" : "SLOPE-DOWN", fits, slope: +lin.slope.toFixed(6), r: lin.r,
      why: `the series ${dir} steadily (${netPct}% end to end, r=${lin.r}) and a line explains it ${(linGain * 100).toFixed(0)}% better than a constant — this is an ACCUMULATION: unbounded, and it gets worse the longer the session runs`,
    };
  }
  return {
    ...base, shape: "STEP", fits, at: step?.at ?? null, atX: step?.x ?? null, jumpPct: step?.jumpPct ?? null,
    why: `a level change explains this series better than a constant does, and no better than a slope does — reported as a step because a step is the weaker claim`,
  };
}

/* ── The eliminator ─────────────────────────────────────────────────────────────────────────── */

/**
 * Did a reload put this counter back where it started?
 *
 * `tolerancePct` exists because a reloaded page legitimately differs by a few nodes and a megabyte
 * of heap; demanding an exact return would report every counter as persisting.
 */
export function reloadReset({ start, end, afterReload, tolerancePct = 15 } = {}) {
  if (![start, end, afterReload].every(Number.isFinite)) {
    return { verdict: "unmeasured", why: "one of the three samples (session start · session end · after reload) is missing, so nothing can be said about the reset" };
  }
  const grew = end - start;
  if (Math.abs(start) < 1e-9) {
    return grew === 0
      ? { verdict: "unmeasured", why: "the counter was zero at the start and never moved — there is no growth whose reset could be tested", grew, recoveredPct: null }
      : { verdict: afterReload <= grew * (tolerancePct / 100) ? "RESETS" : "PERSISTS", why: `started at zero, reached ${end}, and reads ${afterReload} after the reload`, grew, recoveredPct: null };
  }
  if (grew <= Math.abs(start) * 0.01) {
    return { verdict: "no-growth", why: `the counter did not meaningfully grow over the session (${start} → ${end}), so there is nothing for a reload to undo`, grew, recoveredPct: null };
  }
  /* How much of the session's growth the reload gave back. 100% = fully reset to the fresh-page
   * level; 0% = the reload changed nothing. */
  const recoveredPct = +(((end - afterReload) / grew) * 100).toFixed(1);
  if (recoveredPct >= 100 - tolerancePct) {
    return { verdict: "RESETS", recoveredPct, grew, why: `the reload gave back ${recoveredPct}% of what the session added (${start} → ${end} → ${afterReload}) — this counter lives in the document and dies with it` };
  }
  if (recoveredPct <= tolerancePct) {
    return { verdict: "PERSISTS", recoveredPct, grew, why: `the reload gave back ${recoveredPct}% of what the session added (${start} → ${end} → ${afterReload}) — this counter outlives the document, so it cannot be what the reload fixes` };
  }
  return { verdict: "PARTIAL", recoveredPct, grew, why: `the reload gave back ${recoveredPct}% of the session's growth (${start} → ${end} → ${afterReload}) — neither cleanly in-document nor cleanly durable; look at what half of it is which before drawing anything from it` };
}

/**
 * The two-axis verdict. THIS is the deliverable — a shape on its own is only half an answer.
 *
 * Note the deliberate asymmetry in the "flat" branch: a counter that does not grow is EXONERATED
 * regardless of what a reload does to it, because a constant cannot produce a slope. That is the
 * one branch where a single axis is sufficient, and it is sufficient in only that direction.
 */
export function admissibility({ shape, reset } = {}) {
  const grew = shape === "SLOPE" || shape === "STEP" || shape === "SAWTOOTH";
  if (shape === "unmeasured") return { verdict: "UNMEASURED", why: "the growth curve could not be fitted, so this candidate is an open question rather than an answer" };
  if (!grew) return { verdict: "EXONERATED", why: "this counter does not grow over the session, and a constant cannot produce a rising cost" };
  const r = reset?.verdict;
  if (r === "PERSISTS") {
    return {
      verdict: "EXCLUDED",
      why: "it grows, but a reload does not undo the growth — and the owner's symptom IS undone by a reload, so this cannot be the mechanism. ⚠ It is excluded as the CAUSE OF THE SLOPE only: a permanently large store still makes every session slower from the first second, which is B1121 complaint (b) and a different question",
    };
  }
  if (r === "RESETS") {
    return {
      verdict: shape === "SLOPE" ? "ADMISSIBLE" : `ADMISSIBLE-${shape}`,
      why: shape === "SLOPE"
        ? "it accumulates through the session and a reload zeroes it — this is the exact signature the owner describes, and it is a SUSPECT to be explained, never a conviction"
        : `it grows and a reload zeroes it, but the growth is a ${shape.toLowerCase()} rather than an accumulation — it can produce a sudden change in cost, not a steady one`,
    };
  }
  if (r === "PARTIAL") return { verdict: "PARTIAL", why: "it grows and a reload undoes some of the growth — split the counter before concluding anything from it" };
  /* ⛔ NO NET GROWTH IS AN ANSWER, NOT A MISSING ONE — and the first version of this function
   * reported it as UNMEASURED, which is how a clean exoneration reads as an open question. A
   * counter can be fitted a shape (a two-node wiggle clears a tight floor) and still END WHERE IT
   * BEGAN; run 1 did this to `documentNodes` (1691 → 1693), `layoutObjects` (1391 → 1391) and
   * `canvasNodes` (600 → 600), all three of which were then printed as UNMEASURED beside genuinely
   * unanswered rows. Ending where it began means it cannot produce a RISING cost — which is the
   * question — so it is exonerated for the slope, and the shape is carried in the reason because a
   * sawtooth that nets to zero can still produce a TRANSIENT. */
  if (r === "no-growth") {
    return {
      verdict: "NO-NET-GROWTH",
      why: shape === "SAWTOOTH"
        ? "it oscillates during the session but ends where it began — it can produce a transient spike, never a steady rise"
        : "it moves during the session but ends where it began, so it cannot produce a rising cost",
    };
  }
  return { verdict: "UNMEASURED", why: `the reload arm produced "${r ?? "nothing"}", so this candidate's second axis is unanswered` };
}

/* ── Attribution ────────────────────────────────────────────────────────────────────────────── */

/** Pearson's r between two equal-length series, ignoring index pairs where either is missing. */
export function correlate(a = [], b = []) {
  const pairs = [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (Number.isFinite(a[i]) && Number.isFinite(b[i])) pairs.push([a[i], b[i]]);
  if (pairs.length < 3) return null;
  const n = pairs.length;
  const ma = pairs.reduce((s, q) => s + q[0], 0) / n, mb = pairs.reduce((s, q) => s + q[1], 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (const [x, y] of pairs) { sab += (x - ma) * (y - mb); saa += (x - ma) ** 2; sbb += (y - mb) ** 2; }
  if (saa === 0 || sbb === 0) return null;
  return +(sab / Math.sqrt(saa * sbb)).toFixed(4);
}

/**
 * Rank the candidates against the COST curve.
 *
 * ⛔ THE CEILING ON WHAT THIS FUNCTION MAY CONCLUDE IS "SUSPECT", and that is deliberate. In a
 * session that is monotonically busier, most counters correlate with cost at r > 0.9 whether or not
 * they cause anything — time correlates with everything. So correlation only ever PROMOTES a
 * candidate that has already passed the two-axis test, and never rescues one that failed it.
 */
export function attribute({ costSeries = [], candidates = [], costShape = null, minR = 0.8 } = {}) {
  const rows = candidates.map((c) => {
    const r = correlate(costSeries, c.series || []);
    const adm = c.admissibility?.verdict ?? "UNMEASURED";
    let standing = "bystander";
    if (adm === "ADMISSIBLE" || adm.startsWith("ADMISSIBLE-")) standing = r != null && Math.abs(r) >= minR ? "SUSPECT" : "admissible-uncorrelated";
    else if (adm === "EXONERATED") standing = "exonerated";
    else if (adm === "EXCLUDED") standing = "excluded-by-reload";
    else if (adm === "UNMEASURED") standing = "unmeasured";
    else if (adm === "NO-NET-GROWTH") standing = "no-net-growth";
    else if (adm === "PARTIAL") standing = "partial";
    return { id: c.id, title: c.title ?? candidateById(c.id)?.title ?? c.id, shape: c.shape ?? null, admissibility: adm, r, standing };
  });
  const suspects = rows.filter((x) => x.standing === "SUSPECT");
  const order = { SUSPECT: 0, "admissible-uncorrelated": 1, partial: 2, unmeasured: 3, bystander: 4, "excluded-by-reload": 5, "no-net-growth": 6, exonerated: 7 };
  rows.sort((x, y) => (order[x.standing] ?? 9) - (order[y.standing] ?? 9) || Math.abs(y.r ?? 0) - Math.abs(x.r ?? 0));
  return { rows, suspects: suspects.map((s) => s.id), costShape };
}

/**
 * The headline. Written so that a NULL is stated as loudly as a finding — which is the standing
 * instruction on this item, and the reason four dead hypotheses in this program are recorded rather
 * than quietly forgotten.
 */
export function growthHeadline({ costShape = null, attribution = null, floorPct = null, unobservable = [] } = {}) {
  const shape = costShape?.shape ?? "unmeasured";
  const open = unobservable.length ? ` ${unobservable.length} pre-registered candidate(s) could not be sampled from outside the app and remain OPEN: ${unobservable.join(", ")}.` : "";
  if (shape === "unmeasured") return { verdict: "UNMEASURED", headline: `the cost curve itself could not be fitted, so this run says nothing about growth either way.${open}` };
  if (shape === "FLAT" || shape === "SLOPE-DOWN") {
    return {
      verdict: "NULL",
      headline: `⛔ HONEST NULL — the identical gesture did NOT get more expensive across this session (cost curve: ${shape}, ±${floorPct ?? "?"}% floor). The symptom did not reproduce here, which is not the same as the symptom not existing: it means this regime does not contain it.${open}`,
    };
  }
  if (shape === "SAWTOOTH") {
    return { verdict: "OSCILLATES", headline: `cost oscillates rather than accumulating — something fills and is dropped. A before/after pair would have called this either a slope or noise depending on when it sampled.${open}` };
  }
  if (shape === "STEP") {
    return { verdict: "STEP", headline: `⚠ cost STEPS at one point in the session and is then flat — a MODE CHANGE, not an accumulation. It is bounded and does not worsen with time, so it does not match the owner's "worse a minute later" slope; find what switched on at that checkpoint.${open}` };
  }
  const s = attribution?.suspects ?? [];
  return {
    verdict: "SLOPE",
    headline: s.length
      ? `cost ACCUMULATES across the session, and ${s.length} candidate(s) both grow and reset with the document: ${s.join(", ")}. Suspects, not convictions — B1434's rule stands: do not ship a fix against a signal you cannot explain.${open}`
      : `⚠ cost ACCUMULATES across the session and NO measured candidate both grows and resets with the document — the slope is real and UNATTRIBUTED, which is the most important thing this run can say. Widen the registry before proposing a fix.${open}`,
  };
}
