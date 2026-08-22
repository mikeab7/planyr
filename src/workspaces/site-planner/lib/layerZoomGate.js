/* NEW-1 — THE ONE ANSWER TO "IS THIS LAYER ACTUALLY DRAWING RIGHT NOW?", and the reason
 * it is a shared model rather than a note on the contour row.
 *
 * The owner's report (Tsakiris, Waller County, 2026-08-09): he checked "Contour lines
 * (1 ft)" while zoomed out below the z16 terrain gate. The checkbox rendered fully ON, the
 * map drew nothing, and he sat for a full minute believing the feature had failed. His
 * words: "it should be more obvious that that's what's going on… it's not clear to me that
 * it's failing, I guess."
 *
 * ⛔ THE PANEL ALREADY CARRIED AN EXPLANATION AND THAT IS THE DEFECT, NOT THE FIX. The row
 * showed "Zoom in to ≥ 16 to load (1-ft detail needs close zoom)" — STATIC helper text that
 * renders identically whether the layer is currently drawing or not, sitting under a
 * checkbox that says ON. A sentence describing a rule is not a report of a state. So this
 * module computes LIVE STATE from the ACTUAL current zoom, and the row renders that.
 *
 * ⛔ AND THE GATE IS NOT A CONTOUR FACT — IT IS A PROPERTY OF NEARLY EVERY LAYER HERE.
 * Auditing them produced the reason this is generalized rather than patched:
 *
 *   • `featureLayerOptions` passes `minZoom: cfg.minZoom ?? 10` to Leaflet, so EVERY
 *     `esriFeature` layer is gated at zoom 10 whether or not its registry row says so —
 *     and Leaflet simply declines to draw, reporting NOTHING. Those rows showed a GREEN
 *     "loaded" dot over an empty map. That is strictly worse than the contour case the
 *     owner reported, because there was not even a sentence to eventually decode.
 *   • `vectorOverlay` gates on `cfg.minZoom` and reports an `empty` status.
 *   • the terrain pipeline gates on `TERRAIN_MIN_ZOOM`, and the OSM / Mapillary evidence
 *     layers on their own module constants — none of which the registry declared, so the
 *     panel could not have known about them at all.
 *
 * The rule that falls out: a layer's gate is a function of its KIND plus its declared
 * `minZoom`, both of which live in the registry — so a new gated layer gets the dormant
 * treatment for free by declaring `minZoom`, with the kind fallbacks below as the safety
 * net for one that forgets. `test/layerZoomGate.test.js` asserts the declared numbers and
 * the runtime constants agree, so the panel and the map can never disagree about the gate.
 *
 * PURE, and it imports exactly one leaf (`terrainGate.js`, which imports nothing) — the
 * B1095 discipline: reading a gate must never drag a pipeline onto the boot bundle.
 */

import { TERRAIN_MIN_ZOOM } from "./terrainGate.js";

/* The evidence-layer gates. They lived as module-private constants inside
 * `evidenceLayers.js`, which is why nothing outside it could see them; that module now
 * imports them from here so there is ONE number per gate, not two that can drift. */
export const OSM_MIN_ZOOM = 14;        // OSM power/hydrant data is dense — don't fetch zoomed out
export const MAPILLARY_MIN_ZOOM = 16;  // Mapillary bbox must be < 0.01° — high zoom only

/* `featureLayerOptions`'s own default. An `esriFeature` row with no declared `minZoom`
 * is STILL gated — at 10 — because that is the value handed to Leaflet. Naming it here is
 * what makes the invisible half of this bug family visible. */
export const ESRI_FEATURE_DEFAULT_MIN_ZOOM = 10;

export { TERRAIN_MIN_ZOOM };

/* Kinds whose gate is a fixed constant the registry does not (and need not) own. */
const KIND_GATE = {
  contours: TERRAIN_MIN_ZOOM,
  flowdir: TERRAIN_MIN_ZOOM,
  overpass: OSM_MIN_ZOOM,
  mapillary: MAPILLARY_MIN_ZOOM,
};

/* Kinds that gate on the registry's own `minZoom` and nothing else. A `vector` layer below
 * its source's `minVectorZoom` still DRAWS (it falls back to the flat image service), so
 * that is deliberately not a gate — only `cfg.minZoom` is. */
