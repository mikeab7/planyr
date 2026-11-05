/* notesTableSizeFixture — shared fixture + readers for the Notes table text-size / row-height harnesses
 * (NEW-1 / NEW-2 / NEW-3, 2026-11-05). Throwaway data only: every page is seeded into a fresh browser
 * context's own localStorage (signed out) or onto the test account's own throwaway page — never a real notebook.
 *
 * The table is deliberately MIXED in every dimension the fix has to cover (carry-forward §2 / trap 14):
 *   row 0  "Permit | Number | Authority"      all filled
 *   row 1  "TDLR   | (empty) | Texas Dept"    empty cell between two filled ones
 *   row 2  "(empty)| (empty) | (empty)"       a WHOLE empty row
 *   row 3  "Other  | N-1    | (empty)"        empty cell at the end
 */
export const para = (t, marks, attrs) => ({
  type: "paragraph", ...(attrs ? { attrs } : {}),
  content: t ? [{ type: "text", text: t, ...(marks ? { marks } : {}) }] : [],
});
export const cell = (t, extra = {}, kind = "tableCell") => ({
  type: kind, attrs: { colspan: 1, rowspan: 1, colwidth: [150], ...extra },
  content: [typeof t === "string" || t == null ? para(t) : t],
});
export const row = (...cells) => ({ type: "tableRow", content: cells });
export const MIXED_TABLE = () => ({
  type: "table",
  content: [
    row(cell("Permit"), cell("Number"), cell("Authority")),
    row(cell("TDLR"), cell(""), cell("Texas Dept")),
    row(cell(""), cell(""), cell("")),
    row(cell("Other"), cell("N-1"), cell("")),
  ],
});
export const box = (aid, x, y, content, w = 520) => ({ type: "noteAnchor", attrs: { x, y, w, h: null, aid }, content });
export const DOC = (table = MIXED_TABLE()) => [box("tbl", 40, 40, [table]), box("tgt", 40, 600, [para("Target text")]), para("")];
export const TREE = { v: 3, tombs: [], trash: [], pages: [{ id: "p1", title: "ZZ throwaway size check", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }] };
export const PK = "planyr:notes:page:v1:local:p1";
export const ACTIVE_KEY = "planyr:notes:activePage:v1:local";

/** The size a cell's text carries: the textStyle fontSize on its runs, else the paragraph's block size. */
export function cellSizes(doc) {
  const out = [];
  const find = (n) => { if (!n) return null; if (n.type === "table") return n; for (const c of n.content || []) { const t = find(c); if (t) return t; } return null; };
  const t = find({ type: "doc", content: doc.content });
  for (const r of t?.content || []) {
    out.push((r.content || []).map((c) => {
      const sizes = [];
      for (const p of c.content || []) {
        if (p.attrs?.fontSize) sizes.push(`B${p.attrs.fontSize}`);
        for (const run of p.content || []) {
          const m = (run.marks || []).find((x) => x.type === "textStyle");
          sizes.push(m?.attrs?.fontSize ? `T${m.attrs.fontSize}` : "T-");
        }
        if (!(p.content || []).length && !p.attrs?.fontSize) sizes.push("-");
      }
      return [...new Set(sizes)].join("+");
    }));
  }
  return out;
}
export const rowHeights = (doc) => {
  const find = (n) => { if (!n) return null; if (n.type === "table") return n; for (const c of n.content || []) { const t = find(c); if (t) return t; } return null; };
  const t = find({ type: "doc", content: doc.content });
  return (t?.content || []).map((r) => r.attrs?.rowHeight ?? null);
};
