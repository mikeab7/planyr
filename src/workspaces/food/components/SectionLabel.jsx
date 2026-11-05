/* SectionLabel — THE one section header in /food (NEW-1, 2026-10-27): "What to order · 2", "Maybe · 1", "Skip · 1 ▾", "Visits · 3".
 * One caps style (lib/foodType.js `label`), one step above (GROUP_STEP) and one below (ITEM_STEP), on the column edge. A collapsible group's
 * label is a full-width 44-tall button whose chevron rides the SAME right edge as every row's ›; its tap area overhangs the label's own spacing
 * (negative bottom margin) so the visible rhythm is identical to a plain label. `data-section-label` is what the layout harness reads. */
import { FOOD_TYPE, COLUMN_X, GROUP_STEP, ITEM_STEP, LABEL_LINE } from "../lib/foodType.js";

const TAP = 44;

/** `inset`: the label's own left/right padding — COLUMN_X when it sits on the card's full width, 0 inside a block already inset to the column. */
export default function SectionLabel({ children, count, inset = COLUMN_X, open, onToggle, testId, controls }) {
  const text = count == null ? children : `${children} · ${count}`;
  if (!onToggle) {
    return (
      <div data-section-label="" data-testid={testId} style={{ ...FOOD_TYPE.label, padding: `${GROUP_STEP}px ${inset}px ${ITEM_STEP}px` }}>
        <span data-section-label-text="">{text}</span>
      </div>
    );
  }
  return (
    <button
      type="button" onClick={onToggle} aria-expanded={open} aria-controls={controls} data-section-label="" data-testid={testId}
      style={{
        font: "inherit", ...FOOD_TYPE.label, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, width: "100%", boxSizing: "border-box",
        height: TAP, padding: `0 ${inset}px`, margin: `0 0 ${ITEM_STEP - (TAP - LABEL_LINE) / 2}px`, // the tap area's lower half overhangs the rows below, so the visible gap under the text is ITEM_STEP
        border: "none", background: "transparent", cursor: "pointer", textAlign: "left",
        // font:inherit comes FIRST, then the label's own size over it — a <button> otherwise draws the browser's own 13.33/16px (the "SKIP · 1 DISH" that read bigger than every other label)
      }}
    >
      <span data-section-label-text="" style={{ ...FOOD_TYPE.label }}>{text}</span>
      <span aria-hidden="true" style={{ ...FOOD_TYPE.label, flex: "none" }}>{open ? "▴" : "▾"}</span>
    </button>
  );
}
