/**
 * B697–B702 Library refactor — logged-out headless smoke.
 *
 * The Library's list/tree render signed-in only (the sandbox blocks sign-in), so this
 * proves the refactored chunk PARSES and renders its signed-out state with zero page
 * errors — the signed-in click-throughs are V232/V233/V234.
 *
 * Run: node ui-audit/verify-library-refactor.mjs   (preview server on :4173)
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium";

let failures = 0;
const check = (ok, label) => { console.log(`  ${ok ? "✓" : "✗"} ${label}`); if (!ok) failures++; };

async function run() {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 820 } })).newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  // Console errors count EXCEPT resource-load failures (the sandbox blocks the cloud
  // endpoints — net::ERR_* on a fetch is the environment, not a code defect).
  page.on("console", (m) => { if (m.type() === "error" && !/net::ERR_|Failed to load resource/.test(m.text())) pageErrors.push(m.text()); });

  await page.goto(`${BASE}#/library`, { waitUntil: "load" });
  await page.waitForTimeout(2500);

  check(await page.locator('[data-testid="library-root"]').count() === 1, "Library workspace mounts at #/library");
  const body = await page.locator('[data-testid="library-root"]').innerText();
  check(/sign in/i.test(body), "signed-out state renders (list/tree are account-gated)");
  check(!/＋ Category/.test(body), "no '＋ Category' button anywhere (B698)");
  check(!/⊞ All/.test(body), "no '⊞ All (projects)' in-pane button (B700)");
  check(pageErrors.length === 0, `zero page/console errors (got ${pageErrors.length}${pageErrors.length ? `: ${pageErrors[0]}` : ""})`);

  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : "\nAll checks passed.");
  process.exit(failures ? 1 : 0);
}
run().catch((e) => { console.error(e); process.exit(1); });
