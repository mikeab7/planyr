import { describe, it, expect } from "vitest";
import { slimForCloud, headerSig } from "../src/workspaces/site-planner/lib/cloudSync.js";
import { mergePulledSites } from "../src/workspaces/site-planner/lib/storage.js";

// B672 — the cloud `sites.data` row is a SLIM HEADER: element collections live as site_elements
// rows and are stripped before every push. These tests hold the two sides together:
//   1. slimForCloud always strips the 5 vector collections + marks the row `elementsInRows`.
//   2. mergePulledSites understands a slim row — local elements are KEPT (empty ≠ deleted), the
//      boot re-push compares HEADER content only (no perma-push), and a slim row's stale
//      deletedIds can never drop a row-restored element.
// Successor to the retired B459 thin-clobber guard suite: the "8 South" whole-doc data-loss class
// is now structurally impossible through the header, because the header no longer carries elements.

const fullModel = (over = {}) => ({
  id: "s1",
  name: "Concept A",
  updatedAt: 1000,
  els: [{ id: "e1", type: "building", z: 0 }, { id: "e2", type: "road", z: 1024 }],
  markups: [{ id: "m1", kind: "polyline", z: 0 }],
  measures: [{ id: "d1", z: 0 }],
  callouts: [{ id: "c1", z: 0 }],
  parcels: [{ id: "p1", points: [{ x: 0, y: 0 }], z: 0 }],
  sheetOverlays: [{ id: "ov1", x: 1, y: 2 }],
  deletedIds: ["ghost-1"],
  settings: { grid: true },
  ...over,
});

describe("slimForCloud — the header write carries NO elements", () => {
  it("strips the 5 vector collections, marks elementsInRows, keeps header content", () => {
    const slim = slimForCloud(fullModel());
    expect(slim.els).toEqual([]);
    expect(slim.markups).toEqual([]);
    expect(slim.measures).toEqual([]);
    expect(slim.callouts).toEqual([]);
    expect(slim.parcels).toEqual([]);
    expect(slim.elementsInRows).toBe(true);
    expect(slim.sheetOverlays).toEqual([{ id: "ov1", x: 1, y: 2 }]); // header-side collection kept
    expect(slim.settings).toEqual({ grid: true });
    expect(slim.deletedIds).toEqual(["ghost-1"]); // rides along for header-side tombstones
  });

  it("never mutates the input model (the canvas keeps its elements)", () => {
    const m = fullModel();
    slimForCloud(m);
    expect(m.els).toHaveLength(2);
    expect(m.elementsInRows).toBeUndefined();
  });

  it("still strips inline dataURL rasters (the pre-B672 behavior is preserved)", () => {
    const slim = slimForCloud(fullModel({ underlay: { src: "data:image/png;base64,xxx", x: 0 } }));
    expect(slim.underlay.src).toBeNull();
    expect(slim.underlay.strippedForCloud).toBe(true);
  });
});

describe("mergePulledSites — slim cloud rows (elementsInRows)", () => {
  const slimCloud = (over = {}) => ({
    ...fullModel({ els: [], markups: [], measures: [], callouts: [], parcels: [], elementsInRows: true }),
    ...over,
  });

  it("keeps the LOCAL elements when the cloud row is slim (empty ≠ deleted)", () => {
    const { map } = mergePulledSites({ s1: fullModel() }, [slimCloud({ updatedAt: 2000 })], null);
    expect(map.s1.els.map((e) => e.id)).toEqual(["e1", "e2"]);
    expect(map.s1.parcels.map((p) => p.id)).toEqual(["p1"]);
  });

  it("does NOT perma-re-push a slim row when header content matches (no version churn)", () => {
    const { toPush } = mergePulledSites({ s1: fullModel() }, [slimCloud({ updatedAt: 2000 })], null);
    expect(toPush).not.toContain("s1");
  });

  it("DOES re-push when header content genuinely differs (a NEWER local overlay move the cloud lacks)", () => {
    const local = fullModel({ sheetOverlays: [{ id: "ov1", x: 99, y: 2 }], updatedAt: 3000 }); // local is newer
    const { toPush } = mergePulledSites({ s1: local }, [slimCloud({ updatedAt: 2000 })], null);
    expect(toPush).toContain("s1"); // merged header (local's overlay position wins) ≠ cloud header → heal
  });

  it("a slim row's stale deletedIds can NEVER drop a row-restored local element", () => {
    // e1 was deleted then RESTORED via the rows path; the slim header still lists it in deletedIds.
    const local = fullModel({ deletedIds: [] }); // local already reconciled (e1 live)
    const cloud = slimCloud({ updatedAt: 2000, deletedIds: ["e1"] });
    const { map } = mergePulledSites({ s1: local }, [cloud], null);
    expect(map.s1.els.some((e) => e.id === "e1")).toBe(true); // survived the union
  });

  it("a FULL pre-cutover cloud row still merges + compares exactly as before", () => {
    const cloudFull = fullModel({ els: [{ id: "e1", type: "building", z: 0 }], updatedAt: 500 }); // cloud missing e2
    const { map, toPush } = mergePulledSites({ s1: fullModel() }, [cloudFull], null);
    expect(map.s1.els.map((e) => e.id).sort()).toEqual(["e1", "e2"]); // union keeps both
    expect(toPush).toContain("s1"); // merged is fuller than the cloud → heal (the pre-B672 behavior)
  });

  it("a slim row on a NEW device (no local copy) lands as the slim model — elements arrive via the rows refetch", () => {
    const { map, toPush } = mergePulledSites({}, [slimCloud()], null);
    expect(map.s1.els).toEqual([]); // mirror boots empty; refetchReplace paints from rows
    expect(toPush).not.toContain("s1");
  });
});

// B672 recurrence (Observation A) — the header-content signature that lets cloudUpsert SKIP a
// push whose slim header is unchanged. Under element sync the autosave runs on every element
// edit; without this skip each edit bumped sites.version and CAS-ping-ponged every other tab.
describe("headerSig — element edits don't touch the sites row", () => {
  it("is INSENSITIVE to element-collection changes and to updatedAt (the element-edit autosave case)", () => {
    const before = fullModel();
    const after = fullModel({
      els: [{ id: "e1", type: "building", z: 0, cx: 500 }], // element moved…
      updatedAt: 99999,                                     // …and the model timestamp advanced
    });
    expect(headerSig(after)).toBe(headerSig(before)); // → same header content → push skipped
  });

  it("CHANGES when real header content changes (an overlay move, a settings flip, a rename)", () => {
    const base = fullModel();
    expect(headerSig(fullModel({ sheetOverlays: [{ id: "ov1", x: 99, y: 2 }] }))).not.toBe(headerSig(base));
    expect(headerSig(fullModel({ settings: { grid: false } }))).not.toBe(headerSig(base));
    expect(headerSig(fullModel({ name: "Concept B" }))).not.toBe(headerSig(base));
  });

  it("is key-order-insensitive (a cloud round-trip through jsonb can't fake a change)", () => {
    const a = fullModel({ settings: { grid: true, snap: 5 } });
    const b = fullModel({ settings: { snap: 5, grid: true } });
    expect(headerSig(a)).toBe(headerSig(b));
  });
});
