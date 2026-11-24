import { HEALTH, NO_AUTOFILL, useAnchoredPopover } from "../common.jsx";
import { activeProjectOf } from "../grid/columns.js";
import { crossScheduleLabel } from "../../../../shared/schedule/scheduleOwnership.js";
import { exposeToHarness } from "../harnessGlobals.js";

const { useState, useEffect, useRef } = React;


// ── ProjDropdown ──────────────────────────────────────────
export function ProjDropdown({data, setData, addProject, setProjCtx, breadcrumb=false}) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editVal,   setEditVal]   = useState("");
  const editRef = useRef(null);
  const btnRef  = useRef(null);
  const menuRef = useRef(null);
  const pos = useAnchoredPopover(open, btnRef, r => ({top: r.bottom + 4, left: r.left}), () => setOpen(false));   // NEW-1

  const projHealth = p => {
    if (!p.tasks.length) return "gray";
    if (p.tasks.some(t => t.health === "red"))    return "red";
    if (p.tasks.some(t => t.health === "yellow")) return "yellow";
    if (p.tasks.every(t => t.health === "green")) return "green";
    return "gray";
  };

  const toggle = () => setOpen(o => !o);

  useEffect(() => {
    if (!open) { setEditingId(null); return; }
    const down = e => {
      if (!btnRef.current?.contains(e.target) && !menuRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [open]);
  useEffect(() => { if (editingId !== null) setTimeout(()=>editRef.current?.focus(),0); }, [editingId]);

  const cur = activeProjectOf(data);
  const dot = HEALTH[cur ? projHealth(cur) : "gray"].dot;

  return (
    <>
      <button ref={btnRef}
        className=""
        style={breadcrumb
          ? {background:"none",border:"none",cursor:"pointer",fontFamily:"inherit",
             display:"flex",alignItems:"center",gap:5,padding:"3px 6px",borderRadius:4,
             fontSize:12,fontWeight:600,color:"var(--txt)"}
          : {display:"flex",alignItems:"center",gap:9,cursor:"pointer",fontFamily:"inherit",
             background:open?"#eef2ff":"transparent",border:`1px solid ${open?"#c7d2fe":"transparent"}`,
             borderRadius:7,padding:"4px 10px",maxWidth:230,minWidth:80,
             transition:"background .15s,border-color .15s"}}
        onClick={toggle}
        onMouseEnter={e=>{ if(!breadcrumb && !open) e.currentTarget.style.background="var(--surf)"; }}
        onMouseLeave={e=>{ if(!breadcrumb && !open) e.currentTarget.style.background="transparent"; }}>
        {!breadcrumb && <span style={{width:10,height:10,borderRadius:"50%",background:dot,flexShrink:0,boxShadow:`0 0 0 3px ${dot}1f`}} />}
        <span style={breadcrumb
          ? {overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1,textAlign:"left"}
          : {overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1,textAlign:"left",
             fontSize:16,fontWeight:700,letterSpacing:"-.015em",color:"var(--txt)",lineHeight:1.1}}>{cur?.name}</span>
        <i className="ti ti-chevron-down" aria-hidden="true"
          style={{fontSize:breadcrumb?11:13,color:"var(--mut)",flexShrink:0,transition:"transform .15s",transform:open?"rotate(180deg)":"none"}} />
      </button>

      {open && pos && ReactDOM.createPortal(
        <div ref={menuRef} style={{position:"fixed",top:pos.top,left:pos.left,background:"var(--bg)",border:"1px solid var(--bd2)",
          borderRadius:6,padding:4,zIndex:9999,boxShadow:"0 4px 16px rgba(0,0,0,0.12)",minWidth:230}}>
          {Object.values(data.projects).map(p => {
            const h = projHealth(p);
            const isActive = p.id === data.aPid;
            const isEditing = editingId === p.id;
            const confirmRename = () => {
              if (editVal.trim()) setData(d=>({...d,projects:{...d.projects,[p.id]:{...d.projects[p.id],name:editVal.trim()}}}));
              setEditingId(null);
            };
            return (
              <div key={p.id}
                onClick={() => { if(!isEditing){ setData(d=>({...d, aPid:p.id})); setOpen(false); } }}
                onContextMenu={e => { e.preventDefault(); setProjCtx({id:p.id, x:e.clientX, y:e.clientY}); setOpen(false); }}
                style={{display:"flex",alignItems:"center",gap:6,padding:"5px 8px",borderRadius:4,
                  cursor:isEditing?"default":"pointer",
                  background:isActive?"var(--surf)":"transparent",
                  fontFamily:"'Inter',system-ui,sans-serif",fontSize:12,
                  fontWeight:isActive?500:400,color:"var(--txt)"}}
                onMouseEnter={e=>{ if(!isActive&&!isEditing) e.currentTarget.style.background="var(--surf)"; }}
                onMouseLeave={e=>{ if(!isActive&&!isEditing) e.currentTarget.style.background="transparent"; }}>
                <span style={{width:7,height:7,borderRadius:"50%",background:HEALTH[h].dot,flexShrink:0}} />
                {/* B1873361 — the switcher lists EVERY schedule on the account flat, so a bare
                    name is exactly the ambiguity NEW-1 closed in the reports table: two schedules
                    named "Master Schedule" under different projects would be indistinguishable
                    here otherwise. The rename INPUT still edits the raw name (below), unaffected. */}
                {isEditing
                  ? <input {...NO_AUTOFILL} ref={editRef} value={editVal} onChange={e=>setEditVal(e.target.value)}
                      onClick={e=>e.stopPropagation()}
                      onKeyDown={e=>{if(e.key==="Enter"){e.stopPropagation();confirmRename();}if(e.key==="Escape"){e.stopPropagation();setEditingId(null);}}}
                      onBlur={confirmRename}
                      style={{flex:1,border:"1px solid var(--blue)",borderRadius:3,padding:"2px 5px",fontSize:12,
                        fontFamily:"inherit",outline:"none",background:"var(--bg)",color:"var(--txt)"}} />
                  : <span title={crossScheduleLabel(p)} style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{crossScheduleLabel(p)}</span>
                }
                {!isEditing && (
                  <span
                    onClick={e=>{ e.stopPropagation(); setEditVal(p.name); setEditingId(p.id); }}
                    title="Rename"
                    style={{opacity:0,fontSize:11,color:"var(--mut)",cursor:"pointer",flexShrink:0,padding:"1px 3px",borderRadius:3,lineHeight:1,
                      transition:"opacity .12s"}}
                    onMouseEnter={e=>{e.currentTarget.style.opacity="1";e.currentTarget.style.color="var(--amber)";e.currentTarget.style.background="#eef2ff";}}
                    onMouseLeave={e=>{e.currentTarget.style.opacity="0";e.currentTarget.style.color="var(--mut)";e.currentTarget.style.background="transparent";}}
                    ref={el=>{
                      if(el){
                        const row=el.closest("div[style]");
                        if(row){
                          row.addEventListener("mouseenter",()=>{el.style.opacity="0.4";});
                          row.addEventListener("mouseleave",()=>{el.style.opacity="0";});
                        }
                      }
                    }}>
                    <i className="ti ti-pencil" style={{fontSize:11}} />
                  </span>
                )}
                {!isEditing && isActive && <i className="ti ti-check" aria-hidden="true" style={{fontSize:12,color:"var(--amber)",flexShrink:0}} />}
              </div>
            );
          })}
          <div style={{height:1,background:"var(--bd)",margin:"4px 0"}} />
          <div onClick={() => { addProject(); setOpen(false); }}
            style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",borderRadius:4,cursor:"pointer",
              fontFamily:"'Inter',system-ui,sans-serif",fontSize:12,color:"var(--mut)"}}
            onMouseEnter={e=>e.currentTarget.style.background="var(--surf)"}
            onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
            <i className="ti ti-plus" aria-hidden="true" style={{fontSize:13}} />
            New project
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// ── RenameModal ───────────────────────────────────────────
export function RenameModal({name, onConfirm, onClose}) {
  const [val, setVal] = useState(name);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.select(); }, []);

  const confirm = () => { if (val.trim()) onConfirm(val.trim()); };

  return (
    <div style={{position:"fixed",inset:0,background:"#00000060",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center"}}
      onClick={onClose}>
      <div style={{background:"var(--surf)",border:"1px solid var(--bd2)",borderTop:"2px solid var(--amber)",borderRadius:6,
        padding:20,width:340,display:"flex",flexDirection:"column",gap:14}}
        onClick={e=>e.stopPropagation()}>
        <div style={{color:"var(--amber)",fontFamily:"'Inter',system-ui,sans-serif",fontWeight:600,fontSize:11,letterSpacing:".06em"}}>RENAME PROJECT</div>
        <input {...NO_AUTOFILL} ref={inputRef} className="ei" value={val} onChange={e=>setVal(e.target.value)}
          onKeyDown={e=>{ if(e.key==="Enter") confirm(); if(e.key==="Escape") onClose(); }} />
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn" style={{borderColor:"var(--amber)",color:"var(--amber)"}} onClick={confirm}>Rename</button>
        </div>
      </div>
    </div>
  );
}

// ── ProjContextMenu ───────────────────────────────────────
export function ProjContextMenu({x, y, projId, canDelete, onRename, onDuplicate, onDelete, onClose}) {
  const menuRef = useRef(null);

  useEffect(() => {
    const down = e => { if (!menuRef.current?.contains(e.target)) onClose(); };
    const key  = e => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown",   key);
    // NEW-1 — opened at a click point, so a scroll or resize leaves it stranded: close it (like TaskContextMenu).
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", onClose, true); window.removeEventListener("resize", onClose); };
  }, [onClose]);

  // Nudge menu back on-screen if it would overflow
  const vw = window.innerWidth, vh = window.innerHeight;
  const mw = 178, mh = canDelete ? 108 : 76;
  const left = x + mw > vw ? vw - mw - 8 : x;
  const top  = y + mh > vh ? vh - mh - 8 : y;

  const Item = ({icon, label, danger, onClick}) => (
    <div onClick={onClick}
      style={{display:"flex",alignItems:"center",gap:8,padding:"6px 12px",cursor:"pointer",fontSize:12,
        color:danger?"#dc2626":"var(--txt)",borderRadius:4,transition:"background .1s",fontFamily:"'Inter',system-ui,sans-serif"}}
      onMouseEnter={e=>e.currentTarget.style.background=danger?"#fff1f2":"var(--surf)"}
      onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
      <i className={`ti ${icon}`} style={{fontSize:14,flexShrink:0,color:danger?"#dc2626":"var(--mut)"}} aria-hidden="true" />
      {label}
    </div>
  );

  return ReactDOM.createPortal(
    <div ref={menuRef} style={{position:"fixed",top,left,background:"var(--bg)",border:"1px solid var(--bd2)",
      borderRadius:6,padding:"4px",zIndex:9999,boxShadow:"0 4px 16px rgba(0,0,0,0.13)",minWidth:mw}}>
      <Item icon="ti-pencil"      label="Rename"    onClick={onRename} />
      <Item icon="ti-copy"        label="Duplicate" onClick={onDuplicate} />
      {canDelete && <>
        <div style={{height:1,background:"var(--bd)",margin:"4px 0"}} />
        <Item icon="ti-trash" label="Delete" danger onClick={onDelete} />
      </>}
    </div>,
    document.body
  );
}

// harness compatibility — the old classic-script page made every top-level binding a global, and the ui-audit / e2e
// drivers call them by bare name from page.evaluate (GanttView, buildGanttSVG, COLS, showToast, …). Same names, same values.
exposeToHarness({
  ProjDropdown: [() => ProjDropdown],
  RenameModal: [() => RenameModal],
  ProjContextMenu: [() => ProjContextMenu],
});
