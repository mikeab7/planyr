/* Shared layer-toggle UI — rendered on BOTH the map finder and the site planner
 * so the controls never diverge. Given the per-layer `overlays` state + setter, the
 * shared `layerStatus`, and the per-layer `coverage` map, it lists the layer groups
 * — each row with a checkbox, opacity slider, a live status indicator
 * (loading/loaded/empty/failed/needs-setup) and a note.
 *
 * Group order (B696) is most-site-specific first: Basemap (the planner's aerial
 * source control, B693, + terrain) → the current county's local layers → statewide
 * Jurisdictions → Utility evidence → Environmental & hazards. Each group carries ONE
 * screening disclaimer line; row notes keep only row-specific facts (source, zoom
 * gate) so the boilerplate isn't repeated five times.
 *
 * Coverage-aware picker (NEW-2/B284): a "Relevance" control (Show all / Dim / Hide) +
 * an adjustable "nearby range" decide how OUT-OF-COVERAGE layers (ones whose data
 * doesn't reach the current view — e.g. City-of-Houston sewer when you're in Dallas)
 * are presented. This affects ONLY this list's ordering/visibility — never the map: a
 * layer you turn on always renders everything its source returns for the view. It's a
 * meta-filter, so it sits BELOW the groups (B696), not above them.
 */
