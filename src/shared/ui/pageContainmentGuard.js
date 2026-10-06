/* pageContainmentGuard — B1168128 (×2): the owner reported panning WITHIN the map on iPhone
 * Safari instead drags the WHOLE PAGE — the app slides off to the side, bare page background
 * shows at the edges, and fixed chrome (the device status bar row, the module tab row) ends up
 * overlapping. index.css now pins `html, body` (`position: fixed; inset: 0`) so there is no
 * top-level document scroller left for a stray touch to hand a gesture to, which is the known
 * containment fix for this class of iOS Safari behaviour — but it can't be PROVEN from this
 * sandbox: four earlier investigation passes (real touch emulation in Chromium, and in a real
 * Linux WebKit build) never reproduced the owner's literal symptom, because it is Apple-WebKit-
 * specific gesture handling no browser available here implements.
 *
 * STANDING RULE #2 in /CLAUDE.md gives three admissible dispositions for an owner-reported
 * symptom that a null cannot close: reproduce-and-fix, ask-and-take-his-answer, or INSTRUMENT IT
 * SO IT CAPTURES ITSELF WHEN HE HITS IT. This is the third, same shape as `clickDiag.js`: a
 * silent, always-on watcher that self-heals AND reports the instant the page is ever actually
 * dragged off its pin — on his real phone, not a synthetic one — so a recurrence produces a
 * durable server-side record instead of relying on him noticing and describing it again.
 *
 * MECHANISM: `html`/`body` are pinned, so `window.scrollX/scrollY` must always read (0, 0); a
 * `scroll` event with either nonzero is therefore the whole-page-drag defect happening live. A
 * `visualViewport` `resize`/`scroll` event with `scale` drifted away from 1 (the meta viewport's
 * intended scale) is the other shape the same class could take — a native pinch/zoom the app's
 * own gesture-suppression (index.html's `gesturestart`/`gesturechange`/`gestureend` handler)
 * failed to catch, after which an ordinary one-finger drag genuinely pans the now-zoomed page.
 * Both are watched because either would look, to the owner, like "the map pans the whole page."
 *
 * Read-only otherwise: never writes app state, changes no drawing behaviour, never throws into
 * the app. The only DOM writes it makes are the two self-heals described below.
 */

import { layoutViewportHeight } from "./layoutViewport.js";

const SCROLL_EPS = 0; // html/body are pinned — ANY nonzero scroll offset is already the defect
const SCALE_EPS = 0.01; // visualViewport.scale drift tolerance (float rounding only)

const KEYBOARD_MIN_SHRINK = 100; // visualViewport shorter than the layout viewport by more than this = keyboard

/** PURE — is a document scroll explained by the soft keyboard? See `detectDrift`. */
export function keyboardDrivenScroll({ focusedEditable = false, layoutHeight = 0, vvHeight = 0, scaleDrift = false } = {}) {
  if (focusedEditable) return true;
  return !scaleDrift && vvHeight > 0 && layoutHeight > 0 && layoutHeight - vvHeight > KEYBOARD_MIN_SHRINK;
}

/** PURE — given a window's current scroll + visualViewport reading, decide whether containment
 * has drifted and, if so, describe it. Node-testable (no DOM writes). */
export function detectDrift({ scrollX = 0, scrollY = 0, scale = 1, focusedEditable = false, layoutHeight = 0, vvHeight = 0 } = {}) {
  const scaleDrift = Math.abs(scale - 1) > SCALE_EPS;
  /* ⛔ NEW-1 (2026-10-05): iOS Safari lifts a focused field above the soft keyboard BY SCROLLING THE
   * DOCUMENT, even with a `position: fixed` body — so a scroll while the keyboard is the reason for
   * it is Safari's own keyboard avoidance, never the stray-drag defect. Healing it (scrollTo(0,0))
   * made the page jump up and snap back down with the field under the keyboard, app-wide; 49
   * production `client_errors` rows (scrollY 100–350, scale 1, on #/site #/food #/notes #/admin) are
   * the keyboard, not the drag. Keyboard-driven = an editable is focused, OR the visual viewport is
   * markedly shorter than the layout viewport at scale 1 (a pinch also shrinks it — that is the
   * scale branch's business, not a keyboard). Either is enough. */
  const keyboardDriven = keyboardDrivenScroll({ focusedEditable, layoutHeight, vvHeight, scaleDrift });
  const scrollDrift = !keyboardDriven && (Math.abs(scrollX) > SCROLL_EPS || Math.abs(scrollY) > SCROLL_EPS);
  if (!scrollDrift && !scaleDrift) return null;
  return {
    kind: "page-containment-drift",
    message: scrollDrift && scaleDrift
      ? `document scrolled (${scrollX}, ${scrollY}) and viewport scale drifted to ${scale}`
      : scrollDrift
        ? `document scrolled to (${scrollX}, ${scrollY}) — html/body are pinned, this should be impossible`
        : `viewport scale drifted to ${scale} — the meta viewport should hold it at 1`,
    extra: { scrollX, scrollY, scale, scrollDrift, scaleDrift },
  };
}

