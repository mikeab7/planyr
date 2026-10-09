#!/usr/bin/env node
/* verify-signout-store-live — B2233872 / V1652976, against a DEPLOYED build (planyr.io or a PR preview), signed in as the test account.
 *
 * The defect: signing out ran the planner's persist-on-leave AFTER the device store had switched to the signed-out one, so the plan on
 * screen was copied into `planarfit:sites:v1:p:<id>` — where the next signed-out visitor of that browser would find it. The sandbox proof
 * is verify-plan-switch-writes.mjs; this is the live arm.
 *
 * It signs in (ui-audit/lib/signedInSession.mjs — the one shared helper), reads /version.json in the same run, opens a plan of the test
 * account with the planner mounted, records every localStorage write from then on, clicks Sign out, waits, and FAILS if any write after the
 * click lands in a non-account (signed-out) store key and mentions the plan, or creates a signed-out per-plan entry for it.
 * VOID (exit 2) if no planner canvas mounted — a check that never had a plan open cannot vouch for persist-on-leave.
 *
 *   node ui-audit/verify-signout-store-live.mjs [https://planyr.io] [--plan <siteId>]
 */
import { openSignedIn, FIXTURE_SITE_ID } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = (process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "https://planyr.io").replace(/\/$/, "");
const pi = process.argv.indexOf("--plan");
const PLAN = pi > -1 ? process.argv[pi + 1] : FIXTURE_SITE_ID;

const RECORD = () => {
  window.__lsw = [];
  const orig = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    try { if (this === window.localStorage && /planarfit:sites/.test(String(k))) window.__lsw.push({ t: performance.now(), key: String(k), len: String(v).length, plans: (window.__watchIds || []).filter((id) => String(v).includes(id)) }); } catch (_) {}
    return orig.call(this, k, v);
  };
};

const s = await openSignedIn({ base: BASE, initScripts: [[RECORD]] });
const { page, close } = s;
let code = 0;
try {
  await assertMeasurable(page, "verify-signout-store-live");
  const version = await page.evaluate(async () => { try { return await (await fetch("/version.json", { cache: "no-store" })).json(); } catch (_) { return null; } });
  console.log(`build: ${JSON.stringify(version)}`);
  await page.evaluate((id) => { window.__watchIds = [id]; window.location.hash = `#/project/${id}/site`; }, PLAN);
  const mounted = await page.locator('[data-testid="planner-canvas"]:visible').first().waitFor({ timeout: 30000 }).then(() => true, () => false);
  if (!mounted) { console.log(`VOID — no planner canvas mounted for ${PLAN}; persist-on-leave never had a plan to flush`); code = 2; }
  else {
    await page.waitForTimeout(4000);
    const before = await page.evaluate(() => Object.keys(localStorage).filter((k) => /^planarfit:sites:v1/.test(k)));
    const tClick = await page.evaluate(() => performance.now());
    await page.locator('[aria-label^="Account:"]:visible').first().click({ timeout: 8000 });
    await page.locator("button:visible", { hasText: "Sign out" }).first().click({ timeout: 8000 });
    await page.waitForTimeout(6000);
    const after = await page.evaluate((t) => ({ writes: window.__lsw.filter((w) => w.t >= t), keys: Object.keys(localStorage).filter((k) => /^planarfit:sites:v1/.test(k)) }), tClick);
    const leaks = after.writes.filter((w) => !/:cloud:/.test(w.key) && (w.plans.length || w.key.endsWith(`:p:${PLAN}`)));
    const newKeys = after.keys.filter((k) => !before.includes(k) && k.endsWith(`:p:${PLAN}`));
    console.log(`writes after sign-out: ${after.writes.length} (${after.writes.map((w) => w.key).join(", ") || "none"})`);
    if (leaks.length || newKeys.length) { console.log(`FAIL — the plan was written into the signed-out store: ${[...leaks.map((w) => w.key), ...newKeys].join(", ")}`); code = 1; }
    else console.log(`PASS — nothing about ${PLAN} landed in the signed-out store after sign-out`);
  }
} finally { await close(); }
process.exit(code);