const REGISTRY_GATED = new Set(["vector", "vectorLine", "pipelineCorridor"]);

/* Kinds that are never zoom-gated: a raster export draws at any scale. Listed rather than
 * inferred so that adding a kind is a decision somebody made, not an omission. */
const UNGATED = new Set(["esriDynamic", "esriImage"]);

/* THE gate, in Leaflet zoom levels — the lowest zoom at which this layer paints anything.
 * `null` means "this layer has no zoom gate", which is a different answer from 0. */
export function layerMinZoom(cfg) {
  if (!cfg) return null;
  const kind = cfg.kind;
  if (UNGATED.has(kind)) return null;
  if (Object.prototype.hasOwnProperty.call(KIND_GATE, kind)) {
    // A declared value still wins — it is what the registry says the row does, and the
    // consistency test below pins the two together.
    return typeof cfg.minZoom === "number" ? cfg.minZoom : KIND_GATE[kind];
  }
  if (kind === "esriFeature") {
    return typeof cfg.minZoom === "number" ? cfg.minZoom : ESRI_FEATURE_DEFAULT_MIN_ZOOM;
  }
  if (REGISTRY_GATED.has(kind)) return typeof cfg.minZoom === "number" ? cfg.minZoom : null;
  return typeof cfg.minZoom === "number" ? cfg.minZoom : null;
}

/* How far the user has to go, in whole zoom levels, phrased the way the row says it.
 * Always at least 1: a row that says "zoom in 0 levels" is a bug pretending to be advice. */
export function levelsToGate(zoom, minZoom) {
  if (typeof zoom !== "number" || typeof minZoom !== "number") return null;
  return Math.max(1, Math.ceil(minZoom - zoom - 1e-6));
}

/* A hair above the gate, so a zoom-to-fix lands unambiguously INSIDE it. The gates are all
 * strict (`z < min` suppresses), and both the map's committed zoom and the drawing's own
 * zoom are fractional and derived through `ppfToZoom`, so aiming exactly AT the number
 * risks landing a rounding step below it and fixing nothing. */
export const GATE_CLEARANCE = 0.05;

/* WHAT THIS ROW IS DOING RIGHT NOW. Four states, and they are the four the owner has to be
 * able to tell apart:
 *
 *   "off"            — unchecked. Nothing is claimed.
 *   "drawing"        — checked and past every gate: what you see is what this layer has.
 *   "dormant-zoom"   — checked, but the current zoom suppresses it. FIXABLE, and the row
 *                      carries the fix.
 *   "dormant-blank"  — checked and past the gate, but there is nothing here to draw: the
 *                      source's data does not reach this area, it answered with nothing, or
 *                      there is no source wired up for this kind/location at all.
 *                      Not fixable by zooming, and the row must not pretend otherwise.
 *
 * The zoom gate is asked FIRST and outranks the blank test on purpose: below the gate the
 * layer never asked the source anything, so "no data here" would be a fabrication. (It is
 * also how the terrain pipeline's own `empty` status — which carries the old static
 * sentence — is kept from being read as an answer about coverage.)
 *
 * ⛔ B685200 (NEW-1, 2026-08-22) — "unregistered" WAS FALLING INTO THE DEFAULT "drawing"
 * BRANCH, and that is the whole defect this fixes. Measured live: "Water & sanitation
 * districts (Colorado)" is a mergeGroup member of "Water & sewer" with a `kind: "vector"`
 * registry row but no matching `VECTOR_SOURCES` entry (layers.js's `cachedVectorLayer`
 * returns null, so `fail()` reports it), and the row still read `data-layer-state="drawing"`
 * — a checked layer that admits (in its own status message) it has no registered source
 * cannot possibly be drawing anything.
 *
 * THE DISCRIMINATOR is not "did the fetch fail" — it is "can this EVER succeed." A registry
 * gap (`state: "unregistered"`, set only at the two `layers.js` call sites that report "no
 * vector/pipeline source registered") will never resolve on retry, in any environment, for
 * any user — the exact shape `dormant-blank` already exists for: checked, past the gate,
 * permanently nothing to draw. So it gets the SAME hollow-dot/muted-row treatment as an
 * honest empty query, via its own `why: "no-source"`.
 *
 * A genuinely FAILED live source (`state: "failed"` — a network error, a stalled agency, a
 * timeout) is DELIBERATELY left exactly as it was: still "drawing" with its own loud red dot
 * and message. That is not an oversight — it is the opposite fact from "unregistered": a real
 * outage is often transient and worth an active RED alert (the KEY DECISIONS rule: red is
 * reserved for a genuine, actionable alert), where folding it into the same quiet dormant
 * treatment as "nothing here" would bury a live problem. See
 * `test/layerZoomGate.test.js` — "a failure stays a failure" pins that this is unchanged.
 */