/** Is the soft keyboard (probably) up in `win`? An editable element is focused and the visual
 *  viewport is markedly shorter than the layout viewport. */
export function keyboardUp(win) {
  try {
    const vv = win.visualViewport;
    const a = win.document && win.document.activeElement;
    const editable = !!(a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)));
    // B2046224 ×3: measured layout height, not innerHeight — on iOS innerHeight can shrink with the
    // keyboard, which made this read "no keyboard" during the owner's own Food test (21:10 UTC row).
    return !!vv && editable && (layoutViewportHeight(win) - vv.height - (vv.offsetTop || 0)) > 120;
  } catch (_) { return false; }
}

function focusedEditable(win) {
  try {
    const a = win.document && win.document.activeElement;
    return !!(a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)));
  } catch (_) { return false; }
}

function readState(win) {
  const vv = win.visualViewport;
  let layoutHeight = 0;
  try { layoutHeight = layoutViewportHeight(win); } catch (_) { /* no DOM */ }
  return {
    scrollX: win.scrollX || 0, scrollY: win.scrollY || 0, scale: vv ? vv.scale : 1,
    focusedEditable: focusedEditable(win), layoutHeight, vvHeight: vv ? (vv.height || 0) : 0,
  };
}

/* Force Safari to recompute and reset its own zoom level: toggling the viewport meta's
 * `content` value is a long-documented trick (there is no direct "set zoom" API) — Safari
 * re-reads the tag and snaps `visualViewport.scale` back to what it declares. A no-op on a
 * browser that never drifted (the content is put back byte-for-byte). */
function resetViewportScale(doc) {
  try {
    const meta = doc.querySelector('meta[name="viewport"]');
    if (!meta) return;
    const original = meta.getAttribute("content");
    meta.setAttribute("content", original + ",user-scalable=no");
    meta.setAttribute("content", original);
  } catch (_) { /* best-effort only */ }
}

/** Install the watcher. Idempotent (a second call on the same `win` is a no-op). Returns an
 * uninstall function. `reporter` is injectable for the DOM-driven verification harness. */
export function installPageContainmentGuard(win = typeof window === "undefined" ? undefined : window, reporter) {
  if (!win || !win.document) return () => {};
  if (win.__PLANYR_PAGE_CONTAINMENT_GUARD_INSTALLED) return () => {};
  win.__PLANYR_PAGE_CONTAINMENT_GUARD_INSTALLED = true;
  const doc = win.document;
  let lastReportAt = 0;
  const REPORT_THROTTLE_MS = 5000; // a stuck/repeating drift reports at most once per 5s

  const report = (kind, message, extra) => {
    try {
      if (reporter) { reporter(kind, message, extra); return; }
      import("../telemetry/clientErrors.js").then((m) => m.reportClientEvent(kind, message, extra)).catch(() => {});
    } catch (_) { /* telemetry must never throw into the app */ }
  };

  const check = () => {
    try {
      const state = readState(win);
      const found = detectDrift(state);
      if (!found) {
        /* Keyboard-driven scroll: leave it exactly where Safari put it, report nothing. Announce it
         * so the Notes canvas / phoneTyping can re-check the caret (they also listen to the
         * visualViewport themselves — this is only a nudge). */
        if ((win.scrollX || win.scrollY) && keyboardDrivenScroll({ ...state, scaleDrift: false })) {
          try { win.dispatchEvent(new Event("planyr:viewport-healed")); } catch (_) { /* best-effort */ }
        }
        return;
      }
      // Self-heal first — the fix matters more than the report, and healing before reporting
      // means the extra carries what was OBSERVED, not a value already corrected out from under it.
      if (found.extra.scrollDrift) win.scrollTo(0, 0);
      if (found.extra.scaleDrift) resetViewportScale(doc);
      const now = Date.now();
      if (now - lastReportAt < REPORT_THROTTLE_MS) return;
      lastReportAt = now;
      report(found.kind, found.message, { ...found.extra, url: win.location ? win.location.hash : "" });
    } catch (_) { /* never throw into the app */ }
  };

  win.addEventListener("scroll", check, { passive: true });
  if (win.visualViewport) {
    win.visualViewport.addEventListener("resize", check);
    win.visualViewport.addEventListener("scroll", check);
  }

  return () => {
    win.removeEventListener("scroll", check, { passive: true });
    if (win.visualViewport) {
      win.visualViewport.removeEventListener("resize", check);
      win.visualViewport.removeEventListener("scroll", check);
    }
    win.__PLANYR_PAGE_CONTAINMENT_GUARD_INSTALLED = false;
  };
}
