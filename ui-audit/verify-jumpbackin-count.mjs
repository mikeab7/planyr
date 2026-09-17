/* B1617216 (NEW-1, 2026-09-17, owner ask) — "jump back in should be the last couple projects I
 * was working on, and I should be able to increase the amount it shows."
 *
 * This drives the REAL built app against a mocked Supabase `sites` endpoint (same technique as
 * e2e/dashboard-card-growth.spec.js) — signed out, no external GIS, no real project data, so
 * this is Claude-doable per ATTEMPT-BEFORE-YOU-PARK and must not be filed as needing a live pass.
 *
 * Checks: the card shows exactly the DEFAULT count (3) of the most-recently-updated projects,
 * most-recent-first, when the account has never touched the setting; the Customize-mode stepper
 * raises/lowers the count and the card's own row count follows immediately; the chosen count
 * survives a reload (persisted to the local mirror — this run is signed out, so the cloud half of
 * dashboardPrefs.js is unreachable here and is instead covered by test/dashboardPrefs.test.js's
 * mocked-Supabase unit tests); the stepper's min/max bounds actually disable the buttons.
 *
 * Run:  npm run build && npx vite preview --port 4173   (then)   node ui-audit/verify-jumpbackin-count.mjs
 */
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const SUPABASE_HOST = "dashboardverify1.supabase.co";
const EXEC = process.env.PW_CHROME
  || ["/opt/pw-browsers/chromium", "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find(existsSync)
  || chromium.executablePath();

let fails = 0;
const ok = (cond, msg) => { if (!cond) fails++; console.log(`  ${cond ? "✓" : "✗ FAIL"} ${msg}`); };

// Six projects, spread across many days, so "most recent 3" is an unambiguous, orderable subset.
function siteRows() {
  const now = Date.now();
  const daysAgo = (n) => new Date(now - n * 86400000).toISOString();
  return [
    { id: "s-alpha", group_id: "g-alpha", site: "Alpha Tract", county: "Harris", updated_at: daysAgo(10) },
    { id: "s-bravo", group_id: "g-bravo", site: "Bravo Yard", county: "Harris", updated_at: daysAgo(0) },
    { id: "s-charlie", group_id: "g-charlie", site: "Charlie Field", county: "Harris", updated_at: daysAgo(20) },
    { id: "s-delta", group_id: "g-delta", site: "Delta Lot", county: "Harris", updated_at: daysAgo(1) },
    { id: "s-echo", group_id: "g-echo", site: "Echo Parcel", county: "Harris", updated_at: daysAgo(5) },
    { id: "s-foxtrot", group_id: "g-foxtrot", site: "Foxtrot Site", county: "Harris", updated_at: daysAgo(2) },
  ];
}

async function mockSupabase(page) {
  await page.routeWebSocket(/.*/, (ws) => { try { ws.close(); } catch (_) {} });
  await page.route("**/*", async (route) => {
    const req = route.request();
    let u;
    try { u = new URL(req.url()); } catch (_) { return route.continue(); }
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
    if (u.hostname !== SUPABASE_HOST) return route.abort();
    const path = u.pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path.startsWith("/auth/v1/")) return json({});
    if (path === "/rest/v1/sites" && req.method() === "GET") return json(siteRows());
    if (path.startsWith("/rest/v1/")) return json([]);
    return json({});
  });
}

// Reads the Jump-back-in card's project rows: DashboardCard's own `data-card-key="jumpBackIn"`
// root, then every element whose text is exactly one of the seeded site names, in DOM order.
const NAMES = ["Alpha Tract", "Bravo Yard", "Charlie Field", "Delta Lot", "Echo Parcel", "Foxtrot Site"];
const jumpBackInNames = (page) => page.evaluate((names) => {
  const card = document.querySelector('[data-card-key="jumpBackIn"]');
  if (!card) return null;
  const all = [...card.querySelectorAll("div")].map((n) => n.textContent.trim());
  return names.filter((n) => all.includes(n)).sort((a, b) => all.indexOf(a) - all.indexOf(b));
}, NAMES);

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const page = await ctx.newPage();
await mockSupabase(page);
await assertMeasurable(page, "verify-jumpbackin-count");
await page.goto(`${BASE}#/`, { waitUntil: "load" });
await page.waitForSelector('[data-card-key="jumpBackIn"]', { timeout: 20_000 });
await page.waitForTimeout(800); // let the data-fetch/skeleton swap settle

// ── 1. Default count (never touched the setting) — the actual pipeline order is Bravo(0) →
//    Delta(1) → Foxtrot(2) → Echo(5) → Alpha(10) → Charlie(20); default 3 keeps the first three.
const initial = await jumpBackInNames(page);
ok(!!initial, "the Jump-back-in card is present and readable");
ok(initial && initial.length === 3, `default shows exactly 3 rows (got ${initial ? initial.length : "n/a"}: ${initial})`);
ok(initial && initial[0] === "Bravo Yard" && initial[1] === "Delta Lot" && initial[2] === "Foxtrot Site",
  `most-recent-first order is correct (got ${initial})`);

// ── 2. Customize mode → the stepper is reachable and changes the row count live.
await page.getByRole("button", { name: "Customize" }).click();
const stepperPlus = page.locator('[data-card-key="jumpBackIn"] button[title="Show one more"]');
const stepperMinus = page.locator('[data-card-key="jumpBackIn"] button[title="Show one fewer"]');
await stepperPlus.waitFor({ state: "visible", timeout: 5000 });

await stepperPlus.click();
await page.waitForTimeout(150);
let after4 = await jumpBackInNames(page);
ok(after4 && after4.length === 4, `stepper '+' grows the list to 4 rows (got ${after4 ? after4.length : "n/a"})`);
ok(after4 && after4[3] === "Echo Parcel", `the 4th row is the next-most-recent project (got ${after4 && after4[3]})`);

await stepperPlus.click();
await stepperPlus.click(); // now at MAX (6)
await page.waitForTimeout(150);
const after6 = await jumpBackInNames(page);
ok(after6 && after6.length === 6, `stepper '+' clamps at the ceiling (6 of 6 seeded projects, got ${after6 ? after6.length : "n/a"})`);
ok(await stepperPlus.isDisabled(), "the '+' button disables once at the max");

await stepperMinus.click();
await stepperMinus.click();
await stepperMinus.click();
await stepperMinus.click();
await stepperMinus.click(); // down to MIN (1)
await page.waitForTimeout(150);
const after1 = await jumpBackInNames(page);
ok(after1 && after1.length === 1 && after1[0] === "Bravo Yard", `stepper '-' clamps at the floor (1 row, the single most-recent, got ${after1})`);
ok(await stepperMinus.isDisabled(), "the '-' button disables once at the min");

// ── 3. The chosen count survives a reload (local mirror — signed out).
await stepperPlus.click();
await stepperPlus.click(); // back up to 3
await page.waitForTimeout(1200); // past dashboardPrefs.js's SAVE_DEBOUNCE_MS (900ms)
await page.reload({ waitUntil: "load" });
await page.waitForSelector('[data-card-key="jumpBackIn"]', { timeout: 20_000 });
await page.waitForTimeout(800);
const afterReload = await jumpBackInNames(page);
ok(afterReload && afterReload.length === 3, `count persists across reload via the local mirror (got ${afterReload ? afterReload.length : "n/a"})`);

console.log(fails === 0 ? "\nALL CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
await browser.close();
process.exit(fails === 0 ? 0 : 1);
