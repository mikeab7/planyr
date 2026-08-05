/* NEW-4 — THE PLAN IS THE SUBJECT. EVERY GIS LAYER IS REFERENCE, AND REFERENCE RECEDES.
 *
 * The owner's report, verbatim: with ten layers on, "the site plan is buried… nothing recedes
 * and the plan the owner is designing is the least legible thing on his own screen." He named
 * the cause exactly: *they are all shouting at the same volume.*
 *
 * He was right, and it was measurable. Before this module the shipped default opacities were
 * 0.95 (faults, traffic counts, rail, airports, EPA cleanups, road authority), 0.9 (oil & gas
 * wells, LPST), 0.85 (county / city / ISD boundaries, NHD flowlines) — eighteen of twenty-two
 * layers inside a 0.10 band, chosen one at a time, months apart, each defensible alone. There
 * was no model, so there was nothing to be inconsistent WITH.
 *
 * This is that model, and it is deliberately about DECISION IMPACT rather than geometry. Role
 * (area / line / point) already decides ORDER — that is `mapStack.js`, and it is a different
 * question with a different answer. This decides VOLUME:
 *
 *   • CONSTRAINT — it can stop you building, or it takes land: floodplain, drainage easements,
 *     pipelines and their corridors, faults, wetlands. Loudest, because being unable to see one
 *     is the expensive mistake.
 *   • REFERENCE — a fact you look up when you want it: utilities, cleanups, wells, rail.
 *     Quieter than the plan by construction.
 *   • CONTEXT — orientation furniture: jurisdiction and district boundaries, traffic counts,
 *     airports, hydrography inventory. Quietest; it should read as a wash you can ignore.
 *
 * ⛔ THE CEILINGS ARE ENFORCED, NOT SUGGESTED. `hierarchyProblems` is a CI guard
 * (test/layerHierarchy.test.js) that fails the build when any layer's shipped default breaks
 * its tier's ceiling, or when a layer has no declared tier at all. A markdown rule would have
 * rotted the same way the first eighteen defaults did — one reasonable exception at a time.
 *
 * ⛔ THIS IS A DEFAULT, NEVER A CAP ON THE USER. Every row keeps its own opacity control
 * (B1206) and its own "Show above plan" lift (B1205); a user who turns a layer up to 100% gets
 * 100%. What the model owns is where things START, which is the only thing the owner was ever
 * complaining about — he never asked for a layer he had already turned up.
 *
 * Pure: no React, no Leaflet, no DOM.
 */

export const TIERS = ["constraint", "reference", "context"];

/* Opacity ceiling per tier. A layer may ship QUIETER than its ceiling (several do — a big
 * translucent wash like the FEMA zones or the MUD boundaries would be overbearing at its
 * ceiling); it may never ship LOUDER. */
export const TIER_MAX_OPACITY = { constraint: 0.85, reference: 0.55, context: 0.4 };

/* Stroke-weight ceiling per tier, in the same units the layer configs use. The second half of
 * "shouting at the same volume": a 3 px reference centreline reads louder than a 1.5 px
 * constraint line whatever the opacity is, so weight has to be governed alongside it. */
export const TIER_MAX_WEIGHT = { constraint: 3, reference: 2, context: 1.6 };

/* ⛔ THE TIER IS DECLARED PER LAYER, NEVER INFERRED.
 *
 * Inference was tried and rejected: `group` is a PANEL taxonomy (where a row is listed) and
 * `role` is a STACKING fact (which pane it paints into). Neither answers "would not seeing this
 * cost the owner money". Oil & gas wells and drainage easements are both in the same group and
 * are not remotely the same kind of fact.
 *
 * A layer missing from this table fails the CI guard. That is on purpose: adding a layer is
 * exactly the moment to decide how loud it should be, and the moment it is cheapest. */
