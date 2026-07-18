// Map "sheet furniture": a measurement-grade graphic scale bar and a north arrow,
// shared by the on-screen Site Planner canvas and the print/PNG export.
//
// Why this module exists (NEW-1 / NEW-2): the furniture used to be hand-drawn twice
// — once on screen (sized for the live viewport) and once in the export, reusing the
// screen pixel sizes. In a print/PDF the export frame is a different size than the
// screen, so a screen-pixel scale bar overflowed the frame (the "500" clipped, the
// "0" floating) and the north arrow came out oversized and illegible over the
// imagery. The fix: one set of drawing primitives, sized in OUTPUT units and
// anchored to whichever frame they're drawn into.
//
// Sizing model: text / bar / arrow are fractions of a reference size `refS`. For the
// export `refS = min(frame w,h)`, so on a letter sheet (short side ≈ 8.5 in) the
// arrow at 0.06·refS ≈ 0.5 in tall and the safe-area inset at 0.045·refS ≈ 0.38 in —
// a fixed physical size on the page that never depends on the screen zoom. On screen
// `refS` is a fixed pixel reference so the decoration stays a modest, constant size.
//
// The graphic bar is the source of truth: its length encodes a real round distance
// (snapped to a sensible step), so it stays correct if the exported image is rescaled
// — which a "1 in = X ft" text scale would not, so we don't use one.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const r2 = (n) => Number(n.toFixed(2));
const translate = (tx, ty, inner) => `<g transform="translate(${r2(tx)},${r2(ty)})">${inner}</g>`;

// Preferred round distances (ft) the spec calls out, plus a few smaller/larger steps
// that only get picked at extreme zoom so the bar never becomes absurd or runs off
// the frame.
const NICE_FEET = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];

// Pick the round real-world distance whose bar best fills a target width without
// exceeding a hard ceiling (so it can never run off the edge). `ftPerUnit` = feet
// per one user unit (= 1 / pixels-per-foot). Target/ceiling may be given as a
// fraction of `frameW` (export) or as an absolute length in user units (screen).
export function pickScaleBar({ frameW, ftPerUnit, targetFrac = 0.22, maxFrac = 0.3, targetU, maxU }) {
  const lenOf = (feet) => feet / ftPerUnit; // feet -> user units
  const target = targetU != null ? targetU : frameW * targetFrac;
  const ceiling = maxU != null ? maxU : frameW * maxFrac;
  const fit = NICE_FEET.filter((ft) => lenOf(ft) <= ceiling);
  const pool = fit.length ? fit : [NICE_FEET[0]]; // frame absurdly small: smallest step
  const feet = pool.reduce(
    (best, ft) => (Math.abs(lenOf(ft) - target) < Math.abs(lenOf(best) - target) ? ft : best),
    pool[0]
  );
  return { feet, lengthU: lenOf(feet) };
}

// Sizes derived from a reference dimension. Pure → unit-testable.
// Tuned cartographic/surveyor weights: a THIN segmented bar and a SLIM needle drawn
// with hairline strokes — not the old chunky filled bar/triangle that read cartoonish.
//
// NEW-1 (export quality, 2026-06-29): the whole furniture was sized ~30% too large —
// the arrow GLYPH was fine (≈0.4 in) but the surrounding PLATE (generous padding + a
// big "N" + heavy type) ballooned to ~0.7–0.9 in on the page, reading "massive" and
// cartoonish. So the glyph shrinks a touch (0.06→0.05·refS) and, more importantly, the
// padding / type / plate strokes all tighten so the plate hugs its content (~0.45–0.5 in
// total) and reads as a restrained engineering exhibit instead of a screen widget.
export function furnitureMetrics(refS) {
  const fs = clamp(refS * 0.0165, 6, refS * 0.05); // label text — smaller
  const arrowH = refS * 0.05; // glyph ≈ 0.32–0.4 in on a sheet (was 0.06 → ~0.5 in)
  return {
    fs,
    unitFs: fs * 0.74, // "FEET"
    barTh: refS * 0.009, // thin cartographic bar (was 0.0105)
    tickLen: refS * 0.0072,
    pad: fs * 0.5, // tighter plate padding (was 0.7) → the plate hugs its content
    plateStroke: Math.max(0.4, refS * 0.001), // hairline plate border
    segStroke: Math.max(0.35, refS * 0.001), // hairline segment / needle outline
    rx: fs * 0.45,
    arrowH,
    arrowW: arrowH * 0.32, // slim needle (was 0.34)
    nFs: fs * 0.92,
  };
}

// Whole-foot labels via the caller's formatter; a fractional midpoint (only the
// 25 / 250 / 2500… steps halve to x.5) keeps its decimal so the bar reads true.
const fmtTick = (n, fmt) => (Number.isInteger(n) ? fmt(n) : String(n));

// Subtle, warm semi-opaque backing — keeps labels legible over busy aerial imagery
// without reading as a hard white box.
const PLATE_FILL = "rgba(249,248,244,0.84)";

