/* Shared layer-toggle UI — rendered on BOTH the map finder and the site planner
 * so the controls never diverge. Given the per-layer `overlays` state and its
 * setter, it lists the statewide overlays plus the current county's jurisdiction
 * layers, each with a checkbox, opacity slider and disclaimer note. */
import { STATEWIDE, jurisdictionFor } from "../lib/layers.js";

const MUTED = "#8a8473", LINE = "#e7e2d6", INK = "#2c2a26";

export default function LayerPanel({ overlays, setOverlays, county, compact = false }) {
  const jur = jurisdictionFor(county);
  const set = (k, patch) => setOverlays((o) => ({ ...o, [k]: { ...o[k], ...patch } }));

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
