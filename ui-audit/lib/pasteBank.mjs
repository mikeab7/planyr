/* pasteBank — THE NOTES CLIPBOARD REGRESSION BANK (NEW-1, 2026-11-05): every clipboard fixture committed for Notes,
 * in one place, each with the DOCUMENT STRUCTURE a correct paste must leave behind.
 *
 * WHY IT EXISTS. The paste bug stream (a table's fill lost, an empty cell turned into a space, Word bullets arriving as
 * "·" paragraphs, a coloured run losing its colour) kept coming back because each fix pinned ONE clipboard in ONE harness,
 * and the harnesses asserted "a table arrived" or "the text is there" rather than what the table IS. This file is the
 * single, shared definition: `loadBank()` returns every fixture across test/fixtures/clipboard-tables,
 * test/fixtures/clipboard-lists and test/fixtures/clipboard-bank, `summariseDoc()` reads a STORED Notes document into
 * the facts that matter (rows, columns, merges, fills, empty cells, marks, list nesting), and `checkEntry()` returns the
 * list of problems — empty means the structure is right.
 *
 * PURE NODE, NO BROWSER. Driven by ui-audit/verify-notes-paste-bank.mjs (the real paste event in a real editor — a required
 * build gate) and unit-tested, including its own teeth, by test/notesPasteBank.test.js (which also fails when a fixture is
 * committed without an entry here, so the bank cannot quietly stop covering a clipboard). */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../test/fixtures");
export const BANK_DIRS = ["clipboard-tables", "clipboard-lists", "clipboard-bank"];

const readIf = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null);

/* ── colours ─────────────────────────────────────────────────────────────────────────── */
const NAMED = { yellow: "#ffff00", red: "#ff0000", green: "#008000", blue: "#0000ff", black: "#000000", white: "#ffffff" };
/** `#C00000` / `#c00` / `rgb(192, 0, 0)` / `yellow` → `#c00000`; anything else → null. */
export function normColor(v) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (!s) return null;
  if (NAMED[s]) return NAMED[s];
  let m = /^#([0-9a-f]{6})$/.exec(s);
  if (m) return `#${m[1]}`;
  m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s);
  if (m) return `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`;
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(s);
  if (m) return `#${[m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, "0")).join("")}`;
  return null;
}

/* ── the bank ────────────────────────────────────────────────────────────────────────── */
/** Every fixture as { id, dir, name, html, text, kind, expect, plainTable }. `kind`: "table" | "outline" | "runs". */
export function loadBank() {
  const bank = JSON.parse(fs.readFileSync(path.join(FIXTURES, "clipboard-bank", "bank.json"), "utf8"));
  const out = [];
  const files = (dir, name) => ({ html: readIf(path.join(FIXTURES, dir, `${name}.html`)), text: readIf(path.join(FIXTURES, dir, `${name}.txt`)) ?? "" });

  // 1 — the table clipboards: expectations live in that directory's own manifest.json (grid, merged spans, marks)
  const tm = JSON.parse(fs.readFileSync(path.join(FIXTURES, "clipboard-tables", "manifest.json"), "utf8")).fixtures;
  for (const [name, m] of Object.entries(tm)) {
    out.push({ id: `clipboard-tables/${name}`, dir: "clipboard-tables", name, ...files("clipboard-tables", name), kind: "table", plainTable: !!m.plainTable, synthetic: !!m.synthetic, expect: fromManifest(m) });
  }
  // 2 — the Word / OneNote outline clipboards: expectations are the outline each must become
  for (const [name, outline] of Object.entries(bank.outlines)) {
    out.push({ id: `clipboard-lists/${name}`, dir: "clipboard-lists", name, ...files("clipboard-lists", name), kind: "outline", synthetic: true, expect: { outline } });
  }
  // 3 — the cases added with this bank (the 2026-10-30 BlockNote spike's losses + Word lists + an Excel mixed table)
  for (const [name, e] of Object.entries(bank.entries)) {
    out.push({ id: `clipboard-bank/${name}`, dir: "clipboard-bank", name, ...files("clipboard-bank", name), kind: e.kind, synthetic: true, about: e.about, spike: !!e.spike, expect: e.expect });
  }
  return out;
}

