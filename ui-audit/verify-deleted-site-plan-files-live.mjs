/* verify-deleted-site-plan-files-live — V1794816 / B2364288, signed in as the throwaway test account on a real deploy.
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-deleted-site-plan-files-live.mjs [https://planyr.io] [--expect-build <sha7>]
 *
 * WHAT IT PROVES (the owner's acceptance for B2364288):
 *   1. the Site page's All comps list shows NO "Recently deleted site plans" section (the comps' own
 *      "Recently deleted" is still there — that is the KNOWN-GOOD ARM: a list that cannot show it is void);
 *   2. a deleted site-plan FILE on a throwaway project appears in the Site Planner plan menu's "Recently deleted";
 *   3. Restore puts it back (row live, same name/page) and it is still intact after a cache-busting reload;
 *   4. Delete forever (inline confirm) removes it for good.
 * The throwaway project + doc_reviews row are created by this run and removed before it ends (constraint #15).
 * /version.json is read in the SAME run as every verdict; --expect-build makes a stale deploy a hard stop. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { mkdirSync } from "node:fs";

const base = process.argv.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const ei = process.argv.indexOf("--expect-build");
const expectBuild = ei > 0 ? process.argv[ei + 1] : null;
const OUT = process.env.SHOTS_DIR || new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const stamp = Date.now().toString(36);
const PROJ = `zz-delfile-check-${stamp}`;
const FILE = `ZZ Master plan ${stamp}`;
const RID = `zz-delfile-${stamp}`;
const OID = (globalThis.crypto || (await import("node:crypto"))).randomUUID();
const results = [];
const record = (step, ok, detail) => { results.push({ step, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${step}${detail ? " — " + detail : ""}`); };

const s = await openSignedIn({ base });
const { page } = s;
let gid = null, uid = null;
const sb = (fn, arg) => page.evaluate(fn, arg);
try {
  await assertMeasurable(page, "verify-deleted-site-plan-files-live");
  const build = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()));
  console.log("build served:", JSON.stringify(build), "| signed in as", s.proof.email);
  if (expectBuild && !String(build.build || "").startsWith(expectBuild)) throw new Error(`deploy is serving ${build.build}, not ${expectBuild} — run is void`);
  uid = await sb(async () => (await window.pfSupabase.auth.getUser()).data.user.id);

  // ---- throwaway project (+ New project, rename → materialises the sites row) ----
  await page.goto(`${base}/#/project/e2e-fixture/site`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="planner-canvas"]').waitFor({ state: "visible", timeout: 60000 });
  const crumb = () => page.locator('[data-mode-active="true"]').getByTestId("project-crumb").first();
  await crumb().click();
  await page.getByTestId("project-new").click();
  await page.locator('[data-testid="planner-canvas"]:visible').waitFor({ timeout: 30000 });
  gid = await page.evaluate(() => (location.hash.match(/project\/([^/]+)/) || [])[1]);
  await crumb().click(); await page.getByTestId(`project-row-${gid}`).hover(); await page.getByTestId(`project-kebab-${gid}`).click(); await page.getByTestId("project-rename").click();
  const input = page.getByRole("textbox", { name: /^Rename / }); await input.fill(PROJ); await input.press("Enter");
  let row = null; const t0 = Date.now();
  while (Date.now() - t0 < 60000 && !row) {
    row = await sb(async (g) => ((await window.pfSupabase.from("sites").select("id,site").eq("group_id", g)).data || [])[0] || null, gid);
    if (!row) await page.waitForTimeout(500);
  }
  record("0 throwaway project has a cloud row (the plan menu needs a live plan)", !!row, JSON.stringify(row));
  if (!row) throw new Error("no sites row — cannot continue");

  // ---- a site-plan FILE on it, then deleted the way the app deletes (soft_delete_site_plan_overlay) ----
  const seeded = await sb(async ({ RID, OID, FILE, pid }) => {
    const c = window.pfSupabase;
    const r1 = await c.from("doc_reviews").insert({ id: RID, title: FILE, kind: "single", project: null, data: { zz: true } });
    if (r1.error) return { step: "doc_reviews", error: r1.error.message };
    const r2 = await c.from("site_plan_overlays").insert({ id: OID, project_id: pid, review_id: RID, page: 3, doc_title: FILE, source_file_name: "zz-master.pdf", img_w: 1200, img_h: 900, opacity: 0.85, visible: true, locked: false });
    if (r2.error) return { step: "overlay insert", error: r2.error.message };
    const r3 = await c.rpc("soft_delete_site_plan_overlay", { p_overlay_id: OID });
    return r3.error ? { step: "soft delete", error: r3.error.message } : { ok: true };
  }, { RID, OID, FILE, pid: row.id });
  record("1 a site-plan file was created on the throwaway project and deleted", !!seeded.ok, JSON.stringify(seeded));
  if (!seeded.ok) throw new Error("fixture failed");

  // ---- A. All comps list: no deleted-site-plans section; comps' own Recently deleted still there (known-good arm) ----
  await page.goto(`${base}/#/project/e2e-fixture/site`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="planner-canvas"]').waitFor({ state: "visible", timeout: 60000 });
  await page.locator('[data-testid="dashboard-crumb"]:visible').click();
  await page.locator('[data-testid="map-toolbar-draw"]:visible').waitFor({ timeout: 30000 });
  await page.locator("button", { hasText: /^Records/ }).first().click();
  await page.waitForTimeout(2500);
  const listText = await page.evaluate(() => document.body.innerText);
  record("2a KNOWN-GOOD: the All comps list shows the comps' own \"Recently deleted\"", /Recently deleted/.test(listText));
  record("2b NO \"Recently deleted site plans\" section on the All comps list", !/Recently deleted site plans/i.test(listText) && !listText.includes(FILE));
  await page.screenshot({ path: OUT + "deleted-site-plans-01-all-comps.png" });

  // ---- B. the plan menu of the throwaway project lists it ----
  await page.goto(`${base}/#/project/${gid}/site`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="planner-canvas"]').waitFor({ state: "visible", timeout: 60000 });
  await page.getByTestId("plan-crumb").click();
  const fileRow = page.getByTestId("deleted-site-plan-file").filter({ hasText: FILE });
  await fileRow.waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
  record("3a the plan menu's \"Recently deleted\" lists the file as a site plan, p.3", (await fileRow.count()) === 1 && /site plan p\.3/.test(await fileRow.innerText().catch(() => "")), (await fileRow.innerText().catch(() => "")).replace(/\s+/g, " "));
  const bg = await fileRow.evaluate((el) => getComputedStyle(el).backgroundColor).catch(() => "");
  record("3b the row has no grey fill", /rgba\(0, 0, 0, 0\)|transparent/.test(bg), bg);
  await page.screenshot({ path: OUT + "deleted-site-plans-02-plan-menu.png" });

  // ---- C. Restore ----
  await page.getByRole("button", { name: `Restore site plan ${FILE}` }).click();
  await page.waitForFunction((n) => !document.body.innerText.includes(n) || document.querySelectorAll('[data-testid="deleted-site-plan-file"]').length === 0, FILE, { timeout: 20000 }).catch(() => {});
  const afterRestore = await sb(async (id) => (await window.pfSupabase.from("site_plan_overlays").select("id,deleted_at,doc_title,page,project_id").eq("id", id)).data || [], OID);
  record("4a Restore: the row is live again (deleted_at null), same name/page/project", afterRestore.length === 1 && afterRestore[0].deleted_at === null && afterRestore[0].doc_title === FILE && afterRestore[0].page === 3 && afterRestore[0].project_id === row.id, JSON.stringify(afterRestore));
  record("4b Restore: the row left the plan menu", (await page.getByTestId("deleted-site-plan-file").filter({ hasText: FILE }).count()) === 0);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  await page.goto(`${base}/?_=${Date.now()}#/project/${gid}/site`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="planner-canvas"]').waitFor({ state: "visible", timeout: 60000 });
  const reloaded = await sb(async (id) => (await window.pfSupabase.from("site_plan_overlays").select("id,deleted_at,doc_title,page,img_w,img_h,source_file_name,review_id").eq("id", id)).data || [], OID);
  record("5 cache-busting reload: still restored, contents intact", reloaded.length === 1 && reloaded[0].deleted_at === null && reloaded[0].doc_title === FILE && reloaded[0].img_w === 1200 && reloaded[0].source_file_name === "zz-master.pdf", JSON.stringify(reloaded));
  record("5b build re-read after the reload", true, JSON.stringify(await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()))));

  // ---- D. delete again, then Delete forever through the menu's inline confirm ----
  await sb(async (id) => window.pfSupabase.rpc("soft_delete_site_plan_overlay", { p_overlay_id: id }), OID);
  await page.getByTestId("plan-crumb").click();
  const row2 = page.getByTestId("deleted-site-plan-file").filter({ hasText: FILE });
  await row2.waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
  await page.getByRole("button", { name: `Delete site plan ${FILE} forever` }).click();
  record("6a Delete forever asks first (inline confirm, nothing deleted yet)", (await page.getByText(/Permanently delete site plan/).count()) === 1 && (await sb(async (id) => (await window.pfSupabase.from("site_plan_overlays").select("id").eq("id", id)).data.length, OID)) === 1);
  await page.getByRole("button", { name: "Delete", exact: true }).last().click();
  let gone = false; const t1 = Date.now();
  while (Date.now() - t1 < 20000 && !gone) { gone = (await sb(async (id) => (await window.pfSupabase.from("site_plan_overlays").select("id").eq("id", id)).data.length, OID)) === 0; if (!gone) await page.waitForTimeout(400); }
  record("6b Delete forever removes the row for good", gone);
} catch (e) {
  record("run aborted", false, String(e.message || e).slice(0, 300));
} finally {
  try {
    const del = await page.evaluate(async ({ OID, RID, gid }) => {
      const c = window.pfSupabase; const out = {};
      out.overlay = (await c.from("site_plan_overlays").delete().eq("id", OID)).error?.message || null;
      out.review = (await c.from("doc_reviews").delete().eq("id", RID)).error?.message || null;
      if (gid) {
        const rows = ((await c.from("sites").select("id,site").eq("group_id", gid)).data || []).filter((r) => /^zz-delfile-check-/.test(r.site));
        if (rows.length) out.trashed = (await c.from("sites").update({ deleted_at: new Date().toISOString() }).in("id", rows.map((r) => r.id))).error?.message || rows.length;
      }
      return out;
    }, { OID, RID, gid });
    record("7 cleanup: overlay + doc_reviews row removed, throwaway project trashed (never hard-deleted)", !del.overlay && !del.review, JSON.stringify(del));
  } catch (e) { record("7 cleanup", false, String(e.message || e).slice(0, 200)); }
  await s.close();
}
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `RESULT: ${failed.length} FAILED of ${results.length}` : `RESULT: all ${results.length} steps passed`);
process.exit(failed.length ? 1 : 0);
