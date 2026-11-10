/* verify-rename-instant-live — NEW-1 (B2671215, owner 2026-11-10): "When I hit enter, it should immediately change the name when I rename a
 * concept or project." Driven LIVE and SIGNED IN as the throwaway test account on a THROWAWAY project made for this run (never a real
 * project, never the standing `e2e-fixture` group), WITH THE CLOUD WRITE HELD PENDING so the screen cannot be waiting on it:
 *
 *   E2E_LOGIN_KEY=… EXPECT_SHA=<merge sha7> node ui-audit/verify-rename-instant-live.mjs [https://planyr.io]
 *
 *   1  rename the CURRENT plan (menu, double-click) — every Supabase write is held for 6 s — the crumb AND the menu's current row read the new
 *      name at the FIRST animation frame after Enter, and the name is still there after the hold releases
 *   2  rename ANOTHER plan (⋯ ▸ Rename), writes held — its list row reads the new name at the first frame
 *   3  rename the PROJECT (header menu ▸ Rename), writes held — the project crumb + its row read it at the first frame
 *   4  the cloud rows carry all three new names once the hold is released (read back from `public.sites`), and a reload shows them
 *   5  a cloud write that FAILS (aborted) for a plan rename: the new name stays (local-first, saved on this device) and the failure is told in
 *      words on screen — never a silent revert and never a silent success
 *   6  cleanup (constraint #15, never asked): every row of the throwaway project is removed, and the count left is READ BACK = 0
 * KNOWN-GOOD ARM: the run is VOID unless the signed-in proof holds AND the served build (read from /version.json in the SAME call as the
 * assertions) contains EXPECT_SHA; and unless the held-write arm really held something (a count of held requests > 0), so "the screen did not
 * wait" can never be reported by a hold that caught nothing.
 */
import { execSync } from "node:child_process";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const BASE = (process.argv.find((a) => /^https?:/.test(a)) || "https://planyr.io").replace(/\/$/, "");
const EXPECT_SHA = process.env.EXPECT_SHA || "";
const stamp = Date.now().toString(36);
const PROJ = `zz-rename-instant-${stamp}`;
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + String(extra).slice(0, 260) : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const s = await openSignedIn({ base: BASE });
const { page } = s;
let gid = null;
const sb = (fn, arg) => page.evaluate(fn, arg);
const dbRows = () => sb(async (g) => ((await window.pfSupabase.from("sites").select("id,group_id,deleted_at,data").eq("group_id", g)).data || []).map((r) => ({ id: r.id, deleted_at: r.deleted_at, name: r.data && r.data.name, site: r.data && r.data.site })), gid);
const waitFor = async (fn, ms = 30000, step = 500) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await sleep(step); } };
const buildNow = async () => (await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()))).build;

/* THE HOLD — every Supabase write (insert/update/upsert/rpc) waits HOLD_MS before it continues (or is aborted in the failure arm). */
const HOLD_MS = 6000;
let held = 0; let mode = "pass";   // "pass" | "hold" | "abort"
await page.route(/\/(rest\/v1\/(sites|site_elements)|rest\/v1\/rpc\/[a-z_]+)(\?|$)/, async (route) => {
  const m = route.request().method();
  if (mode === "pass" || m === "GET" || m === "HEAD" || m === "OPTIONS") return route.continue();
  held++;
  if (mode === "abort") return route.abort("failed");
  await sleep(HOLD_MS);
  return route.continue().catch(() => {});
});

/* First-paint probe: the next animation frame after Enter (or the editor's blur) snapshots every display. */
const arm = (displays) => page.evaluate((displays) => {
  window.__frame = null;
  const read = (NEW) => Object.fromEntries(Object.entries(displays).map(([k, sel]) => { const el = document.querySelector(sel); return [k, el ? el.textContent : null]; }));
  window.__arm = () => requestAnimationFrame(() => { window.__frame = read(); });
  if (!window.__armed) { window.__armed = true; window.addEventListener("keydown", (e) => { if (e.key === "Enter" && !window.__frame) window.__arm(); }, true); }
}, displays);
const frame = async () => { await page.waitForFunction(() => window.__frame, null, { timeout: 5000 }); return page.evaluate(() => window.__frame); };

