/* Shared layer-toggle UI — rendered on BOTH the map finder and the site planner
 * so the controls never diverge. Given the per-layer `overlays` state + setter and
 * the shared `layerStatus`, it lists the statewide overlays, the utility-evidence
 * layers, and the current county's jurisdiction layers — each with a checkbox,
 * opacity slider, a live status indicator (loading/loaded/empty/failed-with-reason)
 * and a disclaimer note. */
import { useEffect, useState } from "react";
import { STATEWIDE, JURISDICTIONS, EVIDENCE, jurisdictionFor, layerVintage } from "../lib/layers.js";
import { mapillaryToken, setMapillaryToken, subscribeMapillaryToken } from "../lib/evidenceLayers.js";
import { formatAge } from "../lib/gisCache.js";

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
  useEffect(() => subscribeMapillaryToken(setTok), []); // keep both LayerPanel copies in sync (B46)
  // Tick every 30s so a cached layer's age keeps counting up while the panel is open
  // (screening-only honesty — a stale boundary should never look current) (B75).
  const [, forceTick] = useState(0);
  useEffect(() => { const t = setInterval(() => forceTick((n) => n + 1), 30000); return () => clearInterval(t); }, []);
  // Collapsible groups so the panel fits on one page without scrolling (B97). Collapse state
  // persists per device; each header shows how many layers in the group are currently on.
  const [collapsed, setCollapsed] = useState(() => { try { return JSON.parse(localStorage.getItem("planarfit:layerGroups:v1") || "{}") || {}; } catch (_) { return {}; } });
  const toggleGroup = (g) => setCollapsed((c) => { const n = { ...c, [g]: !c[g] }; try { localStorage.setItem("planarfit:layerGroups:v1", JSON.stringify(n)); } catch (_) {} return n; });
  const onCount = (obj) => Object.keys(obj).filter((k) => overlays[k]?.on).length;
  const groupHead = (g, label, count) => (
    <button onClick={() => toggleGroup(g)} title={collapsed[g] ? "Show" : "Hide"}
      style={{ ...groupHdr, display: "flex", alignItems: "center", gap: 6, width: "100%", background: "transparent", border: "none", padding: "5px 0 4px", margin: "5px 0 3px", cursor: "pointer" }}>
      <span style={{ fontSize: 8, lineHeight: 1, transform: collapsed[g] ? "rotate(-90deg)" : "none", display: "inline-block" }}>▼</span>
      <span style={{ flex: 1, textAlign: "left" }}>{label}</span>
      {count > 0 && <span style={{ color: INK, fontWeight: 700 }}>{count} on</span>}
    </button>
  );

  const row = (k, cfg) => {
    const st = overlays[k];
    if (!st) return null;
    const ls = st.on ? layerStatus[k] : null;
    const meta = ls && STATUS[ls.state];
    const age = ls && ls.ts ? formatAge(Date.now() - ls.ts) : "";
    const vintage = layerVintage(k, cfg); // NEW-5 (B234): source vintage, distinct from refreshed-age
    return (
      <div key={k} style={{ marginBottom: 5 }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
          <input type="checkbox" checked={st.on} onChange={(e) => set(k, { on: e.target.checked })} />
          <span style={{ flex: 1, fontSize: compact ? 12 : 12.5, color: INK }}>{cfg.label}</span>
          {age && (ls.state === "loaded" || ls.state === "empty") && (
            <span title={`Cached copy — refreshed ${age}${ls.stale ? " · showing last-good while it refreshes" : ""}. Screening only; verify against the source.`}
              style={{ fontSize: 9.5, color: ls.stale ? "#b45309" : MUTED, flex: "none", whiteSpace: "nowrap" }}>{age}</span>
          )}
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
        {/* NEW-5 (B234): source VINTAGE — the data's own currency, low-weight + honest
            ("vintage unknown" when the source exposes none). Kept distinct from the
            "refreshed Xm ago" cache-age above (that's when WE pulled the copy). */}
        {st.on && (
          <div title={`Source vintage — ${cfg.label}'s own effective / publication date (when the underlying data is current as of). This is NOT when we last fetched it${age ? ` (that's the “${age}” stamp by the name)` : ""}.`}
            style={{ fontSize: 9.5, color: MUTED, lineHeight: 1.35, marginTop: 1, fontStyle: vintage ? "normal" : "italic" }}>
            as of: {vintage || "vintage unknown"}
          </div>
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
      {groupHead("statewide", "Map layers", onCount(STATEWIDE))}
      {!collapsed.statewide && Object.entries(STATEWIDE).map(([k, cfg]) => row(k, cfg))}

      {groupHead("jurbounds", "Jurisdictions", onCount(JURISDICTIONS))}
      {!collapsed.jurbounds && <>
        <div style={{ fontSize: 10, color: MUTED, lineHeight: 1.4, margin: "0 0 4px" }}>
          District lines for screening — a boundary means a district <b>has jurisdiction</b> (can tax/regulate), not that it serves/connects utilities here.
        </div>
        {Object.entries(JURISDICTIONS).map(([k, cfg]) => row(k, cfg))}
      </>}

      {groupHead("evidence", "Utility evidence", onCount(EVIDENCE))}
      {!collapsed.evidence && Object.entries(EVIDENCE).map(([k, cfg]) => row(k, cfg))}
      {!collapsed.evidence && overlays.mapillary?.on && (
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

      {groupHead("jurisdiction", jur ? jur.label : "This jurisdiction", jur ? onCount(jur.layers || {}) : 0)}
      {!collapsed.jurisdiction && (jur && Object.keys(jur.layers || {}).length > 0
        ? Object.entries(jur.layers).map(([k, cfg]) => row(k, cfg))
        : <div style={{ fontSize: 10.5, color: MUTED, lineHeight: 1.4 }}>{(jur && jur.note) || "No local GIS layers wired for this jurisdiction yet."}</div>)}
    </div>
  );
}
