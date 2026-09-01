/* B1020930 — storage for the org-scoped agenda. LOCAL-ONLY, deliberately, for this session:
 * one localStorage list per account (or the signed-out device), same key shape as Notes'
 * per-scope tree (`planyr:notes:tree:v1:<scope>`), no cloud table, no merge, no multi-writer
 * conflict logic. That is a stated, flagged scope cut, not an oversight — see B1020930's
 * BACKLOG entry for the follow-on that adds cross-device sync. It has a real, if narrower,
 * precedent already in this codebase: `notesVersions.js`'s version history is device-local by
 * the same reasoning ("it needs no schema change and cannot fight the server-owned rev").
 * Because there is no cloud tier, LOUD-FAILURE here is simple: a write either lands or it
 * throws to the caller — there is no silent partial state to guard against.
 */
import { reportClientEvent } from "../../../shared/telemetry/clientErrors.js";

const PREFIX = "planyr:agenda:v1:";

function store() {
  try { return window.localStorage; } catch (_) { return null; }
}

function key(scope) { return `${PREFIX}${scope || "local"}`; }

function fail(op, k, e) {
  try { reportClientEvent("agenda_storage_error", `${op} ${k}`, { message: String((e && e.message) || e) }); } catch (_) {}
}

/** Every stored item, oldest write order preserved (callers sort for display). Never throws —
 *  a corrupt or missing record reads as an empty list, same as Notes' own store does. */
export function readAgenda(scope) {
  const st = store();
  if (!st) return [];
  let text;
  try { text = st.getItem(key(scope)); } catch (e) { fail("read", key(scope), e); return []; }
  if (text == null) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) { fail("read", key(scope), e); return []; }
}

/** Returns true only when the bytes actually landed. */
export function writeAgenda(items, scope) {
  const st = store();
  if (!st) { fail("write", key(scope), new Error("localStorage is unavailable in this browser")); return false; }
  try { st.setItem(key(scope), JSON.stringify(items)); return true; }
  catch (e) { fail("write", key(scope), e); return false; }
}