export const LAYER_TIER = {
  // ---- CONSTRAINT: it can stop you building, or it takes land off the site ----
  fema: "constraint",              // the floodplain — the single most expensive thing to miss
  wetlands: "constraint",          // a 404 permit is a schedule-killer
  txrrc_pipe: "constraint",        // a pipeline crossing the tract
  txrrc_pipe_easement: "constraint", // …and the easement it carries
  faults: "constraint",            // a growth fault under a slab
  bkdd_easements: "constraint",    // a district easement IS a hard buildable-area constraint
  hcfcd_row: "constraint",         // channel right-of-way, same
  bkdd_drainage: "constraint",     // district streams / BFE / sub-watersheds
  bkdd_dmp: "constraint",          // master-plan floodplains (advisory, but land-taking if adopted)
  fb_contours: "constraint",
  mhfd_drainage: "constraint",     // NEW-2 — the Colorado district tier
  mhfd_easements: "constraint",

  // ---- REFERENCE: a fact you look up when you want it ----
  txrrc_wells: "reference",
  env_lpst: "reference",
  env_cleanups: "reference",
  co_env_cleanups: "reference",    // NEW-2
  ccn_service: "reference",
  jur_mud: "reference",
  co_water_districts: "reference", // NEW-2
  coh_water: "reference",
  coh_ww: "reference",
  coh_storm: "reference",
  coh_hydrants: "reference",
  osm_hydrants: "reference",
  osm_power: "reference",
  hifld_tx: "reference",
  hifld_substations: "reference",
  bts_rail: "reference",
  mapillary: "reference",
  // Judgment calls worth naming, because both look like "context" and are not:
  // WHO MAINTAINS the frontage road decides who permits the access, and whether there is
  // a channel at all is a drainage FACT (it is the universal fallback where no district
  // publishes GIS — B1078). Neither is orientation furniture.
  jur_road_authority: "reference",
  nhd_flowlines: "reference",

  // ---- CONTEXT: orientation furniture ----
  jur_county: "context",
  jur_city: "context",
  jur_etj: "context",
  jur_isd: "context",
  co_city: "context",              // NEW-2
  co_isd: "context",
  co_metro_districts: "context",
  co_road: "context",
  txdot_aadt: "context",
  co_aadt: "context",
  faa_airports: "context",
};

/* Terrain is exempt from the VOLUME ceilings — it is the ground the plan sits on, and a contour
 * is a hairline whose whole job is to be readable where it crosses a building (that is the B1205
 * rule: line layers draw OVER the elements precisely so a building never hides the ground under
 * it). Fading contours to a context wash would undo that.
 *
 * ⛔ Exempt from the CEILINGS is NOT the same as exempt from the SWEEP, and conflating the two
 * was a real bug in the first cut of this module: the owner asked for a control that "leaves the
 * plan and the basemap", and contours are neither. They are an overlay he turned on and may want
 * off in the same click as everything else. The basemap needs no exemption at all — it is a
 * separate segmented control, not a member of the overlay registry. */
export const EXEMPT_IDS = new Set(["elevation", "contours", "flowdir", "aerial", "basemap"]);

export const tierOf = (id) => LAYER_TIER[id] || null;
export const isExempt = (id) => EXEMPT_IDS.has(id);

/* The default opacity a layer should SHIP with: its own declared default, clamped to its tier's
 * ceiling. A layer with no tier (or an exempt one) is returned untouched — the CI guard is what
 * makes the missing-tier case impossible, not a silent fallback here. Pure. */
export function defaultOpacityFor(id, declared) {
  const d = typeof declared === "number" && isFinite(declared) ? declared : 0.85;
  if (isExempt(id)) return d;
  const tier = tierOf(id);
  if (!tier) return d;
  return Math.min(d, TIER_MAX_OPACITY[tier]);
}

/* Same for a vector layer's stroke weight. Pure. */
export function defaultWeightFor(id, declared) {
  const w = typeof declared === "number" && isFinite(declared) ? declared : null;
  if (w == null || isExempt(id)) return w;
  const tier = tierOf(id);
  if (!tier) return w;
  return Math.min(w, TIER_MAX_WEIGHT[tier]);
}

