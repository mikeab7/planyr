import { computeDisplayHealth, computeRolledHealth } from "../../../../shared/schedule/engine/health.js";
import { OWNER_KIND_SITE, crossScheduleLabel, ownerOf, scheduleLabelParts } from "../../../../shared/schedule/scheduleOwnership.js";
import { effectivePercentComplete } from "../../../../shared/schedule/healthEngine.js";
import { NOW } from "../../../../shared/schedule/engine/calendar.js";
import { groupRowsByProject } from "../../../../shared/schedule/engine/tasks.js";
import { durTooltip, fmtPreds, fmtTaskDuration, normPreds, parseDurationInput, taskDurUnit, taskDurValue } from "../../../../shared/schedule/engine/predecessors.js";
import { ownerDisplayParts, ownerListOf } from "../../../../shared/schedule/engine/owners.js";
import { ContactPicker, DepCell, HDARK, HEALTH, HK, NO_AUTOFILL, measuredColWidth, showToast, useAnchoredPopover } from "../common.jsx";
import { exposeToHarness } from "../harnessGlobals.js";

const { useState, useEffect, useRef, useMemo } = React;


// ── MasterView ────────────────────────────────────────────
function HealthDropMenu({value, onSelect, onClose}) {
  const [idx, setIdx] = React.useState(() => Math.max(0, HK.indexOf(value)));
  React.useEffect(() => {
    const h = e => {
      if (e.key==="ArrowDown")  { e.stopPropagation(); e.preventDefault(); setIdx(i=>Math.min(HK.length-1,i+1)); }
      else if (e.key==="ArrowUp")    { e.stopPropagation(); e.preventDefault(); setIdx(i=>Math.max(0,i-1)); }
      else if (e.key==="Enter")      { e.stopPropagation(); e.preventDefault(); onSelect(HK[idx]); onClose(); }
      else if (e.key==="Escape" || e.key==="ArrowLeft" || e.key==="ArrowRight") { e.stopPropagation(); e.preventDefault(); onClose(); }
      else if (e.key==="Tab")        { e.preventDefault(); onClose(); }
    };
    document.addEventListener("keydown", h, true);
    const outside = e => { if (!e.target.closest("[data-hmenu]")) onClose(); };
    document.addEventListener("mousedown", outside);
    return () => { document.removeEventListener("keydown", h, true); document.removeEventListener("mousedown", outside); };
  }, [idx, onSelect, onClose]);
  return (
    <div data-hmenu="1" style={{position:"absolute",top:"calc(100% + 2px)",left:0,width:"max-content",
      background:"var(--bg)",border:"1px solid var(--bd2)",borderRadius:6,
      boxShadow:"0 4px 20px rgba(0,0,0,.15)",zIndex:9999,padding:"4px 0",userSelect:"none"}}>
      {/* ⛔ RULES-DECIDE (2026-08-25, owner correction): "Automatic" retired along with
          healthOverride — see HealthPicker's own note. */}
      {HK.map((hk,i) => { const hh=HEALTH[hk]; return (
        <div key={hk} data-hmenu="1" onMouseEnter={()=>setIdx(i)}
          onMouseDown={e=>{e.preventDefault();onSelect(hk);onClose();}}
          style={{padding:"5px 10px",display:"flex",alignItems:"center",gap:6,cursor:"pointer",
            background:i===idx?"var(--surf)":"transparent",transition:"background .1s"}}>
          <span style={{width:8,height:8,borderRadius:"50%",background:hh.dot,border:hh.border,flexShrink:0}} />
          <span style={{fontSize:11,color:"var(--txt)",fontFamily:"'Inter',system-ui,sans-serif",whiteSpace:"nowrap"}}>{hh.label}</span>
        </div>
      ); })}
    </div>
  );
}

const MASTER_COL_DEFS = [
  {k:"project",          label:"Project",      editable:false},
  {k:"id",               label:"ID",           editable:false},
  {k:"parent",           label:"Parent Task",  editable:false},
  {k:"name",             label:"Task",         editable:true},
  {k:"start",            label:"Start",        editable:false},
  {k:"end",              label:"End",          editable:false},
  {k:"duration",         label:"Dur",          editable:true},
  {k:"health",           label:"Status",       editable:true},
  {k:"percentComplete",  label:"% Done",       editable:true},
  {k:"responsibleParty", label:"Owner",        editable:true},
  {k:"predecessors",     label:"Predecessors", editable:false},
  {k:"successors",       label:"Successors",   editable:false},
  {k:"notes",            label:"Notes",        editable:false},
];
const DEFAULT_MASTER_COLS = ["project","id","name","parent","start","end","duration","health","responsibleParty","notes"];
const DEFAULT_MASTER_WIDTHS = {
  // B1873360 — 140 sized for a bare schedule name ("Master Schedule"); the Project column and the
  // "Group by project" header now show the qualified crossScheduleLabel ("Goose Creek / Master
  // Schedule"), which needs more room. Only the DEFAULT changes — a saved masterColWidths.project
  // still wins (see colWidths' init below), so nobody who already sized this column gets clobbered.
  project:200, id:36, parent:140, name:220, start:72, end:72,
  duration:52, health:110, percentComplete:60, responsibleParty:100,
  predecessors:180, successors:180, notes:80,
};

// ── Task Report filter (NEW-1) ─────────────────────────────────────────────────────────────────
// The Task Report's ONE Filter dropdown (Status + Project) beside Group by / Show / Columns. It amends the
// Status segmented control (B2631584), which replaced the old "In Progress + Needs Attn." chip.
//   · STATUS — a checkbox for every status (the five built-ins in this order, then any custom ones). The saved key is
//     still `masterHealthFilter`: legacy `true` (the old chip's default) = In Progress + Needs Attention; legacy
//     `false` = nothing checked; an array of keys is each saved status's checkbox. Anything unreadable falls back to the
//     default (In Progress + Needs Attention), never to a silent "nothing matches". A key for a status that no longer
//     exists (a deleted custom one) is dropped.
//   · PROJECT — a checkbox per schedule in the report, saved in `masterProjectFilter` (an array of schedule ids; none
//     checked by default). A stale id (a deleted schedule) is dropped.
//   · NOTHING checked in a section = that section does not narrow anything (so "Clear all" shows every task). Both
//     sections combine: a row must match Status AND Project.
//   · ONE classification — a row passes on its DISPLAYED status (`_disp`: rolled for a parent, rule-computed for a leaf),
//     the same value that paints the row's status pill and orders the Status sort. Never a second copy.
const REPORT_STATUS_BASE = [{ k: "gray", label: "Not Started" }, { k: "yellow", label: "In Progress" }, { k: "red", label: "Needs Attention" },
  { k: "paused", label: "Paused" }, { k: "green", label: "Complete" }];
const REPORT_STATUS_DEFAULT = ["yellow", "red"];
function reportStatusOptions(customHealth) {
  const custom = (Array.isArray(customHealth) ? customHealth : [])
    .filter(c => c && typeof c === "object" && c.k != null && !REPORT_STATUS_BASE.some(o => o.k === c.k))
    .map(c => ({ k: c.k, label: c.label != null && String(c.label).trim() ? String(c.label) : String(c.k) }));
  return [...REPORT_STATUS_BASE, ...custom];
}
function reportStatusKeys(v, options) {
  const opts = options || REPORT_STATUS_BASE;
  if (v === false) return [];
  if (!Array.isArray(v)) return REPORT_STATUS_DEFAULT.slice();
  return opts.map(o => o.k).filter(k => v.includes(k));   // canonical order, unknown keys dropped
}
function reportStatusToggle(keys, k, options) {
  const opts = options || REPORT_STATUS_BASE, has = keys.includes(k);
  return opts.map(o => o.k).filter(x => (x === k ? !has : keys.includes(x)));
}
function reportStatusPasses(keys, disp) { return keys.length === 0 || keys.includes(disp); }
function reportProjectKeys(v, validIds) {
  if (!Array.isArray(v)) return [];
  const want = new Set(v.map(String));
  return (validIds || []).map(String).filter(id => want.has(id));
}
function reportProjectToggle(keys, id, validIds) {
  const has = keys.includes(String(id));
  return (validIds || []).map(String).filter(x => (x === String(id) ? !has : keys.includes(x)));
}
function reportProjectPasses(keys, projId) { return keys.length === 0 || keys.includes(String(projId)); }
// The number on the Filter button's badge: how many filter TYPES are in use (Status plus Project = 2).
function reportFilterCount(statusKeys, projectKeys) { return (statusKeys.length > 0 ? 1 : 0) + (projectKeys.length > 0 ? 1 : 0); }
// The count beside each checkbox: the rows you would see with only that box ticked in its own section, given what the OTHER
// section currently narrows to — so a count always equals the rows that box would show.
function reportFacetCounts(rows, statusKeys, projectKeys) {
  const status = {}, project = {};
  rows.forEach(r => {
    if (reportProjectPasses(projectKeys, r.projId)) status[r._disp] = (status[r._disp] || 0) + 1;
    if (reportStatusPasses(statusKeys, r._disp)) project[String(r.projId)] = (project[String(r.projId)] || 0) + 1;
  });
  return { status, project };
}
function reportFilterPhrase(statusNames, projectNames) {
  const some = (names) => names.length > 2 ? names.slice(0, 2).join(", ") + ", +" + (names.length - 2) + " more" : names.join(" or ");
  const parts = [];
  if (statusNames.length) parts.push(some(statusNames));
  if (projectNames.length) parts.push(some(projectNames));
  return parts.join(" \u00b7 ");
}
// ── end Task Report filter ─────────────────────────────────────────────────────────────────────

