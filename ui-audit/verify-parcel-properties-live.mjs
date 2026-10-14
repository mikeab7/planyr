/* V1690016 / B2264880 — a parcel's properties (record · setbacks · style) open from the map, both menus and the list,
 * signed in as the test account on a real deploy, and a section setback survives a reload AND reaches the cloud row.
 *
 * Seeds a THROWAWAY project (two adjacent rectangular lots) into the signed-in account, drives every entry point with
 * the real mouse, and ALWAYS deletes the throwaway and confirms it gone (owner constraint 15). Reads /version.json in
 * the same run and prints it. KNOWN-GOOD ARM: the run is VOID unless the Land list shows both seeded lots.
 * Usage: BASE_URL=https://planyr.io E2E_LOGIN_KEY=… [SHOTS_DIR=/path] node ui-audit/verify-parcel-properties-live.mjs */
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const BASE = (process.env.BASE_URL || "https://planyr.io").replace(/\/$/, "");
const SHOTS = process.env.SHOTS_DIR || "";
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RUN = "zz-ppl-" + Math.random().toString(36).slice(2, 7);
const SITE_ID = RUN, SITE_NAME = `ZZ PPL ${RUN.slice(-5)}`;
const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const seed = {
  id: SITE_ID, groupId: SITE_ID, site: SITE_NAME, name: "Plan 1", origin: { lat: 29.76, lon: -95.37 }, county: "harris",
  parcels: [
    { id: "pa", points: rect(0, 0, 800, 600), active: true, lockSem: 2, label: "Lot A" },
    { id: "pb", points: rect(800, 0, 500, 600), active: true, lockSem: 2, label: "Lot B" },
  ],
  els: [], measures: [], callouts: [], markups: [], settings: { setback: 25 }, underlay: null, updatedAt: Date.now(), status: "active", schemaVersion: 12,
};

const s = await openSignedIn({ base: BASE });
const { browser, page } = s;
const version = await page.evaluate(async () => (await fetch("/version.json", { cache: "no-store" })).json()).catch(() => null);
console.log("signed in as", s.proof.email, "| served build", JSON.stringify(version));
const UID = await page.evaluate(async () => (await window.pfSupabase.auth.getUser()).data.user.id);
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
const T = (id) => page.getByTestId(id);
const model = () => page.evaluate(([id, uid]) => { const m = JSON.parse(localStorage.getItem("planarfit:sites:cloud:" + uid) || "{}"); return m[id] || null; }, [SITE_ID, UID]);
const pc = async (id) => ((await model())?.parcels || []).find((p) => p.id === id);
const landShowing = async () => (await T("parcels-panel").count()) + (await T("parcel-page").count());
const closeLand = async () => { if (await landShowing()) await page.locator('[data-rail-tab="parcel"]').click(); await sleep(300); await page.keyboard.press("Escape"); await sleep(200); };
const pageFor = async (id) => { for (let i = 0; i < 40; i++) { const n = await T("parcel-page").count(); if (n && (await T("parcel-page").getAttribute("data-parcel-id")) === id) return (await T("setback-all").locator("input").count()) === 1 && (await T("parcel-style-panel").count()) === 1; await sleep(150); } return false; };
const corners = (id) => page.evaluate((i) => { const el = document.querySelector(`[data-feature="parcel:${i}"] [data-testid="parcel-outline"]`); if (!el) return null; const m = el.getScreenCTM(); return [...el.points].map((p) => ({ x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f })); }, id);
const inside = async (id) => { const c = await corners(id); const xs = c.map((p) => p.x), ys = c.map((p) => p.y); return { x: Math.min(...xs) + (Math.max(...xs) - Math.min(...xs)) * 0.3, y: Math.min(...ys) + (Math.max(...ys) - Math.min(...ys)) * 0.3 }; };
const onLine = async (id) => { const c = await corners(id); const xs = c.map((p) => p.x), ys = c.map((p) => p.y); return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: Math.min(...ys) + 0.5 }; }; // middle of the top edge

async function openPlan() {
  await page.goto(BASE + "/#/site-planner", { waitUntil: "load" });
  await sleep(4000); // the project list fills from the cloud a few seconds after load; clicking earlier finds nothing
  await page.getByText(SITE_NAME, { exact: false }).filter({ visible: true }).first().evaluate((el) => el.click(), null, { timeout: 45000 });
  await T("planner-canvas").waitFor({ timeout: 25000 });
  await sleep(1500);
  { const f = page.getByTitle(/zoom to fit|fit to/i).first(); if (await f.count()) await f.click().catch(() => {}); await sleep(800); }
  await assertMeasurable(page, "verify-parcel-properties-live");
  await page.waitForSelector('[data-feature="parcel:pa"] [data-testid="parcel-outline"]', { timeout: 20000 });
}

