/* NEW-1 (B2604xxx) — the Spreadsheet preload (scripts/vite-plugin-spreadsheet-preload.mjs): the inline script adds modulePrefetch tags ONLY when the page is
 * opening on the Spreadsheet, finds the right chunks, and fails the BUILD when it cannot. */
import { describe, it, expect } from "vitest";
import vm from "node:vm";
import { spreadsheetChunkSet, preloadScript, LAST_ROUTE_KEY } from "../scripts/vite-plugin-spreadsheet-preload.mjs";
import { readFileSync } from "node:fs";

const chunk = (fileName, facadeModuleId, imports = []) => ({ type: "chunk", fileName, facadeModuleId, imports });
const bundle = () => ({
  "assets/index-A.js": chunk("assets/index-A.js", "/r/src/main.jsx", ["assets/vendor-A.js"]),
  "assets/vendor-A.js": chunk("assets/vendor-A.js", null),
  "assets/ModelApp-B.js": chunk("assets/ModelApp-B.js", "/r/src/workspaces/model/ModelApp.jsx", ["assets/shared-B.js", "assets/vendor-A.js"]),
  "assets/shared-B.js": chunk("assets/shared-B.js", null),
  "assets/UniverSheet-C.js": chunk("assets/UniverSheet-C.js", "/r/src/workspaces/model/components/UniverSheet.jsx", ["assets/univer-C.js"]),
  "assets/univer-C.js": chunk("assets/univer-C.js", null),
  "assets/SitePlannerApp-D.js": chunk("assets/SitePlannerApp-D.js", "/r/src/workspaces/site-planner/SitePlannerApp.jsx"),
});

describe("spreadsheetChunkSet", () => {
  it("is the Model chunk, the grid chunk and their static closure — and nothing else", () => {
    expect(spreadsheetChunkSet(bundle()).sort()).toEqual(["assets/ModelApp-B.js", "assets/UniverSheet-C.js", "assets/shared-B.js", "assets/univer-C.js", "assets/vendor-A.js"]);
  });
  it("FAILS the build when either chunk cannot be found (a silent skip would quietly turn the preload off)", () => {
    const b = bundle(); delete b["assets/UniverSheet-C.js"];
    expect(() => spreadsheetChunkSet(b)).toThrow(/Univer grid chunk/);
    const c = bundle(); delete c["assets/ModelApp-B.js"];
    expect(() => spreadsheetChunkSet(c)).toThrow(/Model workspace chunk/);
  });
});

function run(script, { hash = "", lastRoute = null } = {}) {
  const added = [];
  const ctx = { location: { hash }, localStorage: { getItem: (k) => (k === LAST_ROUTE_KEY ? lastRoute : null) },
    document: { createElement: () => ({}), head: { appendChild: (l) => added.push(l) } } };
  vm.runInNewContext(script, ctx);
  return added;
}
describe("preloadScript — only a page opening on the Spreadsheet pays", () => {
  const script = preloadScript(["assets/ModelApp-B.js", "assets/UniverSheet-C.js"], "/");
  it("adds a modulepreload tag per file for a Spreadsheet URL (current and legacy slug)", () => {
    for (const hash of ["#/project/p1/spreadsheet", "#/spreadsheet", "#/model", "#/project/p1/model/", "#/org/spreadsheet?x=1"]) {
      const tags = run(script, { hash });
      expect(tags.map((t) => t.href), hash).toEqual(["/assets/ModelApp-B.js", "/assets/UniverSheet-C.js"]);
      expect(tags.every((t) => t.rel === "modulepreload")).toBe(true);
    }
  });
  it("adds nothing for any other route", () => {
    for (const hash of ["#/project/p1", "#/site", "#/library", "#/schedule", "#/notes", "#/markup", "#/food", "#/project/p1/spreadsheets-are-not-this"]) expect(run(script, { hash }), hash).toEqual([]);
  });
  it("an EMPTY url follows the stored 'where I left off' pointer — only if it names the Model module", () => {
    expect(run(script, { hash: "", lastRoute: JSON.stringify({ module: "model", projectId: "p1" }) })).toHaveLength(2);
    expect(run(script, { hash: "#", lastRoute: JSON.stringify({ module: "model" }) })).toHaveLength(2);
    expect(run(script, { hash: "", lastRoute: JSON.stringify({ module: "site-planner", projectId: "p1" }) })).toEqual([]);
    expect(run(script, { hash: "#/", lastRoute: JSON.stringify({ module: "model" }) })).toEqual([]);      // an explicit "#/" is a deep link to the dashboard
  });
  it("never throws: unreadable storage, corrupt pointer, no storage at all", () => {
    expect(() => run(script, { hash: "", lastRoute: "{not json" })).not.toThrow();
    const bad = vm.runInNewContext; // a localStorage that throws
    expect(() => bad(script, { location: { hash: "" }, localStorage: { getItem() { throw new Error("blocked"); } }, document: { createElement: () => ({}), head: { appendChild() {} } } })).not.toThrow();
  });
});

describe("registration", () => {
  it("the app's Vite config registers the plugin", () => {
    expect(readFileSync(new URL("../vite.config.js", import.meta.url), "utf8")).toMatch(/^\s*spreadsheetPreload\(\),/m);
  });
});
