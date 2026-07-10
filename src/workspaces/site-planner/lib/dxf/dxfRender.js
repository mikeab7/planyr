/* DXF → SVG renderer (B747) — pure + DOM-free so it runs inside the DXF Web Worker and
 * is unit-tested. Consumes a `dxf-parser` parse tree and emits a self-contained SVG string
 * plus the metadata the overlay needs (raster dims, true-units feet-per-pixel, unsupported
 * entity tally). The main thread rasterizes the SVG to a transparent PNG (dxfOverlay.js).
 *
 * Supported civil subset: LINE, LWPOLYLINE/POLYLINE (incl. bulge arcs), ARC, CIRCLE,
 * ELLIPSE, TEXT/MTEXT (basic placement, no font fidelity), INSERT (block refs expanded
 * recursively with nested transforms). Every other entity type is COUNTED by type and
 * surfaced by the caller — never silently dropped. */
import {
  insunitsToFeet, insertMatrix, matMul, matApply,
  dxfArcPoints, arcPoints, ellipsePoints, bulgeArcPoints, r3,
} from "./dxfGeom.js";

const RASTER_MAX = 4500;   // longest raster edge in px (matches the B749 PDF base; crisp, memory-safe)
const STROKE_PX = 2;       // nominal linework weight in raster px
const INK = "#1f2937";     // dark slate — a legible backdrop, knocked-transparent paper behind it
const MAX_INSERT_DEPTH = 24;
const SUPPORTED = new Set(["LINE", "LWPOLYLINE", "POLYLINE", "ARC", "CIRCLE", "ELLIPSE", "TEXT", "MTEXT", "INSERT"]);

const translate = (tx, ty) => [1, 0, 0, 1, tx, ty];

// Flatten one LWPOLYLINE/POLYLINE (dxf-parser gives both `vertices:[{x,y,bulge?}]` + `shape`
// for closed) into a continuous model-space point list, expanding bulge arcs.
function polyPoints(e) {
  const vs = (e.vertices || []).filter((v) => Number.isFinite(v.x) && Number.isFinite(v.y));
  if (vs.length < 2) return vs.map((v) => ({ x: v.x, y: v.y }));
  const closed = !!e.shape;
  const pts = [{ x: vs[0].x, y: vs[0].y }];
  const segs = closed ? vs.length : vs.length - 1;
  for (let i = 0; i < segs; i++) {
    const a = vs[i], b = vs[(i + 1) % vs.length];
    if (a.bulge) for (const p of bulgeArcPoints(a, b, a.bulge)) pts.push(p);
    else pts.push({ x: b.x, y: b.y });
  }
  return { pts, closed };
}

// Strip MTEXT inline formatting so the visible words survive (no font fidelity by design).
function cleanMText(s) {
  if (!s) return "";
  return String(s)
    .replace(/\\P/g, " ")                       // paragraph break → space
    .replace(/\\[A-Za-z][^;\\]*;/g, "")          // arg codes ending in ';': \fArial|...; \H2.5x; \C1; \A1; \pxq…;
    .replace(/\\[LlOoKkNX]/g, "")                // no-arg toggles: underline \L\l, overline \O\o, strike \K\k, wrap \N\X
    .replace(/\\[~]/g, " ")                      // non-breaking space
    .replace(/[{}]/g, "")                        // grouping braces
    .replace(/\\\\/g, "\\")                      // escaped backslash → literal
    .trim();
}

