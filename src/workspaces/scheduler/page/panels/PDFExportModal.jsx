import { resolveLabelAlign } from "../gantt/GanttView.jsx";
import { PAGE_SIZES, buildPDFHtml } from "../gantt/pdfExport.jsx";
import { crossScheduleLabel } from "../../../../shared/schedule/scheduleOwnership.js";
import { Field, Row, SegBtn, Toggle } from "./formControls.jsx";
import { exposeToHarness } from "../harnessGlobals.js";

const { useState, useEffect, useRef, useMemo } = React;

// B403 — silently persist & restore the export screen's settings across opens (no badge).
// Per browser/user via localStorage (the column WIDTH state already rides data.exportColWidths,
// B392; task-specific selection/collapse is intentionally NOT persisted). docDate is left to
// default to "today" each open rather than freezing a stale date onto an exhibit.
const EXPORT_PREFS_KEY = "planar:exportPrefs:v1";
const EXPORT_PERSIST_KEYS = ["orientation","pageSize","margins","columns","includeGantt","showToday","showArrows","barNames","labelAlign","healthFilter","exhibitLabel","projectTitle","preparedBy","preparedFor","confidential","timeUnit","zoomMul","panFrac"];
function loadExportPrefs(){ try { return JSON.parse(localStorage.getItem(EXPORT_PREFS_KEY) || "{}") || {}; } catch { return {}; } }
function saveExportPrefs(obj){ try { localStorage.setItem(EXPORT_PREFS_KEY, JSON.stringify(obj)); } catch (_) {} }

