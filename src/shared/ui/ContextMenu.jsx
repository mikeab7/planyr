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

  // ⛔ B735 (×2) — `onClose` is closed over by a REF, not taken as a plain effect dependency.
  // Every consumer passes an inline arrow (`onClose={() => setMenuFor(null)}`), a fresh function
  // identity on every render, and this component's HOST re-renders as a direct side effect of the
  // very `hashchange` this listener exists to catch (the route change that fires it is what causes
  // the surrounding tree to switch workspaces). Depending on `[onClose]` tears the listener down
  // and re-adds it on every such render — and because browsers snapshot a native event's listener
  // list at DISPATCH time, a listener removed mid-dispatch is skipped for THAT event even though
  // it's already back by the next task, so the very re-render this handler is meant to survive was
  // silently unregistering it first. Measured live: with a plain `[onClose]` dependency this fired
  // 0 times per navigation, every time — deterministic, not a rare race — reading the ref instead
  // fires it every time. The mount effect below never tears down for a re-render, only for a real
  // unmount, so the listeners stay registered the entire time the menu is open.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  // Escape / page-scroll / window-resize / `hashchange` all dismiss (a scroll INSIDE the menu is
  // exempt so a scrollable over-tall menu still works). The `hashchange` case is the fix for a
  // menu left open across a kept-alive module switch: unlike AnchoredMenu, this primitive has no
  // live-measured `anchorRef` at all (it opens at a fixed cursor x/y), so there is no anchor
  // geometry to watch collapse — the ONLY signal available is that this app's ENTIRE route lives
  // in the hash (route.js), so every module switch fires one. Measured live on the project
  // breadcrumb's own per-row kebab (this component, not AnchoredMenu — the two are easy to
  // conflate): opening it, then switching workspace tabs without closing it first, left its
  // full-viewport backdrop mounted, invisible, over the newly-active workspace forever — silently
  // eating every click there, because none of Escape/scroll/resize ever fires on a plain module
  // switch. This primitive is reused far beyond the breadcrumb (map pins, canvas elements,
  // parcels, markups, the Library folder tree, Doc Review markup objects), so the same trap was
  // live everywhere a context menu is left open across a tab switch, not just here.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); onCloseRef.current?.(); } };
    const onScroll = (e) => {
      if (panelRef.current && e.target instanceof Node && panelRef.current.contains(e.target)) return;
      onCloseRef.current?.();
    };
    const onResize = () => onCloseRef.current?.();
    const onNav = () => onCloseRef.current?.();
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true); // capture: catch a scroll in any container
    window.addEventListener("resize", onResize);
    window.addEventListener("hashchange", onNav);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("hashchange", onNav);
    };
  }, []);

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