// NEW-1 (2026-10-08) — the owner's project order, pushed by the shell. Held at module scope (a single
// listener, installed once) so a push that lands before the Task Report is on screen is not lost; the
// report asks for a fresh push when it mounts. The page never decides or stores the order itself: a move
// is only ever REQUESTED (planar:project-order-move) and comes back as a new push.
let _projectOrder = { ids: null, canOrder: false, error: null };
const _projectOrderSubs = new Set();
export function installProjectOrderListener() {
  if (typeof window !== "undefined") {
    window.addEventListener("message", (e) => {
      if (e.origin !== window.location.origin) return;
      const m = e.data;
      if (!m || m.source !== "planar-shell" || m.type !== "planar:project-order") return;
      _projectOrder = {
        ids: Array.isArray(m.ids) ? m.ids.filter(x => typeof x === "string") : null,
        canOrder: !!m.canOrder,
        error: m.error ? String(m.error) : null,
      };
      _projectOrderSubs.forEach(f => f());
    });
  }
}
function postToShell(msg) {
  try { if (window.parent && window.parent !== window) window.parent.postMessage({ source: "planar-seq", ...msg }, window.location.origin); } catch (_) {}
}
function useProjectOrder() {
  const [, tick] = React.useState(0);
  React.useEffect(() => {
    const f = () => tick(n => n + 1);
    _projectOrderSubs.add(f);
    postToShell({ type: "planar:project-order-request" });
    return () => { _projectOrderSubs.delete(f); };
  }, []);
  return _projectOrder;
}

// The ⋯ menu on a project group header: Move to top / up / down / bottom. Module scope on purpose
// (MODULE-SCOPE-COMPONENTS) — defined inside MasterView it would remount every render and drop its open state.
function GroupOrderMenu({label, isFirst, isLast, onPick}) {
  const [pos, setPos] = React.useState(null); // {top, right} while open (fixed — the table wrap clips absolute menus)
  const btnRef = useRef(null);
  useEffect(() => {
    if (!pos) return;
    const close = (e) => { if (e && e.type === "keydown" && e.key !== "Escape") return; setPos(null); };
    const down = (e) => { if (!e.target.closest || !e.target.closest("[data-grp-menu]")) setPos(null); };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", close, true);
    window.addEventListener("resize", close);
    document.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", close, true);
      window.removeEventListener("resize", close);
      document.removeEventListener("scroll", close, true);
    };
  }, [pos]);
  const open = (e) => {
    e.stopPropagation();
    if (pos) { setPos(null); return; }
    const r = btnRef.current.getBoundingClientRect();
    setPos({top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right)});
  };
  const item = (txt, to, disabled) => (
    <button type="button" role="menuitem" disabled={disabled} onClick={() => { setPos(null); onPick(to); }}
      style={{display:"block",width:"100%",textAlign:"left",padding:"9px 14px",border:"none",background:"transparent",
        fontFamily:"inherit",fontSize:13,color:disabled?"var(--bd2)":"var(--txt)",cursor:disabled?"default":"pointer"}}>{txt}</button>
  );
  return (
    <span data-grp-menu="1" style={{display:"inline-flex"}}>
      <button ref={btnRef} type="button" data-grp-menu-btn="1" onClick={open} aria-haspopup="menu" aria-expanded={!!pos}
        title={`Order options for ${label}`} aria-label={`Order options for ${label}`}
        style={{width:30,height:30,borderRadius:6,border:"1px solid var(--bd2)",background:"var(--surf)",color:"var(--txt)",
          fontSize:16,lineHeight:1,cursor:"pointer",fontFamily:"inherit"}}>⋯</button>
      {pos && (
        <div role="menu" style={{position:"fixed",top:pos.top,right:pos.right,zIndex:1000,minWidth:170,padding:"4px 0",
          background:"var(--surf)",border:"1px solid var(--bd2)",borderRadius:8,boxShadow:"0 6px 20px rgba(27,31,36,.18)"}}>
          {item("Move to top", "top", isFirst)}
          {item("Move up", "up", isFirst)}
          {item("Move down", "down", isLast)}
          {item("Move to bottom", "bottom", isLast)}
        </div>
      )}
    </span>
  );
}

// The Task Report toolbar's dropdowns (NEW-1). MODULE SCOPE on purpose (MODULE-SCOPE-COMPONENTS): defined inside MasterView
// it would remount every render and drop the open panel on each tick of a checkbox. Four buttons share ONE open slot
// (`openMenu`), so opening one closes any other. The panel is `position:fixed`, placed from the button's own box and clamped
// inside the iframe — the table card and the header would clip an absolutely-positioned one — and scrolls inside when long
// (many projects), with an optional footer that stays pinned.
const REPORT_MENU_SECTION = {fontSize:9,fontWeight:700,color:"var(--mut)",letterSpacing:".08em",textTransform:"uppercase",padding:"6px 10px 4px"};
const REPORT_MENU_ROW = {display:"flex",alignItems:"center",gap:8,padding:"5px 10px",cursor:"pointer",borderRadius:4,transition:"background .1s"};
const REPORT_MENU_COUNT = {fontSize:11,color:"var(--mut)",fontVariantNumeric:"tabular-nums",marginLeft:"auto",paddingLeft:10,flexShrink:0};
function ReportMenu({id, openMenu, setOpenMenu, label, active, minWidth, footer, children}) {
  const open = openMenu === id;
  const btnRef = useRef(null);
  const panelRef = useRef(null);
  // The shared anchored-popover hook (NEW-1 / B2465520): re-reads the anchor every frame and closes the panel (no commit) the moment
  // the anchor leaves view, so a panel can never be stranded away from its button. It is hung under the WHOLE toolbar, not its own
  // button: at phone width the buttons wrap onto a second row, and a panel under its own button would cover the others.
  const pos = useAnchoredPopover(open, btnRef, r => {
    const bar = btnRef.current && btnRef.current.closest("[data-report-toolbar]");
    const p = panelRef.current, vw = document.documentElement.clientWidth, vh = window.innerHeight, pad = 8;
    const w = p ? p.offsetWidth : minWidth;
    const top = (bar ? bar.getBoundingClientRect().bottom : r.bottom) + 4;
    return {left: Math.max(pad, Math.min(r.left, vw - pad - w)), top, maxH: Math.max(140, vh - top - pad)};
  }, () => setOpenMenu(cur => (cur === id ? null : cur)));
  return (
    <div data-tr-menu={id} style={{position:"relative"}}>
      <button ref={btnRef} type="button" className={"btn"+(open||active?" act":"")} data-tr-btn={id} data-active={active?"1":undefined} aria-haspopup="true" aria-expanded={open}
        onClick={()=>setOpenMenu(open ? null : id)}
        style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:11}}>
        {label} <span style={{fontSize:8,opacity:.7}}>{"\u25be"}</span>
      </button>
      {open && (
        <div ref={panelRef} data-tr-panel={id}
          style={{position:"fixed",left:pos?pos.left:0,top:pos?pos.top:0,visibility:pos?"visible":"hidden",zIndex:99,
            display:"flex",flexDirection:"column",maxHeight:pos?pos.maxH:"60vh",minWidth,maxWidth:"calc(100vw - 16px)",boxSizing:"border-box",
            background:"var(--bg)",border:"1px solid var(--bd2)",borderRadius:7,boxShadow:"0 4px 16px rgba(0,0,0,.12)"}}>
          <div data-tr-panel-body style={{overflowY:"auto",minHeight:0,padding:"8px 4px"}}>{children}</div>
          {footer && <div style={{borderTop:"1px solid var(--bd)",padding:"6px 14px",flexShrink:0}}>{footer}</div>}
        </div>
      )}
    </div>
  );
}

