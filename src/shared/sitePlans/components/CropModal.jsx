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
import { createPortal } from "react-dom";
import { RADIUS } from "../../ui/radius.js";

export const CROP_MODAL_Z = 3000;

export default function CropModal({ testId, title, onCancel, children }) {
  const shellRef = useRef(null);
  useEffect(() => {
    const el = shellRef.current && shellRef.current.querySelector('[tabindex="-1"]');
    if (el) el.focus();
  }, []);
  return createPortal(
    <div data-testid={testId} data-crop-modal="" style={{
      position: "fixed", inset: 0, zIndex: CROP_MODAL_Z, background: "rgba(0,0,0,0.35)", // design-exempt: modal backdrop scrim — no backdrop-color token exists repo-wide yet
      display: "flex", alignItems: "center", justifyContent: "center",
    }}
      onPointerDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      onKeyDown={(e) => e.stopPropagation()}>
      <div ref={shellRef} role="dialog" aria-modal="true" aria-label={title} style={{
        background: "var(--surface-raised)", border: "1px solid var(--border-default)", borderRadius: RADIUS.lg, padding: 0, overflow: "hidden",
        boxShadow: "0 8px 32px rgba(0,0,0,0.35)", // design-exempt: no shadow-color token yet repo-wide
        width: "96vw", height: "94vh", display: "flex", flexDirection: "column", boxSizing: "border-box",
      }}>
        {/* NEW-1 (2026-10-15): no title line here any more — the crop tool's own ONE header row carries "Crop" + the
            file name + the shape switch + Cancel / Done, so every spare bit of height goes to the drawing. `title` is
            the dialog's accessible name. */}
        <div style={{ flex: 1, minHeight: 0 }}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
