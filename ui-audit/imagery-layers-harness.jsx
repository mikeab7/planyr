/* Dev-only harness (not part of the app build): mounts the REAL Imagery & Layers panel (components/LayerPanel.jsx) inside a card
 * of a chosen width, exactly as the planner / map finder host it, so ui-audit/verify-imagery-layers-panel.mjs can assert the
 * redesign against rendered DOM at phone + desktop widths, in both themes, for a Texas / Harris / Georgia / Colorado site.
 *
 * Config comes from the URL so a verifier can open one page per case:
 *   ?surface=planner|finder  &w=372  &theme=light|dark  &state=TX|GA|CO|CA|none  &lat=29.76&lng=-95.37  &county=harris
 *   &zoom=15|none  &unlocated=1  &on=fema,contours  &relevance=all|dim|hide  &corridor=on  &corridorWidth=60  &hidden=1
 * Runs under `vite` dev, which serves /src and this file. */
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import LayerPanel from "../src/workspaces/site-planner/components/LayerPanel.jsx";
import { defaultOverlayState } from "../src/workspaces/site-planner/lib/layers.js";
import { PLANNER_BASEMAP_CHOICES, FINDER_BASEMAP_CHOICES } from "../src/shared/basemaps/basemaps.js";
import { setRelevanceMode } from "../src/workspaces/site-planner/lib/coverage.js";
import { setLayersHidden } from "../src/workspaces/site-planner/lib/layerHide.js";

const q = new URLSearchParams(location.search);
const surface = q.get("surface") || "planner";
const width = Number(q.get("w") || 372);
const state = q.get("state") === "none" ? null : (q.get("state") || "TX");
const lat = q.get("lat") != null ? Number(q.get("lat")) : null;
const lng = q.get("lng") != null ? Number(q.get("lng")) : null;
const county = q.get("county") || "harris";
const zoom = q.get("zoom") === "none" ? null : Number(q.get("zoom") || 17);
const unlocated = q.get("unlocated") === "1";
const onList = (q.get("on") || "").split(",").filter(Boolean);
document.body.setAttribute("data-theme", q.get("theme") === "dark" ? "dark" : "light");
if (q.get("relevance")) setRelevanceMode(q.get("relevance"));
if (q.get("hidden") === "1") setLayersHidden(true);

function Host() {
  const [ov, setOv] = useState(() => {
    const o = defaultOverlayState();
    onList.forEach((k) => { if (o[k]) o[k].on = true; });
    if (q.get("corridor") === "on") o.txrrc_pipe_easement.on = true;
    if (q.get("corridorWidth")) o.txrrc_pipe_easement.widthFt = Number(q.get("corridorWidth"));
    return o;
  });
  const [bm, setBm] = useState(surface === "planner" ? "esri" : "esri");
  const [roads, setRoads] = useState(true);
  const [roadOp, setRoadOp] = useState(0.85);
  const [cities, setCities] = useState(true);
  const [sites, setSites] = useState(true), [comps, setComps] = useState(true), [notes, setNotes] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [lastZoom, setLastZoom] = useState(null);
  window.__overlays = ov;
  window.__lastZoom = lastZoom;
  const finder = surface === "finder";
  return (
    <div data-wheelscroll="1" id="card" style={{ width, maxHeight: 640, background: "var(--surface-overlay)", border: "1px solid var(--border-default)", borderRadius: 12, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {collapsed ? (
        <button id="expand" onClick={() => setCollapsed(false)} style={{ padding: 8 }}>Imagery &amp; Layers ▸</button>
      ) : (
        <div id="scroll" style={{ padding: "8px 11px 10px", overflowY: "auto", flex: 1, minHeight: 0 }}>
          <LayerPanel overlays={ov} setOverlays={setOv} county={county} siteCounty={state === "TX" ? county : null} layerStatus={{}} coverage={{}} surface={surface}
            siteState={state} siteLocation={lat != null && lng != null ? { lat, lng } : null}
            mapZoom={zoom} onZoomTo={(z) => setLastZoom(z)} onCollapse={() => setCollapsed(true)}
            gisNote={unlocated ? "GIS layers (flood, wetlands, boundaries, utilities) appear here once this plan has a location." : null}
            onSetLocation={unlocated ? () => {} : null}
            basemap={{ choices: finder ? FINDER_BASEMAP_CHOICES : PLANNER_BASEMAP_CHOICES, value: bm, onChange: setBm, status: "loaded", disabledReason: unlocated ? "This plan has no location yet — the aerial needs a real-world spot to anchor to." : null }}
            placeNames={{ value: roads, onChange: setRoads, opacity: roadOp, onOpacityChange: setRoadOp }}
            cityNames={finder ? { value: cities, onChange: setCities } : null}
            yourData={finder ? [
              { id: "sites", label: "Sites", count: 3, value: sites, onChange: setSites, testId: "map-show-sites" },
              { id: "comps", label: "Comps", count: 2, value: comps, onChange: setComps, testId: "map-show-comps" },
              { id: "notes", label: "Notes", count: 0, value: notes, onChange: setNotes, testId: "map-show-notes" },
            ] : null} />
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<Host />);
window.__READY__ = true;
