import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import * as EL from "esri-leaflet";
import { COUNTIES, COUNTIES_MAP } from "./lib/counties.js";
import { resolveLayerUrl, queryAtPoint, lngLatFeatureToParcel, humanizeError } from "./lib/arcgis.js";

const PAL = {
  panelBg: "#ffffff", panelLine: "#e7e2d6", ink: "#2c2a26",
  accent: "#c2410c", muted: "#8a8473",
};

const ADDR_RE = /(situs|site_?addr|prop_?addr|loc_?addr|location|^addr|str_?name|full_?addr|address)/i;
const ID_RE = /(hcad_?num|^acct|account|parcel_?id|prop_?id|^pid$|quick_?ref|geo_?id|^pin$|^gid$)/i;
const findVal = (attrs, re) => {
  const k = Object.keys(attrs || {}).find((key) => re.test(key) && attrs[key] != null && attrs[key] !== "");
  return k ? String(attrs[k]) : null;
};

export default function MapFinder({ visible, county, onCounty, onUseParcel, onSkip }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const displayRef = useRef(null);   // visible parcel-line layer
  const hiliteRef = useRef(null);    // selected-parcel outline
  const layerUrlRef = useRef(null);  // queryable layer URL
  const [addr, setAddr] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [picked, setPicked] = useState(null);

  /* create the map once */
  useEffect(() => {
    const cfg = COUNTIES_MAP[county] || COUNTIES_MAP.harris;
    const map = L.map(elRef.current, { zoomControl: true, minZoom: 8, maxZoom: 21 }).setView(cfg.center, cfg.zoom);
    mapRef.current = map;
    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 21, attribution: "Imagery &copy; Esri, Maxar, USDA" }
    ).addTo(map);
    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 21, opacity: 0.9 }
    ).addTo(map);
    const onClick = (e) => handleClick(e.latlng);
    map.on("click", onClick);
    return () => { map.off("click", onClick); map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* keep the map sized correctly when shown after being hidden */
  useEffect(() => {
    if (visible && mapRef.current) {
      const t = setTimeout(() => mapRef.current && mapRef.current.invalidateSize(), 60);
      return () => clearTimeout(t);
    }
  }, [visible]);

  /* swap the parcel layer + resolve the queryable URL when the county changes */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const cfg = COUNTIES_MAP[county];
    if (!cfg) return;
    setPicked(null); setErr("");
    if (hiliteRef.current) { map.removeLayer(hiliteRef.current); hiliteRef.current = null; }
    if (displayRef.current) { map.removeLayer(displayRef.current); displayRef.current = null; }
    map.setView(cfg.center, cfg.zoom);

    let layer = null;
    try {
      if (cfg.mapServer) {
        layer = EL.dynamicMapLayer({ url: cfg.mapServer, opacity: 0.85 });
      } else if (cfg.layerUrl) {
        layer = EL.featureLayer({ url: cfg.layerUrl, minZoom: 15, style: () => ({ color: "#ffd24d", weight: 1, fillOpacity: 0 }) });
      }
      if (layer) {
        layer.on("requesterror", () => setErr(`${COUNTIES[county]?.label || "County"} parcel layer didn't load — you can still pan the aerial and trace by hand in the planner.`));
        layer.addTo(map);
        displayRef.current = layer;
      }
    } catch (_) { /* non-fatal: aerial still works */ }

    layerUrlRef.current = null;
    (async () => {
      try { layerUrlRef.current = await resolveLayerUrl(cfg.layerUrl || cfg.mapServer); }
      catch (_) { /* surfaced on click */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [county]);

  const handleClick = async (latlng) => {
    const url = layerUrlRef.current;
    if (!url) { setErr("Parcel layer is still loading — give it a second and click again."); return; }
    setBusy(true); setErr(""); setPicked(null);
    try {
      const feat = await queryAtPoint(url, latlng.lng, latlng.lat);
      if (!feat) { setErr("No parcel right there — zoom in and click directly on a lot."); return; }
      const conv = lngLatFeatureToParcel(feat);
      if (!conv) { setErr("That record has no polygon shape — try an adjacent lot."); return; }
      const map = mapRef.current;
      if (hiliteRef.current) map.removeLayer(hiliteRef.current);
      hiliteRef.current = L.polygon(conv.latlngs, { color: PAL.accent, weight: 3, fillColor: PAL.accent, fillOpacity: 0.12 }).addTo(map);
      const attrs = feat.attributes || {};
      setPicked({ points: conv.points, addr: findVal(attrs, ADDR_RE), acct: findVal(attrs, ID_RE) });
    } catch (e) {
      setErr(humanizeError(e));
    } finally {
      setBusy(false);
    }
  };

  const goAddress = async () => {
    const q = addr.trim();
    if (!q) return;
    setBusy(true); setErr("");
    try {
      const u = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(q)}`;
      const r = await fetch(u);
      const j = await r.json();
      if (!j.length) { setErr("Couldn't find that address — add the city or ZIP, or just pan the map to it."); return; }
      mapRef.current.flyTo([+j[0].lat, +j[0].lon], 18, { duration: 0.75 });
    } catch (_) {
      setErr("Address search is unavailable right now — pan/zoom the map to your site instead.");
    } finally {
      setBusy(false);
    }
  };

  const usePicked = () => { if (picked) onUseParcel({ points: picked.points, meta: { addr: picked.addr, acct: picked.acct } }); };

  const btn = (primary) => ({
    padding: "7px 12px", fontSize: 13, borderRadius: 7, cursor: "pointer", fontFamily: "inherit",
    border: `1px solid ${primary ? PAL.accent : PAL.panelLine}`, background: primary ? PAL.accent : "#fbfaf6",
    color: primary ? "#fff" : PAL.ink, fontWeight: primary ? 600 : 500,
  });
  const field = { padding: "7px 9px", fontSize: 13, border: `1px solid ${PAL.panelLine}`, borderRadius: 6, color: PAL.ink, background: "#fff", fontFamily: "inherit" };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#efeadf" }}>
      {/* top bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", background: PAL.panelBg, borderBottom: `1px solid ${PAL.panelLine}`, flexWrap: "wrap", zIndex: 1000 }}>
        <div style={{ fontWeight: 700, letterSpacing: "0.04em", fontSize: 13.5, textTransform: "uppercase" }}>
          <span style={{ color: PAL.accent }}>◎</span> Find a site
        </div>
        <select style={{ ...field, fontWeight: 600 }} value={county} onChange={(e) => onCounty(e.target.value)}>
          {Object.entries(COUNTIES).map(([k, c]) => <option key={k} value={k}>{c.label}{c.experimental ? " (beta)" : ""}</option>)}
        </select>
        <div style={{ display: "flex", gap: 0, flex: 1, minWidth: 220, maxWidth: 460 }}>
          <input style={{ ...field, flex: 1, borderRadius: "6px 0 0 6px" }} placeholder="Go to an address or place…" value={addr}
            onChange={(e) => setAddr(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") goAddress(); }} />
          <button style={{ ...btn(false), borderRadius: "0 6px 6px 0", borderLeft: "none" }} disabled={busy} onClick={goAddress}>{busy ? "…" : "Go"}</button>
        </div>
        <div style={{ flex: 1 }} />
        <button style={btn(false)} onClick={onSkip}>Open blank planner →</button>
      </div>

      {/* map */}
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        <div ref={elRef} style={{ position: "absolute", inset: 0 }} />

        {/* instruction / error */}
        <div style={{ position: "absolute", left: 12, bottom: 12, zIndex: 1000, maxWidth: 360, background: "rgba(255,255,255,0.94)", border: `1px solid ${PAL.panelLine}`, borderRadius: 8, padding: "8px 11px", fontSize: 12.5, color: err ? PAL.accent : PAL.ink, lineHeight: 1.45, pointerEvents: "none" }}>
          {err || "Zoom to your site, then click a parcel to load it into the planner. (Parcel lines appear as you zoom in.)"}
        </div>

        {/* picked parcel card */}
        {picked && (
          <div style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", bottom: 18, zIndex: 1000, background: PAL.panelBg, border: `1px solid ${PAL.panelLine}`, borderRadius: 10, boxShadow: "0 6px 24px rgba(0,0,0,0.16)", padding: "12px 14px", minWidth: 280, maxWidth: 420 }}>
            <div style={{ fontSize: 11, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>Selected parcel</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: PAL.ink }}>{picked.addr || "Parcel"}</div>
            {picked.acct && <div style={{ fontSize: 11.5, color: PAL.muted, fontFamily: "ui-monospace, Menlo, monospace" }}>#{picked.acct}</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button style={{ ...btn(true), flex: 1 }} onClick={usePicked}>Plan this site →</button>
              <button style={btn(false)} onClick={() => { setPicked(null); if (hiliteRef.current) { mapRef.current.removeLayer(hiliteRef.current); hiliteRef.current = null; } }}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
