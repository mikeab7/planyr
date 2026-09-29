/* siteThumbnail — writes the Dashboard's per-plan thumbnail (site_thumbnail.sql's
 * `sites.thumbnail_svg` / `thumbnail_updated_at`), NEW-1 2026-09-08.
 *
 * Two entry points, one write:
 *  - `refreshSiteThumbnailFromModel(model)` — the "refresh on save" path. Called (fire-and-forget,
 *    best-effort) right after a real cloud save from storage.js's pushSiteToCloud, using the
 *    model already held in memory — it already carries real `els`/`parcels`, so no extra fetch.
 *  - `generateAndStoreThumbnail(siteId)` — the Dashboard's lazy-generate-once fallback, for a plan
 *    that has never been saved since this feature shipped (thumbnail_svg is still null). Rebuilds
 *    a renderable model from the row-synced element engine (fetchElements + rowsToModel — the SAME
 *    reconstruction the planner itself uses to open a plan; see elementRows.js's own header on why
 *    hand-rolling a second one here would be a real risk, not a shortcut) rather than reading
 *    `sites.data`, whose els/parcels are deliberately emptied for a synced plan
 *    (cloudSync.js's slimForCloud — B672 read cutover).
 *
 * Both write via a plain `update`, deliberately OUTSIDE cloudSync.js's CAS/version-guarded upsert
 * engine — see site_thumbnail.sql's header for why that's the right call for a derived, always-
 * regenerable field (TIER-BY-REBUILDABILITY) with exactly one writer per plan and nothing to
 * conflict over. Best-effort throughout: a thumbnail is a rendering convenience (like
 * shared/sitePlans/lib/overlayRasterStorage.js's raster cache), never user data, so a failure here
 * is swallowed rather than surfaced (LOUD-FAILURE governs real writes, not this).
 */
import { supabase } from "./supabase.js";
import { planThumbnailSvg } from "./planThumbnail.js";
import { reportClientEvent } from "../../../shared/telemetry/clientErrors.js";

async function persistThumbnail(siteId, svg) {
  if (!supabase || !siteId) return { ok: false, error: "not ready" };
  try {
    // supabase-js REPORTS a failed write as `{ error }` (it does not throw) - the old code read
    // neither, so a rejected update looked exactly like success. (A-B1953794, LOUD-FAILURE.)
    const { error } = await supabase
      .from("sites")
      .update({ thumbnail_svg: svg, thumbnail_updated_at: new Date().toISOString() })
      .eq("id", siteId);
    return error ? { ok: false, error: error.message || String(error) } : { ok: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/* A-B1953794 - the thumbnail must follow ELEMENT-CONTENT saves. cloudUpsert's header signature
 * deliberately excludes elements (element edits return `skipped`), so keying the refresh on
 * `!skipped` left the thumbnail stale after any element-only edit. This refresher is keyed on the
 * RENDERED SVG itself: after a quiet period it renders the model and writes only if the picture
 * differs from the last one it persisted for that plan - exact by construction (no second
 * "did content change" predicate to drift), and a burst of edits costs one render + one write.
 * A failed write is REPORTED (telemetry) and the remembered picture is NOT advanced, so the very
 * next save retries. Injectable so the timing/failure contract is unit-testable. */
export function createThumbnailRefresher({
  render = (m) => planThumbnailSvg(m) || "",
  persist = persistThumbnail,
  report = reportClientEvent,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (t) => clearTimeout(t),
  delayMs = 3000,
} = {}) {
  const timers = new Map();   // siteId -> pending timer
  const latest = new Map();   // siteId -> newest model handed to schedule()
  const lastSvg = new Map();  // siteId -> svg last persisted successfully
  async function flush(id) {
    timers.delete(id);
    const model = latest.get(id);
    latest.delete(id);
    if (!model) return { skipped: true };
    let svg;
    try { svg = render(model); } catch (e) {
      report("thumbnail-refresh-failed", "plan thumbnail render threw", { id, error: (e && e.message) || String(e) });
      return { ok: false };
    }
    if (lastSvg.get(id) === svg) return { skipped: true };
    const r = await persist(id, svg);
    if (r && r.ok) { lastSvg.set(id, svg); return { ok: true }; }
    report("thumbnail-refresh-failed", "plan thumbnail write failed - the Dashboard card may show an older picture until the next save", { id, error: (r && r.error) || "" });
    return { ok: false };
  }
  return {
    schedule(model) {
      if (!model || !model.id) return;
      const id = model.id;
      latest.set(id, model);
      if (timers.has(id)) clearTimer(timers.get(id));
      timers.set(id, setTimer(() => { flush(id); }, delayMs));
    },
    flush,
    _lastSvg: lastSvg,
  };
}
const defaultRefresher = createThumbnailRefresher();

/** Debounced refresh from a live in-memory model (real els/parcels). Call after ANY successful
 * cloud save - element-only saves included. Never throws. */
export function scheduleThumbnailRefresh(model) { defaultRefresher.schedule(model); }

/** Immediate refresh (kept for callers that want it now). Never throws. */
export async function refreshSiteThumbnailFromModel(model) {
  if (!model || !model.id) return;
  const svg = planThumbnailSvg(model) || "";
  const r = await persistThumbnail(model.id, svg);
  if (r.ok) defaultRefresher._lastSvg.set(model.id, svg);
  else reportClientEvent("thumbnail-refresh-failed", "plan thumbnail write failed", { id: model.id, error: r.error || "" });
}

/** Lazily render + store a thumbnail for a plan that doesn't have one yet, from the cloud's own
 * row-synced element rows (never assumes the caller has this plan open/loaded locally). Returns
 * the SVG string (possibly "" if the plan has nothing drawable) so the caller can use it
 * immediately without a second read; returns null if it couldn't even attempt this (signed out,
 * fetch failed) — the caller should treat that the same as "still no thumbnail" and try again
 * another visit, never write a "" sentinel for a failure that wasn't a genuine empty-plan render. */
export async function generateAndStoreThumbnail(siteId) {
  if (!supabase || !siteId) return null;
  try {
    const [{ fetchElements }, { rowsToModel }] = await Promise.all([
      import("./elementApi.js"),
      import("./elementRows.js"),
    ]);
    const { data: headerRow } = await supabase.from("sites").select("data").eq("id", siteId).single();
    const r = await fetchElements(supabase, siteId);
    if (!r.ok) return null;
    const header = { settings: (headerRow && headerRow.data && headerRow.data.settings) || {} };
    const model = rowsToModel(header, r.rows);
    const svg = planThumbnailSvg(model) || "";
    const w = await persistThumbnail(siteId, svg);
    if (!w.ok) reportClientEvent("thumbnail-refresh-failed", "lazy plan thumbnail write failed", { id: siteId, error: w.error || "" });
    return svg;
  } catch (_) {
    return null;
  }
}