export function MasterView({data, setData, updateTask, setNotesCtx, goToTask}) {
  const [localEdit, setLocalEdit] = useState(null);
  const [selCell, setSelCell] = useState(null); // {ri, ci}
  const tableWrapRef = useRef(null);
  const cellFocusTimer = useRef(null); // pending wrapper-focus queued by a single click — skipped/replaced on multi-clicks
  // A double-click is two clicks THEN a dblclick: each of the first two schedules onCellClick's
  // setTimeout(0) wrapper-refocus, and — unlike a second CLICK, which cancels the first click's
  // timer — nothing ever cancelled the SECOND one for the dblclick that follows. It fired AFTER
  // the editor had already mounted and focused its own input, silently stealing focus back to the
  // table wrapper — so a real double-click-to-edit opened the picker but every keystroke landed on
  // the table instead (measured live: MasterView's Owner AND Name columns both did this, unrelated
  // to which column — the timer, not the editor, was always the bug). Cancel it before opening.
  const openEdit = payload => { clearTimeout(cellFocusTimer.current); setLocalEdit(payload); };
  // The toolbar's four dropdowns (filter | group | show | columns) share ONE open slot, so opening one closes any other.
  const [openMenu, setOpenMenu] = useState(null);
  useEffect(() => {
    if (!openMenu) return;
    const down = e => { if (!(e.target && e.target.closest && e.target.closest("[data-tr-menu]"))) setOpenMenu(null); };   // outside click (a press on another button just switches menus)
    const key = e => { if (e.key === "Escape") { e.stopPropagation(); setOpenMenu(null); } };
    const away = () => setOpenMenu(null);   // the shell around this iframe took focus
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key, true);
    window.addEventListener("blur", away);
    return () => { document.removeEventListener("pointerdown", down, true); document.removeEventListener("keydown", key, true); window.removeEventListener("blur", away); };
  }, [openMenu]);

  const masterSort = data.masterSort || {col:"health", dir:"asc"};
  const setSort = (col) => {
    if (masterSort.col === col) {
      if (masterSort.dir === "asc") setData(d=>({...d, masterSort:{col, dir:"desc"}}));
      else setData(d=>({...d, masterSort:{col:null, dir:"asc"}}));
    } else {
      setData(d=>({...d, masterSort:{col, dir:"asc"}}));
    }
  };

  const visCols = data.masterCols || DEFAULT_MASTER_COLS;
  const setVisCols = cols => setData(d => ({...d, masterCols: cols}));

  // One-time fix: ensure "parent" sits immediately after "name"
  useEffect(() => {
    if (!visCols.includes('parent') || !visCols.includes('name')) return;
    const ni = visCols.indexOf('name'), pi = visCols.indexOf('parent');
    if (pi === ni + 1) return;
    const next = visCols.filter(k => k !== 'parent');
    next.splice(ni + 1, 0, 'parent');
    setVisCols(next);
  }, []);

  const [dragMCol, setDragMCol] = useState(null);
  const [dragMOver, setDragMOver] = useState(null);
  const reorderMCols = (fromKey, toKey) => {
    if (fromKey === toKey) return;
    const next = [...visCols];
    const fi = next.indexOf(fromKey), ti = next.indexOf(toKey);
    if (fi < 0 || ti < 0) return;
    next.splice(fi, 1);
    next.splice(ti, 0, fromKey);
    setVisCols(next);
  };

  // Level filter: { leafOnly: bool, depths: [0,1,2,3] }
  const DEFAULT_LVL = {leafOnly: false, depths: [0,1,2,3]};
  const lvlFilter = data.masterLevelFilter || DEFAULT_LVL;
  const setLvlFilter = f => setData(d => ({...d, masterLevelFilter: f}));
  const lvlActive = lvlFilter.leafOnly || lvlFilter.depths.length < 4;

  // NEW-1 — the Task Report's Filter (see "Task Report filter" above): checked statuses and checked projects, [] = no narrowing.
  const statusOptions = useMemo(() => reportStatusOptions(data.settings?.customHealth), [data.settings?.customHealth]);
  const statusKeys = useMemo(() => reportStatusKeys(data.masterHealthFilter, statusOptions), [data.masterHealthFilter, statusOptions]);
  const setStatusKeys = keys => setData(d => ({...d, masterHealthFilter: keys}));
  const projectIds = useMemo(() => Object.values(data.projects).map(p => String(p.id)), [data.projects]);
  const projectKeys = useMemo(() => reportProjectKeys(data.masterProjectFilter, projectIds), [data.masterProjectFilter, projectIds]);
  const setProjectKeys = keys => setData(d => ({...d, masterProjectFilter: keys}));
  const clearFilters = () => setData(d => ({...d, masterHealthFilter: [], masterProjectFilter: []}));
  const filterCount = reportFilterCount(statusKeys, projectKeys);
  const statusName = o => (data.settings?.healthLabelOverrides?.[o.k]) || o.label;   // a renamed built-in status reads as renamed
  const totalTaskCount = useMemo(() => Object.values(data.projects).reduce((s, p) => s + p.tasks.length, 0), [data.projects]);

  // Per-project rolled status, so a PARENT row shows the worst-of-its-children status (matching
  // the grid/Gantt) instead of its own stale `health`. Recomputes when projects/settings/today
  // change so the at-risk filter, sort and color stay live (overdue/due-soon + CF-rule edits).
  const rows = useMemo(() => {
    const dispOf = (t, isParent, rolled, byId) => isParent ? (rolled[t.id] || t.health) : computeDisplayHealth(t, data.settings, byId);
    return Object.values(data.projects).flatMap(p => {
      const childIds = new Set(p.tasks.filter(t => t.parentId !== null).map(t => t.parentId));
      const rolled = computeRolledHealth(p.tasks, data.settings);
      const byId = {}; p.tasks.forEach(t => byId[t.id] = t);   // predecessorLate lookup, one per project
      // B1873360 — computed once per schedule, not per cell: the bare name AND the qualified
      // "<Project> / <Schedule>" label a row's owner needs are both derived from the same
      // schedule object `p`, so every row of this schedule shares one (cheap) computation.
      const { ownerLabel } = scheduleLabelParts(p);
      const projLabel = crossScheduleLabel(p);
      const _own = ownerOf(p); // NEW-1 — the project (group) this schedule belongs to; null for an org-owned one
      const projSiteId = _own.kind === OWNER_KIND_SITE ? _own.siteId : null;
      return p.tasks
        .map(t => {
          let depth = 0, cur = t;
          while (cur && cur.parentId !== null) {
            depth++;
            cur = p.tasks.find(x => x.id === cur.parentId) || null;
          }
          const isLeaf = !childIds.has(t.id);
          return {...t, projName: p.name, projId: p.id, projSiteId, projOwnerLabel: ownerLabel, projLabel, depth, isLeaf, _disp: dispOf(t, !isLeaf, rolled, byId), _pct: effectivePercentComplete(t, p.tasks)};
        });
    });
  }, [data.projects, data.settings, NOW]);

  // "Show" (outline level) first, then the Filter — the dropdown's counts are taken from the Show-narrowed rows so every count
  // equals the rows that box would show.
  const levelRows = useMemo(() => {
    if (lvlFilter.leafOnly) return rows.filter(r => r.isLeaf);
    return rows.filter(r => lvlFilter.depths.includes(Math.min(r.depth, 3)));
  }, [rows, lvlFilter]);
  const facets = useMemo(() => reportFacetCounts(levelRows, statusKeys, projectKeys), [levelRows, statusKeys, projectKeys]);
  // ONE classification: a row passes on its DISPLAYED status (_disp — the value that paints its status pill and orders the
  // Status sort) and on its project. The header pill, every group pill and the rows all derive from this one list.
  const filteredRows = useMemo(
    () => levelRows.filter(r => reportStatusPasses(statusKeys, r._disp) && reportProjectPasses(projectKeys, r.projId)),
    [levelRows, statusKeys, projectKeys]);
  const projOrder = useProjectOrder();   // the owner's project order (the shell's push) — orders the groups AND the Filter's project list
  // The Filter's project list, in the order the grouped report uses.
  const projectChoices = useMemo(() => groupRowsByProject(
    Object.values(data.projects).map(p => ({ projId: String(p.id), projSiteId: (ownerOf(p).kind === OWNER_KIND_SITE ? ownerOf(p).siteId : null), projOwnerLabel: scheduleLabelParts(p).ownerLabel, projName: p.name, projLabel: crossScheduleLabel(p) })),
    projOrder.ids), [data.projects, projOrder.ids]);

  const getParentName = (t) => {
    if (!t.parentId) return "—";
    const proj = data.projects[t.projId];
    return proj?.tasks.find(x => x.id === t.parentId)?.name || "—";
  };
  const _getPredStr = (t) => {
    const proj = data.projects[t.projId];
    if (!proj) return "";
    return normPreds(t.predecessors).map(p => {
      const pt = proj.tasks.find(x => x.id === p.id);
      return pt ? `${p.id} – ${pt.name}` : "";
    }).filter(Boolean).join("; ");
  };
  const _getSuccStr = (t) => {
    const proj = data.projects[t.projId];
    if (!proj) return "";
    return proj.tasks.filter(x =>
      normPreds(x.predecessors).some(p => p.id === t.id)
    ).map(x => `${x.id} – ${x.name}`).join("; ");
  };

  /* B1341728 — same split as the project grid: `applyCommit` WRITES, `commit` writes and closes.
   * A write-through (tokens-class) editor saves what it renders without closing itself. */
  const applyCommit = (t, col, val) => {
    // Only call updateTask if the value actually changed — prevents no-op edits
    // from triggering cascadeDates and shifting successor start dates
    if (col==="duration") {
      // Unit-aware like the project grid: honor d/w/cd/mo/y (was parseInt, which silently dropped any
      // suffix). Visible error on garbage, never a silent 0. updateTask derives duration+end from the unit.
      const parsed = parseDurationInput(val);
      if (parsed.error) { showToast(parsed.error); return; }
      if (parsed.value !== taskDurValue(t) || parsed.unit !== taskDurUnit(t)) updateTask(t.id, {durValue: parsed.value, durUnit: parsed.unit}, t.projId);
    } else if (col==="health") {
      if (val !== t.health) updateTask(t.id, {health: val}, t.projId);
    } else if (col==="percentComplete") {
      const nv = Math.max(0, Math.min(100, parseInt(val)||0));
      if (nv !== (t.percentComplete||0)) updateTask(t.id, {percentComplete: nv}, t.projId);
    } else if (col==="name") {
      if (val.trim() && val.trim() !== t.name) updateTask(t.id, {name: val.trim()}, t.projId);
    } else if (col==="responsibleParty") {
      const next = Array.isArray(val) ? val : ownerListOf({responsibleParty: val});
      const cur = ownerListOf(t);
      if (next.length !== cur.length || next.some((n,i) => n !== cur[i])) updateTask(t.id, {responsibleParty: next}, t.projId);
    }
  };

  // Close the editor and return focus to the table wrapper so arrow-key navigation resumes.
  const closeEdit = () => {
    setLocalEdit(null);
    setTimeout(() => tableWrapRef.current?.focus({preventScroll:true}), 0);
  };

  const commit = (t, col, val) => {
    applyCommit(t, col, val);
    closeEdit();
  };
  const isE = (t, col) => localEdit?.id===t.id && localEdit?.projId===t.projId && localEdit?.col===col;

  const fmtDate = s => {
    if (!s) return "";
    const [y,m,d] = s.split('-');
    if (!y||!m||!d) return "";   // B503: guard a non-ISO value (matches fmtD) — never render NaN/NaN/yy
    return String(+m).padStart(2,'0')+'/'+String(+d).padStart(2,'0')+'/'+y.slice(2);
  };

  const masterGroupBy = data.masterGroupBy || null; // null | "project"
  const setGroupBy = v => setData(d => ({...d, masterGroupBy: v}));

  const HEALTH_ORDER = {red:0, yellow:1, paused:2, gray:3, green:4};

  const sortedRows = useMemo(() => {
    if (!masterSort.col) return filteredRows;
    const {col, dir} = masterSort;
    const mult = dir === "asc" ? 1 : -1;
    return [...filteredRows].sort((a, b) => {
      let av, bv;
      switch(col) {
        case "health":      av = HEALTH_ORDER[a._disp]??5; bv = HEALTH_ORDER[b._disp]??5; break;  // rolled for parents (B486-out)
        case "id":          av = a.id;                           bv = b.id;                         break;
        case "duration":    av = a.duration;                     bv = b.duration;                   break;
        case "percentComplete": av = a._pct ?? effectivePercentComplete(a);  bv = b._pct ?? effectivePercentComplete(b);         break;
        case "start":       av = a.start;                        bv = b.start;                      break;
        case "end":         av = a.end;                          bv = b.end;                        break;
        // B1873360 — sorts on the qualified label (two schedules can share a bare name), with
        // projId appended as a stable tiebreak so two identically-labelled schedules' rows can
        // never interleave nondeterministically when the labels alone tie.
        case "project":     av = `${(a.projLabel||"").toLowerCase()}\u0000${String(a.projId)}`; bv = `${(b.projLabel||"").toLowerCase()}\u0000${String(b.projId)}`; break;
        case "name":        av = (a.name||"").toLowerCase();     bv = (b.name||"").toLowerCase();   break;
        case "responsibleParty": av=(ownerListOf(a)[0]||"").toLowerCase(); bv=(ownerListOf(b)[0]||"").toLowerCase(); break;   // NEW-1 — sort/group read the FIRST (accountable) owner only
        case "notes":       av = (a.notes||[]).length;           bv = (b.notes||[]).length;         break;
        default:            av = 0; bv = 0;
      }
      if (av < bv) return -1 * mult;
      if (av > bv) return  1 * mult;
      return 0;
    });
  }, [filteredRows, masterSort]);

  // NEW-1 (2026-10-08) — project groups follow the owner's project order (the shell's push). The column
  // sort above orders the rows WITHIN a group and never reaches this.
  const groupedRows = useMemo(
    () => masterGroupBy === "project" ? groupRowsByProject(sortedRows, projOrder.ids) : null,
    [masterGroupBy, sortedRows, projOrder.ids]);
  // The projects that can be moved: a group is movable only when it belongs to a project the shell has
  // in the order list (an org-owned schedule is not a project, so it has no grip).
  const movableIds = useMemo(() => {
    const out = [];
    (groupedRows || []).forEach(g => { if (g.siteId != null && g.rank !== Infinity && !out.includes(g.siteId)) out.push(g.siteId); });
    return out;
  }, [groupedRows]);
  const canReorderGroups = !!projOrder.canOrder && movableIds.length > 1;
  const [grpDrag, setGrpDrag] = useState(null); // {siteId, at} while a group grip is held
  const grpStopRef = useRef(null);
  useEffect(() => () => { if (grpStopRef.current) grpStopRef.current(); }, []);
  const requestGroupMove = (siteId, dest) =>
    postToShell({type: "planar:project-order-move", groupId: siteId, dest, visibleIds: movableIds});
  const pickGroupMenu = (siteId, to) => {
    const pos = movableIds.indexOf(siteId);
    if (pos < 0) return;
    if (to === "top" || to === "bottom") requestGroupMove(siteId, {to});
    else requestGroupMove(siteId, {index: to === "up" ? pos - 1 : pos + 1}); // index among the OTHER visible projects
  };
  // Drag a whole project group by its grip. Works with a finger (the grip has touch-action:none); the
  // table wrap auto-scrolls near its edges so a long report can be dragged past what is visible; Esc cancels.
  const startGroupDrag = (e, siteId) => {
    if (e.button != null && e.button !== 0) return;
    const wrap = tableWrapRef.current;
    if (!wrap) return;
    e.preventDefault(); e.stopPropagation();
    const others = movableIds.filter(x => x !== siteId);
    const firstHeaders = () => {
      const m = new Map();
      wrap.querySelectorAll("tr[data-grp-site]").forEach(tr => { const k = tr.getAttribute("data-grp-site"); if (k && !m.has(k)) m.set(k, tr); });
      return m;
    };
    const atFor = (y) => {
      const hs = firstHeaders();
      let at = 0;
      for (const id of others) {
        const tr = hs.get(id);
        if (!tr) continue;
        const b = tr.getBoundingClientRect();
        if (y > b.top + b.height / 2) at++;
      }
      return at;
    };
    let y = e.clientY, raf = 0, last = atFor(y);
    setGrpDrag({siteId, at: last});
    const tick = () => {
      const b = wrap.getBoundingClientRect();
      const zone = 28;
      if (y < b.top + zone) wrap.scrollTop -= 8;
      else if (y > b.bottom - zone) wrap.scrollTop += 8;
      const at = atFor(y);
      if (at !== last) { last = at; setGrpDrag({siteId, at}); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const move = (ev) => { y = ev.clientY; };
    const releaseCursor = window.pinSchedCursor("grabbing", { onExit: () => end(false) });   // the hand stays closed when the pointer leaves the grip
    const end = (commit) => {
      releaseCursor();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key, true);
      cancelAnimationFrame(raf);
      grpStopRef.current = null;
      setGrpDrag(null);
      if (commit) requestGroupMove(siteId, {index: last});
    };
    const up = () => end(true);
    const cancel = () => end(false);
    const key = (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); end(false); } };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key, true);
    grpStopRef.current = () => end(false);
  };
  // Where the drop line sits while dragging: above the first header of the project now at `at`
  // among the others, or below the last header of the last one.
  const dragOthers = grpDrag ? movableIds.filter(x => x !== grpDrag.siteId) : [];
  const lineAboveSite = grpDrag && grpDrag.at < dragOthers.length ? dragOthers[grpDrag.at] : null;
  const lineBelowSite = grpDrag && grpDrag.at >= dragOthers.length && dragOthers.length ? dragOthers[dragOthers.length - 1] : null;
  const lastGroupOfSite = (sid) => { let idx = -1; (groupedRows || []).forEach((g, i) => { if (g.siteId === sid) idx = i; }); return idx; };

  const [colWidths, setColWidths] = useState(() => {
    const saved = data.masterColWidths || {};
    return Object.fromEntries(Object.entries(DEFAULT_MASTER_WIDTHS).map(([k,v]) => [k, saved[k] ?? v]));
  });
  const startResize = (colKey, e) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX, startW = colWidths[colKey];
    let latestW = startW;
    const move = ev => { latestW = Math.max(40, startW + ev.clientX - startX); setColWidths(w => ({...w, [colKey]: latestW})); };
    const release = window.pinSchedCursor("col-resize", { onExit: () => up() });
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      release();
      setData(d => ({...d, masterColWidths: {...colWidths, [colKey]: latestW}}));
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };

  const autoSizeMCol = (colKey) => {
    const colDef = MASTER_COL_DEFS.find(c => c.k === colKey);
    if (!colDef) return;
    const fmtD = s => { if(!s) return ''; const [y,m,d]=s.split('-'); return `${String(+m).padStart(2,'0')}/${String(+d).padStart(2,'0')}/${(y||'').slice(2)}`; };
    const values = sortedRows.map(t => {
      let val = '';
      switch(colKey) {
        case 'project': val = t.projLabel||''; break;
        case 'id': val = String(t.id); break;
        case 'name': val = t.name||''; break;
        case 'start': val = fmtD(t.start); break;
        case 'end': val = fmtD(t.end); break;
        case 'duration': val = fmtTaskDuration(t, !t.isLeaf)||`${t.duration}d`; break;   // match the unit-aware cell display (B463072: a summary prints its ROLLED span)
        case 'health': val = HEALTH[t.health]?.label||''; break;
        case 'percentComplete': val = `${t._pct ?? effectivePercentComplete(t)}%`; break;
        case 'responsibleParty': val = ownerDisplayParts(ownerListOf(t)).label; break;
        case 'notes': val = t.notes?.length>0?`${t.notes.length} entr`:'+ Add'; break;
        case 'parent': {
          const p=data.projects[t.projId]?.tasks.find(x=>x.id===t.parentId);
          val=p?p.name:'—'; break;
        }
        default: val = String(t[colKey]||'');
      }
      return val;
    });
    const n = {...colWidths, [colKey]: measuredColWidth(colDef.label, values, 40)};
    setColWidths(n);
    setData(d => ({...d, masterColWidths: n}));
  };

  const activeCols = visCols.map(k => MASTER_COL_DEFS.find(c => c.k === k)).filter(Boolean);
  // When grouped by project, hide the project column — it's redundant with the group header
  const displayCols = masterGroupBy === "project" ? activeCols.filter(c => c.k !== "project") : activeCols;

  // ── Jump column ("↗ open in project") ─────────────────────
  // Fixed 30px leading column, outside the configurable masterCols system:
  // not sortable, not draggable, not resizable, always visible (touch-friendly
  // on mobile — no hover required). Clicking navigates to the task's exact row
  // in the project grid via goToTask, which expands ancestors and scrolls.
  const renderJumpCell = (t) => (
    <td key="__jump" style={{width:30,minWidth:30,maxWidth:30,padding:0,textAlign:"center",
      borderBottom:"1px solid var(--bd)",borderRight:"1px solid var(--bd)"}}>
      <button title={`Open row in ${t.projLabel}`}
        onClick={e => { e.stopPropagation(); if (goToTask) goToTask(t.projId, t.id); }}
        onMouseEnter={e => { e.currentTarget.style.color = "var(--blue)"; e.currentTarget.style.background = "rgba(9,105,218,0.08)"; }}
        onMouseLeave={e => { e.currentTarget.style.color = "var(--mut)";  e.currentTarget.style.background = "transparent"; }}
        style={{width:20,height:20,padding:0,border:"none",borderRadius:4,background:"transparent",
          color:"var(--mut)",cursor:"pointer",display:"inline-flex",alignItems:"center",justifyContent:"center",
          verticalAlign:"middle",transition:"color .12s, background .12s"}}>
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 2 H2.5 A.5 .5 0 0 0 2 2.5 V9.5 A.5 .5 0 0 0 2.5 10 H9.5 A.5 .5 0 0 0 10 9.5 V7" />
          <path d="M7.2 2 H10 V4.8" />
          <path d="M10 2 L5.8 6.2" />
        </svg>
      </button>
    </td>
  );
  const EDITABLE_KEYS = new Set(["name","duration","health","percentComplete","responsibleParty","notes"]);

  const handleTableKey = e => {
    if (localEdit) return; // editing — let the input handle keys
    if (!selCell) return;
    const {ri, ci} = selCell;
    // Alt+Down on health cell — must be checked BEFORE plain ArrowDown
    if (e.altKey && e.key === "ArrowDown") {
      const col = displayCols[ci];
      const t = sortedRows[ri];
      if (col?.k === "health" && t) {
        e.preventDefault();
        setLocalEdit({id: t.id, projId: t.projId, col: "health"});
      }
      return;
    }
    if (e.key === "ArrowDown")  { e.preventDefault(); setSelCell({ri: Math.min(sortedRows.length-1, ri+1), ci}); return; }
    if (e.key === "ArrowUp")    { e.preventDefault(); setSelCell({ri: Math.max(0, ri-1), ci}); return; }
    if (e.key === "ArrowRight") { e.preventDefault(); setSelCell({ri, ci: Math.min(displayCols.length-1, ci+1)}); return; }
    if (e.key === "ArrowLeft")  { e.preventDefault(); setSelCell({ri, ci: Math.max(0, ci-1)}); return; }
    if (e.key === "Escape")     { setSelCell(null); return; }
    if (e.key === "Enter" || e.key === "F2") {
      const col = displayCols[ci];
      const t = sortedRows[ri];
      if (col && t && EDITABLE_KEYS.has(col.k)) {
        e.preventDefault();
        if (col.k === 'notes') { setNotesCtx({taskId:t.id, projectId:t.projId, initChar:null}); return; }
        if (col.k === 'duration' && !t.isLeaf) return; // parent durations roll up — locked like the project grid
        setLocalEdit({id: t.id, projId: t.projId, col: col.k});
      }
      return;
    }
    // Printable character on a selected editable cell → open edit immediately
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const col = displayCols[ci];
      const t = sortedRows[ri];
      if (!col || !t || !EDITABLE_KEYS.has(col.k)) return;
      if (col.k === 'health') return; // dropdown, use Enter
      if (col.k === 'notes') { e.preventDefault(); setNotesCtx({taskId:t.id, projectId:t.projId, initChar:e.key}); return; }
      const isNum = col.k === 'duration' || col.k === 'percentComplete';
      if (isNum && !/\d/.test(e.key)) return;
      if (col.k === 'duration' && !t.isLeaf) return; // parent durations roll up — locked like the project grid
      e.preventDefault();
      setLocalEdit({id: t.id, projId: t.projId, col: col.k, initChar: e.key});
    }
  };

  const renderCell = (t, col, ri) => {
    const dispHealth = t._disp ?? computeDisplayHealth(t, data.settings, null);  // rolled-up for parents, computed for leaves; _disp is always set by `rows` above, so this never actually runs the engine live
    const h = HEALTH[dispHealth];
    const ci = displayCols.indexOf(col);  // selection/nav basis must match the RENDERED columns (displayCols), not activeCols — in grouped-by-project mode the hidden Project column otherwise stole index 0 and the outline vanished
    const isSel = selCell && selCell.ri === ri && selCell.ci === ci;
    const selStyle = isSel ? {outline:"2px solid #2563eb",outlineOffset:"-2px"} : {};
    // Single click selects the cell, then bounces focus back to the wrapper so
    // arrow-key nav works. Double-click mounts an autoFocus editor input — so
    // on the 2nd click of a multi-click (e.detail > 1) we must NOT queue the
    // wrapper-focus: it would fire right after the editor mounts, blur the
    // input, and its onBlur → commit would close the edit "after a millisecond".
    const onCellClick = (e) => {
      setSelCell({ri, ci});
      if (e && e.detail > 1) return;
      clearTimeout(cellFocusTimer.current);
      cellFocusTimer.current = setTimeout(()=>tableWrapRef.current?.focus({preventScroll:true}),0);
    };
    const isFirstCol = displayCols[0] === col;
    const stripeColor = h.dot === "#ffffff" ? "#d1d5db" : h.dot;
    const tdBase = {padding:"6px 10px", borderBottom:"1px solid var(--bd)", borderRight:"1px solid var(--bd)",
      borderLeft: isFirstCol ? `3px solid ${stripeColor}` : "none",
      overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
      width:colWidths[col.k], minWidth:colWidths[col.k], maxWidth:colWidths[col.k], cursor:"default", ...selStyle};
    switch(col.k) {
      case "project":
        return <td key={col.k} onClick={onCellClick} title={t.projLabel} style={{...tdBase,color:"#1d4ed8",fontSize:11}}>{t.projLabel}</td>;
      case "id":
        return <td key={col.k} onClick={onCellClick} style={{...tdBase,color:"var(--mut)",fontSize:11}}>{t.id}</td>;
      case "parent":
        return <td key={col.k} onClick={onCellClick} style={{...tdBase,color:"var(--mut)",fontSize:11}}>{getParentName(t)}</td>;
      case "name":
        return <td key={col.k} style={tdBase} onClick={onCellClick} onDoubleClick={()=>openEdit({id:t.id,projId:t.projId,col:"name"})}>
          {isE(t,"name")
            ? <input {...NO_AUTOFILL} autoFocus style={{display:"block",width:"100%",height:"18px",border:"none",borderBottom:"1.5px solid var(--blue)",outline:"none",background:"transparent",fontSize:12,fontFamily:"inherit",color:"var(--txt)",padding:"0 2px"}} defaultValue={localEdit?.initChar ?? t.name}
                onBlur={e=>commit(t,"name",e.target.value)}
                onKeyDown={e=>{if(e.key==="Enter")commit(t,"name",e.target.value);if(e.key==="Escape")setLocalEdit(null);}} />
            : <span style={{color:"#1f2328",fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",display:"block"}}>{t.name}</span>}
        </td>;
      case "start":
        return <td key={col.k} onClick={onCellClick} style={{...tdBase,fontSize:11,color:"var(--mut)"}}>{fmtDate(t.start)}</td>;
      case "end":
        return <td key={col.k} onClick={onCellClick} style={{...tdBase,fontSize:11,color:"var(--mut)"}}>{fmtDate(t.end)}</td>;
      case "duration":
        // Parent durations roll up from children — locked, same as the project grid.
        return <td key={col.k} style={tdBase} onClick={onCellClick} onDoubleClick={()=>{ if (!t.isLeaf) return; openEdit({id:t.id,projId:t.projId,col:"duration"}); }}>
          {isE(t,"duration")
            ? <input {...NO_AUTOFILL} autoFocus style={{display:"block",width:"100%",height:"18px",border:"none",borderBottom:"1.5px solid var(--blue)",outline:"none",background:"transparent",fontSize:12,fontFamily:"inherit",color:"var(--txt)",padding:"0 2px"}} defaultValue={localEdit?.initChar ?? fmtTaskDuration(t)} onBlur={e=>commit(t,"duration",e.target.value)} onKeyDown={e=>{if(e.key==="Enter")commit(t,"duration",e.target.value);if(e.key==="Escape")setLocalEdit(null);}} />
            : <span style={{color:"var(--mut)"}} title={t.isLeaf ? (durTooltip(t)||undefined) : "Computed from subtasks"}>{fmtTaskDuration(t, !t.isLeaf)||"0d"}</span>}
        </td>;
      case "health":
        return <td key={col.k} data-hmenu="1" onClick={onCellClick}
          onDoubleClick={()=>openEdit({id:t.id,projId:t.projId,col:"health"})}
          style={{...tdBase,cursor:"default",position:"relative",
            overflow:isE(t,"health")?"visible":"hidden",
            zIndex:isE(t,"health")?50:"auto"}}>
          {isE(t,"health") && <HealthDropMenu
            value={t.health}
            onSelect={val=>commit(t,"health",val)}
            onClose={()=>setLocalEdit(null)} />}
          <span style={{background:h.bar,borderRadius:999,
            padding:"3px 8px",fontSize:11,display:"inline-flex",alignItems:"center",gap:4,
            color:HDARK[dispHealth]||"#374151",fontWeight:500,whiteSpace:"nowrap",maxWidth:"100%"}}>
            <span style={{width:6,height:6,borderRadius:"50%",background:h.dot==="#ffffff"?"#d1d5db":h.dot,flexShrink:0}} />{h.label}
          </span>
        </td>;
      case "percentComplete":
        return <td key={col.k} style={tdBase} onClick={onCellClick} onDoubleClick={()=>openEdit({id:t.id,projId:t.projId,col:"percentComplete"})}>
          {isE(t,"percentComplete")
            ? <input {...NO_AUTOFILL} autoFocus style={{display:"block",width:"100%",height:"18px",border:"none",borderBottom:"1.5px solid var(--blue)",outline:"none",background:"transparent",fontSize:12,fontFamily:"inherit",color:"var(--txt)",padding:"0 2px"}} defaultValue={localEdit?.initChar ?? (t.percentComplete||0)} onBlur={e=>commit(t,"percentComplete",e.target.value)} onKeyDown={e=>{if(e.key==="Enter")commit(t,"percentComplete",e.target.value);if(e.key==="Escape")setLocalEdit(null);}} />
            : <span style={{color:"var(--mut)"}}>{t._pct ?? effectivePercentComplete(t)}%</span>}
        </td>;
      case "responsibleParty": {
        const { label, title } = ownerDisplayParts(ownerListOf(t));
        return <td key={col.k} style={tdBase} onClick={onCellClick} onDoubleClick={()=>openEdit({id:t.id,projId:t.projId,col:"responsibleParty"})}>
          {isE(t,"responsibleParty")
            ? <ContactPicker
                owners={ownerListOf(t)}
                seedText={localEdit?.initChar != null ? localEdit.initChar : ''}
                contacts={data.settings?.contacts||[]}
                onOwnersChange={(names, newContacts) => {
                  if (newContacts && newContacts.length) {
                    setData(d => ({...d, settings:{...d.settings, contacts:[...(d.settings?.contacts||[]), ...newContacts.map(nc => ({id:Date.now()+Math.random(), ...nc}))]}}));
                  }
                  applyCommit(t,"responsibleParty",names);
                }}
                onClose={closeEdit}
              />
            : <span title={title || undefined} style={{color:"var(--mut)"}}>{label || <span style={{color:"var(--bd2)"}}>—</span>}</span>}
        </td>;
      }
      case "predecessors": {
        const _proj = data.projects[t.projId];
        const _preds = normPreds(t.predecessors);
        const _getName = id => _proj?.tasks.find(x=>x.id===id)?.name ?? `#${id}`;
        const _ds = {fontSize:12,display:"flex",alignItems:"center",overflow:"hidden",padding:0,minHeight:18};
        return <td key={col.k} style={{...tdBase,padding:"3px 6px"}}>
          {_preds.length ? <DepCell items={_preds} renderLabel={p=>fmtPreds([p])} renderName={p=>_getName(p.id)} s={_ds} /> : <span style={{color:"var(--bd2)"}}>—</span>}
        </td>;
      }
      case "successors": {
        const _proj = data.projects[t.projId];
        const _succs = _proj ? _proj.tasks.filter(x=>normPreds(x.predecessors).some(p=>p.id===t.id)) : [];
        const _ds = {fontSize:12,display:"flex",alignItems:"center",overflow:"hidden",padding:0,minHeight:18};
        return <td key={col.k} style={{...tdBase,padding:"3px 6px"}}>
          {_succs.length ? <DepCell items={_succs} renderLabel={x=>String(x.id)} renderName={x=>x.name} s={_ds} /> : <span style={{color:"var(--bd2)"}}>—</span>}
        </td>;
      }
      case "notes": {
        const noteList = [...(t.notes||[])].reverse();
        const visible = noteList.slice(0,2);
        const extra = noteList.length - 2;
        const fmtNoteDate = s => { try { const [y,m,d]=(s||"").split("-"); return d?`${+m}/${+d}/${(y||"").slice(2)}`:s; } catch{return s;} };
        return <td key={col.k} style={{...tdBase,whiteSpace:"normal",verticalAlign:"top",cursor:"pointer",minWidth:colWidths[col.k]}}
          onClick={e=>{onCellClick();setNotesCtx({taskId:t.id,projectId:t.projId});}}>
          {noteList.length===0
            ? <span style={{color:"var(--bd2)",fontSize:11}}>+ Add</span>
            : <div style={{display:"flex",flexDirection:"column",gap:5}}>
                {visible.map(n=>(
                  <div key={n.id} style={{display:"flex",alignItems:"baseline",gap:5,lineHeight:1.4}}>
                    <span style={{fontSize:10,color:"var(--mut)",fontFamily:"inherit",flexShrink:0}}>{fmtNoteDate(n.date)}</span>
                    <span style={{fontSize:11,color:"var(--mut)",flexShrink:0}}>|</span>
                    <span style={{fontSize:11,color:"#374151"}}>{n.text}</span>
                  </div>
                ))}
                {extra>0 && <span style={{fontSize:10,color:"#1d4ed8",fontWeight:500}}>+{extra} more…</span>}
              </div>
          }
        </td>;
      }
      default: return <td key={col.k} style={tdBase} />;
    }
  };

  return (
    <div style={{flex:1,minHeight:0,display:"flex",flexDirection:"column",overflow:"hidden",
      padding:"12px 14px 14px",background:"var(--surf)"}}>
      {/* Header bar */}
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12,flexShrink:0,flexWrap:"wrap",rowGap:8}}>
        <span style={{color:"var(--amber)",fontWeight:600,fontSize:13,letterSpacing:".08em"}}>TASK REPORT</span>
        <span style={{background:"#dbeafe",color:"#1d4ed8",borderRadius:8,padding:"1px 8px",fontSize:10}}>{filteredRows.length}</span>

        {/* Toolbar (NEW-1): Filter · Group by · Show · Columns, one matching button style, one shared open slot.
            Filter = Status + Project checkboxes with counts, filtering immediately; the panel stays open while ticking. */}
        <div data-report-toolbar style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",justifyContent:"flex-end"}}>
          <ReportMenu id="filter" openMenu={openMenu} setOpenMenu={setOpenMenu} active={filterCount>0} minWidth={250}
            label={<>
              <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true" style={{flexShrink:0}}><path d="M1.5 2.5h13L9.5 8.6v4.6l-3 1.5V8.6z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>
              Filter
              {filterCount>0 && <span data-filter-badge style={{background:"var(--amber)",color:"#fff",borderRadius:8,minWidth:15,height:15,padding:"0 4px",fontSize:10,fontWeight:700,lineHeight:"15px",textAlign:"center",boxSizing:"border-box"}}>{filterCount}</span>}
            </>}
            footer={<span role="button" tabIndex={0} data-filter-clear style={{fontSize:10,color:"var(--mut)",cursor:"pointer",textDecoration:"underline"}}
              onClick={clearFilters} onKeyDown={e=>{ if (e.key==="Enter"||e.key===" ") { e.preventDefault(); clearFilters(); } }}>Clear all</span>}>
            <div style={REPORT_MENU_SECTION}>Status</div>
            {statusOptions.map(o => {
              const on = statusKeys.includes(o.k), h = HEALTH[o.k] || {};
              return (
                <label key={o.k} data-filter-row="status" style={REPORT_MENU_ROW}
                  onMouseEnter={e=>e.currentTarget.style.background="var(--surf)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <input type="checkbox" data-filter-status={o.k} checked={on} onChange={()=>setStatusKeys(reportStatusToggle(statusKeys,o.k,statusOptions))}
                    style={{accentColor:"var(--amber)",width:12,height:12,flexShrink:0}} />
                  <span style={{width:7,height:7,borderRadius:"50%",flexShrink:0,background:h.dot||"#d1d5db",border:h.border&&h.border!=="none"?h.border:"none",boxSizing:"border-box"}} />
                  <span style={{fontSize:12,color:"var(--txt)",flex:1,minWidth:0}}>{statusName(o)}</span>
                  <span data-filter-count style={REPORT_MENU_COUNT}>{facets.status[o.k]||0}</span>
                </label>
              );
            })}
            <div style={{height:1,background:"var(--bd)",margin:"6px 0 2px"}} />
            <div style={REPORT_MENU_SECTION}>Project</div>
            {projectChoices.map(g => {
              const on = projectKeys.includes(String(g.projId));
              return (
                <label key={g.projId} data-filter-row="project" style={REPORT_MENU_ROW}
                  onMouseEnter={e=>e.currentTarget.style.background="var(--surf)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <input type="checkbox" data-filter-project={g.projId} checked={on} onChange={()=>setProjectKeys(reportProjectToggle(projectKeys,g.projId,projectIds))}
                    style={{accentColor:"var(--amber)",width:12,height:12,flexShrink:0}} />
                  <span style={{fontSize:12,color:"var(--txt)",flex:1,minWidth:0,overflowWrap:"anywhere"}}>{g.label}</span>
                  <span data-filter-count style={REPORT_MENU_COUNT}>{facets.project[String(g.projId)]||0}</span>
                </label>
              );
            })}
          </ReportMenu>

          <ReportMenu id="group" openMenu={openMenu} setOpenMenu={setOpenMenu} minWidth={150}
            label={<>Group by: <span data-group-current>{masterGroupBy==="project"?"Project":"None"}</span></>}>
            {[{v:null,l:"None"},{v:"project",l:"Project"}].map(opt=>{
              const on = masterGroupBy===opt.v;
              return (
                <button key={String(opt.v)} type="button" role="menuitemradio" aria-checked={on} data-group-opt={opt.v||"none"}
                  onClick={()=>{ setGroupBy(opt.v); setOpenMenu(null); }}
                  onMouseEnter={e=>e.currentTarget.style.background="var(--surf)"} onMouseLeave={e=>e.currentTarget.style.background=on?"#eef2ff":"transparent"}
                  style={{display:"flex",alignItems:"center",gap:8,width:"100%",padding:"6px 10px",border:"none",borderRadius:4,cursor:"pointer",textAlign:"left",
                    background:on?"#eef2ff":"transparent",fontFamily:"inherit",fontSize:12,color:"var(--txt)",fontWeight:on?600:400}}>
                  <span style={{width:12,flexShrink:0,color:"var(--amber)",fontSize:11}}>{on?"\u2713":""}</span>{opt.l}
                </button>
              );
            })}
          </ReportMenu>

          <ReportMenu id="show" openMenu={openMenu} setOpenMenu={setOpenMenu} active={lvlActive} minWidth={176}
            label={<>Show {lvlActive && <span style={{width:5,height:5,borderRadius:"50%",background:"var(--amber)",flexShrink:0}} />}</>}>
              <div style={{fontSize:9,fontWeight:700,color:"var(--mut)",letterSpacing:".08em",textTransform:"uppercase",padding:"0 10px 6px",borderBottom:"1px solid var(--bd)",marginBottom:4}}>Which tasks to show</div>

              {/* Leaf only quick toggle */}
              <label style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",cursor:"pointer",borderRadius:4,
                background:lvlFilter.leafOnly?"#eef2ff":"transparent",transition:"background .1s"}}
                onMouseEnter={e=>{if(!lvlFilter.leafOnly)e.currentTarget.style.background="var(--surf)";}}
                onMouseLeave={e=>{if(!lvlFilter.leafOnly)e.currentTarget.style.background="transparent";}}>
                <input type="checkbox" checked={lvlFilter.leafOnly}
                  onChange={e=>setLvlFilter({...lvlFilter,leafOnly:e.target.checked})}
                  style={{accentColor:"var(--amber)",width:12,height:12,flexShrink:0}} />
                <div>
                  <div style={{fontSize:12,color:"var(--txt)",fontWeight:500}}>Action items only</div>
                  <div style={{fontSize:10,color:"var(--mut)"}}>Hide phases and section headers</div>
                </div>
              </label>

              <div style={{height:1,background:"var(--bd)",margin:"4px 0"}} />
              <div style={{fontSize:9,color:"var(--mut)",padding:"4px 10px 2px",letterSpacing:".04em"}}>OR BY OUTLINE LEVEL</div>

              {[{d:0,label:"Top-level phases",sub:"Outline level 1"},
                {d:1,label:"Subtasks",sub:"Outline level 2"},
                {d:2,label:"Sub-subtasks",sub:"Outline level 3"},
                {d:3,label:"Deeper nesting",sub:"Level 4 and below"},
              ].map(({d,label,sub}) => {
                const on = lvlFilter.depths.includes(d);
                return (
                  <label key={d} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 10px",cursor:"pointer",
                    borderRadius:4,opacity:lvlFilter.leafOnly?0.4:1,transition:"background .1s"}}
                    onMouseEnter={e=>{if(!lvlFilter.leafOnly)e.currentTarget.style.background="var(--surf)";}}
                    onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    <input type="checkbox" checked={on} disabled={lvlFilter.leafOnly}
                      onChange={e=>setLvlFilter({...lvlFilter,depths:e.target.checked?[...lvlFilter.depths,d]:lvlFilter.depths.filter(x=>x!==d)})}
                      style={{accentColor:"var(--amber)",width:12,height:12,flexShrink:0}} />
                    <div>
                      <div style={{fontSize:12,color:"var(--txt)"}}>{label}</div>
                      <div style={{fontSize:10,color:"var(--mut)"}}>{sub}</div>
                    </div>
                  </label>
                );
              })}

              <div style={{borderTop:"1px solid var(--bd)",marginTop:4,padding:"6px 10px 2px"}}>
                <span style={{fontSize:10,color:"var(--mut)",cursor:"pointer",textDecoration:"underline"}}
                  onClick={()=>setLvlFilter({...DEFAULT_LVL})}>Show all</span>
              </div>
          </ReportMenu>

          <ReportMenu id="columns" openMenu={openMenu} setOpenMenu={setOpenMenu} minWidth={168} label="Columns">
              <div style={{fontSize:9,fontWeight:700,color:"var(--mut)",letterSpacing:".08em",textTransform:"uppercase",padding:"0 10px 6px",borderBottom:"1px solid var(--bd)",marginBottom:4}}>Show / Hide Columns</div>
              {MASTER_COL_DEFS.map(col => {
                const on = visCols.includes(col.k);
                return (
                  <label key={col.k} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 10px",cursor:"pointer",borderRadius:4,transition:"background .1s"}}
                    onMouseEnter={e=>e.currentTarget.style.background="var(--surf)"}
                    onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    <input type="checkbox" checked={on}
                      onChange={e=>setVisCols(e.target.checked ? [...visCols,col.k] : visCols.filter(k=>k!==col.k))}
                      style={{accentColor:"var(--amber)",width:12,height:12,flexShrink:0}} />
                    <span style={{fontSize:12,color:"var(--txt)"}}>{col.label}</span>
                  </label>
                );
              })}
              <div style={{borderTop:"1px solid var(--bd)",marginTop:4,paddingTop:6,padding:"6px 10px 2px"}}>
                <span style={{fontSize:10,color:"var(--mut)",cursor:"pointer",textDecoration:"underline"}}
                  onClick={()=>setVisCols([...DEFAULT_MASTER_COLS])}>Reset to default</span>
              </div>
          </ReportMenu>
        </div>
      </div>

      {masterGroupBy === "project" && projOrder.error && (
        <div role="alert" style={{display:"flex",alignItems:"center",gap:10,flexShrink:0,marginBottom:10,padding:"6px 12px",
          borderRadius:8,border:"1px solid var(--red, #dc2626)",color:"var(--red, #dc2626)",fontSize:12,fontWeight:600}}>
          <span>Couldn't save your project order. It's kept on screen for now.</span>
          <button type="button" onClick={()=>postToShell({type:"planar:project-order-retry"})}
            style={{fontSize:12,fontWeight:700,color:"var(--red, #dc2626)",background:"none",border:"1px solid var(--red, #dc2626)",borderRadius:6,padding:"2px 10px",cursor:"pointer",fontFamily:"inherit"}}>Retry</button>
        </div>
      )}
      {/* Table — framed card; the card itself is the scroll container so the
          column headers stay pinned while rows scroll underneath */}
      <div ref={tableWrapRef} data-scroll-bounds tabIndex={0} onKeyDown={handleTableKey}
        style={{flex:1,minHeight:0,overflow:"auto",outline:"none",overscrollBehavior:"contain",paddingBottom:"var(--fab-dock, 0px)",
          background:"var(--bg)",border:"1px solid var(--bd2)",borderRadius:10,
          boxShadow:"0 1px 2px rgba(27,31,36,.05), 0 3px 12px rgba(27,31,36,.04)"}}
        onBlur={e=>{ if (!e.currentTarget.contains(e.relatedTarget)) setSelCell(null); }}>
      <table style={{borderCollapse:"collapse",tableLayout:"fixed",minWidth:"100%",
        width:30 + activeCols.reduce((s,c)=>s+(colWidths[c.k]||100),0),fontSize:12}}>
        <thead>
          <tr>
            <th key="__jump" data-grid-header="1" style={{width:30,minWidth:30,maxWidth:30,padding:0,
              position:"sticky",top:0,zIndex:3,background:"#fafbfc",
              boxShadow:"inset -1px 0 0 var(--bd), inset 0 -1px 0 var(--bd2)"}} />
            {displayCols.map(col => {
              const isActive = masterSort.col === col.k;
              const sortable = ["project","id","name","start","end","duration","health","percentComplete","responsibleParty","notes"].includes(col.k);
              return (
              <th key={col.k}
                draggable
                onDragStart={e=>{e.dataTransfer.effectAllowed="move";setDragMCol(col.k);}}
                onDragOver={e=>{e.preventDefault();e.dataTransfer.dropEffect="move";setDragMOver(col.k);}}
                onDragLeave={()=>setDragMOver(null)}
                onDrop={e=>{e.preventDefault();reorderMCols(dragMCol,col.k);setDragMCol(null);setDragMOver(null);}}
                onDragEnd={()=>{setDragMCol(null);setDragMOver(null);}}
                onClick={sortable&&dragMCol===null ? ()=>setSort(col.k) : undefined}
                style={{padding:"6px 10px",textAlign:"left",color:"var(--mut)",fontSize:10,
                  textTransform:"uppercase",fontWeight:600,letterSpacing:".06em",
                  position:"sticky",top:0,zIndex:3,
                  boxShadow:(dragMOver===col.k&&dragMCol!==col.k?"inset 2px 0 0 var(--blue), ":"")
                    +"inset -1px 0 0 var(--bd), inset 0 -1px 0 var(--bd2)",
                  whiteSpace:"nowrap",
                  width:colWidths[col.k],minWidth:colWidths[col.k],maxWidth:colWidths[col.k],
                  userSelect:"none",overflow:"hidden",
                  cursor:sortable?"pointer":"grab",opacity:dragMCol===col.k?0.4:1,
                  background:"#fafbfc",transition:"opacity .1s"}}>
                <span style={{display:"inline-flex",alignItems:"center",gap:4}}>
                  {col.label}
                  {sortable && (
                    <span style={{fontSize:9,color:isActive?"var(--txt)":"var(--bd2)",lineHeight:1,flexShrink:0}}>
                      {isActive ? (masterSort.dir==="asc"?"↑":"↓") : "↕"}
                    </span>
                  )}
                </span>
                <div
                  onMouseDown={e=>{e.stopPropagation();e.preventDefault();startResize(col.k,e);}}
                  onClick={e=>e.stopPropagation()}
                  onDoubleClick={e=>{e.stopPropagation();autoSizeMCol(col.k);}}
                  style={{position:"absolute",right:0,top:0,bottom:0,width:6,cursor:"col-resize",zIndex:2,
                    background:"transparent",transition:"background .12s"}}
                  onMouseEnter={e=>e.currentTarget.style.background="rgba(79,70,229,0.25)"}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"} />
              </th>
              );
            })}
            {/* Filler column — soaks up leftover width on wide screens so the
                grid closes flush against the card edge instead of ending mid-page */}
            <th key="__fill" aria-hidden="true" style={{width:"auto",minWidth:0,padding:0,
              position:"sticky",top:0,zIndex:3,background:"#fafbfc",
              boxShadow:"inset 0 -1px 0 var(--bd2)"}} />
          </tr>
        </thead>
        <tbody>
          {masterGroupBy === "project" ? (() => {
            // B1873360 — keyed by projId (never the bare schedule name) and ordered by owner
            // label / schedule name / projId, so two schedules sharing a name (e.g. two accounts'
            // "Master Schedule") get their own section instead of merging into one with a summed
            // count badge. See groupRowsByProject's own header for the full reasoning.
            return groupedRows.flatMap(({projId, gRows, label, siteId, rank}, gi) => {
              const movable = canReorderGroups && siteId != null && rank !== Infinity;
              const pos = movable ? movableIds.indexOf(siteId) : -1;
              const dragging = grpDrag && grpDrag.siteId === siteId;
              const first = siteId != null && groupedRows.findIndex(g => g.siteId === siteId) === gi; // a project's first schedule header carries the controls
              const showCtl = movable && first;
              const line = !grpDrag ? null
                : (siteId === lineAboveSite && first) ? "inset 0 3px 0 var(--blue)"
                : (siteId === lineBelowSite && gi === lastGroupOfSite(siteId)) ? "inset 0 -3px 0 var(--blue)" : null;
              return [
              <tr key={`grp-${projId}`} data-grp-site={siteId != null ? siteId : ""} style={{opacity: dragging ? 0.45 : 1}}>
                <td colSpan={displayCols.length + 2} style={{
                  padding:"10px 12px 8px", borderBottom:"1px solid var(--bd)",
                  background:"#f0f0f5", borderLeft:"4px solid var(--amber)", boxShadow: line || "none"}}>
                  <span style={{display:"inline-flex",alignItems:"center",gap:8}}>
                    {showCtl && (
                      <span data-grp-grip={siteId} role="button" tabIndex={0} title="Drag to reorder" aria-label={`Drag to reorder ${label}`}
                        onPointerDown={e=>startGroupDrag(e, siteId)}
                        style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:26,height:30,color:"var(--mut)",
                          fontSize:16,lineHeight:1,cursor:grpDrag?"grabbing":"grab",touchAction:"none",userSelect:"none"}}>⠿</span>
                    )}
                    <span style={{fontSize:15,fontWeight:700,color:"var(--txt)",letterSpacing:"-.01em"}}>{label}</span>
                    <span style={{fontSize:10,background:"#dbeafe",color:"#1d4ed8",borderRadius:8,padding:"1px 7px",verticalAlign:"middle"}}>{gRows.length}</span>
                    {showCtl && <GroupOrderMenu label={label} isFirst={pos === 0} isLast={pos === movableIds.length - 1} onPick={(to)=>pickGroupMenu(siteId, to)} />}
                  </span>
                </td>
              </tr>,
              ...gRows.map((t,gri) => {
                const ri = sortedRows.indexOf(t);
                return (
                <tr key={`${t.projId}-${t.id}`} style={{background:t.rowColor||(gri%2?"var(--row-alt)":"var(--bg)")}}>
                  {renderJumpCell(t)}
                  {displayCols.map(col => renderCell(t, col, ri))}
                  <td style={{padding:0,borderBottom:"1px solid var(--bd)"}} />
                </tr>
                );
              })
            ];
            });
          })()
          : sortedRows.map((t, ri) => (
            <tr key={`${t.projId}-${t.id}`} style={{background:t.rowColor||(ri%2?"var(--row-alt)":"var(--bg)")}}>
              {renderJumpCell(t)}
              {displayCols.map(col => renderCell(t, col, ri))}
              <td style={{padding:0,borderBottom:"1px solid var(--bd)"}} />
            </tr>
          ))}
          {sortedRows.length===0 && (
            <tr><td colSpan={displayCols.length + 2} style={{padding:40,textAlign:"center",color:"var(--mut)",fontSize:12,borderBottom:"1px solid var(--bd)"}}>
              {totalTaskCount===0 ? "No tasks in this project yet."
                : levelRows.length>0 && filterCount>0
                  ? <span data-filter-empty>No tasks match the filter ({reportFilterPhrase(statusKeys.map(k=>statusName(statusOptions.find(o=>o.k===k))), projectKeys.map(id=>(projectChoices.find(g=>String(g.projId)===id)||{}).label||id))}). <button type="button" data-filter-empty-clear onClick={clearFilters}
                      style={{border:"none",background:"none",padding:0,font:"inherit",color:"var(--blue)",textDecoration:"underline",cursor:"pointer"}}>Clear filter</button></span>
                  : <span data-show-empty>No tasks match the Show setting. <button type="button" onClick={()=>setLvlFilter({...DEFAULT_LVL})}
                      style={{border:"none",background:"none",padding:0,font:"inherit",color:"var(--blue)",textDecoration:"underline",cursor:"pointer"}}>Show all</button></span>}
            </td></tr>
          )}
        </tbody>
      </table>
      </div>
    </div>
  );
}

