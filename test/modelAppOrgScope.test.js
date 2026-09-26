import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/* ModelApp.jsx — ORG SCOPE (NEW-1, B1912209), source-guarded. Same shape as
 * test/docReviewOpenProjectGuard.test.js / test/docReviewOrgScope.test.js use for the
 * equally-huge DocReview.jsx: a full render would need to mock Supabase, AppHeader, the
 * grid/ribbon stack and more, for logic that's fully checkable from the source directly. The
 * actual store-layer behavior (org_model_sheets round-trips, the local index, the shared
 * content key) is behavior-tested in test/modelStoreOrg.test.js.
 */
const SRC = fs.readFileSync(path.join(process.cwd(), "src/workspaces/model/ModelApp.jsx"), "utf8");

describe("ModelApp.jsx — org prop + derived state", () => {
  it("accepts an `org` prop, defaulting false", () => {
    expect(SRC).toMatch(/org\s*=\s*false,\s*\n\}\)\s*\{/);
  });

  it("orgMode requires org true AND projectId null AND not crossProject — never trusts `org` alone", () => {
    expect(SRC).toMatch(/const orgMode = !!org && !crossProject && !projectId;/);
  });

  it("openWorkbook is the umbrella of openProject OR openOrgWorkbook — the one gate the render/persistence effects share", () => {
    expect(SRC).toMatch(/const openWorkbook = openProject \|\| openOrgWorkbook;/);
  });

  it("storageKey is the project id in project mode, the workbook id in org mode — never both, never a fallback that mixes them", () => {
    expect(SRC).toMatch(/const storageKey = openProject \? projectId : \(openOrgWorkbook \? orgWorkbookId : null\);/);
  });

  it("leaving org scope always clears the selected workbook — never carries a stale selection into a context that doesn't name it", () => {
    expect(SRC).toMatch(/useEffect\(\(\) => \{ if \(!orgMode\) setOrgWorkbookId\(null\); \}, \[orgMode\]\);/);
  });
});

describe("ModelApp.jsx — the load/save effects key on storageKey, not the raw projectId, once org exists", () => {
  it("the load effect reads readLocalSheet(userId, storageKey) and branches the cloud call on openProject", () => {
    const start = SRC.indexOf("/* ---- load: local first");
    const end = SRC.indexOf("/* Write-through local save", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = SRC.slice(start, end);
    expect(body).toMatch(/readLocalSheet\(userId, storageKey\)/);
    expect(body).toMatch(/openProject \? await loadCloudSheet\(projectId\) : await loadOrgWorkbookCloud\(orgWorkbookId\)/);
  });

  it("the local write-through effect writes to storageKey, gated on openWorkbook (not openProject alone)", () => {
    const start = SRC.indexOf("/* Write-through local save");
    const end = SRC.indexOf("/* Best-effort, debounced cloud push", start);
    const body = SRC.slice(start, end);
    expect(body).toMatch(/if \(!ready \|\| !openWorkbook\) return;/);
    expect(body).toMatch(/writeLocalSheet\(userId, storageKey, workbook\)/);
  });

  it("the cloud push effect saves to org_model_sheets (via saveOrgWorkbookCloud) when a project isn't open, and refreshes the local org index on success", () => {
    const start = SRC.indexOf("/* Best-effort, debounced cloud push");
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1600);
    expect(body).toMatch(/await saveOrgWorkbookCloud\(\{ uid: userId, id: orgWorkbookId, name: orgWorkbookName, sheet: workbook, expected: cloudVersionRef\.current \}\)/);
    expect(body).toMatch(/touchLocalOrgIndex\(userId, \{ id: orgWorkbookId, name: orgWorkbookName, updatedAt: Date\.now\(\) \}\)/);
  });
});

describe("ModelApp.jsx — the render branches on openWorkbook first, then orgMode, then the plain empty state", () => {
  it("openWorkbook shows the grid; orgMode-with-nothing-open shows the picker; otherwise the plain empty state", () => {
    const openWorkbookAt = SRC.indexOf("\n      {openWorkbook ? (");
    const orgBranchAt = SRC.indexOf(") : orgMode ? (");
    const pickerAt = SRC.indexOf("<OrgWorkbookPicker");
    const emptyBranchAt = SRC.indexOf("<EmptyProjectState onGoDashboard={onGoDashboard} />");
    expect(openWorkbookAt).toBeGreaterThan(-1);
    expect(orgBranchAt).toBeGreaterThan(openWorkbookAt);
    expect(pickerAt).toBeGreaterThan(orgBranchAt);
    expect(emptyBranchAt).toBeGreaterThan(pickerAt);
  });

  it("AppHeader receives org={org} so the breadcrumb reads Organization, matching every other org-capable workspace", () => {
    expect(SRC).toMatch(/org=\{org\}/);
  });
});
