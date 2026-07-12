/* FileBrowser — the Library workspace's main surface (was the Document Review landing
 * surface before file browsing moved into its own Library tab).
 *
 * The old flat chip row jammed three axes (what kind / what state / how used) into one
 * list, so nothing nested. Today's shape (B697/B699/B700/B702 refactor):
 *   • a FOLDER TREE (left, folder mode) or CATEGORY TREE (cross-project) — the one true
 *     hierarchy. Selecting a folder filters the list; dropping onto a folder row files
 *     straight into it.
 *   • a TOOLBAR — type-to-filter search (name / sheet number / sheet title), a sort
 *     control, upload pickers, and the loud Needs-filing count. (The old All / On the
 *     map / Reference facet chips are gone — per-file badges carry those facts.)
 *   • a badged FILE LIST — each row shows its subcategory / state / on-map badge.
 *   • the WHOLE PANE is the drop target (drop-anywhere overlay; no separate drop card).
 *     A PDF reads its own title block and files itself; no-match → Needs filing for a
 *     one-click confirm. Nothing auto-guesses a project (misfiled is worse than unfiled).
 *
 * Counts + the tree are metadata-only queries (listReviews + listFileFacts); file bytes
 * load only when a file is opened. Reuses the existing reviewStore / uploadQueue plumbing.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchProjects, fetchReviews, fetchFileFacts, fileNewReview, refileReview,
  upsertFileFacts, deleteReview, restoreReview, purgeReview, listDeletedReviews,
  purgeExpiredDeleted, loadReview, getShareLink, DISCIPLINES,
  downloadFromDrive, downloadSource,
} from "../../doc-review/lib/reviewStore.js";
import { toFactsRow, mergeFactsIntoReviews } from "../../doc-review/lib/fileIndex.js";
import { fileWarn } from "../../doc-review/lib/sourceState.js";
import { buildFilingPlan } from "../../../shared/files/disciplineSplit.js";
import { splitPdfByPlan } from "../../doc-review/lib/pdfSplit.js";
import {
  buildFileFacts, deriveTree, browseFiles, holdingArea, CATEGORIES,
  categoryOf, subcategoryOf, stateOf, FILE_STATES, onMap, isReference, isSpatial,
  searchFiles, sortFiles, SORTS,
} from "../../../shared/files/fileFacts.js";
import {
  resolveDrawingTarget, subtreeIds, displayLabel, matchDropPathToFolder,
} from "../../../shared/folders/folderTree.js";
import { moveDriveFileToFolder } from "../lib/folders.js";
import {
  QUEUE_STATUS, makeQueueItems, splitQueue, runPool,
  dropItemsToEntries, flattenEntries, partitionAccepted, isPdfName, fileRelDirs,
} from "../../../shared/files/uploadQueue.js";
import { loadIdSet, saveIdSet } from "../../../shared/ui/persistedSet.js";

// Cross-project category tree: remembered set of OPEN categories (default: all collapsed).
// Category names are stable canonical labels, so one shared key works across sessions.
const CATS_OPEN_KEY = "planyr:library:catsOpen:v1";

// Remembered file-list sort (one key — the preference is a habit, not per-project).
const SORT_KEY = "planyr:library:sort:v1";

// Is this drag carrying OS files (vs. a text/element drag we must ignore)?
const hasFilesDrag = (e) => Array.from(e.dataTransfer?.types || []).includes("Files");

const fmtDate = (f) => { const s = f.docDate || f.updatedAt; try { return s ? new Date(s).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : ""; } catch (_) { return ""; } };

// ---- small styled atoms (theme tokens only — WCAG AA in light + dark) ----
const Badge = ({ children, tone = "neutral", title }) => {
  const tones = {
    neutral: { bg: "var(--hover-ghost)", fg: "var(--text-secondary)", bd: "var(--border-default)" },
    map: { bg: "rgba(34,197,94,0.14)", fg: "var(--success-text, #15803d)", bd: "rgba(34,197,94,0.4)" },
    ref: { bg: "var(--hover-ghost)", fg: "var(--text-tertiary)", bd: "var(--border-default)" },
    old: { bg: "var(--hover-ghost)", fg: "var(--text-tertiary)", bd: "var(--border-default)" },
  }[tone] || {};
  return (
    <span title={title} style={{ flex: "none", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.03em",
      textTransform: "uppercase", padding: "1px 6px", borderRadius: 5, lineHeight: 1.5,
      background: tones.bg, color: tones.fg, border: `1px solid ${tones.bd}` }}>{children}</span>
  );
};

const FileTypeIcon = ({ kind }) => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none", color: "var(--text-tertiary)" }}>
    {kind === "stitch"
      ? <><rect x="2" y="3" width="5.5" height="10" rx="1" /><rect x="8.5" y="3" width="5.5" height="10" rx="1" /></>
      : <><path d="M4 1.7h5l3 3v9.6H4z" /><path d="M9 1.7v3h3" /></>}
  </svg>
);

export default function FileBrowser({
  projectId = null, projectName = "", signedIn = false, cross = false, isActive = true,
  onOpenReview, onNavigate, indexProvider = null,
  /* Unified Library (B650 follow-on) — "folder mode": the left column shows the project's REAL
   * folder tree (the `folderRail` node, a FolderTree) instead of the derived category tree, and
   * the file list filters to the selected folder's subtree. Files place by the SAME resolver the
   * server files uploads with (Design → Drawings → discipline → Current/Archive), so what you
   * see on screen is where the bytes go in Drive. Cross-project browsing keeps the classic
   * category tree (a folder tree is per-project). */
  folderMode = false, folderRail = null, folderRows = [], selectedFolderId = null, onFolderCounts = null,
  // Library-Home pins: which file (review) ids are pinned + the ☆ toggle (both optional).
  pinnedFileIds = null, onTogglePinFile = null,
  /* Folder-row drops (B699): the FolderTree rail lives in the parent, so it registers a
   * callback here — `registerTreeDrop(fn)` hands the rail a way to route a drop event
   * into THIS browser's ingest pipeline; `treeDragTarget` is the folder label currently
   * hovered by a drag (keeps the drop-overlay pill honest). */
  registerTreeDrop = null, treeDragTarget = null,
  // Bumped by the parent on EVERY rail click (even re-selecting the same folder) so the
  // browser can clear search/holding — a rail click must never look dead.
  navTick = 0,
}) {
  const [projects, setProjects] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [busy, setBusy] = useState(false);
  const [node, setNode] = useState({ category: null, subcategory: null }); // selected tree node (null = all)
  const [showHolding, setShowHolding] = useState(false);   // "Needs filing" view active
  const [showSuperseded, setShowSuperseded] = useState(false);
  const [openCats, setOpenCats] = useState(() => loadIdSet(CATS_OPEN_KEY)); // Set of open categories
  const [searchQ, setSearchQ] = useState("");               // type-to-filter (B702)
  const [sort, setSort] = useState(() => { try { return localStorage.getItem(SORT_KEY) || "recency"; } catch (_) { return "recency"; } });
  const [dropOver, setDropOver] = useState(false);
  const [queue, setQueue] = useState([]);
  const [refileSel, setRefileSel] = useState({});          // fileId -> { category, discipline }
  const [pendingDel, setPendingDel] = useState(null);
  const [share, setShare] = useState({});                  // fileId -> { status, url, error }
  const [delNotice, setDelNotice] = useState(null);        // { orphaned } after a delete left bytes behind
  const [loadNotice, setLoadNotice] = useState(null);      // a refresh FAILED — keeping the last loaded list (NEW-F5)
  const [deletedRows, setDeletedRows] = useState([]);      // soft-deleted reviews (NEW-F3 Recently deleted)
  const [showDeleted, setShowDeleted] = useState(false);   // "Recently deleted" view active
  const [pendingPurge, setPendingPurge] = useState(null);  // two-click arm for "Delete forever"
  const [undoDel, setUndoDel] = useState(null);            // { id, title } — ~10s undo toast after a delete
  const undoTimer = useRef(null);
  const [moveNotice, setMoveNotice] = useState(null);      // refile moved metadata but not the Drive copy (B662 #3)
  const [folderNote, setFolderNote] = useState(null);      // { filed, skipped } after a FOLDER drop/pick (B664)
  const [dlNotice, setDlNotice] = useState(null);          // { name, busy?, error? } for a non-PDF download (B685)
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const reqRef = useRef(0);
  // Whole-pane drop target (B699): a DEPTH COUNTER, not a naive dragleave — entering any
  // child fires enter/leave pairs, and the naive `currentTarget === target` check made the
  // highlight flicker. The counter only clears when every enter has matched a leave.
  const dragDepth = useRef(0);

  // ANY folder-rail click exits the "Needs filing" view AND an active search (parity with
  // the classic tree — clicking a folder means "show me that folder"; leaving a search in
  // place would make the click look dead, since a query overrides the folder filter).
  // Keyed on the parent's click COUNTER, not the selected id, so re-clicking the
  // already-selected folder (or "All files") also clears — never a dead click.
  useEffect(() => {
    if (!navTick || !folderMode) return;
    setShowHolding(false); setSearchQ(""); setShowDeleted(false);
  }, [navTick, folderMode]);

  // Any navigation (tree click, search, holding view) exits the Recently-deleted view — its
  // list ignores those filters, so leaving it up would make the click look dead. `node` is a
  // fresh object on every tree click, so re-filtering always fires this.
  useEffect(() => { setShowDeleted(false); }, [node, showHolding, searchQ, selectedFolderId]);

  // A cancelled drag (Esc, or an OS-file drag released outside the window — which fires
  // NO drop/dragend in the page) would strand the depth counter above zero and pin the
  // overlay on; so would an element unmounting under the cursor mid-drag (its dragleave
  // never fires). Reset on window-level drag end / drop, AND when the drag leaves the
  // window itself (dragleave with no relatedTarget) — the counter self-heals (B699).
  useEffect(() => {
    const reset = () => { dragDepth.current = 0; setDropOver(false); };
    const onWinLeave = (e) => { if (e.relatedTarget == null) reset(); };
    window.addEventListener("dragend", reset);
    window.addEventListener("drop", reset);
    window.addEventListener("dragleave", onWinLeave);
    return () => {
      window.removeEventListener("dragend", reset);
      window.removeEventListener("drop", reset);
      window.removeEventListener("dragleave", onWinLeave);
    };
  }, []);

  const refresh = async () => {
    if (!signedIn) return;
    const tok = ++reqRef.current;
    setBusy(true);
    try {
      const [p, r, ff, dead] = await Promise.all([fetchProjects(), fetchReviews(), fetchFileFacts(), listDeletedReviews()]);
      if (tok !== reqRef.current) return;
      // NEW-F5: a FAILED read keeps the previous list — a network blip must never render the
      // "no files" empty state ("all my drawings are gone" panics a user into re-uploading,
      // which is exactly the same-name collision trap NEW-F1 closes). Loud notice + Retry.
      if (p.ok) setProjects(p.rows);
      if (r.ok && ff.ok) setReviews(mergeFactsIntoReviews(r.rows, ff.rows));
      setDeletedRows(dead);
      const failed = [r, ff, p].find((x) => !x.ok);
      setLoadNotice(failed ? { error: failed.error || "Couldn't refresh." } : null);
      // NEW-F3: lazy 30-day purge of expired Recently-deleted items — best-effort, silent on
      // success, loud on failure; a successful purge re-reads the (now shorter) deleted list.
      purgeExpiredDeleted().then((res) => {
        if (!res) return;
        if (!res.ok) setDelNotice((n) => n || { purgeFailed: true });
        else if (res.purged > 0) listDeletedReviews().then((d2) => { if (tok === reqRef.current) setDeletedRows(d2); });
      }).catch(() => {});
    } finally { if (tok === reqRef.current) setBusy(false); }
  };
  // Keep-alive: the browser stays mounted while hidden, so returning to the Library tab
  // revalidates the (cheap, token-guarded) file index instead of showing a stale list.
  // A hidden browser skips the fetch; the next activation runs it.
  useEffect(() => { if (isActive) refresh(); }, [signedIn, isActive]); // eslint-disable-line react-hooks/exhaustive-deps

  const projName = (id) => (projects.find((p) => p.id === id) || {}).name || projectName || "";

  // Project-scoped facts (or all, in cross-project mode). Metadata only.
  const facts = useMemo(() => {
    const all = buildFileFacts(reviews);
    if (cross) return all;
    return all.filter((f) => f.projectId === projectId);
  }, [reviews, projectId, cross]);

  const tree = useMemo(() => deriveTree(facts, { includeSuperseded: showSuperseded }), [facts, showSuperseded]);
  const holding = useMemo(() => holdingArea(facts), [facts]);
  const filed = useMemo(() => facts.filter((f) => stateOf(f) !== FILE_STATES.NEEDS_FILING).length, [facts]);

  // Folder mode: place every filed fact into the real tree (superseded → 02. Archive) — one
  // map fact.id → folder row id, feeding both the list filter and the rail's rolled-up counts.
  const placedFolder = useMemo(() => {
    if (!folderMode || !folderRows.length) return new Map();
    const byId = new Map(folderRows.map((r) => [r.id, r]));
    const m = new Map();
    for (const f of facts) {
      if (stateOf(f) === FILE_STATES.NEEDS_FILING) continue; // holding-area files aren't in the tree
      // Explicit folder pick wins (B686): the file sits in the folder the user dropped it into,
      // overriding the discipline-derived placement (as long as that folder still exists).
      if (f.folderId && byId.has(f.folderId)) { m.set(f.id, f.folderId); continue; }
      const t = resolveDrawingTarget(folderRows, f.discipline, { archive: stateOf(f) === FILE_STATES.SUPERSEDED });
      if (t) m.set(f.id, t.row.id);
    }
    return m;
  }, [folderMode, folderRows, facts]);

  // Rolled-up per-folder counts (a parent counts everything under it); null key = total filed.
  useEffect(() => {
    if (!folderMode || !onFolderCounts) return;
    const byId = new Map(folderRows.map((r) => [r.id, r]));
    const counts = new Map([[null, filed]]);
    for (const folderId of placedFolder.values()) {
      let cur = byId.get(folderId);
      let guard = 0;
      while (cur && guard++ <= byId.size) {
        counts.set(cur.id, (counts.get(cur.id) || 0) + 1);
        cur = cur.parentId != null ? byId.get(cur.parentId) : null;
      }
    }
    onFolderCounts(counts);
  }, [folderMode, onFolderCounts, placedFolder, folderRows, filed]);

  const query = searchQ.trim();
  const shown = useMemo(() => {
    // An active search runs over EVERYTHING in scope — folder selection, the holding view,
    // and the superseded filter are all ignored so a match is never hidden (the B235 rule:
    // "never hidden by a collapsed container"); badges say what state each match is in.
    if (query) return sortFiles(searchFiles(facts, query), sort);
    if (showHolding) return holding; // the to-do queue keeps its own upload-time order
    if (folderMode) {
      // Archive folders ARE the superseded view, so the list always includes superseded files —
      // they surface under 02. Archive (and carry their badge everywhere else).
      const list = browseFiles(facts, { includeSuperseded: true });
      if (selectedFolderId == null) return sortFiles(list, sort);
      const allowed = subtreeIds(folderRows, selectedFolderId);
      return sortFiles(list.filter((f) => allowed.has(placedFolder.get(f.id))), sort);
    }
    return sortFiles(browseFiles(facts, { ...node, includeSuperseded: showSuperseded }), sort);
  }, [facts, node, query, sort, showHolding, showSuperseded, holding, folderMode, selectedFolderId, folderRows, placedFolder]);

  // ---- drop / file pipeline ------------------------------------------------
  const patchItem = (uploadId, patch) => setQueue((q) => q.map((it) => (it.uploadId === uploadId ? { ...it, ...patch } : it)));
  const removeItem = (uploadId) => setQueue((q) => q.filter((it) => it.uploadId !== uploadId));

  // File one blob as a review + its facts row. Returns the fileNewReview result (or null on fail).
  // `folderId` (B686) files the bytes into an explicitly-picked tree folder (Drive + on-screen).
  // `onProgress(sent,total)` surfaces the chunked upload's byte progress in the tray (B409).
  const fileOne = async ({ pid, discipline, item_, docDate, blob, fileName, facts, needsFiling, folderId = null, onProgress = null }) => {
    const r = await fileNewReview({ projectId: pid, project: pid ? projName(pid) : "", discipline, item: item_, docDate, blob, fileName, folderId, onProgress });
    if (!r || !r.ok) return r || null;
    const factsIn = facts ? { ...facts } : { discipline, item: item_, docDate };
    factsIn.projectId = pid; factsIn.discipline = discipline; factsIn.item = item_; factsIn.needsFiling = needsFiling;
    try { await upsertFileFacts(toFactsRow(factsIn, { id: r.id, reviewId: r.id, sourceFile: fileName })); } catch (_) { /* index is best-effort */ }
    return r;
  };

  const processItem = async (item, targetFolderId = null, { forceNeedsFiling = false } = {}) => {
    patchItem(item.uploadId, { status: QUEUE_STATUS.PROCESSING, error: null, warn: null, progress: null });
    // Byte progress from the chunked Drive upload (B409) → the row's progress bar. A 125 MB
    // set uploads for minutes; a bar beats an inscrutable spinner for that long.
    const onProgress = (sent, total) => patchItem(item.uploadId, { progress: total ? Math.min(1, sent / total) : null });
    try {
      // The file came from a dropped subfolder that matches NO tree folder (B699): the user's
      // own structure is the routing signal here, and it points nowhere we know — so it needs
      // a human decision, not a title-block guess. Straight to the holding area.
      if (forceNeedsFiling) {
        const pid = cross ? null : projectId;
        const r = await fileOne({ pid, discipline: "Other", item_: "", docDate: null, blob: item.file, fileName: item.name, facts: null, needsFiling: true, onProgress });
        if (!r || !r.ok) { patchItem(item.uploadId, { status: QUEUE_STATUS.FAILED, error: (r && r.error) || "Couldn’t file." }); return; }
        const warn = fileWarn({ oversize: r.oversize, uploadFailed: r.uploadFailed, driveError: r.driveError, large: r.large });
        patchItem(item.uploadId, { status: QUEUE_STATUS.NEEDS_FILING, reviewId: r.id, filedAt: Date.now(), warn, target: "Needs filing" });
        return;
      }

      // Explicit folder pick (B686): the user dropped while viewing a specific folder → that folder
      // WINS over auto-filing, for any file type. File straight into it — no title-block read, no
      // discipline guess, and never "needs filing" (they told us exactly where it goes).
      if (targetFolderId && projectId) {
        const folder = folderRows.find((r) => r.id === targetFolderId);
        // Case-preserving label, normalized onto the canonical discipline list when it
        // matches one ("05. Civil" → "Civil", never "civil" — a lowercased discipline
        // slips past DRAWING_DISCIPLINES/classifyDocClass and mis-categorizes the file).
        const rawLabel = (folder && displayLabel(folder.name)) || "Other";
        const discipline = DISCIPLINES.find((d) => d.toLowerCase() === rawLabel.toLowerCase()) || rawLabel;
        const r = await fileOne({ pid: projectId, discipline, item_: "", docDate: null, blob: item.file, fileName: item.name, facts: { discipline }, needsFiling: false, folderId: targetFolderId, onProgress });
        if (!r || !r.ok) { patchItem(item.uploadId, { status: QUEUE_STATUS.FAILED, error: (r && r.error) || "Couldn’t file." }); return; }
        const warn = fileWarn({ oversize: r.oversize, uploadFailed: r.uploadFailed, driveError: r.driveError, large: r.large });
        patchItem(item.uploadId, { status: QUEUE_STATUS.DONE, reviewId: r.id, filedAt: Date.now(), warn, target: folder ? displayLabel(folder.name) : projName(projectId) });
        return;
      }

      // Only PDFs carry a readable title block (B685). Non-PDFs (DWG, images, spreadsheets…) are
      // stored as-is: skip the auto-file read entirely — it would just spin up pdf.js to fail — and
      // file the bytes directly (under the project when we're in one; to the holding area otherwise).
      const isPdf = isPdfName(item.file || item.name);
      let route = null;
      if (isPdf && indexProvider && indexProvider.autofileReady && indexProvider.autofile) {
        try { const a = await indexProvider.autofile(item.file, projects); if (a && a.ok) route = a; } catch (_) { route = null; }
      }
      const decision = route ? route.decision : null;
      // We're inside a project → file into it (an explicit act, never a guess). In cross
      // mode, only a confident title-block match routes; else it goes to the holding area.
      const pid = cross ? (decision && decision.matched ? decision.projectId : null) : projectId;
      const docDate = decision ? decision.docDate : null;

      // Multi-discipline set → SPLIT the bytes into one clean PDF per discipline and file each in
      // its own folder (owner decision 2026-06-23). Falls back to single-file filing if the byte
      // split can't run, so behaviour is never worse than before.
      if (decision && decision.multiDiscipline && (decision.sets || []).length > 1) {
        const split = { multiDiscipline: true, standaloneSets: decision.sets, sets: decision.sets, dominant: { discipline: decision.discipline, item: decision.item } };
        const plan = buildFilingPlan(split, decision.numPages);
        let parts = [];
        try { parts = await splitPdfByPlan(item.file, plan, item.name); } catch (_) { parts = []; }
        if (parts.length > 1) {
          const filed = [];
          let firstId = null;
          let lastErr = null;
          for (const [pi, part] of parts.entries()) {
            const need = !pid || !part.discipline || part.discipline === "Other";
            // One CONTINUOUS bar across all parts — a per-part sent/total would snap back to
            // 0% between disciplines and read like a stalled/restarting upload.
            const partProgress = (sent, t) => onProgress(pi * (t || 1) + Math.min(sent, t || 0), (t || 1) * parts.length);
            const r = await fileOne({ pid, discipline: part.discipline, item_: part.item, docDate, blob: part.blob, fileName: part.fileName, facts: route && route.facts, needsFiling: need, onProgress: partProgress });
            if (r && r.ok) { filed.push({ d: part.discipline, n: part.pageNums.length }); firstId = firstId || r.id; }
            else lastErr = (r && r.error) || "Couldn't file a split.";
          }
          if (filed.length) {
            const note = `Split into ${filed.map((f) => `${f.d} (${f.n}p)`).join(", ")}`;
            patchItem(item.uploadId, { status: QUEUE_STATUS.DONE, reviewId: firstId, filedAt: Date.now(), warn: note, target: pid ? projName(pid) : "Holding area" });
            return;
          }
          patchItem(item.uploadId, { status: QUEUE_STATUS.FAILED, error: lastErr || "Couldn't file the split." });
          return;
        }
        // else: split unavailable → fall through to single-file filing below.
      }

      const discipline = (decision && decision.discipline) || "Other";
      const item_ = (decision && decision.item) || "";
      // A PDF with no confident discipline → Needs filing for a one-click confirm (never a guessed
      // category — misfiled is worse than unfiled). A NON-PDF (B685) has no readable discipline at
      // all, so once it's inside a project it's simply FILED as "Other" (it shows in the tree and
      // can be re-filed anytime) instead of piling every upload into the holding area; with no
      // project (cross mode) it still needs a home, so it goes to Needs filing.
      const needsFiling = isPdf ? (!pid || !discipline || discipline === "Other") : !pid;
      const r = await fileOne({ pid, discipline, item_, docDate, blob: item.file, fileName: item.name, facts: route && route.facts, needsFiling, onProgress });
      if (!r || !r.ok) { patchItem(item.uploadId, { status: QUEUE_STATUS.FAILED, error: (r && r.error) || "Couldn't file." }); return; }
      const warn = fileWarn({ oversize: r.oversize, uploadFailed: r.uploadFailed, driveError: r.driveError, large: r.large });
      patchItem(item.uploadId, { status: needsFiling ? QUEUE_STATUS.NEEDS_FILING : QUEUE_STATUS.DONE, reviewId: r.id, filedAt: Date.now(), warn, target: pid ? projName(pid) : "Holding area" });
    } catch (e) {
      patchItem(item.uploadId, { status: QUEUE_STATUS.FAILED, error: (e && e.message) || "Couldn't file." });
    }
  };

  // The folder a drop should file INTO (B686): the folder currently selected in the tree rail.
  // null = "All files" is selected (or we're not in folder mode) → auto-file by title block —
  // that "All files" node IS the drop-here-to-auto-sort spot the owner asked for. Captured at
  // drop time (a prop read now, threaded through the async pipeline) so a later selection change
  // can't retarget an in-flight upload.
  const dropTargetFolder = () => (folderMode ? (selectedFolderId || null) : null);

  const ingest = async (fileList, targetFolderId = null, opts = undefined) => {
    if (!projectId && !cross) return; // drop gated until a project is chosen (no auto-guess)
    const items = makeQueueItems(fileList);
    if (!items.length) return;
    setQueue((q) => [...items, ...q]);
    const accepted = items.filter((it) => it.status === QUEUE_STATUS.PROCESSING);
    if (accepted.length) { await runPool(accepted, (it) => processItem(it, targetFolderId, opts), 3); refresh(); }
  };

  /* A FOLDER drop/pick (B664/B685/B699): file every real file found anywhere in the tree (any
   * type); report ONE honest summary for the OS junk (dotfiles, thumbnail caches, lock files)
   * a folder sweep drags along, instead of filing noise the user never picked.
   * Structure preservation (B699, decision baked into the brief): with no explicit target, the
   * user's OWN subfolder layout routes each file — a subfolder matching an existing tree folder
   * files straight into it; a subfolder matching nothing goes to Needs filing (the tree is
   * never auto-extended, a file is never guessed); loose root-level files keep the classic
   * auto-file-by-title-block path. An explicit target (folder-row drop / selected folder)
   * still wins for the whole drop, same as B686/B687. */
  const ingestFolder = async (allFiles, targetFolderId = null) => {
    if (!projectId && !cross) return;
    const { accepted, skipped } = partitionAccepted(allFiles);
    if (!accepted.length) { setFolderNote(skipped.length ? { filed: 0, skipped: skipped.length } : null); return; }
    // No explicit target + no published tree rows (still loading) → classic auto-file for
    // the whole drop; guessing structure against an empty tree would needs-file everything.
    if (targetFolderId || !folderMode || !folderRows.length) {
      setFolderNote({ filed: accepted.length, skipped: skipped.length });
      await ingest(accepted, targetFolderId);
      return;
    }
    const groups = new Map(); // tree-folder id → files routed there by the dropped structure
    const auto = [], needs = [];
    for (const f of accepted) {
      // dirs[0] is the dropped CONTAINER itself — an arbitrary name ("Downloads", or a
      // generic "Drawings" that coincides with a tree folder) that must never route
      // anything by itself; only the SUBFOLDER structure inside it is the user's signal.
      // Files sitting directly in the container keep the classic B664 title-block
      // auto-file; explicit folder targeting is the drop-on-a-row / selected-folder
      // gesture (B686/B687), not the container's filename.
      const subDirs = fileRelDirs(f).slice(1);
      if (!subDirs.length) { auto.push(f); continue; }
      const m = matchDropPathToFolder(folderRows, subDirs);
      if (m) { if (!groups.has(m.id)) groups.set(m.id, []); groups.get(m.id).push(f); }
      else needs.push(f); // a real, unmatched subfolder — a human decision, never a guess
    }
    const kept = [...groups.values()].reduce((n, a) => n + a.length, 0);
    setFolderNote({ filed: accepted.length, skipped: skipped.length, kept, needs: needs.length });
    for (const [fid, files] of groups) await ingest(files, fid);
    if (auto.length) await ingest(auto, null);
    if (needs.length) await ingest(needs, null, { forceNeedsFiling: true });
  };

  // One drop router for the pane AND the folder-rail rows (B699). Extract entries
  // SYNCHRONOUSLY (the dataTransfer item list dies after the handler returns), then walk
  // any folders asynchronously. A dropped folder recurses into its subfolders; loose files
  // keep the classic per-file path (which shows rejection rows).
  const dropInto = (targetFolderId, dataTransfer) => {
    const { entries, files, hasEntryApi, hasDirectory } = dropItemsToEntries(dataTransfer);
    if (hasEntryApi && entries.length) {
      flattenEntries(entries).then((all) => (hasDirectory ? ingestFolder(all, targetFolderId) : ingest(all, targetFolderId)))
        .catch(() => ingest(files, targetFolderId));
    } else {
      ingest(files, targetFolderId); // older browsers without the entry API — flat file list only
    }
  };

  const onDrop = (e) => {
    e.preventDefault(); e.stopPropagation();
    dragDepth.current = 0; setDropOver(false);
    dropInto(dropTargetFolder(), e.dataTransfer);
  };

  // The folder rail's rows route their drops here (registered up through the parent):
  // a row drop targets THAT folder explicitly; the "All files" row (null) is the auto path.
  const treeDropImpl = useRef(null);
  treeDropImpl.current = (folderId, e) => {
    dragDepth.current = 0; setDropOver(false);
    dropInto(folderId || null, e.dataTransfer);
  };
  useEffect(() => { registerTreeDrop?.((folderId, e) => treeDropImpl.current?.(folderId, e)); }, [registerTreeDrop]);

  const onPick = (e) => { ingest(e.target.files, dropTargetFolder()); e.target.value = ""; };
  // Folder picker: input.webkitdirectory already hands back a FLAT, recursed file list
  // (each file carries webkitRelativePath, which the structure-preserving router reads).
  const onPickFolder = (e) => { ingestFolder([...(e.target.files || [])], dropTargetFolder()); e.target.value = ""; };

  // A PDF opens on the markup canvas; any other file type (B685) has no canvas preview, so
  // clicking it DOWNLOADS the original instead. Legacy files carry no sourceFile — they were
  // always PDFs, so an empty sourceFile reads as "PDF" (opens in Review, as before).
  const isPdfFile = (f) => !f.sourceFile || isPdfName(f.sourceFile);
  const open = (f) => {
    if (!isPdfFile(f)) { downloadFile(f); return; }
    const r = reviews.find((x) => x.id === f.id); onOpenReview?.(r || f);
  };
  // Fetch a stored file's bytes (Drive-first, Supabase-fallback — the same read-back order the
  // Review canvas uses) and save it to disk. Failure is loud (a banner), never a dead click.
  const downloadFile = async (f) => {
    const label = f.sourceFile || f.title || f.item || "file";
    setDlNotice({ name: label, busy: true });
    try {
      const rec = await loadReview(f.id);
      const src = ((rec && rec.sources) || [])[0];
      if (!src) { setDlNotice({ name: label, error: "This file isn’t stored yet — open it once to file its bytes, then try again." }); return; }
      let buf = src.driveKey ? await downloadFromDrive(src.driveKey) : null;
      if (!buf && src.storageKey) buf = await downloadSource(src.storageKey);
      if (!buf) { setDlNotice({ name: label, error: "Couldn’t fetch this file — check your connection and try again." }); return; }
      const url = URL.createObjectURL(new Blob([buf]));
      const a = document.createElement("a");
      a.href = url; a.download = src.name || label; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch (_) {} }, 4000);
      setDlNotice(null);
    } catch (e) { setDlNotice({ name: label, error: (e && e.message) || "Couldn’t download this file." }); }
  };
  // Delete = move to Recently deleted (NEW-F3, soft) — restorable for ~30 days. The pre-migration
  // degrade path can still hard-delete (r.soft absent); its cleanup failures stay loud (NEW-4).
  const del = async (id) => {
    setPendingDel(null);
    const title = (reviews.find((x) => x.id === id) || {}).title || "file";
    const r = await deleteReview(id);
    if (r && (r.orphaned || r.cleanupFailed)) setDelNotice({ orphaned: r.orphaned || 0, sharedKept: r.sharedKept || 0 });
    if (r && r.ok && r.soft) { // ~10s undo toast — the fastest restore path
      if (undoTimer.current) clearTimeout(undoTimer.current);
      setUndoDel({ id, title });
      undoTimer.current = setTimeout(() => setUndoDel(null), 10000);
    }
    refresh();
  };
  const undoDelete = async () => {
    const u = undoDel;
    setUndoDel(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    if (!u) return;
    const r = await restoreReview(u.id);
    if (!r.ok) setDelNotice({ restoreFailed: true }); // never silent (NEW-4)
    refresh();
  };
  const restoreRow = async (id) => {
    const r = await restoreReview(id);
    if (!r.ok) setDelNotice({ restoreFailed: true });
    refresh();
  };
  // "Delete forever" out of Recently deleted — the only user-facing hard delete (NEW-F3).
  const purgeRow = async (id) => {
    setPendingPurge(null);
    const r = await purgeReview(id);
    if (r && (r.orphaned || r.cleanupFailed)) setDelNotice({ orphaned: r.orphaned || 0, sharedKept: r.sharedKept || 0 });
    refresh();
  };
  // Share-by-link: outward-facing, so confirm first, then mint a link. driveKey lives on the
  // review's sources (not the file-fact row), so load the record on demand.
  const startShare = (id) => setShare((s) => ({ ...s, [id]: { status: "confirm" } }));
  const closeShare = (id) => setShare((s) => { const n = { ...s }; delete n[id]; return n; });
  const doShare = async (f) => {
    setShare((s) => ({ ...s, [f.id]: { status: "loading" } }));
    try {
      const rec = await loadReview(f.id);
      const driveSrcs = ((rec && rec.sources) || []).filter((s) => s.driveKey);
      if (driveSrcs.length === 0) { setShare((s) => ({ ...s, [f.id]: { status: "error", error: "This drawing isn’t stored in Drive yet, so there’s no shareable link — open it once to file it to Drive, then try again." } })); return; }
      if (driveSrcs.length > 1) { setShare((s) => ({ ...s, [f.id]: { status: "error", error: "This is a multi-sheet set — Planyr shares one drawing at a time for now. Open it in Google Drive to share the whole set." } })); return; }
      const r = await getShareLink(driveSrcs[0].driveKey);
      setShare((s) => ({ ...s, [f.id]: r.ok ? { status: "done", url: r.url } : { status: "error", error: r.error || "Couldn’t create a link." } }));
    } catch (e) { setShare((s) => ({ ...s, [f.id]: { status: "error", error: (e && e.message) || "Couldn’t create a link." } })); }
  };
  const doRefile = async (f) => {
    const sel = refileSel[f.id] || {};
    // Normalize a typed discipline onto the canonical list case-insensitively ("civil" →
    // "Civil") so a typo/case variant can't mint a duplicate subcategory node in the tree;
    // a genuinely new name still passes through untouched (concurrent sheet-title batch).
    const typed = (sel.discipline || f.discipline || "Civil").trim();
    const discipline = DISCIPLINES.find((d) => d.toLowerCase() === typed.toLowerCase()) || typed;
    const pid = f.projectId || projectId;
    const res = await refileReview(f.id, { projectId: pid, project: projName(pid), discipline });
    // Update the index row's category/state too so the tree moves it immediately. Preserve the
    // REAL upload filename (B685) — never the extension-less title: source_file is what isPdfFile
    // reads to decide open-in-Review vs. download, so writing f.title here would make a re-filed
    // PDF look like a non-PDF (empty stays empty → legacy PDFs still read as PDF).
    try { await upsertFileFacts(toFactsRow({ projectId: pid, discipline, item: f.item, category: sel.category || undefined, needsFiling: false }, { id: f.id, reviewId: f.id, sourceFile: f.sourceFile || "" })); } catch (_) {}
    if (res.ok) {
      // Move the Drive BYTES to match the confirmed discipline (B662 review #3): the upload
      // landed where the ORIGINAL read pointed (often the Drawings fallback for "Other");
      // filing is only done when the physical copy follows the decision. Failure is loud —
      // the metadata is filed either way, so the notice says exactly what's still pending.
      try {
        const rec = await loadReview(f.id);
        const keys = ((rec && rec.sources) || []).map((s) => s && s.driveKey).filter(Boolean);
        for (const k of keys) {
          const mv = await moveDriveFileToFolder(pid, k, discipline);
          if (mv && mv.ok === false) { setMoveNotice(`Filed as ${discipline}, but the Google Drive copy couldn't be moved (${mv.error || "move failed"}) — it stays in its old folder.`); break; }
        }
      } catch (_) {
        setMoveNotice(`Filed as ${discipline}, but the Google Drive copy couldn't be moved — it stays in its old folder.`);
      }
      setRefileSel((s) => { const n = { ...s }; delete n[f.id]; return n; });
      refresh();
    }
  };

  // ---- empty / no-project states ------------------------------------------
  if (!signedIn) {
    return <Centered title="Sign in to see your files"
      body="Document files live in your account (sign in from the Site Planner). Until then, open a PDF directly to mark it up." />;
  }
  if (!projectId && !cross) {
    return <Centered title="Pick a project to see its files"
      body="Choose a project from the breadcrumb above to open its file browser. (Dropping a file needs a project so it never has to guess where it belongs.)" />;
  }

  const holdingCount = holding.length;
  // Recently-deleted rows in scope (NEW-F3): the project view shows this project's items plus
  // never-filed ones (project_id null) so nothing deleted becomes unfindable; cross shows all.
  const deadShown = cross ? deletedRows : deletedRows.filter((d) => d.project_id === projectId || !d.project_id);
  // Where a drop will file (B686): the selected tree folder wins; "All files"/no selection means
  // auto-file by title block. Drives the drop-strip copy + the drop-anywhere overlay so the two
  // modes are unmistakable ("Filing into 02. Electric" vs. "auto-file drawings by title block").
  const dropFolderRow = folderMode && selectedFolderId ? folderRows.find((r) => r.id === selectedFolderId) : null;
  const dropFolderLabel = dropFolderRow ? displayLabel(dropFolderRow.name) : null;

  return (
    <div
      onDragEnter={(e) => { if (!hasFilesDrag(e)) return; e.preventDefault(); dragDepth.current += 1; setDropOver(true); }}
      onDragOver={(e) => { if (hasFilesDrag(e)) e.preventDefault(); }}
      onDragLeave={(e) => { if (!hasFilesDrag(e)) return; dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setDropOver(false); }}
      onDrop={onDrop}
      style={{ flex: 1, display: "flex", minHeight: 0, position: "relative", background: "var(--surface-page)", fontFamily: "system-ui, sans-serif" }}>

      {/* ---- LEFT: the project's REAL folder tree (folder mode) or the derived category tree ---- */}
      <div style={{ flex: "none", width: folderMode ? 292 : 244, borderRight: "1px solid var(--border-default)", background: "var(--surface-raised)", display: "flex", flexDirection: "column", minHeight: 0 }}>
        {folderMode ? (
          // The editable, Drive-mirrored standard tree (FolderTree, embedded). Selecting a
          // folder filters the file list on the right; files land in these same folders in Drive.
          folderRail
        ) : (
          <>
            <div style={{ flex: "none", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, padding: "11px 10px 7px 14px" }}>
              <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {cross ? "All projects" : projName(projectId) || "Project"} · Files
              </span>
              {/* The "⊞ All (projects)" un-scoping button is gone (B700): a project-scoped pane
                  never silently changes what "here" means. Cross-project browsing lives at the
                  Dashboard level; the route (#/all/library) still works. */}
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "0 6px 8px" }}>
              <TreeRow label="All files" count={filed} active={!showHolding && !node.category}
                onClick={() => { setShowHolding(false); setSearchQ(""); setNode({ category: null, subcategory: null }); }} bold />
              {tree.length === 0 && (
                <div style={{ fontSize: 11.5, color: "var(--text-secondary)", padding: "8px 10px", lineHeight: 1.5 }}>
                  No filed documents yet. Drop files below — a PDF reads its own title block and files itself.
                </div>
              )}
              {tree.map((n) => {
                const expanded = openCats.has(n.category);
                const catActive = !showHolding && node.category === n.category && !node.subcategory;
                return (
                  <div key={n.category}>
                    <TreeRow label={n.category} count={n.count} active={catActive} caret={expanded ? "▾" : "▸"}
                      onCaret={() => setOpenCats((o) => {
                        const next = new Set(o);
                        next.has(n.category) ? next.delete(n.category) : next.add(n.category);
                        saveIdSet(CATS_OPEN_KEY, next);
                        return next;
                      })}
                      onClick={() => { setShowHolding(false); setSearchQ(""); setNode({ category: n.category, subcategory: null }); }} bold />
                    {expanded && n.subs.map((s) => (
                      <TreeRow key={s.name} label={s.name} count={s.count} indent
                        active={!showHolding && node.category === n.category && node.subcategory === s.name}
                        onClick={() => { setShowHolding(false); setSearchQ(""); setNode({ category: n.category, subcategory: s.name }); }} />
                    ))}
                  </div>
                );
              })}
            </div>
            <label style={{ flex: "none", display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderTop: "1px solid var(--border-default)", fontSize: 11, color: "var(--text-secondary)", cursor: "pointer" }}
              title="Show files that have been replaced by a newer revision">
              <input type="checkbox" checked={showSuperseded} onChange={(e) => setShowSuperseded(e.target.checked)} /> Show superseded
            </label>
          </>
        )}
      </div>

      {/* ---- RIGHT: toolbar + list (the whole pane is the drop target) ---- */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
        {/* Toolbar: search + sort + upload pickers + the loud Needs-filing count (B697/B702).
            The old All / On-the-map / Reference facet chips are gone — the per-file badges
            below carry those facts, so the chips only duplicated (and mislabeled) them. */}
        <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderBottom: "1px solid var(--border-default)", flexWrap: "wrap" }}>
          <input
            value={searchQ}
            // Typing a query exits the holding view (a search spans EVERYTHING, so leaving
            // the ⚑ button lit over non-holding results would lie about what's shown).
            onChange={(e) => { const v = e.target.value; setSearchQ(v); if (v.trim()) setShowHolding(false); }}
            onKeyDown={(e) => { if (e.key === "Escape") setSearchQ(""); }}
            placeholder="Search name, sheet number, or title…"
            title="Type to filter — searches every file in this project, wherever it's filed"
            style={{ flex: "1 1 170px", minWidth: 130, maxWidth: 300, fontSize: 11.5, fontFamily: "inherit", border: "1px solid var(--border-default)", borderRadius: 999, padding: "4px 12px", color: "var(--text-primary)", background: "var(--surface-raised)", outline: "none" }}
          />
          <select value={sort} onChange={(e) => { setSort(e.target.value); try { localStorage.setItem(SORT_KEY, e.target.value); } catch (_) { /* preference just won't stick */ } }}
            title="Sort the file list"
            style={{ flex: "none", fontSize: 11, fontFamily: "inherit", border: "1px solid var(--border-default)", borderRadius: 8, padding: "3px 6px", color: "var(--text-secondary)", background: "var(--surface-raised)", cursor: "pointer" }}>
            {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <span style={{ flex: 1 }} />
          <button onClick={() => fileInputRef.current?.click()} style={pickBtn} title="Pick files to upload">Upload files</button>
          <button onClick={() => folderInputRef.current?.click()} style={pickBtn} title="Pick a whole folder to upload — its subfolder layout routes files into matching folders">Upload a folder</button>
          {/* Needs filing — separate + loud (a to-do; a stuck one is a silent failure) */}
          <button onClick={() => { setSearchQ(""); setShowHolding((v) => !v); }} title="Files that couldn't be confidently classified — one click each to confirm"
            style={{ fontSize: 11.5, fontFamily: "inherit", fontWeight: 800, cursor: "pointer", borderRadius: 999, padding: "4px 12px", whiteSpace: "nowrap",
              border: `1px solid ${holdingCount ? "var(--warn-border, #d6a64a)" : "var(--border-default)"}`,
              background: showHolding ? "var(--warn-text)" : (holdingCount ? "var(--warn-bg, #fef3c7)" : "var(--surface-raised)"),
              color: showHolding ? "var(--on-accent)" : (holdingCount ? "var(--warn-text)" : "var(--text-tertiary)") }}>
            ⚑ Needs filing{holdingCount ? ` · ${holdingCount}` : ""}
          </button>
          {/* Recently deleted (NEW-F3): the restore bin. Only rendered when it has items —
              an empty bin is noise; a populated one must be findable. */}
          {deadShown.length > 0 && (
            <button onClick={() => { setShowDeleted((v) => !v); }}
              title="Deleted files wait here ~30 days — restore them or delete them forever"
              style={{ fontSize: 11.5, fontFamily: "inherit", fontWeight: 700, cursor: "pointer", borderRadius: 999, padding: "4px 12px", whiteSpace: "nowrap",
                border: "1px solid var(--border-default)",
                background: showDeleted ? "var(--hover-menu)" : "var(--surface-raised)",
                color: "var(--text-secondary)" }}>
              ↺ Recently deleted · {deadShown.length}
            </button>
          )}
        </div>

        {/* a refresh failed — keep showing the last loaded list, loudly (NEW-F5) */}
        {loadNotice && (
          <div style={{ flex: "none", margin: "8px 12px 0", padding: "7px 10px", borderRadius: 7, display: "flex", alignItems: "center", gap: 8,
            border: "1px solid var(--warn-border, #d6a64a)", background: "var(--warn-bg, #fef3c7)", color: "var(--warn-text)", fontSize: 11.5, lineHeight: 1.45 }}>
            <span style={{ flex: 1 }}>Couldn’t refresh your files — showing the last loaded list. Your files are safe; this is a connection hiccup.</span>
            <button onClick={refresh} title="Try again"
              style={{ flex: "none", fontSize: 11, fontFamily: "inherit", fontWeight: 700, cursor: "pointer", borderRadius: 7, border: "1px solid var(--warn-border, #d6a64a)", background: "transparent", color: "var(--warn-text)", padding: "2px 10px" }}>Retry</button>
            <button onClick={() => setLoadNotice(null)} title="Dismiss" style={{ flex: "none", border: "none", background: "transparent", color: "var(--warn-text)", cursor: "pointer", fontSize: 13, fontWeight: 700, padding: 2 }}>✕</button>
          </div>
        )}

        {/* refile moved the metadata but not the Drive copy — surface it (LOUD-FAILURE) */}
        {moveNotice && (
          <div style={{ flex: "none", margin: "8px 12px 0", padding: "7px 10px", borderRadius: 7, display: "flex", alignItems: "center", gap: 8,
            border: "1px solid var(--warn-border, #d6a64a)", background: "var(--warn-bg, #fef3c7)", color: "var(--warn-text)", fontSize: 11.5, lineHeight: 1.45 }}>
            <span style={{ flex: 1 }}>{moveNotice}</span>
            <button onClick={() => setMoveNotice(null)} title="Dismiss" style={{ flex: "none", border: "none", background: "transparent", color: "var(--warn-text)", cursor: "pointer", fontSize: 13, fontWeight: 700, padding: 2 }}>✕</button>
          </div>
        )}

        {/* folder drop/pick summary (B664/B685) — honest about system junk a folder sweep skips */}
        {folderNote && (
          <div style={{ flex: "none", margin: "8px 12px 0", padding: "7px 10px", borderRadius: 7, display: "flex", alignItems: "center", gap: 8,
            border: "1px solid var(--border-default)", background: "var(--surface-raised)", color: "var(--text-secondary)", fontSize: 11.5, lineHeight: 1.45 }}>
            <span style={{ flex: 1 }}>
              {folderNote.filed
                ? `Folder read — filing ${folderNote.filed} file${folderNote.filed === 1 ? "" : "s"}`
                : "Folder read — no files found"}
              {folderNote.kept ? ` (${folderNote.kept} into your folders)` : ""}
              {folderNote.needs ? ` · ${folderNote.needs} from unrecognized subfolders → Needs filing` : ""}
              {folderNote.skipped ? ` · skipped ${folderNote.skipped} system file${folderNote.skipped === 1 ? "" : "s"}` : ""}.
            </span>
            <button onClick={() => setFolderNote(null)} title="Dismiss" style={{ flex: "none", border: "none", background: "transparent", color: "var(--text-secondary)", cursor: "pointer", fontSize: 13, fontWeight: 700, padding: 2 }}>✕</button>
          </div>
        )}

        {/* non-PDF download — in-flight + honest failure (B685; never a dead click) */}
        {dlNotice && (
          <div style={{ flex: "none", margin: "8px 12px 0", padding: "7px 10px", borderRadius: 7, display: "flex", alignItems: "center", gap: 8,
            border: `1px solid ${dlNotice.error ? "var(--warn-border, #d6a64a)" : "var(--border-default)"}`,
            background: dlNotice.error ? "var(--warn-bg, #fef3c7)" : "var(--surface-raised)",
            color: dlNotice.error ? "var(--warn-text)" : "var(--text-secondary)", fontSize: 11.5, lineHeight: 1.45 }}>
            <span style={{ flex: 1 }}>{dlNotice.error ? `${dlNotice.name}: ${dlNotice.error}` : `Downloading “${dlNotice.name}”…`}</span>
            <button onClick={() => setDlNotice(null)} title="Dismiss" style={{ flex: "none", border: "none", background: "transparent", color: dlNotice.error ? "var(--warn-text)" : "var(--text-secondary)", cursor: "pointer", fontSize: 13, fontWeight: 700, padding: 2 }}>✕</button>
          </div>
        )}

        {/* delete/restore/purge hiccups — surface them (never a silent cleanup failure, NEW-4) */}
        {delNotice && (
          <div style={{ flex: "none", margin: "8px 12px 0", padding: "7px 10px", borderRadius: 7, display: "flex", alignItems: "center", gap: 8,
            border: "1px solid var(--warn-border, #d6a64a)", background: "var(--warn-bg, #fef3c7)", color: "var(--warn-text)", fontSize: 11.5, lineHeight: 1.45 }}>
            <span style={{ flex: 1 }}>
              {delNotice.restoreFailed ? "Couldn’t restore that file — check your connection and try again from Recently deleted."
                : delNotice.purgeFailed ? "Couldn’t clear expired items from Recently deleted — they’ll be retried next time this list loads."
                : <>Deleted — but {delNotice.orphaned ? `${delNotice.orphaned} ` : ""}file{delNotice.orphaned === 1 ? "" : "s"} couldn’t be removed from storage, so a copy may linger. You can remove it directly in Google Drive.{delNotice.sharedKept ? ` ${delNotice.sharedKept} stored file${delNotice.sharedKept === 1 ? " was" : "s were"} kept because another drawing still uses ${delNotice.sharedKept === 1 ? "it" : "them"}.` : ""}</>}
            </span>
            <button onClick={() => setDelNotice(null)} title="Dismiss" style={{ flex: "none", border: "none", background: "transparent", color: "var(--warn-text)", cursor: "pointer", fontSize: 13, fontWeight: 700, padding: 2 }}>✕</button>
          </div>
        )}

        {/* file list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 12px 4px" }}>
          {showDeleted ? (
            /* Recently deleted (NEW-F3): restore or permanently delete. Rows here are soft-
               deleted doc_reviews — everything (markups, bytes, index) is still intact. */
            <>
              <div style={{ fontSize: 11.5, color: "var(--text-secondary)", padding: "4px 4px 10px", lineHeight: 1.5 }}>
                Deleted files wait here about 30 days, then clear out on their own. Restore brings
                everything back — the drawing and your markups.
              </div>
              {deadShown.length === 0 && <div style={{ fontSize: 12.5, color: "var(--text-secondary)", padding: 12 }}>Nothing in Recently deleted.</div>}
              {deadShown.map((d) => (
                <div key={d.id} style={{ border: "1px solid var(--border-default)", borderRadius: 8, padding: "8px 10px", marginBottom: 6, background: "var(--surface-raised)", display: "flex", alignItems: "center", gap: 9 }}>
                  <FileTypeIcon kind={d.kind} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {d.title || d.item || d.sfile || "Untitled"}
                    </span>
                    <span style={{ display: "block", fontSize: 10.5, color: "var(--text-tertiary)", marginTop: 2 }}>
                      Deleted {(() => { try { return new Date(d.deleted_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }); } catch (_) { return ""; } })()}
                      {d.project ? ` · ${d.project}` : ""}
                    </span>
                  </span>
                  <button onClick={() => restoreRow(d.id)} title="Put this file back in the Library"
                    style={{ flex: "none", fontSize: 10.5, fontFamily: "inherit", fontWeight: 700, cursor: "pointer", borderRadius: 8, border: "1px solid var(--border-default)", background: "var(--surface-page)", color: "var(--text-primary)", padding: "3px 10px" }}>Restore</button>
                  {pendingPurge === d.id ? (
                    <span style={{ flex: "none", display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, color: "var(--danger-text)", fontWeight: 700 }}>
                      Delete forever — markups too?
                      <button onClick={() => purgeRow(d.id)} title="Permanently delete this file and its markups" style={{ border: "none", background: "transparent", color: "var(--danger-text)", cursor: "pointer", fontSize: 13, fontWeight: 700, padding: 2 }}>✓</button>
                      <button onClick={() => setPendingPurge(null)} title="Cancel" style={{ border: "none", background: "transparent", color: "var(--text-secondary)", cursor: "pointer", fontSize: 13, padding: 2 }}>✕</button>
                    </span>
                  ) : (
                    <button onClick={() => setPendingPurge(d.id)} title="Permanently delete (cannot be undone)"
                      style={{ flex: "none", fontSize: 10.5, fontFamily: "inherit", fontWeight: 600, cursor: "pointer", borderRadius: 8, border: "1px solid var(--border-default)", background: "transparent", color: "var(--danger-text)", padding: "3px 8px" }}>Delete forever</button>
                  )}
                </div>
              ))}
            </>
          ) : (
          <>
          {busy && shown.length === 0 && <div style={{ fontSize: 12, color: "var(--text-secondary)", padding: 12 }}>Loading…</div>}
          {!busy && shown.length === 0 && !loadNotice && (
            // ONE empty state (B699) — the old pane carried a second "No files here yet. Drop
            // files below…" line AND a dedicated drop card saying the same thing again.
            showHolding ? (
              <div style={{ fontSize: 12.5, color: "var(--text-secondary)", padding: 16, lineHeight: 1.55 }}>
                Nothing waiting to be filed — every document is sorted.
              </div>
            ) : query ? (
              <div style={{ fontSize: 12.5, color: "var(--text-secondary)", padding: 16, lineHeight: 1.55 }}>
                No files match “{query}”.
              </div>
            ) : (
              <div style={{ padding: "44px 16px", textAlign: "center" }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>Drop files anywhere</div>
                {/* Copy tracks the REAL target: with a folder selected the whole drop files
                    into it (B686/B687) — promising title-block auto-sort there would lie. */}
                <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.55, maxWidth: 420, margin: "0 auto" }}>
                  {dropFolderLabel
                    ? <>Everything you drop files straight into <b>{dropFolderLabel}</b>. To auto-sort PDFs by their title block instead, select <b>All files</b> first.</>
                    : <>PDFs read their own title block and file themselves; anything uncertain lands in Needs filing.</>}
                </div>
                <span style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 12 }}>
                  <button onClick={() => fileInputRef.current?.click()} style={pickBtn}>Choose files</button>
                  <button onClick={() => folderInputRef.current?.click()} style={pickBtn}>Choose a folder</button>
                </span>
              </div>
            )
          )}
          {shown.map((f) => {
            const st = stateOf(f);
            const mapped = onMap(f), ref = isReference(f), spatial = isSpatial(f);
            const needs = st === FILE_STATES.NEEDS_FILING;
            // A non-PDF (B685) has no markup-canvas preview: clicking it downloads the original,
            // and a small type chip (its extension) makes clear it's not a drawing you mark up.
            const pdfRow = isPdfFile(f);
            const ext = (String(f.sourceFile || "").match(/\.([a-z0-9]+)$/i) || [])[1];
            return (
              <div key={f.id} style={{ border: "1px solid var(--border-default)", borderRadius: 8, padding: "8px 10px", marginBottom: 6, background: "var(--surface-raised)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <button onClick={() => open(f)} title={pdfRow ? "Open to review / mark up" : "Download this file"}
                    style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 9, textAlign: "left", border: "none", background: "transparent", cursor: "pointer", padding: 0, fontFamily: "inherit" }}>
                    <FileTypeIcon kind={f.kind} />
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {f.title || f.item}{f.revision ? ` · ${f.revision}` : ""}
                      </span>
                      <span style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3, flexWrap: "wrap" }}>
                        <Badge title="Subcategory (discipline)">{subcategoryOf(f)}</Badge>
                        {!pdfRow && ext && <Badge tone="old" title="File type — click the row to download it">{ext.toUpperCase()}</Badge>}
                        {f.sheetNumber && <Badge title="Sheet number / range read off the title block">{f.sheetNumber}</Badge>}
                        {st === FILE_STATES.SUPERSEDED && <Badge tone="old" title="Replaced by a newer revision">superseded</Badge>}
                        {needs && <Badge title="Couldn’t classify confidently">needs filing</Badge>}
                        {mapped && <Badge tone="map" title="Placed on the shared map">on the map</Badge>}
                        {ref && !mapped && <Badge tone="ref" title="Read-only reference — not a map object">reference</Badge>}
                        <span style={{ fontSize: 10.5, color: "var(--text-tertiary)" }}>{fmtDate(f)}</span>
                      </span>
                    </span>
                  </button>
                  {onTogglePinFile && (
                    <button onClick={() => onTogglePinFile(f)}
                      title={pinnedFileIds && pinnedFileIds.has(f.id) ? "Unpin from the Library home" : "Pin to the Library home"}
                      style={{ flex: "none", border: "none", background: "transparent", cursor: "pointer", fontSize: 14, padding: 2, lineHeight: 1,
                        color: pinnedFileIds && pinnedFileIds.has(f.id) ? "var(--accent-library-text)" : "var(--text-tertiary)" }}>
                      {pinnedFileIds && pinnedFileIds.has(f.id) ? "★" : "☆"}
                    </button>
                  )}
                  {pdfRow && spatial && !mapped && <button onClick={() => onOpenReview && open(f)} title="Open to place this drawing on the map"
                    style={{ flex: "none", fontSize: 10.5, fontFamily: "inherit", fontWeight: 600, cursor: "pointer", borderRadius: 8, border: "1px solid var(--border-default)", background: "var(--surface-page)", color: "var(--text-secondary)", padding: "3px 8px" }}>Place</button>}
                  <button onClick={() => (share[f.id] ? closeShare(f.id) : startShare(f.id))} title="Get a shareable link"
                    style={{ flex: "none", fontSize: 10.5, fontFamily: "inherit", fontWeight: 600, cursor: "pointer", borderRadius: 8, border: "1px solid var(--border-default)", background: share[f.id] ? "var(--hover-menu)" : "var(--surface-page)", color: "var(--text-secondary)", padding: "3px 8px" }}>Share</button>
                  {pendingDel === f.id ? (
                    /* Wording, not a bare glyph pair (NEW-F3): say where the file goes. The
                       delete is soft (Recently deleted, ~30-day restore), so the stakes match
                       the light inline affordance. */
                    <span style={{ flex: "none", display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, color: "var(--text-secondary)", fontWeight: 700, whiteSpace: "nowrap" }}>
                      Move to Recently deleted?
                      <button onClick={() => del(f.id)} title="Yes — move it (restorable ~30 days)" style={{ border: "none", background: "transparent", color: "var(--danger-text)", cursor: "pointer", fontSize: 13, fontWeight: 700, padding: 2 }}>✓</button>
                      <button onClick={() => setPendingDel(null)} title="Cancel" style={{ border: "none", background: "transparent", color: "var(--text-secondary)", cursor: "pointer", fontSize: 13, padding: 2 }}>✕</button>
                    </span>
                  ) : (
                    <button onClick={() => setPendingDel(f.id)} title="Delete (moves to Recently deleted)" style={{ flex: "none", border: "none", background: "transparent", color: "var(--danger-text)", cursor: "pointer", fontSize: 14, padding: 3 }}>×</button>
                  )}
                </div>
                {/* re-file (re-assign category/subcategory) — inline, never auto-guesses */}
                {(needs || refileSel[f.id]) && (
                  <RefileRow value={refileSel[f.id]} discipline={f.discipline}
                    onChange={(v) => setRefileSel((s) => ({ ...s, [f.id]: v }))} onFile={() => doRefile(f)} />
                )}
                {/* share-by-link — inline, two-step (confirm → link); failure never silent */}
                {share[f.id] && (
                  <ShareRow state={share[f.id]} onCreate={() => doShare(f)} onClose={() => closeShare(f.id)} />
                )}
              </div>
            );
          })}
          </>
          )}
        </div>

        {/* persistent processing queue (B260 lean) */}
        <DropQueue queue={queue} onDismiss={removeItem} onTriage={(id) => { setSearchQ(""); setShowHolding(true); removeItem(id); }} />

        {/* Hidden pickers (the toolbar + empty-state buttons click these). Any file type
            (B685) — no `accept` filter, so the OS picker never hides a DWG/spreadsheet/image.
            The dedicated bottom drop card is GONE (B699): the whole pane is the drop target. */}
        <input ref={fileInputRef} type="file" multiple style={{ display: "none" }} onChange={onPick} />
        {/* webkitdirectory turns this picker into a folder picker; set imperatively so React
            can't drop the non-standard attribute. Its files list is already flat + recursed. */}
        <input ref={(el) => { folderInputRef.current = el; if (el) el.webkitdirectory = true; }}
          type="file" multiple style={{ display: "none" }} onChange={onPickFolder} />
      </div>

      {/* undo toast (NEW-F3): ~10s window to un-delete without hunting for Recently deleted */}
      {undoDel && (
        <div style={{ position: "absolute", bottom: 14, right: 14, zIndex: 6, display: "flex", alignItems: "center", gap: 10,
          padding: "9px 14px", borderRadius: 9, background: "var(--surface-raised)", border: "1px solid var(--border-default)",
          boxShadow: "0 4px 16px rgba(0,0,0,0.18)", fontSize: 12, color: "var(--text-primary)" }}>
          <span style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            Moved “{undoDel.title}” to Recently deleted.
          </span>
          <button onClick={undoDelete} title="Put it right back"
            style={{ flex: "none", fontSize: 11.5, fontFamily: "inherit", fontWeight: 800, cursor: "pointer", borderRadius: 7, border: "1px solid var(--border-default)", background: "var(--surface-page)", color: "var(--text-primary)", padding: "3px 12px" }}>Undo</button>
          <button onClick={() => setUndoDel(null)} title="Dismiss" style={{ flex: "none", border: "none", background: "transparent", color: "var(--text-secondary)", cursor: "pointer", fontSize: 13, fontWeight: 700, padding: 2 }}>✕</button>
        </div>
      )}

      {/* drop-anywhere overlay hint — the pill names the REAL target: the hovered folder row
          (rail drop), else the selected folder, else the auto-file path. */}
      {dropOver && (
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", border: "2.5px dashed var(--accent-library)", borderRadius: 4, background: "rgba(14,116,144,0.06)", display: "grid", placeItems: "center" }}>
          <span style={{ background: "var(--surface-raised)", color: "var(--text-primary)", fontWeight: 700, fontSize: 13, padding: "8px 16px", borderRadius: 999, border: "1px solid var(--border-default)" }}>
            Drop to file into {treeDragTarget || dropFolderLabel || (cross ? "the matched project" : (projName(projectId) || "this project"))}
          </span>
        </div>
      )}
    </div>
  );
}

