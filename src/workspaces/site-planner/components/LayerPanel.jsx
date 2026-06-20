/* Shared layer-toggle UI — rendered on BOTH the map finder and the site planner
 * so the controls never diverge. Given the per-layer `overlays` state + setter, the
 * shared `layerStatus`, and the per-layer `coverage` map, it lists the statewide
 * overlays, the jurisdiction boundaries, the utility-evidence layers, and the current
 * county's jurisdiction layers — each with a checkbox, opacity slider, a live status
 * indicator (loading/loaded/empty/failed/needs-setup) and a disclaimer note.
 *
 * Coverage-aware picker (NEW-2/B283): a "Relevance" control (Show all / Dim / Hide) +
 * an adjustable "nearby range" decide how OUT-OF-COVERAGE layers (ones whose data
 * doesn't reach the current view — e.g. City-of-Houston sewer when you're in Dallas)
 * are presented. This affects ONLY this list's ordering/visibility — never the map: a
 * layer you turn on always renders everything its source returns for the view.
 */
import { useEffect, useState } from "react";
import { STATEWIDE, JURISDICTIONS, EVIDENCE, jurisdictionFor, layerVintage } from "../lib/layers.js";
import { mapillaryToken, setMapillaryToken, subscribeMapillaryToken } from "../lib/evidenceLayers.js";
import { formatAge } from "../lib/gisCache.js";
import {
  getRelevanceMode, setRelevanceMode, getNearbyRadiusMiles, setNearbyRadiusMiles, subscribeRelevance,
} from "../lib/coverage.js";

