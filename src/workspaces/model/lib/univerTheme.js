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
/** Univer's dark-mode canvas colour transform (core `invertColorByMatrix`): out_i = in_i − 0.667·(r+g+b) + 1, normalised 0..1,
 *  so it keeps each colour's chroma and flips its lightness. Its exact PRE-IMAGE: the input that lands on screen as `target`. */
const invert = (a) => {
  const t = a.map((v) => v / 255);
  const sum = (3 - (t[0] + t[1] + t[2])) / 1.001;
  return t.map((d) => (d + 0.667 * sum - 1) * 255);
};

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

/** `tokens` = { accent, border, surface, text } resolved colour strings; `dark` = the app is in its dark theme.
 *
 * Univer's gray scale is FIXED-DIRECTION in both modes (0 lightest … 900 darkest); its dark mode does not flip the scale,
 * it swaps to `dark:` classes that pick the OTHER end of it — text becomes `gray.0`, the background `gray.800`, a hover or
 * selected row `gray.600` / `gray.700` (read from its own bundles). So writing Planyr's dark surface into `gray.0` and its
 * light text into `gray.900` (what the first cut did, correct only in the light theme) turns every dark-mode label and tool
 * icon into dark-on-dark. Hence one rule per mode:
 *   light  gray.0 = surface · gray.200 = hairline · gray.900 = text
 *   dark   gray.0 = text    · gray.200 = hairline · gray.800 = surface · gray.700 / 600 = surface stepped toward the text
 * Returns a copy of `base`; a bad token leaves that part of the base theme alone (never throws, never a blank colour). */
export function buildUniverTheme(base, tokens = {}, { dark = false } = {}) {
  const theme = { ...base, primary: { ...base.primary }, gray: { ...base.gray } };
  const scale = scaleFrom(tokens.accent);
  if (scale) theme.primary = scale;
  const border = hex(tokens.border), surface = hex(tokens.surface), text = hex(tokens.text);
  if (border) theme.gray[200] = toHex(border);
  if (dark) {
    // The canvas (grid lines, header strips) is painted through Univer's own colour INVERSION in dark mode, so those
    // two steps are written pre-inverted: what lands on screen is the hairline / header tint we mean.
    if (border) theme.gray[200] = toHex(invert(border));
    if (surface && text) theme.gray[50] = toHex(invert(mix(surface, text, 0.06)));
    if (text) theme.gray[0] = toHex(text);
    if (surface) {
      theme.gray[800] = toHex(surface);
      theme.gray[900] = toHex(surface);
      if (text) { theme.gray[700] = toHex(mix(surface, text, 0.1)); theme.gray[600] = toHex(mix(surface, text, 0.18)); }
    }
  } else {
    if (surface) theme.gray[0] = toHex(surface);
    if (text) theme.gray[900] = toHex(text);
  }
  return theme;
}

/** The Planyr tokens Univer's theme is built from (read from the live document so a theme flip is followed). */
export const THEME_TOKEN_VARS = { accent: "--accent-model", border: "--chrome-divider", surface: "--surface-raised", text: "--text-primary" };
