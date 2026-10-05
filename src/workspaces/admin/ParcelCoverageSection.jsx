/* Parcel coverage map (NEW-1) — every US county / parish / borough Planyr can answer a parcel click
 * for, filled by WHERE its parcels come from. Owner-only (rendered inside AdminApp, which AdminGate
 * only mounts for a confirmed admin).
 *
 * ONE SOURCE OF TRUTH: nothing here is a list. The wired set is computed at render from the live
 * registry (counties.js) by lib/parcelCoverage.js; the outlines come from the same nationwide asset
 * the planner resolves counties with (public/geo/county-polygons.json), fetched lazily here — this
 * file lives in the lazy admin chunk, so the asset never rides the planner bundle. Registry entries
 * that join to no outline are listed under the map, never dropped.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildCoverage, totalLine, SOURCE_KINDS, SOURCE_KIND_LABEL } from "./lib/parcelCoverage.js";
import { buildCountyPaths } from "./lib/countyMapGeometry.js";
import { PARCEL_COVERAGE_SECTION } from "./lib/adminSections.js";
import { RADIUS } from "../../shared/ui/radius.js";
import { FONT_SIZE } from "../../shared/ui/designTokens.js";
import { IconButton } from "../../shared/ui/controls.jsx";
import AdminPanel from "./AdminPanel.jsx";

const KIND_FILL = {
  own: "var(--status-active)",
  statewide: "var(--accent-schedule)",
  "third-party": "var(--status-onhold)",
  unclassified: "var(--status-complete)",
};
const MIN_ZOOM = 1, MAX_ZOOM = 40;

/* The registry is imported DYNAMICALLY, on purpose: a static import from this lazy chunk makes the
 * bundler hoist counties.js (and the jurisdiction/appraisal/localDb modules it drags) into their own
 * shared chunks, which then load on a plain Site route and breach the Site-route allowlist. A dynamic
 * import leaves the registry in the chunk the planner already ships it in. */
async function loadRegistry() {
  const [c, poly, prov] = await Promise.all([
    import("../site-planner/lib/counties.js"),
    import("../site-planner/lib/countyPolygons.js"),
    import("../site-planner/lib/countiesProvenance.js"),
  ]);
  return {
    setCountyPolygons: poly.setCountyPolygons,
    registry: {
      countiesMap: c.COUNTIES_MAP, counties: c.COUNTIES, keyForName: c.countyKeyForName,
      statewideKeysForState: c.statewideKeysForState, isStatewideUrl: c.isStatewideLayerUrl,
      verification: prov.COUNTY_VERIFICATION,
    },
  };
}

async function fetchPayload() {
  const base = (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.BASE_URL) || "/";
  const res = await fetch(`${base}geo/county-polygons.json`.replace(/([^:])\/\/+/g, "$1/"));
  if (!res.ok) throw new Error(`county outlines unavailable (HTTP ${res.status})`);
  return res.json();
}

/* One memoised layer of county shapes: re-renders only when the data does, never on a pan/zoom or a
 * hover (those change the parent's transform / readout, not these props). */
const CountyShapes = memo(function CountyShapes({ rows, paths }) {
  return (
    <g>
      {rows.map((r, i) => (
        paths[i] ? (
          <path
            key={r.fips || i}
            d={paths[i]}
            data-i={i}
            data-wired={r.wired ? "1" : "0"}
            data-kind={r.kind || ""}
            style={{
              fill: r.wired ? KIND_FILL[r.kind] : "none",
              fillOpacity: r.kind === "unclassified" ? 0.55 : 0.85,
              stroke: "var(--border-strong)",
              strokeWidth: 0.4,
              vectorEffect: "non-scaling-stroke",
              pointerEvents: "all",
            }}
          />
        ) : null
      ))}
    </g>
  );
});

function readoutOf(r) {
  if (!r) return "Hover or tap a county.";
  if (!r.wired) return `${r.displayName} — not wired for parcels.`;
  return `${r.displayName} — ${SOURCE_KIND_LABEL[r.kind]}${r.host ? ` · reads from ${r.host}` : ""}`;
}

