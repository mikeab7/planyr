import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { placeMenu } from "./anchoredMenuPlacement.js";

/**
 * AnchoredMenu — a dropdown / flyout that renders in a PORTAL at document.body
 * rather than inside the triggering toolbar's DOM tree (NEW-3 / B127).
 *
 * Why a portal: a dropdown nested in the toolbar inherits two things that hide it —
 *   (1) a trapped *stacking context* (an ancestor with position+z-index, transform,
 *       filter or opacity caps every child's z-index, no matter how high), and
 *   (2) *overflow clipping* — a scrolling rail is `overflow-y:auto`, which the CSS
 *       spec forces `overflow-x` to compute to `auto` too, so a menu that spills
 *       sideways out of the rail gets clipped.
 * Mounting the menu at the document root escapes BOTH at once, so bumping z-index is
 * no longer a moving target. This is the shared overlay layer for every rail/flyout
 * menu in the app — fix the class once, not per-instance.
 *
 * Positioned relative to `anchorRef` (the trigger element) via getBoundingClientRect,
 * using `position: fixed`, then clamped into the viewport. Recomputes on scroll/resize.
 *
 * Props:
 *  - open        : boolean — render the menu when true
 *  - onClose     : () => void — called when the click-away backdrop is clicked
 *  - anchorRef   : ref to the trigger element the menu positions against
 *  - placement   : "left" | "below-left" | "below-right" (default "left")
 *  - width       : menu width in px (default 230)
 *  - gap         : px gap between anchor and menu (default 10)
 *  - zIndex      : backdrop z-index; the panel sits at zIndex+1 (default 4000,
 *                  matching the app's modal layer — above the map, below AuthPanel)
 *  - panelStyle  : visual style for the panel (e.g. the shared `menuPanel`)
 *  - className   : panel className (default "menu", for the existing menu styles)
 *  - hoverSafe   : for HOVER-opened popovers (RowInfo/SourcesLegend). The normal
 *                  full-viewport click-away backdrop sits ON TOP of the trigger, so
 *                  the instant a hover-opened menu appears the backdrop covers the
 *                  button, the browser fires `mouseleave` on it, the close timer
 *                  fires, the menu closes, the backdrop is removed, `mouseenter`
 *                  fires again → the popover FLASHES open/closed continuously. In
 *                  hoverSafe mode we render NO interactive backdrop (so it can't
 *                  steal the pointer) and dismiss via a document `mousedown` that
 *                  ignores clicks on the anchor or the panel. Click-opened consumers
 *                  keep the default backdrop (unchanged). (B930 — info-icon flash)
 */
