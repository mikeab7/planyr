/* Global help / report control (B842864) — a persistent control fixed bottom-right, mounted in
 * the app SHELL so it renders on every route, including the map screen (`MapFinder.jsx`), where
 * the always-on performance recorder (B842865, `shared/telemetry/perfRecorder.js`) previously had
 * no reachable manual trigger at all — it only existed as a button inside the Site Planner
 * canvas's own zoom stack (SitePlanner.jsx's "◷" button). The owner: "the recorder is only
 * showing up in the site planning module, not at the map screen. So I can't record what's going
 * on." This is the fix — one control, everywhere, with a menu rather than a second floating
 * button (a menu keeps chrome from accumulating one button at a time).
 *
 * Three menu items:
 *   Report a problem   — a short free-text form; shows the exact context before sending.
 *   Something was slow — retroactively snapshots the recorder's ring buffer (the design point of
 *                         the whole recorder: nobody knows a moment will be slow until it already
 *                         was, so this is a "that just happened" button, never a start/stop one).
 *   Help               — a short static blurb; there is no separate help system in this app yet.
 *
 * Placement: fixed bottom-right, clear of Leaflet's zoom/attribution/scale controls (bottom-left /
 * bottom-right respectively — see MapFinder.jsx / mapChromeStack.js) and the Site Planner's own
 * canvas furniture (scale bar + zoom stack, confined to the CANVAS PANE, which is inset from the
 * true viewport edge by the docked tool rail on desktop and stacks the "✎ Tools" FAB at
 * `right:12,bottom:16` on narrow screens).
 *
 * ⛔ B966700 (owner report, 2026-09-05) — THE BOTTOM OFFSET WAS A CONSTANT (292px), SIZED TO
 * CLEAR THE TALLEST THING THAT COULD EVER OCCUPY THIS CORNER, RESERVED ON EVERY ROUTE WHETHER
 * THAT THING WAS THERE OR NOT. Measured on production: byte-identical `bottom:292` on the map
 * root, a schedule route and a project model route — three screens with completely different
 * chrome — which is exactly the tell that a constant, not adaptive layout, was reserving a slot
 * that was almost always empty. At the owner's viewport that put the button 63% of the way up
 * the screen, tucked under "Imagery & layers", nowhere near the corner he asked for. Fixed by
 * measuring the real DOM instead of assuming the worst case is always present — see
 * `shared/ui/cornerClearance.js` for the mechanism and why it can live in the Shell (which must
 * never statically import a lazy workspace's module) without knowing anything about Site
 * Planner internals. Verified live by `ui-audit/verify-help-report-control.mjs`, which also
 * proves a drag starting on/near the control still pans the map (CHROME-NEVER-EATS-A-PRESS:
 * nothing here is a full-viewport pointer-events layer, so a press anywhere outside the
 * control's own small box reaches whatever's underneath, unchanged).
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import AnchoredMenu from "../shared/ui/AnchoredMenu.jsx";
import { MenuItem, menuPanelStyle } from "../shared/ui/controls.jsx";
import { RADIUS } from "../shared/ui/radius.js";
import { FONT_SIZE } from "../shared/ui/designTokens.js";
import { cornerClearanceFromBottom } from "../shared/ui/cornerClearance.js";
import { requestPerfCapture, perfCaptureDelivery, perfRecorderArmed } from "../shared/telemetry/perfRecorderHandle.js";
import { SUPPRESSED_AUTOMATED } from "../shared/telemetry/clientErrors.js";
import { buildReportContext, submitReport, queuedReportCount } from "../shared/reports/reportsStore.js";

const FAB_SIZE = 44;
const FAB_RIGHT = 14;
const Z_FAB = 2000;
const Z_MENU = 2100;
// How often the corner is re-measured. Cheap (a couple of `getBoundingClientRect` reads, no
// subtree DOM watching that would fire on every canvas pan/drag frame) — a MutationObserver
// scoped wide enough to catch every occupant (a Leaflet map mounting async, a route switch, a
// narrow-width breakpoint flip) would also fire on every SVG canvas edit, which is the one thing
// this control must never cost. Correctness matters more than elegance for a background poll
// this cheap; a stale position for at most one tick is invisible, an assumed one is the bug this
// replaces.
const CORNER_POLL_MS = 500;

const DESC_MAX = 4000;

function QuestionIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9.2 9.4a2.8 2.8 0 1 1 4.2 2.4c-.9.55-1.4 1-1.4 2.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="17.2" r="1" fill="currentColor" />
    </svg>
  );
}

const rowStyle = { display: "flex", alignItems: "center", gap: 9 };

export default function HelpReportControl({ user }) {
  const anchorRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState("menu"); // "menu" | "report" | "help"
  const [desc, setDesc] = useState("");
  const [ctx, setCtx] = useState(null);
  const [submitState, setSubmitState] = useState(null); // null | "sending" | "ok" | "queued"
  const [slowNote, setSlowNote] = useState(null);        // null | "sending" | "ok" | "local" | "undelivered" | "fail"
  const [queued, setQueued] = useState(0);
  const [fabBottom, setFabBottom] = useState(FAB_RIGHT);

  useEffect(() => { setQueued(queuedReportCount()); }, [open]);

  useLayoutEffect(() => {
    const measure = () => {
      const next = cornerClearanceFromBottom({ right: FAB_RIGHT, width: FAB_SIZE, base: FAB_RIGHT });
      setFabBottom((prev) => (Math.abs(prev - next) > 0.5 ? next : prev));
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    const id = setInterval(measure, CORNER_POLL_MS);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
      clearInterval(id);
    };
  }, []);

  const closeAll = () => { setOpen(false); setTimeout(() => { setView("menu"); setDesc(""); setSubmitState(null); }, 200); };

  const openReportForm = () => {
    setCtx(buildReportContext());
    setView("report");
  };

  const submitProblem = async () => {
    setSubmitState("sending");
    const context = ctx || buildReportContext();
    const r = await submitReport({ category: "problem", description: desc, userId: user?.id, userEmail: user?.email, context });
    setSubmitState(r.ok ? "ok" : "queued");
    setTimeout(closeAll, 1700);
  };

  const somethingWasSlow = () => {
    const taken = requestPerfCapture("manual");
    if (!taken) {
      setSlowNote("fail");
      submitReport({ category: "slow", userId: user?.id, userEmail: user?.email, context: buildReportContext({ perf: { captureTaken: false } }) });
      setTimeout(() => setSlowNote(null), 3200);
      return;
    }
    setSlowNote("sending");
    Promise.resolve(perfCaptureDelivery()).then((r) => {
      const ok = !!(r && r.ok);
      const local = !ok && r && r.reason === SUPPRESSED_AUTOMATED;
      setSlowNote(ok ? "ok" : local ? "local" : "undelivered");
      submitReport({
        category: "slow", userId: user?.id, userEmail: user?.email,
        context: buildReportContext({ perf: { captureTaken: true, captureDelivered: ok } }),
      });
      setTimeout(() => setSlowNote(null), 3200);
    }, () => {
      setSlowNote("undelivered");
      submitReport({ category: "slow", userId: user?.id, userEmail: user?.email, context: buildReportContext({ perf: { captureTaken: true, captureDelivered: false } }) });
      setTimeout(() => setSlowNote(null), 3200);
    });
  };

  const slowLabel = slowNote === "sending" ? "Recording…"
    : slowNote === "ok" ? "Recorded — thanks"
    : slowNote === "local" ? "Recorded on this device"
    : slowNote === "undelivered" ? "Recorded, couldn't reach the server yet"
    : slowNote === "fail" ? "Couldn't record — try again in a moment"
    : null;

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        data-testid="help-report-fab"
        aria-label="Help and report a problem"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{
          position: "fixed", right: FAB_RIGHT, bottom: fabBottom, zIndex: Z_FAB,
          width: FAB_SIZE, height: FAB_SIZE, borderRadius: RADIUS.pill,
          border: "1px solid var(--border-strong)", background: "var(--surface-raised)",
          color: "var(--text-primary)", display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", padding: 0, font: "inherit", fontSize: FONT_SIZE.control,
        }}
      >
        <QuestionIcon />
        {queued > 0 && (
          <span
            aria-hidden="true"
            style={{
              position: "absolute", top: -2, right: -2, width: 9, height: 9, borderRadius: RADIUS.pill,
              background: "var(--warn-text)", border: "1.5px solid var(--surface-raised)",
            }}
          />
        )}
      </button>

      <AnchoredMenu open={open} onClose={closeAll} anchorRef={anchorRef} placement="above-left" width={280} zIndex={Z_MENU} panelStyle={menuPanelStyle}>
        {view === "menu" && (
          <>
            <MenuItem onClick={openReportForm} style={rowStyle}>Report a problem</MenuItem>
            <MenuItem onClick={somethingWasSlow} style={rowStyle} disabled={!perfRecorderArmed() || slowNote === "sending"}>
              {slowLabel || "Something was slow just now"}
            </MenuItem>
            <MenuItem onClick={() => setView("help")} style={rowStyle}>Help</MenuItem>
            {queued > 0 && (
              <div style={{ padding: "6px 10px 2px", fontSize: FONT_SIZE.label, color: "var(--text-tertiary)" }}>
                {queued} report{queued === 1 ? "" : "s"} waiting to send — they'll go out next time you're online.
              </div>
            )}
          </>
        )}

        {view === "report" && (
          <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 8, width: 264 }}>
            <div style={{ fontSize: FONT_SIZE.control, fontWeight: 700, color: "var(--text-primary)" }}>Report a problem</div>
            <textarea
              autoFocus
              value={desc}
              onChange={(e) => setDesc(e.target.value.slice(0, DESC_MAX))}
              placeholder="What happened? What did you expect instead?"
              rows={4}
              style={{
                resize: "vertical", font: "inherit", fontSize: FONT_SIZE.control, padding: 8,
                border: "1px solid var(--border-default)", borderRadius: RADIUS.sm,
                background: "var(--surface-page)", color: "var(--text-primary)",
              }}
            />
            <details style={{ fontSize: FONT_SIZE.label, color: "var(--text-tertiary)" }}>
              <summary style={{ cursor: "pointer" }}>What will be sent with this</summary>
              <div style={{ marginTop: 4, lineHeight: 1.5 }}>
                Screen: {ctx?.route || "—"} · Build: {ctx?.build || "—"} · Window: {ctx?.viewportW || "—"}×{ctx?.viewportH || "—"}
                <br />
                {user ? `Signed in as ${user.email || "you"}` : "Signed out — no account is attached"}
                <br />
                Nothing from your drawing (no shapes, addresses, or names) — only this screen, the app version, and your window size.
              </div>
            </details>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setView("menu")} style={{ border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-secondary)", borderRadius: RADIUS.sm, padding: "5px 10px", fontSize: 12, cursor: "pointer", font: "inherit" }}>Back</button>
              <button
                type="button"
                onClick={submitProblem}
                disabled={!desc.trim() || submitState === "sending"}
                style={{
                  border: "1px solid var(--accent)", background: "var(--accent)", color: "var(--on-accent)",
                  borderRadius: RADIUS.sm, padding: "5px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer",
                  font: "inherit", opacity: (!desc.trim() || submitState === "sending") ? 0.5 : 1,
                }}
              >
                {submitState === "sending" ? "Sending…" : submitState === "ok" ? "Sent ✓" : submitState === "queued" ? "Saved — will send" : "Send"}
              </button>
            </div>
          </div>
        )}

        {view === "help" && (
          <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8, width: 264, fontSize: FONT_SIZE.control, color: "var(--text-secondary)", lineHeight: 1.5 }}>
            <div style={{ fontSize: FONT_SIZE.control, fontWeight: 700, color: "var(--text-primary)" }}>Help</div>
            <p style={{ margin: 0 }}>
              Something confusing or not working the way you expect? Use "Report a problem" — it
              comes straight to Michael, with just enough context (this screen, the app version,
              your window size) to track down.
            </p>
            <p style={{ margin: 0 }}>
              If something felt slow, "Something was slow just now" saves the last few seconds so
              it can be looked into — even signed out.
            </p>
            <button type="button" onClick={() => setView("menu")} style={{ alignSelf: "flex-end", border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-secondary)", borderRadius: RADIUS.sm, padding: "5px 10px", fontSize: 12, cursor: "pointer", font: "inherit" }}>Back</button>
          </div>
        )}
      </AnchoredMenu>
    </>
  );
}
