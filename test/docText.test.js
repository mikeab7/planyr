import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { docToText, cleanWordText } from "../src/shared/files/docText.js";
import { parseTracts } from "../src/workspaces/site-planner/lib/metesAndBounds.js";

// Read a fixture file off disk into a clean ArrayBuffer (same helper the docx tests use).
const ab = (rel) => {
  const b = readFileSync(fileURLToPath(new URL(rel, import.meta.url)));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
// Word control marks, built without embedding raw control bytes in the source.
const C = (n) => String.fromCharCode(n);
const PARA = C(13), LINE = C(11), CELL = C(7), NBSP = C(160), NBHY = C(30);
const FBEGIN = C(19), FSEP = C(20), FEND = C(21); // field begin / separator / end

describe("docToText - legacy .doc (OLE/CFB, Word 97-2003)", () => {
  it("reads a real Word .doc survey description into its course text", async () => {
    const t = await docToText(ab("./fixtures/deeds/deed-poa-parcel3.doc"));
    expect(t.length).toBeGreaterThan(1500);
    // paragraph structure is preserved (the parser segments courses by line)
    expect((t.match(/THENCE/gi) || []).length).toBeGreaterThanOrEqual(2);
    expect(t).toMatch(/NORTH 02 DEG\. 29 MIN\. 38 SEC\. WEST/i);
    // CP1252 0x92 smart apostrophe -> U+2019: the high-byte mapping a naive
    // String.fromCharCode decode breaks. Proves TextDecoder("windows-1252") is used.
    expect(t).toContain("CLERK’S");
  });

  it("parses the extracted .doc text into the correct bearings", async () => {
    const t = await docToText(ab("./fixtures/deeds/deed-poa-parcel3.doc"));
    const tracts = parseTracts(t);
    expect(tracts).toHaveLength(1);
    const calls = tracts[0].calls;
    expect(calls).toHaveLength(5);
    // first leg N 02.29.38 W -> az ~357.51 (WEST, not East - the DEG/MIN/SEC parser fix)
    expect(calls[0].az).toBeCloseTo(357.506, 1);
    expect(calls[0].distFt).toBeCloseTo(531.21, 2);
    // a West leg later in the deed stays West (S 23.57.24 W -> ~203.96)
    expect(calls[3].az).toBeCloseTo(203.957, 1);
  });

  it("rejects a non-OLE file loudly", async () => {
    await expect(docToText(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer)).rejects.toThrow(/Word \.doc/i);
  });

  it("rejects a too-small buffer loudly", async () => {
    await expect(docToText(new Uint8Array(8).buffer)).rejects.toThrow();
  });
});

describe("cleanWordText - Word control chars", () => {
  it("turns paragraph / line / cell marks into newlines", () => {
    expect(cleanWordText("A" + PARA + "B" + LINE + "C" + CELL + "D")).toBe("A\nB\nC\nD");
  });
  it("hides a field instruction but keeps its result", () => {
    expect(cleanWordText("A" + FBEGIN + "instr" + FSEP + "B" + FEND + "C")).toBe("ABC");
  });
  it("drops a result-less field entirely", () => {
    expect(cleanWordText("A" + FBEGIN + "instr" + FEND + "B")).toBe("AB");
  });
  it("maps non-breaking space to space and non-breaking hyphen to a dash", () => {
    expect(cleanWordText("A" + NBSP + "B" + NBHY + "C")).toBe("A B-C");
  });
});