// Recursively collect drawable shapes into `acc`, applying the composed INSERT transform M.
function collect(entities, blocks, M, acc, depth) {
  for (const e of entities || []) {
    if (!e || !e.type) continue;
    switch (e.type) {
      case "LINE": {
        const v = e.vertices || [];
        if (v.length >= 2) acc.polys.push({ pts: [matApply(M, v[0].x, v[0].y), matApply(M, v[1].x, v[1].y)], closed: false });
        break;
      }
      case "LWPOLYLINE":
      case "POLYLINE": {
        const r = polyPoints(e);
        const pts = (r.pts || r).map((p) => matApply(M, p.x, p.y));
        if (pts.length >= 2) acc.polys.push({ pts, closed: !!r.closed });
        break;
      }
      case "ARC": {
        if (e.center && Number.isFinite(e.radius))
          acc.polys.push({ pts: dxfArcPoints(e.center.x, e.center.y, e.radius, e.startAngle || 0, e.endAngle ?? 2 * Math.PI).map((p) => matApply(M, p.x, p.y)), closed: false });
        break;
      }
      case "CIRCLE": {
        if (e.center && Number.isFinite(e.radius))
          acc.polys.push({ pts: arcPoints(e.center.x, e.center.y, e.radius, 0, 2 * Math.PI).map((p) => matApply(M, p.x, p.y)), closed: true });
        break;
      }
      case "ELLIPSE": {
        if (e.center && e.majorAxisEndPoint)
          acc.polys.push({ pts: ellipsePoints(e.center, e.majorAxisEndPoint, e.axisRatio, e.startAngle, e.endAngle).map((p) => matApply(M, p.x, p.y)), closed: (e.startAngle || 0) === 0 && Math.abs((e.endAngle || 0) - 2 * Math.PI) < 1e-3 });
        break;
      }
      case "TEXT":
      case "MTEXT": {
        const pos = e.startPoint || e.position;
        const str = e.type === "MTEXT" ? cleanMText(e.text) : (e.text || "");
        const h = e.textHeight || e.height || 0;
        if (pos && str && h > 0) {
          const p = matApply(M, pos.x, pos.y);
          const scale = Math.sqrt(Math.abs(M[0] * M[3] - M[1] * M[2])) || 1;
          const mRot = Math.atan2(M[1], M[0]) * 180 / Math.PI;
          acc.texts.push({ x: p.x, y: p.y, h: h * scale, rot: (e.rotation || 0) + mRot, str, hang: e.type === "MTEXT" });
        }
        break;
      }
      case "INSERT": {
        const blk = e.name && blocks ? blocks[e.name] : null;
        if (blk && Array.isArray(blk.entities) && depth < MAX_INSERT_DEPTH) {
          const base = blk.position || { x: 0, y: 0 };
          // MINSERT: a rectangular array (columnCount×rowCount at column/row spacing). The array is
          // laid out along the INSERT's ROTATED axes, so each cell offset is rotated by `rotation`.
          const cols = Math.max(1, e.columnCount || 1), rows = Math.max(1, e.rowCount || 1);
          const cSp = e.columnSpacing || 0, rSp = e.rowSpacing || 0;
          const rot = (e.rotation || 0) * Math.PI / 180, cos = Math.cos(rot), sin = Math.sin(rot);
          const pos = e.position || { x: 0, y: 0 };
          let cells = 0;
          for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
            if (++cells > 4096) break; // pathological-array backstop
            const ox = c * cSp, oy = r * rSp;
            const cellPos = { x: pos.x + (ox * cos - oy * sin), y: pos.y + (ox * sin + oy * cos) };
            const M2 = matMul(matMul(M, insertMatrix({ ...e, position: cellPos })), translate(-(base.x || 0), -(base.y || 0)));
            collect(blk.entities, blocks, M2, acc, depth + 1);
          }
        } else {
          acc.unsupported[e.type] = (acc.unsupported[e.type] || 0) + 1; // missing block / too deep
        }
        break;
      }
      default:
        acc.unsupported[e.type] = (acc.unsupported[e.type] || 0) + 1;
    }
  }
}

