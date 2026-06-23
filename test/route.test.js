import { describe, it, expect } from "vitest";
import { parseRoute, buildHash, sameRoute, DEFAULT_MODULE } from "../src/app/route.js";

describe("parseRoute", () => {
  it("empty / root hash is the dashboard (default module, no project)", () => {
    for (const h of ["", "#", "#/", "#//"]) {
      expect(parseRoute(h)).toEqual({ module: "site-planner", projectId: null, cross: false });
    }
  });

  it("a bare module slug is that module with no project", () => {
    expect(parseRoute("#/markup")).toEqual({ module: "doc-review", projectId: null, cross: false });
    expect(parseRoute("#/schedule")).toEqual({ module: "scheduler", projectId: null, cross: false });
    expect(parseRoute("#/site")).toEqual({ module: "site-planner", projectId: null, cross: false });
  });

  it("project + module carries the id and resolves the module", () => {
    expect(parseRoute("#/project/mesa/markup")).toEqual({ module: "doc-review", projectId: "mesa", cross: false });
    expect(parseRoute("#/project/s123/site")).toEqual({ module: "site-planner", projectId: "s123", cross: false });
  });

  it("cross-project mode sets cross and no project", () => {
    expect(parseRoute("#/all/markup")).toEqual({ module: "doc-review", projectId: null, cross: true });
  });

  it("decodes an encoded project id", () => {
    expect(parseRoute("#/project/a%2Fb%20c/markup").projectId).toBe("a/b c");
  });

  it("an unknown module slug falls back to the default module (never throws)", () => {
    expect(parseRoute("#/bogus").module).toBe(DEFAULT_MODULE);
    expect(parseRoute("#/project/x/bogus").module).toBe(DEFAULT_MODULE);
    expect(parseRoute("#/project/x").module).toBe(DEFAULT_MODULE); // missing module slug
  });
});

describe("buildHash", () => {
  it("dashboard (default module, no project) is the clean #/", () => {
    expect(buildHash({ module: "site-planner", projectId: null })).toBe("#/");
    expect(buildHash({})).toBe("#/");
  });

  it("a non-default module with no project names its slug", () => {
    expect(buildHash({ module: "doc-review" })).toBe("#/markup");
    expect(buildHash({ module: "scheduler" })).toBe("#/schedule");
  });

  it("project + module", () => {
    expect(buildHash({ module: "doc-review", projectId: "mesa" })).toBe("#/project/mesa/markup");
    expect(buildHash({ module: "site-planner", projectId: "s1" })).toBe("#/project/s1/site");
  });

  it("cross-project mode wins over a project id", () => {
    expect(buildHash({ module: "doc-review", cross: true, projectId: "mesa" })).toBe("#/all/markup");
  });

  it("encodes a project id with reserved characters", () => {
    expect(buildHash({ module: "doc-review", projectId: "a/b c" })).toBe("#/project/a%2Fb%20c/markup");
  });
});

describe("round-trip parse <-> build", () => {
  for (const r of [
    { module: "site-planner", projectId: null, cross: false },
    { module: "doc-review", projectId: null, cross: false },
    { module: "scheduler", projectId: null, cross: false },
    { module: "doc-review", projectId: "mesa", cross: false },
    { module: "site-planner", projectId: "s-9zx", cross: false },
    { module: "doc-review", projectId: null, cross: true },
  ]) {
    it(`${JSON.stringify(r)} survives build->parse`, () => {
      expect(parseRoute(buildHash(r))).toEqual(r);
    });
  }
});

describe("sameRoute", () => {
  it("treats null/absent project the same", () => {
    expect(sameRoute({ module: "doc-review", projectId: null, cross: false }, { module: "doc-review" })).toBe(true);
  });
  it("distinguishes module, project, and cross", () => {
    expect(sameRoute({ module: "doc-review", projectId: "a" }, { module: "doc-review", projectId: "b" })).toBe(false);
    expect(sameRoute({ module: "site-planner" }, { module: "doc-review" })).toBe(false);
    expect(sameRoute({ module: "doc-review", cross: true }, { module: "doc-review", cross: false })).toBe(false);
  });
});
