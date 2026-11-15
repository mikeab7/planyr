/* verify-tn-tax-table-live — the Tennessee county lot's TAX table (B2671283 Rutherford, B2671284 Davidson), driven
 * signed in as the test account against a live deploy.
 *
 * Throwaway sites (cleaned up at the end, owner constraint 15) seeded with county lots whose attribute bags are the REAL
 * layer rows (fetched with outFields=* from the county's own FeatureServer at run time — so a layer that renamed a field
 * is caught here, not just by the unit test):
 *   Rutherford  156-027.00-000 (county only, industrial, $7,056) · 126-050.12-000 (Murfreesboro, $124,346)
 *               103I-B-006.02-000 (IDB → PILOT line, no total) · 152-024.03-000 (tax freeze → rates, no estimate)
 *   Davidson    09400020000 (USD 2.814) · 14401000500 (Belle Meade 3.0831) · 09305020600 (CBID → no table)
 * KNOWN-GOOD ARM: the run is VOID unless the 156-027.00-000 page reports the county row and 1.876200 (a harness that
 * cannot see the table must not score the "hidden" arms).
 * Usage: BASE_URL=https://planyr.io node ui-audit/verify-tn-tax-table-live.mjs
 */
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const BASE = (process.env.BASE_URL || "https://planyr.io").replace(/\/$/, "");
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const RUTH = "https://services.arcgis.com/36I6IHIdr660pAyH/arcgis/rest/services/ParcelsCAMA1/FeatureServer/0/query";
const DAV = "https://services2.arcgis.com/HdTo6HJqh92wn4D8/arcgis/rest/services/Parcels_view/FeatureServer/0/query";
async function attrsOf(base, field, id) {
  const u = `${base}?where=${encodeURIComponent(`${field}='${id}'`)}&outFields=*&returnGeometry=false&f=json`;
  const j = await (await fetch(u)).json();
  const a = j.features && j.features[0] && j.features[0].attributes;
  if (!a) throw new Error(`VOID: the county layer returned no row for ${id}`);
  return a;
}
const sq = (x, id, attrs, label) => ({ id, points: [{ x, y: 0 }, { x: x + 400, y: 0 }, { x: x + 400, y: 400 }, { x, y: 400 }], addr: "1 County Rd", attrs, gisKey: "k-" + id, label });
const mkSite = (sid, name, county, origin, parcels) => ({
  id: sid, groupId: sid, site: name, name: "Plan 1", origin, county, parcels, els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null,
  updatedAt: Date.now(), status: "active", schemaVersion: 12,
});
const tag = Math.random().toString(36).slice(2, 7);
const RS = "zz-tnr-" + tag, DS = "zz-tnd-" + tag;
const rut = [["r1", "156-027.00-000"], ["r2", "126-050.12-000"], ["r3", "103I-B-006.02-000"], ["r4", "152-024.03-000"]];
const dav = [["d1", "09400020000"], ["d2", "14401000500"], ["d3", "09305020600"]];
const rutParcels = [], davParcels = [];
for (let i = 0; i < rut.length; i++) rutParcels.push(sq(i * 400, rut[i][0], await attrsOf(RUTH, "ParcelID", rut[i][1]), rut[i][1]));
for (let i = 0; i < dav.length; i++) davParcels.push(sq(i * 400, dav[i][0], await attrsOf(DAV, "STANPAR", dav[i][1]), dav[i][1]));
const sites = [mkSite(RS, "ZZ TN Rutherford", "tn_rutherford", { lat: 35.85, lon: -86.39 }, rutParcels), mkSite(DS, "ZZ TN Davidson", "tn_davidson", { lat: 36.16, lon: -86.78 }, davParcels)];

const s = await openSignedIn({ base: BASE });
const { browser, page } = s;
const served = JSON.stringify(s.build);
console.log("signed in as", s.proof.email, "| served build", served);
const UID = await page.evaluate(async () => (await window.pfSupabase.auth.getUser()).data.user.id);
await page.evaluate(([uid, ss]) => {
  const k = "planarfit:sites:cloud:" + uid; const m = JSON.parse(localStorage.getItem(k) || "{}");
  for (const st of ss) m[st.id] = st; localStorage.setItem(k, JSON.stringify(m));
}, [UID, sites]);

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
async function openSite(name) {
  await page.goto(BASE + "/#/site-planner", { waitUntil: "load" });
  await page.reload({ waitUntil: "load" }); await sleep(3000);
  await page.getByText(name, { exact: false }).first().click();
  await T("planner-canvas").waitFor({ timeout: 25000 });
  await sleep(1500);
  await assertMeasurable(page, "verify-tn-tax-table-live");
  console.log("served build", await page.evaluate(async () => (await (await fetch("/version.json", { cache: "no-store" })).json()).build));
}
const tableText = async () => ((await T("parcel-tax-table").innerText().catch(() => "")) || "");

