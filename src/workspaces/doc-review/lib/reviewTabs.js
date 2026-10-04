/* Review tabs (NEW-1, 2026-10-04) — the PURE model behind the Bluebeam-style tab strip.
 *
 * A tab is one open review record, keyed by the review id: { id, name, projectId, project, kind }.
 * Everything here is data-in / data-out so it can be asserted without React, pdf.js or a browser:
 *   upsertTab · findOpenTab · closeTab (the neighbour rule) · moveTab (drag reorder) · tabLabel
 *   · the per-DEVICE store (read / write / merge) that reopens the same tabs, order, active tab, and each tab's
 *   page + zoom after a reload.
 * Per-device on purpose (like Bluebeam): a phone must not inherit a desktop's eight tabs, so the store is
 * localStorage — never the cloud. It also carries the account id, so another sign-in on the same browser
 * never reopens someone else's tabs.
 */

export const TABS_STORE_KEY = "planyr:review:tabs:v1";
export const MAX_RESTORED_TABS = 40; // a runaway store can never become a runaway reopen

/** kind of a tab from its file name: Word/text open in the editor, everything else on the drawing canvas. */
export const tabKindOf = (name, docKindOf) => (docKindOf && docKindOf(name) ? "doc" : "pdf");

/** Add a tab, or refresh the one with the same id IN PLACE (position never changes on a refresh). */
export function upsertTab(tabs, tab) {
  if (!tab || !tab.id) return tabs;
  const i = tabs.findIndex((t) => t.id === tab.id);
  if (i < 0) return [...tabs, { id: tab.id, name: tab.name || "", projectId: tab.projectId || null, project: tab.project || "", kind: tab.kind || "pdf", srcKey: tab.srcKey || "" }];
  const cur = tabs[i];
  const next = { ...cur, ...tab, id: cur.id, srcKey: tab.srcKey || cur.srcKey || "" };
  const same = Object.keys(next).every((k) => next[k] === cur[k]);
  if (same) return tabs; // referentially stable — an effect that re-asserts the active tab must not re-render
  const out = tabs.slice(); out[i] = next; return out;
}

/** The already-open tab for a row, or null. By review id first; for a file picked from disk (no record yet) by
 *  name + size inside the SAME project — so the same file name in two projects stays two tabs. */
export function findOpenTab(tabs, ref) {
  if (!ref) return null;
  if (ref.id) { const t = tabs.find((x) => x.id === ref.id); if (t) return t; }
  if (ref.name && ref.size != null) {
    const pid = ref.projectId || null;
    return tabs.find((x) => x.srcKey && x.srcKey === `${ref.name}\u0000${ref.size}` && (x.projectId || null) === pid) || null;
  }
  return null;
}
export const srcKeyOf = (name, size) => (name && size != null ? `${name}\u0000${size}` : "");

/** Close one tab. Returns { tabs, next } — `next` is the id to activate when the CLOSED tab was the active one
 *  (the neighbour to its right, or to its left when it was last; null when nothing is left), else `activeId` unchanged. */
export function closeTab(tabs, id, activeId) {
  const i = tabs.findIndex((t) => t.id === id);
  if (i < 0) return { tabs, next: activeId || null };
  const out = tabs.filter((t) => t.id !== id);
  if (id !== activeId) return { tabs: out, next: activeId || null };
  const n = out[i] || out[i - 1] || null; // after removal, out[i] IS the old right neighbour
  return { tabs: out, next: n ? n.id : null };
}

/** Drag-reorder: move the tab `id` to sit where the tab `beforeId` is (null = the end). */
export function moveTab(tabs, id, beforeId) {
  const from = tabs.findIndex((t) => t.id === id);
  if (from < 0 || id === beforeId) return tabs;
  const without = tabs.filter((t) => t.id !== id);
  const at = beforeId == null ? without.length : without.findIndex((t) => t.id === beforeId);
  if (at < 0) return tabs;
  const out = without.slice(); out.splice(at, 0, tabs[from]);
  return out.every((t, i) => t === tabs[i]) ? tabs : out;
}

/** The hover title: the full name plus the project it is filed under. */
export const tabTitle = (t) => (t.project ? `${t.name} — ${t.project}` : t.name);

/* ---------- the per-device store ---------- */

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
function cleanView(v) {
  if (!v || typeof v !== "object") return null;
  const scale = num(v.scale), tx = num(v.tx), ty = num(v.ty);
  return scale != null && scale > 0 && tx != null && ty != null ? { scale, tx, ty } : null;
}
/** Snapshot of one tab's view state, safe to persist: page · zoom/pan · active tool. */
export function cleanTabState(s) {
  if (!s || typeof s !== "object") return {};
  const out = {};
  if (Number.isInteger(s.page) && s.page >= 1) out.page = s.page;
  const v = cleanView(s.view); if (v) out.view = v;
  if (typeof s.tool === "string" && s.tool) out.tool = s.tool;
  if (typeof s.sel === "string" && s.sel) out.sel = s.sel;
  const sc = num(s.scale) ?? (v ? v.scale : null); if (sc != null && sc > 0) out.scale = sc; // zoom alone — what a OTHER device can use
  return out;
}

