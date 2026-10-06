/* NEW-1 (B217540 recurrence ×2) — a render does not read the disk for a plan's name.
 * `usePlanName` is called from the Site Planner's render body, so its getSnapshot (`planNameOf`) runs every frame of a
 * drag; it used to parse the whole device store each time. It now rides the project-name index's one pass and one cache. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const calls = { n: 0 };
let rows = [];
vi.mock("../src/workspaces/site-planner/lib/siteListLight.js", () => ({ loadSiteSummaries: () => { calls.n++; return rows; } }));

const names = await import("../src/shared/names/names.js");

beforeEach(() => { calls.n = 0; names.invalidateNameIndex(); rows = [{ id: "p1", groupId: "g1", site: "Goose Creek", name: "Phase II" }, { id: "p2", groupId: "g1", site: "Goose Creek", name: "Concept B" }]; });

describe("planNameOf / projectNameOf share one cached pass", () => {
  it("fifty plan-name reads (fifty renders) read the store ONCE", () => {
    for (let i = 0; i < 50; i++) expect(names.planNameOf("p1", "x")).toBe("Phase II");
    expect(calls.n).toBe(1);
  });
  it("project and plan lookups share that pass", () => {
    names.planNameOf("p1"); names.projectNameOf("g1"); names.planNameOf("p2");
    expect(calls.n).toBe(1);
    expect(names.projectNameOf("g1")).toBe("Goose Creek");
    expect(names.planNameOf("p2")).toBe("Concept B");
  });
  it("the app's own 'list moved' signal invalidates it — a rename still reaches every reader at once", () => {
    expect(names.planNameOf("p1")).toBe("Phase II");
    rows = [{ id: "p1", groupId: "g1", site: "Goose Creek", name: "Renamed" }];
    names.invalidateNameIndex();                 // what the app's `onProjectsChanged` signal calls (wiring asserted below)
    expect(names.planNameOf("p1")).toBe("Renamed");
    expect(calls.n).toBe(2);
  });
  it("an unknown plan answers the caller's fallback, never a stale or invented name", () => {
    expect(names.planNameOf("nope", "Untitled plan")).toBe("Untitled plan");
  });
});

describe("source guard", () => {
  const src = readFileSync(fileURLToPath(new URL("../src/shared/names/names.js", import.meta.url)), "utf8");
  it("the invalidation is wired to the app's one signal, for BOTH indexes", () => {
    expect(src).toContain("onProjectsChanged(invalidateNameIndex)");
    expect(src).toMatch(/function invalidateNameIndex\(\) \{ nameIndex = null; planIndex = null; \}/);
  });
  it("planNameOf no longer calls loadSiteSummaries itself", () => {
    const body = src.slice(src.indexOf("export function planNameOf"), src.indexOf("const subscribeAll"));
    expect(body).not.toContain("loadSiteSummaries");
    expect(body).toContain("allPlanNames()");
  });
});
