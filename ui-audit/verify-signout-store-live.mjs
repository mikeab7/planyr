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
 * The test account's standing fixture has no boundary, so no planner mounts on it. `--throwaway` therefore creates a THROWAWAY project on
 * the test account (map → Draw → one building), runs the check on it, then signs back in, deletes it and confirms it is gone (owner
 * constraint #15: test artifacts are always cleared; the standing fixtures are never touched).
 *
 *   node ui-audit/verify-signout-store-live.mjs [https://planyr.io] [--plan <siteId>] [--throwaway]
 */
import { openSignedIn, signInViaRoute, FIXTURE_SITE_ID } from "./lib/signedInSession.mjs";
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
  /* The test account's plans, from its own device store (no extra query): the named fixture first, then the rest. A plan whose planner
   * never mounts (the main fixture has no boundary or location) cannot exercise persist-on-leave, so the next one is tried. */
  let throwaway = null;
  if (process.argv.includes("--throwaway")) {
    const tab = page.getByTestId("module-tab-site-planner").filter({ visible: true });
    await tab.first().click({ timeout: 20000 });
    await page.getByTestId("map-toolbar-draw").first().click({ timeout: 20000 });
    const canvas = page.locator('[data-testid="planner-canvas"]:visible').first();
    await canvas.waitFor({ timeout: 30000 });
    const box = await canvas.boundingBox();
    await page.getByRole("button", { name: /^Building$/ }).first().click();
    const x0 = box.x + box.width * 0.45, y0 = box.y + box.height * 0.35, x1 = box.x + box.width * 0.6, y1 = box.y + box.height * 0.55;
    await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x1, y1, { steps: 8 }); await page.mouse.up();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(4000);                                   // the autosave + the cloud row
    throwaway = await page.evaluate(() => { const m = /#\/project\/([^/]+)\/site/.exec(location.hash); return m ? m[1] : null; });
    console.log(`throwaway project: ${throwaway}`);
    if (!throwaway) throw new Error("could not read the throwaway project's id from the route");
  }
  const candidates = throwaway ? [throwaway] : pi > -1 ? [PLAN] : await page.evaluate((first) => {
    const ids = new Set([first]);
    for (const k of Object.keys(localStorage)) { const m = /^planarfit:sites:cloud:[^:]+:p:(.+)$/.exec(k); if (m) ids.add(m[1]); }
    return [...ids];
  }, PLAN);
  let mounted = false, plan = null;
  for (const id of candidates) {
    await page.evaluate((x) => { window.__watchIds = [x]; window.location.hash = `#/project/${x}/site`; }, id);
    mounted = await page.locator('[data-testid="planner-canvas"]:visible').first().waitFor({ timeout: 20000 }).then(() => true, () => false);
    console.log(`plan ${id}: ${mounted ? "planner mounted" : "no planner"}`);
    if (mounted) { plan = id; break; }
  }
  if (!mounted) { console.log(`VOID — no planner canvas mounted for any of ${candidates.join(", ")}; persist-on-leave never had a plan to flush`); code = 2; }
  else {
    await page.waitForTimeout(4000);
    const before = await page.evaluate(() => Object.keys(localStorage).filter((k) => /^planarfit:sites:v1/.test(k)));
    const tClick = await page.evaluate(() => performance.now());
    await page.locator('[aria-label^="Account:"]:visible').first().click({ timeout: 8000 });
    await page.locator("button:visible", { hasText: "Sign out" }).first().click({ timeout: 8000 });
    await page.waitForTimeout(6000);
    const after = await page.evaluate((t) => ({ writes: window.__lsw.filter((w) => w.t >= t), keys: Object.keys(localStorage).filter((k) => /^planarfit:sites:v1/.test(k)) }), tClick);
    const leaks = after.writes.filter((w) => !/:cloud:/.test(w.key) && (w.plans.length || w.key.endsWith(`:p:${plan}`)));
    const newKeys = after.keys.filter((k) => !before.includes(k) && k.endsWith(`:p:${plan}`));
    console.log(`writes after sign-out: ${after.writes.length} (${after.writes.map((w) => w.key).join(", ") || "none"})`);
    if (leaks.length || newKeys.length) { console.log(`FAIL — the plan was written into the signed-out store: ${[...leaks.map((w) => w.key), ...newKeys].join(", ")}`); code = 1; }
    else console.log(`PASS — nothing about ${plan} landed in the signed-out store after sign-out`);
  }
  if (throwaway) {                                                       // constraint #15 — clear it, and prove it is gone
    await signInViaRoute(page, process.env.E2E_LOGIN_KEY);
    await page.evaluate((g) => { window.location.hash = `#/project/${g}/site`; }, throwaway);
    await page.waitForTimeout(5000);
    await page.locator('[data-testid="project-crumb"]:visible').first().click({ timeout: 15000 });
    await page.getByTestId(`project-row-${throwaway}`).click({ button: "right", timeout: 10000 });
    await page.getByTestId("project-delete").click({ timeout: 10000 });
    await page.getByTestId("project-delete-confirm").click({ timeout: 10000 });
    await page.waitForTimeout(4000);
    const gone = await page.evaluate((g) => !Object.keys(localStorage).some((k) => /^planarfit:sites:cloud:/.test(k) && k.endsWith(`:p:${g}`)), throwaway);
    await page.goto(BASE + "/#/", { waitUntil: "load" }); await page.waitForTimeout(5000);
    const listed = await page.evaluate((g) => !!document.querySelector(`[data-testid="project-row-${g}"]`) || Object.keys(localStorage).some((k) => k.endsWith(`:p:${g}`) && /:cloud:/.test(k)), throwaway);
    console.log(`throwaway ${throwaway} cleared: ${gone && !listed ? "yes (gone from the account's device store and the project list after a reload)" : "NO — still present"}`);
    if (!(gone && !listed) && code === 0) code = 3;
  }
} finally { await close(); }
process.exit(code);
