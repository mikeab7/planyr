/* Parcel coverage map (NEW-1) — every US county / parish / borough Planyr can answer a parcel click
 * for, filled by WHERE its parcels come from. Owner-only (rendered inside AdminApp, which AdminGate only
 * mounts for a confirmed admin).
 *
 * ONE SOURCE OF TRUTH: nothing here is a list. The wired set is computed at render from the live
 * registry (counties.js) by lib/parcelCoverage.js; the outlines come from the same nationwide asset
 * the planner resolves counties with (public/geo/county-polygons.json), fetched lazily here — this
 * file lives in the lazy admin chunk, so the asset never rides the planner bundle. City-level sources
 * (Detroit, Sioux Falls, Kansas City, Independence) are placed on the county they sit in; anything that
 * still cannot be placed goes to the console, never the page.
 *
 * INTERACTION (lib/coverageMapInteraction.js): a plain wheel / two-finger scroll over the map scrolls the PAGE;
 * the map zooms with Ctrl/Cmd + wheel (a pinch), the +/− buttons or a touch pinch. Hover shows a tooltip at the
 * cursor; a click or tap (a press that does not travel) opens the county's details card; a drag pans.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { buildCoverage, countyDetail, openRequestsFor, totalLine, SOURCE_KINDS, SOURCE_KIND_LABEL } from "./lib/parcelCoverage.js";
import { buildCountyPaths } from "./lib/countyMapGeometry.js";
import { PARCEL_COVERAGE_SECTION } from "./lib/adminSections.js";
import { isTap, mapHeightCap, placeNear, wheelIntent, wheelZoomFactor, zoomKeyWord } from "./lib/coverageMapInteraction.js";
import { RADIUS } from "../../shared/ui/radius.js";
import { FONT_SIZE } from "../../shared/ui/designTokens.js";
import { Button, IconButton } from "../../shared/ui/controls.jsx";
import AdminPanel, { Chip } from "./AdminPanel.jsx";
import { useAdminData } from "./AdminData.jsx";

const KIND_FILL = {
  own: "var(--status-active)",
  statewide: "var(--accent-schedule)",
  "third-party": "var(--status-onhold)",
  unclassified: "var(--status-complete)",
};
const KIND_TONE = { own: "ok", statewide: "info", "third-party": "warn", unclassified: "neutral" };
const FAMILY_LABEL = { detention: "Detention", easement: "Easement", pond: "Pond", floodplain: "Floodplain" };
const CITY_ONLY_OPACITY = 0.38;
const MIN_ZOOM = 1, MAX_ZOOM = 40;
let wheelHintShown = false; // "Use Ctrl + scroll to zoom" is shown the first time only, per page visit

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
      verification: prov.COUNTY_VERIFICATION, cityScopes: c.CITY_SCOPE_COUNTIES,
    },
  };
}

async function fetchPayload() {
  const base = (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.BASE_URL) || "/";
  const res = await fetch(`${base}geo/county-polygons.json`.replace(/([^:])\/\/+/g, "$1/"));
  if (!res.ok) throw new Error(`county outlines unavailable (HTTP ${res.status})`);
  return res.json();
}

/* A client point -> the map's own (viewBox) coordinates, plus screen px per unit. Uses the SVG's own transform so
 * a letterboxed map (height capped below its natural height) still maps exactly. */
function clientToBox(svg, W, H, clientX, clientY) {
  const m = svg.getScreenCTM && svg.getScreenCTM();
  if (m && m.a) {
    const inv = m.inverse();
    return [inv.a * clientX + inv.c * clientY + inv.e, inv.b * clientX + inv.d * clientY + inv.f, m.a];
  }
  const r = svg.getBoundingClientRect();
  const s = Math.min(r.width / W, r.height / H) || 1;
  return [(clientX - r.left - (r.width - W * s) / 2) / s, (clientY - r.top - (r.height - H * s) / 2) / s, s];
}

function scrollParentOf(el) {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if (o === "auto" || o === "scroll") return p;
  }
  return null;
}

