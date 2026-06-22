import React, { useEffect, useRef, useState } from "react";
import { runSiteAnalysis } from "../lib/siteAnalysis.js";
import { formatAge } from "../lib/gisCache.js";

/* Site Analysis panel (B147) — environmental / regulatory / infrastructure screening
 * of the active-parcel footprint, presented presence-first and grouped by category.
 *
 * Honest-state UI: every finding reads as PRESENT (a constraint is there), NONE FOUND
 * (verified clear), UNKNOWN (source unavailable / unverified — NOT "none"), or INFO
 * (jurisdiction/zoning facts). Each carries its own source + data-age + caveat — no
 * single blanket disclaimer. Reuses the shared analysis engine (lib/siteAnalysis.js).
 *
 * Props:
 *   rings        — active-parcel outer rings as [[ [lng,lat], ... ], ...] (EPSG:4326)
 *   acres        — total active-parcel acreage (number) for the header
 *   parcelCount  — number of active parcels screened
 *   PAL          — the planner palette (passed so the panel matches the app chrome)
 *   chip         — the shared chip button style
 *   isLayerOn    — (layerId) => bool: is the shared GIS overlay currently shown? (B190)
 *   onToggleLayer— (layerId, wantOn) => void: toggle that overlay on the planner map (B190)
 *   layerStatus  — shared per-overlay sync status map (id → {state}); for an honest
 *                  "service not responding" hint when a just-enabled layer fails (B190)
 *   runAnalysis  — injectable for tests (defaults to the real runSiteAnalysis)
 */

const STATUS = {
  present: { dot: "#c2410c", bg: "#fbeae0", border: "#f0cdb8", label: "Present", glyph: "⚑" },
  absent: { dot: "#15803d", bg: "#e8f5ec", border: "#c4e7cf", label: "None found", glyph: "✓" },
  // UNAVAILABLE — a retryable source failure (e.g. a transient 503). Amber + a Retry
  // control; visually + semantically DISTINCT from "None found" (green). Never read as clear.
  unavailable: { dot: "#b45309", bg: "#fbf0df", border: "#eccfa0", label: "Unavailable", glyph: "↻" },
  unknown: { dot: "#a16207", bg: "#fbf3df", border: "#ecdcae", label: "Unknown", glyph: "⚠" },
  info: { dot: "#1d4ed8", bg: "#e8eefb", border: "#cdd9f3", label: "Info", glyph: "ℹ" },
  pending: { dot: "#8a8473", bg: "#f1efe9", border: "#e0dacb", label: "Not connected", glyph: "○" },
};

