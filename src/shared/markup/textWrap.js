/* Shared TEXT-WRAP + box-fit measurement (B909/NEW-1).
 *
 * The callout overflow bug (B909) was a box sized from a flat char-count guess
 * (`text.length * fs * 0.58`) rendering a SINGLE unwrapped `<text>` — so any text longer than
 * that guess drew straight past the rect. This module is the one place that turns raw callout
 * text into (a) wrapped lines and (b) a box size guaranteed to enclose them, so the renderer
 * and the hit-test box agree by construction — both call `calloutBoxMetrics` with the same
 * inputs instead of keeping two copies of the sizing math.
 *
 * Measurement is pluggable via a `(str, fs) => px` function: `heuristicWidth` (a per-character
 * table) is pure and Node-testable, and is also the fallback when no browser is present;
 * `bestMeasurer()` upgrades to a real <canvas> 2D `measureText` in the browser, so the ON-SCREEN
 * box matches the ACTUAL rendered glyphs, not just an internally-consistent guess. Pure: no
 * React, no SVG.
 */

/* Per-character width as a fraction of font-size. Deliberately generous (an OVER-estimate
 * only wraps a touch early / boxes a touch wide; an UNDER-estimate is the overflow bug this
 * module exists to prevent) — used only when no real <canvas> measurer is available. */
const NARROW = new Set("iIl.,:;'!|()[]{}ft ".split(""));
const WIDE = new Set("MW@%mw".split(""));
export function heuristicCharWidth(ch, fs) {
  if (NARROW.has(ch)) return fs * 0.34;
  if (WIDE.has(ch)) return fs * 0.82;
  if (ch >= "A" && ch <= "Z") return fs * 0.68;
  if (ch >= "0" && ch <= "9") return fs * 0.58;
  return fs * 0.54;
}
export function heuristicWidth(str, fs) {
  let w = 0;
  for (const ch of String(str ?? "")) w += heuristicCharWidth(ch, fs);
  return w;
}

/* A real <canvas> 2D context measurer, memoized (module-singleton — text measurement is a
 * stateless, read-only query, safe to share across every caller). Returns null outside a
 * browser (Node unit tests, SSR) so callers fall back to `heuristicWidth`. Font stack mirrors
 * the app's one UI face (`--font` in index.css) so the estimate matches the inherited SVG
 * <text> font as closely as a canvas font-string can. */
let _ctx = null;
/* VIEW-INDEPENDENT-ONCE (NEW-2, 2026-08-06). `measureText` is a pure function of (string, font)
 * and one of the more expensive calls in a render pass — the browser has to lay the run out. It
 * was being asked the same question over and over: ui-audit/detect-view-recompute.mjs measured
 * 1,122 calls producing ONE distinct answer across a single 60-move pan of the reference plan
 * (12 ms). A callout's text and its font size do not change because the map moved.
 *
 * Bounded on purpose: the key space is (text × size × weight × style), so a document full of
 * distinct strings would otherwise grow this without limit. At the cap the cache is cleared
 * outright rather than evicted one entry at a time — an exact-LRU here would cost more
 * bookkeeping per call than the measurement it is saving, and the miss it causes is one
 * `measureText`, not a wrong answer. */
const _wCache = new Map();
const W_CACHE_MAX = 4000;
export function canvasWidth(str, fs, opts = {}) {
  if (typeof document === "undefined") return null;
  if (!_ctx) { const c = document.createElement("canvas"); _ctx = c.getContext("2d"); }
  if (!_ctx) return null;
  const weight = opts.bold ? "700" : "400";
  const style = opts.italic ? "italic" : "normal";
  const s = String(str ?? "");
  const key = `${style}|${weight}|${fs}|${s}`;
  const hit = _wCache.get(key);
  if (hit !== undefined) return hit;
  _ctx.font = `${style} ${weight} ${fs}px "Inter", system-ui, sans-serif`;
  const w = _ctx.measureText(s).width;
  if (_wCache.size >= W_CACHE_MAX) _wCache.clear();
  _wCache.set(key, w);
  return w;
}

/** The best measurer available: real canvas metrics in a browser, the heuristic elsewhere. */
export function bestMeasurer(opts = {}) {
  return (str, fs) => canvasWidth(str, fs, opts) ?? heuristicWidth(str, fs);
}

/* Force-break ONE space-free run (a long URL, a run-on word — repro case (b)) into chunks that
 * each fit `maxWidth`, so a single unbroken word can never blow out the box. */
function breakWord(word, fs, maxWidth, measure) {
  const out = [];
  let cur = "";
  for (const ch of word) {
    const next = cur + ch;
    if (cur && measure(next, fs) > maxWidth) { out.push(cur); cur = ch; }
    else cur = next;
  }
  if (cur) out.push(cur);
  return out.length ? out : [""];
}

/* Greedy word-wrap of ONE explicit line into rendered lines ≤ maxWidth. */
function wrapOneLine(line, fs, maxWidth, measure) {
  const words = line.split(" ");
  const out = [];
  let cur = "";
  for (const word of words) {
    const chunks = measure(word, fs) > maxWidth ? breakWord(word, fs, maxWidth, measure) : [word];
    for (const chunk of chunks) {
      const candidate = cur ? `${cur} ${chunk}` : chunk;
      if (cur && measure(candidate, fs) > maxWidth) { out.push(cur); cur = chunk; }
      else cur = candidate;
    }
  }
  out.push(cur);
  return out;
}

/** Wrap raw text (which may already contain explicit "\n" breaks — repro case (c)) into
 *  rendered lines, each ≤ maxWidth wide under `measure`. Always returns ≥1 line, so even an
 *  empty/fresh callout gets a paintable box. Explicit blank lines are preserved. */
export function wrapText(text, fs, maxWidth, measure = heuristicWidth) {
  const raw = String(text ?? "").split("\n");
  const lines = raw.flatMap((l) => wrapOneLine(l, fs, maxWidth, measure));
  return lines.length ? lines : [""];
}

/** The box a callout needs to fully enclose its (wrapped) text.
 *  Returns { lines, boxW, boxH, lineHeight } — `boxW` is sized to the LONGEST ACTUAL rendered
 *  line (never a char-count guess), `boxH` grows with the real line count, so the box can never
 *  be smaller than what actually gets drawn (the invariant a caller should assert in tests:
 *  every line's `measure(line, fs) <= boxW - padX*2`). */
export function calloutBoxMetrics(text, fs, opts = {}) {
  const {
    padX = 8, padY = 4, minWidth = 60,
    maxWidth = Math.max(90, fs * 14), // scales with fs (already zoom-scaled by the caller), so the wrap shape holds at any zoom
    measure = heuristicWidth,
    lineHeight = fs * 1.25,
  } = opts;
  const lines = wrapText(text, fs, maxWidth, measure);
  const longest = lines.reduce((w, l) => Math.max(w, measure(l, fs)), 0);
  const boxW = Math.max(minWidth, longest + padX * 2);
  const boxH = (lines.length - 1) * lineHeight + fs + padY * 2; // N=1 reduces to the original fs+padY*2
  return { lines, boxW, boxH, lineHeight };
}
