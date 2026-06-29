import { describe, it, expect, beforeEach } from "vitest";
import { wouldThinClobber, noteLocalContent, _siteContent, _siteTombs, clearSiteVersions } from "../src/workspaces/site-planner/lib/cloudSync.js";

// B459 — the CAS guard (B314) checks only the version NUMBER, never the content, so a tab holding a
// stale/thin model at a matching version could silently overwrite a fuller cloud row (the 8 South
// 5-building loss). wouldThinClobber is the pure decision that blocks that: a push dropping ≥2 items
// the cloud still has, with no delete-tombstone to explain the drop, is a stale-tab clobber. Legit
// incremental undo (≤1 unexplained drop) and any tombstoned delete pass through.

const els = (n, extra = {}) => ({ els: Array.from({ length: n }, (_, i) => ({ id: "e" + i, type: "building" })), ...extra });

describe("wouldThinClobber — never silently shrink the cloud (B459)", () => {
  it("no baseline yet (a first sync) → allow", () => {
    expect(wouldThinClobber(els(1), null, 0)).toBe(false);
    expect(wouldThinClobber(els(1), undefined, 0)).toBe(false);
  });

  it("same or growing content → allow", () => {
    expect(wouldThinClobber(els(6), 6, 0)).toBe(false);
    expect(wouldThinClobber(els(7), 6, 0)).toBe(false);
  });

  it("a single unexplained drop (undo of one add) → allow", () => {
    expect(wouldThinClobber(els(5), 6, 0)).toBe(false);
  });

  it("THE 8 South clobber — 5 buildings vanish with NO delete → BLOCK", () => {
    expect(wouldThinClobber(els(1), 6, 0)).toBe(true);
  });

  it("a legit bulk delete (the whole drop is explained by new tombstones) → allow", () => {
    expect(wouldThinClobber({ ...els(1), deletedIds: ["a", "b", "c", "d", "e"] }, 6, 0)).toBe(false);
  });

  it("partially explained — 3 lost, only 1 tombstone (2 unexplained) → BLOCK", () => {
    expect(wouldThinClobber({ ...els(3), deletedIds: ["x"] }, 6, 0)).toBe(true);
  });

  it("boundary — exactly 2 unexplained lost → BLOCK; exactly 1 → allow", () => {
    expect(wouldThinClobber(els(4), 6, 0)).toBe(true);  // lost 2
    expect(wouldThinClobber(els(5), 6, 0)).toBe(false); // lost 1
  });

  it("only NEW deletes since the baseline explain a drop (baseline tombstones don't double-count)", () => {
    // baseTombs already 2; model carries those same 2 (no NEW delete) yet dropped 3 → BLOCK
    expect(wouldThinClobber({ ...els(3), deletedIds: ["a", "b"] }, 6, 2)).toBe(true);
    // baseTombs 2; model added 3 NEW tombstones (5 total) for a 3-item drop → fully explained → allow
    expect(wouldThinClobber({ ...els(3), deletedIds: ["a", "b", "c", "d", "e"] }, 6, 2)).toBe(false);
  });

  it("counts content across all collections, not just buildings", () => {
    // baseline 5 = 2 parcels + 3 markups; push keeps the parcels, drops all 3 markups, no tombstones → BLOCK
    const m = { parcels: [{ id: "p1" }, { id: "p2" }], markups: [] };
    expect(wouldThinClobber(m, 5, 0)).toBe(true);
  });
});

// B556 — the owner's "phantom conflict" class: a DELIBERATE local shrink (deleting a building +
// its bonded children, OR undo of a multi-element add, OR a version Restore) drops ≥2 items with no
// tombstone, so the thin-clobber guard mistook it for a stale-tab clobber and re-showed the "changed
// in another session / Take over editing" prompt. Deletes now record a tombstone (see SitePlanner
// deleteSel); undo/redo/restore can't tombstone (a redo must re-add the items), so the active tab
// instead rebases its content baseline via noteLocalContent. This proves both halves at the data layer.
describe("noteLocalContent — a deliberate local shrink rebases the baseline, but a stale clobber still blocks (B556)", () => {
  const els = (n) => ({ id: "s1", els: Array.from({ length: n }, (_, i) => ({ id: "e" + i, type: "building" })) });
  beforeEach(() => clearSiteVersions());

  it("undo of a 3-element building add is no longer read as a stale clobber", () => {
    _siteContent.s1 = 6; _siteTombs.s1 = 0;        // last synced a 6-item plan (the add brought it 3→6)
    const afterUndo = els(3);                       // undo drops it back to 3, NO tombstone
    expect(wouldThinClobber(afterUndo, _siteContent.s1, _siteTombs.s1)).toBe(true);   // would FALSELY block…
    noteLocalContent("s1", afterUndo);              // …active tab declares the undo authoritative…
    expect(wouldThinClobber(afterUndo, _siteContent.s1, _siteTombs.s1)).toBe(false);  // …now allowed
  });

  it("a version Restore to a thinner copy rebases the baseline too", () => {
    _siteContent.s1 = 9; _siteTombs.s1 = 0;
    const restored = els(2);
    noteLocalContent("s1", restored);
    expect(wouldThinClobber(restored, _siteContent.s1, _siteTombs.s1)).toBe(false);
  });

  it("never fabricates a baseline — a brand-new, never-synced site is left alone (first sync never blocked)", () => {
    noteLocalContent("brandnew", els(1));
    expect(_siteContent.brandnew).toBeUndefined();
  });

  it("THE 8 South protection is intact — a passive stale tab never calls this, so its thin push still BLOCKS", () => {
    _siteContent.s1 = 6; _siteTombs.s1 = 0;         // baseline came from a cloud read (cloudList), not this tab
    // the stale tab never undoes/restores → no noteLocalContent → its road-only push is still caught
    expect(wouldThinClobber(els(1), _siteContent.s1, _siteTombs.s1)).toBe(true);
  });
});
