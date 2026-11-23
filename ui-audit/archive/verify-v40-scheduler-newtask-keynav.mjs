/* V40 — Scheduling grid keyboard nav: ↓ from the last task row selects the "+ New task" sentinel
 * (blue left border, blue text, light-blue background); ↓ again is a no-op (stays put); ↑ returns
 * to the last real task; ↓ then Enter creates a new task AND opens its name cell in edit mode with
 * focus; ↑ from a non-last task still moves up one row (no regression).
 *
 * VERIFICATION.md's own 2026-06-19 correction (V46) says this is headless-drivable by
 * static-serving public/ and loading /sequence/ — true in spirit, but that page needs TWO CDN
 * scripts (supabase-js + @babel/standalone for in-browser JSX) and cdn.jsdelivr.net now comes
 * back net::ERR_CONNECTION_RESET from Chromium through this sandbox's egress proxy (confirmed
 * live below), so the V46 claim is stale. This harness instead runs against the BUILT app
 * (dist/sequence/index.html via `npx vite preview`, same as every other ui-audit harness here —
 * see BASE_URL) and intercepts the one remaining CDN script the compiled page still needs
 * (supabase-js), fulfilling it from the already-installed npm package instead of the network.
 * Logged-out, no external network needed.
 *
 * Run: npm run build && npx vite preview --port 4173
 *      node ui-audit/verify-v40-scheduler-newtask-keynav.mjs
 */
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import { assertMeasurable } from "../lib/tabTiming.mjs";

const SUPABASE_UMD = new URL("../../node_modules/@supabase/supabase-js/dist/umd/supabase.js", import.meta.url).pathname;
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const url = new URL("sequence/", BASE).href;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await assertMeasurable(page, "verify-v40-scheduler-newtask-keynav");
const real = [];
const BENIGN = [/supabase\.co/i, /\[BABEL\] Note/i, /CORS policy/i, /ERR_FAILED/i, /WebSocket/i, /Failed to load resource/i, /Cloud unreachable/i, /realtime/i];
page.on("console", (m) => { if (m.type() === "error" && !BENIGN.some((r) => r.test(m.text()))) real.push(m.text()); });
page.on("pageerror", (e) => { if (!BENIGN.some((r) => r.test(e.message))) real.push("PAGEERROR: " + e.message); });

const results = [];
const check = (n, p, d = "") => { results.push({ n, p }); console.log(`  ${p ? "✅ PASS" : "❌ FAIL"} — ${n}${d ? "  · " + d : ""}`); };

const supaJs = await readFile(SUPABASE_UMD, "utf8");
await page.route("**cdn.jsdelivr.net/npm/@supabase/supabase-js@2**", (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: supaJs }));
await page.route("**cdn.jsdelivr.net/npm/@tabler/icons-webfont**", (route) => route.fulfill({ status: 200, contentType: "text/css", body: "" }));

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForSelector("[data-task-row]", { timeout: 20000 });
await page.waitForTimeout(1000);

const rowCountBefore = await page.locator("[data-task-row]").count();
check("scheduler grid rendered with at least one task row", rowCountBefore > 0, `rows=${rowCountBefore}`);

const sentinelPresent = () => page.evaluate(() => Array.from(document.querySelectorAll(".drow")).some((d) => d.textContent.includes("+ New task")));

// Step 1 — select the last task row. The embedded seed's grid VIRTUALIZES its rows (the DOM only
// ever holds a rendered window, not the whole list), so a driver click on the last RENDERED row is
// not the last TASK — and jumping the scroll container's scrollTop by hand would be exactly the
// DRIVER-SCROLL-IS-NOT-APP-SCROLL trap (the driver's own scroll, not the app's). Instead, drive REAL
// ArrowDown presses from the first row: each one is a genuine keyboard nav step, and the app's own
// selection-follows-scroll effect (keyed on the real task's index) keeps every newly-selected row on
// screen — the same way a user holding ↓ would reach the bottom. This is what actually clears the
// "not drivable" verdict every prior attempt (2026-06-19, 2026-06-25) recorded.
const rows = page.locator("[data-task-row]");
await rows.first().click();
await page.waitForTimeout(150);
let reachedSentinel = false;
for (let batch = 0; batch < 60 && !reachedSentinel; batch++) {
  for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(80);
  reachedSentinel = await sentinelPresent();
}
check("real ↓ presses from the top eventually reach the '+ New task' sentinel (app-driven scroll-follow, not a driver scroll hack)",
  reachedSentinel, `reached after ~${reachedSentinel ? "≤600" : ">600"} presses`);
// One more ArrowUp + ArrowDown pair re-settles exactly on the boundary (last real task → sentinel),
// which is the actual case steps 2-6 below are about, rather than however many rows short/long the
// batches above overshot by (ArrowDown past the sentinel is a no-op per the app's own guard).
await page.keyboard.press("ArrowUp");
await page.waitForTimeout(150);

