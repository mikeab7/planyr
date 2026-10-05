/* Admin parcel-coverage map — projection + SVG path building (NEW-1). Pure.
 *
 * Reads the county-polygons asset's own encoding (outer rings, delta-encoded in 1/scale degrees,
 * x = longitude, y = latitude — see countyPolygonsCore.decodeRing) and projects it to a US map:
 * an Albers equal-area cone for the lower 48, with Alaska and Hawaii each fitted into an inset
 * box below the Southwest. No map library — one asset, one projection, a few hundred lines less
 * than a dependency would cost the admin chunk.
 */

const RAD = Math.PI / 180;

function albers({ lat0, lon0, p1, p2 }) {
  const s1 = Math.sin(p1 * RAD);
  const n = (s1 + Math.sin(p2 * RAD)) / 2;
  const C = Math.cos(p1 * RAD) ** 2 + 2 * n * s1;
  const rho0 = Math.sqrt(C - 2 * n * Math.sin(lat0 * RAD)) / n;
  return (lng, lat) => {
    const dl = ((lng - lon0 + 540) % 360) - 180; // wrap so the western Aleutians sit beside the rest
    const rho = Math.sqrt(C - 2 * n * Math.sin(lat * RAD)) / n;
    const th = n * dl * RAD;
    return [rho * Math.sin(th), -(rho0 - rho * Math.cos(th))]; // y down
  };
}

const PROJ = {
  lower48: albers({ lat0: 37.5, lon0: -96, p1: 29.5, p2: 45.5 }),
  AK: albers({ lat0: 50, lon0: -154, p1: 55, p2: 65 }),
  HI: albers({ lat0: 20, lon0: -157, p1: 8, p2: 18 }),
};

const groupOf = (state) => (state === "AK" ? "AK" : state === "HI" ? "HI" : "lower48");

/* Decode one flat delta ring to projected [x,y] pairs in the group's own plane. */
function projectRing(flat, scale, project) {
  const pts = [];
  let x = flat[0], y = flat[1];
  pts.push(project(x / scale, y / scale));
  for (let i = 2; i < flat.length; i += 2) {
    x += flat[i]; y += flat[i + 1];
    pts.push(project(x / scale, y / scale));
  }
  return pts;
}

const bboxOf = (rings) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rings) for (const [x, y] of r) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
};

/**
 * Build the drawing: one SVG path string per county (same order as `payload.counties`) in a
 * `width`×`height` box. Returns `{ width, height, paths }`; a county with no rings gets "".
 */
export function buildCountyPaths(payload, { width = 960 } = {}) {
  const scale = payload.scale || 2000;
  const projected = payload.counties.map((c) => ({
    group: groupOf(c.state),
    rings: (c.rings || []).map((r) => projectRing(r, scale, PROJ[groupOf(c.state)])),
  }));

  const groupBox = {};
  for (const g of ["lower48", "AK", "HI"]) {
    const rings = projected.filter((p) => p.group === g).flatMap((p) => p.rings);
    groupBox[g] = rings.length ? bboxOf(rings) : null;
  }
  const L = groupBox.lower48;
  if (!L) return { width, height: 0, paths: payload.counties.map(() => "") };
  const k = width / (L[2] - L[0]);
  const height = (L[3] - L[1]) * k;

  // Lower 48 fills the box; each inset is fitted (aspect kept) into its own rect below the Southwest.
  const place = { lower48: { s: k, ox: -L[0] * k, oy: -L[1] * k } };
  const fit = (g, rx, ry, rw, rh) => {
    const b = groupBox[g];
    if (!b) return;
    const s = Math.min((rw * width) / (b[2] - b[0]), (rh * height) / (b[3] - b[1]));
    place[g] = { s, ox: rx * width - b[0] * s, oy: ry * height - b[1] * s };
  };
  fit("AK", 0.0, 0.7, 0.2, 0.3);
  fit("HI", 0.22, 0.84, 0.12, 0.16);

  const MIN_STEP = 0.35; // drop vertices closer than this (in box units) — keeps 3,144 paths light
  const paths = projected.map((p) => {
    const t = place[p.group];
    if (!t) return "";
    let d = "";
    for (const ring of p.rings) {
      let lx = NaN, ly = NaN, seg = "";
      for (let i = 0; i < ring.length; i++) {
        const x = ring[i][0] * t.s + t.ox, y = ring[i][1] * t.s + t.oy;
        if (i > 0 && i < ring.length - 1 && Math.abs(x - lx) < MIN_STEP && Math.abs(y - ly) < MIN_STEP) continue;
        seg += `${seg ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
        lx = x; ly = y;
      }
      if (seg) d += `${seg}Z`;
    }
    return d;
  });
  return { width, height, paths };
}
