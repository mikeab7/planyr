/* useMapFileDrop — dragging a brochure / site-plan file straight onto the portfolio map (window-level dragover + drop,
 * the shared file-drag tracker and the rejected-file message), moved verbatim out of MapFinder.jsx (audit batch L2).
 * `dropIntakeRef` is set by SitePlansSection and read here at drop time. */
import { useEffect, useRef } from "react";
import { useFileDragActive, isFileDrag, markDropHandled } from "../../../shared/files/fileDrag.js";

export function useMapFileDrop({ visible, isActive, mapRef, setErr, setPanelTab, sitesPanelOpen, toggleSitesPanel }) {
  // ---- Drag-and-drop a brochure straight onto the map (NEW-2, second amendment) ------------
  // The owner's explicit ask: this is the PRIMARY way a brochure gets in (they arrive as email
  // attachments dragged out of Downloads), and the file-picker inside SitePlansSection stays
  // only as the fallback. THE GOTCHA: a browser's default reaction to a dropped file is to
  // navigate the whole tab to it — miss the drop zone by a pixel and the app is gone, unsaved
  // state included. `preventDefault` on a drop zone alone does not stop that; it has to happen
  // on `dragover` AND `drop` at the WINDOW level, gated on `dataTransfer.types.includes("Files")`
  // so a file drag is never confused with the map's own pan-by-drag, the planner's element drag,
  // or the schedule's row drag — none of which use the browser's HTML5 Drag and Drop API, so
  // none of them can trip this gate.
  const dropIntakeRef = useRef(null); // set by SitePlansSection; called with (fileList, dropPlacement)
  // NEW-2: the overlay follows the ONE shared file-drag tracker (cleared by every end-of-drag path,
  // incl. leaving the window, a failed drop, Escape, blur, a view change) and shows only while the
  // portfolio map is the visible view — no per-element enter/leave counter to strand.
  // ⛔ `visible` is only the map↔plan MODE inside the Site workspace; the workspace itself stays mounted
  // behind display:none, so it must ALSO be the active workspace — otherwise this window-level handler
  // swallowed every file dropped on the Library/Review/Notes and routed it into the site-plan intake
  // (NEW-1/NEW-2: the Map pill and the Library overlay "appearing together").
  const dropLive = !!(visible && isActive);
  const fileDragActive = useFileDragActive(dropLive);
  const onRejectDroppedFile = (name, reason) => setErr(`Couldn't add "${name}" — ${reason}.`);

  useEffect(() => {
    const onDragOver = (e) => {
      if (!dropLive || !isFileDrag(e)) return;
      e.preventDefault(); // the whole point — without this the browser navigates the tab to the file
      e.dataTransfer.dropEffect = "copy";
    };
    const onDrop = (e) => {
      if (!dropLive || !isFileDrag(e)) return;
      e.preventDefault(); // stop the tab-navigation gotcha on the actual drop too, not just dragover
      markDropHandled(e);
      const files = e.dataTransfer.files;
      if (!files || !files.length) return;
      // B850016 (NEW-11) — dropping a file is a direct enough action that the Comps tab should
      // surface to show it (`setPanelTab`). NEW-1 (2026-09-08) — it used to also arm the retired
      // centre `mode`; there is no mode to arm any more, and this drop lands straight in the site
      // plan upload flow regardless, so nothing here needed replacing.
      setPanelTab("comp");
      if (!sitesPanelOpen) toggleSitesPanel();
      // NEW-17 — this is a DROP POINT only (a {lat,lng} center override), never a full placement
      // on its own: it carries no scale, because the dropped file's own pixel dimensions aren't
      // known until it's rasterized. `confirmPage` merges it into `suggestPlacement`'s full,
      // always-scaled placement rather than using it standalone.
      let dropPlacement = null;
      const m = mapRef.current;
      if (m) { const ll = m.mouseEventToLatLng(e); dropPlacement = { lat: ll.lat, lng: ll.lng }; }
      dropIntakeRef.current && dropIntakeRef.current(files, dropPlacement);
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [dropLive, sitesPanelOpen]);
  return { dropIntakeRef, fileDragActive, onRejectDroppedFile };
}
