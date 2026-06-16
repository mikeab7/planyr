import { describe, it, expect, beforeEach } from "vitest";
import { mergePulledSites, saveSite, loadSite, snapshotVersion, listVersions, getVersion } from "../src/workspaces/site-planner/lib/storage.js";
import { mergeSiteContent, contentCount } from "../src/workspaces/site-planner/lib/siteModel.js";

// A plain building element (what users mostly lose); `bld("a")` etc.
const bld = (id) => ({ id, type: "building", cx: 0, cy: 0, w: 100, h: 100 });
const site = (id, updatedAt, els = [], extra = {}) => ({ id, updatedAt, els, ...extra });

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

// B126 — the real cure: reconciling two copies of ONE site must UNION their content, so
// a thinner copy (saved last on a stale tab / second device) can never erase a fuller one.
describe("mergeSiteContent — a thinner copy can never erase a fuller one (B126)", () => {
  it("keeps every building present in EITHER copy, even when the thinner one is newer", () => {
    const fatOlder = site("s", 100, [bld("a"), bld("b"), bld("c"), bld("d"), bld("e")]);
    const thinNewer = site("s", 500, [bld("a"), bld("b")]); // newer but missing c,d,e
    const m = mergeSiteContent(fatOlder, thinNewer);
    expect(m.els.map((e) => e.id).sort()).toEqual(["a", "b", "c", "d", "e"]);
    expect(m.updatedAt).toBe(500); // scalar/meta come from the newer copy
  });

  it("unions disjoint buildings drawn separately on two devices", () => {
    const devA = site("s", 200, [bld("a"), bld("b")]);
    const devB = site("s", 100, [bld("c"), bld("d")]);
    const m = mergeSiteContent(devA, devB);
    expect(m.els.map((e) => e.id).sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("newer wins on a per-id conflict (a moved building keeps its newer position)", () => {
    const older = site("s", 100, [{ ...bld("a"), cx: 0 }]);
    const newer = site("s", 200, [{ ...bld("a"), cx: 999 }]);
    expect(mergeSiteContent(older, newer).els[0].cx).toBe(999);
  });

  it("heals a stripped drawing image from the copy that still has it", () => {
    const withImg = site("s", 100, [], { parcelDrawings: [{ id: "d", src: "data:image/png;base64,XXX" }] });
    const stripped = site("s", 500, [], { parcelDrawings: [{ id: "d", src: null, strippedForCloud: true }] });
    const m = mergeSiteContent(withImg, stripped);
    expect(m.parcelDrawings[0].src).toBe("data:image/png;base64,XXX");
  });
});

describe("mergePulledSites — content merge end-to-end (B126)", () => {
  it("a newer-but-thinner cloud copy cannot thin a fuller local one; the union re-pushes", () => {
    const existing = { s: site("s", 100, [bld("a"), bld("b"), bld("c"), bld("d"), bld("e")]) };
    const cloud = [site("s", 500, [bld("a"), bld("b")])]; // cloud newer, fewer buildings
    const { map, toPush } = mergePulledSites(existing, cloud);
    expect(map.s.els.map((e) => e.id).sort()).toEqual(["a", "b", "c", "d", "e"]);
    expect(toPush).toContain("s"); // merged result has MORE than the cloud → push it back
  });
});

// B126 — automatic local backups: each save snapshots the prior version so any
// overwrite (including a thin one) is recoverable.
describe("version history — every save backs up the prior version (B126)", () => {
  beforeEach(() => {
    const store = {};
    globalThis.localStorage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
      clear: () => { for (const k of Object.keys(store)) delete store[k]; },
      key: (i) => Object.keys(store)[i] ?? null,
      get length() { return Object.keys(store).length; },
    };
  });

  it("a thinning save leaves the fat version restorable", () => {
    saveSite({ id: "s", site: "SCHIEL", els: [bld("a"), bld("b"), bld("c"), bld("d"), bld("e")] }); // fat
    saveSite({ id: "s", site: "SCHIEL", els: [bld("a"), bld("b")] }); // oops — thinned to 2
    expect(loadSite("s").els.length).toBe(2); // live record is the thin one
    const versions = listVersions("s");
    expect(versions.length).toBeGreaterThanOrEqual(1);
    expect(versions[0].buildings).toBe(5); // the prior fat version was captured
    const restored = getVersion("s", versions[0].at);
    expect(restored.els.map((e) => e.id).sort()).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("de-dupes identical-shape saves so the ring stays meaningful", () => {
    saveSite({ id: "s", els: [bld("a"), bld("b")] });
    saveSite({ id: "s", els: [bld("a"), bld("b")] }); // same shape — no new snapshot
    saveSite({ id: "s", els: [bld("a"), bld("b")] });
    expect(listVersions("s").length).toBe(1);
  });

  it("contentCount tallies drawn work across collections", () => {
    expect(contentCount({ els: [bld("a")], parcels: [{ id: "p" }] })).toBe(2);
  });
});
