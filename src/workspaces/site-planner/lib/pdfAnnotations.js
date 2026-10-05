/* pdfAnnotations — turn the MARKUPS on an exported site sheet into native PDF annotations
 * (NEW-1, 2026-10-05; owner: "the recipient should be able to move, delete or edit my markups in
 * Bluebeam or Acrobat").
 *
 * Plain-English: the PDF download is a picture of the sheet. With "Flatten markups" OFF (the
 * default) the picture is drawn WITHOUT the callouts, lines, shapes, clouds and measurements, and
 * each of those is written into the file separately as a real PDF annotation — the same kind of
 * object Bluebeam Revu and Adobe Acrobat make themselves, so the recipient can select, move,
 * restyle or delete it.
 *
 * WHY THE GEOMETRY COMES FROM THE EXPORTED SVG, NOT FROM THE MODEL (PDF-PARITY): the sheet is built
 * by cloning the live canvas, so the clone's markup nodes already ARE what the screen draws —
 * cloud scallops, wrapped callout text, leader elbows, the print stroke weights `restyleExportClone`
 * retargeted. Re-deriving any of that from the model would be a second render path that could drift.
 * So this module reads the clone's primitives (a plain-JSON tree — see annotationExtract.js for the
 * DOM adapter) and re-draws them, 1:1, as the annotation's explicit appearance stream (/AP /N).
 * The model contributes only what the picture cannot say: the annotation TYPE and its metadata.
 *
 * Pure + DOM-free (a tree in, strings/numbers out) so it unit-tests in plain node.
 *
 * FONTS — honest deviation from "embed or subset": the planner has no TrueType file to subset (its
 * only font assets are woff2) and the PDF writer is deliberately dependency-free. Text is therefore
 * set in the PDF base-14 Helvetica family, which every viewer carries natively (so it never
 * substitutes), and each line is horizontally scaled (Tz) to the width the browser measured for the
 * on-screen face, so line extents match the sheet.
 */

/* ---------------------------------------------------------------- numbers */
const n3 = (v) => { const s = String(Math.round(v * 1000) / 1000); return s === "-0" ? "0" : s; };

/* ---------------------------------------------------------------- Helvetica metrics (AFM, 1/1000 em)
 * ASCII 32..126. Oblique shares the upright widths. Used only to (a) size the Tz squeeze and (b)
 * place underline / anchors when the browser gave no measured width. */
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const HELV_B = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

/* WinAnsi (cp1252) bytes for the non-Latin1 punctuation that shows up in sheet text. */
const CP1252 = { "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87, "ˆ": 0x88, "‰": 0x89,
  "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c, "Ž": 0x8e, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96,
  "—": 0x97, "˜": 0x98, "™": 0x99, "š": 0x9a, "›": 0x9b, "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f };
// Characters with no WinAnsi glyph degrade to a readable stand-in instead of vanishing. These are the
// benign ones (a prime mark IS a straight tick at print size) and are not reported; only a character
// with no stand-in at all becomes "?" and is reported as a degradation.
const STAND_IN = { "⚠": "!", "′": "'", "″": "\"", "≈": "~", "≥": ">=", "≤": "<=", "→": "->", "←": "<-", "−": "-" };

/** The WinAnsi-encodable form of a string, plus whether anything had to be substituted. */
export function winAnsi(str) {
  let out = "", lossy = false;
  for (const ch of String(str == null ? "" : str)) {
    const c = ch.codePointAt(0);
    if (c === 0x0a || c === 0x0d || c === 0x09) { out += " "; continue; }
    if (c >= 32 && c < 127) { out += ch; continue; }
    if (c >= 0xa0 && c <= 0xff) { out += ch; continue; }
    if (CP1252[ch] != null) { out += ch; continue; }
    if (STAND_IN[ch] != null) { out += STAND_IN[ch]; continue; }
    out += "?"; lossy = true;
  }
  return { text: out, lossy };
}
const winAnsiByte = (ch) => {
  const c = ch.charCodeAt(0);
  if (c < 256) return c;
  return CP1252[ch] != null ? CP1252[ch] : 63;
};
/** Width of `str` in em×1000 for Helvetica(-Bold) — characters outside ASCII count as 556. */
export function helvWidth(str, bold = false) {
  const tbl = bold ? HELV_B : HELV;
  let w = 0;
  for (const ch of String(str)) { const c = ch.charCodeAt(0); w += c >= 32 && c < 127 ? tbl[c - 32] : 556; }
  return w;
}
const pdfStrLiteral = (s) => {
  let o = "(";
  for (const ch of s) {
    const b = winAnsiByte(ch);
    if (ch === "\\" || ch === "(" || ch === ")") o += "\\" + ch;
    else if (b < 32 || b > 126) o += "\\" + b.toString(8).padStart(3, "0");
    else o += ch;
  }
  return o + ")";
};

/* ---------------------------------------------------------------- colour */
const NAMED = { white: [1, 1, 1], black: [0, 0, 0], red: [1, 0, 0], none: null, transparent: null };
/** → { rgb:[0..1 ×3], a } or null (none / transparent / unparseable). */
export function parseColor(v) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (!s || s === "none" || s === "transparent") return null;
  if (s in NAMED) return NAMED[s] ? { rgb: NAMED[s], a: 1 } : null;
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    const rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    return { rgb, a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
  }
  m = /^rgba?\(([^)]+)\)$/.exec(s);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
    if (p.length < 3 || p.slice(0, 3).some((x) => !Number.isFinite(x))) return null;
    return { rgb: p.slice(0, 3).map((x) => Math.max(0, Math.min(255, x)) / 255), a: p.length > 3 && Number.isFinite(p[3]) ? p[3] : 1 };
  }
  return null;
}

