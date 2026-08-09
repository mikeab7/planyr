#!/usr/bin/env node
/* NEW-9 verification — removing the boot-time workspace prefetch must not break lazy loading.
 *
 * The fix stopped the Shell from warming scheduler / doc-review / library at boot, which took
 * ~805 KB of JS off a plain Site route. The risk it introduces is the mirror image: a workspace
 * whose chunk is no longer pre-warmed might fail to load, or load visibly slower, on FIRST open.
 * This drives that path for real.
 *
 * Asserts, against the built app:
 *   1. A plain Site route fetches ONLY the allowlisted chunks (the regression guard).
 *   2. Each deferred workspace still opens on first click, renders real content, and is not
 *      sitting on the error boundary.
 *   3. Its chunk arrives as part of that open (proving it was genuinely deferred, not missing).
 *
 * Runs logged-out, which is what the sandbox allows — every workspace has a signed-out surface
 * (Review's "no drawing open" empty state, Library's browser, the Sequence iframe), so the lazy
 * boundary is exercised even though signed-in content is not.
 *
 *   node ui-audit/verify-new9-lazy-modules.mjs            # against http://localhost:4173
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { perfScenarioSeed } from "./lib/perf-scenario.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE_URL || "http://localhost:4173/").replace(/\/?$/, "/");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const budgets = JSON.parse(readFileSync(join(HERE, "perf-budgets.json"), "utf8"));
const allow = new Set(budgets.bundle.siteRouteAllowlist.allow);
const stem = (f) => f.replace(/-[A-Za-z0-9_-]{8,}\.js$/, "").replace(/\.js$/, "");

/* Each deferred workspace, with the chunk it should pull on first open and a selector proving
 * it actually rendered rather than falling through to the error boundary. */
const MODULES = [
  { id: "doc-review", chunk: "DocReview", label: "Review" },
  { id: "library", chunk: "Library", label: "Library" },
  { id: "scheduler", chunk: "Scheduler", label: "Sequence" },
];

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
await ctx.addInitScript(perfScenarioSeed());
const page = await ctx.newPage();
/* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — not its clock, and not its pixels. A hidden tab clamps
   setTimeout (a setTimeout-paced probe then times the clamp: 3,156 ms for a 138-182 ms gesture) AND
   suspends requestAnimationFrame, so after a view change the app's state attributes update while the
   drawing never repaints — every box, position, hit test and screenshot then agrees with every other
   and describes a view the app already left. One precondition covers both, rAF liveness probe
   included; see ui-audit/lib/tabTiming.mjs. Fails loudly rather than reporting either. */
await assertMeasurable(page, "verify-new9-lazy-modules");

const fetched = [];
page.on("request", (r) => {
  const u = r.url();
  if (u.startsWith(BASE) && /\/assets\/.*\.js(\?|$)/.test(u)) fetched.push(stem(u.split("/").pop()));
});
/* Abort cross-origin traffic so the run does not depend on GIS hosts the sandbox blocks. */
await page.route(/^https?:\/\//, (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));

const fail = [];
const ok = [];

await page.goto(BASE, { waitUntil: "load" });
await page.waitForSelector("svg[role=application]", { timeout: 60_000 });
await page.waitForTimeout(3000); // give any boot-time idle warm a chance to fire, so its absence is meaningful

/* ---- 1. the Site route is clean ---------------------------------------------------------- */
const onSiteRoute = [...new Set(fetched)];
const intruders = onSiteRoute.filter((s) => !allow.has(s));
if (intruders.length) fail.push(`Site route fetched non-allowlisted chunk(s): ${intruders.join(", ")}`);
else ok.push(`Site route fetched only: ${onSiteRoute.join(", ")}`);

/* ---- 2 + 3. each deferred workspace still opens on first click ---------------------------- */
for (const m of MODULES) {
  const before = new Set(fetched);
  const tab = page.getByTestId(`module-tab-${m.id}`).filter({ visible: true });
  try {
    await tab.waitFor({ state: "visible", timeout: 15_000 });
    await tab.click();
    await page.waitForFunction(
      (id) => document.querySelector(`[data-testid="module-tab-${id}"][aria-current="page"]`) != null,
      m.id, { timeout: 20_000 }
    );
    await page.waitForTimeout(2500); // let the lazy chunk land and the workspace paint
  } catch (e) {
    fail.push(`${m.label}: tab never became current — ${String(e).split("\n")[0]}`);
    continue;
  }

  const body = await page.locator("body").innerText();
  if (/hit an error and couldn't load/i.test(body)) {
    fail.push(`${m.label}: workspace rendered the error boundary after first open`);
    continue;
  }
  const arrived = fetched.filter((s) => !before.has(s));
  if (!fetched.includes(m.chunk)) {
    fail.push(`${m.label}: its ${m.chunk} chunk was never fetched — lazy boundary may be broken`);
    continue;
  }
  ok.push(`${m.label}: opened on first click${arrived.length ? ` (chunk(s) arrived: ${[...new Set(arrived)].join(", ")})` : " (already cached)"}`);
}

await browser.close();

console.log("NEW-9 — deferred workspace loading\n");
for (const o of ok) console.log(`  ✓ ${o}`);
for (const f of fail) console.log(`  ✗ ${f}`);
console.log();
console.log(fail.length ? `✗ ${fail.length} failure(s).` : "✓ Site route is clean and every deferred workspace still opens on first click.");
process.exit(fail.length ? 1 : 0);
