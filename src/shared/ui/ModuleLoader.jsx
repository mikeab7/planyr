/* ModuleLoader — one reusable "assembling" loader, themed per workspace.
 *
 * Instead of a bare spinner, each module gets a skeleton screen that builds
 * ITSELF in that module's visual grammar, so the wait previews the structure
 * coming and reads as faster:
 *   • Schedule  → a Gantt chart assembling: zebra row bands fade in top→bottom,
 *                 ghost task bars wipe in left→right (staggered per row), milestone
 *                 diamonds pop at the bar ends, and a vertical "playhead" sweeps
 *                 left→right — all in the Schedule accent #7F77DD.
 *   • Site      → a site plan drawing itself: a parcel outline stroke-draws and
 *                 building footprints fade in, in the Site accent #1D9E75.
 * One animation engine, a per-module skin + accent (reuses MODULE_ACCENT), so the
 * loading UX stays consistent as the suite grows. (B224)
 *
 * Accessibility: honors prefers-reduced-motion — the cascade + sweep are dropped
 * for a static skeleton with a gentle opacity pulse.
 *
 * Threshold: the loader stays invisible for ~250 ms (SHOW_DELAY_MS), so a fast
 * load never flashes it for a split second. Used as a Suspense fallback (chunk
 * fetch) and as an in-place overlay (e.g. the Scheduler iframe boot) that the
 * consumer cross-fades out once the real content is interactive.
 */
import { useEffect, useState } from "react";
import { resolveLoaderTheme, SHOW_DELAY_MS } from "./moduleLoaderTheme.js";

export { SHOW_DELAY_MS };

// Pseudo-random-but-fixed Gantt layout (fractions of the chart area). Bars step
// rightward down the rows so it reads as tasks sequencing along the timeline; a
// couple of rows are milestones (a diamond instead of a bar).
const GANTT_ROWS = [
  { s: 0.00, w: 0.20, kind: "bar", name: 0.62 },
  { s: 0.03, w: 0.11, kind: "bar", name: 0.40 },
  { s: 0.11, w: 0.08, kind: "bar", name: 0.34 },
  { s: 0.17, w: 0.00, kind: "ms",  name: 0.30 },
  { s: 0.22, w: 0.22, kind: "bar", name: 0.55 },
  { s: 0.25, w: 0.13, kind: "bar", name: 0.38 },
  { s: 0.37, w: 0.10, kind: "bar", name: 0.32 },
  { s: 0.46, w: 0.00, kind: "ms",  name: 0.28 },
  { s: 0.51, w: 0.23, kind: "bar", name: 0.58 },
  { s: 0.56, w: 0.15, kind: "bar", name: 0.36 },
];

// Building footprints for the Site skin (fractions of the parcel box).
const SITE_BUILDINGS = [
  { x: 0.10, y: 0.16, w: 0.34, h: 0.26 },
  { x: 0.52, y: 0.14, w: 0.36, h: 0.20 },
  { x: 0.12, y: 0.52, w: 0.30, h: 0.30 },
  { x: 0.50, y: 0.46, w: 0.40, h: 0.36 },
];

// Keyframes (injected as one <style> with the component). transform-origin:left
// makes bars wipe from their start edge; opacity fades the loop boundary so the
// restart from scaleX(0) is seamless.
const KEYFRAMES = `
@keyframes pl-band   { from { opacity: 0; transform: translateY(-3px); } to { opacity: 1; transform: none; } }
@keyframes pl-assemble {
  0%   { transform: scaleX(0); opacity: 0; }
  12%  { opacity: 1; }
  46%  { transform: scaleX(1); opacity: 1; }
  86%  { transform: scaleX(1); opacity: 1; }
  100% { transform: scaleX(1); opacity: 0; }
}
@keyframes pl-pop {
  0%   { transform: rotate(45deg) scale(0); opacity: 0; }
  60%  { opacity: 1; }
  72%  { transform: rotate(45deg) scale(1.3); }
  100% { transform: rotate(45deg) scale(1); opacity: 1; }
}
@keyframes pl-pop-out { 0%, 86% { opacity: 1; } 100% { opacity: 0; } }
@keyframes pl-sweep {
  0%   { opacity: 0; }
  8%   { opacity: 0.65; }
  92%  { opacity: 0.65; }
  100% { opacity: 0; }
}
@keyframes pl-draw  { to { stroke-dashoffset: 0; } }
@keyframes pl-fade  { 0% { opacity: 0; transform: scale(0.96); } 60% { opacity: 1; } 100% { opacity: 1; transform: scale(1); } }
@keyframes pl-pulse { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
`;

