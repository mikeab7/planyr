/* Buildable-ground lattice glue (NEW-1) — turns the B808 site DEM grid (the `fetchSiteGrid` result:
 * LERC-decoded FEET values + validity mask + its request) into the 10-ft feet-frame lattice
 * `buildableGround.js` sweeps. WORKER-SAFE: only the pure terrain modules (demGrid, mapLock) are
 * imported — terrainWorker.js runs this beside the sweep so the resample (tens of thousands of
 * bilinear reads) never lands on the main thread either. Pure, no DOM. */
import { sampleAtLatLng } from "./demGrid.js";
import { feetToLatLngPair } from "./mapLock.js";
import { buildLattice, CELL_FT } from "./buildableGround.js";

/* Resample a DEM grid onto a feet lattice over `bbox` ([x0,y0,x1,y1] feet about `origin` {lat, lon}).
 * A cell the DEM cannot answer (off-grid or a void corner) is NaN — never zero. */
export function latticeFromDem({ grid, req, origin, bbox, cell = CELL_FT }) {
  return buildLattice({
    bbox, cell,
    sample: (x, y) => {
      const [lat, lng] = feetToLatLngPair({ x, y }, origin.lat, origin.lon);
      return sampleAtLatLng(grid, req, lat, lng);
    },
  });
}

/* The sweep's bounding box: the parcel's own box plus a margin so the daylight test has ground to look
 * at just past the boundary ("parcel bbox + 200 ft", per the brief). */
export function sweepBBox(rings, marginFt = 200) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const ring of rings) for (const p of ring) {
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
  }
  return isFinite(x0) ? [x0 - marginFt, y0 - marginFt, x1 + marginFt, y1 + marginFt] : null;
}
