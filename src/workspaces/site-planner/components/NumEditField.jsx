/* NEW-1 — the ONE inline numeric editor on the canvas, at the size of the thing it edits.
 *
 * A module-scope component (MODULE-SCOPE-COMPONENTS) so both call sites — the setback chip's
 * IN-PLACE edit and the floating fallback for road width / overlay trace length / element resize /
 * aerial calibration — render one field with one set of behaviours. `lib/numEditBox.js` decides
 * the box; this decides how it looks and what the keys do.
 *
 * Everything that already worked is kept: Enter commits, Escape cancels, blur commits, and the
 * caller's full-canvas backdrop commits on a click away.
 *
 * Two deliberate departures from the box it replaces:
 *   · NO NATIVE SPINNERS. `index.css` suppresses them app-wide; ArrowUp/ArrowDown nudge instead
 *     (Shift for the coarse step), which is the right control at a size where no button fits.
 *   · The app's OWN tokens — one-pixel border, `NUM_FONT` with tabular figures (the same pair the
 *     chips use, so the digits sit exactly where the chip's digits sat), no drop shadow.
 */
import { useLayoutEffect, useRef } from "react";
import { NUM_FONT, TABULAR_NUMS } from "../../../shared/theme/typography.js";
import { nudgeNumEditValue } from "../lib/numEditBox.js";

export default function NumEditField({ box, value, onChange, onCommit, onCancel, ariaLabel, plate, ink, border, testId = "num-edit-field" }) {
  const ref = useRef(null);
  // Mount-only: focus and SELECT, so typing replaces the value the chip was already showing.
  // An inline ref callback would re-run on every keystroke and re-select mid-edit.
  useLayoutEffect(() => { const el = ref.current; if (el) { el.focus(); el.select(); } }, []);

  return (
    <foreignObject x={box.x} y={box.y} width={box.w} height={box.h} style={{ overflow: "visible" }}>
      <input
        ref={ref}
        className="num-edit-field"
        type="number"
        inputMode="decimal"
        aria-label={ariaLabel}
        data-testid={testId}
        data-in-place={box.inPlace ? "1" : "0"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") { e.preventDefault(); onCommit(); }
          else if (e.key === "Escape") { e.preventDefault(); onCancel(); }
          else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            // preventDefault first: the browser's own step is the spinner by another name, and
            // letting both run would double every nudge.
            e.preventDefault();
            onChange(nudgeNumEditValue(value, e.key === "ArrowUp" ? 1 : -1, e.shiftKey));
          }
        }}
        style={{
          // `display:block` is load-bearing, not tidying. An <input> is inline-level, so inside a
          // <foreignObject> it sits in a LINE BOX and the strut above it drifted the field 5 px
          // below the plate it is supposed to replace (measured, in the verify harness — the same
          // trap B1140 hit with the contour hover label). A block box has no strut, so the field
          // lands exactly on the chip's rect.
          display: "block",
          width: box.w, height: box.h, fontSize: box.fontPx, borderRadius: box.rx,
          border: `1px solid ${border}`, background: plate, color: ink,
          fontFamily: NUM_FONT, fontVariantNumeric: TABULAR_NUMS, fontWeight: 600,
          textAlign: "center", padding: "0 2px", boxSizing: "border-box", outline: "none",
        }}
      />
    </foreignObject>
  );
}
