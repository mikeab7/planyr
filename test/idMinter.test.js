import { describe, it, expect } from "vitest";
import { createIdMinter, randomIdSalt } from "../src/shared/ids.js";
import { mergeSiteContent, createSiteModel } from "../src/workspaces/site-planner/lib/siteModel.js";

describe("createIdMinter — collision-resistant element ids (B591)", () => {
  it("mints a sequential e-id with the salt appended", () => {
    const uid = createIdMinter("kqwz");
    expect(uid()).toBe("e1kqwz");
    expect(uid()).toBe("e2kqwz");
    expect(uid()).toBe("e3kqwz");
  });

  it("two minters with DIFFERENT salts never collide (the two-tab case)", () => {
    const tabA = createIdMinter("aaaa");
    const tabB = createIdMinter("bbbb");
    // Both tabs load the same site → both seed to the same sequence number…
    tabA.seedAbove(["e40"]);
    tabB.seedAbove(["e40"]);
    // …yet their first new draws are DIFFERENT ids (salt disambiguates them).
    const a = tabA();
    const b = tabB();
    expect(a).toBe("e41aaaa");
    expect(b).toBe("e41bbbb");
    expect(a).not.toBe(b);
  });

  it("seedAbove advances past EVERY collection's ids and tombstones (digit parse ignores the salt)", () => {
    const uid = createIdMinter("zz");
    // Mixed: bare legacy ids, salted ids, and a tombstone string — all parsed by their digits.
    uid.seedAbove(["e5", "e12zz", "e3", "e40abc"]);
    expect(uid.peek()).toBe(41); // max numeric (40) + 1
    expect(uid()).toBe("e41zz");
  });

  it("a freshly minted id never equals a prior tombstone, even when the counter re-seeds LOW", () => {
    // Reproduces the reopen-after-delete case: the counter is seeded only from els (none here),
    // so it sits at 1 — below the tombstoned markup id "e3". The salt still makes the new id unique.
    const uid = createIdMinter("newsalt");
    uid.seedAbove([]); // nothing to seed past → next is e1
    const drawn = [uid(), uid(), uid()]; // e1newsalt, e2newsalt, e3newsalt
    expect(drawn).not.toContain("e3"); // the bare tombstone id can never be reminted
    expect(drawn[2]).toBe("e3newsalt");
  });
});

describe("randomIdSalt", () => {
  it("is digit-free letters only (so a numeric id parse recovers the sequence number)", () => {
    for (let i = 0; i < 50; i++) {
      const s = randomIdSalt();
      expect(s).toMatch(/^[a-z]+$/);
      expect(s.length).toBe(6);
    }
  });
});

describe("B591 end-to-end — a salted new markup survives mergeSiteContent's tombstone filter", () => {
  // The actual loss vehicle: mergeSiteContent unions both copies' deletedIds and drops any item
  // whose id is in that union. The bug was an UPSTREAM id collision feeding it a live id; the fix
  // is unique ids, so a genuine tombstone can no longer match a freshly drawn item.
  it("does NOT strip a freshly drawn (salted) markup whose numeric part matches an old tombstone", () => {
    const uid = createIdMinter("sess2");
    uid.seedAbove([]); // reopened tab, counter low
    const polyId = (() => { let id; for (let i = 0; i < 3; i++) id = uid(); return id; })(); // "e3sess2"

    // Live canvas (this tab): the freshly drawn polyline.
    const live = createSiteModel({
      id: "s1", updatedAt: 2000,
      markups: [{ id: polyId, kind: "polyline", pts: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }],
    });
    // The other tab's stored copy carries an OLD-style tombstone "e3" from a prior deleted markup.
    const stored = createSiteModel({ id: "s1", updatedAt: 1000, markups: [], deletedIds: ["e3"] });

    const merged = mergeSiteContent(live, stored);
    // The salted polyline id ("e3sess2") != the bare tombstone ("e3"), so it is KEPT.
    expect(merged.markups.map((m) => m.id)).toContain(polyId);
  });

  it("CONTROL: a colliding BARE id (the old pre-salt behavior) WAS stripped — proving the mechanism", () => {
    const live = createSiteModel({
      id: "s1", updatedAt: 2000,
      markups: [{ id: "e3", kind: "polyline", pts: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }],
    });
    const stored = createSiteModel({ id: "s1", updatedAt: 1000, markups: [], deletedIds: ["e3"] });
    const merged = mergeSiteContent(live, stored);
    // With a colliding bare id, the tombstone filter removes the live markup — the original bug.
    expect(merged.markups.map((m) => m.id)).not.toContain("e3");
  });
});
