/* SideDock — the place card on a phone held SIDEWAYS (B2046224 ×4, owner: "in landscape the card docks
 * to the RIGHT as a panel, like the desktop layout, instead of the bottom sheet").
 *
 * Why not the bottom sheet: sideways there is ~300 px of height, a sheet a third of it tall leaves a
 * sliver of map, and the picked pin ended up behind the "Search live for more here" chip. A card down
 * the right edge leaves the full height of map beside it, and `FoodMap` centres the pin in what is left.
 *
 * Rules this component owns (each is asserted by ui-audit/verify-food-landscape.mjs):
 *  · THE CARD SCROLLS ON ITS OWN — one scroller (`data-testid="food-side-scroll"`), nothing else moves;
 *    "Log a visit" is the content's own `position: sticky; bottom: 0` bar, so it stays at the bottom of
 *    the card and nothing in the page can sit over it (the help button steps aside, see
 *    bottomSheetTracker's side-dock signal).
 *  · SAFE AREAS — the notch side and the home bar are padding on an OUTER box, the scroller inside it, so
 *    the sticky bar still pins to the card's real edge. `env(safe-area-inset-*)` is 0 headless on WebKit;
 *    the picture is proven with an injected inset on Chromium (labelled emulated in the harness).
 *  · KEYBOARD UP (a field in the card): the card pins to the VISUAL viewport's own box, exactly as the
 *    bottom sheet does (BottomSheet.jsx header ×3), the sticky bars step out of the way (`data-typing`,
 *    the same CSS), and the field is scrolled into the visible part of the card.
 * The desktop rail (VisitPanel's own branch) is untouched; this is only mounted on a landscape phone. */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { currentKeyboardInset, visualViewportBox } from "../lib/keyboardInset.js";
import { SIDE_CARD_CSS_WIDTH } from "../lib/phoneLayout.js";
import { publishSideDockWidth } from "../../../shared/ui/bottomSheetTracker.js";
import { TYPING_CSS, FORM_OPEN_CSS } from "./BottomSheet.jsx";

const TEXT_ENTRY = /^(INPUT|TEXTAREA|SELECT)$/;
const REVEAL_MARGIN = 12;
const WATCH_MS = 120;
// The four score tiles (Food / Ambiance / Visits / Cost) need ~70 px each; in a card narrower than ~4 of them they
// go two-by-two instead of running off the card's edge (measured: the Cost tile was cut off on the iPhone SE sideways).
const NARROW_CARD_CSS = `@container food-dock (max-width: 270px){[data-score-grid]{grid-template-columns:repeat(2,1fr) !important}}`;

