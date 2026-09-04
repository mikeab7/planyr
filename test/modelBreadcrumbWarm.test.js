/* B1076480 — the Model workspace's breadcrumb showed the literal word "Project" instead of the
 * real project name. Root cause: ModelApp.jsx computed `projectName` from a single, un-refreshed
 * `listProjects()` call, with no warm-on-mount or change subscription — the only workspace that
 * didn't (Notes.jsx and Scheduler.jsx both warm the on-device project cache on mount).
 *
 * ⛔ WHY THIS IS A SOURCE GUARD, NOT AN e2e ONE: `ProjectBreadcrumb.jsx` (the shared component
 * ModelApp feeds `currentProject` into) ALREADY warms and self-heals its OWN internal project list
 * on mount and on any `storage` event — independently of anything ModelApp does. That pre-existing
 * mechanism means a live-browser test that simulates "the cache got updated" (by writing localStorage
 * and dispatching the storage event ProjectBreadcrumb already listens for) is satisfied by
 * ProjectBreadcrumb alone and CANNOT isolate ModelApp's own contribution — confirmed by mutation
 * testing: e2e/model-spreadsheet.spec.js's breadcrumb spec stayed green even with ModelApp.jsx's
 * fix fully reverted. That e2e spec is still a real, valid regression guard for the USER-VISIBLE
 * symptom (the breadcrumb must not stay stuck on "Project" forever); it does not by itself prove
 * this file's specific change is load-bearing, so we prove that here instead.
 *
 * What ModelApp's OWN fix specifically adds, and why it matters even though ProjectBreadcrumb
 * already self-heals: ProjectBreadcrumb's mount-time warm (`warmProjectsIfEmpty`, gated on the
 * WHOLE on-device cache being empty) does not help the documented B853266 case — a cache that
 * already holds OTHER projects but is simply missing/stale for THIS one, which only
 * `reconcileProjects()` (an always-pull, no empty-cache gate) resolves, and previously only ran
 * when the project SWITCHER DROPDOWN was opened, never for the workspace's own crumb TEXT.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync("src/workspaces/model/ModelApp.jsx", "utf8");

describe("B1076480 — ModelApp warms + self-heals the on-device project cache on mount", () => {
  it("imports reconcileProjects (the always-pull sibling — NOT just warmProjectsIfEmpty, which no-ops on a diverged-but-non-empty cache) and onProjectsChanged", () => {
    expect(src).toMatch(/import\s*\{[^}]*\breconcileProjects\b[^}]*\}\s*from\s*["']\.\.\/\.\.\/shared\/projects\/projects\.js["']/);
    expect(src).toMatch(/import\s*\{[^}]*\bonProjectsChanged\b[^}]*\}\s*from\s*["']\.\.\/\.\.\/shared\/projects\/projects\.js["']/);
  });

  it("calls reconcileProjects() inside a mount effect (an empty dependency array), not gated behind an emptiness check", () => {
    const effectBlock = (() => {
      const i = src.indexOf("useEffect(() => {\n    let live = true;");
      expect(i, "could not find the project-cache-warm mount effect").toBeGreaterThan(-1);
      const end = src.indexOf("}, []);", i);
      return src.slice(i, end + "}, []);".length);
    })();
    expect(effectBlock).toMatch(/reconcileProjects\(\)/);
    expect(effectBlock).toMatch(/onProjectsChanged\(/);
    expect(effectBlock.trim().endsWith("}, []);")).toBe(true); // runs once on mount, not on every render
  });

  it("the fallback breadcrumb string is never the bare placeholder word 'Project' (B848833/NEW-2 — sanity, proves the guard is pinned to the right code)", () => {
    expect(src).toMatch(/name:\s*projectName\s*\|\|\s*"Untitled project"/);
    expect(src).not.toMatch(/name:\s*projectName\s*\|\|\s*"Project"/);
  });
});
