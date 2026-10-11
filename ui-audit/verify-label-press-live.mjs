/* B2249169 / B2249168 — LIVE signed-in check: a press that starts on a building's label drags the building,
 * and the label carries no bump-out wording. Drives a THROWAWAY plan (never a real one) on planyr.io as the
 * test account, reads /version.json in the SAME call as the assertions, and DELETES the throwaway site (cloud
 * row cascades its elements) before exiting — verified gone (owner constraint 15).
 *   E2E_LOGIN_KEY=… node ui-audit/verify-label-press-live.mjs [https://planyr.io] [expectedBuildPrefix]
 */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const base = process.argv[2] || "https://planyr.io";
const want = process.argv[3] || "";
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} — ${name}${detail ? "  ::  " + detail : ""}`); };

const s = await openSignedIn({ base });
const { page } = s;
let gid = null;
try {
  await assertMeasurable(page, "verify-label-press-live");
  // A throwaway project made through the app itself (lazy: no cloud row until the first real write), then a
  // building drawn with the real Building tool — never a real plan of the owner's.
  await page.goto(`${base}/#/project/e2e-fixture/site`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="planner-canvas"]').waitFor({ state: "visible", timeout: 60000 });
  await page.locator('[data-mode-active="true"]').getByTestId("project-crumb").first().click();
  await page.getByTestId("project-new").click();
  await page.waitForFunction(() => { const m = location.hash.match(/project\/([^/]+)/); return m && !/^e2e-fixture/.test(m[1]); }, null, { timeout: 30000 });
  await page.locator('[data-testid="planner-canvas"]:visible').waitFor({ timeout: 30000 });
  // Only a project THIS run created is ever assigned to `gid` (and so ever cleaned up) — never a fixture.
  gid = await page.evaluate(() => (location.hash.match(/project\/([^/]+)/) || [])[1]);
  if (!gid || /^e2e-fixture/.test(gid)) { gid = null; throw new Error("could not open a throwaway project"); }
  const box = await page.locator('[data-testid="planner-canvas"]:visible').boundingBox();
  await page.getByRole("button", { name: /^Building/ }).first().click();
  await page.mouse.move(box.x + 300, box.y + 220); await page.mouse.down();
  await page.mouse.move(box.x + 420, box.y + 260, { steps: 6 }); await page.mouse.move(box.x + 560, box.y + 330, { steps: 6 });
  await page.mouse.up(); await page.keyboard.press("Escape"); await page.waitForTimeout(2500);
  // The building's on-screen box (the view does not change during a drag, so a move shows as a box shift).
  // el-tier: the subject is the one BUILDING this run drew (an element, found by its own label), not a count of
  // plan contents — nothing here asserts "how many features are on the plan".
  const stored = () => page.evaluate(() => {
    for (const g of document.querySelectorAll("[data-el-id]")) {
      const id = g.getAttribute("data-el-id");
      if (!document.querySelector(`[data-label-for="${id}"]`)) continue;
      const r = g.getBoundingClientRect();
      return { id, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    }
    return null;
  });
  const labelPt = (id) => page.evaluate((i) => {
    const t = document.querySelector(`[data-label-for="${i}"] text`); if (!t) return null;
    const r = t.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, id);
  const moved = (a, b) => Math.hypot(b.cx - a.cx, b.cy - a.cy);

  const b0 = await stored();
  if (!b0) throw new Error("VOID: the drawn building is not in the plan — the instrument cannot judge the label");
  const lp0 = await labelPt(b0.id);
  check("known-good: the drawn building's label is on the canvas and shows SF", !!lp0 && /SF/.test(await page.locator(`[data-label-for="${b0.id}"]`).first().textContent()));
  check("NEW-1: no label on the plan has bump-out wording", !(await page.locator("[data-label-for]").allTextContents()).some((t) => /bump|incl/i.test(t)));
  await page.keyboard.press("Escape");
  const lp = await labelPt(b0.id);
  await page.mouse.move(lp.x, lp.y); await page.mouse.down();
  await page.mouse.move(lp.x - 25, lp.y + 15, { steps: 4 }); await page.mouse.move(lp.x - 50, lp.y + 30, { steps: 4 });
  await page.mouse.up(); await page.waitForTimeout(800);
  const b1 = await stored();
  check("NEW-2: a drag that starts on the label moves the building", !!b1 && moved(b0, b1) > 5, `moved ${b1 ? moved(b0, b1).toFixed(1) : "?"} screen units`);
  const build = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()));
  console.log("served build (same call as the assertions):", JSON.stringify(build));
  if (want) check(`served build matches ${want}`, String(build.build).startsWith(want), build.build);
} catch (e) { console.error("ERROR", e.message); results.push(false); }
finally {
  // CLEAN-UP (constraint 15): remove the throwaway plan locally and in the cloud, then prove it is gone.
  await page.waitForTimeout(1500);
  // Move the throwaway to the TRASH (what the app's own Delete does) and stop there — never hard-delete from a harness
  // (see verify-rename-signed-in.mjs: a hard-deleted row can be re-pushed by another browser's cache). Only a project this
  // run created (`gid`, never a fixture) is touched.
  const gone = gid ? await page.evaluate(async (g) => {
    const t = await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("group_id", g);
    const q = await window.pfSupabase.from("sites").select("id,deleted_at").eq("group_id", g);
    return { error: t.error ? String(t.error.message) : null, rows: (q.data || []).length, live: (q.data || []).filter((r) => !r.deleted_at).length };
  }, gid).catch((e) => ({ err: String(e) })) : { live: 0, note: "no project was created" };
  console.log("cleanup:", JSON.stringify(gone));
  if (gone.live !== 0) { results.push(false); console.log("FAIL — throwaway project not trashed"); }
  await s.close();
}
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
