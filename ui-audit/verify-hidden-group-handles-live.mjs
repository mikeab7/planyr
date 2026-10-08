/* verify-hidden-group-handles-live — B2171808, driven LIVE as the test account.
 * Seeds a THROWAWAY site (one building + one parking field) via the app's local-cache path, then for each
 * type: hover (KNOWN-GOOD ARM — the +/− cluster must exist while visible, else the run is VOID), hide its
 * View group and hover again (zero `feature-edit-nodes`), show it and hover (cluster returns).
 * Throwaway ALWAYS deleted and confirmed gone (owner constraint 15).
 * Usage: BASE_URL=https://planyr.io E2E_LOGIN_KEY=… node ui-audit/verify-hidden-group-handles-live.mjs */
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const BASE = (process.env.BASE_URL || "https://planyr.io").replace(/\/$/, "");
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let SITE_ID = null; // read back after the first real write (lazy project creation)
const s = await openSignedIn({ base: BASE });
const { browser, page } = s;
console.log("signed in as", s.proof.email, "| served build", JSON.stringify(s.build));
const UID = await page.evaluate(async () => (await window.pfSupabase.auth.getUser()).data.user.id);
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
const T = (id) => page.getByTestId(id);
const nodes = () => page.getByTestId("feature-edit-nodes").count();
async function setGroup(key, on) {
  const btn = T("view-menu-btn");
  if ((await btn.getAttribute("aria-expanded")) !== "true") await btn.click();
  const cb = T(`view-row-${key}`);
  await cb.waitFor({ timeout: 10000 });
  if ((await cb.isChecked()) !== on) await cb.click();
  await sleep(300);
}
async function centerOf(id) {
  return page.evaluate((i) => { const g = document.querySelector(`[data-el-id="${i}"]`); const r = g.querySelector("rect, path").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, id);
}
async function hoverAt(c) { await page.mouse.move(c.x - 40, c.y - 30); await page.mouse.move(c.x, c.y); await page.mouse.move(c.x + 3, c.y + 2); await sleep(250); }
try {
  await page.goto(BASE + "/#/site-planner", { waitUntil: "load" });
  await sleep(2500);
  await T("map-toolbar-draw").click();
  await T("planner-canvas").waitFor({ timeout: 25000 });
  await sleep(1500);
  const b0 = await T("planner-canvas").boundingBox();
  const drag = async (x1, y1, x2, y2) => { await page.mouse.move(x1, y1); await page.mouse.down(); await page.mouse.move(x1 + 60, y1 + 40, { steps: 5 }); await page.mouse.move(x2, y2, { steps: 8 }); await page.mouse.up(); await page.keyboard.press("Escape"); await sleep(400); };
  await page.getByRole("button", { name: "Building", exact: true }).click();
  await drag(b0.x + 150, b0.y + 120, b0.x + 450, b0.y + 280);
  await page.getByRole("button", { name: "Parking", exact: true }).click();
  await drag(b0.x + 150, b0.y + 340, b0.x + 450, b0.y + 480);
  SITE_ID = await page.evaluate(() => localStorage.getItem("planarfit:currentSite:v1"));
  console.log("throwaway site id:", SITE_ID);
  const ids = await page.evaluate(([uid, sid]) => { const m = JSON.parse(localStorage.getItem("planarfit:sites:cloud:" + uid) || "{}"); const els = (m[sid] || {}).els || []; return { hb1: (els.find((e) => e.type === "building") || {}).id, hp1: (els.find((e) => e.type === "parking") || {}).id }; }, [UID, SITE_ID]);
  console.log("element ids:", JSON.stringify(ids));
  if (!ids.hb1 || !ids.hp1) throw new Error("throwaway elements not created");
  const box = await T("planner-canvas").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -120); await sleep(40); }
  await sleep(500);
  await assertMeasurable(page, "verify-hidden-group-handles-live");
  const build = await page.evaluate(() => [...document.querySelectorAll("script[src]")].map((n) => n.getAttribute("src")).filter((x) => /assets/.test(x)).slice(0, 2));
  console.log("served chunks (same call as assertions):", JSON.stringify(build), "| /version.json:", JSON.stringify(s.build));
  for (const [label, id, key] of [["Buildings", ids.hb1, "el:building"], ["Car parking", ids.hp1, "el:parking"]]) {
    const c = await centerOf(id);
    await hoverAt(c);
    const base = await nodes();
    ok(`known-good arm [${label}]: +/− cluster exists while visible`, base === 1, `count=${base}`);
    if (base !== 1) continue; // run is VOID for this type
    await setGroup(key, false);
    await page.mouse.move(box.x + 20, box.y + 20); await sleep(150);
    await hoverAt(c);
    const hid = await nodes();
    const drawn = await page.locator(`[data-el-id="${id}"]`).count();
    ok(`[${label}] hidden: element not drawn and zero +/− clusters on its old footprint`, drawn === 0 && hid === 0, `drawn=${drawn} clusters=${hid}`);
    await setGroup(key, true);
    await page.mouse.move(box.x + 20, box.y + 20); await sleep(150);
    await hoverAt(c);
    const back = await nodes();
    ok(`[${label}] shown again: cluster returns, no reload`, back === 1, `count=${back}`);
  }
  ok("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) { console.error("HARNESS ERROR:", e.message); ok("harness ran to completion", false, e.message); }
finally {
  const gone = !SITE_ID ? true : await page.evaluate(async ([id, uid]) => {
    await window.pfSupabase.from("site_elements").delete().eq("site_id", id);
    await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id);
    await window.pfSupabase.from("sites").delete().eq("id", id);
    const q = await window.pfSupabase.from("sites").select("id").eq("id", id);
    try { const k = "planarfit:sites:cloud:" + uid; const m = JSON.parse(localStorage.getItem(k) || "{}"); delete m[id]; localStorage.setItem(k, JSON.stringify(m)); } catch (e) {}
    return !q.error && (q.data || []).length === 0;
  }, [SITE_ID, UID]).catch(() => false);
  ok("throwaway site deleted and confirmed gone from the cloud", gone);
  await browser.close();
}
const fails = results.filter((r) => !r.pass);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);
