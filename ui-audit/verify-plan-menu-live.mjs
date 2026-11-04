/* verify-plan-menu-live — NEW-1 (2026-11-04), the redesigned plan menu (the plan crumb's dropdown), driven LIVE and SIGNED IN as the throwaway
 * test account (ui-audit/lib/signedInSession.mjs) on a THROWAWAY project made for this run (never a real project, never the standing
 * `e2e-fixture` group). Run it against the deploy (or a Cloudflare branch preview):
 *
 *   E2E_LOGIN_KEY=… EXPECT_SHA=<merge sha7> node ui-audit/verify-plan-menu-live.mjs [https://planyr.io]
 *
 * What it proves, against the REAL cloud rows (nothing is read off a mock):
 *   1  the menu: the current plan is ONE highlighted row on top, the OTHER plans are the list, a ⋯ on every row, no ✕, no "Plan name"
 *      field, no Save now / "This device" / "Storage on this device…", Find shows at 8+ plans and filters
 *   2  the one ⋯ menu: the ⋯ and a right-click open the same items; every row the same height with the same gap; Delete plan red + last
 *   3  Rename ANOTHER plan in place (Enter commits) — the cloud row carries the new name; empty is refused
 *   4  Delete plan (inline confirm) ×2 → "Recently deleted (2)" row → the bin view with the exact "Deleted <date>, <time>" line on each
 *      entry (two plans with the SAME name are told apart by it) → Restore one (the cloud row's deleted_at is cleared and it is back in the
 *      list) → Delete forever on the other via its ⋯ (the cloud row is GONE) → the bin empties and the view returns to the list
 *   5  a SHORT window keeps the footer in view with the list scrolled; a PHONE width fits the screen with the ⋯ visible; the dark theme
 *   6  cleanup (constraint #15, never asked): every row of the throwaway project is trashed and removed, and the count left is READ BACK = 0
 * KNOWN-GOOD ARM: the run is VOID unless the signed-in proof holds AND the served build (read from /version.json in the SAME call as the
 * assertions) contains EXPECT_SHA. Screenshots of the open menu, the ⋯ menu and the bin view go to SHOTS_DIR (default ui-audit/screens/).
 */
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const BASE = (process.argv.find((a) => /^https?:/.test(a)) || "https://planyr.io").replace(/\/$/, "");
const EXPECT_SHA = process.env.EXPECT_SHA || "";
const OUT = process.env.SHOTS_DIR || new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const stamp = Date.now().toString(36);
const PROJ = `zz-planmenu-check-${stamp}`;
const LONG = "Phase II & III - Two (2) 1.2M";
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + String(extra).slice(0, 260) : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const s = await openSignedIn({ base: BASE });
const { page } = s;
let gid = null;
const sb = (fn, arg) => page.evaluate(fn, arg);
const dbRows = () => sb(async (g) => ((await window.pfSupabase.from("sites").select("id,group_id,deleted_at,data").eq("group_id", g)).data || []).map((r) => ({ id: r.id, deleted_at: r.deleted_at, name: r.data && r.data.name })), gid);
const waitFor = async (fn, ms = 30000, step = 500) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await sleep(step); } };

async function openProject(id) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto(`${BASE}/${attempt ? `?_=${Date.now()}` : ""}#/project/${id}/site`, { waitUntil: "domcontentloaded" });
    if (attempt) await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
    if (await page.getByTestId("planner-canvas").waitFor({ state: "visible", timeout: 25000 }).then(() => true, () => false)) return;
  }
  throw new Error(`project ${id} never opened in the planner`);
}
const openMenu = async () => {
  if (!(await page.getByTestId("plan-footer").isVisible().catch(() => false)) && !(await page.getByTestId("plan-bin-back").isVisible().catch(() => false))) await page.getByTestId("plan-crumb").click();
  await page.locator('[data-testid="plan-footer"], [data-testid="plan-bin-back"]').first().waitFor({ state: "visible", timeout: 15000 });
};
const closeMenu = async () => { if (await page.getByTestId("plan-footer").isVisible().catch(() => false)) await page.getByTestId("plan-crumb").click(); await sleep(200); };
const ctxItems = () => page.locator('[data-testid^="plan-ctx-"]').allInnerTexts().then((a) => a.map((t) => t.trim()));
const buildNow = async () => (await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()))).build;

