/* Project-lifecycle STATUS visual tokens — the ONE source of truth for how each
 * deal stage looks. Each state gets EXACTLY ONE color + ONE marker shape/glyph;
 * every surface (left-rail filter chips, left-rail list markers, map pins, the
 * status-section headers, the right-click status menu) reads from here so the
 * three can never drift apart again (B234). Pure constants — no React — so JSX
 * chrome and pure helpers/tests can all share them (same pattern as moduleAccent).
 *
 * IMPORTANT — two DIFFERENT color axes, never mixed:
 *   • STATUS color (here): the deal stage of a project. Used on dots/chips/pins.
 *   • MODULE accent (moduleAccent.js: Site #1D9E75 / Schedule #7F77DD / Markup
 *     #EF9F27): which workspace you're in. Confined to the top tab row — NEVER a
 *     status dot, chip, or pin. (Before B234 the pins wrongly borrowed the module
 *     greens/ambers for status, which is the mismatch this set closes.)
 *
 * Reassignment rationale (B234): Complete moved green→gray so GREEN reads as
 * "Active" only; settled stages (Complete/Dead) recede while the stages that need
 * a decision (Pursuit/Active/On&nbsp;Hold) stand out. Dead is a deliberate red ✕ with
 * a struck-through label — a killed deal you can still see but that reads as closed.
 */
// `color` is the canonical status hex (used on map pins — pins sit on the aerial map,
// a theme-neutral surface, so they keep the canonical color in both themes). On DARK
// app surfaces (cards/panels) the saturated values go muddy, so each carries a lighter
// `darkColor` variant; DOM badges consume these via the --status-* CSS vars in
// index.css (which mirror these). (B234 / B320)
export const STATUS_TOKENS = {
  pursuit:  { color: "#378ADD", darkColor: "#6FB4F0", glyph: "○", shape: "ring",  hollow: true,  dashed: true,  struck: false, dim: false },
  active:   { color: "#639922", darkColor: "#8FCB4E", glyph: "●", shape: "dot",   hollow: false, dashed: false, struck: false, dim: false },
  onhold:   { color: "#BA7517", darkColor: "#E0A23E", glyph: "‖", shape: "pause", hollow: false, dashed: false, struck: false, dim: false },
  complete: { color: "#888780", darkColor: "#9DA3AD", glyph: "✓", shape: "check", hollow: false, dashed: false, struck: false, dim: true  },
  dead:     { color: "#E24B4A", darkColor: "#F2706F", glyph: "✕", shape: "x",     hollow: false, dashed: false, struck: true,  dim: true  },
};

// Token for a status key, defaulting to pursuit for any unknown/missing value.
export const statusToken = (st) => STATUS_TOKENS[st] || STATUS_TOKENS.pursuit;

// Darken a #rrggbb hex by fraction f (0..1) — used to derive a marker's stroke
// from its single status color (so there is still only ONE authored color per
// state; the outline is just a shade of it).
export function darken(hex, f = 0.28) {
  const n = parseInt(String(hex).slice(1), 16);
  if (!isFinite(n)) return hex;
  const m = 1 - f;
  const ch = (c) => Math.max(0, Math.min(255, Math.round(c * m))).toString(16).padStart(2, "0");
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}
