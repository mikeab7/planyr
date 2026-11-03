/* verify-duplicate-refused-live — V2083840 / B2639168 (2026-11-03): a duplicate the device refuses is refused OUT LOUD, a normal duplicate still works.
 *
 * Signed in as the e2e test account on a real deploy (ui-audit/lib/signedInSession.mjs). Drives the REAL plan menu on `e2e-fixture-site`:
 *   1  normal Duplicate        → crumb reads "<plan> (copy)", no banner, the copy's row exists in public.sites with the fixture's group_id,
 *                                a cache-busting reload lands on the copy, no "This project doesn't exist".
 *   2  Duplicate on a FULL device (localStorage filled to the cap) → the banner reads "Couldn't make the copy … nothing was saved", it never says
 *                                "saved on this device" or "sync", the crumb still names the ORIGINAL, the URL did not move, no new row reached
 *                                public.sites, and a reload opens the original.
 *   4  cleanup (constraint #15, no asking) → the copy from step 1 is deleted AND permanently purged through the plan menu, and verified gone from
 *                                public.sites; the filler keys are removed. `e2e-fixture-site` itself is untouched.
 * KNOWN-GOOD ARM: the harness is VOID unless the signed-in proof holds AND the fixture plan's crumb is on screen before anything is measured.
 * The served build is read from /version.json IN THE SAME CALL as each assertion (EXPECT_SHA=<merge sha prefix> must match).
 * Usage: E2E_LOGIN_KEY=… EXPECT_SHA=fdc5627 node ui-audit/verify-duplicate-refused-live.mjs [https://planyr.io] */
import { execSync } from "node:child_process";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn, FIXTURE_SITE_ID } from "./lib/signedInSession.mjs";

const BASE = (process.argv[2] || "https://planyr.io").replace(/\/$/, "");
const EXPECT_SHA = process.env.EXPECT_SHA || "";
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FIXTURE_GROUP = "e2e-fixture";            // the fixture PROJECT; FIXTURE_SITE_ID is one plan inside it ("E2E Fixture — Markup Harness")
const ROUTE = `/?app#/project/${FIXTURE_GROUP}/site`;

