/* Numeric-value typeface token — the ONE font stack for numbers rendered as product
 * data (measurements, dollar figures, percentages, elevations, coordinates), as
 * distinct from monospace, which stays reserved for genuinely code-like content
 * (hex values, stack traces). Owner design decision (2026-07-18): what Apple (SF Pro)
 * and Google (Roboto/Material) do — ONE type family with TABULAR LINING figures for
 * column alignment, never a second monospace stack for numbers. `var()` does not
 * survive SVG-attribute usage or the canvas/PDF export rasterization (same reason
 * palette.js mirrors index.css in hex, not var() — see that file's header), so this
 * is a concrete string, not a CSS custom property, and must stay in sync with
 * `--font` in index.css by hand.
 *
 * NUM_FONT: the font-family value. TABULAR_NUMS: the font-variant-numeric value —
 * tabular (fixed digit width, so numbers still align in columns) + slashed-zero
 * (0 vs O stays unambiguous without a dedicated monospace face).
 */
export const NUM_FONT = "Inter, system-ui, sans-serif";
export const TABULAR_NUMS = "tabular-nums slashed-zero";
