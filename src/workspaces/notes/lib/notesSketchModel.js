/* notesSketchModel — PURE geometry for the RETIRED Sketch mode. No DOM, no engine, no storage.
 *
 * ⛔ SKETCH MODE ITSELF IS GONE (NEW-2, 2026-09-22, owner direction: "I don't care for the
 * sketch boxes at all... it'd be better if I just had a free canvas to play with"). This file
 * is kept, trimmed to exactly what two callers still need, for ONE reason:
 * `lib/notesFlowMigration.js`'s `migrateSketchesToBoxes` has to read an OLD page's stored
 * `noteSketch` JSON (boxes, links, and the even older outline/positions shape `legacySource`
 * migrates first) and convert it to real `noteAnchor` boxes + document-level arrows, on read,
 * so no stored document can still contain a `noteSketch` node by the time it reaches the schema
 * (which no longer declares that node type at all). `normalizeSketch`/`layoutSketch` are the two
 * functions that migration calls; `edgePoint` is re-exported from `lib/notesArrows.js` for the
 * new box-to-box arrows, unchanged, because the geometry question — where a ray from centre to
 * centre crosses a rectangle's border — is identical for a sketch's own box and a `noteAnchor`.
 * `notesSketchNode.js` (the schema node + interactive node view), `notesSketchEditor.js`
 * (double-click/drag/connect inside a sketch's own canvas) and `notesSketchRender.js` (the SVG
 * drawing of that canvas) are DELETED, not kept dormant — nothing reaches them any more.
 *
 * Every EDIT function that used to live here (`addBox`/`updateBox`/`moveBox`/`removeBox`/
 * `addLink`/`removeLink`/`boxAt`/`nextSpot`/`outlineFromSketch`/`defaultMint`) is deleted with
 * them — migration only ever READS a sketch, once, and never authors or arranges one — per house
 * style: code nothing calls is deleted, not hidden. See `docs/NOTES-CARRY-FORWARD.md` and this
 * repo's git history for the full mechanism if a past decision needs re-deriving.
 */

/* Layout constants. Kept here (not in the renderer, which is also gone) because layout is a
 * pure decision — `migrateSketchesToBoxes` needs the same box sizes the old canvas drew. */
export const BOX_W = 178;
export const BOX_MIN_H = 38;
export const PAD_Y = 9;
export const LINE_H = 16;
export const BODY_LINE_H = 14;
export const LABEL_WRAP = 23;      // characters per label line at the box's font size
export const BODY_WRAP = 27;
export const MARGIN = 10;

/* The canvas is deliberately BIGGER than the boxes on it, and never smaller than this — still
 * needed so a migrated group's `layoutSketch(...).height` (used to stack multiple sketches
 * vertically) matches what the old canvas would have reported. */
export const SLACK_X = 130;
export const SLACK_Y = 90;
export const MIN_CANVAS_W = 560;
export const MIN_CANVAS_H = 230;

/* ---- defensive normalisation ---------------------------------------------------------
 *
 * Attributes arrive from a stored document, so nothing here trusts its shape. Anything
 * unreadable is DROPPED rather than thrown on: one corrupt sketch must not take a note's whole
 * document with it.
 */

const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));
const int = (v, d = 0) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : d);

/** Attributes → a model this module's functions can rely on. Total and never throws.
 *
 *  It also MIGRATES a sketch stored under the superseded outline rule (B1400): an
 *  `outline` + `positions` pair becomes boxes that carry their own text at the coordinates
 *  the old automatic layout put them at, and the parent→child arrows that used to be
 *  implied by the indentation become real, explicit arrows. */
export function normalizeSketch(attrs) {
  const legacy = legacySource(attrs);
  const rawBoxes = legacy ? legacy.boxes : Array.isArray(attrs?.boxes) ? attrs.boxes : [];
  const rawLinks = legacy ? legacy.links : Array.isArray(attrs?.links) ? attrs.links : [];

  const boxes = [];
  const seen = new Set();
  for (const b of rawBoxes) {
    if (!b || typeof b !== "object") continue;
    const id = str(b.id).trim();
    if (!id || seen.has(id)) continue;            // a duplicate id would give one box two places
    seen.add(id);
    boxes.push({
      id,
      label: str(b.label),
      body: str(b.body),
      x: Math.max(0, int(b.x, 0)),
      y: Math.max(0, int(b.y, 0)),
    });
  }

  const ids = new Set(boxes.map((b) => b.id));
  const links = [];
  const linkSeen = new Set();
  for (const l of Array.isArray(rawLinks) ? rawLinks : []) {
    const from = str(l?.from);
    const to = str(l?.to);
    if (!ids.has(from) || !ids.has(to) || from === to) continue;
    const key = `${from} ${to}`;
    if (linkSeen.has(key)) continue;
    linkSeen.add(key);
    links.push({ from, to });
  }

  return { boxes, links };
}

/* ---- the one-time migration off the superseded outline shape --------------------------
 *
 * Deliberately self-contained and used from nowhere else: the tree walk below is the ONLY
 * surviving piece of the outline-owns-content design, and it exists so that a sketch the
 * owner already drew opens looking exactly as it did.
 */
