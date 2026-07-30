/* LazyPanel — the scaffold every lazily-loaded planner panel mounts behind (B1064 tranche a).
 *
 * WHY A SCAFFOLD RATHER THAN A BARE <Suspense fallback={null}>. Splitting a panel out of the
 * planner chunk introduces two new failure modes that did not exist while the code was
 * statically imported, and both are silent unless something handles them here:
 *
 *  1. LAYOUT SHIFT. A `fallback={null}` renders nothing, so the panel's container collapses to
 *     zero height and then snaps open when the chunk arrives — the content below it jumps.
 *     That is trading bytes for a flash, which is the thing this work is not allowed to do.
 *     So the fallback RESERVES the space: the call site passes the panel's resting height and
 *     the placeholder holds exactly that box until the real panel replaces it.
 *
 *  2. A CHUNK THAT NEVER ARRIVES. A statically-imported panel cannot fail to load; a lazy one
 *     can — most often because a new build was deployed while this tab was open, so the hashed
 *     file it is asking for no longer exists (B221/B239). Left unhandled, the throw escapes to
 *     the WORKSPACE error boundary and takes the whole planner down over one panel. Here it is
 *     contained to the panel, and a stale-chunk failure gets the one action that actually
 *     works: a cache-busting reload to the current build.
 *
 * LOUD-FAILURE applies: neither path is a silent no-op. A failed panel says so where the panel
 * would have been, names the reason, and offers the recovery — it never renders empty and
 * leaves the user to wonder whether the panel has no content or no code.
 *
 * MODULE-SCOPE-COMPONENTS: everything here is defined at module scope. A boundary or fallback
 * defined inside a render body would be a new component type every render, remounting the
 * subtree — which for a Suspense boundary means re-triggering the load it just finished.
 */
import { Component, Suspense } from "react";
import { isChunkLoadError, reloadFresh } from "../../../app/chunkReload.js";
import { reportClientError } from "../../../shared/telemetry/clientErrors.js";

/* Height-reserving placeholder. `minHeight` is the panel's resting height at the call site —
 * pass the real one, because the whole point is that nothing below it moves. */
export function PanelFallback({ minHeight = 96, label = "Loading…" }) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        minHeight,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 11.5,
        fontWeight: 600,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color: "var(--text-tertiary)",
        opacity: 0.85,
      }}
    >
      {label}
    </div>
  );
}

const errStyle = {
  wrap: { padding: "10px 11px", borderRadius: 8, background: "var(--danger-bg)", border: "1px solid var(--danger-border)", color: "var(--danger-text)", fontSize: 12, lineHeight: 1.5 },
  title: { fontWeight: 800, marginBottom: 3 },
  btn: { marginTop: 8, padding: "5px 11px", borderRadius: 7, border: "1px solid var(--danger-border)", background: "transparent", color: "var(--danger-text)", fontFamily: "inherit", fontSize: 11.5, fontWeight: 700, cursor: "pointer" },
};

/* Per-panel error boundary. Deliberately NOT the workspace ErrorBoundary: this one contains
 * the failure to the panel so the canvas, the rail and every other panel keep working. */
export class PanelErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // LOUD-FAILURE — a panel that failed to load is a real event, not a rendering detail.
    reportClientError(error, { where: `lazy-panel:${this.props.name || "unknown"}`, componentStack: info?.componentStack });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const stale = isChunkLoadError(error);
    return (
      <div style={errStyle.wrap}>
        <div style={errStyle.title}>{this.props.name || "This panel"} didn’t load</div>
        <div>
          {stale
            ? "A newer version of Planyr was published while this tab was open, so this panel’s code is no longer on the server. Reloading picks up the current build."
            : "Something went wrong opening this panel. The rest of your plan is unaffected."}
        </div>
        {stale && (
          <button type="button" style={errStyle.btn} onClick={() => reloadFresh()}>Reload to the current version</button>
        )}
      </div>
    );
  }
}

/* The one wrapper a call site uses: error path outside, suspense inside, so a chunk that fails
 * to load is caught by the boundary rather than leaving Suspense waiting forever. */
export default function LazyPanel({ name, minHeight, label, children }) {
  return (
    <PanelErrorBoundary name={name}>
      <Suspense fallback={<PanelFallback minHeight={minHeight} label={label || "Loading…"} />}>
        {children}
      </Suspense>
    </PanelErrorBoundary>
  );
}
