/* Drawing-scale helpers for the site-plan overlay (B73). Pure + browser-free (no
 * PDF.js / canvas), so the math is unit-tested. A civil sheet carries a scale note
 * ("1\"=100'") but no coordinates; the scale only sizes the sheet correctly when the
 * page is at its true plot size, so we (a) read the note and (b) sanity-check the page
 * against standard sheet sizes before trusting it.
 *
 * Sizing math: a PDF page's intrinsic size is in points (72 / inch), so 1 inch = 72
 * points. At "1 inch = S feet" the real-world feet per point = S / 72 — i.e. an
 * overlay whose feet-per-image-point (`ftPerPx`) is S/72 is at true real-world size,
 * independent of how large we rasterized it.
 */

export const POINTS_PER_INCH = 72;
// feet-per-point for a given engineer's scale (feet per inch). The one place the
// scale↔size conversion lives, so the panel and auto-apply agree.
export const ftPerPointForScale = (feetPerInch) => feetPerInch / POINTS_PER_INCH;
// inverse: the scale (feet per inch) implied by a current ftPerPx (feet per point).
export const scaleForFtPerPoint = (ftPerPt) => ftPerPt * POINTS_PER_INCH;

// Common civil engineer's scales (feet per inch) offered in the picker.
export const COMMON_SCALES = [10, 20, 30, 40, 50, 60, 80, 100, 200];

// How far an auto-applied scale may stray from the viewport before we distrust it.
// A correctly-scaled sheet of the site you're looking at lands ~0.5–1.5× the viewport;
// a misread vicinity/key-map scale lands 10–30× too big. 4× upper / 0.04× lower cleanly
// separates the two while leaving generous headroom for a tight or wide zoom.
const SCALE_MAX_VIEWPORTS = 4;
const SCALE_MIN_VIEWPORTS = 0.04;

/* Choose an overlay's initial feet-per-point on import. A printed scale note is only a
 * CLAIM about the original plot — it breaks under "fit to page" / copier resize, and a
 * vicinity- or key-map scale printed on the same sheet can be misread as the plan scale.
 * So trust it ONLY when it lands the sheet at a sane on-screen size; otherwise fall back
 * to "size to fit" (a fraction of the viewport) and let the user set the real scale by
 * hand (the panel's scale picker / "Trace a length"). Without this guard a misread scale
 * placed the drawing 10–30× too large, blanketing the whole map with its title block (the
 * "file name all over the map" bug). Pure + browser-free so it's unit-tested.
 *
 *   detectedScale  feet-per-inch read from the sheet (or null/0)
 *   sheetStd       true when the page matches a standard plot size (scale trustworthy)
 *   imgW           page width in points (intrinsic, scale-1)
 *   ppf            current view pixels-per-foot
 *   screenW        canvas width in pixels
 *   fitFrac        viewport-width fraction for a "fit" overlay (default 0.6)
 * Returns { ftPerPx, trusted, reason }: reason ∈ no-scale|ok|too-big|too-small.
 */
export function chooseOverlayScale({ detectedScale, sheetStd, imgW, ppf, screenW, fitFrac = 0.6 }) {
  const safeImgW = Math.max(1, imgW || 1);
  const fit = Math.max(0.01, ((screenW / Math.max(1e-6, ppf)) * fitFrac) / safeImgW);
  if (!detectedScale || !sheetStd) return { ftPerPx: fit, trusted: false, reason: "no-scale" };
  const scaled = ftPerPointForScale(detectedScale);
  const wPx = safeImgW * scaled * ppf; // on-screen width the auto-scaled sheet would take
  if (wPx > screenW * SCALE_MAX_VIEWPORTS) return { ftPerPx: fit, trusted: false, reason: "too-big" };
  if (wPx < screenW * SCALE_MIN_VIEWPORTS) return { ftPerPx: fit, trusted: false, reason: "too-small" };
  return { ftPerPx: scaled, trusted: true, reason: "ok" };
}

// Standard plot sheet sizes in inches (order-independent; compared sorted).
const STD_SHEETS = [
  { in: [8.5, 11], label: "ANSI A (8.5×11)" },
  { in: [11, 17], label: "ANSI B (11×17)" },
  { in: [17, 22], label: "ANSI C (17×22)" },
  { in: [22, 34], label: "ANSI D (22×34)" },
  { in: [34, 44], label: "ANSI E (34×44)" },
  { in: [9, 12], label: "ARCH A (9×12)" },
  { in: [12, 18], label: "ARCH B (12×18)" },
  { in: [18, 24], label: "ARCH C (18×24)" },
  { in: [24, 36], label: "ARCH D (24×36)" },
  { in: [30, 42], label: "ARCH E1 (30×42)" },
  { in: [36, 48], label: "ARCH E (36×48)" },
];
const round1 = (n) => Math.round(n * 10) / 10;

