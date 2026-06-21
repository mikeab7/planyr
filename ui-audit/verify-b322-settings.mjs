/* B322 — verify the display-theme picker moved from the open header into a row-1
 * Settings gear popover, still works (flips data-theme live), and is reachable signed
 * OUT. Asserts: the old inline segmented control is gone; a Settings gear exists; the
 * popover offers Light/Dark/System; choosing one flips <html data-theme>.
 * Run: node ui-audit/verify-b322-settings.mjs   (vite preview on :4173)
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
// Logged-out, start from System so we can prove a switch sticks.
await ctx.addInitScript(`localStorage.setItem('planyr.theme','system');`);
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1500);

const checks = [];
const ok = (name, cond) => { checks.push({ name, pass: !!cond }); console.log(`  ${cond ? "✓" : "✗"} ${name}`); };

// 1) The old always-open segmented control is gone from the header.
const segmented = await page.locator('header [role="group"][aria-label="Theme"]').count();
ok("inline segmented theme control removed from header", segmented === 0);

// 2) A Settings gear exists in row 1.
const gear = page.locator('button[aria-label="Settings"]');
ok("Settings gear present in header", (await gear.count()) === 1);

// 3) Opening it reveals Light / Dark / System inside the popover panel.
await gear.click();
await page.waitForTimeout(400);
const panelLabels = await page.evaluate(() =>
  [...(document.querySelector(".menu")?.querySelectorAll("button") || [])].map((b) => (b.textContent || "").trim()));
for (const label of ["Light", "Dark", "System"]) {
  ok(`popover offers "${label}"`, panelLabels.some((t) => t.startsWith(label)));
}

// Click an option by label inside the popover — drives the real React onClick.
const clickOption = (label) => page.evaluate((lbl) => {
  const btn = [...(document.querySelector(".menu")?.querySelectorAll("button") || [])].find((b) => (b.textContent || "").trim().startsWith(lbl));
  if (!btn) return false; btn.click(); return true;
}, label);

// 4) Choosing Dark flips <html data-theme> live (no reload) + persists the choice.
ok("Dark option clickable", await clickOption("Dark"));
await page.waitForTimeout(300);
ok("selecting Dark sets data-theme=dark", (await page.evaluate(() => document.documentElement.dataset.theme)) === "dark");
ok("choice persisted to localStorage", (await page.evaluate(() => localStorage.getItem("planyr.theme"))) === "dark");

// 5) And back to Light (the popover stays open after a selection).
ok("Light option clickable", await clickOption("Light"));
await page.waitForTimeout(300);
ok("selecting Light sets data-theme=light", (await page.evaluate(() => document.documentElement.dataset.theme)) === "light");

// 6) This whole flow ran while signed OUT (the Sign in pill is present).
ok("reachable while signed out", (await page.locator('button[title="Sign in or create an account"]').count()) === 1);

await page.screenshot({ path: new URL("./screens/b322-settings-popover.png", import.meta.url).pathname });
await ctx.close();
await browser.close();

const failed = checks.filter((c) => !c.pass);
console.log(failed.length ? `\n✗ ${failed.length} check(s) failed.` : "\n✓ Theme picker relocated to the Settings gear and works (signed out).");
process.exit(failed.length ? 1 : 0);