/* One memoised layer of county shapes: re-renders only when the data does, never on a pan/zoom or a
 * hover (those change the parent's transform / tooltip, not these props). */
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
            data-city={r.cityOnly ? "1" : "0"}
            data-kind={r.kind || ""}
            style={{
              fill: r.wired ? KIND_FILL[r.kind] : r.cityOnly ? KIND_FILL[r.cityKind] : "none",
              fillOpacity: r.cityOnly ? CITY_ONLY_OPACITY : r.kind === "unclassified" ? 0.55 : 0.85,
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

const kindWordOf = (r) => (r.wired ? SOURCE_KIND_LABEL[r.kind] : r.cityOnly ? "City-level parcels only" : "Not wired");

const DT = { fontSize: FONT_SIZE.label, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--text-secondary)" };
const DD = { margin: 0, fontSize: FONT_SIZE.control, color: "var(--text-primary)", minWidth: 0, overflowWrap: "anywhere" };

function Fact({ label, children }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "104px 1fr", gap: 8, alignItems: "baseline" }}>
      <dt style={DT}>{label}</dt>
      <dd style={DD}>{children}</dd>
    </div>
  );
}

/* Copy-to-clipboard link: a failure is SAID, never swallowed (LOUD-FAILURE). */
function CopyUrl({ url }) {
  const [state, setState] = useState("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch (err) {
      if (typeof console !== "undefined") console.error("[ParcelCoverageSection] copy failed", err);
      setState("failed");
    }
    setTimeout(() => setState("idle"), 1800);
  };
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
      <code data-testid="parcel-coverage-card-url" style={{ fontFamily: "monospace", fontSize: FONT_SIZE.label, wordBreak: "break-all" }}>{url}</code>
      <Button variant="ghost" size="sm" onClick={copy} aria-label="Copy layer URL">
        {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy URL"}
      </Button>
    </span>
  );
}

