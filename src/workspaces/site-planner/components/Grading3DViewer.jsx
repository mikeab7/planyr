/* Grading3DViewer — the full-screen 3D cut-and-fill viewer (owner-only grading layer; NEW-1, 2026-11-11, from the owner-approved mockups:
 * Option A "ghost the existing ground" as the default view, plus Option B's "slice" as a toggle).
 *
 * ⛔ THIS FILE IS A LAZY CHUNK. SitePlanner.jsx reaches it only through `lazy(() => import("./components/Grading3DViewer.jsx"))`, and it (through
 * lib/grading3d/threeScene.js) is the only code that loads three.js. The Grading panel's button and SitePlanner's mount carry no three.js.
 *
 * WHAT THE OWNER SEES: a black void with ONE thing in it — the parcel as a solid block of ground, trimmed at the property line, its top the PROPOSED
 * surface coloured by cut / fill in the 2D bands' own palette, its sides banded earth down to a flat base. The existing ground floats over it as a
 * wire (bright where it is above the finished grade). Buildings stay flat, outlined with a dashed line. Bottom bar: Height stretch · Existing ground ·
 * Slice · Reset view. Close top right; Esc closes. Closing returns to the planner exactly as it was: this component writes NOTHING to the plan and
 * swallows every key (so Delete cannot reach the planner) while it is open.
 *
 * LIVE WITH THE PLAN: `grid` is the planner's own `gradeSurface.grid`; when grading recalculates, the new surface arrives here as a new object and the
 * model is rebuilt (chunked, off the critical path) while the OLD model stays on screen — the land is never animated — and the shared "Regrading…"
 * banner (lib/regradeProgress.js) shows. Heavy work is `runChunked` slices (NO-PER-MOVE-WORK; B2319137): no long task, no perfcap row.
 *
 * COMPASS (B2671226): the top-left column under the legend; the heading and the ground "N" are lib/grading3d/compass.js (tests: repo-root `test/` **grading3dCompass**).
 * Pure parts: lib/grading3d/{field,meshBuild,orbit,buildModel,colors}.js (tests: repo-root `test/` **grading3dMesh**, **grading3dReal**). */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createViewerScene, liveStats } from "../lib/grading3d/threeScene.js";
import { buildModelSteps } from "../lib/grading3d/buildModel.js";
import { runChunked } from "../lib/runChunked.js";
import * as regrade from "../lib/regradeProgress.js";
import RegradeBanner from "./RegradeBanner.jsx";
import { FloatingToolbar, FloatingToolButton, FloatingToolLabel, FloatingToolDivider } from "../../../shared/ui/controls.jsx";
import { reportClientEvent } from "../../../shared/telemetry/clientErrors.js";
import { isDiagArmed } from "../lib/diagArm.js";
import { VOID_HEX, NEUTRAL_RGB, OUTLINE_RGB } from "../lib/grading3d/colors.js";
import { cardinalHeadings, headingToOffset } from "../lib/grading3d/compass.js";
import { DEFAULT_AZ } from "../lib/grading3d/orbit.js";
import { CUT_RGB, FILL_RGB } from "../lib/gradingPaint.js";
import { SPACE } from "../../../shared/ui/designTokens.js";

export const STRETCHES = [1, 2, 3, 5];
export const DEFAULT_STRETCH = 3;
const inkOf = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;   // design-exempt: the legend swatches ARE the model's own cut / fill / ground colours (lib/grading3d/colors.js), which do not theme

function CloseGlyph() {
  return <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false"><path d="M3 3l8 8M11 3l-8 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
}
const Swatch = ({ rgb }) => <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 2, background: inkOf(rgb), display: "inline-block", flex: "none" }} />;   // design-exempt: 2 = a 10px legend chip, the same chip the 2D legend draws

/* The COMPASS (B2671226): N bold, E / S / W small, turning live with the camera so N always sits where north is on the model as seen (compass.js has the
 * heading). Updated imperatively — the scene calls `apiRef.current(az)` on every drawn frame; React never re-renders for an orbit. */
