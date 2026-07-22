/* Per-site GIS Layers-panel toggle memory (NEW-1).
 *
 * The app-shared `overlays` state is the LIVE source of truth for which overlay layers are on/off
 * (see SitePlannerApp.jsx). This module projects that state to/from a SPARSE per-site record so
 * reopening a site restores the layers you had on THERE — following the sheetOverlays.visible
 * per-site persistence pattern (B276/B277/B343), NOT the global coverage-relevance pref (B284).
 *
 * Persisted shape (site model `layerOverrides`): a sparse `{ [layerKey]: boolean }` map holding the
 * DESIRED `on` state ONLY for layers whose on-state differs from that layer's default. Every layer
 * defaults to OFF today, so in practice the map is "the layers currently on"; storing the DIFF
 * (not the absolute set) future-proofs a default-ON layer — turning it off is remembered too. A key
 * absent from the map = use the current default. That keeps the record tiny and forward-compatible:
 *   (a) a layer newly ADDED to ALL_LAYERS isn't in a saved map → it shows with its default,
 *   (b) a stale/removed key is IGNORED on apply (and self-prunes on the next save),
 *   (c) both on- and off-overrides are remembered.
 *
 * Deliberately NOT persisted: tiles/features (heavy, view-dependent), per-layer opacity, and the
 * corridor width — the brief scopes this to VISIBILITY (the on/off core); the numeric per-layer
 * settings stay session-only for now.
 */
import { ALL_LAYERS, defaultOverlayState } from "./layers.js";

// Coerce any persisted / candidate value into a clean `{ [key]: boolean }` map: keep only boolean
// values whose key is still a real layer in the registry (a removed layer's key is dropped). Returns
// a fresh {} for empty/garbage/legacy-absent input, so a record with no field behaves exactly as today.
export function sanitizeLayerOverrides(raw) {
  const out = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === "boolean" && ALL_LAYERS[k]) out[k] = v;
    }
  }
  return out;
}

// Project a full overlays state → the SPARSE on/off override map: a layer appears only when its
// current `on` differs from that layer's default `on`. Iterates the current registry defaults, so a
// key not in the registry can never be emitted (stale keys self-prune on the next save).
export function overridesFromOverlays(overlays) {
  const defaults = defaultOverlayState();
  const out = {};
  for (const [k, def] of Object.entries(defaults)) {
    const st = overlays && overlays[k];
    const on = !!(st && st.on);
    if (on !== !!def.on) out[k] = on;
  }
  return out;
}

// Apply a saved sparse on/off override map ON TOP of a fresh default overlays state, producing a full
// overlays object (opacity/widthFt at their defaults). Newly-added layers keep their defaults; stale
// keys are ignored. Used to REBUILD the shared overlays when a site opens.
export function overlaysWithOverrides(overrides) {
  const base = defaultOverlayState();
  const ov = sanitizeLayerOverrides(overrides);
  for (const [k, on] of Object.entries(ov)) if (base[k]) base[k] = { ...base[k], on };
  return base;
}

// Merge a saved on/off override map onto an EXISTING overlays object, preserving each layer's live
// opacity / widthFt (unlike overlaysWithOverrides, which resets them). A key absent from the map
// returns to that layer's default on-state. Used by undo/redo restore so reverting a layer toggle
// doesn't also disturb opacity. Reference-stable per layer (returns the same object when unchanged),
// so React can skip untouched layers.
export function applyOnOverrides(overlays, overrides) {
  const defaults = defaultOverlayState();
  const ov = sanitizeLayerOverrides(overrides);
  const out = {};
  for (const [k, st] of Object.entries(overlays || {})) {
    const wantOn = k in ov ? ov[k] : !!(defaults[k] && defaults[k].on);
    out[k] = st && !!st.on === wantOn ? st : { ...(st || {}), on: wantOn };
  }
  return out;
}

// Stable string signature of a sparse override map (registry-sanitized, sorted) — for the undo/redo
// histKey and cheap visibility-changed equality checks.
export function overridesSig(overrides) {
  const ov = sanitizeLayerOverrides(overrides);
  return Object.keys(ov).sort().map((k) => `${k}:${ov[k] ? 1 : 0}`).join(",");
}
