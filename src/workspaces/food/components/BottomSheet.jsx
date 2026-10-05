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
/* ⛔ KEYBOARD (NEW-1, "Food on a phone"): on iOS Safari the on-screen keyboard does NOT shrink the
 * layout viewport — only `visualViewport` shrinks — so a `position: fixed; bottom: 0` sheet sat
 * UNDER the keyboard and hid the field being typed into and the Save button. While the keyboard is
 * up (`keyboardInset`, lib/keyboardInset.js) the sheet lifts by exactly the covered height, goes to
 * its "full" snap (the most room above the keyboard) and the focused field is scrolled into view.
 * Measured with a stubbed visualViewport in ui-audit/verify-food-visit-phone.mjs; the real keyboard is
 * V1476080 (on device).
 *
 * ⛔ RECURRENCE (B2046224 ×2, 2026-10-04 — owner, real iPhone, The Buffalo Grill → "+ Add a dish": the
 * dish-name field sat behind the keyboard and the sheet never lifted, after the fix above had passed
 * 136/136 emulated rows). Two causes, both fixed here and in lib/keyboardInset.js:
 *  1. The inset read `window.innerHeight` as the layout height. On iOS WebKit innerHeight is the
 *     VISIBLE height and shrinks with the keyboard, so the inset was ≈ 0 → no lift, no "full" snap.
 *     It now measures the fixed-position containing block itself (keyboardInset.js header).
 *  2. Revealing the focused field used `el.scrollIntoView`, which scrolls EVERY scrollable ancestor —
 *     on iOS that includes the page/visual viewport, which then fights the sheet's own lift — and it
 *     only ran when the inset was already non-zero at focus time (never true for an autoFocus field:
 *     focus comes first, the keyboard after). `revealField` scrolls only this sheet's content box,
 *     keeps clear of the sticky header / sticky Save bars (`data-sheet-sticky`), and is re-run on
 *     focus, on every visualViewport change, and after the height transition settles.
 * The harness that reproduces the real-phone failure (and was red on the old code) is
 * ui-audit/verify-food-ios-keyboard.mjs; on-device confirmation is the V# in VERIFICATION.md. */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { resolveSnap, heightForSnap } from "../lib/bottomSheetSnap.js";
import { currentKeyboardInset, visualViewportBox } from "../lib/keyboardInset.js";
import { publishBottomSheetHeight } from "../../../shared/ui/bottomSheetTracker.js";

const TOP_INSET = 64; // px of the map always left visible above the sheet, even at "full"
const TRANSITION_MS = 220;
const TEXT_ENTRY = /^(INPUT|TEXTAREA|SELECT)$/;
const REVEAL_MARGIN = 12; // breathing room between a revealed field and the sheet's visible edge
const FOCUS_RECHECK_MS = [0, 120, 350, 700];
const VIEWPORT_WATCH_MS = 120; // while typing, re-read the visual viewport this often (iOS can move it without an event)
const textEntryFocused = () => TEXT_ENTRY.test(document.activeElement?.tagName || "");
// While a field in the sheet has focus (`data-typing`): the "Log a visit" bar steps out of the way and
// every sticky bar (header, the form's Save/Done) flows with its content instead of floating over the
// card being edited (B2046224 ×3, owner: "while typing, the card being edited is fully visible").
// Tried and measured first: keeping the form's own Save pinned (B2057920's choice) — it then covers
// the lower part of any card taller than the space above the keyboard (a dish row's score buttons).
// Save tucks while typing and is back the moment the keyboard closes.
const TYPING_CSS = `[data-food-sheet][data-typing] [data-hide-while-typing]{display:none !important}`
  + `[data-food-sheet][data-typing] [data-sheet-sticky]{position:static !important}`;

