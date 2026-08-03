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
 * ═══ THE ONE PLACE SCREEN AND PAPER DELIBERATELY DIFFER, AND WHY IT LOSES NOTHING ══════
 *
 * A node has a short LABEL and an optional longer BODY. On screen the box shows the label
 * and the body opens IN PLACE (a chevron on the box — no dialog, house rule); on paper
 * nothing can be clicked, so every body prints as a DETAIL LIST under the drawing. Both
 * surfaces therefore carry every body: one behind a click, one on the page. What is
 * forbidden — and what this arrangement avoids — is the same sentence rendered twice on the
 * same surface (PANEL-BREVITY), which is why the screen has no detail list and the paper
 * has no chevrons. `detail: true` is the flag; it is the only difference between the two.
 */
import { layoutSketch, normalizeSketch } from "./notesSketchModel.js";

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
  return [svg("polygon"), { points: pts, class: `planyr-sketch-head planyr-sketch-head-${e.kind}` }];
}

const round = (n) => Math.round(n * 10) / 10;

/** One box, as a group: the rounded rectangle, its wrapped label, its body when showing,
 *  and (screen only) the chevron that opens the body. */
function boxSpec(b, { detail }) {
  const kids = [
    [svg("rect"), {
      x: 0, y: 0, width: b.w, height: b.h, rx: 8, ry: 8,
      class: `planyr-sketch-box${b.placed ? " planyr-sketch-box-placed" : ""}`,
    }],
  ];

  const labelTop = 9 + 12;
  b.labelLines.forEach((line, i) => {
    kids.push([svg("text"), {
      x: 11, y: labelTop + i * 16, class: "planyr-sketch-label",
    }, line]);
  });

  if (b.bodyLines.length) {
    const bodyTop = labelTop + b.labelLines.length * 16 + 6;
    b.bodyLines.forEach((line, i) => {
      kids.push([svg("text"), { x: 11, y: bodyTop + i * 14, class: "planyr-sketch-body" }, line]);
    });
  }

  /* The "there is more behind this box" affordance. On paper it is replaced by the detail
   * list, so it is not drawn at all — an un-clickable chevron on a printed page is a lie. */
  if (!detail && b.body) {
    kids.push([svg("g"), { class: "planyr-sketch-chevron", "data-sketch-toggle": b.id, transform: `translate(${b.w - 20}, 9)` },
      [svg("rect"), { x: -4, y: -3, width: 16, height: 16, rx: 4, class: "planyr-sketch-chevron-hit" }],
      [svg("path"), { d: b.expanded ? "M0 8 L4 3 L8 8" : "M0 3 L4 8 L8 3", class: "planyr-sketch-chevron-mark" }],
    ]);
  }

  return [svg("g"), {
    class: `planyr-sketch-node${b.expanded ? " planyr-sketch-node-open" : ""}`,
    "data-sketch-node": b.id,
    transform: `translate(${round(b.x)}, ${round(b.y)})`,
  }, ...kids];
}

/** The whole drawing. `detail` switches paper mode on (no chevrons, a detail list below). */
export function sketchSpec(model, { detail = false, expanded = new Set(), title = "" } = {}) {
  const m = normalizeSketch(model);
  const layout = layoutSketch(m, { expanded: detail ? new Set() : expanded });

  const svgKids = [];
  for (const e of layout.edges) {
    svgKids.push([svg("line"), {
      x1: round(e.x1), y1: round(e.y1), x2: round(e.x2), y2: round(e.y2),
      class: `planyr-sketch-edge planyr-sketch-edge-${e.kind}`,
      "data-sketch-edge": `${e.from} ${e.to}`,
      "data-sketch-edge-kind": e.kind,
    }]);
    svgKids.push(arrowHead(e));
  }
  for (const b of layout.boxes) svgKids.push(boxSpec(b, { detail }));

  const children = [];
  if (m.outline.length) {
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
    /* An empty sketch says what to do rather than showing an empty white box. LOUD-FAILURE's
     * quiet cousin: a surface that renders nothing must say why it is rendering nothing. */
    children.push(["p", { class: "planyr-sketch-empty" }, "Empty sketch — type a line in the outline to draw a box."]);
  }

  /* The DETAIL LIST — paper only. Every body, in outline order, so a printed sheet carries
   * the detail the screen keeps one click away. */
  if (detail) {
    const withBody = m.outline.filter((n) => n.body);
    if (withBody.length) {
      children.push(["ul", { class: "planyr-sketch-detail" },
        ...withBody.map((n) => ["li", {},
          ["strong", {}, n.label],
          ["span", {}, ` — ${n.body.replace(/\n/g, " ")}`],
        ]),
      ]);
    }
  }

  /* THE PAYLOAD. The drawing above is a rendering; THIS is the sketch. It rides the HTML so
   * a copy-paste into another note, or an HTML round trip, reconstructs the real model
   * rather than a picture of it — the same reason lib/notesImageNode.js puts an id in the
   * HTML instead of a src. */
  return ["div", {
    class: "planyr-sketch",
    "data-note-sketch": JSON.stringify({ outline: m.outline, positions: m.positions, links: m.links }),
    "data-sketch-count": String(m.outline.length),
  }, ...children];
}

/** What a screen reader is told the drawing is. A diagram with no accessible name is a
 *  blank to anyone not looking at it, and the outline is right there to say it with. */
export function sketchAltText(model, title = "") {
  const m = normalizeSketch(model);
  const head = title ? `${title}: ` : "";
  const lines = m.outline.slice(0, 12).map((n) => `${"— ".repeat(n.depth)}${n.label}`);
  const more = m.outline.length > 12 ? `, and ${m.outline.length - 12} more` : "";
  const links = m.links.length ? `. ${m.links.length} extra arrow${m.links.length === 1 ? "" : "s"}` : "";
  return `${head}Sketch of ${m.outline.length} box${m.outline.length === 1 ? "" : "es"}: ${lines.join("; ")}${more}${links}.`;
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
