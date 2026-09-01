import { describe, it, expect } from "vitest";
import { parseRoute, buildHash, sameRoute, unknownModuleSlug, isAdminRoute, DEFAULT_MODULE } from "../src/app/route.js";

describe("parseRoute", () => {
  it("empty / root hash is the dashboard (default module, no project)", () => {
    for (const h of ["", "#", "#/", "#//"]) {
      expect(parseRoute(h)).toEqual({ module: "site-planner", projectId: null, cross: false, org: false });
    }
  });

  it("a bare module slug is that module with no project", () => {
    expect(parseRoute("#/markup")).toEqual({ module: "doc-review", projectId: null, cross: false, org: false });
    expect(parseRoute("#/schedule")).toEqual({ module: "scheduler", projectId: null, cross: false, org: false });
    expect(parseRoute("#/site")).toEqual({ module: "site-planner", projectId: null, cross: false, org: false });
  });

  it("project + module carries the id and resolves the module", () => {
    expect(parseRoute("#/project/mesa/markup")).toEqual({ module: "doc-review", projectId: "mesa", cross: false, org: false });
    expect(parseRoute("#/project/s123/site")).toEqual({ module: "site-planner", projectId: "s123", cross: false, org: false });
  });

  it("cross-project mode sets cross and no project", () => {
    expect(parseRoute("#/all/markup")).toEqual({ module: "doc-review", projectId: null, cross: true, org: false });
  });

  // ORG SCOPE (NEW-1) — a real, distinct scope: its own hash segment, never spelled as a
  // sentinel projectId, never conflated with `cross`.
  it("org mode sets org and no project, and is never conflated with cross", () => {
    expect(parseRoute("#/org/notes")).toEqual({ module: "notes", projectId: null, cross: false, org: true });
    expect(parseRoute("#/org/library")).toEqual({ module: "library", projectId: null, cross: false, org: true });
  });

  it("decodes an encoded project id", () => {
    expect(parseRoute("#/project/a%2Fb%20c/markup").projectId).toBe("a/b c");
  });

  it("an unknown module slug falls back to the default module (never throws)", () => {
    expect(parseRoute("#/bogus").module).toBe(DEFAULT_MODULE);
    expect(parseRoute("#/project/x/bogus").module).toBe(DEFAULT_MODULE);
    expect(parseRoute("#/project/x").module).toBe(DEFAULT_MODULE); // missing module slug
    expect(parseRoute("#/org/bogus").module).toBe(DEFAULT_MODULE);
  });
});

/* B1373 — the fallback above is what let `#/notes` open silently on a build with no Notes.
 * Tolerance stays (nothing throws); the miss is now REPORTABLE so the shell can offer a
 * reload instead of pretending the link resolved. */
describe("unknownModuleSlug", () => {
  it("reports the slug this build could not resolve, in every hash shape", () => {
    expect(unknownModuleSlug("#/notquiteamodule")).toBe("notquiteamodule");
    expect(unknownModuleSlug("#/project/abc/notquiteamodule")).toBe("notquiteamodule");
    expect(unknownModuleSlug("#/all/notquiteamodule")).toBe("notquiteamodule");
  });

  it("is silent for every route this build DOES know, including the shorthands", () => {
    for (const h of ["", "#", "#/", "#/site", "#/notes", "#/markup", "#/schedule", "#/library",
      "#/project/abc/notes", "#/all/markup", "#/project/abc"]) {
      expect(unknownModuleSlug(h)).toBe(null);
    }
  });

  // B711904 (NEW-1) — "admin" is a real, resolvable destination (see isAdminRoute below)
  // even though it's deliberately absent from MODULE_BY_SLUG. It must never trip the
  // "newer build available" banner — that banner is the one behavioral tell that would
  // distinguish "admin" from a random typo for a visitor who isn't on the allowlist.
  it("never flags 'admin' as an unresolved slug", () => {
    expect(unknownModuleSlug("#/admin")).toBe(null);
  });
});

// B711904 (NEW-1) — the admin page is intentionally NOT a module: Shell.jsx checks the raw
// hash directly (isAdminRoute) rather than routing "admin" through MODULE_BY_SLUG, so an
// unauthorized visit is indistinguishable from any other route this build doesn't know.
describe("isAdminRoute", () => {
  it("recognizes #/admin in every shape parseRoute would otherwise accept", () => {
    expect(isAdminRoute("#/admin")).toBe(true);
    expect(isAdminRoute("admin")).toBe(true); // tolerant of a missing leading '#'
  });

  it("is false for everything else, including near-misses", () => {
    for (const h of ["", "#", "#/", "#/site", "#/administrator", "#/project/admin/site", "#/all/admin"]) {
      expect(isAdminRoute(h)).toBe(false);
    }
  });

  it("parseRoute treats #/admin exactly like any other unresolved slug — DEFAULT_MODULE, no project", () => {
    expect(parseRoute("#/admin")).toEqual({ module: DEFAULT_MODULE, projectId: null, cross: false, org: false });
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

  // ORG SCOPE (NEW-1) — its own segment, and it wins over a stale project id the same way cross does.
  it("org mode wins over a project id and names the org segment", () => {
    expect(buildHash({ module: "notes", org: true })).toBe("#/org/notes");
    expect(buildHash({ module: "notes", org: true, projectId: "mesa" })).toBe("#/org/notes");
  });

  it("encodes a project id with reserved characters", () => {
    expect(buildHash({ module: "doc-review", projectId: "a/b c" })).toBe("#/project/a%2Fb%20c/markup");
  });
});

describe("round-trip parse <-> build", () => {
  for (const r of [
    { module: "site-planner", projectId: null, cross: false, org: false },
    { module: "doc-review", projectId: null, cross: false, org: false },
    { module: "scheduler", projectId: null, cross: false, org: false },
    { module: "doc-review", projectId: "mesa", cross: false, org: false },
    { module: "site-planner", projectId: "s-9zx", cross: false, org: false },
    { module: "doc-review", projectId: null, cross: true, org: false },
    { module: "notes", projectId: null, cross: false, org: true },
    { module: "library", projectId: null, cross: false, org: true },
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
  it("distinguishes module, project, cross, and org", () => {
    expect(sameRoute({ module: "doc-review", projectId: "a" }, { module: "doc-review", projectId: "b" })).toBe(false);
    expect(sameRoute({ module: "site-planner" }, { module: "doc-review" })).toBe(false);
    expect(sameRoute({ module: "doc-review", cross: true }, { module: "doc-review", cross: false })).toBe(false);
    expect(sameRoute({ module: "notes", org: true }, { module: "notes", org: false })).toBe(false);
  });
});
