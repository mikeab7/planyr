/* B1953796 — R1 (autosave must not drop fields its snapshot doesn't carry) + R2 (file_facts mirror
 * of the filing facts is derived by ONE function; MCP readers use the review's truth). */
import { describe, it, expect, beforeEach } from "vitest";
import { reviewRowFor, rememberStoredReview, clearReviewVersions, fillEmptyFromFacts, factsPatchFor, filingSignature } from "../src/workspaces/doc-review/lib/reviewStore.js";
import { applyReviewTruth } from "../functions/api/mcp/_tools.js";

const stored = { id: "r1", kind: "single", title: "T", projectId: "p1", discipline: "Survey", folderId: "f-03", sourceFile: "alta.pdf", orgScope: true, placed: true, sources: [{ srcId: "s" }], single: { markups: [] } };
// what DocReview.buildSnapshot emitted BEFORE the fix: no folderId / sourceFile
const snapshot = { id: "r1", kind: "single", title: "T", projectId: "p1", discipline: "Survey", sources: [{ srcId: "s" }], single: { markups: [{ id: "m1" }] } };

describe("R1 preserve-unknown-fields at the write choke point", () => {
  beforeEach(() => clearReviewVersions());
  it("an autosave snapshot without folderId/sourceFile keeps the stored ones", () => {
    rememberStoredReview("r1", stored);
    const row = reviewRowFor(snapshot);
    expect(row.data.folderId).toBe("f-03");
    expect(row.data.sourceFile).toBe("alta.pdf");
    expect(row.data.placed).toBe(true);
    expect(row.data.single.markups).toHaveLength(1); // the snapshot still wins for what it owns
  });
  it("the snapshot wins for a key it carries (explicit orgScope:false is honoured)", () => {
    rememberStoredReview("r1", stored);
    expect(reviewRowFor({ ...snapshot, orgScope: false }).data.orgScope).toBe(false);
  });
  it("a brand-new row merges nothing", () => {
    rememberStoredReview("r1", stored);
    expect(reviewRowFor(snapshot, { isNew: true }).data.folderId).toBeUndefined();
  });
  it("repair fills only EMPTY sourceFile from file_facts, never overwrites", () => {
    expect(fillEmptyFromFacts({ id: "x" }, { source_file: "a.pdf" }).sourceFile).toBe("a.pdf");
    const keep = { id: "x", sourceFile: "mine.pdf" };
    expect(fillEmptyFromFacts(keep, { source_file: "a.pdf" })).toBe(keep);
  });
});

describe("R2 filing facts mirror", () => {
  it("choosing project+discipline clears needs_filing and re-derives the derived category", () => {
    const ex = { discipline: "Other", item: "Doc", sheet_title: "", category: "Reports/Studies", state: "needs_filing" };
    const patch = factsPatchFor(ex, { id: "r", projectId: "p1", discipline: "Civil", item: "Doc" });
    expect(patch.needs_filing).toBe(false);
    expect(patch.state).toBe("filed");
    expect(patch.project_id).toBe("p1");
    expect(patch.category).toBe("Drawings");
  });
  it("keeps an override category and a superseded state", () => {
    const patch = factsPatchFor({ discipline: "Civil", item: "x", category: "Custom", state: "superseded" }, { projectId: "p", discipline: "Survey", item: "x" });
    expect(patch.category).toBeUndefined();
    expect(patch.state).toBeUndefined();
  });
  it("no project => back to needs filing", () => {
    expect(factsPatchFor({}, { discipline: "Civil" }).needs_filing).toBe(true);
  });
  it("signature changes only with filing facts", () => {
    expect(filingSignature({ projectId: "a" })).not.toBe(filingSignature({ projectId: "b" }));
    expect(filingSignature({ projectId: "a", title: "x" })).toBe(filingSignature({ projectId: "a", title: "y" }));
  });
  it("MCP reads: soft-deleted reviews' facts drop; the review's current project wins", () => {
    const facts = [{ id: "f1", review_id: "r1", project_id: "old" }, { id: "f2", review_id: "r2", project_id: "p" }, { id: "f3", project_id: "legacy" }];
    const reviews = [{ id: "r1", project_id: "new", deleted_at: null }, { id: "r2", project_id: "p", deleted_at: "2026-01-01" }];
    const out = applyReviewTruth(facts, reviews);
    expect(out.map((f) => f.id)).toEqual(["f1", "f3"]);
    expect(out[0].project_id).toBe("new");
  });
});
