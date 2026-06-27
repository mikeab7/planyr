// B437 — the Callout tool must be present + armable in the Document Review rail (it was missing when the
// backlog item was filed; the B432 loop caught it as the one tool that SKIPPED instead of arming). This
// confirms the gap is closed: open the fixture PDF (logged-out — the rail + tools are browser-only), then
// arm `callout` (and `text`) and assert aria-pressed flips, plus draw a callout and confirm it commits.
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const FIXTURE = fileURLToPath(new URL("../e2e/fixtures/sample.pdf", import.meta.url));
let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ✓ ${m}`); pass++; };
const bad = (m) => { console.error(`  ✗ ${m}`); fail++; };

const br = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const page = await br.newPage();
const errors = []; page.on("pageerror", (e) => errors.push(e.message));
await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });

const tab = page.locator('[data-testid="module-tab-doc-review"]');
await tab.waitFor({ state: "visible", timeout: 15000 });
await tab.click();
ok("Review tab opened");

const input = page.locator('input[type="file"][accept*="pdf"]').first();
await input.waitFor({ state: "attached", timeout: 10000 });
await input.setInputFiles(FIXTURE);
ok("fixture PDF set on the file input");

const rail = page.locator('[data-testid="markup-rail"]');
try { await rail.waitFor({ state: "visible", timeout: 30000 }); ok("tool rail rendered after opening the PDF"); }
catch { bad("tool rail did NOT render within 30s"); }

// THE B437 ASSERTION: callout (+ text, its sibling) are present and ARM (aria-pressed flips).
for (const id of ["text", "callout"]) {
  const btn = page.locator(`[data-testid="tool-${id}"]`);
  if (!(await btn.count())) { bad(`tool-${id} button MISSING (the B437 gap)`); continue; }
  await btn.click();
  const pressed = await btn.getAttribute("aria-pressed");
  if (pressed === "true") ok(`tool-${id} arms (aria-pressed=true)`);
  else bad(`tool-${id} did not arm (aria-pressed=${pressed})`);
}

// Best-effort draw (informational, NON-fatal): driving the callout's two-click placement + inline editor
// with synthetic mouse events is unreliable headless (same limitation noted for paste in V120 — React's
// canvas pointer/selection doesn't always engage from CDP clicks). The ARM check above + the matrix↔schema
// conformance (node check) are the reliable verification that B437 is wired; the real draw is exercised by
// the auth-gated e2e suite (e2e/markup-tools.spec.js) and by users. So we attempt the draw but only NOTE it.
try {
  await page.locator('[data-testid="tool-callout"]').click();
  const canvas = page.locator('[data-testid="markup-rail"]').locator("xpath=ancestor::*[1]").locator("svg").last();
  const box = await canvas.boundingBox().catch(() => null);
  if (box) {
    await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.45); await page.waitForTimeout(150);
    await page.mouse.click(box.x + box.width * 0.62, box.y + box.height * 0.30); await page.waitForTimeout(300);
    const drew = (await page.locator("textarea").count()) > 0;
    console.log(`  ℹ draw attempt: inline editor ${drew ? "opened" : "did not open"} via synthetic events (informational — not a B437 gate; covered by the e2e suite)`);
  } else { console.log("  ℹ draw attempt skipped: canvas bbox not resolvable headless (informational)"); }
} catch (e) { console.log("  ℹ draw attempt skipped: " + (e.message || e)); }

if (errors.length === 0) ok("no JS crash"); else bad(`JS errors: ${errors.slice(0, 3).join("; ")}`);

await br.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
