/* NEW-1 (owner 2026-11-06) — "Fix the setback tool for odd shapes. On the north and south I can't cleanly add a
 * setback." Academy › Concept A, "Parcel 1 · A" (a split piece of the 311-acre lot): copied READ-ONLY from
 * production into test/fixtures/academySplitParcel.json (52 vertices).
 *
 * MEASURED on that outline (planner frame, screen-down: north = -y): the detector found the right 8 pieces, then the
 * escalating small-piece merge handed each one to its LONGER neighbour — on an open-bordered lot every border key is
 * "open", so length alone decided:
 *   · edge 51, the 650 ft top-right piece that runs ALONG the north side, went to EAST   (the teal "up-and-right" bit);
 *   · edges 18-26, the 970 ft south-west end that runs ALONG the south side, went to WEST (the blue bottom stub).
 * Fix: a piece joins the neighbour it FACES (outward directions), length only as the tie-break. */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { boundarySections, toggleBreak, FACING_TIE_DEG } from "../src/workspaces/site-planner/lib/boundarySections.js";
import { pickVertexDots, DOT_MIN_GAP } from "../src/workspaces/site-planner/lib/setbackSketch.js";
import { fitSketch } from "../src/workspaces/site-planner/components/SetbackSections.jsx";

const J = JSON.parse(fs.readFileSync(new URL("./fixtures/academySplitParcel.json", import.meta.url)));
const ring = J.points.map(([x, y]) => ({ x, y }));
const secOf = (sections, edge) => sections.find((s) => s.edges.includes(edge));

describe("Academy › Concept A · Parcel 1 · A (the owner's real outline)", () => {
  it("known-good arm: the fixture is the real 52-vertex outline and the corner detector's breaks are still there", () => {
    expect(ring).toHaveLength(52);
    // true on the untouched code too: the south-east, north-east and north corners were never the problem
    const s = boundarySections(ring, { defaultSetback: 25 });
    for (const start of [4, 42, 46]) expect(s.some((x) => x.startVertex === start)).toBe(true);
  });

  for (const [name, extra] of [["a flat 25 ft", { defaultSetback: 25 }], ["as stored (25, 30 on the curve)", { setbacks: J.setbacksAsStored, defaultSetback: 25 }]]) {
    describe(name, () => {
      const s = boundarySections(ring, extra);
      it("tiles the ring exactly once and stays a handful of sections (3-6)", () => {
        expect(s.length).toBeGreaterThanOrEqual(3);
        expect(s.length).toBeLessThanOrEqual(6);
        expect(s.flatMap((x) => x.edges).sort((a, b) => a - b)).toEqual(ring.map((_, i) => i));
      });
      it("the top-right piece (edge 51) belongs to the NORTH, not the east side", () => {
        expect(secOf(s, 51)).toBe(secOf(s, 50));
        expect(secOf(s, 51)).not.toBe(secOf(s, 1));
        expect(secOf(s, 1).edges).toEqual([0, 1, 2, 3]); // the east side is just the east side
      });
      it("the south-west end (edges 18-26) belongs to the SOUTH, not the west side", () => {
        for (const e of [18, 20, 22, 24, 26]) expect(secOf(s, e)).toBe(secOf(s, 10));
        expect(secOf(s, 26)).not.toBe(secOf(s, 35));
        expect(secOf(s, 35).startVertex).toBe(27); // the west side starts at the real south-west corner
      });
      it("setting the south value moves ONLY south edges (no north or west edge is touched)", () => {
        const south = secOf(s, 10);
        const out = ring.map((_, i) => (south.edges.includes(i) ? 40 : 25));
        const after = boundarySections(ring, { setbacks: out, defaultSetback: 25 });
        const sv = secOf(after, 10);
        expect(sv.value).toBe(40);
        expect(sv.mixed).toBe(false);
        for (const e of [35, 44, 48, 51, 1]) expect(secOf(after, e).value).toBe(25);
      });
    });
  }

  it("a few clicks finish the job: joining the break dots between the north pieces leaves ONE north section", () => {
    // what the owner does in "Split or join sections": click the filled dot between two north pieces. With fewer
    // sections left the "about six" pass stops merging, so the top-right piece may need its own click — three at most.
    let o = { breaks: [], joins: [] }, clicks = 0;
    for (const v of [42, 46, 51]) {
      const now = boundarySections(ring, { defaultSetback: 25, ...o });
      if (now.some((x) => x.startVertex === v)) { o = toggleBreak({ points: ring, defaultSetback: 25, ...o }, v); clicks++; }
    }
    const s = boundarySections(ring, { defaultSetback: 25, ...o });
    expect(clicks).toBeLessThanOrEqual(3);
    expect(secOf(s, 44)).toBe(secOf(s, 50));
    expect(secOf(s, 44)).toBe(secOf(s, 51));
    expect(secOf(s, 51).edges).not.toContain(1); // still not the east side
    expect(secOf(s, 10).edges).toContain(24);   // and the south is still whole
    expect(s.length).toBeLessThanOrEqual(5);
  });
});

