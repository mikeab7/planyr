/* Model workspace — Univer theme from Planyr's own tokens (spike; docs/SPREADSHEET-UNIVER-SPIKE.md).
 *
 * Univer paints its toolbar, formula bar and tabs from a colour theme (a `primary` scale and a `gray` scale).
 * Planyr's chrome is defined by CSS tokens (`--accent-model`, `--surface-raised`, `--chrome-divider`, …) that
 * flip with the light / dark theme, so the theme is BUILT from those tokens at mount, never hard-coded.
 * Pure: takes the resolved token values (read by UniverSheet.jsx) and the base theme, returns a theme object.
 *
 * What a theme CANNOT do (so it is listed in the report instead of faked): Univer draws the grid itself on a
 * canvas with its own header strips, selection colours and fonts; its toolbar is Univer's, not Planyr's flat
 * Ribbon. The flat-chrome overrides live in components/univerSheet.css. */

const hex = (s) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(s || "").trim());
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  const m3 = /^#?([0-9a-f]{3})$/i.exec(String(s || "").trim());
  if (m3) return m3[1].split("").map((c) => parseInt(c + c, 16));
  const rgb = /^rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/i.exec(String(s || ""));
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
};
const toHex = (a) => `#${a.map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** A 50…900 scale around `accent` (500 = the accent itself): lighter steps mix toward white, darker toward black. */
export function scaleFrom(accent) {
  const base = hex(accent);
  if (!base) return null;
  const white = [255, 255, 255], black = [0, 0, 0];
  const steps = { 50: [white, 0.92], 100: [white, 0.85], 200: [white, 0.7], 300: [white, 0.5], 400: [white, 0.25], 500: [base, 0], 600: [black, 0.12], 700: [black, 0.25], 800: [black, 0.4], 900: [black, 0.55] };
  const out = {};
  for (const [k, [to, t]] of Object.entries(steps)) out[k] = toHex(mix(base, to, t));
  return out;
}

/** `tokens` = { accent, border, surface, text } resolved colour strings. Returns a copy of `base` with the
 *  primary scale from the accent and the hairline grey (200) from Planyr's divider; a bad token leaves that part
 *  of the base theme alone (never throws, never a blank colour). */
export function buildUniverTheme(base, tokens = {}) {
  const theme = { ...base, primary: { ...base.primary }, gray: { ...base.gray } };
  const scale = scaleFrom(tokens.accent);
  if (scale) theme.primary = scale;
  const border = hex(tokens.border);
  if (border) theme.gray = { ...theme.gray, 200: toHex(border) };
  const surface = hex(tokens.surface);
  if (surface) theme.gray = { ...theme.gray, 0: toHex(surface) };
  const text = hex(tokens.text);
  if (text) theme.gray = { ...theme.gray, 900: toHex(text) };
  return theme;
}

/** The Planyr tokens Univer's theme is built from (read from the live document so a theme flip is followed). */
export const THEME_TOKEN_VARS = { accent: "--accent-model", border: "--chrome-divider", surface: "--surface-raised", text: "--text-primary" };