const CYCLE = 2.6;        // seconds — one assemble→sweep loop
const ROW_STAGGER = 0.1;  // seconds — per-row offset (~100 ms)

function GanttSkin({ accent, reduce }) {
  const VB_W = 1000, VB_H = 520;
  const HEAD_H = 36, ROW_H = 44, TOP = HEAD_H + 8;
  const COL_X = 286;                       // task-name column / chart divider
  const CH_X0 = COL_X + 14, CH_X1 = VB_W - 28, CH_W = CH_X1 - CH_X0;
  const barX = (f) => CH_X0 + f * CH_W;

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="xMidYMid meet"
      style={{ display: "block", maxHeight: "78vh" }} aria-hidden="true">
      {/* timeline header */}
      <rect x="0" y="0" width={VB_W} height={HEAD_H} fill="#eef1f6" />
      {[0.18, 0.36, 0.54, 0.72, 0.9].map((f, i) => (
        <rect key={i} x={barX(f)} y="12" width="34" height="9" rx="4" fill="#d4d9e3" />
      ))}
      <line x1={COL_X} y1="0" x2={COL_X} y2={VB_H} stroke="#e2e6ec" strokeWidth="1.5" />

      {GANTT_ROWS.map((r, i) => {
        const y = TOP + i * ROW_H;
        const delay = i * ROW_STAGGER;
        const bandStyle = reduce ? {} : { animation: `pl-band 0.5s ease-out both`, animationDelay: `${delay}s` };
        const barAnim = reduce
          ? { opacity: 0.85 }
          : { transformBox: "fill-box", transformOrigin: "left center", animation: `pl-assemble ${CYCLE}s ease-in-out infinite`, animationDelay: `${delay}s` };
        const msAnim = reduce
          ? { opacity: 0.85, transform: "rotate(45deg)" }
          : { transformBox: "fill-box", transformOrigin: "center", animation: `pl-pop 0.7s ease-out both, pl-pop-out ${CYCLE}s ease-in-out infinite`, animationDelay: `${delay + CYCLE * 0.42}s, ${delay}s` };
        return (
          <g key={i}>
            {/* zebra band — reuses the real banding tints */}
            <rect x="0" y={y} width={VB_W} height={ROW_H} fill={i % 2 ? "#f6f8fb" : "#ffffff"} style={bandStyle} />
            {/* ghost task-name line in the left column */}
            <rect x={24 + (r.s > 0.2 ? 14 : 0)} y={y + ROW_H / 2 - 4} width={r.name * (COL_X - 60)} height="9" rx="4.5" fill="#e4e8ef" style={bandStyle} />
            {/* bar or milestone diamond in the chart area */}
            {r.kind === "bar" ? (
              <rect x={barX(r.s)} y={y + ROW_H / 2 - 6} width={Math.max(14, r.w * CH_W)} height="12" rx="6"
                fill={accent} opacity="0.85" style={barAnim} />
            ) : (
              <rect x={barX(r.s) - 7} y={y + ROW_H / 2 - 7} width="14" height="14"
                fill={accent} opacity="0.9" style={msAnim} />
            )}
          </g>
        );
      })}

      {/* playhead — a soft vertical sweep across the chart, reinforcing time */}
      {!reduce && (
        <g style={{ animation: `pl-sweep ${CYCLE}s ease-in-out infinite` }}>
          <rect x={CH_X0} y={HEAD_H} width="2.5" height={VB_H - HEAD_H} fill={accent}>
            <animate attributeName="x" from={CH_X0} to={CH_X1} dur={`${CYCLE}s`} repeatCount="indefinite" calcMode="spline" keyTimes="0;1" keySplines="0.4 0 0.2 1" />
          </rect>
        </g>
      )}
    </svg>
  );
}

