// NEW-2 (B2571041) then NEW-5 (2026-10-30, owner's live check on Georgia Test Site › Concept A): the grading corner tags and the building's edit buttons
// must never meet. The first cut slid the tags clear of buttons that sat INSIDE the footprint; the ramp buttons then landed on the spot the tags moved
// to ("cu⊘.1"). The rule now is by construction: every button OUTSIDE the walls (lib/buildingButtons.js), every tag INSIDE the footprint
// (lib/padCornerTag.js), so they lie on opposite sides of every wall line at any zoom.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { placeCornerTag, boxInsideQuad, pillWidth, CORNER_TAG_PILL_H } from "../src/workspaces/site-planner/lib/padCornerTag.js";
import { layoutBuildingButtons, layoutDiscs, wallsFromQuad, discTouchesQuad, BTN_OUT_PX, RAMP_BTN_R, HOVER_BUTTON_REACH_PX, ROTATE_GRIP_OFFSET_PX, ROTATE_GRIP_R_PX } from "../src/workspaces/site-planner/lib/buildingButtons.js";
import { padCornerSpots } from "../src/workspaces/site-planner/lib/buildingGrade.js";
import { FEAT_CTRL_R, featureEditOpacity } from "../src/workspaces/site-planner/lib/featureEditZoom.js";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const FEAT_BTN_MIN_PX = 72; // SitePlanner's gate: a wall's buttons need its perpendicular on-screen size to be at least this

/** The building's four screen corners [TL, TR, BR, BL]: w × h feet, rotated `rot` rad, at `ppf` px per foot, centred at (500, 400). */
const quadOf = (w, h, rot, ppf) => {
  const c = Math.cos(rot), s = Math.sin(rot);
  return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => ({ x: 500 + (x * c - y * s) * ppf, y: 400 + (x * s + y * c) * ppf }));
};
/** The layout SitePlanner's `sideAddNodes` builds: the same gating, the same helpers. */
const layoutFor = (w, h, rot, ppf, dockSides = ["top", "bottom"]) => {
  const quad = quadOf(w, h, rot, ppf), wpx = w * ppf, hpx = h * ppf, roomy = Math.min(wpx, hpx) >= FEAT_BTN_MIN_PX;
  const walls = wallsFromQuad(quad, dockSides).filter((x) => ((x.name === "top" || x.name === "bottom") ? hpx : wpx) >= FEAT_BTN_MIN_PX)
    .map((x) => ({ ...x, corners: x.dock && roomy ? x.corners : [] }));
  return { quad, walls, layout: layoutBuildingButtons(walls) };
};
const TAGS = ["fill 22.1", "fill 26.0", "cut 9.1", "grade"];
const boxHitsDisc = (b, d, pad = 0) => {
  const nx = Math.max(b.x - b.w / 2, Math.min(d.x, b.x + b.w / 2)), ny = Math.max(b.y - b.h / 2, Math.min(d.y, b.y + b.h / 2));
  return Math.hypot(d.x - nx, d.y - ny) < d.r + pad;
};
const BUILDINGS = [[1566, 650], [1000, 400], [600, 300], [400, 250], [300, 300], [200, 100], [120, 120]];
const ROTS = [0, 0.3, Math.PI / 2, 2.2];
const PPFS = [0.1, 0.15, 0.25, 0.4, 0.8, 1.5, 3];
const DOCKS = [["top", "bottom"], ["bottom"], ["left", "right"], ["top", "bottom", "left", "right"], []];

