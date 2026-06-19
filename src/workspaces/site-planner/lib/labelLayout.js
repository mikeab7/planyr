// Shared label level-of-detail + collision engine (B121).
//
// The Site Planner used to paint every element's centred label (name + area + dimensions)
// at the shape centroid with NO collision handling, so adjacent labels overprinted into an
// unreadable pile when zoomed out. This module is the one place that decides, per label:
//   (1) LEVEL-OF-DETAIL — how many of its priority-ordered lines survive at the current
//       zoom / shape size (drop the lowest-priority lines first), and
//   (2) COLLISION — which labels yield when their boxes would overlap: highest-importance
//       first, shrinking a loser to fewer lines or hiding it entirely rather than overprint.
//
// Pure geometry (no React / DOM) so it can be unit-tested without a browser and reused across
// surfaces — notably B123's per-building 4-line stack, which feeds into this same pool rather
// than standing up a parallel renderer.

// Axis-aligned box from a centre + size (screen px). x/y are the top-left corner.
export const boxOf = (cx, cy, w, h) => ({ x: cx - w / 2, y: cy - h / 2, w, h });

// Do two boxes overlap, expanded by `pad` px of breathing room on every side?
export const boxesOverlap = (a, b, pad = 0) =>
  a.x - pad < b.x + b.w && a.x + a.w + pad > b.x &&
  a.y - pad < b.y + b.h && a.y + a.h + pad > b.y;

// Level-of-detail. `lines` are ordered HIGHEST priority first (index 0 = name = last to
// drop; the trailing lines — dimensions — drop first). Keep as many leading lines as fit
// within `maxH` px of vertical room, always keeping at least one (you never fully blank a
// label here — collision resolution decides full hiding).
export const fitLines = (lines, lh, maxH) => {
  if (!lines || lines.length === 0) return [];
  let keep = lines.length;
  if (Number.isFinite(maxH) && lh > 0) keep = Math.min(keep, Math.floor(maxH / lh));
  return lines.slice(0, Math.max(1, keep));
};

// Estimated label box width (px) for a monospace stack: widest line × per-char width.
const widthOf = (lines, charW) =>
  Math.max(1, ...lines.map((t) => String(t).length)) * charW;

// Greedy collision + level-of-detail layout with a narrow-shape escape hatch (B121).
// Each item: { id, cx, cy, lines, lh, charW, halfW, halfH, importance }
//   - halfW/halfH: the shape's on-screen bounding half-extents (px). `maxH` is still accepted
//     as a legacy alias for 2*halfH (halfW then defaults to ∞, i.e. never lead a label out).
// Higher `importance` wins ties for space. Returns Map(id -> placement):
//   { lines, x, y, leader } — x/y is the label's CENTRE; `leader` is null for a normal label
// drawn inside its shape, or { x, y } (the shape centroid to draw a thin connector back to)
// when the label was too wide to fit and got pulled OUTSIDE, above the shape. An id absent
// from the map is hidden this frame (its element still draws; zooming in reveals it again).
export const layoutLabels = (items, opts = {}) => {
  const pad = opts.pad == null ? 2 : opts.pad;
  const gap = opts.gap == null ? 4 : opts.gap; // px between an outside label and its shape
  const placed = []; // boxes already committed this frame
  const out = new Map();
  // Most important first; stable id tiebreak so the result is deterministic (testable).
  const ordered = [...(items || [])].sort(
    (a, b) => (b.importance - a.importance) || (String(a.id) < String(b.id) ? -1 : 1),
  );
  for (const it of ordered) {
    const halfH = it.halfH != null ? it.halfH : (it.maxH != null ? it.maxH / 2 : Infinity);
    const halfW = it.halfW != null ? it.halfW : Infinity;
    let lines = fitLines(it.lines, it.lh, halfH * 2); // LOD: drop lines to fit the shape height
    let chosen = null;
    // NEW-2 / NEW-5: a label may be rotated to run along a thin strip's long axis. Its
    // on-screen footprint is the rotated bounding box, so a vertical label is tested for
    // fit against the strip's (tall) height and its (narrow) width — the orientation we want.
    const rot = it.rot || 0;
    const rad = (rot * Math.PI) / 180, ca = Math.abs(Math.cos(rad)), sa = Math.abs(Math.sin(rad));
    while (lines.length >= 1) {
      const w0 = widthOf(lines, it.charW), h0 = lines.length * it.lh;
      const w = ca * w0 + sa * h0, h = sa * w0 + ca * h0; // rotated on-screen footprint
      // Fits inside the shape? Otherwise pull it out, centred above the shape, with a leader.
      const inside = w <= halfW * 2 && h <= halfH * 2;
      const spot = inside
        ? { x: it.cx, y: it.cy, leader: null }
        : { x: it.cx, y: it.cy - halfH - h / 2 - gap, leader: { x: it.cx, y: it.cy } };
      const box = boxOf(spot.x, spot.y, w, h);
      if (!placed.some((p) => boxesOverlap(p, box, pad))) { chosen = { box, lines, ...spot }; break; }
      if (lines.length === 1) break;            // can't shrink further → hide it
      lines = lines.slice(0, lines.length - 1); // drop the lowest-priority remaining line, retry
    }
    if (chosen) { placed.push(chosen.box); out.set(it.id, { lines: chosen.lines, x: chosen.x, y: chosen.y, leader: chosen.leader, rot }); }
  }
  return out;
};

// B123 — the building label as a priority-ordered stack (highest priority first, matching
// fitLines/layoutLabels which drop from the END): name → square footage → "(incl. N
// bump-outs)" → dimensions. So on zoom-out the dimensions drop first, then the bump-out
// note, leaving the square footage and finally just the name — i.e. the square footage
// survives far longer than it did when the whole label just shrank. The parenthetical
// line appears only when the building actually has bump-outs.
export const buildingLabelLines = ({ name, sqft, bumpCount = 0, dims }) => {
  const out = [name, sqft];
  if (bumpCount > 0) out.push(`(incl. ${bumpCount} bump-out${bumpCount > 1 ? "s" : ""})`);
  if (dims) out.push(dims);
  return out;
};

// B121 (round 2) — the red per-edge dimension callouts ("300′" ticks, drawn per element in
// renderElPx) are a separate layer from the centred name labels. Zoomed out they shrink to
// illegible ticks that pile onto the names, so gate them by zoom: show at working zoom,
// hide once the view is zoomed out past DIM_CALLOUT_MIN_PPF (they return as you zoom in).
// Mirrors how the label engine thins labels on zoom-out, keeping the dimension layer out of
// the name pile. Pure + tested; the threshold is a screening default, tune in-browser.
export const DIM_CALLOUT_MIN_PPF = 0.18; // px per foot (default working zoom is ~0.35)
export const dimCalloutVisible = (ppf) => ppf >= DIM_CALLOUT_MIN_PPF;