export default function SideDock({ children, onWidthChange }) {
  const rootRef = useRef(null);
  const scrollRef = useRef(null);
  const [typing, setTyping] = useState(false);
  const [box, setBox] = useState(null); // visual viewport box while the keyboard is up, else null
  const boxRef = useRef(null);

  // Report the card's real width (measured, never assumed) to the map for centring and to the help button.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    const report = () => { const w = Math.round(el.getBoundingClientRect().width); onWidthChange?.(w); publishSideDockWidth(w); };
    report();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(report) : null;
    ro?.observe(el);
    window.addEventListener("resize", report);
    return () => { ro?.disconnect(); window.removeEventListener("resize", report); onWidthChange?.(0); publishSideDockWidth(0); };
  }, [onWidthChange]);

  const reveal = useCallback((el) => {
    const sc = scrollRef.current;
    if (!sc || !el || !sc.contains(el) || !TEXT_ENTRY.test(el.tagName)) return;
    const b = sc.getBoundingClientRect();
    const vv = window.visualViewport;
    const lo = Math.max(b.top, vv ? vv.offsetTop : b.top) + REVEAL_MARGIN;
    const hi = Math.min(b.bottom, vv ? vv.offsetTop + vv.height : b.bottom) - REVEAL_MARGIN;
    const f = (el.closest("[data-edit-card]") || el).getBoundingClientRect();
    const fr = el.getBoundingClientRect();
    const r = f.height <= hi - lo ? f : { top: Math.max(f.top, fr.bottom - (hi - lo)), bottom: fr.bottom };
    if (r.top < lo) sc.scrollTop -= lo - r.top;
    else if (r.bottom > hi) sc.scrollTop += Math.min(r.bottom - hi, r.top - lo);
  }, []);
  const revealActive = useCallback(() => reveal(document.activeElement), [reveal]);

  const measure = useCallback(() => {
    const a = document.activeElement;
    const kb = a && TEXT_ENTRY.test(a.tagName) && currentKeyboardInset() > 0;
    const next = kb ? visualViewportBox() : null;
    const prev = boxRef.current;
    if (next && prev ? next.top === prev.top && next.height === prev.height : next === prev) return;
    boxRef.current = next;
    setBox(next);
    requestAnimationFrame(revealActive); setTimeout(revealActive, 80);
  }, [revealActive]);

  useEffect(() => {
    const vv = window.visualViewport;
    const on = () => { measure(); requestAnimationFrame(revealActive); };
    vv?.addEventListener("resize", on); vv?.addEventListener("scroll", on);
    window.addEventListener("scroll", on, { passive: true });
    return () => { vv?.removeEventListener("resize", on); vv?.removeEventListener("scroll", on); window.removeEventListener("scroll", on); };
  }, [measure, revealActive]);
  useEffect(() => {
    if (!typing) return undefined;
    const id = setInterval(measure, WATCH_MS);
    return () => clearInterval(id);
  }, [typing, measure]);

  const onFocusIn = useCallback((e) => {
    if (!TEXT_ENTRY.test(e.target.tagName)) return;
    setTyping(true);
    for (const ms of [0, 120, 350, 700]) setTimeout(() => { if (document.activeElement === e.target) { measure(); reveal(e.target); } }, ms);
  }, [measure, reveal]);
  const onFocusOut = useCallback(() => {
    setTimeout(() => {
      const a = document.activeElement;
      setTyping(!!(a && TEXT_ENTRY.test(a.tagName) && rootRef.current?.contains(a)));
      measure();
    }, 0);
  }, [measure]);

  // Keyboard up → pinned (fixed) to the visual viewport's own box; otherwise it fills the map area beside it.
  const place = box
    ? { position: "fixed", right: 0, top: box.top, height: box.height }
    : { position: "absolute", right: 0, top: 0, bottom: 0 };
  return (
    <div
      ref={rootRef}
      data-testid="food-visit-panel"
      data-layout="side"
      data-food-sheet=""
      data-food-panel=""
      data-keyboard-managed=""
      data-typing={typing ? "" : undefined}
      onFocus={onFocusIn}
      onBlur={onFocusOut}
      style={{
        ...place, zIndex: 700, boxSizing: "border-box",
        width: `calc(${SIDE_CARD_CSS_WIDTH} + env(safe-area-inset-right, 0px))`,
        paddingRight: "env(safe-area-inset-right, 0px)",
        paddingBottom: box ? 0 : "env(safe-area-inset-bottom, 0px)",
        background: "var(--surface-raised)", borderLeft: "1px solid var(--border-default)",
        boxShadow: "-8px 0 24px rgba(0,0,0,0.18)", // design-exempt: the same panel-edge shadow as VisitPanel's desktop rail and BottomSheet (no shadow token exists); one look for every place card
        display: "flex", flexDirection: "column",
      }}
    >
      <style>{TYPING_CSS + FORM_OPEN_CSS + NARROW_CARD_CSS}</style>
      <div ref={scrollRef} data-testid="food-side-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", overscrollBehavior: "contain", WebkitOverflowScrolling: "touch" }}>
        <div style={{ minHeight: "100%", display: "flex", flexDirection: "column", containerType: "inline-size", containerName: "food-dock" }}>{children}</div>
      </div>
    </div>
  );
}
