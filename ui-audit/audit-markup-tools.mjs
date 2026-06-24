/* B437/B438-audit — drive every Document Review markup tool in a real browser and report
 * the ACTUAL state: does each tool draw? do its properties show? when? (Owner: "the tools are
 * horribly incomplete … you're missing all the properties for every tool.") Logged-out — drawing
 * needs no auth; only saving does. Run: node ui-audit/audit-markup-tools.mjs  (preview on :4173). */
import { chromium } from "playwright";

const EXEC = process.env.PW_CHROMIUM || undefined;
const BASE = "http://localhost:4173";
const FIXTURE = new URL("../e2e/fixtures/sample.pdf", import.meta.url).pathname;

// Drawable tools by gesture (modes/calibrate excluded — they're not markups with properties).
const GESTURES = {
  twoPoint:  ["line", "rect", "ellipse", "cloud", "dimension", "distance"],
  multiPoint:["polyline", "polygon", "perimeter", "area", "arc", "polylength"],
  point:     ["text", "callout", "count"],
  freehand:  ["pen", "highlight"],
  region:    ["snapshot", "eraser"],
};
const modeOf = (id) => Object.keys(GESTURES).find((g) => GESTURES[g].includes(id));

async function arm(page, id) {
  const btn = page.getByTestId(`tool-${id}`);
  if (!(await btn.count())) return false;
  await btn.first().click().catch(() => {});
  return true;
}

async function draw(page, box, id) {
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const m = page.mouse, g = modeOf(id);
  if (g === "twoPoint") { // click-click (the real interaction model)
    await m.click(cx - 60, cy - 40); await m.click(cx + 60, cy + 40);
  } else if (g === "region") {
    await m.move(cx - 60, cy - 40); await m.down(); await m.move(cx + 60, cy + 40, { steps: 6 }); await m.up();
  } else if (g === "freehand") {
    await m.move(cx - 50, cy); await m.down(); await m.move(cx, cy - 30, { steps: 6 }); await m.move(cx + 50, cy, { steps: 6 }); await m.up();
  } else if (g === "multiPoint") {
    await m.click(cx - 50, cy - 30); await m.click(cx + 40, cy - 10); await m.click(cx, cy + 40);
    await m.dblclick(cx, cy + 40);
  } else if (g === "point") {
    await m.click(cx, cy);
    if (id === "callout") await m.click(cx + 50, cy - 40); // second click for the box
    await page.keyboard.type("Xy").catch(() => {});
    await page.keyboard.press("Escape").catch(() => {}); // commit text/callout editor
  }
  await page.waitForTimeout(150);
}

async function countMarkups(page) {
  return page.evaluate(() => document.querySelectorAll('[data-testid="markup-overlay"] *').length);
}

const run = async () => {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on("pageerror", (e) => console.log("  ‼ pageerror:", e.message));
  await page.goto(BASE, { waitUntil: "domcontentloaded" });

  // Open Document Review.
  await page.getByTestId("module-tab-doc-review").click({ timeout: 20000 }).catch(async () => {
    await page.getByRole("button", { name: /review|markup/i }).first().click().catch(() => {});
  });
  await page.waitForTimeout(800);

  // Load the fixture PDF.
  const fi = page.locator('input[type="file"][accept*="pdf"]');
  await fi.first().setInputFiles(FIXTURE).catch((e) => console.log("file load err", e.message));
  await page.getByTestId("markup-rail").waitFor({ state: "visible", timeout: 30000 }).catch(() => console.log("‼ markup-rail never appeared"));
  await page.waitForTimeout(1200);

  const wrap = await page.locator('[data-testid="markup-overlay"]').first().boundingBox().catch(() => null);
  if (!wrap) { console.log("‼ no markup overlay / PDF did not open — cannot drive tools"); await browser.close(); return; }

  const all = [...GESTURES.twoPoint, ...GESTURES.multiPoint, ...GESTURES.point, ...GESTURES.freehand, ...GESTURES.region];
  console.log("\n=== DOCUMENT REVIEW — per-tool audit ===");
  console.log("tool".padEnd(12), "armed", "drew", "propsOnArm", "revertedToSelect", "autoSelectedProps");
  for (const id of all) {
    await page.keyboard.press("Escape").catch(() => {}); // clear any prior selection
    const armed = await arm(page, id);
    await page.waitForTimeout(80);
    const propsOnArm = await page.locator('[data-testid="property-panel"] input, [data-testid="property-panel"] select').count();
    if (id === "line") await page.screenshot({ path: "ui-audit/out-line-armed.png" }).catch(() => {});
    const before = await countMarkups(page);
    await draw(page, wrap, id).catch((e) => console.log("draw err", id, e.message));
    const after = await countMarkups(page);
    const drew = after > before;
    // Bluebeam revert: after a single-use draw the tool should flip to Select and auto-select the
    // new markup (so its panel shows). Measured WITHOUT any extra click.
    await page.waitForTimeout(120);
    const reverted = (await page.getByTestId("tool-select").getAttribute("aria-pressed").catch(() => null)) === "true";
    const autoSelProps = await page.locator('[data-testid="property-panel"] input, [data-testid="property-panel"] select').count();
    console.log(String(id).padEnd(12), String(armed).padEnd(5), String(drew).padEnd(4), String(propsOnArm).padEnd(10), String(reverted).padEnd(16), autoSelProps);
  }

  // Color-instant check: draw a rect (auto-selected), change Line color, read the rendered stroke.
  console.log("\n=== COLOR-INSTANT (selected markup shows its real color live) ===");
  await page.keyboard.press("Escape").catch(() => {});
  await arm(page, "rect");
  const cx = wrap.x + wrap.width / 2, cy = wrap.y + wrap.height / 2;
  await page.mouse.click(cx - 70, cy - 50); await page.mouse.click(cx + 70, cy + 50); // click-click
  await page.waitForTimeout(150);
  const colorInput = page.locator('[data-testid="property-panel"] input[type="color"]').first();
  const had = await colorInput.count();
  if (had) {
    await colorInput.evaluate((el) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, "#00cc44"); // React tracks value — use the native setter so onChange fires
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForTimeout(200);
  }
  const strokes = await page.evaluate(() => [...document.querySelectorAll('[data-testid="markup-overlay"] rect[stroke]')].map((r) => r.getAttribute("stroke")));
  console.log("rect strokes after setting #00cc44:", JSON.stringify(strokes), strokes.some((s) => /00cc44/i.test(s || "")) ? "✓ live" : "✗ not applied");
  await page.screenshot({ path: "ui-audit/out-color-instant.png" }).catch(() => {});

  // Site Planner: is there ANY shared property panel at all?
  console.log("\n=== SITE PLANNER — property panel present? ===");
  await page.getByTestId("module-tab-site-planner").click().catch(() => {});
  await page.waitForTimeout(1500);
  const spPanel = await page.locator('[data-testid="property-panel"]').count();
  console.log("site-planner property-panel testid count:", spPanel, spPanel ? "" : "(shared PropertyPanel NOT wired into Site Planner)");

  await browser.close();
  console.log("\nDONE");
};
run().catch((e) => { console.error(e); process.exit(1); });