function SiteSkin({ accent, reduce }) {
  const VB_W = 760, VB_H = 520;
  // Irregular parcel outline (a closed path) that stroke-draws itself.
  const parcel = "M70,70 L560,48 L700,250 L640,470 L150,452 L60,260 Z";
  const PERIM = 2100; // generous dash length to cover the path
  const PX = 60, PY = 44, PW = 640, PH = 432;   // parcel bounding box for footprints
  const drawStyle = reduce
    ? { strokeDashoffset: 0 }
    : { strokeDasharray: PERIM, strokeDashoffset: PERIM, animation: `pl-draw 1.6s ease-in-out infinite alternate` };
  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="xMidYMid meet"
      style={{ display: "block", maxHeight: "78vh" }} aria-hidden="true">
      {/* faint survey grid */}
      {Array.from({ length: 9 }, (_, i) => (
        <line key={`v${i}`} x1={40 + i * 84} y1="20" x2={40 + i * 84} y2={VB_H - 20} stroke="#eaeef0" strokeWidth="1" />
      ))}
      {Array.from({ length: 7 }, (_, i) => (
        <line key={`h${i}`} x1="20" y1={36 + i * 70} x2={VB_W - 20} y2={36 + i * 70} stroke="#eaeef0" strokeWidth="1" />
      ))}
      {/* parcel outline stroke-drawing itself */}
      <path d={parcel} fill={`${accent}14`} stroke={accent} strokeWidth="3" strokeLinejoin="round" style={drawStyle} />
      {/* building footprints fading in, staggered */}
      {SITE_BUILDINGS.map((b, i) => {
        const style = reduce
          ? { opacity: 0.9 }
          : { transformBox: "fill-box", transformOrigin: "center", animation: `pl-fade 0.6s ease-out both`, animationDelay: `${0.8 + i * 0.22}s` };
        return (
          <rect key={i} x={PX + b.x * PW} y={PY + b.y * PH} width={b.w * PW} height={b.h * PH}
            rx="3" fill={accent} opacity="0.82" stroke="#ffffff" strokeWidth="2" style={style} />
        );
      })}
      {/* north arrow pops in last */}
      <g style={reduce ? { opacity: 0.8 } : { animation: `pl-fade 0.5s ease-out both`, animationDelay: "1.7s" }}>
        <circle cx={VB_W - 56} cy="60" r="20" fill="#ffffff" stroke={accent} strokeWidth="2" />
        <path d={`M${VB_W - 56},44 L${VB_W - 50},64 L${VB_W - 56},59 L${VB_W - 62},64 Z`} fill={accent} />
      </g>
    </svg>
  );
}

export default function ModuleLoader({ module = "scheduler", label, style }) {
  const theme = resolveLoaderTheme(module);
  const [shown, setShown] = useState(false);
  const reduce = typeof window !== "undefined" && window.matchMedia
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Don't flash on fast loads — only reveal after the perceptible-delay threshold.
  useEffect(() => {
    const t = setTimeout(() => setShown(true), SHOW_DELAY_MS);
    return () => clearTimeout(t);
  }, []);

  const Skin = theme.kind === "site" ? SiteSkin : GanttSkin;
  const caption = label || theme.label;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={caption}
      style={{
        position: "absolute", inset: 0, zIndex: 5,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: 18, padding: 24, background: "var(--surface-page)",
        opacity: shown ? 1 : 0, transition: "opacity 0.35s ease",
        ...style,
      }}
    >
      <style>{KEYFRAMES}</style>
      <div style={{ width: "100%", flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center",
        ...(reduce ? { animation: "pl-pulse 1.8s ease-in-out infinite" } : null) }}>
        <Skin accent={theme.accent} reduce={reduce} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 9, color: "var(--text-secondary)", fontFamily: "'Inter', system-ui, sans-serif", fontSize: 13, fontWeight: 500 }}>
        <span style={{ width: 9, height: 9, borderRadius: 2, background: theme.accent, transform: "rotate(45deg)",
          ...(reduce ? null : { animation: "pl-pulse 1.4s ease-in-out infinite" }) }} />
        {caption}
      </div>
    </div>
  );
}