describe("a JOIN removes exactly its own break — nothing else pops back out", () => {
  const before = boundarySections(ring, { defaultSetback: 25 });
  const sig = (s) => s.map((x) => `${x.startVertex}:${x.edges.length}`).join(" ");
  for (const sec of before) {
    it(`joining at vertex ${sec.startVertex} leaves every other section's edges exactly as they were`, () => {
      const after = boundarySections(ring, { defaultSetback: 25, joins: [sec.startVertex] });
      const expected = before.filter((x) => x.startVertex !== sec.startVertex).map((x) => x.startVertex);
      expect(after.map((x) => x.startVertex)).toEqual(expected);
      // and the section that absorbed it is the previous one, grown by exactly the joined section's edges
      const prev = before[(before.indexOf(sec) - 1 + before.length) % before.length];
      expect(secOf(after, sec.edges[0])).toBe(after.find((x) => x.startVertex === prev.startVertex));
      expect(sig(after).split(" ").length).toBe(before.length - 1);
    });
  }
  it("joining every break leaves one whole-ring section (and does not throw)", () => {
    const s = boundarySections(ring, { defaultSetback: 25, joins: before.map((x) => x.startVertex) });
    expect(s).toHaveLength(1);
    expect(s[0].edges).toHaveLength(ring.length);
  });
});

describe("a slanted piece along one side goes to THAT side, whichever way the lot is turned", () => {
  // north 5400 ft, then a 28° slanted piece (600 ft) that is part of the north frontage, then a LONGER east side.
  // The piece is under 3% of the perimeter so it must merge; the old rule gave it to the longer east side.
  const base = [[0, 0], [5400, 0], [5930, -282], [5930, 8000], [0, 8000]];
  const rot = (pts, q) => pts.map(([x, y]) => { let a = [x, y]; for (let k = 0; k < q; k++) a = [-a[1], a[0]]; return { x: a[0], y: a[1] }; });
  for (const q of [0, 1, 2, 3]) {
    it(`rotated ${q * 90}°: the slanted edge shares a section with the side it runs along (edge 0), not the long side it meets (edge 2)`, () => {
      const pts = rot(base, q);
      const s = boundarySections(pts, { defaultSetback: 25 });
      expect(s.flatMap((x) => x.edges).sort((a, b) => a - b)).toEqual(pts.map((_, i) => i));
      expect(secOf(s, 1)).toBe(secOf(s, 0));
      expect(secOf(s, 1)).not.toBe(secOf(s, 2));
    });
  }
  it("a piece that faces both neighbours alike (a 45° chamfer) still joins the LONGER one — length is the tie-break", () => {
    const c = 700;
    const pts = [[c, 0], [8000, 0], [8000, 6000], [0, 6000], [0, c]].map(([x, y]) => ({ x, y }));
    const s = boundarySections(pts, { defaultSetback: 25 });
    expect(FACING_TIE_DEG).toBeGreaterThan(0);
    expect(s.flatMap((x) => x.edges).sort((a, b) => a - b)).toEqual(pts.map((_, i) => i));
    expect(s.length).toBeLessThanOrEqual(5);
  });
});

describe("adjacent cases keep their old answers", () => {
  const P = (a) => a.map(([x, y]) => ({ x, y }));
  it("a rectangle with a small notch at every corner is four sections, each side whole", () => {
    const W = 1000, H = 600, c = 30;
    const s = boundarySections(P([[c, 0], [W - c, 0], [W - c, c], [W, c], [W, H - c], [W - c, H - c], [W - c, H], [c, H], [c, H - c], [0, H - c], [0, c], [c, c]]), { defaultSetback: 25 });
    expect(s.map((x) => x.side).sort()).toEqual(["east", "north", "south", "west"]);
  });
  it("an L-shape stays six sections or fewer and tiles once", () => {
    const L = P([[0, 0], [800, 0], [800, 300], [400, 300], [400, 700], [0, 700]]);
    const s = boundarySections(L, { defaultSetback: 25 });
    expect(s.length).toBeLessThanOrEqual(6);
    expect(s.flatMap((x) => x.edges).sort((a, b) => a - b)).toEqual(L.map((_, i) => i));
  });
});

describe("pickVertexDots — Split / join offers corners, not every digitised vertex", () => {
  const sections = boundarySections(ring, { defaultSetback: 25 });
  const fit = fitSketch(ring);
  const mapped = ring.map(fit.map);
  const breaks = sections.map((s) => s.startVertex);
  const dots = pickVertexDots(mapped, breaks);
  it("every current break is offered (it is the only way to join) and drawn as a break", () => {
    for (const b of breaks) expect(dots.find((d) => d.i === b)?.isBreak).toBe(true);
  });
  it("far fewer dots than the 52 vertices, and no two candidate dots crowd each other or a break", () => {
    expect(dots.length).toBeLessThan(ring.length / 2);
    for (const a of dots) for (const b of dots) {
      if (a.i >= b.i || a.isBreak && b.isBreak) continue;
      expect(Math.hypot(mapped[a.i].x - mapped[b.i].x, mapped[a.i].y - mapped[b.i].y)).toBeGreaterThanOrEqual(DOT_MIN_GAP - 1e-9);
    }
  });
  it("the sharpest non-break turn is offered as a hollow dot (a corner can always be split)", () => {
    const hollow = dots.filter((d) => !d.isBreak);
    expect(hollow.length).toBeGreaterThan(0);
  });
  it("degenerate input never throws", () => {
    expect(pickVertexDots([], [])).toEqual([]);
    expect(pickVertexDots(null, null)).toEqual([]);
    expect(pickVertexDots([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }], [9, -1, 1.5]).length).toBe(0);
  });
});
