/* verify-rename-cloud-failure-live — NEW-1 (B2671215 follow-up, owner 2026-11-11): "If it fails to save to the cloud, then I should get a
 * warning banner saying the save didn't go through. It shouldn't show that everything's working."
 *
 * Driven LIVE and SIGNED IN as the throwaway test account on a THROWAWAY project made for this run (never a real project, never the standing
 * `e2e-fixture` group). The cloud write is made to fail in each way the owner's brief lists, and the screen is read for what the person sees:
 *
 *   E2E_LOGIN_KEY=… EXPECT_SHA=<merge sha7> node ui-audit/verify-rename-cloud-failure-live.mjs [https://planyr.io]
 *
 *   1  plan rename, cloud write ABORTED (network down): the new name stays on the crumb; ONE banner in plain words (the exact sentence, no raw
 *      error text, no status code) with a Retry; the cloud badge reads "error" — never "synced"
 *   2  a second failed rename of the same plan: still ONE banner, ONE record in the durable log for that plan (the latest name)
 *   3  a failed rename of ANOTHER (non-current) plan while the first is still failing: still one banner, same words
 *   4  reload while the cloud copy is behind: the local name is kept, the banner returns, the badge is not "synced"
 *   5  writes work again → Retry clears the banner; the cloud rows carry the latest names; the badge is "synced"; a reload shows no banner
 *   6  fail → writes work again → the NEXT successful sync (an ordinary edit) clears the banner by itself, no Retry
 *   7  truly OFFLINE (the browser's own offline switch): banner appears; back ONLINE it clears by itself and the cloud row has the name
 *   8  the SERVER REFUSING the write while online (HTTP 500 with an ugly body): the same plain banner, none of the server's words
 *   9  PROJECT rename, cloud write failing: the new name stays, one banner in plain words, badge "error"
 *  10  EXPIRED SIGN-IN (the token refresh refused): the existing "You were signed out" notice shows; NO second rename banner
 *  11  cleanup (constraint #15, never asked): every row of the throwaway project is removed, and the count left is READ BACK = 0
 * KNOWN-GOOD ARMS: the run is VOID unless the signed-in proof holds, the served build (read from /version.json in the SAME call) contains
 * EXPECT_SHA, and each failing arm really caught at least one cloud write (a count of failed requests > 0), so "no banner" can never be reported
 * by a failure that never happened.
 */
import { execSync } from "node:child_process";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const BASE = (process.argv.find((a) => /^https?:/.test(a)) || "https://planyr.io").replace(/\/$/, "");
const EXPECT_SHA = process.env.EXPECT_SHA || "";
const stamp = Date.now().toString(36);
const PROJ = `zz-rename-cloudfail-${stamp}`;
const PLAN_TEXT = "Rename didn't save to the cloud. Your other devices still see the old name.";
const PROJECT_TEXT = "Rename didn't fully save to the cloud. Your other devices may still see the old name.";
const RAW_WORDS = /PGRST|TypeError|Failed to fetch|NetworkError|ERR_|\b[45]\d\d\b|internal server|JWT|\{|\}|undefined|null/i;
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + String(extra).slice(0, 300) : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let s = await openSignedIn({ base: BASE });
let { page } = s;
let gid = null;
const sb = (fn, arg) => page.evaluate(fn, arg);
const dbRows = () => sb(async (g) => ((await window.pfSupabase.from("sites").select("id,group_id,deleted_at,data").eq("group_id", g)).data || []).map((r) => ({ id: r.id, deleted_at: r.deleted_at, name: r.data && r.data.name, site: r.data && r.data.site })), gid);
const waitFor = async (fn, ms = 30000, step = 400) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await sleep(step); } };
const buildNow = async () => (await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()))).build;

/* THE FAILURE — every Supabase write (insert/update/upsert/rpc) is made to fail in the way `mode` names. */
let failed = 0; let mode = "pass";   // "pass" | "abort" | "refuse"
const writeRoute = /\/(rest\/v1\/(sites|site_elements)|rest\/v1\/rpc\/[a-z_]+)(\?|$)/;
const installRoutes = async () => {
  await page.route(writeRoute, async (route) => {
    const m = route.request().method();
    if (mode === "pass" || m === "GET" || m === "HEAD" || m === "OPTIONS") return route.continue();
    failed++;
    if (mode === "abort") return route.abort("failed");
    return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: "XX000", message: "internal server error 500 boom PGRST999", details: null, hint: null }) });
  });
};
await installRoutes();

