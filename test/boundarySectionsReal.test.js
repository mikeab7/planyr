/* NEW-1 (B2191xxx) — the Setbacks section on the owner's three real Silvestri parcels (copied read-only from
 * production, test/fixtures/silvestriParcels.json). Before: SCHIEL 11 sections, Parcel 2 10, TRS 1B-10 13, with
 * "(1)/(2)/(3)" twins of one road next to each other. A typical parcel is a handful (3–6). */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { boundarySections } from "../src/workspaces/site-planner/lib/boundarySections.js";

const J = JSON.parse(fs.readFileSync(new URL("./fixtures/silvestriParcels.json", import.meta.url)));
const P = (a) => a.map(([x, y]) => ({ x, y }));
const rings = { schiel: P(J.schiel), parcel2: P(J.parcel2), trs: P(J.trs) };
const streets = J.roads.map((r) => ({ name: r.name, pts: P(r.pts) }));
const run = (k, extra = {}) => boundarySections(rings[k], {
  defaultSetback: 25, streets,
  neighbours: Object.entries(rings).filter(([o]) => o !== k).map(([o, points]) => ({ id: o, name: o, points })), ...extra,
});

describe("the three real Silvestri parcels come out at no more than 6 sections", () => {
  for (const k of ["schiel", "parcel2", "trs"]) {
    it(`${k}: <= 6 sections, tiling the ring exactly once`, () => {
      const s = run(k);
      expect(s.length).toBeGreaterThanOrEqual(2);
      expect(s.length).toBeLessThanOrEqual(6);
      const edges = s.flatMap((x) => x.edges).sort((a, b) => a - b);
      expect(edges).toEqual(rings[k].map((_, i) => i));
    });
    it(`${k}: no two ADJACENT sections share a label base ("(1)/(2)" twins of one road)`, () => {
      const s = run(k), base = (l) => l.replace(/ \(\d+\)$/, "");
      for (let i = 0; i < s.length; i++) {
        const a = s[i], b = s[(i + 1) % s.length];
        if (a !== b) expect(base(a.label) === base(b.label) && /\(\d+\)$/.test(a.label)).toBe(false);
      }
    });
  }
  it("the reported counts reproduce on the PRE-fix thresholds (known-good arm: the fixture is the owner's case)", () => {
    // 21 / 38 / 56 vertices — the fixture is the real outlines, not a tidy stand-in.
    expect([rings.schiel.length, rings.parcel2.length, rings.trs.length]).toEqual([21, 38, 56]);
    expect(run("schiel").some((s) => s.border.kind === "road" && /BAUER HOCKLEY/.test(s.border.name || ""))).toBe(true);
  });
  it("a section whose setback the owner set differently is NEVER merged away", () => {
    const base = run("schiel");
    const sb = rings.schiel.map((_, i) => (base[0].edges.includes(i) ? 60 : 25));
    const s = run("schiel", { setbacks: sb });
    expect(s.some((x) => x.value === 60)).toBe(true);
    expect(s.some((x) => x.value === 25)).toBe(true);
  });
});

describe("a 1–2 vertex jog never splits a run", () => {
  const long = (jogFt, vertices) => {
    // east 900 ft, a jog north of jogFt over `vertices` extra points, east 900 ft, then a real turn back around
    const pts = [{ x: 0, y: 0 }, { x: 900, y: 0 }];
    if (vertices === 1) pts.push({ x: 900 + jogFt, y: -jogFt });
    else { pts.push({ x: 900, y: -jogFt }); }
    pts.push({ x: 1800, y: -jogFt }, { x: 1800, y: 900 }, { x: 0, y: 900 });
    return pts;
  };
  for (const [jog, v] of [[20, 2], [35, 2], [50, 2], [30, 1]]) {
    it(`a ${jog} ft step over ${v} vertices keeps the north side one section (4 sides total)`, () => {
      expect(boundarySections(long(jog, v), { defaultSetback: 25 })).toHaveLength(4);
    });
  }
  it("control: a REAL corner still splits (the square is 4 sections)", () => {
    expect(boundarySections([{ x: 0, y: 0 }, { x: 900, y: 0 }, { x: 900, y: 900 }, { x: 0, y: 900 }], { defaultSetback: 25 })).toHaveLength(4);
  });
});
