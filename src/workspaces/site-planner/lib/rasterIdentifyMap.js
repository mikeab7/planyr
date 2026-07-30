/* Leaflet glue for the raster hover/click identify (NEW-2). The decision layer is the pure
 * rasterIdentify.js; this file is only the map wiring + the transient readout chrome, kept
 * separate so layers.js does not grow another 150 lines and so the state machine stays
 * testable without a DOM.
 *
 * TRANSPORT — the CORS wall is the whole reason these layers are pictures. A raster overlay
 * paints through a CORS-exempt <img>, which is exactly what lets it render from an agency host
 * that sends no CORS headers at all. An identify, by contrast, is a JSON `fetch`, so it hits
 * that wall head-on. The answer is the mechanism the repo already uses for the health probe
 * (`probeService`, B469/B691): try the agency DIRECT first — most hosts are CORS-clean and
 * should take no extra hop — and retry once through the same-origin B445 cache proxy, which
 * fetches server-side and returns the JSON same-origin, only when the direct attempt actually
 * fails on network/CORS. A host the registry flags `noCors` skips the doomed direct attempt
 * (its console noise is the thing B691 was written to stop) and goes straight to the proxy.
 * When the proxy isn't deployed either, the failure is reported honestly — never a spinner.
 */
import L from "leaflet";
import { proxyServiceUrl } from "../../../shared/gis/gisProxyCore.js";
import { gisProxyEnabled, rasterIdentifyLayers } from "./layers.js";
import {
  createHoverIdentify, IDENTIFY_STATE, stateMessage, HOVER_IDENTIFY_DEBOUNCE_MS,
} from "./rasterIdentify.js";

const qs = (params) => Object.entries(params)
  .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&");

/* A typed HTTP failure so rasterIdentify.errorMessage can distinguish a 429 from a 500. */
class IdentifyHttpError extends Error {
  constructor(status) { super(`HTTP ${status}`); this.name = "IdentifyHttpError"; this.status = status; }
}

/* We reached SOMETHING, but it wasn't the service (see getJson). Typed so errorMessage words it. */
class UnreadableIdentifyError extends Error {
  constructor() { super("unreadable answer"); this.name = "UnreadableIdentifyError"; }
}

async function getJson(url, signal) {
  const res = await fetch(url, signal ? { signal } : undefined);
  if (!res.ok) throw new IdentifyHttpError(res.status);
  /* A 200 that isn't JSON means we reached something that is NOT the service — a captive portal, an
   * SPA index.html served for an unrouted path, a proxy error page. Say that plainly: letting
   * `res.json()` throw would surface a raw parser message ("Unexpected token '<'…") in the user's
   * readout, which is noise, not an honest failure. */
  let j;
  try {
    j = await res.json();
  } catch (_) {
    throw new UnreadableIdentifyError();
  }
  // ArcGIS answers a failed operation with HTTP 200 and a JSON `{error:…}` body — the same trap
  // arcgis.js documents. Treat it as the failure it is rather than an empty result.
  if (j && j.error) {
    const e = new Error(j.error.message || "ArcGIS identify error");
    e.status = j.error.code ?? null;
    throw e;
  }
  return j;
}

/* The injected fetcher for createHoverIdentify. `cfg` rides on the params object so the
 * transport can honour the layer's own `noCors` flag. */
export function makeIdentifyFetch({ fetchImpl = getJson } = {}) {
  return async function identifyFetch(url, params, { signal, cfg } = {}) {
    const query = qs(params);
    const proxied = () => {
      // The proxy addresses a SERVICE; re-attach the /identify operation past the encoded base.
      const base = String(url).replace(/\/identify$/i, "");
      return `${proxyServiceUrl(base)}/identify?${query}`;
    };
    if (cfg && cfg.noCors) {
      if (!gisProxyEnabled()) throw new Error("This source needs the cache proxy to be identified");
      return fetchImpl(proxied(), signal);
    }
    try {
      return await fetchImpl(`${url}?${query}`, signal);
    } catch (e) {
      // Only a genuine network/CORS block earns the retry: an HTTP status or an ArcGIS error
      // body means the service ANSWERED, and re-asking through the proxy would just be slower.
      const networkish = !(e && (e.status != null)) && e && e.name !== "AbortError";
      if (!networkish || !gisProxyEnabled()) throw e;
      return fetchImpl(proxied(), signal);
    }
  };
}

/* The transient readout, as DOM. Attribute values come from external services, so every one
 * goes through textContent — never innerHTML (the same rule vectorOverlay.js follows). */
function readoutNode(state) {
  const el = document.createElement("div");
  el.style.cssText = "font-size:12px;line-height:1.45;max-width:250px;";
  el.setAttribute("data-testid", "raster-identify");
  if (state.kind !== IDENTIFY_STATE.hit) {
    el.textContent = stateMessage(state);
    el.style.opacity = "0.85";
    return el;
  }
  state.items.forEach((it, i) => {
    const block = document.createElement("div");
    if (i) block.style.marginTop = "7px";
    const head = document.createElement("div");
    head.style.cssText = "font-weight:700;font-size:12.5px;margin-bottom:2px;";
    head.textContent = it.title;
    block.append(head);
    for (const r of it.rows) {
      const row = document.createElement("div");
      const lab = document.createElement("span");
      lab.style.cssText = "opacity:0.7;";
      lab.textContent = `${r.label}: `;
      const val = document.createElement("span");
      val.textContent = r.text;
      row.append(lab, val);
      block.append(row);
    }
    if (it.sourceName) {
      const src = document.createElement("div");
      src.style.cssText = "opacity:0.7;font-size:10.5px;margin-top:3px;";
      src.textContent = `Source: ${it.sourceName}`;
      block.append(src);
    }
    el.append(block);
  });
  return el;
}

