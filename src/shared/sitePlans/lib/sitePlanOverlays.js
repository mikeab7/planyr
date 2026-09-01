/* Site-plan overlays — pure data model (B848496 NEW-2). A site plan is its own entity,
 * mirroring how comps work (src/shared/comps/lib/comps.js): optionally associated with a
 * project, never requiring one, visible to the team, editable by whoever uploaded it.
 *
 * The uploaded file itself is NOT duplicated storage — the whole brochure is stored WHOLE as
 * a `doc_reviews` row (Review/Library's existing document store, reused rather than a second
 * one), and an overlay row is a reference into it: which review, which page, plus the page's
 * PLACEMENT on the map (see lib/overlayGeoref.js — a direct center/scale/rotation, not a
 * fitted transform) and how it renders. One review can hold several overlay pages (phases,
 * multiple buildings on one flyer); a site can hold several dated reviews (a 2024 flyer and a
 * 2026 flyer describe different buildings).
 */
import { validPlacement } from "./overlayGeoref.js";

export function validOverlayUpload({ imgW, imgH } = {}) {
  return Number.isFinite(imgW) && imgW > 0 && Number.isFinite(imgH) && imgH > 0;
}

/** Whether an overlay has ever been placed on the map — a freshly-picked page has no
 * placement yet (it's placed the moment it's created, so in practice this is only false for a
 * malformed/legacy row). */
export function overlayPlaced(o) {
  return validPlacement(o && { centerLat: o.centerLat, centerLon: o.centerLon, ftPerPx: o.ftPerPx });
}

export function rowToOverlay(r) {
  return {
    id: r.id,
    userId: r.user_id,
    teamId: r.team_id || null,
    projectId: r.project_id || null,
    reviewId: r.review_id,
    page: r.page,
    docTitle: r.doc_title || "",
    docDate: r.doc_date || null,
    sourceFileName: r.source_file_name || "",
    imgW: r.img_w,
    imgH: r.img_h,
    rasterKey: r.raster_key || null,
    thumbDataUrl: r.thumb_data_url || null,
    centerLat: r.center_lat != null ? Number(r.center_lat) : null,
    centerLon: r.center_lon != null ? Number(r.center_lon) : null,
    ftPerPx: r.ft_per_px != null ? Number(r.ft_per_px) : null,
    rotationDeg: r.rotation_deg != null ? Number(r.rotation_deg) : 0,
    opacity: r.opacity != null ? Number(r.opacity) : 0.85,
    visible: r.visible !== false,
    locked: !!r.locked,
    version: r.version != null ? Number(r.version) : 1, // B972512-HARDENING item 7
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// NEVER includes user_id — the column default auth.uid() stamps the owner server-side
// (the comps.js / pinStore.js convention).
export function overlayToRow(o) {
  return {
    team_id: o.teamId || null,
    project_id: o.projectId || null,
    review_id: o.reviewId,
    page: o.page,
    doc_title: o.docTitle || null,
    doc_date: o.docDate || null,
    source_file_name: o.sourceFileName || null,
    img_w: o.imgW,
    img_h: o.imgH,
    raster_key: o.rasterKey || null,
    thumb_data_url: o.thumbDataUrl || null,
    center_lat: o.centerLat ?? null,
    center_lon: o.centerLon ?? null,
    ft_per_px: o.ftPerPx ?? null,
    rotation_deg: o.rotationDeg ?? 0,
    opacity: o.opacity ?? 0.85,
    visible: o.visible !== false,
    locked: !!o.locked,
    updated_at: new Date().toISOString(),
  };
}
