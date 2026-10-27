/* buildingsBand.js — the printed BUILDINGS / SF table, as a card that lives OFF the drawing.
 *
 * Why this exists (owner report, Goose Creek "Phase II - Base Case", 2026-10-27): the table used to be a
 * corner plate drawn INSIDE the plan frame. In the editable PDF every site element is a PDF annotation, and
 * annotations always paint above the page picture — so the table (page picture) was painted over by the site
 * (Building 3's trailer strip cut the third row's label to "ng 3") and hid the corner of the site it sat on.
 * Corner-picking by bounding boxes cannot fix that: a site that fills the frame has no free corner at all.
 *
 * Now the table gets a band of its own on the SHEET (printSheet.js reserves it between the title block and the
 * plan), so it can never overlap the plan, and in the editable PDF it is emitted as its own annotation
 * (exportSheet.js) so the recipient can select, move or delete it in Bluebeam.
 *
 * ONE builder: the compose preview, the PDF (page picture or annotation) and the PNG strip all draw the SAME
 * primitives from `buildingsBandModel`. The numbers come in as `entries`, built from `buildingSfTable.js`
 * (the one place that sums a building's SF) — this module never sums or looks anything up.
 *
 * Layout: a header cell ("BUILDINGS" over "SF") then the entries as a grid of name-left / number-right cells,
 * flowing into as many rows as the available width needs — so 3 buildings are one line and 40 are a short grid,
 * and the card's height always matches what it holds. Total is the last cell, bold.
 *
 * Pure (strings and numbers only) so it is unit-testable and importable by the lazy export chunk without cost.
 */

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const r3 = (n) => Number(Number(n).toPrecision(6));

// A printed sheet is fixed paper ink, never the app theme — the same print-safe values printSheet.js and the furniture plates fall back to.
const PRINT_PAL = { ink: "#26231e", muted: "#6b6557", line: "#b8b1a0", paper: "#ffffff" }; // design-exempt: print-safe paper ink, deliberately not themed

/** Font size of the table's cells on the SHEET (centi-inch units, as the metrics band: 12.5). */
export const BAND_FS = 11.5;

/** Default SF formatter — the same grouping the map labels and the Yield panel use (`f0` in SitePlanner). */
export const fmtSfDefault = (n) => Math.round(n).toLocaleString();

/**
 * Entries for the table from `buildingSfRows(els)`'s output: one per building, then Total last.
 * `rows` is [{ name, sf }]; `total` is the plan's whole building SF (passed in, never re-summed here).
 * Empty rows → null (a plan with no buildings has no table and reserves no space).
 */
export function buildingEntries(rows, total, fmtSf = fmtSfDefault) {
  if (!rows || !rows.length) return null;
  return [
    ...rows.map((r) => ({ name: String(r.name), num: fmtSf(r.sf) })),
    { name: "Total", num: fmtSf(total), total: true },
  ];
}

// A conservative text-width estimate (em fractions of Helvetica/Inter): digits and capitals run wide, separators
// narrow. Deliberately a hair pessimistic so a cell never crowds its number against its name.
export function bandTextW(str, fs, bold = false) {
  let w = 0;
  for (const ch of String(str)) w += /[0-9]/.test(ch) ? 0.6 : /[,. ]/.test(ch) ? 0.3 : /[A-Z]/.test(ch) ? 0.68 : 0.58;
  return w * fs * (bold ? 1.04 : 1);
}

/**
 * @param {{ entries: Array<{name:string,num:string,total?:boolean}>, width: number, fs?: number,
 *          pal?: {ink?:string,muted?:string,panelLine?:string,paper?:string} }} opts
 *   `width` — the most horizontal room the card may take (same units as `fs`).
 * @returns {null | { w:number, h:number, rows:number, cols:number, fs:number, prims:Array }}
 *   `prims` are drawn in the card's own coordinates (origin top-left): rect / line / text records.
 */
