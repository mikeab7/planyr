/* Supabase Storage for a site-plan overlay's cached rasterized page (B848848). Reuses the
 * existing private `doc-review-files` bucket (same bucket the site-planner's reference
 * overlays already back up to, and the same one Review's source PDFs live in) rather than a
 * new bucket — the key puts uid FIRST so the existing Storage RLS
 * ((storage.foldername(name))[1] = auth.uid()) applies unchanged. Mirrors
 * site-planner/lib/overlayStorage.js's shape.
 *
 * The RASTER cached here is a rendering convenience only (so the map doesn't have to re-parse
 * and re-render the source PDF on every load) — the brochure's own bytes are the doc_reviews
 * source file, unaffected by anything here.
 */
import { supabase } from "../../../workspaces/site-planner/lib/supabase.js";
import { getUser } from "../../../workspaces/site-planner/lib/auth.js";

export const BUCKET = "doc-review-files";
export const MAX_BYTES = 20 * 1024 * 1024; // a single rasterized page, generous ceiling

// The overlay raster is a resolution-capped JPEG now, not a lossless PNG (B972225 NEW-5 — see
// shared/sitePlans/lib/overlayRasterSize.js's header for why).
export const overlayRasterKey = (uid, overlayId) => `${uid}/site-plan-overlays/${overlayId}.jpg`;

/** Upload a rasterized page (a resolution-capped JPEG Blob, PDF-sourced or from a plain
 * uploaded image — see SitePlansSection.jsx's capImageFile/rasterizePage) for one overlay;
 * returns { key } or null (no client / not signed in / oversize / error). Caller keeps the
 * overlay row usable without a raster — a missing raster just means nothing paints on the map
 * until re-uploaded. */
export async function uploadOverlayRaster(overlayId, blob) {
  if (!supabase || !blob || blob.size > MAX_BYTES) return null;
  const user = await getUser();
  const uid = user && user.id;
  if (!uid) return null;
  const key = overlayRasterKey(uid, overlayId);
  const { error } = await supabase.storage.from(BUCKET).upload(key, blob, { contentType: blob.type || "image/jpeg", upsert: true });
  return error ? null : { key };
}

/** Download a stored overlay raster as an object URL usable in an <img>/canvas, or null. */
export async function downloadOverlayRasterUrl(key) {
  if (!supabase || !key) return null;
  const { data, error } = await supabase.storage.from(BUCKET).download(key);
  if (error || !data) return null;
  try { return URL.createObjectURL(data); } catch (_) { return null; }
}

/** Best-effort delete of a stored raster (called when an overlay is removed). Silent on error. */
export async function deleteOverlayRaster(key) {
  if (!supabase || !key) return;
  try { await supabase.storage.from(BUCKET).remove([key]); } catch (_) {}
}
