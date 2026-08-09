/* Set this plan's location — the escape from a plan stranded in blank space (NEW-1).
 *
 * A plan started with "Start blank" has no geo anchor, so the aerial, the FEMA flood layer, the
 * contours, the ground elevation, the cursor lat/lon and the county (and therefore jurisdiction,
 * setbacks and drainage rules) are all switched off. That is fine while the county parcel service
 * is down and you are drawing from a deed — but until this shipped there was NO way to attach the
 * plan to the real world afterward, short of starting over.
 *
 * Three ways in, because the owner will have exactly one of them to hand:
 *   • an ADDRESS   — geocoded (lib/geocode.js), the same lookup the map search uses
 *   • a COORDINATE — typed, decimal or degrees-minutes-seconds, either hemisphere order
 *   • a PICK       — click the small aerial; the pin is the anchor
 * All three land in the SAME `picked` state, so the confirm button means one thing.
 *
 * The promise printed on the dialog is the one the caller must keep: nothing you drew moves. The
 * drawing lives in local feet; the origin only decides where that local frame sits on the earth
 * (see lib/sitePlacement.js).
 *
 * Lazily loaded — it is a modal a session opens at most once, and it carries a Leaflet map.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import L from "leaflet";
import { BASEMAPS } from "../lib/basemaps.js";
import { parseLatLon, normalizeOrigin } from "../lib/sitePlacement.js";
import { geocodeAddress } from "../lib/geocode.js";

const f5 = (n) => (Number.isFinite(n) ? n.toFixed(5) : "—");

export default function SetLocationDialog({ origin, PAL, onCancel, onConfirm }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [picked, setPicked] = useState(() => normalizeOrigin(origin));
  const [label, setLabel] = useState("");
  const mapBoxRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const pickedRef = useRef(picked);
  pickedRef.current = picked;

  // The small aerial. Interactive (unlike the planner backdrop) — clicking it IS one of the three
  // ways to answer. Starts on the current anchor when there is one, else a wide Texas-ish view.
  useEffect(() => {
    if (!mapBoxRef.current || mapRef.current) return;
    const start = pickedRef.current;
    const map = L.map(mapBoxRef.current, { attributionControl: false, zoomControl: true })
      .setView(start ? [start.lat, start.lon] : [31.0, -97.5], start ? 16 : 6);
    L.tileLayer(BASEMAPS.esri.tiles, { maxNativeZoom: BASEMAPS.esri.maxNative, maxZoom: 21 }).addTo(map);
    map.on("click", (e) => {
      const o = normalizeOrigin({ lat: e.latlng.lat, lon: e.latlng.lng });
      if (o) { setPicked(o); setLabel(""); setErr(""); }
    });
    mapRef.current = map;
    // Leaflet measures on mount; the modal animates in, so re-measure on the next frame.
    const t = setTimeout(() => { try { map.invalidateSize(); } catch (_) {} }, 60);
    return () => { clearTimeout(t); try { map.remove(); } catch (_) {} mapRef.current = null; markerRef.current = null; };
  }, []);

  // Keep the pin and the view on whatever was picked last, from whichever of the three inputs.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !picked) return;
    if (!markerRef.current) markerRef.current = L.circleMarker([picked.lat, picked.lon], { radius: 7, color: "#fff", weight: 2, fillColor: "#EF6C33", fillOpacity: 1 }).addTo(map);
    else markerRef.current.setLatLng([picked.lat, picked.lon]);
    if (map.getZoom() < 15) map.setView([picked.lat, picked.lon], 17);
    else map.panTo([picked.lat, picked.lon]);
  }, [picked]);

  /* One search box for both a typed coordinate and an address: a coordinate pair is recognized
   * locally (no network — so it still works with every external host blocked), and anything else
   * goes to the geocoder. LOUD-FAILURE: a geocoder that is unreachable says so, and never reads
   * as "not found". */
  const find = useCallback(async () => {
    const text = q.trim();
    if (!text) return;
    const coord = parseLatLon(text);
    if (coord) { setPicked(coord); setLabel(""); setErr(""); return; }
    setBusy(true); setErr("");
    try {
      const hit = await geocodeAddress(text, picked ? { lat: picked.lat, lng: picked.lon } : null);
      if (hit && hit.error) { setErr(`${hit.error} You can still type a latitude and longitude, or click the map.`); return; }
      if (!hit) { setErr("Couldn't find that address — add the city or ZIP, type a latitude and longitude, or click the map."); return; }
      const o = normalizeOrigin({ lat: hit.lat, lon: hit.lon });
      if (!o) { setErr("That address came back without a usable position — type a latitude and longitude instead."); return; }
      setPicked(o); setLabel(hit.label || text);
    } catch (_) {
      setErr("Address lookup is unavailable right now — type a latitude and longitude, or click the map.");
    } finally { setBusy(false); }
  }, [q, picked]);

  const line = { fontSize: 12, color: PAL.muted, lineHeight: 1.5 };
  const btn = (primary, on = true) => ({
    padding: "7px 14px", fontSize: 12.5, fontWeight: 600, borderRadius: 8, fontFamily: "inherit",
    border: `1px solid ${primary ? PAL.accent : PAL.panelLine}`,
    background: primary ? (on ? PAL.accent : "var(--surface-raised)") : "var(--surface-raised)",
    color: primary ? (on ? PAL.onAccent || "#fff" : PAL.muted) : PAL.ink,
    cursor: on ? "pointer" : "default", opacity: on ? 1 : 0.7,
  });

  return (
    <div role="dialog" aria-modal="true" aria-label="Set this plan's location" data-testid="set-location-dialog"
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onCancel(); } }}
      style={{ position: "fixed", inset: 0, zIndex: 5000, background: "rgba(20,18,15,0.42)", display: "grid", placeItems: "center", padding: 16 }}
      onPointerDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div onPointerDown={(e) => e.stopPropagation()}
        style={{ width: "min(560px, 100%)", maxHeight: "calc(100vh - 32px)", overflowY: "auto", background: "var(--surface-raised)", border: `1px solid ${PAL.panelLine}`, borderRadius: 12, boxShadow: "0 18px 50px rgba(0,0,0,0.32)", padding: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: PAL.ink }}>{origin ? "Move this plan's location" : "Set this plan's location"}</div>
        <div style={{ ...line, marginTop: 4 }}>
          Nothing you've drawn moves — this only says where the plan sits on the earth. Once it's set the aerial,
          flood layer, contours and county rules switch on.
        </div>

        <div style={{ display: "flex", gap: 6, margin: "12px 0 8px" }}>
          <input
            autoFocus value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") find(); }}
            placeholder="Address, or a latitude and longitude"
            aria-label="Address, or a latitude and longitude"
            data-testid="set-location-search"
            style={{ flex: 1, minWidth: 0, padding: "8px 10px", fontSize: 13, fontFamily: "inherit", border: `1px solid ${PAL.panelLine}`, borderRadius: 8, outline: "none", color: PAL.ink, background: "var(--surface-base)" }} />
          <button onClick={find} disabled={busy || !q.trim()} style={btn(true, !busy && !!q.trim())} data-testid="set-location-find">{busy ? "…" : "Find"}</button>
        </div>

        <div ref={mapBoxRef} data-testid="set-location-map"
          style={{ height: 240, borderRadius: 10, overflow: "hidden", border: `1px solid ${PAL.panelLine}`, background: "var(--surface-base)" }} />
        <div style={{ ...line, marginTop: 6 }}>Or click the map to drop the anchor.</div>

        {err && <div data-testid="set-location-error" style={{ marginTop: 8, fontSize: 12, color: "var(--warn-text)", lineHeight: 1.45 }}>{err}</div>}

        <div style={{ marginTop: 10, padding: "8px 10px", border: `1px solid ${PAL.panelLine}`, borderRadius: 8, background: "var(--surface-base)" }}>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700, color: PAL.muted }}>Anchor</div>
          <div data-testid="set-location-picked" style={{ fontSize: 13, fontWeight: 600, color: picked ? PAL.ink : PAL.muted, marginTop: 2 }}>
            {picked ? `${f5(picked.lat)}, ${f5(picked.lon)}` : "Nothing picked yet"}
          </div>
          {label && <div style={{ ...line, marginTop: 2 }}>{label}</div>}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <button onClick={onCancel} style={btn(false)}>Cancel</button>
          <button data-testid="set-location-confirm" disabled={!picked} style={btn(true, !!picked)}
            onClick={() => { if (picked) onConfirm(picked, label); }}>
            {origin ? "Move it here" : "Set location"}
          </button>
        </div>
      </div>
    </div>
  );
}
