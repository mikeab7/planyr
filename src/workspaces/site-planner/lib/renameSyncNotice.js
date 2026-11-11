/* renameSyncNotice.js — what the person is told when a RENAME reached this device but not the cloud (NEW-1, B2671215 follow-up, owner 2026-11-11):
 * "If it fails to save to the cloud, then I should get a warning banner saying the save didn't go through. It shouldn't show that everything's working."
 *
 * Pure and dependency-free (it sits on the boot path of the Site route). ONE place owns the words, so the live failure, the boot banner that comes back
 * after a reload, and Retry cannot drift apart:
 *   • PLAN_RENAME_TEXT    — a plan's name is ONE row, so "didn't save" is true.
 *   • PROJECT_RENAME_TEXT — a project's name is written across the whole group; the fallback path can land some rows and not others (B1048400), so
 *                           the honest claim is "didn't fully save" / "may still see the old name".
 * Never a status code, an error class or a server sentence in either (owner rule from the sign-in / 403 work).
 *
 * `isAuthExpiredError` separates "the cloud is down / refused" from "your sign-in is dead". A dead sign-in is not a second banner: the shared session
 * helper is asked, and the existing "You were signed out" notice (Shell) speaks. */
import { WHAT_RENAME, WHAT_PLAN_RENAME } from "../../../shared/cloud/writeFailureLog.js";

export const PLAN_RENAME_TEXT = "Rename didn't save to the cloud. Your other devices still see the old name.";
export const PROJECT_RENAME_TEXT = "Rename didn't fully save to the cloud. Your other devices may still see the old name.";

/** Is this logged failure a rename (of a plan or a project)? */
export const isRenameEntry = (e) => !!e && (e.what === WHAT_PLAN_RENAME || e.what === WHAT_RENAME || e.kind === "rename");

/** The banner text for a set of unconfirmed failures that are ALL renames, or null when any is another kind of write (the caller keeps its own copy). */
export function renameBannerText(pending) {
  const list = (pending || []).filter(Boolean);
  if (!list.length || !list.every(isRenameEntry)) return null;
  return list.some((e) => e.what !== WHAT_PLAN_RENAME) ? PROJECT_RENAME_TEXT : PLAN_RENAME_TEXT;
}

/** A write the server refused because the SIGN-IN is dead (expired / invalid token), as opposed to a down network or a server error. Reads the message the
 *  data layer hands back; unknown shapes are NOT auth (they stay an ordinary cloud failure). */
export function isAuthExpiredError(error) {
  const t = String((error && (error.message || error.code)) || error || "");
  return /\bjwt\b.*\b(expired|invalid|malformed)\b|\b(expired|invalid)\b.*\bjwt\b|PGRST30[123]|invalid refresh token|refresh_token_not_found|session[_ ](expired|not[_ ]found)|not authenticated|invalid_?grant/i.test(t);
}
