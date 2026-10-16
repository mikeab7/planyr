import { FONT_SIZE, SPACE } from "../../../shared/ui/designTokens.js";
import { RADIUS } from "../../../shared/ui/radius.js";

/* Presentational pieces of the redesigned ROAD Properties panel (NEW-1). Module scope on purpose
 * (MODULE-SCOPE-COMPONENTS); theme tokens only; every number they show arrives as a prop from
 * lib/roadPanelModel.js, so nothing here re-derives a width. */

/* A small road glyph for the header (two edge lines + a dashed centre line), drawn in the text colour. */
export function RoadGlyph({ size = 16 }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" style={{ flex: "none", color: "var(--text-secondary)" }}>
      <path d="M7 21L10 3M17 21L14 3M12 5v2M12 11v2M12 17v2" />
    </svg>
  );
}

/* The to-scale strip of a section's bands: each band's flex-grow IS its width in feet, so the strip reads
 * as the section does on the canvas. A plain road is curb · paving · curb. Decorative (aria-hidden): the
 * caption under it and the button below carry the meaning in words. */
export function RoadXSectionStrip({ bands }) {
  return (
    <div data-testid="road-xs-strip" aria-hidden="true" style={{ display: "flex", gap: 2, height: 14, borderRadius: RADIUS.sm, overflow: "hidden", background: "var(--planner-border)" }}>
      {bands.map((b) => (
        <span key={b.key} data-band={b.type} title={`${b.type} · ${Math.round(b.w * 10) / 10} ft`}
          style={{ display: "block", flex: `${b.w} 1 0`, minWidth: 3, background: b.fill, opacity: b.opacity }} />
      ))}
    </div>
  );
}

export function RoadStripCaption({ children }) {
  return <div data-testid="road-xs-caption" style={{ fontSize: FONT_SIZE.label, color: "var(--text-tertiary)", marginTop: SPACE.sm, marginBottom: SPACE.md }}>{children}</div>;
}
