/* The 3D viewer's MODEL BUILD (owner-only grading layer; NEW-1, 2026-11-11). PURE (no three.js, no DOM) — one generator that turns the planner's
 * proposed surface + the DEM + the parcels + the buildings into every typed array the scene draws, yielding a 0..1 fraction as it goes so
 * `runChunked` can keep each slice under ~10 ms and feed the "Regrading…" banner. Opening the viewer, or the plan regrading while it is open,
 * never holds the main thread (B2319137): sampling is one yield per lattice row, meshing one per row of cells.
 *
 * Returns { field, regions, baseZ, top, walls, ghost, outline, sample, footprints, defaultLine, extentFt } or null when there is nothing to show
 * (no parcel, or the ground never loaded). */
import { unionRings } from "../gradingLimit.js";
import { sampleFieldSteps, exactSampler } from "./field.js";
import { topSurfaceSteps, wallsSteps, buildGhost, buildingFootprints, buildOutlineRibbons, baseElevation, defaultSliceLine } from "./meshBuild.js";

/* Run a sub-generator, mapping the 0..1 fractions it yields into [a, b] of the whole job. */
function* scaled(gen, a, b) {
  let r = gen.next();
  while (!r.done) { yield typeof r.value === "number" ? a + (b - a) * r.value : r.value; r = gen.next(); }
  return r.value;
}

export function* buildModelSteps({ grid, existAt, parcelRings, els, maxSamples } = {}) {
  const regions = unionRings(parcelRings || []);
  if (!regions.length || typeof existAt !== "function") return null;
  const field = yield* scaled(sampleFieldSteps({ grid, existAt, regions, maxSamples }), 0, 0.55);
  if (!field) return null;
  const baseZ = baseElevation(field.zLo, field.zHi);
  const top = yield* scaled(topSurfaceSteps(field, regions), 0.55, 0.85);
  const walls = yield* scaled(wallsSteps(field, regions, baseZ), 0.85, 0.93);
  yield 0.95;
  const ghost = buildGhost(field);
  const footprints = buildingFootprints(els);
  const extentFt = Math.max(field.bounds.x1 - field.bounds.x0, field.bounds.y1 - field.bounds.y0);
  const outline = buildOutlineRibbons(field, footprints.map((b) => b.regions), { widthFt: Math.max(2.5, extentFt / 650), liftFt: 0.5 });
  return {
    field, regions, baseZ, top, walls, ghost, outline, footprints, extentFt,
    sample: exactSampler(grid, existAt),
    defaultLine: defaultSliceLine(footprints, field.bounds),
  };
}
