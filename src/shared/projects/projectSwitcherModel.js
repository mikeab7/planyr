/* The project switcher dropdown's pure model (NEW-1, breadcrumb project picker restyle).
 *
 * Three things live here so the dropdown and its tests can never disagree about them:
 *
 * 1. PINNED STATE ON THE FIRST FRAME. The list used to render in plain recency order and then jump
 *    the pinned projects to the top a beat later, because the pinned ids arrived from an async
 *    account-prefs load. `readPinnedFromMirror` reads the SAME `sitesPanel.pinned` array from the
 *    on-device mirror (`planyr:userPrefs:v1`, which `userPrefsStore.loadPrefsRaw`/`savePrefsRaw`
 *    keep in step with the account row) SYNCHRONOUSLY, so the first painted frame already has it.
 *    It is deliberately a dependency-free re-read of that one key rather than an import of
 *    `userPrefsStore.js` — the breadcrumb is chrome on every route and that module is reached only
 *    by dynamic import (see ProjectBreadcrumb's own note on the PR #1714 bundle regression).
 *
 * 2. ONE "LAST OPENED" FIELD. Both groups sort by it, newest first, and the time on each row is
 *    derived from it — `lastOpenedAt` is the only reader, so the sort key and the displayed time
 *    cannot drift apart. It is the later of (a) when this device last opened the project and (b) its
 *    last-saved time, so an edit made from another device still counts as an interaction.
 *
 * 3. The row's short time form ("now", "12m", "4h", "3d", "2w") and the search highlight split.
 */

export const USER_PREFS_MIRROR_KEY = "planyr:userPrefs:v1";
export const OPENED_KEY = "planyr:projectOpened:v1";
const OPENED_CAP = 500;

const lsOf = (storage) => {
  if (storage) return storage;
  try { return typeof localStorage !== "undefined" ? localStorage : null; } catch (_) { return null; }
};

/** Pinned project ids from the on-device mirror, synchronously. Never throws; [] when absent. */
export function readPinnedFromMirror(storage) {
  const ls = lsOf(storage);
  if (!ls) return [];
  try {
    const p = JSON.parse(ls.getItem(USER_PREFS_MIRROR_KEY) || "null");
    const pinned = p && p.sitesPanel && p.sitesPanel.pinned;
    return Array.isArray(pinned) ? pinned.filter((id) => typeof id === "string") : [];
  } catch (_) { return []; }
}

/** { [projectId]: epochMs } — when this device last opened each project. Never throws. */
export function readOpenedMap(storage) {
  const ls = lsOf(storage);
  if (!ls) return {};
  try {
    const m = JSON.parse(ls.getItem(OPENED_KEY) || "null");
    return m && typeof m === "object" && !Array.isArray(m) ? m : {};
  } catch (_) { return {}; }
}

/** Record that `id` was opened now. Returns the updated map (also when storage is unavailable). */
export function noteProjectOpened(id, now = Date.now(), storage) {
  const map = { ...readOpenedMap(storage) };
  if (id == null || id === "") return map;
  map[id] = now;
  const keys = Object.keys(map);
  if (keys.length > OPENED_CAP) {
    keys.sort((a, b) => (Number(map[b]) || 0) - (Number(map[a]) || 0)).slice(OPENED_CAP).forEach((k) => { delete map[k]; });
  }
  const ls = lsOf(storage);
  try { ls && ls.setItem(OPENED_KEY, JSON.stringify(map)); } catch (_) { /* quota / private mode — the sort just falls back to saved time */ }
  return map;
}

const toMs = (ts) => (typeof ts === "string" ? (Date.parse(ts) || Number(ts) || 0) : (Number(ts) || 0));

/** THE one "last opened" reader — the sort key AND the source of the time shown on the row. */
export function lastOpenedAt(p, opened = {}) {
  if (!p) return 0;
  return Math.max(toMs(opened && opened[p.id]), toMs(p.updatedAt));
}

/** Current project first, then pinned, then the rest — both groups newest-opened first. Stable. */
export function orderForSwitcher(list = [], currentId = null, pinnedIds = [], opened = {}) {
  const pinned = new Set(pinnedIds || []);
  const byRecent = (a, b) => lastOpenedAt(b, opened) - lastOpenedAt(a, opened);
  const seen = new Set();
  const rows = (list || []).filter((p) => p && p.id != null && !seen.has(p.id) && seen.add(p.id));
  const current = currentId != null ? rows.find((p) => p.id === currentId) : null;
  const others = rows.filter((p) => p !== current);
  return [
    ...(current ? [current] : []),
    ...others.filter((p) => pinned.has(p.id)).sort(byRecent),
    ...others.filter((p) => !pinned.has(p.id)).sort(byRecent),
  ];
}

/** Short row time: "now", "12m", "4h", "3d", "2w", then a short date for anything over ~a month. */
export function relTimeShort(ts, now = Date.now()) {
  const t = toMs(ts);
  if (!t) return "";
  const min = Math.floor(Math.max(0, now - t) / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  if (day < 30) return `${Math.floor(day / 7)}w`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Split `name` into [{ text, hit }] around every case-insensitive occurrence of `q`. */
export function highlightParts(name, q) {
  const s = String(name ?? "");
  const needle = String(q ?? "").trim().toLowerCase();
  if (!needle) return [{ text: s, hit: false }];
  const hay = s.toLowerCase();
  const out = [];
  let i = 0;
  for (;;) {
    const j = hay.indexOf(needle, i);
    if (j < 0) break;
    if (j > i) out.push({ text: s.slice(i, j), hit: false });
    out.push({ text: s.slice(j, j + needle.length), hit: true });
    i = j + needle.length;
  }
  if (i < s.length) out.push({ text: s.slice(i), hit: false });
  return out.length ? out : [{ text: s, hit: false }];
}
