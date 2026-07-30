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
 * Stale-chunk awareness (B239): the most common way this boundary appears is NOT a
 * code bug but a stale deploy — the tab is holding an old index.html and a lazy
 * workspace chunk it points at was replaced by a newer build (e.g. "Failed to fetch
 * dynamically imported module: …/Scheduler-<hash>.js"). For that case the only thing
 * that helps is reloading to the fresh build, so the PRIMARY action becomes a
 * cache-busting reload (reloadFresh) — "Try again" just re-requests the same dead
 * chunk and fails identically, which is exactly the dead-end users were hitting.
 *
 * PROPORTIONALITY (B1189): a boundary that answers EVERY error with a terminal card is
 * disproportionate for the self-limiting ones. A runaway layout-measurement loop threw React's
 * nested-update circuit breaker and this boundary replaced a working planner — the drawing, the
 * rails, the whole session — with a dead screen, over a transient measurement cycle that a
 * remount clears outright. So a recoverable error (see recoverableError.js) now spends up to two
 * automatic remounts before any card is shown; only if it keeps recurring does the user see one,
 * and the card then says plainly that the plan is saved. LOUD-FAILURE is preserved on BOTH paths:
 * every catch still logs and still reports to telemetry, tagged with whether it auto-recovered,
 * so a silently-retried loop is still visible as data rather than being swallowed.
 */
import { Component } from "react";
import { isChunkLoadError, reloadFresh, arrivedViaFreshReload, clearReloadGuard } from "./chunkReload.js";
import { reportClientError } from "../shared/telemetry/clientErrors.js";
import { planRecovery, isRecoverableRenderError } from "./recoverableError.js";

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
    this.state = { error: null, recovering: false };
    this.autoAttempts = 0;      // automatic remounts spent on the CURRENT incident
    this.lastRecoveryAt = 0;    // when the last one was, so an unrelated later crash starts fresh
    this.recoverTimer = null;
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Decide BEFORE rendering anything: a self-limiting error gets a remount, not a dead end.
    const plan = planRecovery({
      error,
      attempts: this.autoAttempts,
      lastRecoveryAt: this.lastRecoveryAt,
      now: Date.now(),
    });
    const recovering = plan.action === "recover";

    // LOUD-FAILURE: both paths log and both report. Auto-recovery must never make a crash
    // invisible — it changes what the USER sees, not what we record.
    console.error(
      `[workspace error boundary] caught a render crash${recovering ? ` — auto-recovering (attempt ${plan.attempts})` : ""}:`,
      error,
      info && info.componentStack,
    );
    reportClientError(error, {
      source: "react",
      module: this.props.label,
      componentStack: info && info.componentStack,
      recovered: recovering ? plan.attempts : 0,
    });

    if (!recovering) return;
    this.autoAttempts = plan.attempts;
    this.lastRecoveryAt = Date.now();
    this.setState({ recovering: true });
    // Remount on a fresh task, not synchronously: the layout that produced the cycle has to
    // settle (and the browser has to paint) before the subtree is rebuilt, or the remount just
    // re-enters it. The timer is cleared on unmount so a torn-down boundary can't resurrect.
    clearTimeout(this.recoverTimer);
    this.recoverTimer = setTimeout(() => { this.recoverTimer = null; this.setState({ error: null, recovering: false }); }, 0);
  }

  componentWillUnmount() {
    clearTimeout(this.recoverTimer);
    this.recoverTimer = null;
  }

  reset = () => {
    clearTimeout(this.recoverTimer);
    this.recoverTimer = null;
    // A deliberate retry is the user telling us to start over — give the next incident its full
    // automatic budget back rather than making them press this twice.
    this.autoAttempts = 0;
    this.lastRecoveryAt = 0;
    this.setState({ error: null, recovering: false });
  };

  render() {
    const { error, recovering } = this.state;
    if (!error) return this.props.children;

    // Recoverable crash, remount already queued: hold a quiet placeholder for the one frame it
    // takes rather than flashing an error card the user would never get to read. Deliberately
    // NOT the error card's copy — nothing has failed from where they are sitting.
    if (recovering) {
      return (
        <div style={S.wrap} data-testid="boundary-recovering">
          <div style={S.card}><p style={S.body}>Redrawing…</p></div>
        </div>
      );
    }

    // Let a caller supply a custom fallback: fallback(error, reset) => node.
    if (typeof this.props.fallback === "function") return this.props.fallback(error, this.reset);

    const label = this.props.label || "This view";

    // Stale-chunk path: a new build replaced the chunk this tab points at. "Try again"
    // can't fix that (same dead chunk) — only a fresh, cache-busting reload can. Make
    // that the primary, and frame it as an update rather than an error.
    if (isChunkLoadError(error)) {
      // Stuck path (B447): we already arrived via a fresh cache-busting reload and a
      // chunk STILL failed — the fresh build is also missing it (server mid-deploy /
      // edge node skewed). Reloading again just dead-ends, so frame it as "finishing a
      // deploy" and make the escape clear the reload cooldown first so the retry isn't
      // suppressed.
      if (arrivedViaFreshReload()) {
        return (
          <div style={S.wrap}>
            <div style={S.card}>
              <p style={S.title}>Planyr is finishing a deploy</p>
              <p style={S.body}>A new version is still rolling out, so {String(label).toLowerCase()} couldn't load yet. Give it a minute, then try again. Your work is saved.</p>
              <pre style={S.msg}>{String((error && error.message) || error)}</pre>
              <div style={S.row}>
                <button style={S.btn} onClick={() => { clearReloadGuard(); reloadFresh(); }}>Try again</button>
              </div>
            </div>
          </div>
        );
      }
      // First failure: a newer build replaced the chunk this (stale) tab points at. A
      // cache-busting reload picks up the fresh build — make that the primary action.
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

    // A recoverable error that survived its automatic remounts still isn't a data-loss event, and
    // saying so is the difference between "my work is gone" and "this view needs a nudge" (B1189).
    const savedWork = isRecoverableRenderError(error);

    return (
      <div style={S.wrap} data-testid="boundary-error">
        <div style={S.card}>
          <p style={S.title}>{label} hit an error and couldn't load</p>
          <p style={S.body}>
            {savedWork ? "Your plan is saved — this is a display problem, not lost work. " : ""}
            The rest of the app still works — you can switch modules from the menu, or try again. If it keeps happening, reloading usually clears it.
          </p>
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
