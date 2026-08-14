/* NEW-1 (part 2) — WHICH ORDINARY PANEL INTERACTIONS ARM THE NEXT BACKSPACE.
 *
 * Part 1 proved the reported path: Enter commits the Depth field, focus lands on <body>, and the
 * next Backspace deletes the building AND its whole bonded assembly. This probe asks the general
 * question the owner asked — "find EVERY global key handler and audit ALL of them the same way" —
 * from the other end: after each innocent interaction, what does one keystroke now do?
 *
 * Each arm re-opens the plan fresh, does ONE thing a user would do without thinking, then presses
 * ONE key. The report is the element count before/after plus where focus ended up.
 *
 * Run:  BASE_URL=http://localhost:4184/ node ui-audit/diagnose-key-scope-paths.mjs
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { fixtureSeed } from "./lib/planFixture.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4184/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const SITE = "fm359";
const B1 = "e1454615maruai";
const fixture = JSON.parse(readFileSync(new URL("./fixtures/fm359-concept-a.json", import.meta.url), "utf8"));

const readEls = (page) => page.evaluate(() => {
  const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const site = map[Object.keys(map)[0]] || {};
  return (site.els || []).map((e) => ({ id: e.id, w: e.w, h: e.h }));
});
const focusNow = (page) => page.evaluate(() => {
  const a = document.activeElement;
  if (!a) return "null";
  return a.tagName + (a.getAttribute("aria-label") ? `[${a.getAttribute("aria-label")}]` : "") + (a.title ? `{${a.title}}` : "");
});

async function open(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(fixtureSeed(fixture, { id: SITE, name: "Concept A", site: "FM 359" }));
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 30_000 });
  await page.waitForTimeout(1100);
  await assertMeasurable(page, "diagnose-key-scope-paths");
  const at = await page.evaluate((id) => {
    const n = document.querySelector(`[data-el-id="${id}"]`); if (!n) return null;
    const b = n.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, B1);
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(250);
  const props = page.locator('button[title="Properties"]');
  if (await props.count()) await props.first().click();
  await page.waitForTimeout(400);
  return { ctx, page };
}

async function depthInput(page) {
  const h = await page.evaluateHandle(() => {
    for (const r of document.querySelectorAll("div")) {
      const s = r.firstElementChild;
      if (s && s.tagName === "SPAN" && (s.textContent || "").trim() === "Depth (ft)") { const i = r.querySelector("input"); if (i) return i; }
    }
    return null;
  });
  return h.asElement();
}

const ARMS = [
  ["Enter commits the Depth field", async (p) => { const d = await depthInput(p); await d.click(); await p.keyboard.press("Control+A"); await p.keyboard.type("600"); await p.keyboard.press("Enter"); }, "Backspace"],
  ["Escape leaves the Depth field", async (p) => { const d = await depthInput(p); await d.click(); await p.keyboard.press("Escape"); }, "Backspace"],
  ["Enter, then an arrow key", async (p) => { const d = await depthInput(p); await d.click(); await p.keyboard.press("Control+A"); await p.keyboard.type("600"); await p.keyboard.press("Enter"); }, "ArrowUp"],
  ["Enter, then Delete", async (p) => { const d = await depthInput(p); await d.click(); await p.keyboard.press("Enter"); }, "Delete"],
  ["click the ▲ stepper", async (p) => { await p.locator('button[aria-label="Increase"]').first().click(); }, "Backspace"],
  ["Tab out of the Depth field", async (p) => { const d = await depthInput(p); await d.click(); await p.keyboard.press("Tab"); }, "Backspace"],
  ["click the panel background", async (p) => {
    const box = await p.evaluate(() => { for (const r of document.querySelectorAll("div")) { const s = r.firstElementChild; if (s && s.tagName === "SPAN" && (s.textContent || "").trim() === "Depth (ft)") { const b = r.getBoundingClientRect(); return { x: b.x + 4, y: b.y + b.height / 2 }; } } return null; });
    await p.mouse.click(box.x, box.y);
  }, "Backspace"],
  ["nothing (control: field still focused)", async (p) => { const d = await depthInput(p); await d.click(); }, "Backspace"],
];

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
console.log("\n  after this…                              press   focus       elements   Building 1");
for (const [name, act, key] of ARMS) {
  const { ctx, page } = await open(browser);
  const before = await readEls(page);
  try { await act(page); } catch (e) { console.log(`  ${name} — drive failed: ${e.message}`); await ctx.close(); continue; }
  await page.waitForTimeout(350);
  const f = await focusNow(page);
  await page.keyboard.press(key);
  await page.waitForTimeout(450);
  const after = await readEls(page);
  const b1 = after.find((e) => e.id === B1);
  const verdict = !b1 ? "❌ DELETED" : (b1.h !== before.find((e) => e.id === B1).h ? `⚠ h ${before.find((e) => e.id === B1).h}→${b1.h}` : "ok");
  console.log(`  ${name.padEnd(40)} ${key.padEnd(10)} ${f.slice(0, 11).padEnd(11)} ${String(before.length).padStart(2)}→${String(after.length).padEnd(4)} ${verdict}`);
  await ctx.close();
}
await browser.close();
