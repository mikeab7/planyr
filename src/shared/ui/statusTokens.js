/* Project-lifecycle STATUS visual tokens — the ONE source of truth for how each
 * deal stage looks. Each state gets EXACTLY ONE color + ONE marker shape/glyph;
 * every surface (left-rail filter chips, left-rail list markers, map pins, the
 * status-section headers, the right-click status menu) reads from here so the
 * surfaces can never drift apart again (B234). Pure constants — no React — so JSX
 * chrome and pure helpers/tests can all share them (same pattern as moduleAccent).
 *
 * IMPORTANT — two DIFFERENT color axes, never mixed:
 *   • STATUS color (here): the deal stage of a project. Used on dots/chips/pins.
 *   • MODULE accent (moduleAccent.js: Site #1D9E75 / Schedule #7F77DD / Markup
 *     #EF9F27): which workspace you're in. Confined to the top tab row — NEVER a
 *     status dot, chip, or pin. (Before B234 the pins wrongly borrowed the module
 *     greens/ambers for status, which is the mismatch this set closes.) These are a
 *     DELIBERATELY SEPARATE palette — never source a status color from an accent
 *     token, and vice versa (B365).
 *
 * VISUAL-HIERARCHY rule (B365): salience MUST track importance. The stage that
 * needs the eye — Pursuit — is the loudest (solid warm coral, biggest, thickest
 * halo, full opacity); settled stages recede (Complete is small, gray, semi-
 * transparent; Dead is a faint hollow outline, hidden on the map by default). The
 * earlier scheme inverted this — Pursuit was a thin dashed cool-blue outline that
 * vanished into the aerial while Complete shouted — which this set fixes.
 *
 * Color assignments (B365): Pursuit = coral (warm = advances toward the eye);
 * Active = blue (deliberately NOT green, so it never collides with the Site module
 * accent green #1D9E75); On&nbsp;Hold = amber; Complete = neutral gray; Dead = red ✕.
 * Glyph language is intentionally paired so status reads WITHOUT color too (color-
 * blind safe): flag = Pursuit, pulse/activity-line = Active, pause ‖ = On Hold,
 * check ✓ = Complete, ✕ = Dead.
 */
// Per-state fields:
//   color / darkColor — canonical status hex. Map pins use `color` directly (the
//     aerial is a theme-neutral surface, so the saturated color holds in both
//     themes); DOM badges read the theme-aware --status-* CSS vars (index.css,
//     which MIRROR these) — `darkColor` is the lighter value those vars use in dark
//     mode so the badge doesn't go muddy. Keep the two in sync (B234 / B320).
//   glyph  — the DOM text glyph (chips / list dots / menu).
//   shape  — the MAP glyph selector → an inline white SVG in buildingPinIcon.
//   hollow / dashed / struck — DOM badge treatment (hollow = outline-only dot;
//     struck = strike-through label for a killed deal).
//   --- map-pin only (read solely by buildingPinIcon, B365) ---
//   halo       — width (px) of the white outer halo that keeps the pin legible over
//                busy imagery; scales with importance.
//   tier       — relative pin size (1 = largest/Pursuit → smallest/Complete).
//   mapOpacity — pin opacity (settled stages recede).
//   z          — base Leaflet zIndexOffset so the important stages render ON TOP
//                (a Complete pin must never occlude a Pursuit pin where they overlap).
//   mapHollow      — draw the pin as a faint hollow outline (Dead).
//   hideByDefault  — omit the pin from the map unless the user explicitly filters to it.
export const STATUS_TOKENS = {
  pursuit:  { color: "#D85A30", darkColor: "#F08A5D", glyph: "⚑", shape: "flag",  hollow: false, dashed: false, struck: false,
              halo: 3,   tier: 1.00, mapOpacity: 1,    z: 400 },
  active:   { color: "#378ADD", darkColor: "#6FB4F0", glyph: "●", shape: "pulse", hollow: false, dashed: false, struck: false,
              halo: 2.5, tier: 0.90, mapOpacity: 1,    z: 300 },
  onhold:   { color: "#BA7517", darkColor: "#E0A23E", glyph: "‖", shape: "pause", hollow: false, dashed: false, struck: false,
              halo: 2,   tier: 0.82, mapOpacity: 1,    z: 200 },
  complete: { color: "#888780", darkColor: "#9DA3AD", glyph: "✓", shape: "check", hollow: false, dashed: false, struck: false,
              halo: 2,   tier: 0.72, mapOpacity: 0.65, z: 100 },
  dead:     { color: "#E24B4A", darkColor: "#F2706F", glyph: "✕", shape: "x",     hollow: false, dashed: false, struck: true,
              halo: 1.5, tier: 0.66, mapOpacity: 0.5,  z: 50, mapHollow: true, hideByDefault: true },
};

// Token for a status key, defaulting to pursuit for any unknown/missing value.
export const statusToken = (st) => STATUS_TOKENS[st] || STATUS_TOKENS.pursuit;

// Darken a #rrggbb hex by fraction f (0..1) — used to derive a marker's thin edge
// stroke from its single status color (so there is still only ONE authored color
// per state; the edge is just a shade of it).
export function darken(hex, f = 0.28) {
  const n = parseInt(String(hex).slice(1), 16);
  if (!isFinite(n)) return hex;
  const m = 1 - f;
  const ch = (c) => Math.max(0, Math.min(255, Math.round(c * m))).toString(16).padStart(2, "0");
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}
