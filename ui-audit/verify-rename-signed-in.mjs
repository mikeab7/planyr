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

const base = process.argv.find((a) => /^https?:/.test(a)) || "https://planyr.io";
// --dashboard-fixture: also writes ONE throwaway schedule into the test account's own schedule blob (planar_data
// "hs-v1", the table the app itself writes) so the Dashboard's Schedule Health card can be read. The account cannot
// DELETE that row (no delete policy), so it is cleared back to empty afterwards and a row is left — opt-in for that reason.
const WITH_DASH = process.argv.includes("--dashboard-fixture");
const stamp = Date.now().toString(36);
const NAME1 = `zz-rename-check-${stamp}`;
const NAME2 = `zz-rename-after-${stamp}`;
const SCHED = `zz-sched-${stamp}`;
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
  // The row lands a moment after the rename (measured 1.5–3 s: ensureProjectRow → push). Poll up to 15 s and record the time.
  let stored = [], tRow = null; const t0 = Date.now();
  while (Date.now() - t0 < 15000) {
    stored = await page.evaluate(async (g) => { const q = await window.pfSupabase.from("sites").select("id,site").eq("group_id", g); return q.data || []; }, gid);
    if (stored.length) { tRow = Date.now() - t0; break; }
    await page.waitForTimeout(500);
  }
  record("2c a sites row now exists in the cloud under the new name", stored.length >= 1 && stored.every((r) => r.site === NAME1), `${JSON.stringify(stored)} after ~${tRow == null ? ">15000" : tRow}ms`);

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

  // ── V1416128 schedule leg ───────────────────────────────────────────────────────────────────────────────────
  // B. the embedded Schedule page resolves a linked project's name LIVE by id: hand its own label function a schedule
  //    whose STORED copy is deliberately wrong, and require the project's current name (before and after a rename).
  const iframeLabel = async () => {
    const fr = page.frames().find((f) => f !== page.mainFrame());
    if (!fr) return "no-iframe";
    return fr.evaluate((g) => { try { return typeof crossScheduleLabel === "function" ? crossScheduleLabel({ id: 1, name: "S", ownerKind: "site", linkedSiteId: g, linkedSiteName: "STALE-STORED-COPY" }) : "no-fn"; } catch (e) { return "err " + e.message; } }, gid);
  };
  const renameTo = async (name) => {
    await page.goto(`${base}/#/project/${gid}/site`, { waitUntil: "domcontentloaded" });
    await page.locator('[data-testid="planner-canvas"]').waitFor({ state: "visible", timeout: 60000 });
    await crumb().click(); await page.getByTestId(`project-row-${gid}`).hover(); await page.getByTestId(`project-kebab-${gid}`).click(); await page.getByTestId("project-rename").click();
    const inp = page.getByRole("textbox", { name: /^Rename / }); await inp.fill(name); await inp.press("Enter"); await page.waitForTimeout(2500); await page.keyboard.press("Escape");
  };
  const openSchedule = async () => {
    await page.goto(`${base}/#/project/${gid}/schedule`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /create schedule|link an existing/i }).first().waitFor({ timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(8000);
  };
  await openSchedule();
  const l1 = await iframeLabel();
  record("5a Schedule page label uses the project's live name, not the stored copy", l1 === `${NAME1} / S`, `label="${l1}"`);
  await renameTo(NAME2);
  await openSchedule();
  const l2 = await iframeLabel();
  record("5b …and follows a rename (stored copy still wrong)", l2 === `${NAME2} / S`, `label="${l2}"`);

  // C. (opt-in) the Dashboard's Schedule Health card — the surface the owner reported ("Pappadoupolos / Master Schedule").
  if (WITH_DASH) {
    const ownerId = (await page.evaluate(async () => (await window.pfSupabase.auth.getUser()).data.user.id));
    const blob = (name, rev) => ({ __rev: rev, projects: name ? { 1: { id: 1, name: SCHED, ownerKind: "site", linkedSiteId: gid, linkedSiteName: "STALE-STORED-COPY", tasks: [{ id: 1, name: "zz task", start: "2026-10-01", finish: "2026-10-10", dur: 10, pct: 0 }] } } : {}, settings: {} });
    const ins = await page.evaluate(async ({ uid, v }) => { const r = await window.pfSupabase.from("planar_data").insert({ key: "hs-v1", user_id: uid, value: v }); return r.error ? String(r.error.message) : null; }, { uid: ownerId, v: blob(true, 1) });
    record("6 fixture schedule written to the test account's own blob", !ins, ins || "ok");
    if (!ins) {
      const dashText = async () => { await page.goto(`${base}/#/`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(12000); const t = await page.evaluate(() => document.body.innerText.replace(/\n+/g, " | ")); const i = t.toLowerCase().indexOf("schedule health"); return i >= 0 ? t.slice(i, i + 240) : t.slice(0, 240); };
      const d1 = await dashText();
      record("7 Dashboard Schedule Health shows the project's CURRENT name, not the stored copy", d1.includes(`${NAME2} / ${SCHED}`) && !d1.includes("STALE-STORED-COPY"), d1.slice(0, 140));
      await renameTo(NAME1 + "-b");
      const d2 = await dashText();
      record("8 …and follows a second rename without touching the schedule", d2.includes(`${NAME1}-b / ${SCHED}`), d2.slice(0, 140));
      const clr = await page.evaluate(async (v) => { const r = await window.pfSupabase.from("planar_data").update({ value: v }).eq("key", "hs-v1"); return r.error ? String(r.error.message) : null; }, blob(false, 2));
      record("9 fixture blob cleared back to empty", !clr, clr || "ok (one empty blob row remains: the account has no delete policy)");
    }
  }
} catch (e) {
  record("harness error", false, String(e && e.message || e).slice(0, 300));
  // Evidence for a failure: what the page was actually showing (a flake and a defect look identical in a bare timeout).
  try {
    const dump = await page.evaluate(() => ({ hash: location.hash, rows: document.querySelectorAll('[data-testid^="project-row-"]').length, menuOpen: !!document.querySelector('[data-testid="project-new"]'), banners: [...document.querySelectorAll('[role="alert"],[role="status"]')].map((x) => x.innerText.slice(0, 100)).filter(Boolean).slice(0, 4), crumb: (document.querySelector('[data-mode-active="true"] [data-testid="project-crumb"]') || {}).innerText }));
    console.log("page at failure:", JSON.stringify(dump));
    if (process.env.HARNESS_SHOT) await page.screenshot({ path: process.env.HARNESS_SHOT });
  } catch (_) { /* best effort */ }
} finally {
  // 4. delete the throwaway (always)
  try {
    if (gid) {
      const del = await page.evaluate(async (g) => {
        const q = await window.pfSupabase.from("sites").select("id").eq("group_id", g);
        const ids = (q.data || []).map((r) => r.id);
        if (!ids.length) return { removed: 0 };
        // The database refuses to permanently delete a LIVE project (sites_block_delete_live_group): move it to the
        // trash first — exactly what the app's own Delete does — then remove it for good.
        const t = await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).in("id", ids);
        if (t.error) return { removed: 0, error: "trash: " + String(t.error.message) };
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
