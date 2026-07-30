/* Hover / click identify for the RASTER-painted map layers (NEW-2). Pure + injectable —
 * no leaflet import, so it unit-tests in the node env; the leaflet glue is in layers.js.
 *
 * THE CONSTRAINT THIS EXISTS FOR. Roughly half the overlay registry does not paint features
 * at all: FEMA flood zones, wetlands, RRC wells, the CCN/MUD service territories, the City of
 * Houston water / wastewater / storm mains, HCFCD channels, the BKDD drainage sheets and the
 * pipeline layer's zoomed-out tier are all served as a server-rendered PICTURE — an ArcGIS
 * MapServer `export` with `f=image`, deliberately loaded through a CORS-exempt <img> so it
 * renders from hosts that send no CORS headers. There are NO features in the DOM for those
 * layers, so no amount of tooltip binding can ever make them answer a hover: a picture has
 * nothing to bind to. The only way to ask "what is under the cursor" of a raster layer is to
 * ask the SERVICE, via its `/identify` operation.
 *
 * WHAT THIS IS NOT. It is not a second source-health mechanism. A layer whose health probe
 * already said "failed" is skipped by the caller's `layerHealthy` gate rather than re-tested
 * here (`probeService` in layers.js remains the one prober), and a layer that is toggled off
 * is never identified.
 *
 * WHAT IT REFUSES TO DO. `identifyCapable` declines anything it cannot honestly answer:
 *   • a FeatureServer — `/identify` is a MapServer operation; those layers paint as vectors
 *     and get the featureHover.js tooltip path instead.
 *   • an ImageServer (`kind: "esriImage"` — the elevation shading) — its identify returns a
 *     PIXEL VALUE, not a feature, and elevation under the cursor already has its own honest
 *     readout (groundReadout.js / the 3DEP sample). Declining beats inventing a second answer.
 *   • a registry row that opts out (`identify: false`).
 * A declined layer is reported as `unsupported`, never as a failure and never as silence —
 * "this layer can't tell you" is itself an answer, and a spinner that never resolves is the
 * one outcome LOUD-FAILURE forbids here.
 */

import { titleCaseAgency } from "./featureHover.js";

const trimUrl = (u) => String(u || "").replace(/\/+$/, "");

/* Identify's tolerance is in SCREEN PIXELS against the map frame we describe to it, so it
 * scales with zoom for free — a few px is a forgiving target for a thin main or a flood-zone
 * boundary without grabbing something a quarter-mile away. */
export const IDENTIFY_TOLERANCE_PX = 4;

/* How long the cursor must REST before we ask the network. Long enough that sweeping the
 * mouse across the map fires nothing (the owner should never generate a burst of agency
 * requests just by moving), short enough to feel like hover rather than a click. */
export const HOVER_IDENTIFY_DEBOUNCE_MS = 300;

/* How long a single identify may take before we call it unreachable. Agency MapServers stall
 * (the FEMA slowdown that motivated B790's stall watchdog); an indefinite hang would leave a
 * readout pending forever, which is exactly the "spinner that never resolves" this must not do. */
export const IDENTIFY_TIMEOUT_MS = 6000;

/* Can this layer's service answer an identify at a point? */
export function identifyCapable(cfg) {
  if (!cfg || !cfg.url) return false;
  if (cfg.identify === false) return false;
  // Vector layers answer through featureHover.js / vectorOverlay.js, not here.
  if (cfg.kind === "esriFeature" || cfg.kind === "vector" || cfg.kind === "vectorLine"
      || cfg.kind === "pipelineCorridor" || cfg.kind === "overpass" || cfg.kind === "mapillary"
      || cfg.kind === "contours" || cfg.kind === "flowdir") return false;
  if (cfg.kind === "esriImage") return false; // ImageServer → a pixel value, not a feature
  return /\/MapServer$/i.test(trimUrl(cfg.url));
}

/* Which sublayers to interrogate. A registry row pins the sublayers it DRAWS (`cfg.layers`);
 * identify must ask about exactly those and no others, or it would report a feature from a
 * sublayer the user cannot see. With none pinned the service's own visible set is right. */
