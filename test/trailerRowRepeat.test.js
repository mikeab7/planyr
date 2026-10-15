/* NEW-1 — a wall takes a second (and further) row of trailer parking; every NEW layer takes its LENGTH and POSITION
 * along the wall from the layer immediately before it (never its depth — a new layer's depth is its own default). Pure rules (lib/wallRows.js `planTrailerRowAdd` / `nextTrailerRowDepth` / `addOptions`) driven through
 * the SAME layout, stripe and removal code the canvas uses, so panel, canvas and stall count cannot disagree.
 * The live panel is driven by ui-audit/verify-trailer-row-repeat.mjs. */
import { describe, it, expect } from "vitest";
import {
  addOptions, planTrailerRowAdd, inheritExtentFields, resolveLayerExtent, layerExtentPatch, stripPlan, planDockPieceRemoval, applyDockPieceRemoval,
  trailerSpec, trailerCfg, trailerPatchRowDepth, applyZonePatch, wallTotalDepth, STRIP,
} from "../src/workspaces/site-planner/lib/wallRows.js";
import { layoutZoneByKind } from "../src/workspaces/site-planner/lib/dockZones.js";
import { trailerStalls } from "../src/workspaces/site-planner/lib/siteGeometry.js";
import { assemblyIntegrity } from "../src/workspaces/site-planner/lib/assemblyIntegrity.js";
import { createSiteModel } from "../src/workspaces/site-planner/lib/siteModel.js";

const court = { id: "c", type: "paving", truckCourt: { side: "bottom" }, zd: 135 };
const trailer = (id, prev, zd, extra = {}) => ({ id, type: "trailer", prevZone: prev, noFit: true, stackSide: "bottom", zd, cfg: { trailerW: 12, trailerL: zd, trailerAisle: 0, single: true }, ...extra });
const buf = { id: "b", type: "landscape", buffer: true, prevZone: "t1", noFit: true, zd: 15 };
const kindsOf = (chain) => chain.map((z) => (z.type === "trailer" ? "trailer" : "strip"));
const ctx = { chainAlong: 600, chainShift: 0, fullAlong: 600 };
const opts = { standardDepth: 50, trailerW: 12, side: "bottom", ctx };
const keys = (kinds) => addOptions(true, kinds.map((kind) => ({ kind }))).map((o) => o.key);

describe("NEW-1 — the + menu offers trailer parking again after a trailer row", () => {
  it("is offered with a court and one or more trailer rows already present (red on main: only buffer / sidewalk / road)", () => {
    expect(keys(["court", "trailer"])).toContain("trailer");
    expect(keys(["court", "trailer", "trailer"])).toContain("trailer");
    expect(keys(["court", "trailer", "buffer"])).toContain("trailer");
  });
  it("is still never offered without a court, or behind a road", () => {
    expect(keys(["buffer", "sidewalk"])).not.toContain("trailer");
    expect(keys(["court", "trailer", "road"])).toEqual([]);
  });
});

