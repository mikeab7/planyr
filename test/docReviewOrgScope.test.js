import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/* DocReview.jsx / ReviewsBar.jsx — ORG SCOPE (NEW-1, B1912209), source-guarded.
 *
 * DocReview.jsx is the huge, canvas-driving component test/docReviewOpenProjectGuard.test.js's
 * own header already explains why a behavioral mount isn't practical here — the load-bearing
 * facts below are fully source-checkable instead, the same shape that file already uses.
 *
 * The regression these guard is real, not hypothetical: while wiring org scope, this exact class
 * of bug was found and fixed in THIS session — DocReview.jsx's `onSelectProject` handler (both
 * header call sites) merged `{ projectId: id, cross: false }` onto the live route WITHOUT
 * `org: false`, and `route.js`'s `buildHash` picks `org` over `projectId` whenever both are
 * present — so picking a specific project from the breadcrumb while standing in Organization was
 * a silent no-op (the hash never changed, nothing happened). ModelApp.jsx had the identical gap.
 * RED-PROOF: reverting either fix below reproduces that no-op.
 */
const SRC = fs.readFileSync(path.join(process.cwd(), "src/workspaces/doc-review/DocReview.jsx"), "utf8");
const REVIEWS_BAR_SRC = fs.readFileSync(path.join(process.cwd(), "src/workspaces/doc-review/components/ReviewsBar.jsx"), "utf8");
const MODEL_APP_SRC = fs.readFileSync(path.join(process.cwd(), "src/workspaces/model/ModelApp.jsx"), "utf8");

describe("DocReview.jsx — org prop wiring", () => {
  it("accepts an `org` prop, defaulting false", () => {
    expect(SRC).toMatch(/org\s*=\s*false,/);
  });

  it("both AppHeader render calls pass org={org} through (stitch mode AND the single-review view)", () => {
    const matches = SRC.match(/org=\{org\}/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("newMeta() carries an orgScope field, so a fresh review is never ambiguous about its scope", () => {
    expect(SRC).toMatch(/const newMeta = \(\) => \(\{[^}]*orgScope:\s*false[^}]*\}\)/);
  });

  it("buildSnapshot threads meta.orgScope into the saved record — the exact field the autosave would otherwise silently drop", () => {
    const start = SRC.indexOf("const buildSnapshot = useCallback(() => ({");
    const end = SRC.indexOf("}), [reviewId, meta, source", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(SRC.slice(start, end)).toMatch(/orgScope:\s*meta\.orgScope\s*===\s*true/);
  });

  it("loadSingleReview reads rec.orgScope into meta — an opened org-filed review keeps its scope on the next save", () => {
    const start = SRC.indexOf("const loadSingleReview = async (rec) => {");
    const end = SRC.indexOf("\n  const resetSingle = ", start);
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, end);
    expect(body).toMatch(/setMeta\(\{[^}]*orgScope:\s*rec\.orgScope\s*===\s*true/);
  });

  // RED-PROOF: the exact regression found and fixed this session.
  it("onSelectProject ALWAYS clears org:false — picking a project from the breadcrumb must never silently no-op at org scope", () => {
    const matches = SRC.match(/onSelectProject=\{\(id\) => onNavigate\?\.\(\{[^}]*\}\)\}/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
    for (const m of matches) expect(m).toMatch(/org:\s*false/);
  });

  it("the project-switch effect checks `org` BEFORE falling through to the plain projectId branch (never conflates Organization with \"no project chosen\")", () => {
    const start = SRC.indexOf("const routeIdRef = useRef(projectId);");
    const end = SRC.indexOf("// Consume the Shell's cross-workspace", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = SRC.slice(start, end);
    const orgBranchAt = body.indexOf("if (org) {");
    const plainProjectIdCheckAt = body.indexOf("if (projectId === prev) return;");
    expect(orgBranchAt).toBeGreaterThan(-1);
    expect(plainProjectIdCheckAt).toBeGreaterThan(orgBranchAt); // org is checked strictly first
    expect(body).toMatch(/readLastDoc\(null,\s*true\)/); // resumes from the ORG bucket, never the unfiled one
  });

  it("the boot-write effects never let an org-scoped doc reach the legacy GLOBAL pointers (which the plain, non-org resume path reads unconditionally)", () => {
    const start = SRC.indexOf("// Remember the active review so a refresh resumes it");
    const end = SRC.indexOf("const loadTok = useRef(0);", start);
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, end);
    expect(body).toMatch(/if \(org\)/);
    expect(body).toMatch(/writeLastDoc\(null,\s*\{\s*id:\s*reviewId,\s*mode:\s*"review"\s*\},\s*true\)/);
  });

  it("resolveResume/resumeAllowedForRoute calls thread org scope through (boot resume never resolves an org file into a project's bucket, or vice versa)", () => {
    expect(SRC).toMatch(/resolveResume\(\{\s*routeProjectId:\s*projectId,[^}]*org,?\s*\}\)/s);
    expect(SRC).toMatch(/resumeAllowedForRoute\(routeIdRef\.current,\s*rec\.projectId \|\| null,\s*routeOrgRef\.current,\s*rec\.orgScope === true\)/);
  });
});

describe("ReviewsBar.jsx — Organization is one more filing destination, mutually exclusive with a project", () => {
  it("the filing select offers an Organization row", () => {
    expect(REVIEWS_BAR_SRC).toMatch(/🏢 Organization/);
  });

  it("picking Organization sets orgScope true and clears projectId — never both", () => {
    const start = REVIEWS_BAR_SRC.indexOf("const onProject = (v) => {");
    const end = REVIEWS_BAR_SRC.indexOf("// Inline two-step delete", start);
    expect(start).toBeGreaterThan(-1);
    const body = REVIEWS_BAR_SRC.slice(start, end);
    expect(body).toMatch(/onMeta\?\.\("orgScope",\s*true\)/);
    expect(body).toMatch(/onMeta\?\.\("projectId",\s*null\)/);
  });

  it("picking a real project clears orgScope back to false", () => {
    const start = REVIEWS_BAR_SRC.indexOf("const onProject = (v) => {");
    const end = REVIEWS_BAR_SRC.indexOf("// Inline two-step delete", start);
    const body = REVIEWS_BAR_SRC.slice(start, end);
    expect(body).toMatch(/onMeta\?\.\("orgScope",\s*false\)/);
  });
});

describe("ModelApp.jsx — the identical onSelectProject gap, same fix", () => {
  it("onSelectProject clears org:false too", () => {
    expect(MODEL_APP_SRC).toMatch(/onSelectProject=\{\(id\) => onNavigate\?\.\(\{ projectId: id, cross: false, org: false \}\)\}/);
  });
});