let failed = false;
try {
  await openSite("ZZ TN Rutherford");
  await openLot("r1");
  await T("parcel-tax-table").waitFor({ timeout: 20000 }).catch(() => {});
  let t = await tableText();
  if (!/Rutherford County/.test(t) || !/1\.876200/.test(t)) throw new Error("VOID: the known Rutherford lot did not render its table — " + JSON.stringify(t.slice(0, 300)));
  ok("known-good arm: 156-027.00-000 lists Rutherford County 1.876200", true);
  ok("county-only: no city row", !/City of|Town of/.test(t), JSON.stringify(t.slice(0, 160)));
  ok("estimate $7,056 with the 2026-values-× 2025-rates wording", /\$7,056/.test(t) && /2025 rates/.test(t) && /not a bill/.test(t), JSON.stringify(t.slice(-260)));
  ok("caption says 2025 rates and names the Comptroller", /2025 rates · Tennessee Comptroller/.test(t));

  await openLot("r2");
  await T("parcel-tax-table").waitFor({ timeout: 20000 });
  t = await tableText();
  ok("126-050.12-000: county + Murfreesboro, total 2.828800", /Rutherford County/.test(t) && /City of Murfreesboro\s+0\.952600/.test(t) && /2\.828800/.test(t), JSON.stringify(t.slice(0, 220)));
  ok("…estimate $124,346", /\$124,346/.test(t));

  await openLot("r3");
  await T("parcel-tax-table").waitFor({ timeout: 20000 });
  t = await tableText();
  ok("IDB lot: PILOT line, no rate table, no total, no estimate", /Industrial Development Board/.test(t) && !/Total/.test(t) && !/Rate per \$100/.test(t) && !/Estimate/.test(t), JSON.stringify(t.slice(0, 200)));

  await openLot("r4");
  await T("parcel-tax-table").waitFor({ timeout: 20000 });
  t = await tableText();
  ok("tax-freeze lot: rates, no estimate, freeze note", /1\.876200/.test(t) && !/Estimate/.test(t) && /freeze/i.test(t), JSON.stringify(t.slice(0, 200)));

  await openSite("ZZ TN Davidson");
  await openLot("d1");
  await T("parcel-tax-table").waitFor({ timeout: 20000 }).catch(() => {});
  t = await tableText();
  ok("09400020000 (USD): GSD 2.782000 + USD 0.032000 = 2.814000", /General Services District\s+2\.782000/.test(t) && /Urban Services District\s+0\.032000/.test(t) && /2\.814000/.test(t), JSON.stringify(t.slice(0, 260)));
  ok("Davidson shows no dollar estimate", !/Estimate/.test(t));
  await openLot("d2");
  await T("parcel-tax-table").waitFor({ timeout: 20000 });
  t = await tableText();
  ok("14401000500: GSD + City of Belle Meade, total 3.083100", /City of Belle Meade\s+0\.301100/.test(t) && /3\.083100/.test(t), JSON.stringify(t.slice(0, 260)));
  await openLot("d3"); await sleep(3000);
  ok("a CBID (business-improvement-district) lot shows NO table", (await T("parcel-tax-table").count()) === 0);
} catch (e) {
  failed = true; console.log("ERROR —", e.message);
} finally {
  try {
    for (const id of [RS, DS]) {
      await page.evaluate(([uid, sid]) => { const k = "planarfit:sites:cloud:" + uid; const m = JSON.parse((globalThis.__planyrSitesRaw || ((x) => localStorage.getItem(x)))(k) || "{}"); delete m[sid]; localStorage.setItem(k, JSON.stringify(m)); }, [UID, id]);
      await page.evaluate(async (sid) => {
        await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", sid);
        await window.pfSupabase.from("site_elements").delete().eq("site_id", sid);
        await window.pfSupabase.from("sites").delete().eq("id", sid);
      }, id);
      const left = await page.evaluate(async (sid) => { const { data } = await window.pfSupabase.from("sites").select("id").eq("id", sid); return (data || []).length; }, id);
      console.log(left === 0 ? `cleanup — ${id} purged (verified)` : `cleanup — WARNING: ${left} row(s) for ${id} remain`);
    }
  } catch (e) { console.log("cleanup error —", e.message); }
  await browser.close();
}
const bad = results.filter((r) => !r.pass);
console.log(`\n${results.length - bad.length}/${results.length} passed${failed ? " (RUN ABORTED)" : ""} | served build ${served}`);
process.exit(bad.length || failed ? 1 : 0);