export function identifyLayersParam(cfg) {
  const ids = cfg && cfg.layers;
  return Array.isArray(ids) && ids.length ? `all:${ids.join(",")}` : "all";
}

/* The identify request for a point, as { url, params }. `frame` describes the CURRENT map
 * viewport — extent in lon/lat plus pixel size — because identify resolves its pixel
 * tolerance against the frame you give it. Passing the real viewport (rather than a synthetic
 * box, as arcgis.js's parcel fallback does) means the tolerance means on screen exactly what
 * it means to the user. */
export function identifyRequest(cfg, lngLat, frame) {
  const { lng, lat } = lngLat || {};
  const { west, south, east, north, width, height } = frame || {};
  return {
    url: trimUrl(cfg.url) + "/identify",
    params: {
      f: "json",
      geometry: JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }),
      geometryType: "esriGeometryPoint",
      sr: 4326,
      layers: identifyLayersParam(cfg),
      tolerance: cfg.identifyTolerance ?? IDENTIFY_TOLERANCE_PX,
      mapExtent: `${west},${south},${east},${north}`,
      imageDisplay: `${Math.max(1, Math.round(width || 1))},${Math.max(1, Math.round(height || 1))},96`,
      returnGeometry: "false",
    },
  };
}

/* The attributes worth showing, in priority order, as candidate field-name lists. Generic on
 * purpose: one list serves electric, pipeline, water/sewer and flood services without this
 * module having to know each agency's schema (which we cannot probe from the sandbox anyway).
 * A registry row may override with its own `identifyRows` shape via `cfg.hoverFields`. */
export const IDENTIFY_ROW_SPECS = [
  { label: "Name", names: ["NAME", "FACILITY", "FACILITY_NAME", "OWNER_NAME", "SYSTEM_NAME", "UTILITY", "LABEL"] },
  { label: "Voltage", names: ["VOLTAGE", "VOLT_CLASS", "MAX_VOLT", "MAX_VOLTAG", "KV"], unit: "kV" },
  { label: "Commodity", names: ["COMMODITY", "COMMODITY1", "PRODUCT", "PRODUCT_TYPE", "SUBSTANCE"] },
  { label: "Operator", names: ["OWNER", "OPERATOR", "OPERATOR_NAME", "COMPANY", "PROVIDER", "AGENCY"] },
  { label: "Type", names: ["TYPE", "FTYPE", "CLASS", "MATERIAL", "ZONE", "FLD_ZONE", "ZONE_SUBTY"] },
  { label: "Size", names: ["DIAMETER", "DIAM", "SIZE", "PIPE_SIZE", "WIDTH"], unit: "in" },
  { label: "Status", names: ["STATUS", "STATUS_TYPE", "CONDITION"] },
];

const REDACTED = /^(not available|not applicable|unknown|undetermined|none|null|n\/?a|0|-{1,2}|<null>)$/i;

/* Agency MapServers shout too (see titleCaseAgency) — the readout rows go through the same
 * normaliser as the vector tooltips so the two paths cannot read differently for the same fact. */
const cleanValue = (raw) => {
  const s = raw == null ? "" : String(raw).trim();
  return !s || REDACTED.test(s) ? "" : titleCaseAgency(s);
};

const pick = (attrs, names) => {
  if (!attrs) return null;
  for (const n of names) if (attrs[n] != null) return attrs[n];
  const lower = new Map(Object.keys(attrs).map((k) => [k.toLowerCase(), k]));
  for (const n of names) {
    const hit = lower.get(String(n).toLowerCase());
    if (hit != null && attrs[hit] != null) return attrs[hit];
  }
  return null;
};

/* Turn one ArcGIS identify result into a readout. ArcGIS gives each result a `layerName`
 * (the sublayer, e.g. "Water Mains") and a `value` (the sublayer's display-field value).
 * Prefer the display value as the headline when it's a real one — that is the service's own
 * answer to "what is this" — and fall back to the sublayer name, which is always meaningful. */
