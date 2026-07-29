// NEW-1 — what scale does the LABEL tier reason at when we are building an EXPORT sheet?
//
// B1047 made the DRAWN GEOMETRY view-independent on the export path (cull off, full flush,
// clone). The label tier was left behind, and that is the defect this module closes.
//
// Every label decision in the planner — the level-of-detail line drop (`fitLines`), the
// collision resolution (`layoutLabels`), the declutter gates (`dimCalloutVisible`,
// `detailLabelVisible`, `pondParamLabelVisible`) and the zoom→font ramps (`dimFontPx`,
// the `ls` label scale) — is a function of `view.ppf`, i.e. of where the user happened to
// have the canvas zoomed. `buildExportSvg` CLONES the live SVG, so it inherited whatever
// declutter tier was on screen. Measured on the owner's real plan (V481(f), 2026-07-29):
// the same plan exported at a wide zoom carried 118 text nodes against 151 from a corner
// zoom, and "Building 12" had no label at all on the wide-zoom sheet. Silent: the geometry
// was all there, so the sheet looked complete.
//
// The fix is to give the label tier its own frame. On screen that frame IS the view. On an
// export pass it is derived from the SHEET — the framed extent in feet against the plan
// box's physical size — so the sheet is a function of the plan and the frame only, exactly
// like `exportStyle.js` already does for stroke weights ("a real physical drafting weight
// that no longer depends on the zoom at print time").
//
// ── UNITS, because this is the part that is easy to get wrong ────────────────────────────
// The cloned SVG is authored in the canvas's own pixel space (one foot == `view.ppf` units)
// and the sheet scales that whole box to the plan box. So a label frame is TWO numbers:
//   • `ppf` — the px-per-foot the label tier makes its DECISIONS at (gates, LOD, collision).
//   • `k`   — the factor that converts a label-space px into a canvas px, so the emitted
//             font sizes / halos / paddings land at the right physical size on paper.
//             `k = view.ppf / frame.ppf`, and it is exactly 1 on screen.
// Anything derived from world geometry (`el.w * view.ppf`, `f2p(...)`) stays on `view.ppf`
// — it is already in canvas px and already view-independent once the viewBox rescales it.
// Only absolute px constants (a font size, a 30-px legibility floor, a 2-px collision pad)
// need the `ppf`/`k` treatment. Because canvas px == label px × k for EVERY quantity in the
// pool, the collision engine's decisions become identical to what a screen render at
// `frame.ppf` would have produced — uniform scale + translation, which box overlap is
// invariant under.
//
// Pure (no React / DOM) so the view-independence is unit-testable without a browser.

// Screen-equivalent CSS px per centi-inch (1/100 in) of paper. The label tier's thresholds
// (`DETAIL_LABEL_MIN_PX = 30`, `DIM_CALLOUT_MIN_PPF = 0.18`, the `ls` ramp's 0.45 knee) were
// all calibrated against a ~96 dpi screen, so the honest mapping onto paper is "the sheet as
// it reads at 100% on a monitor" — 96 px per inch, 100 centi-inches per inch. Calibration
// check: on a typical letter-landscape sheet this reproduces the label size the export
// already produced from a normal working zoom (~4 pt body text), which is the output the
// owner signed off on — it moves the WIDE-zoom sheet onto that reference, it does not
// re-tune the reference.
export const SHEET_PX_PER_CENTI_INCH = 0.96;

// The planner clamps its own zoom to this range (zoomAround / pinchZoom); the sheet frame
// stays inside it so a pathological extent can't hand the label tier a nonsense ppf.
export const MIN_LABEL_PPF = 0.02;
export const MAX_LABEL_PPF = 8;

const clampPpf = (p) => Math.max(MIN_LABEL_PPF, Math.min(MAX_LABEL_PPF, p));

// The px-per-foot an export sheet reasons at: fit the framed extent (feet) into the plan box
// (centi-inches) the way `preserveAspectRatio="meet"` does — the limiting dimension governs —
// then express it in screen-equivalent px. Depends ONLY on the plan's framed extent and the
// paper; `view` is deliberately not a parameter. Returns null when there's nothing to frame.
export function sheetLabelPpf({ extentWft, extentHft, planW, planH } = {}) {
  const fits = [];
  if (extentWft > 0 && planW > 0) fits.push(planW / extentWft);
  if (extentHft > 0 && planH > 0) fits.push(planH / extentHft);
  if (!fits.length) return null;
  const ppf = Math.min(...fits) * SHEET_PX_PER_CENTI_INCH;
  return Number.isFinite(ppf) && ppf > 0 ? clampPpf(ppf) : null;
}

// The reference zoom the planner's line work is authored against — `strokeZoom(base, zk)`
// with zk = view.ppf / STROKE_ZOOM_REF thickens a plan stroke as you zoom in so the drawing
// holds its look on screen (B617). Kept here because the EXPORT needs to opt out of it.
export const STROKE_ZOOM_REF = 0.35;

// The presentation frame for a render pass. `sheetPpf` is null on every screen render (→ the
// frame IS the view, k = 1, strokes on the live zoom, so screen output is byte-for-byte what
// it was) and the sheet's own ppf during an export pass. Three fields:
//   • ppf      — what the label tier makes its decisions at (gates, LOD, collision).
//   • k        — label-space px → canvas px; see the units note above.
//   • strokeZk — the zoom factor `strokeZoom` should use. On an export it is 1, i.e. every
//     zoom-scaled stroke is authored at its BASE weight. Why: `exportStyle.printStrokeWidth`
//     retargets each stroke to a physical drafting weight, but it reads the AUTHORED width —
//     which already carried the live zoom — and its clamp is non-linear, so it cannot undo
//     that multiplication. Two exports of one plan therefore printed at line weights that
//     differed by ~2×. Authoring at the reference zoom is what an export taken from a normal
//     working zoom already produced, so this pins that output rather than re-tuning it.
export function makeLabelFrame(viewPpf, sheetPpf) {
  const vp = Number(viewPpf) > 0 ? Number(viewPpf) : 1;
  const sp = Number(sheetPpf);
  if (!(sp > 0)) return { ppf: vp, k: 1, sheet: false, strokeZk: vp / STROKE_ZOOM_REF };
  return { ppf: sp, k: vp / sp, sheet: true, strokeZk: 1 };
}
