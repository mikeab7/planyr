/* notesMarkdown — the PURE Markdown export, and `docToText` (what body search reads).
 *
 * The export is deliberately LOSSY-BUT-HONEST: what Markdown can spell it spells (GFM pipe
 * tables, task lists, code fences, quotes, links, the inline marks); what it cannot falls
 * back to the small inline-HTML subset every renderer passes through, and the exporter
 * REPORTS which constructs needed that fallback. Both halves are tested — a silent fallback
 * would be as bad as a dropped one, because the user only finds out in another app.
 */
import { describe, it, expect } from "vitest";
import {
  docToMarkdown, docToText, escapeText, lossyNote, notebookToMarkdown, safeFileName, NOTE_MD_HANDLED,
} from "../src/workspaces/notes/lib/notesMarkdown.js";

const doc = (...content) => ({ type: "doc", content });
const p = (...content) => ({ type: "paragraph", content });
const t = (text, marks) => (marks ? { type: "text", text, marks } : { type: "text", text });
const md = (d, opts) => docToMarkdown(d, opts).markdown;
const lossy = (d) => docToMarkdown(d).lossy;

const cell = (text, attrs) => ({ type: "tableCell", attrs, content: [p(t(text))] });
const header = (text) => ({ type: "tableHeader", content: [p(t(text))] });
const row = (...content) => ({ type: "tableRow", content });

describe("blocks", () => {
  it("paragraphs", () => {
    expect(md(doc(p(t("First.")), p(t("Second."))))).toBe("First.\n\nSecond.\n");
  });

  it("headings at every level the editor admits", () => {
    for (const level of [1, 2, 3, 4]) {
      expect(md(doc({ type: "heading", attrs: { level }, content: [t("Title")] }))).toBe(`${"#".repeat(level)} Title\n`);
    }
  });

  it("a page title becomes the top-level heading", () => {
    expect(md(doc(p(t("Body."))), { title: "Site visit" })).toBe("# Site visit\n\nBody.\n");
  });

  it("bulleted lists", () => {
    const d = doc({ type: "bulletList", content: [
      { type: "listItem", content: [p(t("One"))] },
      { type: "listItem", content: [p(t("Two"))] },
    ] });
    expect(md(d)).toBe("- One\n- Two\n");
  });

  it("numbered lists, honouring an explicit start", () => {
    const items = [{ type: "listItem", content: [p(t("A"))] }, { type: "listItem", content: [p(t("B"))] }];
    expect(md(doc({ type: "orderedList", content: items }))).toBe("1. A\n2. B\n");
    expect(md(doc({ type: "orderedList", attrs: { start: 5 }, content: items }))).toBe("5. A\n6. B\n");
  });

  it("nested lists indent", () => {
    const d = doc({ type: "bulletList", content: [
      { type: "listItem", content: [p(t("Outer")), { type: "bulletList", content: [{ type: "listItem", content: [p(t("Inner"))] }] }] },
    ] });
    expect(md(d)).toContain("- Outer");
    expect(md(d)).toContain("  - Inner");
  });

  it("checkbox lists become GFM task lists, checked state and all", () => {
    const d = doc({ type: "taskList", content: [
      { type: "taskItem", attrs: { checked: true }, content: [p(t("Done thing"))] },
      { type: "taskItem", attrs: { checked: false }, content: [p(t("Open thing"))] },
    ] });
    expect(md(d)).toBe("- [x] Done thing\n- [ ] Open thing\n");
  });

  it("blockquotes prefix every line", () => {
    const d = doc({ type: "blockquote", content: [p(t("Line one.")), p(t("Line two."))] });
    expect(md(d)).toBe("> Line one.\n>\n> Line two.\n");
  });

  it("code blocks fence, carry their language, and are NOT escaped", () => {
    const d = doc({ type: "codeBlock", attrs: { language: "js" }, content: [t("const a = b[0] * 2;")] });
    expect(md(d)).toBe("```js\nconst a = b[0] * 2;\n```\n");
  });

  it("a code block with no language still fences", () => {
    expect(md(doc({ type: "codeBlock", content: [t("plain")] }))).toBe("```\nplain\n```\n");
  });

  it("dividers", () => {
    expect(md(doc(p(t("A")), { type: "horizontalRule" }, p(t("B"))))).toBe("A\n\n---\n\nB\n");
  });

  it("hard breaks become a Markdown line break", () => {
    expect(md(doc(p(t("One"), { type: "hardBreak" }, t("Two"))))).toBe("One  \nTwo\n");
  });

  it("an empty document exports as an empty file, not as a crash", () => {
    expect(() => md(doc())).not.toThrow();
    expect(md({ type: "doc" })).toBe("\n");
    expect(md(null)).toBe("\n");
  });
});