/* ⛔ AGENCY-DRAWN LABELS ARE OFF BY DEFAULT.
 *
 * The owner's specific complaint — numbered well labels painted at full opacity straight across
 * his buildings — is a LABEL problem, not an opacity one: fading a label just makes an
 * illegible number sit on the building instead of a legible one. Two mechanisms, and both are
 * needed because we do not control every renderer:
 *
 *   1. A server-rendered (`kind: "dynamic"`) layer MUST pin its sublayers. `layers: null` sends
 *      no `layers=show:` at all, which tells the agency to render EVERY default-visible sublayer
 *      — and agency services routinely publish a separate LABEL sublayer beside the data one
 *      (the RRC's layer 0 is literally "Well Number", drawn at parcel zoom). Pinning is the only
 *      way to say "the data, not the annotation". `unpinnedDynamicLayers` is the CI guard.
 *   2. A vector layer we render ourselves declares `labelZoom` — and a POINT layer gets no
 *      standing label at all; its answer comes from hover / click identify, which is where an
 *      answer about one specific well belongs.
 * Pure. */
export function unpinnedDynamicLayers(layers = {}) {
  return Object.entries(layers)
    .filter(([, cfg]) => cfg && cfg.kind === "dynamic"
      && !(Array.isArray(cfg.layers) && cfg.layers.length)
      // An ACKNOWLEDGED exception, same discipline as the GIS registry's `monitored-exception`
      // tier: a config may stay unpinned only by declaring, in words, why its sublayer ids
      // cannot be read. Today that is exactly one layer (Fort Bend's contour service sends no
      // CORS headers and its catalog is unreachable from the build sandbox), and guessing at
      // ids would be worse than the annotation risk. The string is required, so the exception
      // can never be taken silently.
      && !cfg.sublayersUnpinned)
    .map(([id]) => id);
}

/* The CI guard. Returns a list of problem strings (empty = the hierarchy holds). Pure. */
export function hierarchyProblems(layers = {}) {
  const problems = [];
  for (const [id, cfg] of Object.entries(layers)) {
    if (!cfg || isExempt(id)) continue;
    const tier = tierOf(id);
    if (!tier) {
      problems.push(`${id}: no declared tier. Add it to LAYER_TIER as "constraint" (it can stop you building / takes land), "reference" (a fact you look up) or "context" (orientation furniture) — deciding this when the layer is added is the whole point.`);
      continue;
    }
    if (!TIERS.includes(tier)) { problems.push(`${id}: unknown tier "${tier}".`); continue; }
    const maxO = TIER_MAX_OPACITY[tier];
    if (typeof cfg.opacity === "number" && cfg.opacity > maxO + 1e-9) {
      problems.push(`${id}: default opacity ${cfg.opacity} exceeds the "${tier}" ceiling ${maxO}. Reference data must recede — the plan is the subject.`);
    }
    const maxW = TIER_MAX_WEIGHT[tier];
    if (typeof cfg.weight === "number" && cfg.weight > maxW + 1e-9) {
      problems.push(`${id}: default weight ${cfg.weight} exceeds the "${tier}" ceiling ${maxW}.`);
    }
  }
  for (const id of unpinnedDynamicLayers(layers)) {
    problems.push(`${id}: a server-rendered layer with no pinned \`layers\` — the agency will render EVERY default-visible sublayer, including any LABEL sublayer (e.g. the RRC's layer 0 "Well Number"). Pin the data sublayer ids explicitly.`);
  }
  return problems;
}

/* Which layers "turn all reference layers off" clears: EVERYTHING in the overlay registry.
 *
 * Deliberately not `EXEMPT_IDS` — see the note there. The basemap is not in this registry (it is
 * its own segmented Off/Aerial/USGS control), so "leaves the plan and the basemap" is satisfied
 * by construction, and terrain goes off with the rest because the owner turned it on the same
 * way he turned everything else on. Derived from the live registry rather than a baked list, so
 * a layer added tomorrow is swept the day it lands. Pure. */
export function sweepableLayerIds(layers = {}) {
  return Object.keys(layers);
}