const COMPASS_HALO = "rgb(24,26,32)"; // design-exempt: the pill's own dark (the shared FloatingToolbar's skin), as a halo so a letter stays legible where it crosses the needle
const ROSE_R = 31;                       // radius of the letter ring in the 100-unit viewBox
const LETTERS = ["N", "E", "S", "W"];
function Compass({ apiRef }) {
  const rootRef = useRef(null);
  const needleRef = useRef(null);
  const letterRefs = useRef({});
  useLayoutEffect(() => {
    const apply = (az) => {
      const hs = cardinalHeadings(az);
      if (rootRef.current) { rootRef.current.setAttribute("data-heading", hs.N.toFixed(2)); rootRef.current.setAttribute("data-az", String(az)); }
      if (needleRef.current) needleRef.current.setAttribute("transform", `rotate(${hs.N.toFixed(2)} 50 50)`);
      for (const L of LETTERS) {
        const node = letterRefs.current[L]; if (!node) continue;
        const o = headingToOffset(hs[L], ROSE_R);
        node.setAttribute("x", (50 + o.x).toFixed(2)); node.setAttribute("y", (50 + o.y).toFixed(2));
      }
    };
    apiRef.current = apply; apply(DEFAULT_AZ);
    return () => { apiRef.current = null; };
  }, [apiRef]);
  return (
    <FloatingToolbar data-testid="grading-3d-compass-card" style={{ padding: SPACE.xs }}>
      <FloatingToolLabel style={{ padding: 0 }}>
        <svg ref={rootRef} data-testid="grading-3d-compass" role="img" aria-label="Compass: north" width="84" height="84" viewBox="0 0 100 100" focusable="false" style={{ display: "block" }}>
          <circle cx="50" cy="50" r="47" fill="none" stroke="currentColor" strokeOpacity="0.28" strokeWidth="1.5" />
          <g ref={needleRef} data-testid="grading-3d-compass-needle">
            <path d="M50 17 L56 50 L44 50 Z" fill="currentColor" />
            <path d="M44 50 L56 50 L50 83 Z" fill="currentColor" fillOpacity="0.28" />
          </g>
          {LETTERS.map((L) => (
            <text key={L} ref={(n) => { letterRefs.current[L] = n; }} data-testid={`grading-3d-compass-${L}`} x="50" y="50" textAnchor="middle" dominantBaseline="central"
              fill="currentColor" fillOpacity={L === "N" ? 1 : 0.7} fontFamily="inherit"
              fontWeight={L === "N" ? 800 : 500} fontSize={L === "N" ? 20 : 12} /* design-exempt: SVG glyph sizes in the compass's own 100-unit viewBox (N bold, the others small) */
              stroke={COMPASS_HALO} strokeWidth="3" paintOrder="stroke"
            >{L}</text>
          ))}
        </svg>
      </FloatingToolLabel>
    </FloatingToolbar>
  );
}