/** The fixture directories' HTML files that have NO bank entry — the completeness check (must be empty). */
export function unregisteredFixtures(bank = loadBank()) {
  const have = new Set(bank.map((b) => `${b.dir}/${b.name}`));
  const missing = [];
  for (const dir of BANK_DIRS) {
    for (const f of fs.readdirSync(path.join(FIXTURES, dir))) if (f.endsWith(".html") && !have.has(`${dir}/${f.slice(0, -5)}`)) missing.push(`${dir}/${f}`);
  }
  return missing;
}

/** A clipboard-tables manifest entry → the structural expectation. */
function fromManifest(m) {
  const grid = m.grid;
  const rows = grid.length;
  const text = grid.map((r) => r.map((c) => (typeof c === "string" ? c : c.t)));
  const merges = [];
  const empty = [];
  grid.forEach((r, ri) => {
    let col = 0;
    r.forEach((c) => {
      const span = typeof c === "string" ? 1 : c.span;
      if (span > 1) merges.push({ r: ri, c: col, colspan: span });
      if ((typeof c === "string" ? c : c.t) === "") empty.push({ r: ri, c: col });
      col += span;
    });
  });
  const cols = Math.max(...grid.map((r) => r.reduce((n, c) => n + (typeof c === "string" ? 1 : c.span), 0)));
  return { tables: [{ rows, cols, text, merges, empty, textMarks: m.marks || [] }], noPicture: true };
}

/* ── reading a stored document ───────────────────────────────────────────────────────── */
const clean = (s) => String(s || "").replace(/ /g, " ").replace(/[ \t]+$/gm, "").replace(/\s+$/g, "");
const flat = (n) => { let s = ""; const w = (x) => { if (x.text) s += x.text; (x.content || []).forEach(w); }; w(n); return s; };

function markFacts(textNode) {
  const f = {};
  for (const m of textNode.marks || []) {
    if (m.type === "textStyle") {
      if (m.attrs?.color) f.color = normColor(m.attrs.color) || m.attrs.color;
      if (m.attrs?.fontFamily) f.fontFamily = m.attrs.fontFamily;
      if (m.attrs?.fontSize) f.fontSize = m.attrs.fontSize;
    } else if (m.type === "highlight") f.highlight = normColor(m.attrs?.color) || true;
    else f[m.type] = true;
  }
  return f;
}

/** Every text node in order as { text, marks }, for the "runs" expectations. */
export function runsOf(doc) {
  const out = [];
  const w = (n) => { if (!n) return; if (n.type === "text") out.push({ text: n.text, marks: markFacts(n) }); (n.content || []).forEach(w); };
  w(doc);
  return out;
}

/** One table node → { rows, cols, cells: [{ r, c, text, raw, colspan, rowspan, header, fill, bold, italic, link, color }] }. */
function readTable(tbl, where) {
  const cells = [];
  const occupied = new Set();
  let cols = 0;
  (tbl.content || []).forEach((row, r) => {
    let c = 0;
    (row.content || []).forEach((cell) => {
      while (occupied.has(`${r},${c}`)) c += 1;
      const colspan = cell.attrs?.colspan || 1;
      const rowspan = cell.attrs?.rowspan || 1;
      for (let dr = 0; dr < rowspan; dr += 1) for (let dc = 0; dc < colspan; dc += 1) occupied.add(`${r + dr},${c + dc}`);
      const texts = [];
      const paras = [];
      const collect = (n, line) => { // text nodes of this cell, skipping a nested table's own cells
        if (n.type === "table") return line;
        if (n.type === "text") { texts.push(n); return line + n.text; }
        if (n.type === "hardBreak") { paras.push(line); return ""; }
        let l = line;
        const isBlock = n.type === "paragraph" || n.type === "heading";
        if (isBlock) l = "";
        (n.content || []).forEach((ch) => { l = collect(ch, l); });
        if (isBlock) { paras.push(l); return ""; }
        return l;
      };
      (cell.content || []).forEach((b) => collect(b, ""));
      const facts = texts.filter((t) => t.text.trim()).map(markFacts);
      const all = (k) => facts.length > 0 && facts.every((f) => f[k]);
      const colors = new Set(facts.map((f) => f.color || null));
      cells.push({
        r, c, colspan, rowspan, header: cell.type === "tableHeader",
        raw: texts.map((t) => t.text).join(""),
        text: clean(paras.map(clean).join("\n")),
        fill: normColor(cell.attrs?.background),
        bold: all("bold"), italic: all("italic"), link: all("link"),
        color: colors.size === 1 ? [...colors][0] : null,
      });
      c += colspan;
      cols = Math.max(cols, c);
    });
  });
  return { where, rows: (tbl.content || []).length, cols, cells };
}