export function buildingsBandModel({ entries, width, fs = BAND_FS, pal = {} }) {
  if (!entries || !entries.length) return null;
  const ink = pal.ink || PRINT_PAL.ink, muted = pal.muted || PRINT_PAL.muted, line = pal.panelLine || PRINT_PAL.line, paper = pal.paper || PRINT_PAL.paper;
  const headFs = fs * 0.85;
  const rowH = fs * 1.55, padY = fs * 0.45, padX = fs * 0.75, gap = fs * 1.4;
  const headW = padX * 2 + bandTextW("BUILDINGS", headFs, true);
  const cellW = entries.reduce((m, e) => Math.max(m, padX + bandTextW(e.name, fs, !!e.total) + gap + bandTextW(e.num, fs, true) + padX), 0);
  const n = entries.length;
  const maxCols = Math.max(1, Math.floor((Math.max(0, width) - headW) / cellW));
  const rows = Math.ceil(n / maxCols);
  const cols = Math.ceil(n / rows); // balanced: 7 entries that need two rows make 4 + 3, not 5 + 2
  const w = headW + cols * cellW, h = rows * rowH + 2 * padY;
  const prims = [];
  prims.push({ tag: "rect", a: { x: 0, y: 0, width: r3(w), height: r3(h), rx: r3(fs * 0.4), fill: paper, stroke: line, "stroke-width": 0.75 } });
  // header: BUILDINGS over SF, centred on the card's height
  const lg = headFs * 1.2, b1 = h / 2 - lg / 2 + headFs * 0.35;
  prims.push({ tag: "text", str: "BUILDINGS", a: { x: r3(padX), y: r3(b1), "font-size": r3(headFs), "font-weight": "700", fill: muted } });
  prims.push({ tag: "text", str: "SF", a: { x: r3(padX), y: r3(b1 + lg), "font-size": r3(headFs), "font-weight": "700", fill: muted } });
  prims.push({ tag: "line", a: { x1: r3(headW), y1: r3(padY * 0.6), x2: r3(headW), y2: r3(h - padY * 0.6), stroke: line, "stroke-width": 0.75 } });
  for (let r = 1; r < rows; r++) {
    const ry = padY + r * rowH;
    prims.push({ tag: "line", a: { x1: r3(headW), y1: r3(ry), x2: r3(w), y2: r3(ry), stroke: line, "stroke-width": 0.5 } });
  }
  entries.forEach((e, i) => {
    const r = Math.floor(i / cols), c = i % cols;
    const x0 = headW + c * cellW, top = padY + r * rowH, base = top + rowH / 2 + fs * 0.35;
    if (c > 0) prims.push({ tag: "line", a: { x1: r3(x0), y1: r3(top + rowH * 0.18), x2: r3(x0), y2: r3(top + rowH * 0.82), stroke: line, "stroke-width": 0.5 } });
    prims.push({ tag: "text", str: e.name, a: { x: r3(x0 + padX), y: r3(base), "font-size": r3(fs), "font-weight": e.total ? "700" : "400", fill: ink } });
    prims.push({ tag: "text", str: e.num, a: { x: r3(x0 + cellW - padX), y: r3(base), "text-anchor": "end", "font-size": r3(fs), "font-weight": "700", fill: ink } });
  });
  return { w: r3(w), h: r3(h), rows, cols, fs, prims };
}

const attrsOf = (a) => Object.entries(a).map(([k, v]) => `${k}="${esc(v)}"`).join(" ");

/** The card as an SVG `<g>` string, its top-left at (x, y). */
export function bandSvg(model, x, y) {
  if (!model) return "";
  const body = model.prims.map((p) => (p.tag === "text"
    ? `<text ${attrsOf(p.a)}>${esc(p.str)}</text>`
    : `<${p.tag} ${attrsOf(p.a)}/>`)).join("");
  return `<g data-sheet-table="buildings" transform="translate(${r3(x)},${r3(y)})" font-family="Inter, system-ui, sans-serif">${body}</g>`;
}

/** The same card as a plain `{tag,a,kids,str}` tree for `pdfAnnotations.flattenTree` (no DOM needed). */
export function bandTree(model, x, y) {
  if (!model) return null;
  return {
    tag: "g", a: { transform: `translate(${r3(x)},${r3(y)})`, "font-family": "Inter, system-ui, sans-serif" },
    kids: model.prims.map((p) => ({ tag: p.tag, a: { ...p.a }, kids: [], ...(p.tag === "text" ? { str: p.str } : {}) })),
  };
}