describe("NEW-1 — the second row: strip pieces, depth, derived geometry (the owner's Court 135′ + Trailer 50′ wall)", () => {
  const t1 = trailer("t1", "c", 50);
  const add = planTrailerRowAdd([court, t1], opts);
  const chain = [court, t1, { id: "t2", ...add.fields }];
  it("adds ONE more trailer piece, at the earlier row's 50′, bonded outward of the outermost layer", () => {
    expect(add.depth).toBe(50);
    expect(add.fields).toMatchObject({ type: "trailer", prevZone: "t1", stackSide: "bottom", noFit: true, zd: 50 });
    expect(add.fields.forCourt).toBeUndefined();            // forCourt names a court's FIRST trailer parking only
    expect(chain.filter((z) => z.type === "trailer")).toHaveLength(2);
    expect(trailerSpec(chain[2]).total).toBe(50);
  });
  it("lays two ADJACENT 50′ trailer bands beyond the 135′ court (no gap, no overlap)", () => {
    const b = { cx: 0, cy: 0, w: 600, h: 200, rot: 0 };
    const depths = chain.map((z) => z.zd);
    const g = chain.map((_, i) => layoutZoneByKind(b, "bottom", i, depths, kindsOf(chain)));
    expect(g[1].h).toBe(50); expect(g[2].h).toBe(50);
    // outward = +y on the bottom wall: court 100→235, trailer 235→285, trailer 285→335
    expect(g[1].cy - g[1].h / 2).toBeCloseTo(100 + 135, 9);
    expect(g[2].cy - g[2].h / 2).toBeCloseTo(g[1].cy + g[1].h / 2, 9);
    expect(g[2].cy + g[2].h / 2).toBeCloseTo(100 + 135 + 50 + 50, 9);
    expect(g[1].w).toBe(g[2].w);                            // both rows run the court's span
  });
  it("holds on a rotated building and on a side wall (the rows are laid in the wall's own frame)", () => {
    const b = { cx: 40, cy: -20, w: 600, h: 200, rot: 90 };
    const depths = chain.map((z) => z.zd);
    const left = chain.map((_, i) => layoutZoneByKind(b, "left", i, depths, kindsOf(chain)));
    const d = (p, q) => Math.hypot(p.cx - q.cx, p.cy - q.cy);
    expect(d(left[1], left[2])).toBeCloseTo(50, 9);          // centres one row apart
    expect(d(left[0], left[1])).toBeCloseTo(135 / 2 + 25, 9);
  });
  it("each row is its own flush strip with its own stall count — a yield readout sums every row", () => {
    const cfg = (z) => trailerCfg(z.cfg, trailerSpec(z), 12, "bottom");
    const per = [chain[1], chain[2]].map((z) => trailerStalls(600, z.zd, cfg(z)).count);
    expect(per[0]).toBeGreaterThan(0);
    expect(per[1]).toBe(per[0]);
    expect(per[0] + per[1]).toBe(2 * per[0]);
  });
  it("the strip keeps one bar: five pieces, every piece at least the minimum width", () => {
    const layers = [{ depth: 135 }, { depth: 50 }, { depth: 50 }, { depth: 50 }, { depth: 15 }];
    const plan = stripPlan([{ key: "dock", layers }]).rows.dock;
    expect(plan.pieces).toHaveLength(5);
    plan.pieces.forEach((p) => expect(p.w).toBeGreaterThanOrEqual(STRIP.MIN_PIECE));
    expect(plan.barW).toBeLessThanOrEqual(STRIP.FULL);
    expect(wallTotalDepth(layers)).toBe(300);
  });
});