function grow(b, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  if (x < b.minX) b.minX = x; if (x > b.maxX) b.maxX = x;
  if (y < b.minY) b.minY = y; if (y > b.maxY) b.maxY = y;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* Render a dxf-parser tree → { ok, svg, imgW, imgH, ftPerPx, unitsKnown, unitsLabel,
 * modelW, modelH, entityCount, unsupported:{count,types} }. Returns { ok:false, reason }
 * when there is nothing drawable (empty ENTITIES or a section of only unsupported types),
 * so the caller can surface it rather than place a blank overlay. */
export function renderDxfToSvg(parsed, { rasterMax = RASTER_MAX } = {}) {
  const header = (parsed && parsed.header) || {};
  const blocks = (parsed && parsed.blocks) || {};
  const { ftPerUnit, known, label } = insunitsToFeet(header.$INSUNITS);

  const acc = { polys: [], texts: [], unsupported: {} };
  collect((parsed && parsed.entities) || [], blocks, [1, 0, 0, 1, 0, 0], acc, 0);

  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const poly of acc.polys) for (const p of poly.pts) grow(b, p.x, p.y);
  for (const t of acc.texts) { grow(b, t.x, t.y); grow(b, t.x + t.h, t.y + t.h); }

  const entityCount = acc.polys.length + acc.texts.length;
  const unsupportedTypes = Object.keys(acc.unsupported).sort();
  const unsupportedCount = unsupportedTypes.reduce((s, k) => s + acc.unsupported[k], 0);

  if (!entityCount || !Number.isFinite(b.minX)) {
    return { ok: false, reason: "no-geometry", unsupported: { count: unsupportedCount, types: unsupportedTypes, byType: acc.unsupported } };
  }

  // A purely 1-D drawing (all geometry collinear) would give a 0-width/height viewBox — pad the
  // degenerate axis symmetrically so the raster + viewBox stay valid. Real 2-D sheets are unaffected
  // (the pad is 0.5% of the long edge, far below any real span).
  const longSpan = Math.max(b.maxX - b.minX, b.maxY - b.minY, 1);
  const minSpan = longSpan * 0.005;
  if (b.maxX - b.minX < minSpan) { const c = (b.minX + b.maxX) / 2; b.minX = c - minSpan / 2; b.maxX = c + minSpan / 2; }
  if (b.maxY - b.minY < minSpan) { const c = (b.minY + b.maxY) / 2; b.minY = c - minSpan / 2; b.maxY = c + minSpan / 2; }

  // Model bounds → raster dims (longest edge = rasterMax, aspect preserved, ≥1px).
  const modelW = Math.max(b.maxX - b.minX, 1e-6);
  const modelH = Math.max(b.maxY - b.minY, 1e-6);
  const scale = rasterMax / Math.max(modelW, modelH);
  const imgW = Math.max(1, Math.round(modelW * scale));
  const imgH = Math.max(1, Math.round(modelH * scale));
  const ftPerPx = (modelW * ftPerUnit) / imgW; // feet per raster pixel — on-map width = imgW·ftPerPx = real feet

  // SVG coords: flip Y (DXF is Y-up, SVG is Y-down) by mapping y → maxY − y, x → x − minX.
  const fx = (x) => r3(x - b.minX);
  const fy = (y) => r3(b.maxY - y);
  const strokeW = r3(STROKE_PX * modelW / imgW);

  const parts = [];
  for (const poly of acc.polys) {
    if (poly.pts.length < 2) continue;
    let d = `M${fx(poly.pts[0].x)} ${fy(poly.pts[0].y)}`;
    for (let i = 1; i < poly.pts.length; i++) d += `L${fx(poly.pts[i].x)} ${fy(poly.pts[i].y)}`;
    if (poly.closed) d += "Z";
    parts.push(`<path d="${d}"/>`);
  }
  for (const t of acc.texts) {
    const x = fx(t.x), y = fy(t.y);
    // model CCW rotation → SVG (Y-down) is negated; anchor at the text origin.
    const rot = Math.abs(t.rot) > 0.01 ? ` transform="rotate(${r3(-t.rot)} ${x} ${y})"` : "";
    const baseline = t.hang ? ` dominant-baseline="hanging"` : "";
    parts.push(`<text x="${x}" y="${y}" font-size="${r3(t.h)}"${baseline}${rot}>${esc(t.str)}</text>`);
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${imgW}" height="${imgH}" viewBox="0 0 ${r3(modelW)} ${r3(modelH)}">` +
    `<g fill="none" stroke="${INK}" stroke-width="${strokeW}" stroke-linecap="round" stroke-linejoin="round">` +
    parts.filter((p) => p.startsWith("<path")).join("") +
    `</g>` +
    `<g fill="${INK}" font-family="Arial, Helvetica, sans-serif" stroke="none">` +
    parts.filter((p) => p.startsWith("<text")).join("") +
    `</g></svg>`;

  return {
    ok: true, svg, imgW, imgH, ftPerPx, unitsKnown: known, unitsLabel: label,
    modelW, modelH, entityCount,
    unsupported: { count: unsupportedCount, types: unsupportedTypes, byType: acc.unsupported },
  };
}

// A short human tally for the "N entities of unsupported types skipped" banner.
export function unsupportedSummary(unsupported) {
  if (!unsupported || !unsupported.count) return "";
  const parts = unsupported.types.map((t) => `${unsupported.byType[t]} ${t}`);
  return `${unsupported.count} entit${unsupported.count === 1 ? "y" : "ies"} of unsupported types skipped (${parts.join(", ")})`;
}