function TreeRow({ label, count, active, indent, bold, caret, onCaret, onClick }) {
  return (
    <div style={{ display: "flex", alignItems: "center", borderRadius: 7, background: active ? "var(--hover-menu)" : "transparent", marginBottom: 1 }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "var(--hover-ghost)"; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}>
      {caret ? (
        <button onClick={onCaret} aria-label="Toggle" style={{ flex: "none", width: 18, border: "none", background: "transparent", cursor: "pointer", color: "var(--text-tertiary)", fontSize: 10, padding: "6px 0 6px 6px" }}>{caret}</button>
      ) : <span style={{ width: indent ? 26 : 18, flex: "none" }} />}
      <button onClick={onClick} style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, textAlign: "left", border: "none", background: "transparent", cursor: "pointer", fontFamily: "inherit", padding: "6px 8px 6px 0" }}>
        <span style={{ fontSize: 12.5, fontWeight: bold ? 700 : 500, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        <span style={{ flex: "none", fontSize: 11, color: "var(--text-tertiary)", fontWeight: 600 }}>{count}</span>
      </button>
    </div>
  );
}

/* Re-file a file: pick a category + discipline (subcategory). A NEW subcategory can be
 * typed, not just chosen. Never auto-guesses. */
function RefileRow({ value = {}, discipline, onChange, onFile }) {
  const ctl = { fontSize: 11, fontFamily: "inherit", border: "1px solid var(--border-default)", borderRadius: 8, padding: "3px 5px", color: "var(--text-primary)", background: "var(--surface-page)" };
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 7, paddingTop: 7, borderTop: "1px solid var(--border-default)", flexWrap: "wrap" }}>
      <span style={{ fontSize: 10.5, color: "var(--warn-text)", fontWeight: 700, flex: "none" }}>File as:</span>
      <select value={value.category || ""} onChange={(e) => onChange({ ...value, category: e.target.value })} style={{ ...ctl, flex: "none" }} title="Category (top-level folder)">
        <option value="">Auto</option>
        {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <input list="dr-disciplines" value={value.discipline ?? discipline ?? ""} placeholder="Discipline…"
        onChange={(e) => onChange({ ...value, discipline: e.target.value })} style={{ ...ctl, flex: 1, minWidth: 90 }} title="Subcategory (type a new one if needed)" />
      <datalist id="dr-disciplines">{DISCIPLINES.map((d) => <option key={d} value={d} />)}</datalist>
      <button onClick={onFile} title="File this document" style={{ flex: "none", fontSize: 11, fontFamily: "inherit", fontWeight: 700, cursor: "pointer", borderRadius: 8, border: "1px solid var(--accent-library)", background: "var(--accent-library)", color: "var(--on-accent-library)", padding: "3px 11px" }}>File</button>
    </div>
  );
}

