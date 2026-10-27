/* Shared Imagery & Layers panel — rendered on BOTH the map finder and the site planner so the
 * controls never diverge. TWO PANES (owner-approved mockup, round 3, 2026-10-20): a group list on
 * the left, the selected group's rows on the right. On a phone-width card the left pane becomes a
 * group dropdown above the rows.
 *
 * THE ROW IS ONE LINE and nothing else: checkbox · map-colour swatch (when on) · name (+ its value,
 * e.g. Contour Lines `1′`) · status dot · ▾. NO persistent text under a row, ever. The ▾ opens an
 * inline dropdown (ONE open at a time) holding, in order and only what applies: the status line ·
 * "Too far out to draw" + Zoom In · Opacity · layer-specific settings · "Draw above plan" · the
 * legend · an ⓘ that reveals the source / vintage / caveat text. The order is the pure
 * `dropdownPlan` (lib/layerPanelModel.js) — this file renders it.
 *
 * LOCATION (owner 2026-10-11): a row whose source cannot serve this site is NOT RENDERED — not
 * demoted into a reveal list (this deliberately supersedes the old "not available in X" list). The
 * rules are pure and shared with the map's draw path (layerPanelModel.js); an unknown location fails
 * open and shows everything.
 *
 * HIDE LAYERS is temporary and non-destructive: a session-only switch (lib/layerHide.js) the MAP
 * reads through `drawnOverlaysOf`. This component never writes a checkbox for it.
 *
 * ⛔ This file may not contain a z-index token (B1205 — mapStack.js is the only place a draw order is
 * decided; test/mapStack asserts it on this source). One text size throughout: group and section
 * headings differ by weight only (owner).
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { RADIUS } from "../../../shared/ui/radius.js";
import { FONT_SIZE, SPACE } from "../../../shared/ui/designTokens.js";
import { Button, IconButton, MenuItem, SegmentedControl, ToggleChip } from "../../../shared/ui/controls.jsx";
import AnchoredMenu from "../../../shared/ui/AnchoredMenu.jsx";
import {
  rowInfoSections, combineLayerStatus,
  buildGroupSlots, mergeSlotAnyOn, mergeSlotOpacity, mergeGroupInfoSections,
} from "../lib/layerPanelInfo.js";
import {
  ALL_LAYERS, MERGE_GROUPS, layerVintage, jurisdictionFor,
} from "../lib/layers.js";
import { DEFAULT_CORRIDOR_WIDTH_FT } from "../lib/pipelineCorridor.js";
// NEW-1 — which layers the "Draw above plan" lift can actually move (only an AREA role). The model, never a local guess.
import { configCanLift } from "../lib/mapStack.js";
import { sweepableLayerIds } from "../lib/layerWeight.js";
import { mapillaryToken, setMapillaryToken, subscribeMapillaryToken } from "../lib/evidenceLayers.js";
import { formatAge } from "../lib/gisCache.js";
import {
  getRelevanceMode, setRelevanceMode, getNearbyRadiusMiles, setNearbyRadiusMiles, subscribeRelevance,
} from "../lib/coverage.js";
import {
  layerVisibility, combineVisibility, DORMANT_BLANK_LINE, GATE_CLEARANCE, PLACE_NAMES_MIN_ZOOM,
} from "../lib/layerZoomGate.js";
import {
  governingDistrict, scopeFloodEntries, floodFactsNote, emptyReason, FEMA_ZONES_NOT_CHANNELS,
} from "../lib/floodGroup.js";
// NEW-3 — the baked-tile vintage stamp. Decision + wording are pure (floodTiles.js); the fetch is one cached call per session.
import { floodTilesEnabled, resolveFloodSource, floodVintageStamp } from "../../../shared/gis/floodTiles.js";
import { loadFloodManifest } from "../lib/floodManifest.js";
import { placeNamesVisible } from "../lib/placeNamesGate.js";
import { PinIcon } from "./icons.jsx";
import {
  PANEL_GROUPS, groupEntriesFor, availableEntries, dropdownPlan, rowSwatch, rampGradient, legendFor,
  CONTOUR_INTERVALS, contourIntervalLabel, contourRowValue, CORRIDOR_WIDTH_CHOICES, corridorWidthOptions,
  opacityFromPercent, percentOf, OPACITY_MIN, OPACITY_MAX, pickGroup,
} from "../lib/layerPanelModel.js";
import { useServiceAreas } from "../lib/useServiceAreas.js";
import { getContourInterval, setContourInterval, subscribeContourInterval } from "../lib/contourIntervalPref.js";
import { setLayersHidden, useLayersHidden } from "../lib/layerHide.js";

const MUTED = "var(--text-secondary)", LINE = "var(--border-default)", INK = "var(--text-primary)";
const TEXT = FONT_SIZE.control;
const STATUS = {
  loading: { color: "var(--warn-text)", label: "loading…" },
  loaded: { color: "var(--status-active)", label: "loaded" },
  empty: { color: "var(--text-tertiary)", label: "no data" },
  // NEW-3/B790: an honest "the picture never arrived" state — amber (warn-text), NOT red. RED is reserved for a genuine error.
  slow: { color: "var(--warn-text)", label: "source slow" },
  failed: { color: "var(--danger)", label: "failed" },
  unconfigured: { color: "var(--text-tertiary)", label: "needs setup" },
};
/* "Layers with no data here": Show (the row renders like every other row) or Hide (it is not rendered). NO "Dim" — a faded row builds
 * hierarchy by fading text toward the background, which the theming rule forbids (NEW-2). A stored "dim" reads as Show. */
const RELEVANCE_OPTIONS = [{ key: "all", label: "Show" }, { key: "hide", label: "Hide" }];
const GROUP_PREF_KEY = "planyr:layerPanelGroup";
const NARROW_BELOW_PX = 310; // the panel's OWN box (ResizeObserver) — never the window; below it the group list becomes a dropdown
const NAV_W = 120;
/* A ROW'S INLINE RHYTHM (B2436064 ×2): the name starts ONE gap after the checkbox on EVERY row — on or off, with or without a map colour
 * — the same checkbox-to-label gap the dropdown's own checkbox rows use (SPACE.sm). No slot is reserved to line names up: every row
 * starts its name right after the checkbox, so they align by construction. The layer's colour chip sits AFTER the name, only while the
 * layer is on and has a map colour. */
