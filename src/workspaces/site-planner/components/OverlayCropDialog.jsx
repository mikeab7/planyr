/* OverlayCropDialog — the Site tab OVERLAYS panel's "Crop…" (NEW-1, B1838704).
 *
 * The owner, on Goose Creek / Phase II with a master-site-plan PDF placed: "I cant see how to crop
 * this overlay?" The visual crop tool (rectangle + polygon) only lived on the separate Comps
 * surface (`site_plan_overlays`); this panel had nothing but four easy-to-miss edge-trim number
 * fields. This dialog is a THIN MODAL SHELL around the ONE crop UI, `ImageCropTool` — it adds no
 * crop behaviour of its own, so the two surfaces can never drift apart in how a crop is drawn.
 *
 * Keyboard: the tool's own Escape / Enter / Backspace must not ALSO reach the planner's window
 * listener (Escape would clear the selection behind the dialog; Backspace is refused in chrome
 * scope anyway, but a crop dialog is no place to lean on that). So key events stop at this shell.
 * The tool is focused on open so those keys work without a first click.
 *
 * Lazy-loaded: opened rarely, and it carries the crop tool, so it stays off the planner's boot chunk.
 */
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import ImageCropTool from "../../../shared/sitePlans/components/ImageCropTool.jsx";
import { RADIUS } from "../../../shared/ui/radius.js";
import { FONT_SIZE } from "../../../shared/ui/designTokens.js";

export default function OverlayCropDialog({ overlay, onCommit, onCancel }) {
  const shellRef = useRef(null);
  useEffect(() => {
    const el = shellRef.current && shellRef.current.querySelector('[tabindex="-1"]');
    if (el) el.focus();
  }, []);
  if (!overlay) return null;
  return createPortal(
    <div data-testid="overlay-crop-dialog" style={{
      position: "fixed", inset: 0, zIndex: 3000, background: "rgba(0,0,0,0.35)", // design-exempt: modal backdrop scrim — no backdrop-color token exists repo-wide yet (same as SitePlansSection's crop modal)
      display: "flex", alignItems: "center", justifyContent: "center",
    }}
      onPointerDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      onKeyDown={(e) => e.stopPropagation()}>
      <div ref={shellRef} style={{
        background: "var(--surface-raised)", border: "1px solid var(--border-default)", borderRadius: RADIUS.lg, padding: 14,
        boxShadow: "0 8px 32px rgba(0,0,0,0.35)", // design-exempt: no shadow-color token yet repo-wide (matches SitePlansSection's crop modal)
        maxWidth: "96vw",
      }}>
        <div style={{ fontSize: FONT_SIZE.control, fontWeight: 600, marginBottom: 8, color: "var(--text-primary)", overflowWrap: "anywhere" }}>
          Crop “{overlay.name || "this overlay"}”
        </div>
        <ImageCropTool
          src={overlay.src} imgW={overlay.imgW} imgH={overlay.imgH} crop={overlay.crop || null}
          maxWidth={Math.min(900, typeof window !== "undefined" ? window.innerWidth - 60 : 900)}
          maxHeight={Math.min(640, typeof window !== "undefined" ? window.innerHeight - 160 : 640)}
          onCommit={onCommit} onCancel={onCancel}
        />
      </div>
    </div>,
    document.body,
  );
}
