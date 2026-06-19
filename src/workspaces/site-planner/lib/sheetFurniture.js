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
export function furnitureMetrics(refS) {
  const fs = clamp(refS * 0.02, 6, refS * 0.06); // label text
  const arrowH = refS * 0.06; // ≈ 0.5 in on a letter sheet
  return {
    fs,
    unitFs: fs * 0.82, // "FEET"
    barTh: refS * 0.018,
    tickLen: refS * 0.012,
    pad: fs * 0.7,
    plateStroke: Math.max(0.5, refS * 0.0016),
    segStroke: Math.max(0.5, refS * 0.002),
    rx: fs * 0.45,
    arrowH,
    arrowW: arrowH * 0.46,
    nFs: fs * 1.05,
  };
}

// Whole-foot labels via the caller's formatter; a fractional midpoint (only the
// 25 / 250 / 2500… steps halve to x.5) keeps its decimal so the bar reads true.
const fmtTick = (n, fmt) => (Number.isInteger(n) ? fmt(n) : String(n));

const PLATE_FILL = "rgba(255,255,255,0.82)"; // translucent legibility plate

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
    s += `<text x="${r2(padX + t)}" y="${r2(numBase)}" text-anchor="middle" font-size="${r2(m.fs)}" fill="${ink}">${esc(fmtTick(labels[i], fmtFeet))}</text>`;
  });
  s += `<text x="${r2(padX + lengthU / 2)}" y="${r2(unitBase)}" text-anchor="middle" font-size="${r2(m.unitFs)}" letter-spacing="${r2(m.unitFs * 0.18)}" fill="${muted}">FEET</text>`;
  return { markup: s, plateW, plateH };
}

// North arrow (simple filled arrow + "N", no compass rose) on the same legibility
// plate, top-left at the local origin. `bearingDeg` rotates the arrow to true north;
// 0° points it straight up. Returns { markup, plateW, plateH }.
export function northArrowPlate({ m, pal = {}, bearingDeg = 0 }) {
  const ink = pal.ink || "#2c2a26";
  const line = pal.panelLine || "#cfc6af";
  const contentW = Math.max(m.arrowW, m.nFs * 0.8);
  const plateW = contentW + 2 * m.pad;
  const nBase = m.pad + m.nFs; // "N" baseline
  const arrowTop = nBase + m.nFs * 0.3;
  const arrowBot = arrowTop + m.arrowH;
  const plateH = arrowBot + m.pad;
  const cx = plateW / 2;
  const notch = m.arrowH * 0.32;
  const aCy = (arrowTop + arrowBot) / 2;
  const path = `M${r2(cx)},${r2(arrowTop)} L${r2(cx + m.arrowW / 2)},${r2(arrowBot)} L${r2(cx)},${r2(arrowBot - notch)} L${r2(cx - m.arrowW / 2)},${r2(arrowBot)} Z`;
  const rot = bearingDeg ? ` transform="rotate(${r2(-bearingDeg)} ${r2(cx)} ${r2(aCy)})"` : "";
  let s = `<rect x="0" y="0" width="${r2(plateW)}" height="${r2(plateH)}" rx="${r2(m.rx)}" fill="${PLATE_FILL}" stroke="${line}" stroke-width="${r2(m.plateStroke)}"/>`;
  s += `<text x="${r2(cx)}" y="${r2(nBase)}" text-anchor="middle" font-size="${r2(m.nFs)}" font-weight="700" fill="${ink}">N</text>`;
  s += `<path d="${path}" fill="${ink}"${rot}/>`;
  return { markup: s, plateW, plateH };
}

// EXPORT furniture for a frame {x,y,w,h} (export viewBox user units): north arrow
// anchored top-left, scale bar bottom-right, both wholly inside an inset safe area so
// neither can clip. `fmtFeet` formats whole-foot labels (pass the app's f0).
// Returns geometry + markup so the safe-area / no-clip guarantees are unit-testable.
export function furnitureLayout({ x, y, w, h, ftPerUnit, fmtFeet, pal = {}, bearingDeg = 0 }) {
  const refS = Math.min(w, h);
  const m = furnitureMetrics(refS);
  const inset = refS * 0.045;
  const { feet, lengthU } = pickScaleBar({ frameW: w, ftPerUnit });
  const sb = scaleBarPlate({ lengthU, feet, m, pal, fmtFeet });
  const na = northArrowPlate({ m, pal, bearingDeg });
  return {
    refS, inset, m, feet, lengthU,
    scaleBar: { ...sb, tx: x + w - inset - sb.plateW, ty: y + h - inset - sb.plateH },
    north: { ...na, arrowH: m.arrowH, tx: x + inset, ty: y + inset },
  };
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
