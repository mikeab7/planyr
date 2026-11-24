/* CropModal — the ONE modal shell around ImageCropTool, for BOTH overlay surfaces (the Site tab's
 * OverlayCropDialog and the Map/Comps Adjust panel's Edit crop). NEW-1/NEW-3 (owner 2026-10-11).
 *
 * LAYERING: it is PORTALED to <body> at CROP_MODAL_Z. A modal rendered inline lives inside whatever
 * stacking context its host sits in (the map finder's rail / map host), so a map control with a higher
 * z-index in the MAP's own context ("Imagery & layers", Leaflet zoom, scale bar, attribution, the Adjust
 * panel) painted over it. At the body level nothing the map owns can outrank it — only the transient
 * tiers above (confirm dialogs, 4000) do, and those are meant to.
 *
 * SIZE: 96% × 94% of the window, the crop tool FILLS the whole shell (its own header row + the drawing), so every
 * spare bit of height goes to the canvas.
 *
 * Keyboard: the tool's own Escape / Enter / Backspace must not ALSO reach the host's window listeners
 * (Escape would deselect the overlay behind the dialog), so key events stop at this shell, and the tool
 * is focused on open so those keys work without a first click. */
import { useEffect, useRef } from "react";
import { Dialog } from "../../ui/controls.jsx";
import { RADIUS } from "../../ui/radius.js";

export const CROP_MODAL_Z = 3000;

export default function CropModal({ testId, title, onCancel, children }) {
  const shellRef = useRef(null);
  useEffect(() => {
    const el = shellRef.current && shellRef.current.querySelector('[tabindex="-1"]');
    if (el) el.focus();
  }, []);
  // dismissOnEscape is OFF: the crop tool owns Escape (it cancels its own sub-step), and every key stops here so none of them
  // also reach the host's window listeners. Outside click still cancels (press AND release on the backdrop, constraint #54).
  return (
    <Dialog onClose={onCancel} label={title} z={CROP_MODAL_Z} scrim="rgba(0,0,0,0.35)" backdropPadding={0} padding={0} dismissOnEscape={false}
      backdropProps={{ "data-testid": testId, "data-crop-modal": "" }}
      style={{ width: "96vw", height: "94vh", maxHeight: "none", overflow: "hidden", display: "flex", flexDirection: "column", boxSizing: "border-box", borderRadius: RADIUS.lg, boxShadow: "0 8px 32px rgba(0,0,0,0.35)" /* design-exempt: no shadow-color token yet repo-wide */ }}>
      <div ref={shellRef} style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }} onKeyDown={(e) => { if (e.key !== "Tab") e.stopPropagation(); }}>
        {/* NEW-1 (2026-10-15): no title line here — the crop tool's own ONE header row carries "Crop" + the file name + the shape
            switch + Cancel / Done, so every spare bit of height goes to the drawing. `title` is the dialog's accessible name. */}
        <div style={{ flex: 1, minHeight: 0 }}>{children}</div>
      </div>
    </Dialog>
  );
}