import { useEffect, useState } from "react";
import RowInfo from "./RowInfo.jsx";
import { rowInfoSections, combineLayerStatus } from "../lib/layerPanelInfo.js";
import { STATEWIDE, JURISDICTIONS, EVIDENCE, TERRAIN, jurisdictionFor, layerVintage } from "../lib/layers.js";
import { DEFAULT_CORRIDOR_WIDTH_FT, MIN_CORRIDOR_WIDTH_FT, MAX_CORRIDOR_WIDTH_FT } from "../lib/pipelineCorridor.js";
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
    // B760: ALL persistent explanatory text (source, vintage/age, sublabel, note, and any
    // has-jurisdiction caveat) moves behind the per-row ⓘ so the row itself stays ONE line.
    const infoSections = rowInfoSections(cfg, { vintage, age, ls });
    return (
      <div key={k} style={{ marginBottom: 5, opacity: dim ? 0.55 : 1 }}>
        {/* Row: checkbox + label + ⓘ + status dot — one line (B760). The ⓘ is a real
            <button> OUTSIDE the <label> so clicking it never toggles the checkbox. */}
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer", flex: 1, minWidth: 0 }}>
            <input type="checkbox" checked={st.on} onChange={(e) => set(k, { on: e.target.checked })} />
            <span style={{ flex: 1, fontSize: compact ? 12 : 12.5, color: INK }}>{cfg.label}</span>
          </label>
          <RowInfo label={cfg.label} sections={infoSections} />
          {meta && (
            <span title={meta.label} style={{ width: 8, height: 8, borderRadius: 99, flex: "none", background: meta.color,
              animation: ls.state === "loading" ? "pf-pulse 1.1s ease-in-out infinite" : "none" }} />
          )}
        </div>
        {st.on && (
          <input type="range" min={0.1} max={1} step={0.05} value={st.opacity}
            title="Layer opacity" aria-label={`${cfg.label} opacity`}
            onChange={(e) => set(k, { opacity: +e.target.value })}
            style={{ width: "100%", marginTop: 2 }} />
        )}
        {/* B752: inline width control for the assumed easement corridor — no dialog (inline-editor
            rule); commits on change, clamped to the editable bounds. */}
        {st.on && cfg.corridorWidth && (
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, color: INK, margin: "3px 0 0 22px" }}>
            Corridor width (total):
            <input type="number" min={MIN_CORRIDOR_WIDTH_FT} max={MAX_CORRIDOR_WIDTH_FT} step={5}
              value={st.widthFt ?? DEFAULT_CORRIDOR_WIDTH_FT}
              aria-label="Assumed corridor total width in feet"
              onChange={(e) => {
                const v = Math.max(MIN_CORRIDOR_WIDTH_FT, Math.min(MAX_CORRIDOR_WIDTH_FT, Math.round(+e.target.value || DEFAULT_CORRIDOR_WIDTH_FT)));
                set(k, { widthFt: v });
              }}
              style={{ width: 56, fontSize: 11, padding: "1px 4px" }} />
            ft
          </label>
        )}
        {/* SIGNAL kept inline (A1): honest out-of-coverage caption for an ON layer (e.g. COH
            sewer in Dallas) — the map still renders everything the source returns for the view. */}
        {outHere && (
          <div style={{ fontSize: 10, color: "var(--warn-text)", lineHeight: 1.4, marginTop: 1 }}>
            No data in this area — this layer only covers its home region. The map still shows whatever the source returns here.
          </div>
        )}
        {/* SIGNAL kept inline: status reason (failed / empty / needs-setup) */}
        {meta && (ls.state === "failed" || ls.state === "empty" || ls.state === "unconfigured") && (
          <div style={{ fontSize: 10, color: meta.color, lineHeight: 1.35, marginTop: 1 }}>
            {ls.msg || meta.label}
          </div>
        )}
        {/* SIGNAL kept inline (NEW-2/B571): categorical legend for a per-feature-colored overlay
            (road authority) — names the on-map colors while the layer is on. */}
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
        {/* SIGNAL kept inline (NEW-2): why it sank to the bottom / is dimmed. */}
        {dim && (
          <div style={{ fontSize: 10, color: MUTED, fontStyle: "italic", marginTop: 1 }}>
            {cfg.needsSetup && !tok ? "Needs setup — not configured." : "No data in this area."}
          </div>
        )}
      </div>
    );
  };

  // B761: the merged "City limits & ETJ" row is driven from the PRIMARY entry (jur_city);
  // its `mergeWith` secondary (jur_etj) folds into that one row and is never listed alone.
  const mergeSecondaries = new Set(Object.values(JURISDICTIONS).map((c) => c.mergeWith).filter(Boolean));

  // ⓘ content for the merged row: both sources' notes + vintages + the has-jurisdiction caveat.
  const mergedInfoSections = (pk, pcfg, sk, scfg, anyOn) => {
    const line = (id, cfg, lead) => {
      const v = layerVintage(id, cfg);
      const ls = anyOn ? layerStatus[id] : null;
      const age = ls && ls.ts ? formatAge(Date.now() - ls.ts) : "";
      const refreshed = age && ls && (ls.state === "loaded" || ls.state === "empty") ? ` · refreshed ${age}` : "";
      return [{ text: `${lead} — ${cfg.note}` }, { text: `As of: ${v || "vintage unknown"}${refreshed}` }];
    };
    const out = [...line(pk, pcfg, "City limits"), ...line(sk, scfg, "ETJ")];
    if (pcfg.infoCaveat) out.push({ text: pcfg.infoCaveat, tone: "warn" });
    return out;
  };

  // The composite City-limits-&-ETJ row (B761): ONE checkbox + opacity slider + ⓘ driving
  // BOTH underlying layers. checked = either on; toggle/opacity write both; the status dot is
  // the combined status; a small solid/dashed key names the two on-map line styles while on.
  const compositeRow = (pk, pcfg, { dim = false } = {}) => {
    const sk = pcfg.mergeWith, scfg = JURISDICTIONS[sk];
    const pst = overlays[pk], sst = overlays[sk];
    if (!pst || !sst || !scfg) return null;
    const anyOn = !!(pst.on || sst.on);
    const opacity = Math.max(pst.opacity ?? 0.85, sst.opacity ?? 0.85);
    const combined = anyOn ? combineLayerStatus(layerStatus[pk], layerStatus[sk]) : null;
    const meta = combined && STATUS[combined.state];
    const label = pcfg.mergeLabel || pcfg.label;
    const setBoth = (patch) => { set(pk, patch); set(sk, patch); };
    return (
      <div key={pk} style={{ marginBottom: 5, opacity: dim ? 0.55 : 1 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer", flex: 1, minWidth: 0 }}>
            <input type="checkbox" checked={anyOn} onChange={(e) => setBoth({ on: e.target.checked })} />
            <span style={{ flex: 1, fontSize: compact ? 12 : 12.5, color: INK }}>{label}</span>
          </label>
          <RowInfo label={label} sections={mergedInfoSections(pk, pcfg, sk, scfg, anyOn)} />
          {meta && (
            <span title={meta.label} style={{ width: 8, height: 8, borderRadius: 99, flex: "none", background: meta.color,
              animation: combined.state === "loading" ? "pf-pulse 1.1s ease-in-out infinite" : "none" }} />
          )}
        </div>
        {anyOn && (
          <input type="range" min={0.1} max={1} step={0.05} value={opacity}
            title="Layer opacity" aria-label={`${label} opacity`}
            onChange={(e) => setBoth({ opacity: +e.target.value })}
            style={{ width: "100%", marginTop: 2 }} />
        )}
        {/* SIGNAL: solid = city limits, dashed = ETJ — names the two on-map line styles */}
        {anyOn && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 12px", margin: "4px 0 1px 22px" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, color: INK }}>
              <span style={{ width: 16, height: 0, flex: "none", borderTop: `2.5px solid ${pcfg.color}` }} /> City limits
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, color: INK }}>
              <span style={{ width: 16, height: 0, flex: "none", borderTop: `2.5px dashed ${pcfg.color}` }} /> ETJ
            </span>
          </div>
        )}
        {meta && (combined.state === "failed" || combined.state === "empty") && (
          <div style={{ fontSize: 10, color: meta.color, lineHeight: 1.35, marginTop: 1 }}>{combined.msg || meta.label}</div>
        )}
      </div>
    );
  };

  const renderEntry = ([k, cfg], opts) => (cfg.mergeWith ? compositeRow(k, cfg, opts) : row(k, cfg, opts));

  // Render a group's rows with the relevance treatment applied (NEW-2). Ordering /
  // visibility ONLY — the map is never touched. Merge secondaries (jur_etj) are dropped —
  // they render folded into their primary's composite row (B761).
  const groupRows = (entries, groupKey) => {
    const ents = entries.filter(([k]) => !mergeSecondaries.has(k));
    if (mode === "all") return ents.map((e) => renderEntry(e));
    const hi = [], lo = [];
    for (const e of ents) (lowRel(e[0], e[1]) ? lo : hi).push(e);
    return (
      <>
        {hi.map((e) => renderEntry(e))}
        {lo.length > 0 && (mode === "dim"
          ? lo.map((e) => renderEntry(e, { dim: true }))
          : (
            <>
              <button onClick={() => setRevealHidden((s) => ({ ...s, [groupKey]: !s[groupKey] }))}
                aria-expanded={!!revealHidden[groupKey]} aria-label={`${revealHidden[groupKey] ? "Hide" : "Show"} ${lo.length} layer${lo.length > 1 ? "s" : ""} with no local data in the ${groupKey} group`} /* B557 */
                style={{ background: "transparent", border: "none", color: MUTED, fontSize: 10.5, cursor: "pointer", padding: "2px 0", textAlign: "left", width: "100%" }}>
                {revealHidden[groupKey] ? "▾ Hide" : "▸ Show"} {lo.length} layer{lo.length > 1 ? "s" : ""} with no local data here
              </button>
              {revealHidden[groupKey] && lo.map((e) => renderEntry(e, { dim: true }))}
            </>
          ))}
      </>
    );
  };

  // B761: count the merged City/ETJ pair as ONE toward the Jurisdictions "N on" chip.
  const jurOnCount = () => {
    let n = 0;
    for (const [k, cfg] of Object.entries(JURISDICTIONS)) {
      if (mergeSecondaries.has(k)) continue; // counted via its primary
      if (cfg.mergeWith) { if (overlays[k]?.on || overlays[cfg.mergeWith]?.on) n++; }
      else if (overlays[k]?.on) n++;
    }
    return n;
  };

  // B762: a single-layer county folds its ONE local layer into the Basemap group (right
  // after the USGS contour row) instead of getting its own dropdown; the "This jurisdiction"
  // group renders only when a county contributes ≥2 layers. Generic (count-based).
  const foldEntry = jur && Object.keys(jur.layers || {}).length === 1 ? Object.entries(jur.layers)[0] : null;
  const basemapEntries = () => {
    const terrain = Object.entries(TERRAIN);
    if (!foldEntry) return terrain;
    const out = [];
    let placed = false;
    for (const e of terrain) { out.push(e); if (e[0] === "contours") { out.push(foldEntry); placed = true; } }
    if (!placed) out.push(foldEntry);
    return out;
  };

  const segBtn = (active) => ({
    flex: 1, padding: "3px 6px", fontSize: 10.5, fontWeight: active ? 700 : 500, cursor: "pointer",
    background: active ? "var(--accent)" : "transparent", color: active ? "var(--on-accent)" : INK, border: "none",  // B508: theme tokens, not hardcoded warm-dark hex (was dark-on-dark in dark mode)
  });

  // The planner's aerial-source control (B693): segmented Off / Aerial / USGS over the
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

  // An unlocated plan (B693): the map-dependent layer list can't do anything yet, so
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
      {/* ——— Basemap (B693) + terrain (B696) + any single-layer county fold (B762) ——— */}
      {groupHead("basemap", "Basemap", onCount(TERRAIN) + (foldEntry && overlays[foldEntry[0]]?.on ? 1 : 0) + (basemap && basemap.value !== "off" && !basemap.disabledReason ? 1 : 0))}
      {!collapsed.basemap && <>
        {basemapControl}
        {groupRows(basemapEntries(), "basemap")}
      </>}

      {/* ——— The current county's local layers — rendered ONLY when the county contributes ≥2
             layers (B762); a lone layer (Fort Bend contours) folds into Basemap above, and a
             county with no public GIS renders nothing (absence is the honest signal). ——— */}
      {jur && Object.keys(jur.layers || {}).length >= 2 && <>
        {groupHead("jurisdiction", jur.label, onCount(jur.layers || {}))}
        {!collapsed.jurisdiction && groupRows(Object.entries(jur.layers), "jurisdiction")}
      </>}

      {groupHead("jurbounds", "Jurisdictions", jurOnCount())}
      {!collapsed.jurbounds && groupRows(Object.entries(JURISDICTIONS), "jurbounds")}

      {groupHead("evidence", "Utility evidence", onCount(EVIDENCE))}
      {!collapsed.evidence && groupRows(Object.entries(EVIDENCE), "evidence")}
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

      {/* Renamed from "Map layers" (B696) — these are the environmental/hazard screens. */}
      {groupHead("statewide", "Environmental & hazards", onCount(STATEWIDE))}
      {!collapsed.statewide && groupRows(Object.entries(STATEWIDE), "statewide")}

      {/* Relevance control (NEW-2): a meta-filter over the LIST above (ordering/visibility
          only; never the map) — so it sits below the layers, not as the panel's lead (B696). */}
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

      {/* B760: the ONE quiet screening footer for the whole panel — replaces the four
          per-group disclaimer paragraphs (each layer's own caveats now live in its ⓘ). */}
      <div style={{ fontSize: 10, color: MUTED, lineHeight: 1.4, marginTop: 8 }}>
        Screening data — verify before relying on it.
      </div>
    </div>
  );
}
