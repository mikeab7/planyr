import { exposeToHarness } from "../harnessGlobals.js";


// ── ErrorBoundary ─────────────────────────────────────────
// Catches render errors in Gantt/Split view and shows a recovery UI
// instead of a white screen. Without this, any uncaught error in a
// child component tears down the entire React tree.
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error("[planar] View render error:", error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
          gap:12,background:"var(--bg)",padding:32}}>
          <span style={{fontSize:22}}>⚠️</span>
          <span style={{fontSize:14,fontWeight:600,color:"var(--txt)"}}>This view failed to load</span>
          <span style={{fontSize:12,color:"var(--mut)",maxWidth:360,textAlign:"center"}}>
            {String(this.state.error?.message || this.state.error || "Unknown render error")}
          </span>
          <button className="btn" style={{marginTop:8}} onClick={() => this.setState({hasError:false, error:null})}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// harness compatibility — the old classic-script page made every top-level binding a global, and the ui-audit / e2e
// drivers call them by bare name from page.evaluate (GanttView, buildGanttSVG, COLS, showToast, …). Same names, same values.
exposeToHarness({
  ErrorBoundary: [() => ErrorBoundary],
});