describe("inline marks", () => {
  const one = (marks) => md(doc(p(t("word", marks))));

  it("bold, italic, strike and inline code use real Markdown", () => {
    expect(one([{ type: "bold" }])).toBe("**word**\n");
    expect(one([{ type: "italic" }])).toBe("*word*\n");
    expect(one([{ type: "strike" }])).toBe("~~word~~\n");
    expect(one([{ type: "code" }])).toBe("`word`\n");
  });

  it("marks combine", () => {
    expect(one([{ type: "bold" }, { type: "italic" }])).toBe("***word***\n");
  });

  it("links carry their href, with the label outermost", () => {
    expect(one([{ type: "link", attrs: { href: "https://planyr.io" } }])).toBe("[word](https://planyr.io)\n");
    expect(one([{ type: "bold" }, { type: "link", attrs: { href: "https://planyr.io" } }])).toBe("[**word**](https://planyr.io)\n");
  });

  it("UNDERLINE falls back to <u> — Markdown has no underline — and says so", () => {
    expect(one([{ type: "underline" }])).toBe("<u>word</u>\n");
    expect(lossy(doc(p(t("word", [{ type: "underline" }]))))).toEqual(["underlined text"]);
  });

  it("HIGHLIGHT falls back to <mark>, keeping the chosen colour", () => {
    expect(one([{ type: "highlight" }])).toBe("<mark>word</mark>\n");
    expect(one([{ type: "highlight", attrs: { color: "#FEF08A" } }])).toBe('<mark style="background-color:#FEF08A">word</mark>\n');
    expect(lossy(doc(p(t("word", [{ type: "highlight" }]))))).toEqual(["highlighted text"]);
  });

  it("text COLOUR, SIZE and FAMILY fall back to one <span style> and are each reported", () => {
    const marks = [{ type: "textStyle", attrs: { color: "#C0392B", fontSize: "18px", fontFamily: "Georgia, serif" } }];
    expect(one(marks)).toBe('<span style="color:#C0392B;font-size:18px;font-family:Georgia, serif">word</span>\n');
    expect(lossy(doc(p(t("word", marks)))).sort()).toEqual(["font family", "font size", "text colour"]);
  });

  it("an empty textStyle adds no wrapper and reports no loss", () => {
    expect(one([{ type: "textStyle", attrs: { } }])).toBe("word\n");
    expect(lossy(doc(p(t("word", [{ type: "textStyle", attrs: { } }]))))).toEqual([]);
  });

  it("ALIGNMENT is not expressible in Markdown, so an aligned block wraps and reports", () => {
    const d = doc({ type: "paragraph", attrs: { textAlign: "center" }, content: [t("Middle")] });
    expect(md(d)).toBe('<p style="text-align:center">Middle</p>\n');
    expect(lossy(d)).toEqual(["text alignment"]);
  });

  it("an aligned HEADING keeps its level in the fallback", () => {
    const d = doc({ type: "heading", attrs: { level: 2, textAlign: "right" }, content: [t("Right")] });
    expect(md(d)).toBe('<h2 style="text-align:right">Right</h2>\n');
  });

  it("the DEFAULT alignment costs nothing — plain Markdown, no loss reported", () => {
    for (const textAlign of [null, undefined, "left"]) {
      const d = doc({ type: "paragraph", attrs: { textAlign }, content: [t("Plain")] });
      expect(md(d)).toBe("Plain\n");
      expect(lossy(d)).toEqual([]);
    }
  });
});

