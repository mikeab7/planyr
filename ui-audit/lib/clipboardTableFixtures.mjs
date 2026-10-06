/* clipboardTableFixtures — load the committed clipboard fixtures (test/fixtures/clipboard-tables)
 * and summarise a stored Notes document's tables so a harness can compare them with the manifest.
 * Shared by ui-audit/verify-notes-table-paste.mjs. Pure Node, no browser. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../test/fixtures/clipboard-tables");

export const manifest = JSON.parse(fs.readFileSync(path.join(DIR, "manifest.json"), "utf8")).fixtures;
export const fixtureNames = Object.keys(manifest);
export const loadFixture = (name) => ({
  html: fs.readFileSync(path.join(DIR, `${name}.html`), "utf8"),
  text: fs.readFileSync(path.join(DIR, `${name}.txt`), "utf8"),
  ...manifest[name],
});

/** A 1×1 transparent PNG — stands in for the picture of the cells Excel (and some OneNote
 *  builds) put on the clipboard BESIDE the html. */
export const TINY_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const clean = (s) => String(s || "").replace(/ /g, " ").replace(/[ \t]+$/gm, "").replace(/\s+$/g, "");

/** Every table in a stored doc → { where: "box"|"top-level"|"nested", grid, marks }.
 *  grid: rows of cells; a merged cell is { t, span }. */
export function summariseTables(doc) {
  const out = [];
  const cellText = (cell) => {
    const paras = [];
    const marks = [];
    (cell.content || []).forEach((blk) => {
      let line = "";
      (blk.content || []).forEach((n) => {
        if (n.type === "hardBreak") { paras.push(line); line = ""; return; }
        if (n.text) {
          line += n.text;
          (n.marks || []).forEach((m) => marks.push([n.text, m.type === "bold" || m.type === "italic" || m.type === "link" ? m.type : m.type]));
        }
      });
      paras.push(line);
    });
    return { text: clean(paras.map(clean).join("\n")), marks };
  };
  const walk = (n, where) => {
    if (!n) return;
    if (n.type === "table") {
      const grid = [];
      const marks = [];
      (n.content || []).forEach((row) => {
        grid.push((row.content || []).map((cell) => {
          const { text, marks: m } = cellText(cell);
          marks.push(...m);
          const span = cell.attrs?.colspan || 1;
          return span > 1 ? { t: text, span } : text;
        }));
      });
      out.push({ where, grid, marks });
      return;
    }
    const next = n.type === "noteAnchor" ? "box" : where;
    (n.content || []).forEach((c) => walk(c, n.type === "tableCell" ? "nested" : next));
  };
  (doc?.content || []).forEach((n) => walk(n, "top-level"));
  return out;
}

/** Compare a summarised table against a manifest entry → list of human-readable problems. */
export function diffAgainst(summary, expected) {
  const problems = [];
  if (!summary) return ["no table arrived at all"];
  const want = JSON.stringify(expected.grid);
  const got = JSON.stringify(summary.grid);
  if (want !== got) problems.push(`grid differs\n        want ${want}\n        got  ${got}`);
  for (const [text, mark] of expected.marks || []) {
    const has = summary.marks.some(([t, m]) => t.includes(text) && m === mark);
    if (!has) problems.push(`"${text}" lost its ${mark}`);
  }
  return problems;
}
