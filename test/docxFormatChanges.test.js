import { describe, it, expect } from "vitest";
import { getSchema } from "@tiptap/core";
import { Node } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { unzipSync, strFromU8 } from "fflate";
import { buildFormatChangeDocx } from "./fixtures/docxFormatChangeFixture.js";
import { buildFixtureDocx } from "./fixtures/docxFixture.js";
import { readDocx } from "../src/shared/files/docx/docxRead.js";
import { writeDocx } from "../src/shared/files/docx/docxWrite.js";
import { sectChanges, resolveSect } from "../src/shared/files/docx/fmtChange.js";
import { docExtensions } from "../src/workspaces/doc-review/docEditor/docExtensions.js";
import { listChanges, acceptChange, rejectChange, acceptAll, rejectAll } from "../src/workspaces/doc-review/docEditor/trackChanges.js";

/* NEW-1 (B2022929 amend): Word's tracked FORMATTING changes are shown, can be accepted / rejected, and any not acted on
 * are written back unchanged. Each test fails on the pre-change code, where these records were dropped on save. */
const schema = getSchema(docExtensions());
const open = (bytes) => { const r = readDocx(bytes); return { ...r, state: EditorState.create({ schema, doc: Node.fromJSON(schema, r.doc) }) }; };
const save = (s, state = s.state) => strFromU8(unzipSync(writeDocx({ doc: state.doc.toJSON(), comments: s.comments, meta: s.meta, files: s.files }))["word/document.xml"]);
const apply = (s, tr) => ({ ...s, state: s.state.apply(tr) });
const fmts = (st) => listChanges(st.doc).filter((c) => c.kind === "fmt");
const FORMAT_RECORDS = /<w:(rPr|pPr|tblPr|tcPr|trPr|sectPr)Change |<w:tblGridChange /g;

