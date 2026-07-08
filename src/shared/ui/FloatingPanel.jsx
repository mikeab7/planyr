import { useRef, useCallback, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import PanelChrome from "./PanelChrome.jsx";
import { clampToBounds, FLOAT_SIZE } from "./floatingPanel.js";

/**
 * FloatingPanel — a Site Planner left-rail panel detached into a draggable card over the map
 * (NEW-1). Renders in a PORTAL at document.body, exactly like AnchoredMenu, for two reasons:
 *   (1) it escapes the left rail's trapped stacking context + overflow clipping, and
 *   (2) the map's wheel-zoom listener is bound to the canvas wrapper and the pan handlers live
 *       on the SVG *inside* it — a body-portaled card is NOT a descendant, so those listeners
 *       never fire over the card. Interacting with / dragging the card can't pan or zoom the map.
 *
 * Position is CONTROLLED by the host (`pos` + `onMove`) so it can be remembered for the session.
 * Every drag move and every layout change is clamped to the map viewport (`boundsRef` → the
 * canvas wrapper rect) so the card can never be dragged off-screen and lost.
 *
 * Props:
 *  - title       : the panel's title (shown once, in the chrome bar).
 *  - pos         : { x, y } — the card's top-left in viewport px (controlled).
 *  - onMove      : (pos) => void — called with the clamped position on drag / re-clamp.
 *  - onDock      : () => void — return the panel to the docked left column.
 *  - onClose     : () => void — close the panel.
 *  - boundsRef   : ref to the element whose rect bounds the card (the canvas wrapper).
 *  - width       : card width in px (default 340).
 *  - zIndex      : default 1500 — above the canvas / narrow overlays, below the 4000 menu tier,
 *                  so a panel's own AnchoredMenu flyouts (also portaled, z 4000) render above it.
 *  - children    : the panel body.
 *  - data-testid : string.
 */
export default function FloatingPanel({ title, pos, onMove, onDock, onClose, boundsRef, width = 340, zIndex = 1500, children, "data-testid": testId }) {
  const cardRef = useRef(null);
  const posRef = useRef(pos);
  posRef.current = pos;

  const cardSize = () => ({
    w: cardRef.current?.offsetWidth || width,
    h: cardRef.current?.offsetHeight || FLOAT_SIZE.h,
  });

  // Re-clamp the current position against the live map rect. Used on window resize and after
  // every render (a layout change — docking a neighbour, resizing the rail — shifts the bounds).
  // Guarded so it only writes when the position actually needs to move (no render loop).
  const reclamp = useCallback(() => {
    const b = boundsRef?.current?.getBoundingClientRect();
    if (!b) return;
    const next = clampToBounds(posRef.current, cardSize(), b);
    if (next.x !== posRef.current.x || next.y !== posRef.current.y) onMove(next);
  }, [boundsRef, width, onMove]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => { reclamp(); });

  useEffect(() => {
    window.addEventListener("resize", reclamp);
    return () => window.removeEventListener("resize", reclamp);
  }, [reclamp]);

  // Drag by the title bar — the shared window-level pointer-drag idiom (SitePlanner startLeftResize).
  const startDrag = useCallback((e) => {
    if (e.button != null && e.button !== 0) return; // left button only
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    const ox = posRef.current.x, oy = posRef.current.y;
    const size = cardSize();
    const move = (ev) => {
      const b = boundsRef?.current?.getBoundingClientRect();
      onMove(clampToBounds({ x: ox + ev.clientX - sx, y: oy + ev.clientY - sy }, size, b));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, [boundsRef, onMove]); // eslint-disable-line react-hooks/exhaustive-deps

  return createPortal(
    <div
      ref={cardRef}
      data-testid={testId}
      // Defensive: the portal already isolates the card from the map, but never let a pointer
      // gesture that starts on the card reach anything beneath it.
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: "fixed", left: pos.x, top: pos.y, width, zIndex,
        maxHeight: "min(72vh, 620px)", display: "flex", flexDirection: "column",
        background: "var(--surface-overlay)", border: "1px solid var(--planner-border)",
        borderRadius: 12, overflow: "hidden",
        boxShadow: "0 16px 44px rgba(28,25,20,0.22), 0 3px 10px rgba(28,25,20,0.1)",
        backdropFilter: "saturate(180%) blur(8px)", WebkitBackdropFilter: "saturate(180%) blur(8px)",
      }}>
      <PanelChrome title={title} floating canFloat onDock={onDock} onClose={onClose} onToggle={onDock} onDragStart={startDrag} data-testid={testId ? `${testId}-chrome` : undefined} />
      <div data-wheelscroll="1" style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: "12px 13px 18px" }}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
