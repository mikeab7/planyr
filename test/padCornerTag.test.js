// NEW-2 (2026-10-30, owner on Georgia Test Site › Concept A): at the building's south corners the grading's "fill 22.1" spot tag sat
// exactly under the purple "+" bump-out button, so it read "fil⊕22.1". With the building SELECTED the tag slides along the wall
// clear of every edit button and keeps a leader to the exact corner; deselected it returns to the corner. Tags are non-interactive.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  placeCornerTag, buttonDiscs, boxHitsDisc, bumpButtonAnchor, sideButtonAnchor, rampWallAnchor, rampCornerAnchor, pillWidth, BUMP_BTN_INSET, SIDE_BTN_INSET, RAMP_BTN_R,
} from "../src/workspaces/site-planner/lib/padCornerTag.js";
import { padCornerSpots } from "../src/workspaces/site-planner/lib/buildingGrade.js";
import { FEAT_CTRL_R, featureEditOpacity } from "../src/workspaces/site-planner/lib/featureEditZoom.js";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** The building's four screen corners: w × h feet, rotated `rot` rad, at `ppf` px per foot, centred at (500, 400). */
const quadOf = (w, h, rot, ppf) => {
  const c = Math.cos(rot), s = Math.sin(rot);
  return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => ({ x: 500 + (x * c - y * s) * ppf, y: 400 + (x * s + y * c) * ppf }));
};
const TAGS = ["fill 22.1", "fill 26.0", "cut 9.1", "grade"];
const boxOf = (t) => ({ x: t.x, y: t.y, w: t.w, h: t.h });
const hits = (quad, t) => buttonDiscs(quad).filter((d) => boxHitsDisc(boxOf(t), d, 0));

