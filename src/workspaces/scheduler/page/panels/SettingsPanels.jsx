import { DEFAULT_HOLIDAYS, DEFAULT_SETTINGS, HOLIDAY_DEFS, buildHolidaySet, setHolidaySet } from "../../../../shared/schedule/engine/calendar.js";
import { recomputeSchedule } from "../../../../shared/schedule/engine/cascade.js";
import { activeProjectOf } from "../grid/columns.js";
import { resolveLabelAlign, writeLabelAlign } from "../gantt/GanttView.jsx";
import { HEALTH, HK, MENU_STOPS_GRID, NO_AUTOFILL, useAnchoredPopover } from "../common.jsx";
import { DEFAULT_HEALTH_RULES, RULE_FIELDS, RULE_FIELD_BY_K, getHealthRules, opsForField } from "../../../../shared/schedule/healthEngine.js";
import { askConfirm } from "../dialogs/confirm.jsx";
import { stripViewState } from "../viewState.js";
import { exposeToHarness } from "../harnessGlobals.js";

const { useState, useEffect, useRef } = React;

export function SettingsPanel({data, setData, onClose, openFile, fileLinked, initialSection, onOpenMeetingCalendars}) {
  const s = data.settings || DEFAULT_SETTINGS;
  const upd = patch => setData(d => ({...d, settings:{...d.settings,...patch}}));
  const updHol = (k, v) => setData(d => {
    const holidays = {...d.settings.holidays, [k]: v};
    setHolidaySet(buildHolidaySet(holidays));
    const newProjects = {};
    Object.entries(d.projects || {}).forEach(([pid, proj]) => {
      let tasks = (proj.tasks || []).map(t => ({...t}));   // clone — never mutate prior state
      tasks = recomputeSchedule(tasks);                     // respects pinnedStart
      newProjects[pid] = {...proj, tasks};
    });
    return {...d, settings:{...d.settings, holidays}, projects: newProjects};
  });
  const pinCount = Object.values(data.projects || {}).reduce((n, p) => n + (p.tasks || []).filter(t => t.pinnedStart).length, 0);
  // B844 — seed the collapsible sections; initialSection (e.g. "meetings") starts expanded so a deep-link
  // from the right-click menu / an empty Meeting cell lands directly on the right editor.
  const [open, setOpen] = useState(() => ({view: true, holidays: false, cf: false, backup: false, ...(initialSection ? {[initialSection]: true} : {})}));
  const tog = k => setOpen(p => ({...p, [k]: !p[k]}));
  // Fix #10: close on Escape (consistent with other modals/pickers)
  useEffect(() => {
    const onKey = e => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  // B844 — when deep-linked to a section, scroll it into view (it may sit below the panel fold).
  useEffect(() => {
    if (!initialSection) return;
    const el = document.querySelector(`[data-section="${initialSection}"]`);
    if (el) el.scrollIntoView({ block: "start" });
  }, [initialSection]);

  const thisYear = new Date().getFullYear();
  const holDates = {};
  HOLIDAY_DEFS.forEach(h => {
    const ds = h.fn(thisYear);
    const d = new Date(ds + "T12:00:00");
    const dateStr = d.toLocaleDateString("en-US", {month:"short", day:"numeric"});
    holDates[h.k] = h.rule ? `${h.rule} · ${dateStr}` : dateStr;
  });

  const SectionHdr = ({id, title}) => (
    <div data-section={id} onClick={()=>tog(id)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",
      padding:"10px 0 7px",borderBottom:"1px solid var(--bd)",marginBottom: open[id] ? 8 : 0,
      cursor:"pointer",userSelect:"none"}}>
      <span style={{fontSize:10,fontWeight:700,color:"var(--mut)",letterSpacing:".08em",textTransform:"uppercase"}}>{title}</span>
      <span style={{fontSize:10,color:"var(--mut)",display:"inline-block",
        transform: open[id] ? "rotate(180deg)" : "rotate(0deg)", transition:"transform .18s", lineHeight:1}}>&#9662;</span>
    </div>
  );
  const Row = ({label, children}) => (
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"4px 0",gap:12}}>
      <span style={{fontSize:12,color:"var(--txt)"}}>{label}</span>
      {children}
    </div>
  );
  const Toggle = ({on, onChange}) => (
    <span onClick={e=>{e.stopPropagation();onChange(!on);}} style={{width:28,height:15,borderRadius:8,background:on?"var(--amber)":"var(--bd2)",
      display:"inline-flex",alignItems:"center",cursor:"pointer",flexShrink:0,transition:"background .15s",padding:"0 2px"}}>
      <span style={{width:11,height:11,borderRadius:"50%",background:"var(--bg)",boxShadow:"0 1px 3px rgba(0,0,0,.2)",
        transform:on?"translateX(13px)":"translateX(0)",transition:"transform .15s",flexShrink:0}} />
    </span>
  );
  const SegBtn = ({options, value, onChange}) => (
    <div style={{display:"flex",border:"1px solid var(--bd2)",borderRadius:4,overflow:"hidden",flexShrink:0}}>
      {options.map(o => (
        <span key={String(o.v)} onClick={()=>onChange(o.v)}
          style={{padding:"3px 10px",fontSize:11,cursor:"pointer",whiteSpace:"nowrap",
            background:value===o.v?"var(--amber)":"transparent",
            color:value===o.v?"#fff":"var(--mut)",transition:"background .12s,color .12s",
            fontFamily:"'Inter',system-ui,sans-serif",fontWeight:value===o.v?500:400}}>
          {o.l}
        </span>
      ))}
    </div>
  );

  return (
    <div style={{position:"fixed",top:48,right:12,width:300,background:"var(--bg)",border:"1px solid var(--bd2)",
      borderRadius:8,boxShadow:"0 4px 20px rgba(0,0,0,0.14)",zIndex:9999,padding:"0 16px 14px",
      overflow:"hidden",maxHeight:"calc(100vh - 64px)",overflowY:"auto"}}
      onMouseDown={e=>e.stopPropagation()}>

      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 0 4px"}}>
        <span style={{fontWeight:600,fontSize:13,color:"var(--txt)"}}>Settings</span>
        <span onClick={onClose} style={{cursor:"pointer",color:"var(--mut)",fontSize:16,lineHeight:1}}>&#x2715;</span>
      </div>

      <SectionHdr id="view" title="View" />
      {open.view && (
        <div style={{marginBottom:4}}>
          <Row label="Default drag mode">
            <SegBtn options={[{l:"Snap",v:true},{l:"Free",v:false}]} value={s.snapDefault} onChange={v=>upd({snapDefault:v})} />
          </Row>
          <div style={{padding:"4px 0 2px"}}>
            <span style={{fontSize:12,color:"var(--txt)",display:"block",marginBottom:6}}>Default split (grid %)</span>
            <div style={{position:"relative",height:20,display:"flex",alignItems:"center"}}>
              <div style={{position:"absolute",left:0,right:0,height:4,borderRadius:2,background:"var(--bd2)",overflow:"hidden",pointerEvents:"none"}}>
                <div style={{width:`${((s.defaultSplit-20)/(82-20))*100}%`,height:"100%",background:"var(--amber)",transition:"width .05s"}} />
              </div>
              <input type="range" min={20} max={82} value={s.defaultSplit}
                onChange={e=>upd({defaultSplit:+e.target.value})}
                style={{width:"100%",appearance:"none",WebkitAppearance:"none",background:"transparent",
                  margin:0,cursor:"pointer",position:"relative",zIndex:1}} />
            </div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:2}}>
              <span style={{fontSize:10,color:"var(--mut)"}}>20%</span>
              <span style={{fontSize:12,fontWeight:600,color:"var(--amber)"}}>{s.defaultSplit}% grid</span>
              <span style={{fontSize:10,color:"var(--mut)"}}>82%</span>
            </div>
          </div>
        </div>
      )}

      <div style={{marginTop: open.view ? 6 : 2}}>
        <SectionHdr id="holidays" title="Holidays" />
        {open.holidays && (<>
          <div style={{fontSize:10,color:"var(--mut)",lineHeight:1.45,margin:"0 0 6px"}}>
            Toggling a holiday recalculates every schedule immediately. Pinned start dates stay put — computed finish dates and downstream tasks shift.
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"2px 4px",paddingBottom:4}}>
            {HOLIDAY_DEFS.map(h => {
              const on = !!(s.holidays||{})[h.k];
              return (
                <div key={h.k} onClick={()=>updHol(h.k,!on)}
                  style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                    padding:"5px 6px",borderRadius:4,cursor:"pointer",gap:4,
                    background: on ? "#f5f3ff" : "transparent", transition:"background .12s"}}
                  onMouseEnter={e=>{ if(!on) e.currentTarget.style.background="var(--surf)"; }}
                  onMouseLeave={e=>{ e.currentTarget.style.background = on ? "#f5f3ff" : "transparent"; }}>
                  <div style={{minWidth:0,flex:1}}>
                    <div style={{fontSize:11,color: on ? "var(--txt)" : "var(--mut)",fontWeight: on ? 500 : 400,
                      whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",lineHeight:1.3}}>{h.label}</div>
                    <div style={{fontSize:10,color: on ? "#7c6ad6" : "#b0b7c0",lineHeight:1.3,marginTop:1}}>{holDates[h.k]}</div>
                  </div>
                  <Toggle on={on} onChange={v=>updHol(h.k,v)} />
                </div>
              );
            })}
          </div>
        </>)}

        <SectionHdr id="meetings" title="Meeting calendars" />
        {open.meetings && (
          <div style={{paddingBottom:8}}>
            <div style={{fontSize:10,color:"var(--mut)",lineHeight:1.45,margin:"0 0 8px"}}>
              External decision bodies (city council, P&amp;Z, commissioners court) whose approvals only happen on a cadence — stored per project. Edited in their own window.
            </div>
            <button className="btn" onClick={()=>{ onOpenMeetingCalendars && onOpenMeetingCalendars(); onClose(); }} style={{fontSize:11,padding:"5px 11px"}}>
              {(() => { const n = ((activeProjectOf(data) || {}).meetingBodies || []).length; return n ? `Open Meeting calendars (${n}) ↗` : "Set up Meeting calendars ↗"; })()}
            </button>
          </div>
        )}

        <SectionHdr id="schedule" title="Schedule" />
        {open.schedule && (
          <div style={{paddingBottom:6}}>
            <div style={{fontSize:11,color:"var(--mut)",lineHeight:1.5,marginBottom:8}}>
              Editing a date directly <strong>pins</strong> it — the dependency cascade stops moving that task.
              Recascade removes every pin in every project and recomputes all dates from predecessor logic.
              A snapshot is saved first, so it can be undone from Version History.
            </div>
            <div style={{fontSize:11,color:"var(--txt)",marginBottom:8}}>
              Currently pinned: <strong>{pinCount}</strong> task{pinCount===1?"":"s"} across all projects
            </div>
            <button className="btn"
              title="Strip all pinned dates and recalculate everything from predecessor logic"
              style={{display:"flex",alignItems:"center",gap:6,fontSize:11,padding:"4px 11px",
                borderColor:"#fca5a5",color:"#b91c1c"}}
              onClick={async ()=>{
                // Guardrail: confirm + snapshot before destructive recascade
                if (!(await askConfirm({
                  title: "Strip all pinned dates and recalculate?",
                  body: "Every project is recalculated from predecessor logic.\n\nA backup snapshot is saved first — you can restore from Version History if needed.",
                  confirmLabel: "Recalculate", danger: true,
                }))) return;
                setData(d => {
                  try { window.storage.set("hs-v1", JSON.stringify(stripViewState(d)), { label: "pre-recascade", skipSanity: true }); } catch {}
                  setHolidaySet(buildHolidaySet(d.settings?.holidays || DEFAULT_HOLIDAYS));
                  const newProjects = {};
                  Object.entries(d.projects).forEach(([pid, proj]) => {
                    let tasks = proj.tasks.map(({pinnedStart, _pinStart, __wasDirectEdit, ...t}) => t);
                    tasks = recomputeSchedule(tasks);
                    newProjects[pid] = {...proj, tasks};
                  });
                  return {...d, _pinnedClean: true, projects: newProjects};
                });
                onClose();
              }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
              </svg>
              Recascade all projects
            </button>
          </div>
        )}

        {/* B566 — "Link a local backup file" moved here from the floppy Save button (the Save
            control is now the unified cloud sync badge in the shell header). Cloud auto-save is
            always on; this is the optional second copy, written to a local .html file on disk on
            every save (Chrome/Edge File System Access API). */}
        {typeof openFile === "function" && (<>
          <SectionHdr id="backup" title="Local backup file" />
          {open.backup && (
            <div style={{paddingBottom:6}}>
              <div style={{fontSize:11,color:"var(--mut)",lineHeight:1.5,marginBottom:8}}>
                Your schedule <strong>auto-saves to the cloud</strong> automatically — this is optional.
                Link a local <strong>.html</strong> file (Chrome or Edge) to ALSO keep a copy on this
                computer, re-written on every save.
              </div>
              <button className="btn"
                title={fileLinked ? "A local backup file is linked — click to choose a different file" : "Pick a local .html file to mirror every save into"}
                style={{display:"flex",alignItems:"center",gap:6,fontSize:11,padding:"4px 11px",
                  borderColor: fileLinked ? "#86efac" : "var(--bd2)", color: fileLinked ? "#16a34a" : "var(--txt)"}}
                onClick={()=>{ openFile(); }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                  <polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
                </svg>
                {fileLinked ? "Backup file linked ✓ — choose another" : "Link a local backup file…"}
              </button>
            </div>
          )}
        </>)}
      </div>

    </div>
  );
}

