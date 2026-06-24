// B436 — verify the e2e fixture PDF opens the Review canvas and the tool rail renders, so the
// per-tool ARM assertions can run. Logged-out (the sandbox blocks sign-in): the PDF parse +
// canvas mount + rail render do NOT need auth (only the background storeSource upload does,
// and it's best-effort), so this validates the core mechanism the auth-gated suite relies on.
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";

const EXEC = "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
const BASE = "http://localhost:4173";
const FIXTURE = fileURLToPath(new URL("../e2e/fixtures/sample.pdf", import.meta.url));
let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ✓ ${m}`); pass++; };
const bad = (m) => { console.error(`  ✗ ${m}`); fail++; };

async function run() {
  const br = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const page = await br.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
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
  try {
    await rail.waitFor({ state: "visible", timeout: 30000 });
    ok("tool rail rendered after opening the PDF");
  } catch {
    bad("tool rail did NOT render within 30s");
  }

  // Arm a couple of tools and confirm aria-pressed flips — the exact assertion the e2e loop makes.
  for (const id of ["line", "rect", "arc", "dimension"]) {
    const btn = page.locator(`[data-testid="tool-${id}"]`);
    if (!(await btn.count())) { bad(`tool-${id} button missing`); continue; }
    await btn.click();
    const pressed = await btn.getAttribute("aria-pressed");
    if (pressed === "true") ok(`tool-${id} arms (aria-pressed=true)`);
    else bad(`tool-${id} did not arm (aria-pressed=${pressed})`);
  }

  if (errors.length === 0) ok("no JS crash");
  else bad(`JS errors: ${errors.slice(0, 3).join("; ")}`);

  await br.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
run().catch((e) => { console.error(e); process.exit(1); });
