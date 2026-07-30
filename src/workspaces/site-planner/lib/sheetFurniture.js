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
// Markup rounding. SIGNIFICANT figures, not fixed decimals (NEW-1 / V481(f)): a user unit
// here is a screen pixel on the live canvas but "one foot × the live zoom" in an export
// clone, so a fixed 2-decimal round is a ~0.01 px nudge on screen and a ~1% distortion on a
// wide-zoom export frame that is only tens of units across — enough to make two exports of
// the same plan disagree on their furniture sizes. Six significant figures is unit-agnostic
// and strictly finer than the old rounding at every scale we draw at.
export const r2 = (n) => Number(Number(n).toPrecision(6));

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
//
// NEW-1 (V481(f), 2026-07-29): the three ABSOLUTE floors below (6-unit type, 0.4/0.35-unit
// hairlines) are SCREEN-PIXEL legibility floors and only make sense when a user unit IS a
// screen pixel — which is true on the live canvas and false in an export clone, whose units
// are "one foot × the live zoom". On an export they made the furniture zoom-dependent: at a
// wide zoom the frame is only tens of units across, the 6-unit floor bit, and the scale bar's
// numbers printed ~9× larger than the same sheet exported from a working zoom. `unitIsPx:
// false` drops the floors, leaving the sizing purely frame-relative — which is what the
// module's own sizing model says it should be ("a fixed physical size on the page that never
// depends on the screen zoom").
export function furnitureMetrics(refS, { unitIsPx = true } = {}) {
  const fs = unitIsPx ? clamp(refS * 0.0165, 6, refS * 0.05) : refS * 0.0165; // label text — smaller
  const arrowH = refS * 0.05; // glyph ≈ 0.32–0.4 in on a sheet (was 0.06 → ~0.5 in)
  return {
    fs,
    unitFs: fs * 0.74, // "FEET"
    barTh: refS * 0.009, // thin cartographic bar (was 0.0105)
    tickLen: refS * 0.0072,
    pad: fs * 0.5, // tighter plate padding (was 0.7) → the plate hugs its content
    plateStroke: unitIsPx ? Math.max(0.4, refS * 0.001) : refS * 0.001, // hairline plate border
    segStroke: unitIsPx ? Math.max(0.35, refS * 0.001) : refS * 0.001, // hairline segment / needle outline
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

// How high a transient canvas pill (the Standards "Applied · Undo" toast) must sit so it clears
// every piece of bottom furniture already on the canvas — the north arrow, the scale bar and the
// calibration badge (which itself may have lifted to its own row). Returned as a CSS `bottom`
// offset inside the canvas pane. The toast used to be viewport-centred, which put it in the
// optical middle of the plan, right over the buildings; anchoring it to the pane and stacking it
// above the furniture keeps it out of both the drawing and the side panel. Pure → unit-testable.
export function canvasPillBottom({ northH = 0, scaleBarH = 0, calibBottom = null, calibH = 26, row = 40, gap = 10 }) {
  const tops = [row + northH, row + scaleBarH];
  if (calibBottom != null) tops.push(calibBottom + calibH);
  return Math.max(...tops) + gap;
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
