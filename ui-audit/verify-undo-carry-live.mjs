/* verify-undo-carry-live — NEW-1 (2026-11-13, owner: "Do I lose the ability to do the control Z whenever I get out of the page?").
 * Driven LIVE and SIGNED IN as the throwaway test account on a THROWAWAY project made for this run (never a real project, never the
 * standing `e2e-fixture` group), then deleted and read back (constraint #15).
 *
 *   E2E_LOGIN_KEY=… EXPECT_SHA=<merge sha7> node ui-audit/verify-undo-carry-live.mjs [https://planyr.io]
 *
 *   1  edit (two lines) on plan A → switch to plan B → back to A → Ctrl+Z removes the second line, again removes the first
 *   2  plan B's own history is B's: Ctrl+Z on A never changes B (read off B's canvas), and B can undo its own edit
 *   3  edit → reload → Ctrl+Z reverts the most recent step (the IndexedDB tail, real planyr.io origin)
 *   4  STALE GUARD: change plan A in the CLOUD (a second client's write: a markup row pushed through Supabase) while its history is
 *      held → reopen A → the cloud copy wins and Ctrl+Z does not replay the old steps over it
 * KNOWN-GOOD ARMS: the run is VOID unless signed in as the test account AND the served build (read from /version.json in the same
 * call) contains EXPECT_SHA; arm 1 is the positive control for arm 4 (the same sequence with nothing in the way DOES undo).
 */
import { execSync } from "node:child_process";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const BASE = (process.argv.find((a) => /^https?:/.test(a)) || "https://planyr.io").replace(/\/$/, "");
const EXPECT_SHA = process.env.EXPECT_SHA || "";
const stamp = Date.now().toString(36);
const PROJ = `zz-undo-carry-${stamp}`;
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + String(extra).slice(0, 260) : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const s = await openSignedIn({ base: BASE });
const { page } = s;
let gid = null;
const waitFor = async (fn, ms = 30000, step = 400) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await sleep(step); } };
const buildNow = async () => (await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()))).build;
const lines = () => page.evaluate(() => new Set(Array.from(document.querySelectorAll('[data-feature^="markup:"]')).map((n) => n.getAttribute("data-feature"))).size);
const waitLines = (n, ms = 20000) => waitFor(async () => (await lines()) === n, ms);
const canvasBox = () => page.getByTestId("planner-canvas").boundingBox();

async function drawLine(yFrac) {
  const box = await canvasBox();
  await page.keyboard.press("l");
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * yFrac); await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * yFrac, { steps: 6 }); await page.mouse.up();
  await page.getByRole("button", { name: /^Select V$/ }).click().catch(() => {});
}
const undo = async () => { await page.getByRole("button", { name: /^Select V$/ }).click().catch(() => {}); await page.keyboard.press("Control+z"); await sleep(400); };
const crumb = () => page.getByTestId("plan-crumb");
async function openPlanMenu() { await crumb().click(); await page.getByTestId("plan-footer").waitFor({ state: "visible", timeout: 10000 }); }
async function switchToPlan(planId) {
  await openPlanMenu();
  await page.getByTestId(`plan-open-${planId}`).click();
  await page.waitForFunction((id) => document.querySelector('[data-testid="plan-crumb"]') && location.hash.includes(id) || true, planId, { timeout: 5000 }).catch(() => {});
  await page.getByTestId("planner-canvas").waitFor({ state: "visible", timeout: 30000 });
  await sleep(900);
}
const planIds = async () => (await page.evaluate(async (g) => ((await window.pfSupabase.from("sites").select("id,deleted_at").eq("group_id", g)).data || []).filter((r) => !r.deleted_at).map((r) => r.id), gid));
const currentPlanId = async () => { await openPlanMenu(); const id = await page.getByTestId("plan-current-row").getAttribute("data-plan-id"); await crumb().click(); return id; };

