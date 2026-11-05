/* Buildable-ground client (NEW-1/NEW-2, owner-only grading layer) — the main-thread half. Fetches the
 * site DEM through the SAME `fetchSiteGrid` the drainage check uses (cached by its deterministic request
 * key, so the Ground row and the drainage check share one pull), then hands the DEM + setback rings to
 * the terrain worker, where the lattice resample, the sweep and the pad masks run. Never imported
 * statically: it is reached through `terrainLazy.loadTerrain()` callers only (the pipeline stays off the
 * boot path), and this module itself only pulls the leaf-sized pure helpers.
 *
 * The worker caches the prepared context by `key`; the first request for a key ships the DEM, later ones
 * (a mask at another finish elevation) ship only the key and, on the worker's LOUD "no-context" reply
 * (evicted / restarted), re-send everything once. */
import { loadTerrain } from "./terrainLazy.js";
import { feetToLatLngPair } from "./mapLock.js";
import { CELL_FT } from "./buildableGround.js";

const MARGIN_FT = 200;
const FETCH_MARGIN_FT = 260;       // the DEM request reaches a little past the lattice so edge bilinears have ground

const ringSig = (ring) => {
  let h = 0;
  for (let i = 0; i < ring.length; i++) h += (ring[i].x * 7.13 + ring[i].y * 3.71) * (i + 1);
  return `${ring.length}:${Math.round(h)}`;
};

/* Lat/lng bounds of the rings' feet bbox plus `marginFt`. Pure. */
export function boundsForRings(rings, origin, marginFt = FETCH_MARGIN_FT) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rings) for (const p of r) {
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
  }
  if (!isFinite(x0)) return null;
  const nw = feetToLatLngPair({ x: x0 - marginFt, y: y0 - marginFt }, origin.lat, origin.lon);
  const se = feetToLatLngPair({ x: x1 + marginFt, y: y1 + marginFt }, origin.lat, origin.lon);
  return { west: Math.min(nw[1], se[1]), east: Math.max(nw[1], se[1]), south: Math.min(nw[0], se[0]), north: Math.max(nw[0], se[0]) };
}

const shipped = new Set();   // keys the worker is believed to hold a context for

/* The sweep key: the DEM request + the setback/parcel geometry + the origin. s and D are NOT in it — the
 * context is independent of them; they ride each request. */
export function sweepKey(reqKey, { setbackRings, holes = [], parcelRings, origin }) {
  return [reqKey, `${origin.lat.toFixed(6)},${origin.lon.toFixed(6)}`,
    setbackRings.map(ringSig).join(","), holes.map(ringSig).join(","), parcelRings.map(ringSig).join(",")].join("|");
}

async function send(t, base, withDem) {
  return t.runBuildableJob(withDem ? base : { ...base, dem: undefined });
}

/* Run a worker job for `op` ("summary" | "mask"), shipping the DEM only when the worker may not hold it. */
async function job(op, { origin, parcelRings, setbackRings, holes = [], s, D, E, dem, t }) {
  const key = sweepKey(dem.req.key, { setbackRings, holes, parcelRings, origin });
  const base = { op, key, origin, rings: setbackRings, holes, parcelRings, cell: CELL_FT, marginFt: MARGIN_FT, s, D, E,
    dem: { grid: dem.grid, req: dem.req } };
  const first = !shipped.has(key);
  try {
    const r = await send(t, base, first);
    shipped.add(key);
    return r;
  } catch (e) {
    if (!first && String(e && e.message) === "no-context") {
      const r = await send(t, base, true);
      shipped.add(key);
      return r;
    }
    throw e;
  }
}

/* Fetch (or reuse) the site DEM for these rings. LOUD: rejects when the fetch fails. */
export async function siteDem({ origin, parcelRings, dem: have = null }) {
  const t = await loadTerrain();
  if (have) return { dem: have, t };
  const bounds = boundsForRings(parcelRings, origin);
  if (!bounds) throw new Error("no parcel to screen");
  const dem = await t.fetchSiteGrid(bounds);
  return { dem, t };
}

/* The Ground row: relief, steepness, best single level pad and the whole sweep curve. */
export async function groundSummaryJob({ origin, parcelRings, setbackRings, holes = [], s, D, dem: have = null }) {
  const { dem, t } = await siteDem({ origin, parcelRings, dem: have });
  const r = await job("summary", { origin, parcelRings, setbackRings, holes, s, D, dem, t });
  return { ...r, demKey: dem.req.key };
}

/* The pad mask at finish elevation E (the Buildable layer). */
export async function buildableMaskJob({ origin, parcelRings, setbackRings, holes = [], s, D, E, dem: have = null }) {
  const { dem, t } = await siteDem({ origin, parcelRings, dem: have });
  return job("mask", { origin, parcelRings, setbackRings, holes, s, D, E, dem, t });
}
