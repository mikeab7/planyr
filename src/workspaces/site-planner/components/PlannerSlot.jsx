import { useCallback, useState } from "react";
import { createPortal } from "react-dom";

/* PlannerSlot — one KEPT planner (B2233521, see lib/plannerKeepAlive.js).
 *
 * The planner renders through a portal into a box this slot owns. While the slot is visible the box sits inside the slot's host; while it is
 * hidden the box is DETACHED from the document. Detached rather than `display:none` on purpose: a hidden planner left in the page would be
 * found by every `querySelector('[data-testid="planner-canvas"]')`, every `[data-feature]` census and every `elementsFromPoint` in this repo
 * and its harnesses — two canvases, two copies of every feature — while a detached subtree answers none of them. React does not care where a
 * portal's container is, so the planner's state, effects, Leaflet map and sync engine live on untouched; showing it again is re-attaching one
 * node.
 *
 * The attach happens in the host's CALLBACK REF, never an effect: React attaches refs in the layout phase in tree order, so the host (rendered
 * before the portal) is attached before the planner's own layout effects run — the boot framing measures the real box on a first mount, and
 * the keep-alive `invalidateSize` sees the real size on a re-show (B842: before paint, in the first visible frame). A `useLayoutEffect` here
 * would run AFTER the child's and both would measure a detached, zero-sized box.
 */
export default function PlannerSlot({ visible, slot, children }) {
  const [box] = useState(() => {
    const d = document.createElement("div");
    d.style.height = "100%";
    d.setAttribute("data-planner-slot", slot);
    return d;
  });
  const hostRef = useCallback((host) => {
    if (!host) return;
    if (visible) { if (box.parentNode !== host) host.appendChild(box); }
    else if (box.parentNode) box.parentNode.removeChild(box);
  }, [visible, box]);
  return (
    <>
      <div ref={hostRef} data-planner-host={visible ? "visible" : "kept"} style={visible ? { height: "100%" } : { display: "none" }} />
      {createPortal(children, box)}
    </>
  );
}
