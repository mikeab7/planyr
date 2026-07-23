/* PR-L — the developer-readable pond SECTION. One component, used everywhere a pond section is
 * shown (the ⚡ Optimize "what changed" card and the pond inspector). Pure geometry + collision-free
 * label placement come from lib/pondSectionModel.js (unit-tested without a browser); this maps the
 * marks to SVG with theme tokens and scales to its container via viewBox. Module scope
 * (MODULE-SCOPE-COMPONENTS). Numbers render 1dp to match the panel values exactly. */
import React from "react";
import { pondSectionModel } from "../lib/pondSectionModel.js";

const DESIGN_W = 520;
const DESIGN_H = 260;

// role → label fill token
const LABEL_FILL = {
  rim: "var(--accent)", grade: "var(--text-secondary)", floor: "var(--text-secondary)",
  flood: "var(--info-text)", groundwater: "var(--accent-library-text)",
  usable: "var(--success-text)", dead: "var(--info-text)", freeboard: "var(--text-tertiary)",
  outlet: "var(--text-primary)", receiving: "var(--info-text)",
  dim: "var(--text-secondary)", earthwork: "var(--warn-text)",
};

const pathOf = (pts) => pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

export default function PondSection({ facts, width = DESIGN_W, height = DESIGN_H, maxWidth = 520 }) {
  const m = pondSectionModel(facts || {}, { w: width, h: height });
  if (!m.ok) return null;

  const bandFill = { dead: "var(--info-text)", usable: "var(--success-text)", freeboard: "var(--planner-raised)" };
  const bandOpacity = { dead: 0.16, usable: 0.18, freeboard: 0 };

  return (
    <svg
      viewBox={`0 0 ${m.w} ${m.h}`}
      width="100%"
      preserveAspectRatio="xMidYMid meet"
      style={{ display: "block", width: "100%", maxWidth, height: "auto" }}
      role="img"
      aria-label="Schematic pond cross-section, not to scale"
    >
      <defs>
        <pattern id="pondsec-berm-hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="var(--warn-bg)" />
          <line x1="0" y1="0" x2="0" y2="6" stroke="var(--warn-text)" strokeWidth="1.1" opacity="0.55" />
        </pattern>
      </defs>

      {/* earth mass below grade */}
      <polygon points={m.ground.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")} fill="var(--warn-bg)" stroke="none" opacity="0.9" />

      {/* water / storage bands */}
      {m.bands.map((b, i) => (
        <polygon key={`band-${i}`} points={b.pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}
          fill={bandFill[b.kind]} opacity={bandOpacity[b.kind]} stroke={b.kind === "freeboard" ? "var(--planner-border)" : "none"} strokeDasharray={b.kind === "freeboard" ? "3 3" : undefined} strokeWidth={b.kind === "freeboard" ? 1 : 0} />
      ))}

      {/* berm fill above grade (distinct hatch), bounded by outer face · crest · inner face · grade */}
      {m.berms.map((quad, i) => (
        <polygon key={`berm-${i}`} points={quad.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")} fill="url(#pondsec-berm-hatch)" stroke="none" />
      ))}
      {/* berm OUTER face + flat crest top (light outline; the inner face is drawn as the dark slope below) */}
      {(m.bermOutlines || []).map((pts, i) => (
        <polyline key={`bo-${i}`} points={pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")} fill="none" stroke="var(--warn-border)" strokeWidth="1.2" strokeLinejoin="round" />
      ))}

      {/* pond inner faces + floor — the dark side slope is ONE colinear line crest→floor (runs along
          the berm fill's inner edge above grade, then the excavation slope below; never through the hatch) */}
      {m.faces.map((seg, i) => (
        <line key={`face-${i}`} x1={seg[0].x} y1={seg[0].y} x2={seg[1].x} y2={seg[1].y} stroke="var(--text-secondary)" strokeWidth="1.6" />
      ))}
      <line x1={m.floor.x1} y1={m.floor.y} x2={m.floor.x2} y2={m.floor.y} stroke="var(--text-secondary)" strokeWidth="1.6" />

      {/* horizontal reference lines */}
      {m.lines.map((ln, i) => {
        const style = ln.role === "grade"
          ? { stroke: "var(--text-tertiary)", strokeWidth: 1.2, strokeDasharray: undefined, opacity: 0.85 }
          : ln.role === "flood"
            ? { stroke: "var(--info-text)", strokeWidth: 1.5, strokeDasharray: "5 3", opacity: 0.95 }
            : { stroke: "var(--accent-library-text)", strokeWidth: 1.3, strokeDasharray: "2 3", opacity: 0.9 };
        return <line key={`line-${i}`} x1={ln.x1} y1={ln.y} x2={ln.x2} y2={ln.y} {...style} />;
      })}

      {/* receiving-water level beyond the berm (a short water line + tick) */}
      {m.receiving && (
        <g>
          <line x1={m.receiving.x1} y1={m.receiving.y} x2={m.receiving.x2} y2={m.receiving.y} stroke="var(--info-text)" strokeWidth="1.5" />
          <polygon points={`${((m.receiving.x1 + m.receiving.x2) / 2 - 4).toFixed(1)},${m.receiving.y} ${((m.receiving.x1 + m.receiving.x2) / 2 + 4).toFixed(1)},${m.receiving.y} ${((m.receiving.x1 + m.receiving.x2) / 2).toFixed(1)},${(m.receiving.y + 5).toFixed(1)}`} fill="var(--info-text)" opacity="0.8" />
        </g>
      )}

      {/* outlet at the invert on the right bank */}
      {m.outlet && (
        <g>
          <circle cx={m.outlet.x} cy={m.outlet.y} r="3" fill="none" stroke="var(--text-primary)" strokeWidth="1.4" />
          <line x1={m.outlet.x} y1={m.outlet.y} x2={m.outlet.x + 16} y2={m.outlet.y} stroke="var(--text-primary)" strokeWidth="1.4" />
        </g>
      )}

      {/* PR-M depth dimension: extension lines touching each measured level + a vertical dimension
          line with end ticks at RIM and FLOOR and a small tick where it crosses GRADE. */}
      {(() => {
        const d = m.depthDim;
        return (
          <g stroke="var(--text-secondary)" strokeWidth="1" fill="none">
            {/* extension lines from the measured levels out to the dimension line */}
            <line x1={d.extRim.x1} y1={d.extRim.y} x2={d.extRim.x2} y2={d.extRim.y} strokeWidth="0.7" opacity="0.7" />
            <line x1={d.extFloor.x1} y1={d.extFloor.y} x2={d.extFloor.x2} y2={d.extFloor.y} strokeWidth="0.7" opacity="0.7" />
            {d.extGrade && <line x1={d.extGrade.x1} y1={d.extGrade.y} x2={d.extGrade.x2} y2={d.extGrade.y} strokeWidth="0.7" opacity="0.7" />}
            {/* the dimension line + end ticks */}
            <line x1={d.x} y1={d.yRim} x2={d.x} y2={d.yFloor} />
            <line x1={d.x - 3.5} y1={d.yRim} x2={d.x + 3.5} y2={d.yRim} />
            <line x1={d.x - 3.5} y1={d.yFloor} x2={d.x + 3.5} y2={d.yFloor} />
            {d.yGrade != null && <line x1={d.x - 2.5} y1={d.yGrade} x2={d.x + 2.5} y2={d.yGrade} />}
          </g>
        );
      })()}

      {/* leader lines for any label that had to move off its anchor */}
      {m.labels.filter((l) => l.leaderX != null && Math.abs(l.y - l.anchorY) > 1).map((l, i) => {
        const dir = l.anchor === "end" ? 6 : -6;
        return <line key={`ld-${i}`} x1={l.leaderX} y1={l.anchorY} x2={l.leaderX + dir} y2={l.y} stroke="var(--text-tertiary)" strokeWidth="0.8" opacity="0.7" />;
      })}

      {/* labels (halo so they stay legible over lines/bands) */}
      {m.labels.map((l, i) => (
        <text key={`lb-${i}`} x={l.x} y={l.y} textAnchor={l.anchor} style={{ fill: LABEL_FILL[l.role] || "var(--text-secondary)", fontSize: 10, fontWeight: 600, paintOrder: "stroke", stroke: "var(--planner-raised)", strokeWidth: 2.6, strokeLinejoin: "round" }}>{l.s}</text>
      ))}

      {/* not-to-scale note in its reserved corner */}
      <text x={m.note.x} y={m.note.y} style={{ fill: "var(--text-tertiary)", fontSize: 9, fontStyle: "italic" }}>{m.note.s}</text>
    </svg>
  );
}