/** The document as the bank judges it: top-level tables (not those pasted INTO a cell — those nest), the outline lines
 *  (bullets/numbers by depth, tables as `[table a | b ; c | d]`), and the text runs. */
export function summariseDoc(doc) {
  const tables = [];
  const lines = [];
  const txt = (n) => flat(n);
  const walkTables = (n, where) => {
    if (!n) return;
    if (n.type === "table") {
      tables.push(readTable(n, where));
      (n.content || []).forEach((row) => (row.content || []).forEach((cell) => (cell.content || []).forEach((c) => walkTables(c, "nested"))));
      return;
    }
    const next = n.type === "noteAnchor" ? "box" : where;
    (n.content || []).forEach((c) => walkTables(c, next));
  };
  (doc?.content || []).forEach((n) => walkTables(n, "top-level"));

  const walkLines = (n, depth) => {
    if (n.type === "bulletList" || n.type === "orderedList" || n.type === "taskList") {
      (n.content || []).forEach((li, i) => {
        const mark = n.type === "orderedList" ? `${(n.attrs?.start || 1) + i}.` : "•";
        (li.content || []).forEach((c, k) => {
          if (k === 0) lines.push(`${"  ".repeat(depth)}${mark} ${txt(c)}`);
          else walkLines(c, depth + 1);
        });
      });
      return;
    }
    if (n.type === "table") {
      lines.push(`${"  ".repeat(depth)}[table ${(n.content || []).map((r) => (r.content || []).map((c) => txt(c)).join(" | ")).join(" ; ")}]`);
      return;
    }
    if (n.type === "noteAnchor" || n.type === "doc") { (n.content || []).forEach((c) => walkLines(c, depth)); return; }
    const t = txt(n);
    if (t) lines.push(`${"  ".repeat(depth)}${t}`);
  };
  walkLines(doc || { type: "doc", content: [] }, 0);

  const count = (type) => { let k = 0; const w = (n) => { if (!n) return; if (n.type === type) k += 1; (n.content || []).forEach(w); }; w(doc); return k; };
  return { tables, outline: lines, runs: runsOf(doc), images: count("noteImage") };
}

/* ── judging ─────────────────────────────────────────────────────────────────────────── */
const cellAt = (t, r, c) => t.cells.find((x) => x.r === r && x.c === c);
const gridText = (t) => {
  const g = [];
  t.cells.forEach((x) => { (g[x.r] ||= [])[x.c] = x.text; });
  return g.map((row) => row.filter((v) => v !== undefined));
};

/** The fill expectations of one table: `fills` (these cells carry exactly this colour), `noFill` (these carry none) and
 *  `noFillAll` (no cell carries any — the DECIDED default: a plain paste imports no foreign shading). */
export function checkFills(t, want, tag = "table") {
  const p = [];
  for (const f of want.fills || []) {
    const x = cellAt(t, f.r, f.c);
    if (!x || x.fill !== normColor(f.color)) p.push(`${tag}: cell (${f.r},${f.c}) fill is ${x ? x.fill : "missing"}, wanted ${normColor(f.color)}`);
  }
  for (const f of want.noFill || []) {
    const x = cellAt(t, f.r, f.c);
    if (x && x.fill) p.push(`${tag}: cell (${f.r},${f.c}) gained a fill ${x.fill} it should not have`);
  }
  if (want.noFillAll) for (const x of t.cells) if (x.fill) p.push(`${tag}: cell (${x.r},${x.c}) carries fill ${x.fill} — a plain paste imports no foreign shading (the Values-and-Source-Formatting option does)`);
  return p;
}

/** Problems with the table left behind AFTER a paste option was chosen (`expect.tables[i].optionFills`). */
export function checkOptionFills(entry, summary) {
  const p = [];
  (entry.expect?.tables || []).forEach((want, ti) => {
    if (!want.optionFills) return;
    const mine = summary.tables.filter((t) => t.where !== "nested");
    const t = mine.find((x) => x.where === "box") || mine[0];
    if (!t) { p.push(`table ${ti}: no table after choosing ${want.optionFills.mode}`); return; }
    p.push(...checkFills(t, want.optionFills, `table ${ti} after ${want.optionFills.mode}`));
  });
  return p;
}

