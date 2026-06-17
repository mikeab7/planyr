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

// Greedy collision + LOD layout. Each item:
//   { id, cx, cy, lines, lh, charW, maxH, importance }
// Higher `importance` wins ties for space. Returns Map(id -> surviving lines[]) for the
// labels that should render; an id absent from the map is hidden this frame (its element
// still draws — only the centred text label is suppressed, and zooming in reveals it again).
export const layoutLabels = (items, opts = {}) => {
  const pad = opts.pad == null ? 2 : opts.pad;
  const placed = []; // boxes already committed this frame
  const out = new Map();
  // Most important first; stable id tiebreak so the result is deterministic (testable).
  const ordered = [...(items || [])].sort(
    (a, b) => (b.importance - a.importance) || (String(a.id) < String(b.id) ? -1 : 1),
  );
  for (const it of ordered) {
    let lines = fitLines(it.lines, it.lh, it.maxH); // start at the zoom/shape LOD
    let chosen = null;
    while (lines.length >= 1) {
      const box = boxOf(it.cx, it.cy, widthOf(lines, it.charW), lines.length * it.lh);
      if (!placed.some((p) => boxesOverlap(p, box, pad))) { chosen = { box, lines }; break; }
      if (lines.length === 1) break;          // can't shrink further → hide it
      lines = lines.slice(0, lines.length - 1); // drop the lowest-priority remaining line, retry
    }
    if (chosen) { placed.push(chosen.box); out.set(it.id, chosen.lines); }
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
