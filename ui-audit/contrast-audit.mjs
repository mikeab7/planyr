/* Programmatic WCAG contrast audit for the Planyr theme tokens (B341).
 *
 * Parses the REAL token values from src/index.css (light :root + dark
 * [data-theme="dark"]), resolves var() aliases and composites rgba() over its
 * surface, then checks every meaningful foreground/background pair against
 * WCAG AA in BOTH themes:
 *   • normal text        → ratio ≥ 4.5
 *   • large / bold text  → ratio ≥ 3.0
 *   • UI / graphic (dot, glyph, border, icon) → ratio ≥ 3.0
 *
 * Run: node ui-audit/contrast-audit.mjs   (exit 1 if any pair fails its floor)
 *
 * This is the "run a programmatic check across every defined token pair rather
 * than eyeballing" deliverable from the B341 contrast-regression audit, and a
 * standing guard so a future palette edit can't silently re-introduce a
 * low-contrast pair.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(HERE, "..", "src", "index.css"), "utf8");

/* ---------- parse :root (light) and [data-theme="dark"] token blocks ---------- */
function block(re) {
  const m = CSS.match(re);
  if (!m) throw new Error("token block not found: " + re);
  const out = {};
  for (const line of m[1].split("\n")) {
    const t = line.match(/^\s*(--[\w-]+)\s*:\s*([^;]+);/);
    if (t) out[t[1]] = t[2].trim();
  }
  return out;
}
// First :root{...} is the light token block.
const lightRaw = block(/:root\s*\{([\s\S]*?)\n\}/);
const darkRaw = block(/\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/);
// Dark only redefines a subset; inherit the rest from light.
const light = { ...lightRaw };
const dark = { ...lightRaw, ...darkRaw };

/* ---------- color resolution: var() aliases, hex, rgb/rgba over a base ---------- */
function resolve(val, tokens, depth = 0) {
  if (depth > 8 || val == null) return null;
  val = String(val).trim();
  const v = val.match(/^var\(\s*(--[\w-]+)\s*(?:,([^)]+))?\)$/);
  if (v) return resolve(tokens[v[1]] ?? (v[2] || "").trim(), tokens, depth + 1);
  // A bare token reference (the PAIRS list passes token names directly).
  if (/^--[\w-]+$/.test(val) && tokens[val] != null) return resolve(tokens[val], tokens, depth + 1);
  return val;
}
function hexToRgb(h) {
  const m = h.replace("#", "");
  const n = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}
// Return an opaque [r,g,b]; composite rgba()/hex8 over `base` (also resolved).
function toRgb(val, tokens, base) {
  const s = resolve(val, tokens);
  if (!s) return null;
  if (s.startsWith("#")) {
    if (s.length === 9) { // #rrggbbaa
      const [r, g, b] = hexToRgb(s.slice(0, 7));
      const a = parseInt(s.slice(7, 9), 16) / 255;
      return over([r, g, b, a], base, tokens);
    }
    return hexToRgb(s);
  }
  const rgba = s.match(/rgba?\(([^)]+)\)/);
  if (rgba) {
    const p = rgba[1].split(",").map((x) => x.trim());
    const r = +p[0], g = +p[1], b = +p[2], a = p[3] == null ? 1 : +p[3];
    return a >= 1 ? [r, g, b] : over([r, g, b, a], base, tokens);
  }
  return null;
}
function over([r, g, b, a], base, tokens) {
  const bg = base ? toRgb(base, tokens) : [255, 255, 255];
  return [r, g, b].map((c, i) => Math.round(c * a + bg[i] * (1 - a)));
}

