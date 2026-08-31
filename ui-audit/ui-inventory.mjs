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
 * the **Map landing page** (no project selected — the FIRST screen a user sees), the Site Planner
 * (header, the dropdown menus it opens, the tool rail, the left rail, the Yield panel), Library,
 * and Doc Review's empty state. It does not attempt every dialog in the app (an auth-gated modal,
 * a signed-in-only settings pane) — those stay on VERIFICATION.md's live-verify list like
 * everything else that needs a real account.
 *
 * ⛔ COVERAGE, STATED RATHER THAN IMPLIED (NEW-2, 2026-08-31 — the map landing page was absent from
 * this crawl for its entire life, so every "N deviations" figure this tool ever printed was measured
 * with the first screen a user sees simply not looked at; see B915536's amendment). Crawled today:
 * Map landing page, App header + its four dropdown menus (File ▾ / Undo history / Settings gear /
 * plan menu), the tool rail, the left rail + Yield panel, Library, Doc Review's empty state. NOT
 * crawled, with the reason each is out of scope for THIS headless/logged-out tool rather than
 * silently forgotten:
 *   - Scheduler (`public/sequence/index.html`) — a separate, self-contained HTML document outside
 *     the React tree this token system governs at all (see docs/DESIGN.md "The Scheduler iframe is
 *     walled off"); a control inventory keyed on RADIUS/FONT_SIZE has nothing to check there.
 *   - Stitcher, Notes, Model, admin (`#/admin`) — each is a real workspace this tool COULD reach by
 *     hash the way Library/Doc Review are reached, but needs its own seed data (a stitched aerial, a
 *     saved note, a model sheet) or an owner-only allowlist (admin) to render anything beyond an
 *     empty shell; a future pass earns its own surface entries once that seed is built, same as this
 *     session built the demo site MapFinder/SitePlanner already use. Left as a named gap, not folded
 *     into "not crawled" silence.
 *   - Doc Review WITH a document open, the Site Planner canvas chrome beyond what "App header" +
 *     "tool rail" + "left rail" already isolate, and any dialog/modal that only opens over real
 *     content (a delete confirmation, a share sheet) — all need a loaded document or drawn geometry
 *     this tool's bare demo site doesn't carry yet. Same disposition as above: a named gap.
 *   - Any auth-gated or signed-in-only surface (the account panel's Storage tab, cloud-sync states,
 *     admin's real content) — out of scope for a logged-out tool by construction; these stay on
 *     `VERIFICATION.md`'s live-verify list, per the ATTEMPT-BEFORE-YOU-PARK rule in root CLAUDE.md
 *     (a logged-out check is Claude-doable and belongs here; a signed-in one does not).
 *
 * GROUPING — "Main menu" is specifically the dropdown MENU PANELS the header opens (File ▾,
 * Undo/Redo history, Settings gear), not the header bar itself. AnchoredMenu portals every open
 * panel to `document.body` stamped `[data-menu-owner]` (src/shared/ui/AnchoredMenu.jsx), so this
 * is a real, principled DOM distinction, not an arbitrary label: "App header" is what's always on
 * screen, "Main menu" is what a click reveals — and the owner's report is squarely about the
 * latter looking inconsistent with the toolbar that opens it. "Map landing page" is deliberately
 * NOT scoped to exclude the header (unlike Library/Doc Review below) — it reports the header
 * controls (account chip, Full screen, the top nav tabs) again, in the landing state, rather than
 * assume they read the same as the "App header" surface's plan-open capture; the two sections can
 * be diffed against each other for exactly that reason.
 *
 * ATTRIBUTION IS BEST-EFFORT. A computed-style walk has no source location, so `attribute()` greps
 * `src/` for the element's own visible text/aria-label/title as a literal string and reports the
 * first match. This can miss or over-match on a generic label ("▾", "File") — every row says so
 * plainly rather than pretending to a precision this method doesn't have.
 *
 * NESTING MISMATCHES (NEW-1) — beyond "is this radius on the scale," a second, geometric check:
 * for every rounded element, find its nearest ROUNDED ancestor that visually contains it, and
 * compare the child's actual radius against `nestedIn(ancestorRadius, gap)` — the exact formula
 * radius.js already documents (a pill container's children must themselves be pills; any other
 * container's child is the outer radius minus the real measured gap, floored at 2px). This is a
 * check design-drift-audit.mjs cannot make: that guard is a text scan with no DOM and no geometry,
 * so it can confirm every number is ON the scale without ever seeing that two adjacent, on-scale
 * curves disagree with each other. See `nestingMismatches()` below.
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
const INTERACTIVE_SEL = 'button, [role="button"], [role="menuitem"], input, select, [class*="btn" i], [class*="chip" i]';

// NEW-2 — the landing page's shell CONTAINERS (the search cluster bar, the Sites/Comps rail) are
// plain inline-styled `<div>`s with no button/role/class hook, so INTERACTIVE_SEL alone — built for
// the other surfaces, which only ever cared about controls — never sees them. `[style*="border-radius"]`
// widens this ONE surface to catch every rounded node, container or control alike (the very thing
// NEW-1's nesting check needs a container FOR); the Leaflet-specific selectors add the scale bar
// (a plain `<div>`, matched by neither clause) and make the zoom-stack/locate-button `<a>` tags
// explicit rather than relying on their incidental `role="button"`.
const LANDING_SEL = `${INTERACTIVE_SEL}, [style*="border-radius"], .leaflet-control-scale-line, .leaflet-bar a`;

const SURFACES = [
  {
    // NEW-2 — the first screen a user sees, no project selected. No prep() beyond collapsing the
    // Imagery & layers panel: default OPEN at desktop width (MapFinder's own useState initializer),
    // but the owner's report and MAP_CORNER_CHIP_STYLE both concern the COLLAPSED corner pill, so
    // this reads the state that's actually in question rather than the wide-open panel.
    name: "Map landing page (no project selected)", hash: "#/site",
    prep: async (p) => { await clickIf(p, '[title="Collapse layers"]'); await p.waitForTimeout(150); },
    scope: "body",
    exclude: "[data-menu-owner]",
    directSelector: LANDING_SEL,
  },
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

// NEW-1 — the nesting-family check design-drift-audit.mjs cannot make (it has no DOM, no geometry).
// For every rounded, visible node under `surface`'s root, find its nearest ROUNDED ancestor that
// visually CONTAINS it (not just any ancestor — a sibling shell one component over must never match),
// and assert the child's own radius equals `nestedIn(ancestorRadius, measuredGap)` — radius.js's own
// formula, duplicated here (not imported: this runs inside `page.evaluate`, a separate JS realm with
// no module graph) and kept a direct transcription on purpose so a change to the real formula is easy
// to notice as a diff between the two copies.
async function nestingMismatches(page, surface) {
  return page.evaluate(({ menuOnly, scope, exclude, radiusOk }) => {
    const nestedIn = (outer, gap) => (outer >= 999 ? 999 : Math.max(2, Math.round(outer - gap)));
    const root = menuOnly
      ? [...document.querySelectorAll('[data-menu-owner]')]
      : [[...document.querySelectorAll(scope)].find((el) => el.getBoundingClientRect().width > 0) || document.body];

    // Candidate pool: every element with a UNIFORM (single-value), positive, on-scale computed
    // border-radius and a non-zero rendered box. Multi-corner radii (e.g. a half-pill split-button
    // pair) opt out of the concentric check — that shape is a different, deliberate pattern, not
    // covered by "nested inside a rounded container".
    const all = [];
    for (const r of root) {
      if (!r) continue;
      for (const el of r.querySelectorAll("*")) {
        if (exclude && el.closest(exclude) && el.closest(exclude) !== r) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const cs = getComputedStyle(el);
        const parts = [...new Set(String(cs.borderRadius).split(/\s+/).map((t) => parseFloat(t)).filter((n) => !Number.isNaN(n)))];
        if (parts.length !== 1) continue;
        const radius = parts[0];
        if (!radius || !radiusOk.includes(radius)) continue;
        const label = el.getAttribute("aria-label") || el.getAttribute("title")
          || (el.textContent || "").trim().slice(0, 30) || el.tagName;
        all.push({ el, radius, rect, label: String(label).replace(/\s+/g, " ").trim() });
      }
    }

    const findings = [];
    for (const child of all) {
      // Nearest ROUNDED ancestor in the candidate pool that visually contains this element with a
      // real inset (strictly smaller on at least one axis — an icon/text span sharing its parent's
      // exact box is the same shape twice, not a nested control, and must not be compared).
      let anc = child.el.parentElement;
      let found = null;
      // Bounded to a few DOM hops and a real size difference — a control "nested" 6 levels deep
      // inside a big scrollable panel (a status dot inside a list row inside a group inside the
      // panel) is not what radius.js's nesting rule means ("an input in a panel, a button in a
      // banner" — flush, direct nesting), and a 1px difference is antialiasing/box-model noise, not
      // a second container. Same LABEL is the giveaway for the latter: a wrapper div measured
      // fractionally larger than the control it wraps reads as its own "ancestor" otherwise.
      let hops = 0;
      while (anc && anc !== document.body && hops < 5) {
        const cand = all.find((c) => c.el === anc);
        if (cand && cand.label !== child.label) {
          const r = child.rect, a = cand.rect;
          const contained = r.left >= a.left - 0.5 && r.right <= a.right + 0.5 && r.top >= a.top - 0.5 && r.bottom <= a.bottom + 0.5;
          const inset = r.width < a.width - 3 || r.height < a.height - 3;
          if (contained && inset) { found = cand; break; }
        }
        anc = anc.parentElement;
        hops++;
      }
      if (!found) continue;
      const gapLeft = child.rect.left - found.rect.left, gapRight = found.rect.right - child.rect.right;
      const gapTop = child.rect.top - found.rect.top, gapBottom = found.rect.bottom - child.rect.bottom;
      const gap = Math.min(gapLeft, gapRight, gapTop, gapBottom);
      if (gap < 1.5) continue; // sub-2px slack is box-model noise, not a second rounded surface
      // The owner's own complaint is about a curve sitting close enough to another curve that "the
      // eye compares the two curves directly with no gap between them" (NEW-1) — a control floating
      // in the MIDDLE of a big panel, nowhere near an actual rounded CORNER, is never that comparison,
      // however it scores on containment alone. Require the child to sit near one of the ancestor's
      // four rounded corners on BOTH axes (within its radius + a little slack) before it counts.
      const corner = found.radius + 6;
      const nearCorner = (gapTop <= corner || gapBottom <= corner) && (gapLeft <= corner || gapRight <= corner);
      if (!nearCorner) continue;
      const expected = nestedIn(found.radius, Math.max(0, gap));
      // A derived `nestedIn()` value that ISN'T itself one of the four canonical steps (this
      // happens at small outer radii with a tight inset — nestedIn(6, 2) = 4, a fifth number
      // nobody's scale declares) has a documented, sanctioned fallback: snap to the CONTAINER's
      // own radius rather than mint a new one (docs/DESIGN.md's radius section) — perfectly
      // concentric-but-off-scale is worse than 1-2px shy of concentric on an already-tiny control.
      // So a child matching its ancestor exactly is compliant in that case, not a mismatch.
      const compliant = Math.abs(expected - child.radius) <= 1.5
        || (!radiusOk.includes(expected) && child.radius === found.radius);
      // Tolerance of 1px otherwise: `gap` is measured from the ancestor's outer (border) box, so a
      // 1px border on the ancestor reads as 1px more gap than the padding-only number a call site
      // hands `nestedIn()` — a real, but sub-perceptual, measurement convention difference, not a
      // second design decision to chase. A genuine family mismatch (a whole scale step, or a curve
      // that should be a pill and isn't) is never this close.
      if (!compliant) {
        findings.push({
          childLabel: child.label, childRadius: child.radius,
          ancestorLabel: found.label, ancestorRadius: found.radius,
          gap: Math.round(gap * 10) / 10, expected,
        });
      }
    }
    // Dedupe identical (child family, ancestor family, expected) triples — many rows share one shape.
    const byKey = new Map();
    for (const f of findings) {
      const key = `${f.childRadius}|${f.ancestorRadius}|${f.expected}|${f.childLabel}|${f.ancestorLabel}`;
      if (!byKey.has(key)) byKey.set(key, f);
    }
    return [...byKey.values()];
  }, { menuOnly: !!surface.menuOnly, scope: surface.scope, exclude: surface.exclude, radiusOk: [...RADIUS_OK] });
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
  const nesting = {}; // surface name -> { light: [...], dark: [...] } of nesting-mismatch findings
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
        (nesting[surface.name] ||= {})[theme] = await nestingMismatches(page, surface);
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

  let totalNestingMismatches = 0;
  const nestingLines = ["## Nesting mismatches (NEW-1)", "",
    "A control whose radius disagrees with `nestedIn(ancestorRadius, gap)` for its nearest rounded,",
    "visually-containing ancestor — the geometric half design-drift-audit.mjs cannot check (see the",
    "script header). Every row here is two on-scale radii that still don't belong next to each other.",
    ""];
  for (const s of SURFACES) {
    for (const theme of ["light", "dark"]) {
      const found = (nesting[s.name] || {})[theme] || [];
      totalNestingMismatches += found.length;
      if (!found.length) continue;
      nestingLines.push(`**${s.name} — ${theme}:**`, "");
      for (const f of found) {
        nestingLines.push(`- "${f.childLabel}" is ${f.childRadius}px inside "${f.ancestorLabel}" (${f.ancestorRadius}px, gap ${f.gap}px) — expected ${f.expected}px.`);
      }
      nestingLines.push("");
    }
  }
  if (!totalNestingMismatches) nestingLines.push("_None found on this run._", "");

  const md = [
    "# `docs/UI-INVENTORY.md` — the generated control inventory (NEW-3)",
    "",
    "**Generated by `node ui-audit/ui-inventory.mjs` — do not hand-edit.** Regenerate after any UI",
    "change; `--check` fails CI on drift so this file can never go stale. See `docs/DESIGN.md` for",
    "the scale this inventory checks against (`RADIUS` / `FONT_SIZE`).",
    "",
    "## Coverage (NEW-2, 2026-08-31)",
    "",
    "**Crawled:** the Map landing page (no project selected — the first screen a user sees),",
    "App header + its four dropdown menus (File ▾ / Undo history / Settings gear / plan menu), the",
    "tool rail, the left rail + Yield panel, Library, Doc Review's empty state.",
    "",
    "**Not yet crawled, named rather than silently absent:** the Scheduler (a separate HTML document",
    "outside this token system entirely — see docs/DESIGN.md), Stitcher/Notes/Model/admin (each needs",
    "its own seed data or an owner-only allowlist this tool doesn't build yet), Doc Review with a",
    "document actually open, the Site Planner canvas chrome beyond header/tool-rail/left-rail, any",
    "dialog that only opens over real content, and every auth-gated/signed-in-only surface (those stay",
    "on `VERIFICATION.md`'s live-verify list — see the script header for the full reasoning per item).",
    "",
    "Rows are grouped by surface, deduplicated by exact computed-style signature (so 40 identical",
    "toolbar buttons are one row, not forty), and **every deviating row is sorted to the top of its",
    "theme's table**, flagged with ⚠️ and the specific reason. Attribution is best-effort (a literal",
    "text search of `src/` for the element's own label) — see the script header for why.",
    "",
    `**Total distinct deviating style signatures found: ${totalDeviations}.** (B915536's earlier "24"`,
    "was measured before the Map landing page — the surface listed first above — was in this crawl at",
    "all; see that item's amendment note for the before/after breakdown.)",
    "",
    `**Total nesting-family mismatches found (NEW-1): ${totalNestingMismatches}.** See the section below.`,
    "",
    "## Known, deliberately-not-fixed findings",
    "",
    "Classes of ⚠️ row below are investigated and intentionally left as-is, rather than mechanically",
    "\"fixed\" — recorded here (in the generator, so it survives regeneration) instead of silently",
    "repeated every run. **All are `fontSize`** — the owner's own report (\"a multitude of different",
    "radii and fillets\") was about RADIUS, and the map landing page's `borderRadius` column is now",
    "clean (see NEW-3): the one radius exemption this list used to carry — 2px on \"Find my location\",",
    "Leaflet's own default — is GONE because the control now carries the same corner treatment as the",
    "zoom stack it sits against (`.leaflet-control-locate.leaflet-bar` in index.css), not because it",
    "was reclassified.",
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
    "- **A `fontSize` of `16px` on a plain, unstyled `<div>` shell** (the map landing page's search",
    "  cluster bar, the Site/Comp switch's own wrapping div, the Sites/Comps rail panel) is the SAME",
    "  browser root default as the `16px` form above — a container div that sets no `fontSize` of its",
    "  own inherits it, and every visible glyph inside these shells sets its own explicit size. Not a",
    "  form control, but the identical root cause and the identical decision not to chase it here.",
    "- **A `fontSize` of `22px` on the Leaflet zoom stack's `+`/`−` glyphs** is this app's own inline",
    "  style (`SitePlanner.jsx`'s `zb`), sized to fill a 30px touch target visibly rather than read as",
    "  a body-text size — the same \"decorative glyph, not UI text\" case FONT_SIZE's scale doesn't try",
    "  to cover, alongside the icon-only buttons above.",
    "- **A `fontSize` of `8.5px` on the small colored count badge inside a Sites-panel group header**",
    "  is a deliberately tiny numeral inside a ~14px pill dot — legible at that size because it's a",
    "  single digit, not running text, the same rationale as the zoom glyph above.",
    "",
    nestingLines.join("\n"),
    "---",
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
  console.log(`docs/UI-INVENTORY.md written — ${totalDeviations} distinct deviating style signature(s), ${totalNestingMismatches} nesting mismatch(es) found.`);
}

run();
