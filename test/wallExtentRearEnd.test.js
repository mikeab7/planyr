/* B2268801 — per-layer LENGTH / POSITION on a rear / end wall. The same three keys a dock-wall layer carries
 * (`alongLen` / `alongAnchor` / `alongOff`) are honoured by the one derivation every writer shares
 * (`dogEar.wallStripBoxFor` for strips / buffer, `flushKidBoxFor` for road / trailer), resolved against the wall's
 * extended-side span (building wall + any bump-out that lengthens it). Old layers (no keys) run the whole span.
 * Pure, host-local frame (alongShift is +X on a top/bottom wall, +Y on a left/right one). */
import { describe, it, expect } from "vitest";
import {
  wallStripBoxFor, wallKidExtent, extentFieldsFor, layerAlignOf, wallExtentAfter, flushKidBoxFor, hasWallExtent,
  sidewalkSpanForBumps, wallKidAlong, wallKidBox, hostAxisExtents, ownExtents,
} from "../src/workspaces/site-planner/lib/dogEar.js";
import { impossibleStacks } from "../src/workspaces/site-planner/lib/siteModel.js";

const B = (o = {}) => ({ id: "h", type: "building", cx: 0, cy: 0, w: 600, h: 200, rot: 0, ...o });
const near = (a, b, t = 1e-6) => Math.abs(a - b) <= t;
// a strip with the given keys, placed on `side` of host b (the box wallStripBoxFor resolves is what is asserted)
const strip = (o = {}) => ({ id: "s", type: "landscape", cx: 0, cy: -110, w: 600, h: 10, rot: 0, ...o });
const SIDES = ["top", "bottom", "left", "right"];
const bump = (side, sign, proj = 60, along = 55) => ({ side, sign, proj, along });

describe("a layer with no extent keys runs the whole span (every old plan loads full-length)", () => {
  for (const side of SIDES) {
    it(`${side}: run = the wall, centred`, () => {
      const b = B(), box = wallStripBoxFor(b, side, [], 10, strip());
      const wall = side === "top" || side === "bottom" ? 600 : 200;
      expect(box.run).toBe(wall); expect(box.alongShift).toBe(0);
      expect(hasWallExtent(strip())).toBe(false);
    });
  }
});

describe("RED on the pre-change rule: a layer WITH keys runs its own length and position", () => {
  for (const side of SIDES) {
    const horiz = side === "top" || side === "bottom", wall = horiz ? 600 : 200;
    it(`${side}: half-length from the start end, from the end, and a centred offset`, () => {
      const b = B();
      const at = (k) => wallStripBoxFor(b, side, [], 10, strip(k));
      const half = wall / 2;
      let box = at({ alongLen: half, alongAnchor: -1, alongOff: 0 });
      expect(box.run).toBe(half); expect(near(box.alongShift, -wall / 4)).toBe(true);
      box = at({ alongLen: half, alongAnchor: 1, alongOff: 0 });
      expect(near(box.alongShift, wall / 4)).toBe(true);
      box = at({ alongLen: 100, alongAnchor: 0, alongOff: 40 });
      expect(box.run).toBe(100); expect(near(box.alongShift, 40)).toBe(true);
      // the box the layer is drawn in: along dimension = run, centred at the shift
      expect(horiz ? near(box.dimBX, 100) : near(box.dimBY, 100)).toBe(true);
      expect(horiz ? near(box.lx, 40) : near(box.ly, 40)).toBe(true);
    });
  }
});