const CHECK_GAP = SPACE.sm;
const CHIP = 10;
const CHECKBOX_RESET = { margin: 0, flex: "none" }; // the browser's own 3-4 px checkbox margins were the rest of the hole
const OUT_OF_AREA_LINE = "No data in this area — this layer only covers its home region. The map still shows whatever the source returns here.";

/* ── small presentational pieces (module scope — MODULE-SCOPE-COMPONENTS) ───────────────────── */

const fieldBase = {
  boxSizing: "border-box", fontFamily: "inherit", fontSize: TEXT, color: INK,
  background: "var(--surface-base)", border: `1px solid ${LINE}`, borderRadius: RADIUS.sm,
};

function StatusDot({ meta, loading, dormant, hidden, title }) {
  if (!meta && !dormant && !hidden) return null;
  const hollow = dormant || hidden;
  return (
    <span data-layer-dot={hidden ? "hidden" : dormant ? "dormant" : (meta ? meta.label : "")} title={title}
      style={{ width: 8, height: 8, borderRadius: RADIUS.pill, flex: "none", boxSizing: "border-box",
        background: hollow ? "transparent" : meta.color,
        border: hollow ? "1.5px solid var(--text-tertiary)" : "none",
        animation: !hollow && loading ? "pf-pulse 1.1s ease-in-out infinite" : "none" }} />
  );
}

/* The layer's colour chip — after the name, only on an ON row that has a map colour. Nothing is rendered otherwise (no placeholder). */
function Swatch({ color, show }) {
  if (!show || !color) return null;
  return <span aria-hidden="true" data-swatch="on" style={{ width: CHIP, height: CHIP, flex: "none", boxSizing: "border-box", background: color, border: `1px solid ${LINE}` }} />;
}

function Caret({ open }) {
  return <span aria-hidden="true" style={{ display: "inline-block", fontSize: TEXT, lineHeight: 1, transform: open ? "rotate(180deg)" : "none" }}>▾</span>;
}

function OpacityRow({ label, value, onChange }) {
  const [draft, setDraft] = useState(null);
  const shown = draft != null ? draft : String(percentOf(value));
  return (
    <div data-part="opacity" style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ flex: "none", color: MUTED, fontWeight: 600 }}>Opacity</span>
      <input type="range" min={OPACITY_MIN} max={OPACITY_MAX} step={0.05} value={value} aria-label={`${label} opacity`}
        onChange={(e) => { setDraft(null); onChange(+e.target.value); }} style={{ flex: 1, minWidth: 0 }} />
      <input type="text" inputMode="numeric" value={shown} aria-label={`${label} opacity percent`}
        onChange={(e) => { setDraft(e.target.value); const f = opacityFromPercent(e.target.value); if (f != null) onChange(f); }}
        onBlur={() => setDraft(null)}
        style={{ ...fieldBase, width: 44, padding: "2px 4px", textAlign: "right", fontVariantNumeric: "tabular-nums", flex: "none" }} />
      <span aria-hidden="true" style={{ flex: "none", color: MUTED }}>%</span>
    </div>
  );
}

function Select({ label, value, onChange, options, testId }) {
  return (
    <select aria-label={label} data-testid={testId} value={value} onChange={(e) => onChange(e.target.value)}
      style={{ ...fieldBase, padding: "3px 6px", cursor: "pointer", maxWidth: "100%" }}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function Legend({ items }) {
  if (!items || !items.length) return null;
  return (
    <div data-part="legend" style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px" }}>
      {items.map((lg) => (
        <span key={lg.label} style={{ display: "inline-flex", alignItems: "center", gap: 5, color: INK }}>
          <span aria-hidden="true" style={{ width: 16, height: 0, flex: "none", borderTop: `${lg.weight ? Math.max(1.5, lg.weight / 1.4) : 3}px ${lg.dash ? "dashed" : "solid"} ${lg.color}` }} />
          {lg.label}
        </span>
      ))}
    </div>
  );
}

function RampBar({ gradient }) {
  return (
    <div data-part="ramp">
      <div aria-hidden="true" style={{ height: 10, borderRadius: RADIUS.sm, border: `1px solid ${LINE}`, background: gradient }} />
      <div style={{ display: "flex", justifyContent: "space-between", color: MUTED, marginTop: 2 }}>
        <span>Lower</span><span>Higher</span>
      </div>
    </div>
  );
}

function InfoReveal({ label, sections }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const rows = (sections || []).filter((s) => s && s.text != null && String(s.text).trim() !== "");
  if (!rows.length) return null;
  return (
    <div data-part="info">
      <button type="button" aria-expanded={open} aria-controls={id} aria-label={`About ${label}`} onClick={() => setOpen((o) => !o)}
        style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: TEXT,
          color: "var(--text-secondary)", fontWeight: 600, display: "inline-flex", alignItems: "center" }}>
        <span aria-hidden="true">ⓘ</span>
      </button>
      {open && (
        <div id={id} role="note" data-testid="layer-info-text" style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 4, lineHeight: 1.42 }}>
          {rows.map((s, i) => (
            <div key={i} style={{ color: s.tone === "warn" ? "var(--warn-text)" : MUTED, fontStyle: s.tone === "warn" ? "italic" : "normal" }}>{s.text}</div>
          ))}
        </div>
      )}
    </div>
  );
}

