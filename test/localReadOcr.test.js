import { describe, it, expect } from "vitest";
import { localTitleBlockRead } from "../src/workspaces/doc-review/lib/localRead.js";

// A named project so matchProjectInText has something to hit.
const PROJECTS = [{ id: "g-mesa", name: "Mesa", aliases: [] }];

// A realistic title-block text blob for one Electrical sheet of the Mesa project.
const MESA_ELEC = "MESA  ELECTRICAL SITE PLAN  SHEET E-1  ISSUED FOR CONSTRUCTION 11/06/2023  SCALE 1\"=40'";

describe("localTitleBlockRead — OCR fallback for scanned/image-only pages (B411a)", () => {
  it("OCRs a wholly image-only PDF so it classifies on the free local path", async () => {
    // The embedded-text pass returns nothing (scanned); the injected OCR recovers the title block.
    const extractPages = async () => [""]; // one page, no text layer
    const ocr = async (_file, pageNums) => {
      expect(pageNums).toEqual([1]); // only the no-text page is OCR'd
      return new Map([[1, MESA_ELEC]]);
    };
    const res = await localTitleBlockRead("file.pdf", PROJECTS, { extractPages, ocr });
    expect(res.ok).toBe(true);
    expect(res.hasText).toBe(true); // was hasText:false before OCR
    expect(res.decision.discipline).toBe("Electrical"); // classified from the OCR'd title block
    expect(res.decision.docDate).toBe("2023-11-06");     // issue date read off the OCR text (B411b)
    expect(res.decision.ocrUsed).toBe(1);                // one page recovered via OCR
  });

  it("still returns hasText:false when OCR recovers nothing (graceful, AI fallback unchanged)", async () => {
    const extractPages = async () => ["", ""];
    const ocr = async () => new Map(); // OCR found nothing usable
    const res = await localTitleBlockRead("file.pdf", PROJECTS, { extractPages, ocr });
    expect(res).toEqual({ ok: true, hasText: false });
  });

  it("never calls OCR when every page already has embedded text (no perf hit on vector PDFs)", async () => {
    let called = false;
    const extractPages = async () => [MESA_ELEC];
    const ocr = async () => { called = true; return new Map(); };
    const res = await localTitleBlockRead("file.pdf", PROJECTS, { extractPages, ocr });
    expect(called).toBe(false);
    expect(res.hasText).toBe(true);
    expect(res.decision.ocrUsed).toBe(0);
  });

  it("OCRs only the image-only pages of a MIXED set, keeping the text pages as-is", async () => {
    const textPage = "MESA  CIVIL GRADING PLAN  SHEET C-2  IFC 11/06/2023";
    const extractPages = async () => [textPage, ""]; // page 1 has text, page 2 is scanned
    const ocr = async (_file, pageNums) => {
      expect(pageNums).toEqual([2]); // only page 2 gets OCR'd
      return new Map([[2, MESA_ELEC]]);
    };
    const res = await localTitleBlockRead("file.pdf", PROJECTS, { extractPages, ocr });
    expect(res.hasText).toBe(true);
    expect(res.decision.ocrUsed).toBe(1);
    expect(res.decision.numPages).toBe(2);
    // Both disciplines were read → a multi-discipline set (Civil page + Electrical page).
    expect(res.decision.multiDiscipline).toBe(true);
  });

  it("a thrown OCR seam degrades to hasText:false, never crashes the read", async () => {
    const extractPages = async () => [""];
    const ocr = async () => { throw new Error("WASM blew up"); };
    const res = await localTitleBlockRead("file.pdf", PROJECTS, { extractPages, ocr });
    expect(res).toEqual({ ok: true, hasText: false });
  });

  it("OCR can be disabled by passing ocr:null (returns the pre-B411a behavior)", async () => {
    const extractPages = async () => [""];
    const res = await localTitleBlockRead("file.pdf", PROJECTS, { extractPages, ocr: null });
    expect(res).toEqual({ ok: true, hasText: false });
  });
});
