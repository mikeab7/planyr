import { Fragment } from "react";
import { SPACE } from "../../../shared/ui/designTokens.js";

const LINE = "var(--border-default)", INK = "var(--text-primary)";
const CHIP = 10;

/* B2573312 (NEW-1/NEW-2) — a legend of what is IN VIEW (the Zoning dropdown): every entry on its OWN ROW — swatch, then "CODE · Name", a long name wrapping under itself — and, where the entries carry a `group`,
 * a small heading naming the jurisdiction above the codes that fall in it (one heading when only one is in view). Never two entries on a line, never a per-row suffix. */
export function StackedLegend({ items }) {
  return (
    <div data-part="legend" data-legend="stacked" style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      {items.map((lg, i) => (
        <Fragment key={`${lg.group || ""}|${lg.label}`}>
          {lg.group && (i === 0 || items[i - 1].group !== lg.group) && (
            <div data-part="legend-heading" style={{ fontWeight: 600, color: INK, marginTop: i === 0 ? 0 : SPACE.xs }}>{lg.group}</div>
          )}
          <div data-part="legend-row" style={{ display: "flex", alignItems: "flex-start", gap: 6, color: INK, minWidth: 0 }}>
            <span aria-hidden="true" style={{ width: CHIP, height: CHIP, flex: "none", boxSizing: "border-box", marginTop: 3, background: lg.color, border: `1px solid ${LINE}` }} />
            <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{lg.label}</span>
          </div>
        </Fragment>
      ))}
    </div>
  );
}
