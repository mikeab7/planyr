import { crossScheduleLabel } from "../../../../shared/schedule/scheduleOwnership.js";
import { HEALTH, HK, NO_AUTOFILL } from "../common.jsx";
import { parseFlexDate, sortByVisualOrder, toShortDate } from "../../../../shared/schedule/engine/tasks.js";
import { MEETING_BODY_INDEX, newPinConflicts, pinConflictNotice, resolveBoundEdit } from "../../../../shared/schedule/engine/meetings.js";
import { cascadeDelta, completionDelta } from "../../../../shared/schedule/healthEngine.js";
import { calcEnd, resolveDuration, taskDurUnit, taskDurValue } from "../../../../shared/schedule/engine/predecessors.js";
import { difBD, pd } from "../../../../shared/schedule/engine/calendar.js";
import { recomputeSchedule } from "../../../../shared/schedule/engine/cascade.js";
import { ownerJoin, ownerListOf } from "../../../../shared/schedule/engine/owners.js";
import { focusGroupIds } from "../grid/gridNav.js";
import { GridView } from "../grid/GridView.jsx";
import { exposeToHarness } from "../harnessGlobals.js";

const { useState, useEffect, useRef } = React;


// ── Suggestions queue (email → AI suggestion → approve/dismiss) ───
const SGQ_HEALTH = {
  gray:  {label:"Not Started", dot:"#ffffff", bd:"1.5px solid #d1d5db"},
  yellow:{label:"In Progress", dot:"#c47b00", bd:"none"},
  red:   {label:"Needs Attn.", dot:"#dc2626", bd:"none"},
  green: {label:"Complete",    dot:"#16a34a", bd:"none"},
  paused:{label:"Paused",      dot:"#9ca3af", bd:"none"},
};
const SGQ_HKEYS = ["gray","yellow","red","green","paused"];
const SGQ_AV = ["#4f46e5","#0969da","#16a34a","#c47b00","#9333ea","#0891b2","#dc2626"];
const SGQ_ALLOWED_PATCH = new Set(["health","duration","end","percentComplete","responsibleParty","predecessors"]);
const SGQ_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function sgqAvatarColor(name) {
  let h = 0; for (const c of String(name||"")) h = (h*31 + c.charCodeAt(0)) >>> 0;
  return SGQ_AV[h % SGQ_AV.length];
}
function sgqInitials(name) {
  const parts = String(name||"").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1] ? parts[1][0] : "")).toUpperCase();
}
function sgqConfClass(c) { const n = Number(c||0); return n >= 0.8 ? "hi" : n >= 0.5 ? "mid" : "lo"; }
function sgqFmtDate(s) {
  if (!s) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return s;
  return SGQ_MONTHS[+m[2] - 1] + " " + (+m[3]);
}
function SgqDot({h}) {
  const m = SGQ_HEALTH[h] || SGQ_HEALTH.gray;
  return <span className="sgq-dot" style={{background: m.dot, border: m.bd !== "none" ? m.bd : "none"}}/>;
}

function sgqChildrenOf(data, pid, parentId) {
  const proj = data && data.projects && data.projects[pid];
  if (!proj) return [];
  return proj.tasks.filter(t => parentId == null ? (t.parentId == null) : (t.parentId === parentId));
}

function sgqCrumbOf(data, pid, path) {
  if (pid == null || !Array.isArray(path) || path.length === 0) return null;
  const proj = data && data.projects && data.projects[pid];
  if (!proj) return null;
  const byId = new Map(proj.tasks.map(t => [t.id, t]));
  const names = path.map(id => byId.get(id) && byId.get(id).name).filter(Boolean);
  if (names.length === 0) return null;
  // B1873361 — this can name a task on ANY schedule on the account (a review suggestion can
  // match to a different project entirely), so the crumb's project half is the qualified label,
  // never the bare schedule name.
  return { project: crossScheduleLabel(proj), names };
}

function SgqCrumb({data, pid, path}) {
  const c = sgqCrumbOf(data, pid, path);
  if (!c) return <span style={{color:"#c47b00", fontWeight:600}}>No task selected</span>;
  return (
    <span className="sgq-crumbline">
      {c.project}
      {c.names.map((nm, i) => (
        <React.Fragment key={i}>
          <span className="sgq-arrow">▸</span>{nm}
        </React.Fragment>
      ))}
    </span>
  );
}

/* Cascade picker — row of selects: Project ▸ Phase ▸ … ▸ Task */
function SgqCascadePicker({data, pid, path, ready, onChange}) {
  const projects = (data && data.projects) ? Object.entries(data.projects) : [];
  const selects = [];
  if (pid != null && data && data.projects && data.projects[pid]) {
    let nodes = sgqChildrenOf(data, pid, null);
    let k = 0;
    /* eslint-disable no-constant-condition */
    while (true) {
      const val = path && path[k] != null ? path[k] : null;
      selects.push({ k, nodes, val });
      if (val == null) break;
      const kids = sgqChildrenOf(data, pid, val);
      if (kids.length === 0) break;
      nodes = kids;
      k++;
    }
  }
  return (
    <div className={"sgq-target" + (ready ? "" : " warnrow")}>
      <i className={ready ? "ti ti-map-pin" : "ti ti-help-circle"}/>
      {!ready && pid == null && <span className="sgq-needpick">Pick the task:</span>}
      <select className="sgq-sel"
        value={pid == null ? "" : pid}
        onChange={e => onChange(e.target.value === "" ? null : +e.target.value, [])}>
        <option value="" disabled>Project…</option>
        {/* B1873361 — every schedule on the account, so the qualified label (never a bare,
            possibly-duplicate schedule name) is what tells two "Master Schedule"s apart here. */}
        {projects.map(([k, p]) => <option key={k} value={k}>{crossScheduleLabel(p)}</option>)}
      </select>
      {selects.map(sel => (
        <React.Fragment key={sel.k}>
          <span className="sgq-arrow">▸</span>
          <select className="sgq-sel"
            value={sel.val == null ? "" : sel.val}
            onChange={e => {
              const v = e.target.value === "" ? null : +e.target.value;
              const np = (path || []).slice(0, sel.k);
              if (v != null) np.push(v);
              onChange(pid, np);
            }}>
            <option value="">{sel.k === 0 ? "Phase…" : "↳ refine (optional)"}</option>
            {sel.nodes.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </React.Fragment>
      ))}
    </div>
  );
}

function SgqChangeRow({field, fromVal, toVal, onEditTo, onRemove}) {
  if (field === "health") {
    return (
      <div className="sgq-chg">
        <span className="sgq-field">Status</span>
        <span className="sgq-fromval"><SgqDot h={fromVal}/>{(SGQ_HEALTH[fromVal] && SGQ_HEALTH[fromVal].label) || fromVal || "—"}</span>
        <i className="ti ti-arrow-right sgq-toarrow"/>
        <span className="sgq-statuslabel">
          <SgqDot h={toVal}/>
          <select className="sgq-sel" value={toVal || "gray"} onChange={e => onEditTo(e.target.value)}>
            {SGQ_HKEYS.map(k => <option key={k} value={k}>{SGQ_HEALTH[k].label}</option>)}
          </select>
        </span>
        <span className="sgq-grow"/>
        {onRemove && <span className="sgq-x" title="Don't apply this change" onClick={onRemove}><i className="ti ti-x"/></span>}
      </div>
    );
  }
  if (field === "percentComplete") {
    return (
      <div className="sgq-chg">
        <span className="sgq-field">% Complete</span>
        <span className="sgq-fromval">{fromVal != null ? fromVal : 0}%</span>
        <i className="ti ti-arrow-right sgq-toarrow"/>
        <input className="sgq-miniinput" type="number" min="0" max="100"
          value={toVal != null ? toVal : 0}
          onChange={e => onEditTo(Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0)))}/>
        <span style={{color:"#8b949e"}}>%</span>
        <span className="sgq-grow"/>
        {onRemove && <span className="sgq-x" title="Don't apply this change" onClick={onRemove}><i className="ti ti-x"/></span>}
      </div>
    );
  }
  if (field === "duration") {
    return (
      <div className="sgq-chg">
        <span className="sgq-field">Duration</span>
        <span className="sgq-fromval">{fromVal != null ? fromVal : 0}d</span>
        <i className="ti ti-arrow-right sgq-toarrow"/>
        <input className="sgq-miniinput" type="number" min="0"
          value={toVal != null ? toVal : 0}
          onChange={e => onEditTo(Math.max(0, parseInt(e.target.value, 10) || 0))}/>
        <span style={{color:"#8b949e"}}>d</span>
        <span className="sgq-grow"/>
        {onRemove && <span className="sgq-x" title="Don't apply this change" onClick={onRemove}><i className="ti ti-x"/></span>}
      </div>
    );
  }
  if (field === "responsibleParty") {
    return (
      <div className="sgq-chg">
        <span className="sgq-field">Owner</span>
        <span className="sgq-fromval">{fromVal || "—"}</span>
        <i className="ti ti-arrow-right sgq-toarrow"/>
        <input {...NO_AUTOFILL} className="sgq-miniinput" type="text" style={{minWidth:140}}
          value={toVal || ""}
          onChange={e => onEditTo(e.target.value)}/>
        <span className="sgq-grow"/>
        {onRemove && <span className="sgq-x" title="Don't apply this change" onClick={onRemove}><i className="ti ti-x"/></span>}
      </div>
    );
  }
  if (field === "end") {
    return (
      <div className="sgq-chg">
        <span className="sgq-field">End date</span>
        <span className="sgq-fromval">{fromVal || "—"}</span>
        <i className="ti ti-arrow-right sgq-toarrow"/>
        <input className="sgq-miniinput" type="date"
          value={toVal || ""}
          onChange={e => onEditTo(e.target.value)}/>
        <span className="sgq-grow"/>
        {onRemove && <span className="sgq-x" title="Reset — don't change end date" onClick={onRemove}><i className="ti ti-x"/></span>}
      </div>
    );
  }
  return null;
}

