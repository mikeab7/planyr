/* Testable core of the county PARCEL snapshot cache (B629).
 *
 * Plain-English: a nightly job saves a whole-county copy of the parcel outlines into the same
 * Google Drive that holds the imagery cache (B445). This endpoint hands that saved copy back to
 * the map, so a county lot still draws + selects even when the county's live GIS server is down.
 *
 * Unlike the B445 imagery proxy this is READ-THROUGH ONLY: it never fetches an upstream on a
 * miss — the builder (scripts/build-parcel-snapshot.mjs) is what populates Drive — so a miss is a
 * plain 404 and the client simply falls back to the live county source (no behaviour change until
 * a snapshot exists). All logic lives here so it unit-tests in plain Node
 * (test/parcelCacheHandler.test.js) with an injected in-memory Drive client + clock; the route
 * ([[path]].js) is a thin wrapper supplying the live Drive client + folder id.
 *
 *   GET /api/parcel-cache/svc/<county>            → the whole-county snapshot (gzipped GeoJSON)
 *   GET /api/parcel-cache/svc/<county>/<z>/<x>/<y> → one viewport tile (Fort Bend, Phase 2)
 *   GET …?meta=1                                   → { cached, ts, generatedAt, count, stale }
 */
import { freshness } from "../../../src/shared/gis/gisProxyCore.js";

// A stored snapshot older than this reports `stale` in ?meta — a coarse "ancient copy" signal.
// Freshness for RE-DOWNLOAD is decided by the client comparing `generatedAt` (see parcelSnapshot);
// this only backstops a builder that silently stopped running. Parcels change slowly, so a week.
export const SNAPSHOT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// FIXED county allowlist — the county path segment names a Drive file, so it must never be able to
// address an arbitrary filename (path-traversal / open-read guard). Keep in lockstep with
// counties.js SNAPSHOT_COUNTIES.
export const SNAPSHOT_COUNTIES = new Set(["chambers", "waller", "fortbend"]);

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const notFound = () => new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
// The stored bytes are already gzipped; declare it so the browser gunzips transparently.
const gzGeoJson = (bytes) =>
  new Response(bytes, { status: 200, headers: {
    "content-type": "application/geo+json",
    "content-encoding": "gzip",
    "cache-control": "public, max-age=300",
  } });

/* The Drive filename for a request. Whole county → `<county>.json.gz`; a tile → the same with a
 * `_<z>_<x>_<y>` suffix; the sidecar → `<county>.meta.json`. Returns null on any shape that isn't
 * an allow-listed county + (optionally) a 3-integer tile. Pure. */
export function snapshotFileName(county, tile = [], meta = false) {
  if (!SNAPSHOT_COUNTIES.has(county)) return null;
  if (meta) return `${county}.meta.json`;
  if (!tile.length) return `${county}.json.gz`;
  if (tile.length !== 3 || !tile.every((n) => /^\d+$/.test(String(n)))) return null;
  return `${county}_${tile[0]}_${tile[1]}_${tile[2]}.json.gz`;
}

export async function handleParcelCache({
  client, segs, search = "", now = () => Date.now(), folderIdFor,
}) {
  if (!Array.isArray(segs) || segs[0] !== "svc" || segs.length < 2) return json({ error: "bad request" }, 400);
  const county = String(segs[1] || "").toLowerCase();
  const tile = segs.slice(2).filter(Boolean); // [] whole-county | [z,x,y] tile
  const metaMode = new URLSearchParams(search).get("meta") === "1";

  const name = snapshotFileName(county, tile, metaMode);
  if (!name) return metaMode ? json({ cached: false }) : notFound();

  try {
    if (!client) return metaMode ? json({ cached: false }) : notFound(); // no Drive creds → live-only
    const folderId = await folderIdFor();
    const existing = await client.findFile(name, folderId).catch(() => null);
    if (!existing) return metaMode ? json({ cached: false }) : notFound();

    const ts = Date.parse(existing.modifiedTime) || null;
    if (metaMode) {
      const f = freshness(ts, now(), SNAPSHOT_TTL_MS);
      // The sidecar carries the authoritative { generatedAt, count, source, bbox } the builder
      // wrote; read it through so the client can version-compare + show a vintage badge.
      let extra = {};
      try { const m = await client.media(existing.id); extra = JSON.parse(new TextDecoder().decode(m.bytes)) || {}; } catch (_) {}
      return json({ cached: true, ts, ageMs: f.ageMs, stale: f.stale, ...extra });
    }
    const media = await client.media(existing.id);
    return gzGeoJson(media.bytes);
  } catch (_) {
    return metaMode ? json({ cached: false }) : notFound();
  }
}
