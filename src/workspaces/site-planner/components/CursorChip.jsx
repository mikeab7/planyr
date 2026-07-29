/* NEW-2 — the ONE cursor chip both map surfaces paint (the planner canvas and the map
 * finder), so the coordinate pair and the elevation readout can't drift apart in copy,
 * order, or state handling. Content comes from lib/groundReadout.js (pure); this file
 * only lays it out.
 *
 * ONE LINE, at its existing size. The layout enforces the priority the owner set: the
 * elevation group never shrinks and never wraps, and the COORDINATE pair is the part
 * that gives way when the map pane is narrow — the opposite of the old `text-overflow`
 * on the whole chip, which truncated from the right and so ate the elevation first.
 */
import React from "react";
import { NUM_FONT, TABULAR_NUMS } from "../../../shared/theme/typography.js";
import { groundReadout } from "../lib/groundReadout.js";
import { GROUND_EL_TITLE } from "./useGroundElevation.js";

export default function CursorChip({ ll, el, prop = null, style = {} }) {
  if (!ll) return null;
  const { parts, title } = groundReadout({ el, prop });
  return (
    <div
      title={[GROUND_EL_TITLE, title].filter(Boolean).join(" ")}
      style={{
        position: "absolute", zIndex: 5, pointerEvents: "none",
        display: "flex", alignItems: "baseline", gap: 0,
        fontFamily: NUM_FONT, fontSize: 11, color: "rgba(255,255,255,0.82)",
        background: "rgba(0,0,0,0.42)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
        padding: "3px 8px", borderRadius: 5, lineHeight: 1.4, fontVariantNumeric: TABULAR_NUMS,
        whiteSpace: "nowrap", boxSizing: "border-box", ...style,
      }}
    >
      {/* the first thing to give way when space runs out */}
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {ll.lat.toFixed(6)}°,&nbsp;{ll.lng.toFixed(6)}°
      </span>
      <span data-ground-el data-ground-el-status={(el && el.status) || "idle"} style={{ flex: "none", whiteSpace: "nowrap" }}>
        {parts.map((p) => (
          <span key={p.key} data-readout-part={p.key} style={p.color ? { color: p.color } : undefined}>
            {" · "}{p.text}
          </span>
        ))}
      </span>
    </div>
  );
}
