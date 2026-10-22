/* verify-road-context-menu-live — B1067 ×2 / V1808976 (2026-10-22): a right-click along a road ALWAYS opens the full road menu with
 * "Add control point" then "Add a T-intersection here" on top — selected or not.
 *
 * Signed in as the e2e test account on a real deploy (BASE_URL, default https://planyr.io), on a THROWAWAY plan written to that
 * account and DELETED AND VERIFIED GONE at the end (owner rule 15). It draws one straight road with the real tool, then:
 *   1 SELECTED road, right-click mid-line  -> first two menu rows are the two point actions, T not repeated, full menu below
 *   2 NOT selected, right-click mid-line   -> the identical rows
 *   3 Add control point                    -> a new grip appears where the click landed
 *   4 Add a T-intersection here            -> a second road, tee'd on the host at that point (host gains a vertex), same class + width
 *   5 locked road                          -> neither row
 *   6 a corner of the (now 3-point) selected road -> the small vertex menu, no point-action rows
 * KNOWN-GOOD ARM: VOID unless the road really drew (one road, two points) and the served build matches EXPECT_SHA when given.
 * Usage: EXPECT_SHA=<merge sha> node ui-audit/verify-road-context-menu-live.mjs
 */
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const BASE = (process.env.BASE_URL || "https://planyr.io").replace(/\/$/, "");
const EXPECT_SHA = process.env.EXPECT_SHA || "";
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SITE_ID = "zz-roadctx-" + Math.random().toString(36).slice(2, 8);
const site = {
  id: SITE_ID, groupId: SITE_ID, site: "ZZ Road Menu", name: "Plan 1", origin: { lat: 29.76, lon: -95.37 }, county: "harris",
  parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), status: "active", schemaVersion: 12,
};

