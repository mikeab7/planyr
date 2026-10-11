/* OverlayCropDialog — the Site tab OVERLAYS panel's "Crop…" (NEW-1, B1838704).
 *
 * The owner, on Goose Creek / Phase II with a master-site-plan PDF placed: "I cant see how to crop
 * this overlay?" The visual crop tool (rectangle + polygon) only lived on the separate Comps
 * surface (`site_plan_overlays`); this panel had nothing but four easy-to-miss edge-trim number
 * fields. This dialog is a THIN MODAL SHELL around the ONE crop UI, `ImageCropTool` — it adds no
 * crop behaviour of its own, so the two surfaces can never drift apart in how a crop is drawn.
 *
 * The modal shell (portal, size, key isolation) is the shared `CropModal`, also used by the Map/Comps
 * Adjust panel — so layering and sizing can never drift between the two surfaces.
 *
 * Lazy-loaded: opened rarely, and it carries the crop tool, so it stays off the planner's boot chunk.
 */
import ImageCropTool from "../../../shared/sitePlans/components/ImageCropTool.jsx";
import CropModal from "../../../shared/sitePlans/components/CropModal.jsx";
import { RADIUS } from "../../../shared/ui/radius.js";
import { FONT_SIZE } from "../../../shared/ui/designTokens.js";

/* NEW-1 (Overlays redesign) — the four B719779 trim-by-feet fields live HERE now (they were crowding the
 * panel). They are the precise-entry path for a RECTANGLE: typing one writes the crop straight through
 * `onTrim` (the same setOverlayCrop the tool commits through) and the tool below is re-keyed on the crop so it
 * re-seeds from it. A polygon has no per-edge trim, so the strip says so instead of rendering dead fields. */
const EDGES = [["left", "L", "Left edge"], ["top", "T", "Top edge"], ["right", "R", "Right edge"], ["bottom", "B", "Bottom edge"]];

export default function OverlayCropDialog({ overlay, onCommit, onCancel, trim, isPoly, onTrim, onTrimFocus }) {
  if (!overlay) return null;
  const trimStrip = trim ? (
    <div data-testid="overlay-crop-trim" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 6, fontSize: FONT_SIZE.label, color: "var(--text-secondary)" }}
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
  ) : null;
  return (
    <CropModal testId="overlay-crop-dialog" title={`Crop “${overlay.name || "this overlay"}”`} onCancel={onCancel} header={trimStrip}>
      <ImageCropTool
        key={JSON.stringify(overlay.crop || null)}
        fill
        src={overlay.src} imgW={overlay.imgW} imgH={overlay.imgH} crop={overlay.crop || null}
        onCommit={onCommit} onCancel={onCancel}
      />
    </CropModal>
  );
}
