import { describe, it, expect } from "vitest";
import { getSchema } from "@tiptap/core";
import { Node } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { unzipSync, strFromU8 } from "fflate";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildFixtureDocx } from "./fixtures/docxFixture.js";
import { readDocx } from "../src/shared/files/docx/docxRead.js";
import { writeDocx, blankPackage } from "../src/shared/files/docx/docxWrite.js";
import { docExtensions } from "../src/workspaces/doc-review/docEditor/docExtensions.js";
import { fixupTracked, listChanges, acceptChange, rejectChange, acceptAll, rejectAll } from "../src/workspaces/doc-review/docEditor/trackChanges.js";

const schema = getSchema(docExtensions());
const open = (bytes) => { const r = readDocx(bytes); return { ...r, state: EditorState.create({ schema, doc: Node.fromJSON(schema, r.doc) }) }; };
const save = (s) => writeDocx({ doc: s.state.doc.toJSON(), comments: s.comments, meta: s.meta, files: s.files });
const parts = (bytes) => Object.fromEntries(Object.entries(unzipSync(bytes)).map(([k, v]) => [k, /\.(png|jpe?g)$/.test(k) ? v : strFromU8(v)]));
const textPos = (doc, needle) => { let at = -1; doc.descendants((n, pos) => { if (at < 0 && n.isText) { const i = n.text.indexOf(needle); if (i >= 0) at = pos + i; } }); return at; };
const typeAt = (state, pos, text, track, author = "Tester") => { const tr = state.tr.insertText(text, pos); if (track) fixupTracked(tr, state, { author }); return state.apply(tr); };
const deleteRange = (state, from, to, track, author = "Tester") => { const tr = state.tr.delete(from, to); if (track) fixupTracked(tr, state, { author }); return state.apply(tr); };

describe("open: a .docx with a heading, table, image, tracked insert/delete and a comment", () => {
  const s = open(buildFixtureDocx());
  const json = JSON.stringify(s.doc);
  it("shows the heading, the table, the image", () => {
    expect(s.doc.content[0]).toMatchObject({ type: "heading", attrs: { level: 1 } });
    expect(s.doc.content.some((n) => n.type === "table")).toBe(true);
    expect(json).toMatch(/"type":"docImage"/);
    expect(json).toMatch(/data:image\/png;base64,/);
    expect(json).toMatch(/bulletList/);
  });
  it("shows one tracked insertion and one tracked deletion with author and time", () => {
    const ch = listChanges(s.state.doc);
    expect(ch.map((c) => [c.kind, c.author, c.date, c.text])).toEqual([
      ["ins", "Alice Reviewer", "2026-09-01T10:00:00Z", "approximately "],
      ["del", "Bob Editor", "2026-09-02T11:30:00Z", "roughly "],
    ]);
  });
  it("shows the comment anchored on its text, with author and time", () => {
    expect(s.comments).toHaveLength(1);
    expect(s.comments[0]).toMatchObject({ author: "Carol Owner", date: "2026-09-03T09:00:00Z", text: "Confirm the final square footage.", resolved: false });
    expect(json).toMatch(/"text":"building","marks":\[\{"type":"comment","attrs":\{"id":"c0"\}\}\]/);
  });
});