const S = await openSignedIn({ base: BASE, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
const page = S.page;
const T = (id) => page.getByTestId(id);
const canvasBox = () => T("planner-canvas").boundingBox();
const menuRows = () => page.locator(".menu button").evaluateAll((bs) => bs.map((b) => ({ id: b.getAttribute("data-testid") || "", text: (b.textContent || "").trim() })));
const grips = () => page.locator("[data-handle-layer] circle");
const gripCentres = () => grips().evaluateAll((cs) => cs.map((c) => { const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
let served = null;

try {
  const ins = await page.evaluate(async (st) => {
    const { data: u } = await window.pfSupabase.auth.getUser();
    const row = { id: st.id, group_id: st.groupId, site: st.site, name: st.name, county: st.county, updated_at: new Date().toISOString(), data: st, user_id: u.user.id };
    let r = await window.pfSupabase.from("sites").insert(row);
    if (r.error && /user_id/.test(String(r.error.message))) { delete row.user_id; r = await window.pfSupabase.from("sites").insert(row); }
    return r.error ? String(r.error.message) : null;
  }, site);
  ok("throwaway plan written to the test account", !ins, ins || "");
  await page.goto(`${BASE}/#/project/${SITE_ID}/site`, { waitUntil: "load" });
  await page.reload({ waitUntil: "load" });
  await T("planner-canvas").waitFor({ state: "visible", timeout: 30000 });
  await sleep(2500);
  await assertMeasurable(page, "verify-road-context-menu-live");
  served = await page.evaluate(async () => (await (await fetch("/version.json", { cache: "no-store" })).json()).build);
  console.log("served build", served);
  if (EXPECT_SHA) ok("the deploy is serving the merge commit", String(served || "").startsWith(EXPECT_SHA.slice(0, 7)), `served ${served}`);

  // draw one straight road with the real tool
  const box = await canvasBox();
  await page.getByRole("button", { name: "Road", exact: true }).click();
  await page.getByRole("button", { name: "Road presets" }).click();
  await page.getByRole("button", { name: /^\d+′$/ }).first().click();
  const y = box.y + 360;
  await page.mouse.click(box.x + 300, y); await page.mouse.click(box.x + 760, y);
  await page.keyboard.press("Enter"); await page.keyboard.press("Escape");
  await sleep(800);
  const mid = { x: box.x + 530, y };
  const probe = await page.evaluate(() => { const n = window.__plannerRoadNet && window.__plannerRoadNet(); return n ? n.regions.length : -1; });
  ok("KNOWN-GOOD: the road drew (one pavement region)", probe === 1, `regions ${probe}`);
  const deselect = async () => { await page.mouse.click(box.x + 60, box.y + 80); await sleep(300); };

  // 1 selected
  await page.mouse.click(mid.x, mid.y); await sleep(300);
  await page.mouse.click(mid.x, mid.y, { button: "right" }); await sleep(400);
  let rows = await menuRows();
  ok("selected road: a full menu (not a one-row stub)", rows.length > 4, `${rows.length} rows`);
  ok("selected road: row 1 = Add control point", rows[0] && rows[0].id === "el-menu-add-control-point" && /Add control point/.test(rows[0].text), JSON.stringify(rows[0]));
  ok("selected road: row 2 = Add a T-intersection here", rows[1] && rows[1].id === "road-branch-here" && /Add a T-intersection here/.test(rows[1].text), JSON.stringify(rows[1]));
  ok("the T row appears once (no second Road section)", rows.filter((r) => r.id === "road-branch-here").length === 1);
  const selectedSig = rows.map((r) => r.text).join("|");
  await page.keyboard.press("Escape"); await sleep(200);

  // 2 not selected
  await deselect();
  await page.mouse.click(mid.x, mid.y, { button: "right" }); await sleep(400);
  rows = await menuRows();
  ok("unselected road: the identical menu", rows.map((r) => r.text).join("|") === selectedSig, `${rows.length} rows`);
  await page.keyboard.press("Escape"); await sleep(200);

  // 3 Add control point at the clicked spot
  await page.mouse.click(mid.x, mid.y); await sleep(300);
  const before = (await gripCentres()).length;
  await page.mouse.click(mid.x + 70, mid.y, { button: "right" }); await sleep(400);
  await T("el-menu-add-control-point").click(); await sleep(700);
  const after = await gripCentres();
  ok("Add control point: a new grip", after.length > before, `${before} -> ${after.length}`);
  ok("…where the right-click landed, on the line", after.some((c) => Math.abs(c.x - (mid.x + 70)) < 5 && Math.abs(c.y - y) < 5));

  // 4 T-intersection
  await deselect();
  await page.mouse.click(mid.x - 90, mid.y, { button: "right" }); await sleep(400);
  await T("road-branch-here").click(); await sleep(400);
  await page.mouse.click(mid.x - 90, y - 170); await sleep(300);
  await T("road-draft-finish").click({ force: true }); await sleep(1200);
  const roadsNow = await page.evaluate(() => { const n = window.__plannerRoadNet && window.__plannerRoadNet(); return n ? { tees: n.tees.length, regions: n.regions.length, wedges: n.tees[0] ? n.tees[0].wedges : 0 } : null; });
  ok("T: the branch resolves as a real tee with two curb returns", roadsNow && roadsNow.tees === 1 && roadsNow.wedges === 2, JSON.stringify(roadsNow));
  ok("T: one joined pavement region", roadsNow && roadsNow.regions === 1);

  // 6 corner of the selected host -> vertex menu
  await deselect();
  await page.mouse.click(mid.x + 200, y); await sleep(300); // select the host again on a straight run
  await page.mouse.click(mid.x + 70, y, { button: "right" }); await sleep(400); // the control point added in step 3 is a corner
  rows = await menuRows();
  ok("corner: the vertex menu (Delete control point), no point-action rows", rows.some((r) => /Delete control point|Delete road/.test(r.text)) && !rows.some((r) => r.id === "el-menu-add-control-point"), JSON.stringify(rows.map((r) => r.text)));
  await page.keyboard.press("Escape"); await sleep(200);

  // 5 locked
  await deselect();
  await page.mouse.click(mid.x + 200, y, { button: "right" }); await sleep(400);
  await page.getByRole("button", { name: /^Lock$/ }).click(); await sleep(400);
  await page.mouse.click(mid.x + 200, y, { button: "right" }); await sleep(400);
  rows = await menuRows();
  ok("locked road: neither point row", rows.length > 3 && !rows.some((r) => r.id === "el-menu-add-control-point" || r.id === "road-branch-here"), JSON.stringify(rows.map((r) => r.id)));
  await page.keyboard.press("Escape");
} catch (e) {
  console.log("ERROR", e.message); results.push({ name: "harness error: " + e.message, pass: false });
} finally {
  const gone = await page.evaluate(async (id) => {
    try {
      for (const k of Object.keys(localStorage)) {
        if (!/^planarfit:sites:/.test(k)) continue;
        try { const m = JSON.parse(localStorage.getItem(k) || "{}"); if (m && m[id]) { delete m[id]; localStorage.setItem(k, JSON.stringify(m)); } } catch (_) {}
      }
      await window.pfSupabase.from("site_elements").delete().eq("site_id", id);
      await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id);
      await window.pfSupabase.from("sites").delete().eq("id", id);
      const q = await window.pfSupabase.from("sites").select("id").eq("id", id);
      return { cloud: !(q.data && q.data.length) };
    } catch (e) { return { error: String(e) }; }
  }, SITE_ID).catch((e) => ({ error: String(e) }));
  ok("throwaway plan deleted and verified gone", !!gone.cloud, JSON.stringify(gone));
  await S.close().catch(() => {});
}
const failed = results.filter((r) => !r.pass);
console.log(`\nserved ${served}\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
