/* Model — the underwriting spreadsheet workspace root.
 *
 * The grid is Univer (components/UniverSheet.jsx, loaded lazily with this tab); this file is the host around it: which workbook is open
 * (a project's own, an Organization workbook, or a Library file), loading and saving it, the File menu's Excel / CSV round trip, and the
 * live project data (Site.* / Plan.* / Comp.*) its formulas read. The stored workbook format is lib/sheetModel.js; the numbers on screen,
 * in the Excel file and in the CSV are Univer's engine's (lib/univerEval.js). The old hand-built grid was retired — see
 * docs/SPREADSHEET-UNIVER-SPIKE.md ("Retired").
 *
 * PERSISTENCE (lib/modelStore.js): local storage is the write-through save that works today,
 * signed in or not, migration or not. The cloud push rides the SAME guarded save path every
 * other cloud table in this repo uses (src/shared/cloud/serializeWrites.js +
 * optimisticUpsert.js) against `model_sheets` (db/model_sheets.sql) — applied to production
 * 2026-08-31. THERE IS NO CROSS-DEVICE MERGE IN V1: local wins whenever it exists; the cloud
 * copy is adopted only to seed a brand-new device that has never opened this project's model
 * before. A genuine two-device conflict DURING a save (another device bumped the version in the
 * gap between this device's load and its own save) surfaces as a small banner rather than
 * silently overwriting anything, and simply asks for a reload.
 *
 * ⛔ B891184-FOLLOWUP-2 (live production finding, 2026-08-31) — TWO further defects, both fixed
 * here: (1) the cloud push silently failed on every first-ever save (modelStore.js's row never
 * included `id`, a real NOT NULL violation on a table whose primary key is composite
 * (user_id, id) — proven live against production) while the header kept showing a confident
 * green "Synced" badge, because `modelSaveState` treated "idle" (nothing confirmed yet) the same
 * as "confirmed synced." Fixed at the source (modelStore.js + optimisticUpsert.js) and the
 * badge now only claims "Synced" once a real round trip (`cloudConfirmed`) has happened this
 * session. (2) A DIFFERENT, still-open gap the CAS-conflict guard above does NOT cover: it only
 * catches a race that happens DURING a save. If device B opens this project with its OWN older
 * local copy while device A's newer content already sits in the cloud, B's load correctly reads
 * cloud version N (so nothing double-books, no false conflict is raised) but then keeps
 * SHOWING B's stale local content (by the "local always wins on load" rule above) — B's next
 * edit saves cleanly at version N→N+1, silently overwriting A's work with no warning, since
 * nothing in the CAS check knows the CONTENT diverged, only the version. That is now DETECTED
 * at load (`status: "diverged"`, a loud red badge + an explicit banner) — v1 still doesn't
 * merge, but it can no longer clobber another device's saved work in total silence.
 */
import { useProjectName, projectNameOf } from "../../shared/names/names.js";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import AppHeader from "../../shared/ui/AppHeader.jsx";
import { RADIUS } from "../../shared/ui/radius.js";
import { useUndoableState } from "./lib/undoStack.js";
import {
  createWorkbook, migrateWorkbook, activeSheetEntry, sheetsDiverge, workbookHasContent,
} from "./lib/sheetModel.js";
import { evalFromPlain, circularNotice } from "./lib/evalValues.js";
import { planyrSyntaxNote } from "./lib/planyrSyntax.js";
import { modelSaveState } from "./lib/modelSaveState.js";
import { runCloudPush, shownModelStatus } from "./lib/modelPushGate.js";
import { orgCloudOutcome, mergeOrgWorkbookLists } from "./lib/orgWorkbookOps.js";
import { Button } from "../../shared/ui/controls.jsx";
import { FONT_SIZE, SPACE } from "../../shared/ui/designTokens.js";
import {
  readLocalSheet, writeLocalSheet, readSyncMeta, writeSyncMeta, decideAnonAdoption, loadCloudSheet, saveCloudSheet,
  readLocalOrgIndex, writeLocalOrgIndex, touchLocalOrgIndex, removeLocalOrgIndexEntry,
  listOrgWorkbooksCloud, loadOrgWorkbookCloud, saveOrgWorkbookCloud, renameOrgWorkbookCloud, deleteOrgWorkbookCloud,
} from "./lib/modelStore.js";
import { reconcileProjects, onProjectsChanged } from "../../shared/projects/projects.js";
import FileMenu from "./components/FileMenu.jsx";
// The Univer grid is THE grid (the only one since the old grid was retired — docs/SPREADSHEET-UNIVER-SPIKE.md). It is a lazy chunk, loaded
// with the Spreadsheet tab (src/app/modulePrefetch.js + the warm below), so none of @univerjs/* rides any other workspace's bundle.
import { warmUniver } from "./lib/univerWarm.js";
import { primeCalcCache, calcCacheSettled } from "./lib/univerCalcCache.js";
const UniverSheet = lazy(() => import("./components/UniverSheet.jsx"));
const CALC_WAIT_MS = 150;                      // the most the grid waits for the device-local calculation cache to be read
// NEW-1 (B2587264) — every device starts fetching the grid's chunk the moment THIS chunk runs, in parallel with the
// admin check and the workbook load, instead of after them (measured live: the chunk request began ~250 ms after ModelApp arrived).
warmUniver();
import OrgWorkbookPicker from "./components/OrgWorkbookPicker.jsx";
import { addSheetFromCsvText, sheetToCsv } from "./lib/csvIO.js";
// NEW-1 (open an uploaded Excel in Spreadsheet) — a Library file opened as an editable workbook.
// Everything heavy (ExcelJS, SheetJS, the parse worker) loads lazily behind lib/fileWorkbookStore.js.
import { useFileWorkbook } from "./lib/useFileWorkbook.js";
import { scopeKeyFor, readActiveFile, setActiveFile, onActiveFileChanged } from "./lib/activeFile.js";
import { spreadsheetKindOf } from "./lib/spreadsheetKind.js";
import { FileBar, FileNotes, FileProblem, FileLoading } from "./components/FileBar.jsx";
import { parseSpreadsheetInWorker, exportWorkbookInWorker } from "./lib/spreadsheetClient.js";
// spreadsheet-live-data-refs — the project's own data (site plan + comps), exposed read-only as
// Site.*/Plan.*/Comp.* formula names (lib/projectRefs.js's own header). `onSiteModelChanged` is a
// cross-workspace notification this feature added to storage.js (mirroring the pre-existing
// `onProjectsChanged` shape exactly) so a live edit made in the still-mounted Site Planner tab
// recalculates a formula here without a reload. `fetchAllComps` is the same async/Supabase-only
// read CompsPanel.jsx uses — there is no synchronous comps cache anywhere in this repo.
import { decideLoadSync, isPlaceholderWorkbook } from "./lib/modelSyncBase.js";
import { buildProjectNames, openPlanId } from "./lib/projectRefs.js";
import { onSiteModelChanged, isCloudActive } from "../site-planner/lib/storage.js";
import { onCompsChanged } from "../../shared/comps/lib/compsChanged.js";
import { supabase } from "../site-planner/lib/supabase.js";
import { fetchPlanRowsForModel, planRowsLoading, planRowsReady, planRowsError, rowsSignature } from "./lib/planRowsSource.js";
import { fetchProjectNameComps } from "./lib/projectCompsFetch.js";

const CLOUD_PUSH_DEBOUNCE_MS = 800;
// Excel round-trip — ALL the heavy xlsx work (read, write, old .xls) runs in ONE Web Worker
// (lib/spreadsheetWorker.js, reached through lib/spreadsheetClient.js, lazily), so opening this tab is
// never slower for someone who never imports or exports and the tab never freezes on a big workbook.

