/* useGroundElevation (B706, reworked by NEW-2) — ground elevation (survey feet, NAVD88)
 * at a hovered WGS84 point, for the cursor coordinate chips on BOTH map surfaces.
 *
 * IT NOW ALWAYS RETURNS A STATE, NEVER NOTHING. B706 collapsed "unknown yet", "no data
 * here" and "the request failed" into a bare null, and the chip rendered null as
 * ABSENCE — so the elevation silently disappeared whenever the fast local path wasn't
 * available, which reads as a glitch and is indistinguishable from a genuine void. The
 * no-fabrication rule stays exactly as it was; only the silence is gone. Callers get
 * { status: "value"|"pending"|"void"|"unavailable"|"idle", ft, cellFt } and lib/
 * groundReadout.js turns that into the one line both chips paint.
 *
 * Three paths, in order:
 *  1. FREE + INSTANT: a decoded DEM grid covering the point (the lattice grid LRU) is
 *     bilinear-sampled on every move — zero network. Sampling the UNSMOOTHED grid keeps
 *     the readout in agreement with the cross-section tool (V242: within 0.40 ft).
 *  2. WARM THE FAST PATH (NEW-2 b): no covering grid → ask terrainLayers to pull the ONE
 *     lattice tile under the cursor, whatever the layer toggles say and whatever the
 *     zoom is. The z16 gate is a CARTOGRAPHY judgment about 1-ft contour LINES on a
 *     coarse cell; it was never a reason to refuse to sample a POINT, and treating it as
 *     one is what left path 3 running alone in the common case. With contours already on
 *     this is a plain cache hit. When the tile lands, the cursor re-samples locally and
 *     every subsequent move is instant.
 *  3. FALLBACK, while the tile is in flight: ONE debounced getSamples point call after
 *     the cursor rests ~300 ms (never per-mousemove). A superseded request is aborted and
 *     its result tied to the position it was asked for, so a slow response can never
 *     paint a stale number under a new cursor position.
 */
import { useEffect, useRef, useState } from "react";
import { sampleTerrainGridsInfo, warmCursorGrid } from "../lib/terrainLayers.js";
import { samplePoint } from "../lib/elevation.js";

const DEBOUNCE_MS = 300;
const IDLE = { status: "idle" };

export function useGroundElevation(pos, { zoom = null } = {}) {
  const [st, setSt] = useState(IDLE);
  const timerRef = useRef(null);
  const ctrlRef = useRef(null);
  const posRef = useRef(null);
  const lat = pos ? pos.lat : null, lng = pos ? pos.lng : null;
  // The warm pull is keyed on the BAND, not the raw zoom, so a fractional planner zoom
  // doesn't re-key the effect on every wheel notch.
  const band = Number.isFinite(zoom) ? Math.round(zoom) : null;
  useEffect(() => {
    posRef.current = lat == null ? null : { lat, lng };
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (ctrlRef.current) { ctrlRef.current.abort(); ctrlRef.current = null; }
    if (lat == null || lng == null) { setSt(IDLE); return undefined; }
    const here = () => { const c = posRef.current; return !!c && c.lat === lat && c.lng === lng; };
    const local = sampleTerrainGridsInfo(lat, lng);
    if (local.status === "value") { setSt({ status: "value", ft: local.ft, cellFt: local.cellFt }); return undefined; }
    if (local.status === "void") { setSt({ status: "void" }); return undefined; }
    // Uncovered: say so honestly while both the tile pull and the point sample run.
    setSt({ status: "pending" });
    let alive = true;
    warmCursorGrid(lat, lng, band).then(
      () => {
        if (!alive || !here()) return;
        const again = sampleTerrainGridsInfo(lat, lng);
        if (again.status === "value") setSt({ status: "value", ft: again.ft, cellFt: again.cellFt });
        else if (again.status === "void") setSt({ status: "void" });
      },
      () => { /* the debounced point sample below owns the LOUD failure state */ },
    );
    timerRef.current = setTimeout(async () => {
      timerRef.current = null;
      const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      ctrlRef.current = ctrl;
      try {
        const v = await samplePoint(lat, lng, { signal: ctrl ? ctrl.signal : undefined });
        if (here()) setSt(v == null ? { status: "void" } : { status: "value", ft: v });
      } catch (e) {
        // An abort means the cursor moved on and a newer effect owns the state — never
        // report that as a failure. Anything else IS a failure, and says so (LOUD-FAILURE).
        const aborted = (e && (e.name === "AbortError" || (ctrl && ctrl.signal && ctrl.signal.aborted)));
        if (!aborted && here()) setSt({ status: "unavailable", reason: (e && e.message) || "elevation source failed" });
      } finally {
        if (ctrlRef.current === ctrl) ctrlRef.current = null;
      }
    }, DEBOUNCE_MS);
    return () => {
      alive = false;
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      if (ctrlRef.current) { ctrlRef.current.abort(); ctrlRef.current = null; }
    };
  }, [lat, lng, band]);
  return st;
}

export const GROUND_EL_TITLE =
  "Ground elevation at the cursor — USGS 3DEP LiDAR bare-earth, NAVD88. Screening only — verify with survey.";
