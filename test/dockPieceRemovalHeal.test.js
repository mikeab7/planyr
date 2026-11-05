/* Building panel v3 (NEW-4) — binning ONE piece of a dock wall must leave an assembly the load-time heal
 * accepts as-is: no tear to repair, no missing sibling to report. The chain is laid out with the REAL
 * layout function, the removal plan applied, the survivors re-laid from the (new) head, and the result
 * run through assemblyIntegrity — the same function that would otherwise re-lay or flag it on the next load. */
import { describe, it, expect } from "vitest";
import { layoutZoneByKind } from "../src/workspaces/site-planner/lib/dockZones.js";
import { assemblyIntegrity } from "../src/workspaces/site-planner/lib/assemblyIntegrity.js";
import { planDockPieceRemoval, applyDockPieceRemoval } from "../src/workspaces/site-planner/lib/wallRows.js";

const host = (rot) => ({ id: "B", type: "building", cx: 500, cy: 300, w: 600, h: 200, rot, dock: "single", dockAxis: "x", dockSide: "bottom" });
const zones = () => [
  { id: "c", type: "paving", truckCourt: { side: "bottom" }, attachedTo: "B", zd: 135 },
  { id: "t", type: "trailer", forCourt: "c", prevZone: "c", noFit: true, attachedTo: "B", zd: 123 },
  { id: "f", type: "landscape", buffer: true, forTrailer: "t", prevZone: "t", noFit: true, attachedTo: "B", zd: 15 },
  { id: "w", type: "sidewalk", prevZone: "f", stackSide: "bottom", noFit: true, attachedTo: "B", zd: 5 },
  { id: "r", type: "road", prevZone: "w", stackSide: "bottom", noFit: true, attachedTo: "B", zd: 28, travelW: 24, curb: 2 },
];
// Re-lay a chain (head → outward) against the host exactly as relayoutSide does.
function layChain(b, chain) {
  const depths = chain.map((z) => z.zd);
  const kinds = chain.map((z) => (z.type === "trailer" || z.forCourt ? "trailer" : "strip"));
  return chain.map((z, i) => ({ ...z, ...layoutZoneByKind(b, "bottom", i, depths, kinds, {}) }));
}
const orderOf = (els) => {                                      // head → outward by the bonds, as dockChainOnSide walks them
  const out = []; const seen = new Set();
  let cur = els.find((x) => x.attachedTo === "B" && !x.prevZone && !x.forCourt && !x.forTrailer);
  while (cur && !seen.has(cur.id)) { seen.add(cur.id); out.push(cur); cur = els.find((x) => x.prevZone === cur.id) || null; }
  return out;
};

describe("removing one dock-wall piece leaves a coherent, heal-clean assembly", () => {
  for (const rot of [0, 315, 90]) {
    for (const [name, index] of [["trailer", 1], ["buffer", 2], ["court", 0], ["road", 4]]) {
      it(`rot ${rot}: bin the ${name} → survivors re-laid from the new head need no repair and report nothing`, () => {
        const b = host(rot);
        const laid = layChain(b, zones());
        const plan = planDockPieceRemoval(laid, index, "bottom");
        const survivors = applyDockPieceRemoval([b, ...laid], plan).filter((x) => x.attachedTo === "B");
        const relaid = layChain(b, orderOf(survivors));
        const next = [b, ...relaid];
        const res = assemblyIntegrity(next);
        expect(res.repairs).toEqual([]);
        expect(res.tears).toEqual([]);
        expect(res.unhealable).toEqual([]);
        // every survivor kept its own depth (the gap closed by moving in, not by resizing)
        const want = zones().filter((z) => !plan.removeIds.includes(z.id));
        expect(relaid.map((z) => [z.id, z.zd])).toEqual(want.map((z) => [z.id, z.zd]));
        // the inner-most survivor sits against the wall
        const [head] = relaid;
        const gap = Math.hypot(head.cx - b.cx, head.cy - b.cy);
        expect(gap).toBeGreaterThan(0);
      });
    }
  }
  it("the survivors sit flush against the wall after the court is binned (the buffer starts where the court did)", () => {
    const b = host(0);
    const laid = layChain(b, zones());
    const before = laid.find((z) => z.id === "c");
    const plan = planDockPieceRemoval(laid, 0, "bottom");
    const relaid = layChain(b, orderOf(applyDockPieceRemoval([b, ...laid], plan).filter((x) => x.attachedTo === "B")));
    const buf = relaid.find((z) => z.id === "f");
    // wall face is at cy + h/2 = 400; the buffer's near edge = centre − depth/2 must be exactly there
    expect(buf.cy - buf.h / 2).toBeCloseTo(400, 6);
    expect(before.cy - before.h / 2).toBeCloseTo(400, 6);
  });
});
