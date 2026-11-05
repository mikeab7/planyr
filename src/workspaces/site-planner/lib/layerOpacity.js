/* A PROJECT's per-layer opacity — the pure rules (B2448033).
 *
 * Owner decision 2026-10-29: a GIS layer's opacity belongs to the PROJECT (the site group), not to a
 * plan. Every plan of a project draws each layer at the project's opacity; on/off stays per plan
 * (`layerOverrides`, layerPrefs.js). The single authority is the `project_layer_opacity` row
 * (db/project_layer_opacity.sql) written through layerOpacityStore.js — nothing here is stored on a
 * plan, and nothing here is a second copy of it.
 *
 * Shape: a SPARSE `{ [layerKey]: number }` holding ONLY layers whose opacity differs from that layer's
 * registry default. Absent = default, so every existing project opens exactly as it did before this
 * existed. Sanitised against the live registry on read AND on write: a removed layer's key is ignored
 * and self-prunes (opacityPatch emits a `null` for it, which deletes it server-side).
 *
 * The write unit is a PATCH of only the layers that changed — never the whole map — so a device with
 * a stale copy that touches one layer cannot revert another. See opacityPatch / the SQL header. */
import { ALL_LAYERS, defaultOverlayState } from "./layers.js";
import { OPACITY_MIN, OPACITY_MAX } from "./layerPanelModel.js";

/* The slider steps 0.05 and a typed % is a whole number, so two decimals is lossless; it also stops
 * float noise (0.6000000000000001) from reading as a change. */
const q = (v) => Math.round(v * 100) / 100;
const defaultOf = (k) => { const c = ALL_LAYERS[k]; return q((c && c.opacity) ?? 0.8); };

/* Any persisted / candidate value → a clean sparse `{ [key]: number }`: registry layers only, finite,
 * clamped to the slider's range, and dropped when it equals that layer's default. A fresh {} for
 * garbage / absent input. */
export function sanitizeLayerOpacity(raw) {
  const out = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw)) {
      if (!ALL_LAYERS[k] || typeof v !== "number" || !Number.isFinite(v)) continue;
      const n = q(Math.max(OPACITY_MIN, Math.min(OPACITY_MAX, v)));
      if (n !== defaultOf(k)) out[k] = n;
    }
  }
  return out;
}

/* A full overlays state → the sparse map: a layer appears only when its current opacity differs from
 * its default. Iterates the registry, so an unknown key can never be emitted. */
export function opacityFromOverlays(overlays) {
  const raw = {};
  for (const k of Object.keys(defaultOverlayState())) {
    const st = overlays && overlays[k];
    if (st && typeof st.opacity === "number") raw[k] = st.opacity;
  }
  return sanitizeLayerOpacity(raw);
}

export const opacitySig = (map) => {
  const m = sanitizeLayerOpacity(map);
  return Object.keys(m).sort().map((k) => `${k}:${m[k]}`).join(",");
};

/* Put the project's opacity onto an overlays object: every layer gets `map[k]`, else its default.
 * Reference-stable (returns the INPUT when nothing moved, and the same inner object per untouched
 * layer) — the applyOnOverrides rule, for the same reason: three effects key off `overlays` identity
 * and an opacity-neutral call must not tear the Leaflet stack down. on / above / widthFt untouched. */
export function applyLayerOpacity(overlays, map) {
  const m = sanitizeLayerOpacity(map);
  const out = {};
  let changed = false;
  for (const [k, st] of Object.entries(overlays || {})) {
    const want = k in m ? m[k] : defaultOf(k);
    if (st && typeof st.opacity === "number" && q(st.opacity) === want) { out[k] = st; continue; }
    out[k] = { ...(st || {}), opacity: want };
    changed = true;
  }
  return changed ? out : (overlays || out);
}

/* The PATCH that turns `prev` into `next`: `{key: number}` for a layer set/changed, `{key: null}` for a
 * layer returned to default. `storedRaw` is the server's raw map; any key in it that is no longer a
 * registry layer is added as `null` so a removed layer's key self-prunes on the next write. */
export function opacityPatch(prev, next, storedRaw = null) {
  const a = sanitizeLayerOpacity(prev), b = sanitizeLayerOpacity(next);
  const patch = {};
  for (const k of Object.keys(b)) if (a[k] !== b[k]) patch[k] = b[k];
  for (const k of Object.keys(a)) if (!(k in b)) patch[k] = null;
  if (storedRaw && typeof storedRaw === "object") {
    for (const k of Object.keys(storedRaw)) if (!ALL_LAYERS[k]) patch[k] = null;
  }
  return patch;
}

/* Fold a patch into a sparse map (null = remove). The result is sanitised, so a no-op patch returns an
 * equal map. Used to lay still-pending local changes over what the server just said. */
export function applyPatch(map, patch) {
  const out = { ...sanitizeLayerOpacity(map) };
  for (const [k, v] of Object.entries(patch || {})) { if (v === null) delete out[k]; else out[k] = v; }
  return sanitizeLayerOpacity(out);
}