/* Share a drawing as a Google Drive "anyone with the link" link. Two-step + inline (no
 * window.prompt, per the owner rule): confirm (outward-facing — a public link) → create →
 * a copyable link, or an honest error. Link-generation failure is never silent (NEW-4). */
function ShareRow({ state = {}, onCreate, onClose }) {
  const [copied, setCopied] = useState(false);
  const wrap = { display: "flex", gap: 8, alignItems: "center", marginTop: 7, paddingTop: 7, borderTop: "1px solid var(--border-default)", flexWrap: "wrap" };
  const btn = (accent) => ({ flex: "none", fontSize: 11, fontFamily: "inherit", fontWeight: 700, cursor: "pointer", borderRadius: 8, padding: "3px 11px",
    border: `1px solid ${accent ? "var(--accent-library)" : "var(--border-default)"}`, background: accent ? "var(--accent-library)" : "var(--surface-page)", color: accent ? "var(--on-accent-library)" : "var(--text-secondary)" });
  if (state.status === "done") {
    const copy = () => { try { navigator.clipboard?.writeText(state.url).then(() => setCopied(true)).catch(() => {}); } catch (_) { /* clipboard blocked */ } };
    return (
      <div style={wrap}>
        <span style={{ fontSize: 10.5, color: "var(--text-secondary)", fontWeight: 700, flex: "none" }}>Link:</span>
        <input readOnly value={state.url} onFocus={(e) => e.target.select()}
          style={{ flex: 1, minWidth: 120, fontSize: 11, fontFamily: "inherit", border: "1px solid var(--border-default)", borderRadius: 8, padding: "3px 6px", color: "var(--text-primary)", background: "var(--surface-page)" }} />
        <button onClick={copy} style={btn(true)}>{copied ? "Copied ✓" : "Copy"}</button>
        <button onClick={onClose} style={btn(false)}>Done</button>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div style={wrap}>
        <span style={{ fontSize: 11, color: "var(--danger-text)", flex: 1, minWidth: 120, lineHeight: 1.45 }}>{state.error}</span>
        <button onClick={onClose} style={btn(false)}>Close</button>
      </div>
    );
  }
  if (state.status === "loading") {
    return <div style={wrap}><span style={{ fontSize: 11, color: "var(--text-secondary)" }}>Creating link…</span></div>;
  }
  // confirm (default) — the outward-facing gate
  return (
    <div style={wrap}>
      <span style={{ fontSize: 10.5, color: "var(--text-secondary)", flex: 1, minWidth: 120, lineHeight: 1.45 }}>
        Anyone with this link can view it · creates a Google Drive link · to stop sharing, remove it in Google Drive.
      </span>
      <button onClick={onCreate} style={btn(true)}>Create link</button>
      <button onClick={onClose} style={btn(false)}>Cancel</button>
    </div>
  );
}