describe("buildings with bump-outs: the span is the extended wall, and an end-anchored layer follows that end", () => {
  const b = B();
  it("a corner bump-out lengthens the adjacent end wall and a Start / End anchored layer tracks its own end", () => {
    // bump-out at the bottom wall's -X corner lengthens the LEFT wall at its +Y end by 60
    const bumps = [bump("bottom", -1, 60)];
    const bare = sidewalkSpanForBumps(b, "left", []), ext = sidewalkSpanForBumps(b, "left", bumps);
    expect(ext.run).toBe(bare.run + 60);
    const endAnch = { alongLen: 100, alongAnchor: 1, alongOff: 0 }, startAnch = { alongLen: 100, alongAnchor: -1, alongOff: 0 };
    const e1 = wallStripBoxFor(b, "left", [], 10, strip(endAnch)), e2 = wallStripBoxFor(b, "left", bumps, 10, strip(endAnch));
    const s1 = wallStripBoxFor(b, "left", [], 10, strip(startAnch)), s2 = wallStripBoxFor(b, "left", bumps, 10, strip(startAnch));
    expect(near(e2.alongShift + 50, ext.alongShift + ext.run / 2)).toBe(true);     // its end is still the wall's end
    expect(near(e1.alongShift + 50, bare.alongShift + bare.run / 2)).toBe(true);
    expect(near(s2.alongShift - 50, ext.alongShift - ext.run / 2)).toBe(true);
    expect(near(s1.alongShift - 50, bare.alongShift - bare.run / 2)).toBe(true);
  });
  it("a layer can never run past the extended wall (clamped, never off the end)", () => {
    const box = wallStripBoxFor(b, "top", [], 10, strip({ alongLen: 9999, alongAnchor: 1, alongOff: 400 }));
    expect(box.run).toBe(600); expect(box.alongShift).toBe(0);
  });
});

describe("rotated buildings: a flush road / trailer layer is re-derived in the host's own frame", () => {
  for (const rot of [0, 33, 90, 315]) {
    for (const side of SIDES) {
      it(`rot ${rot} · ${side}: length and position survive the host rotation`, () => {
        const b = B({ cx: 120, cy: -40, rot });
        const isVert = side === "left" || side === "right";
        const [nx, ny] = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] }[side];
        const perp = (isVert ? b.w : b.h) / 2 + 30 + 12;                    // a 24-deep layer, 30 ft out from the wall
        const loc = { x: isVert ? nx * perp : 0, y: isVert ? 0 : ny * perp };
        const r = (rot * Math.PI) / 180, w = { x: b.cx + loc.x * Math.cos(r) - loc.y * Math.sin(r), y: b.cy + loc.x * Math.sin(r) + loc.y * Math.cos(r) };
        const kidRot = side === "left" || side === "right" ? rot + 90 : rot;   // a trailer's stripes run along w
        const kid = { id: "t", type: "trailer", wallTrailer: true, cx: w.x, cy: w.y, w: 600, h: 24, rot: kidRot, alongLen: 120, alongAnchor: 0, alongOff: 35 };
        const box = flushKidBoxFor(b, side, [], kid);
        expect(near(box.lx * (isVert ? 0 : 1) + box.ly * (isVert ? 1 : 0), 35, 1e-6)).toBe(true);              // along centre
        expect(near(isVert ? box.dimBY : box.dimBX, 120)).toBe(true);                                       // length
        expect(near(isVert ? box.dimBX : box.dimBY, 24)).toBe(true);                                        // depth untouched
        expect(near(isVert ? box.lx : box.ly, (isVert ? nx : ny) * perp)).toBe(true);                      // perpendicular position kept
      });
    }
  }
});