/* The ▾ body. Renders exactly the parts `dropdownPlan` lists, in that order. */
function RowDropdown({ spec }) {
  const d = spec.dropdown;
  return (
    <div id={`layer-menu-${spec.id}`} data-testid={`layer-row-${spec.id}-menu`} data-plan={d.plan.join(",")}
      style={{ margin: "2px 0 4px 20px", padding: "8px 10px", display: "flex", flexDirection: "column", gap: 8,
        border: `1px solid ${LINE}`, borderRadius: RADIUS.md, background: "var(--surface-raised)" }}>
      {d.plan.map((part) => {
        switch (part) {
          case "status":
            return <div key={part} data-part="status" style={{ color: d.status.tone || MUTED, lineHeight: 1.4 }}>{d.status.text}</div>;
          case "zoom":
            return (
              <div key={part} data-part="zoom" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span data-testid="layer-zoom-note" style={{ flex: 1, minWidth: 0, color: "var(--warn-text)", fontWeight: 600 }}>Too far out to draw</span>
                {d.zoom.onZoom && (
                  <Button size="sm" variant="ghost" data-testid="layer-zoom-fix" onClick={d.zoom.onZoom}
                    aria-label={`${spec.label} — too far out to draw. Zoom in far enough for it to draw.`} style={{ flex: "none", fontSize: TEXT }}>Zoom In</Button>
                )}
              </div>
            );
          case "opacity":
            return <OpacityRow key={part} label={spec.label} value={d.opacity.value} onChange={d.opacity.onChange} />;
          case "interval":
            return (
              <label key={part} data-part="interval" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ flex: "none", color: MUTED, fontWeight: 600 }}>Interval</span>
                <Select label="Contour interval" testId="contour-interval" value={String(d.interval.value)}
                  onChange={(v) => d.interval.onChange(Number(v))}
                  options={CONTOUR_INTERVALS.map((n) => ({ value: String(n), label: contourIntervalLabel(n) }))} />
              </label>
            );
          case "corridor":
            return (
              <div key={part} data-part="corridor" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <input type="checkbox" data-testid="pipeline-corridor" checked={d.corridor.on} onChange={(e) => d.corridor.onToggle(e.target.checked)} />
                  <span>Easement corridor</span>
                </label>
                <Select label="Easement corridor total width" testId="pipeline-corridor-width" value={String(d.corridor.widthFt)}
                  onChange={(v) => d.corridor.onWidth(Number(v))}
                  options={corridorWidthOptions(d.corridor.widthFt).map((n) => ({ value: String(n), label: `${n} ft` }))} />
              </div>
            );
          case "token":
            return (
              <div key={part} data-part="token" style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ color: MUTED }}>Optional: use your own Mapillary token instead of Planyr's built-in access.</span>
                <input type="password" value={d.token.value} placeholder="Your own token (MLY|…)" autoComplete="off"
                  onChange={(e) => d.token.onChange(e.target.value)}
                  style={{ ...fieldBase, width: "100%", padding: "4px 6px", fontFamily: "ui-monospace, monospace" }} />
              </div>
            );
          case "above":
            return (
              <label key={part} data-part="above" style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
                title="Draw this layer over your buildings instead of under them. Opacity can't do this — a layer under the plan stays covered however faint it is.">
                <input type="checkbox" aria-label={`Draw ${spec.label} above plan`} checked={d.above.checked} onChange={(e) => d.above.onChange(e.target.checked)} />
                <span>Draw above plan</span>
              </label>
            );
          case "ramp":
            return <RampBar key={part} gradient={d.ramp} />;
          case "legend":
            return <Legend key={part} items={d.legend} />;
          case "info":
            return <InfoReveal key={part} label={spec.label} sections={d.info} />;
          default:
            return null;
        }
      })}
    </div>
  );
}

/* ONE row. Checkbox · name (+ value) · colour chip (on rows with a map colour) · status dot · ▾. Nothing else, ever. */
function LayerRow({ spec, open, onToggleOpen }) {
  /* NO ROW IS EVER FADED (NEW-2): a zoom-gated ("dormant") row reads like every other row — the hollow status dot and the ▾ line say it. */
  return (
    <div data-testid={`layer-row-${spec.id}`} data-layer-state={spec.state} style={{ marginBottom: 4 }}>
      <div style={{ display: "flex", gap: SPACE.xs, alignItems: "center", minHeight: 24 }}>
        <label style={{ display: "flex", gap: CHECK_GAP, alignItems: "center", cursor: "pointer", flex: 1, minWidth: 0 }}>
          <input type="checkbox" checked={spec.checked} onChange={(e) => spec.onCheck(e.target.checked)} aria-label={spec.label} style={CHECKBOX_RESET} />
          <span title={spec.label} style={{ flex: "0 1 auto", minWidth: 0, color: INK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {spec.label}
            {spec.value && <span data-testid={`layer-value-${spec.id}`} style={{ color: MUTED, fontWeight: 600 }}> {spec.value}</span>}
          </span>
          <Swatch color={spec.swatch} show={spec.checked} />
        </label>
        <StatusDot meta={spec.dot.meta} loading={spec.dot.loading} dormant={spec.dot.dormant} hidden={spec.dot.hidden} title={spec.dot.title} />
        {spec.dropdown && (
          <button type="button" data-testid={`layer-caret-${spec.id}`} aria-expanded={open} aria-controls={`layer-menu-${spec.id}`}
            aria-label={`Options for ${spec.label}`} onClick={onToggleOpen}
            style={{ border: "none", background: "transparent", padding: "0 2px", cursor: "pointer", color: spec.checked ? INK : MUTED, fontFamily: "inherit", fontSize: TEXT, fontWeight: 700, flex: "none" }}>
            <Caret open={open} />
          </button>
        )}
      </div>
      {open && spec.dropdown && <RowDropdown spec={spec} />}
    </div>
  );
}

function SimpleCheckRow({ id, label, checked, onChange, testId }) {
  return (
    <div data-testid={`layer-row-${id}`} style={{ marginBottom: 4, minHeight: 24, display: "flex", alignItems: "center" }}>
      <label style={{ display: "flex", gap: CHECK_GAP, alignItems: "center", cursor: "pointer", flex: 1, minWidth: 0 }}>
        <input type="checkbox" data-testid={testId} checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} style={CHECKBOX_RESET} />
        <span style={{ flex: 1, minWidth: 0 }}>{label}</span>
      </label>
    </div>
  );
}

function SectionHeading({ children, title }) {
  return <div title={title} style={{ fontWeight: 700, color: MUTED, margin: "8px 0 4px" }}>{children}</div>;
}

function GroupNav({ groups, counts, selected, onSelect }) {
  return (
    <nav aria-label="Layer groups" role="tablist" aria-orientation="vertical" data-testid="layer-group-nav"
      style={{ width: NAV_W, flex: "none", alignSelf: "flex-start", position: "sticky", top: 0, display: "flex", flexDirection: "column", gap: 2 }}>
      {groups.map((g) => {
        const on = g.key === selected;
        const n = counts[g.key] || 0;
        return (
          <button key={g.key} type="button" role="tab" aria-selected={on} data-testid={`layer-group-${g.key}`} onClick={() => onSelect(g.key)}
            style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 4, width: "100%", textAlign: "left",
              padding: "5px 4px 5px 6px", fontFamily: "inherit", fontSize: TEXT, cursor: "pointer", color: INK,
              fontWeight: on ? 700 : 500, background: on ? "var(--hover-menu)" : "transparent",
              border: "none", borderLeft: `3px solid ${on ? "var(--accent)" : "transparent"}`, borderRadius: RADIUS.sm,
              whiteSpace: "normal", overflowWrap: "break-word", wordBreak: "normal" }}>
            <span style={{ flex: 1, minWidth: 0 }}>{g.label}</span>
            {n > 0 && <span data-testid={`layer-group-count-${g.key}`} aria-label={`${n} on`} style={{ flex: "none", color: "var(--success-text)", fontWeight: 700 }}>{n}</span>}
          </button>
        );
      })}
    </nav>
  );
}

