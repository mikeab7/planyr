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
import {
  rowInfoSections, combineLayerStatus,
  buildGroupSlots, mergeSlotAnyOn, mergeSlotOpacity, mergeGroupInfoSections,
} from "../lib/layerPanelInfo.js";
import {
  ALL_LAYERS, JURISDICTIONS, TERRAIN, MERGE_GROUPS, LAYER_GROUP_LABEL,
  jurisdictionFor, layerVintage,
} from "../lib/layers.js";
import { DEFAULT_CORRIDOR_WIDTH_FT, MIN_CORRIDOR_WIDTH_FT, MAX_CORRIDOR_WIDTH_FT } from "../lib/pipelineCorridor.js";
// NEW-1 — which layers the "Show above plan" lift can actually move (only an AREA role; a line
// or point layer is over the plan already). The model, never a local guess.
import { configCanLift } from "../lib/mapStack.js";
// NEW-4 — which layers the one-click sweep clears (everything but the drawing surface).
import { sweepableLayerIds } from "../lib/layerWeight.js";
import { PLANNER_BASEMAP_CHOICES } from "../lib/basemaps.js";
import { mapillaryToken, setMapillaryToken, subscribeMapillaryToken } from "../lib/evidenceLayers.js";
import { formatAge } from "../lib/gisCache.js";
import {
  getRelevanceMode, setRelevanceMode, getNearbyRadiusMiles, setNearbyRadiusMiles, subscribeRelevance,
} from "../lib/coverage.js";
import {
  governingDistrict, scopeFloodEntries, floodMasterState,
  floodFactsNote, emptyReason, FEMA_ZONES_NOT_CHANNELS,
} from "../lib/floodGroup.js";
// NEW-3 — the baked-tile vintage stamp. Decision + wording are pure (floodTiles.js); the fetch
// is one cached call per session (floodManifest.js). Both are tiny — no chunk cost worth naming.
import { floodTilesEnabled, resolveFloodSource, floodVintageStamp } from "../../../shared/gis/floodTiles.js";
import { loadFloodManifest } from "../lib/floodManifest.js";

