/* fakeVectorTiles — NEW-1 (B2018608). A SYNTHETIC OpenMapTiles-schema vector tile source for the
 * Houston test area (Clay Rd / Beltway 8 / Gessner), served through a Playwright route so the vector
 * roads/labels layer can be exercised where `tiles.openfreemap.org` is unreachable (the cloud sandbox
 * denies the host — measured 2026-10-04, 403 on CONNECT).
 *
 * ⛔ WHAT THIS PROVES AND WHAT IT DOES NOT. It proves the STYLE renders against the OpenMapTiles
 * layer/field names, that the zoom gates hide/show the right road classes, that label collision is on,
 * and that the layer stays in lockstep with Leaflet. It is NOT OpenStreetMap data — the geometry is a
 * hand-placed approximation — so a screenshot made with it says "the style works", never "this is what
 * the live map looks like". The live OpenFreeMap pass is `V1443696` in VERIFICATION.md. */
import geojsonvt from "geojson-vt";
import vtpbf from "vt-pbf";

export const FIXTURE_ORIGIN = "https://tiles.openfreemap.org";
export const HOUSTON = { lat: 29.8195, lng: -95.54 };

const line = (coords, props) => ({ type: "Feature", properties: props, geometry: { type: "LineString", coordinates: coords } });
const pt = (c, props) => ({ type: "Feature", properties: props, geometry: { type: "Point", coordinates: c } });

function roads() {
  const f = [];
  const named = [];
  const add = (coords, cls, name) => {
    f.push(line(coords, { class: cls, brunnel: "" }));
    if (name) named.push(line(coords, { class: cls, name, ref: "" }));
  };
  // Beltway 8 (freeway), Gessner (primary), Clay (secondary), Hempstead Hwy (trunk), plus tertiary.
  add([[-95.5602, 29.74], [-95.5598, 29.80], [-95.5612, 29.9]], "motorway", "Sam Houston Tollway");
  add([[-95.54, 29.74], [-95.5402, 29.9]], "primary", "Gessner Rd");
  add([[-95.66, 29.8195], [-95.42, 29.8195]], "secondary", "Clay Rd");
  add([[-95.62, 29.76], [-95.46, 29.86]], "trunk", "Hempstead Hwy");
  add([[-95.58, 29.7], [-95.58, 29.95]], "tertiary", "Hollister St");
  add([[-95.66, 29.835], [-95.42, 29.835]], "tertiary", "Hammerly Blvd");
  // Local streets: a tight grid right around the centre (neighbourhood zoom only).
  for (let i = -6; i <= 6; i++) {
    const x = -95.54 + i * 0.0016, y = 29.8195 + i * 0.0016;
    if (i === 0) continue;
    add([[x, 29.8195 - 0.011], [x, 29.8195 + 0.011]], "minor", `Birchwood Ln ${i + 7}`);
    add([[-95.54 - 0.011, y], [-95.54 + 0.011, y]], "minor", `Elm Hollow Dr ${i + 7}`);
  }
  add([[-95.5395, 29.8195], [-95.5395, 29.8213]], "service", "");
  return { roads: f, named };
}

export function buildFixtureTiles() {
  const { roads: r, named } = roads();
  const places = [
    pt([-95.37, 29.76], { class: "city", name: "Houston", rank: 1 }),
    pt([-95.5, 29.795], { class: "suburb", name: "Spring Branch", rank: 5 }),
    pt([-95.5465, 29.8265], { class: "neighbourhood", name: "Memorial Villages", rank: 8 }),
  ];
  const pois = [pt([-95.5335, 29.8225], { class: "hospital", name: "Memorial Hermann", rank: 3 })];
  const idx = (features) => geojsonvt({ type: "FeatureCollection", features }, { maxZoom: 14, indexMaxZoom: 8, tolerance: 3, buffer: 64 });
  return { transportation: idx(r), transportation_name: idx(named), place: idx(places), poi: idx(pois) };
}

/* Install on a Playwright context: TileJSON, vector tiles and a thin response log. Returns the log. */
export async function installFakeVectorSource(context, glyphsRoot) {
  const idx = buildFixtureTiles();
  const log = { tilejson: 0, tiles: [], blocked: false };
  await context.route(`${FIXTURE_ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    const cors = { "access-control-allow-origin": "*" };
    if (/\/planet$/.test(url.pathname)) {
      log.tilejson++;
      return route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify({
        tilejson: "3.0.0", name: "fixture", minzoom: 0, maxzoom: 14,
        tiles: [`${FIXTURE_ORIGIN}/planet/{z}/{x}/{y}.pbf`], attribution: "fixture",
      }) });
    }
    const m = url.pathname.match(/\/planet\/(\d+)\/(\d+)\/(\d+)\.pbf$/);
    if (m) {
      const [z, x, y] = m.slice(1).map(Number);
      log.tiles.push({ z, x, y });
      const layers = {};
      for (const [name, index] of Object.entries(idx)) { const t = index.getTile(z, x, y); if (t) layers[name] = t; }
      if (!Object.keys(layers).length) return route.fulfill({ status: 204, headers: cors });
      return route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/x-protobuf" }, body: Buffer.from(vtpbf.fromGeojsonVt(layers, { version: 2 })) });
    }
    return route.fulfill({ status: 404, headers: cors });
  });
  return log;
}
