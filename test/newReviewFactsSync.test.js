/* B2064899 follow-up — a freshly uploaded review's filing facts (item / date / discipline) reach file_facts.
 * Production 2026-10-06: two new uploads had item + date on the review and "" / null in the index, because the
 * first upsert of a never-seen review id only RECORDED its signature as mirrored. fileNewReview now primes the
 * signature so that first save is treated as the filing edit it is. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

const updates = [];
const row = { id: "rv1", discipline: "Other", item: "", sheet_title: "", category: "Other", state: "needs_filing" };
vi.mock("../src/workspaces/site-planner/lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { ...row }, error: null }) }) }),
      update: (p) => ({ eq: async () => { updates.push(p); return { error: null }; } }),
    }),
  },
  supabaseRest: vi.fn(), currentAccessToken: vi.fn(),
}));

const { syncFileFactsForReview, rememberFiledSignature } = await import("../src/workspaces/doc-review/lib/reviewStore.js");
const rec = { id: "rv1", projectId: "p1", discipline: "Geotechnical", item: "Geotechnical Report", revision: "", docDate: "2026-10-06" };

describe("new review → file_facts", () => {
  beforeEach(() => { updates.length = 0; });
  it("WITHOUT priming, the first save of an unseen review id skips the index (the production defect)", async () => {
    const r = await syncFileFactsForReview({ ...rec, id: "rv1" });
    expect(r.skipped).toBe(true);
    expect(updates).toEqual([]);
  });
  it("WITH priming (what fileNewReview now does), the first save writes item / date / discipline to the index", async () => {
    rememberFiledSignature("rv2", {});
    const r = await syncFileFactsForReview({ ...rec, id: "rv2" });
    expect(r.ok).toBe(true);
    expect(updates.length).toBe(1);
    expect(updates[0]).toMatchObject({ item: "Geotechnical Report", doc_date: "2026-10-06", discipline: "Geotechnical", project_id: "p1" });
  });
  it("fileNewReview primes the signature before its first upsert (source guard)", () => {
    const src = readFileSync("src/workspaces/doc-review/lib/reviewStore.js", "utf8");
    const i = src.indexOf("export async function fileNewReview");
    const body = src.slice(i, src.indexOf("\n}\n", i));
    expect(body.indexOf("rememberFiledSignature(id, {})")).toBeGreaterThan(-1);
    expect(body.indexOf("rememberFiledSignature(id, {})")).toBeLessThan(body.indexOf("await upsertReview("));
  });
});
