#!/usr/bin/env node
/* B1064 tranche (a) verification — the lazily-loaded planner panels really are deferred, and
 * they really do arrive when opened.
 *
 * WHY A BROWSER CHECK AND NOT JUST THE BUNDLE AUDIT. `perf-bundle-audit.mjs` proves the STATIC
 * import edge is gone, which is a claim about the build graph. It cannot prove the two things
 * that decide whether the split was worth doing:
 *   • that the chunk is genuinely NOT fetched on a plain Site load (a stray warm, a prefetch
 *     hint, or a second consumer would pull it back onto the critical path while the graph
 *     still looks split), and
 *   • that clicking the panel actually renders it — a Suspense boundary that never resolves,
 *     or an error boundary swallowing a load failure, looks identical to "the panel is closed".
 * Both need the real app, so they are checked here.
 *
 * Runs LOGGED OUT with every cross-origin request blocked, which is the honest sandbox: no
 * Supabase sign-in, no GIS hosts, no tiles. That is enough for the Standards footer (a pure
 * plan-settings surface). It is NOT enough for Site Analysis, which needs a georeferenced plan,
 * or the Team tab, which needs a signed-in account — those two are named at the end as what
 * this run does NOT cover, rather than passed over quietly.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node ui-audit/verify-lazy-panels.mjs
 */
import { chromium } from "playwright";
import { perfScenarioSeed } from "./lib/perf-scenario.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = (process.env.BASE_URL || "http://localhost:4173/").replace(/\/?$/, "/");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const stem = (f) => f.replace(/-[A-Za-z0-9_-]{8}\.js$/, "").replace(/\.js$/, "");

/* The panels this tranche moved. Each must be ABSENT from the boot fetch set. */
const DEFERRED = ["SiteAnalysis", "StandardsBar", "TeamPanel"];

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
/* Seed the committed reference plan into local storage so the app boots straight into the
 * PLANNER. Without it the app lands on the map finder (no site to resume), where the left rail
 * does not exist and the Standards panel is unreachable — the run would then "pass" the
 * deferral half while silently proving nothing about the render half. */
await ctx.addInitScript(perfScenarioSeed());
const page = await ctx.newPage();
/* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — not its clock, and not its pixels. A hidden tab clamps
   setTimeout (a setTimeout-paced probe then times the clamp: 3,156 ms for a 138-182 ms gesture) AND
   suspends requestAnimationFrame, so after a view change the app's state attributes update while the
   drawing never repaints — every box, position, hit test and screenshot then agrees with every other
   and describes a view the app already left. One precondition covers both, rAF liveness probe
   included; see ui-audit/lib/tabTiming.mjs. Fails loudly rather than reporting either. */
await assertMeasurable(page, "verify-lazy-panels");

const fetched = [];
page.on("request", (r) => {
  const u = r.url();
  if (u.startsWith(BASE) && /\/assets\/.*\.js(\?|$)/.test(u)) fetched.push(stem(u.split("/").pop()));
});
await page.route(/^https?:\/\//, (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));

const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e).split("\n")[0]));

const ok = [];
const fail = [];

await page.goto(BASE, { waitUntil: "load" });
await page.waitForSelector('[data-testid="planner-canvas"], canvas, #root', { timeout: 60_000 });
await page.waitForTimeout(3000); // let any boot-time warm fire, so its ABSENCE is meaningful

const bootSet = [...new Set(fetched)];
for (const name of DEFERRED) {
  if (bootSet.includes(name)) fail.push(`${name} was fetched on a plain boot — it is NOT deferred`);
  else ok.push(`${name} is absent from the boot fetch set`);
}
ok.push(`boot fetched: ${bootSet.join(", ")}`);

/* ---- the Standards panel actually opens, loads its footer chunk, and renders it ---------- */
const railStandards = page.getByRole("button", { name: /Standards/ }).filter({ visible: true }).first();
try {
  await railStandards.waitFor({ state: "visible", timeout: 20_000 });
  await railStandards.click();
  // The footer's three named actions are what StandardsBar renders. If the lazy chunk never
  // resolves, the height-reserving fallback stays up and none of these ever appear.
  await page.getByRole("button", { name: /Save for all projects/i }).first().waitFor({ state: "visible", timeout: 20_000 });
  const after = [...new Set(fetched)];
  if (!after.includes("StandardsBar")) fail.push("the Standards footer rendered but its chunk was never fetched — the split did not take");
  else ok.push("opening Standards fetched the StandardsBar chunk and rendered its actions");
  for (const label of [/Apply to this plan/i, /Save for this plan/i]) {
    const n = await page.getByRole("button", { name: label }).count();
    if (!n) fail.push(`the Standards footer is missing its "${label}" action after the lazy load`);
  }
  if (!fail.length) ok.push("all three Standards footer actions are present after the lazy load");
} catch (e) {
  fail.push(`could not open the Standards panel / its lazy footer never resolved: ${String(e).split("\n")[0]}`);
}

/* ---- the failure path is wired, not decorative ------------------------------------------- */
if (pageErrors.length) fail.push(`page errors during the run: ${pageErrors.slice(0, 3).join(" | ")}`);
else ok.push("no uncaught page errors");

await browser.close();

console.log("B1064(a) — lazy panel verification\n");
for (const o of ok) console.log(`  ✓ ${o}`);
for (const f of fail) console.log(`  ✗ ${f}`);
console.log("\n  NOT covered by this run, and deliberately named rather than implied:");
console.log("    • Site Analysis — needs a georeferenced plan (a parcel brought in from the map), which");
console.log("      needs GIS hosts this sandbox blocks. Its DEFERRAL is proven above; its RENDER is not.");
console.log("    • The Team tab — signed-in only, and sign-in is CORS-blocked here. Same split: deferral");
console.log("      proven, render pending a signed-in pass.");
console.log(fail.length ? `\n✗ ${fail.length} failure(s)` : "\n✓ all checked assertions hold");
process.exit(fail.length ? 1 : 0);
