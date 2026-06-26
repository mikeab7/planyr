import { describe, it, expect, beforeEach } from "vitest";
import { mergePulledSites, saveSite, loadSite, snapshotVersion, listVersions, getVersion, summarizeVersion, backupNow } from "../src/workspaces/site-planner/lib/storage.js";
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
    const { summary } = summarizeVersion({ parcels: [{ id: "p1" }, { id: "p2" }], els: [road, bld("a")], measures: [{ id: "m" }] });
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