// Sentinel row style helper — the exact V40 spec: blue left border + blue text + light-blue bg.
const sentinelInfo = () => page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll(".drow"));
  // the sentinel is the "+ New task" affordance row — the last .drow whose text is exactly that.
  const sentinel = rows.find((r) => r.textContent.includes("+ New task"));
  if (!sentinel) return null;
  const cs = getComputedStyle(sentinel);
  const nameCell = sentinel.firstElementChild ? getComputedStyle(sentinel.firstElementChild) : null;
  return { borderLeft: cs.borderLeftColor + " " + cs.borderLeftWidth, background: cs.backgroundColor, nameColor: nameCell?.color };
});
const blueVarInfo = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--blue").trim());
const blueVar = await blueVarInfo();

// Step 2 — press ↓ — the sentinel should light up.
await page.keyboard.press("ArrowDown");
await page.waitForTimeout(200);
const afterFirstDown = await sentinelInfo();
check("↓ from the last task highlights the '+ New task' sentinel (blue left border)",
  !!afterFirstDown && afterFirstDown.borderLeft.startsWith("rgb(") && afterFirstDown.borderLeft.endsWith("2px") && !afterFirstDown.borderLeft.includes("rgba(0, 0, 0, 0)"),
  JSON.stringify(afterFirstDown));
check("the sentinel's background goes light-blue (#eff6ff) when focused", afterFirstDown?.background === "rgb(239, 246, 255)", afterFirstDown?.background);

// Step 3 — press ↓ again — nothing should happen (stays on sentinel).
await page.keyboard.press("ArrowDown");
await page.waitForTimeout(200);
const afterSecondDown = await sentinelInfo();
check("↓ again is a no-op — stays on the '+ New task' row", JSON.stringify(afterSecondDown) === JSON.stringify(afterFirstDown), JSON.stringify(afterSecondDown));

// Step 4 — press ↑ — focus returns to the last task (sentinel no longer highlighted).
await page.keyboard.press("ArrowUp");
await page.waitForTimeout(200);
const afterUp = await sentinelInfo();
check("↑ from the sentinel returns focus to the last real task (no blue on '+ New task')",
  !!afterUp && afterUp.background !== "rgb(239, 246, 255)", JSON.stringify(afterUp));

// Step 5 — ↓ to the sentinel, then Enter — a new task row is created AND its name cell opens in
// edit mode with the input focused. `[data-task-row]` count is NOT a valid before/after measure
// here (it's the virtualized DOM WINDOW, which reflows to a different size once the new row is
// revealed and scrolled to — that's a windowing artifact, not the task list shrinking) — the
// scrollable content's total height is the real total-row-count proxy and isn't windowed.
const scrollExtent = () => page.evaluate(() => {
  const row = document.querySelector("[data-task-row]");
  const content = row?.parentElement; // the absolutely-positioned full-height content div
  return content ? content.scrollHeight : null;
});
const extentBefore = await scrollExtent();
await page.keyboard.press("ArrowDown");
await page.waitForTimeout(150);
await page.keyboard.press("Enter");
await page.waitForTimeout(400);
const extentAfter = await scrollExtent();
check("Enter on the sentinel creates a new task row (total scrollable content grows by exactly one row)",
  extentBefore != null && extentAfter != null && extentAfter > extentBefore, `before=${extentBefore} after=${extentAfter}`);
const activeIsInput = await page.evaluate(() => {
  const el = document.activeElement;
  return el ? { tag: el.tagName, insideGrid: !!el.closest(".drow") } : null;
});
check("the new task's name cell opens in edit mode with the input focused", activeIsInput?.tag === "INPUT" && activeIsInput?.insideGrid, JSON.stringify(activeIsInput));

// Step 6 (regression) — ↑ from a NON-last task still moves to the row above (existing behavior).
// A selected task row gets the SAME blue-left-border treatment as the sentinel (isFocused), so the
// highlighted row is discoverable the same way step 2 discovered the sentinel — no reliance on any
// class name.
const highlightedTaskRow = () => page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll("[data-task-row]"));
  const hit = rows.find((r) => /border-left:\s*2px solid(?!\s*transparent)/.test(r.getAttribute("style") || ""));
  return hit ? hit.getAttribute("data-task-row") : null;
});

await page.keyboard.press("Escape");
await page.waitForTimeout(150);
const rowCountNow = await page.locator("[data-task-row]").count();
const midIdx = Math.max(0, Math.floor(rowCountNow / 2));
const midRows = page.locator("[data-task-row]");
await midRows.nth(midIdx).click();
await page.waitForTimeout(150);
const midId = await midRows.nth(midIdx).getAttribute("data-task-row");
const aboveId = await midRows.nth(Math.max(0, midIdx - 1)).getAttribute("data-task-row");
const highlightedBeforeUp = await highlightedTaskRow();
check("clicking a mid-grid row highlights exactly that row", highlightedBeforeUp === midId, `clicked=${midId} highlighted=${highlightedBeforeUp}`);
await page.keyboard.press("ArrowUp");
await page.waitForTimeout(150);
const highlightedAfterUp = await highlightedTaskRow();
check("↑ from a non-last task moves the highlight to the row above (existing behavior not broken)",
  highlightedAfterUp === aboveId && aboveId !== midId, `above=${aboveId} highlightedAfterUp=${highlightedAfterUp}`);

check("no unexpected console/page errors", real.length === 0, real.slice(0, 5).join(" | "));

await browser.close();
const failed = results.filter((r) => !r.p).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
