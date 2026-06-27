/* Stated-scale parser (B267) — pure, browser-free, unit-tested.
 *
 * Relocated to shared/files/ (B360) so the ONE title-block reader (titleBlockParse.readTitleBlockText)
 * and the positional reader (sheetMeta.readSheetMeta) can both surface `scale` without the shared
 * layer reaching back into a workspace. The Site Planner overlay re-exports it from here
 * (overlayScale.js) so its existing callers and the scale conversions (ftPerPointForScale) are
 * unchanged. Civil-only `parseScaleNote` stays in overlayScale.js (owner: "left untouched").
 *
 * Reads a STATED scale callout from a sheet's text. Richer than the civil-only parseScaleNote
 * (10–1000 ft/in, Site Planner overlay): it also reads ARCHITECTURAL fractional and RATIO forms
 * — which fall below the civil floor — and recognises an explicit "not to scale". Returns one of:
 *   { ftPerInch, form:'engineer'|'arch'|'ratio', label }   a usable real-feet-per-paper-inch
 *   { explicit:'nts', label }                              explicitly NOT scalable (don't calibrate)
 *   null                                                    nothing parseable
 * ftPerInch → feet-per-point via overlayScale.ftPerPointForScale (so it feeds calByPage directly).
 * The caller still gates on detectSheet() (standard plot size) before trusting it, and labels the
 * result "from sheet scale — verify". GEOMETRY-BEATS-PRINTED-SCALE stays intact: a hand-traced /
 * measured calibration always overrides this printed claim.
 */

// "1 1/2" → 1.5, "3/16" → 0.1875, "1" → 1. Tolerant of spaces around the slash.
function fracToNum(s) {
  s = String(s).trim();
  const mixed = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixed) return +mixed[1] + +mixed[2] / +mixed[3];
  const frac = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (frac) return +frac[1] / +frac[2];
  return +s || 0;
}

export function parseSheetScale(text) {
  if (!text || typeof text !== "string") return null;
  const t = text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'"); // normalize smart quotes

  // 1) A TITLE-BLOCK "SCALE: NOT TO SCALE / AS NOTED" wins outright — the sheet itself
  //    declares no single scale. (A stray "NTS" on one detail does NOT; see step 5.)
  if (/\bscale\b[\s:.\-—]{0,4}(?:not\s*to\s*scale|n\.?t\.?s\.?|as\s+noted)\b/i.test(t)) {
    return { explicit: "nts", label: "NOT TO SCALE" };
  }

  // 2) Architectural fractional: 1/4"=1'-0",  3/16" = 1'-0",  1 1/2"=1'-0"  (paper inches as a
  //    fraction/mixed = feet'-inches"). Require a fraction so a bare 1"=50' falls to (3) engineer.
  //    (?<!\d) + a ≤2-digit mixed whole part so a number printed just before the scale — a date is
  //    the common one, "…10/24/2025  1/8\"=1'-0\"" — can't be swallowed into the paper-inch token
  //    ("2025 1/8" read as a mixed number, failing the sanity range and defeating the read). (B360)
  const arch = t.match(/(?<!\d)(\d{1,2}\s+\d+\s*\/\s*\d+|\d+\s*\/\s*\d+)\s*"\s*=\s*(\d+)\s*'(?:\s*-?\s*(\d+(?:\s+\d+\s*\/\s*\d+)?)\s*")?/);
  if (arch) {
    const paperIn = fracToNum(arch[1]);
    const ft = +arch[2] + (arch[3] ? fracToNum(arch[3]) / 12 : 0);
    if (paperIn > 0 && ft > 0) {
      const fpi = ft / paperIn;
      if (fpi >= 0.1 && fpi <= 400) {
        const lbl = `${arch[1].replace(/\s*\/\s*/, "/")}"=${arch[2]}'-${arch[3] || 0}"`;
        return { ftPerInch: fpi, form: "arch", label: lbl };
      }
    }
  }

  // 3) Engineer's: 1"=50',  1" = 50 ft,  1 inch = 50 ft,  SCALE: 1"=50'
  //    (foot mark ' has no \b — it's non-word, so \b would fail at end-of-string; ft/feet keep it)
  const eng = t.match(/1\s*(?:"|in(?:ch)?)\s*=\s*(\d{1,4})\s*(?:['′]|ft\b|feet\b)/i);
  if (eng) { const s = +eng[1]; if (s >= 1 && s <= 2000) return { ftPerInch: s, form: "engineer", label: `1"=${s}'` }; }

  // 4) Ratio: 1:200  (1 paper unit = N real units → N/12 feet per paper inch). GUARDED (B512):
  //    a rise:run SLOPE/grade callout ("MAX SLOPE 1:4", "1:3 TYP") or a clock time ("1:30 PM")
  //    printed in the drawing body must NOT be misread as the drawing scale — that silently
  //    auto-mis-calibrated the whole stitched group. Skip any "1:N" whose surrounding text
  //    carries a slope/grade keyword or that is immediately followed by AM/PM. The engineer/
  //    arch/NTS steps run first, so a sheet with a real stated scale is unaffected.
  const SLOPE_KW = /slope|grade|grad\b|pitch|batter|ratio|h\s*:\s*v|v\s*:\s*h|\btyp\b|\bmax\b|\bmin\b/i;
  const ratioRe = /\b1\s*:\s*(\d{1,5})\b/g;
  let rm;
  while ((rm = ratioRe.exec(t))) {
    const n = +rm[1];
    if (n < 2 || n > 10000) continue;
    const ctx = t.slice(Math.max(0, rm.index - 16), rm.index + rm[0].length + 8);
    if (SLOPE_KW.test(ctx)) continue;                                       // slope/grade callout, not a scale
    if (/^\s*(a|p)m\b/i.test(t.slice(rm.index + rm[0].length))) continue;   // clock time "1:30 PM"
    return { ftPerInch: n / 12, form: "ratio", label: `1:${n}` };
  }

  // 5) No numeric plan scale — a bare "NOT TO SCALE" / "NTS" anywhere means uncalibrate.
  if (/\bnot\s*to\s*scale\b/i.test(t) || /\bn\.?t\.?s\.?\b/i.test(t)) {
    return { explicit: "nts", label: "NOT TO SCALE" };
  }

  return null;
}
