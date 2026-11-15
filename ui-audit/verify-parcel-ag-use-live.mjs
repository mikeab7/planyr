/* verify-parcel-ag-use-live — the ag-use (1D1) rollback line on the parcel page (B2671233 / V2115885), against a live deploy.
 * Throwaway site (cleaned up at the end, owner constraint 15): Harris lots built from the REAL HCAD attribute bags of 0432370000001
 * (Mueschke Rd, 1D1) and 0421030000123 (Schiel, ordinary), a Fort Bend D1 lot, and the same 1D1 bag on a GEORGIA plan.
 * KNOWN-GOOD ARM: the ordinary lot shows NO ag-use element while the 1D1 lot shows it in the same run (else the run is VOID).
 * Usage: SIGNED_IN=1 BASE_URL=https://planyr.io node ui-audit/verify-parcel-ag-use-live.mjs */
import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const BASE = (process.env.BASE_URL || "http://localhost:4173").replace(/\/$/, "");
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const _UNUSED = ["GOOSE CREEK CISD", "HARRIS COUNTY", "HARRIS CO FLOOD CNTRL", "PORT OF HOUSTON AUTHY", "HARRIS CO HOSP DIST", "HARRIS CO EDUC DEPT", "LEE JR COLLEGE DIST", "HC EMERG SRV DIST 14"];

const sq = (x, y, id, extra = {}) => ({ id, points: [{ x, y }, { x: x + 400, y }, { x: x + 400, y: y + 400 }, { x, y: y + 400 }], ...extra });
const lot = (x, id, attrs, label, extra = {}) => sq(x, 0, id, { acct: String(attrs.acct_num || attrs.PROPNUMBER), addr: "1 County Rd", attrs, gisKey: "k-" + id, label, ...extra });
const MUESCHKE = { acct_num: "0432370000001", tax_year: "2026", HCAD_NUM: "0432370000001", owner_name_1: "Test Owner", state_class: "1D1", productivity_value: 10078, total_market_val: 1948231, land_value: 1948231, Acreage: "88.9009 AC", acreage_1: 88.9009 };
const SCHIEL = { acct_num: "0421030000123", tax_year: "2026", HCAD_NUM: "0421030000123", owner_name_1: "Test Owner", state_class: "F1", productivity_value: 0, total_market_val: 9000000, land_value: 9000000, Acreage: "63.8457 AC", acreage_1: 63.8457 };
const FB = { PROPNUMBER: "6495-00-000-0240-901", OWNERNAME: "Test Owner", TOTALVALUE: 276095, LANDVALUE: 276095, IMPVALUE: 0, Land_State_Code: "D1", Land_AG_Code: "A-BK", EXEMPTIONS: "AG" };
const mk = (id, name, county, origin, parcels) => ({
  id, groupId: id, site: name, name: "Plan 1", origin, county, parcels, els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null,
  updatedAt: Date.now(), status: "active", schemaVersion: 12,
});
const R = Math.random().toString(36).slice(2, 7);
const IDS = { hc: "zz-ag-hc-" + R, fb: "zz-ag-fb-" + R, ga: "zz-ag-ga-" + R };
const sites = [
  mk(IDS.hc, "ZZ Ag Harris", "harris", { lat: 29.76, lon: -95.37 }, [lot(0, "p1", MUESCHKE, "Mueschke"), lot(400, "p2", SCHIEL, "Schiel")]),
  mk(IDS.fb, "ZZ Ag FortBend", "fortbend", { lat: 29.55, lon: -95.75 }, [lot(0, "p1", FB, "Pecan Creek")]),
  mk(IDS.ga, "ZZ Ag Georgia", "ga_chatham", { lat: 32.05, lon: -81.1 }, [lot(0, "p1", MUESCHKE, "Same bag, Georgia")]),
];
const SITE_ID = IDS.hc; // (kept for the shared harness shape)