describe("edit → comment → accept one change → save → re-parse the saved .docx", () => {
  const s = open(buildFixtureDocx());
  let st = s.state;
  st = typeAt(st, textPos(st.doc, "200,000") , "about ", false);                       // a plain edit
  const bp = textPos(st.doc, "building");
  st = st.apply(st.tr.addMark(bp, bp + 8, schema.marks.comment.create({ id: "c-new" }))); // a new comment on "building"
  const comments = [...s.comments, { id: "c-new", author: "Dana Test", initials: "DT", date: "2026-10-01T12:00:00Z", text: "New remark from here.", parentId: null, resolved: false }];
  const ins = listChanges(st.doc).find((c) => c.kind === "ins");
  st = st.apply(acceptChange(st, ins.key));                                             // accept Alice's insertion
  const out = parts(writeDocx({ doc: st.doc.toJSON(), comments, meta: s.meta, files: s.files }));
  const docXml = out["word/document.xml"];
  it("is a real .docx package with its original parts intact", () => {
    expect(Object.keys(out)).toEqual(expect.arrayContaining(["[Content_Types].xml", "word/styles.xml", "word/numbering.xml", "word/media/image1.png"]));
    expect(out["word/styles.xml"]).toBe(parts(buildFixtureDocx())["word/styles.xml"]);
  });
  it("keeps the edit", () => { expect(docXml).toContain("about 200,000 SF."); });
  it("writes the accepted change as plain text — no w:ins left for it", () => {
    expect(docXml).not.toMatch(/<w:ins\b/);
    expect(docXml).toMatch(/approximately /);
  });
  it("still has the untouched tracked deletion, in Word's own format, with author and date", () => {
    expect(docXml).toMatch(/<w:del w:id="\d+" w:author="Bob Editor" w:date="2026-09-02T11:30:00Z"><w:r><w:delText xml:space="preserve">roughly <\/w:delText><\/w:r><\/w:del>/);
  });
  it("writes both comments to comments.xml, with ranges + references in the body", () => {
    expect(out["word/comments.xml"]).toMatch(/w:author="Carol Owner"/);
    expect(out["word/comments.xml"]).toMatch(/Confirm the final square footage\./);
    expect(out["word/comments.xml"]).toMatch(/w:author="Dana Test"/);
    expect(out["word/comments.xml"]).toMatch(/New remark from here\./);
    expect((docXml.match(/<w:commentRangeStart/g) || []).length).toBe(2);
    expect((docXml.match(/<w:commentReference/g) || []).length).toBe(2);
    expect(out["[Content_Types].xml"]).toMatch(/comments\.xml/);
  });
  it("re-opens with the saved state (edit, both comments, the remaining change)", () => {
    const again = readDocx(writeDocx({ doc: st.doc.toJSON(), comments, meta: s.meta, files: s.files }));
    expect(again.comments.map((c) => c.text)).toEqual(["Confirm the final square footage.", "New remark from here."]);
    const stAgain = EditorState.create({ schema, doc: Node.fromJSON(schema, again.doc) });
    expect(listChanges(stAgain.doc).map((c) => [c.kind, c.author])).toEqual([["del", "Bob Editor"]]);
    expect(stAgain.doc.textContent).toContain("about 200,000");
  });
  it("keeps the table, image, list and heading", () => {
    expect(docXml).toMatch(/<w:tbl>/); expect(docXml).toMatch(/<w:drawing>/); expect(docXml).toMatch(/<w:numId w:val="1"\/>/); expect(docXml).toMatch(/<w:pStyle w:val="Heading1"\/>/);
  });
});