function sanitizeFilename(name) {
  return String(name || "Workbook").replace(/[\\/:*?"<>|]+/g, "_").trim() || "Workbook";
}

/** The DocReview.jsx-established pattern for "hand the browser a Blob to save" — a throwaway
 *  object URL + a synthetic <a download>, clicked and immediately discarded. */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* V537648 — the visible, persistent "two different copies" bar. Module scope
 * (MODULE-SCOPE-COMPONENTS). It stays until the user picks one; nothing is pushed to the cloud
 * while it is up (lib/modelPushGate.js). `showing` says which copy is on screen right now. */
function DivergedBar({ showing, onKeepDevice, onUseCloud }) {
  const text = showing === "cloud"
    ? "This spreadsheet has a different copy saved on this device from before you signed in. You're seeing the cloud copy. Nothing will be saved to the cloud until you choose which to keep."
    : "This spreadsheet has a different copy saved in the cloud (from another device or browser). You're seeing this device's copy. Nothing will be saved to the cloud until you choose which to keep.";
  return (
    <div
      role="alert"
      data-testid="model-diverged-bar"
      style={{
        flex: "none", display: "flex", alignItems: "center", flexWrap: "wrap", gap: SPACE.md,
        margin: `${SPACE.md}px ${SPACE.md}px 0`, padding: `${SPACE.sm}px ${SPACE.lg}px`,
        background: "var(--danger-bg)", color: "var(--text-primary)", border: "1px solid var(--danger)", borderRadius: RADIUS.md,
        fontSize: FONT_SIZE.control, lineHeight: 1.45,
      }}
    >
      <span style={{ flex: "1 1 260px", fontWeight: 600 }}>{text}</span>
      <Button variant="ghost" size="sm" data-testid="model-diverged-use-cloud" onClick={onUseCloud}>Use the cloud copy</Button>
      <Button variant="ghost" size="sm" data-testid="model-diverged-keep-device" onClick={onKeepDevice}>Keep this device's copy</Button>
    </div>
  );
}

function EmptyProjectState({ onGoDashboard }) {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 28, background: "var(--surface-page)" }}>
      <div style={{ maxWidth: 380, textAlign: "center" }}>
        <h2 style={{ margin: "0 0 8px", fontSize: 19, fontWeight: 700, color: "var(--text-primary)" }}>No spreadsheet open</h2>
        <p style={{ margin: "0 0 16px", fontSize: 13.5, lineHeight: 1.6, color: "var(--text-secondary)" }}>
          A spreadsheet belongs to a project, the same as a site plan or a set of drawings. Pick or start a project to open it.
        </p>
        <button
          type="button"
          onClick={onGoDashboard}
          style={{ height: 32, padding: "0 16px", borderRadius: 8, border: "1px solid var(--accent-model)", background: "var(--accent-model)", color: "var(--on-accent-model)", font: "inherit", fontSize: 13.5, fontWeight: 650, cursor: "pointer" }}
        >Go to Dashboard</button>
      </div>
    </div>
  );
}