// Graphic scale bar drawn with its plate top-left at the local origin. Alternating
// black/white segments, tick marks at 0 / midpoint / max with numbers centered
// directly under their ticks, a "FEET" unit label, on a legibility plate.
// Returns { markup, plateW, plateH }.
export function scaleBarPlate({ lengthU, feet, m, pal = {}, fmtFeet = (n) => String(Math.round(n)) }) {
  const ink = pal.ink || "#2c2a26";
  const muted = pal.muted || "#8a8473";
  const line = pal.panelLine || "#cfc6af";
  const seg = lengthU / 4;
  const padX = Math.max(m.pad, m.fs * 1.4); // room for the end labels to overhang the bar
  const barTop = m.pad, barBot = barTop + m.barTh;
  const tickBot = barBot + m.tickLen;
  const numBase = tickBot + m.fs; // numbers sit directly under their ticks
  const unitBase = numBase + m.unitFs * 1.25; // "FEET" under the numbers
  const plateW = lengthU + 2 * padX;
  const plateH = unitBase + m.pad * 0.4;
  const ticks = [0, lengthU / 2, lengthU];
  const labels = [0, feet / 2, feet];
  let s = `<rect x="0" y="0" width="${r2(plateW)}" height="${r2(plateH)}" rx="${r2(m.rx)}" fill="${PLATE_FILL}" stroke="${line}" stroke-width="${r2(m.plateStroke)}"/>`;
  for (let i = 0; i < 4; i++)
    s += `<rect x="${r2(padX + seg * i)}" y="${r2(barTop)}" width="${r2(seg)}" height="${r2(m.barTh)}" fill="${i % 2 ? "#fff" : ink}" stroke="${ink}" stroke-width="${r2(m.segStroke)}"/>`;
  ticks.forEach((t) => {
    s += `<line x1="${r2(padX + t)}" y1="${r2(barBot)}" x2="${r2(padX + t)}" y2="${r2(tickBot)}" stroke="${ink}" stroke-width="${r2(m.segStroke)}"/>`;
  });
  ticks.forEach((t, i) => {
    s += `<text x="${r2(padX + t)}" y="${r2(numBase)}" text-anchor="middle" font-size="${r2(m.fs)}" font-weight="500" fill="${ink}">${esc(fmtTick(labels[i], fmtFeet))}</text>`;
  });
  s += `<text x="${r2(padX + lengthU / 2)}" y="${r2(unitBase)}" text-anchor="middle" font-size="${r2(m.unitFs)}" letter-spacing="${r2(m.unitFs * 0.2)}" fill="${muted}">FEET</text>`;
  return { markup: s, plateW, plateH };
}

