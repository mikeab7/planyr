/* NEW-1 (B1123) — a spurious `alongLen` pins the trailer so it stops following its court.
 *
 * LIVE EVIDENCE this is written against (Goose Creek "Plan 1 (copy)", site sms69x8rb2qk):
 * building e1454729ykduhm is w 822 · h 500 · rot 178.543241069641. Its two truck courts are w 712,
 * and their trailers carry alongLen 708 and 707 — the ONLY two elements in the whole plan with an
 * alongLen, on a plan whose owner never typed a trailer length. Those stamps came from the app.
 *
 * ROOT CAUSE the guards below pin down: `resizedAlongLen` was fed `boxExtentAlong(box, alongUnit)`,
 * i.e. the WORLD-SPACE projection of the rotated box — w·|cos θ| + h·|sin θ|. At rot 178.543°
 * (sin θ ≈ 0.0254) a 50 ft deep trailer contributes ~1.3 ft of phantom length, and that phantom term
 * moves whenever the DEPTH moves, so the "did the user drag the length?" test could not tell a depth
 * drag or a host refit from a real length drag. Once stamped, `zoneAlongSpan` returns the stored
 * value forever and the trailer never tracks the court again.
 *
 * This plan is full of near-but-not-exact rotations (178.543, 179, 269, 359, 88.543, 268.543), so
 * every rotation below is exercised, not just the axis-aligned ones.
 */
import { describe, it, expect } from "vitest";
import {
  zoneAlongExtent, zoneDepthExtent, resizedZoneAlongLen, resizedAlongLen, alongLenIsChainEcho,
  boxExtentAlong, layoutZoneByKind, zoneAlongSpan,
} from "../src/workspaces/site-planner/lib/dockZones.js";
import { normalizeZoneAlongLen } from "../src/workspaces/site-planner/lib/siteModel.js";

// The reported building, and the rotations this owner's plan actually contains.
const ROT_LIVE = 178.543241069641;
const ROTS = [0, 90, ROT_LIVE, 269, 359];
const HOST = { id: "b1", type: "building", cx: 0, cy: 0, w: 822, h: 500, rot: ROT_LIVE };