/* How long a non-hit message stays up before dismissing itself. Long enough to read, short
 * enough that it never becomes furniture — the honest-but-brief state the brief asks for
 * instead of a spinner that never resolves or a silence that reads as a dead layer. */
export const TRANSIENT_MS = 1600;

/* Wire hover + click identify onto a Leaflet map.
 *
 * Options (all read LIVE per event, never captured at attach time — the layer set, the gate
 * and the health verdict all change while the map stays mounted):
 *   getOverlays()      → the overlay state object ({id: {on, opacity}}).
 *   layerHealthy(id)   → false for a layer the health probe already failed. NOT a second
 *                        prober: `probeService` stays the only one.
 *   identifyOk()       → false while a tool owns the pointer (parcel-select, drawing) — the
 *                        B98 rule, the same gate the vector identify reads.
 *   getFrame()         → optional override of the map frame (the planner drives this from its
 *                        own canvas view rather than the backdrop map's).
 *
 * Returns a detach function. */
export function attachRasterIdentify(map, opts = {}) {
  if (!map) return () => {};
  const {
    getOverlays = () => ({}),
    layerHealthy = () => true,
    identifyOk = () => true,
    debounceMs = HOVER_IDENTIFY_DEBOUNCE_MS,
    fetchJson = makeIdentifyFetch(),
  } = opts;

  let hoverTip = null, pinned = null, dismissTimer = null, panning = false;

  const clearDismiss = () => { if (dismissTimer) { clearTimeout(dismissTimer); dismissTimer = null; } };
  const dropTip = () => {
    clearDismiss();
    if (hoverTip) { try { map.closeTooltip(hoverTip); } catch (_) {} hoverTip = null; }
  };

  const frameOf = () => {
    if (typeof opts.getFrame === "function") return opts.getFrame();
    const b = map.getBounds(), s = map.getSize();
    return { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth(), width: s.x, height: s.y };
  };

  /* One controller for hover (debounced, transient tooltip) and one for click (immediate,
   * pinned popup) so a click can never be cancelled by the hover that follows it. */
  const render = (state, at) => {
    if (state.kind === IDENTIFY_STATE.idle) return dropTip();
    dropTip();
    hoverTip = L.tooltip({ direction: "top", offset: [0, -6], opacity: 0.96, className: "pf-identify-tip" })
      .setLatLng(at || state.at)
      .setContent(readoutNode(state));
    try { hoverTip.addTo(map); } catch (_) { hoverTip = null; return; }
    // A non-hit says its piece and leaves. A hit stays while the cursor rests on it and is
    // dropped by the next move/out, like any hover affordance.
    if (state.kind !== IDENTIFY_STATE.hit && state.kind !== IDENTIFY_STATE.pending) {
      clearDismiss();
      dismissTimer = setTimeout(dropTip, TRANSIENT_MS);
    }
  };

  const hover = createHoverIdentify({
    fetchJson: (url, params, o) => fetchJson(url, params, o),
    debounceMs,
    onState: (state) => render(state),
  });

  const eligible = () => rasterIdentifyLayers(getOverlays(), { layerHealthy });

  let lastLL = null, pending = false;
  const onMove = (e) => {
    lastLL = { lat: e.latlng.lat, lng: e.latlng.lng };
    if (panning || !identifyOk()) { hover.cancel(); return; }
    if (pending) return;
    pending = true;
    // Coalesce to one decision per frame; the debounce inside the controller does the rest.
    requestAnimationFrame(() => {
      pending = false;
      if (!lastLL || panning || !identifyOk()) return;
      const layers = eligible();
      if (!layers.length) { hover.cancel(); return; }
      hover.hover(lastLL, frameOf(), layers);
    });
  };

  const onOut = () => { lastLL = null; hover.cancel(); };
  const onDragStart = () => { panning = true; hover.cancel(); };
  const onDragEnd = () => { panning = false; };
  const onZoomStart = () => { hover.cancel(); dropTip(); };

  const onClick = (e) => {
    if (!identifyOk()) return;
    const layers = eligible();
    if (!layers.length) return;
    // A click PINS the answer: same question, rendered in a popup the user can read and
    // dismiss deliberately rather than one that vanishes on the next mouse move.
    const at = { lat: e.latlng.lat, lng: e.latlng.lng };
    const pin = createHoverIdentify({
      fetchJson: (url, params, o) => fetchJson(url, params, o),
      debounceMs: 0,
      onState: (state) => {
        if (state.kind === IDENTIFY_STATE.idle) return;
        if (pinned) { try { map.closePopup(pinned); } catch (_) {} pinned = null; }
        pinned = L.popup({ maxWidth: 280, autoPan: false })
          .setLatLng(at).setContent(readoutNode(state)).openOn(map);
      },
    });
    dropTip();
    pin.hover(at, frameOf(), layers, { immediate: true });
  };

  map.on("mousemove", onMove);
  map.on("mouseout", onOut);
  map.on("dragstart", onDragStart);
  map.on("dragend", onDragEnd);
  map.on("zoomstart", onZoomStart);
  map.on("click", onClick);

  return () => {
    map.off("mousemove", onMove);
    map.off("mouseout", onOut);
    map.off("dragstart", onDragStart);
    map.off("dragend", onDragEnd);
    map.off("zoomstart", onZoomStart);
    map.off("click", onClick);
    hover.destroy();
    dropTip();
    if (pinned) { try { map.closePopup(pinned); } catch (_) {} pinned = null; }
  };
}
