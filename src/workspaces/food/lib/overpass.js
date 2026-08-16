/* overpass — the fallback for whatever the Overture snapshot missed ("no dataset has the
 * taco truck"). OpenStreetMap's Overpass API: free, no key, no account.
 *
 * FAIR-USE, respected two ways a browser actually can:
 *   1. CACHED — every bbox (rounded to ~0.01°, roughly a neighborhood) is queried at most
 *      once per session; a second look at the same area never re-hits the network.
 *   2. NEVER AUTOMATIC — this is called only from an explicit "search live for more here"
 *      press (FoodMap.jsx), never from a pan/zoom handler. A live map that re-queries
 *      Overpass on every drag is exactly the hammering the fair-use policy asks us not to do.
 * A real `User-Agent` is Overpass's other ask, but browsers refuse to let JS set that header
 * on a fetch (a "forbidden header name") — the request still identifies itself via the
 * ordinary Origin/Referer the browser sends for planyr.io, which is what's actually available
 * from a client-side app.
 */
const ENDPOINT = "https://overpass-api.de/api/interpreter";

// The same eat-and-drink categories the Overture loader keeps — OSM's vocabulary, not
// Overture's, but answering the same question ("is this a place to eat or drink").
const OSM_TAGS = "restaurant|cafe|bar|fast_food|pub|food_court|ice_cream|biergarten|bbq";

const cache = new Map(); // roundedBboxKey -> places[]

function roundKey(bounds) {
  const r = (n) => Math.round(n * 100) / 100; // ~0.01deg, a neighborhood
  return `${r(bounds.south)},${r(bounds.west)},${r(bounds.north)},${r(bounds.east)}`;
}

function queryFor({ south, west, north, east }) {
  return `[out:json][timeout:25];
(
  node["amenity"~"^(${OSM_TAGS})$"](${south},${west},${north},${east});
  node["shop"~"^(bakery|deli|convenience)$"](${south},${west},${north},${east});
);
out body;`;
}

function fromElement(el) {
  const tags = el.tags || {};
  return {
    id: `osm:${el.type}/${el.id}`,
    name: tags.name || "Unnamed place",
    lat: el.lat,
    lon: el.lon,
    category: tags.amenity || tags.shop || null,
    cuisine: tags.cuisine || null,
    address: [tags["addr:housenumber"], tags["addr:street"], tags["addr:city"]].filter(Boolean).join(" ") || null,
    brand: tags.brand || null,
    source: "OpenStreetMap",
    source_licence: "ODbL-1.0",
  };
}

/** Live-query Overpass for a bbox, cached per session. Never call this from a pan/zoom
 *  handler — see the header. Returns [] (never throws) on any network/parse failure, with
 *  the failure reported separately via the returned `error` field. */
export async function searchOverpass(bounds) {
  const key = roundKey(bounds);
  if (cache.has(key)) return { data: cache.get(key), error: null, cached: true };
  try {
    const resp = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: queryFor(bounds),
    });
    if (!resp.ok) throw new Error(`Overpass responded ${resp.status}`);
    const json = await resp.json();
    const places = (json.elements || [])
      .filter((el) => el.type === "node" && el.lat != null && el.lon != null)
      .map(fromElement);
    cache.set(key, places);
    return { data: places, error: null, cached: false };
  } catch (err) {
    return { data: [], error: err, cached: false };
  }
}
