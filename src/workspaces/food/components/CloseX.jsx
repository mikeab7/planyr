/* CloseX — THE one close / remove "X" in /food (NEW-4, 2026-10-11, owner: the sheet's close X sat in a circle while the
 * X beside each dish name was plain). A bare ✕ glyph, no ring, no fill, with a generous invisible touch target (44 square
 * by default). Every close/remove X in the Food sheets and forms renders through this so they cannot drift apart again
 * (test/foodCloseX.test.js fails on a second bordered/round X). */
export default function CloseX({ onClick, label = "Close", testId, size = 44, style }) {
  return (
    <button
      type="button" onClick={onClick} aria-label={label} data-testid={testId} data-food-close-x=""
      style={{
        flex: "0 0 auto", width: size, height: size, minWidth: size, minHeight: size, padding: 0,
        border: "none", background: "none", color: "var(--text-tertiary)", cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1,
        fontSize: 16, // design-exempt: a bare close glyph has no label beside it, so it reads clearly above FONT_SIZE.control
        ...style,
      }}
    >
      ✕
    </button>
  );
}
