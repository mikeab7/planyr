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
 *   node ui-audit/ui-inventory.mjs                        → regenerate docs/UI-INVENTORY.md
 *   node ui-audit/ui-inventory.mjs --check                → CI drift gate (diff against the committed
 *                                                            file, AND fails if any surface's control-
 *                                                            signature count grew past its ceiling)
 *   node ui-audit/ui-inventory.mjs --write-signature-ceiling → (re)write control-signature-ceiling.json
 *                                                            to the CURRENT per-surface counts (NEW-3)
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
const SIGNATURE_CEILING_PATH = join(HERE, "control-signature-ceiling.json");
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
    // B (map-view locked-geometry conversion) — also excludes the bottom-left network-status
    // toast (`data-testid="map-status-toast"`): arming select mode kicks off a real GIS parcel
    // fetch, and this sandbox's blocked/slow county-GIS egress makes WHICH of two fallback error
    // strings wins a genuine race — content this crawl was never testing, and flaky content in a
    // `--check` byte-diff gate is worse than no coverage. Geometry (radius/height/padding/font) is
    // identical either way; only the label text races.
    exclude: '[data-menu-owner], [data-testid="map-status-toast"]',
    directSelector: LANDING_SEL,
  },
  {
    // NEW-1 (map-view locked-geometry conversion) — the DEFAULT "Site" mode search bar hides
    // over half of its own action buttons behind mode/selection state: "Drop a pin" and "Comp
    // from parcel" render ONLY in Comp mode, and the split "Select parcels ▾" pair's own Cancel
    // sibling renders only once selectMode is armed. The surface above never saw any of them —
    // confirmed live: the map landing page's own signature count didn't move after converging
    // those buttons' geometry, because the crawl never rendered them. Both states below are
    // reachable with a plain click (no live parcel data, no network) so they cost nothing extra
    // to cover. The "selected.length > 0" state (Plan N parcels / clear ✕) is NOT covered here —
    // it needs a real parcel click on the live map, the same real-data wall documented on every
    // other GIS-dependent live-verify item in this repo.
    name: "Map landing page (comp mode)", hash: "#/site",
    prep: async (p) => {
      await clickIf(p, '[title="Collapse layers"]');
      await clickIf(p, '[role="tablist"][aria-label="Site or comp"] button:has-text("Comp")');
      await p.waitForTimeout(150);
    },
    scope: "body",
    // B (map-view locked-geometry conversion) — also excludes the bottom-left network-status
    // toast (`data-testid="map-status-toast"`): arming select mode kicks off a real GIS parcel
    // fetch, and this sandbox's blocked/slow county-GIS egress makes WHICH of two fallback error
    // strings wins a genuine race — content this crawl was never testing, and flaky content in a
    // `--check` byte-diff gate is worse than no coverage. Geometry (radius/height/padding/font) is
    // identical either way; only the label text races.
    exclude: '[data-menu-owner], [data-testid="map-status-toast"]',
    directSelector: LANDING_SEL,
  },
  {
    name: "Map landing page (selecting parcels)", hash: "#/site",
    prep: async (p) => {
      await clickIf(p, '[title="Collapse layers"]');
      await clickIf(p, 'button:has-text("Select parcels")');
      await p.waitForTimeout(150);
    },
    scope: "body",
    // B (map-view locked-geometry conversion) — also excludes the bottom-left network-status
    // toast (`data-testid="map-status-toast"`): arming select mode kicks off a real GIS parcel
    // fetch, and this sandbox's blocked/slow county-GIS egress makes WHICH of two fallback error
    // strings wins a genuine race — content this crawl was never testing, and flaky content in a
    // `--check` byte-diff gate is worse than no coverage. Geometry (radius/height/padding/font) is
    // identical either way; only the label text races.
    exclude: '[data-menu-owner], [data-testid="map-status-toast"]',
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
      // NEW-1 (B972096) — a genuinely CIRCULAR status-dot/avatar badge (999px on a roughly square
      // box — a true circle, not an elongated pill like a toggle chip) is compliant nested in ANY
      // container, never shrunk to the container's derived corner radius. docs/DESIGN.md's own
      // radius table names "status dots" as their own pill category independent of nesting; the
      // formula only ever had no case for it because every prior candidate container was ITSELF a
      // pill (nestedIn(999, gap) trivially resolves to 999). Converging the account/cloud-off chip
      // and the presence chip from pill to `md` (B972096's own fix) exposed it: their small round
      // "⊘"/avatar/status-dot badges are still meant to read as circles, not shrink toward the
      // chip's own 8px corner. Measured, not assumed: this is the exact new case B972096 created.
      const isCircularBadge = child.radius >= 999 && Math.abs(child.rect.width - child.rect.height) <= 1.5;
      const compliant = isCircularBadge
        || Math.abs(expected - child.radius) <= 1.5
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

// B950320 (this session's NEW-1) — THE SIBLING-CONSISTENCY CHECK nestingMismatches() cannot make.
// That check compares a control to its CONTAINER; it has nothing to say about two controls that
// sit beside each other with no containment relationship at all, which is exactly the owner's
// report: the row-1 account chip (a pill) sitting immediately next to the fullscreen button (an
// md square) — both individually on-scale, both pass nestingMismatches(), and the pair still
// reads as sloppy because the eye compares the two curves directly. For every SURFACE, group the
// same on-scale rounded-candidate pool nestingMismatches() builds by SHARED FLEX-ROW ANCESTOR
// (the concrete form of "shared parent AND visual row"), sort left-to-right, and walk ADJACENT
// pairs only. A pair counts as "the same visual row" when their vertical centers roughly agree (a
// flex row's own alignItems:center already guarantees this for a real row) AND the horizontal gap
// between them is small — SIBLING_GAP_PX is deliberately close to this app's own base flex `gap`
// (6-8px almost everywhere), so two FLUSH controls trip it and two controls a real divider was
// inserted between (a hairline + its own margins, ~20px+ of clear space) do not: that gap is the
// same "no gap between the two curves" the owner's report turns on.
//
// ⛔ WHY THE ANCESTOR SEARCH, NOT A BARE "SAME IMMEDIATE PARENT" (measured, not assumed — this
// check reported ZERO on the owner's exact header pair on its first pass). The signed-OUT "Cloud
// off" pill (`AccountControl.jsx`, the branch this headless crawl actually reaches — Supabase
// isn't configured in this sandbox) wraps its button in an extra `<div style={{position:
// "relative"}}>` for its own popover anchor; the signed-IN pill does not (a bare Fragment). An
// immediate-parent test sees two different parents for what is visually one row and finds
// nothing — a false negative on the very case this check exists for. Walking up to the nearest
// `display:flex` row ancestor (capped at a few hops, so it can't drift to a distant, unrelated
// container) treats real geometry as authoritative over incidental DOM nesting depth, which is
// what a person actually looking at the row does.
const SIBLING_GAP_PX = 12;
const SIBLING_VCENTER_TOL_PX = 6;
const SIBLING_ROW_ANCESTOR_HOPS = 4;

async function siblingMismatches(page, surface) {
  return page.evaluate(({ menuOnly, scope, exclude, radiusOk, gapPx, vTolPx, rowHops }) => {
    const root = menuOnly
      ? [...document.querySelectorAll('[data-menu-owner]')]
      : [[...document.querySelectorAll(scope)].find((el) => el.getBoundingClientRect().width > 0) || document.body];

    // Same candidate pool as nestingMismatches(): every element with a uniform, positive,
    // on-scale computed border-radius and a non-zero rendered box. A multi-corner radius (a
    // half-pill split-button pair) opts out here too — it is one deliberate shape, not two
    // controls that happen to sit beside each other.
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

    // Group by nearest FLEX-ROW ancestor (a bounded walk up from the element's own parent, never
    // through the element itself) — the concrete "shared parent AND visual row" test. Real
    // rendered geometry (rect) still decides adjacency below, so a candidate wrapped one extra
    // level deep for an unrelated reason (a popover anchor div, say) is still correctly grouped
    // with its true visual row-mates.
    // ⛔ B958466 (row-1 header sibling audit) — MUST SKIP A SINGLE-CHILD FLEX WRAPPER, not stop at
    // it (measured, not assumed — this check reported ZERO on a second real header pair, the same
    // way it first reported zero on the account-chip/fullscreen pair). `CloudSyncBadge` wraps its
    // own button in `<div style={{position:"relative", display:"flex", alignItems:"center"}}>` —
    // a one-child flex div used purely for positioning, not a "row" laying out several controls.
    // The original walk stopped at the FIRST flex ancestor it found and treated THAT as the shared
    // row, so the badge's row root became its own private wrapper while its true flex row-mate
    // (`FullscreenButton`, whose immediate parent IS the header's real right-zone row) resolved to
    // a different root one level further up — two different "rows" for what is visibly one. A flex
    // container with exactly one element child is never the row a person means by "this control's
    // row"; skip it and keep climbing for a container that actually lays out more than one thing.
    const rowRootOf = (el) => {
      let n = el.parentElement, hops = 0;
      while (n && n !== document.body && hops < rowHops) {
        const cs = getComputedStyle(n);
        if ((cs.display === "flex" || cs.display === "inline-flex") && cs.flexDirection !== "column" && cs.flexDirection !== "column-reverse") {
          const elementChildren = [...n.children].filter((c) => c.getBoundingClientRect().width > 0 || c.getBoundingClientRect().height > 0);
          if (elementChildren.length > 1) return n;
        }
        n = n.parentElement; hops++;
      }
      return null;
    };
    const byParent = new Map();
    for (const c of all) {
      const p = rowRootOf(c.el);
      if (!p) continue;
      if (!byParent.has(p)) byParent.set(p, []);
      byParent.get(p).push(c);
    }

    // NEW-2 (B972097) — A DIVIDER MUST NOT BE AN ESCAPE HATCH FROM "MUST AGREE". Read this before
    // touching the gap test below. The check's own history: the account-chip/fullscreen pair was
    // "fixed" TWICE (B950320's divider, B958466's CloudSyncBadge reclassification) without the row
    // ever reading as consistent — the owner reported the SAME mismatch a third time. Both fixes
    // made THIS check pass by making the pair no longer "adjacent" (gap > gapPx) or no longer a
    // pair at all, never by making the ROW look right. The first version of this fix tried to
    // SUBTRACT the divider's own getBoundingClientRect().width from the gap and re-test the
    // remainder against gapPx — that is WRONG and was caught by this file's own teeth-check before
    // it shipped: a divider's rendered box is ~1px, but its CSS margin (0 2px in this app) plus the
    // flex row's own `gap` on both sides of it is real occupied space a partial-subtraction never
    // credits, so a genuine divider still left an "effective" gap over threshold and the pair was
    // STILL silently exempted — reproducing the exact loophole this item exists to close. The
    // correct question is not "how many px does the divider account for" (a margin box has no
    // reliable single answer), it's binary: is there a divider-SHAPED element anywhere in the span
    // between A and B? If yes, the pair is still one visual row and must still agree, however wide
    // the raw DOM gap measures. If no, the gap is real clear space and the pair is genuinely
    // separated (two unrelated clusters) — that case still correctly exempts.
    const hasDividerInSpan = (parent, leftEdge, rightEdge, centerY) => {
      for (const el of parent.querySelectorAll("*")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const thin = r.width <= 2 || r.height <= 2;
        if (!thin) continue;
        // A stray 1x1 dot is not a divider — require the CROSS axis to be a real bar, not a speck
        // (docs/DESIGN.md's divider spec is a hairline the height/width of the row, not a pixel).
        const longAxis = r.width <= 2 ? r.height : r.width;
        if (longAxis < 8) continue;
        const withinSpan = r.left >= leftEdge - 1 && r.right <= rightEdge + 1;
        const onRow = Math.abs((r.top + r.bottom) / 2 - centerY) <= vTolPx + 6;
        if (withinSpan && onRow) return true;
      }
      return false;
    };

    const findings = [];
    for (const [parent, members] of byParent.entries()) {
      if (members.length < 2) continue;
      members.sort((a, b) => a.rect.left - b.rect.left);
      for (let i = 0; i < members.length - 1; i++) {
        const A = members[i], B = members[i + 1];
        if (A.radius === B.radius) continue; // same family — never a mismatch, whatever the gap
        const aCenterY = (A.rect.top + A.rect.bottom) / 2, bCenterY = (B.rect.top + B.rect.bottom) / 2;
        if (Math.abs(aCenterY - bCenterY) > vTolPx) continue; // not the same visual row
        const gap = B.rect.left - A.rect.right;
        if (gap < -2) continue; // overlapping — a different shape entirely, not a row mismatch
        let dividerSeparated = false;
        if (gap > gapPx) {
          dividerSeparated = hasDividerInSpan(parent, A.rect.right, B.rect.left, (aCenterY + bCenterY) / 2);
          if (!dividerSeparated) continue; // genuinely separated — real clear space, no divider present
        }
        findings.push({
          aLabel: A.label, aRadius: A.radius, bLabel: B.label, bRadius: B.radius,
          gap: Math.round(gap * 10) / 10,
          dividerSeparated,
        });
      }
    }
    const byKey = new Map();
    for (const f of findings) {
      const key = `${f.aRadius}|${f.bRadius}|${f.aLabel}|${f.bLabel}`;
      if (!byKey.has(key)) byKey.set(key, f);
    }
    return [...byKey.values()];
  }, { menuOnly: !!surface.menuOnly, scope: surface.scope, exclude: surface.exclude, radiusOk: [...RADIUS_OK], gapPx: SIBLING_GAP_PX, vTolPx: SIBLING_VCENTER_TOL_PX, rowHops: SIBLING_ROW_ANCESTOR_HOPS });
}

/* B982402 (NEW-3) — SIBLING HEIGHT/PADDING mismatches: the axis `siblingMismatches()` above never
 * asked. That check exists to catch two on-scale RADII sitting flush together; height and padding
 * were "governed by NOTHING — not the bible, not the guard, not the inventory's pass/fail" (this
 * item's own brief), and the owner's measured map-view report names SEVEN heights across the row —
 * a worse defect than the three radii the existing check already finds. Same shape, deliberately:
 * grouped by shared flex-row ancestor, adjacent pairs only, the same flush-gap-with-divider-escape
 * test as `siblingMismatches()` (a divider still legitimises two DIFFERENT sizes sitting apart; it
 * is never an excuse for two sizes sitting FLUSH).
 *
 * ⛔ THE CANDIDATE POOL IS DELIBERATELY WIDER than the other two checks' "uniform on-scale radius"
 * filter. A 0px-radius control (the nav tabs) is invisible to `nestingMismatches`/`siblingMismatches`
 * on purpose (`if (!radius || ...) continue` — radius 0 is falsy) because THOSE checks are about
 * curve families, and 0 is not a curve. Height disagreement has no such exemption — a 0-radius tab
 * sitting flush beside an 8-radius chip at a DIFFERENT height is exactly the "seven heights in one
 * screen" defect, so this check's pool is every element `readSurface()`'s own `INTERACTIVE_SEL`
 * would already report (button / [role=button] / [role=menuitem] / input / select / a class*=btn or
 * chip hook), not just the rounded subset.
 */
async function siblingSizeMismatches(page, surface) {
  return page.evaluate(({ interactiveSel, menuOnly, scope, exclude, gapPx, vTolPx, rowHops }) => {
    const root = menuOnly
      ? [...document.querySelectorAll('[data-menu-owner]')]
      : [[...document.querySelectorAll(scope)].find((el) => el.getBoundingClientRect().width > 0) || document.body];

    const all = [];
    for (const r of root) {
      if (!r) continue;
      for (const el of r.querySelectorAll(interactiveSel)) {
        if (exclude && el.closest(exclude) && el.closest(exclude) !== r) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const cs = getComputedStyle(el);
        const label = el.getAttribute("aria-label") || el.getAttribute("title")
          || (el.textContent || "").trim().slice(0, 30) || el.tagName;
        all.push({
          el, rect, label: String(label).replace(/\s+/g, " ").trim(),
          height: Math.round(rect.height), padding: cs.padding,
        });
      }
    }

    // Same "nearest flex-row ancestor with >1 element child" walk as siblingMismatches() — see that
    // function's own B958466 comment for why a single-child positioning wrapper must be skipped.
    const rowRootOf = (el) => {
      let n = el.parentElement, hops = 0;
      while (n && n !== document.body && hops < rowHops) {
        const cs = getComputedStyle(n);
        if ((cs.display === "flex" || cs.display === "inline-flex") && cs.flexDirection !== "column" && cs.flexDirection !== "column-reverse") {
          const elementChildren = [...n.children].filter((c) => c.getBoundingClientRect().width > 0 || c.getBoundingClientRect().height > 0);
          if (elementChildren.length > 1) return n;
        }
        n = n.parentElement; hops++;
      }
      return null;
    };
    const byParent = new Map();
    for (const c of all) {
      const p = rowRootOf(c.el);
      if (!p) continue;
      if (!byParent.has(p)) byParent.set(p, []);
      byParent.get(p).push(c);
    }

    // Same divider-in-span escape as siblingMismatches() (B972097) — a real divider still
    // legitimises two DIFFERENT sizes sitting apart; it is not read here as an exemption for a
    // flush pair, only as what turns "wide gap" into "still adjacent, still has to agree".
    const hasDividerInSpan = (parent, leftEdge, rightEdge, centerY) => {
      for (const el of parent.querySelectorAll("*")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const thin = r.width <= 2 || r.height <= 2;
        if (!thin) continue;
        const longAxis = r.width <= 2 ? r.height : r.width;
        if (longAxis < 8) continue;
        const withinSpan = r.left >= leftEdge - 1 && r.right <= rightEdge + 1;
        const onRow = Math.abs((r.top + r.bottom) / 2 - centerY) <= vTolPx + 6;
        if (withinSpan && onRow) return true;
      }
      return false;
    };

    const findings = [];
    for (const [parent, members] of byParent.entries()) {
      if (members.length < 2) continue;
      members.sort((a, b) => a.rect.left - b.rect.left);
      for (let i = 0; i < members.length - 1; i++) {
        const A = members[i], B = members[i + 1];
        if (A.height === B.height && A.padding === B.padding) continue; // identical size — never a mismatch
        const aCenterY = (A.rect.top + A.rect.bottom) / 2, bCenterY = (B.rect.top + B.rect.bottom) / 2;
        if (Math.abs(aCenterY - bCenterY) > vTolPx) continue; // not the same visual row
        const gap = B.rect.left - A.rect.right;
        if (gap < -2) continue; // overlapping — a different shape entirely
        let dividerSeparated = false;
        if (gap > gapPx) {
          dividerSeparated = hasDividerInSpan(parent, A.rect.right, B.rect.left, (aCenterY + bCenterY) / 2);
          if (!dividerSeparated) continue; // genuinely separated — real clear space, no divider present
        }
        const diffs = [];
        if (A.height !== B.height) diffs.push(`height ${A.height}px vs ${B.height}px`);
        if (A.padding !== B.padding) diffs.push(`padding "${A.padding}" vs "${B.padding}"`);
        findings.push({ aLabel: A.label, bLabel: B.label, gap: Math.round(gap * 10) / 10, diffs, dividerSeparated });
      }
    }
    const byKey = new Map();
    for (const f of findings) {
      const key = `${f.diffs.join(",")}|${f.aLabel}|${f.bLabel}`;
      if (!byKey.has(key)) byKey.set(key, f);
    }
    return [...byKey.values()];
  }, { interactiveSel: INTERACTIVE_SEL, menuOnly: !!surface.menuOnly, scope: surface.scope, exclude: surface.exclude, gapPx: SIBLING_GAP_PX, vTolPx: SIBLING_VCENTER_TOL_PX, rowHops: SIBLING_ROW_ANCESTOR_HOPS });
}

// B950322 (this session's NEW-3) — ALIGNMENT + SIZE, the axis neither nestingMismatches() nor
// siblingMismatches() covers. Owner report: the map landing page's three floating overlays (the
// Sites/Comps rail, the Imagery & layers panel, the top-center search bar) don't share a top edge
// or a height. Those three are not DOM flex-siblings (siblingMismatches()'s grouping would never
// find them) — they are independently `position: absolute` panels that only ever look aligned
// because they float over the same map. So the grouping here is CSS containing-block based, not
// DOM-parent based: every non-nested `position:absolute`/`fixed` node is grouped with its peers by
// (a) sharing the same nearest positioned ancestor, and (b) sitting in the same rough TOP BAND
// (peers more than ALIGN_BAND_PX apart vertically are furniture in a different corner, not a row
// that was ever meant to line up — a bottom-right scale bar and a top-left panel are never this
// check's business). Reports the group's own top-offset spread and height spread; a group is
// flagged when EITHER exceeds its stated tolerance.
const ALIGN_TOP_TOL_PX = 2;
const ALIGN_HEIGHT_TOL_PX = 4;
const ALIGN_BAND_PX = 60;

async function alignmentMismatches(page, surface) {
  return page.evaluate(({ menuOnly, scope, exclude, topTolPx, heightTolPx, bandPx, radiusOk }) => {
    const root = menuOnly
      ? [...document.querySelectorAll('[data-menu-owner]')]
      : [[...document.querySelectorAll(scope)].find((el) => el.getBoundingClientRect().width > 0) || document.body];

    // ⛔ CANDIDATES MUST HAVE A GENUINE ROUNDED CORNER (measured, not assumed — this check
    // reported ZERO on the owner's exact three-overlay case on its first pass). Without this
    // filter, purely structural `position:absolute` wrappers with no visual edge at all (the map
    // container's own `inset:0` div, the page's root shell) enter the candidate pool too — and
    // because they're large enough to CONTAIN every real panel, the "top-level only" filter below
    // reads every real overlay as "nested inside a candidate" and throws it out, which is exactly
    // backwards. A radius requirement is the same "is this actually a control, not scaffolding"
    // test the other two checks already use, and it is a more honest definition of "floating
    // overlay" anyway — the owner's report was about chips/pills, not invisible layout boxes.
    const raw = [];
    for (const r of root) {
      if (!r) continue;
      for (const el of r.querySelectorAll("*")) {
        if (exclude && el.closest(exclude) && el.closest(exclude) !== r) continue;
        const cs = getComputedStyle(el);
        if (cs.position !== "absolute" && cs.position !== "fixed") continue;
        const parts = [...new Set(String(cs.borderRadius).split(/\s+/).map((t) => parseFloat(t)).filter((n) => !Number.isNaN(n)))];
        const radius = parts.length === 1 ? parts[0] : 0;
        if (!radius || !radiusOk.includes(radius)) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const label = el.getAttribute("aria-label") || el.getAttribute("title")
          || (el.textContent || "").trim().slice(0, 30) || el.tagName;
        raw.push({ el, rect, label: String(label).replace(/\s+/g, " ").trim() });
      }
    }

    // Top-level only: a candidate contained inside another candidate's box is that candidate's own
    // internal chrome (e.g. an open panel's inner "collapse" button), never a floating peer of it.
    const contains = (outer, inner) => inner.left >= outer.left - 0.5 && inner.right <= outer.right + 0.5
      && inner.top >= outer.top - 0.5 && inner.bottom <= outer.bottom + 0.5
      && (inner.width < outer.width - 1 || inner.height < outer.height - 1);
    const topLevel = raw.filter((c) => !raw.some((o) => o !== c && contains(o.rect, c.rect)));

    const closestPositioned = (el) => {
      let n = el.parentElement;
      while (n && n !== document.body) {
        if (getComputedStyle(n).position !== "static") return n;
        n = n.parentElement;
      }
      return document.body;
    };
    const byParent = new Map();
    for (const c of topLevel) {
      const p = closestPositioned(c.el);
      if (!byParent.has(p)) byParent.set(p, []);
      byParent.get(p).push(c);
    }

    const findings = [];
    for (const members of byParent.values()) {
      if (members.length < 2) continue;
      const sorted = [...members].sort((a, b) => a.rect.top - b.rect.top);
      // Split into top-proximity bands (a gap over ALIGN_BAND_PX starts a new band — different
      // corners of the same map are never one "should align" group).
      const bands = [];
      let cur = [sorted[0]];
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].rect.top - cur[cur.length - 1].rect.top > bandPx) { bands.push(cur); cur = [sorted[i]]; }
        else cur.push(sorted[i]);
      }
      bands.push(cur);
      for (const band of bands) {
        if (band.length < 2) continue;
        const tops = band.map((c) => c.rect.top), heights = band.map((c) => c.rect.height);
        const topSpread = Math.max(...tops) - Math.min(...tops);
        const heightSpread = Math.max(...heights) - Math.min(...heights);
        if (topSpread <= topTolPx && heightSpread <= heightTolPx) continue;
        findings.push({
          members: band.map((c) => `${c.label} (top ${Math.round(c.rect.top)}, h ${Math.round(c.rect.height)})`),
          topSpread: Math.round(topSpread * 10) / 10, heightSpread: Math.round(heightSpread * 10) / 10,
        });
      }
    }
    return findings;
  }, { menuOnly: !!surface.menuOnly, scope: surface.scope, exclude: surface.exclude, topTolPx: ALIGN_TOP_TOL_PX, heightTolPx: ALIGN_HEIGHT_TOL_PX, bandPx: ALIGN_BAND_PX, radiusOk: [...RADIUS_OK] });
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