const SIGNED = !!process.env.SIGNED_IN;
let browser, ctx, page, UID = null;
if (SIGNED) {
  const s = await openSignedIn({ base: BASE });
  browser = s.browser; ctx = s.context; page = s.page;
  console.log("signed in as", s.proof.email, "| served build", JSON.stringify(s.build));
  UID = await page.evaluate(async () => (await window.pfSupabase.auth.getUser()).data.user.id);
  await page.evaluate(([uid, st]) => { localStorage.setItem("planarfit:sites:cloud:" + uid, JSON.stringify(Object.fromEntries(st.map((x) => [x.id, x])))); localStorage.setItem("planarfit:currentSite:v1", st[0].id); }, [UID, sites]);
} else {
  const exe = existsSync(chromium.executablePath()) ? undefined : "/opt/pw-browsers/chromium";
  browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await ctx.newPage();
  await page.addInitScript((s) => { try { if (!localStorage.getItem("zz-seeded-" + s[0].id)) { localStorage.setItem("planarfit:sites:v1", JSON.stringify(Object.fromEntries(s.map((x) => [x.id, x])))); localStorage.setItem("planarfit:currentSite:v1", s[0].id); localStorage.setItem("zz-seeded-" + s[0].id, "1"); } } catch (_) {} }, sites);
}
const T = (id) => page.getByTestId(id);
async function openPanel() {
  if (await T("parcels-panel").isVisible().catch(() => false)) return;
  await page.locator('[data-rail-tab="parcel"]').first().click();
  await T("parcels-panel").waitFor({ timeout: 15000 });
}
async function openLot(id) {
  if (await T("parcel-page").isVisible().catch(() => false)) { await T("parcel-page-back").click(); await T("parcels-panel").waitFor({ timeout: 8000 }); }
  await openPanel();
  await T("parcel-row-" + id).click();
  await T("parcel-page").waitFor({ timeout: 8000 });
}
let failed = false;
try {
  const openSite = async (name) => {
    await page.goto(BASE + "/#/site-planner", { waitUntil: "load" });
    if (SIGNED) { await page.reload({ waitUntil: "load" }); await sleep(3000); }
    await page.getByText(name, { exact: false }).first().click();
    await T("planner-canvas").waitFor({ timeout: 25000 });
    await sleep(1500);
  };
  await openSite("ZZ Ag Harris");
  await assertMeasurable(page, "verify-parcel-ag-use-live");
  const build = await page.evaluate(async () => (await (await fetch("/version.json", { cache: "no-store" })).json()).build);
  console.log("served build", build);
  await openLot("p1");
  const ag = await T("parcel-ag-use").innerText({ timeout: 15000 }).catch(() => "");
  ok("Harris 1D1 lot shows the full line", ag === "Ag-use valuation (1D1) — a change of use triggers rollback taxes (3 prior years, Tax Code §23.55); market $1.95M vs productivity $10,078", JSON.stringify(ag));
  await openLot("p2"); await sleep(1500);
  if (!(await T("parcel-county-record").isVisible().catch(() => false))) throw new Error("VOID: the ordinary lot's county record did not render, so its silence proves nothing");
  ok("known-good arm: an ordinary Harris lot shows NO ag-use line (county record present)", (await T("parcel-ag-use").count()) === 0);
  await openSite("ZZ Ag FortBend");
  await openLot("p1");
  const fb = await T("parcel-ag-use").innerText({ timeout: 15000 }).catch(() => "");
  ok("Fort Bend D1 lot shows the class + rule and NO dollar figures", fb === "Ag-use valuation (D1) — a change of use triggers rollback taxes (3 prior years, Tax Code §23.55)", JSON.stringify(fb));
  await openSite("ZZ Ag Georgia");
  await openLot("p1"); await sleep(1500);
  if (!(await T("parcel-county-record").isVisible().catch(() => false))) throw new Error("VOID: the Georgia lot's county record did not render");
  ok("Texas only: the same 1D1 bag on a Georgia plan shows NO line", (await T("parcel-ag-use").count()) === 0);
} catch (e) {
  failed = true; console.log("ERROR —", e.message);
} finally {
  // owner constraint 15: test artifacts are always cleared, and the clear is verified.
  if (SIGNED && UID) {
    try {
      await page.evaluate(([uid, ids]) => { const k = "planarfit:sites:cloud:" + uid; const m = JSON.parse((globalThis.__planyrSitesRaw||((k)=>localStorage.getItem(k)))(k) || "{}"); for (const id of ids) delete m[id]; localStorage.setItem(k, JSON.stringify(m)); }, [UID, Object.values(IDS)]);
      // The database refuses to PERMANENTLY delete a live site (sites_block_delete_live_group) — the sanctioned path is
      // trash first, then purge. A bare delete silently matched nothing and left a row per run (found 2026-10-08).
      for (const id of Object.values(IDS)) {
        await page.evaluate(async (sid) => {
          await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", sid);
          await window.pfSupabase.from("site_elements").delete().eq("site_id", sid);
          await window.pfSupabase.from("sites").delete().eq("id", sid);
        }, id);
        const left = await page.evaluate(async (sid) => { const { data } = await window.pfSupabase.from("sites").select("id,deleted_at").eq("id", sid); return (data || []).length; }, id);
        console.log(left === 0 ? `cleanup — ${id} purged from the cloud (verified)` : `cleanup — WARNING: ${left} row(s) for ${id} remain (trashed at minimum); delete them by hand`);
      }
    } catch (e) { console.log("cleanup error —", e.message); }
  }
  await browser.close();
}
const bad = results.filter((r) => !r.pass);
console.log(`\n${results.length - bad.length}/${results.length} passed${failed ? " (RUN ABORTED)" : ""}`);
process.exit(bad.length || failed ? 1 : 0);