/* ---------------------------------------------------------------- 2D affine */
const IDENT = [1, 0, 0, 1, 0, 0];
// compose(M, N): the matrix that applies N first, then M.
export const compose = (M, N) => [
  M[0] * N[0] + M[2] * N[1], M[1] * N[0] + M[3] * N[1],
  M[0] * N[2] + M[2] * N[3], M[1] * N[2] + M[3] * N[3],
  M[0] * N[4] + M[2] * N[5] + M[4], M[1] * N[4] + M[3] * N[5] + M[5],
];
const apply = (M, x, y) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]];
const scaleOf = (M) => Math.sqrt(Math.abs(M[0] * M[3] - M[1] * M[2])) || 1;
/** Parse an SVG transform list into one matrix. */
export function parseTransform(str) {
  if (!str) return IDENT;
  let M = IDENT;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let m;
  while ((m = re.exec(str))) {
    const a = m[2].split(/[\s,]+/).filter(Boolean).map(parseFloat);
    let T = IDENT;
    if (m[1] === "matrix" && a.length === 6) T = a;
    else if (m[1] === "translate") T = [1, 0, 0, 1, a[0] || 0, a[1] || 0];
    else if (m[1] === "scale") T = [a[0], 0, 0, a.length > 1 ? a[1] : a[0], 0, 0];
    else if (m[1] === "rotate") {
      const r = ((a[0] || 0) * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
      const R = [c, s, -s, c, 0, 0];
      T = a.length >= 3 ? compose([1, 0, 0, 1, a[1], a[2]], compose(R, [1, 0, 0, 1, -a[1], -a[2]])) : R;
    } else if (m[1] === "skewX") T = [1, 0, Math.tan(((a[0] || 0) * Math.PI) / 180), 1, 0, 0];
    else if (m[1] === "skewY") T = [1, Math.tan(((a[0] || 0) * Math.PI) / 180), 0, 1, 0, 0];
    if (T.some((x) => !Number.isFinite(x))) T = IDENT;
    M = compose(M, T);
  }
  return M;
}

/* ---------------------------------------------------------------- arcs → béziers */
/** SVG endpoint arc → cubic béziers [[c1x,c1y,c2x,c2y,x,y],…] (all in the arc's own space). */
export function arcToBeziers(x1, y1, rx, ry, phiDeg, fa, fs, x2, y2) {
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (!rx || !ry || (x1 === x2 && y1 === y2)) return [[x1, y1, x2, y2, x2, y2]];
  const phi = (phiDeg * Math.PI) / 180, cp = Math.cos(phi), sp = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cp * dx + sp * dy, y1p = -sp * dx + cp * dy;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { const k = Math.sqrt(lam); rx *= k; ry *= k; }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let co = den === 0 ? 0 : Math.sqrt(Math.max(0, num / den));
  if (!!fa === !!fs) co = -co;
  const cxp = (co * rx * y1p) / ry, cyp = (-co * ry * x1p) / rx;
  const cx = cp * cxp - sp * cyp + (x1 + x2) / 2, cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const th1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dth = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!fs && dth > 0) dth -= 2 * Math.PI;
  else if (fs && dth < 0) dth += 2 * Math.PI;
  const segs = Math.max(1, Math.ceil(Math.abs(dth) / (Math.PI / 2) - 1e-9));
  const d = dth / segs, t = (4 / 3) * Math.tan(d / 4);
  const out = [];
  let a0 = th1;
  const pt = (a, ox = 0, oy = 0) => {
    const ex = rx * Math.cos(a), ey = ry * Math.sin(a);
    return [cp * ex - sp * ey + cx + ox, sp * ex + cp * ey + cy + oy];
  };
  for (let i = 0; i < segs; i++) {
    const a1 = a0 + d;
    const dx0 = -rx * Math.sin(a0), dy0 = ry * Math.cos(a0), dx1 = -rx * Math.sin(a1), dy1 = ry * Math.cos(a1);
    const p0 = pt(a0), p3 = pt(a1);
    const c1 = [p0[0] + t * (cp * dx0 - sp * dy0), p0[1] + t * (sp * dx0 + cp * dy0)];
    const c2 = [p3[0] - t * (cp * dx1 - sp * dy1), p3[1] - t * (sp * dx1 + cp * dy1)];
    out.push([c1[0], c1[1], c2[0], c2[1], p3[0], p3[1]]);
    a0 = a1;
  }
  out[out.length - 1][4] = x2; out[out.length - 1][5] = y2; // no accumulated drift at the join
  return out;
}

