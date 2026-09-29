/* Account-level user preferences — the STORE half, split out of userPrefs.js (NEW-3/NEW-4,
 * the header project switcher's pin-to-top feature).
 *
 * WHY THIS FILE EXISTS SEPARATELY: userPrefs.js's `applyPrefs` publishes the plan-standards half
 * of these prefs into the canvas style resolvers (`planStyle.setAccountStyleDefaults` /
 * `measureStyle.setAccountMeasureDefaults`), which statically pulls in `planStyle.js` and, through
 * it, `metesAndBounds.js` (~24 KB). That's the right thing for the Site Planner canvas, which
 * already reaches userPrefs.js through its own static import graph. But the header's project
 * switcher (`shared/ui/ProjectBreadcrumb.jsx`, mounted on EVERY route via AppHeader) only needs the
 * `sitesPanel.pinned` bag — it has no canvas to publish a style default to — and it can only reach
 * userPrefs.js through a dynamic `import()`. Rollup shares a module across two separate chunk
 * boundaries rather than duplicating it, so that dynamic edge pulled `planStyle.js` /
 * `metesAndBounds.js` out of their existing (already-budgeted) chunk and onto the Site route's boot
 * path as a brand-new, unbudgeted chunk (CI's Site-route allowlist gate caught it as
 * `metesAndBounds (+23.9 KB)` — see PR #1714).
 *
 * So the plain read/normalize/persist logic lives here, with NO dependency on the canvas style
 * modules, and userPrefs.js wraps it with the style-publishing behavior for its own callers
 * (SitePlanner.jsx / MapFinder.jsx). Both files store and read the exact same
 * `public.profiles.prefs` row / `planyr:userPrefs:v1` mirror — this is not a second store.
 *
 * LOUD-FAILURE: a failed cloud write returns { ok:false, error } and the caller surfaces it; it
 * is never swallowed into a silent "saved".
 */
import { supabase } from "./supabase.js";
import { getProfileRow, invalidateProfileRow } from "../../../shared/profile/profileRowCache.js";
import { DEFAULT_SHARE_PREF, normalizeSharePref } from "./newProjectSharing.js";
import { normalizeBands as normalizeXSectionBands } from "./roadCrossSection.js";

const MIRROR_KEY = "planyr:userPrefs:v1";

/** The shape we care about today. Additive: a new preference is a new key, never a migration. */
export const EMPTY_PREFS = {
  planStandards: { parcelStyle: {}, typeStyles: {}, measureStyle: {}, buildingStyle: {} },
  newProjectSharing: DEFAULT_SHARE_PREF,
  roadCrossSectionPresets: [],
  sitesPanel: { order: [], collapsed: { complete: true, dead: true }, pinned: [], sort: "recent" },
};

const SITES_PANEL_SORTS = new Set(["largest", "az", "recent"]);
function normalizeSitesPanel(raw) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const order = Array.isArray(r.order) ? r.order.filter((s) => typeof s === "string") : [];
  const collapsedRaw = r.collapsed && typeof r.collapsed === "object" && !Array.isArray(r.collapsed) ? r.collapsed : null;
  const collapsed = collapsedRaw
    ? Object.fromEntries(Object.entries(collapsedRaw).filter(([, v]) => typeof v === "boolean"))
    : { ...EMPTY_PREFS.sitesPanel.collapsed };
  const pinned = Array.isArray(r.pinned) ? r.pinned.filter((id) => typeof id === "string") : [];
  const sort = SITES_PANEL_SORTS.has(r.sort) ? r.sort : EMPTY_PREFS.sitesPanel.sort;
  return { order, collapsed, pinned, sort };
}

const normalizeXSectionPresets = (list) => (Array.isArray(list) ? list : [])
  .filter((p) => p && typeof p.name === "string" && p.name.trim() && Array.isArray(p.bands) && p.bands.length)
  .map((p) => ({ id: p.id || `xsec-${Math.random().toString(36).slice(2, 10)}`, name: p.name, bands: normalizeXSectionBands(p.bands) }));

