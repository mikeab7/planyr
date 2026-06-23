import { describe, it, expect } from "vitest";
import { buildFilingPlan } from "../src/shared/files/disciplineSplit.js";
import { splitPdfByPlan, partFileName } from "../src/workspaces/doc-review/lib/pdfSplit.js";
import { PDFDocument } from "pdf-lib";

describe("buildFilingPlan — complete page partition", () => {
  it("single-discipline → one entry covering every page", () => {
    const split = { multiDiscipline: false, dominant: { discipline: "Civil", item: "Grading Plan" }, standaloneSets: [{ discipline: "Civil", item: "Grading Plan", pageNums: [1, 2, 3] }], sets: [{ discipline: "Civil", pageNums: [1, 2, 3] }] };
    const plan = buildFilingPlan(split, 3);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ discipline: "Civil", pageNums: [1, 2, 3], primary: true });
  });

  it("multi-discipline → one entry per set; leftover/cover pages ride with the dominant", () => {
    // 8-page Bergstrom-like set: Arch (1,2,8) + Structural (4,5,6,7); page 3 is an orphan cover.
    const split = {
      multiDiscipline: true,
      dominant: { discipline: "Architectural", item: "Architectural" },
      standaloneSets: [
        { discipline: "Architectural", item: "Architectural", pageNums: [1, 2, 8] },
        { discipline: "Structural", item: "Structural", pageNums: [4, 5, 6, 7] },
      ],
      sets: [{ discipline: "Architectural", pageNums: [1, 2, 8] }, { discipline: "Structural", pageNums: [4, 5, 6, 7] }],
    };
    const plan = buildFilingPlan(split, 8);
    expect(plan[0].discipline).toBe("Architectural"); // dominant first
    expect(plan[0].pageNums).toEqual([1, 2, 3, 8]);    // orphan page 3 absorbed here
    const struct = plan.find((e) => e.discipline === "Structural");
    expect(struct.pageNums).toEqual([4, 5, 6, 7]);
    // Every page 1..8 appears exactly once across the plan.
    const all = plan.flatMap((e) => e.pageNums).sort((a, b) => a - b);
    expect(all).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe("pdfSplit.splitPdfByPlan — real byte carve", () => {
  // Build a real N-page PDF so the carve is exercised end to end (no mocks).
  async function makePdf(n) {
    const doc = await PDFDocument.create();
    for (let i = 0; i < n; i++) doc.addPage([200, 200]);
    const bytes = await doc.save();
    return new Blob([bytes], { type: "application/pdf" });
  }
  const loadLib = async () => ({ PDFDocument });

  it("carves a combined PDF into one PDF per discipline with the right page counts", async () => {
    const blob = await makePdf(8);
    const plan = [
      { discipline: "Architectural", item: "Architectural", pageNums: [1, 2, 3, 8] },
      { discipline: "Structural", item: "Structural", pageNums: [4, 5, 6, 7] },
    ];
    const parts = await splitPdfByPlan(blob, plan, "Bergstrom Phase 2a.pdf", { loadLib });
    expect(parts.map((p) => p.discipline)).toEqual(["Architectural", "Structural"]);
    expect(parts[0].fileName).toBe("Bergstrom Phase 2a - Architectural.pdf");
    const counts = await Promise.all(parts.map(async (p) => (await PDFDocument.load(await p.blob.arrayBuffer())).getPageCount()));
    expect(counts).toEqual([4, 4]);
  });

  it("skips out-of-range page numbers safely", async () => {
    const blob = await makePdf(3);
    const parts = await splitPdfByPlan(blob, [{ discipline: "Civil", pageNums: [1, 2, 99] }], "x.pdf", { loadLib });
    const count = (await PDFDocument.load(await parts[0].blob.arrayBuffer())).getPageCount();
    expect(count).toBe(2);
  });

  it("empty inputs degrade cleanly", async () => {
    expect(await splitPdfByPlan(null, [{ pageNums: [1] }], "x.pdf", { loadLib })).toEqual([]);
    expect(await splitPdfByPlan(await makePdf(1), [], "x.pdf", { loadLib })).toEqual([]);
  });
});

describe("partFileName", () => {
  it("appends the discipline and keeps a single .pdf", () => {
    expect(partFileName("Set.pdf", "Structural")).toBe("Set - Structural.pdf");
    expect(partFileName("Set", "Civil")).toBe("Set - Civil.pdf");
  });
});
