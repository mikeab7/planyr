#!/usr/bin/env node
/* ui-inventory.mjs — the computed-style control inventory behind docs/UI-INVENTORY.md (NEW-3).
 *
 * WHY THIS EXISTS. Owner report: "multiple different radii and corner treatments visible on the
 * MAIN MENU alone" — and he does not want this policed by eye. A source grep can miss what
 * actually paints (a token resolved through three layers of spread, a value computed from a
 * shared constant, an inherited default) and can flag things that never render (dead code, a
 * disabled branch). This renders the REAL app headlessly, in both themes, and reads
 * `getComputedStyle` off every interactive/chrome element it can reach — the same principle as
 * ui-audit/audit-chrome.mjs's screenshot pass, but reading computed style instead of pixels.
 *
 * SCOPE, deliberately: this walks the surfaces reachable LOGGED OUT with a locally-seeded demo
 * site (ATTEMPT-BEFORE-YOU-PARK — a Claude-doable check must not be deferred to a live pass) —
 * the Site Planner (header, the dropdown menus it opens, the tool rail, the left rail, the Yield
 * panel), Library, and Doc Review's empty state. It does not attempt every dialog in the app (an
 * auth-gated modal, a signed-in-only settings pane) — those stay on VERIFICATION.md's live-verify
 * list like everything else that needs a real account.
 *
 * GROUPING — "Main menu" is specifically the dropdown MENU PANELS the header opens (File ▾,
 * Undo/Redo history, Settings gear), not the header bar itself. AnchoredMenu portals every open
 * panel to `document.body` stamped `[data-menu-owner]` (src/shared/ui/AnchoredMenu.jsx), so this
 * is a real, principled DOM distinction, not an arbitrary label: "App header" is what's always on
 * screen, "Main menu" is what a click reveals — and the owner's report is squarely about the
 * latter looking inconsistent with the toolbar that opens it.
 *
 * ATTRIBUTION IS BEST-EFFORT. A computed-style walk has no source location, so `attribute()` greps
 * `src/` for the element's own visible text/aria-label/title as a literal string and reports the
 * first match. This can miss or over-match on a generic label ("▾", "File") — every row says so
 * plainly rather than pretending to a precision this method doesn't have.
 *
 * USAGE (preview server must be running — `npx vite build && npx vite preview --port 4173`):
 *   node ui-audit/ui-inventory.mjs                 → regenerate docs/UI-INVENTORY.md
 *   node ui-audit/ui-inventory.mjs --check          → CI drift gate (diff against the committed file)
 *   BASE_URL=http://localhost:4173/ node ui-audit/ui-inventory.mjs
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { RADIUS } from "../src/shared/ui/radius.js";
import { FONT_SIZE } from "../src/shared/ui/designTokens.js";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const OUT_MD = join(REPO, "docs", "UI-INVENTORY.md");
const BASE = process.env.BASE_URL || "http://localhost:4173/";

// Corner radii that always read as deliberate: the four RADIUS.js steps, plus 0 (a square
// corner is never "off-scale" — there's no smaller step to compare it against).
const RADIUS_OK = new Set([0, ...Object.values(RADIUS)]);
const FONT_OK = new Set(Object.values(FONT_SIZE));

const parcel = { id: "pc1", locked: false, points: [{ x: -440, y: -160 }, { x: 440, y: -160 }, { x: 440, y: 300 }, { x: -440, y: 300 }] };
const els = [
  { id: "e1", type: "building", cx: 0, cy: -40, w: 420, h: 180, rot: 0 },
  { id: "e2", type: "paving", cx: 0, cy: 132, w: 420, h: 120, rot: 0 },
  { id: "e3", type: "parking", cx: -330, cy: -40, w: 150, h: 180, rot: 0 },
  { id: "e4", type: "pond", cx: 330, cy: 165, w: 190, h: 120, rot: 0 },
];
const demoSite = {
  id: "uiaudit-inv", groupId: "uiaudit-inv", site: "UI Inventory Demo", name: "Plan 1",
  origin: null, county: null, parcels: [parcel], els, measures: [], callouts: [],
  markups: [], settings: {}, underlay: null, updatedAt: Date.now(),
};
const seed = (theme) => `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [demoSite.id]: demoSite })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(demoSite.id)});
  localStorage.setItem('planyr.theme', ${JSON.stringify(theme)});
} catch (e) {} })();`;

// ⛔ CONFIRMED BUG (found auditing this script's own claims, not during the original session):
// seeding `planarfit:currentSite:v1` does NOT open the plan into the canvas — the app still
// boots onto the MapFinder site-picker screen (the same screen ui-audit/audit-chrome.mjs's own
// "site-planner"/"site-planner-left-panel" scenarios silently land on; `[title="Zoom to fit"]`
// and `button:has-text("File")` do not exist there at all, so every prep() that assumed the
// canvas was already open was measuring the picker screen instead and finding 0 elements).
// Clicking the seeded site's own list row is what actually opens the plan.
const openPlan = async (p) => { await p.getByText("UI Inventory Demo").first().click({ timeout: 5000 }).catch(() => {}); await p.waitForTimeout(600); };
const fit = async (p) => { await p.locator('[title="Zoom to fit"]:visible').first().click({ timeout: 5000 }).catch(() => {}); };
// `.first()` picks the first DOM match, which the "both hosts stay mounted" pattern (see openPlan
// above) can make the HIDDEN copy — Playwright's actionability check then times out waiting for
// it to become visible and clickIf silently swallows that, so the menu never opens (confirmed:
// `[aria-label="Settings"]` matches 2 elements once a plan is open, one hidden). `:visible` scopes
// to only the rendered match.
const clickIf = async (p, sel) => p.locator(`${sel}:visible`).first().click({ timeout: 4000 }).catch(() => {});
const escAll = async (p) => { await p.keyboard.press("Escape").catch(() => {}); };

// ------------------------------------------------------------------------------------------
// SURFACES. Each opens a scenario, then reads computed style from a scoped selector.
// `scope` narrows the query to avoid the same element being reported under two surfaces (the
// header bar itself is only reported under "App header"; its opened menus only under "Main
// menu"). `menuOnly: true` means "read only currently-open [data-menu-owner] portals".
// ------------------------------------------------------------------------------------------
const SURFACES = [
  {
    name: "App header", hash: "#/site",
    prep: async (p) => { await openPlan(p); await fit(p); },
    scope: "header",
  },
  {
    name: "Main menu — File ▾", hash: "#/site",
    prep: async (p) => { await openPlan(p); await fit(p); await clickIf(p, 'button:has-text("File")'); await p.waitForTimeout(150); },
    menuOnly: true,
  },
  {
    name: "Main menu — Undo history", hash: "#/site",
    prep: async (p) => { await openPlan(p); await fit(p); await clickIf(p, '[aria-label="Recent actions to undo"]'); await p.waitForTimeout(150); },
    menuOnly: true,
  },
  {
    name: "Main menu — Settings gear", hash: "#/site",
    prep: async (p) => { await openPlan(p); await fit(p); await clickIf(p, '[aria-label="Settings"]'); await p.waitForTimeout(150); },
    menuOnly: true,
  },
  {
    name: "Main menu — plan menu (▾ next to the plan name)", hash: "#/site",
    prep: async (p) => { await openPlan(p); await fit(p); await clickIf(p, '[data-testid="plan-caret"]'); await clickIf(p, '[data-testid="plan-crumb"]'); await p.waitForTimeout(150); },
    menuOnly: true,
  },
  {
    // ⛔ CONFIRMED BUG (found auditing this script's own claims, not during the original
    // session): `scope` here used to be `.rbtn, [aria-label="Parking presets"] ~ *` — a
    // selector that matches the BUTTONS THEMSELVES, not a wrapping container. readSurface's
    // root-resolution picks ONE match and then does `root.querySelectorAll(directSelector)`,
    // which searches DESCENDANTS only — so `root` ended up being a single `<button class=
    // "rbtn">`, and a button has no `.rbtn` descendants, so every run measured 0/0. `body` is
    // the same scope the other body-rooted surfaces already use (Yield/Library/Doc Review);
    // `directSelector: '.rbtn'` still narrows what gets read. Confirmed live: 25 `.rbtn`
    // buttons, all with a non-zero rect, once this scope is a real container.
    name: "Tool rail", hash: "#/site",
    prep: async (p) => { await openPlan(p); await fit(p); await clickIf(p, '[aria-label="Parking presets"]'); await p.waitForTimeout(150); },
    scope: "body",
    directSelector: '.rbtn, [aria-label="Parking presets"] ~ *',
  },
  {
    name: "Left rail + panels (Yield)", hash: "#/site",
    prep: async (p) => { await openPlan(p); await fit(p); await clickIf(p, 'button[title="Yield"]'); await p.waitForTimeout(200); },
    scope: 'body',
    exclude: "header, [data-menu-owner]",
  },
  { name: "Library", hash: "#/library", prep: async () => {}, scope: "body", exclude: "header, [data-menu-owner]" },
  { name: "Doc Review (empty state)", hash: "#/markup", prep: async () => {}, scope: "body", exclude: "header, [data-menu-owner]" },
];

const INTERACTIVE_SEL = 'button, [role="button"], [role="menuitem"], input, select, [class*="btn" i], [class*="chip" i]';

async function readSurface(page, surface) {
  return page.evaluate(({ interactiveSel, menuOnly, scope, exclude, directSelector }) => {
    // ⛔ Both the MapFinder and the open-plan canvas keep their own AppHeader mounted at once
    // (SitePlannerApp hides the inactive one with display:none rather than unmounting it, to
    // keep the map alive) — so `document.querySelector("header")` can silently grab the HIDDEN
    // one, whose every child reports a zero-size rect and gets skipped below, reading as "0
    // matched elements" for a surface that plainly has content on screen. Pick the first match
    // that actually has a non-zero rendered box.
    const root = menuOnly
      ? [...document.querySelectorAll('[data-menu-owner]')]
      : [[...document.querySelectorAll(scope)].find((el) => el.getBoundingClientRect().width > 0) || document.body];
    const seen = new Set();
    const out = [];
    for (const r of root) {
      if (!r) continue;
      const nodes = directSelector ? r.querySelectorAll(directSelector) : r.querySelectorAll(interactiveSel);
      for (const el of nodes) {
        if (exclude && el.closest(exclude) && el.closest(exclude) !== r) continue;
        if (seen.has(el)) continue;
        seen.add(el);
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const cs = getComputedStyle(el);
        const label = el.getAttribute("aria-label") || el.getAttribute("title")
          || (el.textContent || "").trim().slice(0, 40) || el.getAttribute("data-testid") || el.className || el.tagName;
        out.push({
          tag: el.tagName.toLowerCase(),
          label: String(label).replace(/\s+/g, " ").trim(),
          borderRadius: cs.borderRadius,
          height: Math.round(rect.height),
          padding: cs.padding,
          fontSize: cs.fontSize,
          fontWeight: cs.fontWeight,
          background: cs.backgroundColor,
          border: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`,
        });
      }
    }
    return out;
  }, { interactiveSel: INTERACTIVE_SEL, menuOnly: !!surface.menuOnly, scope: surface.scope, exclude: surface.exclude, directSelector: surface.directSelector });
}

// Best-effort file/line attribution: grep src/ for the element's own label as a literal string.
function attribute(label) {
  if (!label || label.length < 2) return "unattributed (label too short to search)";
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  try {
    const out = execSync(
      `grep -rnI -F ${JSON.stringify(label)} src --include="*.jsx" --include="*.js" -m 3`,
      { cwd: REPO, encoding: "utf8" },
    ).trim();
    if (!out) return "unattributed (no source match — best-effort text search)";
    const lines = out.split("\n");
    const first = lines[0];
    const extra = lines.length > 1 ? ` (+${lines.length - 1} more match${lines.length > 2 ? "es" : ""}, best-effort)` : "";
    return first.replace(REPO + "/", "") + extra;
  } catch (_) {
    return "unattributed (no source match — best-effort text search)";
  }
}

function radiusCorners(v) {
  // getComputedStyle normalizes to "8px" or "8px 0px 0px 8px" (TL TR BR BL). Return the distinct
  // numeric corner values found.
  return [...new Set(String(v).split(/\s+/).map((t) => parseFloat(t)).filter((n) => !Number.isNaN(n)))];
}

function classify(row) {
  const corners = radiusCorners(row.borderRadius);
  const offScaleCorners = corners.filter((c) => !RADIUS_OK.has(c));
  const fontVal = parseFloat(row.fontSize);
  const offScaleFont = row.fontSize && !FONT_OK.has(fontVal);
  const reasons = [];
  if (offScaleCorners.length) reasons.push(`radius ${offScaleCorners.join("/")} not in RADIUS scale {${[...RADIUS_OK].sort((a, b) => a - b).join(",")}}`);
  if (offScaleFont) reasons.push(`fontSize ${fontVal} not in FONT_SIZE scale {${[...FONT_OK].sort((a, b) => a - b).join(",")}}`);
  return reasons;
}

function dedupe(rows) {
  const byKey = new Map();
  for (const r of rows) {
    const key = [r.tag, r.borderRadius, r.height, r.padding, r.fontSize, r.fontWeight, r.background, r.border].join("|");
    if (!byKey.has(key)) byKey.set(key, { ...r, count: 0, labels: new Set() });
    const g = byKey.get(key);
    g.count++;
    g.labels.add(r.label);
  }
  return [...byKey.values()];
}

function renderGroup(name, themeRows) {
  const lines = [`### ${name}`, ""];
  for (const theme of ["light", "dark"]) {
    const rows = dedupe(themeRows[theme] || []);
    const withDeviation = rows.map((r) => ({ ...r, deviations: classify(r) }));
    withDeviation.sort((a, b) => (b.deviations.length - a.deviations.length) || (b.count - a.count));
    lines.push(`**${theme}** — ${rows.length} distinct style signature(s) over ${themeRows[theme]?.length || 0} matched element(s):`, "");
    if (!withDeviation.length) { lines.push("_(nothing matched in this theme/scenario)_", ""); continue; }
    lines.push("| radius | height | font | weight | background | border | label(s) | file/line (best-effort) |", "|---|---|---|---|---|---|---|---|");
    for (const r of withDeviation) {
      const label = [...r.labels].slice(0, 3).join(", ") + (r.labels.size > 3 ? ` (+${r.labels.size - 3} more)` : "");
      const attr = attribute([...r.labels][0]);
      const flag = r.deviations.length ? `⚠️ **${r.deviations.join("; ")}** — ` : "";
      lines.push(`| ${flag}${r.borderRadius} | ${r.height}px | ${r.fontSize} | ${r.fontWeight} | \`${r.background}\` | \`${r.border}\` | ${label} ×${r.count} | ${attr} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

async function run() {
  const EXEC = process.env.PW_CHROME || undefined;
  const browser = await chromium.launch({ ...(EXEC ? { executablePath: EXEC } : {}), args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const results = {}; // surface name -> { light: [...], dark: [...] }
  try {
    for (const theme of ["light", "dark"]) {
      for (const surface of SURFACES) {
        const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
        await ctx.addInitScript(seed(theme));
        const page = await ctx.newPage();
        await assertMeasurable(page, "ui-inventory");
        await page.goto(BASE + surface.hash, { waitUntil: "load" });
        await page.waitForTimeout(1200);
        try { await surface.prep(page); } catch (e) { console.warn(`  prep(${surface.name}/${theme}) warn:`, e.message); }
        await page.waitForTimeout(300);
        const rows = await readSurface(page, surface);
        (results[surface.name] ||= {})[theme] = rows;
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
  }

  let totalDeviations = 0;
  const sections = SURFACES.map((s) => {
    const block = renderGroup(s.name, results[s.name] || {});
    for (const theme of ["light", "dark"]) {
      for (const r of dedupe((results[s.name] || {})[theme] || [])) totalDeviations += classify(r).length ? 1 : 0;
    }
    return block;
  });

  const md = [
    "# `docs/UI-INVENTORY.md` — the generated control inventory (NEW-3)",
    "",
    "**Generated by `node ui-audit/ui-inventory.mjs` — do not hand-edit.** Regenerate after any UI",
    "change; `--check` fails CI on drift so this file can never go stale. See `docs/DESIGN.md` for",
    "the scale this inventory checks against (`RADIUS` / `FONT_SIZE`).",
    "",
    "Rows are grouped by surface, deduplicated by exact computed-style signature (so 40 identical",
    "toolbar buttons are one row, not forty), and **every deviating row is sorted to the top of its",
    "theme's table**, flagged with ⚠️ and the specific reason. Attribution is best-effort (a literal",
    "text search of `src/` for the element's own label) — see the script header for why.",
    "",
    `**Total distinct deviating style signatures found: ${totalDeviations}.**`,
    "",
    "## Known, deliberately-not-fixed findings",
    "",
    "Two classes of ⚠️ row below are investigated and intentionally left as-is, rather than",
    "mechanically \"fixed\" — recorded here (in the generator, so it survives regeneration) instead",
    "of silently repeated every run:",
    "",
    "- **A `fontSize` reading of `13.3333px`\\* is the Chromium UA stylesheet's default form-control",
    "  font-size, not a value from anywhere in this codebase.** `src/index.css` sets",
    "  `input, select, button, textarea { font-family: inherit }` but never `font-size`, so any",
    "  control that doesn't set its own falls through to that browser default. A fix was tried —",
    "  adding `font-size: inherit` — and measured: it changed the reading to `16px` (the browser's",
    "  root default, since no ancestor here declares a base font-size either), which is equally",
    "  off-scale and carries unverified reflow risk across every unstyled control in the app. **Not",
    "  shipped.** Most instances are icon-only buttons or checkboxes where the property is visually",
    "  inert (`Full screen`/`Settings`/`Dashboard`/the theme-picker's own `<button>` — every visible",
    "  glyph or label inside them sets its own explicit `fontSize`). Establishing a real base",
    "  font-size for the app is a separate, deliberately-scoped decision — the same shape as",
    "  `docs/DESIGN-TOKENS.md`'s open padding/font-size retrofit question — not a mechanical fix.",
    "  (\\*or `16px` after the reverted fix — either way, off-scale and not from this codebase.)",
    "- **A `borderRadius` of `2px` on \"Find my location\"** comes from Leaflet's own `.leaflet-bar a`",
    "  default stylesheet, not from any style this app authors — it's third-party map-control chrome,",
    "  the same category as the Scheduler iframe (`docs/DESIGN.md` — out of scope for the token scale).",
    "",
    sections.join("\n\n---\n\n"),
    "",
  ].join("\n");

  if (process.argv.includes("--check")) {
    const existing = existsSync(OUT_MD) ? readFileSync(OUT_MD, "utf8") : null;
    if (existing !== md) {
      console.error("docs/UI-INVENTORY.md is out of date — regenerate with `node ui-audit/ui-inventory.mjs`.");
      process.exit(1);
    }
    console.log("docs/UI-INVENTORY.md is up to date.");
    return;
  }

  writeFileSync(OUT_MD, md);
  console.log(`docs/UI-INVENTORY.md written — ${totalDeviations} distinct deviating style signature(s) found.`);
}

run();
