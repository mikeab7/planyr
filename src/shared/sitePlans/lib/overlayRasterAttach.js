/* overlayRasterAttach — the write that ATTACHES an uploaded raster to its overlay row (NEW-5).
 *
 * B972512-HARDENING item 9 hardened the UPLOAD half (a failed upload is loud). The write right
 * after it — `updateOverlay(overlay.id, { ...overlay, rasterKey })` — was still read as
 * `const { data } = …; overlay = data || overlay;`: a Postgres error, an RLS 0-row refusal or a
 * CAS `conflict` left `raster_key: null` on the row while the image sat in the bucket, and the
 * plan appeared on the map with no picture and "This plan doesn't have an image yet — try
 * Change page…" — the exact placed-but-invisible outcome item 9 was written to prevent, by a
 * different door. This helper reads `{ data, error, conflict }`, retries ONCE on a conflict with
 * the row's fresh version (the way `patchAndReload` already does), and reports the rest.
 *
 * Injectable store functions so it is unit-testable (test/overlayRasterAttach.test.js). */

export async function attachOverlayRaster({ overlay, rasterKey, updateOverlay, fetchAllOverlays, expectedVersion }) {
  const base = { ...overlay, rasterKey };
  const expected0 = Number.isFinite(expectedVersion) ? expectedVersion : overlay.version;
  let r = await updateOverlay(overlay.id, { ...base, version: expected0 });
  let retried = false;
  if (r && r.conflict) {
    const fresh = await fetchAllOverlays();
    const freshVersion = ((fresh && fresh.data) || []).find((x) => x.id === overlay.id)?.version;
    if (Number.isFinite(freshVersion) && freshVersion !== expected0) {
      retried = true;
      r = await updateOverlay(overlay.id, { ...base, version: freshVersion });
    }
  }
  if (!r) return { data: null, error: new Error("Not saved"), conflict: false, retried };
  if (r.conflict) return { data: null, error: r.error || new Error("Someone else changed this site plan — showing the latest version instead."), conflict: true, retried };
  if (r.error) return { data: null, error: r.error, conflict: false, retried };
  if (!r.data) return { data: null, error: new Error("Not saved"), conflict: false, retried };
  return { data: r.data, error: null, conflict: false, retried };
}

/** The panel line for a failed attach. `friendly` is `friendlySaveError` (injected so this
 *  module stays dependency-free). */
export function attachFailureMessage(error, friendly) {
  const why = friendly ? friendly(error) : ((error && error.message) || "the cloud didn't answer");
  return `Uploaded the image but couldn't attach it to this site plan — ${why} Try “Change page…” to attach it again.`;
}
