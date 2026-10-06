/* RailSplit.jsx — NEW-1 (right tool rail). Two module-scope pieces the Site Planner's right rail is
 * built from (MODULE-SCOPE-COMPONENTS: never define either inside SitePlanner's render body).
 *
 *  · RailHeading — small-caps label + a hairline rule that runs to the rail's right edge. ONE rule for
 *    every heading; its spacing numbers are `RAIL` in lib/toolRailModel.js and index.css's `.rail-hdr`
 *    mirrors them (the browser harness measures the page against the model, so they cannot drift).
 *  · RailSplit — a tool row with a flyout: the label button + a ▾ pill. The pill carries the tool's
 *    CURRENT size ("36′", "9′×18′") when it has one, so you can see which version you are about to
 *    grab without opening the menu. Every ▾ is right-aligned inside the pill at one size, so they
 *    form a single column down the rail whatever the value's width. Armed = ONE flat rounded shape
 *    (label + pill share the fill, no gap, no shadow, a faint divider between).
 *
 * Styling note: the halves take the planner's own `rbtn(active, open)` style object from the caller
 * (one source for fill / ink / open-ring) and only adjust the corners, the pill's padding and the
 * divider here, so a change to the row's look still happens in exactly one place.
 */
import { RADIUS } from "../../../shared/ui/radius.js";

export function RailHeading({ children }) {
  return <div className="rail-hdr" data-rail-heading="1">{children}</div>;
}

export function RailSplit({
  icon, label, active, rowStyle, narrow,
  onMain, mainProps = {},
  onCaret, caretLabel, caretProps = {}, expanded,
  value, valueTitle, testid, pillTestid,
}) {
  const inner = active ? "color-mix(in srgb, var(--on-accent) 38%, transparent)" : "transparent";
  const main = {
    ...rowStyle, flex: 1, minWidth: 0, boxShadow: "none",
    borderTopLeftRadius: RADIUS.md, borderBottomLeftRadius: RADIUS.md, borderTopRightRadius: 0, borderBottomRightRadius: 0, paddingRight: 2,
  };
  const pill = {
    ...rowStyle, flex: "none", width: "auto", boxShadow: "none", gap: 1, justifyContent: "flex-end",
    // Tightened padding — the value pill gives up room, never the tool name (brief). Caret centre = 1 + pr + 6
    // for every pill (plain ones are held to `minWidth` and right-aligned), so the ▾ column cannot shift.
    padding: narrow ? "0 15px 0 6px" : "0 4px 0 5px", minWidth: narrow ? 44 : 26,
    borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderTopRightRadius: RADIUS.md, borderBottomRightRadius: RADIUS.md, borderLeft: `1px solid ${inner}`,
    fontWeight: active ? 650 : 600,
  };
  return (
    <div className={`rail-split${active ? " on" : ""}`} data-rail-split={testid || undefined} style={{ display: "flex", gap: 0 }}>
      <button className={`rbtn rail-split-main${active ? " on" : ""}`} style={main} onClick={onMain} aria-expanded={expanded} data-testid={testid} {...mainProps}>
        {icon} {label}
      </button>
      <button className={`rbtn rail-split-pill${active ? " on" : ""}`} style={pill} onClick={onCaret}
        aria-haspopup="menu" aria-expanded={expanded} aria-label={caretLabel} title={valueTitle || undefined}
        data-testid={pillTestid} data-rail-pill={value ? "value" : "plain"} {...caretProps}>
        {value ? <span className="rail-pill-val">{value}</span> : null}
        <span className="rail-caret" aria-hidden="true">▾</span>
      </button>
    </div>
  );
}
