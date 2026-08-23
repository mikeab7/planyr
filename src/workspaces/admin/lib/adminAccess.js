/* Admin access check (B711904 / NEW-1) — the one place that decides "is this signed-in
 * user allowed to see the admin page."
 *
 * Fails CLOSED on every path: no client, no user, an RPC error, a non-boolean answer, or a
 * thrown exception all resolve to `false`. The admin surface must never render on an
 * ambiguous result — a false negative just means Michael's tab briefly shows the ordinary
 * dashboard instead of the admin shell (harmless, self-heals on retry); a false positive
 * would leak the admin page to whoever is looking. See db/admin_users.sql for the
 * server-side half: `admin_users` is RLS-locked with zero policies (unreadable/unwritable by
 * anon/authenticated directly), so this boolean RPC is the ONLY door in or out.
 *
 * A genuine RPC failure (as opposed to an honest "not an admin") is reported via the existing
 * client-error telemetry channel so it's diagnosable later without ever surfacing an error to
 * the person looking at the page — the page must stay silent either way (STANDING RULE:
 * a non-admin gets a 404-equivalent, never a permission message).
 */
import { reportClientEvent } from "../../../shared/telemetry/clientErrors.js";

export async function checkIsAdmin(client) {
  if (!client) return false;
  try {
    const { data, error } = await client.rpc("is_admin");
    if (error) {
      reportClientEvent("admin-check-error", error.message || "is_admin rpc error");
      return false;
    }
    return data === true;
  } catch (err) {
    reportClientEvent("admin-check-error", (err && err.message) || "is_admin threw");
    return false;
  }
}
