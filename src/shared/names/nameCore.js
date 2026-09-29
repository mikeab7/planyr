/* nameCore.js — PURE half of the names store (no React, no storage, no DOM): the rules every
 * rename obeys and the in-memory "pending" map for a project that has no stored record yet.
 *
 * ⛔ NAMES HAVE ONE SOURCE OF TRUTH — NEVER COPY A NAME INTO COMPONENT STATE.
 * A project's persisted name is the group's authoritative `site` (projectName.js /
 * `storage.renameSiteGroup`); a plan's is its record's `name`. Every display reads them through
 * `names.js` (`useProjectName` / `usePlanName`), which re-reads on the app's one "the list moved"
 * signal (`onProjectsChanged`). A component that seeds `useState(...name...)` at mount is the
 * B1934528 defect: it shows the name as of when it mounted and misses every rename that lands
 * through another door. `test/namesSingleSource.test.js` fails the build on that shape.
 */

export const NAME_MAX = 120;

/** Trim + validate a user-typed name. An empty name is REJECTED (never silently defaulted or
 *  saved) with a message the caller must show. */
export function validateName(raw, kind = "name") {
  const name = (typeof raw === "string" ? raw : "").replace(/\s+/g, " ").trim();
  if (!name) return { ok: false, name: "", error: `A ${kind} needs a name — the old name was kept.` };
  if (name.length > NAME_MAX) return { ok: false, name, error: `That ${kind} name is too long (limit ${NAME_MAX} characters) — the old name was kept.` };
  return { ok: true, name, error: "" };
}

/** A name as one safe filename segment: path separators, colons and the other characters the
 *  OSes reject become "-"; the DISPLAYED name is never altered. */
export function fileSafe(name, fallback = "site-plan") {
  const s = String(name == null ? "" : name)
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[\s.-]+|[\s.-]+$/g, "")
    .trim();
  return s || fallback;
}

/* Pending names — a project born through the LAZY "New project" flow has no stored record until
 * its first real write (owner constraint 5), so a rename typed before that has nowhere to land in
 * the persisted store. It lands here instead: still ONE store, read by the same selector, and
 * dropped the moment a stored name exists for the group (the stored name then wins). */
const pending = new Map();
const listeners = new Set();
const emit = () => { listeners.forEach((f) => { try { f(); } catch (_) {} }); };

export function setPendingProjectName(groupId, name) {
  if (!groupId) return;
  if (name) pending.set(groupId, name); else pending.delete(groupId);
  emit();
}
export function pendingProjectName(groupId) { return pending.get(groupId) || null; }
export function clearPendingProjectName(groupId) { if (pending.delete(groupId)) emit(); }
export function subscribePending(cb) { listeners.add(cb); return () => listeners.delete(cb); }

/** Resolve a project's display name: stored (authoritative) → pending (unsaved-project) →
 *  fallback. `stored` is what the persisted store answered, or null when it has no record. */
export function resolveProjectName(stored, groupId, fallback = "Untitled site") {
  if (stored) return stored;
  return pendingProjectName(groupId) || fallback;
}

/* Visible-notice bus: a rejected or failed rename must be SEEN (LOUD-FAILURE). One event, one
 * host (`NameNoticeHost`, mounted in Shell), so no entry point invents its own silent path. */
const noticeListeners = new Set();
export function announceNameNotice(message, tone = "error") {
  const n = { id: Date.now() + Math.random(), message, tone };
  noticeListeners.forEach((f) => { try { f(n); } catch (_) {} });
  return n;
}
export function subscribeNameNotices(cb) { noticeListeners.add(cb); return () => noticeListeners.delete(cb); }
