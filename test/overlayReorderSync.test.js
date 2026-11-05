/* NEW-1 (Overlays panel redesign) — a drag/Move up reorder moves NO field on any overlay, only the array order,
 * and the array order IS the draw order. `contentSig` used to sort overlays by id, so a reorder-only change hashed
 * equal to the cloud's copy and the boot re-push (`toPush`) skipped it: the new order lived on one device only.
 * This runs the REAL merge with a REAL reorder. */
import { describe, it, expect } from "vitest";
import { createSiteModel } from "../src/workspaces/site-planner/lib/siteModel.js";
import { mergePulledSites } from "../src/workspaces/site-planner/lib/storage.js";
import { moveOverlayStep, dropOverlay } from "../src/workspaces/site-planner/lib/overlayOrder.js";

const ov = (id) => ({ id, name: id, src: "data:,x", imgW: 100, imgH: 100, x: 0, y: 0, ftPerPx: 1, rotation: 0, opacity: 1, page: 1, pageCount: 1 });
const site = (overlays, updatedAt) => createSiteModel({ id: "s1", groupId: "g1", site: "T", updatedAt, sheetOverlays: overlays });

describe("a reorder-only change reaches the cloud (boot re-push)", () => {
  const base = [ov("a"), ov("b"), ov("c")];
  const cloud = site(base, 1000);

  it("PRE-FIX SHAPE: the same overlays, same order, newer timestamp → nothing to push (control)", () => {
    const local = site(base, 2000);
    expect(mergePulledSites({ s1: local }, [cloud], null, {}, { now: 5000 }).toPush).toEqual([]);
  });

  it("a Move up on the device is PUSHED, and the merged list keeps the new order", () => {
    const reordered = moveOverlayStep(base, "a", 1);          // b a c
    expect(reordered.map((o) => o.id)).toEqual(["b", "a", "c"]);
    const local = site(reordered, 2000);
    const r = mergePulledSites({ s1: local }, [cloud], null, {}, { now: 5000 });
    expect(r.map.s1.sheetOverlays.map((o) => o.id)).toEqual(["b", "a", "c"]);
    expect(r.toPush).toEqual(["s1"]);
  });

  it("a drag reorder (dropOverlay) is pushed too, and an identical re-open afterwards pushes nothing", () => {
    const dragged = dropOverlay(base, "c", "a", "behind");     // c a b
    const local = site(dragged, 2000);
    expect(mergePulledSites({ s1: local }, [cloud], null, {}, { now: 5000 }).toPush).toEqual(["s1"]);
    const cloudAfter = site(dragged, 2500);                    // the push landed
    expect(mergePulledSites({ s1: local }, [cloudAfter], null, {}, { now: 6000 }).toPush).toEqual([]);
  });

  it("a newer reorder made on ANOTHER device is adopted, not fought over", () => {
    const theirs = site(moveOverlayStep(base, "c", -1), 3000);  // a c b
    const stale = site(base, 2000);
    const r = mergePulledSites({ s1: stale }, [theirs], null, {}, { now: 5000 });
    expect(r.map.s1.sheetOverlays.map((o) => o.id)).toEqual(["a", "c", "b"]);
    expect(r.toPush).toEqual([]);
  });
});
