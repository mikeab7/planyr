/* Warm the Univer grid's chunk before the Spreadsheet tab is clicked (NEW-1, B2587264 — docs/SPREADSHEET-UNIVER-SPIKE.md step 4).
 *
 * WHY. The grid is one 1.8 MB (compressed) lazy chunk: downloading it AND running it (about 0.4 s of the page's main thread)
 * is the biggest single part of a cold open. `src/app/modulePrefetch.js` already warms a workspace's chunk when the pointer
 * aims at its tab; for Spreadsheet that warmed ModelApp only, and the Univer chunk started loading when the grid mounted,
 * AFTER the click. This file is the second half: the same specifier ModelApp's `React.lazy` uses, so the browser makes ONE request
 * and the module is already evaluated when the grid mounts.
 *
 * ONLY WHERE IT WILL BE USED. Today the grid shows only for an account whose device switch is on (lib/univerSwitch.js) — a hover
 * for anyone else must not download 1.8 MB for nothing. The key is repeated here, not imported, because univerSwitch.js imports
 * the admin check (and through it the whole Supabase client), which the always-loaded shell must not pull in; the repo-root
 * `test/` suite **modelUniverWarm** fails if the two ever differ. When the grid becomes the only grid, the `wanted` test goes away
 * and `warmUniver()` warms unconditionally. Best-effort and idempotent: a failed warm is retried by the real mount. */
export const UNIVER_DEVICE_KEY = "planyr:model:univerGrid";

export const univerWantedHere = (storage = typeof localStorage === "undefined" ? null : localStorage) => {
  try { return !!storage && storage.getItem(UNIVER_DEVICE_KEY) === "1"; } catch (_) { return false; }
};

let warm = null;
/** Start loading + evaluating the Univer chunk. Returns the promise (or null when this device will not use the grid). */
export function warmUniver({ force = false, storage } = {}) {
  if (warm) return warm;
  if (!force && !univerWantedHere(storage)) return null;
  warm = import("../components/UniverSheet.jsx").catch((err) => { warm = null; console.warn("univerWarm: could not warm the grid chunk (it will load when the grid opens)", err); });
  return warm;
}
