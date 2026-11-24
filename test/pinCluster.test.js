import { describe, it, expect } from "vitest";
import { mapFinderSource } from "./helpers/mapFinderSource.js";
import fs from "node:fs";
import { pinClusterOffsets, pinOffsetsSig, slotOffset, pinStacks, pinStacksSig, pinPlacement, placedAnchor, pinStackHtml, isStackBadgePress } from "../src/workspaces/site-planner/lib/pinCluster.js";

/* NEW-1 (B2013744) — a map note's pin hid a comp's pin on the same parcel (comp 14x14 wholly inside
 * the note's 34x46 box). Coincident pins are nudged apart in screen pixels; lone pins never move. */
describe("pinClusterOffsets", () => {
  const P = (id, lat = 29.62316598, lon = -95.28208917) => ({ id, lat, lon });
  it("a lone pin never moves", () => expect(pinClusterOffsets([P("comp:1")]).size).toBe(0));
  it("the first pin of a cluster keeps its spot; the rest get distinct non-zero offsets", () => {
    const m = pinClusterOffsets([P("site:s"), P("comp:c"), P("note:n")]);
    expect(m.has("site:s")).toBe(false);
    const a = m.get("comp:c"), b = m.get("note:n");
    expect(a).toBeTruthy(); expect(b).toBeTruthy();
    expect(a.join()).not.toBe(b.join());
  });
  it("offsets clear the 34 px hit boxes (no two slots closer than 34 px horizontally or 46 vertically)", () => {
    const slots = Array.from({ length: 9 }, (_, k) => slotOffset(k));
    for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) {
      const dx = Math.abs(slots[i][0] - slots[j][0]), dy = Math.abs(slots[i][1] - slots[j][1]);
      expect(dx >= 34 || dy >= 46).toBe(true);
    }
  });
  it("pins a few metres apart still cluster; pins tens of metres apart do not", () => {
    expect(pinClusterOffsets([P("a"), P("b", 29.62316598 + 0.00002)]).size).toBe(1); // ~2 m
    expect(pinClusterOffsets([P("a"), P("b", 29.62316598 + 0.0007)]).size).toBe(0); // ~78 m
  });
  it("is deterministic and the signature is stable", () => {
    const pts = [P("site:s"), P("comp:c"), P("note:n")];
    expect(pinOffsetsSig(pinClusterOffsets(pts))).toBe(pinOffsetsSig(pinClusterOffsets(pts)));
  });
  it("source guard: the comp and note markers are placed by the stack helpers, never a fixed nudge", () => {
    const src = mapFinderSource();
    expect(src).toMatch(/placeOf\(`comp:\$\{c\.id\}`\)/);
    expect(src).toMatch(/placeOf\(`note:\$\{n\.id\}`\)/);
    expect(src).not.toMatch(/pinClusterOffsets\(/);
    expect(src).not.toMatch(/shiftAnchor/);
    // a fan never survives a zoom (its pins sit a fixed screen distance from their point)
    expect(src).toMatch(/map\.on\("zoomstart", close\)/);
  });
});

/* B2671329 (owner 2026-11-24: "the pin moves independently of the map on zoom in or out") — the
 * fixed screen-pixel nudge above made coincident pins slide against the map on every zoom. Stacks
 * keep every pin on its own coordinate. Browser proof: ui-audit/verify-pin-overlap.mjs. */
