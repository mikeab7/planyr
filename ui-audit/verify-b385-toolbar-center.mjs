/* B385 — verify the Row-2 center slot on the REAL AppHeader, driven headless against
 * ui-audit/header-center-harness.html:
 *   1. With NO toolbarCenter: the module tabs + right toolbar render and there is NO center
 *      zone — the pre-B385 2-zone layout is unchanged.
 *   2. With toolbarCenter: the center group renders + is visible.
 *   3. The tabs + right toolbar STILL render with the center present (additive, no regression).
 *   4. The center group sits BETWEEN the tabs and the right toolbar, and is optically centered
 *      (its mid-x ≈ the row's mid-x — the left & right zones share the slack like Row 1).
 * Run: npm run dev &  then  node ui-audit/verify-b385-toolbar-center.mjs
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;

const BASE = process.env.BASE_URL || "http://localhost:5173";
const HARNESS_URL = `${BASE}/ui-audit/header-center-harness.html`;
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";

const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 600 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
let pageErrors = 0;
page.on("pageerror", (e) => { pageErrors++; console.log("  [pageerror]", String(e).slice(0, 160)); });
page.on("console", (m) => { if (m.type() === "error") console.log("  [console.error]", m.text().slice(0, 160)); });

try {
  await page.goto(HARNESS_URL, { waitUntil: "load" });
  await page.waitForSelector('[data-scope="with"] [data-testid="center-probe"]', { timeout: 15000 });
  await page.waitForTimeout(300);

  const facts = await page.evaluate(() => {
    const seen = (el) => { if (!el) return false; const cs = getComputedStyle(el); return cs.display !== "none" && cs.visibility !== "hidden" && el.getClientRects().length > 0; };
    const r = (el) => (el ? el.getBoundingClientRect() : null);
    const scope = (name) => {
      const root = document.querySelector(`[data-scope="${name}"]`);
      const header = root && root.querySelector("header");
      const tab = (label) => [...root.querySelectorAll("button")].find((b) => b.textContent.trim() === label);
      const tabs = ["Site", "Schedule", "Markup"].map(tab);
      const center = root.querySelector('[data-testid="center-probe"]');
      const toolbar = root.querySelector('[data-testid="toolbar-probe"]');
      // Row 2 is the SECOND row child of <header> (Row 1 is the first).
      const row2 = header && header.children[1] ? header.children[1] : header;
      return {
        tabsSeen: tabs.every(seen),
        centerExists: !!center,
        centerSeen: seen(center),
        toolbarSeen: seen(toolbar),
        tabMarkupRect: r(tabs[2]),
        centerRect: r(center),
        toolbarRect: r(toolbar),
        row2Rect: r(row2),
      };
    };
    return { without: scope("without"), with: scope("with") };
  });

  // 1) WITHOUT — tabs + toolbar present, NO center zone (layout unchanged).
  ok("no-center: module tabs render", facts.without.tabsSeen);
  ok("no-center: right toolbar renders", facts.without.toolbarSeen);
  ok("no-center: NO center zone exists (2-zone layout unchanged)", !facts.without.centerExists);

  // 2/3) WITH — center renders AND tabs + toolbar still render (additive).
  ok("with-center: center group renders + visible", facts.with.centerSeen);
  ok("with-center: module tabs still render (no regression)", facts.with.tabsSeen);
  ok("with-center: right toolbar still renders (no regression)", facts.with.toolbarSeen);

  // 4) ordering — tabs < center < toolbar along x.
  const w = facts.with;
  const between = !!(w.tabMarkupRect && w.centerRect && w.toolbarRect
    && w.tabMarkupRect.right <= w.centerRect.left + 1
    && w.centerRect.right <= w.toolbarRect.left + 1);
  ok("with-center: center sits BETWEEN the tabs and the right toolbar", between,
    between ? "" : `tabsR=${w.tabMarkupRect?.right} cenL=${w.centerRect?.left} cenR=${w.centerRect?.right} toolL=${w.toolbarRect?.left}`);

  // 4b) optically centered — center mid-x near the row mid-x.
  let centered = false, centeredExtra = "";
  if (w.centerRect && w.row2Rect) {
    const centerMid = w.centerRect.left + w.centerRect.width / 2;
    const rowMid = w.row2Rect.left + w.row2Rect.width / 2;
    const tol = w.row2Rect.width * 0.12; // within 12% of dead-center
    centered = Math.abs(centerMid - rowMid) <= tol;
    centeredExtra = `centerMid=${Math.round(centerMid)} rowMid=${Math.round(rowMid)} tol=${Math.round(tol)}`;
  }
  ok("with-center: center group is optically centered (like Row 1)", centered, centeredExtra);

  ok("no uncaught page errors", pageErrors === 0, `pageErrors=${pageErrors}`);
} catch (e) {
  console.log("HARNESS ERROR:", e.message);
} finally {
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n=== ${passed}/${results.length} checks passed ===`);
  await browser.close();
  process.exit(passed === results.length && results.length >= 9 ? 0 : 1);
}