/** Serialise. `states` maps tab id → view state. */
export function serializeTabs({ uid = null, tabs, activeId, states, at = 0 }) {
  return JSON.stringify({
    v: 1, uid: uid || null, active: activeId || null, at: at || 0,
    tabs: tabs.slice(0, MAX_RESTORED_TABS).map((t) => ({ id: t.id, name: t.name, projectId: t.projectId || null, project: t.project || "", kind: t.kind || "pdf", srcKey: t.srcKey || "", ...cleanTabState(states && states[t.id]) })),
  });
}

/** Parse what `serializeTabs` wrote. Returns null for anything that is not a usable, same-account store. */
export function parseTabs(raw, uid = null) {
  if (!raw) return null;
  let p; try { p = JSON.parse(raw); } catch (_) { return null; }
  if (!p || p.v !== 1 || !Array.isArray(p.tabs)) return null;
  if ((p.uid || null) !== (uid || null)) return null; // another account's tabs are never reopened
  const seen = new Set();
  const tabs = [];
  for (const t of p.tabs.slice(0, MAX_RESTORED_TABS)) {
    if (!t || typeof t.id !== "string" || !t.id || seen.has(t.id)) continue;
    seen.add(t.id);
    tabs.push({ id: t.id, name: String(t.name || ""), projectId: t.projectId || null, project: String(t.project || ""), kind: t.kind === "doc" ? "doc" : "pdf", srcKey: String(t.srcKey || ""), state: cleanTabState(t) });
  }
  if (!tabs.length) return null;
  const active = tabs.some((t) => t.id === p.active) ? p.active : tabs[0].id;
  return { tabs, active, at: typeof p.at === "number" ? p.at : 0 };
}

/** Restore ∪ whatever is already open (a cross-workspace open can land while the restore is validating):
 *  restored tabs keep their stored order, and a tab opened in the meantime joins the end. */
export function mergeRestored(restored, current) {
  const out = restored.map((t) => ({ id: t.id, name: t.name, projectId: t.projectId, project: t.project, kind: t.kind, srcKey: t.srcKey }));
  for (const c of current) {
    const i = out.findIndex((t) => t.id === c.id);
    if (i < 0) out.push(c); else out[i] = { ...out[i], ...c };
  }
  return out;
}

/** One line for a restore that dropped tabs: names them, never an error screen. */
export function droppedNotice(names) {
  const n = (names || []).filter(Boolean);
  if (!n.length) return "";
  if (n.length === 1) return `“${n[0]}” couldn’t be reopened, so its tab was closed.`;
  return `${n.length} files couldn’t be reopened, so their tabs were closed: ${n.slice(0, 3).map((x) => `“${x}”`).join(", ")}${n.length > 3 ? "…" : ""}.`;
}

/* ---------- a tab that is still only IN MEMORY ---------- */

const KEY_FIELDS = ["storageKey", "driveKey", "oversize"];
const hasKey = (s) => !!(s && (s.storageKey || s.driveKey || s.oversize));

/** Where a source's bytes ended up, as far as `keys` (a srcId → { storageKey, driveKey, oversize } map) knows. */
export function withKnownKeys(src, keys) {
  if (!src || hasKey(src) || !keys || !keys[src.srcId]) return src;
  const k = keys[src.srcId], out = { ...src };
  for (const f of KEY_FIELDS) if (k[f]) out[f] = k[f];
  return out;
}

/** The record to open when switching BACK to a tab this session still holds in memory.
 *  The persisted copy cannot be trusted alone: a file whose upload has not landed (or one opened while signed out) is
 *  deliberately left out of `sources` (B323), so a plain reload of the record would lose its drawing. The live copy is the
 *  newest local truth for everything the user did (markups, page, filing); the stored copy may know something the live one
 *  does not — where the bytes ended up — so keys come from whichever side has them. */
export function mergeLiveRecord(stored, live, keys = null) {
  if (!live) return stored;
  if (!stored) return live;
  if ((stored.updatedAt || 0) > (live.updatedAt || 0)) return stored; // another session saved after we left: theirs is newer
  const byId = new Map((stored.sources || []).map((s) => [s.srcId, s]));
  const sources = (live.sources || []).map((s) => {
    const k = byId.get(s.srcId);
    return withKnownKeys(hasKey(s) || !hasKey(k) ? s : { ...s, ...Object.fromEntries(KEY_FIELDS.filter((f) => k[f]).map((f) => [f, k[f]])) }, keys);
  });
  return { ...stored, ...live, sources };
}