describe("tables — GFM when it fits, HTML when it structurally cannot", () => {
  const simple = doc({ type: "table", content: [
    row(header("Parcel"), header("Acres")),
    row(cell("North"), cell("42.1")),
    row(cell("South"), cell("18.6")),
  ] });

  it("a plain table with a header row is a real GFM pipe table", () => {
    expect(md(simple)).toBe([
      "| Parcel | Acres |",
      "| --- | --- |",
      "| North | 42.1 |",
      "| South | 18.6 |",
      "",
    ].join("\n"));
  });

  it("a pipe table reports NO lossiness — this is the case Markdown handles fully", () => {
    expect(lossy(simple)).toEqual([]);
  });

  it("inline marks survive inside pipe cells", () => {
    const d = doc({ type: "table", content: [
      row(header("H")),
      row({ type: "tableCell", content: [p(t("bold", [{ type: "bold" }]))] }),
    ] });
    expect(md(d)).toContain("| **bold** |");
  });

  it("a ragged row is padded so the pipe table stays rectangular", () => {
    const d = doc({ type: "table", content: [row(header("A"), header("B")), row(cell("only"))] });
    expect(md(d)).toContain("| only |  |");
  });

  it("a MERGED cell forces the whole table to HTML, and is reported", () => {
    const d = doc({ type: "table", content: [
      row(header("A"), header("B")),
      row(cell("wide", { colspan: 2 })),
    ] });
    expect(md(d)).toContain("<table>");
    expect(md(d)).toContain('<td colspan="2">wide</td>');
    expect(md(d)).not.toContain("| --- |");
    expect(lossy(d)).toContain("merged table cells");
  });

  it("a rowspan is carried too", () => {
    const d = doc({ type: "table", content: [row(header("A")), row(cell("tall", { rowspan: 3 }))] });
    expect(md(d)).toContain('<td rowspan="3">tall</td>');
    expect(lossy(d)).toContain("merged table cells");
  });

  it("a MULTI-BLOCK cell forces HTML too — a pipe cell cannot hold two paragraphs", () => {
    const d = doc({ type: "table", content: [
      row(header("A")),
      row({ type: "tableCell", content: [p(t("First para")), p(t("Second para"))] }),
    ] });
    expect(md(d)).toContain("<table>");
    expect(md(d)).toContain("First para<br>Second para");
    expect(lossy(d)).toContain("tables with multi-paragraph cells");
  });

  it("a HEADERLESS table falls back rather than promoting a data row into a header", () => {
    // GFM has no way to express a table with no header. Promoting row 1 would silently
    // change what the table SAYS, which is worse than an HTML fallback.
    const d = doc({ type: "table", content: [row(cell("a"), cell("b")), row(cell("c"), cell("d"))] });
    expect(md(d)).toContain("<table>");
    expect(md(d)).toContain("<td>a</td>");
    expect(lossy(d)).toContain("tables with no header row");
  });

  it("header cells render as <th> in the HTML fallback", () => {
    const d = doc({ type: "table", content: [row(header("H"), header("H2")), row(cell("x", { colspan: 2 }))] });
    expect(md(d)).toContain("<th>H</th>");
  });

  it("an empty table exports as nothing rather than a broken skeleton", () => {
    expect(md(doc({ type: "table", content: [] }))).toBe("\n");
  });
});

