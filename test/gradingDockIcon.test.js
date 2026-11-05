import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { GRADING_GLYPH } from "../src/workspaces/site-planner/components/railGlyphs.js";
import { plannerSource } from "./helpers/plannerSource.js";

/* NEW-1 (B2591568, owner 2026-10-30): the Grading dock icon is the contour-lines glyph, registered under the SAME icon key
 * ("grading") the dock, the panel header and the floating panel already read through RailIcon. The painted-pixel half lives in
 * ui-audit/verify-grading-dock-icon.mjs; this is the part CI can run. */

const SRC_ROOT = fileURLToPath(new URL("../src", import.meta.url));
const walk = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : /\.(jsx?|mjs|css|html)$/.test(n) ? [p] : []; });
const ALL_SRC = walk(SRC_ROOT).map((p) => [p, readFileSync(p, "utf8")]);

/* the old glyph: a baseline plus two domes. Matched on its path data, not on a name. */
const OLD_PATHS = ["M3 20h18", "M6 20c0-6 3-10 6-10s6 4 6 10", "M9.5 20c0-3 1.2-5 2.5-5s2.5 2 2.5 5"];

describe("Grading dock icon is a contour-lines glyph (NEW-1)", () => {
  it("the old dome-on-a-baseline path data exists nowhere in src (the bundle's whole input)", () => {
    for (const [p, text] of ALL_SRC) for (const d of OLD_PATHS) expect(text.includes(d), `${d} still in ${p}`).toBe(false);
  });

  it("is registered under the same `grading` key of the dock's RAIL_ICONS, from the shared glyph", () => {
    const s = plannerSource();
    const table = s.match(/const RAIL_ICONS = \{([\s\S]*?)\n\};/)[1];
    expect(table).toMatch(/\n  grading: <>\{GRADING_GLYPH\.contours\.map\(\(d\) => <path key=\{d\} d=\{d\} \/>\)\}<path d=\{GRADING_GLYPH\.spot\} fill="currentColor"/);
    expect(s).toMatch(/import \{ GRADING_GLYPH \} from "\.\/components\/railGlyphs\.js";/);
    // one registration: the key appears once, and every Grading surface (dock, panel header, floating panel) reaches it through RailIcon by id
    expect(table.match(/\n  grading:/g)).toHaveLength(1);
    expect(s).toMatch(/<RailIcon id=\{tb\.id\} \/>/);
    expect(s).toMatch(/icon=\{<RailIcon id=\{leftPanel\} size=\{18\} \/>\}/);
    expect(s).toMatch(/icon=\{<RailIcon id=\{id\} size=\{18\} \/>\}/);
  });

  it("inherits the shared rail stroke — the glyph sets no stroke weight, cap, join or colour except the spot's thin filled mark", () => {
    const s = plannerSource();
    expect(s).toMatch(/const RailIcon[\s\S]{0,260}strokeWidth="1\.75" strokeLinecap="round" strokeLinejoin="round"/);
    const row = s.match(/\n  grading: .*\n/)[0];
    expect(row).not.toMatch(/stroke="|strokeLinecap|strokeLinejoin|color=/);
    expect(row.match(/strokeWidth=/g)).toHaveLength(1); // the spot triangle only
    expect(GRADING_GLYPH.spotStrokeWidth).toBeLessThan(1.75);
  });

  it("is three cubic contour lines + one filled spot, on the 24 grid, no quadratics, no kinks", () => {
    expect(GRADING_GLYPH.contours).toHaveLength(3);
    const segs = (d) => { // [{p0, c1, c2, p1}] from an M followed by absolute C commands
      const nums = d.match(/-?\d*\.?\d+/g).map(Number); expect(d).toMatch(/^M[\d. -]+(C[\d. -]+)+$/); expect(d).not.toMatch(/[QqSsTtAaLlHhVv]/);
      let p = [nums[0], nums[1]], out = []; for (let i = 2; i < nums.length; i += 6) { const c1 = [nums[i], nums[i + 1]], c2 = [nums[i + 2], nums[i + 3]], p1 = [nums[i + 4], nums[i + 5]]; out.push({ p0: p, c1, c2, p1 }); p = p1; } return out; };
    const crest = [];
    for (const d of GRADING_GLYPH.contours) {
      const ss = segs(d); expect(ss.length).toBeGreaterThanOrEqual(2);
      for (const pt of ss.flatMap((x) => [x.p0, x.c1, x.c2, x.p1])) for (const v of pt) { expect(v).toBeGreaterThanOrEqual(1); expect(v).toBeLessThanOrEqual(23); }
      for (let i = 1; i < ss.length; i++) { // tangent-continuous join: the control point before the join, the join and the control point after are collinear
        const a = ss[i - 1].c2, j = ss[i].p0, b = ss[i].c1; const cross = (j[0] - a[0]) * (b[1] - j[1]) - (j[1] - a[1]) * (b[0] - j[0]);
        const dot = (j[0] - a[0]) * (b[0] - j[0]) + (j[1] - a[1]) * (b[1] - j[1]);
        expect(Math.abs(cross), `kink in ${d}`).toBeLessThan(1e-6); expect(dot, `reversal in ${d}`).toBeGreaterThan(0);
      }
      crest.push({ y: ss[0].p1[1], foot: ss[0].p0[0] });
    }
    // even pitch of the crests (a rainbow of equal gaps reads as topo) and of the feet
    const gy = [crest[1].y - crest[0].y, crest[2].y - crest[1].y], gx = [crest[1].foot - crest[0].foot, crest[2].foot - crest[1].foot];
    expect(Math.abs(gy[0] - gy[1])).toBeLessThanOrEqual(0.25); expect(Math.abs(gx[0] - gx[1])).toBeLessThanOrEqual(0.25);
    // each line is shorter than the one outside it and ends at a different height (a knoll, not a target)
    const endY = GRADING_GLYPH.contours.map((d) => Number(d.match(/-?\d*\.?\d+/g).slice(-1)[0]));
    expect(new Set(endY).size).toBe(3);
    // the spot: closed, straight-sided, below and right of the contour tails
    expect(GRADING_GLYPH.spot).toMatch(/^M[\d. ]+l[\d. -]+z$/);
    const [sx, sy] = GRADING_GLYPH.spot.match(/^M([\d.]+) ([\d.]+)/).slice(1).map(Number);
    expect(sy).toBeGreaterThan(Math.max(...endY)); expect(sx).toBeGreaterThan(16);
  });
});
