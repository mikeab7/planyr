import React, { useEffect, useMemo, useRef, useState } from "react";
import { runSiteScreen } from "../lib/siteScreen.js";
import { freshnessOf } from "../lib/siteChecks.js";
import { ringsHash } from "../lib/siteChecksRun.js";
import { pillsFor, pillOn, togglePill, PILLS_NOTE } from "../lib/siteLayerPills.js";
import { ALL_LAYERS } from "../lib/layers.js";
import { ToggleChip } from "../../../shared/ui/controls.jsx";
import { RADIUS } from "../../../shared/ui/radius.js";
import { FONT_SIZE } from "../../../shared/ui/designTokens.js";

/* Site Analysis panel (B147 → redesigned NEW-1, 2026-10-05) — VERDICTS ONLY WHERE THE DATA IS TRUSTWORTHY.
 *
 * Top to bottom: header · "Who governs this site" · "Checked for you" · "Show on the map" · "Calls to
 * make" · footer. A verdict (colour, amount, "None") appears ONLY in "Checked for you", and only for a
 * check whose source we trust at the site's location (lib/siteChecks.js `TRUSTED_CHECKS`). Everything
 * else is a layer pill: no verdict, no distance, no green tick.
 *
 * Severity is by LOCATION, not presence. Red / amber / green appear only as the thin left bar and the
 * figure colour — the rows are not filled cards. A source that errors is "Couldn't check" with a Retry
 * — never blank, never "None", never green.
 *
 * The panel owns NO layer state: pills AND rows read and write the SAME overlay keys the Layers panel does (via
 * `isLayerOn` / `onToggleLayer`). Clicking a "Checked for you" row turns its layer on and keeps it on (it persists like
 * any layer toggle) and opens the row's detail; clicking again turns it off and closes the detail. There is no hover
 * behaviour anywhere: nothing is highlighted, dimmed or shown until a click. A row with nothing to draw (None, or
 * "Couldn't check") opens its detail and says so — it never silently does nothing.
 *
 * Props:
 *   rings, holes   — active-parcel outer rings + save-and-except holes, [[ [lng,lat], … ]] (EPSG:4326)
 *   acres, parcelCount
 *   isLayerOn(id) / onToggleLayer(id, wantOn) / layerStatus / layerZoomNote(id)
 *   callsChecked / onToggleCall(id, checked) — the persisted ticks (per site); local fallback when absent
 *   onOpenDrainage — the "Open in Drainage →" link
 *   onFindings(findings) — the legacy wetlands status the buildability card reads
 *   runAnalysis — injectable (defaults to runSiteScreen)
 */

const SEV = {
  red: { bar: "var(--danger)", ink: "var(--danger-text)" },
  amber: { bar: "var(--warn-text)", ink: "var(--warn-text)" },
  green: { bar: "var(--success-text)", ink: "var(--success-text)" },
  failed: { bar: "var(--border-strong)", ink: "var(--text-secondary)" },
};

/* One spacing step between rows, a larger step between sections — measured off the other docked left-rail panels in the
 * running app (Land: 14 between sections / 10 between rows; Yield: 12 / 7; Standards: 10), not a new scale. */
const GAP_ROW = 7;
const GAP_SECTION = 14;

const sectionLabel = {
  fontSize: FONT_SIZE.micro, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
  color: "var(--text-secondary)",
};
const linkBtn = {
  border: "none", background: "transparent", padding: 0, cursor: "pointer", fontFamily: "inherit",
  fontSize: FONT_SIZE.label, fontWeight: 650, color: "var(--accent-site-text)", textDecoration: "underline",
};

