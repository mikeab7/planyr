import { chromium } from "playwright";
const EXEC = process.env.PW_CHROMIUM || undefined;
const BASE = "http://localhost:4174";
const FIXTURE = new URL("../e2e/fixtures/sample.pdf", import.meta.url).pathname;

const run = async () => {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on("pageerror", (e) => console.log("  pageerror:", e.message));
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.getByTestId("module-tab-doc-review").click({ timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(800);
  const fi = page.locator('input[type="file"][accept*="pdf"]');
  await fi.first().setInputFiles(FIXTURE).catch((e) => console.log("file load err", e.message));
  await page.getByTestId("markup-rail").waitFor({ state: "visible", timeout: 30000 }).catch(() => console.log("markup-rail never appeared"));
  await page.waitForTimeout(1200);
  
  const wrap = await page.locator('[data-testid="markup-overlay"]').first().boundingBox().catch(() => null);
  if (!wrap) { console.log("no markup overlay"); await browser.close(); return; }
  const cx = wrap.x + wrap.width / 2, cy = wrap.y + wrap.height / 2;

  // Check callout tool button exists
  const calloutBtn = page.getByTestId("tool-callout");
  const calloutExists = await calloutBtn.count();
  console.log("callout button exists:", calloutExists > 0);
  
  if (calloutExists) {
    // Single-click arm
    await calloutBtn.first().click();
    await page.waitForTimeout(80);
    const armed = await calloutBtn.first().getAttribute("aria-pressed");
    console.log("callout armed:", armed === "true");
    
    // Property panel when armed
    const propsOnArm = await page.locator('[data-testid="property-panel"] input, [data-testid="property-panel"] select').count();
    console.log("props visible when armed:", propsOnArm);
    
    // Draw: first click (leader tip)
    await page.mouse.click(cx - 60, cy + 40);
    await page.waitForTimeout(100);
    // Second click (text box)
    await page.mouse.click(cx + 60, cy - 20);
    await page.waitForTimeout(100);
    // Type text in inline editor then commit with Enter
    await page.keyboard.type("Test note");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(150);
    
    // Check callout markup was created in overlay
    const overlayChildren = await page.evaluate(() => document.querySelectorAll('[data-testid="markup-overlay"] *').length);
    console.log("overlay elements after draw:", overlayChildren);
    
    // Check revert to select
    const selectBtn = page.getByTestId("tool-select");
    const reverted = await selectBtn.getAttribute("aria-pressed");
    console.log("reverted to select:", reverted === "true");
    
    // Check property panel now shows for selected callout
    const propsAfterDraw = await page.locator('[data-testid="property-panel"] input, [data-testid="property-panel"] select').count();
    console.log("props visible after draw (selected callout):", propsAfterDraw);
    
    await page.screenshot({ path: "/tmp/claude-0/-home-user-planyr/7340a47f-c460-50fe-bc79-0c09eedd98ef/scratchpad/callout-test.png" }).catch(() => {});
  }
  
  await browser.close();
  console.log("DONE");
};
run().catch((e) => { console.error(e); process.exit(1); });
