/* verify-spreadsheet-flat-chrome — NEW-1 (Spreadsheet): the formatting toolbar and the formula bar are FLAT, full-width
 * strips directly under the module tabs (no rounded floating card, no shadow, no grey band around them) and the grid
 * starts flush at the window's left edge and runs to its right edge.
 *
 *  1 desktop 1440x900   toolbar + formula bar: x=0, full window width, square corners, no shadow, no outer margin; the
 *                       formula bar sits FLUSH under the toolbar (0 gap) and the grid flush under it; the grid and
 *                       the sheet-tab strip span the window with no side inset
 *  2 measures           where the first grid row starts, and how many rows are visible (printed as MEASURE {...})
 *  3 narrow 600x800     the toolbar collapses into its More menu — every visible control inside the strip, none clipped,
 *                       page never scrolls sideways
 *  4 dark theme         both strips paint a real (non-transparent) surface and the same one
 *  5 dropdowns          every toolbar dropdown (font, size, number format, insert, delete, …) opens fully inside the
 *                       window, directly under its button
 *  6 fullscreen toggle  the header's full-screen button flips and the strips stay flat and flush
 * KNOWN-GOOD ARM: the toolbar, the formula bar and the grid must all be found and have a real size before anything is judged.
 * Run: node ui-audit/verify-spreadsheet-flat-chrome.mjs [base=http://localhost:5199] [--shots dir] [--signed-in] [--expect-old]
 *   --signed-in  signs in as the test account (E2E_LOGIN_KEY) and opens its fixture site instead of a seeded local project
 *   --expect-old exits 0 when the OLD card layout is measured (used once to record the "before" numbers) */
import { chromium } from "@playwright/test";
import { mkdirSync, existsSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn, FIXTURE_SITE_ID } from "./lib/signedInSession.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const BASE = args.find((a) => /^https?:/.test(a)) || "http://localhost:5199";
const SHOTS = val("--shots");
const SIGNED_IN = flag("--signed-in");
const EXPECT_OLD = flag("--expect-old");
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); if (!cond) failures++; };
const near = (a, b, tol = 0.6) => Math.abs(a - b) <= tol;

let browser, page, signed = null;
if (SIGNED_IN) {
  signed = await openSignedIn({ base: BASE });
  page = signed.page;
} else {
  browser = await chromium.launch({ executablePath: existsSync(chromium.executablePath()) ? undefined : "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await ctx.newPage();
  const id = `zz-flat-chrome-${Date.now().toString(36)}`;
  const site = { id, groupId: id, site: "ZZ Flat chrome (throwaway)", name: "ZZ Flat chrome (throwaway)", origin: null, county: "harris", parcels: [], els: [], markups: [], measures: [], callouts: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now() };
  await page.addInitScript(([sid, rec]) => { localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [sid]: rec })); }, [id, site]);
  page.__projectId = id;
}
const projectId = SIGNED_IN ? FIXTURE_SITE_ID : page.__projectId;

const measure = () => page.evaluate(() => {
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, right: b.right, bottom: b.bottom }; };
  const q = (t) => document.querySelector(`[data-testid="${t}"]`);
  const card = q("model-toolbar-card"), ribbon = q("model-ribbon"), nameBox = q("model-name-box"), sheet = q("model-sheet"), tabs = q("model-tab-strip");
  const fbar = nameBox ? nameBox.parentElement : null;
  const cs = (el, p) => (el ? getComputedStyle(el)[p] : null);
  const hdr0 = q("model-col-header-0");
  const sheetB = sheet ? sheet.getBoundingClientRect() : null;
  const rowCells = sheet ? [...sheet.querySelectorAll('[data-testid^="model-row-header-"]')] : [];
  const visibleRows = rowCells.filter((el) => { const b = el.getBoundingClientRect(); return sheetB && b.top >= sheetB.top - 0.5 && b.bottom <= sheetB.bottom + 0.5; }).length;
  const row0 = q("model-row-header-0");
  return {
    vw: window.innerWidth, vh: window.innerHeight, docScrollW: document.documentElement.scrollWidth,
    card: r(card), ribbon: r(ribbon), fbar: r(fbar), sheet: r(sheet), tabs: r(tabs), colHeader0: r(hdr0), row0: r(row0),
    cardStyle: card ? { margin: cs(card, "margin"), radius: cs(card, "borderRadius"), shadow: cs(card, "boxShadow"), border: cs(card, "borderTopWidth") + "/" + cs(card, "borderLeftWidth") } : null,
    sheetStyle: sheet ? { marginL: cs(sheet, "marginLeft"), marginR: cs(sheet, "marginRight"), radiusTL: cs(sheet, "borderTopLeftRadius"), borderL: cs(sheet, "borderLeftWidth") } : null,
    tabsStyle: tabs ? { marginL: cs(tabs, "marginLeft"), marginB: cs(tabs, "marginBottom"), radiusBL: cs(tabs, "borderBottomLeftRadius"), shadow: cs(tabs, "boxShadow") } : null,
    ribbonBg: cs(ribbon, "backgroundColor"), fbarBg: cs(fbar, "backgroundColor"),
    ribbonBtns: ribbon ? [...ribbon.querySelectorAll("button")].map((b) => { const x = b.getBoundingClientRect(); return { l: x.left, r: x.right, w: x.width, h: x.height }; }).filter((x) => x.w > 0) : [],
    visibleRows,
    firstRowTop: row0 ? row0.getBoundingClientRect().top : null,
  };
});

