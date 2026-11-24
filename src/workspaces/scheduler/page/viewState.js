import { exposeToHarness } from "./harnessGlobals.js";


// B1107680 (NEW-1) — the 13 per-tab / per-browser VIEW-state keys that must NEVER live in the
// versioned hs-v1 cloud document. Before this fix they rode inside the same `data` object that
// gets cloud-saved on every change, so switching projects / zooming the grid / resizing a column
// rewrote the whole ~355KB document and bumped __rev — and every OTHER open tab read that write as
// a genuine concurrent edit, showing a phantom "a newer version was saved on another device" banner
// from a mere navigation. They now live client-side only: VIEW_TAB_KEYS in sessionStorage (per-tab
// — survives a reload of the SAME tab, never crosses to a new one) and VIEW_PREF_KEYS in
// localStorage (durable per-browser preferences a brand-new tab is expected to already have —
// column widths, sort, grouping, health style). editProjId (an in-progress rename) is deliberately
// never persisted at all — it always resets to null on load, like any other transient in-progress-
// edit flag.
const VIEW_TAB_KEYS  = ["aPid", "view", "section"];
const VIEW_PREF_KEYS = ["gridZoom", "gridColWidths", "masterSort", "masterCols", "masterColWidths",
                         "masterGroupBy", "masterLevelFilter", "masterHealthFilter", "masterProjectFilter", "healthColStyle"];
const VIEW_TRANSIENT_KEYS = ["editProjId"];
const VIEW_STATE_KEYS = new Set([...VIEW_TAB_KEYS, ...VIEW_PREF_KEYS, ...VIEW_TRANSIENT_KEYS]);
const VIEW_TAB_STORAGE_KEY   = "planar:tabView:v1";
const VIEW_PREFS_STORAGE_KEY = "planar:viewPrefs:v1";
function loadTabView()      { try { return JSON.parse(sessionStorage.getItem(VIEW_TAB_STORAGE_KEY) || "{}") || {}; } catch { return {}; } }
function saveTabView(obj)   { try { sessionStorage.setItem(VIEW_TAB_STORAGE_KEY, JSON.stringify(obj)); } catch (_) {} }
function loadViewPrefs()    { try { return JSON.parse(localStorage.getItem(VIEW_PREFS_STORAGE_KEY) || "{}") || {}; } catch { return {}; } }
function saveViewPrefs(obj) { try { localStorage.setItem(VIEW_PREFS_STORAGE_KEY, JSON.stringify(obj)); } catch (_) {} }

// NEW-1 (2026-10-02, owner report: "the focus button on the schedule module doesn't hold ... It should
// just hold whatever the last status was") — the OTHER half of the 2026-09-17 strip below. `focused`
// stays OUT of the versioned document (TASK_VIEW_FIELDS), but the strip alone made it live only in
// memory, so every remount/reload came back fully expanded. It now lives per BROWSER in localStorage:
// { [scheduleId]: [focusedTaskId, ...] }. Written by persistViewState (every `focused` change, from the
// pill OR any flow that clears it — re-parent, indent, paste, open-row jump), re-applied by
// applyTaskFocus on every doc that enters memory (load / import / restore / sibling-tab merge).
// `focused` undefined = "not known" (a doc that came off the cloud); an explicit true/false is a
// decision and always wins over what is stored, so a remote doc can never wipe local focus.
const TASK_FOCUS_STORAGE_KEY = "planar:taskFocus:v1";
function loadTaskFocus()    { try { const v = JSON.parse(localStorage.getItem(TASK_FOCUS_STORAGE_KEY) || "{}"); return (v && typeof v === "object" && !Array.isArray(v)) ? v : {}; } catch { return {}; } }
function saveTaskFocus(obj) { try { localStorage.setItem(TASK_FOCUS_STORAGE_KEY, JSON.stringify(obj)); } catch (_) {} }
export function applyTaskFocus(d) {
  if (!d || typeof d !== "object" || !d.projects || typeof d.projects !== "object") return d;
  const store = loadTaskFocus();
  let projects = null;
  Object.keys(store).forEach(pid => {
    const proj = d.projects[pid], ids = store[pid];
    if (!proj || !Array.isArray(proj.tasks) || !Array.isArray(ids) || !ids.length) return;
    const want = new Set(ids);
    let changed = false;
    const tasks = proj.tasks.map(t => {
      if (t && want.has(t.id) && t.focused === undefined) { changed = true; return { ...t, focused: true }; }
      return t;
    });
    if (!changed) return;
    if (!projects) projects = { ...d.projects };
    projects[pid] = { ...proj, tasks };
  });
  return projects ? { ...d, projects } : d;
}
// Fold every explicit `focused` true/false in `next` into the stored map; prune ids that no longer
// exist in a project that is present. A no-op unless the projects tree actually changed.
function persistTaskFocus(prev, next) {
  if (!next || !next.projects || (prev && prev.projects === next.projects)) return;
  const store = loadTaskFocus();
  let dirty = false;
  Object.entries(next.projects).forEach(([pid, proj]) => {
    if (!proj || !Array.isArray(proj.tasks) || !proj.tasks.length) return;
    const before = Array.isArray(store[pid]) ? store[pid] : [];
    const live = new Set(proj.tasks.map(t => t && t.id));
    const set = new Set(before.filter(id => live.has(id)));
    proj.tasks.forEach(t => {
      if (!t) return;
      if (t.focused === true) set.add(t.id);
      else if (t.focused === false) set.delete(t.id);
    });
    const after = [...set];
    if (after.length === before.length && after.every((id, i) => id === before[i])) return;
    dirty = true;
    if (after.length) store[pid] = after; else delete store[pid];
  });
  if (dirty) saveTaskFocus(store);
}

