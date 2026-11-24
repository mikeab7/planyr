import { BASE_HK, HEALTH, HK, NO_AUTOFILL, useAnchoredPopover } from "../common.jsx";
import { colLabel, isBuiltinFormulaName } from "./columns.js";
import { exposeToHarness } from "../harnessGlobals.js";

const { useState, useEffect, useRef } = React;


// ── HealthColHeader ───────────────────────────────────────
const HEALTH_COL_STYLES = [
  { k: "stoplight",   label: "Stoplight" },
  { k: "progressbar", label: "Progress bar" },
  { k: "signal",      label: "Signal bars" },
  { k: "flag",        label: "Flag icon" },
  { k: "text",        label: "\"Status\" text" },
  { k: "heartrate",   label: "Heart rate icon" },
];

function HealthColHeaderIcon({style: s, size=14}) {
  if (s === "stoplight") return (
    <span style={{display:"flex",gap:2,alignItems:"center"}}>
      <span style={{width:size*0.55,height:size*0.55,borderRadius:"50%",background:"#dc2626",flexShrink:0}} />
      <span style={{width:size*0.55,height:size*0.55,borderRadius:"50%",background:"#c47b00",flexShrink:0}} />
      <span style={{width:size*0.55,height:size*0.55,borderRadius:"50%",background:"#16a34a",flexShrink:0}} />
    </span>
  );
  if (s === "progressbar") return (
    <span style={{width:size*1.6,height:size*0.45,background:"#e2e8f0",borderRadius:3,overflow:"hidden",display:"inline-block",flexShrink:0}}>
      <span style={{display:"block",width:"55%",height:"100%",background:"#4f46e5",borderRadius:3}} />
    </span>
  );
  if (s === "signal") return (
    <span style={{display:"flex",alignItems:"flex-end",gap:1.5,height:size}}>
      {[0.36,0.55,0.78,1].map((h,i) => (
        <span key={i} style={{width:size*0.28,height:size*h,background:i<2?"#cbd5e1":"#4f46e5",borderRadius:1,flexShrink:0}} />
      ))}
    </span>
  );
  if (s === "flag") return <i className="ti ti-flag" aria-hidden="true" style={{fontSize:size,color:"var(--mut)",lineHeight:1}} />;
  if (s === "text") return <span style={{fontSize:9,fontWeight:700,color:"var(--mut)",letterSpacing:".06em",textTransform:"uppercase",lineHeight:1}}>Status</span>;
  if (s === "heartrate") return <i className="ti ti-heart-rate-monitor" aria-hidden="true" style={{fontSize:size,color:"var(--mut)",lineHeight:1}} />;
  return null;
}

