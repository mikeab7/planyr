/* verify-bartow-tax-hidden-live — NEW-1 (B2671241): the Bartow GA tax-district table is BUILT but HIDDEN until every district's 2025
 * millage is transcribed (TAX_COVERAGE.ga_bartow.covered === false). Driven against a live deploy as the test account on a throwaway
 * site (cleaned up at the end, owner constraint 15) holding Bartow county lots carrying Tax_District 06 (county unincorporated — the
 * one code whose list is fully sourced), 01 (Cartersville — parks-bond rate missing) and a PILOT lot.
 *   page   — each lot's parcel page OPENS (positive control: the instrument can see the page, so "no table" is not a dead probe)
 *   hidden — NONE of them shows a "Tax rates" section (complete or hidden; the gate is county-wide, never a partial table)
 * KNOWN-GOOD CONTROL for the table path itself lives in verify-parcel-tax-table (Harris, 8/8 on the same deploy).
 * When covered flips to true this harness must be changed to expect 24.05 mills on the 06 lot and "held by the Development Authority".
 * Usage: SIGNED_IN=1 BASE_URL=https://planyr.io node ui-audit/verify-bartow-tax-hidden-live.mjs
 */
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const BASE = (process.env.BASE_URL || "http://localhost:4173").replace(/\/$/, "");
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sq = (x, y, id, extra = {}) => ({ id, points: [{ x, y }, { x: x + 400, y }, { x: x + 400, y: y + 400 }, { x, y: y + 400 }], ...extra });
const lot = (x, id, attrs, label) => sq(x, 0, id, { acct: attrs.PARCELID, addr: "1 County Rd", attrs: { OBJECTID: id.charCodeAt(1), Owner1: "Test", ...attrs }, gisKey: "k-" + id, label });
const SITE_ID = "zz-bartow-" + Math.random().toString(36).slice(2, 7);
const site = {
  id: SITE_ID, groupId: SITE_ID, site: "ZZ Bartow Tax", name: "Plan 1", origin: { lat: 34.2455, lon: -84.8427 }, county: "ga_bartow",
  parcels: [
    lot(0, "p1", { PARCELID: "0080-0202-001", Tax_District: "06", Tax_District_Desc: "Bartow County", Subdivision_Name: "COM - CASS WHITE CORRIDOR" }, "District 06"),
    lot(400, "p2", { PARCELID: "C003-0013-001", Tax_District: "01", Tax_District_Desc: "Cartersville", Subdivision_Name: "" }, "District 01"),
    lot(800, "p3", { PARCELID: "P000-0000-001", Tax_District: "06", Tax_District_Desc: "Bartow County", Subdivision_Name: "Pilot Park" }, "Pilot lot"),
  ],
  els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), status: "active", schemaVersion: 12,
};

const SIGNED = !!process.env.SIGNED_IN;
if (!SIGNED) { console.log("VOID: this harness only runs signed in (SIGNED_IN=1)"); process.exit(2); }
const s = await openSignedIn({ base: BASE });
const browser = s.browser, page = s.page;
console.log("signed in as", s.proof.email, "| served build", JSON.stringify(s.build));
const UID = await page.evaluate(async () => (await window.pfSupabase.auth.getUser()).data.user.id);
await page.evaluate(([uid, st]) => { localStorage.setItem("planarfit:sites:cloud:" + uid, JSON.stringify({ [st.id]: st })); localStorage.setItem("planarfit:currentSite:v1", st.id); }, [UID, site]);
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
  await page.goto(BASE + "/#/site-planner", { waitUntil: "load" });
  await page.reload({ waitUntil: "load" }); await sleep(3000);
  await page.getByText("ZZ Bartow Tax", { exact: false }).first().click();
  await T("planner-canvas").waitFor({ timeout: 25000 });
  await sleep(1500);
  await assertMeasurable(page, "verify-bartow-tax-hidden-live");
  console.log("served build", await page.evaluate(async () => (await (await fetch("/version.json", { cache: "no-store" })).json()).build));
  for (const [id, what] of [["p1", "district 06 (fully sourced list)"], ["p2", "district 01 (parks-bond rate missing)"], ["p3", "a Pilot (Development Authority) lot"]]) {
    await openLot(id); await sleep(2500);
    ok(`${what}: the parcel page opens (positive control)`, await T("parcel-page").isVisible());
    ok(`${what}: shows NO tax table (county hidden until complete)`, (await T("parcel-tax-table").count()) === 0);
  }

} finally {
  // owner constraint 15: test artifacts are always cleared, and the clear is verified.
  if (SIGNED && UID) {
    try {
      await page.evaluate(([uid, id]) => { const k = "planarfit:sites:cloud:" + uid; const m = JSON.parse((globalThis.__planyrSitesRaw||((k)=>localStorage.getItem(k)))(k) || "{}"); delete m[id]; localStorage.setItem(k, JSON.stringify(m)); }, [UID, SITE_ID]);
      // The database refuses to PERMANENTLY delete a live site (sites_block_delete_live_group) — the sanctioned path is
      // trash first, then purge. A bare delete silently matched nothing and left a row per run (found 2026-10-08).
      await page.evaluate(async (id) => {
        await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id);
        await window.pfSupabase.from("site_elements").delete().eq("site_id", id);
        await window.pfSupabase.from("sites").delete().eq("id", id);
      }, SITE_ID);
      const left = await page.evaluate(async (id) => { const { data } = await window.pfSupabase.from("sites").select("id,deleted_at").eq("id", id); return (data || []).length; }, SITE_ID);
      console.log(left === 0 ? "cleanup — throwaway site purged from the cloud (verified)" : `cleanup — WARNING: ${left} row(s) for ${SITE_ID} remain (trashed at minimum); delete them by hand`);
    } catch (e) { console.log("cleanup error —", e.message); }
  }
  await browser.close();
}
const bad = results.filter((r) => !r.pass);
console.log(`\n${results.length - bad.length}/${results.length} passed${failed ? " (RUN ABORTED)" : ""}`);
process.exit(bad.length || failed ? 1 : 0);