export default function SiteAnalysis({ rings, acres, parcelCount, PAL, chip, isLayerOn, onToggleLayer, layerStatus = {}, runAnalysis = runSiteAnalysis }) {
  const [state, setState] = useState({ loading: false, findings: null, error: null, empty: !rings || !rings.length, at: null });
  const [open, setOpen] = useState({});
  const reqRef = useRef(0);

  const sig = rings ? rings.length + ":" + rings.reduce((n, r) => n + r.length, 0) + ":" + JSON.stringify(rings[0]?.[0] || null) : "";

  const run = () => {
    if (!rings || !rings.length) { setState({ loading: false, findings: null, error: null, empty: true, at: null }); return; }
    const tok = ++reqRef.current;
    setState((s) => ({ ...s, loading: true, error: null, empty: false }));
    runAnalysis(rings)
      .then((r) => { if (tok === reqRef.current) setState({ loading: false, findings: r.findings, error: null, empty: !!r.empty, at: r.generatedAt }); })
      .catch((e) => { if (tok === reqRef.current) setState({ loading: false, findings: null, error: String(e?.message || e), empty: false, at: null }); });
  };

  // Run automatically when the screened parcel set changes (keyed by `sig`).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { run(); }, [sig]);

  const muted = PAL?.muted || "#8a8473";
  const ink = PAL?.ink || "#2c2a26";
  const line = PAL?.panelLine || "#e7e2d6";

  if (state.empty) {
    return (
      <div style={{ fontSize: 12, color: muted, lineHeight: 1.6 }}>
        Mark at least one parcel <b>active</b> to screen it. Site Analysis runs against the
        combined footprint of the active parcels — the same parcels that drive yield and coverage.
      </div>
    );
  }

  const findings = state.findings || [];
  const presentCount = findings.filter((f) => f.status === "present").length;

  return (
    <div style={{ fontSize: 12 }}>
      {/* header / context */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
        <div style={{ color: muted, lineHeight: 1.4 }}>
          Screening <b style={{ color: ink }}>{parcelCount}</b> active parcel{parcelCount === 1 ? "" : "s"}
          {acres != null && <> · <b style={{ color: ink }}>{acres.toFixed(2)} ac</b></>}
        </div>
        <button style={{ ...chip, padding: "3px 9px", fontSize: 11 }} onClick={run} disabled={state.loading} title="Re-run the screen (refreshes from the GIS sources)">
          {state.loading ? "Screening…" : "↻ Refresh"}
        </button>
      </div>

      {presentCount > 0 && !state.loading && (
        <div style={{ marginBottom: 8, padding: "6px 9px", borderRadius: 7, background: STATUS.present.bg, border: `1px solid ${STATUS.present.border}`, color: "#9a3412", fontWeight: 600 }}>
          ⚑ {presentCount} constraint{presentCount === 1 ? "" : "s"} present — review below.
        </div>
      )}

      {state.error && (
        <div style={{ marginBottom: 8, padding: "6px 9px", borderRadius: 7, background: STATUS.unknown.bg, border: `1px solid ${STATUS.unknown.border}`, color: "#92400e" }}>
          Couldn't run the screen: {state.error}
        </div>
      )}

      {state.loading && !findings.length && (
        <div style={{ color: muted, padding: "10px 0" }}>Querying GIS sources…</div>
      )}

      {/* findings, grouped + presence-first */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {findings.map((f) => {
          const st = STATUS[f.status] || STATUS.unknown;
          const isOpen = open[f.id];
          const hasDetail = (f.detail && f.detail.length) || (f.rows && f.rows.length) || f.caveat || f.sourceName;
          const toggle = () => hasDetail && setOpen((o) => ({ ...o, [f.id]: !o[f.id] }));
          // "Show on map" (B190): only for a category whose query RESOLVED (present/absent)
          // AND that maps to a drawable shared overlay. UNKNOWN / failed / no-source
          // categories have nothing to draw — no blank toggle; their error stays surfaced.
          const canMap = !!f.mapLayer && !!onToggleLayer && (f.status === "present" || f.status === "absent");
          const layerOn = canMap && !!isLayerOn && isLayerOn(f.mapLayer);
          const mapFailed = layerOn && layerStatus?.[f.mapLayer]?.state === "failed";
          return (
            <div key={f.id} style={{ border: `1px solid ${st.border}`, borderRadius: 8, background: st.bg, overflow: "hidden" }}>
              <div
                role={hasDetail ? "button" : undefined} tabIndex={hasDetail ? 0 : undefined}
                onClick={toggle}
                onKeyDown={(e) => { if (hasDetail && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); toggle(); } }}
                style={{ width: "100%", textAlign: "left", cursor: hasDetail ? "pointer" : "default", padding: "8px 10px", fontFamily: "inherit", display: "flex", gap: 8, alignItems: "flex-start" }}>
                <span style={{ color: st.dot, fontSize: 13, lineHeight: 1.3, flex: "none" }}>{st.glyph}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontWeight: 700, color: ink }}>{f.category}</span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flex: "none" }}>
                      {/* Retry just this source — a transient outage usually clears on a re-try.
                          Re-runs the screen (cached-fresh sources return instantly; the failed
                          one re-fetches with backoff). */}
                      {(f.status === "unavailable" || f.stale) && !state.loading && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); run(); }}
                          title="Retry this source"
                          style={{ cursor: "pointer", fontFamily: "inherit", fontSize: 10, fontWeight: 700, letterSpacing: "0.02em", padding: "2px 7px", borderRadius: 999, whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 3, border: `1px solid ${st.dot}`, background: "transparent", color: st.dot }}>
                          ↻ Retry
                        </button>
                      )}
                      {canMap && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onToggleLayer(f.mapLayer, !layerOn); }}
                          title={layerOn ? "Hide this layer on the map" : "Show this layer on the map (frames to the site)"}
                          style={{ cursor: "pointer", fontFamily: "inherit", fontSize: 10, fontWeight: 700, letterSpacing: "0.02em", padding: "2px 7px", borderRadius: 999, whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 3, border: `1px solid ${layerOn ? "#1d4ed8" : line}`, background: layerOn ? "#1d4ed8" : "transparent", color: layerOn ? "#fff" : muted }}>
                          {layerOn ? "◉ On map" : "◍ Map"}
                        </button>
                      )}
                      <span style={{ fontSize: 10, fontWeight: 700, color: st.dot, textTransform: "uppercase", letterSpacing: "0.05em" }}>{st.label}</span>
                    </span>
                  </span>
                  {/* primary line: presence summary, info rows, or honest unknown reason */}
                  {f.rows && f.rows.length ? (
                    <span style={{ display: "block", marginTop: 2 }}>
                      {f.rows.map(([k, v, age], i) => (
                        <span key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, color: ink }}>
                          <span style={{ color: muted }}>{k}</span>
                          <span style={{ fontWeight: 600, textAlign: "right" }}>{v}{age != null && <span style={{ color: muted, fontWeight: 400 }}> · {formatAge(age)}</span>}</span>
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span style={{ display: "block", marginTop: 2, color: ink }}>
                      {f.summary || (f.status === "unavailable" ? (f.error || "Source temporarily unavailable — not a clear result.") : f.status === "unknown" ? (f.error || "Source unverified — treat as unknown, not clear.") : f.status === "pending" ? "Source not yet connected." : "—")}
                      {f.ageMs != null && f.summary && <span style={{ color: muted }}> · {formatAge(f.ageMs)}</span>}
                    </span>
                  )}
                  {/* Stale-while-revalidate (B367): the refresh failed but a last-good copy
                      survived — show it with its age + an honest "couldn't refresh", never blank. */}
                  {f.stale && f.refreshError && (
                    <span style={{ display: "block", marginTop: 3, color: "var(--warn-text)", fontSize: 10.5, lineHeight: 1.4 }}>
                      ⟳ Showing the last good result{f.ageMs != null ? ` (as of ${formatAge(f.ageMs)})` : ""} — couldn't refresh: {f.refreshError}
                    </span>
                  )}
                  {f.straddle && <span style={{ display: "block", marginTop: 2, color: "var(--warn-text)", fontWeight: 600 }}>⚑ Straddles a boundary — touches multiple jurisdictions.</span>}
                  {mapFailed && <span style={{ display: "block", marginTop: 3, color: "var(--warn-text)", fontSize: 10.5, lineHeight: 1.4 }}>⚠ This layer's map service isn't responding right now — the screen result above still stands; try the map again shortly.</span>}
                </span>
                {hasDetail && <span style={{ color: muted, flex: "none", fontSize: 10 }}>{isOpen ? "▾" : "▸"}</span>}
              </div>

              {isOpen && hasDetail && (
                <div style={{ padding: "0 10px 9px 30px", fontSize: 11, color: ink }}>
                  {f.detail && f.detail.length > 0 && (
                    <ul style={{ margin: "2px 0 6px", paddingLeft: 16, lineHeight: 1.5 }}>
                      {f.detail.map((d, i) => <li key={i}>{d}</li>)}
                    </ul>
                  )}
                  {f.sourceName && <div style={{ color: muted, marginTop: 2 }}>Source: {f.sourceName}{f.ageMs != null && ` · updated ${formatAge(f.ageMs)} ago`}</div>}
                  {f.caveat && <div style={{ color: "var(--warn-text)", marginTop: 4, fontStyle: "italic", lineHeight: 1.45 }}>{f.caveat}</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${line}`, fontSize: 10.5, color: muted, lineHeight: 1.5 }}>
        Screening only — desktop GIS sources, not a survey or a legal determination. Each finding carries its own source, age, and caveat (tap to expand). Tap <b style={{ color: "var(--info-text)" }}>◍ Map</b> on a finding to see that layer on the map, framed to the site. An <b>unknown</b> is never an all-clear.
      </div>
    </div>
  );
}
