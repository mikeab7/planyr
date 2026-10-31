/* Warm the Univer grid's chunk before the Spreadsheet tab is clicked (NEW-1, B2587264 — docs/SPREADSHEET-UNIVER-SPIKE.md step 4; made
 * unconditional by the cutover, NEW-1 2026-10-31).
 *
 * WHY. The grid is one 1.8 MB (compressed) lazy chunk: downloading it AND running it (about 0.4 s of the page's main thread)
 * is the biggest single part of a cold open. `src/app/modulePrefetch.js` warms a workspace's chunk when the pointer aims at its
 * tab; for Spreadsheet that warmed ModelApp only, and the Univer chunk started loading when the grid mounted, AFTER the click.
 * This file is the second half: the same specifier ModelApp's `React.lazy` uses, so the browser makes ONE request and the module is
 * already evaluated when the grid mounts.
 *
 * THE UNIVER GRID IS NOW THE GRID FOR EVERY ACCOUNT, so every device warms it — except a device that asked for the owner's
 * regular-grid hatch (lib/gridChoice.js), which would download 1.8 MB for nothing (an owner whose answer then comes back "not admin"
 * simply loads it at mount, as before). The decision reads `gridChoice.js`, which is dependency-free: the always-loaded shell
 * must not pull the admin check (and through it the whole Supabase client) in just to read a localStorage flag.
 * Best-effort and idempotent: a failed warm is retried by the real mount. */
import { migrateLegacyGridChoice, readRegularGrid } from "./gridChoice.js";

/** Will THIS device show the Univer grid (as far as it can tell without asking who the user is)? */
export const univerWantedHere = (storage = typeof localStorage === "undefined" ? null : localStorage) => !readRegularGrid(storage);

let warm = null;
/** Start loading + evaluating the Univer chunk. Returns the promise (or null when this device will not use the grid). */
export function warmUniver({ force = false, storage } = {}) {
  if (warm) return warm;
  if (!force && !univerWantedHere(storage)) return null;
  migrateLegacyGridChoice(storage);
  warm = import("../components/UniverSheet.jsx").catch((err) => { warm = null; console.warn("univerWarm: could not warm the grid chunk (it will load when the grid opens)", err); });
  return warm;
}
