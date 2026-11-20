/* Model workspace — which grid the Spreadsheet tab shows (NEW-1, 2026-10-31, cutover steps 8–9a — owner decision 2026-10-30:
 * "It should just be the new grid.").
 *
 * THE RULE, in one place:
 *   · EVERY account on EVERY device gets the Univer grid. There is no switch to find and no stored choice a non-admin can make.
 *   · The regular (old) grid survives as a SAFETY HATCH for the owner only, for about a week, per device: it shows only when
 *     `is_admin()` is CONFIRMED for the signed-in user AND this device stored `REGULAR_GRID_KEY = "1"` (File ▾ → "Use the
 *     regular grid"; "Use the new grid" comes back). The old grid's code is deleted in a later session (cutover step 9b).
 *   · Nobody lands on the old grid by accident: the choice lives under a NEW key, so a device that had the old "Try the new
 *     grid" switch on or off has nothing under it; the old key is simply removed (`migrateLegacyGridChoice`).
 *
 * DEPENDENCY-FREE on purpose: the always-loaded shell (src/app/modulePrefetch.js → lib/univerWarm.js) and the Model chunk both read
 * it, and neither may pull the admin check (and through it the whole Supabase client) in just to know a localStorage flag.
 * ⛔ No URL flag, env var or second gate — widening the hatch is a decision for the owner, and he has not made it. */

export const REGULAR_GRID_KEY = "planyr:model:regularGrid";
/** The key the owner-only "Try the new grid" switch used before the cutover. Never read for a decision any more — only removed. */
export const LEGACY_UNIVER_KEY = "planyr:model:univerGrid";

const defaultStorage = () => (typeof localStorage === "undefined" ? null : localStorage);

/** Remove the pre-cutover switch's key. Its value ("on" = the new grid, absent = the old grid) means nothing under the new rule, and
 *  must never be carried over as "use the regular grid" — that is exactly how a device would land on the old grid by accident.
 *  Idempotent and silent; returns whether a key was removed. */
export function migrateLegacyGridChoice(storage = defaultStorage()) {
  try {
    if (!storage || storage.getItem(LEGACY_UNIVER_KEY) === null) return false;
    storage.removeItem(LEGACY_UNIVER_KEY);
    return true;
  } catch (_) { return false; }
}

/** Does THIS DEVICE ask for the regular grid? (Only an admin account ever honours it — see `chooseGrid`.) */
export function readRegularGrid(storage = defaultStorage()) {
  try { return !!storage && storage.getItem(REGULAR_GRID_KEY) === "1"; } catch (_) { return false; }
}
export function writeRegularGrid(on, storage = defaultStorage()) {
  try {
    if (!storage) return false;
    if (on) storage.setItem(REGULAR_GRID_KEY, "1"); else storage.removeItem(REGULAR_GRID_KEY);
    notify();
    return true;
  } catch (_) { return false; }
}

// ONE source of truth: the device setting itself. Every reader subscribes to it (this tab's writes via `notify`, another tab's via the
// `storage` event) instead of copying it into component state (owner rule: shared data is never copied into state).
const listeners = new Set();
const notify = () => listeners.forEach((l) => l());
export function subscribeRegularGrid(l) {
  listeners.add(l);
  const onStorage = (e) => { if (e.key === null || e.key === REGULAR_GRID_KEY) l(); };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => { listeners.delete(l); if (typeof window !== "undefined") window.removeEventListener("storage", onStorage); };
}

/** The one decision. `regular` is the device flag; `signedIn` whether there is an account to ask; `adminStatus` is useIsAdmin's
 *  "unknown" | "admin" | "not-admin" | "error".
 *    "univer"  — the default, and the answer for everyone who is not a CONFIRMED admin (an error fails closed, to the new grid)
 *    "regular" — the hatch: a confirmed admin on a device that asked for it
 *    "deciding"— the device asked for the regular grid and the admin answer has not arrived yet: show neither grid (mounting
 *                Univer only to swap it away a moment later would download and start 1.8 MB for nothing) */
export function chooseGrid({ regular, signedIn, adminStatus }) {
  if (!regular || !signedIn) return "univer";
  if (adminStatus === "admin") return "regular";
  if (adminStatus === "unknown") return "deciding";
  return "univer";
}
