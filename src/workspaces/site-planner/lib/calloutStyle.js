/* Text box / callout OUTLINE + FILL style (B1652704/B1652705, "NEW-1"/"NEW-2").
 *
 * WHAT WAS WRONG. A text box/callout stored a flat colour for its outline and nothing else — no
 * thickness, no dash pattern, no opacity on either the outline or the fill. Every other drawn
 * object with an outline (a parcel, a markup shape, a measurement — see measureStyle.js) already
 * carries the full weight/dash/opacity taxonomy; this was the one gap. This module is the ONE
 * resolver for a callout's line + fill style, so the canvas and the Properties panel can never
 * drift from each other.
 *
 * THE LEADER LINE IS PART OF THE OUTLINE. A callout's leader (the stub + run + arrowhead pointing
 * at what it labels) reads the SAME resolved weight/dash/opacity as the box border — there is no
 * separate leader style. Shipping a dashed box with a solid leader would be the wrong outcome.
 *
 * FILL OPACITY NEVER TOUCHES THE TEXT. The text is painted as its own <text> node with its own
 * `color`, entirely apart from the box's `fill` — a translucent fill under fully opaque type is
 * the point (drop a label on an aerial and still read it), not a bug to fix.
 *
 * BACK-COMPAT. `CALLOUT_LINE` is deliberately NOT the polygon default (weight 2) — it is what a
 * text box/callout has always rendered at, measured off the pre-existing hardcoded render: a
 * 1.4px solid, fully opaque box border (the leader itself rendered at a separately-hardcoded 1.6px
 * with no dash; unifying it onto the box's own value is this item's whole point — see the render
 * call site). An existing saved callout with no weight/dash/opacity/fillOpacity therefore resolves
 * to CALLOUT_LINE and renders the box border pixel-identical to before.
 *
 * Pure (no React/DOM) so it unit-tests without a browser. Tests: test/calloutStyle.test.js.
 *
 * B1652707 — the default text/outline ink and fill are TOKENS (`shared/theme/familyInk.js`),
 * never raw hex literals here: `FAMILY_DEFAULT_INK.callout` is the SAME slate this module used to
 * hardcode twice, and `familyInk.js`'s own header already named it "SitePlanner calloutStyle
 * default border/ink … on its cream plate" — this is that consolidation, not a new value.
 */
import { FAMILY_DEFAULT_INK, CALLOUT_DEFAULT_FILL } from "../../../shared/theme/familyInk.js";

export const CALLOUT_LINE = { weight: 1.4, dash: "solid", opacity: 1, fillOpacity: 1 };

/** The style keys a callout/text box can carry, in panel order. */
export const CALLOUT_STD_KEYS = ["weight", "dash", "opacity", "fillOpacity"];

/**
 * Resolved style for a callout/text box: every field the box, its leader and the Properties panel
 * read, defaults included. `c` may be a bare `{}` (a freshly placed callout, or the WYSIWYG
 * editor's live-typed draft) — every field falls back to its historic built-in value.
 */
export function calloutStyle(c) {
  const o = c || {};
  return {
    size: o.size || 13,
    color: o.color || FAMILY_DEFAULT_INK.callout,
    fill: o.fill || CALLOUT_DEFAULT_FILL,
    stroke: o.stroke || FAMILY_DEFAULT_INK.callout,
    align: o.align || "center",
    bold: !!o.bold,
    italic: !!o.italic,
    underline: !!o.underline,
    padX: o.padX ?? 14, padY: o.padY ?? 8,
    lineHeight: o.lineHeight ?? 1.3,
    weight: Number.isFinite(o.weight) && o.weight > 0 ? o.weight : CALLOUT_LINE.weight,
    dash: o.dash || CALLOUT_LINE.dash,
    opacity: Number.isFinite(o.opacity) ? o.opacity : CALLOUT_LINE.opacity,
    fillOpacity: Number.isFinite(o.fillOpacity) ? o.fillOpacity : CALLOUT_LINE.fillOpacity,
  };
}
