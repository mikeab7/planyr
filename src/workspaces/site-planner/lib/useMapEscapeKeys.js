/* useMapEscapeKeys — Escape closes the project menu, the comp-marker menu, leaves calibration, and leaves a site plan's
 * manipulation mode; moved verbatim out of MapFinder.jsx (audit batch L2). Four independent window listeners. */
import { useEffect } from "react";

export function useMapEscapeKeys({ statusMenu, setStatusMenu, compMenu, setCompMenu, calibration, setCalibration, activeOverlayId, setActiveOverlayId }) {
  // Escape closes the open project menu, matching click-outside (B158 acceptance:
  // the right-click menu dismisses on click-outside, Escape, or selecting an option).
  useEffect(() => {
    if (!statusMenu) return;
    const onKey = (e) => { if (e.key === "Escape") setStatusMenu(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [statusMenu]);
  // Escape also closes the right-click comp-marker menu (site-record KMZ export, B711329).
  useEffect(() => {
    if (!compMenu) return;
    const onKey = (e) => { if (e.key === "Escape") setCompMenu(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [compMenu]);
  // NEW-7 — Escape leaves calibration; the clicked points are drawn on the map (drawing points in the comp
  // accent, their map spots in a contrasting ring, joined by a line) and the cursor says "click here".
  useEffect(() => {
    if (!calibration) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setCalibration(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [calibration?.id, calibration?.kind]); // eslint-disable-line react-hooks/exhaustive-deps
  // B849840/NEW-1 — Escape leaves a site plan's manipulation mode entirely (deselects/disarms),
  // distinct from overlayPlacementHandles.js's own Escape (cancel one in-flight drag and restore
  // the pre-gesture placement, then stay armed). The two never race: that in-flight handler is
  // capture-phase and calls L.DomEvent.stop, which calls the native stopPropagation — per the DOM
  // dispatch algorithm that keeps this bubble-phase window listener (same node, later path entry)
  // from ever firing for the SAME keypress, so a mid-drag Escape only cancels the drag, and a
  // second, separate Escape (nothing in flight) is what actually leaves the mode.
  useEffect(() => {
    if (!activeOverlayId) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setActiveOverlayId(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeOverlayId]);
}