/** Problems with one summarised document against one bank entry. Empty array = the structure is right. */
export function checkEntry(entry, summary) {
  const p = [];
  const e = entry.expect || {};
  if (e.noPicture && summary.images > 0) p.push(`a picture was pasted instead (${summary.images})`);

  if (e.outline) {
    if (JSON.stringify(summary.outline) !== JSON.stringify(e.outline)) p.push(`outline differs\n        want ${JSON.stringify(e.outline)}\n        got  ${JSON.stringify(summary.outline)}`);
    const glyph = summary.outline.find((l) => /[·§□▪]/.test(l) || /^\s*[•\d.a-z]*\s*o\s{2,}/.test(l.replace(/^\s*•\s/, "")));
    if (glyph) p.push(`a bullet glyph was left in the text: ${JSON.stringify(glyph)}`);
  }

  if (e.tables) {
    // the table the paste produced: the first one inside a box (else the first), exactly like the older harnesses
    const mine = summary.tables.filter((t) => t.where !== "nested");
    const pool = e.exactTables ? mine : [mine.find((t) => t.where === "box") || mine[0]].filter(Boolean);
    if (e.exactTables && mine.length !== e.tables.length) p.push(`expected ${e.tables.length} table(s), found ${mine.length}`);
    e.tables.forEach((want, ti) => {
      const t = e.exactTables ? pool[ti] : pool[0];
      if (!t) { p.push(`table ${ti}: no table arrived at all`); return; }
      const tag = `table ${ti}`;
      if (want.rows != null && t.rows !== want.rows) p.push(`${tag}: ${t.rows} rows, wanted ${want.rows}`);
      if (want.cols != null && t.cols !== want.cols) p.push(`${tag}: ${t.cols} columns, wanted ${want.cols}`);
      if (want.text) {
        const got = gridText(t);
        const exp = want.text.map((r) => r.filter((v) => v !== undefined));
        // a merged cell occupies one logical slot in the stored grid: the expectation lists one entry per stored cell
        if (JSON.stringify(got) !== JSON.stringify(exp)) p.push(`${tag}: text differs\n        want ${JSON.stringify(exp)}\n        got  ${JSON.stringify(got)}`);
      }
      for (const m of want.merges || []) {
        const x = cellAt(t, m.r, m.c);
        if (!x) p.push(`${tag}: no cell at (${m.r},${m.c}) to be merged`);
        else if (x.colspan !== (m.colspan || 1) || x.rowspan !== (m.rowspan || 1)) p.push(`${tag}: cell (${m.r},${m.c}) spans ${x.colspan}×${x.rowspan}, wanted ${m.colspan || 1}×${m.rowspan || 1}`);
      }
      const merged = t.cells.filter((x) => x.colspan > 1 || x.rowspan > 1).length;
      if ((want.merges || []).length !== merged && want.merges) p.push(`${tag}: ${merged} merged cell(s), wanted ${want.merges.length}`);
      p.push(...checkFills(t, want, tag));
      for (const z of want.empty || []) {
        const x = cellAt(t, z.r, z.c);
        if (!x) p.push(`${tag}: no cell at (${z.r},${z.c})`);
        else if (x.raw !== "") p.push(`${tag}: cell (${z.r},${z.c}) should be EMPTY but holds ${JSON.stringify(x.raw)}`);
      }
      for (const k of want.cellMarks || []) {
        const x = cellAt(t, k.r, k.c);
        if (!x || !x[k.mark]) p.push(`${tag}: cell (${k.r},${k.c}) lost its ${k.mark}`);
      }
      for (const k of want.cellColors || []) {
        const x = cellAt(t, k.r, k.c);
        if (!x || x.color !== normColor(k.color)) p.push(`${tag}: cell (${k.r},${k.c}) text colour is ${x ? x.color : "missing"}, wanted ${normColor(k.color)}`);
      }
      // the older manifests' "text run X keeps mark Y" form — a substring of any run in the pasted document
      for (const [needle, mark] of want.textMarks || []) {
        const has = summary.runs.some((r) => r.text.includes(needle) && r.marks[mark]);
        if (!has) p.push(`${tag}: "${needle}" lost its ${mark}`);
      }
    });
  }

  for (const w of e.runs || []) {
    const r = summary.runs.find((x) => x.text.includes(w.text));
    if (!r) { p.push(`run "${w.text}" is missing`); continue; }
    if (w.color && normColor(r.marks.color) !== normColor(w.color)) p.push(`run "${w.text}" colour is ${r.marks.color || "none"}, wanted ${normColor(w.color)}`);
    if (w.fontFamily && !String(r.marks.fontFamily || "").toLowerCase().includes(w.fontFamily.toLowerCase())) p.push(`run "${w.text}" font is ${r.marks.fontFamily || "none"}, wanted ${w.fontFamily}`);
    if (w.fontSize && Math.abs(parseFloat(r.marks.fontSize) - parseFloat(w.fontSize)) > 0.05) p.push(`run "${w.text}" size is ${r.marks.fontSize || "none"}, wanted ${w.fontSize}`);
    if (w.highlight && !r.marks.highlight) p.push(`run "${w.text}" lost its highlight`);
    for (const k of w.marks || []) if (!r.marks[k]) p.push(`run "${w.text}" lost its ${k}`);
  }
  if (e.noTables && summary.tables.length) p.push(`${summary.tables.length} table(s) arrived where none was expected`);
  if (e.plainText != null) {
    const got = summary.runs.map((r) => r.text).join("");
    if (got !== e.plainText) p.push(`text differs\n        want ${JSON.stringify(e.plainText)}\n        got  ${JSON.stringify(got)}`);
  }
  return p;
}