describe("the edit-box model: align, length, full — read off geometry, written as the fewest keys", () => {
  const span = { run: 600, alongShift: 0 };
  it("full ⇒ no keys; start / end flush ⇒ an anchor; mid-wall ⇒ a centre offset", () => {
    expect(extentFieldsFor({ run: 600, alongShift: 0 }, span)).toEqual({ alongLen: undefined, alongAnchor: undefined, alongOff: undefined });
    expect(extentFieldsFor({ run: 300, alongShift: -150 }, span)).toEqual({ alongLen: 300, alongAnchor: -1, alongOff: 0 });
    expect(extentFieldsFor({ run: 300, alongShift: 150 }, span)).toEqual({ alongLen: 300, alongAnchor: 1, alongOff: 0 });
    expect(extentFieldsFor({ run: 200, alongShift: 40 }, span)).toEqual({ alongLen: 200, alongAnchor: 0, alongOff: 40 });
  });
  it("round trip: keys → box → keys is the identity (a new layer that inherits an extent resolves to the same box)", () => {
    for (const ext of [{ run: 300, alongShift: -150 }, { run: 300, alongShift: 150 }, { run: 200, alongShift: 40 }, { run: 50, alongShift: -275 }]) {
      const keys = extentFieldsFor(ext, span), got = wallKidExtent(keys, span);
      expect(near(got.run, ext.run)).toBe(true); expect(near(got.alongShift, ext.alongShift)).toBe(true);
    }
  });
  it("layerAlignOf reports full / start / centre / end", () => {
    expect(layerAlignOf({ run: 600, alongShift: 0 }, span)).toMatchObject({ full: true, start: false, end: false, centre: false });
    expect(layerAlignOf({ run: 300, alongShift: -150 }, span)).toMatchObject({ full: false, start: true, end: false, centre: false });
    expect(layerAlignOf({ run: 300, alongShift: 150 }, span)).toMatchObject({ full: false, start: false, end: true });
    expect(layerAlignOf({ run: 300, alongShift: 0 }, span)).toMatchObject({ full: false, start: false, end: false, centre: true });
  });
  it("wallExtentAfter: a typed length keeps the end the layer is on; Align moves it; Full restores the wall", () => {
    const start300 = { run: 300, alongShift: -150 };
    expect(wallExtentAfter(start300, { len: 120 }, span)).toEqual({ run: 120, alongShift: -240 });
    expect(wallExtentAfter(start300, { align: 1 }, span)).toEqual({ run: 300, alongShift: 150 });
    expect(wallExtentAfter(start300, { align: 0 }, span)).toEqual({ run: 300, alongShift: 0 });
    expect(wallExtentAfter(start300, { full: true }, span)).toEqual({ run: 600, alongShift: 0 });
    expect(wallExtentAfter({ run: 200, alongShift: 40 }, { len: 80 }, span)).toEqual({ run: 80, alongShift: 40 });   // mid-wall keeps its centre
    expect(wallExtentAfter(start300, { len: 99999 }, span).run).toBe(600);
  });
  it("editing one layer touches only that layer's keys (separate elements)", () => {
    const first = { id: "a", alongLen: 300, alongAnchor: -1, alongOff: 0 };
    const second = { id: "b", ...extentFieldsFor({ run: 300, alongShift: -150 }, span) };
    const edited = { ...second, ...extentFieldsFor(wallExtentAfter(wallKidExtent(second, span), { len: 80 }, span), span) };
    expect(first).toEqual({ id: "a", alongLen: 300, alongAnchor: -1, alongOff: 0 });
    expect(edited.alongLen).toBe(80);
  });
});

describe("a trailer row on a rear / end wall is a wall layer, not a dock-stack member", () => {
  const host = B({ rot: 0 });
  const flushTrailer = { id: "t", type: "trailer", cx: 0, cy: -100 - 25, w: 600, h: 50, rot: 0, attachedTo: "h" };
  it("RED without the tag: a trailer flush against a wall with no court is reported as an impossible stack", () => {
    expect(impossibleStacks([host, flushTrailer]).map((x) => x.id)).toEqual(["t"]);
  });
  it("with `wallTrailer` it is a legitimate first layer on a rear / end wall (not reported)", () => {
    expect(impossibleStacks([host, { ...flushTrailer, wallTrailer: true }])).toEqual([]);
  });
});

describe("wall-kid helpers used by the writers stay consistent", () => {
  it("wallKidAlong → extentFieldsFor → wallStripBoxFor reproduces the layer's own run and shift", () => {
    const b = B({ rot: 33, cx: 10, cy: 20 }), span = sidewalkSpanForBumps(b, "top", []);
    const bx = wallKidBox(b, "top", { depth: 10, gap: 0, run: 240, alongShift: 90 });
    const r = (33 * Math.PI) / 180, off = { x: bx.lx * Math.cos(r) - bx.ly * Math.sin(r), y: bx.lx * Math.sin(r) + bx.ly * Math.cos(r) };
    const kid = { id: "k", type: "landscape", ...ownExtents(hostAxisExtents(b, { rot: 33 }).cross, bx.dimBX, bx.dimBY), cx: b.cx + off.x, cy: b.cy + off.y, rot: 33 };
    const cur = wallKidAlong(b, "top", kid);
    expect(near(cur.run, 240, 1e-6)).toBe(true); expect(near(cur.alongShift, 90, 1e-6)).toBe(true);
    const keyed = { ...kid, ...extentFieldsFor(cur, span) };
    const again = wallStripBoxFor(b, "top", [], 10, keyed);
    expect(near(again.run, 240)).toBe(true); expect(near(again.alongShift, 90)).toBe(true);
  });
});
