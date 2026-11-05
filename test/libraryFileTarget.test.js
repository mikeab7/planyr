import { describe, it, expect } from "vitest";
import { FOLDER_TEMPLATE } from "../src/shared/folders/folderTemplate.js";
import { buildSeedRows, displayLabel } from "../src/shared/folders/folderTree.js";
import { suggestFolder, resolvePlacement, folderChoices, refileDefault } from "../src/shared/folders/filingTarget.js";
import { categoryFor } from "../src/shared/files/fileFacts.js";
import { QUEUE_STATUS, reconcileQueueWithFacts } from "../src/shared/files/uploadQueue.js";

let n = 0;
const rows = buildSeedRows(FOLDER_TEMPLATE, { projectId: "p1", makeId: () => `f${++n}` })
  .map((r) => ({ ...r, parentId: r.parent_id, order: r.sort_order })); // seed rows are snake_case; live rows camel
const byName = (name) => rows.find((r) => r.name === name);
const pathOf = (row) => { const out = []; let c = row; while (c) { out.unshift(c.name); c = rows.find((r) => r.id === c.parentId); } return out.join("/"); };
const drawings = rows.find((r) => /drawings/i.test(r.name));

describe("File target — non-drawing categories never land in Design › Drawings (NEW-1)", () => {
  it("every non-drawing category resolves outside Drawings (or to nothing), never inside it", () => {
    for (const cat of ["Surveys", "Plats", "Title", "Geotechnical", "Environmental", "Permits/Entitlements", "Reports/Studies", "Agreements"]) {
      const row = suggestFolder(rows, { category: cat, discipline: "Other" });
      expect(row, cat).toBeTruthy();
      expect(pathOf(row), cat).not.toMatch(/Drawings/);
    }
  });
  it("a survey suggests Land › Survey & Legal Descriptions, a plat Land › Plat & Easements", () => {
    expect(pathOf(suggestFolder(rows, { category: "Surveys" }))).toMatch(/Land\/03\. Survey & Legal/);
    expect(pathOf(suggestFolder(rows, { category: "Plats" }))).toMatch(/Land\/04\. Plat/);
    expect(pathOf(suggestFolder(rows, { category: "Geotechnical" }))).toMatch(/09\. Geotech/);
  });
  it("a tree lacking the leaf falls back to the section, not Drawings", () => {
    const trimmed = rows.filter((r) => !/Survey & Legal/.test(r.name));
    const row = suggestFolder(trimmed, { category: "Surveys" });
    expect(pathOf(row)).toBe("02. Land");
  });
  it("drawings still resolve through the drawing resolver", () => {
    expect(pathOf(suggestFolder(rows, { category: "Drawings", discipline: "Civil" }))).toMatch(/Drawings\/05\. Civil/);
  });
  it("an unclassified file (Other, no category) gets no suggestion — the owner must pick", () => {
    expect(refileDefault(rows, { discipline: "Other" }, categoryFor).row).toBeNull();
    expect(refileDefault(rows, { discipline: "Other", category: "Surveys" }, categoryFor).row).toBeTruthy();
  });
});

describe("placement — an explicit folderId wins over the discipline resolver", () => {
  it("explicit live folder wins", () => {
    const survey = suggestFolder(rows, { category: "Surveys" });
    const p = resolvePlacement(rows, { folderId: survey.id, discipline: "Civil" });
    expect(p.row.id).toBe(survey.id);
    expect(p.explicit).toBe(true);
  });
  it("no folderId (or a trashed/missing one) falls back to Drawings by discipline", () => {
    expect(resolvePlacement(rows, { discipline: "Civil" }).row.name).toMatch(/Civil|Current/);
    const gone = rows.map((r) => (r.id === byName("03. Survey & Legal Descriptions").id ? { ...r, trashed: true } : r));
    const p = resolvePlacement(gone, { folderId: byName("03. Survey & Legal Descriptions").id, discipline: "Other" });
    expect(p.row.id).toBe(drawings.id);
    expect(p.explicit).toBe(false);
  });
  it("picker choices are tree-ordered with depth", () => {
    const c = folderChoices(rows);
    expect(c[0].depth).toBe(0);
    expect(c.some((x) => x.depth === 2 && /Civil/.test(x.name))).toBe(true);
    expect(displayLabel(c[0].name)).toBeTruthy();
  });
});

describe("tray reconciliation — the bottom bar never disagrees with the Needs-filing view (NEW-2)", () => {
  const item = (o) => ({ uploadId: "u", status: QUEUE_STATUS.NEEDS_FILING, reviewId: "r1", ...o });
  it("a NEEDS_FILING row whose review is now filed becomes DONE", () => {
    const out = reconcileQueueWithFacts([item()], new Map([["r1", false]]), 123);
    expect(out[0].status).toBe(QUEUE_STATUS.DONE);
    expect(out[0].filedAt).toBe(123);
  });
  it("still needs filing / unknown / other statuses are untouched, and the same array comes back", () => {
    const q = [item(), item({ uploadId: "v", reviewId: "r2" }), item({ uploadId: "w", status: QUEUE_STATUS.DONE })];
    expect(reconcileQueueWithFacts(q, new Map([["r1", true]]))).toBe(q);
  });
});
