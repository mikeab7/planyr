/* Pending-edit journal (NEW-F4) — closes the last silent-overwrite window in element sync.
 *
 * The gap: an edit to an ALREADY-SYNCED element whose `commit_elements` call failed (8s RPC
 * timeout, transient error) lives only in the canvas + local mirror. Reload, and the
 * rows-canonical refetch (`refetchReplace`, B672) rebuilds the canvas from the server's OLDER
 * row — `foldNeverSyncedLocal` (B756) only protects elements with ZERO rows — and the autosave
 * then rewrites the mirror with the reverted data. The newer edit silently vanishes (it was
 * still recoverable from the version ring, but nothing said so).
 *
 * The fix: while the sync engine has pending/failed ops, their entries (with the shadow rev
 * each op targets — `baseRev`) are persisted here. After a reload, the refetch folds journaled
 * edits whose row hasn't advanced (`row.rev <= baseRev`) back over the rebuilt canvas
 * (foldJournal in elementRows.js) and the normal reconcile re-enqueues the commit. When the
 * engine drains to idle the journal is cleared — steady state writes nothing.
 *
 * PER-SESSION NAMESPACING (NEW-1, the two-tab false-conflict fix). Since B674 removed the
 * editor lock, TWO live tabs of one account can hold one plan — and the old one-key-per-site
 * journal made them fight: tab B's refetch folded (and then CLEARED) tab A's mid-commit
 * journal, re-committing A's in-flight edits as B's own writes — byte-divergent copies that
 * echoed back into A as false "you (another window) changed …" conflicts, and destroying A's
 * crash protection. Now each TAB (a sessionStorage-scoped session id — survives a reload in
 * place, distinct across tabs) writes its OWN key:
 *   planyr:elements:pending:<siteId>:s:<sessionId>
 * A tab reads/clears its own journal freely; it may ADOPT another session's journal only when
 * that journal has sat untouched past ORPHAN_ADOPT_MS (its writer rewrites `at` on every
 * status change while alive — a frozen `at` means a dead/closed tab whose failed edits would
 * otherwise be lost). A FRESH foreign journal is never read and never cleared. The legacy
 * un-suffixed key is treated as an orphan (one-time migration).
 *
 * Storage: localStorage (same durability class as the site mirror the edit already lives in),
 * size-capped and age-capped so an abandoned journal can't grow stale or eat quota. Quota-safe:
 * a failed write degrades to "no journal" (the version ring remains the recovery), never a throw.
 */

const PREFIX = (siteId) => `planyr:elements:pending:${siteId}`;
const KEY = (siteId, sessionId) => `${PREFIX(siteId)}:s:${sessionId}`;
const SESSION_KEY = "planyr:journal:session";
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;   // a week-old journal is stale context, not a fix
const MAX_BYTES = 512 * 1024;              // cap: a journal is a handful of elements, not a site
// A journal another session hasn't rewritten in this long is ORPHANED (its tab is gone/wedged) —
// safe to adopt. A live mid-commit writer refreshes `at` on every engine status change (sub-second
// to ~30s backoff ticks), so 5 minutes of silence is decisively dead air.
export const ORPHAN_ADOPT_MS = 5 * 60 * 1000;

// This TAB's journal session id — sessionStorage-backed so it survives a reload in place (the
// primary NEW-F4 recovery path re-reads its own journal) yet differs across tabs (two live
// writers never share a key). A blocked sessionStorage degrades to a per-load id (recovery then
// rides the orphan-adoption path instead — slower, never lost).
// KNOWN LIMITATION (accepted, adversarial-review): browsers COPY sessionStorage on "Duplicate
// tab" / session-restore, so a duplicated pair shares one id and — for that pair only — falls
// back to the pre-NEW-1 shared-journal behavior (strictly no worse than before). Distinguishing
// a duplicate from a reload requires a cross-tab liveness protocol (BroadcastChannel ping) that
// isn't worth the boot-time async cost for this edge; the baseRev guards in foldJournal keep any
// cross-fold from ever clobbering newer server rows regardless.
let memSessionId = null;
export function journalSessionId(store = globalThis.sessionStorage) {
  try {
    let id = store.getItem(SESSION_KEY);
    if (!id) {
      id = randomSessionId();
      store.setItem(SESSION_KEY, id);
    }
    return id;
  } catch (_) {
    if (!memSessionId) memSessionId = randomSessionId();
    return memSessionId;
  }
}
function randomSessionId() {
  try {
    const c = globalThis.crypto;
    if (c && typeof c.randomUUID === "function") return c.randomUUID().slice(0, 13);
  } catch (_) { /* fall through */ }
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}