function GroupSelect({ groups, counts, selected, onSelect }) {
  return (
    <select aria-label="Layer group" data-testid="layer-group-select" value={selected} onChange={(e) => onSelect(e.target.value)}
      style={{ ...fieldBase, width: "100%", padding: "5px 6px", marginBottom: 6, fontWeight: 700, cursor: "pointer" }}>
      {groups.map((g) => <option key={g.key} value={g.key}>{g.label}{counts[g.key] ? ` (${counts[g.key]} on)` : ""}</option>)}
    </select>
  );
}

function MoreMenu({ open, onClose, anchorRef, canClear, onClear, mode, onMode, radius, onRadius }) {
  return (
    <AnchoredMenu open={open} onClose={onClose} anchorRef={anchorRef} placement="below-right" width={276} gap={6}>
      <div data-testid="layers-more-menu" style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: TEXT }}>
        <MenuItem disabled={!canClear} data-testid="layers-clear-all" onClick={() => { onClear(); onClose(); }}
          title="Turn every reference layer off. Your plan and the aerial stay exactly as they are.">Turn all layers off</MenuItem>
        <div style={{ padding: "0 4px", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontWeight: 600, color: INK }} title="How to show layers whose data doesn't reach this view. Affects this list only — never the map.">Layers with no data here</div>
          <SegmentedControl options={RELEVANCE_OPTIONS} value={mode} onChange={onMode} aria-label="Layers with no data here" data-testid="layers-relevance" />
          {mode !== "all" && (
            <label style={{ display: "flex", alignItems: "center", gap: 6, color: MUTED }}
              title="Layers with data within this distance of the view still count as relevant — so data just off-screen or just past a boundary stays listed.">
              <span style={{ flex: "none" }}>Nearby range</span>
              <input type="range" min={0.5} max={10} step={0.5} value={radius} aria-label="Nearby range (miles)" onChange={(e) => onRadius(+e.target.value)} style={{ flex: 1, minWidth: 0 }} />
              <span style={{ flex: "none", color: INK, fontWeight: 600, whiteSpace: "nowrap" }}>{radius} mi</span>
            </label>
          )}
        </div>
        <div style={{ padding: "0 4px", color: MUTED }}>Screening data. Verify before relying on it.</div>
      </div>
    </AnchoredMenu>
  );
}

