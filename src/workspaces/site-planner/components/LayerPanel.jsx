/* Shared layer-toggle UI — rendered on BOTH the map finder and the site planner
 * so the controls never diverge. Given the per-layer `overlays` state + setter, the
 * shared `layerStatus`, and the per-layer `coverage` map, it lists the layer groups
 * — each row with a checkbox, opacity slider, a live status indicator
 * (loading/loaded/empty/failed/needs-setup) and a note.
 *
 * Group order (B692) is most-site-specific first: Basemap (the planner's aerial
 * source control, B689, + terrain) → the current county's local layers → statewide
 * Jurisdictions → Utility evidence → Environmental & hazards. Each group carries ONE
 * screening disclaimer line; row notes keep only row-specific facts (source, zoom
 * gate) so the boilerplate isn't repeated five times.
 *
 * Coverage-aware picker (NEW-2/B284): a "Relevance" control (Show all / Dim / Hide) +
 * an adjustable "nearby range" decide how OUT-OF-COVERAGE layers (ones whose data
 * doesn't reach the current view — e.g. City-of-Houston sewer when you're in Dallas)
 * are presented. This affects ONLY this list's ordering/visibility — never the map: a
 * layer you turn on always renders everything its source returns for the view. It's a
 * meta-filter, so it sits BELOW the groups (B692), not above them.
 */
import { useEffect, useState } from "react";
import { STATEWIDE, JURISDICTIONS, EVIDENCE, TERRAIN, jurisdictionFor, layerVintage } from "../lib/layers.js";
import { PLANNER_BASEMAP_CHOICES } from "../lib/basemaps.js";
import { mapillaryToken, setMapillaryToken, subscribeMapillaryToken } from "../lib/evidenceLayers.js";
import { formatAge } from "../lib/gisCache.js";
import {
  getRelevanceMode, setRelevanceMode, getNearbyRadiusMiles, setNearbyRadiusMiles, subscribeRelevance,
} from "../lib/coverage.js";

