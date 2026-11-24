/* useReviewPinch — the two-finger pinch zoom (throttled to one frame) and its telemetry, moved verbatim out of
 * DocReview.jsx (audit batch L4). The gesture refs shared with the pointer handlers stay owned by DocReview and arrive here. */
import { useEffect, useRef } from "react";
import { midpoint, distance, pinchZoom } from "../../../shared/viewport/viewportTransform.js";
import { recordPinchGesture } from "../../../shared/telemetry/gestureTelemetry.js";

export function useReviewPinch({ wrapRef, setView, touchCountRef, pinchRef, touchPinchedRef, panRef, dragRef, setDraft, setDragPreview, setPanning, VIEW_MIN, VIEW_MAX }) {
  // Viewport-relative screen point (for two-finger pinch midpoint math; also works on a Touch object,
  // which carries the same clientX/clientY shape as a pointer event). (B331)
  const vpPoint = (e) => { const r = wrapRef.current.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const pinchRafRef = useRef(0);     // pending rAF id for the throttled pinch update (0 = none)
  const pinchNextRef = useRef(null); // latest { mid, dist } awaiting the next frame
  const pinchTelemetryRef = useRef(null); // { t, fingers } captured at pinch start — feeds the event:pinch row on end/cancel/anomaly
  // Flush one throttled frame of the pinch: zoom by the finger-distance ratio about the baseline
  // midpoint, then re-baseline to the new pair so the next frame is incremental.
  const flushPinch = () => {
    pinchRafRef.current = 0;
    const nx = pinchNextRef.current, base = pinchRef.current;
    if (!nx || !base) return;
    const factor = nx.dist / base.dist;
    setView((v) => (v ? pinchZoom(v, base.mid, nx.mid, factor, VIEW_MIN, VIEW_MAX) : v));
    pinchRef.current = nx;
  };
  const onTouchStartPinch = (e) => {
    touchCountRef.current = e.touches.length;
    if (e.touches.length < 2) return; // a 3rd+ finger is absorbed (never draws/pans) — only ≥2 starts/rebaselines a pinch below
    const isNewPinch = !pinchRef.current;
    const a = vpPoint(e.touches[0]), b = vpPoint(e.touches[1]);
    pinchRef.current = { mid: midpoint(a, b), dist: Math.max(1, distance(a, b)) };
    pinchNextRef.current = null;
    if (isNewPinch) pinchTelemetryRef.current = { t: performance.now(), fingers: e.touches.length };
    else if (pinchTelemetryRef.current) pinchTelemetryRef.current.fingers = Math.max(pinchTelemetryRef.current.fingers, e.touches.length);
    touchPinchedRef.current = true;
    // Tear down any single-finger gesture the 1st finger had already started, so the pinch begins clean.
    panRef.current = null; dragRef.current = null; setDraft(null); setDragPreview(null); setPanning(false);
  };
  const onTouchMovePinch = (e) => {
    if (!pinchRef.current || e.touches.length < 2) return;
    const a = vpPoint(e.touches[0]), b = vpPoint(e.touches[1]);
    pinchNextRef.current = { mid: midpoint(a, b), dist: Math.max(1, distance(a, b)) };
    if (!pinchRafRef.current) pinchRafRef.current = requestAnimationFrame(flushPinch);
  };
  // Shared by onTouchEnd and onTouchCancel: re-baseline to whatever fingers remain (≥2 → the current
  // pair, so a 3rd finger or a partial lift re-anchors instead of zoom-jumping off a stale pair; <2 →
  // the pinch ends). touchPinchedRef is deliberately left set here — onUp consumes + clears it once
  // touchCountRef reaches 0, so a stray tap on the final lift is suppressed even across a multi-lift.
  // `cancelled` distinguishes a native touchcancel (an interruption) from an ordinary touchend.
  const onTouchEndPinch = (e, cancelled = false) => {
    touchCountRef.current = e.touches.length;
    if (e.touches.length >= 2) {
      if (pinchTelemetryRef.current) pinchTelemetryRef.current.fingers = Math.max(pinchTelemetryRef.current.fingers, e.touches.length);
      const a = vpPoint(e.touches[0]), b = vpPoint(e.touches[1]);
      pinchRef.current = { mid: midpoint(a, b), dist: Math.max(1, distance(a, b)) };
      return;
    }
    if (pinchRef.current) {
      const started = pinchTelemetryRef.current;
      recordPinchGesture({
        surface: "doc-review", eventSource: "touch",
        fingerCount: started ? started.fingers : touchCountRef.current,
        outcome: cancelled ? "cancelled" : "completed",
        cancelReason: cancelled ? "touchcancel" : undefined,
        durationMs: started ? performance.now() - started.t : undefined,
      });
    }
    pinchTelemetryRef.current = null;
    pinchRef.current = null; pinchNextRef.current = null;
    if (pinchRafRef.current) { cancelAnimationFrame(pinchRafRef.current); pinchRafRef.current = 0; }
  };
  // A pinch mid-gesture at unmount (e.g. switching sheets) must not leave a pending rAF whose
  // callback fires against a torn-down instance's refs after the fact.
  useEffect(() => () => { if (pinchRafRef.current) cancelAnimationFrame(pinchRafRef.current); }, []);
  return { onTouchStartPinch, onTouchMovePinch, onTouchEndPinch, pinchTelemetryRef };
}