try {
  await assertMeasurable(page, "verify-rename-instant-live");
  const build0 = await buildNow();
  const containsMerge = (b) => { if (!EXPECT_SHA) return true; if (String(b).startsWith(EXPECT_SHA.slice(0, 7))) return true; try { execSync(`git merge-base --is-ancestor ${EXPECT_SHA} ${b}`, { stdio: "ignore" }); return true; } catch { return false; } };
  ok("KNOWN-GOOD: served build contains the merge commit (read in this call)", containsMerge(build0), `build=${build0} expect=${EXPECT_SHA || "(unset)"}`);
  ok("KNOWN-GOOD: signed in as the test account", s.proof.email === "e2e@planyr.test" && s.proof.fixtureVisible, JSON.stringify(s.proof));

  /* ---- throwaway project: + New project, rename → materialises the sites row, draw one line, Duplicate → two plans ---- */
  await page.goto(`${BASE}/#/project/e2e-fixture`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("planner-canvas").waitFor({ state: "visible", timeout: 30000 });
  const crumb = () => page.locator('[data-mode-active="true"]').getByTestId("project-crumb").first();
  await crumb().click();
  await page.getByTestId("project-new").click();
  await page.waitForFunction(() => { const m = location.hash.match(/project\/([^/]+)/); return !!m && !/^e2e-fixture/.test(m[1]); }, null, { timeout: 30000 });
  gid = await page.evaluate(() => (location.hash.match(/project\/([^/]+)/) || [])[1]);
  if (!gid || /^e2e-fixture/.test(gid)) { const bad = gid; gid = null; throw new Error(`new project did not open (hash group "${bad}") — refusing to touch the fixture`); }
  await crumb().click(); await page.getByTestId(`project-row-${gid}`).hover(); await page.getByTestId(`project-kebab-${gid}`).click(); await page.getByTestId("project-rename").click();
  const first = page.getByRole("textbox", { name: /^Rename / }); await first.fill(PROJ); await first.press("Enter");
  ok("0 throwaway project has a cloud row", !!(await waitFor(async () => (await dbRows()).length >= 1, 60000)), gid);
  const box = await page.getByTestId("planner-canvas").boundingBox();
  await page.keyboard.press("l");
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.8); await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.8, { steps: 6 }); await page.mouse.up();
  await page.keyboard.press("v").catch(() => {});
  await sleep(1500);
  await page.getByTestId("plan-crumb").click(); await page.getByTestId("plan-duplicate").click();
  await waitFor(async () => (await dbRows()).length >= 2, 40000, 800);
  await sleep(1200);
  if (await page.getByTestId("plan-footer").isVisible().catch(() => false)) await page.getByTestId("plan-crumb").click();
  const planRows = (await dbRows()).filter((r) => !r.deleted_at);
  ok("setup: the throwaway project has 2 live plans", planRows.length === 2, `${planRows.length}`);
  // the CURRENT plan is whichever row the menu marks current (never guessed from database order — after Duplicate the copy is current)
  await page.getByTestId("plan-crumb").click();
  const curId = await page.getByTestId("plan-current-row").getAttribute("data-plan-id");
  await page.getByTestId("plan-crumb").click();
  const otherRow = planRows.find((r) => r.id !== curId);
  ok("setup: found the OTHER plan (not the current one)", !!curId && !!otherRow && otherRow.id !== curId, `current=${curId} other=${otherRow && otherRow.id}`);

  /* ---- 1 · the CURRENT plan, cloud writes held ---- */
  mode = "hold"; held = 0;
  await page.getByTestId("plan-crumb").click();
  await arm({ crumb: '[data-testid="plan-crumb"]', currentRow: '[data-testid="plan-current-row"]' });
  await page.getByTestId("plan-current-name").dblclick();
  const NAME1 = `Renamed current ${stamp}`;
  const i1 = page.getByTestId("plan-rename-input"); await i1.fill(NAME1); await i1.press("Enter");
  const f1 = await frame();
  ok("1 the crumb reads the new plan name at the first frame after Enter (cloud write held)", (f1.crumb || "").includes(NAME1), JSON.stringify(f1));
  ok("1 the menu's current row reads it at the first frame too", (f1.currentRow || "").includes(NAME1));
  await sleep(1500);
  ok("1 …and is still the new name 1.5 s later while the write is still held (nothing undid it)", ((await page.getByTestId("plan-crumb").innerText()) || "").includes(NAME1));
  ok("KNOWN-GOOD: the hold really caught a cloud write", held > 0, `held=${held}`);

  /* ---- 2 · ANOTHER plan ---- */
  held = 0;
  await page.evaluate(() => { window.__frame = null; });
  await arm({ other: `[data-testid="plan-open-${otherRow.id}"]` });
  await page.getByTestId(`plan-more-${otherRow.id}`).click();
  await page.getByTestId("plan-ctx-rename").click();
  const NAME2 = `Renamed other ${stamp}`;
  const i2 = page.getByTestId("plan-rename-input"); await i2.fill(NAME2); await i2.press("Enter");
  const f2 = await frame();
  ok("2 the other plan's row reads the new name at the first frame after Enter (cloud write held)", (f2.other || "").includes(NAME2), JSON.stringify(f2));
  await page.keyboard.press("Escape"); await sleep(300);

  /* ---- 3 · the PROJECT ---- */
  held = 0;
  await page.evaluate(() => { window.__frame = null; });
  await arm({ projectCrumb: '[data-mode-active="true"] [data-testid="project-crumb-name"]' });   // scoped to the ACTIVE module: the page keeps others mounted, each with its own crumb
  await crumb().click(); await page.getByTestId(`project-row-${gid}`).hover(); await page.getByTestId(`project-kebab-${gid}`).click(); await page.getByTestId("project-rename").click();
  const NAME3 = `${PROJ}-renamed`;
  const i3 = page.getByRole("textbox", { name: /^Rename / }); await i3.fill(NAME3); await i3.press("Enter");
  const f3 = await frame();
  ok("3 the project crumb reads the new project name at the first frame after Enter (cloud write held)", (f3.projectCrumb || "").includes(NAME3), JSON.stringify(f3));
  ok("KNOWN-GOOD: the hold caught the project rename's cloud write", await waitFor(async () => held > 0, 4000, 200), `held=${held}`);

  /* ---- 4 · release the hold: the cloud rows carry the names; a reload shows them ---- */
  mode = "pass";
  const landed = await waitFor(async () => { const r = await dbRows(); return r.some((x) => x.name === NAME1) && r.some((x) => x.name === NAME2) && r.every((x) => x.site === NAME3) ? r : null; }, 45000, 800);
  ok("4 the cloud rows carry the current plan's name, the other plan's name and the project name", !!landed, JSON.stringify(await dbRows()));
  await page.goto(`${BASE}/?_=${Date.now()}#/project/${gid}/site`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("planner-canvas").waitFor({ state: "visible", timeout: 40000 });
  await sleep(1500);
  const afterReload = { plan: await page.getByTestId("plan-crumb").innerText(), proj: await crumb().innerText() };
  ok("4 after a reload the crumbs show the new plan and project names", afterReload.plan.includes("Renamed") && afterReload.proj.includes(NAME3), JSON.stringify(afterReload));

  /* ---- 5 · a cloud write that FAILS: the name stays (saved on this device) and the failure is told in words ---- */
  mode = "abort"; held = 0;
  await page.getByTestId("plan-crumb").click();
  await page.getByTestId("plan-current-name").dblclick();
  const NAME5 = `Renamed offline ${stamp}`;
  const i5 = page.getByTestId("plan-rename-input"); await i5.fill(NAME5); await i5.press("Enter");
  await page.keyboard.press("Escape");
  const toldIt = await waitFor(async () => /saved on this device|couldn.t sync|couldn.t be saved/i.test(await page.locator("body").innerText()), 15000, 400);
  ok("5 a failed cloud write: the new name STAYS on the crumb (local-first, never a silent revert)", ((await page.getByTestId("plan-crumb").innerText()) || "").includes(NAME5));
  ok("5 …and the failure is said in plain words on screen (not silent)", !!toldIt);
  mode = "pass";
} catch (e) {
  ok("harness ran to the end", false, String(e && e.stack || e).slice(0, 400));
} finally {
  /* ---- 6 · cleanup: the throwaway project's rows are removed, and the count left is READ BACK ---- */
  try {
    mode = "pass";
    if (gid && !/^e2e-fixture/.test(gid)) {
      const left = await page.evaluate(async (g) => {
        const c = window.pfSupabase;
        const rows = ((await c.from("sites").select("id,site,group_id").eq("group_id", g)).data || []);
        const ids = rows.filter((r) => !/^e2e-fixture/.test(r.id) && !/^e2e-fixture/.test(r.group_id)).map((r) => r.id);
        if (ids.length) { await c.from("sites").update({ deleted_at: new Date().toISOString() }).in("id", ids); await c.from("sites").delete().in("id", ids); }
        return ((await c.from("sites").select("id").eq("group_id", g)).data || []).length;
      }, gid);
      ok("6 cleanup: no row of the throwaway project is left (read back)", left === 0, `${left} left`);
    }
  } catch (e) { ok("6 cleanup ran", false, String(e.message || e).slice(0, 200)); }
  await s.close().catch(() => {});
}
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
