/* Planyr brand tokens — the coral mark palette, in one place.
 *
 * These mirror the CSS custom properties in src/index.css (:root, the
 * "Brand — Planyr coral" group). JS components style inline (not via CSS vars),
 * so the BrandMark component and any other inline-styled chrome import from here;
 * plain CSS reaches for the var(--coral-*) twins. Keep the two in sync.
 *
 * The mark is an isometric stack of three floating tiers. Each tier has a lit top
 * face and two progressively darker side faces (sideL = front-left, sideR = front-right):
 *   base — coral        top
 *   mid  — warm coral   middle
 *   top  — light coral  top of stack
 */
export const BRAND = {
  coral: {
    base: { face: "#A8482B", sideL: "#963F26", sideR: "#823620" },
    mid:  { face: "#DC6B42", sideL: "#C85F3A", sideR: "#B25431" },
    top:  { face: "#F8946A", sideL: "#E8825A", sideR: "#D6744E" },
  },
  // Linework for the full-finish mark, tuned to read on a dark surface.
  line: { grid: "#E89A78", glassEdge: "#F0A888", wire: "#FBB89A" },
  // Surfaces the mark sits on.
  surface: { ink: "#15171C", cream: "#F4EFE6" },
  // Wordmark ("planyr") colour, by the surface behind it.
  wordmark: { onDark: "#F4F1E9", onLight: "#2A211C" },
};

export default BRAND;
