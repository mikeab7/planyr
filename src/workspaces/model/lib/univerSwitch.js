/* Model workspace — the owner-only "Try the new grid" switch (Univer spike; docs/SPREADSHEET-UNIVER-SPIKE.md).
 *
 * TWO conditions, both required, and ONLY these:
 *   1. `is_admin()` is CONFIRMED true for the signed-in user — the same owner-only RPC the admin page and the
 *      grading layer use (admin/lib/useIsAdmin.js → adminStatus.js). It fails closed: unknown / error / not-admin /
 *      signed-out are all "not available", so a non-admin sees exactly today's grid and not even a menu row.
 *   2. the person turned it on, remembered PER DEVICE (localStorage). Default OFF.
 * ⛔ No URL flag, env var or second gate. Do not add anyone to `admin_users` to widen it; the cutover is a
 * separate owner decision and, if he makes it, this one file is what changes. */
import { useCallback, useState } from "react";
import { useIsAdmin } from "../../admin/lib/useIsAdmin.js";

export const UNIVER_SWITCH_KEY = "planyr:model:univerGrid";

export function readUniverSwitch(storage = typeof localStorage === "undefined" ? null : localStorage) {
  try { return !!storage && storage.getItem(UNIVER_SWITCH_KEY) === "1"; } catch (_) { return false; }
}
export function writeUniverSwitch(on, storage = typeof localStorage === "undefined" ? null : localStorage) {
  try { if (!storage) return false; if (on) storage.setItem(UNIVER_SWITCH_KEY, "1"); else storage.removeItem(UNIVER_SWITCH_KEY); return true; } catch (_) { return false; }
}
/** The one rule: the Univer grid shows only when the owner gate is open AND the device switch is on. */
export const univerGridActive = ({ available, on }) => !!available && !!on;

/** `{ available, on, active, setOn }` — `available` is the admin gate, `on` the remembered device choice,
 *  `active` what the workspace actually renders. A non-admin's stored "on" never activates anything. */
export function useUniverSwitch(userId) {
  const { isAdmin } = useIsAdmin(userId ? { id: userId } : null);
  const [on, setOnState] = useState(() => readUniverSwitch());
  const setOn = useCallback((next) => { writeUniverSwitch(!!next); setOnState(!!next); }, []);
  return { available: isAdmin, on, active: univerGridActive({ available: isAdmin, on }), setOn };
}
