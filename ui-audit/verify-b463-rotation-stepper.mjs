/* B463 — verify the shared RotationStepper (retires the 0–360 slider), driven headless
 * against ui-audit/rotation-stepper-harness.html. Proves the owner's NEW-3 spec in a real
 * browser with the real component:
 *   1. renders a numeric input + ▲▼ spinners, and there is NO <input type=range> anywhere;
 *   2. typing normalizes/wraps on commit (370 → 10, −5 → 355);
 *   3. a ▲ spinner click nudges +1° about the stored value;
 *   4. garbage ("abc") flashes invalid and does NOT clamp the value to 0;
 *   5. empty input on blur reverts to the last committed value (never zeroes);
 *   6. a locked instance disables BOTH the input and the spinners (refuses, with a reason).
 * Run: npm run dev &  then  node ui-audit/verify-b463-rotation-stepper.mjs
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;

const BASE = process.env.BASE_URL || "http://localhost:5173";
const HARNESS_URL = `${BASE}/ui-audit/rotation-stepper-harness.html`;
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";

const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 900, height: 600 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
let pageErrors = 0;
page.on("pageerror", (e) => { pageErrors++; console.log("  [pageerror]", String(e).slice(0, 160)); });

const NORMAL = '[data-testid="stepper-normal"]';
const valueOf = (scope) => page.locator(`[data-value="${scope}"]`).textContent().then((t) => Number(t));
const setText = async (val) => { await page.locator(NORMAL).fill(String(val)); await page.locator(NORMAL).press("Enter"); await page.waitForTimeout(120); };

try {
  await page.goto(HARNESS_URL, { waitUntil: "load" });
  await page.waitForSelector(NORMAL, { timeout: 15000 });
  await page.waitForTimeout(300);

  // 1) numeric input + spinners present, NO range slider anywhere.
  const shape = await page.evaluate(() => ({
    inputs: document.querySelectorAll('input').length,
    ranges: document.querySelectorAll('input[type=range]').length,
    upBtns: document.querySelectorAll('button[aria-label="Rotate one degree clockwise"]').length,
    downBtns: document.querySelectorAll('button[aria-label="Rotate one degree counterclockwise"]').length,
  }));
  ok("renders numeric inputs (2 instances) + ▲▼ spinners", shape.inputs >= 2 && shape.upBtns >= 2 && shape.downBtns >= 2, JSON.stringify(shape));
  ok("NO <input type=range> slider anywhere (slider retired)", shape.ranges === 0, `ranges=${shape.ranges}`);

  // 2) typing wraps/normalizes on commit.
  await setText("370");
  ok("typing 370 → commits 10 (wrap over 360)", (await valueOf("normal")) === 10, `value=${await valueOf("normal")}`);
  await setText("-5");
  ok("typing −5 → commits 355 (wrap negative)", (await valueOf("normal")) === 355, `value=${await valueOf("normal")}`);
  await setText("45.25");
  ok("typing 45.25 → keeps hundredth-degree precision", (await valueOf("normal")) === 45.25, `value=${await valueOf("normal")}`);

  // 3) spinner +1° about the stored value.
  await page.locator(`[data-scope="normal"] button[aria-label="Rotate one degree clockwise"]`).click();
  await page.waitForTimeout(120);
  ok("▲ spinner nudges +1° (45.25 → 46.25, no drift)", (await valueOf("normal")) === 46.25, `value=${await valueOf("normal")}`);

  // 4) garbage flashes invalid and does NOT clamp to 0.
  await page.locator(NORMAL).fill("abc");
  await page.locator(NORMAL).press("Enter");
  await page.waitForTimeout(150);
  const invalidAttr = await page.locator(NORMAL).getAttribute("aria-invalid");
  ok("garbage 'abc' flags aria-invalid", invalidAttr === "true", `aria-invalid=${invalidAttr}`);
  ok("garbage does NOT clamp the value to 0 (stays 46.25)", (await valueOf("normal")) === 46.25, `value=${await valueOf("normal")}`);

  // 5) empty input on blur reverts to last committed (never zeroes).
  await page.waitForTimeout(1100); // let the invalid flash clear
  await page.locator(NORMAL).fill("");
  await page.locator(NORMAL).press("Enter");
  await page.waitForTimeout(150);
  const afterEmpty = await page.locator(NORMAL).inputValue();
  ok("empty on blur reverts to last committed (46.25), never 0", (await valueOf("normal")) === 46.25 && afterEmpty === "46.25", `value=${await valueOf("normal")} input=${afterEmpty}`);

  // 6) locked instance disables input AND spinners.
  const lockState = await page.evaluate(() => {
    const root = document.querySelector('[data-scope="locked"]');
    const inp = root.querySelector('input');
    const btns = [...root.querySelectorAll('button')];
    return { inputDisabled: !!inp.disabled, allBtnsDisabled: btns.length > 0 && btns.every((b) => b.disabled) };
  });
  ok("locked instance: input disabled", lockState.inputDisabled);
  ok("locked instance: both spinners disabled (refuses rotation)", lockState.allBtnsDisabled);

  ok("no uncaught page errors", pageErrors === 0, `pageErrors=${pageErrors}`);
} catch (e) {
  console.log("HARNESS ERROR:", e.message);
  results.push({ name: "harness ran", pass: false });
} finally {
  await browser.close();
}

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length && results.length > 0 ? 0 : 1);