export default function BottomSheet({ open, onDismiss, initialSnap = "half", peekHeight, onHeightChange, children }) {
  const contentRef = useRef(null);
  const [snap, setSnap] = useState(initialSnap);
  const [heightPx, setHeightPx] = useState(0);
  const [animated, setAnimated] = useState(false);
  const dragRef = useRef(null); // { startY, startHeight, pointerId } while an active drag is in progress
  const didMountRef = useRef(false);
  const selfScrollRef = useRef(false); // true between a reveal's own scrollTop write and the scroll event it fires
  const foreignScrollAtRef = useRef(0); // when something other than a reveal last scrolled the content
  const onContentScroll = useCallback(() => {
    if (selfScrollRef.current) { selfScrollRef.current = false; return; }
    foreignScrollAtRef.current = performance.now();
  }, []);

  // kbInset DETECTS the keyboard (and only while a field has focus); vvBox is where the sheet pins
  // itself while it is up — the visual viewport's own box, so no layout-height estimate can open a
  // gap between the sheet and the keyboard (see the header's ×3 note).
  const [kbInset, setKbInset] = useState(0);
  const [vvBox, setVvBox] = useState(null);
  const vvBoxRef = useRef(null);
  const [typing, setTyping] = useState(false);
  const rootRef = useRef(null);
  const kbOpen = kbInset > 0;
  const revealSoonRef = useRef(() => {});
  const measureViewport = useCallback(() => {
    const kb = textEntryFocused() ? currentKeyboardInset() : 0;
    setKbInset(kb);
    const box = kb ? visualViewportBox() : null;
    const prev = vvBoxRef.current;
    const same = box && prev ? box.top === prev.top && box.height === prev.height : box === prev;
    if (same) return;
    vvBoxRef.current = box;
    setVvBox(box);
    revealSoonRef.current();
  }, []);
  const viewportHeight = () => window.visualViewport?.height || window.innerHeight;
  // The sheet holds the drag handle AND the content; sizing it to the content alone left it one
  // handle short, so the last strip of content always had to scroll (B2046224 ×3: a dropped pin's
  // name field got a scroll area barely taller than itself).
  const handleRef = useRef(null);
  const handleHeight = () => handleRef.current?.offsetHeight ?? 0;
  const contentHeight = () => (contentRef.current?.scrollHeight ?? 0) + handleHeight();

  // Keyboard up -> always the "full" snap: the visible area is already short, so the content-
  // driven half/peek heights would leave the form cramped above the keyboard.
  const targetFor = useCallback((s) => heightForSnap(kbOpen ? "full" : s, {
    contentHeight: contentHeight(), peekHeight: peekHeight + handleHeight(), viewportHeight: viewportHeight(), topInset: kbOpen ? 8 : TOP_INSET,
  // kbInset is read through viewportHeight(); re-derive when it changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [peekHeight, kbOpen, kbInset, vvBox?.height]);

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

  // Keep the focused field inside the visible part of THIS sheet's scroller — never the page's.
  const revealField = useCallback((el) => {
    const box = contentRef.current;
    if (!box || !el || !box.contains(el) || !TEXT_ENTRY.test(el.tagName)) return;
    const b = box.getBoundingClientRect();
    const vv = window.visualViewport;
    const visTop = Math.max(b.top, vv ? vv.offsetTop : b.top);
    const visBottom = Math.min(b.bottom, vv ? vv.offsetTop + vv.height : b.bottom);
    let topReserve = 0, bottomReserve = 0;
    box.querySelectorAll("[data-sheet-sticky]").forEach((s) => {
      if (s.contains(el) || getComputedStyle(s).position !== "sticky") return; // un-stuck while typing → plain content
      const sr = s.getBoundingClientRect();
      if (!sr.height) return;
      if (s.dataset.sheetSticky === "top" && sr.top <= b.top + 2) topReserve = Math.max(topReserve, sr.bottom - b.top);
      if (s.dataset.sheetSticky === "bottom" && Math.abs(sr.bottom - b.bottom) <= 2) bottomReserve = Math.max(bottomReserve, b.bottom - sr.top);
    });
    const lo = visTop + topReserve + REVEAL_MARGIN;
    const hi = visBottom - bottomReserve - REVEAL_MARGIN;
    // Reveal the field's whole CARD (`data-edit-card`: the dish editor, a visit-form row) when it
    // fits; when it does not, keep the field visible with as much of the card above it as fits.
    const f = el.getBoundingClientRect();
    const cardEl = el.closest("[data-edit-card]");
    let r = f;
    if (cardEl && box.contains(cardEl)) {
      const c = cardEl.getBoundingClientRect();
      r = c.height <= hi - lo ? c : { top: Math.max(c.top, f.bottom - (hi - lo)), bottom: f.bottom };
    }
    if (f.height > hi - lo) r = { top: f.top, bottom: f.top }; // smaller than the field: show its top
    const before = box.scrollTop;
    if (r.top < lo) box.scrollTop -= lo - r.top;
    else if (r.bottom > hi) box.scrollTop += Math.min(r.bottom - hi, r.top - lo);
    if (box.scrollTop !== before) selfScrollRef.current = true; // the scroll event this causes is ours, not a finger's
  }, []);
  const revealActive = useCallback(() => revealField(document.activeElement), [revealField]);
  revealSoonRef.current = () => { requestAnimationFrame(revealActive); setTimeout(revealActive, TRANSITION_MS + 40); };

  // Track the visual viewport: it shrinks when the keyboard opens and grows back when it closes
  // (and on iOS it may pan, `offsetTop`). On every change, re-measure and re-reveal.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return undefined;
    const onVv = () => {
      measureViewport();
      requestAnimationFrame(revealActive);
      setTimeout(revealActive, TRANSITION_MS + 40); // again once the lift / full-snap has animated
    };
    vv.addEventListener("resize", onVv);
    vv.addEventListener("scroll", onVv);
    // iOS also SCROLLS THE PAGE to reveal a field and the page-containment guard pins it back
    // (production telemetry, the owner's own test) — the visual viewport moves with no vv event.
    window.addEventListener("scroll", onVv, { passive: true });
    return () => { vv.removeEventListener("resize", onVv); vv.removeEventListener("scroll", onVv); window.removeEventListener("scroll", onVv); };
  }, [revealActive, measureViewport]);

  // …and because none of those events is guaranteed, re-read it on a short timer while typing.
  useEffect(() => {
    if (!typing) return undefined;
    const id = setInterval(measureViewport, VIEWPORT_WATCH_MS);
    return () => clearInterval(id);
  }, [typing, measureViewport]);

  // A focused field must be revealed whether or not the keyboard is up yet — an autoFocus field
  // (the dish editor's name) is focused BEFORE the keyboard opens, and some iOS versions deliver the
  // visualViewport change late, so re-check the inset and re-reveal a few times as it settles.
  // The re-checks stand down the moment anything else scrolls the sheet (a finger moving on to the
  // next field) — they exist to catch a late keyboard, never to drag the list back to the field.
  const onFocusIn = useCallback((e) => {
    if (!TEXT_ENTRY.test(e.target.tagName)) return;
    setTyping(true);
    const focusedAt = performance.now();
    for (const ms of FOCUS_RECHECK_MS) {
      setTimeout(() => {
        if (document.activeElement !== e.target || foreignScrollAtRef.current > focusedAt) return;
        measureViewport();
        revealField(e.target);
      }, ms);
    }
  }, [revealField, measureViewport]);
  const onFocusOut = useCallback(() => {
    setTimeout(() => {
      const a = document.activeElement;
      setTyping(!!(a && TEXT_ENTRY.test(a.tagName) && rootRef.current?.contains(a)));
      measureViewport();
    }, 0);
  }, [measureViewport]);

  useEffect(() => {
    if (!contentRef.current || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => {
      if (!didMountRef.current || dragRef.current) return;
      setHeightPx(targetFor(snap));
    });
    ro.observe(contentRef.current);
    return () => ro.disconnect();
  }, [snap, targetFor]);

  // NEW-1 (2nd owner block, 2026-08-23) — the map's own bottom-anchored notices (zoom-gate,
  // capped, "search live for more here") need to track ABOVE this sheet's real top edge rather
  // than a static guess, so a caller that cares (FoodMap, via FoodApp) can position itself
  // exactly `heightPx` above the viewport bottom — this sheet is `position:fixed; bottom:0`, so
  // its own top edge sits exactly `heightPx` above the viewport bottom at all times, snap or
  // drag alike. Fires on every heightPx change (mount settle, snap change, drag, content
  // resize) — never a separate poll. Optional: only called when a parent asked for it.
  useEffect(() => { onHeightChange?.(heightPx); }, [heightPx, onHeightChange]);

  // NEW-1 (B1000400) — the SAME height, published for FloatingNotice.jsx: an app-level floating
  // notice (the update banner, a fullscreen-refused notice, …) must clear this sheet rather than
  // sit under or over it, and it has no prop path here (it can mount from anywhere in the app).
  // Zeroed on unmount so a closed sheet can't leave notices permanently offset.
  useEffect(() => {
    publishBottomSheetHeight(heightPx);
    return () => publishBottomSheetHeight(0);
  }, [heightPx]);

  const onHandlePointerDown = useCallback((e) => {
    if (e.button != null && e.button !== 0) return;
    // A MOUSE drag of the handle must not start a text selection: WebKit extends it across the
    // page and hands focus to whatever input the pointer crosses (measured: the search box, whose
    // results list then opened over the sheet). Touch never selects here; mouse-only so a tap stays a tap.
    if (e.pointerType === "mouse") e.preventDefault();
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

  // ROOT = the box the sheet is anchored to: the layout viewport normally, the VISUAL viewport's own
  // box while the keyboard is up (so the sheet's bottom edge IS the keyboard's top edge). The skirt
  // below the sheet is sheet-coloured and lives under the keyboard: if any reading is ever off and
  // the sheet sits a little high, what shows between it and the keyboard is still the sheet — never
  // the map (B2046224 ×3, owner: "a band of the satellite map shows through").
  return (
    <div
      ref={rootRef}
      data-food-sheet-root=""
      data-keyboard-managed=""
      style={{
        position: "fixed", left: 0, right: 0, zIndex: 700, pointerEvents: "none",
        ...(vvBox ? { top: vvBox.top, height: vvBox.height } : { top: 0, bottom: 0 }),
      }}
    >
    <style>{TYPING_CSS}</style>
    <div
      data-testid="food-bottom-sheet"
      data-food-sheet=""
      data-typing={typing ? "" : undefined}
      data-sheet-snap={snap}
      style={{
        position: "absolute", left: 0, right: 0, bottom: 0, pointerEvents: "auto",
        height: heightPx, maxHeight: vvBox ? vvBox.height - 8 : `calc(100% - ${TOP_INSET}px)`,
        background: "var(--surface-raised)", borderTopLeftRadius: 16, borderTopRightRadius: 16,
        boxShadow: "0 -8px 24px rgba(0,0,0,0.22)", display: "flex", flexDirection: "column",
        overflow: "hidden", touchAction: "none",
        transition: animated ? `height ${TRANSITION_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)` : "none",
        // The home-indicator inset only matters when the sheet touches the screen bottom; with the
        // keyboard up the keyboard owns that edge.
        paddingBottom: kbOpen ? 0 : "env(safe-area-inset-bottom)",
      }}
      onFocus={onFocusIn}
      onBlur={onFocusOut}
    >
      <div
        ref={handleRef}
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
      <div ref={contentRef} onScroll={onContentScroll} style={{ flex: 1, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain" }}>
        {children}
      </div>
    </div>
    {vvBox && (
      <div data-testid="food-sheet-skirt" aria-hidden="true" style={{
        position: "absolute", left: 0, right: 0, top: "100%", height: "100vh", pointerEvents: "auto",
        background: "var(--surface-raised)",
      }} />
    )}
    </div>
  );
}
