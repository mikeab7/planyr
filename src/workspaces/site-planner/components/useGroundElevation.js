/* useGroundElevation (B706) — ground elevation (survey feet, NAVD88) at a hovered
 * WGS84 point, for the cursor coordinate chips on BOTH map surfaces.
 *
 * Two paths, in order:
 *  1. FREE + INSTANT: if a terrain layer has a decoded DEM grid covering the view
 *     (terrainLayers grid LRU), bilinear-sample it locally on every move — zero
 *     network. Sampling the UNSMOOTHED grid keeps the readout in agreement with the
 *     cross-section tool.
 *  2. FALLBACK: no covering grid → ONE debounced getSamples point call after the
 *     cursor rests ~300 ms (never per-mousemove). A superseded request is aborted
 *     and its result is tied to the position it was asked for — a slow response can
 *     never paint a stale number under a new cursor position.
 *
 * Returns feet (number) or null. Null covers "unknown yet", "no data here (water/
 * void)", and "request failed" alike — the chip simply omits the elevation segment;
 * a confident-looking wrong number is worse than a blank (no-auto-guess).
 */
import { useEffect, useRef, useState } from "react";
import { sampleTerrainGrids } from "../lib/terrainLayers.js";
import { samplePoint } from "../lib/elevation.js";

const DEBOUNCE_MS = 300;

export function useGroundElevation(pos) {
  const [ft, setFt] = useState(null);
  const timerRef = useRef(null);
  const ctrlRef = useRef(null);
  const posRef = useRef(null);
  const lat = pos ? pos.lat : null, lng = pos ? pos.lng : null;
  useEffect(() => {
    posRef.current = pos ? { lat, lng } : null;
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (ctrlRef.current) { ctrlRef.current.abort(); ctrlRef.current = null; }
    if (lat == null || lng == null) { setFt(null); return undefined; }
    const local = sampleTerrainGrids(lat, lng);
    if (local !== undefined) { setFt(local); return undefined; } // covered: value, or null over a void (suppress)
    setFt(null);
    timerRef.current = setTimeout(async () => {
      timerRef.current = null;
      const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      ctrlRef.current = ctrl;
      try {
        const v = await samplePoint(lat, lng, { signal: ctrl ? ctrl.signal : undefined });
        const cur = posRef.current;
        if (cur && cur.lat === lat && cur.lng === lng) setFt(v);
      } catch (_) {
        /* aborted (cursor moved on) or network blip — show nothing, never a guess */
      } finally {
        if (ctrlRef.current === ctrl) ctrlRef.current = null;
      }
    }, DEBOUNCE_MS);
    return () => {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      if (ctrlRef.current) { ctrlRef.current.abort(); ctrlRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng]);
  return ft;
}

export const GROUND_EL_TITLE =
  "Ground elevation at the cursor — USGS 3DEP LiDAR bare-earth, NAVD88. Screening only — verify with survey.";
