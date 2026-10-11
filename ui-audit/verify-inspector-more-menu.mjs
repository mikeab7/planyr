/* verify-inspector-more-menu — B2240177, driven LIVE as the test account. On a THROWAWAY seeded site: open the
 * building inspector, press ⋯, then (1) click the empty canvas, (2) press Escape, (3) click the trigger twice —
 * the menu must close each time with the building still present, still selected and the inspector still open.
 * KNOWN-GOOD ARM: the run is VOID unless ⋯ really opens the menu (building-delete visible) before each close.
 * The throwaway is always deleted and confirmed gone (owner constraint 15).
 * Usage: BASE_URL=https://planyr.io E2E_LOGIN_KEY=… node ui-audit/verify-inspector-more-menu.mjs */
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const BASE = (process.env.BASE_URL || "https://planyr.io").replace(/\/$/, "");
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ID = "zz-more-" + Math.random().toString(36).slice(2, 7);
const NAME = `ZZ MORE ${ID.slice(-5)}`;
const s = await openSignedIn({ base: BASE });
const { browser, page } = s;
console.log("signed in as", s.proof.email, "| served build", JSON.stringify(s.build));
const UID = await page.evaluate(async () => (await window.pfSupabase.auth.getUser()).data.user.id);
const T = (id) => page.getByTestId(id);
const nBldg = () => page.evaluate(([id, uid]) => ((JSON.parse(localStorage.getItem("planarfit:sites:cloud:" + uid) || "{}")[id] || {}).els || []).filter((e) => e.type === "building").length, [ID, UID]);
const open = async () => { await T("building-more").click(); await T("building-delete").waitFor({ timeout: 5000 }); };
const closed = async () => { await sleep(300); return (await T("building-delete").count()) === 0; };
const intact = async () => (await nBldg()) === 1 && (await T("building-header").isVisible()) && (await page.locator('[data-el-id="bz1"]').count()) === 1;
try {
  const site = { id: ID, groupId: ID, site: NAME, name: "Plan 1", origin: { lat: 29.76, lon: -95.37 }, county: "harris", parcels: [], els: [{ id: "bz1", type: "building", cx: 600, cy: 400, w: 520, h: 210, rot: 0, z: 1, dock: "single", dockAxis: "x", dockSide: "bottom" }], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), status: "active", schemaVersion: 12 };
  await page.evaluate(([uid, st]) => { localStorage.setItem("planarfit:sites:cloud:" + uid, JSON.stringify({ [st.id]: st })); localStorage.setItem("planarfit:currentSite:v1", st.id); }, [UID, site]);
  await page.goto(BASE + "/#/site-planner", { waitUntil: "load" });
  await page.getByText(NAME, { exact: false }).filter({ visible: true }).first().click({ timeout: 45000 });
  await T("planner-canvas").waitFor({ timeout: 25000 });
  await sleep(1500);
  { const f = page.getByTitle(/zoom to fit|fit to/i).first(); if (await f.count()) await f.click().catch(() => {}); await sleep(800); }
  await assertMeasurable(page, "verify-inspector-more-menu");
  await page.waitForSelector('[data-el-id="bz1"]', { timeout: 20000 });
  const pt = await page.evaluate(() => { const r = document.querySelector('[data-el-id="bz1"]').querySelector("rect, path").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.dblclick(pt.x, pt.y);
  await T("building-header").waitFor({ timeout: 10000 });
  const box = await T("planner-canvas").boundingBox();

  await open(); ok("known-good: ⋯ opens the menu", true);
  await page.mouse.click(box.x + 40, box.y + 40);
  ok("click on the empty canvas closes the menu", await closed());
  ok("…and the building is still there, still selected, inspector still open", await intact());

  await open(); await page.keyboard.press("Escape");
  ok("Escape closes the menu", await closed());
  ok("…and the building and inspector are untouched", await intact());

  await open(); await T("building-more").click();
  ok("pressing ⋯ again closes it", await closed());
  ok("…building untouched", await intact());
} catch (e) {
  console.error("HARNESS ERROR:", e.message); ok("harness ran to completion", false, e.message);
} finally {
  const gone = await page.evaluate(async ([id, uid]) => {
    await window.pfSupabase.from("site_elements").delete().eq("site_id", id);
    await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id);
    await window.pfSupabase.from("sites").delete().eq("id", id);
    const q = await window.pfSupabase.from("sites").select("id").eq("id", id);
    try { const k = "planarfit:sites:cloud:" + uid; const m = JSON.parse(localStorage.getItem(k) || "{}"); delete m[id]; localStorage.setItem(k, JSON.stringify(m)); } catch (e) {}
    return !q.error && !(q.data || []).length;
  }, [ID, UID]).catch(() => false);
  ok("throwaway site deleted and confirmed gone from the cloud", gone);
  await browser.close();
}
const fails = results.filter((r) => !r.pass);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);
