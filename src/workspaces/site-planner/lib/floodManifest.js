/* The baked-flood-tile MANIFEST — one fetch per session (NEW-3).
 *
 * WHY THE STAMP EXISTS AT ALL. A baked tileset has a VINTAGE. The live FEMA layer does not need
 * one — whatever it draws is whatever FEMA is serving this second — but the moment the picture
 * comes out of a file we built, "when was this true?" becomes a question the panel has to be
 * able to answer. A fast map that is quietly six months stale is worse than a slow one that is
 * right, because nothing about it looks wrong.
 *
 * The manifest is written by scripts/build-flood-tiles.mjs beside the archives and is a few KB,
 * so it is fetched once, cached for the tab, and never re-requested. A failure is NOT an error
 * state: the stamp reports the vintage as unknown (floodTiles.floodVintageStamp), which is the
 * honest-empty-state rule — say so rather than omit the line.
 */
import { FLOOD_MANIFEST_URL } from "../../../shared/gis/floodTiles.js";

let pending = null;
let cached = null;

/* Resolves to the manifest object, or `null` when it cannot be read. Never rejects — a caller
 * rendering a status line must not have to defend against a throw. */
export function loadFloodManifest() {
  if (cached !== null) return Promise.resolve(cached);
  if (pending) return pending;
  pending = fetch(FLOOD_MANIFEST_URL, { cache: "no-cache" })
    .then((r) => (r && r.ok ? r.json() : null))
    .then((m) => { cached = m && typeof m === "object" ? m : null; return cached; })
    .catch(() => { cached = null; return null; })
    .finally(() => { pending = null; });
  return pending;
}

/* Test seam. A manifest is a per-deploy fact, so nothing in the app clears this. */
export const resetFloodManifest = () => { cached = null; pending = null; };