// True when any key OUTSIDE the 13 view-state keys differs between `prev` and `next` — a shallow,
// reference-equality check per top-level key. Safe because every setData updater in this file
// builds its result via immutable spreads, so a changed sub-tree always gets a new object identity.
// Handles any future core key automatically: this only special-cases the fixed, enumerated view
// keys, never the core ones (VIEW-INDEPENDENT-ONCE — work whose inputs are the document's real data
// must not be redone just because the view moved).
export function coreChanged(prev, next) {
  if (prev === next) return false;
  if (!prev || !next) return true;
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const k of keys) {
    if (VIEW_STATE_KEYS.has(k)) continue;
    if (prev[k] !== next[k]) return true;
  }
  return false;
}

// NEW-1 (false-conflict/merge-toast inflation, owner report 2026-09-17) — per-TASK view-only
// fields that must never ride into the versioned document either, same reasoning as the top-level
// VIEW_STATE_KEYS above, one level deeper. `focused` is a task's own "show me just what's still
// open under this row" toggle — pure UI convenience, not data anyone expects synced across devices
// — yet it lives inside the `task` object, which IS core data, so toggling it on an idle tab kept
// bumping __rev and reading as a genuine edit to every other open tab (measured: an idle tab's
// ENTIRE autosave diff, repeatedly, was one task's `focused: true → false`). Stripped here exactly
// like the 13 top-level keys — and restored per browser from localStorage (taskFocus, above), never from the doc.
const TASK_VIEW_FIELDS = ["focused"];
function stripTaskViewFields(tasks) {
  if (!Array.isArray(tasks)) return tasks;
  return tasks.map(t => {
    if (!t || typeof t !== "object") return t;
    let changed = false;
    const out = {...t};
    TASK_VIEW_FIELDS.forEach(k => { if (k in out) { delete out[k]; changed = true; } });
    return changed ? out : t;
  });
}
// The payload actually written to the cloud (a routine autosave OR an explicit pre-X checkpoint
// snapshot) never carries the 13 view-state keys — they are not versioned data and must never bump
// __rev or freeze a stale value into a Version History snapshot. Same treatment for every project's
// tasks' own view-only fields (TASK_VIEW_FIELDS, just above).
export function stripViewState(d) {
  if (!d || typeof d !== "object") return d;
  const out = {...d};
  VIEW_STATE_KEYS.forEach(k => { delete out[k]; });
  if (out.projects && typeof out.projects === "object") {
    const projects = {};
    Object.entries(out.projects).forEach(([pid, proj]) => {
      projects[pid] = (proj && Array.isArray(proj.tasks)) ? { ...proj, tasks: stripTaskViewFields(proj.tasks) } : proj;
    });
    out.projects = projects;
  }
  return out;
}

// NEW-1 (recurrence of B1080547, owner report 2026-09-07: "how come I still can't make multiple
// schedules per project?") — which of a SITE's several linked schedules was most recently active.
// Deliberately NOT a view-state key (must live in the versioned document, not sessionStorage/
// localStorage): a brand-new tab has no per-tab aPid yet (see B1107680 above) and falls back to
// whichever project sorts first; the cross-module carry-in (planar:nav-select-by-site) used to make
// the exact same "first linked, always" choice — so a second/third schedule created for a site was
// reachable only by luck of staying in the same tab forever. This map is the durable memory that
// closes both gaps at once. Pure; a no-op (same object) when the recorded id is already current.
export function withLastActiveSite(d, siteId, scheduleId) {
  if (siteId == null || scheduleId == null) return d;
  if (d.lastActiveBySite && d.lastActiveBySite[siteId] === scheduleId) return d;
  return { ...d, lastActiveBySite: { ...(d.lastActiveBySite || {}), [siteId]: scheduleId } };
}

// Persist whichever of the 13 keys actually changed since the last render — cheap (a few small JSON
// blobs), and this never touches the cloud.
export function persistViewState(prev, next) {
  let tabChanged = false, prefsChanged = false;
  VIEW_TAB_KEYS.forEach(k => { if (!prev || prev[k] !== next[k]) tabChanged = true; });
  VIEW_PREF_KEYS.forEach(k => { if (!prev || prev[k] !== next[k]) prefsChanged = true; });
  if (tabChanged) {
    const cur = loadTabView();
    VIEW_TAB_KEYS.forEach(k => { cur[k] = next[k]; });
    saveTabView(cur);
  }
  if (prefsChanged) {
    const cur = loadViewPrefs();
    VIEW_PREF_KEYS.forEach(k => { cur[k] = next[k]; });
    saveViewPrefs(cur);
  }
  persistTaskFocus(prev, next);   // NEW-1 (2026-10-02) — per-task Focus, local-only
}

