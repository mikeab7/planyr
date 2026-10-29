/* Live signed-in check for B2522752 / B2522753 (header crumb scope + spacing).
 *   E2E_LOGIN_KEY=… node ui-audit/verify-header-crumb-live.mjs [https://planyr.io | a *.planyr.pages.dev preview]
 * Signs in as the test account (shared helper), seeds THREE throwaway local projects (ids zz-crumb-*),
 * checks (1) the plan crumb is Site-only on the test account's own fixture site (read-only) and (2) the
 * crumb/"/" gaps are equal across short/mid/long names, then DELETES every zz-crumb-* row it may have
 * pushed to the cloud and verifies none remain. The served build is read in the same call as the assertions. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const base = process.argv[2] || "https://planyr.io";
const LONG = "Northwest Distribution Park Phase Three Expansion Parcel";
const COMBOS = [["A", "GC"], ["Academy", "Concept A"], [LONG, LONG]];
const fails = [];
const check = (ok, msg) => { console.log(ok ? "  ok  " : "  FAIL", msg); if (!ok) fails.push(msg); };

const s = await openSignedIn({ base });
const { page } = s;
try {
  await assertMeasurable(page, "verify-header-crumb-live");
  console.log("build:", JSON.stringify(s.build), "| signed in as", s.proof.email);
  const vis = (id) => page.getByTestId(id).filter({ visible: true });

  // (1) scope, on the fixture site (read-only — nothing is written)
  await page.goto(`${base}/#/project/e2e-fixture-site/site`);
  await vis("plan-crumb").waitFor({ timeout: 30000 });
  const planBefore = (await vis("plan-crumb").innerText()).replace("▾", "").trim();
  check((await vis("crumb-sep").count()) === 2, "Site: Dashboard / Project / Plan (2 separators)");
  for (const mod of ["model", "doc-review", "library", "notes"]) {
    await page.getByTestId(`module-tab-${mod}`).filter({ visible: true }).click();
    await vis("project-crumb").waitFor({ timeout: 20000 });
    await page.waitForTimeout(400);
    check((await vis("plan-crumb").count()) === 0 && (await vis("model-concept-crumb").count()) === 0 && (await vis("crumb-sep").count()) === 1, `${mod}: no plan crumb, one separator`);
  }
  await page.getByTestId("module-tab-site-planner").filter({ visible: true }).click();
  await vis("plan-crumb").waitFor({ timeout: 20000 });
  check((await vis("plan-crumb").innerText()).replace("▾", "").trim() === planBefore, `Site again shows the same plan ("${planBefore}")`);

  // (2) spacing — three throwaway local projects
  await page.evaluate((combos) => {
    const key = "planarfit:sites:v1", map = JSON.parse(localStorage.getItem(key) || "{}");
    combos.forEach(([site, name], i) => { const id = `zz-crumb-${i}`; map[id] = { schemaVersion: 12, id, groupId: id, site, name, updatedAt: Date.now() + i, els: [], parcels: [], measures: [], callouts: [], markups: [], settings: {} }; });
    localStorage.setItem(key, JSON.stringify(map));
  }, COMBOS);
  const got = [];
  for (let i = 0; i < COMBOS.length; i++) {
    await page.goto(`${base}/#/project/zz-crumb-${i}/site`); await page.reload();
    await vis("plan-crumb").waitFor({ timeout: 30000 });
    await page.waitForTimeout(800);
    got.push(await page.evaluate(() => {
      const v = (id) => [...document.querySelectorAll(`[data-testid="${id}"]`)].filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== "hidden");
      const r = (e) => e.getBoundingClientRect();
      const seps = v("crumb-sep"), name = v("project-crumb-name")[0], caret = v("project-caret")[0], plan = v("plan-crumb")[0], pn = plan.querySelector("span");
      const dash = v("dashboard-crumb")[0], tn = [...dash.childNodes].filter((n) => n.nodeType === 3).pop(), rg = document.createRange(); rg.selectNodeContents(tn);
      return { a: r(seps[0]).left - rg.getBoundingClientRect().right, b: r(name).left - r(seps[0]).right, c: r(seps[1]).left - r(caret).right, d: r(pn).left - r(seps[1]).right, t: name.getAttribute("title") };
    }));
  }
  for (const m of ["a", "b", "c", "d"]) { const xs = got.map((g) => g[m]); check(Math.max(...xs) - Math.min(...xs) <= 1, `gap ${m} equal across names: ${xs.map((x) => x.toFixed(1)).join(" / ")}`); }
  check(got[2].t === LONG, "long project name carries the full-name hover title");
} finally {
  // cleanup — local rows, then any cloud rows the app pushed; verify none remain
  const left = await page.evaluate(async () => {
    const key = "planarfit:sites:v1", map = JSON.parse(localStorage.getItem(key) || "{}");
    for (const k of Object.keys(map)) if (k.startsWith("zz-crumb-")) delete map[k];
    localStorage.setItem(key, JSON.stringify(map));
    let cloud = null;
    if (window.pfSupabase) {
      await window.pfSupabase.from("sites").delete().like("id", "zz-crumb-%");
      const q = await window.pfSupabase.from("sites").select("id").like("id", "zz-crumb-%");
      cloud = q.error ? "error:" + q.error.message : q.data.length;
    }
    return { local: Object.keys(map).filter((k) => k.startsWith("zz-crumb-")).length, cloud };
  });
  console.log("cleanup — remaining throwaway rows:", JSON.stringify(left));
  if (left.local !== 0 || left.cloud !== 0) fails.push("cleanup left rows behind: " + JSON.stringify(left));
  await s.close();
}
console.log(fails.length ? `FAILED (${fails.length})` : "PASS");
process.exit(fails.length ? 1 : 0);