try {
  await assertMeasurable(page, "verify-undo-carry-live");
  const build0 = await buildNow();
  const containsMerge = (b) => { if (!EXPECT_SHA) return true; if (String(b).startsWith(EXPECT_SHA.slice(0, 7))) return true; try { execSync(`git merge-base --is-ancestor ${EXPECT_SHA} ${b}`, { stdio: "ignore" }); return true; } catch { return false; } };
  ok("KNOWN-GOOD: served build contains the merge commit (read in this call)", containsMerge(build0), `build=${build0} expect=${EXPECT_SHA || "(unset)"}`);
  ok("KNOWN-GOOD: signed in as the test account", s.proof.email === "e2e@planyr.test" && s.proof.fixtureVisible, JSON.stringify(s.proof));

  /* ---- throwaway project (same recipe as verify-rename-instant-live) ---- */
  await page.goto(`${BASE}/#/project/e2e-fixture`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("planner-canvas").waitFor({ state: "visible", timeout: 30000 });
  const pcrumb = () => page.locator('[data-mode-active="true"]').getByTestId("project-crumb").first();
  await pcrumb().click();
  await page.getByTestId("project-new").click();
  await page.waitForFunction(() => { const m = location.hash.match(/project\/([^/]+)/); return !!m && !/^e2e-fixture/.test(m[1]); }, null, { timeout: 30000 });
  gid = await page.evaluate(() => (location.hash.match(/project\/([^/]+)/) || [])[1]);
  if (!gid || /^e2e-fixture/.test(gid)) { const bad = gid; gid = null; throw new Error(`new project did not open (hash group "${bad}") — refusing to touch the fixture`); }
  await pcrumb().click(); await page.getByTestId(`project-row-${gid}`).hover(); await page.getByTestId(`project-kebab-${gid}`).click(); await page.getByTestId("project-rename").click();
  const first = page.getByRole("textbox", { name: /^Rename / }); await first.fill(PROJ); await first.press("Enter");
  ok("0 throwaway project exists in the cloud", !!(await waitFor(async () => (await planIds()).length >= 1, 60000)), gid);

  /* plan A: one line, then Duplicate → plan B (a copy, so it exists as a real second plan with the same content) */
  await drawLine(0.80); await waitLines(1);
  await sleep(1500);
  const idA = await currentPlanId();
  await openPlanMenu(); await page.getByTestId("plan-duplicate").click();
  await waitFor(async () => (await planIds()).length >= 2, 40000, 800);
  await sleep(1500);
  const idB = await currentPlanId();
  ok("setup: two plans, and the copy is now current", !!idA && !!idB && idA !== idB, `A=${idA} B=${idB}`);
  await waitLines(1);

  /* B (current): one more line of its own so B has history that A does not */
  await drawLine(0.30); await waitLines(2); await sleep(1500);

  /* ---- 1 · A: two edits, leave, come back ---- */
  await switchToPlan(idA);
  await waitLines(1);
  await drawLine(0.55); await waitLines(2); await sleep(500);
  await drawLine(0.40); await waitLines(3); await sleep(1800);
  await switchToPlan(idB);
  await waitLines(2);
  await switchToPlan(idA);
  await waitLines(3);
  await undo();
  ok("1 Ctrl+Z after switching away and back removes the last line (3 → 2)", await waitLines(2, 8000));
  await undo();
  ok("1 …and the one before it (2 → 1)", await waitLines(1, 8000));
  await page.keyboard.press("Control+Shift+z"); await sleep(400); await page.keyboard.press("Control+Shift+z"); await sleep(400);
  ok("1 redo walks forward again (1 → 3)", await waitLines(3, 8000));

  /* ---- 2 · B is untouched by A's presses, and has its own ---- */
  await switchToPlan(idB);
  ok("2 plan B still holds exactly its own two lines after A was undone", await waitLines(2, 8000), `lines=${await lines()}`);
  await undo();
  ok("2 B's own carried history works on B (2 → 1)", await waitLines(1, 8000));
  await page.keyboard.press("Control+Shift+z"); await sleep(500);
  await waitLines(2, 8000);
  await sleep(2500);

  /* ---- 3 · reload ---- */
  await switchToPlan(idA); await waitLines(3);
  await sleep(2600);                       // plan autosave + the settled history tail
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("planner-canvas").waitFor({ state: "visible", timeout: 40000 });
  await waitLines(3, 30000);
  await sleep(1500);
  await undo();
  ok("3 after a reload, Ctrl+Z reverts the most recent step (3 → 2)", await waitLines(2, 8000), `lines=${await lines()}`);
  await page.keyboard.press("Control+Shift+z"); await sleep(500); await waitLines(3, 8000);

  /* ---- 4 · stale guard: the plan is changed in the CLOUD behind the carried history ---- */
  await switchToPlan(idB);                 // A's history is stashed
  await sleep(1500);
  const newer = await page.evaluate(async (id) => {
    const c = window.pfSupabase;
    const { data } = await c.from("site_elements").select("*").eq("site_id", id).limit(1);
    return { sample: data && data[0] ? Object.keys(data[0]) : null };
  }, idA);
  // A second client's edit, made the way the product does it: A's own element rows. Delete one line row server-side (a soft tombstone)
  // — the plan A then differs from what the carried history was saved against.
  const changed = await page.evaluate(async (id) => {
    const c = window.pfSupabase;
    const { data } = await c.from("site_elements").select("id,kind,deleted_at").eq("site_id", id).is("deleted_at", null).eq("kind", "markup").limit(1);
    if (!data || !data[0]) return { ok: false, why: "no markup row" };
    const r = await c.from("site_elements").update({ deleted_at: new Date().toISOString() }).eq("id", data[0].id);
    return { ok: !r.error, err: r.error && r.error.message, rowId: data[0].id };
  }, idA);
  ok("4 setup: plan A was changed behind the carried history (a markup row removed in the cloud)", changed.ok, JSON.stringify({ ...changed, newer }));
  if (changed.ok) {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("planner-canvas").waitFor({ state: "visible", timeout: 40000 });
    await switchToPlan(idA);
    await sleep(2500);
    const before = await lines();
    await undo(); await undo();
    ok("4 Ctrl+Z on the changed plan does not replay the old steps over the newer work", (await lines()) === before, `before=${before} after=${await lines()}`);
  }
} catch (e) {
  ok("harness ran to completion", false, String(e && e.stack || e).slice(0, 400));
} finally {
  /* ---- cleanup: the throwaway project's rows are removed, and the count left is READ BACK ---- */
  try {
    if (gid && !/^e2e-fixture/.test(gid)) {
      const left = await page.evaluate(async (g) => {
        const c = window.pfSupabase;
        const rows = ((await c.from("sites").select("id,site,group_id").eq("group_id", g)).data || []);
        const ids = rows.filter((r) => !/^e2e-fixture/.test(r.id) && !/^e2e-fixture/.test(r.group_id)).map((r) => r.id);
        if (ids.length) { await c.from("sites").update({ deleted_at: new Date().toISOString() }).in("id", ids); await c.from("sites").delete().in("id", ids); }
        return ((await c.from("sites").select("id").eq("group_id", g)).data || []).length;
      }, gid);
      ok("cleanup: no row of the throwaway project is left (read back)", left === 0, `${left} left`);
    }
  } catch (e) { ok("cleanup ran", false, String(e.message || e).slice(0, 200)); }
  await s.close().catch(() => {});
}
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