const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };

try {
  await page.goto(`${BASE}/#/project/${projectId}/spreadsheet`, { waitUntil: "load" });
  await page.waitForSelector('[data-testid="model-sheet"]', { timeout: 60000 });
  await page.waitForTimeout(800);
  await assertMeasurable(page, "verify-spreadsheet-flat-chrome");
  if (SIGNED_IN) console.log(`served build: ${signed.build}  account: ${signed.proof?.email}  base: ${BASE}`);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(400);

  // ── 1+2 desktop ────────────────────────────────────────────────────────────────────────────────────────────────
  const m = await measure();
  ok("known-good arm: toolbar, formula bar and grid all found with a real size", !!(m.ribbon && m.fbar && m.sheet && m.ribbon.w > 100 && m.fbar.w > 100 && m.sheet.h > 100));
  const oldLayout = !!(m.cardStyle && parseFloat(m.cardStyle.radius) > 0);
  if (EXPECT_OLD) ok("old card layout measured (expected for the 'before' run)", oldLayout);
  console.log("MEASURE " + JSON.stringify({ viewport: [m.vw, m.vh], toolbarTop: m.ribbon?.y, formulaBarTop: m.fbar?.y, gridTop: m.sheet?.y, colHeaderTop: m.colHeader0?.y, firstRowTop: m.firstRowTop, gridLeft: m.sheet?.x, gridWidth: m.sheet?.w, visibleRows: m.visibleRows, cardStyle: m.cardStyle, sheetStyle: m.sheetStyle, tabsStyle: m.tabsStyle }));
  await shot("desktop-light");
  if (!EXPECT_OLD) {
    const card = m.card;
    ok("toolbar block is flush left and spans the whole window", card && near(card.x, 0) && near(card.w, m.vw), `x=${card?.x} w=${card?.w} vw=${m.vw}`);
    ok("toolbar block: no margin, square corners, no shadow", m.cardStyle && m.cardStyle.margin === "0px" && m.cardStyle.radius === "0px" && m.cardStyle.shadow === "none", JSON.stringify(m.cardStyle));
    ok("formula bar sits flush under the toolbar (no gap) and spans the window", m.fbar && m.ribbon && near(m.fbar.y, m.ribbon.bottom, 1) && near(m.fbar.x, 0) && near(m.fbar.w, m.vw), `ribbon.bottom=${m.ribbon?.bottom} fbar.y=${m.fbar?.y}`);
    ok("grid starts flush under the formula bar (no gap)", m.sheet && m.card && near(m.sheet.y, m.card.bottom, 1.5), `card.bottom=${m.card?.bottom} sheet.y=${m.sheet?.y}`);
    ok("grid is flush left and runs to the right edge (no side inset, no rounded top)", m.sheet && near(m.sheet.x, 0) && near(m.sheet.w, m.vw) && m.sheetStyle.marginL === "0px" && m.sheetStyle.marginR === "0px" && m.sheetStyle.radiusTL === "0px", JSON.stringify(m.sheetStyle));
    ok("sheet-tab strip spans the window with no inset, corners or shadow", m.tabs && near(m.tabs.x, 0) && near(m.tabs.w, m.vw) && m.tabsStyle.radiusBL === "0px" && m.tabsStyle.shadow === "none" && m.tabsStyle.marginB === "0px", JSON.stringify(m.tabsStyle));
    const inputs = await page.evaluate(() => ["model-name-box", "model-formula-bar"].map((t) => { const c = getComputedStyle(document.querySelector(`[data-testid="${t}"]`)); return { t, radius: c.borderTopLeftRadius, top: c.borderTopWidth, left: c.borderLeftWidth, bg: c.backgroundColor }; }));
    ok("formula bar: no shaded pills or rounded inset boxes (square, no box border, no fill)", inputs.every((i) => i.radius === "0px" && i.top === "0px" && i.left === "0px" && (i.bg === "rgba(0, 0, 0, 0)" || i.bg === "transparent")), JSON.stringify(inputs));
    ok("buttons keep comfortable hit targets (>= 26 tall)", m.ribbonBtns.length > 0 && m.ribbonBtns.every((b) => b.h >= 26), `min h=${Math.min(...m.ribbonBtns.map((b) => b.h))}`);
  }

  // ── 3 narrow ───────────────────────────────────────────────────────────────────────────────────────────────────
  await page.setViewportSize({ width: 600, height: 800 });
  await page.waitForTimeout(500);
  const n = await measure();
  await shot("narrow-light");
  ok("narrow: page does not scroll sideways", n.docScrollW <= n.vw + 1, `scrollWidth=${n.docScrollW} vw=${n.vw}`);
  ok("narrow: every toolbar control sits fully inside the strip (none clipped or overlapping)", n.ribbon && n.ribbonBtns.every((b) => b.l >= n.ribbon.x - 0.5 && b.r <= n.ribbon.right + 0.5), `ribbon=${n.ribbon?.x}-${n.ribbon?.right}`);
  const sorted = [...n.ribbonBtns].sort((a, b) => a.l - b.l);
  ok("narrow: no two toolbar controls overlap", sorted.every((b, i) => i === 0 || b.l >= sorted[i - 1].r - 0.5));
  ok("narrow: the More menu button is present (overflow folded, not clipped)", (await page.locator('[data-testid="ribbon-more"]').count()) === 1);
  ok("narrow: formula bar still usable (name box and fx field have width)", await page.evaluate(() => { const a = document.querySelector('[data-testid="model-name-box"]'), b = document.querySelector('[data-testid="model-formula-bar"]'); return a.getBoundingClientRect().width > 30 && b.getBoundingClientRect().width > 80; }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(500);

  // ── 4 dark ─────────────────────────────────────────────────────────────────────────────────────────────────────
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await page.waitForTimeout(300);
  const d = await measure();
  await shot("desktop-dark");
  const solid = (c) => c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent";
  ok("dark: toolbar and formula bar paint a real surface, and the same one", solid(d.ribbonBg) && solid(d.fbarBg) && (d.ribbonBg === d.fbarBg || EXPECT_OLD), `${d.ribbonBg} / ${d.fbarBg}`);
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await page.waitForTimeout(200);

  // ── 5 dropdowns ────────────────────────────────────────────────────────────────────────────────────────────────
  const triggers = page.locator('[data-testid="model-ribbon"] button[aria-haspopup="true"]');
  const count = await triggers.count();
  ok("known-good arm: the toolbar exposes dropdowns to test", count >= 4, `${count} dropdowns`);
  let opened = 0;
  for (let i = 0; i < count; i++) {
    const t = triggers.nth(i);
    if (!(await t.isVisible())) continue;
    const title = (await t.getAttribute("title")) || `#${i}`;
    const a = await t.boundingBox();
    await t.click();
    await page.waitForTimeout(250);
    const menu = await page.evaluate(() => { const el = [...document.querySelectorAll("[data-menu-layer]")].find((e) => getComputedStyle(e).opacity === "1"); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, r: b.right, b: b.bottom }; });
    opened++;
    ok(`dropdown "${title}" opens inside the window, directly under its button`, !!menu && menu.x >= 0 && menu.r <= 1440 + 0.5 && menu.b <= 900 + 0.5 && menu.y >= a.y + a.height - 2 && menu.y <= a.y + a.height + 14, menu ? `anchor.bottom=${(a.y + a.height).toFixed(1)} menu.y=${menu.y.toFixed(1)}` : "menu not found");
    if (i === 1) await shot("dropdown-open");
    await page.keyboard.press("Escape");
    await page.mouse.click(700, 500);
    await page.waitForTimeout(150);
  }
  ok("known-good arm: at least four dropdowns were actually opened", opened >= 4, `${opened} opened`);

  // ── 6 fullscreen toggle ────────────────────────────────────────────────────────────────────────────────────────
  const fs = page.locator('[data-testid="toggle-fullscreen"]');
  if (await fs.count()) {
    const before = await fs.getAttribute("aria-pressed");
    await fs.click();
    await page.waitForTimeout(600);
    const after = await fs.getAttribute("aria-pressed");
    const f = await measure();
    await shot("fullscreen");
    ok("fullscreen: the header toggle flips",after !== before, `aria-pressed ${before} -> ${after}`);
    if (!EXPECT_OLD) ok("fullscreen: toolbar, formula bar and grid stay flat and flush left", f.card && near(f.card.x, 0) && near(f.sheet.x, 0) && near(f.fbar.y, f.ribbon.bottom, 1), `card.x=${f.card?.x} sheet.x=${f.sheet?.x}`);
    if (after === "true") await fs.click();
  } else {
    ok("fullscreen button present", false);
  }
} catch (e) {
  console.log("FAIL — harness error: " + (e?.stack || e));
  failures++;
} finally {
  if (signed) await signed.close?.(); else await browser?.close();
}
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(EXPECT_OLD ? (failures ? 1 : 0) : (failures ? 1 : 0));