function legacySource(attrs) {
  const outline = Array.isArray(attrs?.outline) ? attrs.outline : null;
  if (!outline || !outline.length) return null;
  if (Array.isArray(attrs?.boxes) && attrs.boxes.length) return null;   // already migrated

  const nodes = [];
  const seen = new Set();
  for (const n of outline) {
    if (!n || typeof n !== "object") continue;
    const id = str(n.id).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    nodes.push({ id, depth: Math.max(0, int(n.depth, 0)), label: str(n.label), body: str(n.body) });
  }
  let prev = -1;
  for (const n of nodes) { n.depth = Math.min(n.depth, prev + 1); prev = n.depth; }

  const GAP_X = 62;
  const GAP_Y = 16;
  const sizes = new Map(nodes.map((n) => [n.id, boxSize(n)]));

  // The old tree, rebuilt from the depth sequence, and the old left-to-right auto layout.
  const roots = [];
  const stack = [];
  const parentOf = {};
  for (const n of nodes) {
    const entry = { node: n, children: [] };
    stack.length = n.depth;
    if (n.depth === 0 || !stack[n.depth - 1]) roots.push(entry);
    else { stack[n.depth - 1].children.push(entry); parentOf[n.id] = stack[n.depth - 1].node.id; }
    stack[n.depth] = entry;
  }
  const place = {};
  let cursorY = MARGIN;
  const walk = (entry) => {
    const size = sizes.get(entry.node.id);
    const x = MARGIN + entry.node.depth * (BOX_W + GAP_X);
    if (!entry.children.length) {
      place[entry.node.id] = { x, y: cursorY };
      cursorY += size.h + GAP_Y;
      return;
    }
    entry.children.forEach(walk);
    const lastId = entry.children[entry.children.length - 1].node.id;
    const first = place[entry.children[0].node.id];
    const last = place[lastId];
    const mid = (first.y + last.y + sizes.get(lastId).h) / 2;
    place[entry.node.id] = { x, y: Math.max(MARGIN, Math.round(mid - size.h / 2)) };
  };
  roots.forEach(walk);

  const overrides = attrs?.positions && typeof attrs.positions === "object" ? attrs.positions : {};
  const boxes = nodes.map((n) => {
    const o = overrides[n.id];
    const at = o && Number.isFinite(Number(o.x)) && Number.isFinite(Number(o.y))
      ? { x: Number(o.x), y: Number(o.y) }
      : place[n.id] || { x: MARGIN, y: MARGIN };
    return { id: n.id, label: n.label, body: n.body, x: Math.round(at.x), y: Math.round(at.y) };
  });

  // The indentation's implied arrows become real ones, then the explicit extras.
  const links = [];
  for (const n of nodes) if (parentOf[n.id]) links.push({ from: parentOf[n.id], to: n.id });
  for (const l of Array.isArray(attrs?.links) ? attrs.links : []) {
    if (l && typeof l === "object") links.push({ from: str(l.from), to: str(l.to) });
  }
  return { boxes, links };
}

/* ---- text measurement + layout --------------------------------------------------------- */

/** Wrap a string to lines of at most `width` characters, breaking on spaces where it can.
 *  Deliberately a CHARACTER estimate rather than a real text measurement: layout has to be
 *  computable in a pure function, in a unit test — a DOM-measured box would make the migrated
 *  layout disagree with what the old canvas actually drew. */
export function wrapText(text, width) {
  const words = str(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let line = "";
  for (const w of words) {
    if (!line) { line = w; }
    else if (line.length + 1 + w.length <= width) { line += ` ${w}`; }
    else { lines.push(line); line = w; }
    // A single word longer than the line is hard-split rather than allowed to overflow.
    while (line.length > width) { lines.push(line.slice(0, width)); line = line.slice(width); }
  }
  if (line) lines.push(line);
  return lines;
}

/** One box's size. The body is ALWAYS counted: it always drew, on both surfaces, before. */
export function boxSize(box) {
  const labelLines = wrapText(box.label, LABEL_WRAP);
  const bodyLines = box.body ? wrapText(box.body, BODY_WRAP) : [];
  const h = PAD_Y * 2 + Math.max(1, labelLines.length) * LINE_H + (bodyLines.length ? 6 + bodyLines.length * BODY_LINE_H : 0);
  return { w: BOX_W, h: Math.max(BOX_MIN_H, h), labelLines, bodyLines };
}

/** Where the arrow from one box to another crosses the SOURCE box's border.
 *  A ray from centre to centre, clipped to the rectangle — which is what makes an arrow
 *  land correctly no matter where the two boxes sit relative to each other. Re-exported by
 *  `notesArrows.js` for the new box-to-box arrows; the geometry is identical either way. */
export function edgePoint(box, towardX, towardY) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const dx = towardX - cx;
  const dy = towardY - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const sx = dx ? (box.w / 2) / Math.abs(dx) : Infinity;
  const sy = dy ? (box.h / 2) / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

/** THE layout: the model → boxes with real sizes, arrows with real endpoints, and a canvas
 *  that is always roomier than its contents — `migrateSketchesToBoxes` uses `.height` to stack
 *  multiple converted sketch groups without overlap. */
export function layoutSketch(model) {
  const m = normalizeSketch(model);
  const boxes = m.boxes.map((b) => {
    const size = boxSize(b);
    return {
      id: b.id,
      label: b.label,
      body: b.body,
      labelLines: size.labelLines,
      bodyLines: size.bodyLines,
      x: b.x,
      y: b.y,
      w: size.w,
      h: size.h,
    };
  });

  const byId = new Map(boxes.map((b) => [b.id, b]));
  const edges = [];
  for (const l of m.links) {
    const a = byId.get(l.from);
    const b = byId.get(l.to);
    if (!a || !b) continue;                     // unreachable: normalizeSketch dropped danglers
    const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
    const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    const p1 = edgePoint(a, bc.x, bc.y);
    const p2 = edgePoint(b, ac.x, ac.y);
    edges.push({ from: l.from, to: l.to, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
  }

  const width = Math.max(MIN_CANVAS_W, ...boxes.map((b) => b.x + b.w + MARGIN + SLACK_X));
  const height = Math.max(MIN_CANVAS_H, ...boxes.map((b) => b.y + b.h + MARGIN + SLACK_Y));
  return { boxes, edges, width: Math.round(width), height: Math.round(height) };
}
