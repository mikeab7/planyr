/* Supabase Storage for site-plan overlay source files (B72 follow-up — cross-device
 * reload). Reuses the app's Supabase client + the existing private `doc-review-files`
 * bucket; the key puts uid FIRST so the existing Storage RLS
 * ((storage.foldername(name))[1] = auth.uid()) applies unchanged. Purely additive and
 * fallback-safe: logged-out, oversize, unsupported type, or any error → null, and callers
 * keep the inline raster (today's behavior), so nothing regresses if Storage is down. */
import { supabase } from "./supabase.js";
import { getUser } from "./auth.js";

export const BUCKET = "doc-review-files";
export const MAX_BYTES = 50 * 1024 * 1024; // free-tier per-file cap

// uid-first key (RLS-safe). `ext` distinguishes PDF vs image on reload.
export const overlayKey = (uid, siteId, overlayId, ext = "pdf") =>
  `${uid}/site-overlays/${siteId || "unfiled"}/${overlayId}.${ext}`;

// Map a dropped file to {ext, contentType}, or null for unsupported types (stay inline).
// B747/B748 — DXF (parsed client-side) + DWG (converted via B238) join PDF/PNG/JPG so a CAD
// overlay's original bytes back up to Storage for cross-device reload. MIME is unreliable for
// CAD, so the extension fallback is what actually classifies a dragged .dxf/.dwg.
const BY_TYPE = {
  "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg",
  "image/vnd.dxf": "dxf", "application/dxf": "dxf",
  "image/vnd.dwg": "dwg", "application/acad": "dwg", "image/x-dwg": "dwg",
};
export function fileKind(file) {
  let ct = file && file.type;
  if (!BY_TYPE[ct]) {
    const n = ((file && file.name) || "").toLowerCase();
    if (n.endsWith(".pdf")) ct = "application/pdf";
    else if (n.endsWith(".png")) ct = "image/png";
    else if (n.endsWith(".jpg") || n.endsWith(".jpeg")) ct = "image/jpeg";
    else if (n.endsWith(".dxf")) ct = "application/dxf";
    else if (n.endsWith(".dwg")) ct = "image/vnd.dwg";
  }
  return BY_TYPE[ct] ? { ext: BY_TYPE[ct], contentType: ct } : null;
}

/* Upload an overlay's original PDF/PNG/JPG; returns { key } or null (no client / not
 * signed in / oversize / unsupported / error). Caller treats null as "stay inline". */
export async function uploadOverlayFile(siteId, overlayId, file) {
  if (!supabase || !file || file.size > MAX_BYTES) return null;
  const kind = fileKind(file);
  if (!kind) return null;
  const user = await getUser();
  const uid = user && user.id;
  if (!uid) return null;
  const key = overlayKey(uid, siteId, overlayId, kind.ext);
  const { error } = await supabase.storage.from(BUCKET).upload(key, file, { contentType: kind.contentType, upsert: true });
  return error ? null : { key };
}

// Aerial underlay (B474 review #5) — same bucket + uid-first RLS, distinct path. The underlay is the one
// raster that previously had NO cross-device / post-eviction recovery (it lived only in this device's
// IndexedDB), so back it up like overlays/drawings. We store the DOWNSCALED data-URL the planner actually
// renders (not the original file) so the restored raster matches the record's saved imgW/imgH + ftPerPx.
export const siteUnderlayKey = (uid, siteId, ext = "png") =>
  `${uid}/site-underlay/${siteId || "unfiled"}/underlay.${ext}`;

/* Upload the underlay's downscaled data-URL so its backdrop can be rebuilt on another device or after a
 * local IndexedDB eviction; returns { key, ext } or null (no client / not signed in / oversize / bad input
 * / error → caller keeps the local copy, nothing regresses). */
export async function uploadUnderlayDataUrl(siteId, dataUrl) {
  if (!supabase || typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) return null;
  let blob;
  try { blob = await (await fetch(dataUrl)).blob(); } catch (_) { return null; }
  if (!blob || blob.size > MAX_BYTES) return null;
  const ext = blob.type === "image/jpeg" ? "jpg" : "png";
  const user = await getUser();
  const uid = user && user.id;
  if (!uid) return null;
  const key = siteUnderlayKey(uid, siteId, ext);
  const { error } = await supabase.storage.from(BUCKET).upload(key, blob, { contentType: blob.type || "image/png", upsert: true });
  return error ? null : { key, ext };
}

/* Download stored overlay bytes as an ArrayBuffer (ready for loadPdf), or null. */
export async function downloadOverlayBytes(key) {
  if (!supabase || !key) return null;
  const { data, error } = await supabase.storage.from(BUCKET).download(key);
  if (error || !data) return null;
  try { return await data.arrayBuffer(); } catch (_) { return null; }
}

/* Download a stored image overlay as a data URL (its raster is the source, no rasterize),
 * or null. PDFs use downloadOverlayBytes + rasterizeStoredPdf instead. */
export async function downloadOverlayDataUrl(key) {
  if (!supabase || !key) return null;
  const { data, error } = await supabase.storage.from(BUCKET).download(key);
  if (error || !data) return null;
  return new Promise((res) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => res(null);
    r.readAsDataURL(data);
  });
}

/* Best-effort delete of a stored overlay object (called when an overlay is removed so the
 * cloud copy doesn't orphan). Silent on any error. */
export async function deleteOverlayObject(key) {
  if (!supabase || !key) return;
  try { await supabase.storage.from(BUCKET).remove([key]); } catch (_) {}
}