const normalize = (p) => ({
  ...EMPTY_PREFS,
  ...(p && typeof p === "object" ? p : {}),
  newProjectSharing: normalizeSharePref(p && p.newProjectSharing),
  roadCrossSectionPresets: normalizeXSectionPresets(p && p.roadCrossSectionPresets),
  sitesPanel: normalizeSitesPanel(p && p.sitesPanel),
  planStandards: {
    parcelStyle: { ...((p && p.planStandards && p.planStandards.parcelStyle) || {}) },
    typeStyles: { ...((p && p.planStandards && p.planStandards.typeStyles) || {}) },
    measureStyle: { ...((p && p.planStandards && p.planStandards.measureStyle) || {}) },
    buildingStyle: { ...((p && p.planStandards && p.planStandards.buildingStyle) || {}) },
  },
});

const hasLS = () => { try { return typeof localStorage !== "undefined" && !!localStorage; } catch { return false; } };

export function readMirror() {
  if (!hasLS()) return normalize(null);
  try { return normalize(JSON.parse(localStorage.getItem(MIRROR_KEY) || "null")); } catch { return normalize(null); }
}
export function writeMirror(prefs) {
  if (!hasLS()) return;
  try { localStorage.setItem(MIRROR_KEY, JSON.stringify(prefs)); } catch { /* quota / private mode */ }
  notifyPrefs();
}

/* ---------------------------------------------------------------- the ONE shared, subscribable copy
 * (B1953793) Every reader of the account prefs (the header's pin list, the Map Sites panel, the
 * Site Planner Standards panel) reads THIS snapshot through `useSyncExternalStore`, never its own
 * useState copy. The mirror key is the shared medium: same-tab writes notify via `notifyPrefs`,
 * other tabs arrive through the browser's `storage` event. */
export const PREFS_CHANGED_EVENT = "planyr:userPrefs-changed";
const listeners = new Set();
let snapRaw = Symbol("unset");
let snapVal = null;
export function notifyPrefs() {
  listeners.forEach((l) => { try { l(); } catch { /* a bad subscriber never blocks the rest */ } });
  try { if (typeof window !== "undefined" && window.dispatchEvent) window.dispatchEvent(new Event(PREFS_CHANGED_EVENT)); } catch { /* no window */ }
}
/** Stable snapshot: the SAME object until the mirror's raw text changes (useSyncExternalStore-safe). */
export function getPrefsSnapshot() {
  let raw = null;
  if (hasLS()) { try { raw = localStorage.getItem(MIRROR_KEY); } catch { raw = null; } }
  if (raw !== snapRaw || snapVal === null) { snapRaw = raw; snapVal = readMirror(); }
  return snapVal;
}
export function subscribePrefs(cb) {
  listeners.add(cb);
  const onStorage = (e) => { if (!e || e.key === null || e.key === MIRROR_KEY) cb(); };
  if (typeof window !== "undefined" && window.addEventListener) window.addEventListener("storage", onStorage);
  return () => { listeners.delete(cb); if (typeof window !== "undefined" && window.removeEventListener) window.removeEventListener("storage", onStorage); };
}

/**
 * Load the signed-in user's prefs, normalized — WITHOUT publishing the plan-standards half into
 * the canvas style resolvers (that's userPrefs.js's `loadUserPrefs`). Returns { prefs, source }
 * where source is "cloud" (the account row) or "local" (the mirror only). Never throws.
 */
export async function loadPrefsRaw(uid) {
  const mirror = readMirror();
  if (!supabase || !uid) return { prefs: normalize(mirror), source: "local" };
  try {
    const row = await getProfileRow(uid);
    const prefs = normalize(row?.prefs);
    writeMirror(prefs);
    return { prefs, source: "cloud" };
  } catch (e) {
    return { prefs: normalize(mirror), source: "local", error: e?.message || "prefs load failed" };
  }
}