// Persist THIS session's pending entries (dirtyEntries() shape: { kind, id, cls, el, baseRev }).
// `at` = caller-supplied timestamp (Date.now at the call site — injected, not read here, to
// keep this module pure enough to unit test without clock hacks). Rewriting `at` on every call
// is what marks the journal LIVE to other sessions (see ORPHAN_ADOPT_MS).
export function writeJournal(siteId, sessionId, entries, at, storage = globalThis.localStorage) {
  if (!siteId || !sessionId || !storage) return false;
  const key = KEY(siteId, sessionId);
  try {
    if (!Array.isArray(entries) || entries.length === 0) { storage.removeItem(key); return true; }
    const s = JSON.stringify({ at: at || 0, sessionId, entries });
    // A write we can't make must also DROP any previous journal: a stale snapshot left behind
    // would later fold OLDER geometry over the user's newer edits (adversarial-review finding)
    // — no journal is strictly safer than a stale one (mirror + version ring still hold data).
    if (s.length > MAX_BYTES) { try { storage.removeItem(key); } catch (_) {} return false; }
    storage.setItem(key, s);
    return true;
  } catch (_) {
    try { storage.removeItem(key); } catch (_) {} // quota/privacy: never leave a stale journal
    return false;
  }
}

// Every journal key for `siteId` currently in storage, split own / legacy / other-session.
function siteJournalKeys(siteId, sessionId, storage) {
  const own = KEY(siteId, sessionId);
  const legacy = PREFIX(siteId);
  const sessPrefix = `${PREFIX(siteId)}:s:`;
  const out = { own: null, legacy: null, others: [] };
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k === own) out.own = k;
      else if (k === legacy) out.legacy = k;
      else if (k && k.startsWith(sessPrefix)) out.others.push(k);
    }
  } catch (_) { /* enumeration blocked → own-key best effort below */ }
  if (!out.own && readRaw(storage, own)) out.own = own;          // storage without key() iteration
  if (!out.legacy && readRaw(storage, legacy)) out.legacy = legacy;
  return out;
}
function readRaw(storage, key) {
  try {
    const s = storage.getItem(key);
    if (!s) return null;
    const j = JSON.parse(s);
    return j && Array.isArray(j.entries) ? j : null;
  } catch (_) { return null; }
}
const validEntries = (j) =>
  j.entries.filter((e) => e && typeof e.id === "string" && typeof e.kind === "string");

// Read the entries THIS session may fold: its own journal, the legacy un-suffixed key, and any
// other session's journal orphaned past ORPHAN_ADOPT_MS. A fresh foreign journal (a live tab
// mid-commit) is untouchable. Expired journals (MAX_AGE) are dropped on sight. Dedupe by
// (kind:id) — own-session entries win, then the newest `at`.
export function readJournal(siteId, sessionId, now, storage = globalThis.localStorage) {
  if (!siteId || !storage) return [];
  const keys = siteJournalKeys(siteId, sessionId, storage);
  const picked = new Map(); // "kind:id" -> { entry, own, at }
  const fold = (j, own) => {
    for (const e of validEntries(j)) {
      const k = e.kind + ":" + e.id;
      const prev = picked.get(k);
      if (prev && (prev.own || (!own && prev.at >= (j.at || 0)))) continue;
      picked.set(k, { entry: e, own, at: j.at || 0 });
    }
  };
  const consider = (key, own) => {
    const j = readRaw(storage, key);
    if (!j) return;
    if (now != null && j.at != null && now - j.at > MAX_AGE_MS) {
      try { storage.removeItem(key); } catch (_) {}
      return;
    }
    if (!own && !(now != null && j.at != null && now - j.at > ORPHAN_ADOPT_MS)) return; // live foreign journal — hands off
    fold(j, own);
  };
  if (keys.own) consider(keys.own, true);
  if (keys.legacy) consider(keys.legacy, false);
  for (const k of keys.others) consider(k, false);
  return [...picked.values()].map((p) => p.entry);
}

// Drop THIS session's journal only (the idle-drain path — a live sibling tab keeps its own).
export function clearJournal(siteId, sessionId, storage = globalThis.localStorage) {
  if (!siteId || !sessionId || !storage) return;
  try { storage.removeItem(KEY(siteId, sessionId)); } catch (_) { /* best-effort */ }
}

// Post-fold sweep (the refetch-replace path): remove every key readJournal(now) would have
// consumed — own, plus legacy/orphans ONLY once stale — so an adopted orphan isn't re-folded
// (and re-discarded loudly) on every subsequent refetch. A FRESH foreign journal is NOT removed,
// and neither is a FRESH legacy one (a live pre-upgrade tab may be mid-commit on it; readJournal
// refused to fold it for the same reason, and sweeping what wasn't folded would silently destroy
// that tab's crash protection — adversarial-review finding). Read + sweep must be called with the
// SAME `now` so a journal can't cross the staleness boundary between the two (swept unfolded).
export function sweepJournals(siteId, sessionId, now, storage = globalThis.localStorage) {
  if (!siteId || !storage) return;
  const keys = siteJournalKeys(siteId, sessionId, storage);
  const drop = (key) => { try { storage.removeItem(key); } catch (_) {} };
  const consumed = (key) => { // mirrors readJournal's adopt rule: malformed or stale-orphaned
    const j = readRaw(storage, key);
    return !j || (now != null && j.at != null && now - j.at > ORPHAN_ADOPT_MS);
  };
  if (keys.own) drop(keys.own);
  if (keys.legacy && consumed(keys.legacy)) drop(keys.legacy);
  for (const k of keys.others) if (consumed(k)) drop(k);
}
