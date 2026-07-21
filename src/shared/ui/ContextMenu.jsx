import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { placeContextMenu } from "./contextMenuPlacement.js";

/**
 * ContextMenu — the ONE shared right-click / context menu primitive (B915).
 *
 * Every right-click surface in the app (map pins, canvas elements, overlays, parcels, markups,
 * the Library folder tree, Doc Review markup objects, the project breadcrumb) used to hand-roll
 * its own cursor-positioned menu with a HARDCODED, assumed height fed into a one-sided
 * `Math.min(y, innerHeight - 288)` clamp. When the real menu was taller than the guess — a pin
 * menu with status + share + delete — its bottom rows ran off the screen and were unreachable
 * (the reported bug: right-click a pin near the bottom edge, "Delete project…" is clipped). This
 * primitive fixes the whole class once:
 *
 *   • Renders in a PORTAL at document.body, so no ancestor with `overflow:hidden` or a CSS
 *     transform can clip it (same reasoning as AnchoredMenu).
 *   • `position: fixed`, anchored at the cursor point, then MEASURED against the viewport in a
 *     `useLayoutEffect` (before paint, no flicker) and flipped up / flipped left / hard-clamped
 *     via the pure, unit-tested `placeContextMenu`.
 *   • A `maxHeight` of the viewport minus margins + `overflow-y:auto`, so a menu taller than the
 *     screen scrolls instead of clipping.
 *   • Re-places (not closes) if its own contents grow AFTER it opened (a ResizeObserver).
 *   • Closes on Escape, an outside click, and page scroll / window resize (scrolling INSIDE the
 *     menu itself is exempt).
 *
 * Props:
 *  - x, y       : cursor coordinates (event.clientX / clientY) to open at
 *  - onClose    : () => void — outside click / Escape / scroll / resize
 *  - width      : fixed menu width in px (optional — omit to size to content via minWidth)
 *  - minWidth   : min menu width when `width` is omitted (default 190)
 *  - zIndex     : backdrop z-index; the panel sits at zIndex+1 (default 4000)
 *  - margin     : min gap kept from every viewport edge (default 8)
 *  - gap        : gap between the cursor and the menu's anchored corner (default 2)
 *  - panelStyle : extra visual style merged onto the panel (e.g. the shared `menuPanel`)
 *  - className  : panel className (default "menu" — reuses the existing menu styles)
 *  - role       : panel ARIA role (default "menu")
 *  - ariaLabel  : panel aria-label
 */
export default function ContextMenu({
  x,
  y,
  onClose,
  children,
  width,
  minWidth = 190,
  zIndex = 4000,
  margin = 8,
  gap = 2,
  panelStyle,
  className = "menu",
  role = "menu",
  ariaLabel,
  testId,
}) {
  const panelRef = useRef(null);
  const [pos, setPos] = useState(null);

  // Measure the real menu box and place it (flip up/left + clamp). useLayoutEffect runs before
  // paint so the menu never flashes at the un-flipped spot.
  useLayoutEffect(() => {
    const place = () => {
      const el = panelRef.current;
      if (!el) return;
      setPos(
        placeContextMenu({
          cursorX: x,
          cursorY: y,
          menuW: el.offsetWidth,
          menuH: el.offsetHeight,
          viewportW: window.innerWidth,
          viewportH: window.innerHeight,
          margin,
          gap,
        }),
      );
    };
    place();
    // Re-place (don't close) if the menu's own content changes size after it opened — a submenu
    // expanding, an async row arriving. Observes the panel, not the window.
    let ro;
    if (typeof ResizeObserver !== "undefined" && panelRef.current) {
      ro = new ResizeObserver(place);
      ro.observe(panelRef.current);
    }
    return () => ro && ro.disconnect();
  }, [x, y, margin, gap]);

  // Escape / page-scroll / window-resize all dismiss (a scroll INSIDE the menu is exempt so a
  // scrollable over-tall menu still works).
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); onClose?.(); } };
    const onScroll = (e) => {
      if (panelRef.current && e.target instanceof Node && panelRef.current.contains(e.target)) return;
      onClose?.();
    };
    const onResize = () => onClose?.();
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true); // capture: catch a scroll in any container
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [onClose]);

  return createPortal(
    <>
      {/* click-away / right-click-away backdrop (transparent) */}
      <div
        onPointerDown={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose?.(); }}
        style={{ position: "fixed", inset: 0, zIndex }}
      />
      <div
        ref={panelRef}
        className={className}
        role={role}
        aria-label={ariaLabel}
        data-testid={testId}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          ...panelStyle,
          position: "fixed",
          ...(width ? { width } : { minWidth }),
          left: pos ? pos.left : -9999,
          top: pos ? pos.top : 0,
          maxHeight: pos ? pos.maxHeight : undefined,
          overflowY: "auto",
          // hide until measured + placed so it never flashes at the un-flipped spot
          visibility: pos ? "visible" : "hidden",
          zIndex: zIndex + 1,
        }}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