/* ---------- the account copy (what syncs between devices) ---------- */

/** The part of a tab's view state that travels: page + zoom. (Pan, tool, selection, Word cursor/undo stay local.) */
export const syncState = (st) => { const c = cleanTabState(st); return { ...(c.page ? { page: c.page } : {}), ...(c.scale ? { scale: Math.round(c.scale * 1000) / 1000 } : {}) }; };
const syncTab = (t, states) => ({ id: t.id, name: t.name, projectId: t.projectId || null, project: t.project || "", kind: t.kind === "doc" ? "doc" : "pdf", srcKey: t.srcKey || "", ...syncState(states && states[t.id]) });

/** Identity of what would be pushed — no timestamp, so "nothing changed" is decidable and two devices cannot ping-pong. */
export const syncSig = ({ tabs, activeId, states }) => JSON.stringify([activeId || null, tabs.slice(0, MAX_RESTORED_TABS).map((t) => syncTab(t, states))]);

export function buildSyncDoc({ tabs, activeId, states, at }) {
  return { v: 1, at, active: activeId || null, tabs: tabs.slice(0, MAX_RESTORED_TABS).map((t) => syncTab(t, states)) };
}

/** Parse the account copy. null for anything unusable. */
export function parseSyncDoc(doc) {
  if (!doc || typeof doc !== "object" || doc.v !== 1 || !Array.isArray(doc.tabs) || typeof doc.at !== "number") return null;
  const seen = new Set(), tabs = [];
  for (const t of doc.tabs.slice(0, MAX_RESTORED_TABS)) {
    if (!t || typeof t.id !== "string" || !t.id || seen.has(t.id)) continue;
    seen.add(t.id);
    tabs.push({ id: t.id, name: String(t.name || ""), projectId: t.projectId || null, project: String(t.project || ""), kind: t.kind === "doc" ? "doc" : "pdf", srcKey: String(t.srcKey || ""), state: syncState(t) });
  }
  return { tabs, active: tabs.some((t) => t.id === doc.active) ? doc.active : null, at: doc.at };
}

/** Fold the account copy into this device's tabs. LAST CHANGE WINS, with one guard: a Word/text tab holding unsaved edits
 *  HERE stays open even when another device closed it (it is never yanked out from under the edit).
 *  `local` = { tabs, activeId, states }; `remote` = parseSyncDoc(...). `isDirty(id)` says which tabs hold unsaved edits.
 *  adoptActive: take the other device's active tab (Review opening) — off, the tab being looked at stays put.
 *  Returns { tabs, activeId, states, removed: [ids], changed }. */
export function applyRemote(local, remote, { isDirty = () => false, adoptActive = false } = {}) {
  const localById = new Map(local.tabs.map((t) => [t.id, t]));
  const out = remote.tabs.map((r) => { const l = localById.get(r.id); return l ? { ...l, name: r.name || l.name, projectId: r.projectId, project: r.project, kind: r.kind, srcKey: r.srcKey || l.srcKey } : { id: r.id, name: r.name, projectId: r.projectId, project: r.project, kind: r.kind, srcKey: r.srcKey }; });
  const kept = local.tabs.filter((t) => !remote.tabs.some((r) => r.id === t.id) && t.kind === "doc" && isDirty(t.id)); // unsaved here → survives
  const tabs = [...out, ...kept];
  const removed = local.tabs.filter((t) => !tabs.some((x) => x.id === t.id)).map((t) => t.id);
  const states = { ...(local.states || {}) };
  for (const r of remote.tabs) {
    const have = states[r.id] || {};
    if (r.id === local.activeId) continue; // what is on screen keeps its own page/zoom
    if (r.state.page == null && r.state.scale == null) continue;
    const same = (r.state.page == null || r.state.page === have.page) && (r.state.scale == null || Math.abs(r.state.scale - (have.scale || (have.view && have.view.scale) || 0)) < 0.0015);
    if (!same) { const rest = { ...have }; delete rest.view; states[r.id] = { ...rest, ...(r.state.page ? { page: r.state.page } : {}), ...(r.state.scale ? { scale: r.state.scale } : {}) }; } // a remote view has no pan — drop the stale local one
  }
  for (const id of removed) delete states[id];
  let activeId = local.activeId;
  if (adoptActive && remote.active && tabs.some((t) => t.id === remote.active)) activeId = remote.active;
  else if (!tabs.some((t) => t.id === activeId)) {
    const i = local.tabs.findIndex((t) => t.id === local.activeId);
    activeId = (tabs[Math.min(Math.max(i, 0), tabs.length - 1)] || {}).id || null;
    if (remote.active && tabs.some((t) => t.id === remote.active)) activeId = remote.active;
  }
  const changed = syncSig({ tabs, activeId, states }) !== syncSig(local) || removed.length > 0;
  return { tabs, activeId, states, removed, changed };
}
