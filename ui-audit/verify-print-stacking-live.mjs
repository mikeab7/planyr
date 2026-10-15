/* V1689824 / B2264688 — live signed-in check: a polygon sent to Back is NOT lifted into a PDF annotation
 * (it stays in the page, under the building); on top it IS lifted. Throwaway plan on the test account,
 * deleted at the end. Usage: E2E_LOGIN_KEY=… node ui-audit/verify-print-stacking-live.mjs https://planyr.io */
import { readFileSync } from "node:fs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const base = process.argv[2] || "https://planyr.io";
const FIX = JSON.parse(readFileSync(new URL("./fixtures/goose-creek-plan1copy.json", import.meta.url), "utf8"));
const ID = "e2e-print-stacking-live", BLDG = "e1454729ykduhm", MK = "mkPoly";
const b = FIX.els.find((e) => e.id === BLDG), hw = b.w / 2 + 80, hh = b.h / 2 + 80;
const rec = { id: ID, groupId: ID, site: "ZZ print stacking live", name: "ZZ print stacking live", origin: null, county: "harris",
  parcels: FIX.parcels, els: FIX.els, measures: [], callouts: [], settings: FIX.settings || {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
  markups: [{ id: MK, kind: "polygon", pts: [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => ({ x: b.cx + x, y: b.cy + y })), stroke: "#e11d48", weight: 2, fill: "#e11d48", fillOpacity: 0.35, z: 1000 }] };

const s = await openSignedIn({ base });
const page = s.page;
let ok = false, KEY = null;
try {
  await assertMeasurable(page, "verify-print-stacking-live");
  const served = await page.evaluate(() => fetch("/version.json").then((r) => r.json()));
  console.log("served build:", JSON.stringify(served), "| harness-reported:", JSON.stringify(s.build));
  await page.evaluate(() => { window.__PLANYR_E2E = true; });
  // signed in, the device store is per account: planarfit:sites:cloud:<uid>
  const uid = await page.evaluate(async () => (await window.pfSupabase.auth.getUser()).data.user.id);
  KEY = "planarfit:sites:cloud:" + uid;
  await page.evaluate(([k, id, r]) => { const m = JSON.parse(localStorage.getItem(k) || "{}"); m[id] = r; localStorage.setItem(k, JSON.stringify(m)); localStorage.setItem("planarfit:currentSite:v1", id); }, [KEY, ID, rec]);
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
  await page.goto(base + "/#/site"); await page.reload();
  const canvas = page.getByTestId("planner-canvas");
  if (!(await canvas.isVisible().catch(() => false))) await page.getByText("ZZ print stacking live", { exact: false }).first().click();
  await canvas.waitFor({ timeout: 30000 });
  await page.waitForFunction((m) => document.querySelector(`[data-feature="markup:${m}"]`), MK, { timeout: 30000 });
  await page.waitForTimeout(1500);
  const composed = () => page.evaluate(async (m) => { const c = await window.__plannerExportComposed(); const d = new DOMParser().parseFromString(c.sheetSvg, "image/svg+xml"); return { lifted: c.liftedIds, kept: c.keptInPage, inPage: !!d.querySelector(`[data-feature="markup:${m}"]`) }; }, MK);
  const pt = await page.evaluate((id) => { const r = document.querySelector(`[data-el-id="${id}"]`).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; }, BLDG);
  const top = await composed(); console.log("on top   :", JSON.stringify(top));
  await page.mouse.click(pt.x, pt.y, { button: "right" });
  await page.getByRole("button", { name: /^Send to Back/ }).click();
  await page.waitForTimeout(800); await page.mouse.click(pt.x - 900, pt.y - 400);
  const back = await composed(); console.log("sent back:", JSON.stringify(back));
  await page.mouse.click(pt.x, pt.y, { button: "right" });
  await page.getByRole("button", { name: /^Bring to Front/ }).click();
  await page.waitForTimeout(800); await page.mouse.click(pt.x - 900, pt.y - 400);
  const front = await composed(); console.log("to front :", JSON.stringify(front));
  ok = top.lifted === 1 && !top.inPage && back.lifted === 0 && back.kept === 1 && back.inPage && front.lifted === 1 && !front.inPage;
  console.log(ok ? "PASS" : "FAIL");
} catch (e) { console.error("ERROR", e.message); }
finally {
  // always clear the throwaway: the device record, then the cloud row (the server refuses a delete until the row is in the trash)
  try {
    const left = await page.evaluate(async ([k, id]) => {
      if (k) { const m = JSON.parse(localStorage.getItem(k) || "{}"); delete m[id]; localStorage.setItem(k, JSON.stringify(m)); }
      const sb = window.pfSupabase;
      await sb.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id);
      await sb.from("sites").delete().eq("id", id);
      return (await sb.from("sites").select("id").eq("id", id)).data;
    }, [KEY, ID]);
    console.log("throwaway cleared:", JSON.stringify(left) === "[]");
  } catch (e) { console.error("cleanup", e.message); }
  await s.close();
}
process.exit(ok ? 0 : 1);