/* Classify a page given its intrinsic size in POINTS. Returns
 * { std, label, wi, hi } — std=true means it matches a known plot size (so a printed
 * scale can be trusted), false means non-standard (likely shrunk to fit). */
export function detectSheet(imgWpt, imgHpt, tolIn = 0.6) {
  const wi = imgWpt / POINTS_PER_INCH, hi = imgHpt / POINTS_PER_INCH;
  const lo = Math.min(wi, hi), big = Math.max(wi, hi);
  for (const s of STD_SHEETS) {
    const sLo = Math.min(s.in[0], s.in[1]), sBig = Math.max(s.in[0], s.in[1]);
    if (Math.abs(lo - sLo) <= tolIn && Math.abs(big - sBig) <= tolIn)
      return { std: true, label: s.label, wi: round1(wi), hi: round1(hi) };
  }
  return { std: false, label: `${round1(wi)}×${round1(hi)} in`, wi: round1(wi), hi: round1(hi) };
}

/* Best-effort parse of an engineer's scale note from sheet text. Returns feet-per-inch
 * (e.g. 100) or null. Conservative: common civil forms only, sane 10–1000 ft range. */
export function parseScaleNote(text) {
  if (!text || typeof text !== "string") return null;
  const pats = [
    /1\s*["”″]\s*=\s*(\d{1,4})\s*['’′]/,                       // 1"=100'
    /1\s*["”″]\s*=\s*(\d{1,4})\s*(?:ft|feet)\b/i,              // 1"=100 ft
    /1\s*in(?:ch)?\s*=\s*(\d{1,4})\s*(?:ft|feet|['’′])/i,       // 1 inch = 100 ft
    /scale[^0-9]{0,12}1\s*["”″in]+\s*=\s*(\d{1,4})\s*(?:ft|feet|['’′])/i, // SCALE: 1"=100'
  ];
  for (const re of pats) {
    const m = text.match(re);
    if (m) { const s = +m[1]; if (s >= 10 && s <= 1000) return s; }
  }
  return null;
}

/* --- Bluebeam-style "page distance = real distance" scale entry (B560–B564) ---------------
 * The page→real ratio is the single source of truth: a scale is fully described by a distance
 * measured ON THE PAGE equalling a distance in the REAL world. From that we derive feet-per-inch
 * (`realFt / pageIn`) and hand it to the existing `applyOverlayScale`/`ftPerPointForScale` path,
 * so the internal ftPerPx model is untouched. This frees the picker from the old "1 inch = X feet"
 * straitjacket — e.g. 1/2″ = 60′ (→ 120 ft/in) or an architectural 1/8″ = 1′-0″ (→ 8 ft/in) are now
 * expressible. All pure + unit-tested. */

// Page side is measured in inches; real side in feet. These are the only unit conversions.
export const PAGE_UNIT_TO_IN = { in: 1, ft: 12 };
export const REAL_UNIT_TO_FT = { ft: 1, in: 1 / 12, m: 3.280839895 };
// Unit choices the picker offers (in/ft minimum; metres on the real side). Order = dropdown order.
export const PAGE_UNITS = ["in", "ft"];
export const REAL_UNITS = ["ft", "in", "m"];

/* Parse a distance the user typed into the page/real field. Accepts a plain decimal ("0.5", ".5",
 * "12"), a simple fraction ("1/2", "3/4"), or a mixed number ("1 1/2", "1-1/2"). Returns a positive
 * Number, or null for blank / malformed / non-positive / divide-by-zero input. Conservative on
 * purpose — anything it can't read confidently stays null so we never apply a garbage scale. */
export function parseDistanceInput(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // mixed number: "1 1/2" or "1-1/2"
  let m = s.match(/^(\d+)\s*[-\s]\s*(\d+)\s*\/\s*(\d+)$/);
  if (m) {
    const den = +m[3];
    if (!(den > 0)) return null;
    const v = +m[1] + +m[2] / den;
    return v > 0 ? v : null;
  }
  // simple fraction: "1/2", "3/4", ".5/2"
  m = s.match(/^(\d*\.?\d+)\s*\/\s*(\d*\.?\d+)$/);
  if (m) {
    const den = +m[2];
    if (!(den > 0)) return null;
    const v = +m[1] / den;
    return v > 0 ? v : null;
  }
  // plain decimal
  if (/^\d*\.?\d+$/.test(s)) {
    const v = +s;
    return v > 0 ? v : null;
  }
  return null;
}

/* feet-per-inch implied by a [page distance][unit] = [real distance][unit] pair — the single source
 * of truth the picker feeds to applyOverlayScale. pageVal/realVal may be raw strings (parsed via
 * parseDistanceInput) or numbers. Returns a positive feet-per-inch number, or null if either side is
 * blank/invalid. */
export function feetPerInchFromPair({ pageVal, pageUnit = "in", realVal, realUnit = "ft" }) {
  const page = typeof pageVal === "number" ? pageVal : parseDistanceInput(pageVal);
  const real = typeof realVal === "number" ? realVal : parseDistanceInput(realVal);
  if (!(page > 0) || !(real > 0)) return null;
  const pageIn = page * (PAGE_UNIT_TO_IN[pageUnit] ?? 1);
  const realFt = real * (REAL_UNIT_TO_FT[realUnit] ?? 1);
  if (!(pageIn > 0) || !(realFt > 0)) return null;
  return realFt / pageIn;
}

/* Common engineering + architectural scale presets for the picker. Each carries its page/real pair
 * so selecting a preset just populates the two fields; the implied feet-per-inch is derived
 * (realFt / pageIn) via feetPerInchForPreset. */
export const SCALE_PRESETS = [
  { id: "eng-10",   group: "Engineering",   label: '1" = 10\'',     pageIn: 1,     realFt: 10 },
  { id: "eng-20",   group: "Engineering",   label: '1" = 20\'',     pageIn: 1,     realFt: 20 },
  { id: "eng-30",   group: "Engineering",   label: '1" = 30\'',     pageIn: 1,     realFt: 30 },
  { id: "eng-40",   group: "Engineering",   label: '1" = 40\'',     pageIn: 1,     realFt: 40 },
  { id: "eng-50",   group: "Engineering",   label: '1" = 50\'',     pageIn: 1,     realFt: 50 },
  { id: "eng-60",   group: "Engineering",   label: '1" = 60\'',     pageIn: 1,     realFt: 60 },
  { id: "eng-80",   group: "Engineering",   label: '1" = 80\'',     pageIn: 1,     realFt: 80 },
  { id: "eng-100",  group: "Engineering",   label: '1" = 100\'',    pageIn: 1,     realFt: 100 },
  { id: "arch-1-8", group: "Architectural", label: '1/8" = 1\'-0"', pageIn: 0.125, realFt: 1 },
  { id: "arch-1-4", group: "Architectural", label: '1/4" = 1\'-0"', pageIn: 0.25,  realFt: 1 },
  { id: "arch-1-2", group: "Architectural", label: '1/2" = 1\'-0"', pageIn: 0.5,   realFt: 1 },
  { id: "arch-3-4", group: "Architectural", label: '3/4" = 1\'-0"', pageIn: 0.75,  realFt: 1 },
  { id: "arch-1",   group: "Architectural", label: '1" = 1\'-0"',   pageIn: 1,     realFt: 1 },
];

export const feetPerInchForPreset = (p) => (p && p.pageIn > 0 ? p.realFt / p.pageIn : null);

/* Round-trip a feet-per-inch value back to a preset id (so the picker shows the matching preset when
 * the current size lands on one), within a small relative epsilon, else null → the panel shows
 * "Custom" with the paired fields populated from the current size. */
export function matchScalePreset(feetPerInch, eps = 1e-3) {
  if (!(feetPerInch > 0)) return null;
  for (const p of SCALE_PRESETS) {
    const fpi = feetPerInchForPreset(p);
    if (fpi > 0 && Math.abs(fpi - feetPerInch) <= eps * Math.max(1, feetPerInch)) return p;
  }
  return null;
}

/* The richer STATED-scale parser (engineer / architectural / ratio / NTS) moved to
 * shared/files/sheetScale.js (B360) so the shared title-block readers can own it without the
 * shared layer importing back into this workspace. Re-exported here so the overlay's existing
 * callers (and test/sheetScale.test.js) keep importing `parseSheetScale` from overlayScale.js
 * unchanged, and the scale↔feet-per-point conversion (ftPerPointForScale) stays alongside it. */
export { parseSheetScale } from "../../../shared/files/sheetScale.js";