export function layerVisibility({ cfg, on, zoom, status = null, coverage = null } = {}) {
  const minZoom = layerMinZoom(cfg);
  if (!on) return { state: "off", minZoom, levels: null };
  const gated = typeof minZoom === "number" && typeof zoom === "number" && zoom < minZoom;
  if (gated) {
    return { state: "dormant-zoom", minZoom, levels: levelsToGate(zoom, minZoom), target: minZoom + GATE_CLEARANCE };
  }
  const st = status && status.state;
  // "loading" is a state of its own and is neither dormant nor a finished answer — the
  // pulsing dot already says so, and calling an in-flight layer blank is the LOUD-FAILURE
  // inversion (reporting an answer nobody has yet).
  if (st === "loading") return { state: "drawing", minZoom, levels: null };
  // B685200 — a registry-drift failure can never succeed; fold it into dormant-blank before
  // the coverage/empty checks (which answer a different question: a source that DOES exist).
  if (st === "unregistered") return { state: "dormant-blank", minZoom, levels: null, why: "no-source" };
  if (coverage === "out") return { state: "dormant-blank", minZoom, levels: null, why: "out-of-area" };
  if (st === "empty") return { state: "dormant-blank", minZoom, levels: null, why: "nothing-here" };
  return { state: "drawing", minZoom, levels: null };
}

/* The row's ONE live line for a dormant-zoom layer. It REPLACES the static
 * "Zoom in to ≥ 16 to load" sentence rather than joining it (PANEL-BREVITY rule 2), and it
 * is phrased as the action because clicking it performs the action. */
export function dormantZoomLine(levels) {
  const n = typeof levels === "number" && levels > 0 ? levels : 1;
  return `Not showing at this zoom — zoom in ${n} level${n === 1 ? "" : "s"}`;
}

/* A panel ROW is not always one layer: "City limits & ETJ" drives two, and the consolidated
 * utility rows (Water & sewer / Electric / Fire hydrants) drive several — with DIFFERENT
 * gates. A row is dormant only when every ON member is, and the level it offers to zoom to is
 * the EASIEST one to reach, because reaching it is what makes the row start drawing at all.
 * `members` is [{ cfg, on, status, coverage }]. */
export function combineVisibility(members = []) {
  const live = members.filter((m) => m && m.on);
  if (!live.length) return { state: "off", minZoom: null, levels: null };
  const each = live.map((m) => layerVisibility(m));
  if (each.some((v) => v.state === "drawing")) return { state: "drawing", minZoom: null, levels: null };
  const gated = each.filter((v) => v.state === "dormant-zoom");
  if (gated.length === each.length) {
    // The shallowest gate wins: clearing it is what puts something on the map.
    return gated.reduce((a, b) => (b.minZoom < a.minZoom ? b : a));
  }
  // A mix of gated and blank members: the row cannot honestly offer one zoom that fixes it,
  // so it reports blank — the state that claims no action.
  const blank = each.find((v) => v.state === "dormant-blank");
  return blank || each[0];
}

export const DORMANT_BLANK_LINE = {
  "out-of-area": "Not showing here — this layer's data stops short of this area.",
  "nothing-here": "Nothing to show here — this layer covers the area and found none.",
  // B685200 — a registry-drift failure (no source wired up for this kind/location at all).
  // Deliberately plain — never the internal "no vector source registered" wording, which is
  // a developer-facing diagnostic, not something to hand a user as if it were their problem.
  "no-source": "Not showing here — Planyr doesn't have a data source wired up for this one yet.",
};
