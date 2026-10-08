/* verify-rename-signed-in — the signed-in half of B1991041 (V1416129) and the schedule leg of B1991040
 * (V1416128), driven against a real deploy as the throwaway test account (e2e@planyr.test).
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-rename-signed-in.mjs [https://planyr.io]
 *
 * Creates ONE throwaway project ("zz-rename-check-…"), exercises it, and deletes it again (also on
 * failure). Never touches any other row. Prints the served build (/version.json) in the SAME call as
 * every verdict (a live measurement is only valid with the chunk hash read alongside it).
 * A harness for a reported symptom carries a known-good arm: step 0 proves the project list can
 * actually show a name we know is there (the fixture) before any "absent" verdict is believed. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const base = process.argv[2] || "https://planyr.io";
const stamp = Date.now().toString(36);
const NAME1 = `zz-rename-check-${stamp}`;
const results = [];
const record = (step, ok, detail) => { results.push({ step, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${step}${detail ? " — " + detail : ""}`); };

const s = await openSignedIn({ base });
let gid = null;
const { page } = s;
try {
  await assertMeasurable(page, "verify-rename-signed-in");
  console.log("build served:", JSON.stringify(s.build), "| signed in as", s.proof.email);

  // Start from the fixture plan so the header + switcher are mounted.
  await page.goto(`${base}/#/project/e2e-fixture/site`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="planner-canvas"]').waitFor({ state: "visible", timeout: 60000 });
  const crumb = () => page.locator('[data-mode-active="true"]').getByTestId("project-crumb").first();
  await crumb().click();
  // KNOWN-GOOD ARM: the switcher lists the fixture project we know exists.
  const knownVisible = await page.getByTestId("project-row-e2e-fixture").count().catch(() => 0);
  record("0 known-good arm: switcher lists the fixture project", knownVisible > 0, `rows matching: ${knownVisible}`);
  if (!knownVisible) throw new Error("instrument cannot see a known project — run is void");

  // 1. + New project (don't draw)
  await page.getByTestId("project-new").click();
  await page.locator('[data-testid="planner-canvas"]:visible').waitFor({ timeout: 30000 });
  gid = await page.evaluate(() => (location.hash.match(/project\/([^/]+)/) || [])[1]);
  const t1 = (await crumb().innerText()).trim();
  record("1 + New project opens as an untitled project (nothing drawn)", /untitled/i.test(t1) && !!gid && gid !== "e2e-fixture-site", `group=${gid} crumb="${t1}"`);
  const rowBefore = await page.evaluate(async (g) => { const q = await window.pfSupabase.from("sites").select("id").eq("group_id", g); return q.data ? q.data.length : -1; }, gid);
  record("1b no sites row exists yet (lazy creation preserved)", rowBefore === 0, `rows=${rowBefore}`);

  // 2. switcher row menu → Rename
  await crumb().click();
  await page.getByTestId(`project-row-${gid}`).hover();
  await page.getByTestId(`project-kebab-${gid}`).click();
  await page.getByTestId("project-rename").click();
  const input = page.getByRole("textbox", { name: /^Rename / });
  await input.fill(NAME1);
  await input.press("Enter");
  await page.waitForTimeout(2500);
  const toastBad = await page.getByText(/didn.t match any project/i).count();
  const notice = await page.getByTestId("name-notice").count();
  record("2a no \"didn't match any project\" toast, no name notice", toastBad === 0 && notice === 0, `toast=${toastBad} notice=${notice}`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  const t2 = (await crumb().innerText()).trim();
  record("2b breadcrumb shows the new name", t2.includes(NAME1), `crumb="${t2}"`);
  const stored = await page.evaluate(async (g) => { const q = await window.pfSupabase.from("sites").select("id,site").eq("group_id", g); return q.data || []; }, gid);
  record("2c a sites row now exists in the cloud under the new name", stored.length >= 1 && stored.every((r) => r.site === NAME1), JSON.stringify(stored));

  // 3. reload, then the Map: the project is still listed under the new name
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="planner-canvas"]').waitFor({ state: "visible", timeout: 60000 });
  const t3 = (await crumb().innerText()).trim();
  record("3a after reload the breadcrumb still shows the new name", t3.includes(NAME1), `crumb="${t3}"`);
  await page.locator('[data-testid="dashboard-crumb"]:visible').click();
  await page.locator('[data-testid="map-toolbar-draw"]:visible').waitFor({ timeout: 30000 });
  await crumb().click();
  const listed = await page.getByTestId(`project-row-${gid}`).innerText().catch(() => "");
  record("3b the Map's project switcher lists it under the new name", listed.includes(NAME1), `row="${listed.replace(/\s+/g, " ").slice(0, 80)}"`);
  await page.keyboard.press("Escape");
} catch (e) {
  record("harness error", false, String(e && e.message || e).slice(0, 300));
} finally {
  // 4. delete the throwaway (always)
  try {
    if (gid) {
      const del = await page.evaluate(async (g) => {
        const q = await window.pfSupabase.from("sites").select("id").eq("group_id", g);
        const ids = (q.data || []).map((r) => r.id);
        if (!ids.length) return { removed: 0 };
        const r = await window.pfSupabase.from("sites").delete().in("id", ids);
        return { removed: ids.length, error: r.error ? String(r.error.message) : null };
      }, gid);
      record("4 throwaway project removed", !del.error, JSON.stringify(del));
    }
  } catch (e) { record("4 cleanup", false, String(e.message || e).slice(0, 200)); }
  console.log("build served (re-read):", JSON.stringify(await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null))));
  await s.close();
}
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `RESULT: ${failed.length} FAILED of ${results.length}` : `RESULT: all ${results.length} steps passed`);
process.exit(failed.length ? 1 : 0);
