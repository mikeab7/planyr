/* Sheet-furniture LAYOUT tier — the half that only the PDF/PNG/print export needs.
 *
 * Split out of `sheetFurniture.js` so it stops riding the Site route's boot chunk. Both
 * halves lived in one module, and because the export path (`exportSheet.js`, a lazily
 * imported chunk) and the live canvas (`SitePlanner.jsx`, the boot path) each imported
 * from it, Rollup hoisted the WHOLE module into their common ancestor — the site chunk —
 * where the export-only corner-placement + SVG-string tier is dead weight on first paint.
 * Tree-shaking cannot help there: it drops unused exports, not exports used by a sibling
 * chunk. The drawing PRIMITIVES stay in `sheetFurniture.js`, because the canvas genuinely
 * needs them; only what the sheet alone uses moves here.
 *
 * ⛔ Nothing on the boot path may import this file — that would undo the split. Same rule
 * as `exportSheet.js`'s other helpers (see the site-planner folder pointer).
 * Behaviour is UNCHANGED: these are the same functions, moved.
 */
import { furnitureMetrics, pickScaleBar, scaleBarPlate, northArrowPlate, r2 } from "./sheetFurniture.js";

// `kind` tags a plate so the editable PDF can lift it out of the page as its OWN annotation (exportSheet.js): annotations
// always paint above the page picture, so a plate left in the page can be painted over by a site element's annotation.
const translate = (tx, ty, inner, kind = null) => `<g${kind ? ` data-furniture-kind="${kind}"` : ""} transform="translate(${r2(tx)},${r2(ty)})">${inner}</g>`;

// ── No-occlude placement (NEW-1, 2026-06-29) ──────────────────────────────
// The export furniture used to be pinned to fixed corners of the PLAN frame
// (north top-left, bar bottom-right) — but those corners sit INSIDE the drawing,
// so the scale-bar plate routinely landed on a building and its dimension labels
// (the owner's "scale bar overlapping Building 1's 593′×219′"). Now the caller can
// pass the plan content's bounding boxes (`obstacles`, in frame user units) and we
// place each plate in the emptiest corner, keeping the two in DIFFERENT corners so
// they never collide with each other either. Pure → unit-testable.
const CORNERS = ["tl", "tr", "bl", "br"];
function cornerXY(corner, fr, pw, ph, inset) {
  const left = fr.x + inset, right = fr.x + fr.w - inset - pw;
  const top = fr.y + inset, bot = fr.y + fr.h - inset - ph;
  return { tl: { tx: left, ty: top }, tr: { tx: right, ty: top }, bl: { tx: left, ty: bot }, br: { tx: right, ty: bot } }[corner];
}
function rectOverlap(a, b) {
  const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return ox * oy;
}
function cornerCost(corner, fr, pw, ph, inset, obstacles) {
  const p = cornerXY(corner, fr, pw, ph, inset);
  const box = { x: p.tx, y: p.ty, w: pw, h: ph };
  return obstacles.reduce((s, o) => s + rectOverlap(box, o), 0);
}
// Choose a corner for the (larger) scale bar and a DIFFERENT corner for the north
// arrow, each minimizing overlap with plan content. Defaults to bar=br / north=tl
// when no obstacles are given (preserves the historical layout + its tests).
// (The BUILDINGS table is not furniture any more: it has its own band on the sheet — buildingsBand.js.)
export function chooseFurnitureCorners({ x, y, w, h, inset, bar, north, obstacles }) {
  const fr = { x, y, w, h };
  const rank = (pw, ph, excluded) => CORNERS
    .filter((c) => !excluded.includes(c))
    .map((c) => ({ c, cost: cornerCost(c, fr, pw, ph, inset, obstacles || []) }))
    .sort((a, b) => a.cost - b.cost);
  let barC, northC;
  if (!obstacles || !obstacles.length) {
    // No content to weigh — keep the historical defaults exactly as they were.
    barC = "br"; northC = "tl";
  } else {
    barC = rank(bar.plateW, bar.plateH, [])[0].c; // bar first — larger, harder to fit
    northC = rank(north.plateW, north.plateH, [barC])[0].c;
  }
  return {
    bar: { ...cornerXY(barC, fr, bar.plateW, bar.plateH, inset), corner: barC },
    north: { ...cornerXY(northC, fr, north.plateW, north.plateH, inset), corner: northC },
  };
}

// EXPORT furniture for a frame {x,y,w,h} (export viewBox user units): a north arrow
// and a graphic scale bar, each placed in the emptiest corner (NEW-1 no-occlude) and
// wholly inside an inset safe area so neither can clip. `fmtFeet` formats whole-foot
// labels (pass the app's f0). `obstacles` (optional) = plan-content boxes in frame
// units. Returns geometry + markup so the safe-area / no-clip / no-occlude guarantees
// are unit-testable.
export function furnitureLayout({ x, y, w, h, ftPerUnit, fmtFeet, pal = {}, bearingDeg = 0, obstacles = null }) {
  const refS = Math.min(w, h);
  // The EXPORT frame's user unit is "one foot × the live zoom", not a screen pixel — so the
  // absolute px floors are off here (NEW-1 / V481(f)). Everything the furniture draws is then
  // a pure fraction of the frame, so the sheet is identical whatever zoom it was taken from.
  const m = furnitureMetrics(refS, { unitIsPx: false });
  const inset = refS * 0.035;
  const { feet, lengthU } = pickScaleBar({ frameW: w, ftPerUnit });
  const sb = scaleBarPlate({ lengthU, feet, m, pal, fmtFeet });
  const na = northArrowPlate({ m, pal, bearingDeg });
  const place = chooseFurnitureCorners({ x, y, w, h, inset, bar: sb, north: na, obstacles });
  return {
    refS, inset, m, feet, lengthU,
    scaleBar: { ...sb, tx: place.bar.tx, ty: place.bar.ty, corner: place.bar.corner },
    north: { ...na, arrowH: m.arrowH, tx: place.north.tx, ty: place.north.ty, corner: place.north.corner },
  };
}

export function buildSheetFurnitureSvg(opts) {
  const L = furnitureLayout(opts);
  return translate(L.scaleBar.tx, L.scaleBar.ty, L.scaleBar.markup, "scale-bar") +
    translate(L.north.tx, L.north.ty, L.north.markup, "north-arrow");
}

// ON-SCREEN furniture for the live canvas (viewport vw×vh, user units = screen px):
// north arrow bottom-left, scale bar bottom-right, both sitting `bottomGap` px above
// the status bar. Fixed modest size via `refS`. The bar snaps to a round distance for
// a ~130 px target, matching the export's behavior.
export function buildScreenFurnitureSvg({
  vw, vh, ftPerUnit,
  fmtFeet,
  pal = {},
  bearingDeg = 0,
  refS = 540,
  margin = 18,
  bottomGap = 40,
}) {
  const m = furnitureMetrics(refS);
  const { feet, lengthU } = pickScaleBar({ ftPerUnit, targetU: 130, maxU: Math.min(240, vw * 0.4) });
  const sb = scaleBarPlate({ lengthU, feet, m, pal, fmtFeet });
  const na = northArrowPlate({ m, pal, bearingDeg });
  const baseY = vh - bottomGap;
  return translate(vw - margin - sb.plateW, baseY - sb.plateH, sb.markup) +
    translate(margin, baseY - na.plateH, na.markup);
}
