import { describe, it, expect } from "vitest";
import { parseAdminHash, buildAdminHash } from "../src/workspaces/admin/lib/adminRoute.js";
import { SECTIONS } from "../src/workspaces/admin/lib/adminSections.js";
import { isAdminRoute, unknownModuleSlug, readRoute } from "../src/app/route.js";

describe("admin hash sub-routing (NEW-1)", () => {
  it("bare #/admin opens Overview", () => {
    expect(parseAdminHash("#/admin").section).toBe("overview");
    expect(parseAdminHash("#/admin/").section).toBe("overview");
  });
  it("every section round-trips through the hash", () => {
    for (const s of SECTIONS) expect(parseAdminHash(buildAdminHash(s.id)).section).toBe(s.id);
    expect(buildAdminHash("overview")).toBe("#/admin");
    expect(buildAdminHash("users")).toBe("#/admin/users");
  });
  it("an unknown sub-path lands on Overview, not a blank page", () => {
    expect(parseAdminHash("#/admin/nope").section).toBe("overview");
  });
  it("carries a ?user= prefill without it becoming part of the section id", () => {
    const p = parseAdminHash("#/admin/password-reset?user=abc-123");
    expect(p.section).toBe("password-reset");
    expect(p.params).toEqual({ user: "abc-123" });
    expect(buildAdminHash("password-reset", { user: "abc-123" })).toBe("#/admin/password-reset?user=abc-123");
  });
  it("the section order is the owner's", () => {
    expect(SECTIONS.map((s) => s.id)).toEqual(["overview", "users", "issues", "support", "usage", "criteria", "parcel-coverage", "password-reset", "ops"]);
  });
});

describe("non-admin 404-equivalence holds for every sub-path", () => {
  const paths = ["#/admin", "#/admin/users", "#/admin/issues", "#/admin/password-reset?user=x", "#/admin/nope/deeper"];
  it("the shell treats every sub-path as the admin route (the gate, not the route, decides access)", () => {
    for (const h of paths) expect(isAdminRoute(h)).toBe(true);
  });
  it("…and none of them raises the 'newer build' banner that would distinguish it from a typo", () => {
    for (const h of paths) expect(unknownModuleSlug(h)).toBeNull();
  });
  it("…and the workspace route resolves exactly as it does for bare #/admin (same module, nothing admin-specific)", () => {
    const base = readRoute("#/admin");
    for (const h of paths) expect(readRoute(h).module).toBe(base.module);
  });
});