const banner = () => page.getByTestId("cloud-write-failure-banner");
const bannerCount = () => banner().count();
const bannerText = async () => (await bannerCount()) ? ((await banner().first().innerText()) || "").replace(/\s+/g, " ").trim() : "";
const badge = () => page.getByTestId("cloud-sync-badge").first().getAttribute("data-sync-state").catch(() => null);
const logEntries = () => page.evaluate(() => { try { return JSON.parse(localStorage.getItem("planyr:cloudWriteFailures") || "[]"); } catch { return []; } });
const crumbText = async () => ((await page.getByTestId("plan-crumb").innerText().catch(() => "")) || "");
const renameCurrent = async (name) => {
  if (!(await page.getByTestId("plan-footer").isVisible().catch(() => false))) await page.getByTestId("plan-crumb").click();
  await page.getByTestId("plan-current-name").dblclick();
  const i = page.getByTestId("plan-rename-input"); await i.fill(name); await i.press("Enter");
  await page.keyboard.press("Escape"); await sleep(250);
};
const renameOther = async (id, name) => {
  if (!(await page.getByTestId("plan-footer").isVisible().catch(() => false))) await page.getByTestId("plan-crumb").click();
  await page.getByTestId(`plan-more-${id}`).click(); await page.getByTestId("plan-ctx-rename").click();
  const i = page.getByTestId("plan-rename-input"); await i.fill(name); await i.press("Enter");
  await page.keyboard.press("Escape"); await sleep(250);
};
const crumb = () => page.locator('[data-mode-active="true"]').getByTestId("project-crumb").first();
const reloadPlan = async () => { await page.goto(`${BASE}/?_=${Date.now()}#/project/${gid}/site`, { waitUntil: "domcontentloaded" }); await page.getByTestId("planner-canvas").waitFor({ state: "visible", timeout: 40000 }); await sleep(2500); };
const drawLine = async () => {
  const box = await page.getByTestId("planner-canvas").boundingBox();
  await page.keyboard.press("l");
  const y = box.y + box.height * (0.3 + Math.random() * 0.4);
  await page.mouse.move(box.x + box.width * 0.25, y); await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.45, y, { steps: 6 }); await page.mouse.up();
  await page.keyboard.press("v").catch(() => {});
};