/* CONTROL SIGNATURE (NEW-3, B982400/B982402) — the headline metric this item asks for, and it is
 * a NARROWER key than `dedupe()`'s above on purpose. "24 deviations" (the old headline) counted
 * off-scale VALUES; it was never the health metric a design system actually needs, because a 6px
 * chip sitting flush beside an 8px chip is on-scale on BOTH sides and invisible to that count — the
 * exact account-pill failure the item's own brief names. What the owner actually sees is HOW MANY
 * DIFFERENT SHAPES a surface uses at once: (radius, height, padding, fontSize) — never color,
 * weight, background or border, which are legitimate per-role differences (a filled primary button
 * SHOULD look different from an outline icon button; that is not drift). Two elements with the same
 * geometry but different colors are the SAME signature; two with the same color but different
 * heights are DIFFERENT signatures. This is deliberately looser than `dedupe()`'s key, which exists
 * for the per-row table (where color/weight/background/border still matter for attribution) — this
 * metric answers a different question ("how many shapes"), not "how many exact renders".
 */
function controlSignature(row) {
  return [row.borderRadius, row.height, row.padding, row.fontSize].join("|");
}

// { surfaceName: { light: N, dark: N } } — the count of DISTINCT control signatures per surface
// per theme, from the same raw (undeduped) rows `readSurface` collected.
function computeSignatureCounts(results) {
  const counts = {};
  for (const [name, byTheme] of Object.entries(results)) {
    counts[name] = {};
    for (const theme of ["light", "dark"]) {
      const rows = byTheme[theme] || [];
      counts[name][theme] = new Set(rows.map(controlSignature)).size;
    }
  }
  return counts;
}

