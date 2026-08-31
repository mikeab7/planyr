/* V11 — Phone layout (B113) headless verification with REAL mobile emulation.
 *
 * The Cowork batch-4 pass couldn't drive this: its `resize_window` tool kept the desktop
 * 1568px render even at a 414px request. Playwright CAN emulate a true phone (isMobile +
 * hasTouch + small viewport + DPR), so this harness exercises the narrow-mode planner the
 * way a phone would and fails loudly on a real responsive defect.
 *
 * Checks (logged-out, seeded local site — no network/Supabase needed):
 *   1. boots straight into the planner (resume) at phone width
 *   2. NO horizontal page overflow (scrollWidth ~= innerWidth) — the canvas fills, not a sliver
 *   3. the top header does NOT wrap to a 2nd row (stays ~one row tall, per V11 spec)
 *   4. the phone-only floating "✎ Tools" button is present
 *   5. tapping Tools slides the right tool rail in (becomes on-screen)
 *   6. picking a tool auto-closes the rail (so you can draw)
 *   7. a left-rail panel (Yield) opens as an OVERLAY over the canvas (absolute, not a sliver push)
 *   8. no uncaught page errors throughout
 *
 * Run:  npm run build && npx vite preview --port 4173
 *       node ui-audit/verify-phone-layout.mjs
 */
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const SITES_KEY = "planarfit:sites:v1";
const CUR_KEY = "planarfit:currentSite:v1";
const GID = "grp-phone", SID = "site-phone";

const demoSite = {
  schemaVersion: 2, id: SID, groupId: GID, site: "Phone Test", name: "Concept A",
  origin: { lat: 29.78, lon: -95.8 }, county: "harris",
  parcels: [{ id: "pc1", locked: false, points: [{ x: -300, y: -150 }, { x: 300, y: -150 }, { x: 300, y: 200 }, { x: -300, y: 200 }] }],
  els: [{ id: "e1", type: "building", cx: 0, cy: -20, w: 360, h: 150, rot: 0 }],
  markups: [], measures: [], callouts: [], settings: {}, underlay: null, updatedAt: Date.now(),
};
const seed = `(() => { try {
  localStorage.setItem(${JSON.stringify(SITES_KEY)}, JSON.stringify(${JSON.stringify({ [SID]: demoSite })}));
  localStorage.setItem(${JSON.stringify(CUR_KEY)}, ${JSON.stringify(SID)});
} catch (e) {} })();`;