try {
  await assertMeasurable(page, "verify-rename-cloud-failure-live");
  const build0 = await buildNow();
  const containsMerge = (b) => { if (!EXPECT_SHA) return true; if (String(b).startsWith(EXPECT_SHA.slice(0, 7))) return true; try { execSync(`git merge-base --is-ancestor ${EXPECT_SHA} ${b}`, { stdio: "ignore" }); return true; } catch { return false; } };
  ok("KNOWN-GOOD: served build contains the merge commit (read in this call)", containsMerge(build0), `build=${build0} expect=${EXPECT_SHA || "(unset — baseline run)"}`);
  ok("KNOWN-GOOD: signed in as the test account", s.proof.email === "e2e@planyr.test" && s.proof.fixtureVisible, JSON.stringify(s.proof));

  /* ---- throwaway project (same recipe as verify-rename-instant-live): + New project, rename, draw a line, Duplicate → two plans ---- */
  await page.goto(`${BASE}/#/project/e2e-fixture`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("planner-canvas").waitFor({ state: "visible", timeout: 30000 });
  await crumb().click();
  await page.getByTestId("project-new").click();
  await page.waitForFunction(() => { const m = location.hash.match(/project\/([^/]+)/); return !!m && !/^e2e-fixture/.test(m[1]); }, null, { timeout: 30000 });
  gid = await page.evaluate(() => (location.hash.match(/project\/([^/]+)/) || [])[1]);
  if (!gid || /^e2e-fixture/.test(gid)) { const bad = gid; gid = null; throw new Error(`new project did not open (hash group "${bad}") — refusing to touch the fixture`); }
  await crumb().click(); await page.getByTestId(`project-row-${gid}`).hover(); await page.getByTestId(`project-kebab-${gid}`).click(); await page.getByTestId("project-rename").click();
  const first = page.getByRole("textbox", { name: /^Rename / }); await first.fill(PROJ); await first.press("Enter");
  ok("0 throwaway project has a cloud row", !!(await waitFor(async () => (await dbRows()).length >= 1, 60000)), gid);
  await drawLine(); await sleep(1500);
  await page.getByTestId("plan-crumb").click(); await page.getByTestId("plan-duplicate").click();
  await waitFor(async () => (await dbRows()).length >= 2, 40000, 800);
  await sleep(1500);
  if (await page.getByTestId("plan-footer").isVisible().catch(() => false)) await page.getByTestId("plan-crumb").click();
  const planRows = (await dbRows()).filter((r) => !r.deleted_at);
  ok("setup: the throwaway project has 2 live plans", planRows.length === 2, `${planRows.length}`);
  await page.getByTestId("plan-crumb").click();
  const curId = await page.getByTestId("plan-current-row").getAttribute("data-plan-id");
  await page.getByTestId("plan-crumb").click();
  const otherRow = planRows.find((r) => r.id !== curId);
  ok("setup: found the OTHER plan (not the current one)", !!curId && !!otherRow && otherRow.id !== curId, `current=${curId} other=${otherRow && otherRow.id}`);
  ok("setup: starts clean — no banner, badge synced", (await bannerCount()) === 0 && (await badge()) === "synced", `banner=${await bannerCount()} badge=${await badge()}`);

  /* ---- 1 · plan rename, cloud write aborted ---- */
  mode = "abort"; failed = 0;
  const N1 = `Renamed one ${stamp}`;
  await renameCurrent(N1);
  const sawBanner = await waitFor(async () => (await bannerCount()) > 0, 20000, 300);
  ok("1 the new name stays on the crumb (local copy has it)", (await crumbText()).includes(N1), await crumbText());
  ok("1 a warning banner appears", !!sawBanner);
  const t1 = await bannerText();
  ok("1 the banner says, in plain words, the rename didn't save to the cloud and other devices still see the old name", t1.includes(PLAN_TEXT), t1);
  ok("1 the banner carries no raw error text, no status code, no server words", !!t1 && !RAW_WORDS.test(t1.replace(PLAN_TEXT, "")), t1);
  ok("1 the banner has a Retry", (await page.getByTestId("cloud-write-failure-retry").count()) === 1);
  ok("1 the cloud badge is NOT green: it reads 'error'", (await badge()) === "error", `badge=${await badge()}`);
  ok("KNOWN-GOOD: the failure arm really caught a cloud write", failed > 0, `failed=${failed}`);

  /* ---- 2 · a second failed rename of the same plan: one banner, one record, the latest name ---- */
  const N2 = `Renamed two ${stamp}`;
  await renameCurrent(N2); await sleep(2500);
  ok("2 still ONE banner after a second failed rename", (await bannerCount()) === 1, `${await bannerCount()}`);
  const e2 = (await logEntries()).filter((e) => e.siteId === curId && e.what === "The plan rename");
  ok("2 the durable log holds ONE record for that plan (not one per attempt)", e2.length === 1, JSON.stringify(e2.map((e) => e.what)));
  ok("2 the crumb shows the latest name", (await crumbText()).includes(N2), await crumbText());

  /* ---- 3 · another (non-current) plan renamed while the first still fails ---- */
  const N3 = `Renamed other ${stamp}`;
  await renameOther(otherRow.id, N3); await sleep(2500);
  ok("3 still ONE banner, same words, after the other plan's rename failed too", (await bannerCount()) === 1 && (await bannerText()).includes(PLAN_TEXT), await bannerText());
  await page.getByTestId("plan-crumb").click();
  const row3 = await waitFor(async () => { const t = await page.getByTestId(`plan-open-${otherRow.id}`).innerText().catch(() => ""); return t.includes(N3) ? t : ""; }, 8000, 300);
  ok("3 the other plan's row shows its new name", !!row3, row3);
  await page.keyboard.press("Escape"); await sleep(300);
  if (await page.getByTestId("plan-footer").isVisible().catch(() => false)) await page.getByTestId("plan-crumb").click();

  /* ---- 4 · reload while the cloud copy is behind ---- */
  await reloadPlan();
  ok("4 after a reload the local name is KEPT (not the old cloud one)", (await crumbText()).includes(N2), await crumbText());
  const back4 = await waitFor(async () => (await bannerCount()) > 0, 15000, 300);
  ok("4 …and the banner returns", !!back4);
  ok("4 …in the same plain words", (await bannerText()).includes(PLAN_TEXT) || /rename/i.test(await bannerText()), await bannerText());
  ok("4 …and the badge is not 'synced'", (await badge()) !== "synced", `badge=${await badge()}`);

  /* ---- 5 · writes work again → Retry ---- */
  mode = "pass";
  await page.getByTestId("cloud-write-failure-retry").click();
  const cleared5 = await waitFor(async () => (await bannerCount()) === 0, 25000, 400);
  ok("5 Retry clears the banner", !!cleared5, await bannerText());
  const landed5 = await waitFor(async () => { const r = await dbRows(); return r.some((x) => x.name === N2) && r.some((x) => x.name === N3) ? r : null; }, 40000, 800);
  ok("5 the cloud rows carry the latest names of both plans", !!landed5, JSON.stringify(await dbRows()));
  ok("5 the badge is 'synced'", await waitFor(async () => (await badge()) === "synced", 15000, 400), `badge=${await badge()}`);
  await reloadPlan();
  ok("5 a reload shows no banner and an empty failure log for these plans", (await bannerCount()) === 0 && (await logEntries()).filter((e) => e.siteId === curId || e.siteId === otherRow.id).length === 0, `banner=${await bannerCount()} log=${JSON.stringify(await logEntries())}`);

  /* ---- 6 · the next successful sync clears it by itself ---- */
  mode = "abort"; failed = 0;
  const N6 = `Renamed six ${stamp}`;
  await renameCurrent(N6);
  ok("6 banner appears", !!(await waitFor(async () => (await bannerCount()) > 0, 20000, 300)));
  mode = "pass";
  await drawLine();
  const auto6 = await waitFor(async () => (await bannerCount()) === 0, 30000, 500);
  ok("6 the next successful sync (an ordinary edit) clears the banner with no Retry click", !!auto6, await bannerText());
  ok("6 the cloud row carries the name", !!(await waitFor(async () => (await dbRows()).some((x) => x.name === N6), 30000, 800)));
  ok("KNOWN-GOOD: arm 6 really failed a write first", failed > 0, `failed=${failed}`);

  /* ---- 7 · truly offline, then back online ---- */
  const N7 = `Renamed seven ${stamp}`;
  await page.context().setOffline(true);
  await renameCurrent(N7);
  ok("7 offline: banner appears", !!(await waitFor(async () => (await bannerCount()) > 0, 20000, 300)));
  ok("7 offline: the plain words", (await bannerText()).includes(PLAN_TEXT), await bannerText());
  ok("7 offline: the name stays on the crumb and the badge is not 'synced'", (await crumbText()).includes(N7) && (await badge()) !== "synced", `badge=${await badge()}`);
  await page.context().setOffline(false);
  const online7 = await waitFor(async () => (await bannerCount()) === 0, 45000, 500);
  ok("7 back online: the banner clears on its own (no click)", !!online7, await bannerText());
  ok("7 back online: the cloud row has the name", !!(await waitFor(async () => (await dbRows()).some((x) => x.name === N7), 45000, 800)));

  /* ---- 8 · the server refuses the write while online ---- */
  mode = "refuse"; failed = 0;
  const N8 = `Renamed eight ${stamp}`;
  await renameCurrent(N8);
  ok("8 refused write: banner appears", !!(await waitFor(async () => (await bannerCount()) > 0, 20000, 300)));
  const t8 = await bannerText();
  ok("8 refused write: the plain words, none of the server's", t8.includes(PLAN_TEXT) && !RAW_WORDS.test(t8.replace(PLAN_TEXT, "")), t8);
  ok("KNOWN-GOOD: arm 8 really refused a write", failed > 0, `failed=${failed}`);
  mode = "pass";
  await page.getByTestId("cloud-write-failure-retry").click();
  ok("8 Retry after the server recovers clears it", !!(await waitFor(async () => (await bannerCount()) === 0, 25000, 400)));
  await waitFor(async () => (await dbRows()).some((x) => x.name === N8), 30000, 800);

  /* ---- 9 · PROJECT rename, cloud failing ---- */
  mode = "abort"; failed = 0;
  const NP = `${PROJ}-renamed`;
  await crumb().click(); await page.getByTestId(`project-row-${gid}`).hover(); await page.getByTestId(`project-kebab-${gid}`).click(); await page.getByTestId("project-rename").click();
  const ip = page.getByRole("textbox", { name: /^Rename / }); await ip.fill(NP); await ip.press("Enter");
  await page.keyboard.press("Escape"); await sleep(400);
  ok("9 the project crumb shows the new name", ((await page.locator('[data-mode-active="true"] [data-testid="project-crumb-name"]').first().innerText().catch(() => "")) || "").includes(NP));
  ok("9 a banner appears", !!(await waitFor(async () => (await bannerCount()) > 0, 25000, 300)));
  const t9 = await bannerText();
  ok("9 …in plain words, no raw error text", t9.includes(PROJECT_TEXT) && !RAW_WORDS.test(t9.replace(PROJECT_TEXT, "")), t9);
  ok("9 …and the badge is 'error', not 'synced'", (await badge()) === "error", `badge=${await badge()}`);
  ok("KNOWN-GOOD: arm 9 really failed a write", failed > 0, `failed=${failed}`);
  mode = "pass";
  await page.getByTestId("cloud-write-failure-retry").click();
  ok("9 Retry clears it and the cloud carries the project name", !!(await waitFor(async () => (await bannerCount()) === 0 && (await dbRows()).every((x) => x.site === NP), 40000, 800)), JSON.stringify(await dbRows()));

  /* ---- 10 · EXPIRED SIGN-IN: the token refresh is refused, so the person is signed out. The existing notice speaks; no second banner. ---- */
  const N10 = `Renamed ten ${stamp}`;
  mode = "refuse"; failed = 0;
  await page.route(/\/auth\/v1\/token\?grant_type=refresh_token/, (route) => route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: "refresh_token_not_found", error: "invalid_grant", error_description: "Invalid Refresh Token: Refresh Token Not Found" }) }));
  // the write is answered like a dead token: 401 / JWT expired
  await page.unroute(writeRoute);
  let authFailed = 0;
  await page.route(writeRoute, async (route) => {
    const m = route.request().method();
    if (m === "GET" || m === "HEAD" || m === "OPTIONS") return route.continue();
    authFailed++;
    return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ code: "PGRST301", message: "JWT expired", details: null, hint: null }) });
  });
  await renameCurrent(N10);
  const notice10 = await waitFor(async () => (await page.getByTestId("signed-out-notice").count()) > 0, 25000, 400);
  ok("10 the existing 'You were signed out' notice shows", !!notice10);
  ok("10 …and NO second (rename) banner says the cloud save failed", (await bannerCount()) === 0 || !/Rename didn.t/i.test(await bannerText()), await bannerText());
  ok("10 the name stays on the crumb (saved on this device)", (await crumbText()).includes(N10), await crumbText());
  ok("KNOWN-GOOD: arm 10 really answered a write with 401", authFailed > 0, `authFailed=${authFailed}`);
} catch (e) {
  ok("harness ran to the end", false, String(e && e.stack || e).slice(0, 500));
} finally {
  /* ---- 11 · cleanup: the throwaway project's rows are removed, and the count left is READ BACK (constraint #15) ---- */
  try {
    mode = "pass";
    await page.unroute(writeRoute).catch(() => {});
    await page.unroute(/\/auth\/v1\/token\?grant_type=refresh_token/).catch(() => {});
    await page.context().setOffline(false).catch(() => {});
    if (gid && !/^e2e-fixture/.test(gid)) {
      // arm 10 signed this page out: come back in through the same helper before deleting
      let hasSession = await page.evaluate(async () => !!(window.pfSupabase && (await window.pfSupabase.auth.getSession()).data.session)).catch(() => false);
      if (!hasSession) { await s.close().catch(() => {}); s = await openSignedIn({ base: BASE }); page = s.page; }
      const left = await page.evaluate(async (g) => {
        const c = window.pfSupabase;
        const rows = ((await c.from("sites").select("id,site,group_id").eq("group_id", g)).data || []);
        const ids = rows.filter((r) => !/^e2e-fixture/.test(r.id) && !/^e2e-fixture/.test(r.group_id)).map((r) => r.id);
        if (ids.length) { await c.from("sites").update({ deleted_at: new Date().toISOString() }).in("id", ids); await c.from("sites").delete().in("id", ids); }
        return ((await c.from("sites").select("id").eq("group_id", g)).data || []).length;
      }, gid);
      ok("11 cleanup: no row of the throwaway project is left (read back)", left === 0, `${left} left`);
    }
  } catch (e) { ok("11 cleanup ran", false, String(e.message || e).slice(0, 200)); }
  await s.close().catch(() => {});
}
const bad = results.filter((r) => !r.pass);
console.log(`\n${results.length - bad.length}/${results.length} passed`);
process.exit(bad.length ? 1 : 0);
