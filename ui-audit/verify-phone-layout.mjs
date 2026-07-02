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

// 7) left-rail panel (Yield) opens as an overlay over the canvas
let panelOverlay = false;
const yieldBtn = page.locator('button[title="Yield"]').first();
if (await yieldBtn.count()) {
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

// 8) no uncaught errors
check("no uncaught page errors", errs.length === 0, errs.slice(0, 2).join(" | "));

await ctx.close();
await browser.close();

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