// This panel rides on the themed var(--surface-overlay) container, so its text must
// be theme tokens — the old warm cream-era hexes were dark-on-dark in dark mode (B341).
const MUTED = "var(--text-secondary)", LINE = "var(--border-default)", INK = "var(--text-primary)";
const groupHdr = { fontSize: 10, color: MUTED, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", margin: "6px 0 4px" };
const STATUS = {
  loading: { color: "var(--warn-text)", label: "loading…" },
  loaded: { color: "var(--status-active)", label: "loaded" },
  empty: { color: "var(--text-tertiary)", label: "no data" },
  // NEW-3/B790: an honest "the picture never arrived" state — amber (warn-text), NOT red. RED is
  // reserved for a genuine error (--danger); a stalled/degraded source is "too slow, data may be
  // missing," which is retryable and clears on its own once the source recovers.
  slow: { color: "var(--warn-text)", label: "source slow" },
  failed: { color: "var(--danger)", label: "failed" },
  unconfigured: { color: "var(--text-tertiary)", label: "needs setup" }, // NEW-4: not a failure, just not set up
};
const RELEVANCE_LABEL = { all: "Show all", dim: "Dim", hide: "Hide" };

export default function LayerPanel({
  overlays, setOverlays, county, layerStatus = {}, coverage = {}, compact = false, basemap = null, gisNote = null,
  // B1091(×2) — the county this SITE is actually in (the saved site record's own county), kept
  // separate from `county` above, which is the layer-registry key / lookup selector. Only
  // used as the fallback when no identify has resolved. Absent (map finder) → null.
  siteCounty = null,
  // B1076/B1077 — the drainage facts the Flood & drainage group needs to be HONEST:
  // `floodContext` is a resolveDrainageContext result (or its restored slim) — its
  // `drainageDistrict` picks which district's rows are listed, and its `flood.zones` let
  // the group say what FEMA actually reported instead of going silent. Absent (map finder,
  // or before any check) → nothing is suppressed and no verdict line is claimed.
  floodContext = null,
  /* (NEW-1) WHICH copy of this panel this is. Both hosts mount one, and the inactive host
   * stays mounted (display:none) so its map isn't rebuilt — so the DOM always holds TWO
   * Flood & drainage groups, and the hidden one has no `floodContext`. A page-level text
   * check that doesn't distinguish them reads the silent copy and concludes the live panel
   * went quiet. Stamped on the root as `data-surface` so any check can target the real one. */
  surface = "planner",
  /* NEW-2 — WHICH STATE this site is in ("TX" | "CO" | null).
   *
   * Without it a Colorado user saw "Traffic counts (AADT)" and "Leaking petroleum tanks (LPST)"
   * in the list, toggled them on, and got an empty map — with no way to tell "nothing here"
   * from "we do not have this here". On a due-diligence screen those are completely different
   * facts, and only one of them is a finding. Null (unknown location) hides NOTHING: the gate
   * fires on a POSITIVE mismatch only, so a coordinate-less plan behaves exactly as before.
   */
  siteState = null,
  /* NEW-1 — what to do about an unlocated plan. Passed only by the planner, and only while the
   * plan has no origin: it turns the "GIS layers appear once this plan has a location" note from a
   * dead end into the one-click fix. Null on every other surface. */
  onSetLocation = null,
}) {
  const jur = jurisdictionFor(county);
  /* B1091(×2) — WHICH county the flood group reasons about.
   *
   * `county` is the parcel-lookup / jurisdiction-layer REGISTRY KEY. It is a UI selector
   * that defaults to "harris" for every site and only ever names a county Planyr publishes
   * local layers for — it is not a fact about where this site is. Feeding it to the district
   * scoping is how a Waller-County tract came to be told that Harris County Flood Control
   * District governs its drainage. The site IDENTIFY county (TxDOT boundaries — the same
   * value the header renders as "Waller County") is the fact, so it wins; a straddle or an
   * unresolved identify yields null, and null fails OPEN (nothing is demoted). */
  const identifyCounty = Array.isArray(floodContext?.authority?.jurisdiction?.county)
    ? floodContext.authority.jurisdiction.county
    : [];
  const floodCounty = identifyCounty.length === 1 ? identifyCounty[0] : identifyCounty.length ? null : siteCounty;
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
  const [floodCopy, setFloodCopy] = useState(null);     // the lazily-loaded flood copy tier (below)
  /* B1349 — LOADED WHEN THERE IS SOMETHING FOR IT TO SAY, not at mount.
   * This was a bare `[]` effect, so the chunk was fetched the moment ANY LayerPanel mounted —
   * and the map finder's panel mounts at boot on a desktop width even while the planner is the
   * visible workspace. The runtime half of the perf harness caught it by name: `floodZoneCopy`
   * in flight on an idle page with no gesture, which made B1130's "moved off the boot path"
   * justification untrue as stated.
   * The gate is EXACT, not a heuristic: this module's only consumer here is `femaZoneVerdict`,
   * which returns null for anything without `flood.state` (floodZoneCopy.js), so every case we
   * now skip is a case that rendered nothing anyway. No first-paint gap, no spinner, no honest
   * line lost — see the `femaVerdict` note below. */
  const hasFloodFacts = !!floodContext?.flood?.state;
  useEffect(() => {
    if (!hasFloodFacts) return;
    import("../lib/floodZoneCopy.js").then(setFloodCopy).catch(() => {});
  }, [hasFloodFacts]);
  // Collapsible groups so the panel fits on one page without scrolling (B97). Collapse state
  // persists per device; each header shows how many layers in the group are currently on.
  const [collapsed, setCollapsed] = useState(() => { try { return JSON.parse(localStorage.getItem("planarfit:layerGroups:v1") || "{}") || {}; } catch (_) { return {}; } });
  const toggleGroup = (g) => setCollapsed((c) => { const n = { ...c, [g]: !c[g] }; try { localStorage.setItem("planarfit:layerGroups:v1", JSON.stringify(n)); } catch (_) {} return n; });
  const onCount = (obj) => Object.keys(obj).filter((k) => overlays[k]?.on).length;
  const groupHead = (g, label, count) => (
    <button onClick={() => toggleGroup(g)} title={collapsed[g] ? "Show" : "Hide"}
      aria-expanded={!collapsed[g]} aria-label={`${collapsed[g] ? "Show" : "Hide"} ${label} layers`} /* B557 */
      /* NEW-3 — the header STICKS while its rows scroll. With twenty-eight layers in a short
         scroll box the owner could see about four rows at a time and had no idea which group he
         was looking at once he had scrolled. `--surface-overlay` (not transparent) is what stops
         rows showing through as they pass under it.
         ⛔ The stacking half lives in the global stylesheet (`.pf-sticky-group-hdr`), NOT inline:
         this file may not contain a z-index token at all. That is the B1205 invariant — the layer
         stacking model is fixed and the panel offers no ordering control — and `test/mapStack`
         asserts it on the source text, deliberately bluntly, so it cannot be argued around. */
      className="pf-sticky-group-hdr"
      style={{ ...groupHdr, display: "flex", alignItems: "center", gap: 6, width: "100%", background: "var(--surface-overlay)", border: "none", padding: "5px 0 4px", margin: "5px 0 3px", cursor: "pointer" }}>
      <span style={{ fontSize: 8, lineHeight: 1, transform: collapsed[g] ? "rotate(-90deg)" : "none", display: "inline-block" }}>▼</span>
      <span style={{ flex: 1, textAlign: "left" }}>{label}</span>
      {count > 0 && <span style={{ color: INK, fontWeight: 700 }}>{count} on</span>}
    </button>
  );

  // A layer is "low relevance" here when its data doesn't reach the view (out of
  // coverage) or it isn't configured (Mapillary with no token) — but NEVER if it's
  // currently ON (you should always see what you've enabled). Picker-only signal.
  const lowRel = (k, cfg) => !overlays[k]?.on && (coverage[k] === "out" || (cfg.needsSetup && !tok));

  /* NEW-2 — CAN THIS LAYER ANSWER HERE AT ALL?
   *
   * Distinct from `lowRel` above, and the difference is the whole point. Relevance/coverage says
   * "this source's data doesn't reach the current VIEW" — a soft, geographic, sometimes-wrong
   * signal. This says "this source has no meaning in this STATE": the RRC is Texas, a CCN is a
   * Texas PUC construct, LPST is TCEQ, TxDOT counts stop at the state line. No amount of panning
   * will ever make one of them answer in Colorado, so listing it as an ordinary toggle is a lie
   * of omission. Layers with no `states` are national and always in scope. */
  const outOfState = (cfg) => !!(siteState && Array.isArray(cfg?.states) && !cfg.states.includes(siteState));
  /* NEW-2 — A MERGED SLOT DEMOTES ONLY IF *EVERY* MEMBER IS OUT OF STATE, and this is not a
   * refinement — without it, tagging the Texas members of a merge group takes the whole row down
   * and silently removes a Colorado source that was working. "Water & sewer" bundles the Texas CCN,
   * MUD and City-of-Houston mains together with Colorado's water & sanitation districts; reading
   * the slot's state off `members[0]` (the registry's first member, `ccn_service`) would have
   * demoted the one row a Colorado site actually needs. Same shape as `slotLowRel` below — the
   * slot is only as out-of-scope as its most-in-scope member. */
  const slotOutOfState = (slot) => (slot.kind === "merge"
    ? slot.members.length > 0 && slot.members.every(([, cfg]) => outOfState(cfg))
    : outOfState(slot.entry[1]));
  const STATE_NAME = { TX: "Texas", CO: "Colorado" };
  const hereName = STATE_NAME[siteState] || "this state";
  const outOfStateReason = (cfg) => {
    const only = (cfg.states || []).map((c) => STATE_NAME[c] || c).join(" / ");
    return `${only}-only — no ${hereName} equivalent is wired yet. Not a finding: it is a gap in what Planyr carries here.`;
  };

  /* NEW-2/B1206 — THE ONE OPACITY CONTROL, used by every row shape in this panel (solo, the
   * pairwise City-limits-&-ETJ composite, and the N-ary merge groups). "I want to see through
   * this layer" must have exactly ONE answer, in exactly the same place, on every layer in every
   * group. Named ◐ so it reads as a see-through control rather than an anonymous slider — the
   * discoverability half of the ask — and the live percentage is the feedback that it did
   * something.
   *
   * ⛔ CORRECTED BY NEW-1 (2026-07-30): this is NOT the answer to "I can't see through my plan".
   * A layer that draws UNDER the site elements is not helped by its own opacity at all — the
   * building still covers it, and fading it only dims the parts you could already see. That is
   * what abovePlanControl below is for. Opacity is for a layer that is ON TOP and too loud, and
   * the copy here says exactly that much and no more. */
  const opacityControl = (label, value, onChange) => (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}
      title="See through this layer">
      <span aria-hidden="true" style={{ fontSize: 11, color: MUTED, flex: "none", lineHeight: 1 }}>◐</span>
      <input type="range" min={0.1} max={1} step={0.05} value={value}
        aria-label={`${label} opacity`}
        onChange={(e) => onChange(+e.target.value)}
        style={{ flex: 1, minWidth: 0 }} />
      <span style={{ fontSize: 10, color: MUTED, flex: "none", width: 26, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
        {Math.round(value * 100)}%
      </span>
    </div>
  );

  /* NEW-1 — THE "SHOW ABOVE PLAN" CONTROL, the real escape hatch in the stacking model, and the
   * one place in this panel where a draw order is a user decision.
   *
   * Why it exists: the model (lib/mapStack.js) puts filled layers UNDER the site elements, which
   * is right by default — it is what makes contours cross a building with no interaction at all,
   * and keeps a floodplain wash from burying one. But when the answer is wrong for a particular
   * layer on a particular plan, OPACITY CANNOT FIX IT: a buried fill stays buried at any opacity.
   * Only order fixes order. So this is a two-state, semantically-named lift of ONE layer — never
   * a free-form z-order picker (no front/back, no up/down, no per-layer number), and it stops
   * below the labels and below the handle layer.
   *
   * THE ALREADY-ON STATE, deliberately shown rather than hidden: a line or symbol layer is over
   * the plan already, so the control has nothing to do on that row. Rendering it checked and
   * inert says WHICH SIDE the layer is on; hiding it would leave the row's silence to be
   * interpreted ("already above?" vs "not offered here?"), and reading where a layer sits is the
   * whole point of adding the control. One place, one meaning, on every row — the B1206 rule. */
  const abovePlanControl = (label, liftable, checked, onChange) => (
    <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2, fontSize: 10.5,
      color: liftable ? INK : MUTED, cursor: liftable ? "pointer" : "default" }}
      title={liftable
        ? "Draw this layer over your buildings instead of under them. Opacity can't do this — a layer under the plan stays covered however faint it is."
        : "Already drawn over your plan — line and symbol layers always are, so there is nothing to lift."}>
      <input type="checkbox" checked={checked} disabled={!liftable}
        aria-label={`Show ${label} above plan`}
        onChange={(e) => onChange(e.target.checked)} />
      <span>Show above plan</span>
    </label>
  );
  /* The map finder has no site plan for a layer to be above, so the control is meaningless there
   * — it is a planner-surface affordance. (`overlays` is app-shared: a lift made on the planner
   * simply has no effect on the finder, where both bands resolve to the same pane.) */
  const showAbove = surface === "planner";
  /* ONE call site for all three row shapes, taking the row's layer entries and the row's own
   * patch writer — so a solo row, the City-limits composite and an N-ary merge group cannot
   * drift apart in how they read or write the lift (the opacityControl discipline). */
  const aboveRow = (label, entries, patch) => {
    const lift = entries.some(([, c]) => configCanLift(c));
    return abovePlanControl(label, lift, lift ? entries.some(([id]) => overlays[id]?.above === true) : true,
      (v) => patch({ above: v }));
  };

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
            {/* NEW-3 — `minWidth: 0` is load-bearing, not tidiness. A flex item will not shrink
                below its min-content width by default, so this label refused to narrow, wrapped
                onto a second line, and pushed the agency chip beside it past the panel's
                `overflow: hidden` edge — which is why the owner saw "FEMA flood zones" on two
                lines with its chip clipped to "FEM". Letting the label shrink and ellipsise (with
                the full text on hover) keeps every row exactly one line at any panel width. */}
            <span title={cfg.label} style={{ flex: 1, minWidth: 0, fontSize: compact ? 12 : 12.5, color: INK,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cfg.label}</span>
          </label>
          <RowInfo label={cfg.label} sections={infoSections} />
          {meta && (
            <span title={meta.label} style={{ width: 8, height: 8, borderRadius: 99, flex: "none", background: meta.color,
              animation: ls.state === "loading" ? "pf-pulse 1.1s ease-in-out infinite" : "none" }} />
          )}
        </div>
        {st.on && opacityControl(cfg.label, st.opacity, (v) => set(k, { opacity: v }))}
        {st.on && showAbove && aboveRow(cfg.label, [[k, cfg]], (p) => set(k, p))}
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
        {meta && (ls.state === "failed" || ls.state === "slow" || ls.state === "empty" || ls.state === "unconfigured") && (
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
            <span title={label} style={{ flex: 1, minWidth: 0, fontSize: compact ? 12 : 12.5, color: INK,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
          </label>
          <RowInfo label={label} sections={mergedInfoSections(pk, pcfg, sk, scfg, anyOn)} />
          {meta && (
            <span title={meta.label} style={{ width: 8, height: 8, borderRadius: 99, flex: "none", background: meta.color,
              animation: combined.state === "loading" ? "pf-pulse 1.1s ease-in-out infinite" : "none" }} />
          )}
        </div>
        {anyOn && opacityControl(label, opacity, (v) => setBoth({ opacity: v }))}
        {anyOn && showAbove && aboveRow(label, [[pk, pcfg], [sk, scfg]], setBoth)}
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
        {meta && (combined.state === "failed" || combined.state === "slow" || combined.state === "empty") && (
          <div style={{ fontSize: 10, color: meta.color, lineHeight: 1.35, marginTop: 1 }}>{combined.msg || meta.label}</div>
        )}
      </div>
    );
  };

  const renderEntry = ([k, cfg], opts) => (cfg.mergeWith ? compositeRow(k, cfg, opts) : row(k, cfg, opts));

  // The consolidated-layer row (B898) — ONE checkbox + opacity slider + ⓘ driving EVERY
  // member of a `mergeGroup` (Water & sewer / Electric / Fire hydrants). Generalizes
  // compositeRow above (pairwise City-limits-&-ETJ) to N members via the pure
  // mergeSlotAnyOn/mergeSlotOpacity/mergeGroupInfoSections helpers. INCLUSIVE, never
  // AHJ-exclusive: every member toggles together and renders whatever its own source
  // returns for the current view — nothing here re-filters by the parcel's jurisdiction
  // (see the MERGE_GROUPS comment in layers.js).
  const mergeGroupRow = (mergeGroupKey, members, { dim = false } = {}) => {
    const meta = MERGE_GROUPS[mergeGroupKey] || {};
    const label = meta.label || mergeGroupKey;
    const anyOn = mergeSlotAnyOn(members, overlays);
    const opacity = mergeSlotOpacity(members, overlays);
    const combined = anyOn ? combineLayerStatus(...members.map(([id]) => (overlays[id]?.on ? layerStatus[id] : null))) : null;
    const statusMeta = combined && STATUS[combined.state];
    const setAll = (patch) => members.forEach(([id]) => set(id, patch));
    const sections = mergeGroupInfoSections(members, { groupNote: meta.note });
    return (
      <div key={mergeGroupKey} style={{ marginBottom: 5, opacity: dim ? 0.55 : 1 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer", flex: 1, minWidth: 0 }}>
            <input type="checkbox" checked={anyOn} onChange={(e) => setAll({ on: e.target.checked })} />
            <span title={label} style={{ flex: 1, minWidth: 0, fontSize: compact ? 12 : 12.5, color: INK,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
          </label>
          <RowInfo label={label} sections={sections} />
          {statusMeta && (
            <span title={statusMeta.label} style={{ width: 8, height: 8, borderRadius: 99, flex: "none", background: statusMeta.color,
              animation: combined.state === "loading" ? "pf-pulse 1.1s ease-in-out infinite" : "none" }} />
          )}
        </div>
        {anyOn && opacityControl(label, opacity, (v) => setAll({ opacity: v }))}
        {anyOn && showAbove && aboveRow(label, members, setAll)}
        {statusMeta && (combined.state === "failed" || combined.state === "slow" || combined.state === "empty") && (
          <div style={{ fontSize: 10, color: statusMeta.color, lineHeight: 1.35, marginTop: 1 }}>{combined.msg || statusMeta.label}</div>
        )}
        {dim && (
          <div style={{ fontSize: 10, color: MUTED, fontStyle: "italic", marginTop: 1 }}>No data in this area from any source.</div>
        )}
      </div>
    );
  };

  // One RENDER SLOT per panel row: either a solo entry (which may itself be a legacy
  // pairwise mergeWith pair, handled inside renderEntry) or an N-ary `mergeGroup` bundle
  // (B898). slotAnyOn/slotLowRel/renderSlot are the slot-level equivalents of the old
  // per-entry lowRel/renderEntry, so groupRows works unchanged for either shape.
  const slotAnyOn = (slot) => (slot.kind === "merge"
    ? mergeSlotAnyOn(slot.members, overlays)
    : (() => { const [id, cfg] = slot.entry; return cfg.mergeWith ? !!(overlays[id]?.on || overlays[cfg.mergeWith]?.on) : !!overlays[id]?.on; })());
  const slotLowRel = (slot) => (slot.kind === "merge"
    ? slot.members.every(([id, cfg]) => lowRel(id, cfg))
    : lowRel(slot.entry[0], slot.entry[1]));
  const renderSlot = (slot, opts) => (slot.kind === "merge" ? mergeGroupRow(slot.mergeGroup, slot.members, opts) : renderEntry(slot.entry, opts));

  // Render a group's rows with the relevance treatment applied (NEW-2). Ordering /
  // visibility ONLY — the map is never touched. Merge secondaries (jur_etj) are dropped —
  // they render folded into their primary's composite row (B761); `buildGroupSlots` (B898)
  // additionally folds any `mergeGroup` members (Water & sewer / Electric / Fire hydrants)
  // into one slot each.
  // B1076: `render` lets a group supply its own row renderer (the Flood & drainage group
  // wraps each row with an agency badge + an honest empty-state reason) while keeping ALL
  // of the relevance ordering / dim / hide behaviour identical.
  /* NEW-2 — the out-of-state rows, named rather than listed or silently dropped.
   *
   * Dropping them would be the other sanctioned branch, and it is worse: the owner would have no
   * way to learn that oil & gas wells exist as a screen at all, or that Planyr simply has no
   * Colorado source for them yet. One collapsed line per group, each row naming its own reason. */
  const outOfStateBlock = (slots, groupKey) => slots.length > 0 && (
    <div style={{ marginTop: 4 }}>
      <button onClick={() => setRevealHidden((st) => ({ ...st, [`${groupKey}:state`]: !st[`${groupKey}:state`] }))}
        aria-expanded={!!revealHidden[`${groupKey}:state`]}
        aria-label={`${revealHidden[`${groupKey}:state`] ? "Hide" : "Show"} ${slots.length} layer${slots.length > 1 ? "s" : ""} not available in ${hereName}`}
        style={{ background: "transparent", border: "none", color: MUTED, fontSize: 10.5, cursor: "pointer", padding: "2px 0", textAlign: "left", width: "100%" }}>
        {revealHidden[`${groupKey}:state`] ? "▾ Hide" : "▸ Show"} {slots.length} not available in {hereName}
      </button>
      {revealHidden[`${groupKey}:state`] && slots.map((sl) => {
        const cfg = sl.kind === "merge" ? sl.members[0][1] : sl.entry[1];
        const id = sl.kind === "merge" ? sl.mergeGroup : sl.entry[0];
        // A merged slot is named by its GROUP here, exactly as mergeGroupRow names it above —
        // a demoted row that suddenly reads as its first member would be a different row.
        const label = (sl.kind === "merge" ? (MERGE_GROUPS[sl.mergeGroup] || {}).label : null) || cfg.label;
        return (
          <div key={`oos-${id}`} style={{ marginBottom: 5, opacity: 0.6 }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={false} disabled aria-label={`${label} — not available in ${hereName}`} />
              <span title={label} style={{ flex: 1, minWidth: 0, fontSize: compact ? 12 : 12.5, color: INK,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
            </div>
            <div style={{ fontSize: 10, color: MUTED, lineHeight: 1.4, margin: "1px 0 0 22px" }}>{outOfStateReason(cfg)}</div>
          </div>
        );
      })}
    </div>
  );

  const groupRows = (entries, groupKey, render = renderSlot) => {
    const allSlots = buildGroupSlots(entries.filter(([k]) => !mergeSecondaries.has(k)));
    // NEW-2 — split the state gate out BEFORE the relevance treatment. They answer different
    // questions ("this can never answer here" vs "its data doesn't reach this view"), and folding
    // an out-of-state row into the coverage bucket would tell the user the wrong one.
    const slots = [], oos = [];
    for (const sl of allSlots) (slotOutOfState(sl) ? oos : slots).push(sl);
    if (mode === "all") return <>{slots.map((sl) => render(sl))}{outOfStateBlock(oos, groupKey)}</>;
    const hi = [], lo = [];
    for (const sl of slots) (slotLowRel(sl) ? lo : hi).push(sl);
    return (
      <>
        {hi.map((sl) => render(sl))}
        {lo.length > 0 && (mode === "dim"
          ? lo.map((sl) => render(sl, { dim: true }))
          : (
            <>
              <button onClick={() => setRevealHidden((s) => ({ ...s, [groupKey]: !s[groupKey] }))}
                aria-expanded={!!revealHidden[groupKey]} aria-label={`${revealHidden[groupKey] ? "Hide" : "Show"} ${lo.length} layer${lo.length > 1 ? "s" : ""} with no local data in the ${groupKey} group`} /* B557 */
                style={{ background: "transparent", border: "none", color: MUTED, fontSize: 10.5, cursor: "pointer", padding: "2px 0", textAlign: "left", width: "100%" }}>
                {revealHidden[groupKey] ? "▾ Hide" : "▸ Show"} {lo.length} layer{lo.length > 1 ? "s" : ""} with no local data here
              </button>
              {revealHidden[groupKey] && lo.map((sl) => render(sl, { dim: true }))}
            </>
          ))}
        {outOfStateBlock(oos, groupKey)}
      </>
    );
  };

  // B898: entries from the flat ALL_LAYERS registry tagged for one panel GROUP — the
  // data-driven replacement for hard-coding which JS object renders where. `order`
  // decides position within the group (buildGroupSlots sorts by it); a merge-group's
  // members share one slot regardless of which underlying object (STATEWIDE/EVIDENCE/
  // JURISDICTIONS/AHJ_LAYERS) they live in.
  const groupEntries = (groupKey) => Object.entries(ALL_LAYERS).filter(([, cfg]) => cfg.group === groupKey);
  // "N on" group-header count: a merged row counts once if ANY member is on (generalizes
  // the old pairwise jurOnCount to N-ary merge groups too).
  const groupOnCount = (groupKey) => buildGroupSlots(groupEntries(groupKey).filter(([k]) => !mergeSecondaries.has(k))).filter(slotAnyOn).length;

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

  /* ---------------------------------------------------------------------------
   * B1076 / B1077 — the Flood & drainage GROUP.
   *
   * The owner's ask was "I kinda wanted something where it just showed flood elements
   * altogether." That is built here as a GROUP WITH ONE MASTER TOGGLE — deliberately NOT
   * as one merged layer, because merging would erase the difference between a REGULATORY
   * line somebody enforces and an ADVISORY MODEL nobody does. Four labelled tiers keep
   * that difference visible; the master switch still turns the whole relevant bundle on in
   * one click. Every child keeps its own status dot (the B790 machine), opacity slider,
   * ordering and per-row ⓘ — nothing about a row's own behaviour changes here.
   * ------------------------------------------------------------------------- */
  const floodDistrict = governingDistrict({
    detected: floodContext?.drainageDistrict?.id ? [floodContext.drainageDistrict.id] : null,
    county: floodCounty,
    tested: floodContext?.drainageDistrict?.tested || null,
  });
  /* B1091 — scoping now runs on THREE signals, not one: the boundary test (`governing`),
   * the county the site is in, and the coverage engine's published-extent verdict (the
   * same gate the Master Plan row already uses). The county half is what fixes the live
   * report: a Waller site listed HCFCD + City-of-Houston rows whenever the drainage check
   * hadn't resolved a district — and neither agency has anything in Waller County ever.
   *
   * B1091(×2) — but only an EXCLUSIVE answer may pick between two districts that both reach
   * this county (see governingDistrict / floodRowRelevance), and the county it reasons over
   * is `floodCounty` — the county the site IDENTIFY resolved — never the `county` prop,
   * which is the parcel-lookup registry key and defaults to Harris on every site. */
  const floodScope = scopeFloodEntries(groupEntries("flood"), {
    governing: floodDistrict.id, governingExclusive: floodDistrict.exclusive,
    county: floodCounty, coverage,
    isOn: (id) => !!overlays[id]?.on, // a layer you already turned on always stays listed
  });
  const floodMaster = floodMasterState(floodScope.tiers, overlays);

  /* NEW-3 — THE VINTAGE STAMP. Shown whenever the REGULATORY row is drawing from baked tiles,
   * and never when it is drawing live (a live layer's vintage is "now" and stamping it would be
   * noise). The county key is the SITE's own — the same one syncOverlayLayers picks the archive
   * with — so the panel can never stamp a date from a different county's archive than the one
   * on screen.
   *
   * ⛔ PANEL-BREVITY: this adds ZERO visible lines. It renders as a chip on the tier header the
   * FEMA row already sits under ("REGULATORY · NFHL as of Nov 15, 2019"), which is rule 3 —
   * a named state, not a sentence explaining the state. Nothing was removed because nothing
   * needed to be: the default view's line count is unchanged. */
  const floodTileSource = resolveFloodSource({ enabled: floodTilesEnabled(), countyKey: siteCounty });
  const tilesAreSource = floodTileSource.source === "tiles";
  const [floodManifest, setFloodManifest] = useState(null);
  useEffect(() => {
    if (!tilesAreSource) return;
    let alive = true;
    loadFloodManifest().then((m) => { if (alive) setFloodManifest(m); });
    return () => { alive = false; };
  }, [tilesAreSource]);
  // Deliberately computed even when the manifest is null: `floodVintageStamp` answers "unknown"
  // rather than nothing, so the line can never silently disappear on a failed fetch.
  const floodVintage = tilesAreSource ? floodVintageStamp(floodManifest, siteCounty) : null;
  /* ⛔ THE FEMA VERDICT'S WORDS ARE LOADED ON DEMAND, and this is a BUNDLE decision, not a
   * stylistic one. `floodZoneCopy.js` holds every flood sentence plus the NEW-3 FIPS / FIRM
   * provenance tables; a static import from this panel would pin all of it to the site-route
   * chunk, which had 0.4 KB of headroom when this landed. The flood group renders behind
   * `collapsed.flood`, so the import has landed long before anything here is on screen — and
   * if it somehow has not, the group simply shows its other honest lines for one tick rather
   * than a spinner. Loaded once per session and cached by the module system. */
  const femaVerdict = floodCopy ? floodCopy.femaZoneVerdict(floodContext?.flood) : null;
  /* (NEW-1/NEW-2) The one line that fires when the facts AREN'T in hand — the state that
   * used to render nothing at all. Mutually exclusive with the FEMA verdict below. */
  const factsNote = floodFactsNote({ hasContext: !!floodContext?.flood?.state, county: floodCounty });
  const TONE = { ok: "var(--text-secondary)", warn: "var(--warn-text)", alert: "var(--danger)" };

  const floodMasterRow = (
    <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
      <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer", flex: 1, minWidth: 0 }}>
        <input type="checkbox" checked={floodMaster.all}
          ref={(el) => { if (el) el.indeterminate = floodMaster.any && !floodMaster.all; }}
          aria-label="Show all flood and drainage layers"
          onChange={(e) => { const on = e.target.checked; floodMaster.ids.forEach((id) => set(id, { on })); }} />
        <span style={{ flex: 1, fontSize: compact ? 12 : 12.5, color: INK, fontWeight: 600 }}>Show all flood & drainage</span>
      </label>
      {floodMaster.any && (
        <span style={{ fontSize: 10, color: MUTED, flex: "none" }}>{floodMaster.onCount}/{floodMaster.ids.length}</span>
      )}
    </div>
  );

  // The agency badge — WHOSE data this row is, at a glance. Provider names never became
  // group headings (the B898 rule), so they earn their place here instead, as a chip.
  const agencyBadge = (cfg) => (cfg.agency ? (
    <span title={cfg.source || cfg.agency}
      style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.04em", color: MUTED, border: `1px solid ${LINE}`,
        borderRadius: 4, padding: "0 3px", flex: "none", whiteSpace: "nowrap" }}>
      {cfg.agency}
    </span>
  ) : null);

  /* One flood row = the ordinary row, plus its agency badge and — the whole point of
   * B1077 — an HONEST reason when it comes back with nothing. A silent blank is what made
   * a correct "no flood hazard here" indistinguishable from a broken layer. */
  const whyLine = (text) => (
    <div style={{ fontSize: 10, color: MUTED, lineHeight: 1.4, margin: "0 0 5px 22px" }}>{text}</div>
  );
  const floodRow = (slot, opts) => {
    if (slot.kind === "merge") return renderSlot(slot, opts);
    const [k, cfg] = slot.entry;
    const st = overlays[k];
    if (!st) return null;
    const ls = st.on ? layerStatus[k] : null;
    // B1091 — the out-of-area reason outranks the empty-here one: if this source can't
    // cover the site at all, "covers this area and reports nothing" would be a lie.
    const why = floodScope.notes[k] || (st.on && ls && ls.state === "empty"
      ? emptyReason(cfg, { coverage: coverage[k] })
      : null);
    return (
      <div key={k}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <div style={{ flex: 1, minWidth: 0 }}>{renderSlot(slot, opts)}</div>
          {agencyBadge(cfg)}
        </div>
        {why && whyLine(why)}
      </div>
    );
  };

  /* (B1091) The demoted rows — sources that cannot have anything to say at this site.
   * ONE collapsed line in the default view; open it and every row is there, still
   * toggleable, each naming WHY it isn't in the list above. Hiding them outright would
   * have been the other sanctioned branch; this one keeps discoverability, so a scoping
   * call the user disagrees with is one click from being overridden. */
  const floodOffRows = floodScope.offRows.length > 0 && (
    <div style={{ marginTop: 6 }}>
      <button onClick={() => setRevealHidden((s) => ({ ...s, floodOff: !s.floodOff }))}
        aria-expanded={!!revealHidden.floodOff}
        aria-label={`${revealHidden.floodOff ? "Hide" : "Show"} ${floodScope.offRows.length} flood and drainage source${floodScope.offRows.length > 1 ? "s" : ""} that don't cover this site`}
        style={{ background: "transparent", border: "none", color: MUTED, fontSize: 10.5, cursor: "pointer", padding: "2px 0", textAlign: "left", width: "100%" }}>
        {/* NEW-4 — the verb, and the same wording as the sibling "no local data here" control
            above. Without it the line read as a STATEMENT ("5 sources that don't cover this
            site") rather than a control, so the owner had no cue that the five could be named —
            and on an out-of-region site "is one of them flood-related?" is exactly the question
            that decides how much to trust the flood answer. The rows were always here (B1091);
            only the affordance was missing. */}
        {revealHidden.floodOff ? "▾ Hide" : "▸ Show"} the {floodScope.offRows.length} source{floodScope.offRows.length > 1 ? "s" : ""} that don&rsquo;t cover this site
      </button>
      {revealHidden.floodOff && floodScope.offRows.map(([k, cfg]) => (
        <div key={k} style={{ opacity: 0.72 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ flex: 1, minWidth: 0 }}>{renderEntry([k, cfg], { dim: false })}</div>
            {agencyBadge(cfg)}
          </div>
          {floodScope.notes[k] && whyLine(floodScope.notes[k])}
        </div>
      ))}
    </div>
  );

  const floodGroupBody = (
    <>
      {floodMasterRow}
      {floodScope.tiers.map((t) => (
        <div key={t.key}>
          <div title={t.note} style={{ ...groupHdr, margin: "6px 0 3px", display: "flex", alignItems: "center", gap: 5 }}>
            <span>{t.label}</span>
            {t.key === "advisory" && (
              <span style={{ color: "var(--warn-text)", fontWeight: 700, letterSpacing: 0 }}>· not regulatory</span>
            )}
            {/* NEW-3 — the baked-tile vintage, on the tier the FEMA row lives in. Rides the
                header so it costs no line of its own; the hover carries the county it belongs
                to, because a stamp with no county is a date you cannot check. */}
            {t.key === "regulatory" && floodVintage && (
              <span data-testid="flood-tile-vintage"
                title={`Drawn from Planyr's baked copy of FEMA's National Flood Hazard Layer for this county. The live FEMA service remains the authority for a parcel's zone and acreage.`}
                style={{ color: floodVintage.known ? MUTED : "var(--warn-text)", fontWeight: 600, letterSpacing: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                · {floodVintage.text}
              </span>
            )}
          </div>
          {groupRows(t.rows, `flood-${t.key}`, floodRow)}
        </div>
      ))}
      {/* (B1091) Everything the scoping demoted, behind one line — with its reason. */}
      {floodOffRows}
      {/* (NEW-3a) What FEMA actually said — the answer that was missing entirely. */}
      {/* NEW-3 — the PROVENANCE rides the line's hover, not the line: the decoded FIRM panel
          ("Larimer County, Colorado FIRM panel 08069C1405G, effective Jan 15, 2021"), the source,
          and the data's age, in the app's established basis shape. A study identifier is a
          click-into-detail fact, never glance-at-the-map furniture. */}
      {femaVerdict && (
        <div data-testid="flood-fema-verdict" title={femaVerdict.basis || undefined}
          style={{ fontSize: 10.5, color: TONE[femaVerdict.tone] || MUTED, lineHeight: 1.45, marginTop: 6 }}>
          {femaVerdict.text}
        </div>
      )}
      {/* (NEW-1/NEW-2) …and what's HONESTLY not known yet. `femaVerdict` is null exactly when
          there is no context, so these two never both speak about FEMA; the county-open
          variant rides alongside a real verdict because it reports a different fact. */}
      {factsNote && (
        <div data-testid="flood-facts-note" style={{ fontSize: 10.5, color: TONE[factsNote.tone] || MUTED, lineHeight: 1.45, marginTop: 6 }}>
          {factsNote.text}
        </div>
      )}
      {/* The one standing line that would have answered the original report on its own.
          Stated ONCE for the group, never repeated per row. */}
      <div style={{ fontSize: 10, color: MUTED, lineHeight: 1.45, marginTop: 4, fontStyle: "italic" }}>
        {FEMA_ZONES_NOT_CHANNELS}
      </div>
    </>
  );

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
        {/* NEW-1 — the empty-basemap state is one of the two places the owner meets an unlocated
            plan, so it carries the fix rather than just the diagnosis. */}
        {onSetLocation && (
          <button data-testid="layers-set-location" onClick={onSetLocation}
            style={{ marginTop: 6, width: "100%", padding: "5px 8px", fontSize: 11, fontWeight: 700, fontFamily: "inherit",
              border: "1px solid var(--accent)", borderRadius: 6, background: "var(--accent)", color: "var(--on-accent)", cursor: "pointer" }}>
            📍 Set this plan's location
          </button>
        )}
      </div>
    );
  }

  // B898 — decision-first group order (deal-killer first, reference last), replacing the old
  // data-PROVIDER order (a Houston-specific group used to sit above the generic ones). Each
  // group below pulls its rows from the flat ALL_LAYERS registry via `groupEntries`/`groupRows`
  // — purely data-driven off each layer's `group`/`order` (see LAYER_GROUP_ORDER in layers.js).
  /* NEW-4 — THE WAY OUT.
   *
   * The owner's words: "Right now recovering from an over-layered map means unchecking boxes one
   * at a time in a four-row scroll box." Turning things ON is a series of small decisions;
   * turning them all off should be ONE, and it is the action you want precisely when the screen
   * has become unreadable — i.e. when hunting for individual checkboxes is hardest.
   *
   * It clears every GIS layer and leaves the plan and the ground exactly as they were: the
   * basemap and the terrain tier are EXEMPT (lib/layerWeight.js), because "I can't see my plan"
   * never means "turn the aerial off". The button appears only when there is something to
   * clear, so it is never dead chrome. */
  const sweepIds = sweepableLayerIds(ALL_LAYERS).filter((id) => overlays[id]?.on);
  const clearAllLayers = () => setOverlays((o) => {
    const next = { ...o };
    for (const id of sweepIds) next[id] = { ...next[id], on: false };
    return next;
  });

  return (
    <div data-testid="layer-panel" data-surface={surface}>
      {sweepIds.length > 0 && (
        <button data-testid="layers-clear-all" onClick={clearAllLayers}
          title="Turn every reference layer off. Your plan and the aerial stay exactly as they are."
          style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", marginBottom: 6,
            padding: "5px 8px", border: `1px solid ${LINE}`, borderRadius: 6, background: "transparent",
            color: INK, fontFamily: "inherit", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>
          <span aria-hidden="true" style={{ color: MUTED }}>⊘</span>
          <span style={{ flex: 1, textAlign: "left" }}>Turn all {sweepIds.length} layer{sweepIds.length > 1 ? "s" : ""} off</span>
        </button>
      )}
      {/* 1) Base & terrain — the planner's aerial source (B693) + terrain (B696) + any
             single-layer county fold (B762, e.g. Fort Bend contours). Kept as its own
             special-cased section (the segmented Off/Aerial/USGS control isn't a layer row). */}
      {groupHead("basemap", LAYER_GROUP_LABEL.base, onCount(TERRAIN) + (foldEntry && overlays[foldEntry[0]]?.on ? 1 : 0) + (basemap && basemap.value !== "off" && !basemap.disabledReason ? 1 : 0))}
      {!collapsed.basemap && <>
        {basemapControl}
        {groupRows(basemapEntries(), "basemap")}
      </>}

      {/* A county contributing ≥2 layers of its OWN gets a labeled group (B762) — none do
          today (Harris's local layers moved into Flood/Utilities below, B898); kept so a
          future county publishing several layers of its own has an obvious home. A lone
          layer (Fort Bend contours) folds into Base & terrain above instead. */}
      {jur && Object.keys(jur.layers || {}).length >= 2 && <>
        {groupHead("jurisdiction", jur.label, onCount(jur.layers || {}))}
        {!collapsed.jurisdiction && groupRows(Object.entries(jur.layers), "jurisdiction")}
      </>}

      {/* 2) Flood & drainage — deal-killer first: FEMA zones, drainage channels & ROW, storm
             sewer (auto-scoped by AHJ — no hard-coded "Houston" label; today's only adapter is
             Harris/COH, more can be added incrementally per layers.js AHJ_LAYERS). */}
      {groupHead("flood", LAYER_GROUP_LABEL.flood, floodMaster.onCount)}
      {!collapsed.flood && floodGroupBody}

      {/* 3) Utilities serving the site — the THREE consolidations (B898): Water & sewer
             (mains + who's entitled to serve, every provider that reaches here — never just
             the parcel's own AHJ), Electric (lines/substations/poles), Fire hydrants
             (best-available across sources). Each is ONE row driving several source adapters. */}
      {groupHead("utilities", LAYER_GROUP_LABEL.utilities, groupOnCount("utilities"))}
      {!collapsed.utilities && groupRows(groupEntries("utilities"), "utilities")}
      {/* B308: the layer works for everyone via the same-origin proxy (no token needed).
          The box is now an OPTIONAL power-user override — paste your own token to query
          Mapillary directly from this device instead of going through Planyr. */}
      {!collapsed.utilities && overlays.mapillary?.on && (
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

      {/* 4) Environmental & hazards — wetlands, pipelines (+ assumed easement corridor
             sub-toggle), oil & gas wells, faults, LPST, EPA Superfund/RCRA. */}
      {groupHead("environmental", LAYER_GROUP_LABEL.environmental, groupOnCount("environmental"))}
      {!collapsed.environmental && groupRows(groupEntries("environmental"), "environmental")}

      {/* 5) Access & infrastructure — traffic counts, rail, airports. */}
      {groupHead("access", LAYER_GROUP_LABEL.access, groupOnCount("access"))}
      {!collapsed.access && groupRows(groupEntries("access"), "access")}

      {/* 6) Jurisdictions & authority — reference, lowest decision impact: county/city&ETJ/
             road authority/ISD (default-hidden last). MUD moved into Water & sewer above
             (B898) — `groupEntries` naturally excludes it via its retagged `group`. */}
      {groupHead("jurbounds", LAYER_GROUP_LABEL.jurisdiction, groupOnCount("jurisdiction"))}
      {!collapsed.jurbounds && groupRows(groupEntries("jurisdiction"), "jurbounds")}

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
