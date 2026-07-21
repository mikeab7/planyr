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

  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const place = () => {
      const a = anchorRef?.current?.getBoundingClientRect();
      const m = menuRef.current;
      if (!a || !m) return;
      // Pure, tested placement math (B734). Returns null for a zero-sized (display:none)
      // anchor — in that case leave `pos` as-is so the menu stays hidden rather than being
      // clamped to the top-left corner.
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
      if (p) setPos(p);
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true); // capture: catch scrolls in any ancestor
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, placement, gap, width, anchorRef]);

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

  return createPortal(
    <>
      {/* click-away backdrop (transparent). Skipped in hoverSafe mode — an
          interactive full-viewport layer over the trigger makes a hover-opened
          popover flash; hoverSafe dismisses via the document mousedown above. */}
      {!hoverSafe && <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex }} />}
      <div
        ref={menuRef}
        className={className}
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