const alongUnit = (rot, side) => {
  const horiz = side === "top" || side === "bottom";
  const r = (rot * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return horiz ? { x: c, y: s } : { x: -s, y: c };
};

describe("zoneAlongExtent — the TRUE along-wall span, measured in the host's local frame", () => {
  it("returns the raw along dimension exactly, at every rotation this plan contains", () => {
    for (const rot of ROTS) {
      // A strip (court/buffer) on a horizontal wall: along = w. On a vertical wall: along = h.
      expect(zoneAlongExtent({ w: 712, h: 135, rot }, rot, "bottom")).toBeCloseTo(712, 9);
      expect(zoneAlongExtent({ w: 135, h: 712, rot }, rot, "left")).toBeCloseTo(712, 9);
      // A trailer's `w` is the along dimension on BOTH wall orientations (it is laid +90 on a side wall).
      expect(zoneAlongExtent({ w: 712, h: 50, rot }, rot, "bottom")).toBeCloseTo(712, 9);
      expect(zoneAlongExtent({ w: 712, h: 50, rot: rot + 90 }, rot, "left")).toBeCloseTo(712, 9);
    }
  });
  /* AUDIT-FIRST correction to the brief, recorded rather than glossed. The brief attributes the
   * phantom term to the HOST rotation itself (sin 178.543° ≈ 0.0254 → ~1.3 ft on a 50 ft trailer).
   * The code says otherwise: `boxExtentAlong(zone, alongUnit(host, side))` dots the ZONE's own
   * rotated half-axes with the host's along direction, so it is EXACT whenever the zone sits at the
   * host's angle — which, on the reported plan, both trailers do (all three rows read
   * rot 178.543241069641). The projection is only lossy when the two angles DISAGREE, and it then
   * drifts by the depth times the sine of the DISAGREEMENT.
   *
   * That mismatch is real in this owner's data, not hypothetical: `e1454737ykduhm` sits at
   * 268.543241069641 under a host at 178.543241069641, and `e1454692dshobp` at 359 under a host at
   * 269. So the measure is replaced with one that cannot drift under ANY mismatch, and the stamp is
   * additionally gated on gesture intent (below) — which is what actually closes the class, since
   * the geometry alone can never say who moved the box. */
  it("is independent of depth AND of any zone-vs-host angle mismatch", () => {
    const a = zoneAlongExtent({ w: 712, h: 50, rot: ROT_LIVE }, ROT_LIVE, "bottom");
    const b = zoneAlongExtent({ w: 712, h: 250, rot: ROT_LIVE }, ROT_LIVE, "bottom");
    expect(b - a).toBeCloseTo(0, 9);
    // A zone whose stored angle has drifted off its host's still reports its true along span…
    expect(zoneAlongExtent({ w: 712, h: 50, rot: 179 }, ROT_LIVE, "bottom")).toBeCloseTo(712, 9);
    expect(zoneAlongExtent({ w: 712, h: 250, rot: 179 }, ROT_LIVE, "bottom")).toBeCloseTo(712, 9);
    // …whereas the OLD measure moved with the DEPTH under that same 0.457° mismatch (178.543 and 179
    // are both present in this plan), which is what let a depth change read as a length change.
    const tan = alongUnit(ROT_LIVE, "bottom");
    const oldA = boxExtentAlong({ w: 712, h: 50, rot: 179 }, tan);
    const oldB = boxExtentAlong({ w: 712, h: 250, rot: 179 }, tan);
    expect(Math.abs(oldB - oldA)).toBeGreaterThan(0.5);
  });
  it("agrees with the layout that produced the box, for every zone of the chain", () => {
    const depths = [135, 50, 15];
    const kinds = ["strip", "trailer", "strip"];
    for (const side of ["top", "bottom", "left", "right"]) {
      for (let i = 0; i < 3; i++) {
        const g = layoutZoneByKind(HOST, side, i, depths, kinds, { along: 712, alongShift: 0 });
        expect(zoneAlongExtent(g, HOST.rot, side)).toBeCloseTo(712, 6);
        expect(zoneDepthExtent(g, HOST.rot, side)).toBeCloseTo(depths[i], 6);
      }
    }
  });
});

describe("resizedZoneAlongLen — only a real along-axis USER resize may pin a length", () => {
  const box = (w, h, rot) => ({ w, h, rot });

  it("a pure HOST resize NEVER stamps alongLen, at any rotation", () => {
    for (const rot of ROTS) {
      // A host refit re-lays the zone: same along span, whatever the depth, and NO userResize intent.
      const prev = box(712, 50, rot), next = box(712, 50, rot);
      expect(resizedZoneAlongLen(prev, next, { hostRot: rot, side: "bottom", userResize: false })).toBeNull();
      // Even if the refit changed the span (a resized building), intent is what gates the stamp.
      expect(resizedZoneAlongLen(prev, box(760, 50, rot), { hostRot: rot, side: "bottom", userResize: false })).toBeNull();
    }
  });

  it("a DEPTH-only drag on the zone does not stamp — the exact measure sees zero change", () => {
    for (const rot of ROTS) {
      const prev = box(712, 50, rot);
      for (const h of [51, 60, 135, 300]) {
        expect(resizedZoneAlongLen(prev, box(712, h, rot), { hostRot: rot, side: "bottom", userResize: true })).toBeNull();
      }
      // …and the edge-drag axis hint refuses it outright, belt-and-braces.
      expect(resizedZoneAlongLen(prev, box(712, 300, rot), { hostRot: rot, side: "bottom", userResize: true, alongAxisDragged: false })).toBeNull();
    }
  });

  it("a REAL along-axis drag DOES stamp, at any rotation", () => {
    for (const rot of ROTS) {
      const prev = box(712, 50, rot);
      expect(resizedZoneAlongLen(prev, box(600, 50, rot), { hostRot: rot, side: "bottom", userResize: true })).toBe(600);
      expect(resizedZoneAlongLen(prev, box(900, 50, rot), { hostRot: rot, side: "bottom", userResize: true, alongAxisDragged: true })).toBe(900);
      // Vertical wall: the along axis is `h` for a strip, `w` for a trailer.
      expect(resizedZoneAlongLen(box(135, 712, rot), box(135, 600, rot), { hostRot: rot, side: "left", userResize: true })).toBe(600);
    }
  });

  it("a sub-tolerance wobble still stamps nothing (the derive-by-default contract)", () => {
    const prev = { w: 712, h: 50, rot: ROT_LIVE };
    expect(resizedZoneAlongLen(prev, { w: 712.4, h: 50, rot: ROT_LIVE }, { hostRot: ROT_LIVE, side: "bottom", userResize: true })).toBeNull();
  });

  it("keeps the underlying comparison (resizedAlongLen) intact for its existing callers", () => {
    expect(resizedAlongLen(712, 712)).toBeNull();
    expect(resizedAlongLen(712, 700)).toBe(700);
    expect(resizedAlongLen(NaN, 700)).toBeNull();
  });
});

describe("alongLenIsChainEcho — a stored length that carries no intent", () => {
  it("flags the live evidence (court 712 · trailers 708 / 707) as an echo", () => {
    expect(alongLenIsChainEcho(708, 712)).toBe(true);
    expect(alongLenIsChainEcho(707, 712)).toBe(true);
    expect(alongLenIsChainEcho(712, 712)).toBe(true);
  });
  it("leaves a genuinely different length alone", () => {
    expect(alongLenIsChainEcho(400, 712)).toBe(false);
    expect(alongLenIsChainEcho(900, 712)).toBe(false);
  });
  it("ignores absent / junk values", () => {
    for (const v of [undefined, null, 0, -5, "x", NaN]) expect(alongLenIsChainEcho(v, 712)).toBe(false);
    expect(alongLenIsChainEcho(708, 0)).toBe(false);
  });
});

/* The load-time heal, seeded with EXACTLY the reported plan's shape: a rot-178.543 building whose
 * two courts are 712 long and whose two trailers carry 708 / 707. Without the heal those plans stay
 * broken forever — a pinned length is by design never reset. */
describe("normalizeZoneAlongLen — heals a plan already poisoned (the live repro)", () => {
  // Build the assembly through the SAME pure layout the canvas uses, then poison the trailers.
  const build = ({ trailerAlong, trailerLens }) => {
    const depths = [135, 50];
    const kinds = ["strip", "trailer"];
    const els = [HOST];
    ["top", "bottom"].forEach((side, k) => {
      const court = { id: `c${k}`, type: "paving", attachedTo: HOST.id, truckCourt: { side }, zd: 135,
        ...layoutZoneByKind(HOST, side, 0, depths, kinds, { along: 712, alongShift: 0 }) };
      const trailer = { id: `t${k}`, type: "trailer", attachedTo: HOST.id, forCourt: court.id, prevZone: court.id, noFit: true, zd: 50,
        ...layoutZoneByKind(HOST, side, 1, depths, kinds, { along: 712, alongShift: 0, alongs: [null, trailerAlong[k]] }),
        ...(trailerLens[k] == null ? {} : { alongLen: trailerLens[k] }) };
      els.push(court, trailer);
    });
    return els;
  };

  it("drops the spurious alongLen and re-lays the trailer back onto the court's span", () => {
    const els = build({ trailerAlong: [708, 707], trailerLens: [708, 707] });
    const before = els.filter((e) => e.type === "trailer");
    expect(before.map((t) => t.alongLen)).toEqual([708, 707]);
    expect(before.map((t) => Math.round(zoneAlongExtent(t, HOST.rot, "bottom")))).toEqual([708, 707]);

    const healed = [];
    const out = normalizeZoneAlongLen(els, (h) => healed.push(h));
    const after = out.filter((e) => e.type === "trailer");
    // The pin is gone…
    expect(after.every((t) => t.alongLen === undefined)).toBe(true);
    // …the geometry caught up in the same pass (back to the court's 712)…
    after.forEach((t, i) => {
      const side = ["top", "bottom"][i];
      expect(zoneAlongExtent(t, HOST.rot, side)).toBeCloseTo(712, 6);
      expect(zoneDepthExtent(t, HOST.rot, side)).toBeCloseTo(50, 6);
    });
    // …and the repair is AUDITABLE, one record per element (LOUD-FAILURE).
    expect(healed.map((h) => h.kind)).toEqual(["zone-along-len", "zone-along-len"]);
    expect(healed.map((h) => h.id).sort()).toEqual(["t0", "t1"]);
    expect(healed[0].from.alongLen).toBe(708);
  });

  it("PRESERVES a genuinely user-set length (600 against a 712 court)", () => {
    const els = build({ trailerAlong: [600, 600], trailerLens: [600, 600] });
    const out = normalizeZoneAlongLen(els, () => {});
    expect(out.filter((e) => e.type === "trailer").map((t) => t.alongLen)).toEqual([600, 600]);
    // Untouched → returned BY IDENTITY, so a correct record churns nothing (the B499 contract).
    expect(out).toBe(els);
  });

  it("never touches the truck court's own alongLen (the B492 typed-length path)", () => {
    const els = build({ trailerAlong: [null, null], trailerLens: [null, null] })
      .map((e) => (e.id === "c0" ? { ...e, alongLen: 712 } : e));
    const out = normalizeZoneAlongLen(els, () => {});
    expect(out.find((e) => e.id === "c0").alongLen).toBe(712);
  });

  it("is idempotent — a second pass changes nothing", () => {
    const els = build({ trailerAlong: [708, 707], trailerLens: [708, 707] });
    const once = normalizeZoneAlongLen(els, () => {});
    expect(normalizeZoneAlongLen(once, () => {})).toBe(once);
  });

  it("leaves the derive-by-default rule itself untouched (no stored length → tracks the chain)", () => {
    expect(zoneAlongSpan(undefined, 712, 822)).toBe(712);
    expect(zoneAlongSpan(600, 712, 822)).toBe(600);
    expect(zoneAlongSpan(900, 712, 822)).toBe(822); // clamped to the wall, never forgotten
  });
});
