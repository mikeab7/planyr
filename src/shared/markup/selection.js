/* Shared SELECTION primitives (B569 / B570 — NEW-1 multi-select + NEW-2 marquee).
 *
 * The Site Planner and Document Review each own their own canvas, coordinate system, and
 * object model, so the selection STATE and pointer wiring necessarily live in each host. But
 * the genuinely shareable LOGIC — the marquee box-test, the modifier rules (Ctrl/Cmd = toggle,
 * Shift = add), and the neutral selection chrome — lives here ONCE so the two workspaces can't
 * drift into two different behaviours. (Mirrors the purity discipline of geometry.js /
 * tools.matrix.js: pure math + tiny helpers, no React, no DOM — fully unit-testable.)
 *
 * A "box" may arrive in any of three forms; `normBox` reconciles them to { x0,y0,x1,y1 }:
 *   { x0,y0,x1,y1 }   — a corner pair (un-normalised order tolerated)
 *   { a:{x,y}, b }    — the Site Planner marquee rubber-band (feet)
 *   { x,y,w,h }       — an axis-aligned bbox (bboxOf / bboxOfMarkup output)
 */

/** Normalise any supported box form to a sorted { x0, y0, x1, y1 } (or null). */
export function normBox(b) {
  if (!b) return null;
  if (Number.isFinite(b.x0) && Number.isFinite(b.x1)) {
    return { x0: Math.min(b.x0, b.x1), y0: Math.min(b.y0, b.y1), x1: Math.max(b.x0, b.x1), y1: Math.max(b.y0, b.y1) };
  }
  if (b.a && b.b) {
    return { x0: Math.min(b.a.x, b.b.x), y0: Math.min(b.a.y, b.b.y), x1: Math.max(b.a.x, b.b.x), y1: Math.max(b.a.y, b.b.y) };
  }
  if (Number.isFinite(b.x) && Number.isFinite(b.w)) {
    return { x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h };
  }
  return null;
}

/** Crossing test: the two axis-aligned boxes overlap (touch counts). */
export function boxesIntersect(a, b) {
  const A = normBox(a), B = normBox(b);
  if (!A || !B) return false;
  return A.x0 <= B.x1 && A.x1 >= B.x0 && A.y0 <= B.y1 && A.y1 >= B.y0;
}

/** Window test: `inner` is fully enclosed by `outer`. */
export function boxContains(outer, inner) {
  const O = normBox(outer), I = normBox(inner);
  if (!O || !I) return false;
  return I.x0 >= O.x0 && I.x1 <= O.x1 && I.y0 >= O.y0 && I.y1 <= O.y1;
}

/** Does the marquee select this item? mode "crossing" (anything touched, the default) or
 *  "window" (only fully-enclosed — the AutoCAD/Bluebeam left-to-right convention). */
export function marqueeHits(itemBox, marqueeBox, mode = "crossing") {
  return mode === "window" ? boxContains(marqueeBox, itemBox) : boxesIntersect(marqueeBox, itemBox);
}

/** Pick every item the marquee covers.
 *  opts.bboxOf(item) → a box (any supported form); opts.refOf(item) → the value pushed
 *  into the result (defaults to the item); opts.filter(item) skips items; opts.mode as above. */
export function pickInMarquee(items, marqueeBox, opts = {}) {
  const { bboxOf, refOf = (x) => x, mode = "crossing", filter } = opts;
  const out = [];
  for (const it of items || []) {
    if (filter && !filter(it)) continue;
    const bb = bboxOf ? bboxOf(it) : it;
    if (bb && marqueeHits(bb, marqueeBox, mode)) out.push(refOf(it));
  }
  return out;
}

/** Read the selection modifier intent off a pointer / mouse event.
 *  Ctrl or Cmd → toggle the clicked item in/out; Shift → additive add. */
export function selMods(e) {
  return { toggle: !!(e && (e.ctrlKey || e.metaKey)), add: !!(e && e.shiftKey) };
}

/** True if ANY selection modifier is held (so the caller can keep its plain-click path). */
export const hasSelMod = (e) => !!(e && (e.ctrlKey || e.metaKey || e.shiftKey));

/** The next selection set after clicking `ref` with the given modifiers.
 *   toggle (Ctrl/Cmd) — remove if present, else add (pick non-adjacent objects)
 *   add    (Shift)     — add if absent, otherwise leave the set unchanged
 *   neither            — replace the whole set with just `ref`
 *  `current` is an array of refs; `eq` compares two refs (default identity / value). */
export function nextSelection(current, ref, mods = {}, eq = (a, b) => a === b) {
  const cur = Array.isArray(current) ? current : [];
  const has = cur.some((r) => eq(r, ref));
  if (mods.toggle) return has ? cur.filter((r) => !eq(r, ref)) : [...cur, ref];
  if (mods.add) return has ? cur : [...cur, ref];
  return [ref];
}

/* ------------------------------------------------------------------ *
 *  Neutral selection chrome — hue-free so it never collides with a
 *  status / module-accent hue and stays legible on aerial imagery.
 *  The two-tone (light casing UNDER a dark line) + solid corner grips
 *  are rendered by SelectionChrome.jsx; the colours come from the
 *  PAL.selCasing / PAL.selLine tokens. These are the shared dimensions.
 * ------------------------------------------------------------------ */
export const SEL = { casingW: 3, lineW: 1.5, gripPx: 7, gripStrokeW: 1.25, pad: 2 };

/** The four corner-grip rects (screen space) for a bbox rect { x, y, w, h }. */
export function cornerGrips(rect, gripPx = SEL.gripPx) {
  const half = gripPx / 2;
  const corners = [
    [rect.x, rect.y],
    [rect.x + rect.w, rect.y],
    [rect.x + rect.w, rect.y + rect.h],
    [rect.x, rect.y + rect.h],
  ];
  return corners.map(([cx, cy]) => ({ x: cx - half, y: cy - half, w: gripPx, h: gripPx }));
}