try {
  await page.evaluate(([uid, all]) => { localStorage.setItem("planarfit:sites:cloud:" + uid, JSON.stringify(all)); localStorage.setItem("planarfit:currentSite:v1", Object.keys(all)[0]); }, [UID, { [SITE_ID]: seed }]);
  await openPlan();
  // KNOWN-GOOD ARM
  if (!(await landShowing())) await page.locator('[data-rail-tab="parcel"]').click();
  await sleep(500);
  const rows = (await T("parcel-row-pa").count()) + (await T("parcel-row-pb").count());
  ok("known-good: the Land list shows both seeded lots", rows === 2);
  if (rows !== 2) throw new Error("VOID run — seeded lots not listed");

  // 1 · double-click on empty land inside Lot A, panel closed
  await closeLand();
  let p = await inside("pa"); await page.mouse.dblclick(p.x, p.y);
  ok("1 · double-click inside a lot opens THAT lot's page (setback box + style)", await pageFor("pa"));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/1-dblclick-inside.png` });

  // 2 · line click with the panel open → page follows; right-click → Properties; Parcel tools → Properties
  p = await onLine("pb"); await page.mouse.click(p.x, p.y);
  ok("2a · with Land open, clicking Lot B's line moves the page to Lot B", await pageFor("pb"));
  await closeLand();
  p = await onLine("pa"); await page.mouse.click(p.x, p.y, { button: "right" });
  await T("parcel-menu-properties").click();
  ok("2b · right-click → Properties opens Lot A's page", await pageFor("pa"));
  await closeLand();
  p = await onLine("pb"); await page.mouse.click(p.x, p.y); await sleep(300);
  ok("2c · a single click with Land closed only selects (panel stays closed)", (await landShowing()) === 0);
  await T("rail-parcel-tools").click(); await T("parcel-menu-setbacks").click();
  ok("2d · Parcel tools ▾ → Properties opens the selected lot's page", await pageFor("pb"));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/2-menu-properties.png` });

  // 3 · locked lot: opens, and its setback edit saves
  await T("parcel-row-pa").count().then(async (n) => { if (!n) { const b = T("parcel-page-back"); if (await b.count()) await b.click(); } });
  await T("parcel-row-pa").click(); await sleep(300);
  await T("parcel-page-lock").click(); await sleep(500);
  ok("3a · Lot A is now locked", !!(await pc("pa"))?.locked);
  await closeLand();
  p = await inside("pa"); await page.mouse.dblclick(p.x, p.y);
  ok("3b · double-click inside the LOCKED lot still opens its page", await pageFor("pa"));
  const allIn = T("setback-all").locator("input"); await allIn.fill("35"); await allIn.press("Enter"); await sleep(700);
  ok("3c · the setback edit on a locked lot saves (every edge 35)", ((await pc("pa"))?.setbacks || []).every((v) => v === 35));

  // 4 · one section to 62 → wait for the cloud row → cache-busted reload → still 62 + the setback line drawn
  if (!(await T("setback-section-row").count())) await page.locator('[data-testid^="setback-sketch-section-"]').first().click();
  const row = T("setback-section-row").first(); const key = await row.getAttribute("data-section-key");
  await row.locator("input").fill("62"); await row.locator("input").press("Enter"); await sleep(600);
  const local = (await pc("pa"))?.setbacks || [];
  ok("4a · one section set to 62, the others untouched", local.includes(62) && local.some((v) => v !== 62), JSON.stringify(local));
  let cloud = null;
  for (let i = 0; i < 40; i++) { cloud = await page.evaluate(async (sid) => { const q = await window.pfSupabase.from("site_elements").select("data").eq("site_id", sid).eq("kind", "parcel").eq("id", "pa"); return q.data && q.data[0] ? q.data[0].data.setbacks : null; }, SITE_ID); if (JSON.stringify(cloud) === JSON.stringify(local)) break; await sleep(500); }
  ok("4b · the cloud row holds the same per-edge setbacks", JSON.stringify(cloud) === JSON.stringify(local), JSON.stringify(cloud));
  await page.goto(BASE + "/?cb=" + Date.now() + "#/site-planner", { waitUntil: "load" });
  await sleep(4000); // the project list fills from the cloud a few seconds after load
  await page.getByText(SITE_NAME, { exact: false }).filter({ visible: true }).first().evaluate((el) => el.click(), null, { timeout: 45000 });
  await T("planner-canvas").waitFor({ timeout: 25000 }); await sleep(2000);
  await page.waitForSelector('[data-feature="parcel:pa"] [data-testid="parcel-outline"]', { timeout: 20000 });
  await page.waitForSelector('[data-testid="setback-ring"]', { timeout: 15000 }).catch(() => {});
  ok("4c · after a cache-busted reload the setbacks are unchanged", JSON.stringify((await pc("pa"))?.setbacks) === JSON.stringify(local));
  ok("4d · the setback line is drawn on the map", (await page.getByTestId("setback-ring").count()) >= 1);
  await closeLand();
  p = await inside("pa"); await page.mouse.dblclick(p.x, p.y);
  const v = (await pageFor("pa")) ? await page.locator(`[data-testid="setback-section-row"][data-section-key="${key}"] input`).inputValue().catch(() => null) : null;
  ok("4e · reopened, that section still reads 62", v === "62", String(v));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/4-after-reload.png` });
  ok("no page errors", errors.length === 0, errors.join(" | "));
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
  }, [SITE_ID, UID]).catch(() => false);
  ok("throwaway project deleted and confirmed gone from the cloud", gone);
  await browser.close();
}
const fails = results.filter((r) => !r.pass);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);
