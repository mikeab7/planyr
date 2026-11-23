/* Warm the Univer grid's chunk before the Spreadsheet tab is clicked (NEW-1, B2587264 — docs/SPREADSHEET-UNIVER-SPIKE.md step 4; made
 * unconditional by the cutover, NEW-1 2026-10-31).
 *
 * WHY. The grid is one 1.8 MB (compressed) lazy chunk: downloading it AND running it (about 0.4 s of the page's main thread)
 * is the biggest single part of a cold open. `src/app/modulePrefetch.js` warms a workspace's chunk when the pointer aims at its
 * tab; for Spreadsheet that warmed ModelApp only, and the Univer chunk started loading when the grid mounted, AFTER the click.
 * This file is the second half: the same specifier ModelApp's `React.lazy` uses, so the browser makes ONE request and the module is
 * already evaluated when the grid mounts.
 *
 * THE UNIVER GRID IS THE ONLY GRID (the old one was retired), so every device warms it. Dependency-free on purpose: the always-loaded
 * shell reaches this file and must not pull the admin check (and through it the whole Supabase client) in.
 * Best-effort and idempotent: a failed warm is retried by the real mount. */
import { deviceUserId } from "./deviceUser.js";

/** The two device flags the retired "which grid" switch used to keep (the pre-cutover "Try the new grid" key and the owner's
 *  "Use the regular grid" key). Nothing reads either any more; a device that still holds one drops it. Idempotent and silent. */
export const RETIRED_GRID_KEYS = ["planyr:model:univerGrid", "planyr:model:regularGrid"];
export function forgetRetiredGridKeys(storage = typeof localStorage === "undefined" ? null : localStorage) {
  let removed = false;
  for (const k of RETIRED_GRID_KEYS) {
    try { if (storage && storage.getItem(k) !== null) { storage.removeItem(k); removed = true; } } catch (_) { /* a blocked store has nothing to forget */ }
  }
  return removed;
}

/** The project the page is on, from the URL — the Spreadsheet tab opens THIS project's workbook, whose scope key (ModelApp's `viewPrefsKey`) is the project id. */
const projectIdFromHash = (hash = typeof location === "undefined" ? "" : location.hash) => { const m = /^#\/project\/([^/?#]+)/.exec(hash || ""); return m ? decodeURIComponent(m[1]) : null; };

let warm = null;
/** Start loading + evaluating the Univer chunk. Returns the promise. */
export function warmUniver({ storage } = {}) {
  if (warm) return warm;
  forgetRetiredGridKeys(storage);
  // Read this project's remembered formula results from the device store NOW (lib/univerCalcCache.js), so they are in memory when the grid mounts.
  // (A dynamic import: the always-loaded shell must not take the storage layer in statically.)
  try { const id = projectIdFromHash(); if (id) import("./univerCalcCache.js").then((m) => m.primeCalcCache(id)).catch(() => { /* best-effort */ }); } catch (_) { /* best-effort */ }
  warm = import("../components/UniverSheet.jsx").then((mod) => {
    // Chunk in hand: now build the framework instance ahead of time, at idle (components/univerFramework.js — it is a no-op when a grid is
    // already mounted, and UniverSheet takes the waiting instance when it mounts). Held to idle because building it costs main-thread time.
    // The project the page is on, and who is signed in (read from the stored session — lib/deviceUser.js), tell it WHICH workbook to build ahead:
    // the device's copy of this project's workbook becomes the real unit, so the click only has to show it (B2607857).
    const build = () => {
      try { const projectId = projectIdFromHash(); mod.prewarmFramework && mod.prewarmFramework({ projectId, userId: projectId ? deviceUserId() : null }); } catch (_) { /* best-effort */ }
    };
    // Held to idle time. (MEASURED, B2607857: building at once on a page that is OPENING on the Spreadsheet made it slower — 1.37 s against 0.83 s on a
    // repeat visit — because the whole of Univer's start-up ran ahead of the page's own mount instead of beside it; the grid mount builds for itself.)
    if (typeof requestIdleCallback === "function") requestIdleCallback(build, { timeout: 2500 }); else setTimeout(build, 300);
    return mod;
  }).catch((err) => { warm = null; console.warn("univerWarm: could not warm the grid chunk (it will load when the grid opens)", err); });
  return warm;
}
