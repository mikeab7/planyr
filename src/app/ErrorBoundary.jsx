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
import { reportClientError, reportClientEvent } from "../shared/telemetry/clientErrors.js";
import { planRecovery, isRecoverableRenderError, crashSubtree, MAX_AUTO_RECOVERIES } from "./recoverableError.js";
import { loopSummary } from "./renderLoopProbe.js";
import { FONT_SIZE, SPACE } from "../shared/ui/designTokens.js";
import { RADIUS } from "../shared/ui/radius.js";

const S = {
  wrap: { height: "100%", display: "grid", placeItems: "center", padding: 24, background: "#efeadf", fontFamily: "system-ui, sans-serif", color: "#2b2620" },
  card: { maxWidth: 560, width: "100%", textAlign: "center" },
  title: { margin: "0 0 6px", fontSize: 16, fontWeight: 800, letterSpacing: "-0.01em" },
  body: { margin: "0 0 14px", fontSize: 13, lineHeight: 1.5, color: "#6b6453" },
  msg: { margin: "0 0 16px", padding: "8px 10px", borderRadius: 8, background: "rgba(0,0,0,0.05)", border: "1px solid rgba(0,0,0,0.08)", fontFamily: "ui-monospace, monospace", fontSize: 12, color: "#8a3b1e", whiteSpace: "pre-wrap", wordBreak: "break-word", textAlign: "left" },
  row: { display: "flex", gap: 8, justifyContent: "center" },
  btn: { padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 700, border: "1px solid #e8590c", background: "#e8590c", color: "#fff" },
  btnGhost: { padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 600, border: "1px solid rgba(0,0,0,0.18)", background: "transparent", color: "#2b2620" },
  /* NEW-3 — the recovered notice. NON-BLOCKING by construction: fixed, `pointerEvents: none`, and
   * rendered BESIDE the children rather than instead of them, so it can never sit between the user
   * and the drawing that just came back. It exists because a silent full remount of the workspace
   * reads as the app randomly reloading itself — which is exactly what the owner reported. */
  /* ⛔ THIS ONE USES THEME TOKENS, and the contrast with everything above it is deliberate rather
   * than inconsistent. The error-card styles are raw hex on purpose — they have to render when the
   * thing that broke might BE the stylesheet or the theme provider. The recovery notice is the
   * opposite case: it appears over a WORKING app, beside live children, so it must match the app's
   * own theme (including dark mode, where a hardcoded near-white pill would be a flashbang) and it
   * follows the house rule in docs/DESIGN.md — components consume tokens, never raw hex. */
  notice: {
    position: "fixed", left: "50%", bottom: SPACE.xl, transform: "translateX(-50%)", zIndex: 2147483000,
    pointerEvents: "none", maxWidth: "min(92vw, 420px)", padding: `${SPACE.sm}px ${SPACE.xl}px`,
    borderRadius: RADIUS.pill,
    background: "var(--surface-raised)", color: "var(--text-primary)",
    border: "1px solid var(--border-default)",
    fontFamily: "inherit",
    fontSize: FONT_SIZE.control, lineHeight: 1.35, textAlign: "center",
  },
};

/* How long the "it recovered" notice stays up, and how long after a remount we wait before calling
 * the recovery a success. The second is not cosmetic: a remount that re-enters the same loop throws
 * again within a frame or two, so a success declared immediately would be a lie on the one case
 * that matters. */
const NOTICE_MS = 6000;
const RECOVERY_SETTLED_MS = 3000;