try {
  await assertMeasurable(page, "verify-plan-menu-live");
  const build0 = await buildNow();
  const containsMerge = (b) => { if (!EXPECT_SHA) return true; if (String(b).startsWith(EXPECT_SHA.slice(0, 7))) return true; try { execSync(`git merge-base --is-ancestor ${EXPECT_SHA} ${b}`, { stdio: "ignore" }); return true; } catch { return false; } };
  ok("KNOWN-GOOD: served build contains the merge commit (read in this call)", containsMerge(build0), `build=${build0} expect=${EXPECT_SHA || "(unset)"}`);
  ok("KNOWN-GOOD: signed in as the test account", s.proof.email === "e2e@planyr.test" && s.proof.fixtureVisible, JSON.stringify(s.proof));

  /* ---- throwaway project: + New project, rename → materialises the sites row ---- */
  await openProject("e2e-fixture");
  const crumb = () => page.locator('[data-mode-active="true"]').getByTestId("project-crumb").first();
  await crumb().click();
  await page.getByTestId("project-new").click();
  await page.waitForFunction(() => { const m = location.hash.match(/project\/([^/]+)/); return !!m && !/^e2e-fixture/.test(m[1]); }, null, { timeout: 30000 });
  gid = await page.evaluate(() => (location.hash.match(/project\/([^/]+)/) || [])[1]);
  if (!gid || /^e2e-fixture/.test(gid)) { const bad = gid; gid = null; throw new Error(`new project did not open (hash group "${bad}") — refusing to touch the fixture`); }
  await crumb().click(); await page.getByTestId(`project-row-${gid}`).hover(); await page.getByTestId(`project-kebab-${gid}`).click(); await page.getByTestId("project-rename").click();
  const input = page.getByRole("textbox", { name: /^Rename / }); await input.fill(PROJ); await input.press("Enter");
  ok("0 throwaway project has a cloud row", !!(await waitFor(async () => (await dbRows()).length >= 1, 60000)), gid);

  /* ---- give plan 1 real content (a blank, unlocated plan is dropped when left), then make 8 more plans by Duplicate ---- */
  const box = await page.getByTestId("planner-canvas").boundingBox();
  await page.keyboard.press("l");
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.8); await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.8, { steps: 6 }); await page.mouse.up();
  await page.keyboard.press("v").catch(() => {});
  await sleep(1500);
  for (let i = 0; i < 8; i++) {
    const before = (await dbRows()).length;
    await openMenu(); await page.getByTestId("plan-duplicate").click();
    await waitFor(async () => (await dbRows()).length > before, 40000, 800);
    await page.getByTestId("plan-crumb").waitFor({ state: "visible" }); await sleep(900);
    if (await page.getByTestId("plan-footer").isVisible().catch(() => false)) await closeMenu();
  }
  const planCount = (await dbRows()).filter((r) => !r.deleted_at).length;
  ok("setup: the throwaway project has 9 live plans", planCount === 9, `${planCount}`);
  await openProject(gid);

  /* ---- 1 · the menu ---- */
  await openMenu();
  const cur = (await page.getByTestId("plan-current-name").innerText()).trim();
  ok("1a the current plan is one highlighted row on top", (await page.getByTestId("plan-current-row").count()) === 1 && (await page.getByTestId("plan-current-row").innerText()).includes("current"), cur);
  const listNames = async () => (await page.getByTestId("plan-list-scroll").locator('[data-testid^="plan-open-"]').allInnerTexts()).map((t) => t.trim());
  const others = await listNames();
  ok("1b the other 8 plans are the list; the current plan is not repeated in it", others.length === 8 && !others.includes(cur), `${others.length}`);
  ok("1c a ⋯ on every row, always visible", (await page.locator('[data-testid^="plan-more-"]').count()) === 9 && (await page.locator('[data-testid^="plan-more-"]').evaluateAll((els) => els.every((e) => e.getBoundingClientRect().width > 0))));
  ok("1d NO ✕ delete button, no Plan name field, no Save now / This device / Storage row", (await page.locator('button[aria-label^="Delete plan "]').count()) === 0 && (await page.getByTestId("plan-name-input").count()) === 0 && (await page.getByText(/^(Save now|This device|Storage on this device…|Plans in this site|Plan name)$/).count()) === 0);
  ok("1e Find shows at 8+ plans and filters; no match says 'No plan by that name.'", await (async () => {
    const f = page.getByTestId("plan-find"); if (!(await f.count())) return false;
    await f.fill("(copy) (copy) (copy)"); const some = (await listNames()).length; await f.fill("zzzz-none"); const none = await page.getByTestId("plan-find-empty").innerText().catch(() => ""); await f.fill("");
    return some > 0 && some < 8 && none === "No plan by that name.";
  })());
  await page.screenshot({ path: OUT + "plan-menu-01-open-light.png" });

  /* ---- 2 · the one ⋯ menu ---- */
  const firstOtherId = await page.getByTestId("plan-list-scroll").locator('[data-testid^="plan-open-"]').first().getAttribute("data-testid").then((t) => t.replace("plan-open-", ""));
  await page.getByTestId(`plan-more-${firstOtherId}`).click();
  const viaMore = await ctxItems();
  await page.screenshot({ path: OUT + "plan-menu-02-more-menu.png" });
  await page.keyboard.press("Escape"); await sleep(250);
  await openMenu();
  await page.getByTestId(`plan-row-${firstOtherId}`).click({ button: "right" });
  const viaRight = await ctxItems();
  ok("2a ⋯ and right-click open the SAME items: Rename · Duplicate · Delete plan", JSON.stringify(viaMore) === JSON.stringify(viaRight) && JSON.stringify(viaMore) === JSON.stringify(["Rename", "Duplicate", "Delete plan"]), JSON.stringify([viaMore, viaRight]));
  const geo = await page.evaluate(() => {
    const items = [...document.querySelectorAll('[data-testid^="plan-ctx-"]')].map((e) => e.getBoundingClientRect());
    const del = document.querySelector('[data-testid="plan-ctx-delete"]'), ren = document.querySelector('[data-testid="plan-ctx-rename"]');
    return { heights: [...new Set(items.map((r) => Math.round(r.height * 10) / 10))], gaps: [...new Set(items.slice(1).map((r, i) => Math.round((r.top - items[i].bottom) * 10) / 10))], sep: document.querySelectorAll('[data-testid="plan-ctx"] [role="separator"], [data-testid="plan-ctx"] hr').length, red: getComputedStyle(del).color !== getComputedStyle(ren).color, inView: items.every((r) => r.bottom <= innerHeight && r.right <= innerWidth && r.left >= 0) };
  });
  ok("2b every row the same height, the same gap, no divider, Delete plan red, menu inside the window", geo.heights.length === 1 && geo.gaps.length === 1 && geo.sep === 0 && geo.red && geo.inView, JSON.stringify(geo));
  await page.keyboard.press("Escape"); await sleep(250);

  /* ---- 3 · rename ANOTHER plan in place ---- */
  await openMenu();
  await page.getByTestId(`plan-more-${firstOtherId}`).click(); await page.getByTestId("plan-ctx-rename").click();
  const rn = page.getByTestId("plan-rename-input"); await rn.fill(LONG); await rn.press("Enter");
  ok("3a the cloud row carries the new name", !!(await waitFor(async () => (await dbRows()).some((r) => r.id === firstOtherId && r.name === LONG), 30000)), LONG);
  ok("3b the row reads the new name, on ONE line", await (async () => { const b = page.getByTestId(`plan-open-${firstOtherId}`); const h = await b.evaluate((el) => el.getBoundingClientRect().height); const lh = await b.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight)); return (await b.innerText()).trim() === LONG && h < lh * 1.6 + 16; })());
  await page.getByTestId(`plan-more-${firstOtherId}`).click(); await page.getByTestId("plan-ctx-rename").click();
  await page.getByTestId("plan-rename-input").fill("   "); await page.getByTestId("plan-rename-input").press("Enter"); await sleep(1200);
  ok("3c an EMPTY name is refused and the old name stays", (await dbRows()).some((r) => r.id === firstOtherId && r.name === LONG) && (await page.getByTestId(`plan-open-${firstOtherId}`).innerText()).trim() === LONG);

  /* ---- 4 · delete → Recently deleted → restore / delete forever ---- */
  const ids = await page.getByTestId("plan-list-scroll").locator('[data-testid^="plan-open-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid").replace("plan-open-", "")));
  const [delA, delB] = ids.filter((i) => i !== firstOtherId).slice(0, 2);
  for (const id of [delA, delB]) {
    await openMenu();
    await page.getByTestId(`plan-more-${id}`).click(); await page.getByTestId("plan-ctx-delete").click();
    ok(`4a inline confirm names where it goes (${id.slice(0, 6)})`, /Recently deleted/.test(await page.getByTestId(`plan-delete-confirm-${id}`).innerText()));
    await page.getByTestId("plan-delete-go").click();
    await waitFor(async () => (await dbRows()).some((r) => r.id === id && r.deleted_at), 30000);
    await sleep(800);
  }
  ok("4b both plans are soft-deleted in the cloud", (await dbRows()).filter((r) => [delA, delB].includes(r.id) && r.deleted_at).length === 2);
  await openProject(gid); await openMenu();
  const toggle = page.getByTestId("plan-bin-toggle");
  await toggle.waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
  ok("4c a 'Recently deleted (2)' row shows in the footer", /Recently deleted \(2\)/.test(await toggle.innerText().catch(() => "")), await toggle.innerText().catch(() => ""));
  await toggle.click();
  const lines = await page.locator('[data-testid="deleted-at"]').allInnerTexts();
  ok("4d each deleted entry has an exact 'Deleted <date>, <time>' line, newest first", lines.length === 2 && lines.every((l) => /^Deleted [A-Z][a-z]{2} \d{1,2}(, \d{4})?, \d{1,2}:\d{2} [AP]M$/.test(l)), JSON.stringify(lines));
  ok("4e no old '2w ago' text; Delete forever is not next to Restore", (await page.getByText(/\d+[mhdw] ago/).count()) === 0 && (await page.getByTestId("plan-bin-scroll").getByRole("button", { name: /forever/i }).count()) === 0);
  await page.screenshot({ path: OUT + "plan-menu-03-recently-deleted.png" });
  // Restore one
  const restoreId = await page.locator('[data-testid="plan-bin-scroll"] [data-deleted-id]').first().getAttribute("data-deleted-id");
  const purgeId = restoreId === delA ? delB : delA;
  await page.getByTestId(`deleted-restore-${restoreId}`).click();
  ok("4f Restore: the cloud row is live again", !!(await waitFor(async () => (await dbRows()).some((r) => r.id === restoreId && !r.deleted_at), 30000)));
  // Delete forever the other via its ⋯
  await openMenu();
  if (!(await page.getByTestId("plan-bin-back").isVisible().catch(() => false))) await page.getByTestId("plan-bin-toggle").click();
  await page.getByTestId(`deleted-more-${purgeId}`).click(); await page.getByTestId("deleted-ctx-purge").click();
  const conf = await page.getByTestId(`deleted-purge-confirm-${purgeId}`).innerText();
  ok("4g Delete forever asks first, in the plan's own words: 'No restore after this.'", /No restore after this\./.test(conf), conf);
  ok("4h …and nothing is deleted before the confirm", (await dbRows()).some((r) => r.id === purgeId));
  await page.getByTestId("deleted-purge-go").click();
  ok("4i Delete forever removes the cloud row for good", !!(await waitFor(async () => !(await dbRows()).some((r) => r.id === purgeId), 30000)));
  ok("4j the bin emptied and the menu went back to the plan list", !!(await waitFor(async () => (await page.getByTestId("plan-footer").isVisible().catch(() => false)) && (await page.getByTestId("plan-bin-toggle").count()) === 0, 15000)));
  ok("4k the restored plan is back in the list", (await page.getByTestId(`plan-open-${restoreId}`).count()) === 1);

  /* ---- 5 · short window, phone width, dark theme ---- */
  await closeMenu();
  await page.setViewportSize({ width: 1280, height: 440 }); await sleep(400); await openMenu();
  const sc = page.getByTestId("plan-list-scroll");
  await sc.evaluate((el) => { el.scrollTop = el.scrollHeight; }); await sleep(250);
  const fb = await page.getByTestId("plan-version-history").boundingBox();
  const sm = await sc.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
  ok("5a SHORT window: the list scrolls and the footer stays in view", sm.sh > sm.ch + 4 && fb && fb.y + fb.height <= 440, JSON.stringify({ ...sm, fb: fb && fb.y + fb.height }));
  await closeMenu();
  await page.setViewportSize({ width: 390, height: 780 }); await sleep(400); await openMenu();
  const pr = await page.getByTestId("plan-footer").evaluate((f) => { const r = f.parentElement.getBoundingClientRect(); return { l: r.left, r: r.right }; });
  ok("5b PHONE width: the menu fits the screen and every ⋯ is visible", pr.l >= 0 && pr.r <= 390 && (await page.locator('[data-testid^="plan-more-"]').first().isVisible()), JSON.stringify(pr));
  await page.screenshot({ path: OUT + "plan-menu-04-phone.png" });
  await closeMenu();
  await page.setViewportSize({ width: 1440, height: 900 }); await page.emulateMedia({ colorScheme: "dark" }); await sleep(600); await openMenu();
  await page.screenshot({ path: OUT + "plan-menu-05-open-dark.png" });
  await page.getByTestId(`plan-more-${firstOtherId}`).click(); await page.screenshot({ path: OUT + "plan-menu-06-more-dark.png" });
  await page.keyboard.press("Escape"); await closeMenu(); await page.emulateMedia({ colorScheme: "light" });
  const build1 = await buildNow();
  ok("served build unchanged across the run (re-read in the same call as the last assertion)", build0 === build1, `${build0} ${build1}`);
} catch (e) {
  ok("run completed", false, String((e && e.stack) || e).slice(0, 400));
  await page.screenshot({ path: OUT + "plan-menu-abort.png" }).catch(() => {});
} finally {
  /* ---- 6 · cleanup: the throwaway project's rows are trashed, then removed, and the count left is READ BACK ---- */
  try {
    if (gid && !/^e2e-fixture/.test(gid)) {
      const left = await page.evaluate(async (g) => {
        const c = window.pfSupabase;
        const rows = ((await c.from("sites").select("id,site,group_id").eq("group_id", g)).data || []).filter((r) => /^zz-planmenu-check-/.test(r.site || "") || r.group_id === g);
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
