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

/* NEW-1 (Overlays redesign) — the four B719779 trim-by-feet fields live HERE now (they were crowding the
 * panel). They are the precise-entry path for a RECTANGLE: typing one writes the crop straight through
 * `onTrim` (the same setOverlayCrop the tool commits through) and the tool below is re-keyed on the crop so it
 * re-seeds from it. A polygon has no per-edge trim, so the strip says so instead of rendering dead fields. */
const EDGES = [["left", "L", "Left edge"], ["top", "T", "Top edge"], ["right", "R", "Right edge"], ["bottom", "B", "Bottom edge"]];

export default function OverlayCropDialog({ overlay, onCommit, onCancel, trim, isPoly, onTrim, onTrimFocus }) {
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
        width: "96vw", height: "94vh", display: "flex", flexDirection: "column", boxSizing: "border-box",
      }}>
        <div style={{ fontSize: FONT_SIZE.control, fontWeight: 600, marginBottom: 8, color: "var(--text-primary)", overflowWrap: "anywhere" }}>
          Crop “{overlay.name || "this overlay"}”
        </div>
        {/* NEW-5 (2026-09-29) — the dialog takes 96% × 94% of the window and the crop tool FILLS what
            is left under the title (measured live, refitted on resize), so a landscape sheet is shown
            as big as the window allows instead of a fixed box with dead space either side. */}
        {trim && (
          <div data-testid="overlay-crop-trim" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 8, fontSize: FONT_SIZE.label, color: "var(--text-secondary)" }}
            title="Trim white space off any edge, in feet — reversible, the full image is kept">
            <span style={{ fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>Trim by feet</span>
            {isPoly ? <span>A polygon has no edge trim — switch to Rectangle to type feet.</span> : EDGES.map(([edge, letter, title]) => (
              <label key={edge} style={{ display: "inline-flex", alignItems: "center", gap: 4 }} title={title}>
                <span>{letter}</span>
                <input type="number" min={0} aria-label={`Crop ${title}`} data-testid={`overlay-crop-trim-${edge}`}
                  style={{ width: 64, padding: "5px 8px", fontSize: FONT_SIZE.control, border: "1px solid var(--border-default)", borderRadius: RADIUS.sm, background: "var(--surface-raised)", color: "var(--text-primary)" }}
                  value={Math.round(trim[edge] || 0)} onFocus={onTrimFocus} onChange={(e) => onTrim(edge, e.target.value)} />
              </label>
            ))}
          </div>
        )}
        <div style={{ flex: 1, minHeight: 0 }}>
          <ImageCropTool
            key={JSON.stringify(overlay.crop || null)}
            fill
            src={overlay.src} imgW={overlay.imgW} imgH={overlay.imgH} crop={overlay.crop || null}
            onCommit={onCommit} onCancel={onCancel}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
