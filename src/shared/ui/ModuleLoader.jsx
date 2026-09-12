/* ModuleLoader — one reusable "assembling" loader, themed per workspace.
 *
 * Instead of a bare spinner, most modules get a skeleton screen that builds
 * ITSELF in that module's visual grammar, so the wait previews the structure
 * coming and reads as faster:
 *   • Schedule  → a Gantt chart assembling: zebra row bands fade in top→bottom,
 *                 ghost task bars wipe in left→right (staggered per row), milestone
 *                 diamonds pop at the bar ends, and a vertical "playhead" sweeps
 *                 left→right — all in the Schedule accent #7F77DD.
 *   • Site      → the "Stack" mark (B1340512/NEW-1): the three isometric plates of
 *                 the brand mark (BrandMark.jsx, variant="favicon") settle into place
 *                 bottom-first, hold, then loop. Deliberately bare — no caption, no
 *                 progress text, no drawn geometry — the owner's pick among five
 *                 replacements for the old drawn-parcel skeleton.
 * One animation engine, a per-module skin + accent (reuses MODULE_ACCENT), so the
 * loading UX stays consistent as the suite grows. (B224)
 *
 * Accessibility: honors prefers-reduced-motion — the cascade + sweep (or, for Site,
 * the plate settle) are dropped for a static rest state (a gentle opacity pulse for
 * the Gantt skin; the three Stack plates simply held at full opacity).
 *
 * Threshold: the loader stays invisible for ~250 ms (SHOW_DELAY_MS), so a fast
 * load never flashes it for a split second. Used as a Suspense fallback (chunk
 * fetch) and as an in-place overlay (e.g. the Scheduler iframe boot) that the
 * consumer cross-fades out once the real content is interactive.
 */
import { useEffect, useState } from "react";
import { resolveLoaderTheme, SHOW_DELAY_MS } from "./moduleLoaderTheme.js";
import BrandMark from "../brand/BrandMark.jsx";

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

const STACK_SIZE = 46;      // px square at desktop (CSS scales it down on phone widths)
const STACK_CYCLE = 2.9;    // seconds — settle → hold → fade → pause, then loop
const STACK_STAGGER = 0.13; // seconds — 130ms per plate, bottom plate first
const STACK_TIERS = ["base", "mid", "top"];

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
/* Stack (B1340512/NEW-1) — a plate settles in, holds, then fades back to its start
   state before the next loop begins (86%→100% is the deliberate pause: 0%'s state
   already matches 100%'s, so the infinite loop never jumps/flickers at the seam). */
@keyframes pl-stack-settle {
  0%   { opacity: 0; transform: translateY(-9px); }
  14%  { opacity: 1; transform: translateY(0); }
  72%  { opacity: 1; transform: translateY(0); }
  86%  { opacity: 0; transform: translateY(-9px); }
  100% { opacity: 0; transform: translateY(-9px); }
}
.pl-stack-wrap { display: flex; align-items: center; justify-content: center; }
.pl-stack-plate {
  opacity: 0;
  transform: translateY(-9px);
  animation-name: pl-stack-settle;
  animation-duration: ${STACK_CYCLE}s;
  animation-timing-function: cubic-bezier(.22,.61,.36,1);
  animation-iteration-count: infinite;
}
@media (max-width: 560px) {
  .pl-stack-wrap { transform: scale(0.72); }
}
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

// The Stack mark — the three plates of the brand mark (BrandMark.jsx) settling into
// place, bottom plate first. Reuses BrandMark's geometry via its plateProps hook
// (never a second copy of the polygons). Deliberately the ONLY thing on screen for
// this skin — no caption, no progress text, no drawn parcel (the owner's pick among
// five replacements for the old skeleton, B1340512/NEW-1).
function StackMark({ reduce }) {
  const plateProps = (tier) => reduce
    ? { style: { opacity: 1, transform: "none" } }
    : {
        className: "pl-stack-plate",
        style: { animationDelay: `${STACK_TIERS.indexOf(tier) * STACK_STAGGER}s` },
      };
  return (
    <div className="pl-stack-wrap" aria-hidden="true">
      <BrandMark size={STACK_SIZE} variant="favicon" tile={false} plateProps={plateProps} />
    </div>
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

  const isStack = theme.kind === "stack";
  // Screen readers still get an announcement even though the Stack skin shows no
  // visible caption by design (theme.label is intentionally unset for it).
  const caption = label || theme.label || "Loading…";

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
      {isStack ? (
        <StackMark reduce={reduce} />
      ) : (
        <>
          <div style={{ width: "100%", flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center",
            ...(reduce ? { animation: "pl-pulse 1.8s ease-in-out infinite" } : null) }}>
            <GanttSkin accent={theme.accent} reduce={reduce} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 9, color: "var(--text-secondary)", fontFamily: "'Inter', system-ui, sans-serif", fontSize: 13, fontWeight: 500 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: theme.accent, transform: "rotate(45deg)",
              ...(reduce ? null : { animation: "pl-pulse 1.4s ease-in-out infinite" }) }} />
            {caption}
          </div>
        </>
      )}
    </div>
  );
}
