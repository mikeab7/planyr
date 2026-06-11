import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import * as EL from "esri-leaflet";
import { COUNTIES, COUNTIES_MAP } from "./lib/counties.js";
import {
  resolveLayerUrl,
  queryAtPoint,
  largestRingLngLat,
  lngLatRingToFeet,
  feetToLatLng,
  aerialPlacement,
  humanizeError,
} from "./lib/arcgis.js";
import { elStyle, elRingFeet, byZ } from "./lib/planStyle.js";

const PAL = {
  panelBg: "#ffffff", panelLine: "#e7e2d6", ink: "#2c2a26",
  accent: "#c2410c", muted: "#8a8473",
  chrome: "#191613", chromeLine: "#2e2a23", chromeInk: "#ece7db", chromeMuted: "#9b9482", ember: "#e8590c",
};

// Free aerial sources (no API key). Both are ArcGIS MapServers that support
// both XYZ tiles (for the map) and `export` (for the planner underlay capture).
const BASEMAPS = {
  esri: {
    label: "Esri",
    tiles: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    export: "https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/export",
    maxNative: 19,
    attr: "Imagery &copy; Esri, Maxar",
  },
  usgs: {
    label: "USGS",
    tiles: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}",
    export: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/export",
    maxNative: 16,
    attr: "Imagery &copy; USGS",
  },
};
// Subtle road/place labels overlay (drawn faint over the imagery).
const LABELS_TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}";

// Parcel boundaries are drawn as styleable vector lines (same query path that
// powers click-to-select), not a server image — so they render reliably. They
// load once zoomed in past this level (too many to draw across a whole county).
const PARCEL_MINZOOM = 16;
function makeParcelLayer(url) {
  return EL.featureLayer({
    url,
    minZoom: PARCEL_MINZOOM,
    simplifyFactor: 0.5,
    precision: 6,
    fields: ["OBJECTID"],
    interactive: false, // purely visual; clicks go to the map for add/remove
    style: () => ({ color: "#a21caf", weight: 1.3, opacity: 0.95, fillOpacity: 0 }),
  });
}

// Custom cursors so it's obvious you're adding (+) or removing (−) a parcel.
// Just a + / − with a white halo for contrast — no circle around it.
const ADD_CURSOR =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28'%3E%3Cpath d='M14 5 L14 23 M5 14 L23 14' stroke='%23ffffff' stroke-width='5' stroke-linecap='round'/%3E%3Cpath d='M14 5 L14 23 M5 14 L23 14' stroke='%23c2410c' stroke-width='2.5' stroke-linecap='round'/%3E%3C/svg%3E\") 14 14, crosshair";
const REMOVE_CURSOR =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28'%3E%3Cpath d='M5 14 L23 14' stroke='%23ffffff' stroke-width='5' stroke-linecap='round'/%3E%3Cpath d='M5 14 L23 14' stroke='%23b91c1c' stroke-width='2.5' stroke-linecap='round'/%3E%3C/svg%3E\") 14 14, crosshair";

