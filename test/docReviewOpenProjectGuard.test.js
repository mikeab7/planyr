import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/* B1340368 (×2), recurrence 2026-09-09 — source guard for DocReview.jsx's loadSingleReview.
 *
 * The Dashboard's "Last document" card (and Library Home's Recent list, and the boot-resume
 * effect — every entry point routes through loadSingleReview) used to navigate straight off a
 * just-opened document's OWN `rec.projectId` field with no liveness check at all: `if
 * (rec.projectId) onNavigate?.({ projectId: rec.projectId })`. That field is a SEPARATE copy of
 * "which project is this doc filed under" from the flat `doc_reviews.project_id` mirror column
 * the offer-time checks (docProjectLiveness.docProjectIsDead, in dashboardDocFetch.js and
 * LibraryHome.jsx) read — a project purge could clear the mirror without touching the record's
 * own copy, so a document that was safe to OFFER still routed to a dead project the instant it
 * was opened.
 *
 * A behavioral test here would need to mount the whole (huge, canvas-driving) DocReview
 * component; the load-bearing fact is simpler and fully source-checkable: loadSingleReview must
 * resolve `openProjectId` via `openableProjectId` BEFORE it ever calls `onNavigate` with a
 * project id, and the old unguarded shape must not reappear. See test/docProjectLiveness.test.js
 * for the behavioral proof of openableProjectId itself.
 */
const SRC = fs.readFileSync(path.join(process.cwd(), "src/workspaces/doc-review/DocReview.jsx"), "utf8");

describe("DocReview.jsx loadSingleReview — re-checks project liveness before navigating", () => {
  it("imports openableProjectId (and liveProjectIds) from the shared liveness module", () => {
    expect(SRC).toMatch(/import\s*\{[^}]*openableProjectId[^}]*\}\s*from\s*["']\.\.\/\.\.\/shared\/projects\/docProjectLiveness\.js["']/);
    expect(SRC).toMatch(/import\s*\{[^}]*liveProjectIds[^}]*\}\s*from\s*["']\.\.\/\.\.\/shared\/projects\/docProjectLiveness\.js["']/);
  });

  it("loadSingleReview computes openProjectId via openableProjectId, strictly before its own onNavigate call", () => {
    const start = SRC.indexOf("const loadSingleReview = async (rec, opts = {}) => {");
    expect(start).toBeGreaterThan(-1);
    const end = SRC.indexOf("\n  const resetSingle = ", start);
    expect(end).toBeGreaterThan(start);
    const body = SRC.slice(start, end);

    const openableAt = body.indexOf("openableProjectId(rec");
    const navigateAt = body.indexOf("onNavigate?.({ projectId: openProjectId })");
    expect(openableAt).toBeGreaterThan(-1);
    expect(navigateAt).toBeGreaterThan(-1);
    expect(openableAt).toBeLessThan(navigateAt);

    // RED-PROOF (mutation replay): the pre-fix line navigated straight off the record's own
    // field with no liveness gate anywhere in the function. Reintroducing it — even alongside
    // the guard above — is the exact regression this test exists to catch.
    expect(body).not.toMatch(/if \(rec\.projectId\) onNavigate\?\.\(\{ projectId: rec\.projectId \}\)/);
    // and the recorded "recently opened" pointer must use the SAME re-checked id, not the raw
    // record field, or a dead project can re-enter Library Home's own offer-time check that way.
    expect(body).not.toMatch(/recordOpen\(uid,\s*\{\s*id:\s*rec\.id,\s*projectId:\s*rec\.projectId/);
  });
});
