/* notesSketchRender — a sketch model → ONE drawing spec, used by BOTH the screen and paper.
 *
 * ⛔ PDF-PARITY, BOUGHT THE SAME WAY lib/notesDocHtml.js BUYS IT. There is exactly one
 * function that decides what a sketch looks like. The schema node's `renderHTML` returns
 * this spec (so ProseMirror's own DOMSerializer produces the printed sheet from it), and
 * the interactive node view builds real DOM from the SAME spec via `specToDom`. Two
 * consumers, one builder — a shape added here appears on screen and on paper in the same
 * commit, because there is no second place to add it to.
 *
 * ⛔ NOT ONE LITERAL COLOUR. The spec emits CLASS NAMES only; the ink lives in the two CSS
 * blocks that already mirror each other — `EDITOR_CSS` (components/NoteEditor.jsx, theme
 * tokens, so a sketch themes with the app) and `PRINT_CSS` (lib/notesPrint.js, black on
 * white, because a theme token would print a dark page). That is also what keeps this file
 * out of the module's "chrome is theme tokens only" problem entirely: it has no colours to
 * get wrong.
 *
 * ═══ SCREEN AND PAPER NOW DRAW THE SAME CONTENT, FULL STOP ═════════════════════════════
 *
 * Under the superseded outline design a box's body hid behind a chevron on screen and
 * reappeared as a detail list on paper. The canvas now owns the text (see the header of
 * lib/notesSketchModel.js), so the body is simply always drawn inside its box, on both
 * surfaces — the divergence is gone rather than managed.
 *
 * The ONE remaining difference is `interactive`, and it carries no content: it adds the
 * AFFORDANCES a person can press — the drag-out grip that starts an arrow, the focus stops
 * a keyboard user tabs through. A grip printed on paper would be a lie (nothing on a sheet
 * can be dragged), so paper does not get one. Every box, every word and every arrow is
 * identical either way.
 */
import { GRIP_R, layoutSketch, normalizeSketch, outlineFromSketch } from "./notesSketchModel.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const svg = (tag) => `${SVG_NS} ${tag}`;

/* The arrowhead is drawn as a real polygon per edge rather than as a `<marker>` in `<defs>`:
 * a marker needs an id, and two sketches in one note (or one note in a printed notebook)
 * would then collide on it. A polygon has nothing to collide with. */
const HEAD = 7;
function arrowHead(e) {
  const dx = e.x2 - e.x1;
  const dy = e.y2 - e.y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const bx = e.x2 - ux * HEAD;
  const by = e.y2 - uy * HEAD;
  const px = -uy * (HEAD * 0.5);
  const py = ux * (HEAD * 0.5);
  const pts = [
    [e.x2, e.y2],
    [bx + px, by + py],
    [bx - px, by - py],
  ].map(([x, y]) => `${round(x)},${round(y)}`).join(" ");
  return [svg("polygon"), { points: pts, class: "planyr-sketch-head" }];
}

const round = (n) => Math.round(n * 10) / 10;

/** One arrow: a fat invisible line to press, the visible line, and the head. The hit line
 *  is drawn FIRST and under everything, so it can never steal a press from a box. */
function edgeSpec(e, selected) {
  const on = selected && selected.kind === "edge" && selected.from === e.from && selected.to === e.to;
  return [svg("g"), {
    class: `planyr-sketch-edge-g${on ? " is-selected" : ""}`,
    "data-sketch-edge": `${e.from} ${e.to}`,
  },
    [svg("line"), { x1: round(e.x1), y1: round(e.y1), x2: round(e.x2), y2: round(e.y2), class: "planyr-sketch-edge-hit" }],
    [svg("line"), { x1: round(e.x1), y1: round(e.y1), x2: round(e.x2), y2: round(e.y2), class: "planyr-sketch-edge" }],
    arrowHead(e),
  ];
}

/** One box: the rounded rectangle, its wrapped label, its body, and — on screen only — the
 *  grip you drag out of to draw an arrow. */
function boxSpec(b, { interactive, selected }) {
  const on = selected && selected.kind === "box" && selected.id === b.id;
  const kids = [
    [svg("rect"), { x: 0, y: 0, width: b.w, height: b.h, rx: 8, ry: 8, class: "planyr-sketch-box" }],
  ];

  const labelTop = 9 + 12;
  b.labelLines.forEach((line, i) => {
    kids.push([svg("text"), { x: 11, y: labelTop + i * 16, class: "planyr-sketch-label" }, line]);
  });

  if (b.bodyLines.length) {
    const bodyTop = labelTop + Math.max(1, b.labelLines.length) * 16 + 6;
    b.bodyLines.forEach((line, i) => {
      kids.push([svg("text"), { x: 11, y: bodyTop + i * 14, class: "planyr-sketch-body" }, line]);
    });
  }

  /* THE GRIP — the whole of "drag from one box to another draws an arrow", with no mode to
   * turn on first. It sits on the right edge because that is where a left-to-right reader
   * expects the next thing to be, and it is a generous circle rather than a hairline so a
   * press lands on it and not on the box behind. */
  if (interactive) {
    kids.push([svg("g"), { class: "planyr-sketch-grip", "data-sketch-grip": b.id, transform: `translate(${b.w}, ${round(b.h / 2)})` },
      [svg("circle"), { cx: 0, cy: 0, r: GRIP_R + 5, class: "planyr-sketch-grip-hit" }],
      [svg("circle"), { cx: 0, cy: 0, r: GRIP_R, class: "planyr-sketch-grip-dot" }],
    ]);
  }

  const attrs = {
    class: `planyr-sketch-node${on ? " is-selected" : ""}`,
    "data-sketch-node": b.id,
    transform: `translate(${round(b.x)}, ${round(b.y)})`,
  };
  /* A keyboard user has to be able to reach a box to delete it or start an arrow from it,
   * and a screen reader has to be told what it landed on. */
  if (interactive) {
    attrs.tabindex = "0";
    attrs.role = "button";
    attrs["aria-label"] = `Box: ${b.label || "empty"}${b.body ? `. ${b.body.replace(/\n/g, " ")}` : ""}`;
  }
  return [svg("g"), attrs, ...kids];
}