const MUTED = "#8a8473", LINE = "#e7e2d6", INK = "#2c2a26";
const groupHdr = { fontSize: 10, color: MUTED, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", margin: "6px 0 4px" };
const STATUS = {
  loading: { color: "#f59e0b", label: "loading…" },
  loaded: { color: "#15803d", label: "loaded" },
  empty: { color: "#9b9482", label: "no data" },
  failed: { color: "#b91c1c", label: "failed" },
  unconfigured: { color: "#9b9482", label: "needs setup" }, // NEW-4: not a failure, just not set up
};
const RELEVANCE_LABEL = { all: "Show all", dim: "Dim", hide: "Hide" };

export default function LayerPanel({ overlays, setOverlays, county, layerStatus = {}, coverage = {}, compact = false }) {
  const jur = jurisdictionFor(county);
  const set = (k, patch) => setOverlays((o) => ({ ...o, [k]: { ...o[k], ...patch } }));
  const [tok, setTok] = useState(() => mapillaryToken());
  useEffect(() => subscribeMapillaryToken(setTok), []); // keep both LayerPanel copies in sync (B46)
  // Tick every 30s so a cached layer's age keeps counting up while the panel is open
  // (screening-only honesty — a stale boundary should never look current) (B75).
  const [, forceTick] = useState(0);
  useEffect(() => { const t = setInterval(() => forceTick((n) => n + 1), 30000); return () => clearInterval(t); }, []);
  // Relevance mode + nearby range (NEW-2): shared across both panels + persisted in
  // coverage.js; subscribe so a change in either Layers panel reflects here live.
  const [mode, setMode] = useState(getRelevanceMode);
  const [radius, setRadius] = useState(getNearbyRadiusMiles);
  useEffect(() => subscribeRelevance((p) => { setMode(p.mode); setRadius(p.radius); }), []);
  const [revealHidden, setRevealHidden] = useState({}); // per-group reveal in "hide" mode
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

  // A layer is "low relevance" here when its data doesn't reach the view (out of
  // coverage) or it isn't configured (Mapillary with no token) — but NEVER if it's
  // currently ON (you should always see what you've enabled). Picker-only signal.
  const lowRel = (k, cfg) => !overlays[k]?.on && (coverage[k] === "out" || (cfg.needsSetup && !tok));

  const row = (k, cfg, { dim = false } = {}) => {
    const st = overlays[k];
    if (!st) return null;
    const ls = st.on ? layerStatus[k] : null;
    const meta = ls && STATUS[ls.state];
    const age = ls && ls.ts ? formatAge(Date.now() - ls.ts) : "";
    const vintage = layerVintage(k, cfg); // B236: source vintage, distinct from refreshed-age
    const outHere = st.on && coverage[k] === "out"; // honest "no data here" for an ON regional layer
    return (
      <div key={k} style={{ marginBottom: 5, opacity: dim ? 0.55 : 1 }}>
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
        {/* NEW-3: plain-language sublabel (and a demoted source/attribution note). */}
        {cfg.sublabel && (
          <div style={{ fontSize: 10.5, color: MUTED, lineHeight: 1.4, margin: "1px 0 0 22px" }}>{cfg.sublabel}</div>
        )}
        {st.on && (
          <input type="range" min={0.1} max={1} step={0.05} value={st.opacity}
            title="Layer opacity" aria-label={`${cfg.label} opacity`}
            onChange={(e) => set(k, { opacity: +e.target.value })}
            style={{ width: "100%", marginTop: 2 }} />
        )}
        {/* B236: source VINTAGE — the data's own currency, kept distinct from the
            "refreshed Xm ago" cache-age above (that's when WE pulled the copy). */}
        {st.on && (
          <div title={`Source vintage — ${cfg.label}'s own effective / publication date (when the underlying data is current as of). This is NOT when we last fetched it${age ? ` (that's the “${age}” stamp by the name)` : ""}.`}
            style={{ fontSize: 9.5, color: MUTED, lineHeight: 1.35, marginTop: 1, fontStyle: vintage ? "normal" : "italic" }}>
            as of: {vintage || "vintage unknown"}
          </div>
        )}
        {/* NEW-1: honest out-of-coverage caption for an ON layer (e.g. COH sewer in
            Dallas) — the map still renders everything the source returns for the view. */}
        {outHere && (
          <div style={{ fontSize: 10, color: "#b45309", lineHeight: 1.4, marginTop: 1 }}>
            No data in this area — this layer only covers its home region. The map still shows whatever the source returns here.
          </div>
        )}
        {/* status reason (failed / empty / needs-setup) */}
        {meta && (ls.state === "failed" || ls.state === "empty" || ls.state === "unconfigured") && (
          <div style={{ fontSize: 10, color: meta.color, lineHeight: 1.35, marginTop: 1 }}>
            {ls.msg || meta.label}
          </div>
        )}
        {st.on && cfg.note && (
          <div style={{ fontSize: 10.5, color: MUTED, lineHeight: 1.4, marginTop: 2 }}>{cfg.note}</div>
        )}
        {cfg.source && (
          <div style={{ fontSize: 9.5, color: MUTED, lineHeight: 1.3, marginTop: 1 }}>Source: {cfg.source}</div>
        )}
        {/* NEW-2: why it sank to the bottom / is dimmed. */}
        {dim && (
          <div style={{ fontSize: 10, color: MUTED, fontStyle: "italic", marginTop: 1 }}>
            {cfg.needsSetup && !tok ? "Needs setup — not configured." : "No data in this area."}
          </div>
        )}
      </div>
    );
  };

  // Render a group's rows with the relevance treatment applied (NEW-2). Ordering /
  // visibility ONLY — the map is never touched.
  const groupRows = (entries, groupKey) => {
    if (mode === "all") return entries.map(([k, cfg]) => row(k, cfg));
    const hi = [], lo = [];
    for (const e of entries) (lowRel(e[0], e[1]) ? lo : hi).push(e);
    return (
      <>
        {hi.map(([k, cfg]) => row(k, cfg))}
        {lo.length > 0 && (mode === "dim"
          ? lo.map(([k, cfg]) => row(k, cfg, { dim: true }))
          : (
            <>
              <button onClick={() => setRevealHidden((s) => ({ ...s, [groupKey]: !s[groupKey] }))}
                style={{ background: "transparent", border: "none", color: MUTED, fontSize: 10.5, cursor: "pointer", padding: "2px 0", textAlign: "left", width: "100%" }}>
                {revealHidden[groupKey] ? "▾ Hide" : "▸ Show"} {lo.length} layer{lo.length > 1 ? "s" : ""} with no local data here
              </button>
              {revealHidden[groupKey] && lo.map(([k, cfg]) => row(k, cfg, { dim: true }))}
            </>
          ))}
      </>
    );
  };

  const segBtn = (active) => ({
    flex: 1, padding: "3px 6px", fontSize: 10.5, fontWeight: active ? 700 : 500, cursor: "pointer",
    background: active ? "#3b3a36" : "transparent", color: active ? "#fbfaf6" : INK, border: "none",
  });

  return (
    <div>
      {/* Relevance control (NEW-2): list ordering/visibility only; never the map. */}
      <div style={{ margin: "0 0 8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
          <span style={{ ...groupHdr, margin: 0, flex: "none" }}>Relevance</span>
          <div role="group" aria-label="Relevance" title="How to show layers whose data doesn't reach this view. Affects this list only — never the map."
            style={{ display: "flex", flex: 1, border: `1px solid ${LINE}`, borderRadius: 6, overflow: "hidden" }}>
            {["all", "dim", "hide"].map((m) => (
              <button key={m} onClick={() => setRelevanceMode(m)} aria-pressed={mode === m}
                style={{ ...segBtn(mode === m), borderLeft: m !== "all" ? `1px solid ${LINE}` : "none" }}>
                {RELEVANCE_LABEL[m]}
              </button>
            ))}
          </div>
        </div>
        {mode !== "all" && (
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, color: MUTED }}
            title="Layers with data within this distance of the view still count as relevant — so data just off-screen or just past a boundary stays listed.">
            <span style={{ flex: "none" }}>Nearby range</span>
            <input type="range" min={0.5} max={10} step={0.5} value={radius}
              aria-label="Nearby range (miles)" onChange={(e) => setNearbyRadiusMiles(+e.target.value)}
              style={{ flex: 1 }} />
            <span style={{ flex: "none", color: INK, fontWeight: 600, whiteSpace: "nowrap" }}>{radius} mi</span>
          </label>
        )}
      </div>

      {groupHead("statewide", "Map layers", onCount(STATEWIDE))}
      {!collapsed.statewide && groupRows(Object.entries(STATEWIDE), "statewide")}

      {groupHead("jurbounds", "Jurisdictions", onCount(JURISDICTIONS))}
      {!collapsed.jurbounds && <>
        <div style={{ fontSize: 10, color: MUTED, lineHeight: 1.4, margin: "0 0 4px" }}>
          District lines for screening — a boundary means a district <b>has jurisdiction</b> (can tax/regulate), not that it serves/connects utilities here.
        </div>
        {groupRows(Object.entries(JURISDICTIONS), "jurbounds")}
      </>}

      {groupHead("evidence", "Utility evidence", onCount(EVIDENCE))}
      {!collapsed.evidence && groupRows(Object.entries(EVIDENCE), "evidence")}
      {!collapsed.evidence && overlays.mapillary?.on && (
        <div style={{ marginBottom: 5 }}>
          {!tok && (
            <div style={{ fontSize: 10.5, color: "#b45309", fontWeight: 600, lineHeight: 1.4, marginBottom: 3 }}>
              Not configured — add a free access token to enable this layer:
            </div>
          )}
          <input type="password" value={tok} placeholder="Access token (MLY|…)" autoComplete="off"
            onChange={(e) => { setTok(e.target.value); setMapillaryToken(e.target.value.trim()); }}
            style={{ width: "100%", boxSizing: "border-box", padding: "5px 7px", fontSize: 11, fontFamily: "ui-monospace, monospace", border: `1px solid ${tok ? LINE : "#b45309"}`, borderRadius: 6, color: INK }} />
          <div style={{ fontSize: 10, color: MUTED, lineHeight: 1.4, marginTop: 2 }}>
            {tok ? "Stored on this device only." : "Free at mapillary.com/dashboard/developers — or set VITE_MAPILLARY_TOKEN at build. Source: Mapillary."}
          </div>
        </div>
      )}

      {groupHead("jurisdiction", jur ? jur.label : "This jurisdiction", jur ? onCount(jur.layers || {}) : 0)}
      {!collapsed.jurisdiction && (jur && Object.keys(jur.layers || {}).length > 0
        ? groupRows(Object.entries(jur.layers), "jurisdiction")
        : <div style={{ fontSize: 10.5, color: MUTED, lineHeight: 1.4 }}>{(jur && jur.note) || "No local GIS layers wired for this jurisdiction yet."}</div>)}
    </div>
  );
}