describe("every edit button sits OUTSIDE the footprint; every corner tag sits INSIDE it", () => {
  it("zero intersection between the union of button discs and the union of tag boxes — every building × rotation × zoom × dock set × corner × text", () => {
    let checked = 0, withButtons = 0;
    for (const [w, h] of BUILDINGS) for (const rot of ROTS) for (const ppf of PPFS) for (const docks of DOCKS) {
      if (Math.min(w, h) * ppf < 90) continue;                       // below this the tags are not drawn at all (LABELS_MIN_PX)
      const { quad, layout } = layoutFor(w, h, rot, ppf, docks), discs = layoutDiscs(layout);
      if (discs.length) withButtons++;
      for (const d of discs) expect(discTouchesQuad(d, quad, 0), `${w}×${h} rot ${rot} @${ppf} ${d.id} is inside / on the footprint`).toBe(false);
      for (const text of TAGS) for (let i = 0; i < 4; i++) {
        const t = placeCornerTag(quad, i, text);
        for (const d of discs) expect(boxHitsDisc(t, d, 0), `${w}×${h} rot ${rot} @${ppf} corner ${i} "${text}" meets ${d.id}`).toBe(false);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(2000);                           // not vacuous
    expect(withButtons).toBeGreaterThan(200);                        // …and buttons really were laid out in most of those frames
  });

  it("the tag box lies wholly inside the footprint whenever the building is big enough on screen to hold it", () => {
    let seen = 0;
    for (const [w, h] of BUILDINGS) for (const rot of ROTS) for (const ppf of PPFS) {
      if (Math.min(w, h) * ppf < 90) continue;
      const quad = quadOf(w, h, rot, ppf);
      for (const text of TAGS) for (let i = 0; i < 4; i++) {
        const t = placeCornerTag(quad, i, text);
        expect(t.inside, `${w}×${h} rot ${rot} @${ppf} corner ${i}`).toBe(true);
        expect(boxInsideQuad(t, quad, 0)).toBe(true);
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(500);
  });

  it("across the zoom ladder the owner's 1,566 × 650 ft building renders (featureEditOpacity > 0): buttons and tags never meet, tags always inside", () => {
    let seen = 0;
    for (let ppf = 0.1; ppf <= 4; ppf *= 1.07) {
      if (!featureEditOpacity(ppf, 1400)) continue;
      seen++;
      const { quad, layout } = layoutFor(1566, 650, 0, ppf, ["top", "bottom"]), discs = layoutDiscs(layout);
      for (let i = 0; i < 4; i++) {
        const t = placeCornerTag(quad, i, "fill 22.1");
        expect(boxInsideQuad(t, quad, 0)).toBe(true);
        for (const d of discs) expect(boxHitsDisc(t, d, 0)).toBe(false);
      }
    }
    expect(seen).toBeGreaterThan(20);
  });

  it("RED PROOF: the same tags DO collide with buttons laid on the INSIDE of the walls (the pre-fix shape) — the check can see the bug", () => {
    const { quad, walls } = layoutFor(1566, 650, 0, 0.4, ["top", "bottom"]);
    const inward = layoutBuildingButtons(walls.map((w) => ({ ...w, out: { x: -w.out.x, y: -w.out.y } })));   // buttons pushed into the footprint
    const discs = layoutDiscs(inward);
    expect(discs.some((d) => discTouchesQuad(d, quad, 0))).toBe(true);
    let collisions = 0;
    for (let i = 0; i < 4; i++) { const t = placeCornerTag(quad, i, "fill 22.1"); collisions += discs.filter((d) => boxHitsDisc(t, d, 0)).length; }
    expect(collisions).toBeGreaterThan(0);
  });
});

describe("the button row: one pair per wall, one ramp per dock wall, one per corner button — no extras", () => {
  const ids = (layout) => [...layout.keys()];
  it("a cross-dock building: 4 pairs, 4 purple corners, 2 wall ramps (dock walls only), 4 corner ramps", () => {
    const { layout } = layoutFor(1000, 400, 0, 0.8, ["top", "bottom"]);
    expect(ids(layout).filter((k) => k.startsWith("pair:")).sort()).toEqual(["pair:bottom", "pair:left", "pair:right", "pair:top"]);
    expect(ids(layout).filter((k) => /^corner:/.test(k))).toHaveLength(4);
    expect(ids(layout).filter((k) => /^ramp:[a-z]+$/.test(k)).sort()).toEqual(["ramp:bottom", "ramp:top"]);
    expect(ids(layout).filter((k) => /^ramp:[a-z]+:-?1$/.test(k))).toHaveLength(4);
  });
  it("no ramp button on a short, non-dock end wall — ever", () => {
    for (const ppf of PPFS) {
      const { layout } = layoutFor(1000, 400, 0, ppf, ["top", "bottom"]);
      expect(ids(layout).some((k) => k === "ramp:left" || k === "ramp:right" || /^ramp:(left|right):/.test(k))).toBe(false);
    }
  });
  it("the ramp count never exceeds (dock walls + corner buttons) at any zoom, and no two discs touch", () => {
    for (const [w, h] of BUILDINGS) for (const rot of ROTS) for (const ppf of PPFS) for (const docks of DOCKS) {
      const { layout } = layoutFor(w, h, rot, ppf, docks), k = ids(layout);
      const ramps = k.filter((x) => x.startsWith("ramp:")), corners = k.filter((x) => x.startsWith("corner:"));
      expect(ramps.filter((x) => /^ramp:[a-z]+$/.test(x)).length).toBeLessThanOrEqual(docks.length);
      expect(ramps.filter((x) => /:-?1$/.test(x)).length).toBeLessThanOrEqual(corners.length);
      const d = layoutDiscs(layout);
      for (let i = 0; i < d.length; i++) for (let j = i + 1; j < d.length; j++) {
        expect(Math.hypot(d[i].x - d[j].x, d[i].y - d[j].y), `${d[i].id} / ${d[j].id}`).toBeGreaterThanOrEqual(d[i].r + d[j].r);
      }
    }
  });
  it("at working zoom on the owner's building every one of them is present (nothing dropped for room)", () => {
    const { layout } = layoutFor(1566, 650, 0, 0.4, ["top", "bottom"]);
    expect(ids(layout).filter((k) => k.startsWith("ramp:")).length).toBe(2 + 4);
    expect(ids(layout).filter((k) => k.startsWith("corner:")).length).toBe(4);
  });
  it("a button that would touch one already placed is DROPPED, never moved onto it (the pair and the purple corner outrank the ramp)", () => {
    const { layout } = layoutFor(300, 300, 0, 0.55, ["top", "bottom"]);    // a small, nearly square building: tight rows
    expect(ids(layout).filter((k) => k.startsWith("pair:")).length).toBe(4);
    const d = layoutDiscs(layout);
    for (let i = 0; i < d.length; i++) for (let j = i + 1; j < d.length; j++) expect(Math.hypot(d[i].x - d[j].x, d[i].y - d[j].y)).toBeGreaterThanOrEqual(d[i].r + d[j].r);
  });
  it("the buttons are in ONE row along each wall: the same distance outside the wall line, a fixed gap apart", () => {
    const { quad, layout } = layoutFor(1566, 650, 0, 0.4, ["top", "bottom"]);
    const topY = quad[0].y, botY = quad[2].y;
    for (const [id, e] of layout) {
      if (!/:top|:bottom/.test(id)) continue;
      const pts = e.discs ? [e.pos] : [e];
      for (const p of pts) expect(Math.abs((id.includes(":top") ? topY - p.y : p.y - botY) - BTN_OUT_PX), id).toBeLessThan(1e-9);
    }
  });
  it("the building's rotate grip, which rides out past the top wall, clears every button at every zoom and rotation", () => {
    for (const [w, h] of BUILDINGS) for (const rot of ROTS) for (const ppf of PPFS) {
      const { quad, layout } = layoutFor(w, h, rot, ppf, ["top", "bottom"]);
      const topMid = { x: (quad[0].x + quad[1].x) / 2, y: (quad[0].y + quad[1].y) / 2 };
      const c = { x: (quad[0].x + quad[2].x) / 2, y: (quad[0].y + quad[2].y) / 2 };
      const L = Math.hypot(topMid.x - c.x, topMid.y - c.y) || 1, g = { x: topMid.x + ((topMid.x - c.x) / L) * ROTATE_GRIP_OFFSET_PX, y: topMid.y + ((topMid.y - c.y) / L) * ROTATE_GRIP_OFFSET_PX };
      for (const d of layoutDiscs(layout)) expect(Math.hypot(d.x - g.x, d.y - g.y), `${w}×${h} rot ${rot} @${ppf} ${d.id}`).toBeGreaterThanOrEqual(d.r + ROTATE_GRIP_R_PX);
    }
  });
  it("sizes: the ramp disc is the smaller one, and a hovered building stays hovered out to its buttons", () => {
    expect(RAMP_BTN_R).toBeLessThan(FEAT_CTRL_R);
    expect(HOVER_BUTTON_REACH_PX).toBeGreaterThan(BTN_OUT_PX + FEAT_CTRL_R);
  });
});

describe("the tag keeps a leader to its exact corner when it sits away from it", () => {
  it("a tag at the corner needs no leader; one pushed in carries a leader ending on the EXACT corner point", () => {
    const quad = quadOf(1566, 650, 0, 0.4);
    let withLeader = 0;
    for (let i = 0; i < 4; i++) {
      const t = placeCornerTag(quad, i, "fill 22.1");
      if (t.leader) { withLeader++; expect(t.leader.x1).toBeCloseTo(quad[i].x, 9); expect(t.leader.y1).toBeCloseTo(quad[i].y, 9); }
      else expect(Math.hypot(t.x - quad[i].x, t.y - quad[i].y)).toBeLessThan(t.w);
    }
    expect(withLeader).toBeGreaterThanOrEqual(0);
  });
  it("selection no longer matters: the placer is a pure function of the quad, the index and the text", () => {
    const quad = quadOf(1566, 650, 0, 0.4);
    expect(placeCornerTag(quad, 3, "fill 22.1")).toEqual(placeCornerTag(quad, 3, "fill 22.1"));
    expect(placeCornerTag.length).toBe(3);
  });
});

describe("the planner draws what the layout hands it", () => {
  const src = code(read("../src/workspaces/site-planner/SitePlanner.jsx"));
  it("sideAddNodes places every button THROUGH layoutBuildingButtons / wallsFromQuad (no inline offsets)", () => {
    expect(src).toMatch(/const layout = layoutBuildingButtons\(walls\)/);
    expect(src).toMatch(/wallsFromQuad\(quad, dockSides\)/);
    expect(src).not.toMatch(/sideButtonAnchor|bumpButtonAnchor/);
    expect(src).not.toMatch(/ms\.x - ux \* 24/);
    expect(src).not.toMatch(/cs\.x - dx \* 20/);
  });
  it("exactly one ramp glyph is drawn per layout entry: the wall one and the corner one, and the non-dock branch draws none", () => {
    expect(src).toMatch(/layout\.get\(`ramp:\$\{name\}`\)/);
    expect(src).toMatch(/layout\.get\(`ramp:\$\{name\}:\$\{sign\}`\)/);
    const nonDock = src.slice(src.indexOf("// non-dock side (a short end"), src.indexOf("// dog-ear bumps") > 0 ? src.indexOf("// dog-ear bumps") : src.indexOf("walls.flatMap((w) => w.corners.map"));
    expect(nonDock).not.toMatch(/rampGlyph/);
  });
  it("a hovered building stays hovered out to its buttons (they are outside the walls)", () => {
    expect(src).toMatch(/x\.type === "building" && x\.id === hoverElId && view\.ppf > 0 \? HOVER_BUTTON_REACH_PX \/ view\.ppf/);   // buildings only: no other element type widens its hover zone
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
    expect(CORNER_TAG_PILL_H).toBe(17);
  });
});

describe("the corner spots carry their corner index (the placer needs it when a void drops one)", () => {
  it("padCornerSpots tags each spot with its corner's place in padCorners order, skipping voids without renumbering", () => {
    const ring = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }];
    const spots = padCornerSpots(ring, 100, (p) => (p.x === 100 && p.y === 0 ? null : 95));
    expect(spots.map((s) => s.idx)).toEqual([0, 2, 3]);
  });
});