function loadSignatureCeiling() {
  if (!existsSync(SIGNATURE_CEILING_PATH)) return null;
  return JSON.parse(readFileSync(SIGNATURE_CEILING_PATH, "utf8"));
}

function writeSignatureCeiling(counts) {
  const ceiling = {
    bySurface: counts,
    writtenAt: new Date().toISOString().slice(0, 10),
    note: "Ratchet ceiling for ui-audit/ui-inventory.mjs's per-surface DISTINCT CONTROL SIGNATURE " +
      "count (NEW-3, B982402) — same shape as design-drift-ceiling.json. A surface's count may " +
      "never silently grow; regenerate with `node ui-audit/ui-inventory.mjs --write-signature-ceiling` " +
      "only after a session genuinely LOWERS a surface's count (a real control-geometry " +
      "convergence), or deliberately after adding a new surface to the crawl (a first measurement, " +
      "not a regression). Never raise an EXISTING surface's ceiling to silence real drift.",
  };
  writeFileSync(SIGNATURE_CEILING_PATH, JSON.stringify(ceiling, null, 2) + "\n");
  return ceiling;
}

// Fails when any surface (in either theme) EXCEEDS its recorded ceiling. A surface present in
// `counts` but absent from `ceiling.bySurface` (a newly-crawled surface) is reported as missing a
// baseline rather than silently passing — the same "no silent debt" discipline design-drift's
// checkCeiling applies to a missing ceiling file entirely.
export function checkSignatureCeiling(counts, ceiling) {
  const problems = [];
  if (!ceiling) {
    problems.push("No ui-audit/control-signature-ceiling.json — run --write-signature-ceiling once to establish a baseline.");
    return { ok: false, problems };
  }
  for (const [surface, byTheme] of Object.entries(counts)) {
    const recorded = ceiling.bySurface[surface];
    if (!recorded) {
      problems.push(`"${surface}" has no recorded ceiling — run --write-signature-ceiling to add it (a new surface, not a regression, unless you did not mean to add one).`);
      continue;
    }
    for (const theme of ["light", "dark"]) {
      if (byTheme[theme] > recorded[theme]) {
        problems.push(`"${surface}" (${theme}) grew: ${byTheme[theme]} distinct control signature(s) > ceiling ${recorded[theme]}.`);
      }
    }
  }
  return { ok: problems.length === 0, problems };
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
  const sibling = {}; // surface name -> { light: [...], dark: [...] } of sibling-radius-family findings (B950320)
  const sizeSibling = {}; // surface name -> { light: [...], dark: [...] } of sibling height/padding findings (B982402)
  const alignment = {}; // surface name -> { light: [...], dark: [...] } of top/height alignment findings (B950322)
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
        (sibling[surface.name] ||= {})[theme] = await siblingMismatches(page, surface);
        (sizeSibling[surface.name] ||= {})[theme] = await siblingSizeMismatches(page, surface);
        (alignment[surface.name] ||= {})[theme] = await alignmentMismatches(page, surface);
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

  // B950320/B972097 — sibling radius-family mismatches (adjacent controls, no containment relationship).
  let totalSiblingMismatches = 0;
  const siblingLines = ["## Sibling radius mismatches (B950320, tightened B972097)", "",
    "Two on-scale, differently-shaped controls sitting in the same visual row with no containment",
    "relationship between them — the axis `nestingMismatches()` above cannot see, because that check",
    "only ever compares a control to a CONTAINER. Grouped by shared flex-row ancestor, adjacent",
    `pairs only, within ${SIBLING_GAP_PX}px of clear horizontal space and ${SIBLING_VCENTER_TOL_PX}px`,
    "of shared vertical center — the same \"no gap between the two curves\" the owner's report turns on.",
    "",
    "**B972097 (NEW-2):** a plain gap over the threshold no longer clears a pair on its own — if a",
    "thin (≤ 2px) element sitting between the two accounts for the excess, the pair is measured as",
    "still adjacent and still has to agree. A finding whose gap was bridged only by real clear space",
    "reads as an ordinary mismatch; one where a divider-sized element covers the excess is flagged",
    "`(divider-separated)` below — that annotation is informational, not an exemption: the finding is",
    "still reported and still fails the build. **What this still cannot check:** whether the divider",
    "itself is `docs/DESIGN.md`'s real divider spec (1px, `--chrome-divider`) versus some other thin",
    "element that happens to fit the width budget, and it cannot tell a genuine family boundary (two",
    "unrelated control clusters that were never meant to match) from a loophole use of a divider. Both",
    "read as \"divider-separated\" here; a human still judges which one it is.",
    ""];
  for (const s of SURFACES) {
    for (const theme of ["light", "dark"]) {
      const found = (sibling[s.name] || {})[theme] || [];
      totalSiblingMismatches += found.length;
      if (!found.length) continue;
      siblingLines.push(`**${s.name} — ${theme}:**`, "");
      for (const f of found) {
        const tag = f.dividerSeparated ? " (divider-separated)" : "";
        siblingLines.push(`- "${f.aLabel}" (${f.aRadius}px) sits ${f.gap}px from "${f.bLabel}" (${f.bRadius}px) — different radius families in one row${tag}.`);
      }
      siblingLines.push("");
    }
  }
  if (!totalSiblingMismatches) siblingLines.push("_None found on this run._", "");

  // B982402 (NEW-3) — sibling HEIGHT/PADDING mismatches. Same shape as the radius check above,
  // deliberately: it exists because that check was blind to this axis entirely.
  let totalSizeSiblingMismatches = 0;
  const sizeSiblingLines = ["## Sibling height/padding mismatches (NEW-3, B982402)", "",
    "Two controls sitting in the same visual row with no containment relationship, disagreeing on",
    "HEIGHT and/or PADDING — the axis this inventory never checked before this item: \"not the",
    "bible, not the guard, not the inventory's pass/fail.\" Same grouping and the same",
    "divider-in-span escape as \"Sibling radius mismatches\" above (a real divider still legitimises",
    "two different SIZES sitting apart; it is never an excuse for two sizes sitting flush). The",
    "candidate pool is wider than the radius check's, deliberately: it includes every interactive",
    "control this inventory reads (buttons, inputs, selects, chip-hooked elements), not only ones",
    "with a uniform on-scale radius — a 0px-radius nav tab disagreeing in height with its flush",
    "neighbour is exactly the class this check exists to catch, and the radius check is blind to it",
    "by construction (radius 0 opts out of that check's own candidate pool).",
    ""];
  for (const s of SURFACES) {
    for (const theme of ["light", "dark"]) {
      const found = (sizeSibling[s.name] || {})[theme] || [];
      totalSizeSiblingMismatches += found.length;
      if (!found.length) continue;
      sizeSiblingLines.push(`**${s.name} — ${theme}:**`, "");
      for (const f of found) {
        const tag = f.dividerSeparated ? " (divider-separated)" : "";
        sizeSiblingLines.push(`- "${f.aLabel}" sits ${f.gap}px from "${f.bLabel}" — ${f.diffs.join(", ")}${tag}.`);
      }
      sizeSiblingLines.push("");
    }
  }
  if (!totalSizeSiblingMismatches) sizeSiblingLines.push("_None found on this run._", "");

  // B950322 — top-offset + height alignment mismatches among floating (position:absolute/fixed) peers.
  let totalAlignmentMismatches = 0;
  const alignmentLines = ["## Alignment mismatches (B950322)", "",
    "Floating overlays (`position: absolute`/`fixed`) that share the same positioned ancestor and the",
    "same rough top band, but disagree on their own top edge or height beyond a stated tolerance —",
    `top-offset tolerance ${ALIGN_TOP_TOL_PX}px, height tolerance ${ALIGN_HEIGHT_TOL_PX}px. These are`,
    "not DOM flex-siblings (`siblingMismatches()`'s grouping would never find them) — they only ever",
    "look aligned because they float over the same surface.",
    ""];
  for (const s of SURFACES) {
    for (const theme of ["light", "dark"]) {
      const found = (alignment[s.name] || {})[theme] || [];
      totalAlignmentMismatches += found.length;
      if (!found.length) continue;
      alignmentLines.push(`**${s.name} — ${theme}:**`, "");
      for (const f of found) {
        alignmentLines.push(`- ${f.members.join(" · ")} — top spread ${f.topSpread}px, height spread ${f.heightSpread}px.`);
      }
      alignmentLines.push("");
    }
  }
  if (!totalAlignmentMismatches) alignmentLines.push("_None found on this run._", "");

  // NEW-3 (B982402) — the HEADLINE metric this item asks for: not "how many deviations from a
  // list" (a value can be individually on-scale and still be the wrong one to sit next to its
  // neighbour — the account-pill failure this whole item is about) but "how many DIFFERENT SHAPES
  // does this surface actually use". See controlSignature()'s own header for the precise
  // definition (radius+height+padding+fontSize; never color/weight/background/border).
  const signatureCounts = computeSignatureCounts(results);
  const signatureCeiling = loadSignatureCeiling();
  const signatureCheck = checkSignatureCeiling(signatureCounts, signatureCeiling);
  const signatureLines = ["## Distinct control signatures per surface (NEW-3, B982402)", "",
    "**The headline metric.** Not \"how many values deviate from the allowed list\" — a 6px chip",
    "sitting flush beside an 8px chip is individually on-scale on BOTH sides and invisible to that",
    "count, which is exactly how the account-pill mismatch shipped clean through every prior check.",
    "This counts DISTINCT (radius, height, padding, fontSize) COMBINATIONS actually painted on each",
    "surface — never color, weight, background or border, which are legitimate per-role differences",
    "(a filled primary action SHOULD look different from an outline icon button; that is not drift).",
    "Ratcheted the same way `design-drift-ceiling.json` is: a surface's count may never silently",
    "grow (`ui-audit/control-signature-ceiling.json`, `--write-signature-ceiling` to update after a",
    "genuine convergence).",
    "",
    "| surface | light | dark | ceiling (light/dark) |", "|---|---|---|---|"];
  for (const s of SURFACES) {
    const counts = signatureCounts[s.name] || { light: 0, dark: 0 };
    const recorded = signatureCeiling?.bySurface?.[s.name];
    const ceilingCell = recorded ? `${recorded.light} / ${recorded.dark}` : "_(none recorded)_";
    signatureLines.push(`| ${s.name} | ${counts.light} | ${counts.dark} | ${ceilingCell} |`);
  }
  signatureLines.push("");
  if (!signatureCheck.ok) {
    signatureLines.push("**⚠️ RATCHET FAILED — a surface's signature count grew:**", "");
    for (const p of signatureCheck.problems) signatureLines.push(`- ${p}`);
    signatureLines.push("");
  }

  const md = [
    "# `docs/UI-INVENTORY.md` — the generated control inventory (NEW-3)",
    "",
    "**Generated by `node ui-audit/ui-inventory.mjs` — do not hand-edit.** Regenerate after any UI",
    "change; `--check` fails CI on drift so this file can never go stale. See `docs/DESIGN.md` for",
    "the scale this inventory checks against (`RADIUS` / `FONT_SIZE`).",
    "",
    "## Coverage (NEW-2, 2026-08-31; extended for map-view mode/selection states below)",
    "",
    "**Crawled:** the Map landing page (no project selected — the first screen a user sees) in its",
    "default Site-mode state, PLUS its Comp-mode state (\"Drop a pin\"/\"Comp from parcel\" render only",
    "there) and its \"selecting parcels\" state (the split \"Select parcels ▾\" button's own Cancel",
    "sibling renders only once armed) — added because the map's own action row hides most of its",
    "buttons behind mode/selection state, and the single default-state crawl was silently measuring",
    "none of them. App header + its four dropdown menus (File ▾ / Undo history / Settings gear /",
    "plan menu), the tool rail, the left rail + Yield panel, Library, Doc Review's empty state.",
    "",
    "**Not yet crawled, named rather than silently absent:** the map's \"selected.length > 0\" state",
    "(the \"Plan N parcels →\"/\"Comp N parcels\"/clear-✕ row) — it needs a real parcel click against",
    "live GIS data, the same real-data wall as every other live-verify GIS item in this repo, so it",
    "stays on `VERIFICATION.md` rather than this logged-out crawl. The Scheduler (a separate HTML document",
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
    signatureLines.join("\n"),
    "---",
    "",
    `**Total distinct deviating style signatures found: ${totalDeviations}.** (B915536's earlier "24"`,
    "was measured before the Map landing page — the surface listed first above — was in this crawl at",
    "all; the amended, complete-coverage count was 44. NEW-1/NEW-2 (2026-08-31) then reduced FONT_SIZE",
    "from 8 legal values to 5 named roles and moved every fixable one of those 44 onto it — see",
    "\"Known, deliberately-not-fixed findings\" below for what's left and why. **This count is now the",
    "BACKSTOP, not the headline** — see \"Distinct control signatures per surface\" above for why: it",
    "can certify two individually-on-scale, mutually-wrong values as clean.)",
    "",
    `**Total nesting-family mismatches found (NEW-1): ${totalNestingMismatches}.** See the section below.`,
    "",
    `**Total sibling radius mismatches found (B950320): ${totalSiblingMismatches}.** See the section below.`,
    "",
    `**Total sibling height/padding mismatches found (NEW-3, B982402): ${totalSizeSiblingMismatches}.** See the section below.`,
    "",
    `**Total alignment mismatches found (B950322): ${totalAlignmentMismatches}.** See the section below.`,
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
    "- **RESOLVED, 2026-08-31 (B915536's NEW-2) — the `13.3333px` Chromium UA form-control default",
    "  is GONE from this list.** It was never a value from anywhere in this codebase — `src/index.css`",
    "  sets `input, select, button, textarea { font-family: inherit }` but never `font-size`, so a",
    "  control that set no `fontSize` of its own fell through to that browser default. A GLOBAL fix",
    "  (adding `font-size: inherit` to that same rule) was tried once and reverted: it only moved the",
    "  reading to `16px` (the browser's own root default, since no ancestor declares a base font-size",
    "  either) and carried unverified reflow risk across every unstyled control in the app. Retried at",
    "  the new, narrower scope this scale now allows: every instance (`Full screen`/`Settings`",
    "  icon buttons, the Dashboard logo button, the Cloud-sync badge, the Sites-panel collapse/reorder",
    "  toggles and group-header row, the Yield-panel `Collapse` header, the Settings-gear ThemePicker",
    "  rows and its smooth-zoom checkbox) got its OWN explicit on-scale `fontSize` — most of them icon-",
    "  only or checkbox controls where the property is visually INERT (every visible glyph or label",
    "  inside already set its own explicit size), so this is zero-risk, targeted, and does not touch",
    "  the global reset the reverted attempt was right to be cautious about.",
    "- **A `fontSize` of `16px` on a plain, unstyled `<div>` shell** (the map landing page's search",
    "  cluster bar, the Site/Comp switch's own wrapping div, the Sites/Comps rail panel) is the SAME",
    "  browser root default as the `16px` form above — a container div that sets no `fontSize` of its",
    "  own inherits it, and every visible glyph inside these shells sets its own explicit size. Not a",
    "  form control, but the identical root cause and the identical decision not to chase it here.",
    "- **A `fontSize` of `22px` on the Leaflet zoom stack's `+`/`−` glyphs is LEAFLET'S OWN bundled",
    "  CSS** (`.leaflet-touch .leaflet-control-zoom-in/-out { font-size: 22px }` in",
    "  `node_modules/leaflet/dist/leaflet.css`), not an app literal — corrects an earlier report in",
    "  this same list that misattributed it to `SitePlanner.jsx`'s `zb` (AUDIT-FIRST: verified against",
    "  the real stylesheet, not re-asserted). Same category as the map landing page's scale-bar",
    "  exception in docs/DESIGN.md — third-party chrome this token scale doesn't reach — and the same",
    "  \"decorative glyph, not body text\" rationale as the icon-only buttons above; SitePlanner.jsx's",
    "  OWN zoom-stack glyphs (the Yield-panel `.gbtn` +/−/⤢ trio, a genuinely app-authored style) were",
    "  the real off-scale app literal and were fixed in the same session (B915536's NEW-2) — all three",
    "  now render at `FONT_SIZE.display`, so the row no longer appears in the table above.",
    "- **The \"Alignment mismatches\" section below still reports the map landing page's three floating",
    "  overlays as a height-spread finding (B950321/B950322)** — investigated, and it is now ENTIRELY",
    "  the Sites/Comps rail rendering OPEN by default in this crawl's seeded account (126px of real",
    "  site-list content) against the two chip-scale siblings (the collapsed Layers panel, 30px; the",
    "  search bar, 42px). The TOP SPREAD the owner actually reported is fixed — all three now read",
    "  `0px` (`MAP_OVERLAY_TOP_PX`, one shared edge). Collapse both corner panels (their resting,",
    "  \"pill\" state) and the height spread is genuinely gone too: both corner chips land on the exact",
    "  same `MAP_OVERLAY_CHIP_H_PX` (30px) — verified directly against the real app, not just argued —",
    "  leaving only the search bar's own `MAP_OVERLAY_BAR_H_PX` (42px), a deliberately different number",
    "  for a compound cluster (a Site/Comp switch, an address combobox, one or two action buttons) that",
    "  needs real room for a text field, not a fourth hand-picked literal. This crawl's default-open",
    "  Sites panel is a legitimate, content-driven state, not the reported defect, and is left showing.",
    "",
    nestingLines.join("\n"),
    "---",
    "",
    siblingLines.join("\n"),
    "---",
    "",
    sizeSiblingLines.join("\n"),
    "---",
    "",
    alignmentLines.join("\n"),
    "---",
    "",
    sections.join("\n\n---\n\n"),
    "",
  ].join("\n");

  if (process.argv.includes("--write-signature-ceiling")) {
    const ceiling = writeSignatureCeiling(signatureCounts);
    console.log(`ui-audit/control-signature-ceiling.json written — ${Object.keys(ceiling.bySurface).length} surface(s) recorded.`);
  }

  if (process.argv.includes("--check")) {
    const existing = existsSync(OUT_MD) ? readFileSync(OUT_MD, "utf8") : null;
    const docStale = existing !== md;
    if (docStale) console.error("docs/UI-INVENTORY.md is out of date — regenerate with `node ui-audit/ui-inventory.mjs`.");
    if (!signatureCheck.ok) console.error("Control-signature ceiling check FAILED:\n" + signatureCheck.problems.map((p) => "  • " + p).join("\n"));
    if (docStale || !signatureCheck.ok) process.exit(1);
    console.log("docs/UI-INVENTORY.md is up to date and no surface's control-signature count grew.");
    return;
  }

  writeFileSync(OUT_MD, md);
  console.log(`docs/UI-INVENTORY.md written — ${totalDeviations} distinct deviating style signature(s), ${totalNestingMismatches} nesting mismatch(es), ${totalSiblingMismatches} sibling radius mismatch(es), ${totalSizeSiblingMismatches} sibling height/padding mismatch(es), ${totalAlignmentMismatches} alignment mismatch(es) found.`);
  if (!signatureCheck.ok) {
    console.warn("⚠ Control-signature ceiling check FAILED (see docs/UI-INVENTORY.md's own section):\n" + signatureCheck.problems.map((p) => "  • " + p).join("\n"));
  }
}

run();