export default function ModelApp({
  isActive, shellModule, onShellSwitch, authControl, accountActive, userId,
  projectId, crossProject, onNavigate, onGoDashboard, onNewProject, onSelectOrg,
  // ORG SCOPE (NEW-1, B1912209) — standing in the Organization, not any project (route.js's
  // `org` field; mutually exclusive with `projectId`/`crossProject` by construction — see
  // `orgMode` below). Unlike a project's single workbook, Organization holds SEVERAL — the
  // picker (`OrgWorkbookPicker.jsx`) chooses one before this component's existing grid/ribbon/
  // File-menu UI (unchanged, reused verbatim) has anything to show.
  org = false,
}) {
  const { value: workbook, commit: commitRaw, reset } = useUndoableState(createWorkbook());
  // B2450528 — "the person changed it" vs "a load adopted it". Only commit/undo/redo raise this flag
  // (reset never does), and the local write-through effect consumes it to mark the stored copy DIRTY
  // (edited since it was last confirmed against the cloud — see lib/modelSyncBase.js).
  const userEditRef = useRef(false);
  const commit = useCallback((u) => { userEditRef.current = true; commitRaw(u); }, [commitRaw]);
  // Which sheet TAB is currently being VIEWED (the one a CSV export writes). Kept outside the undo-tracked `workbook` value: a plain tab
  // click is navigation, not a content edit. Seeded from `workbook.activeSheetId` on every load and updated from the grid's own changes;
  // if the stored id ever names a sheet that no longer exists, the effect below resyncs it.
  const [activeSheetId, setActiveSheetId] = useState(() => workbook.activeSheetId);
  const activeEntry = workbook.sheets.find((s) => s.id === activeSheetId) || activeSheetEntry(workbook);
  useEffect(() => { if (activeEntry.id !== activeSheetId) setActiveSheetId(activeEntry.id); }, [activeEntry.id, activeSheetId]);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("idle"); // idle | saving | saved | error | conflict | not-provisioned | diverged
  // Whether a REAL cloud round trip (a successful load or a successful save) has happened this
  // session for the CURRENT project. Distinct from `status`, which can be "idle" — meaning
  // nothing failed but nothing was ever confirmed either — the exact ambiguity that used to let
  // the badge claim "Synced" for a project that had never actually reached the cloud.
  const [cloudConfirmed, setCloudConfirmed] = useState(false);
  // B1076480: the on-device project-name cache (listProjects()) is only populated after a cloud
  // pull — Notes.jsx/Scheduler.jsx warm it on mount, but this workspace never did, so a fresh
  // tab/deep-link/reload landing straight in Model saw an empty cache and the breadcrumb fell back
  // to the literal word "Project" instead of the real name.
  // ⛔ `warmProjectsIfEmpty()` (what Notes/Scheduler use) is NOT enough on its own — it's gated on
  // the WHOLE cache being empty (`loadSiteSummaries().length === 0`), so it no-ops for the more
  // likely real case: a cache that already holds OTHER projects but has quietly diverged and is
  // simply missing/stale for THIS one (documented gap, B853266 — "the switcher can be opened a
  // hundred times and it will keep serving the same stale snapshot"). That fix only reaches the
  // project SWITCHER dropdown (reconcile only runs when it's opened, in ProjectBreadcrumb.jsx) —
  // the crumb TEXT itself, resolved via resolveCurrentName()'s synthetic-entry fallback, is still
  // exposed the moment this workspace is a fresh mount. reconcileProjects() is the always-pull
  // sibling (no empty-cache gate) — call it once on mount, then keep listening so a later cloud
  // pull (from anywhere in the app) self-heals the breadcrumb too.
  // Deliberately unread — its only job is to force the re-render that picks up the newly-warmed
  // cache in the plain `projectName` computation below (B1128 dead-store convention: `_` prefix).
  const [_projectsTick, setProjectsTick] = useState(0);
  useEffect(() => {
    let live = true;
    (async () => {
      try { await reconcileProjects(); } catch (_) {}
      if (live) setProjectsTick((n) => n + 1);
    })();
    const off = onProjectsChanged(() => { if (live) setProjectsTick((n) => n + 1); });
    return () => { live = false; off(); };
  }, []);
  // spreadsheet-live-data-refs — the two live inputs Site.*/Plan.*/Comp.* project names are built
  // from (lib/projectRefs.js). `comps` is re-fetched on mount and on every project switch
  // (compsStore.js is async/Supabase-only, no sync cache — see that module's own header);
  // `siteTick` bumps on a DEBOUNCED site-content-changed notification, so a burst of drag-frame
  // saves in the (possibly hidden) Site Planner tab recomputes the site model once, not per save.
  const [comps, setComps] = useState([]);
  // B1953796 (R4) — comps are re-read on project switch AND whenever a comp is written elsewhere
  // (the Site Planner's Comps panel, same mounted app) or this workspace becomes active/visible
  // again, so Comp.<title>.* never quotes a stale rate. Token-guarded: the newest read wins.
  const compsReq = useRef(0);
  const refetchComps = useCallback(async () => {
    const tok = ++compsReq.current;
    const { data, error } = await fetchProjectNameComps();
    if (tok === compsReq.current && !error) setComps(data || []); // a FAILED read keeps the last-known list
  }, []);
  useEffect(() => { refetchComps(); }, [projectId, refetchComps]);
  useEffect(() => { if (isActive) refetchComps(); }, [isActive, refetchComps]);
  useEffect(() => {
    const off = onCompsChanged(refetchComps);
    const onVis = () => { if (document.visibilityState === "visible") refetchComps(); };
    window.addEventListener("focus", onVis);
    document.addEventListener("visibilitychange", onVis);
    return () => { off(); window.removeEventListener("focus", onVis); document.removeEventListener("visibilitychange", onVis); };
  }, [refetchComps]);
  const [siteTick, setSiteTick] = useState(0);
  const siteTickTimer = useRef(0);
  useEffect(() => {
    const off = onSiteModelChanged(() => {
      clearTimeout(siteTickTimer.current);
      siteTickTimer.current = window.setTimeout(() => setSiteTick((n) => n + 1), 600);
    });
    return () => { off(); clearTimeout(siteTickTimer.current); };
  }, []);
  /* B1953797 (H2) — a SIGNED-IN plan's geometry is element ROWS, not the local mirror (which is a slim
   * header on any device that has not opened the plan). Fetch the open plan's rows so Site.Acres /
   * Plan.BuildingN.SF read the same source of truth the Map and Dashboard do, with an explicit
   * loading / error state (projectRefs.js turns those into a labelled #N/A — never #REF! or a stale
   * number for "not fetched"). Refreshes on: plan/project change · a site-content notification
   * (`siteTick` — the Site Planner's own commits, remote rows applied there included) · the tab
   * regaining focus · a realtime change on the plan's element rows (best effort — the focus/tick paths
   * are the floor). Signed out: `null` → the local mirror stays the one authority, as before. */
  const [planRows, setPlanRows] = useState(null);
  const [rowsTick, setRowsTick] = useState(0);
  const cloudOn = isCloudActive();
  const openPlan = useMemo(() => (cloudOn ? openPlanId(projectId) : null), [cloudOn, projectId, siteTick, _projectsTick]);
  useEffect(() => {
    if (!openPlan) { setPlanRows(null); return undefined; }
    let live = true;
    // First look at a plan (or a different plan) is LOADING; a refresh of the same plan keeps what it
    // has (stale-while-revalidate) so the sheet does not flicker to #N/A on every commit.
    setPlanRows((cur) => (cur && cur.planId === openPlan ? cur : planRowsLoading(openPlan)));
    const t = window.setTimeout(async () => {
      const r = await fetchPlanRowsForModel(openPlan);
      if (!live) return;
      setPlanRows((cur) => {
        if (!r.ok) return planRowsError(openPlan, r.error);
        if (cur && cur.planId === openPlan && cur.status === "ready" && rowsSignature(cur.rows) === rowsSignature(r.rows)) return cur;
        return planRowsReady(openPlan, r.rows);
      });
    }, 250);
    return () => { live = false; window.clearTimeout(t); };
  }, [openPlan, siteTick, rowsTick]);
  useEffect(() => {
    if (!openPlan) return undefined;
    const bump = () => setRowsTick((n) => n + 1);
    const onVis = () => { if (document.visibilityState === "visible") bump(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", bump);
    let ch = null, debounce = 0;
    try {
      if (supabase) {
        ch = supabase.channel(`model-plan-rows:${openPlan}`)
          .on("postgres_changes", { event: "*", schema: "public", table: "site_elements", filter: "site_id=eq." + openPlan },
            () => { clearTimeout(debounce); debounce = window.setTimeout(bump, 800); })
          .subscribe();
      }
    } catch (_) { /* realtime is a bonus: focus + siteTick keep the numbers current without it */ }
    return () => {
      document.removeEventListener("visibilitychange", onVis); window.removeEventListener("focus", bump); clearTimeout(debounce);
      try { if (ch && supabase) supabase.removeChannel(ch); } catch (_) {}
    };
  }, [openPlan]);
  const projectNames = useMemo(() => buildProjectNames(projectId, { comps, planRows }), [projectId, comps, siteTick, _projectsTick, planRows]);
  // NEW-1 (2026-10-29) — no plan/concept crumb here: only the Site tab is plan-scoped, so the
  // Spreadsheet header reads "Dashboard / <Project> ▾" (the old spreadsheet-concept-crumb is gone,
  // and shared/ui/crumbScope.js would not draw a trailing crumb on this module anyway).
  const cloudVersionRef = useRef(null);
  // B2450528 — the sync base (modelSyncBase.js): `baseVersionRef` = the cloud version this device's copy was
  // last confirmed against, `dirtyRef` = it holds edits not yet confirmed uploaded, `workbookRef` = the
  // workbook on screen RIGHT NOW (so a cloud answer that lands after a keystroke decides on the edited copy).
  const baseVersionRef = useRef(null);
  const dirtyRef = useRef(false);
  const workbookRef = useRef(null);
  workbookRef.current = workbook;
  const [cloudSettled, setCloudSettled] = useState(false); // the cloud load has answered (any way) for this workbook
  const pushTimer = useRef(0);
  // V537648 — the debounced push reads these at FIRE time (lib/modelPushGate.js). `statusRef`
  // mirrors `status`; `divergedRef` is the divergence HOLD — a latch set synchronously the moment
  // the load detects local ≠ cloud, released only by a fresh load or the user's own resolution
  // (the two buttons in the "different copies" bar). `divergedCopiesRef` keeps both sides so the
  // user can pick either one; `diverged` is its render mirror.
  const statusRef = useRef(status);
  useEffect(() => { statusRef.current = status; }, [status]);
  const divergedRef = useRef(false);
  const divergedCopiesRef = useRef(null); // { device, cloud, showing: "device" | "cloud" } | null
  const [diverged, setDiverged] = useState(false);
  const [pushNonce, setPushNonce] = useState(0); // bumped by a resolution so the push runs even with no edit
  const markDiverged = useCallback((copies) => {
    divergedRef.current = true;
    divergedCopiesRef.current = copies;
    clearTimeout(pushTimer.current);
    setDiverged(true);
    setStatus("diverged");
  }, []);
  const loadTokenRef = useRef(0);
  // A one-line, auto-dismissing message for anything a shortcut could not do — LOUD-FAILURE: no silent no-op.
  const [notice, setNotice] = useState(null);
  const noticeTimer = useRef(null);
  const showNotice = useCallback((msg) => {
    setNotice(msg);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 7000);
  }, []);
  useEffect(() => () => clearTimeout(noticeTimer.current), []);
  const fileMenuRef = useRef(null);
  // ORG SCOPE (NEW-1) — hoisted above the view-preference hooks below so they can key on the
  // right thing (a project id, or an org workbook id) without reordering any hook relative to
  // the rest of this component. `orgMode` requires `projectId` to be null BY CONSTRUCTION
  // (route.js never sets `org` and `projectId` together — invariant §14, docs/DATA.md), checked
  // here too rather than trusted blindly. The fuller org-scope block further down
  // (openOrgWorkbook/openWorkbook/storageKey, the workbook list + its CRUD) builds on these two.
  const orgMode = !!org && !crossProject && !projectId;
  const [orgWorkbookId, setOrgWorkbookId] = useState(null);
  // NEW-1 (open an uploaded Excel) — FILE MODE: the Spreadsheet is showing a Library file, remembered
  // per place (this project / the Organization). It wins over the project's own workbook until
  // "Close file". The pointer is lib/activeFile.js (written by the Shell when a Library row is
  // clicked); the content is the Library file itself (lib/fileWorkbook.js) — never a copy.
  const fileScopeKey = scopeKeyFor({ projectId: crossProject ? null : projectId, org: orgMode });
  const [activeFileId, setActiveFileId] = useState(() => readActiveFile(fileScopeKey));
  const fileScopeRef = useRef(fileScopeKey);
  useEffect(() => { fileScopeRef.current = fileScopeKey; setActiveFileId(readActiveFile(fileScopeKey)); }, [fileScopeKey]);
  useEffect(() => onActiveFileChanged((scope, id) => { if (scope === fileScopeRef.current) setActiveFileId(id); }), []);
  const fileMode = !!activeFileId;
  const viewPrefsKey = fileMode ? `file:${activeFileId}` : (orgMode ? orgWorkbookId : projectId);

  // The grid's calculation cache (lib/univerCalcCache.js) is read from this device's large store, and the grid is mounted only once that read
  // has settled (or after CALC_WAIT_MS, whichever is first): its first `load()` is synchronous and cannot wait for a read, and a read still in
  // flight at that moment is a silent miss. When the Univer chunk is still downloading the read is long finished, so this costs nothing then;
  // on a warm tab click it is a few milliseconds, repaid many times over by a first paint that is already complete.
  const [calcReadyKey, setCalcReadyKey] = useState(null);
  useEffect(() => {
    let live = true; const done = () => { if (live) setCalcReadyKey(viewPrefsKey); };
    Promise.resolve(primeCalcCache(viewPrefsKey)).then(done, done); // B2671203 — primeCalcCache(null) returns null (no scope): a bare `.then` crashed the whole workspace
    const t = setTimeout(done, CALC_WAIT_MS);
    return () => { live = false; clearTimeout(t); };
  }, [viewPrefsKey]);
  const calcReady = calcCacheSettled(viewPrefsKey) || calcReadyKey === viewPrefsKey;
  // The grid mounts with the workbook that is LOADED, never with ModelApp's blank first-render placeholder: the load effect that reads the device copy
  // runs just after the first render, and a grid that mounted in between built a blank unit, then threw it away for the real one (and could not adopt a
  // unit pre-built for the real workbook — B2607857). A Library file (`fileMode`) has its own loading phase and never sets `ready`.
  const gridWorkbookReady = fileMode || ready;
  const openProject = !crossProject && !!projectId;

  // ORG SCOPE (NEW-1), continued from `orgMode`/`orgWorkbookId` above (hoisted for the view-
  // preference hooks). A stray prop combination (org true but projectId also somehow set) falls
  // through `orgMode`'s own guard to the plain empty state in the render below, rather than
  // silently mis-happening on whatever `projectId` last named (the "URL is a hint, not an
  // address" trap B1020928 warns against).
  const [orgWorkbooks, setOrgWorkbooks] = useState(() => readLocalOrgIndex(userId));
  const [orgListLoading, setOrgListLoading] = useState(false);
  const [orgListNotice, setOrgListNotice] = useState(null);
  const openOrgWorkbook = orgMode && !!orgWorkbookId;
  // The umbrella "is a workbook actually open" condition — a project's own single workbook, or a
  // chosen org workbook. Mutually exclusive by construction (`orgMode` already requires no
  // `projectId`), so `storageKey` below is never ambiguous about which one it names.
  const openWorkbook = fileMode || openProject || openOrgWorkbook;
  const storageKey = openProject ? projectId : (openOrgWorkbook ? orgWorkbookId : null);
  const orgWorkbookName = useMemo(
    () => orgWorkbooks.find((w) => w.id === orgWorkbookId)?.name || "Untitled workbook",
    [orgWorkbooks, orgWorkbookId],
  );
  // NEW-1 — the file's own load / debounced save / status. Hands the parsed workbook to the same
  // undo-tracked state the other two modes use; `onFileChanged` re-points the remembered file when a
  // save of an .xls/.csv created its .xlsx copy (or an original opened on its copy).
  const fw = useFileWorkbook({
    fileId: activeFileId, userId, workbook,
    onLoaded: (wb) => { reset(wb); setActiveSheetId(wb.activeSheetId); },
    onFileChanged: (id) => setActiveFile(fileScopeRef.current, id),
  });
  // Declared AFTER `fw` and `fileMode` (a `const` read earlier is a TDZ crash — it took the Spreadsheet down on the live build).
  const shownStatus = fileMode ? fw.status : shownModelStatus(status, diverged);
  // NEW-2 (Univer save path) — the Univer grid hands its edits over after a short debounce, so EVERY way out of it asks the
  // grid to flush first: Export, the grid toggle, hiding the module tab, closing a file, a project / workbook / file change,
  // the page closing. `flushUniver()` is synchronous and idempotent and returns the workbook AS IT IS NOW (the edit included).
  // An URGENT save is also persisted right here, synchronously: React would not render before a closing page dies, and the
  // write-through effect only runs after a render. Same safety net the regular grid has — the stored copy is never staler
  // than the screen — and the same dirty mark, so the next load pushes it (decideLoadSync "push-local"), never a "different copy" bar.
  const univerHandleRef = useRef(null);
  const readyRef = useRef(false); readyRef.current = ready;
  const fwRef = useRef(fw); fwRef.current = fw;
  const univerScope = fileMode ? `file:${fw.loadGen}` : (storageKey ? `${orgMode ? "org" : "project"}:${storageKey}` : "none");
  const scopeRef = useRef(univerScope); scopeRef.current = univerScope;
  const persistUniverNow = useCallback((scope, wb) => {
    if (scope.fileMode) { fwRef.current.noteWorkbookNow(wb, scope.fileId); return true; }
    if (!readyRef.current || !scope.key) return true;
    if (!writeLocalSheet(scope.userId, scope.key, wb)) { setStatus("error"); return false; }
    writeSyncMeta(scope.userId, scope.key, { baseVersion: baseVersionRef.current, dirty: true });
    if (scopeRef.current === scope.id) dirtyRef.current = true;
    return true;
  }, []);
  /** The grid is going away because the project / workbook CHANGED: the regular push effect for the one being left is cancelled by
   *  the change, so start its upload here (best effort — the dirty local copy written above is the net, and the next open of
   *  that workbook pushes it). A failure raises nothing on the badge: the badge now describes the workbook being OPENED. */
  const uploadLeavingUniver = useCallback((scope, wb) => {
    if (!scope.cloud) return;
    const expected = cloudVersionRef.current;
    const p = scope.cloud.projectId
      ? saveCloudSheet({ uid: scope.userId, projectId: scope.cloud.projectId, sheet: wb, expected })
      : saveOrgWorkbookCloud({ uid: scope.userId, id: scope.cloud.orgId, name: scope.cloud.name, sheet: wb, expected });
    Promise.resolve(p).then((r) => {
      if (!r || !r.ok) return;
      const stored = readLocalSheet(scope.userId, scope.key);
      if (stored && sheetsDiverge(stored, wb)) return;   // edited again since — that copy stays dirty and uploads on its own
      writeSyncMeta(scope.userId, scope.key, { baseVersion: r.version, dirty: false });
    }).catch(() => {});
  }, []);
  const reportUniverSaveError = useCallback((err, stage) => {
    setStatus("error");
    setFileNotice({ kind: "error", text: "Your last edit in the new grid could not be saved yet. It will be retried — keep this tab open." });
    import("../../shared/telemetry/clientErrors.js").then((m) => m.reportClientEvent("model-univer-save-failed", String((err && err.message) || err), { stage })).catch(() => {});
  }, []);
  /** Save a workbook the Univer grid just emitted. `scope` is the workbook that grid was SHOWING — a grid that is going away
   *  because the project / file changed must save into the OLD one and never into whatever replaced it. */
  const onUniverChange = (next, _notes, meta) => {
    const scope = {
      id: univerScope, key: storageKey, userId, fileMode, fileId: activeFileId,
      cloud: !fileMode && userId && cloudSettled && !divergedRef.current && statusRef.current !== "not-provisioned"
        ? (openProject ? { projectId } : { orgId: orgWorkbookId, name: orgWorkbookName }) : null,
    };
    if (meta && meta.urgent) {
      if (!persistUniverNow(scope, next)) return;
      if (scopeRef.current !== scope.id) uploadLeavingUniver(scope, next);
    }
    if (scopeRef.current === scope.id) { commit(() => next); if (next.activeSheetId) setActiveSheetId(next.activeSheetId); }
  };
  const flushUniver = useCallback(() => {
    const h = univerHandleRef.current;
    return h ? h.flush({ urgent: true }) : null;   // { workbook, changed, ok } | null (the regular grid is showing)
  }, []);
  // Leaving the workbook the grid is showing (project, org workbook, file) or hiding the tab: flush BEFORE the swap. A layout
  // effect's cleanup runs ahead of every passive effect, including the load effect that replaces the workbook and the file
  // hook's "start uploading what I'm leaving" step — both then see the newest edit.
  useLayoutEffect(() => () => { flushUniver(); }, [univerScope, activeFileId, flushUniver]);
  useEffect(() => { if (!isActive) flushUniver(); }, [isActive, flushUniver]);
  const closeFile = useCallback(async () => {
    flushUniver();
    const ok = await fw.flush();
    if (!ok) return; // the bar already shows why it couldn't save; never close over unsaved edits
    setActiveFile(fileScopeRef.current, null);
  }, [fw, flushUniver]);
  // Leaving Organization (switching tabs elsewhere, or picking a project) always drops back to
  // the workbook list — never carry a stale workbook selection into a context that no longer
  // names it.
  useEffect(() => { if (!orgMode) setOrgWorkbookId(null); }, [orgMode]);
  // The workbook LIST: local cache first (instant, and all a signed-out account has), then
  // reconciled against the cloud (source of truth once reachable) — the same "local first, then
  // reconcile" shape the single-workbook load effect below uses for CONTENT, applied here to the
  // LIST of what exists. A workbook this device created but hasn't synced yet stays in the merged
  // list even if the cloud fetch doesn't (yet) know about it.
  useEffect(() => {
    if (!orgMode) return undefined;
    setOrgWorkbooks(readLocalOrgIndex(userId));
    setOrgListNotice(null);
    let live = true;
    setOrgListLoading(true);
    (async () => {
      const r = await listOrgWorkbooksCloud();
      if (!live) return;
      if (r.ok) {
        // B2671225 — a cached entry the cloud once listed and no longer does was deleted elsewhere: drop it.
        const merged = mergeOrgWorkbookLists(r.rows, readLocalOrgIndex(userId));
        setOrgWorkbooks(merged);
        writeLocalOrgIndex(userId, merged);
      } else if (r.reason === "not-provisioned") {
        setOrgListNotice("Cloud backup for organization workbooks isn't turned on yet — saved on this device only.");
      }
    })().finally(() => { if (live) setOrgListLoading(false); });
    return () => { live = false; };
  }, [orgMode, userId]);

  // NEW-3 — every index op READS the cloud result. The three store functions never throw — they
  // RESOLVE `{ ok:false, reason, error }` — so the old `.catch(() => {})` on each was dead code and
  // the resolved failure was never read: a delete that the cloud refused vanished from the picker
  // and was back on the next visit (the list effect above re-merges cloud rows), a rename held
  // until the next cloud list reverted it, and a create existed on this device only with no notice.
  // `orgCloudOutcome` (lib/orgWorkbookOps.js, unit-tested) is the one decision; the notice lands on
  // the picker (the surface the op was made on) and on the header badge via `status`, the same
  // surface the content push reports through.
  const applyOrgOutcome = useCallback((op, r, id) => {
    const o = orgCloudOutcome(op, r, { id });
    if (o.notice) setOrgListNotice(o.notice);
    if (o.status) setStatus(o.status);
    if (o.telemetry) import("../../shared/telemetry/clientErrors.js").then((m) => m.reportClientEvent(o.telemetry.kind, o.telemetry.message, o.telemetry.extra)).catch(() => {});
    return o;
  }, []);
  // B2584320 — the workbook OPENS only once its first cloud row exists (or the create has said why not). It used to open at
  // once and race the insert: the open-time load ran first, found no row, and left the version unknown — so the first edit's
  // push was an INSERT too and the database refused it as a duplicate (409), and no edit to a new organization workbook ever
  // reached the cloud until the page was reloaded. Opening on the create's answer makes that load find version 1.
  const orgCreatingRef = useRef(false);
  const onOrgCreate = useCallback(async () => {
    if (orgCreatingRef.current) return;
    orgCreatingRef.current = true;
    try {
      const id = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : `wb-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const name = "Untitled workbook";
      const wb = createWorkbook();
      writeLocalSheet(userId, id, wb);
      setOrgWorkbooks(touchLocalOrgIndex(userId, { id, name, updatedAt: Date.now() }));
      if (userId) {
        let r;
        try { r = await saveOrgWorkbookCloud({ uid: userId, id, name, sheet: wb, expected: null }); } catch (e) { r = { ok: false, reason: "error", error: String((e && e.message) || e) }; }
        applyOrgOutcome("create", r, id); // a refusal is still said out loud; the workbook opens on this device either way
      }
      setOrgWorkbookId(id);
    } finally { orgCreatingRef.current = false; }
  }, [userId, applyOrgOutcome]);
  const onOrgOpen = useCallback((id) => setOrgWorkbookId(id), []);
  const onOrgRename = useCallback((id, name) => {
    setOrgWorkbooks(touchLocalOrgIndex(userId, { id, name, updatedAt: Date.now() }));
    if (userId) renameOrgWorkbookCloud(userId, id, name).then((r) => applyOrgOutcome("rename", r, id));
  }, [userId, applyOrgOutcome]);
  // DELETE mirrors deleteSite's "tombstone, ask the server, remove locally only on confirmed
  // removal" rule (site-planner/lib/storage.js): the local index entry is dropped only once the
  // cloud tombstone landed (or the cloud genuinely holds nothing — not-provisioned / unavailable /
  // signed out). On a refusal the row stays in the picker with the notice beside it.
  const onOrgDelete = useCallback(async (id) => {
    const r = userId ? await deleteOrgWorkbookCloud(userId, id) : undefined;
    const o = applyOrgOutcome("delete", r, id);
    if (!o.applyLocal) return;
    setOrgWorkbooks(removeLocalOrgIndexEntry(userId, id));
    setOrgWorkbookId((cur) => (cur === id ? null : cur));
  }, [userId, applyOrgOutcome]);
  const onBackToOrgWorkbooks = useCallback(() => setOrgWorkbookId(null), []);

  /* ---- load: local first (synchronous, always available), then reconcile against the cloud.
   * Local wins whenever it already exists on this device — see the file header for why. Reads
   * `storageKey` (a project id, or an org workbook id — never both, see `openWorkbook` above);
   * the cloud half branches on which one is actually open. */
  useEffect(() => {
    loadTokenRef.current += 1;
    const token = loadTokenRef.current;
    cloudVersionRef.current = null;
    // V537648 — a fresh load re-decides divergence from scratch (a reload of a still-divergent
    // copy re-detects it below, so this never silently forgets an unresolved one).
    divergedRef.current = false;
    divergedCopiesRef.current = null;
    setDiverged(false);
    setStatus("idle");
    setCloudConfirmed(false);
    setCloudSettled(false);
    userEditRef.current = false;
    baseVersionRef.current = null;
    dirtyRef.current = false;
    if (fileMode) return undefined; // NEW-1 — a Library file is open: useFileWorkbook owns the load
    if (!openWorkbook) { const wb = createWorkbook(); reset(wb); setActiveSheetId(wb.activeSheetId); setReady(false); return undefined; }
    const local = readLocalSheet(userId, storageKey);
    // B2450528 — the sync base this device's stored copy carries. No stored copy = a placeholder the
    // write-through is about to write: it is CLEAN (it can never win a fight with the cloud copy).
    const meta0 = local ? readSyncMeta(userId, storageKey) : null;
    if (!local) writeSyncMeta(userId, storageKey, { baseVersion: null, dirty: false });
    baseVersionRef.current = meta0 ? meta0.baseVersion : null;
    dirtyRef.current = !!(meta0 && meta0.dirty);
    const initialWorkbook = local ? migrateWorkbook(local) : createWorkbook();
    reset(initialWorkbook);
    setActiveSheetId(initialWorkbook.activeSheetId);
    setReady(true);
    let live = true;
    /** Show `wb` as the on-screen copy and record the outcome in the sync base. Never a user edit. */
    const adoptWorkbook = (wb, { base, dirty }) => {
      userEditRef.current = false;
      reset(wb);
      setActiveSheetId(wb.activeSheetId);
      baseVersionRef.current = base; dirtyRef.current = dirty;
      writeSyncMeta(userId, storageKey, { baseVersion: base, dirty });
    };
    (async () => {
      let r;
      try { r = openProject ? await loadCloudSheet(projectId) : await loadOrgWorkbookCloud(orgWorkbookId); }
      catch (_) { r = { ok: false, reason: "error" }; }
      if (!live || loadTokenRef.current !== token) return;
      if (r.ok) {
        cloudVersionRef.current = r.version;
        setCloudConfirmed(true);
        // R3 — a workbook made signed-out (scope "local") is adopted once into this account's scope.
        const anon = openProject && userId && !local ? readLocalSheet(null, storageKey) : null;
        const anonWb = anon ? migrateWorkbook(anon) : null;
        const adoption = decideAnonAdoption({ userId, userLocal: local, cloudSheet: r.sheet, cloudOk: true, anonLocal: anon,
          // A never-edited signed-out placeholder is not "a different copy" — it can't hold work.
          diverges: anonWb && r.sheet ? sheetsDiverge(anonWb, migrateWorkbook(r.sheet)) && !isPlaceholderWorkbook(anonWb) : false });
        const editedMeanwhile = dirtyRef.current; // a keystroke landed before the cloud answered
        if (adoption === "adopt") {
          // the write-through + debounced push effects persist it under this account; it is unsynced work
          adoptWorkbook(anonWb, { base: r.version, dirty: true });
          setPushNonce((n) => n + 1);
        } else if (!local && r.sheet && !editedMeanwhile) {
          const cloudWorkbook = migrateWorkbook(r.sheet);
          if (adoption === "diverged") markDiverged({ device: anonWb, cloud: cloudWorkbook, showing: "cloud" });
          adoptWorkbook(cloudWorkbook, { base: r.version, dirty: false });
        } else {
          // Both sides may hold something. "Local wins on load" is only safe when this device's copy is
          // provably newer or equal; otherwise the very next edit would silently overwrite the other copy
          // (a clean CAS bump — nothing raced). Decide from the sync base (lib/modelSyncBase.js), on the
          // workbook as it is NOW (the person may have typed while the cloud was answering).
          // ⛔ V537648 — and DETECTING a divergence is not enough: the debounced push scheduled at mount
          // used to fire anyway. `markDiverged` latches the hold the push body checks at fire time.
          const localNow = workbookRef.current || migrateWorkbook(local);
          const cloudWorkbook = r.sheet ? migrateWorkbook(r.sheet) : null;
          const meta = readSyncMeta(userId, storageKey);
          const verdict = decideLoadSync({
            local: localNow, cloud: cloudWorkbook, cloudVersion: r.version, meta,
            sameContent: cloudWorkbook ? !sheetsDiverge(localNow, cloudWorkbook) : false,
            localIsPlaceholder: isPlaceholderWorkbook(localNow),
          });
          if (verdict.action === "adopt-cloud") adoptWorkbook(cloudWorkbook, { base: r.version, dirty: false });
          else if (verdict.action === "in-sync") { baseVersionRef.current = r.version; dirtyRef.current = false; writeSyncMeta(userId, storageKey, { baseVersion: r.version, dirty: false }); }
          else if (verdict.action === "push-local") { dirtyRef.current = true; baseVersionRef.current = r.version; writeSyncMeta(userId, storageKey, { baseVersion: r.version, dirty: true }); setPushNonce((n) => n + 1); }
          else if (verdict.action === "no-cloud-copy") {
            dirtyRef.current = verdict.dirty;
            writeSyncMeta(userId, storageKey, { baseVersion: null, dirty: verdict.dirty });
            if (verdict.dirty) setPushNonce((n) => n + 1);
          } else markDiverged({ device: localNow, cloud: cloudWorkbook, showing: "device" });
        }
      } else if (r.reason === "not-provisioned") {
        setStatus("not-provisioned");
      }
      setCloudSettled(true);
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, openWorkbook, openProject, projectId, orgWorkbookId, userId, fileMode]);

  /* Write-through local save on every commit — never debounced (the stored copy must never
   * be staler than the screen: a tab close a moment after typing must not lose that edit). */
  const prevFileModeRef = useRef(fileMode);
  useEffect(() => {
    // The commit in which file mode flips still holds the OTHER mode's workbook (the load that swaps it runs in
    // this same pass) — writing it now would put a Library file's cells into the project's slot, or the reverse.
    const flipped = prevFileModeRef.current !== fileMode;
    prevFileModeRef.current = fileMode;
    if (flipped) return;
    if (!ready || !openWorkbook || fileMode) return; // a Library file keeps its own safety copy (lib/fileDraft.js), never the project's slot
    if (!writeLocalSheet(userId, storageKey, workbook)) setStatus("error");
    // B2450528 — a PERSON'S edit (commit/undo/redo — never a load's reset) makes the stored copy dirty:
    // edited since it was last confirmed against the cloud version `baseVersionRef`.
    if (userEditRef.current) {
      userEditRef.current = false;
      dirtyRef.current = true;
      writeSyncMeta(userId, storageKey, { baseVersion: baseVersionRef.current, dirty: true });
    }
  }, [workbook, ready, openWorkbook, storageKey, userId, fileMode]);

  // B2450528 — a push landed: the stored copy is now confirmed against `version`, and clean unless something newer
  // was typed while it was in flight.
  const noteSynced = useCallback((version, pushedWorkbook) => {
    baseVersionRef.current = version;
    if (workbookRef.current === pushedWorkbook) dirtyRef.current = false;
    writeSyncMeta(userId, storageKey, { baseVersion: version, dirty: dirtyRef.current });
  }, [userId, storageKey]);

  /* Best-effort, debounced cloud push through the guarded save path. Reads `status` without
   * depending on it — this must fire only on a WORKBOOK change, not on every status transition
   * the push itself causes (that would restart the debounce on its own "saving" flag).
   * ⛔ V537648 — `runCloudPush` re-asks the gate from REFS when the timer FIRES (see its header). */
  useEffect(() => {
    if (!ready || !openWorkbook || !userId || fileMode) return undefined; // fileMode: the Library file is the save target
    if (status === "not-provisioned") return undefined; // stop hammering a table that isn't there yet
    if (divergedRef.current) return undefined; // V537648 — held until the user picks a copy
    if (!cloudSettled || !dirtyRef.current) return undefined; // B2450528
    clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => {
      runCloudPush({
        readGate: () => ({ status: statusRef.current, diverged: divergedRef.current }),
        save: async () => (openProject
          ? await saveCloudSheet({ uid: userId, projectId, sheet: workbook, expected: cloudVersionRef.current })
          : await saveOrgWorkbookCloud({ uid: userId, id: orgWorkbookId, name: orgWorkbookName, sheet: workbook, expected: cloudVersionRef.current })),
        setStatus,
        onSaved: (version) => {
          cloudVersionRef.current = version; setCloudConfirmed(true);
          noteSynced(version, workbook);
          if (!openProject) setOrgWorkbooks(touchLocalOrgIndex(userId, { id: orgWorkbookId, name: orgWorkbookName, updatedAt: Date.now() }));
        },
      });
    }, CLOUD_PUSH_DEBOUNCE_MS);
    return () => clearTimeout(pushTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workbook, ready, openWorkbook, openProject, projectId, orgWorkbookId, orgWorkbookName, userId, pushNonce, fileMode, cloudSettled]);

  /* V537648 — the ONLY two ways out of a divergence besides opening a different workbook. Both
   * are explicit user choices; neither deletes anything (the copy not chosen is reachable by
   * Ctrl+Z, because the switch is a normal undoable commit, and a signed-out copy is never
   * touched). Releasing the hold re-arms the ordinary push, which still goes through the CAS
   * guard — so if the cloud moved AGAIN in the meantime, that surfaces as a conflict. */
  const releaseDivergence = useCallback(() => {
    divergedRef.current = false;
    divergedCopiesRef.current = null;
    setDiverged(false);
    setStatus("idle");
    setPushNonce((n) => n + 1);
  }, []);
  // B2450528 — the choice is also the new sync base: keeping this device's copy is unsynced work based on the
  // cloud version it was just shown against; using the cloud copy is clean against that same version.
  const onKeepDeviceCopy = useCallback(() => {
    const c = divergedCopiesRef.current;
    if (c && c.showing === "cloud") { commit(c.device); setActiveSheetId(c.device.activeSheetId); }
    baseVersionRef.current = cloudVersionRef.current; dirtyRef.current = true;
    writeSyncMeta(userId, storageKey, { baseVersion: baseVersionRef.current, dirty: true });
    releaseDivergence();
  }, [commit, releaseDivergence, userId, storageKey]);
  const onUseCloudCopy = useCallback(() => {
    const c = divergedCopiesRef.current;
    baseVersionRef.current = cloudVersionRef.current;
    if (c && c.showing === "device") { commit(c.cloud); setActiveSheetId(c.cloud.activeSheetId); dirtyRef.current = true; }
    else dirtyRef.current = false;
    writeSyncMeta(userId, storageKey, { baseVersion: baseVersionRef.current, dirty: dirtyRef.current });
    releaseDivergence();
  }, [commit, releaseDivergence, userId, storageKey]);


  // Excel round-trip (NEW-1, owner chat block) — FileMenu.jsx's four actions. `fileBusy` disables
  // the File button for the duration of an export/import (both are async — ExcelJS's own parse/
  // write is not instant on a real multi-sheet workbook); `fileNotice` is the one LOUD-FAILURE /
  // import-summary line FileMenu renders next to the button, auto-dismissed below. A plain
  // successful EXPORT gets no notice at all (the browser's own download UI is feedback enough,
  // PANEL-BREVITY) — only an IMPORT (which changes what's on screen) or a genuine error does.
  const [fileBusy, setFileBusy] = useState(false);
  const [fileNotice, setFileNotice] = useState(null); // { kind: "warn" | "error", text } | null
  useEffect(() => {
    if (!fileNotice) return undefined;
    const t = setTimeout(() => setFileNotice(null), 9000);
    return () => clearTimeout(t);
  }, [fileNotice]);
  // NEW-1 (owner chat block, 2026-09-05) — Import Excel replaces the WHOLE workbook, and used to
  // do it unconditionally: importing a two-sheet file into a workbook that already had a real
  // Sheet1 silently discarded it, with nothing in the label or the flow saying so (Ctrl+Z recovers
  // it, but that doesn't survive a reload, so it isn't a substitute for asking first). A file is
  // only ever queued here — never read/parsed yet — while `workbookHasContent(workbook)` says the
  // CURRENT workbook has something in it to lose; an empty workbook (a brand-new project, or one
  // nobody has typed into) still imports immediately, no prompt, exactly as before.
  const [pendingXlsxImport, setPendingXlsxImport] = useState(null); // { file, sheetCount } | null

  const currentFileBaseName = useCallback(() => {
    if (fileMode && fw.name) return sanitizeFilename(fw.name.replace(/\.[A-Za-z0-9]+$/, ""));
    if (openOrgWorkbook) return sanitizeFilename(orgWorkbookName);
    let name = "Workbook";
    if (projectId) name = projectNameOf(projectId, "") || name;
    return sanitizeFilename(name);
  }, [projectId, openOrgWorkbook, orgWorkbookName, fileMode, fw.name]);

  /** NEW-2 — what Export writes is the workbook as it is NOW: with the Univer grid showing, an edit still inside its save
   *  debounce is flushed first and read straight from the grid (the React state is a render behind it). null = the flush FAILED
   *  (already reported) — the export must not go ahead with a stale copy. */
  const workbookForExport = useCallback(() => {
    const r = flushUniver();
    if (!r) return workbook;
    if (!r.ok || !r.workbook) { setFileNotice({ kind: "error", text: "Export stopped: the latest edit in the new grid could not be saved first. Try again in a moment." }); return null; }
    return r.workbook;
  }, [flushUniver, workbook]);

  const onExportXlsx = useCallback(async () => {
    setFileBusy(true);
    try {
      const wbNow = workbookForExport();
      if (!wbNow) return;
      // NEW-1 — Univer's engine computes the numbers that go into the file (main thread; the writer runs in a worker).
      const { evaluateForExport } = await import("./lib/univerEval.js");
      const evaluated = await evaluateForExport(wbNow, { projectNames });
      const blob = await exportWorkbookInWorker(evaluated.workbook, { projectNames, evaluated });
      downloadBlob(blob, `${currentFileBaseName()}.xlsx`);
      const note = [planyrSyntaxNote(evaluated.rewritten), circularNotice(evaluated.circular)].filter(Boolean).join(" ");
      if (note) setFileNotice({ kind: "warn", text: `Exported. ${note}` });
    } catch (e) {
      setFileNotice({ kind: "error", text: `Export to Excel failed: ${e?.message || e}` });
    } finally { setFileBusy(false); }
  }, [workbookForExport, currentFileBaseName, projectNames]);

  const onExportCsv = useCallback(async () => {
    try {
      const wbNow = workbookForExport();
      if (!wbNow) return;
      // NEW-1 — the numbers in the CSV are Univer's (the same engine that draws the grid and fills the Excel file), computed from the
      // flushed workbook, whichever grid is showing.
      const { evaluateForExport } = await import("./lib/univerEval.js");
      const ev = await evaluateForExport(wbNow, { projectNames });
      const entry = ev.workbook.sheets.find((e) => e.id === activeSheetId) || activeSheetEntry(ev.workbook);
      const csv = sheetToCsv(entry.sheet, evalFromPlain(ev.values).get(entry.id));
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      downloadBlob(blob, `${sanitizeFilename(entry.name)}.csv`);
      const note = circularNotice(ev.circular);
      if (note) setFileNotice({ kind: "warn", text: `Exported. ${note}` });
    } catch (e) {
      setFileNotice({ kind: "error", text: `Export to CSV failed: ${e?.message || e}` });
    }
  }, [workbookForExport, activeSheetId, projectNames]);

  const runXlsxImport = useCallback(async (file) => {
    setFileBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const { workbook: imported, unsupportedCount } = await parseSpreadsheetInWorker(buf, file.name);
      commit(imported);
      setActiveSheetId(imported.activeSheetId);
      setFileNotice({
        kind: "warn",
        text: unsupportedCount > 0
          ? `Imported "${file.name}" — ${unsupportedCount} formula${unsupportedCount === 1 ? "" : "s"} used an unsupported function and were kept as values (hover the marked cells). Ctrl+Z undoes the import.`
          : `Imported "${file.name}". Ctrl+Z undoes the import.`,
      });
    } catch (e) {
      // NEW-2 (owner chat block, 2026-09-05) — xlsxIO.js's own importXlsxToWorkbook already turns
      // any raw ExcelJS/JSZip failure into one plain sentence before it ever reaches here (see its
      // header), so `e.message` is always safe to show verbatim now — never string-built from a
      // dependency's own developer-facing text.
      setFileNotice({ kind: "error", text: e?.message || `Could not read “${file.name}” as an Excel file.` }); // SpreadsheetFileError messages already name the file
    } finally { setFileBusy(false); }
  }, [commit]);

  const onImportXlsxFile = useCallback((file) => {
    // "Does this workbook have anything in it?" must be asked of what is ON SCREEN. With the Univer grid showing, an edit made in the last few hundred
    // ms is still inside its save debounce and not yet in `workbook`, so a quick File ▾ → Import would replace it without asking. `flushUniver()` hands
    // over the grid's workbook as it is NOW (null when the regular grid shows).
    const shown = (flushUniver() || {}).workbook || workbook;
    if (workbookHasContent(shown)) { setPendingXlsxImport({ file, sheetCount: shown.sheets.length }); return; }
    runXlsxImport(file);
  }, [workbook, runXlsxImport, flushUniver]);

  const onConfirmXlsxImport = useCallback(() => {
    const pending = pendingXlsxImport;
    setPendingXlsxImport(null);
    if (pending) runXlsxImport(pending.file);
  }, [pendingXlsxImport, runXlsxImport]);

  const onCancelXlsxImport = useCallback(() => setPendingXlsxImport(null), []);

  // NEW-1 — the file's untouched first upload (the oldest stored version), straight to disk.
  const onDownloadOriginal = useCallback(async () => {
    setFileBusy(true);
    try {
      const got = await fw.downloadOriginal();
      if (!got) { setFileNotice({ kind: "error", text: "Couldn’t read the original upload from your Library. Check your connection and try again." }); return; }
      downloadBlob(got.blob, got.name);
    } catch (e) {
      setFileNotice({ kind: "error", text: `Couldn’t download the original: ${e?.message || e}` });
    } finally { setFileBusy(false); }
  }, [fw]);

  // NEW-1 — "Open Excel or CSV file…": the in-module door to the SAME place a Library click lands. The
  // file is FILED in the Library under this project (or the Organization) first — one document, never a
  // disconnected import — and then opened from there.
  const onOpenFileFromComputer = useCallback(async (file) => {
    if (!file) return;
    if (!spreadsheetKindOf(file.name)) { setFileNotice({ kind: "error", text: `“${file.name}” isn’t an Excel or CSV file. Choose a .xlsx, .xls or .csv file.` }); return; }
    if (!orgMode && !(openProject && projectId)) { setFileNotice({ kind: "error", text: "Open a project (or switch to the Organization) first — the file is saved in its Library." }); return; }
    setFileBusy(true);
    try {
      const { fileNewReview } = await import("../doc-review/lib/reviewStore.js");
      const res = await fileNewReview({
        projectId: orgMode ? null : projectId, project: orgMode ? "" : (projectNameOf(projectId, "") || ""),
        discipline: "Other", orgScope: orgMode, blob: file, fileName: file.name,
      });
      if (!res.ok || res.uploadFailed) {
        setFileNotice({ kind: "error", text: `Couldn’t save “${file.name}” to your Library: ${res.error || res.driveError || "check your connection and that you’re signed in"}.` });
        return;
      }
      setActiveFile(fileScopeRef.current, res.id);
    } catch (e) {
      setFileNotice({ kind: "error", text: `Couldn’t open “${file.name}”: ${e?.message || e}` });
    } finally { setFileBusy(false); }
  }, [orgMode, openProject, projectId]);

  const onImportCsvFile = useCallback(async (file) => {
    setFileBusy(true);
    try {
      const text = await file.text();
      const desiredName = file.name.replace(/\.csv$/i, "") || "Imported";
      const next = addSheetFromCsvText(workbook, text, desiredName);
      commit(next);
      setActiveSheetId(next.activeSheetId);
      setFileNotice({ kind: "warn", text: `Imported "${file.name}" as a new sheet. Ctrl+Z undoes the import.` });
    } catch (e) {
      // NEW-2's "check the CSV path too" (owner chat block): csvIO.js's parser is hand-rolled with
      // no dependency to leak a developer-facing error out of (parseCsv never throws — any bytes
      // decode to SOME set of rows/cells; `file.text()` reading a real File object doesn't throw
      // either). Nothing here composes a library's own internal message, so this is left as is.
      setFileNotice({ kind: "error", text: `Could not read "${file.name}" as CSV: ${e?.message || e}` });
    } finally { setFileBusy(false); }
  }, [workbook, commit]);
  const projectName = useProjectName(projectId, ""); // shared/names — the one live source
  const currentProject = projectId ? { id: projectId, name: projectName || "Untitled project" } : null;

  return (
    <div data-testid="model-root" style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--surface-page)" }}>
      <AppHeader
        module={shellModule || "model"}
        onSwitch={onShellSwitch}
        onDashboard={onGoDashboard}
        currentProject={currentProject}
        cross={crossProject}
        // ORG SCOPE (NEW-1) — passed through like every other org-capable workspace; the
        // breadcrumb reads "Organization" (never a blank/half-built crumb) while `currentProject`
        // stays null, matching Notes/Library/Scheduler's own treatment exactly.
        org={org}
        onSelectProject={(id) => onNavigate?.({ projectId: id, cross: false, org: false })}
        onNewProject={onNewProject}
        onSelectOrg={onSelectOrg}
        authControl={authControl}
        accountActive={accountActive}
        saveState={openWorkbook ? modelSaveState(shownStatus, accountActive, fileMode ? fw.cloudConfirmed : cloudConfirmed) : null}
        saveDetail={
          shownStatus === "not-provisioned" ? "Cloud backup for Spreadsheet isn't turned on yet — saved on this device only."
          : shownStatus === "conflict" ? (fileMode ? "This file was changed somewhere else — use “Show the Library’s version” in the bar above the sheet (your edits here are kept on this device)." : "This spreadsheet changed elsewhere — reload to see the latest (your edits here stayed on this device).")
          : shownStatus === "diverged" ? "This spreadsheet has different content saved from another device or browser. Nothing is being saved to the cloud until you choose which copy to keep, using the bar above the sheet."
          : undefined
        }
        multiEditOk
        // STAGE 2 ICONOGRAPHY PASS — Undo/Redo moved OUT of row 1 and into the Ribbon's own
        // leading "Actions" group (icon buttons, matching Google Sheets' own toolbar, where
        // Undo/Redo open the row rather than living in a separate header bar). Row 1 carries the
        // Excel round-trip File menu (NEW-1) — since there's no workbook to export/import before
        // a project is open — plus, since this pass, the module's OWN differentiators
        // (NEW-1, command palette): Trace Precedents/Dependents/Remove Arrows + the
        // Inconsistencies toggle now have a PERMANENT, always-visible home here rather than
        // riding the Home ribbon's own width-aware collapse (lib/ribbonLayout.js no longer lists
        // an "audit" group at all — see its header). `AuditGroup` is the SAME component/buttons/
        // testids Stage 3 shipped, just reused from a different call site with the same `ctx`.
        toolbarContent={openWorkbook ? (
          <>
            {/* ORG SCOPE (NEW-1) — the one door back to the workbook list; a project's own
                single workbook has no list to return to, so this never renders there. */}
            {openOrgWorkbook && (
              <button
                type="button"
                data-testid="org-workbook-back"
                onClick={onBackToOrgWorkbooks}
                title="Back to your organization's workbook list"
                style={{ height: 30, padding: "0 10px", borderRadius: RADIUS.md, border: "1px solid var(--chrome-divider)", background: "var(--chrome-bg-elev)", color: "var(--chrome-text)", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
              >‹ Workbooks</button>
            )}
            <FileMenu
              ref={fileMenuRef}
              busy={fileBusy}
              notice={fileNotice}
              confirmReplace={pendingXlsxImport ? {
                text: `Replace this workbook's ${pendingXlsxImport.sheetCount} sheet${pendingXlsxImport.sheetCount === 1 ? "" : "s"} with "${pendingXlsxImport.file.name}"?`,
                onConfirm: onConfirmXlsxImport,
                onCancel: onCancelXlsxImport,
              } : null}
              onExportXlsx={onExportXlsx}
              onExportCsv={onExportCsv}
              onImportXlsxFile={onImportXlsxFile}
              onImportCsvFile={onImportCsvFile}
              onOpenFile={onOpenFileFromComputer}
            />
          </>
        ) : undefined}
      />

      {openWorkbook && fileMode && fw.phase === "error" ? (
        <FileProblem
          message={fw.error?.message || "This file couldn’t be opened."}
          canRetry={["download", "timeout", "error", "worker"].includes(fw.error?.code)}
          onRetry={fw.retryOpen}
          onClose={() => setActiveFile(fileScopeRef.current, null)}
        />
      ) : openWorkbook && fileMode && fw.phase !== "ready" ? (
        <FileLoading name={fw.name} />
      ) : openWorkbook ? (
        <>
          {fileMode && (
            <>
              <FileBar
                name={fw.name}
                inPlace={fw.inPlace}
                saving={fw.status === "saving"}
                saveError={fw.saveError}
                conflict={fw.status === "conflict"}
                hasOriginal={fw.hasOriginal}
                onDownloadOriginal={onDownloadOriginal}
                onClose={closeFile}
                onRetry={fw.retrySave}
                onReload={fw.reloadFromLibrary}
              />
              <FileNotes notes={fw.notes} fileKey={activeFileId} />
            </>
          )}
          {diverged && (
            <DivergedBar
              showing={divergedCopiesRef.current?.showing || "device"}
              onKeepDevice={onKeepDeviceCopy}
              onUseCloud={onUseCloudCopy}
            />
          )}
          {!(calcReady && gridWorkbookReady) ? (
            <div role="status" style={{ flex: 1, display: "grid", placeItems: "center", fontSize: 12, color: "var(--text-secondary)" }}>Loading the spreadsheet…</div>
          ) : (
            // The Univer grid — its own toolbar, formula bar, grid and sheet tabs. Edits come back as a whole Planyr workbook through the
            // SAME `commit` (and so the same write-through, cloud push, file-mode save and undo frame) as every other edit — persistence is
            // not touched.
            <Suspense fallback={<div role="status" style={{ flex: 1, display: "grid", placeItems: "center", fontSize: 12, color: "var(--text-secondary)" }}>Loading the spreadsheet…</div>}>
              <UniverSheet
                key={univerScope}
                workbook={workbook}
                projectNames={projectNames}
                viewKey={viewPrefsKey}
                onChange={onUniverChange}
                onNotice={showNotice}
                onError={reportUniverSaveError}
                onReady={(h) => { univerHandleRef.current = h; }}
              />
            </Suspense>
          )}
          {notice && (
            <div
              role="status" data-testid="model-notice"
              style={{ position: "fixed", left: "50%", bottom: 48, transform: "translateX(-50%)", zIndex: 65, maxWidth: "calc(100vw - 32px)", padding: "6px 12px", background: "var(--surface-raised)", color: "var(--text-primary)", border: "1px solid var(--border-strong)", borderRadius: RADIUS.md }}
            >{notice}</div>
          )}
        </>
      ) : orgMode ? (
        // ORG SCOPE (NEW-1) — Organization holds SEVERAL workbooks (unlike a project's one), so
        // this is the list to choose from before the grid above has anything to show.
        <OrgWorkbookPicker
          workbooks={orgWorkbooks}
          loading={orgListLoading}
          notice={orgListNotice}
          onOpen={onOrgOpen}
          onCreate={onOrgCreate}
          onRename={onOrgRename}
          onDelete={onOrgDelete}
        />
      ) : (
        <EmptyProjectState onGoDashboard={onGoDashboard} />
      )}
    </div>
  );
}