export function readoutFromResult(cfg, result) {
  if (!result) return null;
  const attrs = result.attributes || {};
  const display = cleanValue(result.value);
  const layerName = cleanValue(result.layerName);
  const rows = [];
  for (const spec of IDENTIFY_ROW_SPECS) {
    let text = cleanValue(pick(attrs, spec.names));
    if (!text) continue;
    if (spec.unit && /^[\d.,]+$/.test(text)) text = spec.unit === "in" ? `${text}″` : `${text} ${spec.unit}`;
    if (text === display) continue; // already the headline — never state the same fact twice
    rows.push({ label: spec.label, text });
    if (rows.length >= 4) break; // a hover readout, not a report
  }
  const title = display && display !== layerName
    ? (layerName ? `${layerName}: ${display}` : display)
    : (layerName || cfg.label || "Feature");
  return { title, rows, sourceName: cfg.source || null };
}

/* All readouts from one identify response, capped. An empty `results` is NOT an error — it
 * means the layer genuinely has nothing under the cursor, which must read differently from
 * "the service didn't answer" (the B233 distinction). */
export function readoutsFromJson(cfg, json, { limit = 2 } = {}) {
  const results = (json && json.results) || [];
  return results.slice(0, limit).map((r) => readoutFromResult(cfg, r)).filter(Boolean);
}

/* The user-facing state of a hover identify. Every terminal state SAYS something — there is
 * no silent branch, because a layer that answers nothing is indistinguishable from a dead one
 * (LOUD-FAILURE). `pending` is the only non-terminal state and it is always superseded. */
export const IDENTIFY_STATE = {
  idle: "idle",
  pending: "pending",
  hit: "hit",
  none: "none",
  unsupported: "unsupported",
  error: "error",
};

/* The honest short message for a non-hit outcome. Deliberately brief — this appears in a
 * transient hover chip, not a report — and never blames the user. */
export function stateMessage(state) {
  if (!state) return "";
  switch (state.kind) {
    case IDENTIFY_STATE.pending: return "Checking…";
    case IDENTIFY_STATE.none: return "Nothing here";
    case IDENTIFY_STATE.unsupported: return "This layer can't be identified";
    case IDENTIFY_STATE.error: return state.msg || "Source didn't answer";
    default: return "";
  }
}

/* Classify a failed identify into the honest wording. A 429 is explicitly NOT "down" — it is
 * "asked too often", which is retryable and is the user's cue to hover again rather than to
 * distrust the layer. */
export function errorMessage(e) {
  const status = e && e.status;
  if (status === 429) return "Source is rate-limiting — try again";
  if (e && e.name === "AbortError") return "Source didn't answer in time";
  if (e && e.name === "UnreadableIdentifyError") return "Source sent an unreadable answer";
  if (status) return `Source returned HTTP ${status}`;
  const m = String((e && e.message) || "");
  if (/failed to fetch|networkerror|load failed/i.test(m)) return "Couldn't reach the source";
  /* A JSON parse failure that reached here (rather than through the typed error above) still must
   * not leak the parser's own wording — "Unexpected token '<'" tells the user nothing about their
   * map. Anything unrecognised degrades to the honest generic rather than a raw internal message. */
  if (/unexpected token|not valid json|json\.parse|unexpected end of/i.test(m)) return "Source sent an unreadable answer";
  return m || "Source didn't answer";
}

/* The debounced, cancelling hover-identify controller.
 *
 * Everything time- and network-shaped is injected so this is deterministic under test:
 *   fetchJson(url, params, { signal, cfg, id }) → parsed JSON (throws on HTTP/network failure)
 *   setTimer/clearTimer                → the debounce clock
 *   makeController()                   → an AbortController (or a stub)
 *   onState(state)                     → the single render channel
 *
 * Contract:
 *   • hover(lngLat, frame, layers) restarts the debounce and ABORTS any in-flight request —
 *     a request for a position the cursor has already left is waste, and worse, its late
 *     answer would describe the wrong ground.
 *   • cancel() clears both timer and request and returns to idle. Called on mouse-out, on a
 *     pan/drag start, and when the identify gate closes.
 *   • `layers` is resolved by the CALLER, per event, so a layer toggled off mid-hover is
 *     already gone by the time the debounce fires.
 *   • a result from a superseded generation is dropped, never rendered.
 */