describe("a selected building's corner tags clear every edit button", () => {
  // the owner's building (1,566 × 650 ft) and a spread of others, at every zoom the buttons and the tags both exist
  const BUILDINGS = [[1566, 650], [1000, 400], [600, 300], [400, 250], [300, 300], [200, 100], [120, 120]];
  const ROTS = [0, 0.3, Math.PI / 2, 2.2];
  const PPFS = [0.1, 0.15, 0.25, 0.4, 0.8, 1.5, 3];

  it("zero overlap between the tag box and any button disc — every building × rotation × zoom × corner × text", () => {
    let checked = 0;
    for (const [w, h] of BUILDINGS) for (const rot of ROTS) for (const ppf of PPFS) {
      if (Math.min(w, h) * ppf < 90) continue;                    // below this the tags are not drawn at all (LABELS_MIN_PX)
      const quad = quadOf(w, h, rot, ppf);
      for (const text of TAGS) for (let i = 0; i < 4; i++) {
        const t = placeCornerTag(quad, i, text, true);
        expect(hits(quad, t), `${w}×${h} rot ${rot} @${ppf} corner ${i} "${text}"`).toEqual([]);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(500);                         // not vacuous
  });

  it("the owner's case: 1,566 × 650 ft at about the 50-ft scale, both south corners, fill 22.1 and fill 26.0", () => {
    const ppf = 1 / 5;                                           // a 50-ft scale bar ≈ 250 px at the owner's display
    const quad = quadOf(1566, 650, 0, ppf * 2);                  // zoomed to the building's south end: 0.4 px/ft
    for (const [i, text] of [[3, "fill 22.1"], [2, "fill 26.0"]]) {
      const t = placeCornerTag(quad, i, text, true);
      expect(hits(quad, t)).toEqual([]);
      expect(t.leader).not.toBeNull();
      expect(t.leader.x1).toBeCloseTo(quad[i].x, 6);
      expect(t.leader.y1).toBeCloseTo(quad[i].y, 6);              // the leader ends on the EXACT corner point
      // it moved along the long (south) wall, on the building's own side of the corner
      expect(Math.abs(t.y - quad[i].y)).toBeLessThan(12);
      expect(Math.abs(t.x - quad[i].x)).toBeGreaterThan(t.w / 2);
    }
  });

  it("RED PROOF: the pre-fix placement (toward the centre, no selection logic) DOES collide with the purple + at the same corners", () => {
    const quad = quadOf(1566, 650, 0, 0.4);
    const unselected = [3, 2].map((i) => placeCornerTag(quad, i, "fill 22.1", false));
    for (const t of unselected) expect(hits(quad, t).some((d) => d.kind === "bump")).toBe(true);
  });

  it("never lets a tag cover a button at any zoom the buttons render (featureEditOpacity > 0) on the owner's building", () => {
    let seen = 0;
    for (let ppf = 0.1; ppf <= 4; ppf *= 1.07) {
      if (!featureEditOpacity(ppf, 1400)) continue;
      seen++;
      const quad = quadOf(1566, 650, 0, ppf);
      for (let i = 0; i < 4; i++) expect(hits(quad, placeCornerTag(quad, i, "fill 22.1", true))).toEqual([]);
    }
    expect(seen).toBeGreaterThan(20);
  });
});

describe("deselected: the tag returns to the corner, exactly where it always was", () => {
  it("inset toward the centre (min of 26 px and 30% of the way), no leader", () => {
    const quad = quadOf(1566, 650, 0, 0.4);
    const C = { x: 500, y: 400 };
    for (let i = 0; i < 4; i++) {
      const t = placeCornerTag(quad, i, "fill 22.1", false);
      const d = Math.hypot(C.x - quad[i].x, C.y - quad[i].y), inset = Math.min(26, d * 0.3);
      expect(t.x).toBeCloseTo(quad[i].x + ((C.x - quad[i].x) / d) * inset, 9);
      expect(t.y).toBeCloseTo(quad[i].y + ((C.y - quad[i].y) / d) * inset, 9);
      expect(t.leader).toBeNull();
    }
  });
  it("selecting and deselecting is a pure function of the flag", () => {
    const quad = quadOf(1566, 650, 0, 0.4);
    const before = placeCornerTag(quad, 3, "fill 22.1", false);
    placeCornerTag(quad, 3, "fill 22.1", true);
    expect(placeCornerTag(quad, 3, "fill 22.1", false)).toEqual(before);
  });
});

describe("the buttons never move: the canvas places them through the same anchors the tags avoid", () => {
  it("anchor formulas are the ones the planner always used (corner 20 px in toward the centre; wall pair 24 px in, tangent along the wall)", () => {
    expect(BUMP_BTN_INSET).toBe(20);
    expect(SIDE_BTN_INSET).toBe(24);
    const a = bumpButtonAnchor({ x: 0, y: 0 }, { x: 30, y: 40 });
    expect(a.x).toBeCloseTo(12, 9); expect(a.y).toBeCloseTo(16, 9);
    const s = sideButtonAnchor({ x: 100, y: 0 }, { x: 0, y: 0 });
    expect(s.pos).toEqual({ x: 76, y: 0 }); expect(s.tan.x).toBeCloseTo(0, 9); expect(s.tan.y).toBeCloseTo(1, 9);
  });
  it("SitePlanner's selected-building buttons are placed THROUGH those anchors (no inline copy of the 20 / 24 px offsets)", () => {
    const src = code(read("../src/workspaces/site-planner/SitePlanner.jsx"));
    expect(src).toMatch(/const \{ pos, tan \} = sideButtonAnchor\(ms, cpx\)/);
    expect(src).toMatch(/const pos = bumpButtonAnchor\(cs, cpx\)/);
    expect(src).not.toMatch(/ms\.x - ux \* 24/);
    expect(src).not.toMatch(/cs\.x - dx \* 20/);
  });
  it("the drive-in ramp buttons (B2566544) are placed through the shared anchors too, and the tags avoid them (the ramp PR merged first, so its discs were NOT known to the placer until this follow-up)", () => {
    const src = code(read("../src/workspaces/site-planner/SitePlanner.jsx"));
    expect(src).toMatch(/rampWallAnchor\(pos, tan\)/);
    expect(src).toMatch(/rampCornerAnchor\(pos, midS\)/);
    expect(src).not.toMatch(/const RAMP_BTN_R =/);          // one definition, in the lib
    const wall = rampWallAnchor({ x: 100, y: 100 }, { x: 0, y: 1 });
    expect(wall.x).toBeCloseTo(100, 9); expect(wall.y).toBeCloseTo(100 + FEAT_CTRL_R * 2 + 7 + RAMP_BTN_R, 9);
    const corner = rampCornerAnchor({ x: 0, y: 0 }, { x: 50, y: 0 });
    expect(corner.x).toBeCloseTo(FEAT_CTRL_R + 4 + RAMP_BTN_R, 9); expect(corner.y).toBeCloseTo(0, 9);
  });
});

describe("tags are non-interactive", () => {
  const src = read("../src/workspaces/site-planner/components/GradingPanels.jsx");
  it("the whole grading layer and every corner tag group carry pointer-events none, so a tag can never take a press from a button", () => {
    expect(src).toMatch(/<g data-grading-layers="1" pointerEvents="none">/);
    expect(src).toMatch(/data-pad-corner=\{k\.kind\}[^>]*pointerEvents="none"/);
  });
  it("the pill draws with the same width the placer measures (one formula)", () => {
    expect(src).toMatch(/const w = pillWidth\(text, size\)/);
    expect(pillWidth("fill 22.1")).toBeCloseTo(9 * 6.6 + 10, 9);
    expect(pillWidth("")).toBe(22);
  });
});

describe("the corner spots carry their corner index (the placer needs it when a void drops one)", () => {
  it("padCornerSpots tags each spot with its corner's place in padCorners order, skipping voids without renumbering", () => {
    const ring = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }];
    const spots = padCornerSpots(ring, 100, (p) => (p.x === 100 && p.y === 0 ? null : 95));
    expect(spots.map((s) => s.idx)).toEqual([0, 2, 3]);
  });
  it("FEAT_CTRL_R is what the disc radius is built from", () => {
    const d = buttonDiscs(quadOf(400, 250, 0, 1));
    expect(d.filter((x) => !x.kind.startsWith("ramp")).every((x) => x.r > FEAT_CTRL_R)).toBe(true);
    expect(d.filter((x) => x.kind.startsWith("ramp")).every((x) => x.r > RAMP_BTN_R)).toBe(true);
    expect(d).toHaveLength(24);                                    // per wall/corner: bump + 2 pair discs + wall ramp + 2 corner ramps
    expect(d.filter((x) => x.kind.startsWith("ramp"))).toHaveLength(12);
  });
});
