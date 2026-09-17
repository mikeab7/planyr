import { describe, it, expect, beforeEach, vi } from "vitest";

/* B1340368 (owner report 2026-09-08, "the Last document row dead-ends") — the Dashboard's
 * Jump-back-in card offered the single most recent NON-DELETED document with no notion that
 * its FILED PROJECT could be gone. Reproduced live: doc `rvmtov1wtr0459a` is alive
 * (deleted_at null — neither obvious candidate, "the doc itself is deleted" or "the query
 * doesn't exclude deleted rows", is what's happening) but its `project_id` resolves to
 * nothing in `sites` at all, so opening it hits Shell.jsx's project-deletion gate and shows
 * "This project doesn't exist" instead of ever mounting Doc Review.
 *
 * Two independent in-memory tables, mirroring the real two-query shape: `h.docs` (doc_reviews,
 * queried .is/.order/.limit) and `h.sites` (sites, queried .in — liveProjectIds' own batch).
 */
const h = vi.hoisted(() => ({ docs: [], sites: [], sitesErr: null }));
vi.mock("../src/workspaces/site-planner/lib/supabase.js", () => ({
  supabase: {
    from: (table) => {
      if (table === "sites") {
        return {
          select: () => ({
            in: (field, vals) => Promise.resolve({
              data: h.sitesErr ? null : h.sites.filter((r) => r && vals.includes(r[field])),
              error: h.sitesErr,
            }),
          }),
        };
      }
      // doc_reviews: .select().is("deleted_at", null).order(...).limit(n) — a plain awaited
      // chain, no .maybeSingle() any more (the fix reads a BATCH, not a single row).
      const rows = h.docs.filter((d) => !d.deleted_at);
      const query = { _rows: rows.slice() };
      query.select = () => query;
      query.is = () => query; // already pre-filtered to non-deleted above
      query.order = (field, { ascending } = {}) => {
        query._rows = query._rows.slice().sort((a, b) => {
          const av = a[field] || "", bv = b[field] || "";
          return ascending ? (av < bv ? -1 : 1) : (av > bv ? -1 : 1);
        });
        return query;
      };
      query.limit = (n) => { query._rows = query._rows.slice(0, n); return query; };
      query.then = (resolve) => resolve({ data: query._rows, error: null });
      return query;
    },
  },
}));

import { fetchLastTouchedDoc } from "../src/workspaces/dashboard/lib/dashboardDocFetch.js";

describe("fetchLastTouchedDoc — never offers a document whose filed project is gone", () => {
  beforeEach(() => { h.docs = []; h.sites = []; h.sitesErr = null; });

  it("no documents at all → null (drop the line), not a throw", async () => {
    const doc = await fetchLastTouchedDoc();
    expect(doc).toBeNull();
  });

  it("THE CORE REPRO — the single most recent document's project has no trace anywhere in sites: falls back, never offers it", async () => {
    h.docs = [
      { id: "rvmtov1wtr0459a", title: "2026.09.05 planyr-dupe-check", project: null, project_id: "smtov116eka7", updated_at: "2026-09-05T20:54:06Z", deleted_at: null },
      { id: "older-doc", title: "Older Doc", project: "Bain", project_id: "healthy-project", updated_at: "2026-09-01T00:00:00Z", deleted_at: null },
    ];
    h.sites = [{ id: "healthy-project", group_id: "healthy-project", deleted_at: null }];
    const doc = await fetchLastTouchedDoc();
    expect(doc.id).toBe("older-doc");
  });

  it("a document with no project_id at all is always offered — nothing to go stale", async () => {
    h.docs = [{ id: "unfiled", title: "Loose PDF", project: null, project_id: null, updated_at: "2026-09-05T00:00:00Z", deleted_at: null }];
    const doc = await fetchLastTouchedDoc();
    expect(doc.id).toBe("unfiled");
  });

  it("the most recent document's project is alive — offered normally, the common case", async () => {
    h.docs = [{ id: "d1", title: "Concept A", project: "Richfield", project_id: "smsdrvzr9gzx", updated_at: "2026-09-08T00:00:00Z", deleted_at: null }];
    h.sites = [{ id: "smsdrvzr9gzx", group_id: "smsdrvzr9gzx", deleted_at: null }];
    const doc = await fetchLastTouchedDoc();
    expect(doc.id).toBe("d1");
  });

  it("the anchor row of the document's project group is soft-deleted but a sibling is live (B1164192 shape) — still offered, group-aware", async () => {
    h.docs = [{ id: "d1", title: "Concept A", project: "Richfield", project_id: "smsdrvzr9gzx", updated_at: "2026-09-08T00:00:00Z", deleted_at: null }];
    h.sites = [
      { id: "smsdrvzr9gzx", group_id: "smsdrvzr9gzx", deleted_at: "2026-08-29T00:00:00Z" },
      { id: "concept-b", group_id: "smsdrvzr9gzx", deleted_at: null },
    ];
    const doc = await fetchLastTouchedDoc();
    expect(doc.id).toBe("d1");
  });

  it("EVERY candidate in the fallback batch is filed under a dead project → drops the line entirely (null)", async () => {
    h.docs = [
      { id: "d1", title: "One", project: null, project_id: "gone1", updated_at: "2026-09-05T00:00:00Z", deleted_at: null },
      { id: "d2", title: "Two", project: null, project_id: "gone2", updated_at: "2026-09-04T00:00:00Z", deleted_at: null },
    ];
    h.sites = [];
    const doc = await fetchLastTouchedDoc();
    expect(doc).toBeNull();
  });

  it("falls back through several dead candidates to the first genuinely-openable one", async () => {
    h.docs = [
      { id: "d1", title: "Newest, dead project", project: null, project_id: "gone1", updated_at: "2026-09-06T00:00:00Z", deleted_at: null },
      { id: "d2", title: "Middle, also dead", project: null, project_id: "gone2", updated_at: "2026-09-05T00:00:00Z", deleted_at: null },
      { id: "d3", title: "Third, unfiled", project: null, project_id: null, updated_at: "2026-09-04T00:00:00Z", deleted_at: null },
    ];
    h.sites = [];
    const doc = await fetchLastTouchedDoc();
    expect(doc.id).toBe("d3");
  });

  it("an already-soft-deleted document never enters the candidate batch at all", async () => {
    h.docs = [{ id: "d1", title: "Deleted doc", project: null, project_id: null, updated_at: "2026-09-08T00:00:00Z", deleted_at: "2026-09-07T00:00:00Z" }];
    const doc = await fetchLastTouchedDoc();
    expect(doc).toBeNull();
  });

  it("an inconclusive liveness check (thrown error) fails OPEN — falls back to the plain most-recent document, the pre-fix behavior", async () => {
    h.docs = [{ id: "d1", title: "Concept A", project: "Richfield", project_id: "smsdrvzr9gzx", updated_at: "2026-09-08T00:00:00Z", deleted_at: null }];
    h.sitesErr = { message: "network down" };
    const doc = await fetchLastTouchedDoc();
    expect(doc.id).toBe("d1");
  });
});

