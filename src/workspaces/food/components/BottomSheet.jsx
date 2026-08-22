/* BottomSheet — the mobile container for the place detail panel (NEW-2, owner: "Bottom sheet,
 * not a side drawer. Map stays visible above it." — replacing the old ~78%-width right-hand
 * drawer that buried the map behind a sliver and ran floor-to-ceiling with roughly half the
 * screen blank under the content).
 *
 * A generic drag-to-resize primitive, deliberately content-agnostic: it knows nothing about
 * place detail, ratings, or visits — it just owns three snap heights (peek/half/full), a drag
 * handle, dismiss-on-drag-below-peek, and the safe-area inset. `peekHeight` is measured by the
 * CALLER (VisitPanel measures its own header+score-strip block) and handed in as a number — this
 * file only turns numbers into pixels and gestures, it never inspects its own children's DOM
 * shape to guess where "peek" should end.
 *
 * ⛔ WHY EVERY SNAP IS AN EXPLICIT PIXEL HEIGHT, NEVER `height: auto` (NEW-2: "The sheet's height
 * at the peek and half snaps is driven by its content. No empty white below the content, ever").
 * `height: auto` can't be CSS-transitioned, so a drag-release or a snap change would have to jump
 * instead of animate. Instead, every snap's height is COMPUTED from the content's real
 * `scrollHeight` (via `heightForSnap`, lib/bottomSheetSnap.js) each time it might have changed —
 * on mount, on a snap change, and on a ResizeObserver firing for the content itself (so opening
 * the visit form, which grows the content, re-measures and re-animates to the new content-driven
 * height without the caller doing anything) — and that computed px value is what actually
 * transitions. The peek/half/full labels are never fixed pixel constants; they're always
 * `min(realContentHeight, band cap)`.
 *
 * ⛔ WHY DRAG IS SCOPED TO THE HANDLE, NOT THE WHOLE SHEET BODY. "Swipe must not fight the map's
 * own pan gesture - the sheet owns vertical drag when the touch starts on the sheet" is about the
 * SHEET vs the MAP: because the sheet is a normal top-of-stack DOM element covering only its own
 * bottom slice of the screen (no full-viewport backdrop), a touch that starts on it is delivered
 * to the sheet, never to the map underneath, by ordinary DOM hit-testing — so that property holds
 * for free, everywhere in the sheet, with no extra plumbing. Scoping the RESIZE gesture itself to
 * the handle (not the scrollable content list) is a separate, standard bottom-sheet convention
 * (Apple/Google Maps do the same): drag the handle to resize, scroll the list to scroll it —
 * letting the whole body drag-to-resize would make the visit list unscrollable.
 *
 * ⛔ WHY THE MOUNT ANIMATION NEEDS TWO ANIMATION FRAMES, NOT ONE. The sheet must SLIDE UP on open,
 * not appear already full-height. That needs three things to happen in order, each only true
 * once the previous one has actually painted: (1) render at height 0 with transitions OFF (so
 * nothing flashes), (2) turn transitions ON, (3) THEN set the real target height so the browser
 * has something to animate FROM — collapsing (2) and (3) into the same tick means the height
 * change and the transition-enabling land in the same style recalculation and the browser skips
 * the animation entirely (nothing to interpolate from, as far as it can tell). `didMountRef`
 * guards the snap-settle and ResizeObserver effects so neither of them races this sequence and
 * jumps straight to the target before the two-frame reveal gets to.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { resolveSnap, heightForSnap } from "../lib/bottomSheetSnap.js";

const TOP_INSET = 64; // px of the map always left visible above the sheet, even at "full"
const TRANSITION_MS = 220;

export default function BottomSheet({ open, onDismiss, initialSnap = "half", peekHeight, children }) {
  const contentRef = useRef(null);
  const [snap, setSnap] = useState(initialSnap);
  const [heightPx, setHeightPx] = useState(0);
  const [animated, setAnimated] = useState(false);
  const dragRef = useRef(null); // { startY, startHeight, pointerId } while an active drag is in progress
  const didMountRef = useRef(false);

  const viewportHeight = () => window.visualViewport?.height || window.innerHeight;
  const contentHeight = () => contentRef.current?.scrollHeight ?? 0;

  const targetFor = useCallback((s) => heightForSnap(s, {
    contentHeight: contentHeight(), peekHeight, viewportHeight: viewportHeight(), topInset: TOP_INSET,
  }), [peekHeight]);

  // The two-frame reveal (see header comment): frame 1 flips transitions on, frame 2 sets the
  // real content-driven target height so the browser has something to animate FROM.
  useEffect(() => {
    const id1 = requestAnimationFrame(() => {
      setAnimated(true);
      const id2 = requestAnimationFrame(() => {
        didMountRef.current = true;
        setHeightPx(targetFor(snap));
      });
      return () => cancelAnimationFrame(id2);
    });
    return () => cancelAnimationFrame(id1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-settle to the current snap's content-driven height on every LATER snap change (never the
  // first render — the mount effect above owns that) and never while a drag is live.
  useLayoutEffect(() => {
    if (!didMountRef.current || dragRef.current) return;
    setHeightPx(targetFor(snap));
  }, [snap, targetFor]);

  useEffect(() => {
    if (!contentRef.current || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => {
      if (!didMountRef.current || dragRef.current) return;
      setHeightPx(targetFor(snap));
    });
    ro.observe(contentRef.current);
    return () => ro.disconnect();
  }, [snap, targetFor]);

  const onHandlePointerDown = useCallback((e) => {
    if (e.button != null && e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { startY: e.clientY, startHeight: heightPx, pointerId: e.pointerId };
  }, [heightPx]);

  const onHandlePointerMove = useCallback((e) => {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    const deltaUp = drag.startY - e.clientY; // dragging UP (finger moves up) grows the sheet
    const next = Math.max(0, Math.min(drag.startHeight + deltaUp, viewportHeight() - TOP_INSET));
    setHeightPx(next);
  }, []);

  const endDrag = useCallback((e) => {
    const drag = dragRef.current;
    if (!drag || (e && e.pointerId !== drag.pointerId)) return;
    dragRef.current = null;
    const peek = targetFor("peek");
    const half = targetFor("half");
    const full = targetFor("full");
    const resolved = resolveSnap({ heightPx, peekHeight: peek, halfHeight: half, fullHeight: full, dismissBelow: peek * 0.5 });
    if (resolved === "dismiss") { onDismiss?.(); return; }
    // Re-settle to the exact content-driven height for the resolved snap — either the SAME snap
    // (a small drag that didn't cross a boundary) or a new one (the snap-change effect above
    // would also do this, but setting it here too means there's no one-frame flash at the raw
    // drag-release height before that effect catches up).
    setHeightPx(targetFor(resolved));
    if (resolved !== snap) setSnap(resolved);
  }, [heightPx, snap, targetFor, onDismiss]);

  if (!open) return null;

  return (
    <div
      data-testid="food-bottom-sheet"
      data-sheet-snap={snap}
      style={{
        position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 700,
        height: heightPx, maxHeight: `calc(100vh - ${TOP_INSET}px)`,
        background: "var(--surface-raised)", borderTopLeftRadius: 16, borderTopRightRadius: 16,
        boxShadow: "0 -8px 24px rgba(0,0,0,0.22)", display: "flex", flexDirection: "column",
        overflow: "hidden", touchAction: "none",
        transition: animated ? `height ${TRANSITION_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)` : "none",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <div
        data-testid="food-sheet-drag-handle"
        onPointerDown={onHandlePointerDown}
        onPointerMove={onHandlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{
          flex: "0 0 auto", display: "flex", justifyContent: "center", alignItems: "center",
          height: 22, minHeight: 44, cursor: "grab", touchAction: "none",
        }}
      >
        <span aria-hidden="true" style={{ width: 36, height: 4, borderRadius: 999, background: "var(--border-strong, var(--border-default))" }} />
      </div>
      <div ref={contentRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain" }}>
        {children}
      </div>
    </div>
  );
}
