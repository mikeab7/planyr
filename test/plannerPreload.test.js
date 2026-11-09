/* B329408 — the plan-editor preload (scripts/vite-plugin-planner-preload.mjs): the inline script adds modulepreload tags ONLY when the page is
 * opening ON a plan, finds the editor chunk by the module it holds, and fails the BUILD when it cannot. */
import { describe, it, expect } from "vitest";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { plannerChunkSet, plannerPreloadScript } from "../scripts/vite-plugin-planner-preload.mjs";
import { LAST_ROUTE_KEY } from "../scripts/vite-plugin-spreadsheet-preload.mjs";

const chunk = (fileName, modules = {}, imports = [], facadeModuleId = null) => ({ type: "chunk", fileName, modules, imports, facadeModuleId });
const bundle = () => ({
  "assets/index-A.js": chunk("assets/index-A.js", { "/r/src/main.jsx": 1 }, []),
  "assets/SitePlannerApp-B.js": chunk("assets/SitePlannerApp-B.js", { "/r/src/workspaces/site-planner/SitePlannerApp.jsx": 1 }, ["assets/shared-C.js"]),
  "assets/SitePlanner-D.js": chunk("assets/SitePlanner-D.js", { "/r/src/workspaces/site-planner/SitePlanner.jsx": 1 }, ["assets/shared-C.js", "assets/only-E.js"], "/r/src/workspaces/site-planner/SitePlanner.jsx"),
  "assets/shared-C.js": chunk("assets/shared-C.js"),
  "assets/only-E.js": chunk("assets/only-E.js"),
});

describe("plannerChunkSet", () => {
  it("is the editor chunk and its static closure — not the workspace chunk, not the entry", () => {
    expect(plannerChunkSet(bundle()).sort()).toEqual(["assets/SitePlanner-D.js", "assets/only-E.js", "assets/shared-C.js"]);
  });
  it("finds the chunk by the module it holds even when rollup dropped the facade", () => {
    const b = bundle(); b["assets/SitePlanner-D.js"].facadeModuleId = null;
    expect(plannerChunkSet(b)).toContain("assets/SitePlanner-D.js");
  });
  it("FAILS the build when the editor chunk cannot be found (a silent skip would quietly turn the preload off)", () => {
    const b = bundle(); delete b["assets/SitePlanner-D.js"];
    expect(() => plannerChunkSet(b)).toThrow(/plan editor chunk/);
  });
});

function run(script, { hash = "", lastRoute = null } = {}) {
  const added = [];
  const ctx = { location: { hash }, localStorage: { getItem: (k) => (k === LAST_ROUTE_KEY ? lastRoute : null) },
    document: { createElement: () => ({}), head: { appendChild: (l) => added.push(l) } } };
  vm.runInNewContext(script, ctx);
  return added;
}
describe("plannerPreloadScript — only a page opening on a plan pays", () => {
  const script = plannerPreloadScript(["assets/SitePlanner-D.js", "assets/shared-C.js"], "/");
  it("adds a modulepreload tag per file for a project-on-Site URL", () => {
    for (const hash of ["#/project/p1/site", "#/project/abc123/site/", "#/project/p1/site?x=1"]) {
      const tags = run(script, { hash });
      expect(tags.map((t) => t.href), hash).toEqual(["/assets/SitePlanner-D.js", "/assets/shared-C.js"]);
      expect(tags.every((t) => t.rel === "modulepreload")).toBe(true);
    }
  });
  it("adds nothing for the map, the dashboard or any other workspace", () => {
    for (const hash of ["#/site", "#/", "#/dashboard", "#/project/p1/schedule", "#/project/p1/spreadsheet", "#/project/p1/notes", "#/library", "#/food", "#/project/p1/sitemap", "#/project//site"]) expect(run(script, { hash }), hash).toEqual([]);
  });
  it("an EMPTY url follows the stored pointer — only if it names the Site module WITH a project", () => {
    expect(run(script, { hash: "", lastRoute: JSON.stringify({ module: "site-planner", projectId: "p1" }) })).toHaveLength(2);
    expect(run(script, { hash: "#", lastRoute: JSON.stringify({ module: "site-planner", projectId: "p1" }) })).toHaveLength(2);
    expect(run(script, { hash: "", lastRoute: JSON.stringify({ module: "site-planner", projectId: null }) })).toEqual([]);
    expect(run(script, { hash: "", lastRoute: JSON.stringify({ module: "model", projectId: "p1" }) })).toEqual([]);
    expect(run(script, { hash: "#/", lastRoute: JSON.stringify({ module: "site-planner", projectId: "p1" }) })).toEqual([]);
  });
  it("never throws: unreadable storage, corrupt pointer", () => {
    expect(() => run(script, { hash: "", lastRoute: "{not json" })).not.toThrow();
    expect(() => vm.runInNewContext(script, { location: { hash: "" }, localStorage: { getItem() { throw new Error("blocked"); } }, document: { createElement: () => ({}), head: { appendChild() {} } } })).not.toThrow();
  });
});

describe("registration", () => {
  it("the app's Vite config registers the plugin", () => {
    expect(readFileSync(new URL("../vite.config.js", import.meta.url), "utf8")).toMatch(/^\s*plannerPreload\(\),/m);
  });
});