/* ---------------------------------------------------------------- SVG path d → segments */
/** Segments in the path's own space: ["M",x,y] ["L",x,y] ["C",x1,y1,x2,y2,x,y] ["Z"]. */
export function parsePathD(d) {
  const toks = String(d || "").match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
  const segs = [];
  let i = 0, cmd = null, cx = 0, cy = 0, sx = 0, sy = 0;
  const num = () => parseFloat(toks[i++]);
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
    if (cmd == null) break;
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
    if (C === "Z") { segs.push(["Z"]); cx = sx; cy = sy; continue; }
    if (C === "M") { let x = num(), y = num(); if (rel) { x += cx; y += cy; } segs.push(["M", x, y]); cx = sx = x; cy = sy = y; cmd = rel ? "l" : "L"; }
    else if (C === "L") { let x = num(), y = num(); if (rel) { x += cx; y += cy; } segs.push(["L", x, y]); cx = x; cy = y; }
    else if (C === "H") { let x = num(); if (rel) x += cx; segs.push(["L", x, cy]); cx = x; }
    else if (C === "V") { let y = num(); if (rel) y += cy; segs.push(["L", cx, y]); cy = y; }
    else if (C === "C") {
      let a = [num(), num(), num(), num(), num(), num()];
      if (rel) a = a.map((v, k) => v + (k % 2 ? cy : cx));
      segs.push(["C", ...a]); cx = a[4]; cy = a[5];
    } else if (C === "Q") {
      let a = [num(), num(), num(), num()];
      if (rel) a = a.map((v, k) => v + (k % 2 ? cy : cx));
      const c1x = cx + (2 / 3) * (a[0] - cx), c1y = cy + (2 / 3) * (a[1] - cy);
      const c2x = a[2] + (2 / 3) * (a[0] - a[2]), c2y = a[3] + (2 / 3) * (a[1] - a[3]);
      segs.push(["C", c1x, c1y, c2x, c2y, a[2], a[3]]); cx = a[2]; cy = a[3];
    } else if (C === "A") {
      const rx = num(), ry = num(), rot = num(), fa = num(), fs = num();
      let x = num(), y = num(); if (rel) { x += cx; y += cy; }
      for (const b of arcToBeziers(cx, cy, rx, ry, rot, fa, fs, x, y)) segs.push(["C", ...b]);
      cx = x; cy = y;
    } else { i++; } // unsupported command (S/T): skip its token rather than loop forever
  }
  return segs;
}
const rectSegs = (x, y, w, h, rx, ry) => {
  rx = Math.min(rx || 0, w / 2); ry = Math.min(ry || rx || 0, h / 2);
  if (!(rx > 0) || !(ry > 0)) return [["M", x, y], ["L", x + w, y], ["L", x + w, y + h], ["L", x, y + h], ["Z"]];
  const k = 0.5522847498;
  return [["M", x + rx, y], ["L", x + w - rx, y],
    ["C", x + w - rx + rx * k, y, x + w, y + ry - ry * k, x + w, y + ry], ["L", x + w, y + h - ry],
    ["C", x + w, y + h - ry + ry * k, x + w - rx + rx * k, y + h, x + w - rx, y + h], ["L", x + rx, y + h],
    ["C", x + rx - rx * k, y + h, x, y + h - ry + ry * k, x, y + h - ry], ["L", x, y + ry],
    ["C", x, y + ry - ry * k, x + rx - rx * k, y, x + rx, y], ["Z"]];
};
const ellipseSegs = (cx, cy, rx, ry) => {
  const k = 0.5522847498;
  return [["M", cx + rx, cy],
    ["C", cx + rx, cy + ry * k, cx + rx * k, cy + ry, cx, cy + ry],
    ["C", cx - rx * k, cy + ry, cx - rx, cy + ry * k, cx - rx, cy],
    ["C", cx - rx, cy - ry * k, cx - rx * k, cy - ry, cx, cy - ry],
    ["C", cx + rx * k, cy - ry, cx + rx, cy - ry * k, cx + rx, cy], ["Z"]];
};
const pointsOf = (str) => {
  const v = String(str || "").split(/[\s,]+/).filter(Boolean).map(parseFloat);
  const out = [];
  for (let i = 0; i + 1 < v.length; i += 2) out.push([v[i], v[i + 1]]);
  return out;
};
const mapSegs = (segs, M) => segs.map((s) => {
  if (s[0] === "Z") return s;
  const o = [s[0]];
  for (let i = 1; i < s.length; i += 2) { const p = apply(M, s[i], s[i + 1]); o.push(p[0], p[1]); }
  return o;
});

/* ---------------------------------------------------------------- tree → draw items
 * A tree node is { tag, a: {attr: value} (presentation attrs, style merged in), kids: [...], str? , tw? }.
 * `a["data-testid"]` / `a["data-chip-text"]` etc. ride along so builders can tell parts apart. */
const SKIP_TAGS = new Set(["defs", "title", "desc", "style", "pattern", "clippath", "mask", "filter", "lineargradient", "radialgradient", "image", "foreignobject", "metadata"]);
const INHERIT = ["fill", "stroke", "stroke-width", "stroke-dasharray", "stroke-linecap", "stroke-linejoin", "fill-opacity", "stroke-opacity",
  "font-size", "font-weight", "font-style", "text-anchor", "dominant-baseline", "paint-order", "text-decoration", "font-family"];

/** The share of a font size the baseline sits below an SVG `dominant-baseline: middle` line. */
export const MIDDLE_BASELINE_DY = 0.36;

function isHitCompanion(a, fill, stroke) {
  // The canvas pairs every markup with a fat, near-invisible stroke for hit-testing; it is not ink.
  const sInk = stroke && stroke.a * (parseFloat(a["stroke-opacity"] ?? 1) || 1) > 0.02;
  const fInk = fill && fill.a * (parseFloat(a["fill-opacity"] ?? 1) || 1) > 0.02;
  return !sInk && !fInk;
}

/**
 * Flatten `tree` into draw items in PDF page space. `M0` maps tree user units → PDF points
 * (y already flipped). `patterns` is an id→tree lookup for `fill="url(#id)"`.
 */
