/* rasterCost — the pure half of the RASTER COMPOSITING probe (NEW-1).
 *
 * ⛔ THE BLIND SPOT THIS FILE EXISTS TO CLOSE, and it is the reason a program of null results could
 * be honest and still miss the owner's problem.
 *
 * Every work metric this repo has ever used is the un-quantised one from `Performance.getMetrics`:
 * `ScriptDuration + LayoutDuration + RecalcStyleDuration`, differenced across a gesture. It was a
 * genuine improvement — it replaced a frame median whose quantisation floor was ±100% — and it is
 * still the right metric for the questions it was built for.
 *
 * But look at what those three counters are: SCRIPT, LAYOUT, STYLE. All three are main-thread work
 * that runs BEFORE a pixel is produced. **None of them can see paint, raster, image decode, texture
 * upload or compositing.** Those live on the compositor and raster threads, and a
 * 4.5-megapixel semi-transparent overlay costs almost nothing in script, layout or style — it
 * costs blending, and blending is invisible to the only cost metric in the program.
 *
 * So a plan whose distinguishing feature is a large translucent raster could be measurably slower
 * for the owner and read as identical on every instrument here. That is not a hypothetical: it is
 * the shape of the entire Bain miss.
 *
 * ── THE INSTRUMENT ──────────────────────────────────────────────────────────────────────────────
 * Chromium's own tracing. `disabled-by-default-devtools.timeline` emits a duration event for every
 * paint, raster task, image decode and composite, on whichever thread did it. Bucketing those by
 * name and differencing across a gesture gives the missing half of the cost, in milliseconds, on
 * the same gesture the existing metric measures.
 *
 * ⚠ WHAT A TRACED NUMBER IS AND IS NOT. Tracing perturbs: it adds per-event overhead, so a traced
 * gesture is slower in absolute terms than an untraced one. Every number produced here is therefore
 * a BETWEEN-ARM COMPARISON, never an absolute frame budget — which is exactly what an arm design
 * needs, and why the harness runs the untraced gesture separately for the headline work figure.
 */

/* Event-name → bucket. Names are Chromium's, and they have been stable for years; anything
 * unrecognised is charged to an explicit `other` bucket rather than dropped, so a renamed event
 * shows up as an unexplained total instead of silently vanishing from the accounting. */
export const TRACE_BUCKETS = {
  paint: ["Paint", "PaintImage", "PaintSetup"],
  raster: ["RasterTask", "Rasterize", "RasterizerTaskImpl::RunOnWorkerThread"],
  decode: ["Decode Image", "ImageDecodeTask", "Decode LazyPixelRef", "DecodeImage"],
  composite: ["CompositeLayers", "DrawFrame", "cc::Scheduler::BeginImplFrame", "ProxyImpl::ScheduledActionDraw"],
  layerize: ["UpdateLayerTree", "UpdateLayer", "Layerize", "cc::LayerTreeHostImpl::PrepareToDraw"],
};

const BUCKET_OF = (() => {
  const m = new Map();
  for (const [bucket, names] of Object.entries(TRACE_BUCKETS)) for (const n of names) m.set(n, bucket);
  return m;
})();

/** Which bucket an event name belongs to, or `null` for one this file does not account for. */
export const bucketOf = (name) => BUCKET_OF.get(name) || null;

/* Sum trace-event durations by bucket, restricted to a time window.
 *
 * Trace timestamps (`ts`, `dur`) are MICROSECONDS. Returning milliseconds here — once, in the one
 * place that knows the unit — is what stops a thousand-fold error being introduced downstream by a
 * reader who assumes ms.
 *
 * Only complete duration events are counted (`ph === "X"`), because a `B`/`E` pair split across the
 * window boundary cannot be attributed to the window without inventing the split.
 */
export function bucketTrace(events, { fromUs = -Infinity, toUs = Infinity } = {}) {
  const out = { paint: 0, raster: 0, decode: 0, composite: 0, layerize: 0, other: 0 };
  const counts = { paint: 0, raster: 0, decode: 0, composite: 0, layerize: 0, other: 0 };
  const unknown = new Map();
  for (const e of events || []) {
    if (!e || e.ph !== "X" || !Number.isFinite(e.dur) || !Number.isFinite(e.ts)) continue;
    if (e.ts < fromUs || e.ts > toUs) continue;
    const b = bucketOf(e.name);
    if (b) { out[b] += e.dur; counts[b]++; }
    else if (/paint|raster|decode|composit|draw|layer/i.test(e.name)) {
      /* Charged to `other` only when it LOOKS like render work. A generic trace carries thousands
       * of unrelated events (GC, timers, network); sweeping all of them in would produce a
       * meaningless figure a reader could mistake for unexplained render cost. */
      out.other += e.dur; counts.other++;
      unknown.set(e.name, (unknown.get(e.name) || 0) + e.dur);
    }
  }
  const ms = (n) => +(n / 1000).toFixed(2);
  return {
    paintMs: ms(out.paint), rasterMs: ms(out.raster), decodeMs: ms(out.decode),
    compositeMs: ms(out.composite), layerizeMs: ms(out.layerize),
    /* ⛔ `otherMs` IS DELIBERATELY EXCLUDED FROM `totalMs`, AND THE REASON IS NESTING.
     * Chromium's render events are a TREE, not a flat list: `ZeroCopyRasterBuffer::Playback` and
     * `DisplayItemList::Raster` run INSIDE a `RasterTask`, and `LocalFrameView::RunPaintLifecyclePhase`
     * wraps `Paint`. The first run of this harness added them together and inflated the render total
     * by roughly 60% — a number that looked like an enormous finding and was double-counting. The
     * five named buckets are chosen to be siblings, and `other` is kept as a DIAGNOSTIC LIST of
     * render-shaped names the accounting does not recognise, never as an addend. */
    otherNestedMs: ms(out.other),
    totalMs: ms(out.paint + out.raster + out.decode + out.composite + out.layerize),
    counts,
    /* Named, so an unrecognised event is diagnosable rather than mysterious. */
    unaccounted: [...unknown.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, us]) => ({ name, ms: ms(us) })),
  };
}

