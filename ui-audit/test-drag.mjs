import { chromium } from "playwright";
const EXEC = process.env.PW_CHROMIUM || undefined;
const BASE = "http://localhost:4174";
const FIXTURE = new URL("../e2e/fixtures/sample.pdf", import.meta.url).pathname;

const run = async () => {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.getByTestId("module-tab-doc-review").click({ timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(800);
  await page.locator('input[type="file"][accept*="pdf"]').first().setInputFiles(FIXTURE).catch(() => {});
  await page.getByTestId("markup-rail").waitFor({ state: "visible", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const wrap = await page.locator('[data-testid="markup-overlay"]').first().boundingBox().catch(() => null);
  if (!wrap) { console.log("no overlay"); await browser.close(); return; }
  const cx = wrap.x + wrap.width / 2, cy = wrap.y + wrap.height / 2;

  const count = () => page.evaluate(() => document.querySelectorAll('[data-testid="markup-overlay"] *').length);
  
  // Test drag gesture for rect
  await page.getByTestId("tool-rect").click();
  const before = await count();
  const m = page.mouse;
  await m.move(cx - 80, cy - 60); await m.down();
  await m.move(cx + 80, cy + 60, { steps: 8 });
  await m.up();
  await page.waitForTimeout(150);
  const after = await count();
  console.log("rect drag drew:", after > before, "(before:", before, "after:", after, ")");

  // Test click-click still works for line
  await page.keyboard.press("Escape");
  await page.getByTestId("tool-line").click();
  const before2 = await count();
  await m.click(cx - 50, cy - 30); await m.click(cx + 50, cy + 30);
  await page.waitForTimeout(150);
  const after2 = await count();
  console.log("line click-click drew:", after2 > before2, "(before:", before2, "after:", after2, ")");
  
  await browser.close();
  console.log("DONE");
};
run().catch(e => { console.error(e); process.exit(1); });