export function PDFExportModal({data, activePid, onClose, setData}) {
  const projs = Object.values(data.projects);
  const now = new Date();
  const seedCollapsed = useMemo(() => {
    const out = [];
    Object.values(data.projects).forEach(p => p.tasks.forEach(t => {
      if (p.tasks.some(x => x.parentId === t.id) && t.isExpanded === false) out.push(p.id + ":" + t.id);
    }));
    return out;
  }, []);
  const initPrefs = useMemo(() => loadExportPrefs(), []);   // B403
  const [cfg, setCfg] = useState(() => {
    const base = {
      exhibitLabel: "",
      projectTitle: "",
      preparedBy: "", preparedFor: "",
      docDate: now.toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"}),
      orientation: "landscape",
      pageSize: "letter",
      margins: {top:"0.75", right:"0.75", bottom:"0.75", left:"0.75"},
      selProjects: activePid ? [String(activePid)] : projs.map(p => String(p.id)),
      columns: (() => { const PRINTABLE=new Set(["id","name","start","end","duration","health","percentComplete","responsibleParty","predecessors"]); const mc=(data.masterCols||[]).filter(k=>PRINTABLE.has(k)); return mc.length>0?mc:["id","name","start","end","duration","health","responsibleParty"]; })(),
      includeGantt: true,
      showToday: true,
      showArrows: true,
      barNames: true,                                              // in-chart Gantt names ON by default (B394)
      labelAlign: resolveLabelAlign(activePid!=null ? data.projects?.[activePid] : null),  // seed from the on-screen choice
      healthFilter: "all",
      confidential: "",
      collapsedIds: seedCollapsed,
      detailLevel: seedCollapsed.length ? "custom" : "all",
      // B392 — per-column width overrides from dragging a column edge in the preview.
      colWidths: data.exportColWidths || {},
      // B361 time axis: discrete unit (null = auto-fit), continuous fine multiplier, pan 0..1.
      timeUnit: null, zoomMul: 1, panFrac: 0,
    };
    // B403 — overlay the persisted choices (only the safe-to-restore keys).
    EXPORT_PERSIST_KEYS.forEach(k => { if (initPrefs[k] !== undefined) base[k] = initPrefs[k]; });
    return base;
  });
  const upd = patch => setCfg(c => ({...c, ...patch}));
  const cfgRef = useRef(cfg);
  useEffect(() => { cfgRef.current = cfg; }, [cfg]);
  const [headerOpen, setHeaderOpen] = useState(() => !!initPrefs.headerOpen);   // B403
  // Collapsible sidebar sections — default open; clicking a section header toggles it
  const [secOpen, setSecOpen] = useState(() => initPrefs.secOpen || {});        // B403
  const secIsOpen = k => secOpen[k] !== false;

  // B403 — silently persist the restorable settings on any change (no badge). Written
  // synchronously (not debounced) so closing the modal right after a change still saves it.
  useEffect(() => {
    const out = {}; EXPORT_PERSIST_KEYS.forEach(k => { out[k] = cfg[k]; });
    out.secOpen = secOpen; out.headerOpen = headerOpen;
    saveExportPrefs(out);
  }, [cfg, secOpen, headerOpen]);

  // Debounced config for preview (avoids re-render on every keystroke)
  const [previewCfg, setPreviewCfg] = useState(cfg);
  useEffect(() => {
    const t = setTimeout(() => setPreviewCfg(cfg), 280);
    return () => clearTimeout(t);
  }, [cfg]);

  // ── Collapse / detail level (exhibit-only; never written back to live tasks) ──
  // Collapse changes flush the preview immediately rather than waiting on the debounce.
  const applyCollapse = (idsArr, lvl) => { const next = {...cfg, collapsedIds: idsArr, detailLevel: lvl}; setCfg(next); setPreviewCfg(next); };
  const levelCollapsedIds = n => {
    const out = [];
    cfg.selProjects.forEach(pidStr => {
      const p = data.projects[pidStr]; if (!p) return;
      p.tasks.forEach(t => {
        if (!p.tasks.some(x => x.parentId === t.id)) return;
        let d = 0, cur = t; while (cur && cur.parentId != null) { d++; cur = p.tasks.find(x => x.id === cur.parentId); }
        if (d >= (n - 1)) out.push(p.id + ":" + t.id);
      });
    });
    return out;
  };
  const setDetailLevel = lvl => { if (lvl === "all") applyCollapse([], "all"); else applyCollapse(levelCollapsedIds(+lvl), String(lvl)); };
  const expandAll = () => setDetailLevel("all");
  const collapseAll = () => setDetailLevel("1");

  // Collapse toggles fired from the ▾/▸ triangles inside the preview iframe.
  useEffect(() => {
    const onToggle = e => {
      if (e.origin !== window.location.origin) return;   // B516: same-origin only (matches the nav/toolbar bridges)
      if (!e.data || e.data.type !== "planarToggleCollapse") return;
      const key = e.data.key, c = cfgRef.current, s = new Set(c.collapsedIds || []);
      if (s.has(key)) s.delete(key); else s.add(key);
      const next = {...c, collapsedIds: [...s], detailLevel: "custom"};
      setCfg(next); setPreviewCfg(next);
    };
    window.addEventListener("message", onToggle);
    return () => window.removeEventListener("message", onToggle);
  }, []);

  // Column drag-resize (B392) fired from a header handle inside the preview iframe: stash
  // the new width as an override (flush the preview immediately, like collapse) and persist
  // it on the schedule so the tuned exhibit comes back next time.
  useEffect(() => {
    const onResize = e => {
      if (e.origin !== window.location.origin) return;   // B516: same-origin only — this persists to saved data
      if (!e.data || e.data.type !== "planarColResize") return;
      const { key, w } = e.data;
      if (!key || !(w > 0)) return;
      const c = cfgRef.current, next = {...c, colWidths: {...(c.colWidths || {}), [key]: Math.round(w)}};
      setCfg(next); setPreviewCfg(next);
      if (setData) setData(d => ({...d, exportColWidths: {...(d.exportColWidths || {}), [key]: Math.round(w)}}));
    };
    window.addEventListener("message", onResize);
    return () => window.removeEventListener("message", onResize);
  }, []);
  const hasColOverrides = Object.keys(cfg.colWidths || {}).length > 0;
  const resetColWidths = () => {
    const next = {...cfg, colWidths: {}}; setCfg(next); setPreviewCfg(next);
    if (setData) setData(d => { const n = {...d}; delete n.exportColWidths; return n; });
  };

  // Blob URL for iframe preview
  const [previewUrl, setPreviewUrl] = useState(null);
  useEffect(() => {
    const html = buildPDFHtml(previewCfg, data, true);
    const blob = new Blob([html], {type:"text/html"});
    const url  = URL.createObjectURL(blob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [previewCfg]);

  // Measure preview pane width for scaling
  const previewPaneRef = useRef(null);
  const [paneW, setPaneW] = useState(760);
  const [_paneH, setPaneH] = useState(520);
  useEffect(() => {
    const el = previewPaneRef.current; if (!el) return;
    const obs = new ResizeObserver(([e]) => { setPaneW(e.contentRect.width); setPaneH(e.contentRect.height); });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const _ps = PAGE_SIZES[cfg.pageSize] || PAGE_SIZES.letter;
  const pageW = Math.round((cfg.orientation === "landscape" ? _ps.h : _ps.w) * 96);
  const pageH = Math.round((cfg.orientation === "landscape" ? _ps.w : _ps.h) * 96);

  // iframe reports its full content height via postMessage — more reliable than reading contentDocument
  const iframeRef = useRef(null);
  const [iframeH, setIframeH] = useState(pageH);
  useEffect(() => { setIframeH(pageH); }, [pageH]);
  useEffect(() => {
    const handler = e => {
      if (e.origin !== window.location.origin) return;   // B516: same-origin only (matches the nav/toolbar bridges)
      if (e.data?.type === 'planarPreviewHeight') setIframeH(Math.max(pageH, e.data.h));
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [pageH]);

  const fitScale = Math.min(1, (paneW - 48) / pageW);
  const [previewZoom, setPreviewZoom] = useState(1);
  const scale = fitScale * previewZoom;
  const zoomTo = z => setPreviewZoom(Math.min(4, Math.max(0.25, z)));
  // "Fit" resets BOTH the page magnification AND the time axis back to the auto-fit whole-
  // schedule frame (B361/B401) — one button that says "show everything, nicely framed".
  const fitWidth = () => { setPreviewZoom(1); upd({timeUnit:null, zoomMul:1, panFrac:0}); };

  // B361 — time-axis controls. The discrete unit and the continuous fine multiplier feed ONE
  // span inside buildGanttSVG (they compose, never fight); picking a unit snaps the multiplier.
  const setTimeUnit = u => upd({timeUnit:u, zoomMul:1, panFrac:0});
  const bumpScale = f => upd({zoomMul: Math.min(12, Math.max(0.25, (cfg.zoomMul||1) * f))});

  // B361 — "Pan" mode (renamed from "Move"): a hand-cursor drag slides the visible TIME window
  // left/right (horizontal → cfg.panFrac) and scrolls the sheet vertically; the wheel magnifies
  // the page. A transparent overlay captures these only WHILE pan is on, so the in-preview
  // collapse triangles / column drag-handles keep working under a real mouse when it's off.
  const [panMode, setPanMode] = useState(false);
  const panRef = useRef(null);
  const overlayRef = useRef(null);
  const flushRef = useRef(0);
  useEffect(() => {
    const el = overlayRef.current;
    if (!el || !panMode) return;
    const pane = previewPaneRef.current;
    const PAN_SPAN = 520;   // px of horizontal drag = the full time range
    const onWheel = e => { e.preventDefault(); e.stopPropagation(); setPreviewZoom(z => Math.min(4, Math.max(0.25, z * (e.deltaY < 0 ? 1.1 : 1/1.1)))); };
    const onDown = e => { if (e.button !== 0) return; e.preventDefault(); panRef.current = { x:e.clientX, y:e.clientY, pf:(cfgRef.current.panFrac||0), st:pane?pane.scrollTop:0 }; el.style.cursor = "grabbing"; };
    const onMove = e => {
      const p = panRef.current; if (!p) return;
      if (pane) pane.scrollTop = p.st - (e.clientY - p.y);                            // vertical → scroll the sheet
      const pf = Math.max(-1.2, Math.min(1.2, p.pf - (e.clientX - p.x) / PAN_SPAN));  // horizontal → slide the window (offset from today-center)
      const next = {...cfgRef.current, panFrac: pf};
      setCfg(next);
      const now = Date.now();
      if (now - flushRef.current > 170) { setPreviewCfg(next); flushRef.current = now; }  // throttled live update
    };
    const onUp = () => { if (panRef.current) setPreviewCfg(cfgRef.current); panRef.current = null; if (el) el.style.cursor = "grab"; };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { el.removeEventListener('wheel', onWheel); el.removeEventListener('mousedown', onDown); window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [panMode]);

  const COL_OPTS = [
    {k:"id",label:"ID"},{k:"name",label:"Task Name"},{k:"start",label:"Start"},
    {k:"end",label:"End"},{k:"duration",label:"Duration"},{k:"health",label:"Status"},
    {k:"percentComplete",label:"% Done"},{k:"responsibleParty",label:"Owner"},
    {k:"predecessors",label:"Predecessors"},{k:"cost",label:"Cost"},
  ];

  const openPrint = () => {
    const html = buildPDFHtml(cfg, data);
    const w = window.open("","_blank","width=1100,height=820");
    w.document.write(html); w.document.close();
  };

  // Toggle / SegBtn / Field / Row hoisted to module scope (above PDFExportModal) — B3/M4.
  const SHdr = ({title,k}) => (
    <div onClick={k ? ()=>setSecOpen(s=>({...s,[k]:!(s[k]!==false)})) : undefined}
      style={{display:"flex",alignItems:"center",justifyContent:"space-between",
        fontSize:9,fontWeight:700,color:"var(--mut)",letterSpacing:".08em",textTransform:"uppercase",
        padding:"9px 0 5px",borderBottom:"1px solid var(--bd)",marginBottom:5,
        cursor:k?"pointer":"default",userSelect:"none"}}
      onMouseEnter={k ? (e=>e.currentTarget.style.opacity="0.7") : undefined}
      onMouseLeave={k ? (e=>e.currentTarget.style.opacity="1") : undefined}>
      {title}
      {k && <span style={{fontSize:10,color:"var(--mut)",transform:secIsOpen(k)?"rotate(180deg)":"rotate(0deg)",
        transition:"transform .2s",display:"inline-block",lineHeight:1}}>▾</span>}
    </div>
  );

  // Shared styles for the floating preview toolbar (B361).
  const TB_BTN={width:22,height:20,border:"none",borderRadius:4,background:"rgba(255,255,255,0.16)",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",lineHeight:1,fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center"};
  const TB_LBL={height:20,border:"none",borderRadius:4,background:"rgba(255,255,255,0.16)",color:"#fff",fontSize:10,fontWeight:600,padding:"0 8px",cursor:"pointer",fontFamily:"inherit"};
  const TB_TAG={color:"#aab2bd",fontSize:8,fontWeight:700,letterSpacing:".06em",textTransform:"uppercase"};
  const TB_DIV={width:1,height:16,background:"rgba(255,255,255,0.22)",margin:"0 2px"};

  return (
    <div style={{position:"fixed",inset:0,background:"#000000a0",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}
      onClick={onClose}>
      <div style={{background:"var(--surf)",border:"1px solid var(--bd2)",borderRadius:10,
        width:"min(98vw,1700px)",height:"min(96vh,960px)",display:"flex",flexDirection:"column",overflow:"hidden"}}
        onClick={e=>e.stopPropagation()}>

        {/* ── Top bar ── */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
          padding:"12px 18px",borderBottom:"1px solid var(--bd)",flexShrink:0,background:"var(--bg)"}}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <div>
              <div style={{fontSize:10,fontWeight:700,color:"var(--amber)",letterSpacing:".07em",textTransform:"uppercase",lineHeight:1,marginBottom:2}}>EXPORT</div>
              <div style={{fontSize:14,fontWeight:600,color:"var(--txt)"}}>PDF / Print Exhibit</div>
            </div>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <span style={{fontSize:10,color:"var(--mut)"}}>Opens print dialog — choose <strong>Save as PDF</strong></span>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn" onClick={openPrint}
              style={{background:"var(--amber)",color:"#fff",borderColor:"var(--amber)",padding:"5px 16px",fontWeight:600,fontSize:12}}>
              Print / Save as PDF ↗
            </button>
          </div>
        </div>

        {/* ── Body: sidebar + preview ── */}
        <div style={{flex:1,display:"flex",overflow:"hidden"}}>

          {/* Config sidebar */}
          <div style={{width:252,flexShrink:0,borderRight:"1px solid var(--bd)",overflowY:"auto",padding:"0 14px 16px",background:"var(--bg)"}}>

            <SHdr title="Projects" k="projects" />
            {secIsOpen("projects") && (
            <div style={{display:"flex",flexDirection:"column",gap:1,marginBottom:4}}>
              {projs.map(p=>(
                <label key={p.id} style={{display:"flex",alignItems:"center",gap:7,cursor:"pointer",padding:"3px 4px",borderRadius:3,transition:"background .1s"}}
                  onMouseEnter={e=>e.currentTarget.style.background="var(--surf)"}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <input type="checkbox" checked={cfg.selProjects.includes(String(p.id))}
                    onChange={e=>upd({selProjects:e.target.checked?[...cfg.selProjects,String(p.id)]:cfg.selProjects.filter(x=>x!==String(p.id))})}
                    style={{accentColor:"#4f46e5",width:12,height:12,flexShrink:0}} />
                  {/* B1873361 — picking WHICH schedules to export, so the qualified label
                      disambiguates two same-named schedules the same way the export's own
                      per-project header (crossScheduleLabel, buildPDFHtml) now does. */}
                  <span title={crossScheduleLabel(p)} style={{fontSize:11,color:"var(--txt)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{crossScheduleLabel(p)}</span>
                </label>
              ))}
            </div>
            )}

            <SHdr title="Layout" k="layout" />
            {secIsOpen("layout") && (<>
            <Row label="Size">
              <select value={cfg.pageSize} onChange={e=>upd({pageSize:e.target.value})}
                style={{flex:1,background:"var(--bg)",border:"1px solid var(--bd2)",borderRadius:3,
                  padding:"3px 6px",fontSize:11,color:"var(--txt)",fontFamily:"inherit",outline:"none",cursor:"pointer"}}
                onFocus={e=>e.target.style.borderColor="var(--blue)"}
                onBlur={e=>e.target.style.borderColor="var(--bd2)"}>
                {Object.entries(PAGE_SIZES).map(([k,ps])=>(
                  <option key={k} value={k}>{ps.label}</option>
                ))}
              </select>
            </Row>
            <Row label="Orientation">
              <SegBtn small options={[{l:"Landscape",v:"landscape"},{l:"Portrait",v:"portrait"}]} value={cfg.orientation} onChange={v=>upd({orientation:v})} />
            </Row>
            <Row label="Tasks">
              <SegBtn small options={[{l:"All",v:"all"},{l:"Active",v:"active"},{l:"Done",v:"complete"}]} value={cfg.healthFilter} onChange={v=>upd({healthFilter:v})} />
            </Row>
            <Row label={<span style={{display:"inline-flex",alignItems:"center",gap:5}}>Detail{cfg.detailLevel==="custom" && <span style={{fontSize:8,fontWeight:700,color:"#4f46e5",background:"#eef0fe",padding:"1px 5px",borderRadius:99,letterSpacing:".03em"}}>CUSTOM</span>}</span>}>
              <SegBtn small options={[{l:"All",v:"all"},{l:"L1",v:"1"},{l:"1\u20132",v:"2"},{l:"1\u20133",v:"3"}]} value={cfg.detailLevel} onChange={setDetailLevel} />
            </Row>
            <div style={{display:"flex",gap:6,padding:"3px 0 1px"}}>
              {[["Expand all",expandAll],["Collapse all",collapseAll]].map(([lbl,fn])=>(
                <span key={lbl} onClick={fn} style={{flex:1,textAlign:"center",padding:"3px 0",fontSize:10,cursor:"pointer",borderRadius:4,border:"1px solid var(--bd2)",color:"var(--mut)",userSelect:"none",transition:"background .12s"}}
                  onMouseEnter={e=>e.currentTarget.style.background="var(--surf)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>{lbl}</span>
              ))}
            </div>
            <div style={{fontSize:9.5,color:"var(--mut)",lineHeight:1.45,padding:"3px 0 1px"}}>Tip: click \u25BE on a row in the preview to open or collapse that branch. This only affects the exhibit \u2014 your live schedule stays as-is.</div>
            <Row label="Gantt"><Toggle on={cfg.includeGantt} onChange={v=>upd({includeGantt:v})} /></Row>
            {cfg.includeGantt && (
              <Row label="Today line"><Toggle on={cfg.showToday!==false} onChange={v=>upd({showToday:v})} /></Row>
            )}
            {cfg.includeGantt && (
              <Row label="Dep. arrows"><Toggle on={cfg.showArrows!==false} onChange={v=>upd({showArrows:v})} /></Row>
            )}
            {cfg.includeGantt && (
              <Row label="Time scale">
                <SegBtn small options={[{l:"Fit",v:"fit"},{l:"Qtr",v:"quarters"},{l:"Mo",v:"months"},{l:"Wk",v:"weeks"},{l:"Day",v:"days"}]} value={cfg.timeUnit||"fit"} onChange={v=>setTimeUnit(v==="fit"?null:v)} />
              </Row>
            )}
            {cfg.includeGantt && (
              <Row label="Bar names"><Toggle on={cfg.barNames!==false} onChange={v=>upd({barNames:v})} /></Row>
            )}
            {cfg.includeGantt && cfg.barNames!==false && (
              <Row label="Name align">
                <SegBtn small options={[{l:"Left",v:"left"},{l:"Center",v:"center"},{l:"Right",v:"right"}]} value={cfg.labelAlign||"right"} onChange={v=>upd({labelAlign:v})} />
              </Row>
            )}
            </>)}

            <SHdr title="Margins" k="margins" />
            {secIsOpen("margins") && (
            <div style={{marginBottom:6}}>
              <div style={{display:"flex",gap:4,marginBottom:6}}>
                {[{l:"Narrow",v:"0.5"},{l:"Normal",v:"0.75"},{l:"Wide",v:"1.0"}].map(p=>{
                  const isActive=cfg.margins.top===p.v&&cfg.margins.right===p.v&&cfg.margins.bottom===p.v&&cfg.margins.left===p.v;
                  return <span key={p.v} onClick={()=>upd({margins:{top:p.v,right:p.v,bottom:p.v,left:p.v}})}
                    style={{flex:1,textAlign:"center",padding:"3px 0",fontSize:10,cursor:"pointer",borderRadius:3,border:"1px solid var(--bd2)",
                      background:isActive?"var(--amber)":"transparent",color:isActive?"#fff":"var(--mut)",transition:"background .12s,color .12s"}}>{p.l}</span>;
                })}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4}}>
                {[{k:"top",l:"Top"},{k:"right",l:"Right"},{k:"bottom",l:"Bot."},{k:"left",l:"Left"}].map(({k,l})=>(
                  <div key={k} style={{display:"flex",alignItems:"center",gap:4}}>
                    <span style={{fontSize:10,color:"var(--mut)",width:28,flexShrink:0}}>{l}</span>
                    <div style={{position:"relative",flex:1,display:"flex",alignItems:"center"}}>
                      <input type="number" step="0.25" min="0" max="2" value={cfg.margins[k]}
                        onChange={e=>upd({margins:{...cfg.margins,[k]:e.target.value}})}
                        style={{width:"100%",background:"var(--bg)",border:"1px solid var(--bd2)",borderRadius:3,
                          padding:"3px 22px 3px 6px",fontSize:11,color:"var(--txt)",fontFamily:"inherit",outline:"none"}}
                        onFocus={e=>e.target.style.borderColor="var(--blue)"}
                        onBlur={e=>e.target.style.borderColor="var(--bd2)"} />
                      <span style={{position:"absolute",right:5,fontSize:9,color:"var(--mut)",pointerEvents:"none"}}>in</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            )}

            {/* Collapsible Header / Cover section */}
            <div onClick={()=>setHeaderOpen(o=>!o)}
              style={{display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer",
                padding:"6px 0 5px",borderBottom:"1px solid var(--bd)",marginBottom:5,userSelect:"none"}}
              onMouseEnter={e=>e.currentTarget.style.opacity="0.7"}
              onMouseLeave={e=>e.currentTarget.style.opacity="1"}>
              <span style={{fontSize:9,fontWeight:700,color:"var(--mut)",letterSpacing:".08em",textTransform:"uppercase"}}>
                Header / Cover
              </span>
              <span style={{fontSize:10,color:"var(--mut)",transform:headerOpen?"rotate(180deg)":"rotate(0deg)",
                transition:"transform .2s",display:"inline-block",lineHeight:1}}>▾</span>
            </div>
            {headerOpen && (
              <div style={{display:"flex",flexDirection:"column",gap:1,marginBottom:4}}>
                <Row label="Exhibit"><Field value={cfg.exhibitLabel} onChange={v=>upd({exhibitLabel:v})} placeholder="Exhibit A" /></Row>
                <Row label="Title"><Field value={cfg.projectTitle} onChange={v=>upd({projectTitle:v})} placeholder="Schedule title" /></Row>
                <Row label="Prep. by"><Field value={cfg.preparedBy} onChange={v=>upd({preparedBy:v})} placeholder="Name / company" /></Row>
                <Row label="Prep. for"><Field value={cfg.preparedFor} onChange={v=>upd({preparedFor:v})} placeholder="Client" /></Row>
                <Row label="Date"><Field value={cfg.docDate} onChange={v=>upd({docDate:v})} /></Row>
                <Row label="Conf. tag"><Field value={cfg.confidential} onChange={v=>upd({confidential:v})} placeholder="Confidential" /></Row>
              </div>
            )}

            <SHdr title="Columns" k="columns" />
            {secIsOpen("columns") && (
            <div style={{display:"flex",flexDirection:"column",gap:1}}>
              {COL_OPTS.map(c=>(
                <label key={c.k} style={{display:"flex",alignItems:"center",gap:7,cursor:"pointer",padding:"3px 4px",borderRadius:3,transition:"background .1s"}}
                  onMouseEnter={e=>e.currentTarget.style.background="var(--surf)"}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <input type="checkbox" checked={cfg.columns.includes(c.k)}
                    onChange={e=>upd({columns:e.target.checked?[...cfg.columns,c.k]:cfg.columns.filter(x=>x!==c.k)})}
                    style={{accentColor:"#4f46e5",width:12,height:12,flexShrink:0}} />
                  <span style={{fontSize:11,color:"var(--txt)"}}>{c.label}</span>
                </label>
              ))}
              {/* B392 — column widths auto-fit to content; drag a header edge in the preview to tune one. */}
              {cfg.includeGantt && (
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:6,marginTop:6,paddingTop:6,borderTop:"1px solid var(--bd)"}}>
                  <span style={{fontSize:10,color:"var(--mut)",lineHeight:1.3}}>Drag a column's right edge in the preview to resize it.</span>
                  {hasColOverrides && (
                    <span onClick={resetColWidths} title="Reset all columns to auto-fit"
                      style={{fontSize:10,fontWeight:600,color:"#4f46e5",cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>Reset</span>
                  )}
                </div>
              )}
            </div>
            )}

          </div>

          {/* Preview area = a NON-scrolling relative wrapper holding the scroller + a pinned
              toolbar. The toolbar lives OUTSIDE the scroller as an absolute overlay so it is
              always visible AND clickable (the old float/sticky-inside-flex toolbar was dead +
              intermittently visible — B361 bug fix). */}
          <div style={{flex:1,position:"relative",display:"flex",minWidth:0,background:"#e8eaed"}}>
            <div ref={previewPaneRef}
              style={{flex:1,overflow:"auto",display:"flex",alignItems:"flex-start",
                justifyContent: (pageW*scale > paneW-48) ? "flex-start" : "center", padding:24}}>
              {previewUrl && (
                <div style={{
                  width: pageW * scale, height: iframeH * scale, flexShrink: 0,
                  overflow: "hidden", background: "transparent", position: "relative",
                }}>
                  <iframe
                    ref={iframeRef}
                    key={previewUrl}
                    src={previewUrl}
                    style={{ width: pageW, height: iframeH, border: "none",
                      transformOrigin: "top left", transform: `scale(${scale})`, display: "block" }}
                    title="PDF Preview"
                  />
                  {/* Overlay captures drag-pan + wheel-zoom ONLY in Pan mode; otherwise it is
                      click-through so the preview's own collapse / column-resize controls work. */}
                  <div ref={overlayRef}
                    style={{position:"absolute",inset:0,zIndex:2,background:"transparent",
                      pointerEvents: panMode ? "auto" : "none", cursor: panMode ? "grab" : "default"}} />
                </div>
              )}
              {!previewUrl && (
                <div style={{color:"#888",fontSize:12,marginTop:60}}>Generating preview…</div>
              )}
            </div>

            {/* Floating controls (B361): page Zoom · time-axis Time stretch · Fit · Pan. */}
            {previewUrl && (
              <div style={{position:"absolute",top:12,right:12,zIndex:30,display:"flex",gap:5,alignItems:"center",
                background:"rgba(20,22,26,0.88)",borderRadius:7,padding:"4px 7px",userSelect:"none",fontFamily:"inherit",
                boxShadow:"0 2px 10px rgba(0,0,0,0.30)"}}>
                <span style={TB_TAG}>Zoom</span>
                <button onClick={()=>zoomTo(previewZoom/1.2)} title="Zoom out — magnify the page less" style={TB_BTN}>−</button>
                <span onClick={fitWidth} title="Reset to fit" style={{color:"#fff",fontSize:10,fontWeight:600,padding:"0 2px",cursor:"pointer",minWidth:30,textAlign:"center"}}>{Math.round(previewZoom*fitScale*100)}%</span>
                <button onClick={()=>zoomTo(previewZoom*1.2)} title="Zoom in — magnify the page more" style={TB_BTN}>+</button>
                {cfg.includeGantt && (<>
                  <span style={TB_DIV} />
                  <span style={TB_TAG}>Time</span>
                  <button onClick={()=>bumpScale(1/1.25)} title="Compress the time axis — fit more months across the chart" style={TB_BTN}>−</button>
                  <button onClick={()=>bumpScale(1.25)} title="Expand the time axis — fewer months, stretched wider" style={TB_BTN}>+</button>
                </>)}
                <span style={TB_DIV} />
                <button onClick={fitWidth} title="Fit the whole timeline & reset zoom" style={TB_LBL}>Fit</button>
                {cfg.includeGantt && (
                  <button onClick={()=>setPanMode(m=>!m)} title={panMode?"Stop panning (re-enable clicking in the preview)":"Pan — drag to slide the visible time window left/right"}
                    style={{...TB_LBL, background: panMode?"var(--amber)":"rgba(255,255,255,0.16)"}}>✋ Pan</button>
                )}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

// harness compatibility — the old classic-script page made every top-level binding a global, and the ui-audit / e2e
// drivers call them by bare name from page.evaluate (GanttView, buildGanttSVG, COLS, showToast, …). Same names, same values.
exposeToHarness({
  EXPORT_PREFS_KEY: [() => EXPORT_PREFS_KEY],
  EXPORT_PERSIST_KEYS: [() => EXPORT_PERSIST_KEYS],
  loadExportPrefs: [() => loadExportPrefs],
  saveExportPrefs: [() => saveExportPrefs],
  PDFExportModal: [() => PDFExportModal],
});