describe("escaping", () => {
  it("escapes the Markdown specials that would otherwise become formatting", () => {
    expect(escapeText("a*b_c[d]e`f")).toBe("a\\*b\\_c\\[d\\]e\\`f");
  });

  it("escapes a leading block marker so a line of prose stays prose", () => {
    expect(escapeText("# not a heading")).toBe("\\# not a heading");
    expect(escapeText("- not a bullet")).toBe("\\- not a bullet");
    expect(escapeText("1. not a list")).toBe("\\1. not a list");
  });

  it("escapes angle brackets so typed HTML shows as text", () => {
    expect(md(doc(p(t("<b>literal</b>"))))).toBe("\\<b\\>literal\\</b\\>\n");
  });

  it("does NOT escape inside inline code — the point of code is that it is literal", () => {
    expect(md(doc(p(t("a*b_c", [{ type: "code" }]))))).toBe("`a*b_c`\n");
  });

  it("a backtick INSIDE inline code widens the fence instead of altering the content", () => {
    // The content must survive byte-for-byte: an earlier version inserted a zero-width
    // space to break the fence, which silently edited the user's code.
    const out = md(doc(p(t("a `b` c", [{ type: "code" }]))));
    expect(out).toBe("`` a `b` c ``\n");
    expect(out).not.toContain("​");
  });

  it("plain inline code with no backticks keeps the simple single fence", () => {
    expect(md(doc(p(t("plain", [{ type: "code" }]))))).toBe("`plain`\n");
  });

  it("no exported file contains a zero-width space", () => {
    const d = doc(p(t("x", [{ type: "code" }])), p(t("y", [{ type: "bold" }])));
    expect(md(d)).not.toContain("​");
  });

  it("does NOT escape inside a code block", () => {
    expect(md(doc({ type: "codeBlock", content: [t("if (a[0] && b_c) { }")] }))).toContain("if (a[0] && b_c) { }");
  });

  /* THE TRAP. `escapeText` already escapes `|`, because a pipe is a Markdown special
   * everywhere. A table writer that escapes pipes a second time emits `\\|`, and every cell
   * containing one renders with a stray backslash. */
  it("a pipe inside a table cell is escaped EXACTLY ONCE", () => {
    const d = doc({ type: "table", content: [row(header("H")), row(cell("a|b"))] });
    const out = md(d);
    expect(out).toContain("a\\|b");
    expect(out, "the pipe was escaped twice — escapeText already handles it").not.toContain("a\\\\|b");
  });

  it("a pipe in ordinary prose is escaped exactly once too", () => {
    const out = md(doc(p(t("left|right"))));
    expect(out).toContain("left\\|right");
    expect(out).not.toContain("left\\\\|right");
  });

  it("a backslash in the source survives as one escaped backslash", () => {
    expect(escapeText("C:\\path")).toBe("C:\\\\path");
  });

  it("attribute values in an HTML fallback are entity-escaped, so a quote cannot break out", () => {
    const marks = [{ type: "highlight", attrs: { color: '"><script>' } }];
    expect(md(doc(p(t("x", marks))))).not.toContain("<script>");
  });
});

describe("the lossiness report", () => {
  it("is empty when everything exported cleanly", () => {
    expect(lossy(doc(p(t("Plain")), { type: "bulletList", content: [{ type: "listItem", content: [p(t("Item"))] }] }))).toEqual([]);
  });

  it("de-duplicates — three underlined words are ONE reported construct", () => {
    const u = [{ type: "underline" }];
    expect(lossy(doc(p(t("a", u), t("b", u), t("c", u))))).toEqual(["underlined text"]);
  });

  it("collects every distinct construct across a whole document", () => {
    const d = doc(
      p(t("u", [{ type: "underline" }])),
      p(t("h", [{ type: "highlight" }])),
      { type: "paragraph", attrs: { textAlign: "center" }, content: [t("c")] },
      { type: "table", content: [row(header("A"), header("B")), row(cell("m", { colspan: 2 }))] },
    );
    expect(lossy(d).sort()).toEqual(["highlighted text", "merged table cells", "text alignment", "underlined text"]);
  });

  it("lossyNote turns the list into a plain-English sentence, and says nothing when nothing was lost", () => {
    expect(lossyNote([])).toBe("");
    expect(lossyNote(["underlined text"])).toContain("Markdown can't carry underlined text");
    expect(lossyNote(["underlined text", "text colour"])).toContain("underlined text and text colour");
    expect(lossyNote(["a", "b", "c"])).toContain("a, b and c");
  });
});

