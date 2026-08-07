/* B209502 — the WORKING half of the county resolver: decode, ray cast, edge distance.
 *
 * ⛔ WHY THIS IS SPLIT OFF `countyPolygons.js`, and why it must stay split. `counties.js` is on the
 * Site route's boot path, and anything it statically imports is charged against that route's
 * largest chunk. When this shipped as one module it put the whole resolver on the boot path and
 * pushed `bundle.largestChunkBytes` 0.7 KB past its ceiling in CI — a real breach, and the repo's
 * rule is that a feature which breaches a budget ships with a matching optimization rather than a
 * raised baseline.
 *
 * The split costs nothing in behaviour because the resolver was ALREADY asynchronous to warm: the
 * geometry arrives over the network, and every query before it lands returns a `pending` verdict.
 * So the code that decodes that geometry can arrive on exactly the same schedule. `countyPolygons.js`
 * stays a small gate on the boot path (the state, the pending verdict, the dynamic import); this
 * module — the part that only matters once there is geometry to search — rides the same lazy step.
 *
 * That is the `adminBoundaryGate.js` / `adminBoundaryData.js` and `terrainGate.js` / `terrainLazy.js`
 * shape, for the same reason: split by tier, don't hope for tree-shaking. A module imported by BOTH
 * the boot path and a lazy chunk is hoisted whole into their common ancestor.
 *
 * Pure — no DOM, no network, no module state. Everything here takes what it needs as an argument,
 * which is also what makes it directly unit-testable.
 */

/* [x0, y0, dx1, dy1, …] → [[x,y],…] in quantised units. The inverse of the delta encoding in
 * scripts/build-county-polygons.mjs. */
export function decodeRing(flat) {
  const out = [];
  let x = flat[0], y = flat[1];
  out.push([x, y]);
  for (let i = 2; i < flat.length; i += 2) {
    x += flat[i]; y += flat[i + 1];
    out.push([x, y]);
  }
  return out;
}

/* A raw asset payload → the queryable index. Exported so tests can build one without a fetch. */
export function buildIndex(payload) {
  if (!payload || !Array.isArray(payload.counties)) return null;
  const scale = payload.scale || 10000;
  return {
    scale,
    counties: payload.counties.map((c) => ({
      state: c.state,
      name: c.name,
      fips: c.fips || "",
      bbox: c.bbox,
      rings: c.rings.map(decodeRing),
    })),
  };
}

/* Standard ray-casting crossing test, in the asset's own quantised integer units so there is no
 * float drift between the encode and the test. A point exactly on an edge is deliberately not
 * special-cased — `nearEdge` is how uncertainty at a boundary is reported, not a tie-break rule
 * that could only ever be arbitrary. */
export function pointInRing(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/* How far (in quantised units) the point sits from the nearest ring edge. Only ever called for the
 * county that already answered, so it costs one extra ring walk on a hit and nothing on a miss. */
export function distToRings(rings, x, y) {
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x1, y1] = ring[j], [x2, y2] = ring[i];
      let px = x1, py = y1;
      const dx = x2 - x1, dy = y2 - y1;
      if (dx !== 0 || dy !== 0) {
        const t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy);
        if (t > 1) { px = x2; py = y2; } else if (t > 0) { px = x1 + dx * t; py = y1 + dy * t; }
      }
      const d = Math.hypot(x - px, y - py);
      if (d < best) best = d;
    }
  }
  return best;
}

/* Roughly 150 m in degrees — the band inside which the simplified geometry cannot be trusted to
 * have picked the right side of a county line. */
export const NEAR_EDGE_DEG = 0.0015;

/* The containment search itself. Takes the index explicitly (no module state), so the gate owns
 * the lifecycle and this owns only the geometry. Returns the same `ok` / `outside` shapes the
 * gate documents. */
export function resolveIn(index, lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { status: "outside" };
  const s = index.scale;
  const x = lng * s, y = lat * s;
  for (const c of index.counties) {
    const [a, b, cx, d] = c.bbox;
    if (x < a || x > cx || y < b || y > d) continue;   // cheap pre-filter — narrows, never decides
    let hit = false;
    for (const ring of c.rings) if (pointInRing(ring, x, y)) { hit = true; break; }
    if (!hit) continue;
    return {
      status: "ok",
      name: c.name,
      state: c.state,
      fips: c.fips,
      nearEdge: distToRings(c.rings, x, y) < NEAR_EDGE_DEG * s,
    };
  }
  return { status: "outside" };
}