export function flattenTree(tree, M0, patterns = {}) {
  const items = [];
  const degraded = new Set();
  const walk = (node, M, inh, src) => {
    if (!node || SKIP_TAGS.has(String(node.tag || "").toLowerCase())) return;
    const a = node.a || {};
    if (a["data-export"] === "skip" || a.display === "none" || a.visibility === "hidden") return;
    const tag = String(node.tag || "").toLowerCase();
    const cur = { ...inh };
    for (const k of INHERIT) if (a[k] != null && a[k] !== "") cur[k] = a[k];
    cur.opacity = (inh.opacity ?? 1) * (a.opacity != null && a.opacity !== "" ? parseFloat(a.opacity) : 1);
    const NM = a.transform ? compose(M, parseTransform(a.transform)) : M;
    const nsrc = a["data-testid"] || src;
    if (tag === "g" || tag === "svg" || tag === "a") { (node.kids || []).forEach((k) => walk(k, NM, cur, nsrc)); return; }

    // a <line> has no interior, whatever `fill` it inherits
    const fillC = tag === "line" ? null : parseColor(cur.fill == null ? "black" : (/^url\(/.test(cur.fill) ? "none" : cur.fill));
    const patId = /^url\(#([^)]+)\)/.exec(cur.fill || "");
    const strokeC = parseColor(cur.stroke == null ? "none" : cur.stroke);

    if (tag === "text") {
      const str = node.str != null ? node.str : (node.kids || []).map((k) => k.str || "").join("");
      if (!str || !fillC) return;
      const fs = parseFloat(cur["font-size"]) || 12, k = scaleOf(NM);
      const bold = /^(bold|[6-9]00)$/.test(String(cur["font-weight"] || ""));
      const italic = /italic|oblique/.test(String(cur["font-style"] || ""));
      const anchor = cur["text-anchor"] || "start";
      const x = parseFloat(a.x) || 0, y = parseFloat(a.y) || 0;
      const dy = cur["dominant-baseline"] === "middle" || cur["dominant-baseline"] === "central" ? MIDDLE_BASELINE_DY * fs : 0;
      if (winAnsi(str).lossy) degraded.add("text characters with no PDF-font equivalent were replaced with “?”");
      const w = Number.isFinite(node.tw) && node.tw > 0 ? node.tw : (helvWidth(winAnsi(str).text, bold) * fs) / 1000; // user units
      const x0 = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
      const base = apply(NM, x0, y + dy);
      const strokeW = parseFloat(cur["stroke-width"]);
      const halo = strokeC && strokeW > 0 ? { c: strokeC, w: strokeW * k, under: /^\s*stroke/.test(cur["paint-order"] || "") } : null;
      items.push({
        t: "text", src: nsrc, str, x: base[0], y: base[1], ang: Math.atan2(NM[1], NM[0]), size: fs * k, bold, italic,
        w: w * k, helvW: (helvWidth(winAnsi(str).text, bold) * fs * k) / 1000,
        fill: fillC, fillA: fillC.a * (parseFloat(cur["fill-opacity"] ?? 1) || 1) * cur.opacity,
        halo, haloA: cur.opacity * (strokeC ? strokeC.a : 1),
        underline: /underline/.test(cur["text-decoration"] || ""),
      });
      return;
    }

    let segs = null;
    if (tag === "line") segs = [["M", parseFloat(a.x1) || 0, parseFloat(a.y1) || 0], ["L", parseFloat(a.x2) || 0, parseFloat(a.y2) || 0]];
    else if (tag === "polyline" || tag === "polygon") {
      const p = pointsOf(a.points);
      if (p.length < 2) return;
      segs = p.map((q, i) => [i ? "L" : "M", q[0], q[1]]);
      if (tag === "polygon") segs.push(["Z"]);
    } else if (tag === "rect") segs = rectSegs(parseFloat(a.x) || 0, parseFloat(a.y) || 0, parseFloat(a.width) || 0, parseFloat(a.height) || 0, parseFloat(a.rx) || 0, parseFloat(a.ry) || 0);
    else if (tag === "ellipse") segs = ellipseSegs(parseFloat(a.cx) || 0, parseFloat(a.cy) || 0, parseFloat(a.rx) || 0, parseFloat(a.ry) || 0);
    else if (tag === "circle") segs = ellipseSegs(parseFloat(a.cx) || 0, parseFloat(a.cy) || 0, parseFloat(a.r) || 0, parseFloat(a.r) || 0);
    else if (tag === "path") segs = parsePathD(a.d);
    if (!segs || !segs.length) return;

    const sw = strokeC ? (parseFloat(cur["stroke-width"] ?? 1) || 0) : 0;
    const pat = patId && patterns[patId[1]] ? patterns[patId[1]] : null;
    if (patId && !pat) degraded.add("pattern fill unavailable");
    if (!pat && isHitCompanion(cur, fillC, strokeC)) return;
    if (!pat && !(strokeC && sw > 0) && !fillC) return;
    const da = String(cur["stroke-dasharray"] || "");
    const dash = /[\d]/.test(da) && da !== "none" ? da.split(/[\s,]+/).filter(Boolean).map(parseFloat).filter((v) => Number.isFinite(v)) : [];
    const k = scaleOf(NM);
    items.push({
      t: "path", src: nsrc, segs: mapSegs(segs, NM),
      fill: pat ? null : fillC, fillA: fillC ? fillC.a * (parseFloat(cur["fill-opacity"] ?? 1) || 1) * cur.opacity : 0,
      pat: pat ? { id: patId[1], tree: pat, M: NM, op: cur.opacity } : null,
      stroke: strokeC && sw > 0 ? strokeC : null, sw: sw * k,
      strokeA: strokeC ? strokeC.a * (parseFloat(cur["stroke-opacity"] ?? 1) || 1) * cur.opacity : 0,
      dash: dash.map((v) => v * k),
      cap: cur["stroke-linecap"] || "butt", join: cur["stroke-linejoin"] || "miter",
    });
  };
  walk(tree, M0, { opacity: 1 }, null);
  return { items, degraded: [...degraded] };
}

/* ---------------------------------------------------------------- geometry helpers */
export function itemBBox(it) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
  if (it.t === "path") {
    for (const s of it.segs) for (let i = 1; i < s.length; i += 2) add(s[i], s[i + 1]);
    if (!Number.isFinite(x0)) return null;
    const pad = (it.stroke ? it.sw / 2 : 0) + 0.5;
    return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
  }
  // text: a box along the baseline direction, inflated by the font size
  const c = Math.cos(it.ang), s = Math.sin(it.ang);
  const hw = it.w, up = it.size * 0.95, dn = it.size * 0.3;
  for (const [u, v] of [[0, -dn], [hw, -dn], [hw, up], [0, up]]) add(it.x + u * c - v * s, it.y + u * s + v * c);
  const pad = (it.halo ? it.halo.w / 2 : 0) + 0.5;
  return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
}
export const unionBox = (boxes) => boxes.filter(Boolean).reduce((u, b) => (u ? [Math.min(u[0], b[0]), Math.min(u[1], b[1]), Math.max(u[2], b[2]), Math.max(u[3], b[3])] : b.slice()), null);
export const intersectBox = (a, b) => {
  const r = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
  return r[2] > r[0] && r[3] > r[1] ? r : null;
};
/** On-curve vertices of a flattened path (control points skipped), closing duplicate dropped. */
export function pathVertices(it) {
  const v = [];
  for (const s of it.segs) {
    if (s[0] === "M" || s[0] === "L") v.push([s[1], s[2]]);
    else if (s[0] === "C") v.push([s[5], s[6]]);
  }
  if (v.length > 2 && Math.hypot(v[0][0] - v[v.length - 1][0], v[0][1] - v[v.length - 1][1]) < 1e-6) v.pop();
  return v;
}

/* ---------------------------------------------------------------- items → appearance stream */
const FONT_KEY = (bold, italic) => (bold ? (italic ? "F4" : "F2") : (italic ? "F3" : "F1"));
export const BASE_FONTS = { F1: "Helvetica", F2: "Helvetica-Bold", F3: "Helvetica-Oblique", F4: "Helvetica-BoldOblique" };

/** Draw `items` into one content stream. Returns { stream, fonts:Set, gs:[{name,ca,CA}], patterns:[…] }. */
export function itemsToStream(items) {
  const fonts = new Set(), gsList = [], patterns = [];
  const gsName = (ca, CA) => {
    const key = `${n3(Math.max(0, Math.min(1, ca)))}_${n3(Math.max(0, Math.min(1, CA)))}`;
    let g = gsList.find((x) => x.key === key);
    if (!g) { g = { key, name: `G${gsList.length}`, ca: Math.max(0, Math.min(1, ca)), CA: Math.max(0, Math.min(1, CA)) }; gsList.push(g); }
    return g.name;
  };
  const out = [];
  const pathOps = (segs) => segs.map((s) => (s[0] === "M" ? `${n3(s[1])} ${n3(s[2])} m` : s[0] === "L" ? `${n3(s[1])} ${n3(s[2])} l`
    : s[0] === "C" ? `${s.slice(1).map(n3).join(" ")} c` : "h")).join("\n");
  const rg = (c) => `${c.rgb.map(n3).join(" ")}`;
  for (const it of items) {
    if (it.t === "path") {
      const hasFill = !!it.fill && it.fillA > 0.001, hasStroke = !!it.stroke && it.sw > 0 && it.strokeA > 0.001;
      if (!hasFill && !hasStroke && !it.pat) continue;
      out.push("q");
      out.push(`/${gsName(hasFill ? it.fillA : 1, hasStroke ? it.strokeA : 1)} gs`);
      if (it.pat) {
        const p = { name: `P${patterns.length}`, ...it.pat };
        patterns.push(p);
        out.push(`/Pattern cs /${p.name} scn`);
      } else if (hasFill) out.push(`${rg(it.fill)} rg`);
      if (hasStroke) {
        out.push(`${rg(it.stroke)} RG`, `${n3(it.sw)} w`);
        out.push(`${it.cap === "round" ? 1 : it.cap === "square" ? 2 : 0} J`, `${it.join === "round" ? 1 : it.join === "bevel" ? 2 : 0} j`);
        if (it.dash.length) out.push(`[${(it.dash.length % 2 ? it.dash.concat(it.dash) : it.dash).map(n3).join(" ")}] 0 d`);
      }
      out.push(pathOps(it.segs));
      out.push(hasStroke && (hasFill || it.pat) ? "B" : hasStroke ? "S" : "f");
      out.push("Q");
    } else {
      const wa = winAnsi(it.str).text;
      const fk = FONT_KEY(it.bold, it.italic);
      fonts.add(fk);
      const tz = it.helvW > 0 && it.w > 0 ? Math.max(60, Math.min(140, (it.w / it.helvW) * 100)) : 100;
      const c = Math.cos(it.ang), s = Math.sin(it.ang);
      const draw = (mode) => {
        out.push("BT", `/${fk} ${n3(it.size)} Tf`, `${n3(tz)} Tz`, `${mode} Tr`, `${n3(c)} ${n3(s)} ${n3(-s)} ${n3(c)} ${n3(it.x)} ${n3(it.y)} Tm`, `${pdfStrLiteral(wa)} Tj`, "ET");
      };
      const fillOps = () => { out.push("q", `/${gsName(it.fillA, it.fillA)} gs`, `${rg(it.fill)} rg`); draw(0); out.push("Q"); };
      const haloOps = () => { out.push("q", `/${gsName(it.haloA, it.haloA)} gs`, `${rg(it.halo.c)} RG`, `${n3(it.halo.w)} w`, "1 j"); draw(1); out.push("Q"); };
      if (it.halo && it.halo.under) { haloOps(); fillOps(); } else { fillOps(); if (it.halo) haloOps(); }
      if (it.underline) {
        const ux = it.x + (c * 0), uy = it.y - it.size * 0.12;
        out.push("q", `/${gsName(it.fillA, it.fillA)} gs`, `${rg(it.fill)} RG`, `${n3(Math.max(0.3, it.size * 0.06))} w`,
          `${n3(ux)} ${n3(uy)} m ${n3(ux + c * it.w)} ${n3(uy + s * it.w)} l S`, "Q");
      }
    }
  }
  return { stream: out.join("\n") + "\n", fonts, gs: gsList, patterns };
}

/** The content stream + resources for a tiling pattern's own tree (pattern space, no flip). */
export function patternStream(p) {
  const a = p.tree.a || {};
  const w = parseFloat(a.width) || 8, h = parseFloat(a.height) || 8;
  const inner = flattenTree({ tag: "g", a: {}, kids: p.tree.kids || [] }, IDENT, {});
  const body = itemsToStream(inner.items);
  const M = compose(p.M, parseTransform(a.patternTransform));
  return { w, h, matrix: M, ...body };
}

/* ---------------------------------------------------------------- dates */
const pdfDate = (iso) => {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  const p = (x) => String(x).padStart(2, "0");
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
};

/* ---------------------------------------------------------------- descriptors → annotation specs */
const SUBJECT = { line: "Line", polyline: "Polyline", rect: "Rectangle", ellipse: "Ellipse", polygon: "Polygon", cloud: "Cloud" };
const MEASURE_SUBJECT = { line: "Length measurement", path: "Length measurement", polyline: "Length measurement", area: "Area measurement", count: "Count" };

const rgbOf = (c) => (c ? c.rgb.slice() : null);
const aligned = (it, tol = 0.5) => {
  // is this closed path an axis-aligned rectangle? (all vertices on its bbox's four corners)
  const v = pathVertices(it);
  if (v.length !== 4) return false;
  const b = itemBBox({ ...it, stroke: null, sw: 0 });
  const bx = [b[0] + 0.5, b[1] + 0.5, b[2] - 0.5, b[3] - 0.5];
  return v.every((p) => (Math.abs(p[0] - bx[0]) < tol || Math.abs(p[0] - bx[2]) < tol) && (Math.abs(p[1] - bx[1]) < tol || Math.abs(p[1] - bx[3]) < tol));
};

/**
 * Build one annotation spec per descriptor.
 *
 * descriptor = { family: "markup"|"callout"|"measure", id, kind, tree, hints?, meta? }
 * opts       = { M0: user→PDF matrix, frame: [x0,y0,x1,y1] PDF rect the sheet's plan window occupies,
 *                patterns: id→tree, now: ISO string, author: string }
 * Returns { annots: [...], skipped: [{id, why}], degraded: [...] }.
 */
export function buildAnnotations(descriptors, opts) {
  const { M0, frame, patterns = {}, now = new Date().toISOString(), author = "Planyr" } = opts;
  const annots = [], skipped = [], degraded = [];
  for (const d of descriptors) {
    const flat = flattenTree(d.tree, M0, patterns);
    const items = flat.items;
    flat.degraded.forEach((g) => degraded.push(`${d.family} ${d.id}: ${g}`));
    if (!items.length) { skipped.push({ id: d.id, family: d.family, why: "nothing drawn" }); continue; }
    const full = unionBox(items.map(itemBBox));
    const rect = intersectBox(full, frame);
    if (!rect) { skipped.push({ id: d.id, family: d.family, why: "outside the plan window" }); continue; }
    const ink = items.filter((i) => i.t === "path");
    const main = ink.find((i) => !/leader|callout-box/.test(i.src || "")) || ink[0];
    const meta = d.meta || {};
    const created = meta.createdAt || null, modified = meta.modifiedAt || meta.createdAt || null;
    const base = {
      id: d.id, family: d.family, kind: d.kind, rect, items,
      nm: `planyr-${d.family}-${String(d.id).replace(/[^A-Za-z0-9_-]/g, "")}`,
      subj: meta.subject || null, contents: meta.comment || "", title: meta.author || author,
      created: pdfDate(created || now), modified: pdfDate(modified || now),
      color: null, ic: null, ca: 1, bw: 0, dash: [], degraded: flat.degraded,
    };
    const st = main || {};
    base.color = rgbOf(st.stroke); base.ic = rgbOf(st.fill);
    base.bw = st.stroke ? st.sw : 0; base.dash = st.dash || [];
    base.ca = st.stroke ? st.strokeA : (st.fill ? st.fillA : 1);
    if (st.pat) base.degraded = base.degraded.concat(["hatch drawn as a tiling pattern in the appearance only"]);

    if (d.family === "markup") {
      base.subj = base.subj || SUBJECT[d.kind] || "Markup";
      const label = items.filter((i) => i.t === "text").map((i) => i.str).join(" ");
      if (!base.contents && label) base.contents = label;
      if (d.kind === "line" && main) {
        const v = pathVertices(main);
        annots.push({ ...base, subtype: "Line", L: [v[0][0], v[0][1], v[v.length - 1][0], v[v.length - 1][1]], LE: ["None", "None"] });
      } else if (d.kind === "polyline" && main) {
        annots.push({ ...base, subtype: "PolyLine", vertices: pathVertices(main).flat(), LE: ["None", "None"] });
      } else if (d.kind === "cloud" && main) {
        const hv = d.hints && d.hints.verts ? d.hints.verts.map((p) => apply(M0, p.x, p.y)) : pathVertices(main);
        annots.push({ ...base, subtype: "Polygon", vertices: hv.flat(), BE: { S: "C", I: d.hints && d.hints.arcFt > 4 ? 2 : 1 } });
      } else if (d.kind === "polygon" && main) {
        annots.push({ ...base, subtype: "Polygon", vertices: pathVertices(main).flat() });
      } else if (d.kind === "rect" && main) {
        if (aligned(main)) annots.push({ ...base, subtype: "Square" });
        else annots.push({ ...base, subtype: "Polygon", vertices: pathVertices(main).flat(), subj: base.subj + " (rotated)" });
      } else if (d.kind === "ellipse" && main) {
        const v = pathVertices(main);
        // four on-curve points are the axis extremes; an axis-aligned ellipse has them on the bbox mid-edges
        const bb = itemBBox({ ...main, stroke: null, sw: 0 });
        const mids = [[(bb[0] + bb[2]) / 2, bb[1] + 0.5], [bb[2] - 0.5, (bb[1] + bb[3]) / 2], [(bb[0] + bb[2]) / 2, bb[3] - 0.5], [bb[0] + 0.5, (bb[1] + bb[3]) / 2]];
        const axis = v.length === 4 && v.every((p) => mids.some((m) => Math.hypot(p[0] - m[0], p[1] - m[1]) < 0.6));
        if (axis) annots.push({ ...base, subtype: "Circle" });
        else {
          // a rotated ellipse has no native subtype: a 72-gon Polygon is editable and indistinguishable at print size
          const poly = [];
          for (let i = 0; i < 72; i++) { const t = (i / 72) * 2 * Math.PI; poly.push(...ellipseApprox(main, t)); }
          annots.push({ ...base, subtype: "Polygon", vertices: poly, subj: base.subj + " (rotated)" });
        }
      } else {
        // never silently drop: anything unmapped becomes a Stamp that carries its appearance
        annots.push({ ...base, subtype: "Stamp", subj: base.subj + " (unmapped)" });
        degraded.push(`markup ${d.id}: kind "${d.kind}" has no native subtype — written as a Stamp`);
      }
    } else if (d.family === "callout") {
      const box = ink.find((i) => /callout-box/.test(i.src || "")) || null;
      const stubs = ink.filter((i) => /leader-stub/.test(i.src || "")), runs = ink.filter((i) => /leader-run/.test(i.src || ""));
      const txt = items.filter((i) => i.t === "text");
      const lines = (d.meta && d.meta.lines) || txt.map((t) => t.str);
      const t0 = txt[0] || {};
      const boxBB = box ? itemBBox({ ...box, stroke: null, sw: 0 }) : rect;
      const boxPad = box && box.stroke ? box.sw / 2 : 0;
      const innerBox = [boxBB[0] + 0.5, boxBB[1] + 0.5, boxBB[2] - 0.5, boxBB[3] - 0.5];
      let cl = null;
      if (runs.length) {
        const r = pathVertices(runs[0]), s = stubs[0] ? pathVertices(stubs[0]) : null;
        const tip = r[r.length - 1], elbow = r[0], origin = s ? s[0] : elbow;
        const zeroStub = Math.hypot(elbow[0] - origin[0], elbow[1] - origin[1]) < 0.05;
        cl = zeroStub ? [tip[0], tip[1], origin[0], origin[1]] : [tip[0], tip[1], elbow[0], elbow[1], origin[0], origin[1]];
      }
      const dx = Math.cos(t0.ang || 0), align = d.meta && d.meta.align === "left" ? 0 : d.meta && d.meta.align === "right" ? 2 : 1;
      void dx;
      const fk = FONT_KEY(!!t0.bold, !!t0.italic);
      const col = t0.fill ? t0.fill.rgb : [0, 0, 0];
      annots.push({
        ...base, subtype: "FreeText", subj: base.subj || (cl ? "Callout" : "Text Box"), contents: lines.join("\n"),
        IT: cl ? "FreeTextCallout" : "FreeText", CL: cl, LE: cl ? "ClosedArrow" : null,
        Q: align, RD: [Math.max(0, innerBox[0] - rect[0] - boxPad), Math.max(0, innerBox[1] - rect[1] - boxPad), Math.max(0, rect[2] - innerBox[2] - boxPad), Math.max(0, rect[3] - innerBox[3] - boxPad)],
        DA: { font: fk, size: t0.size || 12, rgb: col },
        extraLeaders: Math.max(0, runs.length - 1),
        rotated: !!(d.meta && d.meta.rot && d.meta.rot % 90 !== 0) || (d.meta && d.meta.rot % 90 === 0 && d.meta.rot !== 0),
      });
      if (runs.length > 1) degraded.push(`callout ${d.id}: ${runs.length - 1} extra leader(s) are drawn in the appearance only (a PDF callout carries one native leader)`);
    } else {
      const mode = d.kind;
      const chip = items.filter((i) => i.t === "text" && /chip|tally/.test(i.src || "") || (i.t === "text" && d.meta && d.meta.chipTexts && d.meta.chipTexts.includes(i.str)));
      const chipLines = (d.meta && d.meta.chipTexts) || [];
      void chip;
      base.subj = base.subj || MEASURE_SUBJECT[mode] || "Measurement";
      base.contents = base.contents || chipLines.join("\n");
      if (mode === "area" && main) annots.push({ ...base, subtype: "Polygon", vertices: pathVertices(main).flat() });
      else if (mode === "count") { annots.push({ ...base, subtype: "Stamp" }); degraded.push(`measure ${d.id}: a count has no native subtype — written as a Stamp`); }
      else if (main) {
        const v = pathVertices(main);
        if (v.length === 2) annots.push({ ...base, subtype: "Line", L: [v[0][0], v[0][1], v[1][0], v[1][1]], LE: ["None", "None"] });
        else annots.push({ ...base, subtype: "PolyLine", vertices: v.flat(), LE: ["None", "None"] });
      } else { annots.push({ ...base, subtype: "Stamp" }); degraded.push(`measure ${d.id}: no line geometry — written as a Stamp`); }
    }
  }

  // appearance streams, built last so pattern/gs resources are collected per annotation
  for (const a of annots) {
    const body = itemsToStream(a.items);
    a.ap = { bbox: a.rect, ...body, patternStreams: body.patterns.map((p) => ({ name: p.name, ...patternStream(p) })) };
    delete a.items;
  }
  return { annots, skipped, degraded };
}

function ellipseApprox(it, t) {
  // sample a flattened (Bézier) ellipse path by angle about its bbox centre — only used for rotated ellipses
  const b = itemBBox({ ...it, stroke: null, sw: 0 });
  const v = pathVertices(it);
  const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
  // semi-axes from the 4 extreme on-curve points (they lie on the axes in the ellipse's own frame)
  const r = v.map((p) => [p[0] - cx, p[1] - cy]);
  const a1 = r[0], a2 = r[1];
  return [cx + a1[0] * Math.cos(t) + a2[0] * Math.sin(t), cy + a1[1] * Math.cos(t) + a2[1] * Math.sin(t)];
}

/* ---------------------------------------------------------------- PDF object text for one annotation */
const arr = (a) => `[${a.map(n3).join(" ")}]`;
const textString = (s) => {
  const t = String(s == null ? "" : s);
  if (/^[\x20-\x7e]*$/.test(t)) return `(${t.replace(/[\\()]/g, "\\$&")})`;
  let hex = "FEFF";
  for (let i = 0; i < t.length; i++) hex += t.charCodeAt(i).toString(16).padStart(4, "0");
  return `<${hex}>`;
};
export const pdfTextString = textString;

/**
 * The annotation dictionary body (without the /AP reference), as a string. `apRef` is "N 0 R".
 * /F 4 = Print only — never ReadOnly (64) or Locked (128): the recipient must be able to edit.
 */
export function annotationDict(a, apRef) {
  const f = [`/Type /Annot`, `/Subtype /${a.subtype}`, `/Rect ${arr(a.rect)}`, `/F 4`, `/NM ${textString(a.nm)}`,
    `/T ${textString(a.title)}`, `/Contents ${textString(a.contents)}`];
  if (a.subj) f.push(`/Subj ${textString(a.subj)}`);
  if (a.modified) f.push(`/M (${a.modified})`);
  if (a.created) f.push(`/CreationDate (${a.created})`);
  if (a.color) f.push(`/C ${arr(a.color)}`);
  if (a.ic && a.subtype !== "Line" && a.subtype !== "PolyLine") f.push(`/IC ${arr(a.ic)}`);
  f.push(`/CA ${n3(a.ca)}`);
  if (a.bw > 0 || a.dash.length) {
    f.push(`/BS << /Type /Border /W ${n3(a.bw)} /S ${a.dash.length ? "/D" : "/S"}${a.dash.length ? ` /D ${arr(a.dash)}` : ""} >>`);
  }
  if (a.subtype === "Line") f.push(`/L ${arr(a.L)}`, `/LE [/${a.LE[0]} /${a.LE[1]}]`);
  if (a.subtype === "PolyLine" || a.subtype === "Polygon") f.push(`/Vertices ${arr(a.vertices)}`);
  if (a.subtype === "PolyLine") f.push(`/LE [/${a.LE[0]} /${a.LE[1]}]`);
  if (a.BE) f.push(`/BE << /S /${a.BE.S} /I ${a.BE.I} >>`);
  if (a.subtype === "FreeText") {
    const c = a.DA.rgb.map(n3).join(" ");
    f.push(`/DA (/Helv ${n3(a.DA.size)} Tf ${c} rg)`, `/Q ${a.Q}`, `/IT /${a.IT}`, `/RD ${arr(a.RD)}`);
    f.push(`/DS ${textString(`font: Helvetica ${n3(a.DA.size)}pt; text-align:${["left", "center", "right"][a.Q]}`)}`);
    if (a.CL) f.push(`/CL ${arr(a.CL)}`, `/LE /${a.LE}`);
  }
  if (a.subtype === "Stamp") f.push(`/Name /Planyr`);
  f.push(`/AP << /N ${apRef} >>`);
  return `<< ${f.join(" ")} >>`;
}