// Ray-cast point-in-polygon on a [[lat,lng], ...] ring.
function pointInPoly(lat, lng, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i][0], xi = ring[i][1], yj = ring[j][0], xj = ring[j][1];
    if (((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

const ADDR_RE = /(situs|site_?addr|prop_?addr|loc_?addr|location|^addr|str_?name|full_?addr|address)/i;
const ID_RE = /(hcad_?num|^acct|account|parcel_?id|prop_?id|^pid$|quick_?ref|geo_?id|^pin$|^gid$|objectid)/i;
const findVal = (attrs, re) => {
  const k = Object.keys(attrs || {}).find((key) => re.test(key) && attrs[key] != null && attrs[key] !== "");
  return k ? String(attrs[k]) : null;
};
const shoelace = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const j = (i + 1) % pts.length; a += pts[i].x * pts[j].y - pts[j].x * pts[i].y; }
  return Math.abs(a) / 2;
};

// Build the planner hand-off: all selected parcels in one shared feet frame,
// plus an aerial export covering them.
function computeAssembly(selected, exportBase) {
  if (!selected.length) return null;
  let lonMin = Infinity, lonMax = -Infinity, latMin = Infinity, latMax = -Infinity;
  selected.forEach((s) => s.ring.forEach(([lon, lat]) => {
    lonMin = Math.min(lonMin, lon); lonMax = Math.max(lonMax, lon);
    latMin = Math.min(latMin, lat); latMax = Math.max(latMax, lat);
  }));
  const lon0 = (lonMin + lonMax) / 2, lat0 = (latMin + latMax) / 2;
  const parcels = selected.map((s) => ({ points: lngLatRingToFeet(s.ring, lon0, lat0), addr: s.addr || null, acct: s.acct || null, attrs: s.attrs || null }));
  const totalSqft = parcels.reduce((sum, p) => sum + shoelace(p.points), 0);
  // Generous context around the site so you can see access roads / neighbors.
  const padLon = Math.max((lonMax - lonMin) * 0.4, 0.0012);
  const padLat = Math.max((latMax - latMin) * 0.4, 0.001);
  const bbox = { lonMin: lonMin - padLon, lonMax: lonMax + padLon, latMin: latMin - padLat, latMax: latMax + padLat };
  const underlay = { ...aerialPlacement(bbox, lon0, lat0, { exportBase }), opacity: 1, locked: true, fromMap: true };
  return { parcels, underlay, totalAc: totalSqft / 43560, origin: { lat: lat0, lon: lon0 } };
}

// Acreage of a stored site from its planner-feet parcels.
function siteAcres(site) {
  if (!site.parcels?.length) return 0;
  return site.parcels.reduce((s, p) => s + shoelace(p.points), 0) / 43560;
}

export default function MapFinder({ visible, county, onCounty, sites = [], activeSiteId, onOpenSite, onDeleteSite, onUseParcels, onSkip }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const displayRef = useRef(null);   // visible parcel-line layer
  const sitesLayerRef = useRef(null); // saved-site footprints
  const onOpenSiteRef = useRef(onOpenSite);
  useEffect(() => { onOpenSiteRef.current = onOpenSite; }, [onOpenSite]);
  const hilitesRef = useRef({});     // key -> L.polygon for each selected parcel
  const layerUrlRef = useRef(null);  // queryable layer URL
  const imageryRef = useRef(null);
  const labelsRef = useRef(null);
  const selectModeRef = useRef(false); // read by the once-bound map handlers
  const selectedRef = useRef([]);
  const draggingRef = useRef(false);
  const [addr, setAddr] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [basemap, setBasemap] = useState("esri");
  const [labels, setLabels] = useState(true);
  const [selectMode, setSelectMode] = useState(false); // off = pan only; on = add/remove parcels
  const [zoom, setZoom] = useState(null);
  const [selected, setSelected] = useState([]); // [{key, ring, latlngs, addr, acct}]
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  const clearHilites = () => {
    const map = mapRef.current;
    Object.values(hilitesRef.current).forEach((p) => map && map.removeLayer(p));
    hilitesRef.current = {};
  };

  /* create the map once */
  useEffect(() => {
    const cfg = COUNTIES_MAP[county] || COUNTIES_MAP.harris;
    const map = L.map(elRef.current, { zoomControl: true, minZoom: 8, maxZoom: 21 }).setView(cfg.center, cfg.zoom);
    mapRef.current = map;
    setZoom(map.getZoom());
    const onClick = (e) => { if (selectModeRef.current) handleClick(e.latlng); };
    const onZoom = () => setZoom(map.getZoom());
    const onMouseMove = (e) => {
      if (!selectModeRef.current || draggingRef.current) return; // don't fight the grab cursor while panning
      const inside = selectedRef.current.some((s) => pointInPoly(e.latlng.lat, e.latlng.lng, s.latlngs));
      map.getContainer().style.cursor = inside ? REMOVE_CURSOR : ADD_CURSOR;
    };
    const onDragStart = () => { draggingRef.current = true; map.getContainer().style.cursor = "grabbing"; };
    const onDragEnd = () => { draggingRef.current = false; map.getContainer().style.cursor = selectModeRef.current ? ADD_CURSOR : ""; };
    map.on("click", onClick);
    map.on("zoomend", onZoom);
    map.on("mousemove", onMouseMove);
    map.on("dragstart", onDragStart);
    map.on("dragend", onDragEnd);
    return () => { map.off("click", onClick); map.off("zoomend", onZoom); map.off("mousemove", onMouseMove); map.off("dragstart", onDragStart); map.off("dragend", onDragEnd); map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* aerial imagery layer (swappable source) */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const bm = BASEMAPS[basemap] || BASEMAPS.esri;
    const layer = L.tileLayer(bm.tiles, { maxZoom: 21, maxNativeZoom: bm.maxNative, attribution: bm.attr });
    layer.setZIndex(1);
    layer.addTo(map);
    imageryRef.current = layer;
    return () => { try { map.removeLayer(layer); } catch (_) {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap]);

  /* faint labels overlay (toggle) */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !labels) return;
    const layer = L.tileLayer(LABELS_TILES, { maxZoom: 21, opacity: 0.4 });
    layer.setZIndex(2);
    layer.addTo(map);
    labelsRef.current = layer;
    return () => { try { map.removeLayer(layer); } catch (_) {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labels]);

  /* keep the map sized correctly when shown after being hidden */
  useEffect(() => {
    if (visible && mapRef.current) {
      const t = setTimeout(() => mapRef.current && mapRef.current.invalidateSize(), 60);
      return () => clearTimeout(t);
    }
  }, [visible]);

  /* Saved sites on the overview map. Zoomed out: a branded pin per site.
     Zoomed in (>= PLAN_ZOOM): the actual site plan — parcel boundary plus every
     element in its true colors — georeferenced via the site's origin. Clickable
     to open (unless we're in parcel-select mode, where clicks add parcels). */
  const PLAN_ZOOM = 15;
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (sitesLayerRef.current) { map.removeLayer(sitesLayerRef.current); sitesLayerRef.current = null; }
    const group = L.layerGroup();
    const showPlans = (zoom ?? 0) >= PLAN_ZOOM;
    sites.forEach((site) => {
      if (!site.origin) return; // blank-planner sites have no geo anchor
      const { lat, lon } = site.origin;
      const active = site.id === activeSiteId;
      const tip = `${site.site || site.name || "Site"} · ${siteAcres(site).toFixed(1)} ac · click to open`;
      const openSiteNow = () => onOpenSiteRef.current && onOpenSiteRef.current(site.id);

      if (showPlans && site.parcels?.length) {
        // parcel boundary
        site.parcels.forEach((p) => {
          if (!p.points?.length) return;
          const poly = L.polygon(p.points.map((pt) => feetToLatLng(pt, lat, lon)), {
            color: active ? "#e8590c" : "#22d3ee", weight: 2.25, dashArray: "6 5",
            fillColor: active ? "#e8590c" : "#22d3ee", fillOpacity: 0.05, interactive: !selectMode,
          });
          if (!selectMode) poly.on("click", openSiteNow).bindTooltip(tip, { direction: "top", sticky: true });
          poly.addTo(group);
        });
        // the plan itself: every element in its real fill/stroke (same resolver
        // as the planner canvas, including per-site default colors + overrides)
        [...(site.els || [])].sort(byZ).forEach((el) => {
          const ring = elRingFeet(el);
          if (!ring || ring.length < 3) return;
          const st = elStyle(el, site.settings);
          const poly = L.polygon(ring.map((pt) => feetToLatLng(pt, lat, lon)), {
            color: st.stroke, weight: 1, fillColor: st.fill,
            fillOpacity: Math.min(0.92, st.fillOpacity ?? 1),
            interactive: !selectMode,
          });
          if (!selectMode) poly.on("click", openSiteNow).bindTooltip(tip, { direction: "top", sticky: true });
          poly.addTo(group);
        });
      } else {
        // zoomed out: a branded map pin at the site origin
        const pin = active ? "#e8590c" : "#191613";
        const icon = L.divIcon({
          className: "",
          html: `<div style="filter: drop-shadow(0 3px 7px rgba(0,0,0,.4));">
            <svg width="30" height="40" viewBox="0 0 30 40">
              <path d="M15 39 C15 39 3 22.5 3 13.5 a12 12 0 1 1 24 0 C27 22.5 15 39 15 39Z" fill="${pin}" stroke="#ffffff" stroke-width="2"/>
              <rect x="9.5" y="8" width="6.5" height="11" fill="#fff" opacity=".95"/>
              <rect x="17.6" y="8" width="3" height="6.5" fill="#fff" opacity=".55"/>
            </svg></div>`,
          iconSize: [30, 40], iconAnchor: [15, 38], tooltipAnchor: [0, -34],
        });
        const marker = L.marker([lat, lon], { icon, interactive: !selectMode, keyboard: false });
        if (!selectMode) marker.on("click", openSiteNow).bindTooltip(tip, { direction: "top" });
        marker.addTo(group);
      }
    });
    group.addTo(map);
    sitesLayerRef.current = group;
    return () => { try { map.removeLayer(group); } catch (_) {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sites, activeSiteId, selectMode, zoom]);

  const flyToSite = (site) => {
    if (site.origin && mapRef.current) mapRef.current.flyTo([site.origin.lat, site.origin.lon], 17, { duration: 0.7 });
  };

  /* resolve the parcel layer URL + draw boundaries when the county changes */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const cfg = COUNTIES_MAP[county];
    if (!cfg) return;
    setSelected([]); setErr(""); clearHilites();
    if (displayRef.current) { map.removeLayer(displayRef.current); displayRef.current = null; }
    map.setView(cfg.center, cfg.zoom);
    layerUrlRef.current = null;
    let cancelled = false;
    (async () => {
      try {
        const url = await resolveLayerUrl(cfg.layerUrl || cfg.mapServer);
        if (cancelled) return;
        layerUrlRef.current = url;
        if (selectModeRef.current && !displayRef.current) {
          const fl = makeParcelLayer(url);
          fl.on("requesterror", () => setErr("Parcel outlines are heavy here — clicking a lot still adds it."));
          fl.addTo(map);
          displayRef.current = fl;
        }
      } catch (e) {
        if (!cancelled) setErr(`Couldn't reach the ${COUNTIES[county]?.label || "county"} parcel service. Pan the aerial and trace by hand, or try again.`);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [county]);

  /* enter/leave select mode: show outlines, set the +/− cursor, enable clicks */
  useEffect(() => {
    selectModeRef.current = selectMode;
    const map = mapRef.current;
    if (!map) return;
    if (selectMode) {
      if (!displayRef.current && layerUrlRef.current) {
        const fl = makeParcelLayer(layerUrlRef.current);
        fl.on("requesterror", () => setErr("Parcel outlines are heavy here — clicking a lot still adds it."));
        fl.addTo(map);
        displayRef.current = fl;
      }
      map.getContainer().style.cursor = ADD_CURSOR;
    } else {
      if (displayRef.current) { map.removeLayer(displayRef.current); displayRef.current = null; }
      map.getContainer().style.cursor = "";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectMode]);

  const handleClick = async (latlng) => {
    const url = layerUrlRef.current;
    if (!url) { setErr("Parcel layer is still loading — give it a second and click again."); return; }
    setBusy(true); setErr("");
    try {
      const feat = await queryAtPoint(url, latlng.lng, latlng.lat);
      if (!feat) { setErr("No parcel right there — zoom in and click directly on a lot."); return; }
      const ring = largestRingLngLat(feat);
      if (!ring) { setErr("That record has no polygon shape — try an adjacent lot."); return; }
      const attrs = feat.attributes || {};
      const key = String(attrs.OBJECTID ?? attrs.objectid ?? `${ring[0][0].toFixed(6)},${ring[0][1].toFixed(6)}`);
      const map = mapRef.current;
      if (hilitesRef.current[key]) {
        // toggle off
        map.removeLayer(hilitesRef.current[key]);
        delete hilitesRef.current[key];
        setSelected((s) => s.filter((x) => x.key !== key));
      } else {
        const latlngs = ring.map(([lon, lat]) => [lat, lon]);
        hilitesRef.current[key] = L.polygon(latlngs, { color: PAL.accent, weight: 2.5, fillColor: PAL.accent, fillOpacity: 0.14, interactive: false }).addTo(map);
        setSelected((s) => [...s, { key, ring, latlngs, addr: findVal(attrs, ADDR_RE), acct: findVal(attrs, ID_RE), attrs }]);
      }
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

  const clearSel = () => { clearHilites(); setSelected([]); };
  // Always capture the planner underlay from Esri: it supports image `export`
  // (USGS tiles render on the map but its export op returns no image). The
  // boundary aligns to either source, so the planner aerial stays reliable.
  const planSelected = () => {
    const asm = computeAssembly(selected, BASEMAPS.esri.export);
    if (asm) onUseParcels({ ...asm, name: selected[selected.length - 1]?.addr || "Untitled site", county });
  };

  const asm = selected.length ? computeAssembly(selected, BASEMAPS.esri.export) : null;

  const btn = (primary) => ({
    padding: "8px 14px", fontSize: 13, borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
    border: `1px solid ${primary ? PAL.accent : PAL.panelLine}`, background: primary ? PAL.accent : "#fbfaf6",
    color: primary ? "#fff" : PAL.ink, fontWeight: primary ? 600 : 500,
    boxShadow: primary ? "0 2px 8px rgba(232,89,12,0.3)" : "none",
  });
  const field = { padding: "8px 10px", fontSize: 13, border: `1px solid ${PAL.panelLine}`, borderRadius: 8, color: PAL.ink, background: "#fff", fontFamily: "inherit" };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#efeadf" }}>
      {/* top bar — dark graphite chrome */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 14px", height: 52, background: PAL.chrome, borderBottom: `1px solid ${PAL.chromeLine}`, boxShadow: "0 6px 20px rgba(0,0,0,0.18)", flexWrap: "nowrap", zIndex: 1000 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ width: 22, height: 22, borderRadius: 6, background: `linear-gradient(150deg, ${PAL.ember}, #c2410c)`, display: "grid", placeItems: "center", boxShadow: "0 2px 6px rgba(232,89,12,0.45)", flex: "none" }}>
            <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="7" height="12" rx="1" fill="#fff" opacity="0.95" /><rect x="10.5" y="2" width="3.5" height="6.5" rx="0.8" fill="#fff" opacity="0.6" /></svg>
          </span>
          <span style={{ fontWeight: 800, fontSize: 15, color: "#fff", letterSpacing: "-0.01em" }}>Site Planar</span>
          <span style={{ color: PAL.chromeMuted, fontSize: 11, fontWeight: 500, borderLeft: `1px solid ${PAL.chromeLine}`, paddingLeft: 9 }}>Find a site</span>
        </div>
        <select style={{ ...field, fontWeight: 600, marginLeft: 4 }} value={county} onChange={(e) => onCounty(e.target.value)}>
          {Object.entries(COUNTIES).map(([k, c]) => <option key={k} value={k}>{c.label}{c.experimental ? " (beta)" : ""}</option>)}
        </select>
        <div style={{ display: "flex", gap: 0, flex: 1, minWidth: 220, maxWidth: 460 }}>
          <input style={{ ...field, flex: 1, borderRadius: "7px 0 0 7px" }} placeholder="Go to an address or place…" value={addr}
            onChange={(e) => setAddr(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") goAddress(); }} />
          <button style={{ ...btn(true), borderRadius: "0 7px 7px 0", borderLeft: "none" }} disabled={busy} onClick={goAddress}>{busy ? "…" : "Go"}</button>
        </div>
        <div style={{ flex: 1 }} />
        <button className="dbtn" style={{ padding: "7px 13px", fontSize: 13, borderRadius: 8, border: `1px solid ${PAL.chromeLine}`, background: "rgba(255,255,255,0.06)", color: PAL.chromeInk, cursor: "pointer", fontFamily: "inherit", fontWeight: 600, whiteSpace: "nowrap" }} onClick={onSkip}>Open site planner →</button>
      </div>

      {/* map */}
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        <div ref={elRef} style={{ position: "absolute", inset: 0 }} />

        {/* saved sites */}
        {sites.length > 0 && (
          <div style={{ position: "absolute", top: 10, left: 10, zIndex: 1000, width: 232, background: "rgba(255,255,255,0.96)", border: `1px solid ${PAL.panelLine}`, borderRadius: 10, boxShadow: "0 4px 18px rgba(28,25,20,0.14)", overflow: "hidden" }}>
            <div style={{ fontSize: 10.5, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700, padding: "9px 12px 6px" }}>Your sites · {sites.length}</div>
            <div style={{ maxHeight: 280, overflowY: "auto", paddingBottom: 4 }}>
              {sites.map((s) => {
                const isActive = s.id === activeSiteId;
                return (
                  <div key={s.id} title={s.origin ? "Open site (double-click to fly here)" : "Open site"}
                    onClick={() => onOpenSite && onOpenSite(s.id)}
                    onDoubleClick={() => flyToSite(s)}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", cursor: "pointer", borderLeft: `3px solid ${isActive ? PAL.accent : "transparent"}`, background: isActive ? "#fbf3ee" : "transparent" }}>
                    <span style={{ width: 9, height: 9, borderRadius: 2.5, flex: "none", background: s.origin ? "#22d3ee" : "#d6cfbe", border: "1px solid rgba(0,0,0,0.15)" }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: PAL.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.site || s.name || "Untitled site"}</div>
                      <div style={{ fontSize: 10.5, color: PAL.muted, fontFamily: "ui-monospace, Menlo, monospace" }}>{siteAcres(s) > 0 ? `${siteAcres(s).toFixed(1)} ac` : "no boundary"}{(s.els?.length ? ` · ${s.els.length} elem` : "")}</div>
                    </div>
                    {s.origin && <button title="Show on map (zoom to the plan)" onClick={(e) => { e.stopPropagation(); flyToSite(s); }}
                      style={{ border: "none", background: "transparent", color: PAL.muted, cursor: "pointer", fontSize: 13, lineHeight: 1, padding: "2px 3px", borderRadius: 5 }}>◎</button>}
                    <button title="Delete site and all its plans" onClick={(e) => { e.stopPropagation(); if (confirm(`Delete "${s.site || s.name || "this site"}" and all its plans? This can't be undone.`)) onDeleteSite && onDeleteSite(s.id); }}
                      style={{ border: "none", background: "transparent", color: PAL.muted, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "2px 4px", borderRadius: 5 }}>✕</button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* imagery + labels control */}
        <div style={{ position: "absolute", top: 10, right: 10, zIndex: 1000, background: "rgba(255,255,255,0.94)", border: `1px solid ${PAL.panelLine}`, borderRadius: 8, padding: "6px 9px", display: "flex", gap: 10, alignItems: "center", fontSize: 12, color: PAL.ink, boxShadow: "0 2px 8px rgba(0,0,0,0.12)" }}>
          <button onClick={() => setSelectMode((m) => !m)} style={{
            padding: "6px 11px", fontSize: 12.5, borderRadius: 7, cursor: "pointer", fontWeight: 600, fontFamily: "inherit",
            border: `1px solid ${PAL.accent}`, background: selectMode ? "#fff" : PAL.accent, color: selectMode ? PAL.accent : "#fff",
          }}>{selectMode ? "✓ Selecting — click lots" : "+ Select parcels"}</button>
          <span style={{ color: PAL.muted }}>Imagery</span>
          <select style={{ ...field, padding: "4px 6px", fontSize: 12 }} value={basemap} onChange={(e) => setBasemap(e.target.value)}>
            {Object.entries(BASEMAPS).map(([k, b]) => <option key={k} value={k}>{b.label}</option>)}
          </select>
          <label style={{ display: "flex", gap: 5, alignItems: "center", cursor: "pointer" }}>
            <input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} /> Labels
          </label>
        </div>

        {/* instruction / error */}
        <div style={{ position: "absolute", left: 12, bottom: 12, zIndex: 1000, maxWidth: 380, background: "rgba(255,255,255,0.94)", border: `1px solid ${PAL.panelLine}`, borderRadius: 8, padding: "8px 11px", fontSize: 12.5, color: err ? PAL.accent : PAL.ink, lineHeight: 1.45, pointerEvents: "none" }}>
          {err
            ? err
            : !selectMode
              ? "Drag to move the map. Hit “+ Select parcels” (top-right) to start adding lots."
              : zoom != null && zoom < PARCEL_MINZOOM
                ? "Zoom in until the purple lot lines show, then click a lot to add it (＋). Click an added lot to remove it (−)."
                : "Click a lot to add it (＋). Hover an added lot and click to remove it (−). Add several, then Plan."}
        </div>

        {/* selection card */}
        {selected.length > 0 && (
          <div style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", bottom: 20, zIndex: 1000, background: PAL.panelBg, border: `1px solid ${PAL.panelLine}`, borderRadius: 14, boxShadow: "0 14px 40px rgba(0,0,0,0.26), 0 2px 8px rgba(0,0,0,0.12)", padding: "14px 16px", minWidth: 320, maxWidth: 480 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 10.5, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600, marginBottom: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: 99, background: PAL.accent }} />
              {selected.length} parcel{selected.length > 1 ? "s" : ""} · <span style={{ color: PAL.ink, fontWeight: 700 }}>{asm ? asm.totalAc.toFixed(2) : "—"} ac</span>
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: PAL.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {selected[selected.length - 1].addr || "Parcel"}{selected.length > 1 ? ` +${selected.length - 1} more` : ""}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button style={{ ...btn(true), flex: 1, padding: "9px 14px" }} onClick={planSelected}>Plan {selected.length > 1 ? `${selected.length} parcels` : "this site"} →</button>
              <button style={btn(false)} onClick={clearSel}>Clear</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
