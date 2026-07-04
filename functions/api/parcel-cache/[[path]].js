/* /api/parcel-cache/* — same-origin county PARCEL snapshot cache (B629).
 *
 * Cloudflare Pages Function (thin wrapper). Hands back the whole-county parcel snapshot (or a
 * viewport tile) that the nightly builder saved into Google Drive, so a lot still draws + selects
 * when the county's live GIS server is down. Read-through only: on a miss it 404s and the map
 * falls back to the live source. The real logic + contract live in _handler.js (unit-tested in
 * Node); this only supplies the live Drive client + the shared `parcelcache` folder id.
 *
 *   GET /api/parcel-cache/svc/<county>            → gzipped GeoJSON (Drive-served)
 *   GET /api/parcel-cache/svc/<county>/<z>/<x>/<y> → one viewport tile (Fort Bend)
 *   GET …?meta=1                                   → { cached, ts, generatedAt, count, stale }
 *
 * Reuses the SAME Drive creds as B445 + the PDF store (GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN,
 * server-side only — never a VITE_ var). No Supabase, no new secret. The snapshot is public,
 * non-personal county data, so — like the B445 imagery cache — it lives in ONE shared folder with
 * no per-user auth.
 */
import { storageConfig, defaultDriveClientFactory } from "../../../server/storage/index.js";
import { handleParcelCache } from "./_handler.js";

const CACHE_FOLDER = "parcelcache";

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

  return handleParcelCache({
    client,
    segs: Array.isArray(params && params.path) ? params.path : String((params && params.path) || "").split("/"),
    search: url.search,
    folderIdFor: async () => {
      if (!folderP) folderP = client.folderId(CACHE_FOLDER).catch((e) => { folderP = null; throw e; });
      return folderP;
    },
  });
}