describe("NEW-1 — a new layer takes the LENGTH and POSITION of the layer before it; depth is its own default", () => {
  const b = { cx: 0, cy: 0, w: 600, h: 200, rot: 0 };
  // trailer row 1 shortened to HALF the wall, held from the start end (court spans the whole wall)
  const half = trailer("t1", "c", 60, { alongLen: 300, alongAnchor: -1, alongOff: 0 });
  const laid = (chain, c = ctx) => {
    const depths = chain.map((z) => z.zd), kinds = kindsOf(chain);
    const o = { along: c.chainAlong, alongShift: c.chainShift, alongs: chain.map((z, i) => (i === 0 ? null : z.alongLen || null)), anchors: chain.map((z, i) => (i === 0 ? 0 : z.alongAnchor)), offs: chain.map((z, i) => (i === 0 ? 0 : z.alongOff)) };
    return chain.map((_, i) => layoutZoneByKind(b, "bottom", i, depths, kinds, o));
  };
  it("court full wall + trailer at half: a second trailer row AND a buffer come in at the half-length trailer's length and position, at their own default depths", () => {
    const add = planTrailerRowAdd([court, half], opts);
    expect(add.depth).toBe(50);                       // the standard trailer depth — NOT the 60 of the row before it
    const t2 = { id: "t2", ...add.fields };
    const bufAdd = { id: "b", type: "landscape", buffer: true, noFit: true, prevZone: "t2", zd: 15, ...inheritExtentFields(t2, false, ctx) };
    const g = laid([court, half, t2, bufAdd]);
    expect(g[1].w).toBeCloseTo(300, 9);
    expect(g[2].w).toBeCloseTo(300, 9); expect(g[3].w).toBeCloseTo(300, 9);
    expect(g[2].cx).toBeCloseTo(g[1].cx, 9); expect(g[3].cx).toBeCloseTo(g[1].cx, 9);   // same start end → same position
    expect(g[1].cx - g[1].w / 2).toBeCloseTo(-300, 9);                                   // held from the wall's start end
    expect([t2.zd, bufAdd.zd]).toEqual([50, 15]);                                         // own depths
  });
  it("RED on the pre-change rule: without inheritance the new rows run the full wall", () => {
    const t2 = { id: "t2", ...planTrailerRowAdd([court, half], { ...opts, ctx: undefined }).fields };
    expect(laid([court, half, t2])[2].w).toBe(600);
  });
  it("a layer added directly after a full-length court is full length, and tracks the court (no stored extent)", () => {
    expect(inheritExtentFields(court, true, ctx)).toEqual({});
    const add = planTrailerRowAdd([court], opts);
    expect(add).not.toBeNull();
    expect(add.fields.alongLen).toBeUndefined();
    expect(laid([court, { id: "t", ...add.fields }])[1].w).toBe(600);
  });
  it("a constrained COURT: the layer after it just tracks the court's span (the court's own length is the chain's)", () => {
    const c2 = { chainAlong: 500, chainShift: 20, fullAlong: 600 };
    expect(inheritExtentFields(court, true, c2)).toEqual({});
  });
  it("position is inherited even when the previous layer is off-centre mid-wall", () => {
    const mid = trailer("t1", "c", 50, { alongLen: 200, alongAnchor: 0, alongOff: 120 });
    const f = inheritExtentFields(mid, false, ctx);
    const r = resolveLayerExtent({ ...f }, false, ctx), p = resolveLayerExtent(mid, false, ctx);
    expect(r.along).toBeCloseTo(p.along, 9); expect(r.shift).toBeCloseTo(p.shift, 9);
  });
  it("a third row copies the second's extent (the layer immediately before)", () => {
    const t2 = { id: "t2", ...planTrailerRowAdd([court, half], opts).fields };
    const t3 = { id: "t3", ...planTrailerRowAdd([court, half, t2], opts).fields };
    const g = laid([court, half, t2, t3]);
    expect(g[3].w).toBeCloseTo(300, 9); expect(g[3].cx).toBeCloseTo(g[2].cx, 9);
  });
  it("a wall with no truck court, or ending in a road, takes none", () => {
    expect(planTrailerRowAdd([{ ...buf, prevZone: null }], opts)).toBeNull();
    expect(planTrailerRowAdd([court, trailer("t1", "c", 50), { id: "r", type: "road", prevZone: "t1", zd: 28 }], opts)).toBeNull();
  });
  it("editing the new layer's length leaves the layer before it unchanged; typing / aligning / Full touch only that layer", () => {
    const t2 = { id: "t2", ...planTrailerRowAdd([court, half], opts).fields };
    const els = [court, half, t2];
    const patch = layerExtentPatch(t2, { len: 120 }, ctx);
    const next = els.map((x) => (x.id === "t2" ? { ...x, ...patch } : x));
    expect(next[1]).toEqual(half);                                        // row 1 byte for byte
    expect(resolveLayerExtent(next[2], false, ctx).along).toBe(120);
    expect(resolveLayerExtent(next[2], false, ctx).shift).toBeCloseTo(resolveLayerExtent(t2, false, ctx).shift, 9);   // kept its position
    const end = layerExtentPatch(t2, { align: 1 }, ctx);
    expect(end).toMatchObject({ alongAnchor: 1, alongOff: 0 });
    const cleared = layerExtentPatch(t2, { full: true }, ctx);
    expect(cleared).toEqual({ alongLen: undefined, alongAnchor: undefined, alongOff: undefined });
    expect(layerExtentPatch(t2, { len: 9999 }, ctx)).toEqual(cleared);     // typing the full wall length = tracking the court again
  });
});

