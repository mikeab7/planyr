/**
 * NEW-1 (B821280, 2026-08-28) — the browser tab title names the module you're in, not a fixed
 * marketing string.
 *
 * Owner: "lets change this title to just Planyr - Planner, Scheduler, or whatever module we're
 * in". Mapped to the REAL top-nav labels (Site · Schedule · Review · Library · Notes) rather
 * than the owner's illustrative wording, so the tab word always matches the tab Michael clicked.
 *
 * What this proves, against the REAL built app, logged out (no auth/GIS needed — a Claude-doable
 * check per ATTEMPT-BEFORE-YOU-PARK, so it runs here rather than being filed as "needs a live
 * pass"):
 *   1. The default route ("#/") titles "Planyr — Site".
 *   2. Clicking each real header tab (Schedule, Review, Library, Notes, back to Site) updates
 *      `document.title` to "Planyr — <that tab's own label>", via a CLIENT-SIDE route change —
 *      proven by a zero-increment "page load" counter across every click (a hash-router SPA must
 *      never reload to change the title).
 *   3. A module with no nav tab (Food — deliberately unlisted, NEW-2 to B568400) and the unlisted
 *      /admin surface both fall back to the bare "Planyr" brand string, set via a plain hash write
 *      (no navigation) — the same "typed/followed a link" path a real visitor takes.
 *   4. An unresolvable slug falls back the same tolerant way parseRoute already does elsewhere
 *      (route.js) — "Planyr — Site", not a crash, not the stale marketing string.
 *
 * Run:  npm run build && npx vite preview --port 4173   (then)   node ui-audit/verify-tab-title.mjs
 */
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME
  || ["/opt/pw-browsers/chromium-1234/chrome-linux64/chrome", "/opt/pw-browsers/chromium-1228/chrome-linux/chrome"].find(existsSync)
  || chromium.executablePath();

let fails = 0;
const ok = (cond, msg) => { if (!cond) fails++; console.log(`  ${cond ? "✓" : "✗ FAIL"} ${msg}`); };

const title = (page) => page.evaluate(() => document.title);

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();

let loadCount = 0;
page.on("load", () => { loadCount++; });

await page.goto(`${BASE}#/`, { waitUntil: "load" });
await assertMeasurable(page, "verify-tab-title");
await page.waitForTimeout(1500);
loadCount = 0; // discount the initial navigation itself — only later steps must stay reload-free

console.log("\nSTEP 1 — the default route titles the tab Michael lands on");
ok((await title(page)) === "Planyr — Site", `"#/" (default route) -> "${await title(page)}" (want "Planyr — Site")`);

console.log("\nSTEP 2 — clicking each real header tab updates the title, with NO reload");
const CLICK_SEQUENCE = [
  { id: "scheduler", want: "Planyr — Schedule" },
  { id: "doc-review", want: "Planyr — Review" },
  { id: "library", want: "Planyr — Library" },
  { id: "notes", want: "Planyr — Notes" },
  { id: "site-planner", want: "Planyr — Site" }, // back to Site, closing the loop
];
for (const { id, want } of CLICK_SEQUENCE) {
  const before = loadCount;
  await page.locator(`[data-testid=module-tab-${id}]:visible`).first().click({ timeout: 6000 });
  await page.waitForTimeout(900);
  const got = await title(page);
  ok(got === want, `click "${id}" tab -> title "${got}" (want "${want}")`);
  ok(loadCount === before, `clicking "${id}" fired NO page load (client-side route change) — load count ${before} -> ${loadCount}`);
}

console.log("\nSTEP 3 — a module with no nav tab, and the unlisted /admin surface, fall back to bare \"Planyr\"");
for (const [label, hash] of [["Food (#/food, deliberately unlisted)", "#/food"], ["/admin (not a workspace)", "#/admin"]]) {
  const before = loadCount;
  await page.evaluate((h) => { window.location.hash = h; }, hash);
  await page.waitForTimeout(700);
  const got = await title(page);
  ok(got === "Planyr", `${label} -> title "${got}" (want bare "Planyr")`);
  ok(loadCount === before, `navigating to ${hash} fired NO page load — load count ${before} -> ${loadCount}`);
}

console.log("\nSTEP 4 — an unresolvable slug falls back the same tolerant way parseRoute already does (never a crash, never the stale marketing string)");
{
  const before = loadCount;
  await page.evaluate(() => { window.location.hash = "#/not-a-real-route"; });
  await page.waitForTimeout(700);
  const got = await title(page);
  ok(got === "Planyr — Site", `"#/not-a-real-route" -> title "${got}" (want "Planyr — Site", matching parseRoute's own default-module fallback)`);
  ok(loadCount === before, `navigating to an unresolvable slug fired NO page load — load count ${before} -> ${loadCount}`);
}

await ctx.close();
await browser.close();

console.log("\n" + (fails === 0 ? "✅ PASS — the tab title names the module you're in, and updates on every client-side route change" : `❌ FAIL — ${fails} assertion(s)`));
process.exit(fails === 0 ? 0 : 1);
