/* Self-verification for B569/B570 in DOCUMENT REVIEW (the shared selection model's second host).
 * Opens the fixture PDF (browser-only, no auth), draws two rectangles, then:
 *   B570 — the Marquee rail tool exists + LIGHTS (aria-pressed); a box-drag selects both rects.
 *   B569 — neutral hue-free chrome renders on the multi-selection; Delete removes the whole set
 *          (proven by re-marqueeing the same area afterwards and finding NOTHING left). */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const FIXTURE = fileURLToPath(new URL("../e2e/fixtures/sample.pdf", import.meta.url));

let fail = 0;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true, colorScheme: "light" });
const page = await ctx.newPage();
const errors = [];
const isNetNoise = (s) => /ERR_TUNNEL_CONNECTION_FAILED|ERR_CONNECTION_CLOSED|ERR_CERT|Failed to load resource/i.test(s);
page.on("pageerror", (e) => { if (!isNetNoise(String(e))) errors.push(String(e)); });
page.on("console", (m) => { if (m.type() === "error" && !isNetNoise(m.text())) errors.push(m.text()); });

await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1500);

// Open the Review workspace.
const tab = page.locator('[data-testid="module-tab-doc-review"]');
if (await tab.count()) { await tab.click(); await page.waitForTimeout(2500); }

// Open the fixture PDF through the always-rendered header file input (browser-only, no auth).
await page.locator('input[type="file"][accept*="pdf"]').first().setInputFiles(FIXTURE).catch(() => {});
const rail = page.locator('[data-testid="markup-rail"]');
await rail.waitFor({ state: "visible", timeout: 45000 }).catch(() => {});
log(await rail.isVisible().catch(() => false), "fixture PDF opened — the Markup tool rail rendered");

// The neutral chrome's line rect carries stroke=var(--sel-line) (Doc Review keeps its overlay on
// CSS vars, resolved on-screen by the browser) + fill:none → one per selected member.
const selChromeCount = () => page.evaluate(() => {
  let n = 0;
  for (const r of document.querySelectorAll('[data-testid="markup-overlay"] g rect')) {
    if ((r.getAttribute("stroke") || "") === "var(--sel-line)" && (r.getAttribute("fill") || "").toLowerCase() === "none") n++;
  }
  return n;
});
const overlayBox = () => page.evaluate(() => { const s = document.querySelector('[data-testid="markup-overlay"]'); if (!s) return null; const b = s.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
const arm = async (id) => { await page.locator(`[data-testid="tool-${id}"]`).click(); await page.waitForTimeout(150); };
const drag = async (a, b) => { await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2); await page.mouse.move(b.x, b.y); await page.mouse.move(b.x, b.y); await page.mouse.up(); await page.waitForTimeout(250); };

// B570 — the Marquee rail tool exists + lights.
const mq = page.locator('[data-testid="tool-marquee"]');
log(await mq.count() > 0, "B570 Document Review carries the SAME Marquee rail tool (data-testid=tool-marquee)");
await mq.click(); await page.waitForTimeout(150);
log((await mq.getAttribute("aria-pressed")) === "true", "B570 the Marquee button LIGHTS when active (aria-pressed=true)");

// Fit the page so the sheet area is fully on screen, then measure it.
await page.locator('[data-testid="tool-fitP"]').click().catch(() => {});
await page.waitForTimeout(500);
const ob = await overlayBox();
console.log("  overlay box:", JSON.stringify(ob));
log(!!ob && ob.w > 50, "the sheet area is on screen");
// Each rect markup renders as a DIRECT <rect> child of the overlay svg (MarkupRenderer returns it
// unwrapped); the neutral chrome's rects live inside a <g>, so a direct-child count = drawn markups.
const markupCount = () => page.evaluate(() => document.querySelectorAll('[data-testid="markup-overlay"] > rect').length);
// Two rectangles in the left + right of the sheet.
await arm("rect");
await drag({ x: ob.x + ob.w * 0.12, y: ob.y + ob.h * 0.30 }, { x: ob.x + ob.w * 0.34, y: ob.y + ob.h * 0.58 });
await arm("rect");
await drag({ x: ob.x + ob.w * 0.60, y: ob.y + ob.h * 0.30 }, { x: ob.x + ob.w * 0.82, y: ob.y + ob.h * 0.58 });
await page.waitForTimeout(150);
log(await markupCount() >= 2, `two rectangles drawn on the sheet (${await markupCount()} markup groups)`);
await page.keyboard.press("Escape"); await page.waitForTimeout(150);

// B570 — marquee a box over BOTH rects → both selected into the shared set.
await arm("marquee");
await drag({ x: ob.x + ob.w * 0.06, y: ob.y + ob.h * 0.20 }, { x: ob.x + ob.w * 0.90, y: ob.y + ob.h * 0.70 });
const picked = await selChromeCount();
log(picked >= 2, `B570 marquee selected BOTH markups — neutral multi-select chrome rendered (${picked} member outlines)`);

// B569 — Delete removes the WHOLE set. Prove it by re-marqueeing the same area: nothing left.
await page.keyboard.press("Delete"); await page.waitForTimeout(300);
log(await selChromeCount() === 0, "B569 Delete cleared the multi-selection chrome");
await arm("marquee");
await drag({ x: ob.x + ob.w * 0.06, y: ob.y + ob.h * 0.20 }, { x: ob.x + ob.w * 0.90, y: ob.y + ob.h * 0.70 });
const after = await selChromeCount();
log(after === 0, `B569 multi-DELETE actually removed both markups (re-marquee finds nothing: ${after} outlines)`);

await page.screenshot({ path: OUT + "multiselect-docreview.png" });
console.log(errors.length ? `page errors:\n${errors.slice(0, 6).join("\n")}` : "(no page errors)");
if (errors.length) fail++;

await ctx.close();
await browser.close();
console.log(fail === 0 ? "\n✓ ALL DOC-REVIEW B569/B570 CHECKS PASSED" : `\n✗ ${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
