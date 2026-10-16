/* The grading layer's ONE gate (owner decision 2026-10-16: "add it in, but only for me to use for now").
 *
 * Everything the grading-aware Site Planner adds — the Ground row, the Building tab, the two Topography
 * layers, the spot elevations, the FFE basis chips — renders ONLY when `is_admin()` is true for the
 * signed-in user. This module is where that is decided, and the ONLY place: every other grading surface
 * reads `gradingEnabled()` / `useGradingEnabled()` and nothing else.
 *
 *   ⛔ No second mechanism. No URL flag, no env var, no localStorage switch, no per-plan setting. An
 *   account is "grading-enabled" exactly when the existing owner-only RPC (admin/lib/adminStatus.js,
 *   fed by public.is_admin() — a SECURITY DEFINER function behind the zero-policy `admin_users` table)
 *   has CONFIRMED it. Do not add anyone to `admin_users` to widen it; when the owner says "everyone",
 *   this one file changes.
 *   ⛔ Fails CLOSED: unknown / error / not-admin / signed-out are all "off" (adminStatus.js never caches
 *   an error, so a failed call cannot lock the owner out of the visit either).
 *   For every account that is not enabled the Site Planner is byte-for-byte what it was: the code
 *   behind this gate is loaded on demand (GradingController / GradingPanels) and never reaches them. */
import { useIsAdmin } from "../../admin/lib/useIsAdmin.js";
import { adminStatusStore } from "../../admin/lib/adminStatus.js";
import { activeUid } from "./activeUser.js";

/* The non-React face — for pure code that needs the answer NOW (a confirmed admin answer already in
 * the shared store). Anything not yet confirmed reads as off. */
export const gradingEnabled = (uid = activeUid()) => !!uid && adminStatusStore.peek(uid) === "admin";

/* The React face. `user` defaults to the planner's own signed-in user id (activeUid), so no caller has to
 * thread an auth object through. Re-reads the id every render; useIsAdmin keys its answer to that id, so an
 * account switch can never inherit the previous account's "admin". */
export function useGradingEnabled() {
  const uid = activeUid();
  return useIsAdmin(uid ? { id: uid } : null).isAdmin;
}
