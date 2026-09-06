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
 *
 * ⛔ B1176480 (owner report, 2026-09-05) — THE CORNER-MEASUREMENT FIX ABOVE STILL LEFT THE
 * CONTROL UNUSABLE ON AN IPHONE-CLASS SCREEN: nothing added the safe-area (the notch/dynamic-
 * island/home-indicator no-go strip, set via CSS `env()`) to either offset, so on a real device
 * the button can render partly under the home indicator / off the rounded corner. Every OTHER
 * safe-area consumer in this app (Food's `BottomSheet.jsx`, the Site Planner's phone FABs,
 * B1168128) writes `env(safe-area-inset-bottom)` straight into a CSS string, which is the right,
 * simpler answer when the offset is a fixed literal — but this control's offset is DYNAMIC
 * (`cornerClearanceFromBottom` measures real occupants and this button must clear whichever
 * needs the most room), and that occupant-overlap math runs in JS against `window.innerWidth`.
 * A CSS-only `calc()` would position the button correctly but leave the overlap math blind to
 * the inset — in LANDSCAPE, where `safe-area-inset-right` is genuinely non-zero (the notch
 * rotates to a side edge), the column this button occupies would be computed as if it were
 * flush against the true edge when it is actually shifted in — so the inset has to reach JS as a
 * number (`shared/ui/safeAreaInsets.js`), not stay CSS-only; see that file's own header for the
 * full reasoning. `index.html`'s viewport meta already carries `viewport-fit=cover` (confirmed,
 * not assumed — without it every `env()` call below resolves to 0 and this fix is inert), and it
 * predates this control, so no change was needed there. Re-measures on `resize`,
 * `orientationchange`, `visualViewport` `resize`/`scroll` (iOS Safari's collapsing bottom
 * toolbar changes the visual viewport without firing a plain `resize`) and the existing
 * `CORNER_POLL_MS` poll. The popover itself (`AnchoredMenu` / `placeMenu`) already clamps into
 * the viewport with an 8px margin on every side — verified, not re-built, to still fit with zero
 * overflow at 320/375/390/430 CSS px in `ui-audit/verify-help-report-control.mjs`'s new PART F.
 * ⛔ THIS SANDBOX HAS NO WEBKIT (standing gap, `VERIFICATION.md` → Self-verification, B1168128) —
 * every check here that isn't real Playwright/WebKit is a Chromium claim under a real iPhone
 * device descriptor, and neither engine's headless mode can render `env(safe-area-inset-*)` as
 * anything but 0 (no physical notch to inset around) — PART F's safe-area assertions run against
 * a SIMULATED override (a CSS rule forcing the probe element's padding), never real device
 * evidence. See that file's own header comment for the full three-tier breakdown.
 *
 * ⛔ B1176976 (owner report, 2026-09-05) — THE FAB SHIPPED AS RADIUS.pill (999, a full circle at
 * this 44×44 size); docs/DESIGN.md's shape rule (B942176) reserves `pill` for a CONTAINER that
 * holds several sub-controls — a segmented shell, the account chip, a toggle bar whose height IS
 * its shape — never a standalone action button's own resting shape, which is `RADIUS.md`
 * regardless of the button's own aspect ratio. Measured on the deployed build (after PR 1439):
 * this was the only circular chrome control on the map landing page (the one other >=90px-radius
 * element, the 20×20 account avatar "M", is a legitimately round BADGE, not a control). Fixed to
 * `RADIUS.md` — the button keeps its 44×44 hit area and its popover anchoring, only its own
 * corner curve changes. `design-drift-audit.mjs` never caught this because `999` is a legal value
 * on the RADIUS scale, just the wrong step for this role — `nestingMismatches()`/
 * `siblingMismatches()` couldn't either, because this control has no rounded containing ancestor
 * and no rounded row-peer (it renders fixed, alone, outside every workspace's own chrome tree) —
 * see `ui-audit/lib/controlKind.mjs` (NEW-2, the mechanism that now catches exactly this).
 *
 * ⛔ B1231280 (owner chat block, 2026-09-06, "NEW-1") — THE CAPTURE IS NOW TAKEN AT THE FIRST
 * PRESS THAT OPENS THIS CONTROL, NOT AT SUBMIT. Owner, verbatim: "the question mark should record
 * the moments before by default and submit it with the ticket. Like, as soon as you even click on
 * it. Just always catch it in time." `armCapture()` runs from the SAME `onClick` that flips `open`
 * true — the earliest point compatible with a keyboard Enter/Space activation too (PART C of
 * `verify-help-report-control.mjs` opens this control by keyboard, so the arm point cannot be a
 * mouse-only `pointerdown`) — and freezes `cap` (armed / taken / the delivery promise) for the
 * WHOLE time the panel stays open. Both "Report a problem" and "Something was slow just now" read
 * that ONE frozen `cap`; neither takes a second capture. This is why `perfCaptureDelivery()` is
 * called exactly once per opening, in `armCapture`, not once per action — reusing the same
 * `requestPerfCapture`/`perfCaptureDelivery` bind seam `perfRecorderHandle.js` already exposes,
 * never a second capture path. Acceptance test: `verify-help-report-control.mjs` PART D asserts
 * `pfRec.state().sent` increments on the OPEN click and does NOT increment again on the
 * "Something was slow" click that follows it.
 * Three honest states, carried into `context.perf` on EVERY submission (LOUD-FAILURE — an
 * un-armed recorder or an empty ring must never look like a silently-attached capture):
 * `captureArmed:false` (the recorder hasn't installed on this page yet — main.jsx defers it to an
 * idle callback on every route, so a press in the first few seconds after load can race it) ·
 * `captureArmed:true, captureTaken:false` (armed but this press's budget/allowlist refused it) ·
 * `captureTaken:true, captureDelivered:<bool>` (taken; delivered or not). An empty ring (no
 * interaction happened before the press) is NOT a fourth case here — `requestPerfCapture` still
 * returns `taken:true` for it and the capture itself carries `note:"no-frames"`
 * (`perfCapture.js`), which is the honest "nothing was happening" answer, not a failure to record.
 *
 * ⛔ B1231281 ("NEW-2") — THE PLANNER'S OWN "◷" ZOOM-STACK BUTTON IS GONE; this menu's "Something
 * was slow just now" row is the only door now (`SitePlanner.jsx`'s own header note on its removal
 * has the geometry side of this). Traded one press for two (open the control, then this row) —
 * flagged rather than hidden, because the owner explicitly asked not to make a fast signal slower
 * without saying so. Two things that keep it close to as fast as it was: the capture is already
 * taken (and usually already delivered) from the first press by the time this row is reachable, so
 * the second press adds no capture latency, only one more tap; and the row is the FIRST thing on
 * screen after opening — no typing, no scrolling — so filing a pure performance report is still
 * "open, then one more tap," never "open, navigate, then tap."
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import AnchoredMenu from "../shared/ui/AnchoredMenu.jsx";
import { MenuItem } from "../shared/ui/controls.jsx";
import { RADIUS } from "../shared/ui/radius.js";
import { FONT_SIZE } from "../shared/ui/designTokens.js";
import { cornerClearanceFromBottom } from "../shared/ui/cornerClearance.js";
import { safeAreaInsets } from "../shared/ui/safeAreaInsets.js";
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
  // NEW-1 (B1231280) — the capture FROZEN at the press that opened the panel. null until then.
  // { armed: bool, taken: bool, deliveryPromise: Promise|null }. Never re-armed until the next open.
  const [cap, setCap] = useState(null);
  const [fabRight, setFabRight] = useState(FAB_RIGHT);
  const [fabBottom, setFabBottom] = useState(FAB_RIGHT);

  useEffect(() => { setQueued(queuedReportCount()); }, [open]);

  useLayoutEffect(() => {
    const measure = () => {
      // Fold the real safe-area inset into the offsets BEFORE the occupant-overlap math runs
      // (never a CSS-only calc() — see this file's B1176480 header note for why the overlap
      // check needs the inset as a number).
      const insets = safeAreaInsets();
      const right = FAB_RIGHT + insets.right;
      const bottom = cornerClearanceFromBottom({ right, width: FAB_SIZE, base: FAB_RIGHT + insets.bottom });
      setFabRight((prev) => (Math.abs(prev - right) > 0.5 ? right : prev));
      setFabBottom((prev) => (Math.abs(prev - bottom) > 0.5 ? bottom : prev));
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    // iOS Safari's collapsing bottom toolbar changes the VISUAL viewport (what's actually on
    // screen) without firing a plain `resize` on `window` — the layout viewport is unchanged.
    const vv = window.visualViewport;
    vv?.addEventListener("resize", measure);
    vv?.addEventListener("scroll", measure);
    const id = setInterval(measure, CORNER_POLL_MS);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
      vv?.removeEventListener("resize", measure);
      vv?.removeEventListener("scroll", measure);
      clearInterval(id);
    };
  }, []);

  const closeAll = () => { setOpen(false); setTimeout(() => { setView("menu"); setDesc(""); setSubmitState(null); setCap(null); }, 200); };

  /* NEW-1 (B1231280) — THE ONE PLACE `requestPerfCapture`/`perfCaptureDelivery` ARE CALLED. Runs
   * once, from the click that OPENS the panel (see `toggleOpen` below) — never again until the
   * next opening. Every action taken while the panel is open reads this frozen `cap`, so whatever
   * he writes or picks afterwards is attached to the moment he reacted to, not the moment he
   * finished acting on it. */
  const armCapture = () => {
    if (!perfRecorderArmed()) { setCap({ armed: false, taken: false, deliveryPromise: null }); return; }
    const taken = requestPerfCapture("manual");
    setCap({ armed: true, taken, deliveryPromise: taken ? Promise.resolve(perfCaptureDelivery()) : null });
  };

  const toggleOpen = () => {
    const opening = !open;
    setOpen(opening);
    if (opening) armCapture();
  };

  /* The same frozen `cap`, resolved into the flat shape every submission attaches under
   * `context.perf` — LOUD-FAILURE: an un-armed recorder or a refused capture must read as exactly
   * that, never as a silently-omitted or silently-empty attachment. */
  const perfOutcome = async () => {
    if (!cap || !cap.armed) return { captureArmed: false };
    if (!cap.taken) return { captureArmed: true, captureTaken: false };
    try {
      const r = await cap.deliveryPromise;
      return { captureTaken: true, captureDelivered: !!(r && r.ok) };
    } catch (_) { return { captureTaken: true, captureDelivered: false }; }
  };

  const openReportForm = () => {
    setCtx(buildReportContext());
    setView("report");
  };

  const submitProblem = async () => {
    setSubmitState("sending");
    const perf = await perfOutcome();
    const context = { ...(ctx || buildReportContext()), ...perf };
    const r = await submitReport({ category: "problem", description: desc, userId: user?.id, userEmail: user?.email, context });
    setSubmitState(r.ok ? "ok" : "queued");
    setTimeout(closeAll, 1700);
  };

  const somethingWasSlow = () => {
    if (!cap || !cap.armed) {
      setSlowNote("fail");
      submitReport({ category: "slow", userId: user?.id, userEmail: user?.email, context: buildReportContext({ perf: { captureArmed: false } }) });
      setTimeout(() => setSlowNote(null), 3200);
      return;
    }
    if (!cap.taken) {
      setSlowNote("fail");
      submitReport({ category: "slow", userId: user?.id, userEmail: user?.email, context: buildReportContext({ perf: { captureArmed: true, captureTaken: false } }) });
      setTimeout(() => setSlowNote(null), 3200);
      return;
    }
    setSlowNote("sending");
    Promise.resolve(cap.deliveryPromise).then((r) => {
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
        onClick={toggleOpen}
        style={{
          position: "fixed", right: fabRight, bottom: fabBottom, zIndex: Z_FAB,
          width: FAB_SIZE, height: FAB_SIZE, borderRadius: RADIUS.md,
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

      <AnchoredMenu open={open} onClose={closeAll} anchorRef={anchorRef} placement="above-left" width={280} zIndex={Z_MENU}>
        {view === "menu" && (
          <>
            <MenuItem onClick={openReportForm} style={rowStyle}>Report a problem</MenuItem>
            <MenuItem
              data-testid="report-slow"
              data-slow-note={slowNote || ""}
              onClick={somethingWasSlow}
              style={{
                ...rowStyle,
                color: (slowNote === "ok" || slowNote === "local") ? "var(--accent)"
                  : (slowNote === "fail" || slowNote === "undelivered") ? "var(--warn-text)"
                  : undefined,
              }}
              disabled={!(cap && cap.armed) || slowNote === "sending"}
            >
              {slowLabel || "Something was slow just now"}
            </MenuItem>
            <MenuItem onClick={() => setView("help")} style={rowStyle}>Help</MenuItem>
            {/* NEW-1 (B1231280) — an un-armed recorder must say so plainly, not just grey the row
                out with no explanation (LOUD-FAILURE). Races the idle-deferred install every route
                runs on load; resolves itself within a few seconds without a reopen. */}
            {cap && !cap.armed && (
              <div style={{ padding: "6px 10px 2px", fontSize: FONT_SIZE.label, color: "var(--text-tertiary)" }}>
                Performance recording hasn't started on this device yet — try again in a few seconds.
              </div>
            )}
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
                {cap && cap.armed
                  ? "Also included: a few seconds of recent app performance, from just before you opened this."
                  : "Performance recording hasn't started on this device yet — none will be attached this time."}
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
              The moment you opened this, the app quietly saved the last few seconds of its own
              performance — even signed out. "Something was slow just now" sends that along by
              itself, no typing needed; it's attached to "Report a problem" too, automatically.
            </p>
            <button type="button" onClick={() => setView("menu")} style={{ alignSelf: "flex-end", border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-secondary)", borderRadius: RADIUS.sm, padding: "5px 10px", fontSize: 12, cursor: "pointer", font: "inherit" }}>Back</button>
          </div>
        )}
      </AnchoredMenu>
    </>
  );
}
