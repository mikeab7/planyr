/* diagnose-grading-boundary-live — B2500224 ×2 (round 9): render the owner's Concept A (2026-10-30 rows) on the REAL
 * deployed planner, "To the boundary", contours + cut/fill + paper on, and save the whole-site, NE-corner and SW-corner
 * pictures — a THROWAWAY copy written to the test account (deleted and verified gone at the end, constraint #15). Grading
 * is owner-only: is_admin is answered `true` inside THIS headless browser only (Playwright route), exactly as
 * diagnose-grading-freeze-live does — nothing in the product or the database changes.
 *   node ui-audit/diagnose-grading-boundary-live.mjs [--base https://planyr.io] [--mode boundary|layout] [--out dir] */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { CHEHAW_CONCEPT_A_ROWS } from "./lib/chehawCrossDock.mjs";
import { mkdirSync } from "node:fs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const base = arg("--base", "https://planyr.io");
const mode = arg("--mode", "boundary");
const SWITCH = arg("--switch", null);   // open in --mode, then switch to this mode through the panel (the owner's path)
const OUT = arg("--out", new URL("./screenshots/grading/live/", import.meta.url).pathname);
mkdirSync(OUT, { recursive: true });
const RUN = Math.random().toString(36).slice(2, 6);
const PARCEL = [[687.46,-1170.96],[676.36,-745.72],[889.65,-744.71],[867,290.42],[867.07,907.41],[856.07,932.9],[652.84,1084.61],[537.47,1167.6],[492.56,1157.05],[466.6,1137.62],[435.11,1133.74],[411.91,1150.39],[399.2,1139.84],[397.55,1112.09],[406.39,1095.99],[412.47,1073.79],[404.73,1058.25],[331.81,1087.11],[327.94,1102.09],[355.01,1113.75],[363.85,1134.84],[325.73,1164.26],[301.42,1170.92],[252.81,1158.15],[228.5,1143.16],[179.34,1119.85],[174.92,1105.97],[163.32,1090.43],[140.11,1095.43],[145.64,1127.06],[137.35,1142.6],[126.3,1137.05],[119.67,1106.53],[60.57,1043.81],[79.9,1004.95],[44.55,992.74],[4.22,1039.92],[-7.94,1021.05],[-10.7,959.99],[-40.53,899.49],[-97.6,818.7],[-110.54,788.34],[-140.75,757.99],[-177.01,757.12],[-219.3,728.5],[-265.05,716.36],[-291.81,679.06],[-344.47,675.59],[-365.18,646.11],[-396.26,635.7],[-448.91,620.09],[-489.48,583.66],[-593.93,536.83],[-635.36,530.76],[-687.15,486.53],[-735.76,467.34],[-733.8,431.65],[-718.06,330.64],[-702.07,278.07],[-673.35,202.28],[-654.12,145.19],[-642.38,105.04],[-633.13,62.5],[-625.14,7.42],[-623.64,-44.4],[-625.14,-68.74],[-636.63,-137.88],[-714.56,-405.78],[-766.76,-615.95],[-780.75,-675.93],[-838.45,-956],[-872.17,-1107.96],[-889.65,-1168.31],[-177.77,-1167.55],[643.52,-1170.79]].map(([x, y]) => ({ x, y }));
const id = `zz-grbound-${RUN}`;
const SITE = {
  id, groupId: id, site: `zz grading boundary ${RUN}`, name: "Concept A copy", origin: { lat: 33.2458963792457, lon: -84.16362918465775 }, county: "ga_spalding",
  parcels: [{ id: "pc1", active: true, locked: false, points: PARCEL }],
  els: CHEHAW_CONCEPT_A_ROWS.map((e, i) => ({ ...e, z: i * 1024 })), measures: [], callouts: [], markups: [],
  settings: { setback: 25, showSetback: true, truckCourtD: 135, trailerParkD: 50, grading: { enabled: true, limitMode: mode, layers: { buildable: false, cutfill: true, contours: true, paper: true } } },
  underlay: null, updatedAt: Date.now(), status: "active",
};
const s = await openSignedIn({ base, viewport: { width: 1600, height: 1000 } });
if (arg("--cpu", null)) { const c = await s.context.newCDPSession(s.page); await c.send("Emulation.setCPUThrottlingRate", { rate: +arg("--cpu", "1") }); }
const { page, context } = s;
try {
  await assertMeasurable(page, "diagnose-grading-boundary-live");
  const served = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).then((j) => j.build).catch(() => null));
  console.log("signed in as", s.proof.email, "| served build", served, "| run", RUN);
  const err = await page.evaluate(async (site) => {
    const { data: u } = await window.pfSupabase.auth.getUser();
    const r = await window.pfSupabase.from("sites").insert({ id: site.id, group_id: site.groupId, site: site.site, name: site.name, county: site.county, updated_at: new Date().toISOString(), data: site, user_id: u.user.id });
    return r.error ? String(r.error.message) : null;
  }, SITE);
  if (err) throw new Error("insert failed: " + err);
  await context.route(/\/rest\/v1\/rpc\/is_admin/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: "true" }));
  await page.goto(`${base}/#/project/${id}/site`, { waitUntil: "load" });
  await page.reload({ waitUntil: "load" });
  await page.getByTestId("planner-canvas").waitFor({ timeout: 60000 });
  await page.waitForSelector('[data-layer="contours"] path', { state: "attached", timeout: 400000 });
  await page.waitForSelector("[data-band-tint]", { state: "attached", timeout: 400000 });
  await page.waitForTimeout(4000);
  let tag0 = mode;
  if (SWITCH) {
    await page.locator('button[title="Grading"]').click({ timeout: 30000 }).catch(async () => { await page.getByText("Grading", { exact: true }).first().click(); });
    await page.waitForSelector('[data-testid="grading-limit-mode"]', { timeout: 60000 });
    await page.locator('[data-testid="grading-limit-mode"]').getByText(SWITCH === "boundary" ? "To the boundary" : "Around the layout").click();
    await page.waitForFunction((m) => { const e = document.querySelector("[data-graded-area]"); return e && e.getAttribute("data-limit-mode") === m; }, SWITCH, { timeout: 120000 });
    // what is painted the moment the panel names the new mode: the band / contours' own surface keys vs the surface's
    const snap = () => page.evaluate(() => ({ mode: document.querySelector("[data-graded-area]")?.getAttribute("data-limit-mode"),
      bandSource: document.querySelector("[data-layer=cutfill]")?.getAttribute("data-band-source"), stale: document.querySelector("[data-layer=cutfill]")?.getAttribute("data-band-stale") }));
    console.log("at switch:", JSON.stringify(await snap()));
    await page.screenshot({ path: `${OUT}${mode}-to-${SWITCH}-at-switch.png` });
    await page.waitForTimeout(+arg("--wait", "15000"));
    tag0 = `${mode}-to-${SWITCH}`;
  }
  await page.screenshot({ path: `${OUT}${tag0}-site.png` });
  const info = await page.evaluate(() => ({
    limitD: (document.querySelector("[data-grading-limit] path") || {}).getAttribute?.("d")?.slice(0, 120),
    daylight: !!document.querySelector("[data-daylight-line]"), inner: !!document.querySelector("[data-band-inner]"),
    graded: (document.body.innerText.match(/Graded area[^\n]*/) || [""])[0],
  }));
  console.log(JSON.stringify(info));
  // zoom toward the building's NE corner (top-right of its box) and its SW corner, a few wheel notches each
  const box = await page.locator('[data-el-id="e331olvzwe"]').first().boundingBox();
  for (const [tag, px, py] of [["ne", box.x + box.width, box.y], ["sw", box.x, box.y + box.height]]) {
    await page.mouse.move(px, py);
    for (let k = 0; k < 7; k++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(150); }
    await page.waitForTimeout(3500);
    await page.screenshot({ path: `${OUT}${tag0}-${tag}.png` });
    for (let k = 0; k < 7; k++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(150); }
    await page.waitForTimeout(1500);
  }
  console.log("saved under", OUT);
} finally {
  try {
    await page.goto(`${base}/#/`, { waitUntil: "load" }); await page.waitForTimeout(2000);
    const left = await page.evaluate(async (id) => {
      await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id);
      await window.pfSupabase.from("sites").delete().eq("id", id);
      const q = await window.pfSupabase.from("sites").select("id").eq("id", id);
      for (const k of Object.keys(localStorage)) { const v = localStorage.getItem(k) || ""; if (v.includes(id)) localStorage.removeItem(k); }
      return q.error ? "err:" + q.error.message : (q.data || []).length;
    }, id);
    console.log("cleanup: throwaway sites left in the cloud =", left);
  } catch (e) { console.log("cleanup FAILED", String(e).slice(0, 200)); }
  await s.close().catch(() => {});
}
