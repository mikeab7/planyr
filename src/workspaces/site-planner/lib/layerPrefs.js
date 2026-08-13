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
 *
 * NEW-1 — A SECOND, SEPARATE SPARSE MAP: `layerAbove` (site model field of the same name), the
 * per-site memory of which layers the user LIFTED with "Show above plan". It is deliberately its
 * own field rather than a richer value inside `layerOverrides`, because every function above and
 * every saved record already speaks plain booleans there — a second field is purely additive, so
 * no existing site record, merge or undo frame changes meaning. Same discipline in every respect:
 * sparse (only layers actually lifted), registry-sanitized on read AND on write (a removed layer's
 * key self-prunes), absent field = nothing lifted = today's behaviour, and only layers the lift
 * can actually MOVE are stored (an already-over-the-plan line layer has nothing to remember).
 */
import { ALL_LAYERS, defaultOverlayState } from "./layers.js";
import { configCanLift } from "./mapStack.js";

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

// NEW-1 — the "Show above plan" twin of sanitizeLayerOverrides. Additionally drops any key whose
// layer CANNOT be lifted (a line/point source is over the plan already), so a stale or nonsensical
// flag can never reach the renderer and ask for a band that doesn't apply to it.
const liftable = (k) => !!(ALL_LAYERS[k] && configCanLift(ALL_LAYERS[k]));

export function sanitizeLayerAbove(raw) {
  const out = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw)) if (v === true && liftable(k)) out[k] = true;
  }
  return out;
}

// Project a full overlays state → the SPARSE lifted map: a layer appears only when it is actually
// lifted. Sanitised on the way out as well as on the way in, so a key not in the live registry (or
// one for a layer the lift can't move) can never be emitted and self-prunes on the next save.
// `false` is simply absence — there is no "off" override to record, because the default is off for
// every layer and always will be (the whole design).
export const aboveFromOverlays = (overlays) => sanitizeLayerAbove(
  Object.fromEntries(Object.entries(overlays || {}).map(([k, st]) => [k, !!(st && st.above === true)])),
);

// Apply a saved sparse on/off override map ON TOP of a fresh default overlays state, producing a full
// overlays object (opacity/widthFt at their defaults). Newly-added layers keep their defaults; stale
// keys are ignored. Used to REBUILD the shared overlays when a site opens.
// NEW-1 — `above` is the second (optional) saved map: which layers this site had lifted above the
// plan. Absent → every layer sits at its default band, which is exactly the pre-NEW-1 behaviour.
export function overlaysWithOverrides(overrides, above = null) {
  const base = defaultOverlayState();
  const ov = sanitizeLayerOverrides(overrides);
  for (const [k, on] of Object.entries(ov)) if (base[k]) base[k] = { ...base[k], on };
  return applyAboveOverrides(base, above); // ONE place decides which layers sit in the lifted band
}

// Merge a saved lifted map onto an EXISTING overlays object, preserving on/opacity/widthFt — the
// applyOnOverrides twin, used by the same undo/redo restore so reverting a lift doesn't disturb
// anything else. A key absent from the map returns that layer to the default band (not lifted).
// Reference-stable per layer, so React can skip untouched layers.
export function applyAboveOverrides(overlays, above) {
  const ab = sanitizeLayerAbove(above);
  const out = {};
  let changed = false;
  for (const [k, st] of Object.entries(overlays || {})) {
    if (!liftable(k)) { out[k] = st; continue; }
    const want = ab[k] === true;
    if (st && !!st.above === want) { out[k] = st; continue; }
    out[k] = { ...(st || {}), above: want };
    changed = true;
  }
  return changed ? out : (overlays || out); // NEW-1 (B385040) — see applyOnOverrides
}

// Stable string signature of a sparse lifted map — the aboveSig twin of overridesSig, for the
// undo/redo histKey so a lift is its own undoable frame exactly like a visibility toggle.
export const aboveSig = (above) => Object.keys(sanitizeLayerAbove(above)).sort().join(",");

// Merge a saved on/off override map onto an EXISTING overlays object, preserving each layer's live
// opacity / widthFt (unlike overlaysWithOverrides, which resets them). A key absent from the map
// returns to that layer's default on-state. Used by undo/redo restore so reverting a layer toggle
// doesn't also disturb opacity. Reference-stable per layer (returns the same object when unchanged),
// so React can skip untouched layers.
//
// ⛔ NEW-1 (B385040) — AND REFERENCE-STABLE FOR THE WHOLE MAP, not just per layer. This function
// carefully preserved each INNER layer state's identity when unchanged, and then handed back a
// BRAND-NEW OUTER object every single call. Three effects in SitePlanner.jsx key off `overlays`
// identity — the layer staging/sync effect (whose cleanup clears its intervals and idle callbacks
// and then re-stages and RE-ADDS the entire Leaflet overlay stack), the coverage recompute, and the
// persist — so an undo that touched no layer at all still tore the whole GIS stack down and put it
// back. That is the owner's "the screen flashes on every ctrl z".
//
// Returning the INPUT when nothing moved is the half of the fix that no caller can undo by being
// written carelessly: the guard lives with the value rather than with each consumer. (`applySnapshot`
// additionally skips the setState entirely on a matching `overridesSig`, so React is not even asked;
// this one makes the answer safe for every other caller, present and future.)
export function applyOnOverrides(overlays, overrides) {
  const defaults = defaultOverlayState();
  const ov = sanitizeLayerOverrides(overrides);
  const out = {};
  let changed = false;
  for (const [k, st] of Object.entries(overlays || {})) {
    const wantOn = k in ov ? ov[k] : !!(defaults[k] && defaults[k].on);
    if (st && !!st.on === wantOn) { out[k] = st; continue; }
    out[k] = { ...(st || {}), on: wantOn };
    changed = true;
  }
  return changed ? out : (overlays || out);
}

// Stable string signature of a sparse override map (registry-sanitized, sorted) — for the undo/redo
// histKey and cheap visibility-changed equality checks.
export function overridesSig(overrides) {
  const ov = sanitizeLayerOverrides(overrides);
  return Object.keys(ov).sort().map((k) => `${k}:${ov[k] ? 1 : 0}`).join(",");
}