export function createHoverIdentify({
  fetchJson,
  onState,
  debounceMs = HOVER_IDENTIFY_DEBOUNCE_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  makeController = () => (typeof AbortController === "function" ? new AbortController() : null),
  timeoutMs = IDENTIFY_TIMEOUT_MS,
  limit = 2,
} = {}) {
  let timer = null, ctrl = null, gen = 0, last = { kind: IDENTIFY_STATE.idle };

  const emit = (state) => {
    last = state;
    if (onState) onState(state);
  };

  const abort = () => {
    if (ctrl) { try { ctrl.abort(); } catch (_) {} ctrl = null; }
  };

  const stop = () => {
    if (timer != null) { clearTimer(timer); timer = null; }
    abort();
    gen += 1; // invalidate anything already resolving
  };

  const run = async (lngLat, frame, layers) => {
    const mine = gen;
    emit({ kind: IDENTIFY_STATE.pending, at: lngLat });
    // Ask each eligible layer in parallel; the first layers with a hit win. A layer whose
    // service declines or dies must not suppress a sibling that answered.
    ctrl = makeController();
    const signal = ctrl ? ctrl.signal : undefined;
    let timeoutId = null;
    if (timeoutMs) timeoutId = setTimer(() => abort(), timeoutMs);
    const settled = await Promise.all(layers.map(async ({ id, cfg }) => {
      if (!identifyCapable(cfg)) return { id, kind: IDENTIFY_STATE.unsupported };
      const { url, params } = identifyRequest(cfg, lngLat, frame);
      try {
        // `cfg` rides along so the injected transport can honour the layer's own flags (the
        // `noCors` hosts must skip the doomed direct attempt — see rasterIdentifyMap.js).
        const json = await fetchJson(url, params, { signal, cfg, id });
        return { id, kind: IDENTIFY_STATE.hit, items: readoutsFromJson(cfg, json, { limit }) };
      } catch (e) {
        if (e && e.name === "AbortError") return { id, kind: "aborted" };
        return { id, kind: IDENTIFY_STATE.error, msg: errorMessage(e) };
      }
    }));
    if (timeoutId != null) clearTimer(timeoutId);
    if (mine !== gen) return; // the cursor moved on — this answer describes ground we left
    ctrl = null;
    if (settled.some((s) => s.kind === "aborted")) return; // superseded or timed out into abort

    const items = settled.filter((s) => s.kind === IDENTIFY_STATE.hit).flatMap((s) => s.items);
    if (items.length) return emit({ kind: IDENTIFY_STATE.hit, items: items.slice(0, limit), at: lngLat });
    // No hit anywhere. An ERROR is more informative than "nothing here" — a user must not read
    // an unreachable service as empty ground, so a failure wins the tie.
    const bad = settled.find((s) => s.kind === IDENTIFY_STATE.error);
    if (bad) return emit({ kind: IDENTIFY_STATE.error, msg: bad.msg, at: lngLat });
    if (settled.length && settled.every((s) => s.kind === IDENTIFY_STATE.unsupported))
      return emit({ kind: IDENTIFY_STATE.unsupported, at: lngLat });
    emit({ kind: IDENTIFY_STATE.none, at: lngLat });
  };

  return {
    /* Cursor rested (or clicked, with debounceMs 0) at a position. */
    hover(lngLat, frame, layers, { immediate = false } = {}) {
      stop();
      if (!lngLat || !frame || !layers || !layers.length) { emit({ kind: IDENTIFY_STATE.idle }); return; }
      const fire = () => { timer = null; run(lngLat, frame, layers); };
      if (immediate || !debounceMs) fire();
      else timer = setTimer(fire, debounceMs);
    },
    /* Mouse left the map, a pan started, or the gate closed. */
    cancel() {
      stop();
      emit({ kind: IDENTIFY_STATE.idle });
    },
    /* Tear down without emitting (unmount). */
    destroy() { stop(); onState = null; },
    state: () => last,
  };
}
