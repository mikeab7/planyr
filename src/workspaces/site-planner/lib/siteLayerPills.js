/* Site Analysis — "Show on the map" pills (NEW-1, 2026-10-05). Pure.
 *
 * Everything the panel will NOT issue a verdict for is offered as a layer you turn on yourself. A pill
 * is nothing but a handle on the SAME layer key(s) the Layers panel row uses — the panel holds no state
 * of its own, so the two cannot disagree (and a reload restores both from the plan's saved overrides).
 * No distances, no counts, no substation names (the source's name field is junk like "TAP"), no green.
 *
 * A pill is offered only for a layer that can actually draw where the site is: a layer whose registry
 * `states` excludes every region the site touches is left out rather than shown dead.
 */

/* Each pill: its Layers-panel keys, overall (`layers`) or by region (`byRegion`, the first matching
 * region wins and a straddle gets the union). `fallback` applies when the region has no entry. */
export const PILL_DEFS = Object.freeze([
  { id: "power", label: "Power lines", layers: ["hifld_tx"] },
  { id: "rail", label: "Rail", layers: ["bts_rail"] },
  { id: "traffic", label: "Traffic counts", byRegion: { TX: ["txdot_aadt"], CO: ["co_aadt"] } },
  { id: "contamination", label: "Contamination sites", byRegion: { TX: ["env_lpst", "env_cleanups"], CO: ["co_env_cleanups"] }, fallback: ["env_cleanups"] },
  { id: "faults", label: "Faults", byRegion: { TX: ["faults"] } },
]);

/* Checks that drop out of the verdict list outside their regions come back here as pills, on whatever
 * layer that region has for the same thing (FL/GA pipelines are the EIA approximations). Oil & gas wells
 * have no non-Texas layer yet (Colorado's ECMC is unwired), so there is deliberately no pill there. */
export const OFF_REGION_PILLS = Object.freeze({
  pipelines: { label: "Pipelines", byRegion: { FL: ["eia_gas", "eia_petroleum", "eia_crude", "eia_hgl"], GA: ["eia_gas", "eia_petroleum", "eia_crude", "eia_hgl"] } },
  wells: { label: "Oil & gas wells", byRegion: {} },
});

const MUTED_LINE = "Tap one to turn it on. These come from public maps that are often off, so Planyr doesn't flag them for you.";
export const PILLS_NOTE = MUTED_LINE;

const layerAvailable = (cfg, regions) => {
  if (!cfg) return false;
  if (!Array.isArray(cfg.states) || !cfg.states.length) return true;
  return regions.length === 0 || regions.some((r) => r === "?" || cfg.states.includes(r));
};

function resolveLayers(def, regions) {
  const out = [];
  const add = (keys) => { for (const k of keys || []) if (!out.includes(k)) out.push(k); };
  if (def.layers) add(def.layers);
  if (def.byRegion) {
    let any = false;
    for (const r of regions) if (def.byRegion[r]) { add(def.byRegion[r]); any = true; }
    if (!any && def.fallback) add(def.fallback);
  }
  return out;
}

/* The pills for a site. `regions` = siteRegions().regions; `untrusted` = ids of checks that dropped out;
 * `layers` = the registry (ALL_LAYERS), injected so this stays pure. Returns [{ id, label, layers }]. */
export function pillsFor({ regions = [], untrusted = [], layers = {} } = {}) {
  const out = [];
  const push = (id, label, keys) => {
    const usable = keys.filter((k) => layerAvailable(layers[k], regions));
    if (usable.length) out.push({ id, label, layers: usable });
  };
  for (const def of PILL_DEFS) push(def.id, def.label, resolveLayers(def, regions));
  for (const id of untrusted) {
    const def = OFF_REGION_PILLS[id];
    if (def) push(id, def.label, resolveLayers(def, regions));
  }
  return out;
}

/* A pill is ON when any of its layers is on — the Layers panel's own merged-row rule (jur_city + jur_etj). */
export const pillOn = (pill, isLayerOn) => pill.layers.some((k) => !!isLayerOn(k));
/* Toggle: turn every one of its layers to `!on`, through the caller's one layer writer. */
export function togglePill(pill, isLayerOn, setLayer) {
  const want = !pillOn(pill, isLayerOn);
  for (const k of pill.layers) setLayer(k, want);
  return want;
}
