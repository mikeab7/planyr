/* Verify B401 — the Document Review module tab is renamed "Markup" → "Library" (label only;
 * the route/module id `doc-review` is unchanged). Logged out (sandbox can't sign in), which
 * is fine: the module tabs render in the shared shell header regardless of auth.
 *
 *   1. exactly one header button reads "Library";
 *   2. NO header button still reads "Markup" (the stale label is fully gone);
 *   3. clicking "Library" activates that tab (aria-current="page") — proving it's a working
 *      module tab, not a relabelled dead control, and the workspace mounts without a crash.
 *
 * Run: npx vite preview --port 4173 &  then  node ui-audit/verify-b401-library-tab.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1800);

const checks = [];
const ok = (name, cond, extra = "") => { checks.push({ name, pass: !!cond }); console.log(`  ${cond ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`); };

const headerButtonTexts = () => page.evaluate(() =>
  [...document.querySelectorAll("header button")].map((b) => (b.textContent || "").trim()));

const texts = await headerButtonTexts();
const libCount = texts.filter((t) => t === "Library").length;
const markupCount = texts.filter((t) => t === "Markup").length;

ok("exactly one header tab reads \"Library\"", libCount === 1, `found ${libCount}`);
ok("no header tab still reads \"Markup\"", markupCount === 0, `found ${markupCount}`);

// Click the Library tab and confirm it becomes the active module tab.
await page.evaluate(() => {
  const b = [...document.querySelectorAll("header button")].find((x) => (x.textContent || "").trim() === "Library");
  b && b.click();
});
await page.waitForTimeout(1500);

const active = await page.evaluate(() => {
  const b = [...document.querySelectorAll("header button")].find((x) => (x.textContent || "").trim() === "Library");
  return b ? b.getAttribute("aria-current") : null;
});
ok("clicking \"Library\" activates the module tab (aria-current=page)", active === "page", `aria-current=${active}`);
ok("Document Review workspace mounts without a page error", errors.length === 0, errors.join(" | ") || "clean");

await browser.close();
const passed = checks.filter((c) => c.pass).length;
console.log(`\nB401: ${passed}/${checks.length} checks passed`);
process.exit(passed === checks.length ? 0 : 1);