/* ── WHAT EACH PASTE OPTION OWES THE TEXT (NEW-2, 2026-11-10) ─────────────────────────────────────────────────────────── */

const APPEARANCE = ["color", "fontFamily", "fontSize", "highlight"];     // what Merge Formatting takes away
const EMPHASIS = ["bold", "italic", "underline", "strike", "link"];      // what it keeps

/** Problems with the document AFTER a paste option was chosen, judged against the document as the paste first landed (`base`).
 *  · `source` (Keep Source Formatting)  — the paste exactly as it landed: every mark, byte for byte
 *  · `merge`  (Merge Formatting)        — the same words, with the source's font, size, colour and highlight GONE and its bold,
 *                                          italic, underline, strike and links KEPT, run for run
 *  · `text`   (Keep Text Only)          — the same words and nothing else: no mark of any kind
 *  · `values` (a table's Values)        — the same words, no mark
 *  · `valuesFormat`                     — the same words with the source's bold and colour (and font, size) kept
 *  Empty array = the option did what it says. Text is compared run-joined, so a split in how runs fall never fails an option. */
export function checkPasteOption(mode, base, after) {
  const p = [];
  const b = runsOf(base); const a = runsOf(after);
  const text = (runs) => runs.map((r) => r.text).join("").replace(/\s+/g, " ").trim();
  if (mode === "source") {
    if (JSON.stringify(base) !== JSON.stringify(after)) p.push("Keep Source Formatting is not the paste as it landed");
    return p;
  }
  if (text(a) !== text(b)) p.push(`the words changed:\n        want ${JSON.stringify(text(b))}\n        got  ${JSON.stringify(text(a))}`);
  // characters of each flag in `base`, so a run split differently still compares fairly
  const flagChars = (runs, flag) => runs.filter((r) => r.marks[flag]).map((r) => r.text).join("").replace(/\s+/g, "");
  if (mode === "merge") {
    for (const r of a) for (const k of APPEARANCE) if (r.marks[k]) p.push(`Merge Formatting left "${r.text.slice(0, 24)}" with its source ${k}`);
    for (const k of EMPHASIS) if (flagChars(a, k) !== flagChars(b, k)) p.push(`Merge Formatting changed which words are ${k}: want "${flagChars(b, k).slice(0, 40)}", got "${flagChars(a, k).slice(0, 40)}"`);
  } else if (mode === "text" || mode === "values") {
    for (const r of a) if (Object.keys(r.marks).length) p.push(`${mode === "text" ? "Keep Text Only" : "Values"} left a mark on "${r.text.slice(0, 24)}": ${Object.keys(r.marks).join(", ")}`);
  } else if (mode === "valuesFormat") {
    for (const k of ["bold", "italic", "color", "fontFamily"]) if (flagChars(b, k) && !flagChars(a, k)) p.push(`Values and Source Formatting lost the ${k}`);
  } else p.push(`unknown paste option "${mode}"`);
  return p;
}