describe("whole-notebook export", () => {
  const notebook = {
    id: "nb", title: "Goose Creek",
    sections: [
      { id: "s1", title: "Due diligence", pages: [{ id: "p1", title: "Site visit" }, { id: "p2", title: "Utilities" }] },
      { id: "s2", title: "Zoning", pages: [{ id: "p3", title: "Setbacks" }] },
    ],
  };
  const bodies = {
    p1: doc(p(t("Walked the north line."))),
    p2: doc({ type: "bulletList", content: [{ type: "listItem", content: [p(t("Water at the road"))] }] }),
    // p3 deliberately absent — an unwritten page must not break the export.
  };

  it("nests notebook › section › page as heading levels 1 › 2 › 3", () => {
    const { markdown } = notebookToMarkdown(notebook, bodies);
    expect(markdown).toContain("# Goose Creek");
    expect(markdown).toContain("## Due diligence");
    expect(markdown).toContain("### Site visit");
    expect(markdown).toContain("Walked the north line.");
    expect(markdown).toContain("- Water at the road");
  });

  it("keeps every page in reading order", () => {
    const { markdown } = notebookToMarkdown(notebook, bodies);
    const order = ["# Goose Creek", "## Due diligence", "### Site visit", "### Utilities", "## Zoning", "### Setbacks"];
    let at = -1;
    for (const s of order) { const i = markdown.indexOf(s); expect(i, s).toBeGreaterThan(at); at = i; }
  });

  it("a page with no stored body exports as its heading, never as a thrown error", () => {
    expect(() => notebookToMarkdown(notebook, bodies)).not.toThrow();
    expect(notebookToMarkdown(notebook, bodies).markdown).toContain("### Setbacks");
  });

  it("reports lossiness across the whole notebook, not just the first page", () => {
    const { lossy: l } = notebookToMarkdown(notebook, { ...bodies, p3: doc(p(t("x", [{ type: "underline" }]))) });
    expect(l).toContain("underlined text");
  });

  it("survives an empty or malformed notebook", () => {
    expect(() => notebookToMarkdown(null, {})).not.toThrow();
    expect(notebookToMarkdown({ title: "Bare" }, {}).markdown).toContain("# Bare");
  });
});

describe("safeFileName", () => {
  it("keeps an ordinary title readable", () => {
    expect(safeFileName("Site visit")).toBe("Site visit.md");
  });

  it("strips path separators so an export cannot escape the download folder", () => {
    expect(safeFileName("../../etc/passwd")).toBe("etc passwd.md");
    expect(safeFileName("a/b\\c")).toBe("a b c.md");
  });

  it("strips characters Windows reserves", () => {
    expect(safeFileName('a:b*c?d"e<f>g|h')).toBe("a b c d e f g h.md");
  });

  it("never returns a hidden file or an empty stem", () => {
    expect(safeFileName("...")).toBe("note.md");
    expect(safeFileName("")).toBe("note.md");
    expect(safeFileName("   ")).toBe("note.md");
    expect(safeFileName(null)).toBe("note.md");
  });

  it("caps an absurdly long title", () => {
    expect(safeFileName("x".repeat(500)).length).toBeLessThanOrEqual(84);
  });

  it("honours a different extension", () => {
    expect(safeFileName("Notebook", "txt")).toBe("Notebook.txt");
  });
});

describe("docToText — what body search matches against", () => {
  it("flattens every text node in the document", () => {
    expect(docToText(doc(p(t("Hello")), p(t("world"))))).toBe("Hello\nworld");
  });

  it("reaches text inside lists, quotes and table cells", () => {
    const d = doc(
      { type: "bulletList", content: [{ type: "listItem", content: [p(t("in a list"))] }] },
      { type: "blockquote", content: [p(t("in a quote"))] },
      { type: "table", content: [row(header("in a header"), cell("in a cell"))] },
    );
    const text = docToText(d);
    for (const s of ["in a list", "in a quote", "in a header", "in a cell"]) expect(text).toContain(s);
  });

  it("keeps block boundaries, so a phrase cannot be stitched across two paragraphs", () => {
    expect(docToText(doc(p(t("north")), p(t("line"))))).not.toContain("northline");
  });

  it("ignores marks — searching for a word finds it however it is formatted", () => {
    expect(docToText(doc(p(t("bold", [{ type: "bold" }, { type: "highlight" }]))))).toBe("bold");
  });

  it("is empty and non-throwing for junk input", () => {
    for (const v of [null, undefined, {}, { type: "doc" }, 7, "str"]) {
      expect(() => docToText(v)).not.toThrow();
      expect(docToText(v)).toBe("");
    }
  });
});

describe("the handled-construct manifest", () => {
  it("lists every node and mark the exporter has a case for", () => {
    expect(NOTE_MD_HANDLED.nodes).toContain("table");
    expect(NOTE_MD_HANDLED.nodes).toContain("taskItem");
    expect(NOTE_MD_HANDLED.marks).toContain("highlight");
    expect(new Set(NOTE_MD_HANDLED.nodes).size).toBe(NOTE_MD_HANDLED.nodes.length);
    expect(new Set(NOTE_MD_HANDLED.marks).size).toBe(NOTE_MD_HANDLED.marks.length);
  });
});
