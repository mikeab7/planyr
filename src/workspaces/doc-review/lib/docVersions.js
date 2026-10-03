/* Earlier saved versions of one Library file (B2022929, NEW-1 "Version history").
 *
 * The storage already exists: a Word/text Save stores the new bytes under a NEW source id (new Drive key)
 * and keeps the previous source in the review record — `sources[0]` is the latest, `sources[1..]` the
 * earlier ones. Nothing here adds a table or a store; this module only describes that list and builds the
 * entries written into it. PURE (no I/O) so the rules are asserted away from React, Drive and a clock.
 *
 * Invariants: a version is NEVER deleted or rewritten (Restore appends a NEW latest entry whose bytes are
 * the old ones; the old entry stays) · an entry written before this feature has no save date/author and is
 * shown as "Date not recorded", never invented. */

const FIELDS = ["srcId", "name", "size", "storageKey", "driveKey", "oversize", "savedAt", "savedBy", "restoredFrom"];

/** The persisted shape of one source/version entry — keeps the save stamp that older code dropped. */
export function packSource(s) {
  if (!s) return null;
  const out = {
    srcId: s.srcId, name: s.name, size: s.size || 0,
    storageKey: s.storageKey || null, driveKey: s.driveKey || null, oversize: !!s.oversize,
  };
  if (s.savedAt) out.savedAt = s.savedAt;
  if (s.savedBy) out.savedBy = s.savedBy;
  if (s.restoredFrom) out.restoredFrom = s.restoredFrom;
  if (s.local) out.local = true; // bytes live only in this browser session (signed out) — never persisted to the record
  return out;
}
export const SOURCE_FIELDS = FIELDS;

/** A source is a retrievable version only if it was actually stored somewhere. */
const stored = (s) => !!(s && (s.storageKey || s.driveKey || s.oversize));

/** Newest first. `current` = the latest source; `prior` = earlier ones, newest first (as the record keeps them).
 *  Each row: {srcId,name,size,savedAt,savedBy,restoredFrom,isCurrent,number (1 = oldest), readable}. */
export function versionList(current, prior = []) {
  const all = [];
  const seen = new Set();
  for (const s of [current, ...(prior || [])]) {
    if (!s || !s.srcId || seen.has(s.srcId)) continue;
    seen.add(s.srcId); all.push(s);
  }
  const n = all.length;
  return all.map((s, i) => ({
    srcId: s.srcId, name: s.name || "", size: s.size || 0,
    savedAt: s.savedAt || null, savedBy: s.savedBy || "", restoredFrom: s.restoredFrom || null,
    isCurrent: i === 0, number: n - i,
    readable: stored(s) || !!s.local, // a signed-out local save has bytes only in this session
  }));
}

/** The entry for bytes just saved (or restored). */
export function newVersionEntry({ srcId, name, size, driveKey = null, storageKey = null, savedBy = "", now = Date.now(), restoredFrom = null }) {
  return packSource({ srcId, name, size, driveKey, storageKey, oversize: false, savedAt: now, savedBy, restoredFrom });
}

/** Push the entry being replaced down into the earlier-versions list (newest first). Never drops anything. */
export function demote(prior, old, { session = false } = {}) {
  const p = Array.isArray(prior) ? prior : [];
  if (!old || !(stored(old) || session) || p.some((x) => x.srcId === old.srcId)) return p;
  return [packSource(stored(old) ? old : { ...old, local: true }), ...p];
}

/** "Earlier version — 3 Oct 2026, 2:14 PM" (or "Earlier version — date not recorded"). */
export function versionDateLabel(savedAt, locale) {
  if (!savedAt) return "date not recorded";
  try {
    return new Date(savedAt).toLocaleString(locale, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
  } catch (_) { return "date not recorded"; }
}
export const earlierVersionLabel = (savedAt, locale) => `Earlier version — ${versionDateLabel(savedAt, locale)}`;

export function fmtVersionSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

/** Name for "Save a copy": "Report (copy of 3 Oct 2026).docx". Keeps the extension. */
export function copyFileName(name, savedAt, locale) {
  const m = String(name || "document").match(/^(.*?)(\.[A-Za-z0-9]+)?$/);
  const base = (m && m[1]) || "document"; const ext = (m && m[2]) || "";
  let d = "an earlier version";
  if (savedAt) { try { d = new Date(savedAt).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" }); } catch (_) { /* keep default */ } }
  return `${base} (copy of ${d})${ext}`.replace(/[\\/:*?"<>|]/g, "-");
}

/** Whether a file can be browsed version-by-version in an editor. PDFs keep exactly one stored source
 *  (a replaced drawing is a SEPARATE Library file marked "superseded"), so for them the list is the single
 *  current version and Open/Restore don't apply. */
export const canOpenEarlier = (versions, isDoc) => !!isDoc && versions.length > 1;

/* ---------- the two write operations, with I/O injected so they are testable without Drive or React ---------- */

/** Store `blob` as a NEW latest version; the entry it replaces moves into `prior`. Nothing is overwritten.
 *  io.store(srcId, blob) → {ok, driveKey?, storageKey?, driveError?}.  Returns {ok, source, prior} or {ok:false, error}.
 *  `online:false` (signed out) keeps the bytes on this device only — the old entry is still kept. */
export async function saveVersion({ source, prior = [], blob, io, by = "", now = Date.now(), restoredFrom = null, online = true }) {
  if (!source) return { ok: false, error: "There is no file to save to." };
  const srcId = io.newId();
  io.cache && io.cache(srcId, blob);
  if (!online) {
    const entry = { ...packSource({ ...source, srcId, size: blob.size, storageKey: null, driveKey: null, savedAt: now, savedBy: by, restoredFrom }), local: true };
    // The replaced bytes are still in this session's cache, so it stays listed (and restorable) until the tab closes.
    return { ok: true, local: true, source: entry, prior: demote(prior, source, { session: true }) };
  }
  const r = await io.store(srcId, blob);
  if (!r || !r.ok) return { ok: false, error: (r && r.driveError) || "Couldn’t upload the saved file. Your edits are still here — try again." };
  const entry = newVersionEntry({ srcId, name: source.name, size: blob.size, driveKey: r.driveKey || null, storageKey: r.storageKey || null, savedBy: by, now, restoredFrom });
  return { ok: true, source: entry, prior: demote(prior, source) };
}

/** Restore = save an earlier version's CONTENT as a new latest version. History is untouched: every entry
 *  that existed before still exists after, plus one. io.read(version) → Blob|null. */
export async function restoreVersion({ source, prior = [], version, io, by = "", now = Date.now(), online = true }) {
  if (!version || version.isCurrent) return { ok: false, error: "That is already the latest version." };
  const blob = await io.read(version);
  if (!blob) return { ok: false, error: "Couldn’t read that earlier version. Check your connection and try again." };
  const res = await saveVersion({ source, prior, blob, io, by, now, online, restoredFrom: version.srcId });
  return res.ok ? { ...res, blob } : res;
}
