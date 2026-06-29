import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { documentXmlToText, docxToText } from "../src/shared/files/docxText.js";

const ab = (rel) => {
  const b = readFileSync(fileURLToPath(new URL(rel, import.meta.url)));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};

describe("documentXmlToText — WordprocessingML → text", () => {
  it("makes each <w:p> a line and decodes entities", () => {
    const xml = `<w:p><w:r><w:t>THENCE North 45</w:t></w:r><w:r><w:t> &amp; East</w:t></w:r></w:p><w:p><w:r><w:t>line two</w:t></w:r></w:p>`;
    const t = documentXmlToText(xml);
    expect(t).toMatch(/THENCE North 45 & East/);
    expect(t.split("\n")).toContain("line two");
  });
  it("turns <w:br/> into a newline and reads numeric entities (°)", () => {
    expect(documentXmlToText(`<w:p><w:t>a&#176;b</w:t><w:br/><w:t>c</w:t></w:p>`)).toBe("a°b\nc");
  });
  it("is empty for empty input", () => {
    expect(documentXmlToText("")).toBe("");
    expect(documentXmlToText(null)).toBe("");
  });
});

describe("docxToText — real .docx via native ZIP + inflate", () => {
  it("reads a real survey .docx into its course text", async () => {
    const t = await docxToText(ab("./fixtures/deeds/deed-94_91.docx"));
    expect(t.length).toBeGreaterThan(3000);
    expect((t.match(/THENCE/gi) || []).length).toBe(8);
    expect(t).toMatch(/POINT OF BEGINNING/);
    expect(t).toMatch(/North 87°04'16" East/);
  });
  it("rejects a non-zip buffer with a friendly error", async () => {
    await expect(docxToText(new Uint8Array([1, 2, 3, 4]).buffer)).rejects.toThrow(/docx/i);
  });
});
