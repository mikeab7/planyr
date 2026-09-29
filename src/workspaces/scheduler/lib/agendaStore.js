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

// -- B1953795 (S6) -- the stored list is the ONE truth; a view is a subscriber, never a copy it writes back.
// The view used to hold the list in React state and `writeAgenda(wholeList)` on every edit, so two tabs
// (or a tab + a stale render) overwrote each other's items. Now every operation is a fresh
// read-modify-write against storage (`mutateAgenda`), and views subscribe (`subscribeAgenda`) to the
// cross-tab `storage` event plus a same-tab notification, so they always re-read the truth.
const CHANGED_EVENT = "planyr:agenda-changed";

/** Fresh read -> `fn(items)` -> write. Returns `{ ok, items }`: `items` is what storage holds AFTER the
 * op (the new list on success, the untouched fresh list on a failed write -- the caller re-renders from
 * it, i.e. rollback -- and `ok:false` tells it to show the error). `fn` may return the same array to no-op. */
export function mutateAgenda(scope, fn) {
  const fresh = readAgenda(scope);
  let next;
  try { next = fn(fresh); } catch (e) { fail("mutate", key(scope), e); return { ok: false, items: fresh }; }
  if (next === fresh) return { ok: true, items: fresh };
  if (!writeAgenda(next, scope)) return { ok: false, items: fresh };
  try { window.dispatchEvent(new CustomEvent(CHANGED_EVENT, { detail: { scope: scope || "local" } })); } catch (_) {}
  return { ok: true, items: next };
}

/** Call `cb()` whenever this scope's list changes -- in this tab (via mutateAgenda) or another
 * (the browser's `storage` event). Returns the unsubscribe function. */
export function subscribeAgenda(scope, cb) {
  if (typeof window === "undefined") return () => {};
  const k = key(scope);
  const onStorage = (e) => { if (e.key === k || e.key === null) cb(); };
  const onLocal = (e) => { if (!e.detail || e.detail.scope === (scope || "local")) cb(); };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGED_EVENT, onLocal);
  return () => { window.removeEventListener("storage", onStorage); window.removeEventListener(CHANGED_EVENT, onLocal); };
}