export default function ParcelCoverageSection({ loadPayload = fetchPayload }) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const [hover, setHover] = useState(null);
  const [picked, setPicked] = useState(null);
  const svgRef = useRef(null);
  const drag = useRef(null);
  const pointers = useRef(new Map());

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [payload, { setCountyPolygons, registry }] = await Promise.all([loadPayload(), loadRegistry()]);
        // The registry's Texas tier is derived from this same roster, so it must be resident first.
        await setCountyPolygons(payload);
        const coverage = buildCoverage(payload.counties, registry);
        const geo = buildCountyPaths(payload);
        if (live) setState({ loading: false, error: null, data: { coverage, geo } });
      } catch (err) {
        if (typeof console !== "undefined") console.error("[ParcelCoverageSection]", err);
        if (live) setState({ loading: false, error: (err && err.message) || String(err), data: null });
      }
    })();
    return () => { live = false; };
  }, [loadPayload]);

  const data = state.data;
  const W = data ? data.geo.width : 960, H = data ? data.geo.height : 600;

  const clampView = useCallback((k, x, y) => {
    const kk = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));
    return { k: kk, x: Math.min(0, Math.max(W - W * kk, x)), y: Math.min(0, Math.max(H - H * kk, y)) };
  }, [W, H]);

  const zoomAt = useCallback((factor, cx, cy) => {
    setView((v) => {
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.k * factor));
      const f = k / v.k;
      return clampView(k, cx - (cx - v.x) * f, cy - (cy - v.y) * f);
    });
  }, [clampView]);

  const toBox = useCallback((e) => {
    const r = svgRef.current.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H, r.width / W];
  }, [W, H]);

  // Wheel zoom needs a non-passive listener so the page does not scroll under the map.
  useEffect(() => {
    const el = svgRef.current;
    if (!el || !data) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const [cx, cy] = toBox(e);
      zoomAt(Math.exp(-e.deltaY * 0.0015), cx, cy);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [data, toBox, zoomAt]);

  const onPointerDown = (e) => {
    pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
    drag.current = { x: e.clientX, y: e.clientY, moved: 0, pinch: null, target: e.target }; // target read BEFORE capture retargets later events to the svg
    try { svgRef.current.setPointerCapture(e.pointerId); } catch { /* capture is a nicety */ }
  };
  const onPointerMove = (e) => {
    const rowAt = (t) => (t && t.dataset && t.dataset.i != null ? data.coverage.rows[+t.dataset.i] : null);
    if (!pointers.current.has(e.pointerId)) { if (e.pointerType === "mouse") setHover(rowAt(e.target)); return; }
    pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const d = drag.current;
      if (d.pinch) {
        const r = svgRef.current.getBoundingClientRect();
        zoomAt(dist / d.pinch, (((a[0] + b[0]) / 2 - r.left) / r.width) * W, (((a[1] + b[1]) / 2 - r.top) / r.height) * H);
      }
      d.pinch = dist; d.moved = 99;
      return;
    }
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    d.moved += Math.abs(dx) + Math.abs(dy);
    d.x = e.clientX; d.y = e.clientY;
    if (d.moved > 4) {
      const scale = svgRef.current.getBoundingClientRect().width / W;
      setView((v) => clampView(v.k, v.x + dx / scale, v.y + dy / scale));
    }
  };
  const onPointerUp = (e) => {
    const d = drag.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) {
      // A press that never moved is a tap: select what is under it (this is how a phone reads a county).
      if (d && d.moved <= 4) {
        const t = d.target;
        setPicked(t && t.dataset && t.dataset.i != null ? data.coverage.rows[+t.dataset.i] : null);
      }
      drag.current = null;
    } else if (d) d.pinch = null;
  };

  const shown = hover || picked;
  const summary = useMemo(() => (data ? totalLine(data.coverage.totals) : ""), [data]);

  return (
    <AdminPanel id="parcel-coverage" title={PARCEL_COVERAGE_SECTION.title} blurb={PARCEL_COVERAGE_SECTION.blurb}>
      <div data-testid="parcel-coverage-section" style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      {state.loading && <div style={{ fontSize: FONT_SIZE.control, color: "var(--text-tertiary)" }}>Loading county outlines…</div>}
      {state.error && (
        <div role="alert" style={{ fontSize: FONT_SIZE.control, color: "var(--danger-text)" }}>
          Could not draw the map: {state.error}
        </div>
      )}
      {data && (
        <>
          <div data-testid="parcel-coverage-total" style={{ fontSize: FONT_SIZE.emphasis, fontWeight: 600, color: "var(--text-primary)" }}>
            {summary}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", fontSize: FONT_SIZE.control, color: "var(--text-secondary)" }}>
            {SOURCE_KINDS.map((k) => (
              <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: RADIUS.sm, background: KIND_FILL[k], opacity: k === "unclassified" ? 0.55 : 0.85, display: "inline-block" }} />
                {SOURCE_KIND_LABEL[k]}
              </span>
            ))}
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: RADIUS.sm, border: "1px solid var(--border-strong)", display: "inline-block" }} />
              Not wired
            </span>
          </div>
          <div
            data-testid="parcel-coverage-readout"
            aria-live="polite"
            style={{ minHeight: 18, fontSize: FONT_SIZE.control, fontWeight: 600, color: "var(--text-primary)" }}
          >
            {readoutOf(shown)}
          </div>
          <div style={{ position: "relative", border: "1px solid var(--border-default)", borderRadius: RADIUS.md, overflow: "hidden", background: "var(--surface-page)" }}>
            <svg
              ref={svgRef}
              data-testid="parcel-coverage-map"
              viewBox={`0 0 ${W} ${H}`}
              role="img"
              aria-label="Map of US counties wired to a parcel source"
              style={{ display: "block", width: "100%", height: "auto", touchAction: "none", cursor: "grab" }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onPointerLeave={() => setHover(null)}
            >
              <g data-testid="parcel-coverage-viewport" transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
                <CountyShapes rows={data.coverage.rows} paths={data.geo.paths} />
              </g>
            </svg>
            <div style={{ position: "absolute", top: 8, right: 8, display: "flex", flexDirection: "column", gap: 4 }}>
              <IconButton aria-label="Zoom in" onClick={() => zoomAt(1.6, W / 2, H / 2)}>+</IconButton>
              <IconButton aria-label="Zoom out" onClick={() => zoomAt(1 / 1.6, W / 2, H / 2)}>−</IconButton>
              <IconButton aria-label="Reset map view" onClick={() => setView({ k: 1, x: 0, y: 0 })}>⟲</IconButton>
            </div>
          </div>
          {(data.coverage.notDrawn.length > 0 || data.coverage.ambiguous.length > 0) && (
            <div data-testid="parcel-coverage-notdrawn" style={{ fontSize: FONT_SIZE.control, color: "var(--warn-text)" }}>
              {data.coverage.notDrawn.length > 0 && (
                <div>{data.coverage.notDrawn.length} wired entries not drawn: {data.coverage.notDrawn.join(", ")}</div>
              )}
              {data.coverage.ambiguous.length > 0 && (
                <div>Registry keys claimed by more than one outline: {data.coverage.ambiguous.map((a) => a.key).join(", ")}</div>
              )}
            </div>
          )}
        </>
      )}
    </div>
    </AdminPanel>
  );
}