// harness compatibility — the old classic-script page made every top-level binding a global, and the ui-audit / e2e
// drivers call them by bare name from page.evaluate (GanttView, buildGanttSVG, COLS, showToast, …). Same names, same values.
exposeToHarness({
  HealthDropMenu: [() => HealthDropMenu],
  MASTER_COL_DEFS: [() => MASTER_COL_DEFS],
  DEFAULT_MASTER_COLS: [() => DEFAULT_MASTER_COLS],
  DEFAULT_MASTER_WIDTHS: [() => DEFAULT_MASTER_WIDTHS],
  REPORT_STATUS_BASE: [() => REPORT_STATUS_BASE],
  REPORT_STATUS_DEFAULT: [() => REPORT_STATUS_DEFAULT],
  reportStatusOptions: [() => reportStatusOptions],
  reportStatusKeys: [() => reportStatusKeys],
  reportStatusToggle: [() => reportStatusToggle],
  reportStatusPasses: [() => reportStatusPasses],
  reportProjectKeys: [() => reportProjectKeys],
  reportProjectToggle: [() => reportProjectToggle],
  reportProjectPasses: [() => reportProjectPasses],
  reportFilterCount: [() => reportFilterCount],
  reportFacetCounts: [() => reportFacetCounts],
  reportFilterPhrase: [() => reportFilterPhrase],
  _projectOrder: [() => _projectOrder, (v) => { _projectOrder = v; }],
  _projectOrderSubs: [() => _projectOrderSubs],
  installProjectOrderListener: [() => installProjectOrderListener],
  postToShell: [() => postToShell],
  useProjectOrder: [() => useProjectOrder],
  GroupOrderMenu: [() => GroupOrderMenu],
  REPORT_MENU_SECTION: [() => REPORT_MENU_SECTION],
  REPORT_MENU_ROW: [() => REPORT_MENU_ROW],
  REPORT_MENU_COUNT: [() => REPORT_MENU_COUNT],
  ReportMenu: [() => ReportMenu],
  MasterView: [() => MasterView],
});
