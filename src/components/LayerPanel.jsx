/* Shared layer-toggle UI — rendered on BOTH the map finder and the site planner
 * so the controls never diverge. Given the per-layer `overlays` state and its
 * setter, it lists the statewide overlays plus the current county's jurisdiction
 * layers, each with a checkbox, opacity slider and disclaimer note. */
import { useState } from "react";
import { STATEWIDE, EVIDENCE, jurisdictionFor } from "../lib/layers.js";
import { mapillaryToken, setMapillaryToken } from "../lib/evidenceLayers.js";

const MUTED = "#8a8473", LINE = "#e7e2d6", INK = "#2c2a26";
const groupHdr = { fontSize: 10, color: MUTED, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", margin: "6px 0 4px" };

export default function LayerPanel({ overlays, setOverlays, county, compact = false }) {
  const jur = jurisdictionFor(county);
  const set = (k, patch) => setOverlays((o) => ({ ...o, [k]: { ...o[k], ...patch } }));
  const [tok, setTok] = useState(() => mapillaryToken());

  const row = (k, cfg) => {
    const st = overlays[k];
    if (!st) return null;
    return (
      <div key={k} style={{ marginBottom: 5 }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
          <input type="checkbox" checked={st.on} onChange={(e) => set(k, { on: e.target.checked })} />
          <span style={{ flex: 1, fontSize: compact ? 12 : 12.5, color: INK }}>{cfg.label}</span>
        </label>
        {st.on && (
          <input type="range" min={0.1} max={1} step={0.05} value={st.opacity}
            title="Layer opacity" aria-label={`${cfg.label} opacity`}
            onChange={(e) => set(k, { opacity: +e.target.value })}
            style={{ width: "100%", marginTop: 2 }} />
        )}
        {st.on && cfg.note && (
          <div style={{ fontSize: 10.5, color: MUTED, lineHeight: 1.4, marginTop: 2 }}>{cfg.note}</div>
        )}
      </div>
    );
  };

  return (
    <div>
      {Object.entries(STATEWIDE).map(([k, cfg]) => row(k, cfg))}

      <div style={{ borderTop: `1px solid ${LINE}`, margin: "6px 0 0" }} />
      <div style={groupHdr}>Utility evidence</div>
      {Object.entries(EVIDENCE).map(([k, cfg]) => row(k, cfg))}
      {overlays.mapillary?.on && (
        <div style={{ marginBottom: 5 }}>
          <input type="password" value={tok} placeholder="Mapillary token (MLY|…)" autoComplete="off"
            onChange={(e) => { setTok(e.target.value); setMapillaryToken(e.target.value.trim()); }}
            style={{ width: "100%", boxSizing: "border-box", padding: "5px 7px", fontSize: 11, fontFamily: "ui-monospace, monospace", border: `1px solid ${LINE}`, borderRadius: 6, color: INK }} />
          <div style={{ fontSize: 10, color: MUTED, lineHeight: 1.4, marginTop: 2 }}>
            {tok ? "Stored on this device only." : "Free at mapillary.com/dashboard/developers — or set VITE_MAPILLARY_TOKEN at build."}
          </div>
        </div>
      )}

      <div style={{ borderTop: `1px solid ${LINE}`, margin: "6px 0 5px" }} />
      <div style={{ fontSize: 10, color: MUTED, fontWeight: 700, marginBottom: 4, lineHeight: 1.3 }}>
        {jur ? jur.label : "This jurisdiction"}
      </div>
      {jur && Object.keys(jur.layers || {}).length > 0
        ? Object.entries(jur.layers).map(([k, cfg]) => row(k, cfg))
        : <div style={{ fontSize: 10.5, color: MUTED, lineHeight: 1.4 }}>{(jur && jur.note) || "No local GIS layers wired for this jurisdiction yet."}</div>}
    </div>
  );
}