const s = await openSignedIn({ base: BASE });
const { page } = s;
let createdId = null;
try {
  await assertMeasurable(page, "verify-duplicate-refused-live");
  const buildNow = async () => (await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()))).build;
  const build0 = await buildNow();
  const containsMerge = (b) => { if (!EXPECT_SHA) return true; if (String(b).startsWith(EXPECT_SHA.slice(0, 7))) return true; try { execSync(`git merge-base --is-ancestor ${EXPECT_SHA} ${b}`, { stdio: "ignore" }); return true; } catch (_) { return false; } };   // the merge commit itself, or a later main build that contains it
  ok("served build is the merge commit or a later main build containing it", containsMerge(build0), `build=${build0} expect=${EXPECT_SHA || "(unset)"}`);
  ok("signed in as the test account", s.proof.email === "e2e@planyr.test" && s.proof.fixtureVisible, JSON.stringify(s.proof));

  const open = async (cb, pin = false) => {
    if (pin) await page.evaluate((id) => localStorage.setItem("planarfit:currentSite:v1", id), FIXTURE_SITE_ID);   // open the fixture plan itself, not whichever plan was last current
    await page.goto(BASE + ROUTE.replace("/?app", `/?app${cb ? "&cb=" + cb : ""}`), { waitUntil: "domcontentloaded" });
    await page.getByTestId("plan-crumb").waitFor({ state: "visible", timeout: 60000 });
  };
  const crumb = () => page.getByTestId("plan-crumb").innerText();
  const rows = (where) => page.evaluate(async (w) => {
    const q = window.pfSupabase.from("sites").select("id,group_id,deleted_at,data");
    const r = await (w.id ? q.eq("id", w.id) : q.eq("group_id", w.group));
    return { error: r.error ? String(r.error.message) : null, rows: (r.data || []).map((x) => ({ id: x.id, group_id: x.group_id, deleted_at: x.deleted_at, name: x.data && x.data.name })) };
  }, where);
  const duplicate = async () => { await page.getByTestId("plan-crumb").click(); await page.getByRole("button", { name: /Duplicate/ }).click(); };

  await open(null, true);
  const fixtureName = (await crumb()).replace("▾", "").trim();
  ok("KNOWN-GOOD: the fixture plan is open (crumb on screen)", fixtureName.length > 0, `"${fixtureName}"`);
  const before = await rows({ group: FIXTURE_GROUP });
  ok("fixture group readable", !before.error && before.rows.length >= 1, JSON.stringify(before).slice(0, 200));
  const idsBefore = new Set(before.rows.map((r) => r.id));

  /* ---- step 1: normal duplicate ---- */
  await duplicate();
  await page.waitForFunction(() => /\(copy\)/.test(document.querySelector('[data-testid="plan-crumb"]')?.innerText || ""), null, { timeout: 30000 }).catch(() => {});
  const crumb1 = await crumb();
  ok("step 1: crumb reads '(copy)'", /\(copy\)/.test(crumb1), crumb1);
  ok("step 1: no failure banner", (await page.getByTestId("cloud-write-failure-banner").count()) === 0);
  createdId = await page.evaluate(() => localStorage.getItem("planarfit:currentSite:v1"));
  ok("step 1: the planner is on a NEW plan id", !!createdId && !idsBefore.has(createdId), createdId);
  let after1 = null;
  for (let i = 0; i < 30; i++) { after1 = await rows({ id: createdId }); if (after1.rows.length) break; await sleep(1000); }
  ok("step 1: the copy's row exists in public.sites with the fixture's group_id", after1.rows.length === 1 && after1.rows[0].group_id === FIXTURE_GROUP && !after1.rows[0].deleted_at, JSON.stringify(after1.rows));
  await open("r" + Date.now());
  ok("step 1: reload (cache-busted) lands on the copy", /\(copy\)/.test(await crumb()), await crumb());
  ok("step 1: no 'This project doesn't exist'", (await page.getByText(/This project doesn't exist/i).count()) === 0);
  const build1 = await buildNow();

  /* ---- step 2: a full device ---- */
  const createdName = after1.rows[0].name;
  await open("f" + Date.now(), true);
  const crumbOrig = (await crumb()).replace("▾", "").trim();
  const groupBefore = await rows({ group: FIXTURE_GROUP });
  const urlBefore = page.url();
  const filled = await page.evaluate(() => {
    let i = 0;
    for (let step = 262144; step >= 1; step = Math.floor(step / 2)) { for (;;) { try { localStorage.setItem("zz-filler-" + i, "x".repeat(step)); i++; } catch (_) { break; } } }
    return i;
  });
  ok("step 2: localStorage filled to the cap", filled > 0, `${filled} keys`);
  await duplicate();
  const banner = page.getByTestId("cloud-write-failure-banner");
  await banner.waitFor({ state: "visible", timeout: 30000 }).catch(() => {});
  const bText = (await banner.count()) ? await banner.innerText() : "";
  ok("step 2: banner says the copy could not be made and nothing was saved", /Couldn't make the copy/.test(bText) && /nothing was saved/.test(bText), bText.slice(0, 160));
  ok("step 2: banner never says 'saved on this device' or 'sync'", !/saved on this device/i.test(bText) && !/sync/i.test(bText));
  ok("step 2: crumb still names the ORIGINAL plan", (await crumb()).replace("▾", "").trim() === crumbOrig && !/\(copy\)/.test(await crumb()), await crumb());
  ok("step 2: URL did not move", page.url() === urlBefore, page.url());
  /* The harness is an AUTOMATED browser, so the app deliberately does not SEND telemetry rows (navigator.webdriver, clientErrors.networkReportSuppression):
   * client_errors cannot show these events from here. The page's own diagnostic ring (window.pfTelemetry.recent()) records every event the app raised. */
  const ring = await page.evaluate(() => (window.pfTelemetry && window.pfTelemetry.recent ? window.pfTelemetry.recent() : []).map((r) => ({ s: String(r.source), m: String(r.message).slice(0, 400) })));
  const evt = (name) => ring.filter((r) => r.s === "event:" + name);
  ok("KNOWN-GOOD: the page's event ring is readable", ring.length > 0, `${ring.length} rows`);
  ok("step 2: plan-store-write-refused fired with reason quota", evt("plan-store-write-refused").some((r) => /"reason":"quota"/.test(r.m)), (evt("plan-store-write-refused")[0] || {}).m || "none");
  ok("step 2: site-save-refused fired", evt("site-save-refused").length >= 1, (evt("site-save-refused")[0] || {}).m || "none");
  ok("step 2: site-mint-refused fired for 'The duplicated plan' (reason quota)", evt("site-mint-refused").some((r) => /The duplicated plan/.test(r.m) && /"reason":"quota"/.test(r.m)), (evt("site-mint-refused")[0] || {}).m || "none");
  ok("step 2: NO cloud-push-failed 'missing' was raised", !evt("cloud-push-failed").some((r) => /missing/.test(r.m)) && evt("push-missing-local").length === 0);
  await sleep(4000);
  const groupAfter = await rows({ group: FIXTURE_GROUP });
  ok("step 2: no new row reached public.sites", groupAfter.rows.length === groupBefore.rows.length, `${groupBefore.rows.length} -> ${groupAfter.rows.length}`);
  await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith("zz-filler-")) localStorage.removeItem(k); });
  await open("g" + Date.now());
  ok("step 2: reload opens a plan, no 'doesn't exist'", (await page.getByText(/This project doesn't exist/i).count()) === 0 && !!(await crumb()));
  const build2 = await buildNow();
  ok("served build unchanged across the run (read in the same call as the assertions)", build0 === build1 && build1 === build2, `${build0} ${build1} ${build2}`);

  /* ---- step 4: cleanup — delete the copy AND purge it, then prove it is gone ---- */
  await open("c" + Date.now(), true);
  await page.getByTestId("plan-crumb").click();
  await page.getByRole("button", { name: "Delete plan " + createdName, exact: true }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).first().click();      // 1) soft delete → the project's "Recently deleted"
  await sleep(2500);
  if (!(await page.getByRole("button", { name: "Delete plan " + createdName + " forever", exact: true }).count())) await page.getByTestId("plan-crumb").click();
  await page.getByRole("button", { name: "Delete plan " + createdName + " forever", exact: true }).click({ timeout: 15000 });
  await page.getByRole("button", { name: "Delete", exact: true }).first().click({ timeout: 15000 });   // 2) permanent purge (the confirm row's Delete)
  let gone = null;
  for (let i = 0; i < 20; i++) { gone = await rows({ id: createdId }); if (!gone.rows.length) break; await sleep(1000); }
  ok("step 4: the copy is gone from public.sites (purged, verified)", !!gone && !gone.error && gone.rows.length === 0, JSON.stringify(gone));
  const fixture = await rows({ id: FIXTURE_SITE_ID });
  ok("step 4: e2e-fixture-site is untouched", fixture.rows.length === 1 && !fixture.rows[0].deleted_at, JSON.stringify(fixture));
} catch (e) {
  ok("harness ran to completion", false, String((e && e.stack) || e).slice(0, 400));
} finally {
  await s.close().catch(() => {});
}
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
