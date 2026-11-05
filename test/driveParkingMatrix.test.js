/* NEW-1 (road → employee-parking, every approach) — THE APPROACH MATRIX, through the real pure pipeline.
 *
 * Every case is drawn in a rect field's own frame (test/helpers/driveMatrix.js), then re-run at rot 0 / 90 / 270 / 23, as a
 * rect field AND a free-drawn polygon field, as a free field AND a building-attached one. A case passes only when the FINISHED
 * geometry is clean: one joined pavement, a curb return on each side that has room, the outline open across the mouth and
 * nowhere else, no pavement under a building, and no stall left painted inside the drive.
 *
 * Run it on `main` first: `MATRIX_REPORT=1 npx vitest run test/driveParkingMatrix.test.js` prints every failing cell.
 */
import { describe, it, expect } from "vitest";
import { makeField, makeRoad, measure, SETTINGS, stallCells, netOf } from "./helpers/driveMatrix.js";

const AISLE_Y = (SETTINGS.stallDepth + SETTINGS.aisle / 2);           // local y of the first aisle's centreline (30)
const ROTS = [0, 90, 270, 23];

// [name, field opts, road opts, measure opts, extra check name]
const CASES = [
  ["1 head-on aisle end, centred", {}, { face: "left", along: AISLE_Y }, {}],
  ["1b head-on aisle end, 3 ft off", {}, { face: "left", along: AISLE_Y + 3 }, { aisleSnap: true }],
  ["1c head-on, far (right) end", {}, { face: "right", along: AISLE_Y }, {}],
  ["2 perpendicular into a row side", { w: 200, h: 60 }, { face: "top", along: 100 }, { rowSide: true }],
  ["2b perpendicular into the far row side", { w: 200, h: 60 }, { face: "bottom", along: 100 }, { rowSide: true }],
  ["3 oblique aisle end +30", {}, { face: "left", along: AISLE_Y, angle: 30 }, {}],
  ["3 oblique aisle end -45", {}, { face: "left", along: AISLE_Y, angle: -45 }, {}],
  ["3 oblique aisle end +60", {}, { face: "left", along: AISLE_Y, angle: 60 }, {}],
  ["3 oblique row side +30", {}, { face: "top", along: 100, angle: 30 }, { rowSide: true }],
  ["3 oblique row side -45", {}, { face: "top", along: 100, angle: -45 }, { rowSide: true }],
  ["3 oblique row side +60", {}, { face: "top", along: 100, angle: 60 }, { rowSide: true }],
  ["3 near-parallel 85", {}, { face: "top", along: 100, angle: 85 }, { runaway: true, expectWedges: null }],
  ["3 near-parallel -89", {}, { face: "top", along: 100, angle: -89 }, { runaway: true, expectWedges: null }],
  ["4 near a corner (row side, 10 ft in)", {}, { face: "top", along: 10 }, { rowSide: true, expectWedges: null }],
  ["4 near a corner (aisle end beside the corner)", { h: 40 }, { face: "left", along: 8 }, { expectWedges: null }],
  ["6 endpoint just inside (4 ft)", {}, { face: "top", along: 100, insideFt: 4 }, { rowSide: true }],
  ["6 endpoint well inside (30 ft)", {}, { face: "top", along: 100, insideFt: 30 }, { rowSide: true }],
  ["6 aisle-end endpoint inside (20 ft)", {}, { face: "left", along: AISLE_Y, insideFt: 20 }, {}],
  ["4 near a corner + endpoint inside (the road is wider than the room beside it)", {}, { face: "top", along: 10, insideFt: 20 }, { rowSide: true, expectWedges: null }],
  ["4 aisle end near the corner + endpoint inside", { h: 42 }, { face: "left", along: 30, insideFt: 19, travelW: 24 }, { expectWedges: null }],
  ["9 two modules, second aisle", { h: 120 }, { face: "left", along: AISLE_Y + 60 }, {}],
  ["9 flipDepth (aisle on the near edge)", { cfg: { flipDepth: true } }, { face: "top", along: 100 }, { expectWedges: 2 }],
  ["9 single-loaded bay (one row + a lane, h 42): into the row side", { h: 42 }, { face: "top", along: 100 }, { rowSide: true }],
  ["9 single-loaded bay, flipped (the lane is on the near edge): arrives in the lane", { h: 42, cfg: { flipDepth: true } }, { face: "top", along: 100 }, {}],
  ["9 single-loaded bay: into the lane's end (the road overhangs the field edge: one side has no room)", { h: 42 }, { face: "left", along: 30 }, { expectWedges: null }],
  ["10 24 ft drive", {}, { face: "left", along: AISLE_Y, travelW: 24 }, {}],
  ["10 26 ft road row side", {}, { face: "top", along: 100, travelW: 26 }, { rowSide: true }],
  ["no stored driveTee (geometric detection)", {}, { face: "left", along: AISLE_Y, stored: false }, {}],
];

const report = [];
const CELLS = [];
for (const [name, fo, ro, mo] of CASES) {
  for (const rot of ROTS) for (const shape of ["rect", "poly"]) for (const attached of [false, true]) {
    if (shape === "poly" && (mo.rowSide || mo.aisleSnap)) continue;     // a polygon field has no stall rows (estimated count only)
    CELLS.push({ name, fo, ro, mo, rot, shape, attached });
  }
}

describe("road → parking approach matrix (real pipeline)", () => {
  it.each(CELLS.map((c) => [`${c.name} | rot ${c.rot} | ${c.shape} | ${c.attached ? "attached" : "free"}`, c]))("%s", async (label, c) => {
    const field = makeField({ ...c.fo, rot: c.rot, shape: c.shape, attached: c.attached });
    const road = makeRoad(field, c.ro);
    const m = await measure([field, road], { expectWedges: c.mo.expectWedges === undefined ? 2 : c.mo.expectWedges, entryFace: c.ro.face });
    const fails = [...m.fails];
    if (c.mo.rowSide && m.facts.cellsUnderDrive > 0) {
      const { net } = await netOf([field, road]);
      const clip = net.stallClips.get(field.id);
      if (!clip) fails.push(`${m.facts.cellsUnderDrive} stall(s) painted inside the drive (no stall clip for the field)`);
      else {
        const left = m.facts.hit.filter((k) => !clip.set.has(k));
        if (left.length) fails.push(`${left.length} stall(s) still inside the drive after the clip: ${left.join(",")}`);
        const all = new Set(stallCells(field, SETTINGS).map((c2) => `${c2.band}:${c2.k}`));
        if ([...clip.set].some((k) => !all.has(k))) fails.push("the clip names a stall that does not exist");
        if (clip.count !== clip.base - clip.removed.length) fails.push("stall count disagrees with the stalls removed");
        if (clip.removed.length > m.facts.hit.length + 4) fails.push(`removed ${clip.removed.length} stalls for a drive that covers ${m.facts.hit.length} (over-removal)`);
      }
    }
    if (c.mo.runaway && m.j) {
      const far = Math.max(0, ...m.j.geom.wedges.flat().map((p) => Math.hypot(p.x - m.j.junctionPt.x, p.y - m.j.junctionPt.y)));
      if (far > 90) fails.push(`curb return reaches ${far.toFixed(0)} ft from the junction (near-parallel runaway)`);
    }
    if (process.env.MATRIX_REPORT && fails.length) report.push(`${label}\n    - ${fails.join("\n    - ")}`);
    expect(fails, label).toEqual([]);
  });
  it("(report)", () => { if (process.env.MATRIX_REPORT) console.log(`\nMATRIX-FAILS ${report.length}\n` + report.join("\n")); });
});
