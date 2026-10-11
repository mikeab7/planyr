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
const SITE_ID = "e2e-label-press-live";
const els = [
  { id: "bPlain", type: "building", cx: -900, cy: -500, w: 600, h: 300, rot: 0, dock: "cross", dockSide: "bottom", z: 0 },
  { id: "bBump", type: "building", cx: -900, cy: 400, w: 600, h: 300, rot: 0, dock: "cross", dockSide: "bottom", z: 1 },
  { id: "bBump-d1", type: "building", cx: -1227.5, cy: 580, w: 55, h: 60, rot: 0, dock: "none", noFit: true, noLabel: true, dogEar: { side: "bottom", sign: -1 }, attachedTo: "bBump", z: 2 },
  { id: "bBump-d2", type: "building", cx: -572.5, cy: 580, w: 55, h: 60, rot: 0, dock: "none", noFit: true, noLabel: true, dogEar: { side: "bottom", sign: 1 }, attachedTo: "bBump", z: 3 },
  { id: "bRot", type: "building", cx: 300, cy: -500, w: 600, h: 300, rot: 30, dock: "cross", dockSide: "bottom", z: 4 },
];
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} — ${name}${detail ? "  ::  " + detail : ""}`); };

const s = await openSignedIn({ base });
const { page } = s;
let exit = 0;
try {
  await assertMeasurable(page, "verify-label-press-live");
  const site = { id: SITE_ID, groupId: SITE_ID, site: "Label press live", name: "plan", origin: null, county: "harris", parcels: [], els, measures: [], callouts: [], markups: [], settings: { showAreas: true }, underlay: null, parcelDrawings: [], updatedAt: Date.now() };
  await page.evaluate(([id, rec]) => {
    const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    map[id] = rec; localStorage.setItem("planarfit:sites:v1", JSON.stringify(map));
    localStorage.setItem("planarfit:currentSite:v1", id);
  }, [SITE_ID, site]);
  await page.goto(`${base}/#/project/${SITE_ID}/site`, { waitUntil: "load" });
  await page.reload({ waitUntil: "load" });
  await page.getByTestId("planner-canvas").waitFor({ state: "visible", timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll("[data-el-id]").length > 3, null, { timeout: 30000 });
  await page.waitForTimeout(2500);

  const stored = (id) => page.evaluate((i) => {
    const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const e = ((map["e2e-label-press-live"] || {}).els || []).find((x) => x.id === i);
    return e ? { cx: e.cx, cy: e.cy } : null;
  }, id);
  const labelPt = (id) => page.evaluate((i) => {
    const t = document.querySelector(`[data-label-for="${i}"] text`); if (!t) return null;
    const r = t.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, id);
  const moved = (a, b) => Math.hypot(b.cx - a.cx, b.cy - a.cy);

  // Known-good arm: the label exists and the plan is the one we seeded.
  const txt = await page.locator('[data-label-for="bBump"]').first().textContent();
  check("known-good: the bump-out building's label is on the canvas and shows SF", /SF/.test(txt || ""), JSON.stringify(txt));
  check("NEW-1: label carries no bump-out wording", !/bump|incl/i.test(txt || ""));
  for (const t of await page.locator("[data-label-for]").allTextContents()) if (/bump-?out/i.test(t)) check("NEW-1: no label anywhere has bump-out wording", false, t);

  for (const id of ["bPlain", "bRot", "bBump"]) {
    await page.keyboard.press("Escape");
    const lp = await labelPt(id);
    if (!lp) { check(`${id}: label present`, false); continue; }
    const a = await stored(id);
    await page.mouse.move(lp.x, lp.y); await page.mouse.down();
    await page.mouse.move(lp.x - 25, lp.y + 15, { steps: 4 }); await page.mouse.move(lp.x - 50, lp.y + 30, { steps: 4 });
    await page.mouse.up(); await page.waitForTimeout(700);
    const b = await stored(id);
    check(`NEW-2: ${id} — drag starting on the label moves the building`, moved(a, b) > 5, `moved ${moved(a, b).toFixed(1)} ft`);
  }
  const build = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()));
  console.log("served build (same call as the assertions):", JSON.stringify(build));
  if (want) check(`served build matches ${want}`, String(build.build).startsWith(want), build.build);
} catch (e) { console.error("ERROR", e.message); results.push(false); }
finally {
  // CLEAN-UP (constraint 15): remove the throwaway plan locally and in the cloud, then prove it is gone.
  await page.waitForTimeout(1500);
  const gone = await page.evaluate(async (id) => {
    const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"); delete map[id];
    localStorage.setItem("planarfit:sites:v1", JSON.stringify(map));
    const del = await window.pfSupabase.from("sites").delete().eq("id", id);
    const q = await window.pfSupabase.from("sites").select("id").eq("id", id);
    return { delError: del.error ? String(del.error.message) : null, remaining: q.data ? q.data.length : "?", local: !!map[id] };
  }, SITE_ID).catch((e) => ({ err: String(e) }));
  console.log("cleanup:", JSON.stringify(gone));
  if (gone.remaining !== 0 || gone.local) { results.push(false); console.log("FAIL — throwaway plan not fully removed"); }
  await s.close();
}
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