export default function Grading3DViewer({ grid, existAt, parcelRings, els, onClose }) {
  const hostRef = useRef(null);
  const sceneRef = useRef(null);
  const modelRef = useRef(null);
  const inRef = useRef({ grid, existAt, parcelRings, els }); inRef.current = { grid, existAt, parcelRings, els };
  const seq = useRef(0);
  const compassApi = useRef(null);
  const [stretch, setStretch] = useState(DEFAULT_STRETCH);
  const [ghost, setGhost] = useState(true);
  const [slice, setSlice] = useState(false);
  const [phase, setPhase] = useState("starting");   // starting | building | ready | empty | failed | nogl
  const [failure, setFailure] = useState("");
  const phaseRef = useRef("starting"); phaseRef.current = phase;
  const noGl = useRef(false);   // set the moment the scene cannot be made — read by the build effect in the SAME commit (phaseRef only updates on the next render)
  const uiRef = useRef({ stretch, ghost, slice }); uiRef.current = { stretch, ghost, slice };

  // ---- the scene: made once on mount, released on unmount ----
  useEffect(() => {
    const host = hostRef.current;
    let scene = null;
    try {
      scene = createViewerScene(host, { onCamera: (az) => { if (compassApi.current) compassApi.current(az); } });
    } catch (e) {
      reportClientEvent("grading-3d-failed", String((e && e.message) || e), { stage: "webgl" });
      noGl.current = true;
      setFailure("3D isn't available in this browser."); setPhase("nogl");
      return undefined;
    }
    sceneRef.current = scene;
    scene.setStretch(uiRef.current.stretch);
    const armed = isDiagArmed();
    if (armed) window.__grading3d = { state: () => scene.state(), drive: (o) => scene.drive(o), stats: liveStats, setSlice: (on) => { setSlice(!!on); }, renderNow: () => scene.renderNow() };
    return () => {
      sceneRef.current = null;
      scene.dispose();
      if (armed && window.__grading3d) delete window.__grading3d;
    };
  }, []);

  // ---- the model: built (chunked) whenever the plan's surface changes; the old model stays up until the new one lands ----
  useEffect(() => {
    if (noGl.current || phaseRef.current === "nogl") return undefined;
    const my = ++seq.current;
    const stale = () => my !== seq.current;
    const inp = inRef.current;
    if (!inp.grid) { if (!modelRef.current) setPhase("building"); return () => { seq.current++; }; }
    if (!modelRef.current) setPhase("building");
    const tok = regrade.begin("view3d");
    runChunked(buildModelSteps({ grid: inp.grid, existAt: inp.existAt, parcelRings: inp.parcelRings, els: inp.els }), {
      isStale: stale, onProgress: (f) => regrade.progress("view3d", tok, f),
    }).then((m) => {
      const ok = !stale() && !(m && m.stale);
      regrade.end("view3d", tok, { ok });
      if (!ok) return;
      if (!m) { if (!modelRef.current) { setPhase("empty"); } return; }
      modelRef.current = m;
      const scene = sceneRef.current;
      if (!scene) return;
      scene.setModel(m);
      if (uiRef.current.slice) scene.setSlice(true, m.defaultLine);
      setPhase("ready");
    }).catch((e) => {
      regrade.end("view3d", tok, { ok: false });
      if (stale()) return;
      reportClientEvent("grading-3d-failed", String((e && e.message) || e), { stage: "build", keptPrevious: !!modelRef.current });
      if (!modelRef.current) { setFailure("Couldn't build the 3D model."); setPhase("failed"); }
    });
    // the surface object IS the plan's grading signature; existAt / parcels / buildings ride the ref (a fresh closure per render would rebuild forever)
    return () => { seq.current++; regrade.cancel("view3d", tok); };   // eslint-disable-line react-hooks/exhaustive-deps -- `seq` is a counter, never a DOM ref: the bump MUST hit the live value
  }, [grid]);

  // ---- the controls ----
  useEffect(() => { const s = sceneRef.current; if (s) s.setStretch(stretch); }, [stretch]);
  useEffect(() => { const s = sceneRef.current; if (s) s.setGhost(ghost); }, [ghost]);
  useEffect(() => {
    const s = sceneRef.current, m = modelRef.current;
    if (!s || !m) return;
    s.setSlice(slice, m.defaultLine);
  }, [slice, phase]);

  // ---- keys: Esc closes; every other key is swallowed so a planner shortcut (Delete!) can never act on the plan behind the viewer ----
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); return; }
      e.stopPropagation();
    };
    const onKeyUp = (e) => e.stopPropagation();
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => { window.removeEventListener("keydown", onKey, true); window.removeEventListener("keyup", onKeyUp, true); };
  }, [onClose]);
  const rootRef = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    if (rootRef.current) rootRef.current.focus({ preventScroll: true });
    return () => { if (prev && prev.focus) { try { prev.focus({ preventScroll: true }); } catch (_) { /* gone */ } } };
  }, []);

  const resetView = useCallback(() => { const s = sceneRef.current; if (s) s.resetView(); }, []);
  const msg = phase === "building" || phase === "starting" ? "Building the 3D model…" : phase === "empty" ? "Nothing to show yet — the ground hasn't loaded." : phase === "failed" || phase === "nogl" ? failure : "";

  return (
    <div ref={rootRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="3D grading view" data-testid="grading-3d" data-phase={phase}
      data-stretch={stretch} data-ghost={ghost ? "1" : "0"} data-slice={slice ? "1" : "0"}
      style={{ position: "fixed", inset: 0, zIndex: 3000, background: VOID_HEX, outline: "none" }}>
      <div ref={hostRef} data-testid="grading-3d-host" style={{ position: "absolute", inset: 0 }} />
      {msg && <div data-testid="grading-3d-message" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none" }}>
        <FloatingToolbar style={{ pointerEvents: "none" }}><FloatingToolLabel>{msg}</FloatingToolLabel></FloatingToolbar>
      </div>}
      <FloatingToolbar style={{ position: "absolute", top: SPACE.xl, right: SPACE.xl }}>
        <FloatingToolButton aria-label="Close 3D view" title="Close (Esc)" data-testid="grading-3d-close" onClick={onClose}><CloseGlyph /></FloatingToolButton>
      </FloatingToolbar>
      {/* top left: the legend, and the compass right under it (a column, so a legend that wraps on a narrow screen pushes the compass down instead of onto it) */}
      <div data-testid="grading-3d-topleft" style={{ position: "absolute", left: SPACE.xl, top: SPACE.xl, maxWidth: `calc(100% - ${SPACE.xl * 2 + 56}px)`, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: SPACE.md }}>
        <FloatingToolbar data-testid="grading-3d-legend" style={{ flexWrap: "wrap" }}>
          <FloatingToolLabel><Swatch rgb={CUT_RGB} />Cut</FloatingToolLabel>
          <FloatingToolLabel><Swatch rgb={FILL_RGB} />Fill</FloatingToolLabel>
          <FloatingToolLabel><Swatch rgb={NEUTRAL_RGB} />Untouched</FloatingToolLabel>
          <FloatingToolLabel>
            <svg width="18" height="8" aria-hidden="true" focusable="false"><line x1="0" x2="18" y1="4" y2="4" stroke={inkOf(OUTLINE_RGB)} strokeWidth="1.6" strokeDasharray="4 3" /></svg>Building
          </FloatingToolLabel>
        </FloatingToolbar>
        <Compass apiRef={compassApi} />
      </div>
      <FloatingToolbar data-testid="grading-3d-controls" style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", bottom: SPACE.xl, maxWidth: `calc(100% - ${SPACE.xl * 2}px)`, flexWrap: "wrap", justifyContent: "center", rowGap: 2 }}>
        <FloatingToolLabel>Height</FloatingToolLabel>
        {STRETCHES.map((k) => (
          <FloatingToolButton key={k} active={stretch === k} data-testid={`grading-3d-stretch-${k}`} aria-label={`Height stretch ${k} times`} onClick={() => setStretch(k)}>{k}×</FloatingToolButton>
        ))}
        <FloatingToolDivider />
        <FloatingToolButton active={ghost} data-testid="grading-3d-ghost" onClick={() => setGhost((g) => !g)}>Existing ground</FloatingToolButton>
        <FloatingToolButton active={slice} data-testid="grading-3d-slice" onClick={() => setSlice((s) => !s)}>Slice</FloatingToolButton>
        <FloatingToolDivider />
        <FloatingToolButton data-testid="grading-3d-reset" onClick={resetView}>Reset view</FloatingToolButton>
      </FloatingToolbar>
      <RegradeBanner left={0} bottom={72} />
    </div>
  );
}
