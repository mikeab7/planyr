import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { pinClusterOffsets, pinOffsetsSig, slotOffset } from "../src/workspaces/site-planner/lib/pinCluster.js";

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
  it("source guard: the comp and note markers shift their anchor by the cluster offset", () => {
    const src = fs.readFileSync(new URL("../src/workspaces/site-planner/MapFinder.jsx", import.meta.url), "utf8");
    expect(src).toMatch(/shiftAnchor\(anchor, `comp:\$\{c\.id\}`\)/);
    expect(src).toMatch(/shiftAnchor\(iconAnchor, `note:\$\{n\.id\}`\)/);
  });
});
