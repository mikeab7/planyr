/* useReviewRail — the sheet rail's width / collapsed state, the takeoff panel's open state, and the VIEWPORT-STABLE
 * compensation that keeps the drawing from skipping sideways when the rail moves; moved verbatim out of DocReview.jsx
 * (audit batch L4). The layout effect travels WITH the `wrapRef` it measures. */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { pinDragCursor } from "../../../shared/ui/controls.jsx";

export function useReviewRail({ wrapRef, setView, numPages, mode }) {
  const [takeoffOpen, setTakeoffOpen] = useState(() => { try { return localStorage.getItem("planarfit:takeoffOpen") === "1"; } catch (_) { return false; } });
  useEffect(() => { try { localStorage.setItem("planarfit:takeoffOpen", takeoffOpen ? "1" : "0"); } catch (_) { /* private mode */ } }, [takeoffOpen]);
  // Sheet rail: user-resizable (drag the right edge) + collapsible to a slim strip (owner, B664
  // — "I should be able to expand and slim the left menu"); both persist per device.
  const [railW, setRailW] = useState(() => { try { const v = +localStorage.getItem("planarfit:reviewRailW"); return v >= 160 && v <= 460 ? v : 224; } catch (_) { return 224; } });
  const [railHidden, setRailHidden] = useState(() => { try { return localStorage.getItem("planarfit:reviewRailHidden") === "1"; } catch (_) { return false; } });
  useEffect(() => { try { localStorage.setItem("planarfit:reviewRailW", String(railW)); localStorage.setItem("planarfit:reviewRailHidden", railHidden ? "1" : "0"); } catch (_) { /* private mode */ } }, [railW, railHidden]);
  // B838 / VIEWPORT-STABLE (compensate half): collapsing/expanding or drag-resizing the left sheet
  // rail moves the canvas viewport's left edge; without compensation the drawing skips sideways by
  // the full rail delta (in one frame on collapse, continuously on drag). Mirror the shipped B837
  // discipline: read the MEASURED left edge (`wrapRef.offsetLeft`, relative to the position:relative
  // review row) in a LAYOUT effect (before paint) and fold the exact delta into `view.tx` in the SAME
  // frame — no assumed width, no passive-effect skip. Measuring the real edge self-gates the right-side
  // takeoff panel, the portaled Layers popover, and the in-rail Properties panel (they leave offsetLeft
  // unchanged → zero delta). Deps are the measure triggers: rail width/visibility, doc-open (numPages),
  // and stitch→review remount (mode). (Guards a hidden keep-alive: offsetParent is null under display:none.)
  const railShiftRef = useRef(null); // last-compensated canvas left-edge (px); null until seeded / while the wrap is absent or hidden
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el || el.offsetParent == null) return; // wrap not mounted (empty state / stitch) or hidden (keep-alive) — don't measure
    const left = Math.round(el.offsetLeft);
    if (railShiftRef.current == null) { railShiftRef.current = left; return; } // seed baseline — no shift
    const delta = left - railShiftRef.current;
    if (delta !== 0) {
      railShiftRef.current = left;
      setView((v) => (v ? { ...v, tx: v.tx - delta } : v));
    }
  }, [railHidden, railW, numPages, mode]);
  const startRailResize = (e) => {
    e.preventDefault();
    const startX = e.clientX, startW = railW;
    const unpin = pinDragCursor("col-resize"); // NEW-4: the divider cursor holds for the whole drag, past the 160/460 clamp and off the grip
    const move = (ev) => setRailW(Math.max(160, Math.min(460, startW + ev.clientX - startX)));
    const up = () => { unpin(); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); };
    window.addEventListener("pointercancel", up);
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  return { takeoffOpen, setTakeoffOpen, railW, railHidden, setRailHidden, startRailResize };
}
