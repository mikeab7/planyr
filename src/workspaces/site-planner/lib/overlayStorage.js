/* Supabase Storage for site-plan overlay source PDFs (B72 follow-up — cross-device
 * reload). Reuses the app's Supabase client + the existing private `doc-review-files`
 * bucket; the key puts uid FIRST so the existing Storage RLS
 * ((storage.foldername(name))[1] = auth.uid()) applies unchanged. Purely additive and
 * fallback-safe: logged-out, oversize, or any error → null, and callers keep the inline
 * raster (today's behavior), so nothing regresses if Storage is unavailable. */
import { supabase } from "./supabase.js";
import { getUser } from "./auth.js";

export const BUCKET = "doc-review-files";
const MAX_BYTES = 50 * 1024 * 1024; // free-tier per-file cap

// uid-first key (RLS-safe). PDF-only for now; images stay inline.
export const overlayKey = (uid, siteId, overlayId) =>
  `${uid}/site-overlays/${siteId || "unfiled"}/${overlayId}.pdf`;

/* Upload an overlay's original PDF; returns { key } or null (no client / not signed in /
 * oversize / error). Caller treats null as "stay inline". */
export async function uploadOverlayPdf(siteId, overlayId, file) {
  if (!supabase || !file || file.size > MAX_BYTES) return null;
  const user = await getUser();
  const uid = user && user.id;
  if (!uid) return null;
  const key = overlayKey(uid, siteId, overlayId);
  const { error } = await supabase.storage.from(BUCKET).upload(key, file, { contentType: "application/pdf", upsert: true });
  return error ? null : { key };
}

/* Download stored overlay bytes as an ArrayBuffer (ready for loadPdf), or null. */
export async function downloadOverlayBytes(key) {
  if (!supabase || !key) return null;
  const { data, error } = await supabase.storage.from(BUCKET).download(key);
  if (error || !data) return null;
  try { return await data.arrayBuffer(); } catch (_) { return null; }
}