describe("fetchLastTouchedDoc — B1616656 (×3 recurrence): a project-less, non-PDF document is never a candidate", () => {
  beforeEach(() => { h.docs = []; h.sites = []; h.sitesErr = null; });

  it("THE EXACT REPORTED ROW — project-less, non-PDF (rvmtov1wtr0459a's own real shape: no `sourceFile` mirror, but `sources[0].name` reads the real .txt) — skipped, falls back to the next candidate", async () => {
    h.docs = [
      { id: "rvmtov1wtr0459a", title: "2026.09.05 planyr-dupe-check", project: null, project_id: null, updated_at: "2026-09-10T03:58:50Z", deleted_at: null, sources: [{ name: "planyr-dupe-check.txt" }] },
      { id: "older-pdf", title: "Older PDF", project: null, project_id: null, updated_at: "2026-09-01T00:00:00Z", deleted_at: null, sources: [{ name: "site-plan.pdf" }] },
    ];
    const doc = await fetchLastTouchedDoc();
    expect(doc.id).toBe("older-pdf");
  });

  it("project-less AND a PDF — stays eligible, nothing to route to but the canvas can render it", async () => {
    h.docs = [{ id: "unfiled-pdf", title: "Loose PDF", project: null, project_id: null, updated_at: "2026-09-10T00:00:00Z", deleted_at: null, sources: [{ name: "drawing.pdf" }] }];
    const doc = await fetchLastTouchedDoc();
    expect(doc.id).toBe("unfiled-pdf");
  });

  it("attached to a LIVE project and non-PDF — stays eligible; a live project gives the click somewhere real to land (must not regress this case)", async () => {
    h.docs = [{ id: "filed-nonpdf", title: "Geotech report", project: "8 South", project_id: "live-proj", updated_at: "2026-09-10T00:00:00Z", deleted_at: null, sources: [{ name: "report.docx" }] }];
    h.sites = [{ id: "live-proj", group_id: "live-proj", deleted_at: null }];
    const doc = await fetchLastTouchedDoc();
    expect(doc.id).toBe("filed-nonpdf");
  });

  it("attached to a live project and a PDF — unaffected, the ordinary case", async () => {
    h.docs = [{ id: "filed-pdf", title: "Concept A", project: "Richfield", project_id: "live-proj", updated_at: "2026-09-10T00:00:00Z", deleted_at: null, sources: [{ name: "concept-a.pdf" }] }];
    h.sites = [{ id: "live-proj", group_id: "live-proj", deleted_at: null }];
    const doc = await fetchLastTouchedDoc();
    expect(doc.id).toBe("filed-pdf");
  });

  it("attached to a DEAD (hard-gone) project and non-PDF — already excluded by the B1340368 dead-project rule, unaffected by this rule", async () => {
    h.docs = [
      { id: "dead-nonpdf", title: "Old test file", project: null, project_id: "gone", updated_at: "2026-09-10T00:00:00Z", deleted_at: null, sources: [{ name: "test.txt" }] },
      { id: "fallback-pdf", title: "Fallback", project: null, project_id: null, updated_at: "2026-09-01T00:00:00Z", deleted_at: null, sources: [{ name: "fallback.pdf" }] },
    ];
    h.sites = [];
    const doc = await fetchLastTouchedDoc();
    expect(doc.id).toBe("fallback-pdf");
  });

  it("EVERY document in the account is project-less and non-PDF — drops the line entirely (null), never a live-looking dead end", async () => {
    h.docs = [
      { id: "d1", title: "One", project: null, project_id: null, updated_at: "2026-09-10T00:00:00Z", deleted_at: null, sources: [{ name: "one.txt" }] },
      { id: "d2", title: "Two", project: null, project_id: null, updated_at: "2026-09-09T00:00:00Z", deleted_at: null, sources: [{ name: "two.docx" }] },
    ];
    const doc = await fetchLastTouchedDoc();
    expect(doc).toBeNull();
  });
});