/* The persistent processing queue: a row per in-flight / needs-attention file. Filed rows
 * fade out shortly (splitQueue's recent group); exceptions stay until acted on. Never a
 * vanishing toast — a silent processing state is a failure. */
function DropQueue({ queue, onDismiss, onTriage }) {
  const { active } = splitQueue(queue, Date.now());
  if (!active.length) return null;
  const S = QUEUE_STATUS;
  const meta = (it) => ({
    // While the chunked upload runs (B409), the label is honest byte progress; before it
    // (title-block read) and after the final chunk (recording) it names those phases.
    [S.PROCESSING]: { color: "var(--text-secondary)", label: it.progress == null ? "Reading title block…" : (it.progress >= 1 ? "Recording the file…" : `Uploading — ${Math.floor(it.progress * 100)}%`) },
    [S.DONE]: { color: "var(--success-text, #15803d)", label: it.target ? `Filed · ${it.target}` : "Filed" },
    [S.NEEDS_FILING]: { color: "var(--warn-text)", label: "Needs filing — confirm a discipline" },
    [S.FAILED]: { color: "var(--danger-text)", label: it.error || "Failed" },
    [S.REJECTED]: { color: "var(--danger-text)", label: it.error || "Couldn’t read this file" },
  })[it.status] || { color: "var(--text-secondary)", label: it.status };
  return (
    <div style={{ flex: "none", margin: "0 12px 8px", display: "flex", flexDirection: "column", gap: 4 }}>
      {active.map((it) => {
        const m = meta(it);
        return (
          <div key={it.uploadId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 9px", borderRadius: 7, border: "1px solid var(--border-default)", background: "var(--surface-raised)" }}>
            <span style={{ flex: "none", width: 12, textAlign: "center", color: m.color, fontSize: 12 }}>
              {it.status === S.PROCESSING
                ? <span style={{ display: "inline-block", width: 10, height: 10, border: "2px solid var(--border-default)", borderTopColor: "var(--text-secondary)", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
                : it.status === S.DONE ? "✓" : "⚠"}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11.5, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</div>
              <div style={{ fontSize: 10, color: m.color, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.label}{it.warn ? ` · ${it.warn}` : ""}</div>
              {it.status === S.PROCESSING && it.progress != null && it.progress < 1 && (
                <div style={{ marginTop: 3, height: 3, borderRadius: 2, background: "var(--border-default)", overflow: "hidden" }}>
                  <div style={{ width: `${Math.floor(it.progress * 100)}%`, height: "100%", background: "var(--accent-library)", transition: "width 0.3s ease" }} />
                </div>
              )}
            </div>
            {it.status === S.NEEDS_FILING && <button onClick={() => onTriage(it.uploadId)} style={miniBtn}>Triage</button>}
            {(it.status === S.FAILED || it.status === S.REJECTED) && <button onClick={() => onDismiss(it.uploadId)} style={miniBtn}>Dismiss</button>}
          </div>
        );
      })}
    </div>
  );
}
const miniBtn = { flex: "none", fontSize: 10, fontFamily: "inherit", fontWeight: 700, cursor: "pointer", borderRadius: 5, border: "1px solid var(--border-default)", background: "var(--surface-page)", color: "var(--text-secondary)", padding: "2px 8px" };
// The two drop-strip pickers (B664): loose files vs. a whole folder.
const pickBtn = { flex: "none", fontSize: 11, fontFamily: "inherit", fontWeight: 700, cursor: "pointer", borderRadius: 8, border: "1px solid var(--border-default)", background: "var(--surface-page)", color: "var(--text-secondary)", padding: "3px 11px" };

function Centered({ title, body }) {
  return (
    <div style={{ flex: 1, display: "grid", placeItems: "center", padding: 28, background: "var(--surface-page)", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 380, textAlign: "center" }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.6 }}>{body}</div>
      </div>
    </div>
  );
}