/* The card's own measured width (never the window's): below NARROW_BELOW_PX the group list is a dropdown. */
function useNarrow(ref) {
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const measure = () => { const w = el.getBoundingClientRect().width; if (w > 0) setNarrow(w < NARROW_BELOW_PX); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return narrow;
}

const readGroupPref = () => { try { return localStorage.getItem(GROUP_PREF_KEY) || null; } catch (_) { return null; } };
const writeGroupPref = (k) => { try { localStorage.setItem(GROUP_PREF_KEY, k); } catch (_) { /* per-device convenience only */ } };

/* ── the panel ──────────────────────────────────────────────────────────────────────────────── */

export default function LayerPanel({
  overlays, setOverlays, county, layerStatus = {}, coverage = {}, basemap = null, gisNote = null,
  /* Owner-only grading layer: `{ rows: [{id,label,on,sub,info}], onToggle(id,on) }` — two extra Topography rows. */
  gradingRows = undefined,
  /* The basemap's ROAD-NAMES overlay: `{ value, onChange, opacity, onOpacityChange }`, and the finder's own CITY-NAMES layer
   * `{ value, onChange }`. Both live in Map Base › Labels. */
  placeNames = null,
  cityNames = null,
  /* The finder's "Your Data": [{ id, label, count, value, onChange, testId }] — Sites, Comps, Notes. Absent on the planner. */
  yourData = null,
  /* B1091(×2) — the county this SITE is in; the flood group's district scoping reasons over it. */
  siteCounty = null,
  /* B1076/B1077 — drainage facts the Flood & Drainage group needs to be HONEST (governing district + what FEMA reported). */
  floodContext = null,
  /* WHICH copy of this panel this is — both hosts mount one, so the DOM always holds two. */
  surface = "planner",
  /* WHICH STATE this site is in ("TX" | "CO" | …| null) and WHERE ({lat,lng} | null). Null hides nothing (fail open). */
  siteState = null,
  siteLocation = null,
  /* The planner passes this only while the plan has no origin: the one-click fix for an unlocated plan. */
  onSetLocation = null,
  /* The LIVE map zoom and the callback that changes it — what turns "too far out" into a button that fixes it. */
  mapZoom = null,
  onZoomTo = null,
  /* The host's collapse control (the title is its button). Absent → the title is plain text. */
  onCollapse = null,
}) {
  const rootRef = useRef(null);
  const narrow = useNarrow(rootRef);
  const hidden = useLayersHidden();
  useServiceAreas(!!siteLocation); // a row scoped to a service area (HCFCD, City of Houston, BKDD) is judged once its geometry loads — the state change re-renders the rows
  const scope = useMemo(() => ({ state: siteState || null, loc: siteLocation || null }), [siteState, siteLocation]);
  const jur = jurisdictionFor(county);

  /* B1091(×2) — WHICH county the flood group reasons about: the site IDENTIFY county, never the registry selector (`county`). */
  const identifyCounty = Array.isArray(floodContext?.authority?.jurisdiction?.county) ? floodContext.authority.jurisdiction.county : [];
  const floodCounty = identifyCounty.length === 1 ? identifyCounty[0] : identifyCounty.length ? null : siteCounty;
  const set = (k, patch) => setOverlays((o) => ({ ...o, [k]: { ...o[k], ...patch } }));

  const [tok, setTok] = useState(() => mapillaryToken());
  useEffect(() => subscribeMapillaryToken(setTok), []); // keep both LayerPanel copies in sync (B46)
  const [, forceTick] = useState(0); // a cached layer's age keeps counting up while the panel is open (B75)
  useEffect(() => { const t = setInterval(() => forceTick((n) => n + 1), 30000); return () => clearInterval(t); }, []);
  const [mode, setMode] = useState(getRelevanceMode);
  const [radius, setRadius] = useState(getNearbyRadiusMiles);
  useEffect(() => subscribeRelevance((p) => { setMode(p.mode); setRadius(p.radius); }), []);
  const [interval, setIntervalState] = useState(getContourInterval);
  useEffect(() => subscribeContourInterval(setIntervalState), []);
  const [floodCopy, setFloodCopy] = useState(null); // the lazily-loaded flood copy tier (B1349: loaded when there is something for it to say)
  const hasFloodFacts = !!floodContext?.flood?.state;
  useEffect(() => {
    if (!hasFloodFacts) return;
    import("../lib/floodZoneCopy.js").then(setFloodCopy).catch(() => {});
  }, [hasFloodFacts]);

  const [openRow, setOpenRow] = useState(null);    // ONE dropdown open at a time
  const toggleOpen = (id) => setOpenRow((cur) => (cur === id ? null : id));
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const [groupPref, setGroupPref] = useState(readGroupPref); // stale-ok: a per-device UI choice (which group tab is showing); only this panel reads or writes it

  /* ── per-row facts ── */
  const lowRel = (k, cfg) => !overlays[k]?.on && (coverage[k] === "out" || (cfg.needsSetup && !tok));
  const memberOf = (id, cfg) => ({ cfg, on: !!overlays[id]?.on, zoom: mapZoom, status: layerStatus[id] || null, coverage: coverage[id] || null });
  const visForMembers = (entries) => combineVisibility(entries.map(([id, c]) => memberOf(id, c)));
  const isDormant = (v) => !!v && (v.state === "dormant-zoom" || v.state === "dormant-blank");
  const showAbove = surface === "planner";
  const writeOn = (patchFn) => (v) => { if (v && hidden) setLayersHidden(false); patchFn(v); }; // turning a layer ON while hidden ends the hide

  /* B1076 — the Flood & Drainage tiers, scoped by the SAME governing-district rules as ever. */
  const floodEntries = availableEntries(groupEntriesFor(ALL_LAYERS, "flood"), scope);
  const floodDistrict = governingDistrict({
    detected: floodContext?.drainageDistrict?.id ? [floodContext.drainageDistrict.id] : null,
    county: floodCounty, tested: floodContext?.drainageDistrict?.tested || null,
  });
  const floodScope = scopeFloodEntries(floodEntries, {
    governing: floodDistrict.id, governingExclusive: floodDistrict.exclusive,
    county: floodCounty, coverage, isOn: (id) => !!overlays[id]?.on,
  });
  const floodTileSource = resolveFloodSource({ enabled: floodTilesEnabled(), countyKey: siteCounty });
  const tilesAreSource = floodTileSource.source === "tiles";
  const [floodManifest, setFloodManifest] = useState(null);
  useEffect(() => {
    if (!tilesAreSource) return undefined;
    let alive = true;
    loadFloodManifest().then((m) => { if (alive) setFloodManifest(m); });
    return () => { alive = false; };
  }, [tilesAreSource]);
  const floodVintage = tilesAreSource ? floodVintageStamp(floodManifest, siteCounty) : null;
  const femaVerdict = floodCopy ? floodCopy.femaZoneVerdict(floodContext?.flood) : null;
  const factsNote = floodFactsNote({ hasContext: !!floodContext?.flood?.state, county: floodCounty });

  /* The FEMA row's ⓘ carries what used to sit visible under the group: the verdict, the not-yet-known note, the FEMA-vs-channels line. */
  const femaExtras = () => {
    const out = [];
    if (femaVerdict) {
      out.push({ text: femaVerdict.text, tone: femaVerdict.tone === "ok" ? undefined : "warn" });
      if (femaVerdict.basis) out.push({ text: femaVerdict.basis });
    }
    if (factsNote) out.push({ text: factsNote.text, tone: factsNote.tone === "ok" ? undefined : "warn" });
    if (floodVintage) out.push({ text: `Drawn from Planyr's baked copy of FEMA's National Flood Hazard Layer for this county: ${floodVintage.text}. The live FEMA service remains the authority for a parcel's zone and acreage.`, tone: floodVintage.known ? undefined : "warn" });
    out.push({ text: FEMA_ZONES_NOT_CHANNELS });
    return out;
  };

  /* ── building one row spec from a slot ── */
  const slotSpec = (slot, { why = null } = {}) => {
    const members = slot.kind === "merge" ? slot.members : [slot.entry];
    const id = slot.kind === "merge" ? slot.mergeGroup : slot.entry[0];
    const cfg0 = members[0][1];
    const mg = slot.kind === "merge" ? (MERGE_GROUPS[slot.mergeGroup] || {}) : null;
    const label = mg ? (mg.label || id) : cfg0.label;
    const anyOn = mergeSlotAnyOn(members, overlays);
    const opacity = mergeSlotOpacity(members, overlays);
    const combined = anyOn ? combineLayerStatus(...members.map(([mid]) => (overlays[mid]?.on ? layerStatus[mid] : null))) : null;
    const meta = combined && STATUS[combined.state];
    const vis = visForMembers(members);
    const setAll = (patch) => members.forEach(([mid]) => set(mid, patch));
    // Changing how an OFF layer looks (opacity, Draw above plan, the easement corridor) turns it on first — one on-transition, like its checkbox.
    const wakeRow = () => { if (hidden) setLayersHidden(false); setAll({ on: true }); };
    const ls0 = slot.kind === "solo" && anyOn ? layerStatus[id] : null;
    const age = ls0 && ls0.ts ? formatAge(Date.now() - ls0.ts) : "";
    let info = slot.kind === "merge"
      ? mergeGroupInfoSections(members, { groupNote: mg.note })
      : rowInfoSections(cfg0, { vintage: layerVintage(id, cfg0), age, ls: ls0 });
    if (id === "fema") info = [...femaExtras(), ...info];
    if (cfg0.agency && slot.kind === "solo") info = [{ text: `Agency: ${cfg0.agency}` }, ...info];

    // the status line (failed / slow / empty / needs-setup / out-of-area) leads the dropdown when it applies — LOUD-FAILURE keeps the dot on the row
    let status = null;
    if (vis.state === "dormant-blank" && vis.why === "out-of-area") status = { text: OUT_OF_AREA_LINE, tone: "var(--warn-text)" };
    else if (meta && vis.state !== "dormant-zoom" && ["failed", "slow", "empty", "unconfigured"].includes(combined.state)) status = { text: combined.msg || meta.label, tone: meta.color };
    else if (vis.state === "dormant-blank") status = { text: DORMANT_BLANK_LINE[vis.why] || DORMANT_BLANK_LINE["nothing-here"], tone: MUTED };
    else if (why && anyOn) status = { text: why, tone: MUTED };
    // an OFF row cannot carry a status line, so the reason it is listed (or demoted) is reachable in its ⓘ instead
    if (why && !anyOn) info = [{ text: why }, ...info];

    const hasPipelineLine = members.some(([mid]) => mid === "txrrc_pipe");
    const settings = [];
    if (id === "contours") settings.push("interval");
    if (hasPipelineLine && overlays.txrrc_pipe_easement) settings.push("corridor");
    if (members.some(([mid]) => mid === "mapillary")) settings.push("token");
    const lift = showAbove && members.some(([, c]) => configCanLift(c));
    const ramp = id === "elevation" ? rampGradient(cfg0) : null;
    const legend = ramp ? [] : legendFor(members, slot.kind === "merge" ? slot.mergeGroup : null);
    const zoomGated = vis.state === "dormant-zoom";
    const plan = dropdownPlan({ on: anyOn, zoomGated, canLift: lift, hasStatus: !!status, settings, hasLegend: legend.length > 0, hasRamp: !!ramp, hasInfo: info.some((s) => s && s.text) });
    const corr = overlays.txrrc_pipe_easement || {};
    const swatch = members.map(([, c]) => rowSwatch(c)).find(Boolean) || null;
    const dormant = isDormant(vis);
    return {
      id, label, value: id === "contours" ? contourRowValue(interval) : null, swatch, dormant, state: vis.state,
      checked: anyOn,
      onCheck: writeOn((v) => setAll({ on: v })),
      dot: {
        meta, loading: !!(combined && combined.state === "loading"), dormant: dormant && !hidden, hidden: hidden && anyOn,
        title: hidden && anyOn ? "On — hidden by Hide Layers" : dormant ? (vis.state === "dormant-zoom" ? "On — not showing at this zoom" : "On — nothing to show here") : (meta ? meta.label : ""),
      },
      dropdown: plan.length ? {
        plan, status, info,
        zoom: { onZoom: typeof onZoomTo === "function" && vis.target != null ? () => onZoomTo(vis.target) : null },
        /* NEW-2: a change to how the layer LOOKS on an OFF row turns it on at that setting (`wakeRow`; Hide Layers ends too). Only the first
         * tick of a drag is the off→on transition; the Contour Interval stays a standing preference and never calls it. */
        opacity: { value: opacity, onChange: (v) => { if (!anyOn) wakeRow(); setAll({ opacity: v }); } },
        interval: { value: interval, onChange: setContourInterval },
        corridor: { on: !!corr.on, widthFt: corr.widthFt ?? DEFAULT_CORRIDOR_WIDTH_FT, onToggle: (v) => { if (v && !anyOn) wakeRow(); set("txrrc_pipe_easement", { on: v }); }, onWidth: (w) => set("txrrc_pipe_easement", { widthFt: w }) },
        token: { value: tok, onChange: (v) => { setTok(v); setMapillaryToken(v.trim()); } },
        above: { checked: members.some(([mid]) => overlays[mid]?.above === true), onChange: (v) => { if (v && !anyOn) wakeRow(); setAll({ above: v }); } },
        ramp, legend,
      } : null,
    };
  };

  /* A group's rows with the relevance treatment applied. Show renders every row the same; Hide leaves out the unchecked rows whose
   * data does not reach this view (ordering / hiding only — never the map). No row is ever rendered faded (NEW-2). */
  const slotsOf = (entries) => buildGroupSlots(entries);
  const slotLowRel = (slot) => (slot.kind === "merge" ? slot.members.every(([id, cfg]) => lowRel(id, cfg)) : lowRel(slot.entry[0], slot.entry[1]));
  const slotAnyOn = (slot) => (slot.kind === "merge" ? mergeSlotAnyOn(slot.members, overlays) : !!overlays[slot.entry[0]]?.on);
  const rowFor = (slot, opts) => {
    const spec = slotSpec(slot, opts);
    return <LayerRow key={spec.id} spec={spec} open={openRow === spec.id} onToggleOpen={() => toggleOpen(spec.id)} />;
  };
  const shownSlots = (entries) => { const slots = slotsOf(entries); return mode === "hide" ? slots.filter((sl) => !slotLowRel(sl)) : slots; };
  const groupRows = (entries, render = (sl, o) => rowFor(sl, o)) => <>{shownSlots(entries).map((sl) => render(sl, {}))}</>;

  /* ── the groups ── */
  const foldEntry = jur && Object.keys(jur.layers || {}).length === 1 ? Object.entries(jur.layers)[0] : null;
  const entriesFor = (pg) => {
    if (pg === "flood") return floodEntries;
    let list = availableEntries(groupEntriesFor(ALL_LAYERS, pg), scope);
    if (pg === "topo" && foldEntry && layerAvailableForFold(foldEntry, scope)) {
      // B762: a single-layer county folds its ONE local layer into Topography right after the contour row
      const out = [];
      let placed = false;
      for (const e of list) { out.push(e); if (e[0] === "contours") { out.push(foldEntry); placed = true; } }
      if (!placed) out.push(foldEntry);
      list = out;
    }
    if (pg === "jur" && jur && Object.keys(jur.layers || {}).length >= 2) list = [...list, ...availableEntries(Object.entries(jur.layers), scope)];
    return list;
  };
  const layerGroups = PANEL_GROUPS.filter((g) => g.key !== "base");
  const slotCount = (pg) => slotsOf(entriesFor(pg)).filter(slotAnyOn).length;
  const baseCount = (placeNames && placeNames.value ? 1 : 0) + (cityNames && cityNames.value ? 1 : 0) + (yourData || []).filter((d) => d.value).length;
  const gradingOnCount = (gradingRows?.rows || []).filter((g) => g.on).length;
  const unlocated = !!gisNote;
  // A group with no rows left for this location is hidden from the left pane (Map Base always stays).
  const visibleGroups = unlocated
    ? [PANEL_GROUPS[0]]
    : PANEL_GROUPS.filter((g) => g.key === "base" || shownSlots(entriesFor(g.key)).length > 0 || (g.key === "topo" && (gradingRows?.rows || []).length > 0));
  const counts = { base: baseCount };
  for (const g of layerGroups) counts[g.key] = slotCount(g.key) + (g.key === "topo" ? gradingOnCount : 0);
  const selected = pickGroup(groupPref, visibleGroups.map((g) => g.key));
  const selectGroup = (k) => { setGroupPref(k); writeGroupPref(k); setOpenRow(null); };

  /* ── Map Base ── */
  const bmStatus = basemap && basemap.status ? STATUS[basemap.status] : null;
  const placeNamesDormant = !!placeNames && !!placeNames.value && typeof mapZoom === "number" && mapZoom < PLACE_NAMES_MIN_ZOOM;
  const roadNamesInfo = [{ text: "Road and highway names drawn OVER the aerial — the same labels the map finder shows; part of the base layer, not a separate overlay. It does not carry city, town or landmark names — those are the separate \"City Names\" row. Only visible once you're zoomed in past neighborhood scale. Fade it with Opacity, or turn it off for a clean picture of the ground." }];
  const cityNamesInfo = [{ text: "City and town names drawn over the map — the biggest cities first, smaller towns as you zoom in. They fade out as you reach parcel and site-plan zoom so nothing sits on your plan." }];
  const roadNamesSpec = placeNames && {
    id: "road_names", label: "Road Names", value: null, swatch: null, dormant: placeNamesDormant, state: placeNamesDormant ? "dormant-zoom" : (placeNames.value ? "drawing" : "off"),
    checked: !!placeNames.value, onCheck: writeOn(placeNames.onChange),
    // The same anatomy as every other row: a LIVE dot while the labels are drawing (green), hollow while the zoom gate holds them back.
    dot: { meta: placeNames.value && !placeNamesDormant ? STATUS.loaded : null, loading: false, dormant: placeNamesDormant, hidden: false, title: placeNamesDormant ? "On — not showing at this zoom" : (placeNames.value ? STATUS.loaded.label : "") },
    dropdown: (() => {
      const hasOpacity = typeof placeNames.opacity === "number" && typeof placeNames.onOpacityChange === "function";
      const plan = dropdownPlan({ on: !!placeNames.value, zoomGated: placeNamesDormant, canLift: false, hasStatus: false, settings: [], hasLegend: false, hasRamp: false, hasInfo: true }).filter((p) => p !== "opacity" || hasOpacity);
      return {
        plan, status: null, info: roadNamesInfo,
        zoom: { onZoom: typeof onZoomTo === "function" ? () => onZoomTo(PLACE_NAMES_MIN_ZOOM + GATE_CLEARANCE) : null },
        opacity: { value: placeNames.opacity, onChange: placeNames.onOpacityChange },
      };
    })(),
  };
  // City names live in zooms 3..13 (`placeNamesVisible`); the row reads hollow outside that band, like any zoom-gated row.
  const cityNamesDormant = !!cityNames && !!cityNames.value && typeof mapZoom === "number" && !placeNamesVisible(mapZoom);
  const cityNamesSpec = cityNames && {
    id: "city_names", label: "City Names", value: null, swatch: null, dormant: cityNamesDormant, state: cityNamesDormant ? "dormant-zoom" : (cityNames.value ? "drawing" : "off"),
    checked: !!cityNames.value, onCheck: writeOn(cityNames.onChange),
    dot: { meta: cityNames.value && !cityNamesDormant ? STATUS.loaded : null, loading: false, dormant: cityNamesDormant, hidden: false, title: cityNamesDormant ? "On — not showing at this zoom" : (cityNames.value ? STATUS.loaded.label : "") },
    dropdown: { plan: ["info"], status: null, info: cityNamesInfo },
  };

  const baseBody = (
    <>
      {basemap && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontWeight: 700, color: MUTED, marginBottom: 4 }}>Satellite Imagery Source</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <select aria-label="Satellite imagery source" data-testid="basemap-source" value={basemap.value}
              disabled={!!basemap.disabledReason} onChange={(e) => !basemap.disabledReason && basemap.onChange(e.target.value)}
              title={basemap.disabledReason || "Which aerial imagery draws under the plan."}
              style={{ ...fieldBase, flex: 1, minWidth: 0, padding: "4px 6px", cursor: basemap.disabledReason ? "default" : "pointer", opacity: basemap.disabledReason ? 0.5 : 1 }}>
              {(basemap.choices || []).map((c) => <option key={c.key} value={c.key} title={c.title}>{c.label}</option>)}
            </select>
            {bmStatus && !basemap.disabledReason && basemap.value !== "off" && (
              <span title={bmStatus.label} style={{ width: 8, height: 8, borderRadius: RADIUS.pill, flex: "none", background: bmStatus.color, animation: basemap.status === "loading" ? "pf-pulse 1.1s ease-in-out infinite" : "none" }} />
            )}
          </div>
          {basemap.disabledReason && <div style={{ color: MUTED, lineHeight: 1.4, marginTop: 3 }}>{basemap.disabledReason}</div>}
        </div>
      )}
      {(roadNamesSpec || cityNamesSpec) && !(basemap && basemap.disabledReason) && (
        <>
          <SectionHeading>Labels</SectionHeading>
          {roadNamesSpec && (!basemap || basemap.value !== "off") && <LayerRow spec={roadNamesSpec} open={openRow === "road_names"} onToggleOpen={() => toggleOpen("road_names")} />}
          {cityNamesSpec && <LayerRow spec={cityNamesSpec} open={openRow === "city_names"} onToggleOpen={() => toggleOpen("city_names")} />}
        </>
      )}
      {yourData && yourData.length > 0 && (
        <>
          <SectionHeading>Your Data</SectionHeading>
          {yourData.map((d) => <SimpleCheckRow key={d.id} id={`data_${d.id}`} testId={d.testId} label={`${d.label}${d.count ? ` (${d.count})` : ""}`} checked={!!d.value} onChange={d.onChange} />)}
        </>
      )}
      {unlocated && (
        <>
          <div style={{ color: MUTED, lineHeight: 1.45, marginTop: 4 }}>{gisNote}</div>
          {onSetLocation && (
            <button type="button" data-testid="layers-set-location" onClick={onSetLocation}
              style={{ marginTop: 6, width: "100%", padding: "5px 8px", fontSize: TEXT, fontWeight: 700, fontFamily: "inherit", border: "1px solid var(--accent)", borderRadius: RADIUS.sm, background: "var(--accent)", color: "var(--on-accent)", cursor: "pointer" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, justifyContent: "center" }}>
                <PinIcon size={11} /> Set this plan's location
              </span>
            </button>
          )}
        </>
      )}
    </>
  );

  /* ── Flood & Drainage (four quiet sub-headings) ── */
  const floodRowFor = (slot, opts) => {
    if (slot.kind === "merge") return rowFor(slot, opts);
    const [k, cfg] = slot.entry;
    const st = overlays[k];
    const ls = st && st.on ? layerStatus[k] : null;
    const gatedHere = visForMembers([slot.entry]).state === "dormant-zoom";
    const why = floodScope.notes[k] || (!gatedHere && st && st.on && ls && ls.state === "empty" ? emptyReason(cfg, { coverage: coverage[k] }) : null);
    return rowFor(slot, { ...opts, why });
  };
  const floodBody = (
    <>
      {floodScope.tiers.filter((t) => shownSlots(t.rows).length > 0).map((t) => (
        <div key={t.key} data-testid={`flood-tier-${t.key}`}>
          <SectionHeading title={t.note}>{t.label}</SectionHeading>
          {groupRows(t.rows, floodRowFor)}
        </div>
      ))}
    </>
  );

  const gradingBody = gradingRows && gradingRows.rows && gradingRows.rows.map((g) => {
    const spec = {
      id: `grading-${g.id}`, label: g.label, value: null, swatch: null, dormant: false, state: g.on ? "drawing" : "off",
      checked: !!g.on, onCheck: writeOn((v) => gradingRows.onToggle(g.id, v)),
      dot: { meta: null, loading: false, dormant: false, hidden: false, title: "" },
      dropdown: { plan: ["info"], status: null, info: [{ text: g.info }, ...(g.on && g.sub ? [{ text: g.sub }] : [])] },
    };
    return <LayerRow key={spec.id} spec={spec} open={openRow === spec.id} onToggleOpen={() => toggleOpen(spec.id)} />;
  });

  const bodyFor = (key) => {
    if (key === "base") return baseBody;
    if (key === "flood") return floodBody;
    return <>{groupRows(entriesFor(key))}{key === "topo" && gradingBody}</>;
  };

  /* ── header actions ── */
  const sweepIds = sweepableLayerIds(ALL_LAYERS).filter((id) => overlays[id]?.on);
  const clearAllLayers = () => setOverlays((o) => {
    const next = { ...o };
    for (const id of sweepIds) next[id] = { ...next[id], on: false };
    return next;
  });

  const title = onCollapse ? (
    <button type="button" onClick={onCollapse} aria-expanded="true" aria-label="Collapse Imagery & Layers" title="Collapse Imagery & Layers" data-testid="layers-collapse"
      style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0, background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: TEXT, color: INK, fontWeight: 700, padding: 0, textAlign: "left" }}>
      <span aria-hidden="true" style={{ fontSize: TEXT, lineHeight: 1 }}>▾</span>
      <span>Imagery &amp; Layers</span>
    </button>
  ) : <span style={{ flex: 1, fontWeight: 700 }}>Imagery &amp; Layers</span>;

  return (
    <div ref={rootRef} data-testid="layer-panel" data-surface={surface} data-narrow={narrow ? "1" : "0"} style={{ fontSize: TEXT, color: INK }}>
      <div data-testid="layers-header" style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 0 8px" }}>
        {title}
        <ToggleChip active={hidden} aria-pressed={hidden} data-testid="layers-hide-toggle" onClick={() => setLayersHidden(!hidden)}
          title={hidden ? "Put every layer you had on back on the map." : "Take every reference layer off the map for now — nothing is unchecked or forgotten."}
          style={{ fontSize: TEXT, padding: "3px 10px", flex: "none", whiteSpace: "nowrap" }}>
          {hidden ? "Show Layers" : "Hide Layers"}
        </ToggleChip>
        <IconButton ref={menuRef} size={26} aria-label="More layer options" aria-haspopup="menu" aria-expanded={menuOpen} data-testid="layers-more"
          onClick={() => setMenuOpen((o) => !o)} style={{ fontSize: TEXT }}>⋯</IconButton>
        <MoreMenu open={menuOpen} onClose={() => setMenuOpen(false)} anchorRef={menuRef} canClear={sweepIds.length > 0} onClear={clearAllLayers}
          mode={mode} onMode={setRelevanceMode} radius={radius} onRadius={setNearbyRadiusMiles} />
      </div>
      {narrow && visibleGroups.length > 1 && <GroupSelect groups={visibleGroups} counts={counts} selected={selected} onSelect={selectGroup} />}
      <div style={{ display: "flex", alignItems: "stretch" }}>
        {!narrow && visibleGroups.length > 1 && (
          <>
            <GroupNav groups={visibleGroups} counts={counts} selected={selected} onSelect={selectGroup} />
            {/* NEW-1: one hairline between the group list and the rows, the full height of the panes (the row stretches both). */}
            <div aria-hidden="true" data-testid="layer-pane-divider" style={{ width: 1, flex: "none", alignSelf: "stretch", background: LINE, margin: "0 8px" }} />
          </>
        )}
        <div role="tabpanel" data-testid="layer-pane" data-group={selected} style={{ flex: 1, minWidth: 0 }}>
          {selected && bodyFor(selected)}
        </div>
      </div>
    </div>
  );
}

/* A county's single folded layer is subject to the same location gate as any other row. */
function layerAvailableForFold(entry, scope) { return availableEntries([entry], scope).length > 0; }