export default function SiteAnalysis({
  rings, holes = [], acres, parcelCount, isLayerOn, onToggleLayer, layerStatus = {}, layerZoomNote = null,
  callsChecked = null, onToggleCall = null, onOpenDrainage = null, onFindings = null,
  runAnalysis = runSiteScreen, layers = ALL_LAYERS,
}) {
  const [state, setState] = useState({ loading: false, result: null, error: null, empty: !rings || !rings.length });
  const [openIds, setOpenIds] = useState({});   // detail open per row id (several rows can be on at once)
  const [retrying, setRetrying] = useState({});
  const [localCalls, setLocalCalls] = useState({});
  const reqRef = useRef(0);

  // Every coordinate of every ring and hole — a moved vertex must re-screen (the stored answers are keyed the same way).
  const sig = rings && rings.length ? ringsHash(rings, holes) : "";

  const run = (force = false) => {
    if (!rings || !rings.length) { ++reqRef.current; setState({ loading: false, result: null, error: null, empty: true }); return; }
    const tok = ++reqRef.current;
    setState((s) => ({ ...s, loading: true, error: null, empty: false }));
    Promise.resolve(runAnalysis(rings, { holes, force }))
      .then((r) => { if (tok !== reqRef.current) return; setState({ loading: false, result: r, error: null, empty: !!r.empty }); })
      .catch((e) => { if (tok === reqRef.current) setState({ loading: false, result: null, error: String(e?.message || e), empty: false }); });
  };

  /* Retry ONE trusted row: re-ask just that check (bypassing its stored measurement) and merge it back. */
  const retry = (id) => {
    const tok = reqRef.current;
    setRetrying((m) => ({ ...m, [id]: true }));
    Promise.resolve(runAnalysis(rings, { holes, force: true, only: [id] }))
      .then((r) => {
        if (tok !== reqRef.current) return;
        setState((s) => {
          if (!s.result) return s;
          const byId = new Map((r.rows || []).map((x) => [x.id, x]));
          const rows = s.result.rows.map((x) => byId.get(x.id) || x);
          return { ...s, result: { ...s.result, rows, findings: r.findings && r.findings.length ? r.findings : s.result.findings } };
        });
      })
      .catch(() => { /* the row keeps its "Couldn't check" state — a failed retry is the same honest answer */ })
      .finally(() => setRetrying((m) => ({ ...m, [id]: false })));
  };

  // Run automatically when the screened parcel set changes (keyed by `sig`).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { run(false); }, [sig]);

  const result = state.result;
  // The legacy wetlands status is lifted from an EFFECT, never from inside a state updater (a side effect there can
  // run twice or during render).
  useEffect(() => { if (result && onFindings) { try { onFindings(result.findings || []); } catch (_) { /* a listener error must not break the panel */ } } }, [result]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => result?.rows || [], [result]);
  const fresh = useMemo(() => freshnessOf(rows), [rows]);
  const pills = useMemo(() => (result && !result.partial ? pillsFor({ regions: result.regions || [], untrusted: result.untrusted || [], layers }) : []), [result, layers]);

  if (state.empty) {
    return (
      <div style={{ fontSize: FONT_SIZE.control, color: "var(--text-secondary)", lineHeight: 1.6 }}>
        Mark at least one parcel <b>active</b> to screen it. Site Analysis runs against the
        combined footprint of the active parcels — the same parcels that drive yield and coverage.
      </div>
    );
  }

  const layerOn = (k) => !!(isLayerOn && isLayerOn(k));
  // A row draws only when it has something to show: a "None" row (nothing near the site) and a failed row do not.
  const drawable = (r) => !!r.layer && r.severity !== "failed" && r.severity !== "green";
  // Why a layer that is ON may still show nothing right now (zoomed out past its gate, or its map service down).
  const layerNote = (k) => {
    if (!layerOn(k)) return null;
    const note = layerZoomNote ? layerZoomNote(k) : null;
    return note || (layerStatus?.[k]?.state === "failed" ? "This layer's map service isn't responding right now — try again shortly." : null);
  };
  const toggleRow = (r) => {
    if (!drawable(r)) { setOpenIds((m) => ({ ...m, [r.id]: !m[r.id] })); return; }
    const want = !layerOn(r.layer);
    if (onToggleLayer) onToggleLayer(r.layer, want);
    // Rows that share one layer (100-/500-year both ride FEMA) go on and off together: closing one closes both.
    setOpenIds((m) => { const n = { ...m }; rows.forEach((x) => { if (x.layer === r.layer) delete n[x.id]; }); if (want) n[r.id] = true; return n; });
  };
  const calls = result?.calls || [];
  const ticked = callsChecked || localCalls;
  const tick = (id) => {
    const next = !ticked[id];
    if (onToggleCall) onToggleCall(id, next); else setLocalCalls((m) => ({ ...m, [id]: next }));
  };
  const governs = result?.governs;

  return (
    <div data-site-analysis="1" style={{ fontSize: FONT_SIZE.control, color: "var(--text-primary)", display: "flex", flexDirection: "column", gap: GAP_SECTION }}>
      {/* header: what was screened + ONE freshness line */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <div style={{ lineHeight: 1.4 }}>
          <b>{parcelCount}</b> parcel{parcelCount === 1 ? "" : "s"}{acres != null && <> · <b>{acres.toFixed(2)} AC</b></>}
          <div data-analysis-freshness="1" style={{ color: "var(--text-secondary)", fontSize: FONT_SIZE.label }}>
            {state.loading ? "Checking the maps…" : fresh.line || (rows.length && rows.every((r) => r.severity === "failed") ? "Couldn't check the maps" : result ? "Checked just now" : "")}
          </div>
        </div>
        <button type="button" style={linkBtn} onClick={() => run(true)} disabled={state.loading} title="Re-check from the map sources">
          {state.loading ? "Checking…" : "↻ Refresh"}
        </button>
      </div>

      {state.error && (
        <div style={{ padding: "2px 0 2px 9px", borderLeft: "3px solid var(--warn-text)", color: "var(--warn-text)" }}>
          Couldn't run the screen. Try Refresh in a moment.
        </div>
      )}

      {/* ── Who governs this site ─────────────────────────────────────────────────────────── */}
      {governs && (
        <div data-section="governs" style={{ border: "1px solid var(--border-default)", borderRadius: RADIUS.md, padding: "10px 12px", display: "flex", flexDirection: "column", gap: GAP_ROW }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={sectionLabel}>Who governs this site</span>
            {governs.lineLayers && governs.lineLayers.length > 0 && (() => {
              const linesOn = governs.lineLayers.some((k) => layerOn(k));
              return (
                <button type="button" data-governs-lines="1" aria-pressed={linesOn} style={linkBtn}
                  onClick={() => governs.lineLayers.forEach((k) => onToggleLayer && onToggleLayer(k, !linesOn))}>
                  {linesOn ? "Hide lines" : "Show lines"}
                </button>
              );
            })()}
          </div>
          {/* The label column is only as wide as its longest label (max-content), so the values get the room. */}
          <div data-governs-grid="1" style={{ display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr)", columnGap: 12, rowGap: GAP_ROW, alignItems: "baseline" }}>
            <FactRow label="County" value={governs.county || "—"} />
            <FactRow label="City" value={governs.city.text} note={governs.city.note}
              chip={governs.city.straddles ? "straddles" : null} />
            <FactRow label="School district" value={governs.school || "—"} />
            <FactRow label="Roads" value={governs.roads.text}>
              {governs.roads.kind === "mixed" && (
                <ul data-roads-list="1" style={{ margin: "3px 0 0", padding: 0, listStyle: "none", color: "var(--text-secondary)", fontSize: FONT_SIZE.label, lineHeight: 1.45 }}>
                  {(governs.roads.listed || governs.roads.items).map((it, i) => (
                    <li key={i} data-road-row="1">{it.name} · {it.authority}</li>
                  ))}
                  {governs.roads.more > 0 && <li data-roads-more="1">+{governs.roads.more} more</li>}
                </ul>
              )}
            </FactRow>
          </div>
        </div>
      )}

      {/* ── Checked for you ───────────────────────────────────────────────────────────────── */}
      <div data-section="checked" style={{ opacity: state.loading && rows.length ? 0.5 : 1 }}>
        <div style={{ ...sectionLabel, marginBottom: GAP_ROW }}>Checked for you</div>
        {state.loading && !rows.length && <div style={{ color: "var(--text-secondary)", padding: "6px 0" }}>Checking the maps…</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: GAP_ROW }}>
          {rows.map((r) => {
            const sev = SEV[r.severity] || SEV.failed;
            const draws = drawable(r);
            const onMap = draws && layerOn(r.layer);
            const open = !!openIds[r.id] && (!draws || onMap);   // a drawn row's detail lives exactly as long as its layer is on
            const toggle = () => toggleRow(r);
            return (
              <div key={r.id} data-check-row={r.id} data-severity={r.severity} data-on-map={onMap ? "1" : undefined}
                style={{ borderLeft: `3px solid ${sev.bar}`, padding: "6px 0 6px 10px" }}>
                <div role="button" tabIndex={0} aria-expanded={open} aria-pressed={draws ? onMap : undefined}
                  onClick={toggle} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } }}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, cursor: "pointer" }}>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ fontWeight: 700 }}>{r.label}</span>
                    {onMap && <span data-on-map-tag="1" style={{ marginLeft: 6, padding: "1px 7px", borderRadius: RADIUS.pill, border: "1px solid var(--accent-site-text)", color: "var(--accent-site-text)", fontSize: FONT_SIZE.micro, fontWeight: 700, whiteSpace: "nowrap" }}>On map</span>}
                    <span data-check-line="1" style={{ display: "block", color: "var(--text-secondary)", fontSize: FONT_SIZE.label }}>
                      {r.line}{fresh.stale[r.id] ? ` · checked ${fresh.stale[r.id]}` : ""}
                    </span>
                  </span>
                  <span data-check-figure="1" style={{ color: sev.ink, fontWeight: 700, whiteSpace: "nowrap", textAlign: "right" }}>
                    {r.severity === "failed" ? "Couldn't check" : r.figure}
                  </span>
                </div>
                {r.severity === "failed" && (
                  <button type="button" data-check-retry={r.id} style={{ ...linkBtn, marginTop: 3 }} disabled={!!retrying[r.id]}
                    onClick={(e) => { e.stopPropagation(); retry(r.id); }}>
                    {retrying[r.id] ? "Retrying…" : "↻ Retry"}
                  </button>
                )}
                {open && !draws && (
                  <div data-check-expanded={r.id} data-check-nodraw="1" style={{ marginTop: 6, fontSize: FONT_SIZE.label, lineHeight: 1.5 }}>
                    {r.severity === "failed"
                      ? "Nothing to show on the map yet — this check couldn't run. Use Retry."
                      : "Nothing to show on the map — this check found none near the site, so no layer was turned on."}
                  </div>
                )}
                {open && draws && (
                  <div data-check-expanded={r.id} style={{ marginTop: 6, fontSize: FONT_SIZE.label, lineHeight: 1.5 }}>
                    {(r.sentences || []).map((s, i) => <div key={i}>{s}</div>)}
                    {layerNote(r.layer) && <div data-analysis-zoom-note={r.layer} style={{ color: "var(--warn-text)" }}>{layerNote(r.layer)}</div>}
                    {r.link && r.link.id === "drainage" && onOpenDrainage && (
                      <button type="button" style={{ ...linkBtn, marginTop: 3 }} onClick={onOpenDrainage}>{r.link.label}</button>
                    )}
                    {(r.source || r.caveat) && (
                      <div style={{ color: "var(--text-secondary)", marginTop: 4 }}>
                        {r.source ? `Source: ${r.source}. ` : ""}{r.caveat}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Show on the map ───────────────────────────────────────────────────────────────── */}
      {pills.length > 0 && (
        <div data-section="pills">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
            <span style={sectionLabel}>Show on the map</span>
            <span style={{ fontSize: FONT_SIZE.label, color: "var(--text-secondary)" }}>check these yourself</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {pills.map((p) => {
              const on = pillOn(p, (k) => !!(isLayerOn && isLayerOn(k)));
              return (
                <ToggleChip key={p.id} data-layer-pill={p.id} aria-pressed={on} active={on}
                  onClick={() => togglePill(p, (k) => !!(isLayerOn && isLayerOn(k)), (k, want) => onToggleLayer && onToggleLayer(k, want))}>
                  {p.label}
                </ToggleChip>
              );
            })}
          </div>
          <div style={{ marginTop: 6, fontSize: FONT_SIZE.label, color: "var(--text-secondary)", lineHeight: 1.45 }}>{PILLS_NOTE}</div>
          {pills.flatMap((p) => p.layers).filter((k, i, a) => a.indexOf(k) === i).map((k) => {
            const note = isLayerOn && isLayerOn(k) && layerZoomNote ? layerZoomNote(k) : null;
            const failed = isLayerOn && isLayerOn(k) && layerStatus?.[k]?.state === "failed";
            return (note || failed) ? (
              <div key={k} data-analysis-zoom-note={k} style={{ marginTop: 3, color: "var(--warn-text)", fontSize: FONT_SIZE.label, lineHeight: 1.4 }}>
                {note || "This layer's map service isn't responding right now — try again shortly."}
              </div>
            ) : null;
          })}
        </div>
      )}

      {/* ── Calls to make ─────────────────────────────────────────────────────────────────── */}
      {calls.length > 0 && (
        <div data-section="calls">
          <div style={{ ...sectionLabel, marginBottom: 4 }}>Calls to make</div>
          {calls.map((c) => (
            <label key={c.id} data-call={c.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", cursor: "pointer" }}>
              <input type="checkbox" checked={!!ticked[c.id]} onChange={() => tick(c.id)} />
              <span style={{ textDecoration: ticked[c.id] ? "line-through" : "none", color: ticked[c.id] ? "var(--text-secondary)" : "var(--text-primary)" }}>{c.label}</span>
            </label>
          ))}
        </div>
      )}

      <div style={{ borderTop: "1px solid var(--border-default)", paddingTop: 8, fontSize: FONT_SIZE.label, color: "var(--text-secondary)" }}>
        Screening data. Verify before relying on it.
      </div>
    </div>
  );
}

function FactRow({ label, value, note = null, chip = null, children = null }) {
  return (
    <>
      <span data-fact-label="1" style={{ color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{label}</span>
      <span style={{ minWidth: 0 }}>
        {/* each " · " part stays whole, so "1 state, 5 county" never breaks across two lines */}
        <span style={{ fontWeight: 600 }}>{String(value).split(" · ").map((seg, i) => <React.Fragment key={i}>{i > 0 && " · "}<span style={{ display: "inline-block" }}>{seg}</span></React.Fragment>)}</span>
        {chip && (
          <span data-governs-chip={chip} style={{ marginLeft: 6, padding: "1px 7px", borderRadius: RADIUS.pill, border: "1px solid var(--warn-border)", background: "var(--warn-bg)", color: "var(--warn-text)", fontSize: FONT_SIZE.micro, fontWeight: 700 }}>{chip}</span>
        )}
        {note && <span data-fact-note="1" title={note} style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", color: "var(--text-secondary)", fontSize: FONT_SIZE.label }}>{note}</span>}
        {children}
      </span>
    </>
  );
}
