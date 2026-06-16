import { describe, it, expect } from "vitest";
import { mergePulledSites } from "../src/workspaces/site-planner/lib/storage.js";

// Regression guard for B124: pullCloud used to rebuild the local cache from the cloud
// list ALONE, silently dropping any local site the cloud hadn't returned yet (a push
// that hadn't landed / a brand-new site). mergePulledSites must keep local-only work.
const rec = (id, updatedAt, extra = {}) => ({ id, updatedAt, ...extra });

describe("mergePulledSites — pullCloud must never drop local-only work (B124)", () => {
  it("preserves a local site the cloud didn't return, and flags it to re-push", () => {
    const { map, toPush } = mergePulledSites({ a: rec("a", 100) }, []); // cloud returned nothing
    expect(map.a).toBeTruthy();
    expect(map.a.id).toBe("a");
    expect(toPush).toContain("a"); // re-push so it actually reaches the cloud
  });

  it("adds cloud-only records without scheduling a redundant push", () => {
    const { map, toPush } = mergePulledSites({}, [rec("b", 200)]);
    expect(map.b).toBeTruthy();
    expect(toPush).not.toContain("b");
  });

  it("newer-wins: cloud-newer overlays local; local-newer is kept AND re-pushed", () => {
    const existing = { a: rec("a", 100), b: rec("b", 999) };
    const cloud = [rec("a", 500), rec("b", 100)];
    const { map, toPush } = mergePulledSites(existing, cloud);
    expect(map.a.updatedAt).toBe(500); // cloud newer wins
    expect(map.b.updatedAt).toBe(999); // local newer kept
    expect(toPush).toContain("b");
    expect(toPush).not.toContain("a");
  });

  it("a tie goes to the cloud and needs no push", () => {
    const { map, toPush } = mergePulledSites({ a: rec("a", 100) }, [rec("a", 100)]);
    expect(map.a.updatedAt).toBe(100);
    expect(toPush).not.toContain("a");
  });

  it("keeps the UNION of local and cloud ids — nothing is ever lost", () => {
    const existing = { a: rec("a", 1), b: rec("b", 1) };
    const cloud = [rec("b", 2), rec("c", 2)];
    const { map } = mergePulledSites(existing, cloud);
    expect(Object.keys(map).sort()).toEqual(["a", "b", "c"]);
  });

  it("tolerates empty / missing inputs", () => {
    expect(mergePulledSites(undefined, undefined).map).toEqual({});
    expect(mergePulledSites({}, []).toPush).toEqual([]);
  });
});