describe("NEW-1 — rows stay independent", () => {
  it("editing row 2's depth leaves row 1 unchanged (separate elements, separate zd)", () => {
    const t1 = trailer("t1", "c", 50), t2 = trailer("t2", "t1", 50);
    const els = [court, t1, t2];
    const patch = trailerPatchRowDepth(t2, 0, 65, 60);
    const next = els.map((x) => (x.id === "t2" ? applyZonePatch(x, patch) : x));
    expect(next.find((x) => x.id === "t1").zd).toBe(50);
    expect(next.find((x) => x.id === "t2").zd).toBe(65);
  });
  it("removing one trailer row keeps the other, re-bonded inboard; removing the court takes every trailer row", () => {
    const t1 = trailer("t1", "c", 50), t2 = trailer("t2", "t1", 60);
    const chain = [court, t1, t2];
    const rm = planDockPieceRemoval(chain, 1, "bottom");
    expect(rm.removeIds).toEqual(["t1"]);
    const left = applyDockPieceRemoval(chain, rm);
    expect(left.find((x) => x.id === "t2")).toMatchObject({ prevZone: "c", zd: 60 });
    const rc = planDockPieceRemoval(chain, 0, "bottom");
    expect(rc.removeIds.sort()).toEqual(["c", "t1", "t2"]);
  });
});

/* Survives reload / the load-time repair passes: a laid-out Court + Trailer + Trailer chain is COHERENT to the same
 * heal that runs on every load, save and undo — it must not "fix" a repeat row (move, re-bond or drop it). */

describe("NEW-1 — a plan saved with repeat trailer rows loads unchanged", () => {
  const build = (rot, side) => {
    const host = { id: "h", type: "building", cx: 120, cy: -60, w: 600, h: 200, rot };
    const c = { ...court, id: "c", attachedTo: "h", truckCourt: { side } };
    const t1 = { ...trailer("t1", "c", 50), attachedTo: "h", stackSide: side, forCourt: "c" };
    const add = planTrailerRowAdd([c, t1], { ...opts, side });
    const t2 = { id: "t2", attachedTo: "h", ...add.fields };
    const chain = [c, t1, t2];
    const depths = chain.map((z) => z.zd);
    const laid = chain.map((z, i) => ({ ...z, ...layoutZoneByKind(host, side, i, depths, kindsOf(chain)) }));
    return [host, ...laid];
  };
  for (const [rot, side] of [[0, "bottom"], [0, "top"], [90, "left"], [270, "right"], [33, "bottom"]]) {
    it(`rot ${rot} · ${side} wall: no tear, no unhealable, createSiteModel keeps both rows byte for byte`, () => {
      const els = build(rot, side);
      const r = assemblyIntegrity(els);
      expect(r.repairs).toEqual([]);
      expect(r.unhealable.missingBondSiblings || []).toEqual([]);
      const m = createSiteModel({ els });
      const after = (id) => m.els.find((e) => e.id === id);
      for (const id of ["t1", "t2"]) {
        const a = after(id), b = els.find((e) => e.id === id);
        expect(a).toBeTruthy();
        const r3 = (v) => (typeof v === "number" ? Math.round(v * 1000) / 1000 : v);
        ["cx", "cy", "w", "h", "rot", "zd", "prevZone"].forEach((k) => expect(r3(a[k])).toBe(r3(b[k])));
      }
    });
  }
});