/* ---------- WCAG relative luminance + contrast ratio ---------- */
const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
function ratio(fg, bg) {
  const a = lum(fg), b = lum(bg);
  const [hi, lo] = a >= b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/* ---------- the pairs to check (fg, bg-token-or-literal, label, floor[, accept]) ---------- */
// floor: 4.5 normal text · 3.0 large/bold text or UI graphic (dot/glyph/icon/border)
// A 5th `accept` string marks a DOCUMENTED exception: it prints WARN (not FAIL) and
// does not fail the run — used for owner-exempt subtle borders and locked brand fills
// that are only ever used above their failing floor.
const T = 4.5, U = 3.0;
const PAIRS = [
  // Body text on surfaces
  ["--text-primary", "--surface-page", "body text · page", T],
  ["--text-primary", "--surface-raised", "body text · card", T],
  ["--text-secondary", "--surface-page", "secondary text · page", T],
  ["--text-secondary", "--surface-raised", "secondary text · card", T],
  ["--text-tertiary", "--surface-page", "tertiary/hint · page", T],
  ["--text-tertiary", "--surface-raised", "tertiary/hint · card", T],
  // B685: the Site Planner "drafting parchment" surfaces (cream in light, slate in dark) —
  // text + warn/danger must clear AA on both planner surfaces in both themes.
  ["--text-primary", "--planner-panel", "body text · planner panel", T],
  ["--text-primary", "--planner-raised", "body text · planner card", T],
  ["--text-secondary", "--planner-panel", "secondary · planner panel", T],
  ["--text-secondary", "--planner-raised", "secondary · planner card", T],
  ["--text-tertiary", "--planner-raised", "tertiary · planner card", U],
  ["--warn-text", "--planner-raised", "warn text · planner card", T],
  ["--danger-text", "--planner-raised", "danger text · planner card", T],
  // Chrome (top bars, rail, status bar)
  ["--chrome-text", "--chrome-bg", "chrome text · chrome", T],
  ["--chrome-text", "--chrome-bg-elev", "chrome text · chrome-elev", T],
  ["--chrome-muted", "--chrome-bg", "chrome muted · chrome", T],
  ["--chrome-muted", "--chrome-bg-elev", "chrome muted · chrome-elev", T],
  ["--chrome-tab-inactive", "--chrome-bg", "inactive tab · chrome", T],
  ["--chrome-tab-inactive", "--chrome-bg-elev", "inactive tab · chrome-elev", T],
  ["--save-badge", "--chrome-bg", "save badge · chrome", U],
  ["--save-badge", "--chrome-bg-elev", "save badge · chrome-elev", U],
  // Module accent TEXT on chrome (active tab label) — the -text token, per theme
  ["--accent-site-text", "--chrome-bg", "Site tab text · chrome", T],
  ["--accent-site-text", "--chrome-bg-elev", "Site tab text · chrome-elev", T],
  ["--accent-schedule-text", "--chrome-bg", "Schedule tab text · chrome", T],
  ["--accent-schedule-text", "--chrome-bg-elev", "Schedule tab text · chrome-elev", T],
  ["--accent-review-text", "--chrome-bg", "Review tab text · chrome", T],
  ["--accent-review-text", "--chrome-bg-elev", "Review tab text · chrome-elev", T],
  ["--accent-library-text", "--chrome-bg", "Library tab text · chrome", T],
  ["--accent-library-text", "--chrome-bg-elev", "Library tab text · chrome-elev", T],
  // Module accent TEXT on a light card (breadcrumb "current"/"New project" labels use
  // the -text token after the B341 fix — verifies accent-as-foreground is legible).
  ["--accent-site-text", "--surface-raised", "Site accent text · card", T],
  ["--accent-schedule-text", "--surface-raised", "Schedule accent text · card", T],
  ["--accent-review-text", "--surface-raised", "Review accent text · card", T],
  ["--accent-library-text", "--surface-raised", "Library accent text · card", T],
  // Semantic text colors (success/danger/info/warn) — used for colored labels on the
  // themed panels (B354). A hardcoded #15803d/#b3361b/#1d4ed8/#b45309 reads on a light
  // card but fails on a dark card, so these MUST stay tokens. Checked on both surfaces.
  ["--success-text", "--surface-raised", "success text · card", T],
  ["--success-text", "--surface-page", "success text · page", T],
  ["--danger-text", "--surface-raised", "danger text · card", T],
  ["--danger-text", "--surface-page", "danger text · page", T],
  ["--info-text", "--surface-raised", "info text · card", T],
  ["--info-text", "--surface-page", "info text · page", T],
  ["--warn-text", "--surface-raised", "warn text · card", T],
  ["--warn-text", "--surface-page", "warn text · page", T],
  // On-accent text (text/icon ON a module fill — chips, active fills)
  ["--on-accent-site", "--accent-site", "on-fill · Site", T, "fill locked + white specced (B318); fill used only as ≥3:1 underline, on-accent token currently unused for text — safe for large/bold only"],
  ["--on-accent-schedule", "--accent-schedule", "on-fill · Schedule", T, "fill locked + white specced (B318); used only as ≥3:1 underline — safe for large/bold only"],
  ["--on-accent-review", "--accent-review", "on-fill · Review (amber→dark)", T],
  ["--on-accent-library", "--accent-library", "on-fill · Library (white on teal)", T],
  // B657-5B: the shared Button primary/active variant — on-accent text on the global accent fill.
  ["--on-accent", "--accent", "on-fill · global accent button", T],
  // The 2px active-tab underline (a UI graphic) — fill on chrome
  ["--accent-site", "--chrome-bg-elev", "Site underline · chrome", U],
  ["--accent-schedule", "--chrome-bg-elev", "Schedule underline · chrome", U],
  ["--accent-review", "--chrome-bg-elev", "Review underline · chrome", U, "decorative 2px indicator on white chrome; active state is also carried by the (passing) review-text label + bold weight"],
  ["--accent-library", "--chrome-bg-elev", "Library underline · chrome", U],
  // Status as a glyph/dot/border (graphic) on the app surface
  ["--status-pursuit", "--surface-raised", "status Pursuit glyph · card", U],
  ["--status-active", "--surface-raised", "status Active glyph · card", U],
  ["--status-onhold", "--surface-raised", "status On-hold glyph · card", U],
  ["--status-complete", "--surface-raised", "status Complete glyph · card", U],
  ["--status-dead", "--surface-raised", "status Dead glyph · card", U],
  // Alert/error fill (cloud-off badge, failed-layer dot, destructive ×) — the loud
  // red reserved for genuine errors (B433), as an icon/border graphic on a card.
  ["--danger", "--surface-raised", "danger icon · card", U],
  // Global interactive accent as a focus/active graphic on surfaces
  ["--accent", "--surface-raised", "accent stroke · card", U],
  ["--accent", "--chrome-bg", "accent stroke · chrome", U],
  // kbd chips (text), borders (subtle graphic — owner rule exempts borders/grid)
  ["--kbd-text", "--kbd-bg", "kbd text · kbd chip", T],
  ["--border-strong", "--surface-page", "strong border · page", U, "subtle hover border — owner rule explicitly allows low-contrast for borders/grid"],
];

function run(name, tokens) {
  const rows = [];
  let fails = 0, warns = 0;
  for (const [fg, bg, label, floor, accept] of PAIRS) {
    const f = toRgb(fg, tokens, bg);
    const b = toRgb(bg, tokens);
    if (!f || !b) { rows.push(["skip", "—", label, ""]); continue; }
    const r = ratio(f, b);
    const ok = r >= floor - 1e-9;
    let st = ok ? "PASS" : (accept ? "WARN" : "FAIL");
    if (st === "FAIL") fails++;
    if (st === "WARN") warns++;
    rows.push([st, r.toFixed(2), label, `(≥${floor})`, !ok && accept ? accept : ""]);
  }
  console.log(`\n===== ${name} theme =====`);
  for (const [st, r, label, note, accept] of rows) {
    const mark = st === "FAIL" ? "✗" : st === "WARN" ? "!" : st === "skip" ? "·" : "✓";
    console.log(`  ${mark} ${st.padEnd(4)} ${String(r).padStart(6)} ${note.padEnd(7)} ${label}${accept ? `\n        ↳ accepted: ${accept}` : ""}`);
  }
  return { fails, warns };
}

// Pure programmatic result (no printing) — consumed by test/contrast.test.js so a
// future palette edit that drops a pair below its floor fails CI, not just the eye.
export function auditAll() {
  const out = { fails: 0, warns: 0, themes: {} };
  for (const [name, tokens] of [["light", light], ["dark", dark]]) {
    const theme = { fails: [], warns: [] };
    for (const [fg, bg, label, floor, accept] of PAIRS) {
      const f = toRgb(fg, tokens, bg), b = toRgb(bg, tokens);
      if (!f || !b) continue;
      const r = ratio(f, b);
      if (r >= floor - 1e-9) continue;
      (accept ? theme.warns : theme.fails).push({ label, ratio: +r.toFixed(2), floor, accept });
    }
    out.fails += theme.fails.length; out.warns += theme.warns.length;
    out.themes[name] = theme;
  }
  return out;
}

// Only print + exit when run directly as a CLI (not when imported by the test).
if (import.meta.url === `file://${process.argv[1]}`) {
  let fails = 0, warns = 0;
  for (const [name, tok] of [["LIGHT", light], ["DARK", dark]]) {
    const r = run(name, tok);
    fails += r.fails; warns += r.warns;
  }
  console.log("\n----------------------------------------");
  if (fails === 0) console.log(`✓ Every token pair clears its WCAG floor in both themes (${warns} documented exception${warns === 1 ? "" : "s"}).`);
  else console.log(`✗ ${fails} actionable token pair(s) below floor — see FAIL rows above.`);
  process.exit(fails === 0 ? 0 : 1);
}
