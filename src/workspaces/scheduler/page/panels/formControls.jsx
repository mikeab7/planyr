import { NO_AUTOFILL } from "../common.jsx";
import { exposeToHarness } from "../harnessGlobals.js";


// ── PDFExportModal ────────────────────────────────────────
// PDFExportModal presentational helpers, hoisted to module scope so React keeps a STABLE
// component identity across renders. Defined inside the modal, each render minted a fresh
// identity, so React unmounted the live <input> and mounted a new one — stealing focus
// after every keystroke in the Header/Cover fields (B3/M4). Props-only (no closure over
// modal state); SHdr deliberately stays inside the modal because it closes over setSecOpen.
export const Toggle = ({on,onChange}) => (
  <span onClick={()=>onChange(!on)} style={{width:28,height:15,borderRadius:8,background:on?"var(--amber)":"var(--bd2)",
    display:"inline-flex",alignItems:"center",cursor:"pointer",flexShrink:0,transition:"background .15s",padding:"0 2px"}}>
    <span style={{width:11,height:11,borderRadius:"50%",background:"var(--bg)",boxShadow:"0 1px 3px rgba(0,0,0,.2)",
      transform:on?"translateX(13px)":"translateX(0)",transition:"transform .15s",flexShrink:0}} />
  </span>
);
export const SegBtn = ({options,value,onChange,small}) => (
  <div style={{display:"flex",border:"1px solid var(--bd2)",borderRadius:4,overflow:"hidden",flexShrink:0}}>
    {options.map(o=>(
      <span key={o.v} onClick={()=>onChange(o.v)} style={{padding:small?"2px 7px":"3px 9px",fontSize:10,cursor:"pointer",whiteSpace:"nowrap",
        background:value===o.v?"var(--amber)":"transparent",color:value===o.v?"#fff":"var(--mut)",
        transition:"background .12s,color .12s",fontWeight:value===o.v?500:400}}>{o.l}</span>
    ))}
  </div>
);
export const Field = ({value,onChange,placeholder}) => (
  <input {...NO_AUTOFILL} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder||""}
    style={{width:"100%",background:"var(--bg)",border:"1px solid var(--bd2)",borderRadius:3,
      padding:"3px 7px",fontSize:11,color:"var(--txt)",fontFamily:"inherit",outline:"none"}}
    onFocus={e=>e.target.style.borderColor="var(--blue)"}
    onBlur={e=>e.target.style.borderColor="var(--bd2)"} />
);
export const Row = ({label,children}) => (
  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"3px 0",gap:8,minHeight:26}}>
    <span style={{fontSize:11,color:"var(--txt)",flexShrink:0}}>{label}</span>
    {children}
  </div>
);

// harness compatibility — the old classic-script page made every top-level binding a global, and the ui-audit / e2e
// drivers call them by bare name from page.evaluate (GanttView, buildGanttSVG, COLS, showToast, …). Same names, same values.
exposeToHarness({
  Toggle: [() => Toggle],
  SegBtn: [() => SegBtn],
  Field: [() => Field],
  Row: [() => Row],
});