// Resolve the 13 view-state keys for a just-loaded/imported/restored document `d`: prefer whatever
// THIS tab (sessionStorage) / THIS browser (localStorage) already holds, and fall back to the value
// baked into `d` only the first time nothing is saved yet — a one-time migration off the legacy
// hs-v1 rows that used to carry these fields inline. This also means an import or a Version History
// restore can never yank the current tab onto a different project than what's on screen: this tab's
// already-saved aPid/view/section win over whatever happened to be baked into the imported/restored
// snapshot. editProjId always resets to null (never resurrected). A guard keeps aPid pointing at a
// REAL project — a stale per-tab id surviving a delete on another device, or an import that swapped
// in a different project set entirely, falls back to the document's own aPid, then to its first
// project, so nothing downstream ever reads the active project as undefined.
// B2285440 — THE ONE ACCESSOR for "which schedule is active". The document can legitimately hold no
// active schedule: an account whose every schedule was deleted (rows soft-deleted, index row still
// there, stale aPid in the index's view flags), or a per-tab aPid that outlived a delete on another
// device. ~8 render paths used to read the active project straight off the projects map bare, so ANY such document crashed
// the view ("This view failed to load"). Everything that needs the active schedule asks these two;
// they never throw and never write. pickActivePid keeps `preferred` when it is real, else the first
// real schedule, else null (the caller shows the visible empty state — nothing is created or deleted).
export function pickActivePid(projects, preferred) {
  if (!projects || typeof projects !== "object") return null;
  if (preferred != null && projects[preferred]) return preferred;
  const first = Object.values(projects).find(p => p && typeof p === "object" && p.id != null);
  return first ? first.id : null;
}
export function resolveViewState(d) {
  if (!d || typeof d !== "object") return d;
  const tab = loadTabView();
  const prefs = loadViewPrefs();
  const patch = { editProjId: null };
  VIEW_TAB_KEYS.forEach(k => { patch[k] = Object.prototype.hasOwnProperty.call(tab, k) ? tab[k] : d[k]; });
  VIEW_PREF_KEYS.forEach(k => { patch[k] = Object.prototype.hasOwnProperty.call(prefs, k) ? prefs[k] : d[k]; });
  if (d.projects && (patch.aPid == null || !d.projects[patch.aPid])) {
    patch.aPid = pickActivePid(d.projects, d.aPid);   // B2285440 — null (not a dangling id) when there is no schedule at all
  }
  const tabPatch = {};   VIEW_TAB_KEYS.forEach(k => { tabPatch[k] = patch[k]; });
  const prefsPatch = {}; VIEW_PREF_KEYS.forEach(k => { prefsPatch[k] = patch[k]; });
  saveTabView({...tab, ...tabPatch});
  saveViewPrefs({...prefs, ...prefsPatch});
  return applyTaskFocus({...d, ...patch});   // NEW-1 (2026-10-02) — re-apply per-task Focus before first render
}

// harness compatibility — the old classic-script page made every top-level binding a global, and the ui-audit / e2e
// drivers call them by bare name from page.evaluate (GanttView, buildGanttSVG, COLS, showToast, …). Same names, same values.
exposeToHarness({
  VIEW_TAB_KEYS: [() => VIEW_TAB_KEYS],
  VIEW_PREF_KEYS: [() => VIEW_PREF_KEYS],
  VIEW_TRANSIENT_KEYS: [() => VIEW_TRANSIENT_KEYS],
  VIEW_STATE_KEYS: [() => VIEW_STATE_KEYS],
  VIEW_TAB_STORAGE_KEY: [() => VIEW_TAB_STORAGE_KEY],
  VIEW_PREFS_STORAGE_KEY: [() => VIEW_PREFS_STORAGE_KEY],
  loadTabView: [() => loadTabView],
  saveTabView: [() => saveTabView],
  loadViewPrefs: [() => loadViewPrefs],
  saveViewPrefs: [() => saveViewPrefs],
  TASK_FOCUS_STORAGE_KEY: [() => TASK_FOCUS_STORAGE_KEY],
  loadTaskFocus: [() => loadTaskFocus],
  saveTaskFocus: [() => saveTaskFocus],
  applyTaskFocus: [() => applyTaskFocus],
  persistTaskFocus: [() => persistTaskFocus],
  coreChanged: [() => coreChanged],
  TASK_VIEW_FIELDS: [() => TASK_VIEW_FIELDS],
  stripTaskViewFields: [() => stripTaskViewFields],
  stripViewState: [() => stripViewState],
  withLastActiveSite: [() => withLastActiveSite],
  persistViewState: [() => persistViewState],
  pickActivePid: [() => pickActivePid],
  resolveViewState: [() => resolveViewState],
});
