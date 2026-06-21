import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
      const vw = window.innerWidth, vh = window.innerHeight, M = 8;
      const mw = m.offsetWidth || width;
      const mh = m.offsetHeight || 0;
      let left, top;
      if (placement === "below-left") { left = a.left; top = a.bottom + gap; }
      else if (placement === "below-right") { left = a.right - mw; top = a.bottom + gap; }
      else { left = a.left - gap - mw; top = a.top; } // "left" — flyout to the left of the rail
      // keep the whole menu on-screen
      left = Math.max(M, Math.min(left, vw - mw - M));
      top = Math.max(M, Math.min(top, vh - mh - M));
      setPos({ left, top });
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

  if (!open) return null;

  return createPortal(
    <>
      {/* click-away backdrop (transparent) */}
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex }} />
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
