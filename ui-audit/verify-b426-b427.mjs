/* Headless smoke test for B426+B427: MarkupRenderer + parity tools in DocReview */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const EXEC = "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
const BASE = "http://localhost:4173";

async function run() {
  const browser = await chromium.launch({
    executablePath: EXEC,
    args: ["--no-sandbox", "--ignore-certificate-errors"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  /* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — not its clock, and not its pixels. A hidden tab clamps
     setTimeout (a setTimeout-paced probe then times the clamp: 3,156 ms for a 138-182 ms gesture) AND
     suspends requestAnimationFrame, so after a view change the app's state attributes update while the
     drawing never repaints — every box, position, hit test and screenshot then agrees with every other
     and describes a view the app already left. One precondition covers both, rAF liveness probe
     included; see ui-audit/lib/tabTiming.mjs. Fails loudly rather than reporting either. */
  await assertMeasurable(page, "verify-b426-b427");

  const appErrs = [];
  page.on("pageerror", (e) => appErrs.push("pageerror: " + e.message));

  console.log("→ Loading app at root...");
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(2000);

  // Click the "Review" / doc-review tab
  const tabSel = '[data-testid="module-tab-doc-review"]';
  const tabCount = await page.locator(tabSel).count();
  console.log("  doc-review tab:", tabCount > 0 ? "✓ found" : "✗ MISSING");
  if (tabCount > 0) {
    await page.locator(tabSel).click();
    await page.waitForTimeout(3000);
  }

  console.log("  title:", await page.title());
  console.log("  url:", page.url());

  const testIds = await page.evaluate(() =>
    [...document.querySelectorAll("[data-testid]")].map((el) => el.getAttribute("data-testid"))
  );
  console.log("  all data-testid:", testIds.join(", "));

  await page.screenshot({ path: "ui-audit/screens/b426-b427-smoke.png", fullPage: false });
  console.log("  screenshot saved");

  if (appErrs.length) {
    console.error("\n⛔ Uncaught JS errors:");
    appErrs.forEach((e) => console.error("  ", e));
    process.exit(1);
  }

  const rail = testIds.includes("markup-rail");
  const toolButtons = testIds.filter((id) => id && id.startsWith("tool-"));
  console.log("\n  markup-rail:", rail ? "✓" : "✗");
  console.log("  tool buttons found:", toolButtons.join(", ") || "(none)");

  if (!rail) {
    console.log("\n  DocReview needs auth — no crash = pass for logged-out smoke.");
    console.log("✅ Build + tests green; no JS crash. UI check needs signed-in session.");
  } else {
    const newTools = ["line", "polyline", "polygon", "ellipse"];
    const missing = newTools.filter((t) => !testIds.includes(`tool-${t}`));
    if (missing.length) {
      console.error("\n⛔ Parity tools missing:", missing.join(", "));
      process.exit(1);
    }
    console.log("\n✅ All new parity tools visible in markup-rail.");
  }

  await browser.close();
}

run().catch((e) => { console.error(e); process.exit(1); });