describe("a .docx with every kind of Word formatting change — open", () => {
  const s = open(buildFormatChangeDocx());
  const ch = fmts(s.state);
  it("shows each one as a tracked formatting change with author, time and a Formatted: label", () => {
    expect(ch.map((c) => [c.scope, c.label, c.author, c.date])).toEqual([
      ["para", "Formatted: paragraph style", "Erin Fmt", "2026-09-05T09:00:00Z"],
      ["para", "Formatted: alignment, indent / spacing", "Erin Fmt", "2026-09-05T09:00:00Z"],
      ["run", "Formatted: Bold", "Erin Fmt", "2026-09-05T09:00:00Z"],
      ["run", "Formatted: Not bold, Italic", "Frank Fmt", "2026-09-06T10:30:00Z"],
      ["table", "Formatted: Table", "Erin Fmt", "2026-09-05T09:00:00Z"],
      ["grid", "Formatted: Table column widths", "", ""],
      ["row", "Formatted: Table row", "Erin Fmt", "2026-09-05T09:00:00Z"],
      ["cell", "Formatted: Table cell", "Erin Fmt", "2026-09-05T09:00:00Z"],
      ["mark", "Formatted: Paragraph mark", "Erin Fmt", "2026-09-05T09:00:00Z"],
    ]);
    expect(sectChanges(s.meta.sectPr).map((c) => [c.label, c.author])).toEqual([["Formatted: Section", "Erin Fmt"]]);
  });
  it("no longer warns that formatting changes will be dropped", () => { expect(s.meta.warnings).toEqual([]); });
  it("shows the CURRENT formatting on the text", () => {
    const json = JSON.stringify(s.doc);
    expect(json).toMatch(/"text":"Bold applied","marks":\[\{"type":"bold"\}/);
    expect(s.doc.content[0]).toMatchObject({ type: "heading", attrs: { level: 2 } });
  });
});

describe("write back what was not acted on — the file round-trips with nothing lost", () => {
  const s = open(buildFormatChangeDocx());
  const xml = save(s);
  it("writes every record, with its OLD properties and author, as Word's own elements", () => {
    expect(xml).toMatch(/<w:pPrChange [^>]*w:author="Erin Fmt"[^>]*><w:pPr><w:pStyle w:val="Heading1"\/><\/w:pPr><\/w:pPrChange>/);
    expect(xml).toMatch(/<w:pPrChange [^>]*><w:pPr><w:ind w:left="0"\/><\/w:pPr><\/w:pPrChange>/);
    expect(xml).toMatch(/<w:rPrChange [^>]*w:author="Erin Fmt"[^>]*><w:rPr\/><\/w:rPrChange>/);
    expect(xml).toMatch(/<w:rPrChange [^>]*w:author="Frank Fmt"[^>]*w:date="2026-09-06T10:30:00Z"[^>]*><w:rPr><w:b\/><\/w:rPr><\/w:rPrChange>/);
    expect(xml).toMatch(/<w:tblPrChange [^>]*><w:tblPr><w:tblW w:w="5000" w:type="dxa"\/><\/w:tblPr><\/w:tblPrChange>/);
    expect(xml).toMatch(/<w:tblGridChange [^>]*><w:tblGrid><w:gridCol w:w="2000"\/><w:gridCol w:w="4000"\/><\/w:tblGrid><\/w:tblGridChange>/);
    expect(xml).toMatch(/<w:trPrChange /);
    expect(xml).toMatch(/<w:tcPrChange [^>]*><w:tcPr><w:tcW w:w="3000" w:type="dxa"\/><\/w:tcPr><\/w:tcPrChange>/);
    expect(xml).toMatch(/<w:sectPrChange [^>]*><w:sectPr><w:pgSz w:w="11906" w:h="16838"\/><\/w:sectPr><\/w:sectPrChange>/);
    expect((xml.match(FORMAT_RECORDS) || []).length).toBe(10);
  });
  it("puts the record where Word's schema wants it (last inside its property block)", () => {
    expect(xml).toMatch(/<w:rPr><w:b\/><w:rPrChange [^>]*><w:rPr\/><\/w:rPrChange><\/w:rPr><w:t[ >]/);
    expect(xml).toMatch(/<w:jc w:val="center"\/>(?:<w:ind[^>]*\/>)?<w:pPrChange /);
  });
  it("re-opens to the same list of changes (nothing gained, nothing lost)", () => {
    const again = open(Uint8Array.from(unzipSync(writeDocx({ doc: s.state.doc.toJSON(), comments: [], meta: s.meta, files: s.files })) && writeDocx({ doc: s.state.doc.toJSON(), comments: [], meta: s.meta, files: s.files })));
    expect(fmts(again.state).map((c) => [c.scope, c.label, c.author, c.date])).toEqual(fmts(s.state).map((c) => [c.scope, c.label, c.author, c.date]));
    expect(sectChanges(again.meta.sectPr).length).toBe(1);
  });
});

describe("accept — the new formatting stays, the records go", () => {
  const s0 = open(buildFormatChangeDocx());
  const s = apply(s0, acceptAll(s0.state));
  const xml = save(s0, s.state).replace(/<w:sectPr>[\s\S]*<\/w:sectPr>(?=<\/w:body>)/, "");
  it("leaves no record in the body and keeps the look", () => {
    expect(xml.match(FORMAT_RECORDS)).toBeNull();
    expect(fmts(s.state)).toEqual([]);
    expect(xml).toMatch(/<w:pStyle w:val="Heading2"\/>/);
    expect(xml).toMatch(/<w:rPr><w:b\/><\/w:rPr><w:t[^>]*>Bold applied/);
    expect(xml).toMatch(/<w:shd w:val="clear" w:color="auto" w:fill="FFFF00"\/>/);
    expect(xml).toMatch(/<w:gridCol w:w="3000"\/><w:gridCol w:w="3000"\/><\/w:tblGrid>/);
  });
  it("accepts one change at a time", () => {
    const one = fmts(s0.state).find((c) => c.scope === "run" && c.author === "Frank Fmt");
    const r = apply(s0, acceptChange(s0.state, one.key));
    expect(fmts(r.state)).toHaveLength(fmts(s0.state).length - 1);
    expect(fmts(r.state).some((c) => c.author === "Frank Fmt")).toBe(false);
  });
  it("accepts the section change", () => {
    const out = resolveSect(s0.meta.sectPr, true);
    expect(out).not.toMatch(/sectPrChange/); expect(out).toMatch(/w:w="12240"/);
  });
});

describe("reject — the old formatting comes back", () => {
  const s0 = open(buildFormatChangeDocx());
  const s = apply(s0, rejectAll(s0.state));
  const xml = save(s0, s.state);
  it("leaves no record", () => { expect(xml.replace(/<w:sectPr>[\s\S]*<\/w:sectPr>(?=<\/w:body>)/, "").match(FORMAT_RECORDS)).toBeNull(); expect(fmts(s.state)).toEqual([]); });
  it("restores the run formatting (bold removed; bold back, italic removed)", () => {
    expect(xml).not.toMatch(/<w:rPr><w:b\/><\/w:rPr><w:t[^>]*>Bold applied/);
    expect(xml).toMatch(/<w:r><w:t[^>]*>Bold applied/);
    expect(xml).toMatch(/<w:rPr><w:b\/><\/w:rPr><w:t[^>]*>was bold, now italic/);
    expect(xml).not.toMatch(/<w:i\/>/);
  });
  it("restores the paragraph style, alignment and indent", () => {
    expect(s.state.doc.child(0)).toMatchObject({ type: { name: "heading" }, attrs: { level: 1 } });
    expect(xml).toMatch(/<w:pStyle w:val="Heading1"\/>/);
    expect(s.state.doc.child(1).attrs.textAlign).toBe("left");
    expect(s.state.doc.child(1).attrs.pprx).toBe('<w:ind w:left="0"/>');
  });
  it("restores the table, its column grid, row and cell", () => {
    expect(xml).toMatch(/<w:tblW w:w="5000" w:type="dxa"\/>/);
    expect(xml).toMatch(/<w:gridCol w:w="2000"\/><w:gridCol w:w="4000"\/><\/w:tblGrid>/);
    expect(xml).not.toMatch(/<w:cantSplit/);
    expect(xml).not.toMatch(/w:fill="FFFF00"/);
  });
  it("restores the paragraph mark and the section", () => {
    expect(xml).not.toMatch(/<w:pPr><w:rPr><w:b\/>/);
    expect(resolveSect(s0.meta.sectPr, false)).toMatch(/w:w="11906"/);
    expect(resolveSect(s0.meta.sectPr, false)).not.toMatch(/pgMar/);
  });
});

describe("adjacent cases", () => {
  it("a .docx with no tracked changes has none and writes none", () => {
    const f = open(buildFixtureDocx());
    expect(fmts(f.state)).toEqual([]);
    expect(save(f).match(FORMAT_RECORDS)).toBeNull();
    expect(f.meta.warnings).toEqual([]);
  });
  it("a .docx where every change was already accepted in Word reads as plain formatted text", () => {
    const accepted = buildFormatChangeDocx(
      '<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Scope</w:t></w:r></w:p><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold</w:t></w:r></w:p>',
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>');
    const f = open(accepted);
    expect(fmts(f.state)).toEqual([]);
    expect(sectChanges(f.meta.sectPr)).toEqual([]);
    expect(save(f)).toMatch(/<w:rPr><w:b\/><\/w:rPr><w:t[^>]*>Bold/);
  });
  it("a formatting change inside a tracked insertion keeps both", () => {
    const f = open(buildFormatChangeDocx('<w:p><w:ins w:id="40" w:author="Gus" w:date="2026-09-07T08:00:00Z"><w:r><w:rPr><w:u w:val="single"/><w:rPrChange w:id="41" w:author="Gus" w:date="2026-09-07T08:00:00Z"><w:rPr/></w:rPrChange></w:rPr><w:t>new and underlined</w:t></w:r></w:ins></w:p>', '<w:sectPr/>'));
    expect(listChanges(f.state.doc).map((c) => c.kind).sort()).toEqual(["fmt", "ins"]);
    const xml = save(f);
    expect(xml).toMatch(/<w:ins [^>]*w:author="Gus"[^>]*><w:r><w:rPr><w:u w:val="single"\/><w:rPrChange /);
  });
  it("rejecting a list-membership change restores the rest and says what it left alone", () => {
    const f = open(buildFormatChangeDocx('<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:pPrChange w:id="50" w:author="Hal" w:date="2026-09-08T08:00:00Z"><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr></w:pPrChange></w:pPr><w:r><w:t>Was a bullet</w:t></w:r></w:p>', '<w:sectPr/>'));
    const [c] = fmts(f.state);
    expect(c.label).toBe("Formatted: paragraph style, bullets / numbering");
    const tr = rejectChange(f.state, c.key);
    expect(tr.getMeta("fmtPartial")).toBe("bullets / numbering");
  });
});
