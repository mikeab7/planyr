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
 * NEW-1 (2026-10-15): the four-field edge-trim strip that used to sit above the tool is GONE (owner: "we need to remove
 * that"); the crop is drawn on the picture, nothing else. The file name now rides in the tool's own header row.
 *
 * Lazy-loaded: opened rarely, and it carries the crop tool, so it stays off the planner's boot chunk.
 */
import ImageCropTool from "../../../shared/sitePlans/components/ImageCropTool.jsx";
import CropModal from "../../../shared/sitePlans/components/CropModal.jsx";

export default function OverlayCropDialog({ overlay, onCommit, onCancel }) {
  if (!overlay) return null;
  const name = overlay.name || "this overlay";
  return (
    <CropModal testId="overlay-crop-dialog" title={`Crop “${name}”`} onCancel={onCancel}>
      <ImageCropTool
        key={JSON.stringify(overlay.crop || null)}
        fill fileName={overlay.name || ""}
        src={overlay.src} imgW={overlay.imgW} imgH={overlay.imgH} crop={overlay.crop || null}
        onCommit={onCommit} onCancel={onCancel}
      />
    </CropModal>
  );
}
