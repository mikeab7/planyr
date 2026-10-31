/* Model workspace — which grid the Spreadsheet tab shows, as a hook (NEW-1, 2026-10-31; was the owner-only "Try the new grid" switch
 * of the Univer spike, docs/SPREADSHEET-UNIVER-SPIKE.md).
 *
 * The Univer grid is THE grid for every account. What is left of the old switch is the owner's safety hatch — the decision lives in
 * `./gridChoice.js` (dependency-free; read it for the rule). This file only adds the React face: the `is_admin()` answer (the same
 * owner-only RPC the admin page and the grading layer use; it fails closed) and a subscription to the per-device flag. */
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useIsAdmin } from "../../admin/lib/useIsAdmin.js";
import { chooseGrid, migrateLegacyGridChoice, readRegularGrid, subscribeRegularGrid, writeRegularGrid } from "./gridChoice.js";

// The pre-cutover switch's key is dropped as soon as this chunk runs (also from the shell's warm path), whoever the user is.
migrateLegacyGridChoice();

/** `{ grid, active, deciding, available, regular, setRegular }`
 *    grid      "univer" | "regular" | "deciding" — see gridChoice.chooseGrid
 *    active    the Univer grid is (or is about to be) the grid: everything that stands down the regular grid's keyboard listens to this
 *    deciding  show a placeholder, mount neither grid yet
 *    available the hatch exists for this user (a CONFIRMED admin) — the File ▾ menu row shows only then
 *    regular   this device asked for the regular grid (only an admin's device can ever make it show)
 *    setRegular(true) = "Use the regular grid", setRegular(false) = "Use the new grid". */
export function useUniverSwitch(userId) {
  const { isAdmin, status } = useIsAdmin(userId ? { id: userId } : null);
  const regular = useSyncExternalStore(subscribeRegularGrid, () => readRegularGrid(), () => false);
  useEffect(() => { migrateLegacyGridChoice(); }, []);
  const setRegular = useCallback((next) => { writeRegularGrid(!!next); }, []);
  const grid = chooseGrid({ regular, signedIn: !!userId, adminStatus: status });
  return { grid, active: grid !== "regular", deciding: grid === "deciding", available: isAdmin, regular, setRegular };
}
