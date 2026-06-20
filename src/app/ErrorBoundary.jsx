/* React error boundary — a safety net around a workspace subtree.
 *
 * A render/lifecycle throw anywhere below this component (e.g. a dangling
 * reference like the cfgOf scope bug) is caught here and shown as a legible
 * fallback INSTEAD of unmounting the whole React tree to a blank white page.
 * Wrap each lazy workspace so a crash in one is contained: the shell, the
 * workspace switcher, and the other workspace keep working.
 *
 * Must be a class component — React has no hook equivalent for error boundaries.
 *
 * Stale-chunk awareness (B237): the most common way this boundary appears is NOT a
 * code bug but a stale deploy — the tab is holding an old index.html and a lazy
 * workspace chunk it points at was replaced by a newer build (e.g. "Failed to fetch
 * dynamically imported module: …/Scheduler-<hash>.js"). For that case the only thing
 * that helps is reloading to the fresh build, so the PRIMARY action becomes a
 * cache-busting reload (reloadFresh) — "Try again" just re-requests the same dead
 * chunk and fails identically, which is exactly the dead-end users were hitting.
 */
import { Component } from "react";
import { isChunkLoadError, reloadFresh } from "./chunkReload.js";

const S = {
  wrap: { height: "100%", display: "grid", placeItems: "center", padding: 24, background: "#efeadf", fontFamily: "system-ui, sans-serif", color: "#2b2620" },
  card: { maxWidth: 560, width: "100%", textAlign: "center" },
  title: { margin: "0 0 6px", fontSize: 16, fontWeight: 800, letterSpacing: "-0.01em" },
  body: { margin: "0 0 14px", fontSize: 13, lineHeight: 1.5, color: "#6b6453" },
  msg: { margin: "0 0 16px", padding: "8px 10px", borderRadius: 8, background: "rgba(0,0,0,0.05)", border: "1px solid rgba(0,0,0,0.08)", fontFamily: "ui-monospace, monospace", fontSize: 12, color: "#8a3b1e", whiteSpace: "pre-wrap", wordBreak: "break-word", textAlign: "left" },
  row: { display: "flex", gap: 8, justifyContent: "center" },
  btn: { padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 700, border: "1px solid #e8590c", background: "#e8590c", color: "#fff" },
  btnGhost: { padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 600, border: "1px solid rgba(0,0,0,0.18)", background: "transparent", color: "#2b2620" },
};

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Surface for diagnosis; the visible fallback already tells the user what to do.
    console.error("[workspace error boundary] caught a render crash:", error, info && info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    // Let a caller supply a custom fallback: fallback(error, reset) => node.
    if (typeof this.props.fallback === "function") return this.props.fallback(error, this.reset);

    const label = this.props.label || "This view";

    // Stale-chunk path: a new build replaced the chunk this tab points at. "Try again"
    // can't fix that (same dead chunk) — only a fresh, cache-busting reload can. Make
    // that the primary, and frame it as an update rather than an error.
    if (isChunkLoadError(error)) {
      return (
        <div style={S.wrap}>
          <div style={S.card}>
            <p style={S.title}>A new version of Planyr is ready</p>
            <p style={S.body}>{label} couldn't load because Planyr was just updated in the background. Reload to get the latest version — your work is saved.</p>
            <pre style={S.msg}>{String((error && error.message) || error)}</pre>
            <div style={S.row}>
              <button style={S.btn} onClick={() => reloadFresh()}>Reload to update</button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div style={S.wrap}>
        <div style={S.card}>
          <p style={S.title}>{label} hit an error and couldn't load</p>
          <p style={S.body}>The rest of the app still works — you can switch modules from the menu, or try again. If it keeps happening, reloading usually clears it.</p>
          <pre style={S.msg}>{String((error && error.message) || error)}</pre>
          <div style={S.row}>
            <button style={S.btn} onClick={this.reset}>Try again</button>
            <button style={S.btnGhost} onClick={() => reloadFresh()}>Reload page</button>
          </div>
        </div>
      </div>
    );
  }
}
