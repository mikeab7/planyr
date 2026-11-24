import { NO_AUTOFILL, useAnchoredPopover } from "../common.jsx";
import { agendaDeadline, cadenceSummary, importMeetingBodies, joinWithAnd, mbBodiesSameCadence, mbRuleSummary, meetingDatesInRange, positionMissingReport } from "../../../../shared/schedule/engine/meetings.js";
import { addD, fdLocal } from "../../../../shared/schedule/engine/calendar.js";
import { exposeToHarness } from "../harnessGlobals.js";

const { useState, useEffect, useRef } = React;


// ── Meeting calendars — dedicated editor window (B815/B845 editor, promoted out of Settings) ──
// B815 built this editor inside the 300px Settings popover; the owner called that UI out
// (2026-07-15) — the dense editor (presets, multi-rule cadence cards, 12 month chips, the
// next-6-meetings preview) needs real width. Now a centered master-detail window: left rail =
// the project's bodies, right pane = the selected body's editor. Module-scope
// (MODULE-SCOPE-COMPONENTS): an inner definition would remount per render and drop input focus.
// Fully controlled: `bodies` in, `onChange(next)` out — the caller owns the setData write path
// (and MUST call rebuildMeetingBodyIndex, see the render site). Live-previews the next 6
// resolved meeting dates + agenda deadlines so a wrong rule is visible immediately.
const MB_WD = [{v:0,l:"Sun"},{v:1,l:"Mon"},{v:2,l:"Tue"},{v:3,l:"Wed"},{v:4,l:"Thu"},{v:5,l:"Fri"},{v:6,l:"Sat"}];
// NEW-1 — POSITION is a multi-pick: 1st..5th plus 2nd-to-last/Last, with "Every week" exclusive
// (picking it clears everything else — the new home for the old separate Weekly mode).
const MB_POSITIONS = [{v:1,l:"1st"},{v:2,l:"2nd"},{v:3,l:"3rd"},{v:4,l:"4th"},{v:5,l:"5th"},{v:-2,l:"2nd-to-last"},{v:-1,l:"Last"}];
const MB_MONTHS = [{v:1,l:"Jan"},{v:2,l:"Feb"},{v:3,l:"Mar"},{v:4,l:"Apr"},{v:5,l:"May"},{v:6,l:"Jun"},{v:7,l:"Jul"},{v:8,l:"Aug"},{v:9,l:"Sep"},{v:10,l:"Oct"},{v:11,l:"Nov"},{v:12,l:"Dec"}];
// One dot color per pattern (cycled), so the merged "next meetings" list can show which pattern
// produced each date without repeating the whole sentence.
const MB_PATTERN_COLORS = ["#2563eb","#d97706","#059669","#db2777","#7c3aed","#0891b2"];
const newMeetingBody = () => ({
  id: "mb_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
  name: "", jurisdiction: "",
  recurrence: [{ positions: [2, 4], weekday: 2, months: "all", anchor: null }],
  agendaLead: { type: "offset", n: 10, unit: "business" },
  cutoffTime: "12:00 PM", sameDayFilingAllowed: false,
  blackoutDates: [], extraDates: [], sourceUrl: "", verifiedOn: "",
});
const mbFmt = iso => { if(!iso) return ""; const d=new Date(iso+"T12:00:00"); return isNaN(d)?"":d.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}); };
// MB_ACTIVE_POPOVER_CLOSE — a single module-level slot naming the currently-open MBMultiPick's own
// close function. MeetingCalendarsModal's Escape handler (a document-level CAPTURE listener) always
// runs before any handler bound inside the modal, so a popover can't just listen for its own
// Escape — the modal would close first. Routing through this slot lets the modal's own handler close
// the popover INSTEAD of itself when one is open, satisfying "Escape closes the popover" without a
// second competing capture listener.
let MB_ACTIVE_POPOVER_CLOSE = null;
// MBMultiPick (NEW-1) — the multi-select popover POSITION and MONTHS share: `value` is either
// `allValue` (the exclusive "every"/"all" sentinel) or a non-empty array of picked option values.
// Fully keyboard-operable: the trigger is a real <button> (native Enter/Space activation + focus),
// every option is a real <button role="checkbox">, and Escape closes it via MB_ACTIVE_POPOVER_CLOSE.
function MBMultiPick({ value, onChange, options, allValue, allRowLabel, allButtonLabel, formatSelected }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null), popRef = useRef(null);
  const pos = useAnchoredPopover(open, btnRef, r => ({top: r.bottom + 4, left: r.left}), () => setOpen(false));   // NEW-1
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    MB_ACTIVE_POPOVER_CLOSE = close;
    const down = e => { if (!btnRef.current?.contains(e.target) && !popRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", down);
    return () => { document.removeEventListener("mousedown", down); if (MB_ACTIVE_POPOVER_CLOSE === close) MB_ACTIVE_POPOVER_CLOSE = null; };
  }, [open]);
  const isAll = value === allValue;
  const picked = isAll ? [] : (Array.isArray(value) ? value : []);
  const toggle = v => {
    const has = picked.includes(v);
    const next = has ? picked.filter(x => x !== v) : [...picked, v];
    onChange(next.length ? next : allValue);
  };
  const openMenu = e => {
    e.stopPropagation();
    setOpen(o => !o);
  };
  const chip = (on, extra) => ({padding:"4px 10px",fontSize:11.5,borderRadius:5,cursor:"pointer",border:"1px solid var(--bd2)",background:on?"var(--amber)":"#fff",color:on?"#fff":"var(--mut)",fontFamily:"inherit",...extra});
  const label = isAll ? allButtonLabel : (formatSelected ? formatSelected(picked) : joinWithAnd(picked.map(v => (options.find(o=>o.v===v)||{}).l || String(v))));
  return (
    <>
      <button type="button" ref={btnRef} onClick={openMenu}
        style={{fontSize:12,padding:"3px 8px",border:"1px solid var(--bd2)",borderRadius:5,background:"var(--bg)",color:"var(--txt)",cursor:"pointer",fontWeight:600,display:"inline-flex",alignItems:"center",gap:3,fontFamily:"inherit"}}>
        {label} <span style={{fontSize:7,opacity:.7}}>▾</span>
      </button>
      {open && pos && ReactDOM.createPortal(
        <div ref={popRef} onMouseDown={e=>e.stopPropagation()}
          style={{position:"fixed",top:pos.top,left:pos.left,minWidth:200,maxWidth:260,background:"var(--bg)",border:"1px solid var(--bd2)",borderRadius:6,padding:6,zIndex:9999,boxShadow:"0 4px 16px rgba(0,0,0,.15)",display:"flex",flexWrap:"wrap",gap:4}}>
          <button type="button" role="checkbox" aria-checked={isAll} onClick={()=>{ onChange(allValue); setOpen(false); }}
            style={chip(isAll, {flexBasis:"100%",fontWeight:700})}>{allRowLabel}</button>
          {options.map(o => {
            const on = picked.includes(o.v);
            return <button type="button" role="checkbox" aria-checked={on} key={String(o.v)} onClick={()=>toggle(o.v)} style={chip(on)}>{o.l}</button>;
          })}
        </div>, document.body)}
    </>
  );
}
// MeetingImportPicker (NEW-1, B1824576) — "Import from another schedule…": every meeting body on
// every OTHER schedule on the account, grouped by schedule, multi-select, each showing its cadence
// sentence + next few dates so the owner can tell same-named bodies with different cadences apart.
// A body whose name + recurrence already match one on THIS schedule is tagged "already here" —
// still pickable (importMeetingBody dedupes it to the existing copy, never a second one).
function MeetingImportPicker({ otherSchedules, existingBodies, onImport, onCancel }) {
  const [picked, setPicked] = useState(() => new Set());
  const toggle = key => setPicked(prev => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const today = fdLocal(new Date());
  const nextDates = b => meetingDatesInRange(b, today, addD(today, 366 * 2)).slice(0, 3);
  const alreadyHere = b => (existingBodies || []).some(eb => mbBodiesSameCadence(eb, b));
  const entries = otherSchedules.flatMap(g => g.bodies.map(b => ({ key: `${g.pid}:${b.id}`, g, b })));
  const byKey = new Map(entries.map(e => [e.key, e.b]));
  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{padding:"9px 18px",borderBottom:"1px solid var(--bd)",display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
        <span onClick={onCancel} title="Back" style={{cursor:"pointer",color:"var(--mut)",fontSize:13,lineHeight:1}}>&larr;</span>
        <span style={{fontSize:12.5,fontWeight:600,color:"var(--txt)"}}>Import meeting calendars</span>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"12px 18px"}}>
        {otherSchedules.length === 0 && (
          <div style={{fontSize:12,color:"var(--mut)",fontStyle:"italic"}}>No other schedules on this account have meeting calendars yet.</div>
        )}
        {otherSchedules.map(g => (
          <div key={g.pid} style={{marginBottom:16}}>
            {/* B1873361 — g.schedName is now the full "<Project> / <Schedule>" label (house order),
                so the old reversed "<Schedule> · <Project>" tacked on here is retired, not just
                reordered — schedName already carries both halves. */}
            <div style={{fontSize:10,fontWeight:700,color:"var(--mut)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:6}}>
              {g.schedName}
            </div>
            {g.bodies.map(b => {
              const key = `${g.pid}:${b.id}`;
              const on = picked.has(key);
              const dup = alreadyHere(b);
              const dates = nextDates(b);
              return (
                <label key={key} style={{display:"flex",alignItems:"flex-start",gap:8,padding:"7px 8px",borderRadius:6,cursor:"pointer",background:on?"var(--surf)":"transparent"}}>
                  <input type="checkbox" checked={on} onChange={()=>toggle(key)} style={{marginTop:3,flexShrink:0}} />
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:600,color:"var(--txt)"}}>
                      {b.name || <span style={{color:"var(--mut)",fontStyle:"italic",fontWeight:400}}>Untitled body</span>}
                      {dup && <span style={{marginLeft:7,fontSize:9.5,fontWeight:700,color:"var(--mut)",textTransform:"uppercase",letterSpacing:".04em"}}>already here</span>}
                    </div>
                    <div style={{fontSize:10.5,color:"var(--mut)",marginTop:2}}>{cadenceSummary(b)}</div>
                    <div style={{fontSize:10.5,color:"var(--mut)",marginTop:1}}>{dates.length ? dates.map(d=>mbFmt(d)).join(" · ") : "no dates resolve"}</div>
                  </div>
                </label>
              );
            })}
          </div>
        ))}
      </div>
      <div style={{padding:"10px 16px",borderTop:"1px solid var(--bd)",display:"flex",justifyContent:"flex-end",gap:8,flexShrink:0}}>
        <button className="btn" onClick={onCancel} style={{fontSize:12,padding:"6px 12px"}}>Cancel</button>
        <button className="btn" disabled={picked.size===0}
          onClick={()=>onImport([...picked].map(k=>byKey.get(k)).filter(Boolean))}
          style={{fontSize:12,padding:"6px 14px",background:picked.size?"var(--amber)":"#eee",color:picked.size?"#fff":"var(--mut)",borderColor:picked.size?"var(--amber)":"var(--bd2)",cursor:picked.size?"pointer":"default"}}>
          Import{picked.size ? ` ${picked.size}` : ""}
        </button>
      </div>
    </div>
  );
}
export function MeetingCalendarsModal({ projName, bodies, otherSchedules = [], onChange, onClose }) {
  // Draft / Save model (owner ask, 2026-07-15): the window edits a WORKING COPY — nothing touches the
  // schedule until "Save changes", so it's unmistakable when the edits take effect. savedRef holds the
  // last-applied snapshot, driving the dirty flag + the unsaved-close guard. All edits are JSON-safe.
  const initial = Array.isArray(bodies) ? bodies : [];
  const [draft, setDraft] = useState(() => JSON.parse(JSON.stringify(initial)));
  const savedRef = useRef(JSON.stringify(initial));
  const [savedFlash, setSavedFlash] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const list = draft;
  const dirty = JSON.stringify(draft) !== savedRef.current;
  const [selId, setSelId] = useState(() => (list[0] && list[0].id) || null);
  const sel = list.find(b => b.id === selId) || null;
  const save = () => { onChange(JSON.parse(JSON.stringify(draft))); savedRef.current = JSON.stringify(draft); setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1600); };
  const requestClose = () => { if (dirty) setConfirmClose(true); else onClose(); };
  // NotesModal-style close hardening: a text-selection drag ending on the backdrop must not dismiss;
  // Escape backs out (an open POSITION/MONTHS popover first, then the confirm bar, then the close)
  // via a capture-phase listener — this always fires before any handler bound inside the modal, so a
  // popover can't just listen for its own Escape (see MB_ACTIVE_POPOVER_CLOSE).
  const backdropRef = useRef(null);
  const downOnBackdropRef = useRef(false);
  useEffect(() => {
    const onKey = e => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (MB_ACTIVE_POPOVER_CLOSE) { MB_ACTIVE_POPOVER_CLOSE(); MB_ACTIVE_POPOVER_CLOSE = null; return; }
      if (confirmClose) setConfirmClose(false); else requestClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  });
  // All edits mutate the DRAFT only (setDraft) — the parent's onChange runs once, on Save.
  const patch = (id, fields) => setDraft(prev => prev.map(b => b.id === id ? { ...b, ...fields } : b));
  const rulesOf = b => (Array.isArray(b.recurrence) && b.recurrence.length) ? b.recurrence : [{ positions:[2,4], weekday:2, months:"all", anchor:null }];
  const patchRuleAt = (id, idx, rf) => setDraft(prev => prev.map(b => b.id === id ? { ...b, recurrence: rulesOf(b).map((r, i) => i === idx ? { ...r, ...rf } : r) } : b));
  const addRuleAt = id => setDraft(prev => prev.map(b => b.id === id ? { ...b, recurrence: [...rulesOf(b), { positions:[1], weekday:2, months:"all", anchor:null }] } : b));
  const removeRuleAt = (id, idx) => setDraft(prev => prev.map(b => b.id === id ? { ...b, recurrence: rulesOf(b).filter((_, i) => i !== idx) } : b));
  const patchLead = (id, lf) => setDraft(prev => prev.map(b => b.id === id ? { ...b, agendaLead: { ...(b.agendaLead||{}), ...lf } } : b));
  const add = () => { const b = newMeetingBody(); setDraft(prev => [...prev, b]); setSelId(b.id); };
  const remove = id => { const rest = list.filter(b => b.id !== id); setDraft(prev => prev.filter(b => b.id !== id)); if (selId === id) setSelId((rest[0] && rest[0].id) || null); };
  // NEW-1 (B1824576) — "Import from another schedule…": pulls one or more bodies' cadence in
  // from another of the owner's schedules instead of re-entering it. Imported bodies land in the
  // DRAFT like any other edit — still gated behind Save changes, same as everything else here.
  const [importOpen, setImportOpen] = useState(false);
  const importBodies = sourceBodies => {
    const { bodies: next, ids } = importMeetingBodies(draft, sourceBodies);
    setDraft(next);
    if (ids.length) setSelId(ids[ids.length - 1]);
    setImportOpen(false);
  };
  const inp = { fontSize:12, padding:"5px 8px", border:"1px solid var(--bd2)", borderRadius:5, background:"var(--bg)", color:"var(--txt)", width:"100%", boxSizing:"border-box", fontFamily:"'Inter',system-ui,sans-serif" };
  const lbl = { fontSize:10, fontWeight:600, color:"var(--mut)", textTransform:"uppercase", letterSpacing:".05em", margin:"0 0 4px", display:"block" };
  const sect = { fontSize:10, fontWeight:700, color:"var(--mut)", textTransform:"uppercase", letterSpacing:".07em", margin:"18px 0 8px", paddingBottom:5, borderBottom:"1px solid var(--bd)" };
  const seg = (opts, val, on) => (
    <div style={{display:"flex",border:"1px solid var(--bd2)",borderRadius:5,overflow:"hidden",flexShrink:0}}>
      {opts.map(o => <span key={String(o.v)} onClick={()=>on(o.v)} style={{padding:"4px 10px",fontSize:11.5,cursor:"pointer",whiteSpace:"nowrap",background:val===o.v?"var(--amber)":"transparent",color:val===o.v?"#fff":"var(--mut)"}}>{o.l}</span>)}
    </div>
  );
  const today = fdLocal(new Date());
  // preview: the next N merged, de-duplicated meeting dates, each tagged with the color of the
  // FIRST pattern (in rule order) that produces it — N is 8 when any pattern is "every week"
  // (matches the acceptance spec: an every-week body's dates come far more densely).
  const preview = b => {
    const rules = rulesOf(b);
    const n = rules.some(r => r.positions === "every") ? 8 : 6;
    const merged = meetingDatesInRange(b, today, addD(today, 366*2)).slice(0, n);
    return merged.map(date => {
      const idx = rules.findIndex(r => meetingDatesInRange({ recurrence:[r] }, date, date).length > 0);
      return { date, dot: MB_PATTERN_COLORS[(idx >= 0 ? idx : 0) % MB_PATTERN_COLORS.length] };
    });
  };
  const detail = b => {
    const rules = rulesOf(b);
    const lead = b.agendaLead || { type:"offset", n:10, unit:"business" };
    const dates = preview(b);
    return (
      <div style={{padding:"16px 20px 20px"}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr auto",gap:12,alignItems:"end"}}>
          <div>
            <label style={lbl}>Body name</label>
            <input {...NO_AUTOFILL} value={b.name||""} placeholder="e.g. Baytown city council" onChange={e=>patch(b.id,{name:e.target.value})} style={{...inp,fontWeight:600}} />
          </div>
          <div>
            <label style={lbl}>Jurisdiction</label>
            <input {...NO_AUTOFILL} value={b.jurisdiction||""} placeholder="e.g. Baytown, TX" onChange={e=>patch(b.id,{jurisdiction:e.target.value})} style={inp} />
          </div>
          <button className="btn" onClick={()=>remove(b.id)} title="Remove this meeting body" style={{fontSize:11,padding:"5px 10px",color:"var(--danger,#d83a3a)"}}>Remove</button>
        </div>

        <div style={sect}>Meets</div>
        {rules.map((rule, ri) => {
          const isEvery = rule.positions === "every";
          const months = (rule.months === "all" || !Array.isArray(rule.months) || !rule.months.length) ? "all" : rule.months;
          const hasAnchor = !!(rule.anchor && rule.anchor.weekday != null && rule.anchor.position != null);
          const missing = positionMissingReport(rule, today);
          const ruleDates = meetingDatesInRange({ recurrence:[rule] }, today, addD(today, 366*4)).slice(0, 3);
          const dot = MB_PATTERN_COLORS[ri % MB_PATTERN_COLORS.length];
          return (
            <div key={ri} style={{border:"1px solid var(--bd)",borderRadius:6,padding:"10px 12px",marginBottom:8,background:"var(--surf)"}}>
              <div style={{display:"flex",alignItems:"flex-start",gap:6}}>
                <span title="This pattern's color in the resolved-dates list below" style={{width:7,height:7,marginTop:6,borderRadius:"50%",background:dot,flexShrink:0}} />
                <div style={{display:"flex",gap:6,rowGap:4,alignItems:"center",flexWrap:"wrap",flex:1,fontSize:12.5,color:"var(--txt)"}}>
                  <span>Meets</span>
                  {!isEvery && <span style={{color:"var(--mut)"}}>the</span>}
                  <MBMultiPick
                    value={isEvery ? "every" : (Array.isArray(rule.positions) ? rule.positions : [1])}
                    onChange={v => patchRuleAt(b.id, ri, v === "every" ? {positions:"every", anchor:null} : {positions:v})}
                    options={MB_POSITIONS} allValue="every" allRowLabel="Every week" allButtonLabel="every"
                    formatSelected={arr=>joinWithAnd(arr.map(v=>(MB_POSITIONS.find(o=>o.v===v)||{}).l||String(v)))} />
                  <select value={rule.weekday} onChange={e=>patchRuleAt(b.id,ri,{weekday:+e.target.value})} style={{...inp,width:"auto",display:"inline-block"}}>
                    {MB_WD.map(w=><option key={w.v} value={w.v}>{w.l}</option>)}
                  </select>
                  <span style={{color:"var(--mut)"}}>{isEvery ? (months==="all" ? "," : "in") : "of"}</span>
                  <MBMultiPick
                    value={months}
                    onChange={v => patchRuleAt(b.id, ri, {months:v})}
                    options={MB_MONTHS} allValue="all" allRowLabel="Every month"
                    allButtonLabel={isEvery ? "all year" : "every month"} />
                </div>
                {rules.length>1 && <span onClick={()=>removeRuleAt(b.id,ri)} title="Remove this pattern" style={{cursor:"pointer",color:"var(--mut)",fontSize:14,padding:"0 2px",flexShrink:0}}>&#x2715;</span>}
              </div>
              {!isEvery && (
                <label style={{fontSize:11.5,color:"var(--txt)",display:"flex",alignItems:"flex-start",gap:6,cursor:"pointer",marginTop:10,paddingLeft:13}}>
                  <input type="checkbox" checked={hasAnchor} style={{marginTop:2,flexShrink:0}}
                    onChange={e=>patchRuleAt(b.id,ri, e.target.checked
                      ? {anchor:{position:1, weekday:(rule.weekday+6)%7}}
                      : {anchor:null})} />
                  <span style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                    <span>counting from after the</span>
                    {hasAnchor ? (<>
                      <select value={rule.anchor.position} onChange={e=>patchRuleAt(b.id,ri,{anchor:{...rule.anchor,position:+e.target.value}})} style={{...inp,width:"auto",display:"inline-block"}}>
                        {MB_POSITIONS.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}
                      </select>
                      <select value={rule.anchor.weekday} onChange={e=>patchRuleAt(b.id,ri,{anchor:{...rule.anchor,weekday:+e.target.value}})} style={{...inp,width:"auto",display:"inline-block"}}>
                        {MB_WD.map(w=><option key={w.v} value={w.v}>{w.l}</option>)}
                      </select>
                    </>) : <span style={{color:"var(--mut)",fontStyle:"italic"}}>1st Monday (e.g. the U.S. Election Day pattern)</span>}
                  </span>
                </label>
              )}
              {!isEvery && missing && missing.missing > 0 && (
                <div style={{marginTop:8,paddingLeft:13,fontSize:11,color:"var(--warn-text,#b45309)"}}>
                  ⚠ {missing.missing} of the next {missing.checked} picked months have no such meeting.
                </div>
              )}
              <div style={{marginTop:10,paddingTop:8,paddingLeft:13,borderTop:"1px dashed var(--bd2)",fontSize:11.5,lineHeight:1.5}}>
                <span style={{color:"var(--mut)"}}>Resolves to </span>
                <span style={{fontWeight:600,color:"var(--txt)"}}>{mbRuleSummary(rule)}</span>
                {ruleDates.length
                  ? <span style={{color:"var(--mut)"}}> — next: {ruleDates.map(d=>mbFmt(d)).join(" · ")}</span>
                  : <span style={{color:"var(--warn-text,#b45309)",fontWeight:600}}> — no dates resolve; check the rule</span>}
              </div>
            </div>
          );
        })}
        <button className="btn" onClick={()=>addRuleAt(b.id)} style={{fontSize:11,padding:"4px 10px"}}>+ And also…</button>

        <div style={sect}>Deadline before each meeting <span style={{textTransform:"none",fontWeight:400,letterSpacing:0}}>— file the agenda / call the election by (e.g. 78 calendar days before an election)</span></div>
        <div style={{fontSize:10.5,color:"var(--mut)",margin:"0 0 8px",lineHeight:1.5}}>
          To put this date on the schedule: right-click the bound task → “+ Add deadline row”. The row then always sits this far ahead of the meeting and moves with it.
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          {seg([{v:"offset",l:"Days before"},{v:"weekdayAnchor",l:"Weekday anchor"}], lead.type||"offset", v=>patchLead(b.id,{type:v}))}
          {(lead.type||"offset")==="offset" ? (<>
            <input type="number" min={0} value={lead.n??10} onChange={e=>patchLead(b.id,{n:+e.target.value})} style={{...inp,width:60}} />
            {seg([{v:"business",l:"business"},{v:"calendar",l:"calendar"}], lead.unit||"business", v=>patchLead(b.id,{unit:v}))}
            <span style={{fontSize:11.5,color:"var(--mut)"}}>days before</span>
          </>) : (<>
            <input type="number" min={0} value={lead.weeksBefore??2} onChange={e=>patchLead(b.id,{weeksBefore:+e.target.value})} style={{...inp,width:52}} />
            <span style={{fontSize:11.5,color:"var(--mut)"}}>weeks before, on</span>
            <select value={lead.weekday??3} onChange={e=>patchLead(b.id,{weekday:+e.target.value})} style={{...inp,width:"auto"}}>
              {MB_WD.map(w=><option key={w.v} value={w.v}>{w.l}</option>)}
            </select>
          </>)}
        </div>
        <div style={{display:"flex",gap:18,marginTop:10,alignItems:"flex-end",flexWrap:"wrap"}}>
          <div><label style={lbl}>Cutoff time</label>
            <input {...NO_AUTOFILL} value={b.cutoffTime||""} placeholder="12:00 PM" onChange={e=>patch(b.id,{cutoffTime:e.target.value})} style={{...inp,width:100}} /></div>
          <label style={{fontSize:11.5,color:"var(--txt)",display:"flex",alignItems:"center",gap:6,cursor:"pointer",paddingBottom:6}}>
            <input type="checkbox" checked={!!b.sameDayFilingAllowed} onChange={e=>patch(b.id,{sameDayFilingAllowed:e.target.checked})} /> Same-day filing OK
          </label>
        </div>

        <div style={sect}>Exceptions &amp; source</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <div>
            <label style={lbl}>Cancelled / blackout dates</label>
            <input {...NO_AUTOFILL} value={(b.blackoutDates||[]).join(", ")} placeholder="2026-12-22, 2026-12-29" title="Comma-separated YYYY-MM-DD" onChange={e=>patch(b.id,{blackoutDates:e.target.value.split(",").map(x=>x.trim()).filter(Boolean)})} style={inp} />
          </div>
          <div>
            <label style={lbl}>Special-called / extra dates</label>
            <input {...NO_AUTOFILL} value={(b.extraDates||[]).join(", ")} placeholder="2026-08-18" title="Comma-separated YYYY-MM-DD" onChange={e=>patch(b.id,{extraDates:e.target.value.split(",").map(x=>x.trim()).filter(Boolean)})} style={inp} />
          </div>
          <div>
            <label style={lbl}>Published calendar URL</label>
            <input {...NO_AUTOFILL} value={b.sourceUrl||""} placeholder="https://…/agenda-calendar" onChange={e=>patch(b.id,{sourceUrl:e.target.value})} style={inp} />
          </div>
          <div>
            <label style={lbl}>Verified on</label>
            <input type="date" value={b.verifiedOn||""} onChange={e=>patch(b.id,{verifiedOn:e.target.value})} style={{...inp,width:"auto"}} />
          </div>
        </div>

        <div style={{marginTop:18,background:"var(--surf)",border:"1px solid var(--bd)",borderRadius:8,padding:"10px 14px 12px"}}>
          <div style={{fontSize:12,marginBottom:8,paddingBottom:8,borderBottom:"1px solid var(--bd)"}}>
            <span style={{color:"var(--mut)"}}>This body meets </span>
            <span style={{fontWeight:600,color:"var(--txt)"}}>{cadenceSummary(b)}</span>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginBottom:4}}>
            <span style={{fontSize:10,fontWeight:700,color:"var(--mut)",textTransform:"uppercase",letterSpacing:".06em"}}>Next {dates.length || (rules.some(r=>r.positions==="every")?8:6)} meetings → file by</span>
            <span style={{fontSize:10,color: b.verifiedOn ? "var(--mut)" : "var(--warn-text,#b45309)"}}>{b.verifiedOn ? `verified ${mbFmt(b.verifiedOn)}` : "rule-derived, unverified"}</span>
          </div>
          {dates.length===0 && <div style={{fontSize:12,color:"var(--mut)",fontStyle:"italic",marginTop:4}}>No dates resolve — check the recurrence rule.</div>}
          {dates.map(({date:m, dot})=>(
            <div key={m} style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:12,padding:"3px 0",color:"var(--txt)",gap:8,borderTop:"1px dashed var(--bd)"}}>
              <span style={{display:"flex",alignItems:"center",gap:6,fontWeight:500}}>
                <span style={{width:6,height:6,borderRadius:"50%",background:dot,flexShrink:0}} />
                {mbFmt(m)}
              </span>
              <span style={{color:"var(--mut)"}}>file by {mbFmt(agendaDeadline(b,m))}{b.cutoffTime?` · ${b.cutoffTime}`:""}</span>
            </div>
          ))}
          {b.sourceUrl && <div style={{marginTop:6}}><a href={b.sourceUrl} target="_blank" rel="noreferrer" style={{fontSize:10.5,color:"var(--amber)"}}>published calendar ↗</a></div>}
        </div>
      </div>
    );
  };

  return (
    <div ref={backdropRef}
      onMouseDown={e => { downOnBackdropRef.current = (e.target === backdropRef.current); }}
      onClick={e => { const hit = e.target === backdropRef.current && downOnBackdropRef.current; downOnBackdropRef.current = false; if (hit) requestClose(); }}
      style={{position:"fixed",inset:0,background:"rgba(15,23,42,.38)",zIndex:9000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div data-testid="meeting-calendars-modal" onMouseDown={e=>e.stopPropagation()}
        style={{background:"var(--bg)",border:"1px solid var(--bd2)",borderRadius:10,width:"min(860px,96vw)",height:"min(640px,90vh)",
          display:"flex",flexDirection:"column",overflow:"hidden",boxShadow:"0 16px 48px rgba(0,0,0,.18)"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,padding:"12px 18px",borderBottom:"1px solid var(--bd)",flexShrink:0}}>
          <div>
            <div style={{fontSize:10,fontWeight:700,color:"var(--amber)",letterSpacing:".07em",textTransform:"uppercase",lineHeight:1,marginBottom:2}}>Meeting calendars</div>
            <div style={{fontSize:14,fontWeight:600,color:"var(--txt)"}}>{projName || "Project"}</div>
          </div>
          <div style={{display:"flex",gap:14,alignItems:"center",minWidth:0}}>
            <span style={{fontSize:10.5,color:"var(--mut)",maxWidth:380,textAlign:"right",lineHeight:1.45}}>External decision bodies (city council, P&amp;Z, commissioners court). Bind a task to one and its hearing date snaps to the body's calendar.</span>
            <span onClick={requestClose} title="Close (Esc)" style={{cursor:"pointer",color:"var(--mut)",fontSize:17,lineHeight:1,flexShrink:0}}>&#x2715;</span>
          </div>
        </div>
        {importOpen ? (
          <MeetingImportPicker otherSchedules={otherSchedules} existingBodies={draft} onCancel={()=>setImportOpen(false)} onImport={importBodies} />
        ) : (
        <div style={{flex:1,display:"flex",overflow:"hidden"}}>
          <div style={{width:216,flexShrink:0,borderRight:"1px solid var(--bd)",display:"flex",flexDirection:"column",background:"var(--surf)"}}>
            <div style={{flex:1,overflowY:"auto",padding:"8px 0"}}>
              {list.length===0 && <div style={{fontSize:11,color:"var(--mut)",fontStyle:"italic",padding:"8px 14px"}}>No meeting bodies yet.</div>}
              {list.map(b => {
                const isSel = b.id === selId;
                return (
                  <div key={b.id} data-testid="meeting-body-row" onClick={()=>setSelId(b.id)}
                    style={{padding:"8px 12px 8px 13px",cursor:"pointer",borderLeft:`3px solid ${isSel?"var(--amber)":"transparent"}`,background:isSel?"#fff":"transparent"}}>
                    <div style={{fontSize:12,fontWeight:600,color:"var(--txt)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{b.name || <span style={{color:"var(--mut)",fontStyle:"italic",fontWeight:400}}>Untitled body</span>}</div>
                    <div style={{fontSize:10,color:"var(--mut)",marginTop:2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{cadenceSummary(b)}</div>
                  </div>
                );
              })}
            </div>
            <div style={{padding:10,borderTop:"1px solid var(--bd)",flexShrink:0,display:"flex",flexDirection:"column",gap:6}}>
              <button className="btn" onClick={add} style={{width:"100%",fontSize:11.5,padding:"6px 10px"}}>+ Add meeting body</button>
              {/* NEW-1 (B1824576) — hidden entirely with no OTHER schedule on the account (nothing
                  to import); otherwise always enabled, even with zero bodies here. Never a dead button. */}
              {otherSchedules.length > 0 && (
                <button className="btn" onClick={()=>setImportOpen(true)} style={{width:"100%",fontSize:11.5,padding:"6px 10px"}}>Import from another schedule…</button>
              )}
            </div>
          </div>
          <div style={{flex:1,overflowY:"auto",minWidth:0}}>
            {sel ? detail(sel) : (
              <div style={{height:"100%",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:10,textAlign:"center",padding:"0 48px"}}>
                <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--mut)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 21h18"/><path d="M5 21V10M9 21V10M15 21V10M19 21V10"/><path d="M4 10h16"/><path d="M12 3 3 8h18L12 3Z"/>
                </svg>
                <div style={{fontSize:13.5,fontWeight:600,color:"var(--txt)"}}>No meeting calendars yet</div>
                <div style={{fontSize:11.5,color:"var(--mut)",lineHeight:1.55,maxWidth:380}}>
                  Add an external decision body — a city council, P&amp;Z commission, or commissioners court.
                  Bind a task to it (right-click the task) and its hearing date snaps to the body's calendar,
                  with the agenda-filing deadline derived automatically.
                </div>
                <div style={{display:"flex",gap:8,marginTop:4}}>
                  <button className="btn" onClick={add} style={{fontSize:12,padding:"7px 14px"}}>+ Add meeting body</button>
                  {otherSchedules.length > 0 && (
                    <button className="btn" onClick={()=>setImportOpen(true)} style={{fontSize:12,padding:"7px 14px"}}>Import from another schedule…</button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        )}
        {/* Footer — the explicit apply gate. Nothing on the schedule moves until Save changes. */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,padding:"10px 16px",borderTop:"1px solid var(--bd)",flexShrink:0,background:"var(--surf)"}}>
          {confirmClose ? (<>
            <span style={{fontSize:12,fontWeight:600,color:"var(--warn-text,#b45309)"}}>You have unsaved changes.</span>
            <div style={{display:"flex",gap:8}}>
              <button className="btn" onClick={()=>setConfirmClose(false)} style={{fontSize:12,padding:"6px 12px"}}>Keep editing</button>
              <button className="btn" onClick={onClose} style={{fontSize:12,padding:"6px 12px",color:"var(--danger,#d83a3a)"}}>Discard</button>
              <button className="btn" onClick={()=>{ save(); onClose(); }} style={{fontSize:12,padding:"6px 12px",background:"var(--amber)",color:"#fff",borderColor:"var(--amber)"}}>Save &amp; close</button>
            </div>
          </>) : (<>
            {/* NEW-2 (2026-09-22): this dialog does NOT autosave — edits live only in the draft until
                Save changes is clicked. The footer used to show "All changes saved" beside a (merely
                disabled) Save changes button at the same time, which read as self-contradictory even
                though the two never disagreed about the real state. Fix: when there is nothing to
                save, the Save button is gone entirely — only Close remains, matching what's true. */}
            <span style={{fontSize:11.5,fontWeight:600,color: dirty ? "var(--warn-text,#b45309)" : savedFlash ? "#15803d" : "var(--mut)"}}>
              {dirty ? "● Unsaved changes — nothing on the schedule has moved yet" : savedFlash ? "✓ Saved — the schedule updated" : "All changes saved"}
            </span>
            <div style={{display:"flex",gap:8}}>
              <button className="btn" onClick={requestClose} style={{fontSize:12,padding:"6px 12px"}}>{dirty ? "Cancel" : "Close"}</button>
              {dirty && <button className="btn" onClick={save} style={{fontSize:12,padding:"6px 14px",background:"var(--amber)",color:"#fff",borderColor:"var(--amber)"}}>Save changes</button>}
            </div>
          </>)}
        </div>
      </div>
    </div>
  );
}

// harness compatibility — the old classic-script page made every top-level binding a global, and the ui-audit / e2e
// drivers call them by bare name from page.evaluate (GanttView, buildGanttSVG, COLS, showToast, …). Same names, same values.
exposeToHarness({
  MB_WD: [() => MB_WD],
  MB_POSITIONS: [() => MB_POSITIONS],
  MB_MONTHS: [() => MB_MONTHS],
  MB_PATTERN_COLORS: [() => MB_PATTERN_COLORS],
  newMeetingBody: [() => newMeetingBody],
  mbFmt: [() => mbFmt],
  MB_ACTIVE_POPOVER_CLOSE: [() => MB_ACTIVE_POPOVER_CLOSE, (v) => { MB_ACTIVE_POPOVER_CLOSE = v; }],
  MBMultiPick: [() => MBMultiPick],
  MeetingImportPicker: [() => MeetingImportPicker],
  MeetingCalendarsModal: [() => MeetingCalendarsModal],
});