export default function AnchoredMenu({
  open,
  onClose,
  anchorRef,
  placement = "left",
  width = 230,
  gap = 10,
  zIndex = 4000,
  panelStyle,
  className = "menu",
  hoverSafe = false,
  children,
}) {
  const menuRef = useRef(null);
  const [pos, setPos] = useState(null);
  // B735 (×2) — read via a ref in the hashchange effect below, never as a plain dependency: every
  // consumer passes an inline `onClose` arrow, a fresh identity each render, and the host re-renders
  // as a direct side effect of the very `hashchange` this listener exists to catch. See that
  // effect's own header for the measured race a bare `[onClose]` dependency produces.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const place = () => {
      const a = anchorRef?.current?.getBoundingClientRect();
      const m = menuRef.current;
      if (!a || !m) return;
      // Pure, tested placement math (B734). Returns null for a zero-sized (display:none) anchor.
      const p = placeMenu({
        anchorRect: a,
        menuW: m.offsetWidth || width,
        menuH: m.offsetHeight || 0,
        viewportW: window.innerWidth,
        viewportH: window.innerHeight,
        placement,
        gap,
        margin: 8,
      });
      // B1125 — and CLEAR a stale position when the anchor stops being measurable (its rail/panel
      // went `display:none`, e.g. the host workspace was switched away while this popover was open).
      // Leaving the old `pos` standing floated an orphan menu over unrelated content, and — worse —
      // kept its full-viewport click-away layer alive with nothing visible to explain it. The
      // backdrop is now gated on `pos` too (below), so clearing it also frees the pointer.
      setPos(p || null);
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true); // capture: catch scrolls in any ancestor
    /* ⛔ B735 (×2) — B1125's fix above (clear `pos` for a zero-sized anchor) never fired for the
     * exact case it names in its own comment: "the host workspace was switched away while this
     * popover was open." A keep-alive module switch hides the PREVIOUS workspace by setting
     * `display:none` on an ANCESTOR div (Shell.jsx) — a pure CSS/React change that dispatches
     * neither a `resize` nor a `scroll` event and touches none of this effect's deps, so `place()`
     * never re-ran and the stale `pos` (and its full-viewport backdrop) stayed live forever,
     * floating over every OTHER workspace. Measured live: opening the project-switcher AND a
     * row's kebab menu, then switching module tabs, left an invisible `inset:0` interceptor over
     * the newly-active workspace — confirmed via `elementFromPoint` at its center — that silently
     * ate every click there, and going back left the SAME trap over the original workspace too.
     * A `ResizeObserver` on the anchor is one trigger: its box collapses to 0×0 the instant a
     * `display:none` ancestor hides it (and reports again if it's ever re-shown), which is exactly
     * the signal `place()` needs and neither `resize` nor `scroll` can give it. */
    let ro;
    if (typeof ResizeObserver !== "undefined" && anchorRef?.current) {
      ro = new ResizeObserver(place);
      ro.observe(anchorRef.current);
    }
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      ro?.disconnect();
    };
  }, [open, placement, gap, width, anchorRef]);

  /* ⛔ B735 (×2), second half — the ResizeObserver above is NOT enough on its own for a NESTED
   * menu (the project switcher's per-row kebab, anchored on a button that lives INSIDE the
   * switcher's own already-portaled panel). That panel hides itself with `visibility:hidden`,
   * never `display:none` — visibility:hidden keeps the box in LAYOUT, so every descendant,
   * kebab anchor included, keeps its ordinary non-zero size the whole time. Measured live: the
   * kebab's own anchor stayed 20×18 px, unchanged, long after its host workspace was switched
   * away — a ResizeObserver on it has nothing to fire on, so its stale backdrop never clears.
   * `hashchange` is the one signal every such case shares (this app's ENTIRE route lives in the
   * hash — see route.js — so no consumer here ever needs a menu to survive one): fully CLOSE
   * (not just visually hide) any open menu the instant the route changes, regardless of whether
   * its anchor is a plain element or portaled inside another open menu's panel. Closing via
   * `onClose` (not a bare `setPos(null)`) matters — merely hiding would let the ResizeObserver's
   * own next callback silently REOPEN the menu the moment its anchor becomes measurable again
   * (e.g. navigating back to the same workspace), which is worse than the original bug.
   *
   * ⛔ AND THE DEPENDENCY ARRAY MATTERS AS MUCH AS THE LISTENER: `onCloseRef` above, never a bare
   * `onClose`. Every consumer passes an inline arrow, so this component's HOST re-renders as a
   * direct side effect of the very `hashchange` being listened for (the route change that fires it
   * is what makes the surrounding tree switch workspaces) — a plain `[open, onClose]` dependency
   * tears the listener down and re-adds it on that SAME re-render, and a listener removed
   * mid-dispatch is skipped for the event already in flight (browsers snapshot the listener list
   * at dispatch time), so the handler silently unregistered itself moments before it needed to
   * fire. Measured: with a bare `onClose` dependency this fired 0 times per navigation, every
   * time — deterministic, not a rare race. */
  useEffect(() => {
    if (!open) return;
    const onNav = () => onCloseRef.current?.();
    window.addEventListener("hashchange", onNav);
    return () => window.removeEventListener("hashchange", onNav);
  }, [open]);

  // Escape closes the menu — a shared affordance for every AnchoredMenu consumer
  // (account dropdown, project breadcrumb, rail flyouts).
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // hoverSafe click-away: no backdrop to catch the click (it would steal the hover
  // and flash the popover), so dismiss on any document mousedown outside both the
  // anchor (its own click toggles) and the panel (its content is not click-away).
  useEffect(() => {
    if (!open || !hoverSafe) return;
    const onDown = (e) => {
      const panel = menuRef.current;
      const anchor = anchorRef?.current;
      if (panel && panel.contains(e.target)) return;
      if (anchor && anchor.contains(e.target)) return;
      onClose?.();
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [open, hoverSafe, onClose, anchorRef]);

  if (!open) return null;

  /* NEW-1 — declare which chrome SCOPE this menu was opened from, read off the anchor's nearest
     `[data-menu-scope]` ancestor. A portal deliberately escapes its trigger's DOM tree, so a
     surface that auto-hides on pointer-away (the fullscreen header) has no way to tell "my own
     dropdown is open" from "nothing is open" — and a switcher that vanishes as you reach for it
     is worse than no switcher at all. Stamping the panel closes that gap generically: any
     auto-hiding surface marks itself with `data-menu-scope` and holds itself open while a
     `[data-menu-owner="<scope>"]` panel exists. Menus opened from an unmarked tree stamp nothing
     and are byte-identical to before. */
  const ownerScope = anchorRef?.current?.closest?.("[data-menu-scope]")?.getAttribute("data-menu-scope") || undefined;

  return createPortal(
    <>
      {/* click-away backdrop (transparent). Skipped in hoverSafe mode — an
          interactive full-viewport layer over the trigger makes a hover-opened
          popover flash; hoverSafe dismisses via the document mousedown above.
          B1125 — also skipped until the menu is actually PLACED (`pos`). This layer covers the whole
          app (elementFromPoint over the canvas returns it), which is correct while a visible menu
          needs dismissing and indefensible otherwise: an unplaced menu is invisible, so the layer
          would swallow clicks with nothing on screen to explain why the app stopped responding. */}
      {!hoverSafe && pos && <div onClick={onClose} data-menu-owner={ownerScope} style={{ position: "fixed", inset: 0, zIndex }} />}
      <div
        ref={menuRef}
        className={className}
        data-menu-owner={ownerScope}
        style={{
          maxHeight: "min(72vh, 540px)",
          overflowY: "auto",
          ...panelStyle,
          position: "fixed",
          width,
          zIndex: zIndex + 1,
          left: pos ? pos.left : -9999,
          top: pos ? pos.top : 0,
          // hide until measured+placed so it never flashes at the wrong spot
          visibility: pos ? "visible" : "hidden",
        }}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