function InlineDate({value, onCommit}) {
  // B502: keep the YEAR (M/D/YY via toShortDate) — the old month/day-only display made
  // parseFlexDate default the year to the current year on commit, silently rewriting a
  // past/future-year date just by opening + blurring the field.
  const disp = value ? toShortDate(value) : "";
  const [txt, setTxt] = useState(disp);
  useEffect(() => { setTxt(disp); }, [disp]);
  const commit = () => { const isoV = parseFlexDate(txt); if (isoV) onCommit(isoV); else setTxt(disp); };
  return <input {...NO_AUTOFILL} className="rev-edit rev-date-edit" value={txt} placeholder="—"
    onChange={e => setTxt(e.target.value)}
    onBlur={commit}
    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } else if (e.key === 'Escape') { setTxt(disp); e.currentTarget.blur(); } }}/>;
}

// Strip forwarded-email noise: URL-defense link wrappers, external-sender banners,
// and the quoted reply thread (returned separately so the UI can hide it behind a toggle).
function cleanEmailBody(raw) {
  if (!raw) return { body: "", quoted: "", hasQuoted: false };
  let text = String(raw).replace(/\r\n/g, "\n");

  // unwrap Outlook/Proofpoint plain-text links: "display<https://…>" / "name<mailto:…>" → "display"
  text = text.replace(/\s*<\s*https?:\/\/urldefense\.proofpoint\.com[^\n]*$/gim, "");
  text = text.replace(/\s*<\s*(?:https?:\/\/|mailto:)[^>\n]*>/gi, "");

  // drop a leading external-sender banner line if present
  text = text.replace(/^[ \t]*\[?\s*EXTERNAL[^\n]*\]?\s*\n?/gim, "");

  // split off the quoted reply thread at the first quote header
  const lines = text.split("\n");
  const quoteRe = /^\s*(?:-{3,}\s*Original Message\s*-{3,}|_{5,}|From:\s.+|On\b.+\bwrote:\s*)$/i;
  let cut = -1;
  for (let i = 0; i < lines.length; i++) { if (quoteRe.test(lines[i])) { cut = i; break; } }
  const head = cut >= 0 ? lines.slice(0, cut) : lines;
  const quoted = cut >= 0 ? lines.slice(cut) : [];

  const tidy = a => a.join("\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const qtext = tidy(quoted);
  return { body: tidy(head), quoted: qtext, hasQuoted: qtext.length > 0 };
}

export function SuggestionsView({data, updateTask, setData, rows, setRows, loading, onClose, gridProps, activeIdx, setActiveIdx}) {
  const [edits, setEdits] = useState({});
  const [view, setView] = useState("grid");
  const [split, setSplit] = useState(50);
  const [toast, setToast] = useState(null);
  const [showPicker, setShowPicker] = useState(false);
  const [showQuoted, setShowQuoted] = useState(false);
  const bodyRef = useRef(null), targetRef = useRef(null), canvasRef = useRef(null);
  const toastTimer = useRef(null), undoRef = useRef(null);
  const [mailReaderOpen, setMailReaderOpen] = useState(false);
  const [mailOverflow, setMailOverflow] = useState(false);
  const mailBodyRef = useRef(null);

  // Pending suggestions are fetched + subscribed in App and passed in via props (rows / setRows / loading).

  useEffect(() => { setActiveIdx(i => Math.max(0, Math.min(i, rows.length - 1))); }, [rows.length]);
  useEffect(() => { setShowPicker(false); setShowQuoted(false); setMailReaderOpen(false); }, [activeIdx]);
  React.useLayoutEffect(() => {
    const measure = () => { const el = mailBodyRef.current; setMailOverflow(!!el && el.scrollHeight > el.clientHeight + 2); };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [activeIdx]);

  const rfmt = s => { if (!s) return ""; const p = s.split('-'); return (+p[1]) + "/" + (+p[2]); };
  const rfmtIso = s => { if (!s) return ""; const p = s.split('-'); return (+p[1]) + "/" + (+p[2]) + "/" + String(p[0]).slice(2); };

  const getEff = (row) => {
    const e = edits[row.id] || {};
    return {
      project_id: ('project_id' in e) ? e.project_id : row.project_id,
      task_path:  ('task_path'  in e) ? e.task_path  : (row.task_path  || []),
      note_text:  ('note_text'  in e) ? e.note_text  : (row.note_text  || ''),
      patch:      ('patch'      in e) ? e.patch      : (row.patch      || {}),
    };
  };
  const patchRow = (id, p) => setEdits(E => ({ ...E, [id]: { ...(E[id] || {}), ...p } }));
  const setPatchField = (id, field, val) => setEdits(E => {
    const row = rows.find(r => r.id === id);
    const cur = (E[id] && E[id].patch) || (row && row.patch) || {};
    return { ...E, [id]: { ...(E[id] || {}), patch: { ...cur, [field]: val } } };
  });

  const cleanPatchFor = (patch, target) => {
    const out = {};
    Object.keys(patch || {}).forEach(k => {
      if (!SGQ_ALLOWED_PATCH.has(k)) return;
      const v = patch[k];
      if (v === undefined || v === null || v === "") return;
      // "unchanged?" check: structural-compare objects/arrays (a `predecessors` array of {id,type,lag}
      // objects all stringify to "[object Object]" via String(), so a real dependency change was silently
      // dropped); keep the cheap String() compare for primitives.
      const same = (x, y) => ((x && typeof x === "object") || (y && typeof y === "object"))
        ? JSON.stringify(x) === JSON.stringify(y) : String(x) === String(y);
      if (target && same(target[k], v)) return;
      out[k] = v;
    });
    return out;
  };
  const previewProject = (tasks, tId, patchIn) => {
    // NEW-1 — the SAME forward-to-a-real-meeting gate updateTask applies, so the preview never lies.
    const boundEdit = resolveBoundEdit(tasks, tId, patchIn, id => MEETING_BODY_INDEX[id]);
    const patch = boundEdit.updates;
    let ts = tasks.map(t => {
      if (t.id !== tId) return t;
      const u = { ...t, ...patch, ...completionDelta(t, patch) };
      // Editing a predecessor clears any manual pin so the cascade controls the start — mirror updateTask
      // here, else the preview cascades a PINNED task in place while the real apply moves it (the preview lies).
      if ('predecessors' in patch) delete u.pinnedStart;
      if ('duration' in patch && !('durValue' in patch) && !('durUnit' in patch)) { u.durUnit = 'd'; u.durValue = Math.max(0, Math.trunc(Number(patch.duration) || 0)); }
      if (('durValue' in patch) || ('durUnit' in patch)) { u.durUnit = u.durUnit || 'd'; if (u.durValue == null) u.durValue = 0; }
      const durEdited = ('duration' in patch) || ('durValue' in patch) || ('durUnit' in patch);
      if ((durEdited || ('start' in patch)) && !('end' in patch)) {
        if (!(u.pinnedEnd && u.end)) { const r = resolveDuration(u.start, taskDurValue(u), taskDurUnit(u)); u.end = r.end; u.duration = r.duration; }
      }
      else if ('end' in patch && !('start' in patch)) {
        if (u.end && !u.start) { u.start = u.end; u.durUnit = 'd'; u.durValue = 1; u.duration = 1; }
        else { u.duration = (u.start && u.end) ? Math.max(0, difBD(u.start, u.end) + 1) : ""; u.durUnit = 'd'; u.durValue = (typeof u.duration === 'number' ? u.duration : 0); }
        u.pinnedEnd = !!u.end;
      }
      if ('start' in patch) u.pinnedStart = true;
      if (boundEdit.startOverride) { u.start = boundEdit.startOverride; u.end = boundEdit.startOverride; }
      return u;
    });
    if ('health' in patch) {
      const desc = (id, all) => { const k = all.filter(t => t.parentId === id); return [...k.map(x => x.id), ...k.flatMap(x => desc(x.id, all))]; };
      const ids = new Set(desc(tId, ts));
      if (ids.size) { ts = ts.map(t => ids.has(t.id) ? { ...t, health: patch.health, ...cascadeDelta(t, patch.health) } : t); }
    }
    if ('duration' in patch || 'start' in patch || 'end' in patch || 'predecessors' in patch || 'meetingBound' in patch || 'meetingBodyId' in patch || 'pinnedMeetingDate' in patch || 'minMeetingsAfter' in patch) {
      ts = recomputeSchedule(ts);
    }
    return ts;
  };

  const active = rows[activeIdx] || null;
  const isCreate = !!(active && (active.kind === 'create_task' || (active.patch && active.patch.kind === 'create_task')));
  const eff = active ? getEff(active) : null;
  const pid = eff ? eff.project_id : null;
  const proj = (pid != null && data && data.projects) ? data.projects[pid] : null;
  const rawTargetId = (eff && eff.task_path && eff.task_path.length) ? eff.task_path[eff.task_path.length - 1] : null;
  const target = (proj && rawTargetId != null)
    ? (proj.tasks.find(t => String(t.id) === String(rawTargetId)) || proj.tasks.find(t => t.name === rawTargetId) || null)
    : null;
  const targetId = target ? target.id : null;   // resolved numeric id — used for injection/matching
  const matched = !isCreate && !!(proj && target);   // create mode runs a separate path below

  // Resolve an "add dependency" instruction (add_predecessors: [taskId|taskName, ...]) into a
  // concrete predecessors array, merged with whatever the target already depends on.
  const resolveTaskRef = (ref) => {
    if (ref == null || !proj) return null;
    return proj.tasks.find(t => String(t.id) === String(ref)) || proj.tasks.find(t => t.name === ref) || null;
  };
  let addedPredTasks = [];
  let cleanPatch = (matched && eff) ? cleanPatchFor(eff.patch, target) : {};
  if (matched && eff && eff.patch && Array.isArray(eff.patch.add_predecessors) && eff.patch.add_predecessors.length) {
    const existing = Array.isArray(target.predecessors) ? target.predecessors : [];
    const existingIds = new Set(existing.map(p => (p && typeof p === 'object') ? p.id : p));
    const additions = [];
    eff.patch.add_predecessors.forEach(ref => {
      const t = resolveTaskRef(ref);
      if (!t || t.id === targetId || existingIds.has(t.id)) return;
      additions.push({ id: t.id, type: 'FS', lag: 0 });
      addedPredTasks.push(t);
      existingIds.add(t.id);
    });
    if (additions.length) cleanPatch = { ...cleanPatch, predecessors: [...existing, ...additions] };
  }
  const previewTasks = matched ? previewProject(proj.tasks, targetId, cleanPatch) : [];
  const propById = {}; previewTasks.forEach(t => { propById[t.id] = t; });
  const propTarget = matched ? propById[targetId] : null;

  const moversList = [];
  if (matched) proj.tasks.forEach(t => {
    if (t.id === targetId) return;
    const p = propById[t.id]; if (!p) return;
    if (p.start !== t.start || p.end !== t.end) moversList.push({ id: t.id, newStart: p.start, newEnd: p.end, dStart: difBD(t.start, p.start), dEnd: difBD(t.end, p.end) });
  });
  const moverMap = {}; moversList.forEach(m => { moverMap[m.id] = m; });
  const maxDelta = moversList.reduce((a, m) => Math.max(a, m.dEnd), 0);
  // NEW-1 — the SAME conflict check updateTask runs (pinConflictsOf/newPinConflicts), so the preview of an approval
  // never disagrees with the apply: a typed date that would be earlier than its predecessor allows is called out BEFORE approving.
  const previewConflictMsg = matched ? pinConflictNotice(newPinConflicts(proj.tasks, previewTasks, (cleanPatch && (cleanPatch.start || cleanPatch.end)) ? [targetId] : []), (cleanPatch && (cleanPatch.start || cleanPatch.end)) ? targetId : null, rfmtIso) : "";

  const sugByTask = {};
  rows.forEach((r, i) => { const e = getEff(r); if (e.project_id === pid && e.task_path && e.task_path.length) { const tid = e.task_path[e.task_path.length - 1]; if (!(tid in sugByTask)) sugByTask[tid] = i; } });

  const propStatus = propTarget ? propTarget.health : (target ? target.health : 'gray');
  const propEnd = propTarget ? propTarget.end : (target ? target.end : '');
  // NEW-1 — Owner is a list now; the automation review panel still edits it as ONE proposed value
  // (approving a suggestion REPLACES the whole owner list with whatever is typed here) — shown
  // joined so an existing multi-owner task isn't misleadingly displayed as having just one.
  const propOwner = ownerJoin(propTarget ? ownerListOf(propTarget) : (target ? ownerListOf(target) : []));
  const endChanged = target && propEnd && propEnd !== target.end;
  const endDelta = endChanged ? difBD(target.end, propEnd) : 0;
  const startChanged = target && propTarget && propTarget.start !== target.start;
  const noteText = eff ? eff.note_text : '';

  // --- New-task suggestions (kind: 'create_task'): task_path points at the PARENT, patch.name is the new task ---
  const createReady = isCreate && !!proj && !!(eff && eff.patch && typeof eff.patch.name === 'string' && eff.patch.name.trim());
  let newTask = null, newTaskAddNames = [];
  if (createReady) {
    const parent = target; // in create mode, task_path's last element resolves here to the parent
    const preds = [];
    if (Array.isArray(eff.patch.add_predecessors)) eff.patch.add_predecessors.forEach(ref => {
      const t = resolveTaskRef(ref); if (t) { preds.push({ id: t.id, type: 'FS', lag: 0 }); newTaskAddNames.push(t.name); }
    });
    const newId = proj.tasks.reduce((m, t) => Math.max(m, +t.id || 0), 0) + 1;
    const fallbackStart = eff.patch.start || (parent ? parent.start : (proj.tasks[0] ? proj.tasks[0].start : new Date().toISOString().slice(0, 10)));
    let dur = (eff.patch.duration != null && eff.patch.duration !== '') ? eff.patch.duration : 1;
    if (eff.patch.end && (eff.patch.duration == null || eff.patch.duration === '')) {
      dur = (fallbackStart && eff.patch.end) ? Math.max(0, difBD(fallbackStart, eff.patch.end) + 1) : dur;
    }
    let prov = { id: newId, name: eff.patch.name.trim(), start: fallbackStart, end: '', duration: dur, durUnit: 'd', durValue: dur, predecessors: preds, health: eff.patch.health || 'gray', percentComplete: 0, parentId: parent ? parent.id : null, responsibleParty: eff.patch.responsibleParty || '', notes: [], isExpanded: true };
    prov.end = calcEnd(prov.start, prov.duration);
    let sim = recomputeSchedule([...proj.tasks, prov]);
    const c = sim.find(t => t.id === newId) || prov;
    newTask = { ...prov, start: c.start, end: c.end, duration: c.duration };
  }

  const flash = (msg) => { setToast({ msg }); if (toastTimer.current) clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), 6500); };

  const createTask = async () => {
    if (!createReady || !newTask) return;
    const row = active;
    undoRef.current = { kind: 'approve', pid, tasks: JSON.parse(JSON.stringify(proj.tasks)), row, idx: activeIdx };
    const dateMatch = row.email_date && /^(\d{4})-(\d{2})-(\d{2})$/.exec(row.email_date);
    const ymd = dateMatch ? row.email_date : new Date().toISOString().slice(0, 10);
    const noteArr = (noteText && String(noteText).trim()) ? [{ id: Date.now(), date: ymd, text: String(noteText).trim() }] : [];
    setData(d => {
      if (!d.projects || !d.projects[pid]) return d;
      const p = d.projects[pid];
      const tasks = p.tasks.slice();
      const newId = tasks.reduce((m, t) => Math.max(m, +t.id || 0), 0) + 1;
      const t = { id: newId, name: newTask.name, start: newTask.start, end: newTask.end, duration: newTask.duration, predecessors: newTask.predecessors, health: newTask.health, percentComplete: 0, parentId: newTask.parentId, responsibleParty: newTask.responsibleParty ? [newTask.responsibleParty] : [], notes: noteArr, isExpanded: true };
      let insertIdx = tasks.length;
      if (newTask.parentId != null) {
        // Prefer right after the predecessor it depends on, when that predecessor is a sibling under
        // the same parent (so the task follows what must finish first) — matches the review preview.
        const predIds = new Set((newTask.predecessors || []).map(pp => pp.id));
        let afterPred = -1;
        tasks.forEach((x, i) => { if (predIds.has(x.id) && x.parentId === newTask.parentId) afterPred = i; });
        if (afterPred >= 0) {
          insertIdx = afterPred + 1;
        } else {
          const desc = new Set([newTask.parentId]);
          let changed = true; while (changed) { changed = false; tasks.forEach(x => { if (x.parentId != null && desc.has(x.parentId) && !desc.has(x.id)) { desc.add(x.id); changed = true; } }); }
          let last = -1; tasks.forEach((x, i) => { if (desc.has(x.id)) last = i; });
          if (last >= 0) insertIdx = last + 1;
        }
      }
      tasks.splice(insertIdx, 0, t);
      const recomputed = recomputeSchedule(tasks);
      return { ...d, projects: { ...d.projects, [pid]: { ...p, tasks: recomputed } } };
    });
    const sb = window.__sb;
    if (sb) { try { await sb.from('planar_suggestions').update({ status: 'approved' }).eq('id', row.id); } catch (e) { console.warn("mark approved failed:", e); } }
    setRows(R => R.filter(r => r.id !== row.id));
    setEdits(E => { const c = { ...E }; delete c[row.id]; return c; });
    flash("Task created · " + newTask.name);
  };

  const approve = async () => {
    if (isCreate) { return createTask(); }
    if (!active || !matched) return;
    const row = active, p = cleanPatch;
    const dateMatch = row.email_date && /^(\d{4})-(\d{2})-(\d{2})$/.exec(row.email_date);
    const ymd = dateMatch ? row.email_date : new Date().toISOString().slice(0, 10);
    // Only attach a note when the reviewer actually typed one (matches createTask's guard) — an
    // unconditional append left a blank note on the task, inflating its notes badge/count.
    const noteTxt = String(noteText || "").trim();
    const existingNotes = Array.isArray(target.notes) ? target.notes : [];
    const merged = noteTxt
      ? { ...p, notes: [...existingNotes, { id: Date.now(), date: ymd, text: noteTxt }] }
      : { ...p };
    // NEW-1 — a suggested Owner is edited here as ONE proposed value (see propOwner above), but the
    // real task's field is a LIST — wrap it, or approving a suggestion would overwrite the array
    // with a bare string. Approving REPLACES the whole owner list, same as any other approved field.
    if ('responsibleParty' in merged) merged.responsibleParty = merged.responsibleParty ? [merged.responsibleParty] : [];
    undoRef.current = { kind: 'approve', pid, tasks: JSON.parse(JSON.stringify(proj.tasks)), row, idx: activeIdx };
    try { updateTask(targetId, merged, pid); }
    catch (e) { console.error("updateTask failed:", e); return; }
    const sb = window.__sb;
    if (sb) { try { await sb.from('planar_suggestions').update({ status: 'approved' }).eq('id', row.id); } catch (e) { console.warn("mark approved failed:", e); } }
    setRows(R => R.filter(r => r.id !== row.id));
    setEdits(E => { const c = { ...E }; delete c[row.id]; return c; });
    flash("Approved · " + (row.email_subject || "update"));
  };

  const dismiss = async () => {
    if (!active) return;
    const row = active;
    undoRef.current = { kind: 'dismiss', row, idx: activeIdx };
    const sb = window.__sb;
    if (sb) { try { await sb.from('planar_suggestions').update({ status: 'dismissed' }).eq('id', row.id); } catch (e) { console.warn("mark dismissed failed:", e); } }
    setRows(R => R.filter(r => r.id !== row.id));
    setEdits(E => { const c = { ...E }; delete c[row.id]; return c; });
    flash("Dismissed · " + (row.email_subject || "update"));
  };

  const doUndo = async () => {
    const snap = undoRef.current; if (!snap) return;
    undoRef.current = null; setToast(null);
    if (snap.kind === 'approve' && setData) {
      setData(d => (d.projects && d.projects[snap.pid]) ? { ...d, projects: { ...d.projects, [snap.pid]: { ...d.projects[snap.pid], tasks: snap.tasks } } } : d);
    }
    setRows(R => R.some(r => r.id === snap.row.id) ? R : [snap.row, ...R]);
    setActiveIdx(0);
    const sb = window.__sb;
    if (sb) { try { await sb.from('planar_suggestions').update({ status: 'pending' }).eq('id', snap.row.id); } catch (e) {} }
  };

  const prev = () => setActiveIdx(i => Math.max(0, i - 1));
  const next = () => setActiveIdx(i => Math.min(rows.length - 1, i + 1));

  useEffect(() => {
    const h = (e) => {
      const t = e.target;
      if (mailReaderOpen) { if (e.key === 'Escape') { e.preventDefault(); setMailReaderOpen(false); } return; }
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === 'j' || e.key === 'ArrowRight') { e.preventDefault(); next(); }
      else if (k === 'k' || e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
      else if (k === 'a' || e.key === 'Enter') { if (active && (matched || createReady)) { e.preventDefault(); approve(); } }
      else if (k === 'x' || e.key === 'Backspace' || e.key === 'Delete') { if (active) { e.preventDefault(); dismiss(); } }
      else if (k === 'g') { e.preventDefault(); setView(v => v === 'grid' ? 'gantt' : 'grid'); }
      else if (k === 'u') { e.preventDefault(); doUndo(); }
      else if (e.key === 'Escape') { if (onClose) { e.preventDefault(); onClose(); } }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  useEffect(() => {
    if (!matched) return;
    const id = setTimeout(() => {
      if (view === 'grid' && targetRef.current) targetRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
      if (view === 'gantt' && canvasRef.current && targetRef.current) {
        const bar = targetRef.current.querySelector('.rev-bar,.rev-amber,.rev-ghost');
        if (bar) canvasRef.current.scrollTo({ left: Math.max(0, bar.offsetLeft - 120), behavior: 'smooth' });
      }
    }, 60);
    return () => clearTimeout(id);
  }, [activeIdx, view, matched, targetId]);

  // Keep the real grid's selection on the targeted task, so it highlights + scrolls into view as you step the queue.
  useEffect(() => {
    if (!(matched && gridProps && gridProps.setSelectedId && targetId != null)) return;
    const id = setTimeout(() => gridProps.setSelectedId(targetId), 60);
    return () => clearTimeout(id);
  }, [targetId, matched]);

  const onDivDown = (e) => {
    e.preventDefault();
    const sy = e.clientY, sp = split, H = bodyRef.current.getBoundingClientRect().height;
    const mv = (ev) => { let p = sp + ((ev.clientY - sy) / H) * 100; p = Math.max(28, Math.min(76, p)); setSplit(p); };
    const release = window.pinSchedCursor("row-resize", { onExit: () => up() });
    const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); release(); };
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
  };

  const visualTasks = proj ? sortByVisualOrder(proj.tasks) : [];
  const byId = {}; (proj ? proj.tasks : []).forEach(t => byId[t.id] = t);
  const depthOf = (t) => { let d = 0, p = t.parentId; while (p != null && byId[p]) { d++; p = byId[p].parentId; } return d; };

  const renderStatus = (h) => {
    const m = HEALTH[h] || HEALTH.gray;
    return <span className="revstatus"><span className="revdot" style={{ background: m.dot, border: m.border }}/>{m.label}</span>;
  };

  const renderGrid = () => {
    if (!proj) return <div className="rev-hint">Pick a task in the panel below to preview this update against the plan.</div>;
    return (
      <div className="rev-grid">
        <div className="rev-ghead">
          <div className="rev-cell">Task</div><div className="rev-cell">Start</div><div className="rev-cell">End</div>
          <div className="rev-cell">Status</div><div className="rev-cell">Owner</div><div className="rev-cell"/>
        </div>
        {visualTasks.map(t => {
          const isTgt = matched && t.id === targetId;
          const mv = moverMap[t.id];
          const hasSug = (t.id in sugByTask) && !isTgt;
          const ss = mv ? { start: mv.newStart, end: mv.newEnd } : { start: t.start, end: t.end };
          return (
            <React.Fragment key={t.id}>
              <div ref={isTgt ? targetRef : null}
                   className={"rev-row" + (isTgt ? " tgt" : "") + (mv ? " mv" : "") + (hasSug ? " pick" : "")}
                   onClick={hasSug ? () => setActiveIdx(sugByTask[t.id]) : undefined}>
                <div className="rev-cell rev-name" style={{ paddingLeft: (12 + depthOf(t) * 15) + "px" }}>
                  {hasSug ? <span className="rev-sugdot" title="Pending update"/> : null}
                  <span className="nm">{t.name || "(untitled)"}</span>
                </div>
                <div className="rev-cell rev-date">{rfmt(ss.start)}{mv ? <span className="rev-delta">{mv.dStart >= 0 ? "+" : ""}{mv.dStart}d</span> : null}</div>
                <div className="rev-cell rev-date">{rfmt(ss.end)}{mv ? <span className="rev-delta">{mv.dEnd >= 0 ? "+" : ""}{mv.dEnd}d</span> : null}</div>
                <div className="rev-cell">{renderStatus(t.health)}</div>
                <div className="rev-cell rev-owner"><span className="nm">{ownerJoin(ownerListOf(t))}</span></div>
                <div className="rev-cell"/>
              </div>
              {isTgt ? (
                <div className="rev-sub">
                  <div className="rev-cell rev-prop" style={{ paddingLeft: (12 + depthOf(t) * 15) + "px" }}>
                    <i className="ti ti-corner-down-right"/>proposed
                  </div>
                  <div className="rev-cell rev-date faint">{startChanged ? rfmt(propTarget.start) : ""}</div>
                  <div className="rev-cell rev-endcell">
                    <InlineDate value={propEnd} onCommit={(isoV) => setPatchField(active.id, 'end', isoV)} />
                    {endChanged ? <span className="rev-delta">{endDelta >= 0 ? "+" : ""}{endDelta}d</span> : null}
                  </div>
                  <div className="rev-cell">
                    <select className="rev-sel" value={propStatus} onChange={e => setPatchField(active.id, 'health', e.target.value)}>
                      {HK.map(k => <option key={k} value={k}>{(HEALTH[k] && HEALTH[k].label) || k}</option>)}
                    </select>
                  </div>
                  <div className="rev-cell">
                    <input {...NO_AUTOFILL} className="rev-edit" value={propOwner} placeholder="—"
                      onChange={e => setPatchField(active.id, 'responsibleParty', e.target.value)} />
                  </div>
                  <div className="rev-cell rev-actcell">
                    <button className="rev-iconbtn ok" title="Approve (A)" onClick={approve}><i className="ti ti-check"/></button>
                    <button className="rev-iconbtn no" title="Dismiss (X)" onClick={dismiss}><i className="ti ti-x"/></button>
                  </div>
                </div>
              ) : null}
            </React.Fragment>
          );
        })}
      </div>
    );
  };

  const renderGantt = () => {
    if (!proj) return <div className="rev-hint">Pick a task in the panel below to preview this update on the timeline.</div>;
    const PPD = 13, ROWH = 30, HEAD = 40, DAY = 86400000;
    let lo = null, hi = null;
    const pushd = s => { if (!s) return; const d = pd(s); if (!lo || d < lo) lo = d; if (!hi || d > hi) hi = d; };
    visualTasks.forEach(t => { pushd(t.start); pushd(t.end); const p = propById[t.id]; if (p) { pushd(p.start); pushd(p.end); } });
    if (!lo || !hi) return <div className="rev-hint">No dated tasks to show yet.</div>;
    lo = new Date(lo.getTime() - 3 * DAY); hi = new Date(hi.getTime() + 4 * DAY);
    const days = Math.round((hi - lo) / DAY) + 1;
    const width = days * PPD;
    const xOf = s => Math.round((pd(s) - lo) / DAY) * PPD;
    const wOf = (s, e) => (Math.round((pd(e) - pd(s)) / DAY) + 1) * PPD;
    const weekends = [], wk = [], months = [];
    for (let i = 0; i < days; i++) { const d = new Date(lo.getTime() + i * DAY); const g = d.getDay(); if (g === 0 || g === 6) weekends.push(i); if (g === 1) wk.push(i); if (d.getDate() === 1 || i === 0) months.push({ i, label: SGQ_MONTHS[d.getMonth()] + " " + String(d.getFullYear()).slice(2) }); }
    return (
      <div className="rev-gantt">
        <div className="rev-glabels">
          <div className="rev-glabhd">Task</div>
          {visualTasks.map(t => { const isTgt = matched && t.id === targetId; const mv = moverMap[t.id]; const m = HEALTH[t.health] || HEALTH.gray;
            return <div key={t.id} className={"rev-glab" + (isTgt ? " tgt" : "") + (mv ? " mv" : "")} style={{ paddingLeft: (12 + depthOf(t) * 12) + "px" }}>
              <span className="revdot" style={{ background: m.dot, border: m.border }}/><span className="nm">{t.name || "(untitled)"}</span></div>; })}
        </div>
        <div className="rev-gcanvas" ref={canvasRef}>
          <div style={{ position: "relative", width: width + "px" }}>
            <div className="rev-axis">{months.map((m, k) => <div key={k} className="rev-month" style={{ left: (m.i * PPD) + "px" }}>{m.label}</div>)}</div>
            {weekends.map(i => <div key={'w'+i} className="rev-weekend" style={{ left: (i*PPD)+"px", width: PPD+"px", top: HEAD+"px" }}/>)}
            {wk.map(i => <div key={'l'+i} className="rev-wk" style={{ left: (i*PPD)+"px", top: HEAD+"px" }}/>)}
            {visualTasks.map((t, ri) => {
              const isTgt = matched && t.id === targetId; const mv = moverMap[t.id];
              const top = HEAD + ri * ROWH; const m = HEALTH[t.health] || HEALTH.gray;
              const p = propById[t.id];
              const changed = (isTgt && propTarget && (propTarget.end !== t.end || propTarget.start !== t.start)) || !!mv;
              return (
                <div key={t.id} className={"rev-grow" + (isTgt ? " tgt" : "") + (mv ? " mv" : "")} style={{ top: top + "px" }} ref={isTgt ? targetRef : null}>
                  {(!t.start || !t.end) ? null : (changed && p) ? (
                    <React.Fragment>
                      <div className="rev-ghost" style={{ left: xOf(t.start)+"px", width: wOf(t.start,t.end)+"px" }}/>
                      <div className="rev-amber" style={{ left: xOf(p.start)+"px", width: wOf(p.start,p.end)+"px" }}/>
                      {isTgt ? <div className="rev-flag" style={{ left: (xOf(p.end)+8)+"px" }}>{endDelta>=0?"+":""}{endDelta}d</div> : null}
                    </React.Fragment>
                  ) : (
                    <div className="rev-bar" style={{ left: xOf(t.start)+"px", width: wOf(t.start,t.end)+"px", background: m.ganttBar }}/>
                  )}
                </div>
              );
            })}
            <div style={{ height: (HEAD + visualTasks.length * ROWH) + "px" }}/>
          </div>
        </div>
      </div>
    );
  };

  const fromName = active ? (active.email_from || "Unknown sender") : "";
  const fromMatch = active ? /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(fromName) : null;
  const dispName = fromMatch ? (fromMatch[1] || fromMatch[2]) : fromName;
  const dispEmail = fromMatch ? fromMatch[2] : "";

  const renderDrawer = () => {
    if (!active) return (
      <div className="rev-empty"><div className="ico"><i className="ti ti-inbox"/></div><h3>Inbox zero</h3><p>No pending updates. Forward a work email and it’ll show up here as a suggested edit.</p></div>
    );
    return (
      <div className="rev-drawer">
        <div className="rev-cols">
          <div className="rev-mail">
            <div className="rev-head">
              <div className="rev-av" style={{ background: sgqAvatarColor(dispName) }}>{sgqInitials(dispName)}</div>
              <div className="rev-who"><div className="rev-name">{dispName}</div>{dispEmail ? <div className="rev-email">{dispEmail}</div> : null}</div>
              <div className="rev-meta"><span className="rev-date2">{rfmt(active.email_date)}</span><span className={"rev-conf " + sgqConfClass(active.confidence)}>{Math.round((active.confidence||0)*100)}% match</span></div>
            </div>
            <div className="rev-subject">{active.email_subject || "(no subject)"}{matched ? <span className="rev-tgtpill"><i className="ti ti-target-arrow"/>{target.name}</span> : null}</div>
            {(() => {
              const ce = cleanEmailBody(active.email_body);
              return (
                <React.Fragment>
                  <div className="rev-bodywrap">
                    <div className="rev-mailbody" ref={mailBodyRef} style={{maxHeight:156, overflow:"hidden"}}>{ce.body || "(no body)"}</div>
                    {mailOverflow ? <div className="rev-fade"/> : null}
                  </div>
                  {mailOverflow
                    ? <button className="rev-readmore" onClick={() => setMailReaderOpen(true)}><i className="ti ti-arrows-diagonal" style={{fontSize:13}}/>Read full message</button>
                    : (ce.hasQuoted ? (
                        <div className="rev-quotewrap">
                          <button className="rev-quote-toggle" onClick={() => setShowQuoted(q => !q)}>
                            <i className={"ti " + (showQuoted ? "ti-chevron-down" : "ti-chevron-right")} style={{fontSize:13}}/>
                            {showQuoted ? "Hide quoted thread & disclaimers" : "Show quoted thread & disclaimers"}
                          </button>
                          {showQuoted ? <div className="rev-quoted">{ce.quoted}</div> : null}
                        </div>
                      ) : null)
                  }
                </React.Fragment>
              );
            })()}
          </div>
          <div className="rev-card">
            {isCreate ? (
              <React.Fragment>
                <div className="rev-taskline">
                  <span style={{display:"inline-flex", alignItems:"center", gap:7, minWidth:0}}>
                    <span style={{fontSize:9.5, fontWeight:700, color:"#15803d", background:"#dcfce7", border:"1px solid #86efac", borderRadius:5, padding:"2px 6px", letterSpacing:".04em", flexShrink:0}}>NEW TASK</span>
                    <SgqCrumb data={data} pid={pid} path={eff.task_path}/>
                  </span>
                </div>
                <div className="rev-lbl" style={{ marginTop: 10 }}>Task name</div>
                <input {...NO_AUTOFILL} className="rev-note" style={{ flex:"0 0 auto", minHeight:0, height:34, fontWeight:600 }} value={(eff.patch && eff.patch.name) || ''} placeholder="New task name"
                  onChange={e => patchRow(active.id, { patch: { ...(eff.patch || {}), name: e.target.value } })}/>
                <div className="rev-lbl" style={{ marginTop: 10 }}>Note</div>
                <textarea className="rev-note" rows={2} value={noteText} placeholder="Add a note to the new task…"
                  onChange={e => patchRow(active.id, { note_text: e.target.value })}/>
                {createReady && newTask ? (
                  <div className="rev-cascade" style={{ color:"#15803d", background:"#ecfdf3", border:"1px solid #bbf7d0" }}>
                    <i className="ti ti-calendar-plus"/>
                    {"Scheduled " + rfmt(newTask.start) + "–" + rfmt(newTask.end) + " · " + newTask.duration + "d"}
                  </div>
                ) : null}
                {newTaskAddNames.length ? (
                  <div className="rev-cascade dep" style={{ marginLeft: 8 }}>
                    <i className="ti ti-arrow-bar-to-right"/>
                    {"Depends on " + newTaskAddNames.join(", ")}
                  </div>
                ) : null}
                <div className="rev-actions">
                  <div className="rev-qnav">
                    <button onClick={prev} disabled={activeIdx<=0} title="Previous (K)"><i className="ti ti-chevron-left"/></button>
                    <span className="rev-qpos">{activeIdx+1} of {rows.length}</span>
                    <button onClick={next} disabled={activeIdx>=rows.length-1} title="Next (J)"><i className="ti ti-chevron-right"/></button>
                  </div>
                  <div className="rev-actbtns">
                    <button className="rev-approve" onClick={approve} disabled={!createReady} style={!createReady ? {opacity:.5, cursor:"default"} : undefined}><i className="ti ti-plus"/>Create task</button>
                    <button className="rev-dismiss" onClick={dismiss}><i className="ti ti-x"/>Dismiss</button>
                  </div>
                </div>
              </React.Fragment>
            ) : !matched ? (
              <React.Fragment>
                <div className="rev-lbl">Match to a task</div>
                <p className="rev-cardhint">This suggestion isn’t linked to a task yet. Pick one to preview the change against the plan.</p>
                <SgqCascadePicker data={data} pid={eff.project_id} path={eff.task_path} ready={false}
                  onChange={(p, pa) => patchRow(active.id, { project_id: p, task_path: pa })}/>
              </React.Fragment>
            ) : (
              <React.Fragment>
                <div className="rev-taskline">
                  <SgqCrumb data={data} pid={pid} path={eff.task_path}/>
                  <span className="rev-change" onClick={() => setShowPicker(s => !s)}>{showPicker ? "done" : "change task"}</span>
                </div>
                {showPicker ? <div style={{ marginTop: 8 }}><SgqCascadePicker data={data} pid={eff.project_id} path={eff.task_path} ready={true}
                  onChange={(p, pa) => patchRow(active.id, { project_id: p, task_path: pa })}/></div> : null}

                <div className="rev-lbl" style={{ marginTop: 10 }}>Note</div>
                <textarea className="rev-note" rows={2} value={noteText} placeholder="Add a note to the task…"
                  onChange={e => patchRow(active.id, { note_text: e.target.value })}/>

                <div className={"rev-cascade " + (moversList.length ? "has" : "none")}>
                  <i className={moversList.length ? "ti ti-arrow-ramp-right-2" : "ti ti-circle-check"}/>
                  {moversList.length ? (moversList.length + " task" + (moversList.length>1?"s":"") + " shift " + (maxDelta>=0?"+":"") + maxDelta + " business day" + (Math.abs(maxDelta)>1?"s":"") + " downstream") : "No downstream schedule impact"}
                </div>
                {previewConflictMsg ? (
                  <div className="rev-cascade has" style={{marginTop:4}}><i className="ti ti-alert-triangle"/>{previewConflictMsg}</div>
                ) : null}
                {addedPredTasks.length ? (
                  <div className="rev-cascade dep" style={{marginLeft:8}}>
                    <i className="ti ti-arrow-bar-to-right"/>
                    {"Adds dependency on " + addedPredTasks.map(t => t.name).join(", ")}
                  </div>
                ) : null}

                <div className="rev-actions">
                  <div className="rev-qnav">
                    <button onClick={prev} disabled={activeIdx<=0} title="Previous (K)"><i className="ti ti-chevron-left"/></button>
                    <span className="rev-qpos">{activeIdx+1} of {rows.length}</span>
                    <button onClick={next} disabled={activeIdx>=rows.length-1} title="Next (J)"><i className="ti ti-chevron-right"/></button>
                  </div>
                  <div className="rev-actbtns">
                    <button className="rev-approve" onClick={approve}><i className="ti ti-check"/>Approve</button>
                    <button className="rev-dismiss" onClick={dismiss}><i className="ti ti-x"/>Dismiss</button>
                  </div>
                </div>
              </React.Fragment>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ── Build the task list the REAL grid renders while reviewing ──
  // While reviewing we show the FULL plan in visual order, ignoring Focus and collapsed parents, so the
  // targeted task and any downstream movers are always present (otherwise they'd be hidden and the band
  // would have nothing to attach to). The target sprouts an ephemeral "proposed" band right beneath it,
  // movers carry preview dates + Δ, other pending tasks get a clickable dot. Pure view state — only Approve writes.
  const flattenAll = (ts) => {
    if (!ts || !ts.length) return [];
    const childSet = focusGroupIds(ts);
    const kids = new Map();
    ts.forEach(t => { if (!kids.has(t.parentId)) kids.set(t.parentId, []); kids.get(t.parentId).push(t); });
    const out = [];
    const walk = (pid, level) => { (kids.get(pid) || []).forEach(t => { out.push({ ...t, level, hasChildren: childSet.has(t.id) }); walk(t.id, level + 1); }); };
    walk(null, 0);
    return out;
  };
  const buildReviewTasks = () => {
    const base = (proj && proj.tasks && proj.tasks.length) ? flattenAll(proj.tasks) : ((gridProps && gridProps.tasks) ? gridProps.tasks : []);
    if (isCreate) {
      if (!createReady || !newTask) return base;
      const subtreeSet = (arr, rootId) => { const s = new Set([rootId]); let c = true; while (c) { c = false; arr.forEach(t => { if (t.parentId != null && s.has(t.parentId) && !s.has(t.id)) { s.add(t.id); c = true; } }); } return s; };
      const lastOfSubtree = (arr, rootId) => { if (rootId == null) return -1; const s = subtreeSet(arr, rootId); let last = -1; arr.forEach((t, i) => { if (s.has(t.id)) last = i; }); return last; };
      const predIds = new Set((newTask.predecessors || []).map(p => p.id));
      const parentRow = newTask.parentId != null ? base.find(t => t.id === newTask.parentId) : null;
      const row = { id: '__rvnew', __rvProposed: true, __rvNew: true, level: parentRow ? (parentRow.level || 0) + 1 : 0 };
      // Slot the new task right after the predecessor it depends on (when that predecessor sits under the
      // same parent) — a task should follow what must finish first. Otherwise drop it at the end of the parent's children.
      let anchor = -1;
      base.forEach((t, i) => { if (predIds.has(t.id) && t.parentId === newTask.parentId) anchor = i; });
      if (anchor >= 0) anchor = lastOfSubtree(base, base[anchor].id);
      else if (newTask.parentId != null) anchor = lastOfSubtree(base, newTask.parentId);
      if (anchor < 0) return [...base, row];
      const out = [];
      base.forEach((t, i) => { out.push(t); if (i === anchor) out.push(row); });
      return out;
    }
    if (!matched) return base.map(t => (t.id in sugByTask) ? { ...t, __rvPending: sugByTask[t.id] } : t);
    const out = [];
    base.forEach(t => {
      if (t.id === targetId) {
        out.push({ ...t, __rvTarget: true });
        out.push({ id: '__rvprop', name: '', __rvProposed: true, level: t.level || 0 });
      } else if (moverMap[t.id]) {
        const m = moverMap[t.id];
        out.push({ ...t, start: m.newStart, end: m.newEnd, __rvMover: m.dEnd });
      } else if (t.id in sugByTask) {
        out.push({ ...t, __rvPending: sugByTask[t.id] });
      } else {
        out.push(t);
      }
    });
    return out;
  };
  const reviewTasks = gridProps ? buildReviewTasks() : null;
  // End and duration are mutually exclusive drivers (matching the grid): setting one clears the other
  // so the preview engine recomputes the dependent value cleanly.
  const setPatchExclusive = (set, drop) => setEdits(E => {
    if (!active) return E;
    const row = rows.find(r => r.id === active.id);
    const cur = (E[active.id] && E[active.id].patch) || (row && row.patch) || {};
    const np = { ...cur, ...set }; drop.forEach(k => { delete np[k]; });
    return { ...E, [active.id]: { ...(E[active.id] || {}), patch: np } };
  });
  const reviewCtx = {
    isCreate,
    newName: newTask ? newTask.name : '',
    propStatus: isCreate ? (newTask ? newTask.health : 'gray') : propStatus,
    propEnd:    isCreate ? (newTask ? newTask.end : '') : propEnd,
    propOwner:  isCreate ? (newTask ? (newTask.responsibleParty || '') : '') : propOwner,
    propStart:  isCreate ? (newTask ? newTask.start : '') : (propTarget ? propTarget.start : (target ? target.start : '')),
    startChanged: isCreate ? true : !!startChanged,
    propDur:    isCreate ? (newTask ? newTask.duration : null) : (propTarget ? propTarget.duration : (target ? target.duration : null)),
    addedPreds: isCreate ? newTaskAddNames : addedPredTasks.map(t => t.name),
    endChanged: isCreate ? false : !!endChanged, endDelta,
    note: !!(noteText && String(noteText).trim()),
    onStatus: (v) => { if (active) setPatchField(active.id, 'health', v); },
    onEnd:    (v) => { if (active) setPatchExclusive({ end: v }, ['duration']); },
    onDur:    (v) => { if (active) setPatchExclusive({ duration: v }, ['end']); },
    onOwner:  (v) => { if (active) setPatchField(active.id, 'responsibleParty', v); },
    approve, dismiss,
    pick: (idx) => setActiveIdx(idx),
  };

  if (loading) return <div className="rev" style={{flex:1, minHeight:0}}><div className="rev-loading">Loading updates…</div></div>;

  return (
    <div className="rev" style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
      <div className="rev-body" ref={bodyRef} style={{flex:1}}>
        <div className="rev-top" style={{ height: split + "%", overflow:"hidden", display:"flex", minHeight:0 }}>
          {(gridProps && reviewTasks)
            ? <GridView {...gridProps} tasks={reviewTasks} review={reviewCtx} />
            : (view==='grid' ? renderGrid() : renderGantt())}
        </div>
        <div className="rev-div" onMouseDown={onDivDown}><span className="grip"><i/><i/><i/></span></div>
        <div className="rev-bottom">{renderDrawer()}</div>
      </div>
      {toast ? <div className="rev-toast"><span className="tmsg"><i className="ti ti-check ok"/>{toast.msg}</span><button onClick={doUndo}><i className="ti ti-arrow-back-up"/>Undo</button></div> : null}
      {mailReaderOpen && active ? (
        <div className="rev-readeroverlay" onClick={() => setMailReaderOpen(false)}>
          <div className="rev-reader" onClick={e => e.stopPropagation()}>
            <div className="rev-reader-head">
              <div className="rev-av" style={{ background: sgqAvatarColor(dispName) }}>{sgqInitials(dispName)}</div>
              <div className="rev-who" style={{flex:1, minWidth:0}}>
                <div className="rev-name">{dispName}</div>
                {dispEmail ? <div className="rev-email">{dispEmail}</div> : null}
              </div>
              <span className="rev-date2">{rfmt(active.email_date)}</span>
              <button className="rev-reader-close" onClick={() => setMailReaderOpen(false)} title="Close (Esc)"><i className="ti ti-x"/></button>
            </div>
            <div className="rev-reader-subject">{active.email_subject || "(no subject)"}</div>
            <div className="rev-reader-body">
              {(() => { const ce = cleanEmailBody(active.email_body); return (
                <React.Fragment>
                  <div className="rev-mailbody" style={{marginTop:0}}>{ce.body || "(no body)"}</div>
                  {ce.hasQuoted ? (
                    <div className="rev-quotewrap">
                      <button className="rev-quote-toggle" onClick={() => setShowQuoted(q => !q)}>
                        <i className={"ti " + (showQuoted ? "ti-chevron-down" : "ti-chevron-right")} style={{fontSize:13}}/>
                        {showQuoted ? "Hide quoted thread & disclaimers" : "Show quoted thread & disclaimers"}
                      </button>
                      {showQuoted ? <div className="rev-quoted">{ce.quoted}</div> : null}
                    </div>
                  ) : null}
                </React.Fragment>
              ); })()}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// harness compatibility — the old classic-script page made every top-level binding a global, and the ui-audit / e2e
// drivers call them by bare name from page.evaluate (GanttView, buildGanttSVG, COLS, showToast, …). Same names, same values.
exposeToHarness({
  SGQ_HEALTH: [() => SGQ_HEALTH],
  SGQ_HKEYS: [() => SGQ_HKEYS],
  SGQ_AV: [() => SGQ_AV],
  SGQ_ALLOWED_PATCH: [() => SGQ_ALLOWED_PATCH],
  SGQ_MONTHS: [() => SGQ_MONTHS],
  sgqAvatarColor: [() => sgqAvatarColor],
  sgqInitials: [() => sgqInitials],
  sgqConfClass: [() => sgqConfClass],
  sgqFmtDate: [() => sgqFmtDate],
  SgqDot: [() => SgqDot],
  sgqChildrenOf: [() => sgqChildrenOf],
  sgqCrumbOf: [() => sgqCrumbOf],
  SgqCrumb: [() => SgqCrumb],
  SgqCascadePicker: [() => SgqCascadePicker],
  SgqChangeRow: [() => SgqChangeRow],
  InlineDate: [() => InlineDate],
  cleanEmailBody: [() => cleanEmailBody],
  SuggestionsView: [() => SuggestionsView],
});
