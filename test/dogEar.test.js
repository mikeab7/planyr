import { describe, it, expect } from "vitest";
import { DOGEAR_W, DOGEAR_D, dogEarGeom, dogEarSize, bumpSidewalkSide, sidewalkSpanForBumps } from "../src/workspaces/site-planner/lib/dogEar.js";

// A square host building centred at the origin, axis-aligned, 100×100.
const host = (over = {}) => ({ cx: 0, cy: 0, w: 100, h: 100, rot: 0, ...over });

describe("dogEar — corner bump-out geometry (B362)", () => {
  it("default bump-out is 55′ along the wall × 60′ projection, flush at the corner", () => {
    // bottom wall, right corner (sign +1): along runs on X (w), projection on Y (h)
    const g = dogEarGeom(host(), { side: "bottom", sign: 1 });
    expect(g.w).toBe(DOGEAR_W); // 55 along the wall
    expect(g.h).toBe(DOGEAR_D); // 60 projecting out
    // outer (right) edge flush with the building's right edge (x = +50)
    expect(g.cx + g.w / 2).toBeCloseTo(50, 6);
    // inner edge flush against the bottom dock face (y = +50), projecting outward
    expect(g.cy - g.h / 2).toBeCloseTo(50, 6);

    // a left/right wall swaps the axes: along is on Y (h), projection on X (w)
    const r = dogEarGeom(host(), { side: "right", sign: 1 });
    expect(r.w).toBe(DOGEAR_D);
    expect(r.h).toBe(DOGEAR_W);
  });

  it("dogEarSize is the inverse of the w/h packing (remembers a resize by wall)", () => {
    // top/bottom wall: box w = along, box h = projection
    expect(dogEarSize({ side: "bottom" }, 70, 80)).toEqual({ along: 70, proj: 80 });
    // left/right wall: box h = along, box w = projection
    expect(dogEarSize({ side: "left" }, 80, 70)).toEqual({ along: 70, proj: 80 });
  });

  it("THE BUG: a resized bump-out keeps its size across a host resize (never reverts to 55×60)", () => {
    const de = { side: "bottom", sign: 1 };
    // user resizes the bump to 70 along × 80 out → captured onto the dogEar tag
    const sized = { ...de, ...dogEarSize(de, 70, 80) };
    expect(sized).toMatchObject({ along: 70, proj: 80 });

    // now the host is resized bigger AND smaller; the bump must keep 70×80, not snap back
    for (const w of [140, 100, 90]) {
      const g = dogEarGeom(host({ w, h: 120 }), sized);
      expect(g.w).toBe(70); // along preserved (wall is wide enough)
      expect(g.h).toBe(80); // projection preserved
      // and it stays flush at the (new) right corner
      expect(g.cx + g.w / 2).toBeCloseTo(w / 2, 6);
    }
  });

  it("clamps (does NOT reset) the along-span when the host shrinks past the corner, then springs back", () => {
    const sized = { side: "bottom", sign: 1, along: 80, proj: 60 };
    // host wall shrinks to 50 (< 80): the rendered span clamps to the wall …
    const shrunk = dogEarGeom(host({ w: 50 }), sized);
    expect(shrunk.w).toBe(50);
    // … but the stored size is untouched, so growing the host back restores the full 80
    const grown = dogEarGeom(host({ w: 120 }), sized);
    expect(grown.w).toBe(80);
  });

  it("carries the host's rotation (the box turns with the building)", () => {
    const g = dogEarGeom(host({ rot: 30 }), { side: "bottom", sign: 1 });
    expect(g.rot).toBe(30);
  });
});

describe("bumpSidewalkSide — which perpendicular wall a corner bump lengthens (B492)", () => {
  it("maps a top/bottom dock corner to the left/right wall by sign", () => {
    expect(bumpSidewalkSide("top", -1)).toBe("left");
    expect(bumpSidewalkSide("top", 1)).toBe("right");
    expect(bumpSidewalkSide("bottom", -1)).toBe("left");
    expect(bumpSidewalkSide("bottom", 1)).toBe("right");
  });
  it("maps a left/right dock corner to the top/bottom wall by sign", () => {
    expect(bumpSidewalkSide("left", -1)).toBe("top");
    expect(bumpSidewalkSide("right", 1)).toBe("bottom");
  });
});

describe("sidewalkSpanForBumps — sidewalk spans the FULL building side incl. bump-outs (B492)", () => {
  const b = { cx: 0, cy: 0, w: 600, h: 300, rot: 0 }; // docks on top/bottom

  it("with no bumps the run is just the wall length, no shift", () => {
    expect(sidewalkSpanForBumps(b, "left", [])).toEqual({ run: 300, alongShift: 0 });
    expect(sidewalkSpanForBumps(b, "top", [])).toEqual({ run: 600, alongShift: 0 });
  });

  it("a single bump on the perpendicular wall extends the run by its projection and shifts the centre", () => {
    // top-left bump (side=top, sign=-1) lengthens the LEFT wall at its top (−Y) end
    const bumps = [{ side: "top", sign: -1, proj: 60 }];
    const { run, alongShift } = sidewalkSpanForBumps(b, "left", bumps);
    expect(run).toBe(360);          // 300 + 60
    expect(alongShift).toBe(-30);   // centre shifts toward −Y (the extended top end) by 60/2
  });

  it("bumps at BOTH ends of a wall add up and re-centre by the difference", () => {
    const bumps = [
      { side: "top", sign: -1, proj: 60 },     // extends left wall at −Y end
      { side: "bottom", sign: -1, proj: 40 },  // extends left wall at +Y end
    ];
    const { run, alongShift } = sidewalkSpanForBumps(b, "left", bumps);
    expect(run).toBe(400);            // 300 + 60 + 40
    expect(alongShift).toBe(-10);     // (40 − 60)/2 = −10 → net toward the bigger (top) bump end
  });

  it("ignores bumps that don't land on this wall", () => {
    // a right-end (top, sign=+1) bump affects the RIGHT wall, not the left
    expect(sidewalkSpanForBumps(b, "left", [{ side: "top", sign: 1, proj: 60 }]))
      .toEqual({ run: 300, alongShift: 0 });
  });
});
