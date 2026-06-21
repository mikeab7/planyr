/* Theme palette — the JS mirror of the CSS custom-property tokens in src/index.css.
 *
 * Two surfaces, one source of truth. `src/index.css` defines the tokens for first
 * paint, all CSS rules, and the HTML chrome (consumed as var(--…)). This file holds
 * the SAME values as real hex strings for the drafting canvas + Markup viewer, where
 * var() does NOT resolve — SVG presentation attributes (`fill=`, `stroke=`) ignore
 * custom properties, and var() would not survive the canvas → PNG/PDF export
 * rasterization either. So canvas colors must be concrete at render time.
 *
 * KEEP THE TWO IN SYNC. (Same established pattern as src/shared/brand/tokens.js ↔
 * the --coral-* vars in index.css.) (B316 / B317 / B318 / B319)
 */

const LIGHT = {
  /* Surfaces */
  surfacePage: "#F3F5F8", surfaceRaised: "#FFFFFF",
  borderDefault: "#E1E5EB", borderStrong: "#CDD3DC",
  textPrimary: "#1B1E26", textSecondary: "#353B49", textTertiary: "#4B5263",
  /* Chrome (themes with the app) */
  chromeBg: "#EAEEF3", chromeBgElev: "#FFFFFF", chromeDivider: "#D7DDE5",
  chromeText: "#1B1E26", chromeMuted: "#353B49", chromeTabInactive: "#454C5C",
  saveBadge: "#0F6E56",
  /* Global interactive accent (focus/forms/buttons) — replaces the retired ember */
  accent: "#C2410C", onAccent: "#FFFFFF",
  /* Work surfaces — drafting canvas + Markup mat */
  canvasBg: "#EDF1F6", canvasGridMinor: "#DCE3EB", canvasGridMajor: "#C5CED9",
  canvasParcel: "#5b6650", canvasSetback: "#b45309", canvasSelection: "#C2410C",
  canvasAccentSoft: "#f0d9cc", canvasMat: "#DCE1E8",
  /* Module accents — fills fixed both themes; -text swaps */
  accentSite: "#1D9E75", accentSchedule: "#7F77DD", accentMarkup: "#EF9F27",
  accentSiteText: "#0F6E56", accentScheduleText: "#534AB7", accentMarkupText: "#8A5410",
  /* Strong accent for TEXT sitting on the soft-accent fill (selected menu row /
     "current" marker). The plain accent (#C2410C) is only 3.8:1 on canvasAccentSoft —
     this darker value clears AA there; dark theme keeps the bright accent. */
  accentStrong: "#9A3412",
  /* Semantic TEXT colors (mirror of the --success/danger/info/warn-text tokens) for the
     canvas-adjacent inline styles that read PAL instead of var(). */
  warnText: "#8A5410", successText: "#15803D", dangerText: "#B3361B", infoText: "#1D4ED8", purpleText: "#534AB7",
};

const DARK = {
  /* Surfaces */
  surfacePage: "#14161B", surfaceRaised: "#1D2027",
  borderDefault: "#2A2E37", borderStrong: "#3A3F4B",
  textPrimary: "#E8EBF0", textSecondary: "#CAD0DA", textTertiary: "#A4ABB8",
  /* Chrome */
  chromeBg: "#111319", chromeBgElev: "#171A21", chromeDivider: "#262A33",
  chromeText: "#ECEFF4", chromeMuted: "#A6ADBA", chromeTabInactive: "#C2C8D2",
  saveBadge: "#7FD8B8",
  /* Global interactive accent — light enough (B319) that on-fill text goes near-black */
  accent: "#F26B3A", onAccent: "#15171C",
  /* Work surfaces */
  canvasBg: "#0E1014", canvasGridMinor: "rgba(232,235,240,0.05)", canvasGridMajor: "rgba(232,235,240,0.10)",
  canvasParcel: "#2FBE90", canvasSetback: "#E0954A", canvasSelection: "#F26B3A",
  canvasAccentSoft: "rgba(242,107,58,0.18)", canvasMat: "#0E1014",
  /* Module accents — fills unchanged; -text is the light-on-dark set */
  accentSite: "#1D9E75", accentSchedule: "#7F77DD", accentMarkup: "#EF9F27",
  accentSiteText: "#5DCAA5", accentScheduleText: "#AFA9EC", accentMarkupText: "#EF9F27",
  /* On dark, the soft-accent fill is a low-alpha tint over the dark surface, so the
     bright accent already clears AA against it — keep it. */
  accentStrong: "#F26B3A",
  /* Semantic TEXT colors — lightened for the dark panels. */
  warnText: "#EFB54E", successText: "#4FBF7B", dangerText: "#F2706F", infoText: "#6FB4F0", purpleText: "#AFA9EC",
};

export const PALETTES = { light: LIGHT, dark: DARK };

export function paletteFor(resolved) {
  return resolved === "dark" ? DARK : LIGHT;
}