export function HealthColHeader({current, onChange}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const anchorRef = useRef(null);
  // NEW-1 — a header cell scrolls sideways with the columns; the menu follows it (or closes when it leaves).
  const pos = useAnchoredPopover(open, anchorRef, r => ({top: r.bottom + 4, left: r.left}), () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    const down = e => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [open]);

  const handleClick = e => {
    e.stopPropagation();
    setOpen(o => !o);
  };

  return (
    <>
      <span ref={anchorRef} onClick={handleClick} title="Change header style"
        style={{display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",
          width:"100%",height:"100%",borderRadius:3,
          outline:open?"1.5px solid var(--bd2)":"1.5px solid transparent",transition:"outline-color .1s"}}
        onMouseEnter={e=>e.currentTarget.style.outline="1.5px solid var(--bd2)"}
        onMouseLeave={e=>e.currentTarget.style.outline=open?"1.5px solid var(--bd2)":"1.5px solid transparent"}>
        <HealthColHeaderIcon style={current} size={13} />
      </span>
      {open && pos && ReactDOM.createPortal(
        <div ref={ref} style={{position:"fixed",top:pos.top,left:pos.left,background:"var(--bg)",
          border:"1px solid var(--bd2)",borderRadius:8,padding:8,zIndex:9999,
          boxShadow:"0 4px 20px rgba(0,0,0,0.14)",display:"flex",flexDirection:"column",gap:2,minWidth:160}}>
          <div style={{fontSize:9,fontWeight:600,color:"var(--mut)",letterSpacing:".07em",textTransform:"uppercase",padding:"0 4px 4px",borderBottom:"1px solid var(--bd)"}}>Column header style</div>
          {HEALTH_COL_STYLES.map(opt => (
            <div key={opt.k} onClick={() => { onChange(opt.k); setOpen(false); }}
              style={{display:"flex",alignItems:"center",gap:10,padding:"5px 6px",borderRadius:4,
                cursor:"pointer",background:current===opt.k?"var(--surf)":"transparent",
                transition:"background .1s"}}
              onMouseEnter={e=>e.currentTarget.style.background="var(--surf)"}
              onMouseLeave={e=>e.currentTarget.style.background=current===opt.k?"var(--surf)":"transparent"}>
              <span style={{width:36,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                <HealthColHeaderIcon style={opt.k} size={13} />
              </span>
              <span style={{fontSize:11,color:"var(--txt)",fontFamily:"'Inter',system-ui,sans-serif"}}>{opt.label}</span>
              {current===opt.k && <i className="ti ti-check" style={{fontSize:11,color:"var(--amber)",marginLeft:"auto"}} />}
            </div>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}

// ── GridView ──────────────────────────────────────────────
// ── StatusHeaderDropdown ─────────────────────────────────
const STATUS_PALETTE = [
  {dot:"#7c3aed", bar:"#ede9fe", dark:"#5b21b6"},
  {dot:"#0891b2", bar:"#cffafe", dark:"#155e75"},
  {dot:"#ea580c", bar:"#ffedd5", dark:"#9a3412"},
  {dot:"#db2777", bar:"#fce7f3", dark:"#9d174d"},
  {dot:"#4f46e5", bar:"#e0e7ff", dark:"#3730a3"},
];
export function StatusHeaderDropdown({data, setData}) {
  const [open,    setOpen]    = useState(false);
  const [adding,  setAdding]  = useState(false);
  const [newLabel,setNewLabel]= useState("");
  const [newColor,setNewColor]= useState(STATUS_PALETTE[0].dot);
  const [editing, setEditing] = useState(null); // {k, label}
  const ref     = useRef(null);
  const menuRef = useRef(null);
  const menuPos = useAnchoredPopover(open, ref, r => ({top: r.bottom + 4, left: r.left}),
    () => { setOpen(false); setAdding(false); setEditing(null); setNewLabel(""); });   // NEW-1

  useEffect(() => {
    if (!open) return;
    const down = e => {
      if (!ref.current?.contains(e.target) && !menuRef.current?.contains(e.target))
        { setOpen(false); setAdding(false); setEditing(null); setNewLabel(""); }
    };
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [open]);

  const openMenu = e => {
    e.stopPropagation();
    setOpen(o => !o);
  };

  const saveEdit = () => {
    if (!editing || !editing.label.trim()) { setEditing(null); return; }
    const k = editing.k;
    if (BASE_HK.includes(k)) {
      setData(d => ({...d, settings:{...d.settings,
        healthLabelOverrides:{...(d.settings?.healthLabelOverrides||{}), [k]: editing.label.trim()}}}));
    } else {
      setData(d => ({...d, settings:{...d.settings,
        customHealth:(d.settings?.customHealth||[]).map(c => c.k===k ? {...c,label:editing.label.trim()} : c)}}));
    }
    setEditing(null);
  };

  const addOption = () => {
    if (!newLabel.trim()) return;
    const pal = STATUS_PALETTE.find(p => p.dot === newColor) || STATUS_PALETTE[0];
    const ch = {k:"custom_"+Date.now(), label:newLabel.trim(), dot:newColor, bar:pal.bar, dark:pal.dark};
    setData(d => ({...d, settings:{...d.settings, customHealth:[...(d.settings?.customHealth||[]), ch]}}));
    setNewLabel(""); setAdding(false);
  };

  const removeOption = k => {
    setData(d => {
      // Reassign any task still carrying the deleted status back to "Not Started" (gray)
      // BEFORE removing it, so no view dereferences a now-missing HEALTH key and crashes (B1).
      const projects = {};
      Object.entries(d.projects || {}).forEach(([pid, p]) => {
        projects[pid] = {...p, tasks: (p.tasks || []).map(t => t.health === k ? {...t, health: "gray"} : t)};
      });
      return {...d, projects, settings:{...d.settings,
        customHealth:(d.settings?.customHealth||[]).filter(c=>c.k!==k)}};
    });
  };

  const OptionIcon = ({hk}) => {
    const h = HEALTH[hk] || {};
    const isHollow = h.dot === "#ffffff";
    return (
      <span style={{width:8,height:8,borderRadius:2,flexShrink:0,
        background: isHollow ? "#fff" : (h.dot||"#ccc"),
        border: isHollow ? "1.5px solid #d1d5db" : "none"}} />
    );
  };

  return (
    <>
      <span ref={ref} onClick={openMenu}
        style={{cursor:"pointer",display:"inline-flex",alignItems:"center",gap:3,userSelect:"none"}}>
        Status <span style={{fontSize:7,opacity:.7}}>▾</span>
      </span>
      {open && menuPos && ReactDOM.createPortal(
        <div ref={menuRef} onMouseDown={e=>e.stopPropagation()}
          style={{position:"fixed",top:menuPos.top,left:menuPos.left,minWidth:190,
            background:"var(--bg)",border:"1px solid var(--bd2)",borderRadius:6,
            padding:"6px",zIndex:9999,boxShadow:"0 4px 16px rgba(0,0,0,0.13)"}}>
          <div style={{fontSize:9,fontWeight:700,color:"var(--mut)",letterSpacing:".07em",
            textTransform:"uppercase",padding:"2px 4px 6px"}}>Status options</div>

          {HK.map(hk => {
            const h = HEALTH[hk]; if (!h) return null;
            const isCustom = !BASE_HK.includes(hk);
            const isEditingThis = editing?.k === hk;
            return (
              <div key={hk} style={{display:"flex",alignItems:"center",gap:6,padding:"3px 4px",borderRadius:3}}>
                <OptionIcon hk={hk} />
                {isEditingThis ? (
                  <>
                    <input {...NO_AUTOFILL} autoFocus value={editing.label}
                      onChange={e=>setEditing(ev=>({...ev,label:e.target.value}))}
                      onKeyDown={e=>{if(e.key==="Enter")saveEdit();if(e.key==="Escape")setEditing(null);}}
                      style={{flex:1,fontSize:11,padding:"2px 5px",border:"1px solid var(--amber)",
                        borderRadius:3,outline:"none",fontFamily:"'Inter',system-ui,sans-serif",minWidth:0}} />
                    <span onClick={saveEdit} title="Save"
                      style={{cursor:"pointer",color:"var(--amber)",fontSize:12,fontWeight:700,padding:"0 2px"}}>✓</span>
                    <span onClick={()=>setEditing(null)} title="Cancel"
                      style={{cursor:"pointer",color:"#9ca3af",fontSize:12,padding:"0 2px"}}>✕</span>
                  </>
                ) : (
                  <>
                    <span style={{flex:1,fontSize:12,color:"var(--txt)"}}>{h.label}</span>
                    <span onClick={()=>setEditing({k:hk,label:h.label})} title="Rename"
                      style={{cursor:"pointer",color:"#9ca3af",fontSize:11,opacity:.6,padding:"0 2px"}}
                      onMouseEnter={e=>e.currentTarget.style.opacity=1}
                      onMouseLeave={e=>e.currentTarget.style.opacity=.6}>✎</span>
                    {isCustom && <span onClick={()=>removeOption(hk)} title="Remove"
                      style={{cursor:"pointer",color:"#9ca3af",fontSize:13,padding:"0 2px"}}>×</span>}
                  </>
                )}
              </div>
            );
          })}

          <div style={{borderTop:"1px solid var(--bd)",marginTop:4,paddingTop:6}}>
            {adding ? (
              <div style={{display:"flex",flexDirection:"column",gap:6,padding:"0 2px"}}>
                <input {...NO_AUTOFILL} autoFocus value={newLabel} onChange={e=>setNewLabel(e.target.value)}
                  onKeyDown={e=>{if(e.key==="Enter")addOption();if(e.key==="Escape"){setAdding(false);setNewLabel("");}}}
                  placeholder="Option label…"
                  style={{fontSize:11,padding:"4px 7px",border:"1px solid var(--bd2)",borderRadius:4,
                    outline:"none",fontFamily:"'Inter',system-ui,sans-serif"}} />
                <div style={{display:"flex",gap:5,padding:"0 1px"}}>
                  {STATUS_PALETTE.map(p=>(
                    <span key={p.dot} onClick={()=>setNewColor(p.dot)}
                      style={{width:18,height:18,borderRadius:4,background:p.dot,cursor:"pointer",flexShrink:0,
                        outline:newColor===p.dot?`2px solid ${p.dot}`:"2px solid transparent",outlineOffset:2}} />
                  ))}
                </div>
                <div style={{display:"flex",gap:4}}>
                  <span onClick={addOption}
                    style={{flex:1,textAlign:"center",padding:"4px",borderRadius:4,fontSize:11,fontWeight:600,
                      background:"var(--amber)",color:"#fff",cursor:"pointer",
                      fontFamily:"'Inter',system-ui,sans-serif"}}>Add</span>
                  <span onClick={()=>{setAdding(false);setNewLabel("");}}
                    style={{flex:1,textAlign:"center",padding:"4px",borderRadius:4,fontSize:11,
                      background:"var(--bd2)",color:"var(--txt)",cursor:"pointer",
                      fontFamily:"'Inter',system-ui,sans-serif"}}>Cancel</span>
                </div>
              </div>
            ) : (
              <div onClick={()=>setAdding(true)}
                style={{display:"flex",alignItems:"center",gap:6,padding:"3px 6px",cursor:"pointer",
                  color:"var(--mut)",fontSize:11,borderRadius:3,fontFamily:"'Inter',system-ui,sans-serif"}}
                onMouseEnter={e=>e.currentTarget.style.background="#f3f4f6"}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <span style={{fontSize:15,fontWeight:300,lineHeight:1}}>+</span> Add option
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}


// ── NotesColHeader ────────────────────────────────────────
export const NOTE_SIZES = [{k:"sm",l:"Small",px:11},{k:"md",l:"Medium",px:13},{k:"lg",l:"Large",px:15}];

export function NotesColHeader({data, setData}) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(null); // {value:string} — pending text-size change
  const [size, setSize] = useState(() => { try { return localStorage.getItem("planar_noteSize")||"sm"; } catch { return "sm"; } });
  const ref = useRef(null);
  const menuRef = useRef(null);
  const menuPos = useAnchoredPopover(open, ref, r => ({top: r.bottom + 4, left: r.left}), () => { setOpen(false); setConfirm(null); });   // NEW-1

  const hasNotes = data ? Object.values(data.projects||{}).some(p=>(p.tasks||[]).some(t=>(t.notes||[]).length>0)) : false;

  useEffect(() => {
    if (!open) { setConfirm(null); return; }
    const down = e => { if (!ref.current?.contains(e.target) && !menuRef.current?.contains(e.target)) { setOpen(false); setConfirm(null); } };
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [open]);

  const openMenu = e => { e.stopPropagation(); setOpen(o=>!o); };

  const applySize = (value, overrideAll) => {
    setSize(value); try { localStorage.setItem("planar_noteSize", value); } catch {}
    if (setData) {
      setData(d => ({...d, projects: Object.fromEntries(Object.entries(d.projects).map(([pid,proj]) => [pid, {
        ...proj,
        tasks: proj.tasks.map(t => ({...t, notes: (t.notes||[]).map(n => {
          if (overrideAll) return {...n, size: value}; // stamp new size on every note immediately
          return n.size ? n : {...n, size: size}; // freeze at OLD size if not already frozen
        })}))
      }]))}));
    }
    setConfirm(null); setOpen(false);
  };

  const handleSize = value => { if (value===size) { setOpen(false); return; } hasNotes ? setConfirm({value}) : applySize(value, true); };

  const BtnStyle = (primary) => ({border:primary?"none":"1px solid var(--bd2)",borderRadius:4,padding:"6px 10px",fontSize:11,
    cursor:"pointer",textAlign:"left",fontFamily:"inherit",width:"100%",
    background:primary?"var(--amber)":"var(--surf)", color:primary?"#fff":"var(--txt)", fontWeight:primary?500:400});

  return (
    <div ref={ref} style={{display:"flex",alignItems:"center",gap:4,width:"100%"}}>
      <span>Notes</span>
      <button onClick={openMenu}
        style={{background:"transparent",border:"none",cursor:"pointer",padding:"1px 3px",
          borderRadius:3,fontSize:13,lineHeight:1,color:"var(--mut)",letterSpacing:"1px",
          fontFamily:"inherit",marginLeft:"auto",transition:"background .1s"}}
        onMouseEnter={e=>e.currentTarget.style.background="var(--bd)"}
        onMouseLeave={e=>e.currentTarget.style.background="transparent"}>···</button>
      {open && menuPos && ReactDOM.createPortal(
        <div ref={menuRef} style={{position:"fixed",top:menuPos.top,left:menuPos.left,
          background:"var(--bg)",border:"1px solid var(--bd2)",borderRadius:7,
          boxShadow:"0 4px 18px rgba(0,0,0,.13)",zIndex:9999,minWidth:192,padding:"4px 0",overflow:"hidden"}}>
          {confirm ? (
            <div style={{padding:"10px 12px",display:"flex",flexDirection:"column",gap:6}}>
              <div style={{fontSize:11,fontWeight:600,color:"var(--txt)"}}>Change text size?</div>
              <div style={{fontSize:11,color:"var(--mut)",lineHeight:1.5}}>
                Apply the new size to all existing notes, or only to new ones going forward?
              </div>
              <button style={BtnStyle(true)} onClick={()=>applySize(confirm.value, true)}>Override all existing</button>
              <button style={BtnStyle(false)} onClick={()=>applySize(confirm.value, false)}>New notes only</button>
              <button style={{...BtnStyle(false),background:"transparent",border:"none",color:"var(--mut)"}} onClick={()=>setConfirm(null)}>Cancel</button>
            </div>
          ) : <>
            <div style={{padding:"4px 12px 3px",fontSize:9,fontWeight:600,letterSpacing:".07em",textTransform:"uppercase",color:"#9ca3af"}}>Text size</div>
            <div style={{display:"flex",gap:4,padding:"4px 12px 8px"}}>
              {NOTE_SIZES.map(({k,l})=>(
                <div key={k} onClick={()=>handleSize(k)}
                  style={{flex:1,textAlign:"center",padding:"4px 0",cursor:"pointer",borderRadius:4,fontSize:11,
                    fontWeight:size===k?600:400,
                    background:size===k?"var(--amber)":"var(--surf)",
                    color:size===k?"#fff":"var(--mut)",
                    border:`1px solid ${size===k?"var(--amber)":"var(--bd2)"}`}}>
                  {l}
                </div>
              ))}
            </div>
          </>}
        </div>,
        document.body
      )}
    </div>
  );
}

// ── Grid column chooser + header context menu (B212) ──────
// Both portal-mount at document root (per the established z-index pattern) so they never
// clip under the table's sticky header or the split divider.
export function GridColumnsChooser({cols, visible, hidden, onToggle, onMove, onReset, onClose, onAddFormula, onEditFormula, onDeleteFormula, anchor}) {
  // NEW-1/B1350080 — anchor under the header row's ⋯ button when we have its measured
  // screen position; fall back to the old fixed corner if the button ref isn't ready yet.
  const top   = anchor ? Math.min(anchor.bottom + 6, window.innerHeight - 40) : 46;
  const right = anchor ? Math.max(8, window.innerWidth - anchor.right) : 18;
  return ReactDOM.createPortal(
    <>
      <div onClick={onClose} onContextMenu={e=>{e.preventDefault();onClose();}} style={{position:"fixed",inset:0,zIndex:9998}} />
      <div onClick={e=>e.stopPropagation()} style={{position:"fixed",top,right,zIndex:9999,width:258,maxHeight:"72vh",overflow:"auto",
        background:"var(--bg)",border:"1px solid var(--bd2)",borderRadius:9,boxShadow:"0 8px 28px rgba(0,0,0,0.18)",padding:"10px 8px",
        fontFamily:"'Inter',system-ui,sans-serif"}}>
        <div style={{fontSize:9.5,fontWeight:700,color:"var(--mut)",letterSpacing:".08em",textTransform:"uppercase",padding:"0 8px 6px"}}>Shown columns</div>
        {visible.map((k,idx)=>{ const c=cols.find(x=>x.k===k); if(!c) return null; const locked=k==="name"; const isF=c.t==="formula";
          return (
          <div key={k} style={{display:"flex",alignItems:"center",gap:6,padding:"4px 8px",borderRadius:5}}
            onMouseEnter={e=>e.currentTarget.style.background="var(--surf)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
            <span style={{display:"flex",flexDirection:"column",lineHeight:0.62}}>
              <span onClick={()=>onMove(k,-1)} title="Move up"   style={{cursor:idx>0?"pointer":"default",opacity:idx>0?0.65:0.18,fontSize:9}}>▲</span>
              <span onClick={()=>onMove(k,1)}  title="Move down" style={{cursor:idx<visible.length-1?"pointer":"default",opacity:idx<visible.length-1?0.65:0.18,fontSize:9}}>▼</span>
            </span>
            <span style={{flex:1,fontSize:12,color:"var(--txt)",display:"flex",alignItems:"center",gap:5,minWidth:0}}>
              <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{colLabel(c)}</span>
              {isF && <span title="Formula column" style={{flexShrink:0,fontSize:8,fontWeight:700,color:"var(--amber)",border:"1px solid var(--amber)",borderRadius:3,padding:"0 3px",letterSpacing:".04em"}}>fx</span>}
            </span>
            {isF && <span onClick={()=>onEditFormula&&onEditFormula(k)} title="Edit formula" style={{cursor:"pointer",color:"var(--mut)",fontSize:12,lineHeight:1,padding:"0 2px"}}>✎</span>}
            {locked
              ? <span style={{fontSize:9,color:"var(--bd2)"}} title="The Task name column can't be hidden">locked</span>
              : <span onClick={()=>onToggle(k,false)} title="Hide column" style={{cursor:"pointer",color:"var(--mut)",fontSize:14,lineHeight:1,padding:"0 2px"}}>✕</span>}
          </div>);
        })}
        {hidden.length>0 && <div style={{fontSize:9.5,fontWeight:700,color:"var(--mut)",letterSpacing:".08em",textTransform:"uppercase",padding:"10px 8px 6px",borderTop:"1px solid var(--bd)",marginTop:6}}>Available — click to add</div>}
        {hidden.map(c=>{ const isF=c.t==="formula"; return (
          <div key={c.k} style={{display:"flex",alignItems:"center",gap:6,padding:"4px 8px",borderRadius:5}}
            onMouseEnter={e=>e.currentTarget.style.background="var(--surf)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
            <span onClick={()=>onToggle(c.k,true)} style={{flex:1,cursor:"pointer",display:"flex",alignItems:"center",gap:6,minWidth:0}}>
              <span style={{color:"#16a34a",fontSize:14,width:14,textAlign:"center",lineHeight:1,flexShrink:0}}>+</span>
              <span style={{fontSize:12,color:"var(--txt)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{colLabel(c)}</span>
              {isF && <span title="Formula column" style={{flexShrink:0,fontSize:8,fontWeight:700,color:"var(--amber)",border:"1px solid var(--amber)",borderRadius:3,padding:"0 3px"}}>fx</span>}
            </span>
            {isF && <span onClick={()=>onEditFormula&&onEditFormula(c.k)} title="Edit formula" style={{cursor:"pointer",color:"var(--mut)",fontSize:12,padding:"0 2px"}}>✎</span>}
            {isF && onDeleteFormula && <span onClick={()=>onDeleteFormula(c.k)} title="Delete formula column" style={{cursor:"pointer",color:"var(--mut)",fontSize:13,padding:"0 2px"}}>🗑</span>}
          </div>
        ); })}
        <div style={{borderTop:"1px solid var(--bd)",marginTop:8,paddingTop:7,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <span onClick={()=>onAddFormula&&onAddFormula()} title="Create a column computed from an Excel-style formula"
            style={{fontSize:11,fontWeight:600,color:"var(--amber)",cursor:"pointer",display:"inline-flex",alignItems:"center",gap:4}}>
            <span style={{fontSize:13,lineHeight:1}}>+</span> Formula column
          </span>
          <span onClick={onReset} style={{fontSize:10.5,color:"var(--mut)",cursor:"pointer",textDecoration:"underline"}}>Reset</span>
        </div>
      </div>
    </>,
    document.body
  );
}

export function GridHeaderMenu({ctx, hidden, onHide, onInsert, onColumns, onClose, isFormula, onAddFormula, onEditFormula, onDeleteFormula}) {
  const [sub,setSub]=React.useState(false);
  const x=Math.min(ctx.x, window.innerWidth-210), y=Math.min(ctx.y, window.innerHeight-210);
  const Row=({label,onClick,disabled,arrow})=>(
    <div onClick={disabled?undefined:onClick} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:14,padding:"6px 12px",cursor:disabled?"default":"pointer",color:disabled?"var(--bd2)":"var(--txt)",whiteSpace:"nowrap"}}
      onMouseEnter={e=>{if(!disabled)e.currentTarget.style.background="var(--surf)";}} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
      <span>{label}</span>{arrow&&<span style={{fontSize:10,opacity:.55}}>▸</span>}
    </div>
  );
  return ReactDOM.createPortal(
    <>
      <div onClick={onClose} onContextMenu={e=>{e.preventDefault();onClose();}} style={{position:"fixed",inset:0,zIndex:9998}} />
      <div onClick={e=>e.stopPropagation()} style={{position:"fixed",top:y,left:x,zIndex:9999,minWidth:186,
        background:"var(--bg)",border:"1px solid var(--bd2)",borderRadius:8,boxShadow:"0 8px 24px rgba(0,0,0,0.18)",padding:"5px 0",
        fontFamily:"'Inter',system-ui,sans-serif",fontSize:12.5}}>
        {isFormula && <>
          <Row label="Edit formula…" onClick={onEditFormula} />
          <Row label="Delete this formula column" onClick={onDeleteFormula} />
          <div style={{height:1,background:"var(--bd)",margin:"4px 0"}} />
        </>}
        <Row label="Hide this column" disabled={ctx.colKey==="name"} onClick={onHide} />
        <div style={{position:"relative"}} onMouseEnter={()=>setSub(true)} onMouseLeave={()=>setSub(false)}>
          <Row label="Insert column" disabled={!hidden.length} arrow />
          {sub && hidden.length>0 && (
            <div style={{position:"absolute",left:"100%",top:-5,minWidth:172,background:"var(--bg)",border:"1px solid var(--bd2)",borderRadius:8,boxShadow:"0 8px 24px rgba(0,0,0,0.18)",padding:"5px 0",maxHeight:300,overflow:"auto"}}>
              {hidden.map(c=><Row key={c.k} label={colLabel(c)} onClick={()=>onInsert(c.k)} />)}
            </div>
          )}
        </div>
        <Row label="Add formula column…" onClick={onAddFormula} />
        <div style={{height:1,background:"var(--bd)",margin:"4px 0"}} />
        <Row label="Columns…" onClick={onColumns} />
      </div>
    </>,
    document.body
  );
}

// ── B583 — Formula column editor ──────────────────────────────────────────────
// Inline (portal) editor for a user-defined Formula column: a name field, a formula
// box with autocomplete for [Column] names and FUNCTION() names, and a live preview
// that evaluates against the selected row. No window.prompt — owner rule. Excel is
// the mental model (the formula bar). Save is blocked until the name + formula are valid.
export function FormulaColumnEditor({mode, initLabel, initFormula, columnNames, existingLabels, preview, onSave, onDelete, onClose}) {
  const PF = window.PlanyrFormula;
  const [label, setLabel] = useState(initLabel || "");
  const [formula, setFormula] = useState(initFormula || "");
  const [caret, setCaret] = useState((initFormula || "").length);
  const [sugIdx, setSugIdx] = useState(0);
  const taRef = useRef(null);
  const FNS = (PF && PF.FUNCTION_NAMES) || [];
  const FN_HELP = (PF && PF.FUNCTION_HELP) || {};

  // The token under the caret → contextual suggestions.
  const ctxAt = (() => {
    const upto = formula.slice(0, caret);
    const lastOpen = upto.lastIndexOf("[");
    const lastClose = upto.lastIndexOf("]");
    if (lastOpen > lastClose) return { kind: "col", start: lastOpen, frag: upto.slice(lastOpen + 1) };
    const m = /([A-Za-z][A-Za-z0-9_]*)$/.exec(upto);
    if (m) return { kind: "word", start: caret - m[1].length, frag: m[1] };
    return { kind: "none", start: caret, frag: "" };
  })();
  const suggestions = (() => {
    const frag = ctxAt.frag.toLowerCase();
    if (ctxAt.kind === "col") {
      return columnNames.filter(n => n.toLowerCase().includes(frag)).slice(0, 8).map(n => ({ type: "col", name: n }));
    }
    if (ctxAt.kind === "word") {
      const fns = FNS.filter(n => n.toLowerCase().startsWith(frag)).slice(0, 6).map(n => ({ type: "fn", name: n }));
      const cols = columnNames.filter(n => n.toLowerCase().startsWith(frag)).slice(0, 4).map(n => ({ type: "col", name: n }));
      return frag ? [...fns, ...cols] : [];
    }
    return [];
  })();

  const applySuggestion = (sug) => {
    const before = formula.slice(0, ctxAt.start);
    const after = formula.slice(caret);
    let insert, newCaret;
    if (sug.type === "col") {
      insert = "[" + sug.name + "]";
      const trimmedAfter = after.replace(/^\s*\]/, ""); // don't double a trailing ]
      const next = before + insert + trimmedAfter;
      newCaret = (before + insert).length;
      setFormula(next);
    } else {
      insert = sug.name + "(";
      const next = before + insert + after;
      newCaret = (before + insert).length;
      setFormula(next);
    }
    setSugIdx(0);
    setTimeout(() => { const ta = taRef.current; if (ta) { ta.focus(); ta.setSelectionRange(newCaret, newCaret); setCaret(newCaret); } }, 0);
  };

  // Validation
  const trimmedLabel = label.trim();
  const dupLabel = existingLabels.some(l => (l || "").trim().toLowerCase() === trimmedLabel.toLowerCase());
  const isBuiltinName = isBuiltinFormulaName(trimmedLabel);
  // A name containing [ or ] could never be referenced from another formula: a [Column]
  // reference scans to the first ], so a name like "Cost [USD]" would tokenize as the
  // truncated "Cost [USD" plus a stray ] and surface #ERROR! — reject the brackets up front.
  const bracketInName = /[[\]]/.test(trimmedLabel);
  const parsed = PF ? PF.parseFormula(formula) : { error: "engine unavailable" };
  const parseErr = parsed && parsed.error ? parsed.error : null;
  const labelErr = !trimmedLabel ? "Give the column a name" : bracketInName ? "Name can't contain [ or ]" : dupLabel ? "A column with this name already exists" : isBuiltinName ? "That name is reserved for a built-in column" : null;
  const canSave = !labelErr && !parseErr && formula.trim() !== "";
  const prev = (canSave && preview) ? preview(formula) : null;

  const handleKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); if (canSave) onSave({ label: trimmedLabel, formula: formula.trim() }); return; }
    if (suggestions.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSugIdx(i => Math.min(suggestions.length - 1, i + 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSugIdx(i => Math.max(0, i - 1)); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); applySuggestion(suggestions[Math.min(sugIdx, suggestions.length - 1)]); return; }
    }
  };
  const syncCaret = (e) => setCaret(e.target.selectionStart);

  const box = { fontFamily: "'Inter',system-ui,sans-serif" };
  return ReactDOM.createPortal(
    <>
      <div onClick={onClose} style={{position:"fixed",inset:0,zIndex:100000,background:"rgba(15,18,23,0.28)"}} />
      <div onClick={e=>e.stopPropagation()} style={{...box,position:"fixed",top:"14vh",left:"50%",transform:"translateX(-50%)",zIndex:100001,width:480,maxWidth:"94vw",
        background:"var(--bg)",border:"1px solid var(--bd2)",borderRadius:12,boxShadow:"0 16px 48px rgba(0,0,0,0.28)",padding:"18px 18px 14px"}}>
        <div style={{fontSize:14,fontWeight:700,color:"var(--txt)",marginBottom:2}}>{mode==="edit"?"Edit formula column":"New formula column"}</div>
        <div style={{fontSize:11.5,color:"var(--mut)",marginBottom:12,lineHeight:1.5}}>
          A formula column computes a value for <b>every task row</b> from that row's other columns — like a calculated column in Excel. Reference a column by name in brackets, e.g. <code style={{background:"var(--surf)",padding:"0 4px",borderRadius:3}}>[Finish] - [Start]</code>.
        </div>

        <label style={{fontSize:10,fontWeight:700,letterSpacing:".06em",textTransform:"uppercase",color:"var(--mut)"}}>Column name</label>
        <input {...NO_AUTOFILL} autoFocus value={label} onChange={e=>setLabel(e.target.value)} placeholder="e.g. Days remaining"
          style={{width:"100%",boxSizing:"border-box",margin:"4px 0 2px",padding:"7px 9px",fontSize:13,border:`1px solid ${labelErr?"var(--danger,#d83a3a)":"var(--bd2)"}`,borderRadius:6,fontFamily:"inherit"}} />
        <div style={{fontSize:10.5,color:labelErr?"var(--danger,#d83a3a)":"transparent",minHeight:14}}>{labelErr||"."}</div>

        <label style={{fontSize:10,fontWeight:700,letterSpacing:".06em",textTransform:"uppercase",color:"var(--mut)"}}>Formula</label>
        <div style={{position:"relative",margin:"4px 0 2px"}}>
          <textarea ref={taRef} value={formula} rows={2} spellCheck={false}
            onChange={e=>{setFormula(e.target.value);setCaret(e.target.selectionStart);setSugIdx(0);}}
            onKeyDown={handleKey} onKeyUp={syncCaret} onClick={syncCaret}
            placeholder='IF([% Complete] >= 100, "Done", NETWORKDAYS([Start], [Finish]) & " days")'
            style={{width:"100%",boxSizing:"border-box",padding:"8px 9px",fontSize:12.5,lineHeight:1.45,
              border:`1px solid ${parseErr?"var(--danger,#d83a3a)":"var(--bd2)"}`,borderRadius:6,
              fontFamily:"ui-monospace,SFMono-Regular,Menlo,monospace",resize:"vertical"}} />
          {suggestions.length>0 && (
            <div style={{position:"absolute",top:"100%",left:0,marginTop:2,zIndex:5,minWidth:240,maxWidth:"100%",
              background:"var(--bg)",border:"1px solid var(--bd2)",borderRadius:7,boxShadow:"0 8px 24px rgba(0,0,0,0.16)",overflow:"hidden"}}>
              {suggestions.map((sg,i)=>(
                <div key={sg.type+sg.name} onMouseDown={e=>{e.preventDefault();applySuggestion(sg);}} onMouseEnter={()=>setSugIdx(i)}
                  style={{padding:"6px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:8,background:i===sugIdx?"#fff6e9":"transparent"}}>
                  <span style={{fontSize:8,fontWeight:700,color:sg.type==="fn"?"var(--amber)":"#0e7490",border:`1px solid ${sg.type==="fn"?"var(--amber)":"#0e7490"}`,borderRadius:3,padding:"0 3px"}}>{sg.type==="fn"?"fx":"col"}</span>
                  <span style={{fontSize:12,color:"var(--txt)",fontFamily:"ui-monospace,monospace"}}>{sg.type==="fn"?sg.name+"()":"["+sg.name+"]"}</span>
                  {sg.type==="fn" && FN_HELP[sg.name] && <span style={{fontSize:10.5,color:"var(--mut)",marginLeft:"auto",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:160}}>{FN_HELP[sg.name]}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{minHeight:18,fontSize:11.5,margin:"2px 0 8px"}}>
          {parseErr
            ? <span style={{color:"var(--danger,#d83a3a)",fontWeight:600}}>Can't read this formula: {parseErr}{parsed.detail?` — ${parsed.detail}`:""}</span>
            : prev
              ? (prev.ok
                  ? <span style={{color:"var(--mut)"}}>Preview {prev.sampleName?`(${prev.sampleName})`:""}: <b style={{color:"var(--txt)"}}>{prev.display===""?"(empty)":prev.display}</b></span>
                  : <span style={{color:"var(--danger,#d83a3a)",fontWeight:600}}>Preview: {prev.error}{prev.detail?` — ${prev.detail}`:""}</span>)
              : <span style={{color:"var(--mut)"}}>Type a formula to see a live preview.</span>}
        </div>

        <details style={{marginBottom:10}}>
          <summary style={{fontSize:11,color:"var(--mut)",cursor:"pointer"}}>Columns &amp; functions you can use</summary>
          <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:6}}>
            {columnNames.map(n=>(
              <span key={n} onClick={()=>applySuggestion({type:"col",name:n})} title="Insert"
                style={{fontSize:10.5,padding:"2px 6px",borderRadius:10,background:"#f1f5f9",color:"#0e7490",cursor:"pointer",fontFamily:"ui-monospace,monospace"}}>[{n}]</span>
            ))}
          </div>
          <div style={{fontSize:10.5,color:"var(--mut)",marginTop:7,lineHeight:1.5}}>
            <b>Functions:</b> {FNS.join(", ")}
          </div>
          <div style={{fontSize:10.5,color:"var(--mut)",marginTop:5,lineHeight:1.5}}>
            Dates use the project working-day calendar (WORKDAY/NETWORKDAYS skip weekends + holidays). % Complete is 0–100; Duration is in working days.
          </div>
        </details>

        <div style={{display:"flex",alignItems:"center",gap:8,borderTop:"1px solid var(--bd)",paddingTop:11}}>
          {onDelete && <button onClick={onDelete} style={{border:"1px solid var(--bd2)",background:"var(--bg)",color:"var(--danger,#d83a3a)",borderRadius:6,padding:"7px 12px",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Delete</button>}
          <span style={{flex:1}} />
          <button onClick={onClose} style={{border:"1px solid var(--bd2)",background:"var(--bg)",color:"var(--txt)",borderRadius:6,padding:"7px 14px",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
          <button onClick={()=>canSave&&onSave({label:trimmedLabel,formula:formula.trim()})} disabled={!canSave}
            style={{border:"none",background:canSave?"var(--amber)":"var(--bd2)",color:"#fff",borderRadius:6,padding:"7px 16px",fontSize:12,fontWeight:600,cursor:canSave?"pointer":"default",fontFamily:"inherit"}}>
            {mode==="edit"?"Save":"Add column"}
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}

// harness compatibility — the old classic-script page made every top-level binding a global, and the ui-audit / e2e
// drivers call them by bare name from page.evaluate (GanttView, buildGanttSVG, COLS, showToast, …). Same names, same values.
exposeToHarness({
  HEALTH_COL_STYLES: [() => HEALTH_COL_STYLES],
  HealthColHeaderIcon: [() => HealthColHeaderIcon],
  HealthColHeader: [() => HealthColHeader],
  STATUS_PALETTE: [() => STATUS_PALETTE],
  StatusHeaderDropdown: [() => StatusHeaderDropdown],
  NOTE_SIZES: [() => NOTE_SIZES],
  NotesColHeader: [() => NotesColHeader],
  GridColumnsChooser: [() => GridColumnsChooser],
  GridHeaderMenu: [() => GridHeaderMenu],
  FormulaColumnEditor: [() => FormulaColumnEditor],
});
