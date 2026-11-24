import { ownerHas, ownerListOf, removeOwnerFrom, renameOwnerIn } from "../../../../shared/schedule/engine/owners.js";
import { avatarColor, contactField, getInitials, showToast } from "../common.jsx";
import { crossScheduleLabel } from "../../../../shared/schedule/scheduleOwnership.js";
import { askConfirm } from "../dialogs/confirm.jsx";
import { stripViewState } from "../viewState.js";
import { exposeToHarness } from "../harnessGlobals.js";

const { useState, useEffect } = React;


export function ContactsPanel({ data, setData, onClose }) {
  const contacts = data.settings?.contacts || [];
  const [editId, setEditId] = React.useState(null);
  const [editName, setEditName] = React.useState('');
  const [editEmail, setEditEmail] = React.useState('');
  const [addMode, setAddMode] = React.useState(false);
  const [newName, setNewName] = React.useState('');
  const [newEmail, setNewEmail] = React.useState('');

  function saveContacts(updated) {
    setData(d => ({...d, settings:{...d.settings, contacts: updated}}));
  }
  function startEdit(c) { setEditId(c.id); setEditName(c.name); setEditEmail(c.email||''); setAddMode(false); }
  function commitEdit() {
    const nm = editName.trim();
    if (!nm) return;
    const oldName = (contacts.find(c => c.id === editId) || {}).name;
    setData(d => {
      const settings = {...d.settings, contacts: (d.settings?.contacts||[]).map(c => c.id===editId ? {...c, name:nm, email:editEmail.trim()} : c)};
      // The owner link is by NAME (and ensureContacts re-derives contacts from task owners on load), so
      // a rename must also rewrite every task's responsibleParty — else the change shows nothing on the
      // tasks AND the old name respawns as a duplicate contact on the next load (the rename "bounces back").
      let projects = d.projects;
      if (oldName && oldName !== nm) {
        projects = {};
        Object.entries(d.projects).forEach(([pid, proj]) => {
          projects[pid] = {...proj, tasks: (proj.tasks||[]).map(t => {
            const list = ownerListOf(t);
            if (!ownerHas(list, oldName)) return t;   // B1953795 (S7) -- case-insensitive link, same as the picker / ensureContacts
            return {...t, responsibleParty: renameOwnerIn(list, oldName, nm)};
          })};
        });
      }
      return {...d, settings, projects};
    });
    setEditId(null);
  }
  function del(id) {
    const goneName = (contacts.find(c => c.id === id) || {}).name;
    setData(d => {
      const settings = {...d.settings, contacts: (d.settings?.contacts||[]).filter(c => c.id!==id)};
      // Clear the owner on tasks that referenced this contact, else ensureContacts respawns it on the
      // next load (the link is by name) and the delete silently undoes itself.
      let projects = d.projects;
      if (goneName) {
        projects = {};
        Object.entries(d.projects).forEach(([pid, proj]) => {
          projects[pid] = {...proj, tasks: (proj.tasks||[]).map(t => {
            const list = ownerListOf(t);
            if (!ownerHas(list, goneName)) return t;
            return {...t, responsibleParty: removeOwnerFrom(list, goneName)};
          })};
        });
      }
      return {...d, settings, projects};
    });
  }
  function addContact() {
    if (!newName.trim()) return;
    const id = Date.now();
    saveContacts([...contacts, {id, name:newName.trim(), email:newEmail.trim()}]);
    setNewName(''); setNewEmail(''); setAddMode(false);
  }

  return (
    <div style={{position:'fixed',inset:0,zIndex:3000,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,.32)'}}>
      <div style={{background:'var(--bg)',borderRadius:12,boxShadow:'0 12px 40px rgba(0,0,0,.18)',width:420,maxWidth:'94vw',maxHeight:'80vh',display:'flex',flexDirection:'column',overflow:'hidden'}}>
        {/* Header */}
        <div style={{padding:'16px 20px 12px',borderBottom:'1px solid var(--bd)',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
          <div>
            <div style={{fontSize:15,fontWeight:600,color:'var(--txt)'}}>Contacts</div>
            <div style={{fontSize:11,color:'var(--mut)',marginTop:2}}>{contacts.length} contact{contacts.length!==1?'s':''}</div>
          </div>
          <button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',color:'var(--mut)',fontSize:18,lineHeight:1,padding:'4px 6px',borderRadius:5}}
            onMouseEnter={e=>e.currentTarget.style.background='#f0f0f0'} onMouseLeave={e=>e.currentTarget.style.background='none'}>✕</button>
        </div>
        {/* List */}
        <div style={{flex:1,overflowY:'auto',padding:'8px 0'}}>
          {contacts.length===0 && !addMode && (
            <div style={{padding:'24px 20px',textAlign:'center',color:'var(--mut)',fontSize:13}}>
              No contacts yet. Add one below.
            </div>
          )}
          {contacts.map(c => (
            <div key={c.id} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 20px',transition:'background .1s'}}
              onMouseEnter={e=>e.currentTarget.style.background='#f8f9fa'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
              {editId===c.id ? (
                <div style={{flex:1,display:'flex',gap:6,alignItems:'center'}}>
                  <input {...contactField("name")} value={editName} onChange={e=>setEditName(e.target.value)}
                    autoFocus placeholder="Name *"
                    style={{flex:1,fontSize:12,border:'1px solid var(--blue)',borderRadius:4,padding:'4px 7px',fontFamily:'inherit',outline:'none'}}
                    onKeyDown={e=>{if(e.key==='Enter')commitEdit();if(e.key==='Escape')setEditId(null);}} />
                  <input {...contactField("email")} value={editEmail} onChange={e=>setEditEmail(e.target.value)}
                    placeholder="Email"
                    style={{flex:1,fontSize:12,border:'1px solid var(--bd2)',borderRadius:4,padding:'4px 7px',fontFamily:'inherit',outline:'none'}}
                    onFocus={e=>e.target.style.borderColor='var(--blue)'} onBlur={e=>e.target.style.borderColor='var(--bd2)'}
                    onKeyDown={e=>{if(e.key==='Enter')commitEdit();if(e.key==='Escape')setEditId(null);}} />
                  <button onClick={commitEdit} style={{fontSize:11,padding:'4px 9px',borderRadius:4,border:'1px solid var(--amber)',background:'#eef2ff',color:'var(--amber)',cursor:'pointer',fontFamily:'inherit',whiteSpace:'nowrap'}}>Save</button>
                  <button onClick={()=>setEditId(null)} style={{fontSize:11,padding:'4px 7px',borderRadius:4,border:'1px solid var(--bd2)',background:'none',color:'var(--mut)',cursor:'pointer',fontFamily:'inherit'}}>✕</button>
                </div>
              ) : (<>
                <div style={{width:32,height:32,borderRadius:'50%',background:avatarColor(c.name),
                  display:'flex',alignItems:'center',justifyContent:'center',
                  fontSize:11,fontWeight:700,color:'#fff',flexShrink:0}}>{getInitials(c.name)}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,color:'var(--txt)',fontWeight:500}}>{c.name}</div>
                  {c.email && <div style={{fontSize:11,color:'var(--mut)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.email}</div>}
                  {!c.email && <div style={{fontSize:11,color:'var(--bd2)'}}>No email</div>}
                </div>
                <button onClick={()=>startEdit(c)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--mut)',padding:'4px 6px',borderRadius:4,fontSize:11,fontFamily:'inherit'}}
                  onMouseEnter={e=>e.currentTarget.style.background='#e8eaf0'} onMouseLeave={e=>e.currentTarget.style.background='none'}>Edit</button>
                <button onClick={()=>del(c.id)} style={{background:'none',border:'none',cursor:'pointer',color:'#f85149',padding:'4px 6px',borderRadius:4,fontSize:16,lineHeight:1}}
                  onMouseEnter={e=>e.currentTarget.style.background='#fef2f2'} onMouseLeave={e=>e.currentTarget.style.background='none'}>×</button>
              </>)}
            </div>
          ))}
        </div>
        {/* Add contact */}
        <div style={{borderTop:'1px solid var(--bd)',padding:'12px 20px',flexShrink:0}}>
          {!addMode ? (
            <button onClick={()=>setAddMode(true)}
              style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:'var(--blue)',fontWeight:500,
                background:'none',border:'1px dashed var(--bd2)',borderRadius:6,padding:'7px 14px',cursor:'pointer',width:'100%',justifyContent:'center',fontFamily:'inherit'}}
              onMouseEnter={e=>e.currentTarget.style.borderColor='var(--blue)'} onMouseLeave={e=>e.currentTarget.style.borderColor='var(--bd2)'}>
              <span style={{fontSize:16,lineHeight:1}}>+</span> Add Contact
            </button>
          ) : (
            <div style={{display:'flex',flexDirection:'column',gap:8}}>
              <div style={{display:'flex',gap:8}}>
                <input {...contactField("name")} autoFocus value={newName} onChange={e=>setNewName(e.target.value)}
                  placeholder="Full name *" style={{flex:1,fontSize:12,border:'1px solid var(--blue)',borderRadius:5,padding:'6px 9px',fontFamily:'inherit',outline:'none'}}
                  onKeyDown={e=>{if(e.key==='Enter')addContact();if(e.key==='Escape')setAddMode(false);}} />
                <input {...contactField("email")} value={newEmail} onChange={e=>setNewEmail(e.target.value)}
                  placeholder="Email (optional)" style={{flex:1,fontSize:12,border:'1px solid var(--bd2)',borderRadius:5,padding:'6px 9px',fontFamily:'inherit',outline:'none'}}
                  onFocus={e=>e.target.style.borderColor='var(--blue)'} onBlur={e=>e.target.style.borderColor='var(--bd2)'}
                  onKeyDown={e=>{if(e.key==='Enter')addContact();if(e.key==='Escape')setAddMode(false);}} />
              </div>
              <div style={{display:'flex',gap:8}}>
                <button onClick={addContact} style={{flex:1,fontSize:12,padding:'7px 0',borderRadius:5,
                  border:'1px solid var(--amber)',background:'#eef2ff',color:'var(--amber)',cursor:'pointer',fontFamily:'inherit',fontWeight:500}}>
                  Add Contact
                </button>
                <button onClick={()=>{setAddMode(false);setNewName('');setNewEmail('');}}
                  style={{fontSize:12,padding:'7px 14px',borderRadius:5,border:'1px solid var(--bd2)',
                    background:'none',color:'var(--mut)',cursor:'pointer',fontFamily:'inherit'}}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── HistoryPanel — browse / preview / restore snapshots from planar_history ─
export function HistoryPanel({ data, setData, onClose, exportJSON, importJSON, applyLoadedData }) {
  const [rows, setRows]           = useState(null);   // null = loading
  const [previewRow, setPreviewRow] = useState(null);
  const [previewData, setPreviewData] = useState(null); // parsed full snapshot
  const [busy, setBusy]           = useState(false);

  // Fetch list on mount
  useEffect(() => {
    let alive = true;
    (async () => {
      const list = await window.storage.getHistory("hs-v1", 100);
      if (alive) setRows(list);
    })();
    return () => { alive = false; };
  }, []);

  const refresh = async () => {
    setRows(null);
    const list = await window.storage.getHistory("hs-v1", 100);
    setRows(list);
  };

  const fmtAgo = (iso) => {
    const ms = Date.now() - new Date(iso).getTime();
    const s = Math.floor(ms/1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s/60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m/60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h/24);
    return `${d}d ago`;
  };
  const fmtAbs = (iso) => {
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  };
  const fmtBytes = (n) => {
    if (n == null) return "—";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
  };
  const labelStyle = (label) => {
    const map = {
      "auto":              { bg: "#f3f4f6", fg: "#4b5563" },
      "pre-import":        { bg: "#fef3c7", fg: "#92400e" },
      "pre-recascade":     { bg: "#fee2e2", fg: "#991b1b" },
      "pre-delete-project":{ bg: "#fee2e2", fg: "#991b1b" },
      "pre-restore":       { bg: "#dbeafe", fg: "#1e40af" },
      "safety-block":      { bg: "#fef2f2", fg: "#7f1d1d" },
    };
    return map[label] || { bg: "#f3f4f6", fg: "#4b5563" };
  };

  const doPreview = async (row) => {
    setBusy(true);
    const valStr = await window.storage.getHistoryValue(row.id);
    setBusy(false);
    if (!valStr) { showToast("Could not load snapshot.", { type: "error" }); return; }
    try {
      const parsed = JSON.parse(valStr);
      setPreviewRow(row);
      setPreviewData(parsed);
    } catch {
      showToast("Snapshot is not valid JSON.", { type: "error" });
    }
  };

  const doDownload = async (row) => {
    const valStr = await window.storage.getHistoryValue(row.id);
    if (!valStr) { showToast("Could not load snapshot.", { type: "error" }); return; }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([valStr], { type: "application/json" }));
    const stamp = row.created_at?.replace(/[:.]/g, "-").slice(0,19) || "snapshot";
    a.download = `planar-snapshot-${stamp}.json`;
    a.click();
  };

  const doRestore = async (row) => {
    if (!(await askConfirm({
      title: `Restore the snapshot from ${fmtAbs(row.created_at)}?`,
      body: `${row.task_count} tasks, ${row.project_count} projects.\n\nThe current state is saved as a 'pre-restore' snapshot first.`,
      confirmLabel: "Restore",
    }))) return;
    setBusy(true);
    try {
      // 1. Snapshot current state with pre-restore label
      if (data) {
        await window.storage.set("hs-v1", JSON.stringify(stripViewState(data)), { label: "pre-restore", skipSanity: true });
      }
      // 2. Fetch the snapshot value
      const valStr = await window.storage.getHistoryValue(row.id);
      if (!valStr) { showToast("Could not load snapshot.", { type: "error" }); setBusy(false); return; }
      const parsed = JSON.parse(valStr);
      // 3. Apply through the SAME normalize + cascade pipeline import/load use (B4). Applying a snapshot
      // RAW skipped B550 cycle-breaking (a parentId cycle → sortByVisualOrder infinite-recurses → white-
      // screen on render), id renumbering (B568 dup-id graph scramble), the holiday remerge, and the
      // date recascade — restore was the inconsistent twin of importJSON, which routes through it.
      if (applyLoadedData) applyLoadedData(parsed); else setData(parsed);
      showToast(`Restored snapshot from ${fmtAgo(row.created_at)}.`, { type: "success", duration: 4000 });
      onClose && onClose();
    } catch (e) {
      console.error("Restore failed:", e);
      showToast("Restore failed — see console.", { type: "error" });
    }
    setBusy(false);
  };

  return (
    <div data-testid="history-panel"
      style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",zIndex:9000,
        display:"flex",alignItems:"center",justifyContent:"center",padding:16}}
      onClick={onClose}>
      <div style={{background:"var(--bg)",border:"1px solid var(--bd2)",borderRadius:10,
        width:"min(900px,96vw)",maxHeight:"86vh",display:"flex",flexDirection:"column",overflow:"hidden"}}
        onClick={e=>e.stopPropagation()}>

        {/* Header */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
          padding:"12px 18px",borderBottom:"1px solid var(--bd)",flexShrink:0}}>
          <div>
            <div style={{fontSize:10,fontWeight:700,color:"var(--amber)",letterSpacing:".07em",textTransform:"uppercase",lineHeight:1,marginBottom:2}}>RECOVERY</div>
            <div style={{fontSize:14,fontWeight:600,color:"var(--txt)"}}>Version History</div>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            {exportJSON && (
              <button className="btn" onClick={exportJSON} title="Download a complete offline copy of all data as a .json file"
                style={{display:"flex",alignItems:"center",gap:5,fontSize:11}}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Backup file
              </button>
            )}
            {importJSON && (
              <label className="btn" title="Replace current data from a backup .json — current state is snapshotted first"
                style={{cursor:"pointer",display:"flex",alignItems:"center",gap:5,fontSize:11}}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 5 17 10"/><line x1="12" y1="5" x2="12" y2="17"/></svg>
                Restore file
                <input type="file" accept=".json" onChange={e=>{importJSON(e); e.target.value="";}} style={{display:"none"}}/>
              </label>
            )}
            <div style={{width:1,height:16,background:"var(--bd)"}} />
            <button className="btn" onClick={refresh} disabled={busy} aria-busy={busy || undefined} title="Refresh">↻</button>
            <button className="btn" onClick={onClose}>Close</button>
          </div>
        </div>

        {/* Banner */}
        <div style={{padding:"10px 18px",fontSize:11,color:"var(--mut)",background:"#fafbfc",borderBottom:"1px solid var(--bd)",flexShrink:0}}>
          Snapshots of your data, newest first. Restore reverts to a snapshot; your current state is backed up first as <code style={{background:"#eef2ff",padding:"1px 4px",borderRadius:2,fontSize:10}}>pre-restore</code>. For an offline copy, <strong>Backup file</strong> downloads everything as .json — <strong>Restore file</strong> loads one back.
        </div>

        {/* Body */}
        <div style={{flex:1,overflow:"auto"}}>
          {rows === null ? (
            <div style={{padding:"40px 18px",textAlign:"center",color:"var(--mut)",fontSize:12,cursor:"progress"}}>Loading…</div>
          ) : rows.length === 0 ? (
            <div style={{padding:"40px 18px",textAlign:"center",color:"var(--mut)",fontSize:12}}>
              <div style={{marginBottom:8,fontSize:13,color:"var(--txt)",fontWeight:500}}>No snapshots yet.</div>
              <div>If you've just enabled history, the <code>planar_history</code> table needs to be created in Supabase.<br/>See the setup SQL in the project README. Snapshots will appear here as you edit.</div>
            </div>
          ) : (
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead>
                <tr style={{background:"#fafbfc",borderBottom:"1px solid var(--bd)"}}>
                  <th style={{textAlign:"left",padding:"8px 12px",fontWeight:600,color:"var(--mut)",fontSize:10,textTransform:"uppercase",letterSpacing:".05em"}}>When</th>
                  <th style={{textAlign:"left",padding:"8px 12px",fontWeight:600,color:"var(--mut)",fontSize:10,textTransform:"uppercase",letterSpacing:".05em"}}>Label</th>
                  <th style={{textAlign:"right",padding:"8px 12px",fontWeight:600,color:"var(--mut)",fontSize:10,textTransform:"uppercase",letterSpacing:".05em"}}>Projects</th>
                  <th style={{textAlign:"right",padding:"8px 12px",fontWeight:600,color:"var(--mut)",fontSize:10,textTransform:"uppercase",letterSpacing:".05em"}}>Tasks</th>
                  <th style={{textAlign:"right",padding:"8px 12px",fontWeight:600,color:"var(--mut)",fontSize:10,textTransform:"uppercase",letterSpacing:".05em"}}>Size</th>
                  <th style={{textAlign:"right",padding:"8px 12px",fontWeight:600,color:"var(--mut)",fontSize:10,textTransform:"uppercase",letterSpacing:".05em"}}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const ls = labelStyle(r.label);
                  return (
                    <tr key={r.id} style={{borderBottom:"1px solid var(--bd)"}} data-testid="history-row">
                      <td style={{padding:"8px 12px",color:"var(--txt)"}} title={fmtAbs(r.created_at)}>{fmtAgo(r.created_at)}</td>
                      <td style={{padding:"8px 12px"}}>
                        <span style={{display:"inline-block",padding:"1px 7px",borderRadius:9,fontSize:10,fontWeight:500,background:ls.bg,color:ls.fg}}>{r.label || "auto"}</span>
                      </td>
                      <td style={{padding:"8px 12px",textAlign:"right",fontVariantNumeric:"tabular-nums"}}>{r.project_count ?? "—"}</td>
                      <td style={{padding:"8px 12px",textAlign:"right",fontVariantNumeric:"tabular-nums"}}>{r.task_count ?? "—"}</td>
                      <td style={{padding:"8px 12px",textAlign:"right",fontVariantNumeric:"tabular-nums",color:"var(--mut)"}}>{fmtBytes(r.byte_size)}</td>
                      <td style={{padding:"8px 12px",textAlign:"right"}}>
                        <button className="btn" disabled={busy} aria-busy={busy || undefined} onClick={()=>doPreview(r)} style={{marginRight:4,fontSize:10,padding:"2px 7px"}}>Preview</button>
                        <button className="btn" disabled={busy} aria-busy={busy || undefined} onClick={()=>doDownload(r)} style={{marginRight:4,fontSize:10,padding:"2px 7px"}}>Download</button>
                        <button className="btn" disabled={busy} aria-busy={busy || undefined} onClick={()=>doRestore(r)}
                          style={{fontSize:10,padding:"2px 7px",borderColor:"var(--amber)",color:"var(--amber)"}}>Restore</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Preview modal */}
        {previewRow && previewData && (
          <div onClick={()=>{setPreviewRow(null);setPreviewData(null);}}
            style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:9100,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
            <div onClick={e=>e.stopPropagation()}
              style={{background:"var(--bg)",borderRadius:8,width:"min(800px,94vw)",maxHeight:"82vh",display:"flex",flexDirection:"column",overflow:"hidden"}}>
              <div style={{padding:"10px 16px",borderBottom:"1px solid var(--bd)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{fontSize:13,fontWeight:600}}>Snapshot Preview</div>
                  <div style={{fontSize:10,color:"var(--mut)"}}>{fmtAbs(previewRow.created_at)} · {previewRow.label}</div>
                </div>
                <button className="btn" onClick={()=>{setPreviewRow(null);setPreviewData(null);}}>Close</button>
              </div>
              <div style={{flex:1,overflow:"auto",padding:"12px 16px"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                  <thead>
                    <tr style={{borderBottom:"1px solid var(--bd)"}}>
                      <th style={{textAlign:"left",padding:"6px 8px",fontWeight:600,color:"var(--mut)"}}>Project</th>
                      <th style={{textAlign:"right",padding:"6px 8px",fontWeight:600,color:"var(--mut)"}}>Tasks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(previewData.projects || {}).map(([pid, p]) => (
                      <tr key={pid} style={{borderBottom:"1px solid var(--bd)"}}>
                        {/* B1873361 — a version-history snapshot can hold two same-named schedules
                            same as the live document does, so this row names the schedule via
                            crossScheduleLabel, never the bare (possibly ambiguous) name. */}
                        <td style={{padding:"6px 8px"}}>{crossScheduleLabel(p)}</td>
                        <td style={{padding:"6px 8px",textAlign:"right",fontVariantNumeric:"tabular-nums"}}>{p.tasks?.length || 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{padding:"10px 16px",borderTop:"1px solid var(--bd)",display:"flex",justifyContent:"flex-end",gap:8}}>
                <button className="btn" onClick={()=>doDownload(previewRow)}>Download JSON</button>
                <button className="btn"
                  style={{borderColor:"var(--amber)",color:"var(--amber)"}}
                  onClick={()=>{ const r = previewRow; setPreviewRow(null); setPreviewData(null); doRestore(r); }}>
                  Restore This Snapshot
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// harness compatibility — the old classic-script page made every top-level binding a global, and the ui-audit / e2e
// drivers call them by bare name from page.evaluate (GanttView, buildGanttSVG, COLS, showToast, …). Same names, same values.
exposeToHarness({
  ContactsPanel: [() => ContactsPanel],
  HistoryPanel: [() => HistoryPanel],
});
