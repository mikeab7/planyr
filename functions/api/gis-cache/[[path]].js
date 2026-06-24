/* /api/gis-cache/* — same-origin GIS imagery cache proxy (B439).
 *
 * Cloudflare Pages Function (thin wrapper). The map points its county/agency layers (FEMA flood,
 * USFWS wetlands, City-of-Houston utilities) at THIS instead of straight at the agency. The real
 * logic + its contract live in _handler.js (unit-tested in Node); this only supplies the live
 * Drive client, `fetch`, and `context.waitUntil` for background refresh/store.
 *
 *   GET /api/gis-cache/svc/<b64url(serviceUrl)>/export?bbox=…&f=image   → image bytes (Drive-cached)
 *   GET …&meta=1                                                         → { cached, ts, ageMs, stale }
 *
 * Serves a durable copy from Google Drive instantly when present (survives an agency outage),
 * refreshes it in the background past the TTL, and FAILS OPEN (302 → real upstream) on missing
 * Drive creds / agency error / any error — so this can never break a layer. The durable copy
 * lives in the same Drive that holds uploaded PDFs (GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN,
 * server-side only — never a VITE_ var, never in the bundle). No Supabase, no new secret.
 */
import { storageConfig, defaultDriveClientFactory } from "../../../server/storage/index.js";
import { handleGisCache } from "./_handler.js";

const CACHE_FOLDER = "giscache";

// One Drive client + one cache-folder id per warm Function instance.
let driveP = null;
let folderP = null;
function drive(env) {
  if (!driveP) driveP = Promise.resolve(defaultDriveClientFactory(storageConfig(env).drive));
  return driveP;
}

export async function onRequestGet(context) {
  const { env, request, params } = context;
  const url = new URL(request.url);
  const client = await drive(env);

  return handleGisCache({
    client,
    segs: Array.isArray(params && params.path) ? params.path : String((params && params.path) || "").split("/"),
    search: url.search,
    origin: request.headers.get("Origin"),
    selfHost: url.host,
    defer: (p) => { try { context.waitUntil(p); } catch (_) {} },
    folderIdFor: async () => {
      if (!folderP) folderP = client.folderId(CACHE_FOLDER).catch((e) => { folderP = null; throw e; });
      return folderP;
    },
  });
}
