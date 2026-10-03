import { describe, it, expect } from "vitest";
import { getSchema } from "@tiptap/core";
import { Node } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { loadModel, buildSave } from "../src/workspaces/doc-review/docEditor/docModel.js";
import { docKindOf, asDocxName } from "../src/workspaces/doc-review/docEditor/docKind.js";
import { docExtensions } from "../src/workspaces/doc-review/docEditor/docExtensions.js";
import { readDocx } from "../src/shared/files/docx/docxRead.js";
import { writeDocx, blankPackage } from "../src/shared/files/docx/docxWrite.js";

const file = (name, bytes) => ({ name, kind: docKindOf(name), blob: new Blob([bytes]) });
const enc = (s) => new TextEncoder().encode(s);
const edit = (schema, model, fn) => { let st = EditorState.create({ schema, doc: Node.fromJSON(schema, model.doc) }); st = st.apply(fn(st)); return st.doc.toJSON(); };

describe(".txt — open, edit, save, re-read: byte-faithful", () => {
  const schema = getSchema(docExtensions({ plain: true }));
  it("round-trips untouched text byte for byte (LF, CRLF, no trailing newline, blank lines, tabs)", async () => {
    for (const src of ["one\ntwo\n", "one\r\ntwo\r\n", "one\ntwo", "a\n\n\nb\n", "  indented\t tab\n", "", "\n", "ünïcödé ☃\n"]) {
      const f = file("a.txt", enc(src)); const m = await loadModel(f);
      const out = buildSave({ model: m, file: f, json: m.doc });
      expect(Buffer.from(out.bytes).toString("utf8"), JSON.stringify(src)).toBe(src);
      expect(out.mode).toBe("replace"); expect(out.name).toBe("a.txt");
    }
  });
  it("keeps a UTF-8 BOM and UTF-16 encoding", async () => {
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF, ...enc("hi\n")]);
    const m = await loadModel(file("a.txt", bom));
    expect([...buildSave({ model: m, file: file("a.txt", bom), json: m.doc }).bytes]).toEqual([...bom]);
    const u16 = new Uint8Array([0xFF, 0xFE, 0x68, 0, 0x69, 0]);
    const m2 = await loadModel(file("b.txt", u16));
    expect([...buildSave({ model: m2, file: file("b.txt", u16), json: m2.doc }).bytes]).toEqual([...u16]);
  });
  it("an edit changes exactly the edited bytes", async () => {
    const f = file("n.txt", enc("alpha\r\nbeta\r\n")); const m = await loadModel(f);
    const json = edit(schema, m, (st) => st.tr.insertText("X", 9)); // inside "beta" (after "b")
    expect(Buffer.from(buildSave({ model: m, file: f, json }).bytes).toString("utf8")).toBe("alpha\r\nbXeta\r\n");
  });
  it("an empty .txt opens as one empty line and saves back to zero bytes", async () => {
    const f = file("e.txt", new Uint8Array(0)); const m = await loadModel(f);
    expect(m.doc.content).toHaveLength(1);
    expect(buildSave({ model: m, file: f, json: m.doc }).bytes.length).toBe(0);
  });
  it("find & replace through the same transactions is undoable text replacement", async () => {
    const f = file("f.txt", enc("cat dog cat\n")); const m = await loadModel(f);
    const json = edit(schema, m, (st) => { const tr = st.tr; tr.insertText("bird", 9, 12); tr.insertText("bird", 1, 4); return tr; });
    expect(Buffer.from(buildSave({ model: m, file: f, json }).bytes).toString("utf8")).toBe("bird dog bird\n");
  });
  it("Save as Word document converts a COPY (new .docx, .txt unchanged)", async () => {
    const f = file("notes.txt", enc("first\nsecond\n")); const m = await loadModel(f);
    const out = buildSave({ model: m, file: f, json: m.doc, asNew: true });
    expect(out.mode).toBe("new"); expect(out.name).toBe("notes.docx");
    expect(readDocx(out.bytes).doc.content.map((p) => p.content[0].text)).toEqual(["first", "second"]);
  });
});

describe(".doc (Word 97–2003) — opens, and saves as a NEW .docx with the original kept", () => {
  const bytes = readFileSync(fileURLToPath(new URL("./fixtures/deeds/deed-poa-parcel3.doc", import.meta.url)));
  it("opens as an editable document flagged for conversion", async () => {
    const m = await loadModel(file("deed.doc", new Uint8Array(bytes)));
    expect(m.converted).toBe(true);
    expect(JSON.stringify(m.doc)).toMatch(/THENCE/i);
  });
  it("saves to a new .docx file (mode 'new'), never over the original", async () => {
    const f = file("deed.doc", new Uint8Array(bytes)); const m = await loadModel(f);
    const out = buildSave({ model: m, file: f, json: m.doc });
    expect(out.mode).toBe("new"); expect(out.name).toBe("deed.docx"); expect(out.note).toMatch(/original \.doc is kept/);
    expect(JSON.stringify(readDocx(out.bytes).doc)).toMatch(/THENCE/i);
  });
});

describe("empty and damaged inputs", () => {
  it("an empty (no-body) .docx opens as one empty paragraph and saves", async () => {
    const bytes = writeDocx({ doc: { type: "doc", content: [] }, comments: [], meta: {}, files: blankPackage() });
    const m = await loadModel(file("empty.docx", bytes));
    expect(m.doc.content).toHaveLength(1); expect(m.doc.content[0].type).toBe("paragraph");
    expect(buildSave({ model: m, file: file("empty.docx", bytes), json: m.doc }).mode).toBe("replace");
  });
  it("a corrupt .docx fails with a plain message, not a crash", async () => {
    await expect(loadModel(file("bad.docx", enc("not a zip at all")))).rejects.toThrow(/valid \.docx/);
  });
  it("kinds + names", () => {
    expect(docKindOf("A.DOCX")).toBe("docx"); expect(docKindOf("a.doc")).toBe("doc"); expect(docKindOf("a.txt")).toBe("txt"); expect(docKindOf("a.pdf")).toBeNull();
    expect(asDocxName("x.doc")).toBe("x.docx");
  });
});

describe("no download ever fires from the document editor", () => {
  const dir = fileURLToPath(new URL("../src/workspaces/doc-review/docEditor/", import.meta.url));
  const files = readdirSync(dir).filter((f) => statSync(join(dir, f)).isFile());
  it("none of the editor's files create a download (anchor/download/createObjectURL/saveAs)", () => {
    for (const f of files) {
      const src = readFileSync(join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(src, f).not.toMatch(/createObjectURL|\.download\s*=|saveAs\(|createElement\(["']a["']\)|showSaveFilePicker/);
    }
  });
});
