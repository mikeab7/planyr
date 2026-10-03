import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { unzipSync, strFromU8 } from "fflate";
import { readDocStructure, describeDocImport } from "../src/shared/files/docStructure.js";
import { loadModel, buildSave } from "../src/workspaces/doc-review/docEditor/docModel.js";
import { readDocx } from "../src/shared/files/docx/docxRead.js";

/* NEW-2 (B2022929 amend): a legacy .doc brings its formatting, not just its text. The fixtures are real binary
 * .doc files (LibreOffice's Word 97 export, built from the HTML in test/fixtures/doc/README.md) plus the
 * Word-authored deed .doc already in the repo. */
const fx = (name) => { const b = readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const flat = (n, out = []) => { out.push(n); (n.content || []).forEach((c) => flat(c, out)); return out; };
const textOf = (n) => flat(n).filter((x) => x.type === "text").map((x) => x.text).join("");
const marked = (doc, type) => flat(doc).filter((n) => n.type === "text" && (n.marks || []).some((m) => m.type === type)).map((n) => n.text);
const file = (name, bytes) => ({ name, kind: "doc", blob: { arrayBuffer: async () => bytes } });

describe("a .doc with a heading, a bold run, a bulleted list and a table", () => {
  const { doc, report } = readDocStructure(fx("doc/formatted.doc"));
  it("keeps the heading", () => { expect(doc.content[0]).toMatchObject({ type: "heading", attrs: { level: 1 } }); expect(textOf(doc.content[0])).toBe("Project Scope"); });
  it("keeps the bold run — and italic and underline — on exactly their words", () => {
    expect(marked(doc, "bold")).toEqual(["building"]);
    expect(marked(doc, "italic")).toEqual(["approximately"]);
    expect(marked(doc, "underline")).toEqual(["200,000"]);
  });
  it("keeps the bulleted list", () => {
    const list = doc.content.find((n) => n.type === "bulletList");
    expect(list.content.map(textOf)).toEqual(["Dock doors", "Trailer stalls"]);
  });
  it("keeps the table: two rows, two columns, every cell's text", () => {
    const t = doc.content.find((n) => n.type === "table");
    expect(t.content.map((r) => r.content.map(textOf))).toEqual([["Item", "Value"], ["Clear height", "36 ft"]]);
    expect(t.attrs.gridCols.length).toBe(2);
  });
  it("keeps Unicode in the running text", () => { expect(textOf(doc.content[1])).toContain("café “naïve” Ωmega 北京"); });
  it("reports what it carried and what it did not", () => {
    expect(report).toMatchObject({ pictures: 0, tables: 1, lists: 1 });
    expect(describeDocImport(report)).toMatch(/headings, bold \/ italic \/ underline, lists, tables and JPEG \/ PNG pictures come across/);
  });
});

describe("opening through the editor's own loader, then saving as a new .docx", () => {
  it("loadModel returns the formatted document (this is the red-proof: main returned plain paragraphs)", async () => {
    const m = await loadModel(file("scope.doc", fx("doc/formatted.doc")));
    expect(m.converted).toBe(true);
    expect(m.doc.content[0].type).toBe("heading");
    expect(m.docNote).toMatch(/lists, tables and JPEG \/ PNG pictures come across/);
  });
  it("the saved .docx re-parses with the heading, bold, list and table intact", async () => {
    const f = file("scope.doc", fx("doc/formatted.doc"));
    const m = await loadModel(f);
    const out = buildSave({ model: m, file: f, json: m.doc });
    expect(out.mode).toBe("new"); expect(out.name).toBe("scope.docx");
    const parts = Object.fromEntries(Object.entries(unzipSync(out.bytes)).map(([k, v]) => [k, strFromU8(v)]));
    const xml = parts["word/document.xml"];
    expect(xml).toMatch(/<w:pStyle w:val="Heading1"\/>/);
    expect(xml).toMatch(/<w:rPr><w:b\/><\/w:rPr><w:t[^>]*>building/);
    expect(xml).toMatch(/<w:numPr>/);
    expect(xml).toMatch(/<w:tbl>/);
    const back = readDocx(out.bytes).doc;
    expect(back.content[0]).toMatchObject({ type: "heading", attrs: { level: 1 } });
    expect(marked(back, "bold")).toEqual(["building"]);
    expect(back.content.some((n) => n.type === "bulletList")).toBe(true);
    expect(back.content.find((n) => n.type === "table").content.map((r) => r.content.map(textOf))).toEqual([["Item", "Value"], ["Clear height", "36 ft"]]);
  });
});

describe("adjacent cases", () => {
  it(".doc with no formatting: plain paragraphs, no marks, no lists", () => {
    const { doc } = readDocStructure(fx("doc/plain.doc"));
    expect(doc.content.map((n) => [n.type, textOf(n)])).toEqual([["paragraph", "Just some text."], ["paragraph", "A second line, no formatting at all."]]);
    expect(flat(doc).some((n) => (n.marks || []).length)).toBe(false);
  });
  it(".doc with Unicode text (incl. an emoji outside the BMP) is exact", () => {
    const { doc } = readDocStructure(fx("doc/unicode.doc"));
    expect(textOf(doc)).toBe("Ünïcödé — 北京 — Ωmega — emoji 😀 — «guillemets» — ‘single’ “double” — ½ ± €");
  });
  it("a real Word-authored .doc: alignment, bold, size, font and numbered lists come across, and the text is the deed's", () => {
    const { doc } = readDocStructure(fx("deeds/deed-poa-parcel3.doc"));
    expect(doc.content.some((n) => n.attrs && n.attrs.textAlign === "center")).toBe(true);
    expect(marked(doc, "bold").some((t) => /DESCRIPTION OF/.test(t))).toBe(true);
    expect(flat(doc).some((n) => n.type === "text" && (n.marks || []).some((m) => m.type === "textStyle" && m.attrs.fontSize === "14pt"))).toBe(true);
    expect(doc.content.some((n) => n.type === "orderedList")).toBe(true);
    expect(textOf(doc)).toContain("CLERK’S");
  });
  it("horizontal and vertical merged cells keep their spans", () => {
    const t = readDocStructure(fx("doc/merged.doc")).doc.content[0];
    expect(t.type).toBe("table");
    expect(t.content[0].content[0].attrs.colspan).toBe(2);
    expect(t.content[1].content[0].attrs.rowspan).toBe(2);
    expect(t.content.map((r) => r.content.map(textOf))).toEqual([["Wide header", "C"], ["Tall", "b2", "c2"], ["b3", "c3"]]);
  });
  it("nested lists, centring, super/subscript, strike, colour and a hyperlink", () => {
    const { doc } = readDocStructure(fx("doc/nested.doc"));
    const outer = doc.content[0];
    expect(outer.type).toBe("orderedList");
    expect(outer.content[0].content[1].type).toBe("orderedList");
    expect(outer.content[0].content[1].content.map(textOf)).toEqual(["Nested a", "Nested b"]);
    expect(doc.content[1].attrs.textAlign).toBe("center");
    expect(marked(doc, "superscript")).toEqual(["sup"]); expect(marked(doc, "subscript")).toEqual(["sub"]); expect(marked(doc, "strike")).toEqual(["struck"]);
    const link = flat(doc).find((n) => n.type === "text" && (n.marks || []).some((m) => m.type === "link"));
    expect(link.text).toBe("link"); expect(link.marks.find((m) => m.type === "link").attrs.href).toBe("https://example.com/x");
    expect(flat(doc).some((n) => (n.marks || []).some((m) => m.type === "textStyle" && m.attrs.color === "#FF0000"))).toBe(true);
  });
  it("a JPEG/PNG picture comes across as a real image, and Save writes it into the .docx's media", async () => {
    const { doc, report, media } = readDocStructure(fx("doc/picture.doc"));
    expect(report).toMatchObject({ pictures: 1, picturesLost: 0 });
    const img = flat(doc).find((n) => n.type === "docImage");
    expect(img.attrs.src).toMatch(/^data:image\/png;base64,iVBORw0KGgo/); expect(img.attrs.width).toBe(40); expect(img.attrs.height).toBe(40);
    expect(media).toHaveLength(1);
    const f = file("pic.doc", fx("doc/picture.doc")); const m = await loadModel(f);
    const parts = unzipSync(buildSave({ model: m, file: f, json: m.doc }).bytes);
    expect(Array.from(parts["word/media/image1.png"].slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(strFromU8(parts["[Content_Types].xml"])).toContain('Extension="png"');
    expect(strFromU8(parts["word/_rels/document.xml.rels"])).toContain('Target="media/image1.png"');
    expect(strFromU8(parts["word/document.xml"])).toContain('r:embed="rIdPic1"');
    expect(flat(readDocx(buildSave({ model: m, file: f, json: m.doc }).bytes).doc).some((n) => n.type === "docImage")).toBe(true);
  });
  it("a picture in a format a browser cannot draw is not silently dropped: a visible placeholder holds its place, and the note counts it", async () => {
    const bytes = new Uint8Array(fx("doc/picture.doc"));
    // Turn the PNG blip header (instance 0x6E0, type 0xF01E) into an EMF one (instance 0x3D4, type 0xF01A): same file, a picture kind we do not carry.
    let hits = 0;
    for (let i = 0; i + 4 <= bytes.length; i++) if (bytes[i] === 0x00 && bytes[i + 1] === 0x6e && bytes[i + 2] === 0x1e && bytes[i + 3] === 0xf0) { bytes.set([0x40, 0x3d, 0x1a, 0xf0], i); hits++; }
    expect(hits).toBe(1);
    const { doc, report } = readDocStructure(bytes.buffer);
    expect(report).toMatchObject({ pictures: 0, picturesLost: 1 });
    expect(flat(doc).filter((n) => n.type === "docRaw").map((n) => n.attrs.label)).toEqual(["picture not carried over"]);
    expect(describeDocImport(report)).toMatch(/1 picture in a format a browser cannot draw \(marked in the text\)/);
    const f = file("emf.doc", bytes.buffer); const m = await loadModel(f);
    expect(strFromU8(unzipSync(buildSave({ model: m, file: f, json: m.doc }).bytes)["word/document.xml"])).toContain("[EMF picture not carried over from the .doc]");
  });
  it("still rejects a non-.doc loudly", () => { expect(() => readDocStructure(new Uint8Array(600).buffer)).toThrow(/Word \.doc/i); });
});

describe("if the formatting cannot be read, the text still opens and the editor says so", () => {
  it("falls back to the text-only reader with a visible warning", async () => {
    vi.resetModules();
    vi.doMock("../src/shared/files/docStructure.js", () => ({ readDocStructure: () => { throw new Error("unexpected sprm"); }, describeDocImport: () => "" }));
    const { loadModel: load } = await import("../src/workspaces/doc-review/docEditor/docModel.js");
    const m = await load(file("scope.doc", fx("doc/formatted.doc")));
    vi.doUnmock("../src/shared/files/docStructure.js");
    expect(JSON.stringify(m.doc)).toMatch(/Project Scope/);
    expect(m.doc.content[0].type).toBe("paragraph"); // text only
    expect(m.meta.warnings[0]).toMatch(/formatting could not be read.*unexpected sprm.*only its text came across/);
    expect(m.converted).toBe(true);
  });
});