/**
 * Merge a patch into the account prefs and persist it — WITHOUT publishing to the canvas style
 * resolvers. The mirror is written first so the UI is instant, then the cloud row is upserted; a
 * cloud failure is REPORTED (LOUD-FAILURE), not swallowed.
 */
export async function savePrefsRaw(uid, prefs) {
  // NOTE (B1953793): writes the WHOLE bag it is handed — safe only for a caller whose bag is
  // provably fresh. UI writers use `updatePrefs` (per-change read-modify-write) instead.
  const next = normalize(prefs);
  writeMirror(next);
  if (!supabase || !uid) return { ok: false, prefs: next, error: "not signed in" };
  const { error } = await supabase.from("profiles").upsert({ id: uid, prefs: next, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) return { ok: false, prefs: next, error: error.message };
  invalidateProfileRow(uid);
  return { ok: true, prefs: next };
}

/**
 * FRESH read-modify-write of only what `reducer` changes (B1953793 — the lost-update fix).
 * `reducer(prefs) -> prefs` is applied (1) to the newest on-device mirror immediately, so the UI
 * is instant in every view, then (2) to the account row READ FRESH right now (not any in-memory
 * or cached copy), and that result is upserted — so a key this caller never touched (a dashboard
 * layout, a pin made in another tab) is carried through, never reverted by a stale bag.
 * Writes are serialised so two quick edits land in order. LOUD-FAILURE: { ok:false, error }.
 * A failed cloud write leaves the on-device mirror (the caller says "saved on this computer only").
 */
let writeChain = Promise.resolve();
export function updatePrefs(uid, reducer) {
  const local = normalize(reducer(readMirror()));
  writeMirror(local);
  if (!supabase || !uid) return Promise.resolve({ ok: false, prefs: local, error: "not signed in" });
  const run = async () => {
    try {
      const { data: row, error: readErr } = await supabase.from("profiles").select("prefs").eq("id", uid).maybeSingle();
      if (readErr) return { ok: false, prefs: local, error: readErr.message };
      const next = normalize(reducer(normalize(row?.prefs)));
      const { error } = await supabase.from("profiles").upsert({ id: uid, prefs: next, updated_at: new Date().toISOString() }, { onConflict: "id" });
      if (error) return { ok: false, prefs: local, error: error.message };
      invalidateProfileRow(uid);
      return { ok: true, prefs: next };
    } catch (e) { return { ok: false, prefs: local, error: e?.message || "prefs save failed" }; }
  };
  const p = writeChain.then(run, run);
  writeChain = p.catch(() => {});
  return p;
}

/* ---------------------------------------------------------------- pure edits */

export function setStandardPref(prefs, group, key, value, type) {
  const p = normalize(prefs);
  if (group === "typeStyles") {
    const bag = { ...(p.planStandards.typeStyles[type] || {}) };
    if (value === null || value === undefined) delete bag[key]; else bag[key] = value;
    const all = { ...p.planStandards.typeStyles };
    if (Object.keys(bag).length) all[type] = bag; else delete all[type];
    return { ...p, planStandards: { ...p.planStandards, typeStyles: all } };
  }
  const bag = { ...(p.planStandards[group] || {}) };
  if (value === null || value === undefined) delete bag[key]; else bag[key] = value;
  return { ...p, planStandards: { ...p.planStandards, [group]: bag } };
}

export function getStandardPref(prefs, group, key, type) {
  const p = normalize(prefs);
  return group === "typeStyles" ? (p.planStandards.typeStyles[type] || {})[key] : (p.planStandards[group] || {})[key];
}

/** Merge a patch into the Sites-panel arrangement bag (order/collapsed/pinned/sort). Any key not
 * present in `patch` is left as-is. Used for a group drag reorder, a collapse toggle, a pin/unpin,
 * a per-pin reorder, or a sort-order change — all one store (see EMPTY_PREFS.sitesPanel's header). */
export function setSitesPanelPref(prefs, patch) {
  const p = normalize(prefs);
  return { ...p, sitesPanel: normalizeSitesPanel({ ...p.sitesPanel, ...patch }) };
}

export const _normalizePrefs = normalize;
