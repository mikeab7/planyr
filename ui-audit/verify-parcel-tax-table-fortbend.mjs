/* verify-parcel-tax-table-fortbend — the Fort Bend county lot's TAX table (NEW-1), driven against a live deploy.
 *
 * Throwaway FORT BEND plan (cleaned up at the end, owner constraint 15) whose county lots carry FBCAD account numbers (QUICKREFID):
 * R130561 (Stafford: C19 · D01 · G01 · J03 · S11 · W03), R33231 (Sugar Land: C21 · D01 · G01 · S07), R169774 (carries M256, a unit
 * no rate source publishes → the table must be HIDDEN), plus a drawn lot.
 *   KNOWN-GOOD ARM (independent of the code under test): the unit codes the FBCAD parcel layer itself lists for the account
 *   (read straight from the layer in the page) must each appear in /api/taxunits for R33231 — the run is VOID otherwise.
 *   page   — each known account renders "Tax rates": a name per unit, the rows SUM to the Total, the caption names a four-digit year
 *   hide   — R169774 and a drawn lot show NO table (complete or hidden, never a guess)
 * Usage: SIGNED_IN=1 BASE_URL=https://planyr.io node ui-audit/verify-parcel-tax-table-fortbend.mjs
 */
import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const BASE = (process.env.BASE_URL || "http://localhost:4173").replace(/\/$/, "");
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sq = (x, y, id, extra = {}) => ({ id, points: [{ x, y }, { x: x + 400, y }, { x: x + 400, y: y + 400 }, { x, y: y + 400 }], ...extra });
const lot = (x, id, hcad, label) => sq(x, 0, id, { acct: hcad, addr: "1 County Rd", attrs: { QUICKREFID: hcad, OWNER: "Test" }, gisKey: "k-" + id, label });
const SITE_ID = "zz-tax-fb-" + Math.random().toString(36).slice(2, 7);
const site = {
  id: SITE_ID, groupId: SITE_ID, site: "ZZ Tax Table FB", name: "Plan 1", origin: { lat: 29.62, lon: -95.63 }, county: "fortbend",
  parcels: [lot(0, "p1", "R130561", "Stafford"), lot(400, "p2", "R33231", "Sugar Land"), lot(800, "p3", "R169774", "Has M256"), sq(1200, 0, "p4", { label: "Drawn Lot" })],
  els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), status: "active", schemaVersion: 12,
};

const SIGNED = !!process.env.SIGNED_IN;
let browser, ctx, page, UID = null;
if (SIGNED) {
  const s = await openSignedIn({ base: BASE });
  browser = s.browser; ctx = s.context; page = s.page;
  console.log("signed in as", s.proof.email, "| served build", JSON.stringify(s.build));
  UID = await page.evaluate(async () => (await window.pfSupabase.auth.getUser()).data.user.id);
  await page.evaluate(([uid, st]) => { localStorage.setItem("planarfit:sites:cloud:" + uid, JSON.stringify({ [st.id]: st })); localStorage.setItem("planarfit:currentSite:v1", st.id); }, [UID, site]);
} else {
  const exe = existsSync(chromium.executablePath()) ? undefined : "/opt/pw-browsers/chromium";
  browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await ctx.newPage();
  await page.addInitScript((s) => { try { if (!localStorage.getItem("zz-seeded-" + s.id)) { localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [s.id]: s })); localStorage.setItem("planarfit:currentSite:v1", s.id); localStorage.setItem("zz-seeded-" + s.id, "1"); } } catch (_) {} }, site);
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
  await page.goto(BASE + "/#/site-planner", { waitUntil: "load" });
  if (SIGNED) { await page.reload({ waitUntil: "load" }); await sleep(3000); }
  await page.getByText("ZZ Tax Table FB", { exact: false }).first().click();
  await T("planner-canvas").waitFor({ timeout: 25000 });
  await sleep(1500);
  await assertMeasurable(page, "verify-parcel-tax-table-fortbend");
  console.log("served build", await page.evaluate(async () => (await (await fetch("/version.json", { cache: "no-store" })).json()).build));

  // KNOWN-GOOD ARM — the layer's own list, read in the page (CORS-open), compared to what our function reports.
  const layerCodes = await page.evaluate(async () => {
    const u = "https://services2.arcgis.com/D4saGHECICkCeoJm/arcgis/rest/services/FBCAD_Public_Data/FeatureServer/0/query?where=QUICKREFID%3D%27R33231%27&outFields=TAXUNITS&returnGeometry=false&f=json";
    const j = await (await fetch(u)).json();
    return String(j.features[0].attributes.TAXUNITS).split(",").map((c) => c.trim()).filter((c) => c && c !== "CAD").sort();
  });
  const api = await page.evaluate(async () => (await fetch("/api/taxunits?county=fortbend&acct=R33231", { cache: "no-store" })).json());
  console.log("api R33231 ->", JSON.stringify(api).slice(0, 700));
  if (!api.complete || JSON.stringify(api.units.map((u) => u.code).sort()) !== JSON.stringify(layerCodes)) throw new Error("VOID: /api/taxunits did not list the layer's own units for R33231 — layer " + layerCodes + " api " + JSON.stringify(api).slice(0, 200));
  ok("known-good arm: /api/taxunits for R33231 lists exactly the FBCAD layer's units " + layerCodes.join(","), true);

  const sumRows = (txt) => {
    const nums = [...txt.matchAll(/(\d\.\d{6})/g)].map((m) => Number(m[1]));
    const total = nums.pop();
    return { sum: Math.round(nums.reduce((s, n) => s + n, 0) * 1e6) / 1e6, total, n: nums.length };
  };
  for (const [id, label, names] of [["p1", "Stafford R130561", ["City of Stafford", "General Fund", "Stafford MSD"]], ["p2", "Sugar Land R33231", ["City of Sugar Land", "General Fund", "Fort Bend ISD"]]]) {
    await openLot(id);
    await T("parcel-tax-table").waitFor({ timeout: 30000 });
    const txt = await T("parcel-tax-table").innerText();
    const cap = await T("parcel-tax-caption").innerText();
    console.log(label, "->", JSON.stringify(txt.replace(/\s+/g, " ")), "|", cap);
    const r = sumRows(txt);
    ok(label + ": names " + names.join(" / "), names.every((n) => txt.includes(n)));
    ok(label + ": rows sum to the Total (" + r.sum + " = " + r.total + ", " + r.n + " rows)", r.n >= 4 && r.sum === r.total);
    ok(label + ": caption names the source and a four-digit year", /Fort Bend County Tax Office/.test(cap) && /\b20\d\d\b/.test(cap), cap);
  }
  await openLot("p3"); await sleep(8000);
  ok("R169774 (unit M256 has no published rate) shows NO table", (await T("parcel-tax-table").count()) === 0);
  await openLot("p4"); await sleep(1500);
  ok("a drawn lot shows NO table", (await T("parcel-tax-table").count()) === 0);
} catch (e) {
  failed = true; console.log("ERROR —", e.message);
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
