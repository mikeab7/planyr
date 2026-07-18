/* V247 (B717) live-look verification: poppable / floating left panels — frosted look in both
 * themes, drag feel (clamp already proven by e2e/floating-panels.spec.js), and session-position
 * persistence (sessionStorage while the tab stays open; resets to the default cascade spot in a
 * brand-new tab/session).
 *
 * Run: node ui-audit/verify-v247-floating-panels-live.mjs   (preview on :4173)
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

let fail = 0;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };

const openBlankPlanner = async (page) => {
  await page.goto(BASE + "#/site-planner", { waitUntil: "load" });
  await page.getByText("Start blank", { exact: false }).first().click();
  await page.locator('button[title="Analysis"]').first().waitFor({ state: "visible", timeout: 20000 });
};

// ---- Session A: frosted look in both themes + drag + within-tab persistence ----
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await openBlankPlanner(page);

  await page.locator('button[title="Analysis"]').first().click();
  await page.locator('[data-testid="panel-chrome-analysis-detach"]').click();
  const card = page.locator('[data-testid="floating-panel-analysis"]');
  await card.waitFor({ state: "visible" });

  console.log("\n== Frosted-glass look, light theme ==");
  const style = () => page.evaluate(() => {
    const el = document.querySelector('[data-testid="floating-panel-analysis"]');
    const cs = getComputedStyle(el);
    return { backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter, background: cs.backgroundColor, boxShadow: cs.boxShadow };
  });
  let s = await style();
  log(/blur/i.test(s.backdropFilter), `backdrop-filter carries a blur (frosted glass) in light theme: "${s.backdropFilter}"`);
  log(!!s.boxShadow && s.boxShadow !== "none", `card has a drop shadow (reads as floating over the map): "${s.boxShadow}"`);
  await page.screenshot({ path: OUT + "v247-light-frosted.png" });

  const settingsBtn = page.getByRole("button", { name: "Settings" }).first();
  const closePopover = async () => { await page.mouse.click(10, 10); await page.waitForTimeout(150); };

  console.log("\n== Frosted-glass look, dark theme ==");
  await settingsBtn.click();
  await page.waitForTimeout(200);
  await page.getByText("Dark", { exact: true }).first().click();
  await page.waitForTimeout(300);
  await closePopover();
  const themeAttr = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  log(themeAttr === "dark", `data-theme flipped to dark (${themeAttr})`);
  let sDark = await style();
  log(/blur/i.test(sDark.backdropFilter), `backdrop-filter still carries blur in dark theme: "${sDark.backdropFilter}"`);
  log(sDark.background !== s.background, `card surface color CHANGED between themes (token-driven, not hardcoded): light=${s.background} dark=${sDark.background}`);
  await page.screenshot({ path: OUT + "v247-dark-frosted.png" });
  // back to light for the rest of the run
  await settingsBtn.click({ force: true });
  await page.waitForTimeout(200);
  await page.getByText("Light", { exact: true }).first().click();
  await page.waitForTimeout(300);
  await closePopover();

  console.log("\n== Drag to a distinctive spot, dock, re-detach → returns to the SAME spot (within-tab) ==");
  const box1 = await card.boundingBox();
  const grabX = box1.x + box1.width / 2, grabY = box1.y + 14;
  const targetX = grabX + 160, targetY = grabY + 90;
  await page.mouse.move(grabX, grabY);
  await page.mouse.down();
  await page.mouse.move(targetX, targetY, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const box2 = await card.boundingBox();
  log(Math.abs(box2.x - box1.x) > 50 || Math.abs(box2.y - box1.y) > 50, `card actually moved on drag (Δx=${(box2.x - box1.x).toFixed(0)}, Δy=${(box2.y - box1.y).toFixed(0)})`);

  await page.locator('[data-testid="floating-panel-analysis-chrome-dock"]').click();
  await card.waitFor({ state: "hidden" });
  await page.waitForTimeout(150);
  await page.locator('[data-testid="panel-chrome-analysis-detach"]').click();
  await card.waitFor({ state: "visible" });
  const box3 = await card.boundingBox();
  log(Math.abs(box3.x - box2.x) < 3 && Math.abs(box3.y - box2.y) < 3, `re-detach returns to the SAME position (dragged=${box2.x.toFixed(0)},${box2.y.toFixed(0)} → redetached=${box3.x.toFixed(0)},${box3.y.toFixed(0)})`);

  console.log("\n== Switch panels, re-detach the SAME panel again → position still remembered ==");
  await page.locator('[data-testid="floating-panel-analysis-chrome-dock"]').click();
  await card.waitFor({ state: "hidden" });
  // Docked panels are single-slot (opening Parcel swaps Analysis out of the dock) — switch to
  // Parcel and back to Analysis, then re-detach Analysis.
  await page.locator('button[title="Parcel"]').first().click();
  await page.waitForTimeout(150);
  await page.locator('button[title="Analysis"]').first().click();
  await page.waitForTimeout(150);
  await page.locator('[data-testid="panel-chrome-analysis-detach"]').click();
  await card.waitFor({ state: "visible" });
  const box4 = await card.boundingBox();
  log(Math.abs(box4.x - box2.x) < 3 && Math.abs(box4.y - box2.y) < 3, `after switching panels, re-detach STILL returns to the dragged spot (${box4.x.toFixed(0)},${box4.y.toFixed(0)})`);

  log(errors.length === 0, `no page errors this session (${errors.length})`);
  if (errors.length) fail += errors.length;
  await ctx.close();

  // stash the dragged position for the cross-session comparison below
  globalThis.__draggedPos = { x: box2.x, y: box2.y };
}

// ---- Session B: a BRAND-NEW tab/session (fresh sessionStorage) → resets to the default spot ----
{
  console.log("\n== Brand-new tab/session → detach resets to the DEFAULT cascade spot, not the remembered drag ==");
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  await openBlankPlanner(page);
  await page.locator('button[title="Analysis"]').first().click();
  await page.locator('[data-testid="panel-chrome-analysis-detach"]').click();
  const card = page.locator('[data-testid="floating-panel-analysis"]');
  await card.waitFor({ state: "visible" });
  const boxNew = await card.boundingBox();
  const prev = globalThis.__draggedPos;
  const same = prev && Math.abs(boxNew.x - prev.x) < 3 && Math.abs(boxNew.y - prev.y) < 3;
  log(!same, `fresh session does NOT reuse the other session's dragged position (fresh=${boxNew.x.toFixed(0)},${boxNew.y.toFixed(0)} vs old drag=${prev.x.toFixed(0)},${prev.y.toFixed(0)})`);
  await page.screenshot({ path: OUT + "v247-fresh-session-default.png" });
  await ctx.close();
}

console.log(fail === 0 ? "\n✓ ALL V247 CHECKS PASSED" : `\n✗ ${fail} CHECK(S) FAILED`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
