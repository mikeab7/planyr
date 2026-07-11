import { describe, it, expect, beforeEach } from "vitest";
import { mergePulledSites, saveSite, loadSite, renameSiteGroup, snapshotVersion, listVersions, getVersion, summarizeVersion, backupNow, pruneMigratedLegacy } from "../src/workspaces/site-planner/lib/storage.js";
import { mergeSiteContent, contentCount, createSiteModel } from "../src/workspaces/site-planner/lib/siteModel.js";
import { idbAvailable } from "../src/workspaces/site-planner/lib/localDb.js";

// B474 faithfulness guard (#31) — this suite runs with IndexedDB ABSENT (no fake-indexeddb import), which
// is the WHOLE POINT: it proves the localStorage path is byte-for-byte the pre-B474 behavior. Pin it
// explicitly so the guarantee can't quietly erode (e.g. someone adding a global idb polyfill to setup).
describe("B474 — the localStorage faithfulness path (IndexedDB genuinely absent here)", () => {
  it("idbAvailable() is false, so dropIdbBackedSrc + the history idb write are no-ops", () => {
    expect(idbAvailable()).toBe(false);
  });
});

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

  it("re-pushes a row whose merge is FULLER than the cloud; an identical row is not pushed (B460)", () => {
    // a: cloud newer, SAME content → cloud scalars win, no push. b: local has a building the cloud
    // lacks → the union is fuller → re-push to heal the cloud.
    const existing = { a: site("a", 100, [bld("x")]), b: site("b", 999, [bld("p"), bld("q")]) };
    const cloud = [site("a", 500, [bld("x")]), site("b", 100, [bld("p")])];
    const { map, toPush } = mergePulledSites(existing, cloud);
    expect(map.a.updatedAt).toBe(500);                          // cloud newer wins (scalars)
    expect(map.b.els.map((e) => e.id).sort()).toEqual(["p", "q"]); // union kept the local-only building
    expect(toPush).toContain("b");                              // merged is fuller → heal
    expect(toPush).not.toContain("a");                          // identical content → no push
  });

  it("does NOT re-push a row that's merely NEWER with identical content (B460 — no spurious version churn)", () => {
    // B458 advances the local updatedAt on every edit while the cloud push lags, so a reload would
    // otherwise re-push identical content, bump `version`, and trip a spurious "changed in another
    // session" conflict in any OTHER open tab. Same content (newer timestamp) must NOT re-push.
    const existing = { a: site("a", 999, [bld("x"), bld("y")]) };
    const cloud = [site("a", 100, [bld("x"), bld("y")])];
    expect(mergePulledSites(existing, cloud).toPush).not.toContain("a");
  });

  it("STILL re-pushes when a tombstoned delete made the merge differ from the cloud (delete heals)", () => {
    // The delete-propagation path the old updatedAt rule covered must survive B460: local deleted b
    // (tombstone) while the cloud still has a+b → the merge differs from the cloud → re-push so the
    // delete reaches the cloud (B459 allows it — the tombstone explains the drop).
    const existing = { s: site("s", 200, [bld("a")], { deletedIds: ["b"] }) };
    const cloud = [site("s", 100, [bld("a"), bld("b")])];
    const { map, toPush } = mergePulledSites(existing, cloud);
    expect(map.s.els.map((e) => e.id)).toEqual(["a"]); // tombstone kept b out
    expect(toPush).toContain("s");                      // the delete must propagate to the cloud
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

// B757 — a deliberately-deleted PLAN must not resurrect on the next pull when its cloud delete
// never landed (offline / transient failure). Durable {id: ts} tombstones suppress the pending
// row in the merge and drive a delete retry; a genuinely-newer cross-device edit overrides.
describe("mergePulledSites — durable record-delete tombstones (B757)", () => {
  it("SUPPRESSES an owned cloud row whose delete is still pending, and flags it for retry", () => {
    // local already removed it (existing {}); the cloud still has it because the delete never landed.
    const { map, deleteRetry, tombClear } = mergePulledSites({}, [site("s", 100, [bld("a")], { ownerId: "u1" })], "u1", { s: 200 });
    expect(map.s).toBeUndefined();          // NOT resurrected
    expect(deleteRetry).toContain("s");     // retry the cloud delete so it actually sticks
    expect(tombClear).not.toContain("s");   // keep the tombstone until the cloud confirms removal
  });

  it("KEEPS the row (and clears the tombstone) when the cloud copy is genuinely NEWER than the delete", () => {
    // A real later edit on another device AFTER our delete → the delete is stale; don't suppress.
    const { map, deleteRetry, tombClear } = mergePulledSites({}, [site("s", 500, [bld("a")], { ownerId: "u1" })], "u1", { s: 200 });
    expect(map.s).toBeTruthy();
    expect(deleteRetry).not.toContain("s");
    expect(tombClear).toContain("s");       // stale tombstone dropped (cross-device safety)
  });

  it("clears a tombstone whose row the cloud no longer has (the delete already landed)", () => {
    const { map, deleteRetry, tombClear } = mergePulledSites({}, [], "u1", { s: 200 });
    expect(map.s).toBeUndefined();
    expect(deleteRetry).toEqual([]);
    expect(tombClear).toContain("s");
  });

  it("does NOT suppress a teammate's shared row we can't delete (it should still show)", () => {
    const { map, deleteRetry, tombClear } = mergePulledSites({}, [site("s", 100, [bld("a")], { ownerId: "someone-else" })], "u1", { s: 200 });
    expect(map.s).toBeTruthy();             // a shared row we don't own stays visible
    expect(deleteRetry).not.toContain("s");
    expect(tombClear).toContain("s");       // give up on it (not ours to delete)
  });

  it("never drops a NON-tombstoned row (no over-suppression)", () => {
    const { map, deleteRetry } = mergePulledSites({}, [site("s", 100, [bld("a")], { ownerId: "u1" })], "u1", { other: 200 });
    expect(map.s).toBeTruthy();
    expect(deleteRetry).toEqual([]);
  });

  it("is byte-for-byte the old behavior when no tombstones are supplied (backward compatible)", () => {
    const { map, toPush, deleteRetry, tombClear } = mergePulledSites({}, [site("s", 100, [bld("a")], { ownerId: "u1" })], "u1");
    expect(map.s).toBeTruthy();
    expect(toPush).not.toContain("s");
    expect(deleteRetry).toEqual([]);
    expect(tombClear).toEqual([]);
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

// B276 — a deliberate delete records a tombstone (`deletedIds`); the merge must honor it so a
// stale/other copy that still has the item can't resurrect it (the documented B126 trade-off, fixed).
describe("mergeSiteContent — delete-tombstones keep a deletion deleted (B276)", () => {
  const ov = (id) => ({ id, name: "sheet", src: "data:img", imgW: 100, imgH: 100, x: 0, y: 0, ftPerPx: 1 });

  it("does NOT resurrect an overlay the newer copy tombstoned, though the older copy still has it", () => {
    const older = site("s", 100, [], { sheetOverlays: [ov("o1")] });            // pre-delete copy still has it
    const newer = site("s", 500, [], { sheetOverlays: [], deletedIds: ["o1"] }); // deleted here
    const m = mergeSiteContent(older, newer);
    expect(m.sheetOverlays.map((o) => o.id)).toEqual([]); // stays deleted
    expect(m.deletedIds).toContain("o1");                  // tombstone carried forward
  });

  it("a tombstone in the OLDER copy still wins (a deletion isn't undone by any copy that still has the item)", () => {
    const older = site("s", 100, [], { sheetOverlays: [], deletedIds: ["o1"] });
    const newer = site("s", 500, [], { sheetOverlays: [ov("o1")] }); // still carries the stale item
    const m = mergeSiteContent(older, newer);
    expect(m.sheetOverlays.map((o) => o.id)).toEqual([]); // either-copy tombstone wins
  });

  it("unions the tombstone sets from both copies", () => {
    const a = site("s", 200, [], { deletedIds: ["o1"] });
    const b = site("s", 100, [], { deletedIds: ["o2"] });
    expect(mergeSiteContent(a, b).deletedIds.sort()).toEqual(["o1", "o2"]);
  });

  it("leaves non-tombstoned overlays alone — the normal union still keeps work from either copy (no regression)", () => {
    const a = site("s", 200, [], { sheetOverlays: [ov("keep")] });
    const b = site("s", 100, [], { sheetOverlays: [ov("alsoKeep")], deletedIds: ["gone"] });
    const m = mergeSiteContent(a, b);
    expect(m.sheetOverlays.map((o) => o.id).sort()).toEqual(["alsoKeep", "keep"]);
  });

  it("generalizes to any drawn item — a tombstoned building stays deleted", () => {
    const older = site("s", 100, [bld("a"), bld("b")]);
    const newer = site("s", 500, [bld("a")], { deletedIds: ["b"] });
    expect(mergeSiteContent(older, newer).els.map((e) => e.id)).toEqual(["a"]);
  });

  // NEW-1 — the owner's exact report: "Remove truck court (+ outer)" drops the court AND its bonded
  // trailer parking + buffer. The delete handler (removeFeature/removeWithChildren) must tombstone the
  // WHOLE cascade — else this merge (forced by "Take over editing here" → fetchSiteForReconcile) unions
  // the still-present cloud copy back and the trailer parking reappears.
  it("does NOT resurrect a whole tombstoned dock-zone cascade (court → trailer → buffer)", () => {
    const court = { id: "court", type: "paving", cx: 0, cy: 0, w: 100, h: 60, truckCourt: { side: "left" }, attachedTo: "b1" };
    const trailer = { id: "trailer", type: "trailer", cx: 0, cy: 0, w: 100, h: 60, forCourt: "court", prevZone: "court", attachedTo: "b1" };
    const buffer = { id: "buffer", type: "landscape", cx: 0, cy: 0, w: 100, h: 10, forTrailer: "trailer", prevZone: "trailer", attachedTo: "b1" };
    const cloudStillHas = site("s", 100, [bld("b1"), court, trailer, buffer]);      // pre-delete copy (cloud)
    const localDeleted = site("s", 500, [bld("b1")], { deletedIds: ["court", "trailer", "buffer"] }); // all three tombstoned
    const m = mergeSiteContent(cloudStillHas, localDeleted);
    expect(m.els.map((e) => e.id).sort()).toEqual(["b1"]);       // building kept, none of the three come back
    expect(m.deletedIds.sort()).toEqual(["buffer", "court", "trailer"]);
  });

  it("end-to-end via mergePulledSites: a locally-deleted dock-zone cascade isn't brought back by the cloud", () => {
    const court = { id: "court", type: "paving", cx: 0, cy: 0, w: 100, h: 60, truckCourt: { side: "left" }, attachedTo: "b1" };
    const trailer = { id: "trailer", type: "trailer", cx: 0, cy: 0, w: 100, h: 60, forCourt: "court", prevZone: "court", attachedTo: "b1" };
    const localDeleted = site("s", 500, [bld("b1")], { deletedIds: ["court", "trailer"] });
    const cloudStillHas = site("s", 100, [bld("b1"), court, trailer]);
    const { map } = mergePulledSites({ s: localDeleted }, [cloudStillHas]);
    expect(map.s.els.map((e) => e.id).sort()).toEqual(["b1"]); // stays deleted across the cloud pull
  });

  // NEW-1 (review follow-ups) — measures / callouts / split-away parcels ALL carry stable uid() ids and
  // are unioned by id in mergeSiteContent, so each delete path now tombstones. Prove none resurrect.
  it("does NOT resurrect a tombstoned measure (measures are unioned by id)", () => {
    const meas = (id) => ({ id, mode: "line", pts: [{ x: 0, y: 0 }, { x: 10, y: 0 }] });
    const older = site("s", 100, [], { measures: [meas("m1"), meas("m2")] });
    const newer = site("s", 500, [], { measures: [meas("m1")], deletedIds: ["m2"] });
    expect(mergeSiteContent(older, newer).measures.map((m) => m.id)).toEqual(["m1"]);
  });

  it("does NOT resurrect a blanked callout, nor a parcel replaced by a split", () => {
    const tri = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    const older = site("s", 100, [], { callouts: [{ id: "c1", text: "note", tip: { x: 0, y: 0 } }], parcels: [{ id: "p1", points: tri }] });
    // c1 blanked; p1 split into pa+pb (source tombstoned) — the review-confirmed callout + parcel-split paths.
    const newer = site("s", 500, [], { callouts: [], parcels: [{ id: "pa", points: tri }, { id: "pb", points: tri }], deletedIds: ["c1", "p1"] });
    const m = mergeSiteContent(older, newer);
    expect(m.callouts.map((c) => c.id)).toEqual([]);                 // blanked callout stays gone
    expect(m.parcels.map((p) => p.id).sort()).toEqual(["pa", "pb"]); // split source not resurrected
  });

  it("end-to-end via mergePulledSites: a locally-deleted overlay isn't brought back by a cloud copy that still has it", () => {
    const localDeleted = site("s", 500, [bld("a")], { sheetOverlays: [], deletedIds: ["o1"] });
    const cloudStillHas = site("s", 100, [bld("a")], { sheetOverlays: [ov("o1")] });
    const { map } = mergePulledSites({ s: localDeleted }, [cloudStillHas]);
    expect(map.s.sheetOverlays.map((o) => o.id)).toEqual([]); // tombstone survives the cloud pull
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

// B453 (NEW-5) — the exact 8 South / Plan 1 incident shape: the on-device autosave mirror
// (which IS the cloud-cache key saveSite writes to) still held 5 buildings, while the cloud
// row had gone road-only (0 buildings) after a thin save won. Boot reconciliation must UNION
// the local mirror with the cloud pull — never blind-replace local with the thin cloud — so
// the buildings survive the reload AND are re-pushed to heal the cloud. This guards the very
// path the data-loss could have finished through.
describe("mergePulledSites — boot reconcile keeps a fuller local mirror over a road-only cloud (B453/NEW-5)", () => {
  const road = { id: "r1", type: "road", cx: 0, cy: 0, w: 100, h: 10 };
  it("5 local buildings + a road survive a 0-building (road-only) cloud row, and re-push", () => {
    const localMirror = { s: site("s", 1000, [bld("a"), bld("b"), bld("c"), bld("d"), bld("e"), road]) };
    const cloudRoadOnly = [site("s", 9999, [road])]; // cloud is newer in time but road-only (thin save won)
    const { map, toPush } = mergePulledSites(localMirror, cloudRoadOnly, "u1");
    const buildings = map.s.els.filter((e) => e.type === "building").map((e) => e.id).sort();
    expect(buildings).toEqual(["a", "b", "c", "d", "e"]); // every building present in EITHER copy is kept
    expect(toPush).toContain("s"); // merged is fuller than the cloud → re-push heals the split
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

// B511 — pruneMigratedLegacy must NOT drop a NEWER on-device (logged-out) site just because an
// OLDER copy already exists in the cloud. Pruning by id-exists alone was silent data loss (edit
// while signed out → sign back in → newer local work deleted before the migration modal saw it).
describe("B511 — pruneMigratedLegacy compares timestamps before deleting", () => {
  const SITES_KEY = "planarfit:sites:v1";
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
  it("keeps a legacy site that is NEWER than the cloud copy", () => {
    localStorage.setItem(SITES_KEY, JSON.stringify({ x: { id: "x", updatedAt: 200, els: [bld("new")] } }));
    pruneMigratedLegacy({ x: { id: "x", updatedAt: 100 } }); // cloud has an OLDER x
    const left = JSON.parse(localStorage.getItem(SITES_KEY));
    expect(left.x).toBeTruthy();              // newer local work survives
    expect(left.x.els[0].id).toBe("new");
  });
  it("prunes a legacy site the cloud has at the same or newer timestamp (B473 reclamation)", () => {
    localStorage.setItem(SITES_KEY, JSON.stringify({ x: { id: "x", updatedAt: 100 }, y: { id: "y", updatedAt: 100 } }));
    pruneMigratedLegacy({ x: { id: "x", updatedAt: 100 }, y: { id: "y", updatedAt: 250 } });
    expect(JSON.parse(localStorage.getItem(SITES_KEY))).toEqual({}); // both reclaimed (cloud same/newer)
  });
  it("keeps a legacy site the cloud doesn't have at all", () => {
    localStorage.setItem(SITES_KEY, JSON.stringify({ z: { id: "z", updatedAt: 50 } }));
    pruneMigratedLegacy({});                  // empty cloud
    expect(JSON.parse(localStorage.getItem(SITES_KEY)).z).toBeTruthy();
  });
});

// B458 — the autosave splits into an IMMEDIATE per-edit local-mirror write (so a reload within the
// 400ms cloud-push debounce can't lose the edit) + a debounced cloud push. The immediate write keeps
// DEFAULT history (it owns the thinning safety net + makes the snapshot reload-safe); the debounced
// settle re-write passes { skipHistory: true } so it can't double-snapshot. These assert the flag.
describe("saveSite skipHistory option (B458)", () => {
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

  it("persists content but takes NO snapshot when skipHistory is set", () => {
    saveSite({ id: "s", els: [bld("a"), bld("b")] });                       // fat (no prior → no snapshot)
    saveSite({ id: "s", els: [bld("a")] }, { skipHistory: true });          // thinned, but skipHistory
    expect(loadSite("s").els.length).toBe(1);                              // content WAS persisted
    expect(listVersions("s").length).toBe(0);                             // the fat version was NOT captured
  });

  it("default save (no flag) still snapshots the prior version", () => {
    saveSite({ id: "s", els: [bld("a"), bld("b")] });                       // fat
    saveSite({ id: "s", els: [bld("a")] });                                // thinned, history ON
    const v = listVersions("s");
    expect(v.length).toBe(1);
    expect(v[0].buildings).toBe(2);                                        // the fat version is restorable
  });

  it("immediate-then-settle (the B458 shape) backs up the prior version exactly once per shape", () => {
    // Mimic the autosave: each edit = an immediate DEFAULT save, then a skipHistory settle re-write.
    saveSite({ id: "s", els: [bld("a"), bld("b"), bld("c")] });             // immediate: 3 (no prior)
    saveSite({ id: "s", els: [bld("a"), bld("b"), bld("c")] }, { skipHistory: true }); // settle
    saveSite({ id: "s", els: [bld("a")] });                                // immediate: thinned to 1 → snapshots the 3
    saveSite({ id: "s", els: [bld("a")] }, { skipHistory: true });          // settle (no double-snapshot)
    const v = listVersions("s");
    expect(v.length).toBe(1);                                             // exactly one snapshot, not two
    expect(v[0].buildings).toBe(3);                                       // the fat (3-building) version is restorable
    expect(getVersion("s", v[0].at).els.map((e) => e.id).sort()).toEqual(["a", "b", "c"]);
  });
});

// B467/NEW-4 — Restore must VERIFY the pre-restore backup persisted before overwriting current work.
// snapshotVersion now reports whether it wrote (so a quota failure is visible to the caller), and
// `force` bypasses the shape-dedup so a same-shape-but-different-content current state is still backed
// up; backupNow drives both so Restore can confirm "your current version is backed up" is true.
describe("snapshotVersion return + backupNow (B467/NEW-4)", () => {
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

  it("returns true on write, false when deduped, and force bypasses the dedup", () => {
    saveSite({ id: "s", els: [bld("a"), bld("b")] });
    const cur = loadSite("s");
    expect(snapshotVersion(cur)).toBe(true);                  // first snapshot of this shape → written
    expect(snapshotVersion(cur)).toBe(false);                 // same shape again → deduped → no write
    expect(snapshotVersion(cur, { force: true })).toBe(true); // force ignores the dedup → a backup is written
  });

  it("backupNow writes a verified backup of the current state when there's real content", () => {
    saveSite({ id: "s", els: [bld("a"), bld("b"), bld("c")] });
    const before = listVersions("s").length;
    expect(backupNow("s")).toBe(true);
    const after = listVersions("s");
    expect(after.length).toBeGreaterThan(before);
    expect(after[0].buildings).toBe(3); // the current 3-building state is the freshest restorable backup
  });

  it("backupNow is a safe true (don't block a restore) when there's nothing at risk", () => {
    expect(backupNow("missing")).toBe(true); // no record → a restore can't lose anything
    saveSite({ id: "e", els: [] });          // an empty record
    expect(backupNow("e")).toBe(true);       // nothing to protect → never block the restore
  });
});

// B456 (NEW-8) — the version-history list read "0 buildings" on every row (it used
// mainBuildingCount, which excludes attached additions) and rows were indistinguishable.
// Now each row gets a real content summary + a true building count, computed from the
// stored model so OLD snapshots benefit too.
describe("summarizeVersion — real building counts + content summary (B456/NEW-8)", () => {
  const attached = (id) => ({ id, type: "building", attachedTo: "a", cx: 0, cy: 0, w: 50, h: 50 });
  const dogEar = (id) => ({ id, type: "building", dogEar: true, cx: 0, cy: 0, w: 10, h: 10 });
  const road = { id: "r", type: "road", cx: 0, cy: 0, w: 100, h: 10 };

  it("counts a building whose pieces are ALL attached (the old code read 0)", () => {
    const { buildings, summary } = summarizeVersion({ els: [bld("a"), attached("b")] });
    expect(buildings).toBe(2);          // a real building + its attached addition
    expect(summary).toContain("2 buildings");
  });

  it("excludes dog-ear sub-pieces from the count", () => {
    expect(summarizeVersion({ els: [bld("a"), dogEar("d")] }).buildings).toBe(1);
  });

  it("builds a distinguishing summary across collections", () => {
    const tri = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }]; // parcels are geometry — the funnel drops points-less ones
    const { summary } = summarizeVersion({ parcels: [{ id: "p1", points: tri }, { id: "p2", points: tri }], els: [road, bld("a")], measures: [{ id: "m" }] });
    expect(summary).toBe("2 parcels · 1 road · 1 building · 1 markup");
  });

  it("never reads a misleading empty string — always reports the building count", () => {
    expect(summarizeVersion({}).summary).toBe("0 buildings");
    expect(summarizeVersion(null).summary).toBe("0 buildings");
  });
});

describe("listVersions — rows carry a summary + de-dupe same-second/same-shape (B456/NEW-8)", () => {
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

  it("each row exposes a content summary string", () => {
    saveSite({ id: "s", els: [bld("a"), bld("b"), bld("c"), bld("d"), bld("e")] }); // fat
    saveSite({ id: "s", els: [bld("a")] });                                          // thinned → snapshots the fat one
    const rows = listVersions("s");
    expect(rows[0].summary).toContain("5 buildings");
    expect(typeof rows[0].at).toBe("number");
  });
});

// rename-revert — renameSiteGroup must rename the WHOLE site whether it's handed the group id
// (the header breadcrumb) OR any plan id within the group (the map's site list passes a
// *representative* plan's id, which for a multi-plan site is often NOT the group's anchor plan).
// Passing a non-anchor plan id used to match no plans → nothing was saved → the name "reverted".
describe("renameSiteGroup — renames the whole site by group id OR any plan id (rename-revert)", () => {
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

  it("renames every plan when given the group (anchor) id — the unchanged header path", () => {
    saveSite({ id: "g1", groupId: "g1", site: "Old", name: "Concept A" }); // anchor plan
    saveSite({ id: "p2", groupId: "g1", site: "Old", name: "Concept B" }); // sibling plan
    renameSiteGroup("g1", "New Name");
    expect(loadSite("g1").site).toBe("New Name");
    expect(loadSite("p2").site).toBe("New Name");
  });

  it("renames the WHOLE site when given a NON-anchor plan id (the map's representative)", () => {
    saveSite({ id: "g1", groupId: "g1", site: "Old", name: "Concept A" }); // anchor plan
    saveSite({ id: "p2", groupId: "g1", site: "Old", name: "Concept B" }); // sibling — the map may pick this as the row
    renameSiteGroup("p2", "New Name"); // the map handed us the sibling plan's id, not the group id
    expect(loadSite("g1").site).toBe("New Name"); // the whole site renamed…
    expect(loadSite("p2").site).toBe("New Name"); // …not just the plan we were handed
  });

  it("renames a single-plan site whose own id is its group id", () => {
    saveSite({ id: "s1", groupId: "s1", site: "Old" });
    renameSiteGroup("s1", "Fresh");
    expect(loadSite("s1").site).toBe("Fresh");
  });

  it("is a harmless no-op (never throws) on an unknown id", () => {
    expect(() => renameSiteGroup("ghost", "X")).not.toThrow();
    expect(loadSite("ghost")).toBeNull();
  });
});

// B127 — a stale tab's save must FOLD into the store (never thin it), while a single tab's
// own delete must still stick. The guard: saveSite merges only when the stored record is
// newer than what this tab last loaded/wrote (another tab advanced it in between).
describe("saveSite — cross-tab stale-write guard (B127)", () => {
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

  it("a stale save (store advanced by another tab) folds in — never thins", () => {
    saveSite({ id: "s", els: [bld("a"), bld("b"), bld("c")] }); // this tab last saw 3
    // simulate ANOTHER tab advancing the same site to 5 buildings with a newer timestamp
    const raw = JSON.parse(localStorage.getItem("planarfit:sites:v1"));
    raw.s.els = [bld("a"), bld("b"), bld("c"), bld("d"), bld("e")];
    raw.s.updatedAt = (raw.s.updatedAt || 0) + 100000;
    localStorage.setItem("planarfit:sites:v1", JSON.stringify(raw));
    // this (stale) tab now saves its old 3-building copy on top — must NOT erase d & e
    saveSite({ id: "s", els: [bld("a"), bld("b"), bld("c")] });
    expect(loadSite("s").els.map((e) => e.id).sort()).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("a single tab's own delete still sticks (the guard is not over-eager)", () => {
    saveSite({ id: "s", els: [bld("a"), bld("b"), bld("c")] });
    saveSite({ id: "s", els: [bld("a"), bld("b")] }); // deleted c in the SAME tab
    expect(loadSite("s").els.map((e) => e.id).sort()).toEqual(["a", "b"]);
  });
});

// B343 — a site-plan overlay's "hide" (eye toggle) must persist across reload, INCLUDING the
// signed-in cloud round-trip. The hidden flag rides in the overlay record's `visible` field and
// is saved / cloud-mirrored / content-merged exactly like opacity, rotation, page, and position.
// The logged-out path already had a live-browser harness (ui-audit/verify-overlay-delete-hide.mjs);
// these lock the DATA layer — especially the signed-in pull/merge, which had NO `visible`-specific
// regression test, so a future merge-logic change can't silently un-hide an overlay on reload.
describe("overlay hide persists — visible:false survives save/load + the signed-in cloud merge (B343)", () => {
  const ov = (extra = {}) => ({ id: "ovJ", name: "ARCH IFC.pdf", imgW: 800, imgH: 600, page: 1,
    pageCount: 1, ftPerPx: 1.25, rotation: 89, opacity: 0.85, locked: false, x: -500, y: -375, ...extra });
  // A cloud-row overlay: its big PNG raster was stripped for the DB row (B72/slimForCloud), which
  // is exactly the shape an overlay has on a real signed-in reload (src null, storageKey kept).
  const stripped = (extra = {}) => ov({ src: null, strippedForCloud: true, storageKey: "uid/site-overlays/J/ovJ.pdf", ...extra });

  describe("logged-out (localStorage) save → reload", () => {
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
    it("hiding then reloading keeps visible:false on the overlay", () => {
      saveSite({ id: "s", site: "Jacinto", sheetOverlays: [ov()] });                 // visible (flag absent)
      saveSite({ id: "s", site: "Jacinto", sheetOverlays: [ov({ visible: false })] }); // hidden
      expect(loadSite("s").sheetOverlays[0].visible).toBe(false);
    });
    it("showing again clears it back to visible across reload", () => {
      saveSite({ id: "s", sheetOverlays: [ov({ visible: false })] });
      saveSite({ id: "s", sheetOverlays: [ov({ visible: true })] });
      expect(loadSite("s").sheetOverlays[0].visible).toBe(true);
    });
  });

  describe("signed-in cloud round-trip (the path the logged-out harness can't reach)", () => {
    const hiddenLocal = (t) => createSiteModel({ id: "J", site: "Jacinto", updatedAt: t, sheetOverlays: [stripped({ visible: false })] });
    const visibleCloud = (t) => createSiteModel({ id: "J", site: "Jacinto", updatedAt: t, sheetOverlays: [stripped()] });
    const hiddenCloud = (t) => createSiteModel({ id: "J", site: "Jacinto", updatedAt: t, sheetOverlays: [stripped({ visible: false })] });

    it("createSiteModel normalize keeps visible:false (lossless save normalization)", () => {
      expect(createSiteModel({ id: "J", sheetOverlays: [ov({ visible: false })] }).sheetOverlays[0].visible).toBe(false);
    });
    it("mergeSiteContent keeps the hide in BOTH directions — never resurrects a visible copy", () => {
      expect(mergeSiteContent(hiddenLocal(2000), visibleCloud(1000)).sheetOverlays[0].visible).toBe(false);
      expect(mergeSiteContent(visibleCloud(1000), hiddenLocal(2000)).sheetOverlays[0].visible).toBe(false);
    });
    it("reload merge (mergePulledSites): local-hidden wins over a stale still-visible cloud copy", () => {
      const { map } = mergePulledSites({ J: hiddenLocal(2000) }, [visibleCloud(1000)]);
      expect(map.J.sheetOverlays[0].visible).toBe(false);
    });
    it("reload merge: a cloud copy that already carries the hide stays hidden", () => {
      const { map } = mergePulledSites({ J: hiddenLocal(2000) }, [hiddenCloud(2000)]);
      expect(map.J.sheetOverlays[0].visible).toBe(false);
    });
    it("a freshly-hidden local copy is re-pushed so the hide actually reaches the cloud", () => {
      const { toPush } = mergePulledSites({ J: hiddenLocal(2000) }, [visibleCloud(1000)]);
      expect(toPush).toContain("J");
    });
    it("rehydrating the stripped raster on reload doesn't disturb visible (SitePlanner spreads {...overlay, src})", () => {
      const o = stripped({ visible: false });
      const rehydrated = { ...o, src: "data:image/png;base64,AAAA", strippedForCloud: false };
      expect(rehydrated.visible).toBe(false);
    });
  });
});