describe("Track Changes ON", () => {
  const base = open(buildFixtureDocx());
  it("typing is written as a w:ins by the current author", () => {
    const st = typeAt(base.state, textPos(base.state.doc, "200,000"), "about ", true, "Tester One");
    const xml = parts(writeDocx({ doc: st.doc.toJSON(), comments: base.comments, meta: base.meta, files: base.files }))["word/document.xml"];
    expect(xml).toMatch(/<w:ins w:id="\d+" w:author="Tester One" w:date="[^"]+"><w:r><w:t xml:space="preserve">about <\/w:t><\/w:r><\/w:ins>/);
  });
  it("deleting existing text keeps it, struck through, as a w:del with w:delText", () => {
    const p = textPos(base.state.doc, "200,000");
    const st = deleteRange(base.state, p, p + 7, true, "Tester One");
    expect(st.doc.textContent).toContain("200,000 SF.");
    const xml = parts(writeDocx({ doc: st.doc.toJSON(), comments: base.comments, meta: base.meta, files: base.files }))["word/document.xml"];
    expect(xml).toMatch(/<w:del w:id="\d+" w:author="Tester One"[^>]*><w:r><w:delText xml:space="preserve">200,000<\/w:delText>/);
  });
  it("typing then deleting your own insertion leaves no trace", () => {
    let st = typeAt(base.state, textPos(base.state.doc, "200,000"), "ZZ", true, "Tester One");
    const p = textPos(st.doc, "ZZ");
    st = deleteRange(st, p, p + 2, true, "Tester One");
    expect(st.doc.textContent).not.toContain("ZZ");
    expect(listChanges(st.doc).filter((c) => c.author === "Tester One")).toEqual([]);
  });
  it("replacing a selection = deletion + insertion", () => {
    const p = textPos(base.state.doc, "200,000");
    const tr = base.state.tr.insertText("300,000", p, p + 7); fixupTracked(tr, base.state, { author: "Tester One" });
    const st = base.state.apply(tr);
    const mine = listChanges(st.doc).filter((c) => c.author === "Tester One");
    expect(mine.map((c) => [c.kind, c.text])).toEqual(expect.arrayContaining([["ins", "300,000"], ["del", "200,000"]]));
  });
  it("Backspace leaves the caret before the struck text", () => {
    const p = textPos(base.state.doc, "200,000") + 3;
    let st = base.state.apply(base.state.tr.setSelection(TextSelection.create(base.state.doc, p)));
    const tr = st.tr.delete(p - 1, p); fixupTracked(tr, st, { author: "T" }); st = st.apply(tr);
    expect(st.selection.from).toBe(p - 1);
  });
  it("accept all / reject all", () => {
    const rejected = base.state.apply(rejectAll(base.state));
    expect(rejected.doc.textContent).toContain("roughly 200,000"); expect(rejected.doc.textContent).not.toContain("approximately");
    const accepted = base.state.apply(acceptAll(base.state));
    expect(accepted.doc.textContent).toContain("approximately 200,000"); expect(accepted.doc.textContent).not.toContain("roughly");
    expect(listChanges(accepted.doc)).toEqual([]);
  });
  it("reject one change", () => {
    const del = listChanges(base.state.doc).find((c) => c.kind === "del");
    const st = base.state.apply(rejectChange(base.state, del.key));
    expect(listChanges(st.doc).map((c) => c.kind)).toEqual(["ins"]);
    expect(st.doc.textContent).toContain("roughly");
  });
  it("Enter marks the paragraph break as inserted; Backspace over your own Enter is a clean join", () => {
    const p = textPos(base.state.doc, "200,000");
    const tr = base.state.tr.split(p); fixupTracked(tr, base.state, { author: "T" });
    let st = base.state.apply(tr);
    expect(st.doc.nodeAt(st.doc.resolve(p).before()).attrs.pMark).toMatchObject({ type: "ins", author: "T" });
    const tr2 = st.tr.join(p + 1); fixupTracked(tr2, st, { author: "T" });
    st = st.apply(tr2);
    expect(st.doc.nodeAt(st.doc.resolve(p).before()).attrs.pMark).toBeNull();
    expect(st.doc.textContent).toBe(base.state.doc.textContent);
    expect(st.doc.childCount).toBe(base.state.doc.childCount);
  });
});

describe("a real-world survey .docx survives open → save → open", () => {
  const bytes = readFileSync(fileURLToPath(new URL("./fixtures/deeds/deed-94_91.docx", import.meta.url)));
  it("keeps the course text", () => {
    const a = open(new Uint8Array(bytes));
    const again = readDocx(save(a));
    const st2 = EditorState.create({ schema, doc: Node.fromJSON(schema, again.doc) });
    expect(st2.doc.textContent).toBe(a.state.doc.textContent);
    expect(a.doc.content.length).toBeGreaterThan(5);
  });
});

describe("blank package", () => {
  it("builds a valid docx from a plain-text conversion", () => {
    const files = blankPackage();
    const bytes = writeDocx({ doc: { type: "doc", content: [{ type: "paragraph", attrs: { pStyle: null, textAlign: "left", pprx: "", pMark: null }, content: [{ type: "text", text: "hello" }] }] }, comments: [], meta: {}, files });
    expect(readDocx(bytes).doc.content[0].content[0].text).toBe("hello");
  });
});