// ── FormatPanel — how the chart looks (row height, bar labels). Settings stays behavioral. ──
export function FormatPanel({data, setData, onClose}) {
  const s = data.settings || {};
  const upd = patch => setData(d => ({...d, settings:{...d.settings, ...patch}}));
  useEffect(() => {
    const onKey = e => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const Toggle = ({on, onChange}) => (
    <span onClick={e=>{e.stopPropagation();onChange(!on);}} style={{width:28,height:15,borderRadius:8,background:on?"var(--amber)":"var(--bd2)",position:"relative",display:"inline-block",cursor:"pointer",transition:"background .15s",flexShrink:0}}>
      <span style={{width:11,height:11,borderRadius:"50%",background:"var(--bg)",boxShadow:"0 1px 3px rgba(0,0,0,.2)",position:"absolute",top:2,left:on?15:2,transition:"left .15s"}} />
    </span>
  );
  const SegBtn = ({options, value, onChange}) => (
    <div style={{display:"inline-flex",background:"#f0f0f0",borderRadius:6,padding:2,gap:2}}>
      {options.map(o=>(
        <button key={String(o.v)} onClick={()=>onChange(o.v)}
          style={{border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:11,fontWeight:600,padding:"3px 10px",borderRadius:4,
            background:value===o.v?"#fff":"transparent",color:value===o.v?"var(--amber)":"var(--mut)",
            boxShadow:value===o.v?"0 1px 2px rgba(0,0,0,.12)":"none",transition:"all .12s"}}>{o.l}</button>
      ))}
    </div>
  );
  const rh = Math.min(34, Math.max(20, s.rowHeight || 24));
  return (
    <div style={{position:"fixed",top:48,right:12,width:300,background:"var(--bg)",border:"1px solid var(--bd2)",
      borderRadius:8,boxShadow:"0 4px 20px rgba(0,0,0,0.14)",zIndex:9999,padding:"0 16px 14px",
      maxHeight:"calc(100vh - 70px)",overflowY:"auto",fontFamily:"inherit"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 0 8px",borderBottom:"1px solid var(--bd)",position:"sticky",top:0,background:"var(--bg)",zIndex:2}}>
        <span style={{fontSize:13,fontWeight:700,color:"var(--txt)"}}>Format</span>
        <button onClick={onClose} title="Close" style={{background:"none",border:"none",cursor:"pointer",fontSize:15,color:"var(--mut)",padding:"2px 4px",lineHeight:1}}>✕</button>
      </div>

      <div style={{padding:"8px 0 2px"}}>
        <span style={{fontSize:12,color:"var(--txt)",display:"block",marginBottom:6}}>Row height — grid &amp; Gantt</span>
        <div style={{position:"relative",height:20,display:"flex",alignItems:"center"}}>
          <div style={{position:"absolute",left:0,right:0,height:4,borderRadius:2,background:"var(--bd2)",overflow:"hidden",pointerEvents:"none"}}>
            <div style={{width:`${((rh-20)/(34-20))*100}%`,height:"100%",background:"var(--amber)",transition:"width .05s"}} />
          </div>
          <input type="range" min={20} max={34} value={rh}
            onChange={e=>upd({rowHeight:+e.target.value})}
            style={{width:"100%",appearance:"none",WebkitAppearance:"none",background:"transparent",
              margin:0,cursor:"pointer",position:"relative",zIndex:1}} />
        </div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:2}}>
          <span style={{fontSize:10,color:"var(--mut)"}}>20px</span>
          <span style={{fontSize:12,fontWeight:600,color:"var(--amber)"}}>{rh}px</span>
          <span style={{fontSize:10,color:"var(--mut)"}}>34px</span>
        </div>
      </div>

      <div style={{padding:"10px 0 2px",borderTop:"1px solid var(--bd)",marginTop:8}}>
        <span style={{fontSize:12,color:"var(--txt)",display:"block",marginBottom:5}}>Gantt bar labels</span>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
          <thead><tr>
            <th style={{textAlign:"left",padding:"3px 6px",borderBottom:"1px solid var(--bd)",fontSize:9,fontWeight:700,color:"var(--mut)",letterSpacing:".06em",textTransform:"uppercase"}}>Position</th>
            <th style={{textAlign:"left",padding:"3px 6px",borderBottom:"1px solid var(--bd)",fontSize:9,fontWeight:700,color:"var(--mut)",letterSpacing:".06em",textTransform:"uppercase"}}>Field</th>
          </tr></thead>
          <tbody>
            {[["left","Left of bar"],["right","Right of bar"]].map(([k,label])=>(
              <tr key={k}>
                <td style={{padding:"4px 6px",borderBottom:"1px solid var(--bd)",color:"var(--txt)"}}>{label}</td>
                <td style={{padding:"2px 4px",borderBottom:"1px solid var(--bd)"}}>
                  <select value={(s.barLabels||{})[k]||"none"}
                    onChange={e=>upd({barLabels:{...(s.barLabels||{}),[k]:e.target.value}})}
                    style={{width:"100%",background:"var(--bg)",border:"1px solid var(--bd2)",borderRadius:3,padding:"3px 6px",fontSize:11,color:"var(--txt)",fontFamily:"inherit",outline:"none",cursor:"pointer"}}>
                    <option value="none">None</option>
                    <option value="start">Start date</option>
                    <option value="end">End date</option>
                    <option value="owner">Owner</option>
                    <option value="pct">% complete</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 2px 0"}}>
          <span style={{fontSize:12,color:"var(--txt)"}}>Show year in dates</span>
          <Toggle on={(s.barLabels||{}).year!==false} onChange={v=>upd({barLabels:{...(s.barLabels||{}),year:v}})} />
        </div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 2px 0"}}>
          <span style={{fontSize:12,color:"var(--txt)"}}>Task name alignment</span>
          <SegBtn options={[{l:"Left",v:"left"},{l:"Center",v:"center"},{l:"Right",v:"right"}]}
            value={resolveLabelAlign(data.projects?.[data.aPid])}
            onChange={v=>writeLabelAlign(setData, data.aPid, v)} />
        </div>
        <div style={{fontSize:10,color:"var(--mut)",marginTop:6,lineHeight:1.4}}>
          Task names sit beside the bar (Left / Right), on it (Center), or — when there's no room — above it, never on the fill. Saved per project, and used on screen and in the PDF exhibit. The small date/owner labels are set by the table above.
        </div>
      </div>
    </div>
  );
}

// ── RuleColorPicker ──────────────────────────────────────
// Small inline color-swatch picker for one rule row — click the dot to choose which existing
// health color the rule assigns. No new colors: options come straight from this plan's own HK
// palette (the same list every StatusPicker offers), never invented here.
//
// B1449(schedule) — the dropdown used to render INLINE (position:absolute, no portal) inside
// AutomationPanel, whose own root has onMouseDown={e=>e.stopPropagation()} (line ~11579, the same
// pattern every side panel in this file uses — SettingsPanel, ContactsPanel, MeetingCalendarsModal
// — to keep a click anywhere inside the panel from being misread as an "outside click" by some
// OTHER already-open picker's own document-level dismiss listener). That's fine for a panel with
// no floating sub-menu of its own, but this picker's dropdown DOES need to hear document-level
// mousedowns to know when to close — and the panel's blanket stopPropagation was eating every one
// of them before they ever left the panel's own DOM subtree, not just clicks on the menu itself.
// Measured live: with the dropdown open, a click on the panel's own blank space, or on a DIFFERENT
// rule row's <select>, left it open and floating over that control — only a click that landed
// outside the whole panel (on the grid behind it) closed it. That's exactly Michael's report ("I
// clicked everywhere else, but it just closed off that drop down").
// Two-part fix, matching how every other menu in this app behaves (HealthPicker/StatusPicker, the
// Status-options editor at ~8301): (1) portal the dropdown to document.body as position:fixed
// computed from the trigger's own rect, with the stopPropagation pair on the MENU's own root
// ({...MENU_STOPS_GRID}) — a click landing inside the menu still can't leak out and arm grid
// drag-select (NEW-2). (2) Listen for the outside-click in the CAPTURE phase, not bubble — a
// capture-phase document listener runs before the event ever reaches AutomationPanel's bubble-
// phase stopPropagation, so it fires for every click outside this picker regardless of which
// stopPropagation-wrapped panel it's sitting inside. Every other picker here is bubble-phase, but
// none of them live inside a panel that blanket-stops propagation the way this one does — this is
// the minimal change that makes the DISMISS RULE (click anywhere outside it closes it) match
// theirs exactly, without touching AutomationPanel or any other panel's own behavior.
function RuleColorPicker({value, onChange}) {
  const [open, setOpen] = useState(false);
  const dotRef  = useRef(null);
  const menuRef = useRef(null);
  const pos = useAnchoredPopover(open, dotRef, r => ({top: r.bottom + 4, left: r.right - 110}), () => setOpen(false));   // NEW-1

  useEffect(() => {
    if (!open) return;
    const onDown = e => {
      if (!dotRef.current?.contains(e.target) && !menuRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [open]);

  const openMenu = () => {
    setOpen(o => !o);
  };

  const hh = HEALTH[value] || HEALTH.gray;
  return (
    <span style={{position:"relative",flexShrink:0}}>
      <span ref={dotRef} onClick={openMenu} title={hh.label} data-rule-color-swatch="1"
        style={{width:16,height:16,borderRadius:"50%",background:hh.dot,border:hh.dot==="#ffffff"?"1.5px solid #d1d5db":hh.border,
          display:"block",cursor:"pointer"}} />
      {open && pos && ReactDOM.createPortal(
        <div ref={menuRef} {...MENU_STOPS_GRID} data-rule-color-menu="1"
          style={{position:"fixed",top:pos.top,left:pos.left,background:"var(--bg)",border:"1px solid var(--bd2)",
            borderRadius:6,padding:"4px",display:"flex",flexDirection:"column",gap:2,zIndex:10000,
            boxShadow:"0 4px 14px rgba(0,0,0,0.15)",minWidth:110}}>
          {HK.map(hk => { const h = HEALTH[hk]; return (
            <span key={hk} onClick={()=>{onChange(hk);setOpen(false);}}
              style={{display:"flex",alignItems:"center",gap:6,padding:"3px 6px",borderRadius:4,cursor:"pointer",
                background: hk===value?"var(--surf)":"transparent"}}
              onMouseEnter={e=>e.currentTarget.style.background="var(--surf)"}
              onMouseLeave={e=>e.currentTarget.style.background = hk===value?"var(--surf)":"transparent"}>
              <span style={{width:9,height:9,borderRadius:"50%",background:h.dot,border:h.dot==="#ffffff"?"1.5px solid #d1d5db":h.border,flexShrink:0}} />
              <span style={{fontSize:11,color:"var(--txt)"}}>{h.label}</span>
            </span>
          ); })}
        </div>,
        document.body
      )}
    </span>
  );
}

// ── ConditionRow / ConditionGroup — the field/comparison/value builder shared by a rule's IF and
// UNLESS groups (B785744). One row = pick a FIELD, pick a COMPARISON valid for that field's type,
// give a VALUE if the comparison needs one. Multiple rows in a group combine with AND/OR.
function ConditionRow({cond, onChange, onRemove}) {
  const field = RULE_FIELD_BY_K[cond.field] || RULE_FIELDS[0];
  const ops = opsForField(field.k);
  const op = ops.find(o => o.k === cond.op) || ops[0];
  const setField = fk => {
    const f = RULE_FIELD_BY_K[fk];
    const newOp = opsForField(fk)[0];
    onChange({field:fk, op:newOp.k, value: newOp.needsValue ? (newOp.defaultValue ?? (f.type==="status" ? "red" : "")) : undefined});
  };
  const setOp = ok => {
    const newOp = ops.find(o => o.k === ok);
    onChange({op:ok, value: newOp.needsValue ? (cond.value ?? newOp.defaultValue ?? (field.type==="status" ? "red" : "")) : undefined});
  };
  const selSt = {fontSize:11,color:"var(--txt)",border:"1px solid var(--bd2)",borderRadius:4,padding:"3px 4px",background:"var(--bg)",minWidth:0};
  return (
    <div style={{display:"flex",alignItems:"center",gap:5,flexWrap:"wrap"}}>
      <select value={field.k} onChange={e=>setField(e.target.value)} style={{...selSt,flex:"1 1 120px"}}>
        {RULE_FIELDS.map(f => <option key={f.k} value={f.k}>{f.label}</option>)}
      </select>
      <select value={op?.k} onChange={e=>setOp(e.target.value)} style={{...selSt,flex:"1 1 130px"}}>
        {ops.map(o => <option key={o.k} value={o.k}>{o.label}</option>)}
      </select>
      {op?.needsValue && field.type==="date" && (
        <input type="number" min={0} value={cond.value ?? op.defaultValue ?? 0}
          onChange={e=>onChange({value: Math.max(0, parseInt(e.target.value,10)||0)})}
          style={{width:36,fontSize:11,border:"1px solid var(--bd2)",borderRadius:4,padding:"3px 4px",flexShrink:0}} />
      )}
      {op?.needsValue && op.valueKind==="status" && (
        <RuleColorPicker value={cond.value || "red"} onChange={hk=>onChange({value:hk})} />
      )}
      {op?.needsValue && op.valueKind==="text" && (
        <input {...NO_AUTOFILL} type="text" value={cond.value || ""} placeholder="value"
          onChange={e=>onChange({value:e.target.value})}
          style={{width:80,fontSize:11,border:"1px solid var(--bd2)",borderRadius:4,padding:"3px 4px",flexShrink:1,minWidth:0}} />
      )}
      {op?.needsValue && op.valueKind==="number" && (
        <input type="number" value={cond.value ?? 0}
          onChange={e=>onChange({value: parseFloat(e.target.value)||0})}
          style={{width:64,fontSize:11,border:"1px solid var(--bd2)",borderRadius:4,padding:"3px 4px",flexShrink:0}} />
      )}
      <span onClick={onRemove} title="Remove condition"
        style={{cursor:"pointer",color:"var(--mut)",fontSize:12,lineHeight:1,flexShrink:0,padding:"0 2px",marginLeft:"auto"}}>&#x2715;</span>
    </div>
  );
}
function ConditionGroup({conds, combinator, onChange, addLabel}) {
  const setConds = next => onChange({conds: next, combinator});
  const updCond = (i, patch) => setConds(conds.map((c,ci) => ci===i ? {...c, ...patch} : c));
  const removeCond = i => setConds(conds.filter((_,ci) => ci!==i));
  const addCond = () => {
    const op = opsForField(RULE_FIELDS[0].k)[0];
    setConds([...conds, {field:RULE_FIELDS[0].k, op:op.k, value: op.needsValue ? op.defaultValue : undefined}]);
  };
  return (
    <div style={{display:"flex",flexDirection:"column",gap:4}}>
      {conds.map((c,i) => (
        <React.Fragment key={i}>
          {i>0 && (
            <div style={{display:"flex",gap:4}}>
              {["AND","OR"].map(op => (
                <span key={op} onClick={()=>onChange({conds, combinator:op})}
                  style={{fontSize:9,fontWeight:700,letterSpacing:".03em",cursor:"pointer",padding:"1px 6px",borderRadius:3,
                    color: combinator===op ? "var(--on-accent)" : "var(--mut)",
                    background: combinator===op ? "var(--blue)" : "var(--surf)"}}>{op}</span>
              ))}
            </div>
          )}
          <ConditionRow cond={c} onChange={patch=>updCond(i,patch)} onRemove={()=>removeCond(i)} />
        </React.Fragment>
      ))}
      <span onClick={addCond} style={{fontSize:10.5,color:"var(--amber)",fontWeight:600,cursor:"pointer",alignSelf:"flex-start"}}>+ {addLabel}</span>
    </div>
  );
}

// ── AutomationPanel — IF/THEN/UNLESS rule builder (B785744, rebuild #2) ──────────────────────
// Replaces the ordered-list-of-canned-conditions panel from #1073 (owner, verbatim: "you've got
// like two variables here"). The real ask was Smartsheet/MS-Project-style conditional formatting:
// pick a field, pick a comparison, give a value, combine with AND/OR, and — the piece the old
// panel had no way to express — an UNLESS exception clause, so "Complete beats overdue" is a rule
// you can read and edit instead of a hardcoded early-return. Rules stay an ORDERED list, first
// FIRING rule wins (unchanged mental model — the owner kept this over "worst color always wins").
// `rules` resolves via getHealthRules, which now also carries v1 (old ordered-list) and the very
// old 3-toggle cfRules forward into this shape live — nothing repaints until this panel is opened
// and something in it is touched (matches the migration precedent this panel has always used).
export function AutomationPanel({data, setData, onClose}) {
  const s = data.settings || DEFAULT_SETTINGS;
  const rules = getHealthRules(s);
  const setRules = next => setData(d => ({...d, settings:{...d.settings, healthRules: next}}));
  const updRule = (id, patch) => setRules(rules.map(r => r.id === id ? {...r, ...patch} : r));
  const removeRule = id => setRules(rules.filter(r => r.id !== id));
  const moveRule = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= rules.length) return;
    const next = rules.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setRules(next);
  };
  const addRule = () => {
    const op = opsForField(RULE_FIELDS[0].k)[0];
    setRules([...rules, {
      id:`r${Date.now()}${Math.random().toString(36).slice(2,6)}`,
      when:[{field:RULE_FIELDS[0].k, op:op.k, value: op.needsValue ? op.defaultValue : undefined}], whenCombinator:"AND",
      color:"red",
      unless:[], unlessCombinator:"OR",
    }]);
  };
  const resetDefaults = () => setRules(DEFAULT_HEALTH_RULES.map(r => ({
    ...r, id:`r${Date.now()}${Math.random().toString(36).slice(2,6)}`,
    when: r.when.map(c=>({...c})), unless: r.unless.map(c=>({...c})),
  })));

  return (
    <div style={{position:"fixed",top:48,right:12,width:440,maxHeight:"calc(100vh - 64px)",overflowY:"auto",background:"var(--bg)",border:"1px solid var(--bd2)",
      borderRadius:8,boxShadow:"0 4px 20px rgba(0,0,0,0.14)",zIndex:9999,padding:"0 16px 14px"}}
      onMouseDown={e=>e.stopPropagation()}>

      {/* Header */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 0 10px",position:"sticky",top:0,background:"var(--bg)"}}>
        <div style={{display:"flex",alignItems:"center",gap:7}}>
          {/* Lightning bolt icon */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
          </svg>
          <span style={{fontWeight:600,fontSize:13,color:"var(--txt)"}}>Automation</span>
        </div>
        <span onClick={onClose} style={{cursor:"pointer",color:"var(--mut)",fontSize:16,lineHeight:1}}>&#x2715;</span>
      </div>

      {/* Description */}
      <div style={{fontSize:11,color:"var(--mut)",lineHeight:1.5,marginBottom:10,paddingBottom:10,borderBottom:"1px solid var(--bd)"}}>
        First matching rule sets a task's color — IF its conditions are true, THEN it sets the status, UNLESS an exception applies.
      </div>

      {/* Rules */}
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {rules.length === 0 && (
          <div style={{fontSize:11,color:"var(--mut)",padding:"6px 2px"}}>No rules yet — a task's status stays exactly what you set it to.</div>
        )}
        {rules.map((r, i) => (
          <div key={r.id} style={{display:"flex",flexDirection:"column",gap:7,padding:"8px 9px",borderRadius:6,background:"var(--surf)",border:"1px solid var(--bd)"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <span style={{fontSize:9,fontWeight:700,letterSpacing:".05em",textTransform:"uppercase",color:"var(--mut)"}}>Rule {i+1}</span>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span onClick={()=>moveRule(i,-1)} title="Move up"
                  style={{cursor:i===0?"default":"pointer",opacity:i===0?0.3:1,fontSize:10,color:"var(--mut)"}}>▲</span>
                <span onClick={()=>moveRule(i,1)} title="Move down"
                  style={{cursor:i===rules.length-1?"default":"pointer",opacity:i===rules.length-1?0.3:1,fontSize:10,color:"var(--mut)"}}>▼</span>
                <span onClick={()=>removeRule(r.id)} title="Delete rule"
                  style={{cursor:"pointer",color:"var(--mut)",fontSize:13,lineHeight:1}}>&#x2715;</span>
              </div>
            </div>

            <div>
              <div style={{fontSize:9,fontWeight:700,letterSpacing:".05em",color:"var(--mut)",marginBottom:3}}>IF</div>
              <ConditionGroup conds={r.when} combinator={r.whenCombinator}
                onChange={({conds,combinator})=>updRule(r.id,{when:conds, whenCombinator:combinator})}
                addLabel="Add condition" />
            </div>

            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <span style={{fontSize:9,fontWeight:700,letterSpacing:".05em",color:"var(--mut)"}}>THEN set status to</span>
              <RuleColorPicker value={r.color} onChange={hk=>updRule(r.id,{color:hk})} />
            </div>

            <div>
              <div style={{fontSize:9,fontWeight:700,letterSpacing:".05em",color:"var(--mut)",marginBottom:3}}>
                UNLESS <span style={{fontWeight:400,textTransform:"none",letterSpacing:0}}>(optional)</span>
              </div>
              {r.unless && r.unless.length > 0 ? (
                <ConditionGroup conds={r.unless} combinator={r.unlessCombinator}
                  onChange={({conds,combinator})=>updRule(r.id,{unless:conds, unlessCombinator:combinator})}
                  addLabel="Add exception" />
              ) : (
                <span onClick={()=>updRule(r.id,{unless:[{field:"status",op:"is",value:"green"}]})}
                  style={{fontSize:10.5,color:"var(--amber)",fontWeight:600,cursor:"pointer"}}>+ Add exception</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Add / reset */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:10,paddingTop:10,borderTop:"1px solid var(--bd)"}}>
        <span onClick={addRule} style={{fontSize:11.5,color:"var(--amber)",fontWeight:600,cursor:"pointer"}}>+ Add rule</span>
        <span onClick={resetDefaults} style={{fontSize:11,color:"var(--mut)",cursor:"pointer"}}>Reset to suggested defaults</span>
      </div>
    </div>
  );
}

// harness compatibility — the old classic-script page made every top-level binding a global, and the ui-audit / e2e
// drivers call them by bare name from page.evaluate (GanttView, buildGanttSVG, COLS, showToast, …). Same names, same values.
exposeToHarness({
  SettingsPanel: [() => SettingsPanel],
  FormatPanel: [() => FormatPanel],
  RuleColorPicker: [() => RuleColorPicker],
  ConditionRow: [() => ConditionRow],
  ConditionGroup: [() => ConditionGroup],
  AutomationPanel: [() => AutomationPanel],
});