/* The details card for one county. Module scope (MODULE-SCOPE-COMPONENTS). */
function CountyCard({ detail, requests, kind, onClose, cardRef }) {
  const tone = detail.wired ? KIND_TONE[kind] || "neutral" : "warn";
  return (
    <div
      ref={cardRef}
      role="region"
      aria-label={`${detail.title} parcel source`}
      data-testid="parcel-coverage-card"
      style={{
        position: "absolute", left: 0, top: 0, zIndex: 3, boxSizing: "border-box",
        width: "min(340px, calc(100% - 16px))", maxHeight: "calc(100% - 16px)", overflowY: "auto",
        padding: 12, background: "var(--surface-raised)", border: "1px solid var(--border-default)",
        borderRadius: RADIUS.lg, boxShadow: "var(--modal-shadow)", display: "flex", flexDirection: "column", gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div data-testid="parcel-coverage-card-title" style={{ fontSize: FONT_SIZE.display, fontWeight: 700, color: "var(--text-primary)", overflowWrap: "anywhere" }}>{detail.title}</div>
          <div style={{ marginTop: 4 }}><Chip tone={tone}>{detail.kindWord}</Chip></div>
        </div>
        <IconButton size={26} aria-label="Close details" onClick={onClose}>✕</IconButton>
      </div>

      {!detail.wired && detail.cityParcels.length === 0 && (
        <div style={{ fontSize: FONT_SIZE.control, color: "var(--text-secondary)" }}>No parcel source is wired for this county.</div>
      )}

      {detail.wired && (
        <dl style={{ margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {detail.publisherName && <Fact label="Source">{detail.publisherName}</Fact>}
          {detail.host && <Fact label="Host">{detail.host}</Fact>}
          {detail.registryKey && <Fact label="Registry key"><code style={{ fontFamily: "monospace" }}>{detail.registryKey}</code></Fact>}
          {detail.layerUrl && <Fact label="Layer URL"><CopyUrl url={detail.layerUrl} /></Fact>}
          {detail.verifiedOn && <Fact label="Last verified">{detail.verifiedOn}</Fact>}
          {detail.fields.map(([label, v]) => <Fact key={label} label={label}><code style={{ fontFamily: "monospace" }}>{v}</code></Fact>)}
        </dl>
      )}

      {detail.cityParcels.map((c) => (
        <div key={c.key} data-testid="parcel-coverage-card-city" style={{ borderTop: "1px solid var(--border-default)", paddingTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: FONT_SIZE.emphasis, fontWeight: 700, color: "var(--text-primary)" }}>City of {c.cityName} parcels available</div>
          <dl style={{ margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            <Fact label="Coverage">{c.kindWord} · inside the city limits only</Fact>
            {c.publisherName && <Fact label="Source">{c.publisherName}</Fact>}
            {c.host && <Fact label="Host">{c.host}</Fact>}
            <Fact label="Registry key"><code style={{ fontFamily: "monospace" }}>{c.registryKey}</code></Fact>
            {c.layerUrl && <Fact label="Layer URL"><CopyUrl url={c.layerUrl} /></Fact>}
          </dl>
        </div>
      ))}

      {requests.length > 0 && (
        <div data-testid="parcel-coverage-card-requests" style={{ fontSize: FONT_SIZE.control, color: "var(--text-primary)", borderTop: "1px solid var(--border-default)", paddingTop: 8 }}>
          Open request in County requests: {requests.map((q) => `${FAMILY_LABEL[q.family] || q.family} (${q.request_count})`).join(", ")}.{" "}
          <a href="#/admin/criteria" style={{ color: "var(--accent-text, var(--text-primary))", fontWeight: 700 }}>View requests</a>
        </div>
      )}

      {detail.verifiedNote && (
        <details style={{ fontSize: FONT_SIZE.control, color: "var(--text-secondary)" }}>
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>Verification note</summary>
          <p style={{ margin: "6px 0 0", overflowWrap: "anywhere" }}>{detail.verifiedNote}</p>
        </details>
      )}
    </div>
  );
}

export default function ParcelCoverageSection({ loadPayload = fetchPayload }) {
  const adminData = useAdminData();
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const [panning, setPanning] = useState(false); // a pan drag is live → grabbing
  const [hover, setHover] = useState(null);   // county index under the cursor
  const [picked, setPicked] = useState(null); // { idx, x, y } — the clicked county and where the click landed
  const [hint, setHint] = useState(false);
  const [cap, setCap] = useState(null);       // tallest the map may be (px), so it fits under what sits above it
  const svgRef = useRef(null);
  const frameRef = useRef(null);
  const sectionRef = useRef(null);
  const tipRef = useRef(null);
  const cardRef = useRef(null);
  const lastPt = useRef(null);
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
        // Developer diagnostics go to the console, never the page.
        if (coverage.unplaced.length && typeof console !== "undefined") console.warn(`[ParcelCoverageSection] ${coverage.unplaced.length} wired registry entries have no county outline: ${coverage.unplaced.join(", ")}`);
        if (coverage.ambiguous.length && typeof console !== "undefined") console.warn(`[ParcelCoverageSection] registry keys claimed by more than one outline: ${coverage.ambiguous.map((a) => a.key).join(", ")}`);
        if (live) setState({ loading: false, error: null, data: { coverage, geo, registry } });
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

  const toBox = useCallback((clientX, clientY) => clientToBox(svgRef.current, W, H, clientX, clientY), [W, H]);

  // The map must fit under what sits above it (header, summary, legend): cap its height to the scroller's visible
  // height minus the map's natural offset, so on a laptop the whole map is in view at once.
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return undefined;
    const sc = scrollParentOf(frame);
    const measure = () => {
      const scTop = sc ? sc.getBoundingClientRect().top : 0;
      const scrolled = sc ? sc.scrollTop : window.scrollY;
      const offsetTop = frame.getBoundingClientRect().top - scTop + scrolled;
      const next = mapHeightCap({ visibleHeight: sc ? sc.clientHeight : window.innerHeight, offsetTop });
      setCap((c) => (c === next ? c : next));
    };
    measure();
    window.addEventListener("resize", measure);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (ro) { if (sc) ro.observe(sc); if (sectionRef.current) ro.observe(sectionRef.current); }
    return () => { window.removeEventListener("resize", measure); if (ro) ro.disconnect(); };
  }, [data]);

  // Wheel: a plain wheel / two-finger scroll is the PAGE's (we do not touch it); Ctrl/Cmd + wheel (and a trackpad
  // pinch, which arrives as a ctrl-wheel) zooms the map. The listener is non-passive only so the zoom can
  // preventDefault the browser's own page zoom.
  useEffect(() => {
    const el = svgRef.current;
    if (!el || !data) return undefined;
    let timer = null;
    const onWheel = (e) => {
      if (wheelIntent(e) === "scroll") {
        if (!wheelHintShown) {
          wheelHintShown = true;
          setHint(true);
          timer = setTimeout(() => setHint(false), 2400);
        }
        return;
      }
      e.preventDefault();
      const [cx, cy] = toBox(e.clientX, e.clientY);
      zoomAt(wheelZoomFactor(e), cx, cy);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => { el.removeEventListener("wheel", onWheel); if (timer) clearTimeout(timer); };
  }, [data, toBox, zoomAt]);

  // Esc closes the details card.
  useEffect(() => {
    if (!picked) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setPicked(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picked]);

  const relPoint = (e) => {
    const r = frameRef.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
  };

  const placeTip = useCallback(() => {
    const tip = tipRef.current, pt = lastPt.current;
    if (!tip || !pt) return;
    const p = placeNear({ x: pt.x, y: pt.y }, { w: tip.offsetWidth, h: tip.offsetHeight }, { w: pt.w, h: pt.h }, 14, 4);
    tip.style.transform = `translate(${p.x}px, ${p.y}px)`;
  }, []);
  useLayoutEffect(() => { placeTip(); }, [hover, placeTip]);

  // Keep the card on screen: placed next to the click, flipped/clamped inside the map frame, before paint.
  useLayoutEffect(() => {
    const card = cardRef.current, frame = frameRef.current;
    if (!picked || !card || !frame) return;
    const p = placeNear({ x: picked.x, y: picked.y }, { w: card.offsetWidth, h: card.offsetHeight }, { w: frame.clientWidth, h: frame.clientHeight });
    card.style.left = `${p.x}px`;
    card.style.top = `${p.y}px`;
  }, [picked, data]);

  const rowOf = (t) => (t && t.dataset && t.dataset.i != null ? +t.dataset.i : null);

  const onPointerDown = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
    // The target is read now; pointer capture is taken only once the press turns into a drag, so a plain click keeps
    // its own target and is never swallowed by the pan handler.
    drag.current = { x: e.clientX, y: e.clientY, moved: 0, pinch: null, target: e.target, captured: false };
    setHover(null);
  };
  const onPointerMove = (e) => {
    if (!pointers.current.has(e.pointerId)) {
      if (e.pointerType === "mouse") {
        lastPt.current = relPoint(e);
        const idx = rowOf(e.target);
        setHover((h) => (h === idx ? h : idx));
        placeTip();
      }
      return;
    }
    pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const d = drag.current;
      if (d.pinch) {
        const [cx, cy] = toBox((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
        zoomAt(dist / d.pinch, cx, cy);
      }
      d.pinch = dist; d.moved = 99;
      return;
    }
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    d.moved += Math.abs(dx) + Math.abs(dy);
    d.x = e.clientX; d.y = e.clientY;
    if (!isTap(d.moved)) {
      if (!d.captured) {
        d.captured = true;
        setPanning(true);
        try { svgRef.current.setPointerCapture(e.pointerId); } catch { /* capture is a nicety */ }
      }
      const scale = toBox(0, 0)[2];
      setView((v) => clampView(v.k, v.x + dx / scale, v.y + dy / scale));
    }
  };
  const onPointerUp = (e) => {
    const d = drag.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) {
      // A press that never travelled is a click/tap: open the county under it (this is how a phone reads a county).
      if (d && isTap(d.moved)) {
        const idx = rowOf(d.target);
        if (idx != null) {
          const p = relPoint(e);
          setPicked({ idx, x: p.x, y: p.y });
        }
      }
      drag.current = null;
      setPanning(false);
    } else if (d) d.pinch = null;
  };
  const onPointerCancel = (e) => { // the browser took the gesture (e.g. a touch scroll): never a tap
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) { drag.current = null; setPanning(false); }
  };

  const rows = data ? data.coverage.rows : null;
  const summary = useMemo(() => (data ? totalLine(data.coverage.totals) : ""), [data]);
  const hoverRow = rows && hover != null ? rows[hover] : null;
  const pickedRow = rows && picked ? rows[picked.idx] : null;
  const detail = useMemo(() => (pickedRow ? countyDetail(pickedRow, data.registry) : null), [pickedRow, data]);
  const requests = useMemo(() => (pickedRow ? openRequestsFor(pickedRow, adminData?.criteria?.rows) : []), [pickedRow, adminData]);
  const keyWord = zoomKeyWord(typeof navigator !== "undefined" ? navigator.platform : "");

  return (
    <AdminPanel id="parcel-coverage" title={PARCEL_COVERAGE_SECTION.title} blurb={PARCEL_COVERAGE_SECTION.blurb}>
      <div ref={sectionRef} data-testid="parcel-coverage-section" style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
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
            {data.coverage.totals.cityOnly > 0 && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: RADIUS.sm, background: KIND_FILL.own, opacity: CITY_ONLY_OPACITY, border: "1px solid var(--border-strong)", display: "inline-block" }} />
                City-level only
              </span>
            )}
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: RADIUS.sm, border: "1px solid var(--border-strong)", display: "inline-block" }} />
              Not wired
            </span>
          </div>
          <div ref={frameRef} data-testid="parcel-coverage-frame" style={{ position: "relative", border: "1px solid var(--border-default)", borderRadius: RADIUS.md, overflow: "hidden", background: "var(--surface-page)" }}>
            <svg
              ref={svgRef}
              data-testid="parcel-coverage-map"
              viewBox={`0 0 ${W} ${H}`}
              role="img"
              aria-label="Map of US counties wired to a parcel source"
              style={{ display: "block", width: "100%", height: "auto", maxHeight: cap || undefined, touchAction: view.k > 1 ? "none" : "pan-y", cursor: panning ? "grabbing" : hover != null ? "pointer" : view.k > 1 ? "grab" : "default" }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerCancel}
              onPointerLeave={() => setHover(null)}
            >
              <g data-testid="parcel-coverage-viewport" transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
                <CountyShapes rows={data.coverage.rows} paths={data.geo.paths} />
                {pickedRow && data.geo.paths[picked.idx] && (
                  <path d={data.geo.paths[picked.idx]} data-testid="parcel-coverage-selected" style={{ fill: "none", stroke: "var(--text-primary)", strokeWidth: 1.8, vectorEffect: "non-scaling-stroke", pointerEvents: "none" }} />
                )}
              </g>
            </svg>
            <div style={{ position: "absolute", top: 8, right: 8, display: "flex", flexDirection: "column", gap: 4 }}>
              <IconButton aria-label="Zoom in" onClick={() => zoomAt(1.6, W / 2, H / 2)}>+</IconButton>
              <IconButton aria-label="Zoom out" onClick={() => zoomAt(1 / 1.6, W / 2, H / 2)}>−</IconButton>
              <IconButton aria-label="Reset map view" onClick={() => setView({ k: 1, x: 0, y: 0 })}>⟲</IconButton>
            </div>
            {hint && (
              <div role="status" data-testid="parcel-coverage-hint" style={{ position: "absolute", left: "50%", top: 12, transform: "translateX(-50%)", zIndex: 4, pointerEvents: "none", padding: "6px 12px", borderRadius: RADIUS.pill, background: "var(--chrome-bg)", color: "var(--chrome-text)", fontSize: FONT_SIZE.control, fontWeight: 600, whiteSpace: "nowrap" }}>
                Use {keyWord} + scroll to zoom
              </div>
            )}
            {hoverRow && !(picked && picked.idx === hover) && (
              <div ref={tipRef} role="tooltip" data-testid="parcel-coverage-tooltip" style={{ position: "absolute", left: 0, top: 0, zIndex: 2, pointerEvents: "none", maxWidth: 260, padding: "5px 9px", borderRadius: RADIUS.md, background: "var(--chrome-bg)", color: "var(--chrome-text)", fontSize: FONT_SIZE.control, boxShadow: "var(--shadow-popover, 0 4px 14px var(--border-strong))" }}>
                <div style={{ fontWeight: 700 }}>{hoverRow.displayName}</div>
                <div>{kindWordOf(hoverRow)}</div>
              </div>
            )}
            {detail && <CountyCard cardRef={cardRef} detail={detail} requests={requests} kind={pickedRow.kind} onClose={() => setPicked(null)} />}
          </div>
        </>
      )}
    </div>
    </AdminPanel>
  );
}
