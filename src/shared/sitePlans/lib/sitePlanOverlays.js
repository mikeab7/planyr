/* Site-plan overlays — pure data model (B848848). A site plan is its own entity, mirroring
 * how comps work (src/shared/comps/lib/comps.js): optionally associated with a project,
 * never requiring one, visible to the team, editable by whoever uploaded it.
 *
 * The uploaded file itself is NOT duplicated storage — the whole brochure is stored WHOLE as
 * a `doc_reviews` row (Review/Library's existing document store, reused rather than a second
 * one), and an overlay row is a reference into it: which review, which page, plus the
 * page's georeference (see lib/overlayGeoref.js) and how it renders on the map. One review
 * can hold several overlay pages (phases, multiple buildings on one flyer); a site can hold
 * several dated reviews (a 2024 flyer and a 2026 flyer describe different buildings).
 */
import { solveOverlayTransform } from "./overlayGeoref.js";

/** True if `cps` is a usable control-point array (>=2 well-formed points). */
export function validControlPoints(cps) {
  return Array.isArray(cps) && cps.length >= 2 && cps.every(
    (cp) => cp && typeof cp.px === "number" && typeof cp.py === "number" &&
      typeof cp.lat === "number" && typeof cp.lon === "number" &&
      Number.isFinite(cp.px) && Number.isFinite(cp.py) && Number.isFinite(cp.lat) && Number.isFinite(cp.lon)
  );
}

/** Derived, cacheable metrics from a set of control points — {scaleFtPerPx, rotationDeg,
 * fitResidualFt}, or null when the points can't resolve a transform. These are DERIVED,
 * never authoritative: recomputed from `controlPoints` any time they change, never edited
 * independently, so they can never drift out of sync with the points that define them. */
export function deriveOverlayMetrics(controlPoints) {
  const t = solveOverlayTransform(controlPoints);
  if (!t) return null;
  return { scaleFtPerPx: t.scale, rotationDeg: t.rotDeg, fitResidualFt: t.residual };
}

export function validOverlayUpload({ imgW, imgH } = {}) {
  return Number.isFinite(imgW) && imgW > 0 && Number.isFinite(imgH) && imgH > 0;
}

export function rowToOverlay(r) {
  return {
    id: r.id,
    userId: r.user_id,
    teamId: r.team_id || null,
    projectId: r.project_id || null,
    reviewId: r.review_id,
    reviewUserId: r.review_user_id,
    page: r.page,
    docTitle: r.doc_title || "",
    docDate: r.doc_date || null,
    imgW: r.img_w,
    imgH: r.img_h,
    rasterKey: r.raster_key || null,
    controlPoints: Array.isArray(r.control_points) ? r.control_points : [],
    scaleFtPerPx: r.scale_ft_per_px != null ? Number(r.scale_ft_per_px) : null,
    rotationDeg: r.rotation_deg != null ? Number(r.rotation_deg) : null,
    fitResidualFt: r.fit_residual_ft != null ? Number(r.fit_residual_ft) : null,
    scaleCheckFt: r.scale_check_ft != null ? Number(r.scale_check_ft) : null,
    scaleCheckNote: r.scale_check_note || null,
    opacity: r.opacity != null ? Number(r.opacity) : 0.85,
    visible: r.visible !== false,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// NEVER includes user_id — the column default auth.uid() stamps the owner server-side
// (the comps.js / pinStore.js convention).
export function overlayToRow(o) {
  const metrics = deriveOverlayMetrics(o.controlPoints) || {};
  return {
    team_id: o.teamId || null,
    project_id: o.projectId || null,
    review_id: o.reviewId,
    review_user_id: o.reviewUserId,
    page: o.page,
    doc_title: o.docTitle || null,
    doc_date: o.docDate || null,
    img_w: o.imgW,
    img_h: o.imgH,
    raster_key: o.rasterKey || null,
    control_points: o.controlPoints || [],
    scale_ft_per_px: metrics.scaleFtPerPx ?? null,
    rotation_deg: metrics.rotationDeg ?? null,
    fit_residual_ft: metrics.fitResidualFt ?? null,
    scale_check_ft: o.scaleCheckFt ?? null,
    scale_check_note: o.scaleCheckNote || null,
    opacity: o.opacity ?? 0.85,
    visible: o.visible !== false,
    updated_at: new Date().toISOString(),
  };
}
