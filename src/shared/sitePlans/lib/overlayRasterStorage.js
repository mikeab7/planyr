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
 * returns `{ key, error }` — `error` is null on success. Caller keeps the overlay row usable
 * without a raster — a missing raster just means nothing paints on the map until re-uploaded —
 * but B972512-HARDENING item 9 found that path was going COMPLETELY SILENT: the old bare-`null`
 * return gave the caller (`if (up) {...}`, no `else`) nothing to distinguish "worked" from "the
 * upload failed" from "you're not signed in" from "the compressed page is still over the size
 * cap" — every failure looked identical to a slow-but-successful save, and the overlay row saved
 * fine with `raster_key: null`, so the plan was placed but invisible with zero indication why.
 * Every branch now returns a specific Error so the caller can show something real. */
export async function uploadOverlayRaster(overlayId, blob) {
  if (!supabase) return { key: null, error: new Error("Sign in to add a site plan.") };
  if (!blob) return { key: null, error: new Error("No image to upload.") };
  if (blob.size > MAX_BYTES) {
    const mb = Math.round(MAX_BYTES / (1024 * 1024));
    return { key: null, error: new Error(`This page's image is too large to save (over ${mb} MB even after compression) — try a lower-resolution source, or crop the page.`) };
  }
  const user = await getUser();
  const uid = user && user.id;
  if (!uid) return { key: null, error: new Error("Sign in to add a site plan.") };
  const key = overlayRasterKey(uid, overlayId);
  const { error } = await supabase.storage.from(BUCKET).upload(key, blob, { contentType: blob.type || "image/jpeg", upsert: true });
  if (error) return { key: null, error };
  return { key, error: null };
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