// This panel rides on the themed var(--surface-overlay) container, so its text must
// be theme tokens — the old warm cream-era hexes were dark-on-dark in dark mode (B341).
const MUTED = "var(--text-secondary)", LINE = "var(--border-default)", INK = "var(--text-primary)";
const groupHdr = { fontSize: 10, color: MUTED, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", margin: "6px 0 4px" };
const groupNote = { fontSize: 10, color: MUTED, lineHeight: 1.4, margin: "0 0 4px" };
const STATUS = {
  loading: { color: "var(--warn-text)", label: "loading…" },
  loaded: { color: "var(--status-active)", label: "loaded" },
  empty: { color: "var(--text-tertiary)", label: "no data" },
  failed: { color: "var(--danger)", label: "failed" },
  unconfigured: { color: "var(--text-tertiary)", label: "needs setup" }, // NEW-4: not a failure, just not set up
};
const RELEVANCE_LABEL = { all: "Show all", dim: "Dim", hide: "Hide" };

export default function LayerPanel({ overlays, setOverlays, county, layerStatus = {}, coverage = {}, compact = false, basemap = null, gisNote = null }) {
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
      aria-expanded={!collapsed[g]} aria-label={`${collapsed[g] ? "Show" : "Hide"} ${label} layers`} /* B557 */
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
        {/* B236 vintage + B75 refreshed-age, folded into ONE line (the B96 note):
            "as of" = the DATA's own currency; "refreshed" = when WE last pulled the
            cached copy. Both honest, both here, never conflated. */}
        {st.on && (
          <div title={`Source vintage — ${cfg.label}'s own effective / publication date (when the underlying data is current as of). "refreshed" is when we last pulled our cached copy — screening only; verify against the source.`}
            style={{ fontSize: 9.5, color: MUTED, lineHeight: 1.35, marginTop: 1, fontStyle: vintage ? "normal" : "italic" }}>
            as of: {vintage || "vintage unknown"}
            {age && (ls.state === "loaded" || ls.state === "empty") && (
              <span style={{ color: ls.stale ? "var(--warn-text)" : MUTED, fontStyle: "normal" }}>
                {" "}· refreshed {age}{ls.stale ? " (updating…)" : ""}
              </span>
            )}
          </div>
        )}
        {/* NEW-1: honest out-of-coverage caption for an ON layer (e.g. COH sewer in
            Dallas) — the map still renders everything the source returns for the view. */}
        {outHere && (
          <div style={{ fontSize: 10, color: "var(--warn-text)", lineHeight: 1.4, marginTop: 1 }}>
            No data in this area — this layer only covers its home region. The map still shows whatever the source returns here.
          </div>
        )}
        {/* status reason (failed / empty / needs-setup) */}
        {meta && (ls.state === "failed" || ls.state === "empty" || ls.state === "unconfigured") && (
          <div style={{ fontSize: 10, color: meta.color, lineHeight: 1.35, marginTop: 1 }}>
            {ls.msg || meta.label}
          </div>
        )}
        {/* NEW-2/B571: categorical legend for a per-feature-colored overlay (road
            authority) — shown only while the layer is on, so the colors on the map are
            named. Unknown is drawn dashed (a neutral, never a faded line). */}
        {st.on && cfg.legend && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 10px", margin: "4px 0 1px 22px" }}>
            {cfg.legend.map((lg) => (
              <span key={lg.label} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, color: INK }}>
                <span style={{ width: 16, height: 0, flex: "none", borderTop: `3px ${lg.dash ? "dashed" : "solid"} ${lg.color}` }} />
                {lg.label}
              </span>
            ))}
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
                aria-expanded={!!revealHidden[groupKey]} aria-label={`${revealHidden[groupKey] ? "Hide" : "Show"} ${lo.length} layer${lo.length > 1 ? "s" : ""} with no local data in the ${groupKey} group`} /* B557 */
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
    background: active ? "var(--accent)" : "transparent", color: active ? "var(--on-accent)" : INK, border: "none",  // B508: theme tokens, not hardcoded warm-dark hex (was dark-on-dark in dark mode)
  });

  // The planner's aerial-source control (B689): segmented Off / Aerial / USGS over the
  // shared BASEMAPS registry (same sources as the map finder's Imagery dropdown, so the
  // two surfaces always offer the same choices). Disabled — with the plain reason — when
  // the plan has no map placement (no origin: there is nothing to anchor imagery to);
  // it re-enables the moment a placement lands. Rendered only when the host passes the
  // `basemap` prop (the finder keeps its own Imagery dropdown).
  const bmStatus = basemap && basemap.status ? STATUS[basemap.status] : null;
  const basemapControl = basemap && (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div role="group" aria-label="Aerial basemap source" title={basemap.disabledReason || "Which aerial imagery draws under the plan."}
          style={{ display: "flex", flex: 1, border: `1px solid ${LINE}`, borderRadius: 6, overflow: "hidden", opacity: basemap.disabledReason ? 0.5 : 1 }}>
          {PLANNER_BASEMAP_CHOICES.map((c, i) => (
            <button key={c.key} title={c.title} aria-pressed={basemap.value === c.key}
              disabled={!!basemap.disabledReason} aria-disabled={!!basemap.disabledReason}
              onClick={() => !basemap.disabledReason && basemap.onChange(c.key)}
              style={{ ...segBtn(basemap.value === c.key), cursor: basemap.disabledReason ? "not-allowed" : "pointer", borderLeft: i !== 0 ? `1px solid ${LINE}` : "none" }}>
              {c.label}
            </button>
          ))}
        </div>
        {bmStatus && !basemap.disabledReason && basemap.value !== "off" && (
          <span title={bmStatus.label} style={{ width: 8, height: 8, borderRadius: 99, flex: "none", background: bmStatus.color,
            animation: basemap.status === "loading" ? "pf-pulse 1.1s ease-in-out infinite" : "none" }} />
        )}
      </div>
      {basemap.disabledReason && (
        <div style={{ fontSize: 10, color: MUTED, lineHeight: 1.4, marginTop: 3 }}>{basemap.disabledReason}</div>
      )}
    </div>
  );

  // An unlocated plan (B689): the map-dependent layer list can't do anything yet, so
  // show ONLY the (disabled) Basemap control + the plain reason — never silent no-op
  // toggles that flip state with nothing on screen to show for it.
  if (gisNote) {
    return (
      <div>
        {groupHead("basemap", "Basemap", 0)}
        {!collapsed.basemap && basemapControl}
        <div style={{ fontSize: 10.5, color: MUTED, lineHeight: 1.45, marginTop: 4 }}>{gisNote}</div>
      </div>
    );
  }

  return (
    <div>
      {/* ——— Basemap (B689) + terrain (B692: terrain isn't utility evidence) ——— */}
      {groupHead("basemap", "Basemap", onCount(TERRAIN) + (basemap && basemap.value !== "off" && !basemap.disabledReason ? 1 : 0))}
      {!collapsed.basemap && <>
        {basemapControl}
        {groupRows(Object.entries(TERRAIN), "basemap")}
      </>}

      {/* ——— The current county's local layers — most site-specific, so first after the base ——— */}
      {groupHead("jurisdiction", jur ? jur.label : "This jurisdiction", jur ? onCount(jur.layers || {}) : 0)}
      {!collapsed.jurisdiction && <>
        <div style={groupNote}>Local agency layers for this county — screening only; verify with the agency.</div>
        {jur && Object.keys(jur.layers || {}).length > 0
          ? groupRows(Object.entries(jur.layers), "jurisdiction")
          : <div style={{ fontSize: 10.5, color: MUTED, lineHeight: 1.4 }}>{(jur && jur.note) || "No local GIS layers wired for this jurisdiction yet."}</div>}
      </>}

      {groupHead("jurbounds", "Jurisdictions", onCount(JURISDICTIONS))}
      {!collapsed.jurbounds && <>
        <div style={groupNote}>
          District lines for screening — a boundary means a district <b>has jurisdiction</b> (can tax/regulate), not that it serves/connects utilities here.
        </div>
        {groupRows(Object.entries(JURISDICTIONS), "jurbounds")}
      </>}

      {groupHead("evidence", "Utility evidence", onCount(EVIDENCE))}
      {!collapsed.evidence && <>
        <div style={groupNote}>Field evidence for screening — hints at what's nearby, never proof of service. Verify with the utility.</div>
        {groupRows(Object.entries(EVIDENCE), "evidence")}
      </>}
      {/* B308: the layer works for everyone via the same-origin proxy (no token needed).
          The box is now an OPTIONAL power-user override — paste your own token to query
          Mapillary directly from this device instead of going through Planyr. */}
      {!collapsed.evidence && overlays.mapillary?.on && (
        <div style={{ marginBottom: 5 }}>
          <div style={{ fontSize: 10, color: MUTED, lineHeight: 1.4, marginBottom: 3 }}>
            Works automatically — no token needed. <i>(Advanced)</i> use your own Mapillary token instead:
          </div>
          <input type="password" value={tok} placeholder="Your own token (optional, MLY|…)" autoComplete="off"
            onChange={(e) => { setTok(e.target.value); setMapillaryToken(e.target.value.trim()); }}
            style={{ width: "100%", boxSizing: "border-box", padding: "5px 7px", fontSize: 11, fontFamily: "ui-monospace, monospace", border: `1px solid ${LINE}`, borderRadius: 6, color: INK }} />
          <div style={{ fontSize: 10, color: MUTED, lineHeight: 1.4, marginTop: 2 }}>
            {tok ? "Using your token on this device only." : "Leave blank to use Planyr's built-in access. Source: Mapillary."}
          </div>
        </div>
      )}

      {/* Renamed from "Map layers" (B692) — these are the environmental/hazard screens. */}
      {groupHead("statewide", "Environmental & hazards", onCount(STATEWIDE))}
      {!collapsed.statewide && <>
        <div style={groupNote}>Screening only — verify with the issuing agency (FEMA / USFWS / RRC) before relying on it.</div>
        {groupRows(Object.entries(STATEWIDE), "statewide")}
      </>}

      {/* Relevance control (NEW-2): a meta-filter over the LIST above (ordering/visibility
          only; never the map) — so it sits below the layers, not as the panel's lead (B692). */}
      <div style={{ margin: "8px 0 0", borderTop: `1px solid ${LINE}`, paddingTop: 6 }}>
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
    </div>
  );
}
