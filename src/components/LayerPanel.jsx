/* Shared layer-toggle UI — rendered on BOTH the map finder and the site planner
 * so the controls never diverge. Given the per-layer `overlays` state + setter and
 * the shared `layerStatus`, it lists the statewide overlays, the utility-evidence
 * layers, and the current county's jurisdiction layers — each with a checkbox,
 * opacity slider, a live status indicator (loading/loaded/empty/failed-with-reason)
 * and a disclaimer note. */
import { useState } from "react";
import { STATEWIDE, EVIDENCE, jurisdictionFor } from "../lib/layers.js";
import { mapillaryToken, setMapillaryToken } from "../lib/evidenceLayers.js";

const MUTED = "#8a8473", LINE = "#e7e2d6", INK = "#2c2a26";
const groupHdr = { fontSize: 10, color: MUTED, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", margin: "6px 0 4px" };
const STATUS = {
  loading: { color: "#f59e0b", label: "loading…" },
  loaded: { color: "#15803d", label: "loaded" },
  empty: { color: "#9b9482", label: "no data" },
  failed: { color: "#b91c1c", label: "failed" },
};

export default function LayerPanel({ overlays, setOverlays, county, layerStatus = {}, compact = false }) {
  const jur = jurisdictionFor(county);
  const set = (k, patch) => setOverlays((o) => ({ ...o, [k]: { ...o[k], ...patch } }));
  const [tok, setTok] = useState(() => mapillaryToken());

  const row = (k, cfg) => {
    const st = overlays[k];
    if (!st) return null;
    const ls = st.on ? layerStatus[k] : null;
    const meta = ls && STATUS[ls.state];
    return (
      <div key={k} style={{ marginBottom: 5 }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
          <input type="checkbox" checked={st.on} onChange={(e) => set(k, { on: e.target.checked })} />
          <span style={{ flex: 1, fontSize: compact ? 12 : 12.5, color: INK }}>{cfg.label}</span>
          {meta && (
            <span title={meta.label} style={{ width: 8, height: 8, borderRadius: 99, flex: "none", background: meta.color,
              animation: ls.state === "loading" ? "pf-pulse 1.1s ease-in-out infinite" : "none" }} />
          )}
        </label>
        {st.on && (
          <input type="range" min={0.1} max={1} step={0.05} value={st.opacity}
            title="Layer opacity" aria-label={`${cfg.label} opacity`}
            onChange={(e) => set(k, { opacity: +e.target.value })}
            style={{ width: "100%", marginTop: 2 }} />
        )}
        {/* status reason (failed / empty) */}
        {meta && (ls.state === "failed" || ls.state === "empty") && (
          <div style={{ fontSize: 10, color: meta.color, lineHeight: 1.35, marginTop: 1 }}>
            {ls.msg || meta.label}
          </div>
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
          {!tok && (
            <div style={{ fontSize: 10.5, color: "#b45309", fontWeight: 600, lineHeight: 1.4, marginBottom: 3 }}>
              Add a Mapillary token to enable this layer:
            </div>
          )}
          <input type="password" value={tok} placeholder="Mapillary token (MLY|…)" autoComplete="off"
            onChange={(e) => { setTok(e.target.value); setMapillaryToken(e.target.value.trim()); }}
            style={{ width: "100%", boxSizing: "border-box", padding: "5px 7px", fontSize: 11, fontFamily: "ui-monospace, monospace", border: `1px solid ${tok ? LINE : "#b45309"}`, borderRadius: 6, color: INK }} />
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
