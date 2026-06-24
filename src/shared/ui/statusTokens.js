/* Project-lifecycle STATUS visual tokens — the ONE source of truth for how each
 * deal stage looks. Each state gets EXACTLY ONE color + (for the glyphed stages)
 * ONE marker glyph; every surface (left-rail filter chips, left-rail list markers,
 * map pins, the status-section headers, the right-click status menu) reads from here
 * so the surfaces can never drift apart again (B234). Pure constants — no React — so
 * JSX chrome and pure helpers/tests can all share them (same pattern as moduleAccent).
 *
 * IMPORTANT — two DIFFERENT color axes, never mixed:
 *   • STATUS color (here): the deal stage of a project. Used on dots/chips/pins.
 *   • MODULE accent (moduleAccent.js: Site #1D9E75 / Schedule #7F77DD / Review
 *     #EF9F27): which workspace you're in. Confined to the top tab row — NEVER a
 *     status dot, chip, or pin. (Before B234 the pins wrongly borrowed the module
 *     greens/ambers for status, which is the mismatch this set closes.) These are a
 *     DELIBERATELY SEPARATE palette — never source a status color from an accent
 *     token, and vice versa (B365).
 *
 * VISUAL-HIERARCHY rules (B365, refined B433) — three standing rules:
 *   1. Salience is MONOTONIC, Pursuit loudest → Dead quietest. Pursuit is the
 *      biggest, fullest-opacity disc; settled stages recede (Complete + Dead are
 *      smaller, gray, and dimmed). The earlier scheme inverted this.
 *   2. Map markers are ALWAYS solid-filled with a white keyline — never a
 *      transparent/hollow primary marker on the aerial (a thin hollow ring vanishes
 *      over green imagery). Dead used to be a hollow outline; it is now a solid (but
 *      small + dim) gray disc.
 *   3. RED is reserved for genuine alert/error (the --danger CSS token), NEVER an
 *      inert state. Dead is therefore neutral gray (✕ + strike), not red.
 *
 * Color assignments: Pursuit = coral (warm = advances toward the eye); Active = blue
 * (deliberately NOT green, so it never collides with the Site module accent green
 * #1D9E75, and the warm-coral/cool-blue split stays legible for red-green-colorblind
 * viewers); On&nbsp;Hold = amber; Complete = neutral gray; Dead = the SAME neutral
 * gray (distinguished from Complete by glyph + strike, not hue). Pursuit and Active
 * are glyphless SOLID DISCS — color, size, and the ground-ring progress sweep
 * distinguish them; the colorblind-safe second cue is the glyph on the settled
 * stages: pause ‖ = On Hold, check ✓ = Complete, ✕ = Dead.
 */
// Per-state fields:
//   color / darkColor — canonical status hex. Map pins use `color` directly (the
//     aerial is a theme-neutral surface, so the saturated color holds in both
//     themes); DOM badges read the theme-aware --status-* CSS vars (index.css,
//     which MIRROR these) — `darkColor` is the lighter value those vars use in dark
//     mode so the badge doesn't go muddy. Keep the two in sync (B234 / B320).
//   glyph  — the DOM text glyph (chips / list dots / menu); "" = a plain solid disc
//            (Pursuit / Active).
//   shape  — the MAP glyph selector → an inline white SVG in sitePinIcon; "" = none.
//   dim    — true for the recessive settled stages (Complete / Dead); pairs with the
//            reduced mapOpacity so loudness tracks importance.
//   hollow / dashed / struck — DOM badge treatment (hollow = outline-only dot — now
//     always false, see rule 2; struck = strike-through label for a killed deal).
//   --- map-pin only (read solely by sitePinIcon) ---
//   halo       — width (px) of the white outer keyline/halo that keeps the pin
//                legible over busy imagery; scales with importance.
//   tier       — relative pin size (1 = largest/Pursuit → smallest/Dead).
//   mapOpacity — pin opacity (settled stages recede).
//   z          — base Leaflet zIndexOffset so the important stages render ON TOP
//                (a Complete pin must never occlude a Pursuit pin where they overlap).
//   hideByDefault  — omit the pin from the map unless the user explicitly filters to it.
export const STATUS_TOKENS = {
  pursuit:  { color: "#D85A30", darkColor: "#F08A5D", glyph: "",  shape: "",      hollow: false, dashed: false, struck: false, dim: false,
              halo: 3,   tier: 1.00, mapOpacity: 1,    z: 400 },
  active:   { color: "#378ADD", darkColor: "#6FB4F0", glyph: "",  shape: "",      hollow: false, dashed: false, struck: false, dim: false,
              halo: 2.5, tier: 0.90, mapOpacity: 1,    z: 300 },
  onhold:   { color: "#BA7517", darkColor: "#E0A23E", glyph: "‖", shape: "pause", hollow: false, dashed: false, struck: false, dim: false,
              halo: 2,   tier: 0.82, mapOpacity: 1,    z: 200 },
  complete: { color: "#888780", darkColor: "#9DA3AD", glyph: "✓", shape: "check", hollow: false, dashed: false, struck: false, dim: true,
              halo: 2,   tier: 0.72, mapOpacity: 0.65, z: 100 },
  dead:     { color: "#888780", darkColor: "#9DA3AD", glyph: "✕", shape: "x",     hollow: false, dashed: false, struck: true,  dim: true,
              halo: 1.6, tier: 0.64, mapOpacity: 0.5,  z: 50, hideByDefault: true },
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
