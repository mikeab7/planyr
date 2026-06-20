import { describe, it, expect } from "vitest";
import { jpegToPdf } from "../src/workspaces/site-planner/lib/imagePdf.js";

// Latin1 view of the PDF bytes — every byte maps 1:1 to a char code, so structural
// (ASCII) assertions and byte-offset checks both work on the same string.
const latin1 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return s; };
// A stand-in "JPEG": real SOI/EOI markers wrapping bytes that include 0x00 and 0xFF so
// the test proves binary survives (no UTF-16 corruption). Structure, not decodability,
// is what jpegToPdf cares about.
const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);

describe("jpegToPdf — wrap a raster into a one-page PDF (NEW-1)", () => {
  const pdf = jpegToPdf({ jpeg: fakeJpeg, pixelW: 3300, pixelH: 2550, widthIn: 11, heightIn: 8.5, title: "2026.06.20 Mesa - Plan 1" });
  const s = latin1(pdf);

  it("is a well-formed PDF envelope", () => {
    expect(s.startsWith("%PDF-1.4")).toBe(true);
    expect(s.trimEnd().endsWith("%%EOF")).toBe(true);
  });

  it("declares the page size in points (inches x 72) — Letter landscape = 792 x 612", () => {
    expect(s).toContain("/MediaBox [0 0 792 612]");
  });

  it("embeds the image as DeviceRGB / DCTDecode at the given pixel size", () => {
    expect(s).toContain("/Subtype /Image");
    expect(s).toContain("/Width 3300");
    expect(s).toContain("/Height 2550");
    expect(s).toContain("/ColorSpace /DeviceRGB");
    expect(s).toContain("/Filter /DCTDecode");
    expect(s).toContain(`/Length ${fakeJpeg.length}`);
  });

  it("stores the JPEG bytes verbatim (binary intact)", () => {
    // The exact JPEG byte run appears between 'stream' and 'endstream'.
    const seq = latin1(fakeJpeg);
    const at = s.indexOf(seq);
    expect(at).toBeGreaterThan(0);
    for (let i = 0; i < fakeJpeg.length; i++) expect(pdf[at + i]).toBe(fakeJpeg[i]);
  });

  it("draws the image to fill the page (cm matrix = page size)", () => {
    expect(s).toContain("792 0 0 612 0 0 cm");
    expect(s).toContain("/Im0 Do");
  });

  it("has a byte-accurate xref: startxref points at 'xref', each entry at 'N 0 obj'", () => {
    const m = s.match(/startxref\s+(\d+)/);
    expect(m).toBeTruthy();
    const xrefStart = Number(m[1]);
    expect(s.slice(xrefStart, xrefStart + 4)).toBe("xref");
    // Parse the entries (skip object 0, the free head) and confirm each offset lands on "i 0 obj".
    const body = s.slice(xrefStart).split("\n").slice(2); // after "xref" and "0 7"
    for (let i = 1; i <= 6; i++) {
      const off = Number(body[i].slice(0, 10));
      expect(s.slice(off, off + (`${i} 0 obj`).length)).toBe(`${i} 0 obj`);
    }
    expect(s).toContain("/Size 7");
    expect(s).toContain("/Root 1 0 R");
    expect(s).toContain("/Info 6 0 R");
  });

  it("puts the title into the document Info", () => {
    expect(s).toContain("/Title (2026.06.20 Mesa - Plan 1)");
  });

  it("tabloid portrait sizes to 11 x 17 in (792 x 1224 pt)", () => {
    const t = latin1(jpegToPdf({ jpeg: fakeJpeg, pixelW: 100, pixelH: 154, widthIn: 11, heightIn: 17 }));
    expect(t).toContain("/MediaBox [0 0 792 1224]");
  });

  it("escapes parens/backslashes in the title so the Info dict can't break", () => {
    const t = latin1(jpegToPdf({ jpeg: fakeJpeg, pixelW: 10, pixelH: 10, widthIn: 1, heightIn: 1, title: "A (B) \\ C" }));
    expect(t).toContain("/Title (A \\(B\\) \\\\ C)");
  });

  it("rejects bad input", () => {
    expect(() => jpegToPdf({ jpeg: [1, 2, 3], pixelW: 10, pixelH: 10, widthIn: 1, heightIn: 1 })).toThrow();
    expect(() => jpegToPdf({ jpeg: new Uint8Array(), pixelW: 10, pixelH: 10, widthIn: 1, heightIn: 1 })).toThrow();
    expect(() => jpegToPdf({ jpeg: fakeJpeg, pixelW: 0, pixelH: 10, widthIn: 1, heightIn: 1 })).toThrow();
    expect(() => jpegToPdf({ jpeg: fakeJpeg, pixelW: 10, pixelH: 10, widthIn: 0, heightIn: 1 })).toThrow();
  });
});