describe("pinStacks / pinPlacement", () => {
  const P = (id, lat = 29.62316598, lon = -95.28208917) => ({ id, lat, lon });
  const TYPES = ["land", "building_sale", "lease", "under_construction", "available"];
  it("a lone pin is never stacked, hidden or moved", () => {
    const s = pinStacks([P("comp:1"), P("comp:2", 29.7)]);
    expect(s.size).toBe(0);
    expect(pinPlacement(s, "comp:1", null)).toMatchObject({ hidden: false, offset: null, count: 0 });
  });
  it("collapsed: the lead draws ON its point with the stack's count, every other member is hidden, nothing is offset", () => {
    const s = pinStacks([P("site:s"), ...TYPES.map((t) => P(`comp:${t}`)), P("note:n")]);
    const all = ["site:s", ...TYPES.map((t) => `comp:${t}`), "note:n"].map((id) => [id, pinPlacement(s, id, null)]);
    for (const [, pl] of all) expect(pl.offset).toBeNull();
    const shown = all.filter(([, pl]) => !pl.hidden).map(([id]) => id);
    expect(shown).toEqual(["site:s", "comp:land"]);
    expect(pinPlacement(s, "comp:land", null)).toMatchObject({ count: 7, aboveSite: true, fanned: false });
    expect(pinPlacement(s, "site:s", "site:s")).toMatchObject({ hidden: false, offset: null }); // a site is never moved
  });
  it("every comp type stacks the same way (two under-construction buildings on one park pin)", () => {
    for (const t of TYPES) {
      const s = pinStacks([P(`comp:${t}-1`), P(`comp:${t}-2`)]);
      expect(pinPlacement(s, `comp:${t}-1`, null)).toMatchObject({ hidden: false, offset: null, count: 2 });
      expect(pinPlacement(s, `comp:${t}-2`, null).hidden).toBe(true);
    }
  });
  it("fanned: every member is shown at a distinct slot; with a site in the stack none keeps the true spot", () => {
    const s = pinStacks([P("site:s"), P("comp:a"), P("comp:b"), P("note:n")]);
    const key = s.get("comp:a").key;
    const pls = ["comp:a", "comp:b", "note:n"].map((id) => pinPlacement(s, id, key));
    for (const pl of pls) { expect(pl.hidden).toBe(false); expect(pl.offset).not.toBeNull(); }
    expect(new Set(pls.map((pl) => pl.offset.join())).size).toBe(3);
    expect(pls[0].count).toBe(4); // the lead keeps the (now ×) badge
  });
  it("fanned without a site: the lead keeps the true spot", () => {
    const s = pinStacks([P("comp:a"), P("comp:b")]);
    expect(pinPlacement(s, "comp:a", "comp:a").offset).toBeNull();
    expect(pinPlacement(s, "comp:b", "comp:a").offset).toEqual(slotOffset(1));
  });
  it("only the fanned stack fans", () => {
    const s = pinStacks([P("comp:a"), P("comp:b"), P("comp:c", 29.7), P("comp:d", 29.7)]);
    expect(pinPlacement(s, "comp:d", "comp:a").hidden).toBe(true);
  });
  it("placedAnchor shifts only a fanned member; the badge and tether html mark themselves", () => {
    expect(placedAnchor([7, 7], { offset: null })).toEqual([7, 7]);
    expect(placedAnchor([7, 7], { offset: [38, 0] })).toEqual([-31, 7]);
    expect(pinStackHtml({ count: 3, fanned: false, offset: null }, [7, 7], 7)).toMatch(/data-pin-stack="1"[^>]*>3</);
    expect(pinStackHtml({ count: 3, fanned: true, offset: null }, [7, 7], 7)).toMatch(/>×</);
    expect(pinStackHtml({ count: 0, fanned: true, offset: [38, 0] }, [7, 7], 7)).toMatch(/data-pin-tether/);
    expect(pinStackHtml({ count: 0, offset: null }, [7, 7], 7)).toBe("");
  });
  it("a badge press is told apart from a pin press", () => {
    const badge = { closest: (sel) => (sel === "[data-pin-stack]" ? {} : null) };
    const pin = { closest: () => null };
    expect(isStackBadgePress({ originalEvent: { target: badge } })).toBe(true);
    expect(isStackBadgePress({ originalEvent: { target: pin } })).toBe(false);
    expect(isStackBadgePress(null)).toBe(false);
  });
  it("the signature is stable and changes when a stack changes", () => {
    const a = pinStacks([P("comp:a"), P("comp:b")]);
    expect(pinStacksSig(a)).toBe(pinStacksSig(pinStacks([P("comp:a"), P("comp:b")])));
    expect(pinStacksSig(a)).not.toBe(pinStacksSig(pinStacks([P("comp:a"), P("comp:b"), P("note:n")])));
  });
});
