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
 * Pure parts: lib/grading3d/{field,meshBuild,orbit,buildModel,colors}.js (tests: repo-root `test/` **grading3dMesh**, **grading3dReal**). */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createViewerScene, liveStats } from "../lib/grading3d/threeScene.js";
import { buildModelSteps } from "../lib/grading3d/buildModel.js";
import { runChunked } from "../lib/runChunked.js";
import * as regrade from "../lib/regradeProgress.js";
import RegradeBanner from "./RegradeBanner.jsx";
import { FloatingToolbar, FloatingToolButton, FloatingToolLabel, FloatingToolDivider } from "../../../shared/ui/controls.jsx";
import { reportClientEvent } from "../../../shared/telemetry/clientErrors.js";
import { isDiagArmed } from "../lib/diagArm.js";
import { VOID_HEX, NEUTRAL_RGB, OUTLINE_RGB } from "../lib/grading3d/colors.js";
import { CUT_RGB, FILL_RGB } from "../lib/gradingPaint.js";
import { SPACE } from "../../../shared/ui/designTokens.js";

export const STRETCHES = [1, 2, 3, 5];
export const DEFAULT_STRETCH = 3;
const inkOf = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;   // design-exempt: the legend swatches ARE the model's own cut / fill / ground colours (lib/grading3d/colors.js), which do not theme

function CloseGlyph() {
  return <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false"><path d="M3 3l8 8M11 3l-8 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
}
const Swatch = ({ rgb }) => <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 2, background: inkOf(rgb), display: "inline-block", flex: "none" }} />;   // design-exempt: 2 = a 10px legend chip, the same chip the 2D legend draws

export default function Grading3DViewer({ grid, existAt, parcelRings, els, onClose }) {
  const hostRef = useRef(null);
  const sceneRef = useRef(null);
  const modelRef = useRef(null);
  const inRef = useRef({ grid, existAt, parcelRings, els }); inRef.current = { grid, existAt, parcelRings, els };
  const seq = useRef(0);
  const [stretch, setStretch] = useState(DEFAULT_STRETCH);
  const [ghost, setGhost] = useState(true);
  const [slice, setSlice] = useState(false);
  const [phase, setPhase] = useState("starting");   // starting | building | ready | empty | failed | nogl
  const [failure, setFailure] = useState("");
  const phaseRef = useRef("starting"); phaseRef.current = phase;
  const uiRef = useRef({ stretch, ghost, slice }); uiRef.current = { stretch, ghost, slice };

  // ---- the scene: made once on mount, released on unmount ----
  useEffect(() => {
    const host = hostRef.current;
    let scene = null;
    try {
      scene = createViewerScene(host, {});
    } catch (e) {
      reportClientEvent("grading-3d-failed", String((e && e.message) || e), { stage: "webgl" });
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
    if (phaseRef.current === "nogl") return undefined;
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
      <FloatingToolbar data-testid="grading-3d-legend" style={{ position: "absolute", left: SPACE.xl, top: SPACE.xl, maxWidth: `calc(100% - ${SPACE.xl * 2 + 56}px)`, flexWrap: "wrap" }}>
        <FloatingToolLabel><Swatch rgb={CUT_RGB} />Cut</FloatingToolLabel>
        <FloatingToolLabel><Swatch rgb={FILL_RGB} />Fill</FloatingToolLabel>
        <FloatingToolLabel><Swatch rgb={NEUTRAL_RGB} />Untouched</FloatingToolLabel>
        <FloatingToolLabel>
          <svg width="18" height="8" aria-hidden="true" focusable="false"><line x1="0" x2="18" y1="4" y2="4" stroke={inkOf(OUTLINE_RGB)} strokeWidth="1.6" strokeDasharray="4 3" /></svg>Building
        </FloatingToolLabel>
      </FloatingToolbar>
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