/** The compositor's own view of the page, read from CDP `LayerTree` rather than inferred.
 *  `areaPx` is the summed layer area — the proxy for how much surface the compositor must keep
 *  rastered, which is the figure a large backdrop moves and a layer COUNT does not. */
export function layerCensus(layers) {
  if (!Array.isArray(layers)) return { count: null, areaPx: null, rasterProxyMB: null };
  const areaPx = layers.reduce((s, l) => s + (l.width || 0) * (l.height || 0), 0);
  return {
    count: layers.length,
    areaPx,
    /* 4 bytes per compositor-surface pixel. A PROXY, and named one: the compositor does not
     * necessarily hold every layer at full resolution, and tiling means the true figure can be
     * lower. It moves with the thing being tested, which is what an arm comparison needs. */
    rasterProxyMB: +((areaPx * 4) / 1048576).toFixed(2),
  };
}

/** Median of a numeric list, or null. */
export function median(xs) {
  const s = (xs || []).filter(Number.isFinite).sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
}

/* The noise floor, MEASURED from the baseline arm's own repeats rather than assumed. Same
 * discipline as every other instrument here: a difference that does not clear the floor is
 * reported INCONCLUSIVE, never as a finding. */
export function noiseFloorPct(values) {
  const xs = (values || []).filter(Number.isFinite);
  if (xs.length < 2) return null;
  const m = median(xs);
  if (!m) return null;
  return +(((Math.max(...xs) - Math.min(...xs)) / m) * 100).toFixed(1);
}

/** Compare an arm against the baseline, refusing to call anything real inside the floor. */
export function armVerdict(baselineMs, armMs, floorPct) {
  if (!Number.isFinite(baselineMs) || !Number.isFinite(armMs) || !baselineMs) return { pct: null, verdict: "NOT MEASURED" };
  const pct = +(((armMs - baselineMs) / baselineMs) * 100).toFixed(1);
  if (floorPct == null) return { pct, verdict: "NO FLOOR MEASURED (single rep) — not a finding" };
  if (Math.abs(pct) <= floorPct) return { pct, verdict: `INCONCLUSIVE — inside the ±${floorPct}% floor` };
  return { pct, verdict: `${pct < 0 ? "CHEAPER" : "DEARER"} by ${Math.abs(pct)}%, which clears the floor` };
}

/* ---- THE DECODE ASSERTION ---------------------------------------------------------------------
 * ⛔ THE SINGLE MOST IMPORTANT GUARD IN THIS FILE, and the one whose absence would make every
 * number below a comfortable lie.
 *
 * A raster arm that measures a page where the raster NEVER DECODED measures the arm it was supposed
 * to be the control for — and it reads as a beautiful null result. That is precisely the failure
 * mode `fakeTile.mjs` was written to prevent for basemap tiles, arriving by a different door: here
 * the bytes come from IndexedDB, so a failed `idbGet`, a `src`-less overlay stuck on its "Loading
 * drawing…" placeholder, or a raster the renderer never got round to decoding all produce a page
 * that looks right in a screenshot and contains no texture at all. It happened on the very first
 * run of this harness — a Playwright string-vs-function subtlety wrote NOTHING to IndexedDB — and
 * this assertion is the only reason the run was not reported as a clean null.
 *
 * ⚠ AND THE OBVIOUS CHECK DOES NOT EXIST. An `<image>` inside an `<svg>` is an `SVGImageElement`,
 * NOT an `HTMLImageElement`: it has **no `naturalWidth`, no `naturalHeight` and no `complete`**.
 * Reading them yields `undefined`, and a guard written against `undefined > 0` would pass or fail
 * for reasons unrelated to decoding. What SVGImageElement DOES have is `decode()`, whose promise
 * resolves only once the browser has actually decoded the bytes — so that is the proof used, paired
 * with the intrinsic dimensions read out of the element's OWN data-URL bytes (the PNG IHDR header),
 * which is a measurement of what is really on the page rather than a restatement of the fixture.
 */
export function decodeFault(rendered, expected) {
  const want = (expected || []).filter((s) => s.visible !== false);
  if (!want.length) return null; // an arm with nothing to show cannot fail this
  const missing = [];
  for (const s of want) {
    const hit = (rendered || []).find((r) => r.decoded && r.intrinsicW === s.imgW && r.intrinsicH === s.imgH);
    if (!hit) missing.push(`${s.role} ${s.imgW}×${s.imgH}`);
  }
  return missing.length
    ? `RASTER NEVER DECODED: ${missing.join(", ")} — this arm did not measure what it claims to. `
      + `<image> elements present: ${(rendered || []).map((r) => `${r.intrinsicW || "?"}×${r.intrinsicH || "?"}${r.decoded ? "" : " (NOT decoded)"}`).join(", ") || "none"}.`
    : null;
}

/** Decoded texture bytes actually on the page, from the intrinsic dimensions read out of the bytes
 *  the DOM is holding — never from the fixture's own claim about itself. Only images that actually
 *  decoded are counted: a texture the compositor does not have is not a cost. */
export function renderedDecodedBytes(rendered) {
  return (rendered || []).filter((r) => r.decoded).reduce((s, r) => s + (r.intrinsicW || 0) * (r.intrinsicH || 0) * 4, 0);
}
