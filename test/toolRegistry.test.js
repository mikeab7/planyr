import { describe, it, expect } from "vitest";
import { ARM_POLICY, SITE_TOOL_ALIAS, canonicalToolId, hostToolId, nextToolAfterCommit } from "../src/shared/markup/toolRegistry.js";

/* B423 / NEW-2 — the one sanctioned divergence (arm policy) + the Site Planner tool-id alias. */

describe("arm policy after commit", () => {
  it("Site Planner reverts to Select; Document Review and the Stitcher reuse", () => {
    expect(nextToolAfterCommit("line", "site")).toBe("select");
    expect(nextToolAfterCommit("line", "doc")).toBe("line");
    expect(nextToolAfterCommit("area", "stitch")).toBe("area");
  });
  it("a pointer mode never auto-switches in any workspace", () => {
    expect(nextToolAfterCommit("pan", "site")).toBe("pan");
    expect(nextToolAfterCommit("select", "doc")).toBe("select");
  });
  it("ARM_POLICY records the divergence explicitly", () => {
    expect(ARM_POLICY).toEqual({ site: "revert", doc: "reuse", stitch: "reuse" });
  });
});

describe("Site Planner tool-id alias", () => {
  it("maps prefixed ids to canonical and back", () => {
    expect(canonicalToolId("mline")).toBe("line");
    expect(canonicalToolId("rect")).toBe("rect"); // already canonical
    expect(hostToolId("line", "site")).toBe("mline");
    expect(hostToolId("line", "doc")).toBe("line");
  });
  it("reverting in the Site Planner yields its own Select id (no prefix on select)", () => {
    expect(SITE_TOOL_ALIAS.mpolygon).toBe("polygon");
    expect(nextToolAfterCommit("mpolygon", "site")).toBe("select");
  });
});