const results = [];
const check = (n, p, d = "") => { results.push({ n, p }); console.log(`  ${p ? "✅ PASS" : "❌ FAIL"} — ${n}${d ? "  · " + d : ""}`); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
// iPhone 13-class device: 390×844 CSS px, DPR 3, mobile + touch.
const iphone = devices["iPhone 13"] || { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148" };
const ctx = await browser.newContext({ ...iphone, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
/* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — not its clock, and not its pixels. A hidden tab clamps
   setTimeout (a setTimeout-paced probe then times the clamp: 3,156 ms for a 138-182 ms gesture) AND
   suspends requestAnimationFrame, so after a view change the app's state attributes update while the
   drawing never repaints — every box, position, hit test and screenshot then agrees with every other
   and describes a view the app already left. One precondition covers both, rAF liveness probe
   included; see ui-audit/lib/tabTiming.mjs. Fails loudly rather than reporting either. */
await assertMeasurable(page, "verify-phone-layout");
const errs = []; page.on("pageerror", (e) => errs.push(String(e)));

await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(2200);

// 1) resumed into the planner (the tool rail / canvas chrome exists, finder search hidden)
const inPlanner = await page.evaluate(() => {
  const finder = document.querySelector('input[placeholder*="Search"]');
  const finderVisible = finder && finder.offsetParent !== null;
  const svg = document.querySelector("main svg");
  return { planner: !!svg, finderVisible: !!finderVisible };
});
check("boots into the planner at phone width (not the finder)", inPlanner.planner && !inPlanner.finderVisible,
  `planner=${inPlanner.planner} finderVisible=${inPlanner.finderVisible}`);

// 2) no horizontal overflow — the layout fits the phone, content isn't a clipped sliver
const overflow = await page.evaluate(() => ({
  sw: document.documentElement.scrollWidth, iw: window.innerWidth,
}));
check("no horizontal page overflow (content fits the phone width)", overflow.sw <= overflow.iw + 2,
  `scrollWidth=${overflow.sw} innerWidth=${overflow.iw}`);

// 3) header does not wrap to a 2nd row. Row1 (35) + Row2 (44) = ~79px; a wrap pushes it past ~100.
const headerH = await page.evaluate(() => {
  let h = 0;
  for (const el of document.querySelectorAll("main *, body > div *")) {
    const r = el.getBoundingClientRect();
    if (r.top <= 1 && r.height > 50 && r.height < 160 && r.width > window.innerWidth * 0.8) h = Math.max(h, r.height);
  }
  return h;
});
check("top header stays a single tier (no 2-line wrap on phone)", headerH > 0 && headerH <= 100,
  `headerBand=${Math.round(headerH)}px (≤100 = not wrapped)`);

// 3b) THE REGRESSION GUARD (this is what 8/8 missed before the fix). The header must SCROLL
// SIDEWAYS, not clip: at least one header row's content is wider than the row (scrollable),
// and no control is hidden under overflow:hidden. We assert (a) a header row overflows and is
// horizontally scrollable, and (b) a control that USED to clip away — the Row-2 "Undo" button —
// renders at full width inside the viewport bounds (reachable, not a 0-width sliver).
const scrollProbe = await page.evaluate(() => {
  // Pick the ACTIVE planner header deterministically: the <header> that contains the Row-2
  // toolbar (the Undo button lives only there). A hidden finder <header> can co-exist and
  // sometimes reports the same width, so "widest" was ambiguous — "owns the toolbar" is not.
  const undo = document.querySelector('button[title^="Undo"]');
  const header = undo ? undo.closest("header") : document.querySelector("header");
  const rows = header ? Array.from(header.children).filter((c) => c.tagName === "DIV") : [];
  let anyScrolls = false, maxOverflow = 0;
  for (const row of rows) {
    const over = row.scrollWidth - row.clientWidth; // the ROW itself is the scroll container
    if (over > 4) { anyScrolls = true; maxOverflow = Math.max(maxOverflow, over); }
  }
  const ur = undo ? undo.getBoundingClientRect() : null;
  return { anyScrolls, maxOverflow: Math.round(maxOverflow), undoW: ur ? Math.round(ur.width) : 0 };
});
check("header SCROLLS sideways (content preserved, not clipped)", scrollProbe.anyScrolls,
  `maxRowOverflow=${scrollProbe.maxOverflow}px`);
check("a previously-clipped toolbar control (Undo) renders at full width", scrollProbe.undoW >= 18,
  `undoBtnWidth=${scrollProbe.undoW}px`);

await page.screenshot({ path: OUT + "phone-planner.png" });

// 4) phone-only floating "✎ Tools" button present
const toolsBtn = page.locator('button:has-text("Tools")').first();
const hasTools = await toolsBtn.count().then((c) => c > 0 && toolsBtn.isVisible());
check("phone floating '✎ Tools' button is present", !!hasTools);

// helper: is the dark tool rail currently on-screen (not translated off the right edge)?
const railOnScreen = async () => page.evaluate(() => {
  // The rail holds the draw tools; find a button labelled Rectangle/Line and check its x.
  const btns = Array.from(document.querySelectorAll("button"));
  const tool = btns.find((b) => /Rectangle|Ellipse|Polygon|Polyline/.test(b.getAttribute("title") || b.textContent || ""));
  if (!tool) return false;
  const r = tool.getBoundingClientRect();
  return r.right > 0 && r.left < window.innerWidth - 2 && r.width > 0; // on-screen, inside the viewport
});

// 5) tap Tools → rail slides in
let railOpened = false;
if (hasTools) {
  await toolsBtn.click({ timeout: 5000 });
  await page.waitForTimeout(450); // allow the 0.2s slide transition
  railOpened = await railOnScreen();
  await page.screenshot({ path: OUT + "phone-tools.png" });
}
check("tapping Tools slides the tool rail on-screen", railOpened);

// 6) pick a tool → rail auto-closes
let railClosed = false;
if (railOpened) {
  const rectTool = page.locator('button[title*="Rectangle"], button:has-text("Rectangle")').first();
  if (await rectTool.count()) {
    await rectTool.click({ timeout: 5000 });
    await page.waitForTimeout(450);
    railClosed = !(await railOnScreen());
  }
}
check("picking a tool auto-closes the rail (so you can draw)", railClosed);

// 7) NEW-1 (B917072) — the six-section rail (Land/Analysis/Yield/…) must NOT hold a fixed
// vertical strip at phone width when idle: it is off-screen by default, summoned by a
// "☰ Sections" FAB (mirroring "✎ Tools"), same as the right tool rail.
const sectionsRailOnScreen = async () => page.evaluate(() => {
  const btn = document.querySelector('[data-rail-tab="parcel"]'); // "Land" — always first, never floats
  if (!btn) return false;
  const rail = btn.closest("div");
  const r = rail.getBoundingClientRect();
  return r.right > 0 && r.left < window.innerWidth - 2 && r.width > 0;
});
check("section rail is off-screen by default (no persistent width tax)", !(await sectionsRailOnScreen()));

const sectionsBtn = page.locator('button:has-text("Sections")').first();
const hasSectionsFab = await sectionsBtn.count().then((c) => c > 0 && sectionsBtn.isVisible());
check("phone floating '☰ Sections' button is present", !!hasSectionsFab);

let sectionsRailOpened = false;
if (hasSectionsFab) {
  await sectionsBtn.click({ timeout: 5000 });
  await page.waitForTimeout(450);
  sectionsRailOpened = await sectionsRailOnScreen();
  await page.screenshot({ path: OUT + "phone-sections.png" });
}
check("tapping Sections slides the section rail on-screen", sectionsRailOpened);

// 8) left-rail panel (Yield) opens as an overlay over the canvas, reached through the summoned rail
let panelOverlay = false;
const yieldBtn = page.locator('button[title="Yield"]').first();
if (sectionsRailOpened && (await yieldBtn.count())) {
  await yieldBtn.click({ timeout: 5000 });
  await page.waitForTimeout(400);
  panelOverlay = await page.evaluate(() => {
    // The left panel in narrow mode is position:absolute (overlay), width min(320, 100vw-74).
    const panels = Array.from(document.querySelectorAll("div")).filter((d) => {
      const cs = getComputedStyle(d);
      const r = d.getBoundingClientRect();
      return cs.position === "absolute" && r.left <= 60 && r.height > window.innerHeight * 0.4 && r.width > 200 && r.width < window.innerWidth;
    });
    return panels.length > 0;
  });
  await page.screenshot({ path: OUT + "phone-panel.png" });
}
check("left-rail panel opens as an overlay over the canvas", panelOverlay);
check("section rail stays on-screen while its panel is open (no re-summon needed to switch)", panelOverlay && (await sectionsRailOnScreen()));

// 8) no uncaught errors
check("no uncaught page errors", errs.length === 0, errs.slice(0, 2).join(" | "));

/* ════ NOTES — PHONE DRILL-IN LAYOUT (NEW-1…NEW-4, B849632–B849635) ═══════════════════════
 *
 * Michael's own screenshot: the desktop two-pane rail+editor split does NOT collapse on a
 * phone — the rail takes ~60% of a 390px screen and the editor pane is squeezed into the
 * rest, its title clipped mid-word; the formatting toolbar wraps into a column that runs the
 * full height of the pane. This section drives the SAME iPhone-13-emulated tab against the
 * real Notes route and asserts the fix: the page list is the full-width ROOT view, opening a
 * page PUSHES a full-width editor over it with a Back control (Apple Notes/Bear/Notion/Craft's
 * pattern), the toolbar is one compact scrollable row instead of a column, the search
 * placeholder drops the keyboard-only shortcut hint, and the drill-in's own controls meet the
 * 44px tap-target floor (WCAG 2.5.5) — the same bar B485 met for the planner body. */
const errsBeforeNotes = errs.length;

await page.goto(`${BASE}#/notes`, { waitUntil: "load" });
await page.evaluate(() => { try { localStorage.clear(); } catch (_) {} });
await page.reload({ waitUntil: "load" });
await page.waitForSelector('[data-testid="notes-tree"]', { timeout: 20000 });
await assertMeasurable(page, "verify-phone-layout:notes");

// 9) fresh/empty scope: the page LIST is the root view, full width, no Back control shown
const emptyState = await page.evaluate(() => {
  const tree = document.querySelector('[data-testid="notes-tree"]');
  const back = document.querySelector('[data-testid="notes-mobile-back"]');
  const visible = !!(tree && tree.offsetParent !== null);
  const r = visible ? tree.getBoundingClientRect() : null;
  return {
    treeVisible: visible,
    treeFullWidth: !!(r && Math.abs(r.width - window.innerWidth) < 6),
    backShown: !!(back && back.offsetParent !== null),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  };
});
check("Notes: empty scope shows the page list as the full-width root view", emptyState.treeVisible && emptyState.treeFullWidth && !emptyState.backShown,
  `treeVisible=${emptyState.treeVisible} fullWidth=${emptyState.treeFullWidth} backShown=${emptyState.backShown}`);
check("Notes: no horizontal overflow on the empty list", emptyState.overflow <= 2, `overflow=${emptyState.overflow}px`);

// 10) the search placeholder drops the desktop-only keyboard-shortcut hint on phone (NEW-3)
const searchPh = await page.evaluate(() => document.querySelector('[data-testid="notes-search"]')?.placeholder || "");
check("Notes: search placeholder drops the keyboard-shortcut hint on phone", searchPh === "Search notes", `placeholder="${searchPh}"`);

// 11) "＋ Page" drills straight into a full-width editor (list hidden, Back shown) — this IS
// the module's own "restore straight into a page" behaviour, exercised live.
await page.locator('[data-testid="notes-new-page"]').click({ timeout: 5000 });
await page.waitForTimeout(400);
const afterCreate = await page.evaluate(() => {
  const tree = document.querySelector('[data-testid="notes-tree"]');
  const back = document.querySelector('[data-testid="notes-mobile-back"]');
  return {
    treeHidden: !tree || tree.offsetParent === null,
    backShown: !!(back && back.offsetParent !== null),
    backH: back ? Math.round(back.getBoundingClientRect().height) : 0,
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  };
});
check("Notes: opening a page pushes a full-width editor (list hidden)", afterCreate.treeHidden);
check("Notes: the editor's Back control is on screen and ≥44px tall", afterCreate.backShown && afterCreate.backH >= 44, `backH=${afterCreate.backH}`);
check("Notes: no horizontal overflow with the editor open", afterCreate.overflow <= 2, `overflow=${afterCreate.overflow}px`);

// 12) a realistically long title does not force page-level clipping/overflow
await page.locator('[data-testid="note-title"]').fill("Entitlements and Bonding — Grand Port Phase 2 Coordination");
await page.waitForTimeout(150);
const titleOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check("Notes: a long title does not force page-level overflow", titleOverflow <= 2, `overflow=${titleOverflow}px`);

// 13) THE REGRESSION GUARD — the toolbar is ONE scrollable row, not a wrapped column. This is
// exactly what the owner's screenshot showed (~35 controls stacked to the pane's full height):
// fails on the pre-fix `flexWrap: "wrap"` bar, passes on the fix.
const toolbarShape = await page.evaluate(() => {
  const bar = document.querySelector('[data-testid="note-toolbar"]');
  if (!bar) return null;
  const cs = getComputedStyle(bar);
  const r = bar.getBoundingClientRect();
  return { flexWrap: cs.flexWrap, overflowX: cs.overflowX, height: Math.round(r.height), narrowAttr: bar.getAttribute("data-narrow") };
});
check("Notes: phone toolbar compact mode is engaged (data-narrow=1)", toolbarShape?.narrowAttr === "1", JSON.stringify(toolbarShape));
check("Notes: phone toolbar does not wrap into a column (flex-wrap: nowrap)", toolbarShape?.flexWrap === "nowrap", `flexWrap=${toolbarShape?.flexWrap}`);
check("Notes: phone toolbar scrolls sideways rather than growing tall", toolbarShape?.overflowX === "auto" && toolbarShape.height > 0 && toolbarShape.height <= 70,
  `overflowX=${toolbarShape?.overflowX} height=${toolbarShape?.height}px`);

// 14) the primary row holds only the owner's short list (undo/redo/bold/italic/bullet/
// numbered/link) — everything else lives behind More, closed by default so nothing from the
// sheet is in this DOM query yet.
const primaryRow = await page.evaluate(() => Array.from(
  document.querySelectorAll('[data-testid="note-toolbar"] [data-testid]'),
).map((el) => el.getAttribute("data-testid")));
const EXPECTED_PRIMARY = ["nt-undo", "nt-redo", "nt-bold", "nt-italic", "nt-bullet", "nt-ordered", "nt-link", "nt-more"];
const ALWAYS_HIDDEN = ["nt-image-input"];   // the file <input type=file>, display:none, unrelated to layout
const unexpectedOnRow = primaryRow.filter((id) => !EXPECTED_PRIMARY.includes(id) && !ALWAYS_HIDDEN.includes(id));
check("Notes: only the common controls sit on the primary row, the rest behind More",
  unexpectedOnRow.length === 0 && EXPECTED_PRIMARY.every((id) => primaryRow.includes(id)),
  `row=${JSON.stringify(primaryRow)}`);

// 15) tapping Back returns to the full-width list
await page.locator('[data-testid="notes-mobile-back"]').click({ timeout: 5000 });
await page.waitForTimeout(300);
const afterBack = await page.evaluate(() => {
  const tree = document.querySelector('[data-testid="notes-tree"]');
  const r = tree && tree.offsetParent !== null ? tree.getBoundingClientRect() : null;
  return { treeFullWidth: !!(r && Math.abs(r.width - window.innerWidth) < 6) };
});
check("Notes: Back returns to the full-width page list", afterBack.treeFullWidth);

// 17a) the LIST's own tap targets, measured while the list is actually the visible pane —
// a target hidden behind the OTHER pane reports a 0px rect, which is a harness bug wearing a
// product bug's clothes (DRIVER-SCROLL-IS-NOT-APP-SCROLL's sibling: measure what's on screen).
const listTargets = await page.evaluate(() => {
  const ids = ["notes-new-page", "notes-view-tree", "notes-view-tasks", "notes-view-bin"];
  return ids.map((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (!el) return { id, present: false };
    const r = el.getBoundingClientRect();
    return { id, present: true, h: Math.round(r.height) };
  });
});

// 16) tapping a page row in the list drills back into its editor
await page.locator('[data-testid^="notes-row-"]').first().click({ timeout: 5000 });
await page.waitForTimeout(300);
const afterRowTap = await page.evaluate(() => {
  const back = document.querySelector('[data-testid="notes-mobile-back"]');
  return !!(back && back.offsetParent !== null);
});
check("Notes: tapping a page in the list opens its editor (Back shown)", afterRowTap);

// 17b) the EDITOR's own tap targets, measured while the editor is the visible pane
const editorTargets = await page.evaluate(() => {
  const ids = ["notes-mobile-back", "nt-undo", "nt-bold", "nt-more"];
  return ids.map((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (!el) return { id, present: false };
    const r = el.getBoundingClientRect();
    return { id, present: true, h: Math.round(r.height) };
  });
});
const allTargets = [...listTargets, ...editorTargets];
check("Notes: drill-in tap targets are ≥44px tall", allTargets.every((t) => t.present && t.h >= 44), JSON.stringify(allTargets));

check("Notes: no uncaught page errors", errs.length === errsBeforeNotes, errs.slice(errsBeforeNotes).slice(0, 2).join(" | "));

await ctx.close();
await browser.close();

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