// North arrow as a classic two-tone surveyor's needle (NOT a chunky filled triangle
// or a compass rose): a slim elongated kite split down its spine — the west half a
// thin hairline outline, the east half filled with one neutral ink colour — with a
// small "N" above, all on the same legibility plate, top-left at the local origin.
// `bearingDeg` rotates the needle to true north; 0° points it straight up. Single
// low-saturation colour, hairline strokes, no bright fills, no compass rose.
// Returns { markup, plateW, plateH }.
export function northArrowPlate({ m, pal = {}, bearingDeg = 0 }) {
  const ink = pal.ink || "#2c2a26";
  const line = pal.panelLine || "#cfc6af";
  const contentW = Math.max(m.arrowW, m.nFs * 0.8);
  const plateW = contentW + 2 * m.pad;
  const nBase = m.pad + m.nFs; // "N" baseline
  const arrowTop = nBase + m.nFs * 0.26; // tighter "N"→needle gap (was 0.32)
  const arrowBot = arrowTop + m.arrowH;
  const plateH = arrowBot + m.pad;
  const cx = plateW / 2;
  const halfW = m.arrowW / 2;
  const shoulderY = arrowTop + m.arrowH * 0.62; // shoulders below centre → slim, elongated needle
  const aCy = (arrowTop + arrowBot) / 2;
  const sw = r2(m.segStroke);
  // Two half-kites sharing the vertical spine (top tip → shoulder → tail). West half
  // hollow (hairline), east half filled — the conventional two-tone north needle.
  const west = `M${r2(cx)},${r2(arrowTop)} L${r2(cx - halfW)},${r2(shoulderY)} L${r2(cx)},${r2(arrowBot)} Z`;
  const east = `M${r2(cx)},${r2(arrowTop)} L${r2(cx + halfW)},${r2(shoulderY)} L${r2(cx)},${r2(arrowBot)} Z`;
  let needle =
    `<path d="${west}" fill="none" stroke="${ink}" stroke-width="${sw}" stroke-linejoin="round"/>` +
    `<path d="${east}" fill="${ink}" stroke="${ink}" stroke-width="${sw}" stroke-linejoin="round"/>`;
  if (bearingDeg) needle = `<g transform="rotate(${r2(-bearingDeg)} ${r2(cx)} ${r2(aCy)})">${needle}</g>`;
  let s = `<rect x="0" y="0" width="${r2(plateW)}" height="${r2(plateH)}" rx="${r2(m.rx)}" fill="${PLATE_FILL}" stroke="${line}" stroke-width="${r2(m.plateStroke)}"/>`;
  s += `<text x="${r2(cx)}" y="${r2(nBase)}" text-anchor="middle" font-size="${r2(m.nFs)}" font-weight="600" fill="${ink}">N</text>`;
  s += needle;
  return { markup: s, plateW, plateH };
}

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
export function chooseFurnitureCorners({ x, y, w, h, inset, bar, north, obstacles }) {
  const fr = { x, y, w, h };
  if (!obstacles || !obstacles.length) {
    return {
      bar: { ...cornerXY("br", fr, bar.plateW, bar.plateH, inset), corner: "br" },
      north: { ...cornerXY("tl", fr, north.plateW, north.plateH, inset), corner: "tl" },
    };
  }
  const rank = (pw, ph, exclude) => CORNERS
    .filter((c) => c !== exclude)
    .map((c) => ({ c, cost: cornerCost(c, fr, pw, ph, inset, obstacles) }))
    .sort((a, b) => a.cost - b.cost);
  const barC = rank(bar.plateW, bar.plateH, null)[0].c; // bar first — larger, harder to fit
  const northC = rank(north.plateW, north.plateH, barC)[0].c;
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
  const m = furnitureMetrics(refS);
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

// ── Bottom on-screen furniture placement (B881 / NEW-1) ────────────────────
// The live map pins the graphic scale bar bottom-RIGHT (at `sbRight`), the zoom controls
// bottom-right above it, the north arrow bottom-LEFT, and the calibration badge bottom-LEFT
// (at `left`), all on the same `bottom:40` band. Every plate except the badge is either tiny
// (north arrow) or auto-capped to the viewport (the scale bar targets ~130px, max ~vw·0.4),
// so the ONE item that can run into the right-anchored scale bar when a docked panel narrows
// the pane is the text-width calibration badge. This decides whether the badge stays on the
// scale-bar row or lifts to its OWN row just above the bar — which clears the bar below and
// the zoom controls above (they start at bottom:100) — and, when lifted, caps its width so it
// truncates with an ellipsis instead of overflowing the pane / colliding with the zoom column.
// Pure → unit-testable. `badgeW` is the badge's natural (untruncated) width in CSS px; pass 0
// before it's measured (→ never raised). Returns { raise, left, bottom, maxWidth }.
export function calibBadgePlacement({
  paneW, badgeW, scaleBarW, scaleBarH,
  left = 56, gap = 10, sbRight = 14, zoomRight = 14, zoomW = 30, row = 40,
}) {
  const scaleBarLeft = paneW - sbRight - scaleBarW;
  const raise = badgeW > 0 && left + badgeW + gap > scaleBarLeft;
  const bottom = raise ? row + scaleBarH + 2 : row;
  // When raised, keep the right edge clear of the pane edge AND the zoom column (right-anchored
  // at zoomRight, zoomW wide) — the raised row barely clears the zoom vertically, so leave a
  // horizontal margin too. Floor so the badge never truncates to an unreadable stub.
  const maxWidth = raise ? Math.max(150, paneW - (zoomW + zoomRight) - left - 6) : null;
  return { raise, left, bottom, maxWidth };
}

export function buildSheetFurnitureSvg(opts) {
  const L = furnitureLayout(opts);
  return translate(L.scaleBar.tx, L.scaleBar.ty, L.scaleBar.markup) +
    translate(L.north.tx, L.north.ty, L.north.markup);
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

// ON-SCREEN furniture as TWO standalone plates for DOM overlays (each rendered in
// its own absolutely-positioned <svg> anchored to a visible canvas corner, instead
// of inside the canvas SVG's coordinate space). This keeps the scale bar + north
// arrow ALWAYS fully on screen — immune to canvas-taller-than-viewport / status-bar
// overlap — and lets CSS place each precisely. Returns each plate's inner SVG markup
// plus its width/height so the caller can size its wrapping <svg>. `targetU`/`maxU`
// are absolute screen-pixel widths for the bar (the canvas user unit == screen px).
export function screenFurniturePlates({
  ftPerUnit, fmtFeet, pal = {}, bearingDeg = 0, refS = 540, targetU = 130, maxU = 240,
}) {
  const m = furnitureMetrics(refS);
  const { feet, lengthU } = pickScaleBar({ ftPerUnit, targetU, maxU });
  const sb = scaleBarPlate({ lengthU, feet, m, pal, fmtFeet });
  const na = northArrowPlate({ m, pal, bearingDeg });
  return { scaleBar: sb, north: na }; // each: { markup, plateW, plateH }
}
