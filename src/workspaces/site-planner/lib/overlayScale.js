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
export const COMMON_SCALES = [10, 20, 30, 40, 50, 60, 100, 200];

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