/** The whole drawing. `interactive` adds the affordances (grips, focus stops) and nothing
 *  else; `selected` highlights one box or one arrow, which is view state and never stored. */
export function sketchSpec(model, { interactive = false, selected = null, title = "" } = {}) {
  const m = normalizeSketch(model);
  const layout = layoutSketch(m);

  const children = [];
  if (m.boxes.length || interactive) {
    const svgKids = [
      /* THE SURFACE. A transparent rect covering the canvas, so an empty spot is a real
       * target — an SVG with no painted background swallows nothing and a double-click on
       * "nothing" would never reach us. It is drawn first, so it is under everything. */
      [svg("rect"), { x: 0, y: 0, width: layout.width, height: layout.height, class: "planyr-sketch-surface", "data-sketch-surface": "1" }],
    ];
    for (const e of layout.edges) svgKids.push(edgeSpec(e, selected));
    for (const b of layout.boxes) svgKids.push(boxSpec(b, { interactive, selected }));

    children.push([svg("svg"), {
      class: "planyr-sketch-canvas",
      viewBox: `0 0 ${layout.width} ${layout.height}`,
      width: layout.width,
      height: layout.height,
      "data-sketch-canvas": "1",
      role: "img",
      "aria-label": sketchAltText(m, title),
    }, ...svgKids]);
  } else {
    /* An empty sketch on paper says it is empty rather than printing a blank rectangle.
     * (On screen the canvas is always drawn — it is the thing you double-click.) */
    children.push(["p", { class: "planyr-sketch-empty" }, "Empty sketch."]);
  }

  /* THE PAYLOAD. The drawing above is a rendering; THIS is the sketch. It rides the HTML so
   * a copy-paste into another note, or an HTML round trip, reconstructs the real model
   * rather than a picture of it — the same reason lib/notesImageNode.js puts an id in the
   * HTML instead of a src. */
  return ["div", {
    class: "planyr-sketch",
    "data-note-sketch": JSON.stringify({ boxes: m.boxes, links: m.links }),
    "data-sketch-count": String(m.boxes.length),
  }, ...children];
}

/** What a screen reader is told the drawing is. A diagram with no accessible name is a
 *  blank to anyone not looking at it, and the derived ordering is right there to say it. */
export function sketchAltText(model, title = "") {
  const m = normalizeSketch(model);
  const { lines, extra } = outlineFromSketch(m);
  const head = title ? `${title}: ` : "";
  const shown = lines.slice(0, 12).map((n) => `${"— ".repeat(n.depth)}${n.label || "empty box"}`);
  const more = lines.length > 12 ? `, and ${lines.length - 12} more` : "";
  const links = extra.length ? `. ${extra.length} other arrow${extra.length === 1 ? "" : "s"}` : "";
  return `${head}Sketch of ${m.boxes.length} box${m.boxes.length === 1 ? "" : "es"}: ${shown.join("; ")}${more}${links}.`;
}

/** Build real DOM from a spec — the node view's half of the pair. Mirrors ProseMirror's own
 *  `renderSpec` closely enough that the two produce the same tree, including the SVG
 *  namespace (a `<rect>` created without it renders as nothing at all). */
export function specToDom(spec, doc = typeof document !== "undefined" ? document : null) {
  if (!doc) return null;
  if (typeof spec === "string") return doc.createTextNode(spec);
  if (!Array.isArray(spec)) return doc.createTextNode("");

  let [tag, ...rest] = spec;
  let ns = null;
  const space = String(tag).indexOf(" ");
  if (space > 0) { ns = String(tag).slice(0, space); tag = String(tag).slice(space + 1); }
  const el = ns ? doc.createElementNS(ns, tag) : doc.createElement(tag);

  let start = 0;
  if (rest.length && rest[0] && typeof rest[0] === "object" && !Array.isArray(rest[0])) {
    for (const [k, v] of Object.entries(rest[0])) if (v != null) el.setAttribute(k, String(v));
    start = 1;
  }
  for (const child of rest.slice(start)) {
    const node = specToDom(child, doc);
    if (node) el.appendChild(node);
  }
  return el;
}