// NEW-2 — pure, so the module-slug choice is unit-testable without mounting a React tree.
// `moduleId` is the machine slug every other telemetry source reports (Shell.jsx's `w.id`,
// e.g. "site-planner"); `label` is the human-facing crash-card copy ("Site Planyr") and is
// only a fallback here, for a caller that hasn't been updated to pass `moduleId`.
export function crashModuleSlug(props) {
  return (props && (props.moduleId || props.label)) || null;
}

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, recovering: false, recovered: false };
    this.autoAttempts = 0;      // automatic remounts spent on the CURRENT incident
    this.lastRecoveryAt = 0;    // when the last one was, so an unrelated later crash starts fresh
    this.recoverTimer = null;
    this.settleTimer = null;    // NEW-3 — fires only if the remount HELD, which is what makes it a success
    this.noticeTimer = null;
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // A crash arriving before the settle timer fires means the previous remount did NOT hold, so
    // the pending success claim is cancelled rather than allowed to contradict this row.
    clearTimeout(this.settleTimer);
    this.settleTimer = null;
    // Decide BEFORE rendering anything: a self-limiting error gets a remount, not a dead end.
    const plan = planRecovery({
      error,
      attempts: this.autoAttempts,
      lastRecoveryAt: this.lastRecoveryAt,
      now: Date.now(),
    });
    const recovering = plan.action === "recover";
    const stack = (info && info.componentStack) || null;
    const where = crashSubtree(stack);

    // LOUD-FAILURE: both paths log and both report. Auto-recovery must never make a crash
    // invisible — it changes what the USER sees, not what we record.
    console.error(
      `[workspace error boundary] caught a render crash${recovering ? ` — auto-recovering (attempt ${plan.attempts})` : ""}:`,
      error,
      stack,
    );
    reportClientError(error, {
      source: "react",
      module: crashModuleSlug(this.props),
      componentStack: stack,
      recovered: recovering ? plan.attempts : 0,
    });

    /* ⛔ NEW-3 — THE DECISION IS NOW ON THE RECORD, and until this shipped it was not.
     *
     * The boundary has decided "remount quietly" vs "show the dead end" since B1189, under a
     * bounded, time-windowed retry budget — and it wrote down NEITHER. A query over three days of
     * `client_errors` for anything matching recover / boundary / crash / reload returned only
     * chunk-recovery and preload rows: no recovery attempt, no success, no budget exhaustion,
     * anywhere. So the app's single most visible behaviour to a user — the whole workspace blinking
     * and coming back — was invisible to us, and neither the owner nor a session could tell an
     * auto-remount from a browser reload after the fact. That is a LOUD-FAILURE violation at the
     * one place a silent path is most confusing, and it is what he actually reported: "it reloaded
     * itself, with no reason I could see."
     *
     * Each row carries what a diagnosis needs and could not previously get from anywhere:
     *   • `reason`    — the classified crash (the nested-update breaker vs anything else);
     *   • `attempt` / `budgetLeft` — where in the bounded budget this sits, so three rows read as
     *     one escalating incident rather than three unrelated blips;
     *   • `module`    — the ACTIVE ROUTE, the slug every other telemetry source reports;
     *   • `crashedIn` / `component` — the SUBTREE that actually threw, which is a different
     *     question and on 2026-09-19 had a different answer (NEW-2: a header crash filed under
     *     site-planner);
     *   • `loop`      — the render-loop probe's own verdict at the moment of the crash, which names
     *     the effect that was running hot and the dependency feeding it. That is the one field that
     *     turns the next occurrence from an investigation into a read. */
    const evt = {
      reason: isRecoverableRenderError(error) ? "update-depth" : "other",
      attempt: plan.attempts,
      budgetLeft: Math.max(0, MAX_AUTO_RECOVERIES - plan.attempts),
      module: crashModuleSlug(this.props),
      crashedIn: where.crashedIn,
      component: where.component,
      stackHead: where.head,
      loop: loopSummary({ limit: 3 }) || null,
    };

    if (!recovering) {
      reportClientEvent("boundary-budget-exhausted", "render crash shown as the dead-end card", evt);
      return;
    }
    reportClientEvent("boundary-recovery-attempted", "render crash being cleared by a subtree remount", evt);

    this.autoAttempts = plan.attempts;
    this.lastRecoveryAt = Date.now();
    this.setState({ recovering: true });
    // Remount on a fresh task, not synchronously: the layout that produced the cycle has to
    // settle (and the browser has to paint) before the subtree is rebuilt, or the remount just
    // re-enters it. The timer is cleared on unmount so a torn-down boundary can't resurrect.
    clearTimeout(this.recoverTimer);
    this.recoverTimer = setTimeout(() => {
      this.recoverTimer = null;
      this.setState({ error: null, recovering: false, recovered: true });
      // The notice is transient; the RECORD is not.
      clearTimeout(this.noticeTimer);
      this.noticeTimer = setTimeout(() => { this.noticeTimer = null; this.setState({ recovered: false }); }, NOTICE_MS);
      // A success is only a success if it HELD. Re-entering the same loop throws again within a
      // frame or two, and `componentDidCatch` cancels this before it can claim otherwise.
      clearTimeout(this.settleTimer);
      this.settleTimer = setTimeout(() => {
        this.settleTimer = null;
        reportClientEvent("boundary-recovery-succeeded", "subtree remount held — the workspace is back", evt);
      }, RECOVERY_SETTLED_MS);
    }, 0);
  }

  componentWillUnmount() {
    clearTimeout(this.recoverTimer);
    clearTimeout(this.settleTimer);
    clearTimeout(this.noticeTimer);
    this.recoverTimer = null;
    this.settleTimer = null;
    this.noticeTimer = null;
  }

  reset = () => {
    clearTimeout(this.recoverTimer);
    clearTimeout(this.settleTimer);
    clearTimeout(this.noticeTimer);
    this.recoverTimer = null;
    this.settleTimer = null;
    this.noticeTimer = null;
    // A deliberate retry is the user telling us to start over — give the next incident its full
    // automatic budget back rather than making them press this twice.
    this.autoAttempts = 0;
    this.lastRecoveryAt = 0;
    this.setState({ error: null, recovering: false, recovered: false });
  };

  render() {
    const { error, recovering, recovered } = this.state;
    /* NEW-3 — a silent full remount reads as the app reloading itself for no reason, which is
     * exactly what the owner reported. Say so, briefly, without getting in the way: the children
     * render normally and this sits over them, click-through, and clears itself. */
    if (!error) {
      return recovered
        ? (
          <>
            {this.props.children}
            <div style={S.notice} role="status" aria-live="polite" data-testid="boundary-recovered-notice">
              This view redrew itself after a display hiccup. Your work is saved.
            </div>
          </>
        )
        : this.props.children;
    }

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

    /* ⛔ NEW-2 — THE HEADLINE MAY NOT NAME A MODULE IT CANNOT VOUCH FOR, AND MAY NOT SAY "LOAD".
     *
     * `label` is the ACTIVE ROUTE's display name. On 2026-09-19 the crash threw inside the HEADER
     * and the card read "Site Planyr hit an error and couldn't load" — wrong twice over: the
     * planner had loaded fine, and nothing failed to load at all. A render loop is a display
     * failure in whatever subtree tripped it, so the recoverable class gets a headline that is true
     * of every case of it. The route and the real subtree both still go on the RECORD (see
     * `componentDidCatch`) — this is about not telling the owner something false. */
    return (
      <div style={S.wrap} data-testid="boundary-error">
        <div style={S.card}>
          <p style={S.title}>{savedWork ? "Planyr hit a display problem" : `${label} hit an error and couldn't load`}</p>
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
