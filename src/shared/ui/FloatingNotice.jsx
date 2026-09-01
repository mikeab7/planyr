/* FloatingNotice — the ONE place that owns position for every floating, app-level notification
 * (NEW-1, B1000400, 2026-09-01, owner report with a screenshot: the "+ Select parcels" guidance
 * box sat oversized at the top-left of the map, covering the aerial and the zoom controls — see
 * docs/DESIGN.md's "Floating notifications" rule this component is the implementation of).
 *
 * Before this, three surfaces each invented their own fixed position for the same job — a top-
 * left stack in MapFinder.jsx, `top:84` pairs in AppHeader.jsx/ProjectBreadcrumb.jsx (at THREE
 * different z-indexes: 5999/6500/9000) — while Toast.jsx already had the right shape (bottom:18,
 * left:50%, translateX(-50%)). This promotes Toast's shape into the shared primitive every
 * floating banner now renders through, so there is exactly one place a future banner can get
 * this wrong.
 *
 * WHAT IT OWNS: position (fixed, bottom-center), stacking (every mounted FloatingNotice is a
 * flex child of ONE shared host, so the browser's own layout — never manual pixel math — keeps
 * simultaneous notices from landing on the same pixels), the max-width clamp, and clearing a
 * mobile bottom sheet (`bottomSheetTracker.js`) rather than sitting under or over it.
 * WHAT IT DOES NOT OWN: visual style. Each caller keeps its own border/background/color/content
 * layout — an amber warning and a blue info notice still read differently; only WHERE they sit
 * is shared.
 *
 * BOUNDARY (docs/DESIGN.md): this is for FLOATING, APP-LEVEL notifications only — something that
 * overlays content to say what happened or how the user can proceed. An inline message that
 * belongs to one panel, row, or form field stays exactly where it is; `role="status"`/`"alert"`
 * is never the test, floating-and-app-level is.
 */
import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useBottomSheetHeight } from "./bottomSheetTracker.js";

// Promoted from Toast.jsx's existing dominant values (docs/DESIGN.md — "promote it, don't invent
// a new one"). NOTICE_Z replaces the 5999/6500/9000 spread with the one z-index every floating
// app-level notice now shares.
export const NOTICE_BOTTOM = 18;
export const NOTICE_GAP = 8;
export const NOTICE_Z = 6500;
export const NOTICE_MAX_WIDTH = "min(560px, calc(100vw - 16px))";

// Pure: how far off the viewport bottom the shared host sits, given the open bottom sheet's
// current height (0 when none is open). Split out so the arithmetic is unit-testable without a
// DOM — see test/floatingNotice.test.js.
export function noticeBottomOffset(sheetHeight) {
  return NOTICE_BOTTOM + (sheetHeight > 0 ? sheetHeight + NOTICE_GAP : 0);
}

let hostEl = null;
function getHost() {
  if (typeof document === "undefined") return null;
  if (hostEl && document.body.contains(hostEl)) return hostEl;
  hostEl = document.createElement("div");
  hostEl.setAttribute("data-floating-notice-host", "1");
  // Static shape, set once: fixed, bottom-center stack, newest-mounted nearest the bottom edge
  // (flex column + justifyContent:"flex-end" packs items against the container's bottom edge in
  // DOM order). `bottom` itself is dynamic (clears an open mobile bottom sheet) and is kept in
  // sync by every mounted FloatingNotice below — idempotent, so any number of callers writing the
  // same computed value is harmless.
  Object.assign(hostEl.style, {
    position: "fixed", left: "50%", transform: "translateX(-50%)", zIndex: String(NOTICE_Z),
    bottom: `${NOTICE_BOTTOM}px`, display: "flex", flexDirection: "column",
    justifyContent: "flex-end", alignItems: "center", gap: `${NOTICE_GAP}px`,
    pointerEvents: "none", maxWidth: "calc(100vw - 16px)",
  });
  document.body.appendChild(hostEl);
  return hostEl;
}

/** One floating, app-level notice. Renders `children` bottom-centered and stacked with any other
 *  mounted FloatingNotice. `testId` becomes the wrapper's `data-testid` (existing testids on the
 *  content itself keep working unchanged — this only wraps them). `pointerEvents` defaults to
 *  `"auto"` (the ordinary case: one filled banner box that should be clickable/dismissible) —
 *  pass `"none"` when the content manages its own per-child pointer-events instead (Toast's own
 *  multi-item stack, where empty space around a narrower item must stay click-through to the map
 *  beneath it). */
export default function FloatingNotice({ children, maxWidth = NOTICE_MAX_WIDTH, testId, pointerEvents = "auto" }) {
  const [host, setHost] = useState(null);
  const sheetHeight = useBottomSheetHeight();
  useLayoutEffect(() => { setHost(getHost()); }, []);
  useLayoutEffect(() => {
    if (!host) return;
    host.style.bottom = `${noticeBottomOffset(sheetHeight)}px`;
  }, [host, sheetHeight]);
  if (!host) return null;
  return createPortal(
    <div data-testid={testId} data-floating-notice="1" style={{ maxWidth, pointerEvents }}>
      {children}
    </div>,
    host,
  );
}
