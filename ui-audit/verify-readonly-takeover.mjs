/* B464/B466 (NEW-1/NEW-3) — single-active-editor read-only banner + "Take over editing here".
 *
 * The owner hit this live on planyr.io: a second tab on the same plan put this tab into read-only
 * mode, ~1hr of edits never synced, and reloading didn't clear it (the other tab still held the
 * lock). The fixes: a LOUD, actionable read-only banner that says reloading won't help, plus a
 * "Take over editing here" button that steals the editor lock and pushes the pent-up work.
 *
 * This harness proves it end-to-end, LOGGED-OUT (the banner is auth-independent; only the cloud
 * INDICATOR's read-only state needs sign-in, which is a Cowork check). Two tabs of the SAME browser
 * context share Web Locks — exactly the multi-tab scenario:
 *   1. Tab A loads the plan → becomes the active editor (no read-only banner).
 *   2. Tab B loads the SAME plan → goes read-only → shows the banner + the Take-over button.
 *   3. Click Take over in B → B's banner clears (B is now active) AND A goes read-only via the
 *      cross-tab yield (the hand-off), proving the takeover actually transfers the lock.
 *
 * Run: npm run build && npx vite preview --port 4173, then  node ui-audit/verify-readonly-takeover.mjs */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const SITES_KEY = "planarfit:sites:v1";

const sites = { s1: { id: "s1", groupId: "s1", site: "Verify B464", name: "Plan 1", status: "active",
  origin: { lat: 29.78, lon: -95.79 }, county: "harris",
  parcels: [{ id: "p1", points: [{ x: -700, y: -500 }, { x: 700, y: -500 }, { x: 700, y: 500 }, { x: -700, y: 500 }] }],
  els: [{ id: "r1", type: "road", cx: 0, cy: 0, w: 400, h: 30, rot: 0, travelW: 24, curb: 0.5 }], markups: [], updatedAt: Date.now() } };
const seed = `(()=>{try{localStorage.setItem(${JSON.stringify(SITES_KEY)},${JSON.stringify(JSON.stringify(sites))});localStorage.setItem("planarfit:currentSite:v1","s1");}catch(e){}})();`;

const results = [];
const check = (n, p, d = "") => { results.push({ n, p }); console.log(`  ${p ? "✅ PASS" : "❌ FAIL"} — ${n}${d ? "  · " + d : ""}`); };
const roVisible = (page) => page.locator('[data-testid="readonly-banner"]').isVisible().catch(() => false);
const settle = (page) => page.waitForTimeout(1500);

const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const context = await browser.newContext({ viewport: { width: 1280, height: 850 }, ignoreHTTPSErrors: true });
await context.addInitScript(seed); // both tabs of this context share Web Locks AND this seed
const pageErrors = [];

// --- Tab A: the first/active editor ---
const a = await context.newPage();
a.on("pageerror", (e) => pageErrors.push("A:" + e));
await a.goto(BASE, { waitUntil: "domcontentloaded" });
await a.waitForTimeout(3000);
check("Tab A is the active editor — no read-only banner", !(await roVisible(a)));

// --- Tab B: a second tab on the SAME plan → must go read-only ---
const b = await context.newPage();
b.on("pageerror", (e) => pageErrors.push("B:" + e));
await b.goto(BASE, { waitUntil: "domcontentloaded" });
await b.waitForTimeout(3000);
const bReadOnly = await roVisible(b);
check("Tab B (second tab on the same plan) shows the read-only banner", bReadOnly);
const takeoverBtn = b.locator('[data-testid="takeover-btn"]');
check("the banner offers a 'Take over editing here' action", await takeoverBtn.isVisible().catch(() => false));
const bannerText = await b.locator('[data-testid="readonly-banner"]').innerText().catch(() => "");
check("the banner says reloading won't help while the other tab is open", /reload/i.test(bannerText) && /(take over|close)/i.test(bannerText), bannerText.replace(/\s+/g, " ").slice(0, 90));
await b.screenshot({ path: OUT + "b464-readonly-banner.png" });

// --- Click Take over in B → B becomes active, A steps down via the cross-tab yield ---
if (bReadOnly) {
  await takeoverBtn.click();
  await settle(b); await settle(a);
  check("after Take over, B's read-only banner clears (B is now the active editor)", !(await roVisible(b)));
  check("after Take over, Tab A steps down to read-only (the lock handed off via the bus)", await roVisible(a));
  await a.screenshot({ path: OUT + "b464-after-takeover-A.png" });
} else {
  check("after Take over, B's read-only banner clears (B is now the active editor)", false, "skipped — B never went read-only");
  check("after Take over, Tab A steps down to read-only (the lock handed off via the bus)", false, "skipped — B never went read-only");
}

check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | ").slice(0, 200));

await browser.close();
const passed = results.filter((r) => r.p).length;
console.log(`\nB464/B466 read-only takeover: ${passed}/${results.length} checks passed.`);
process.exit(passed === results.length ? 0 : 1);
