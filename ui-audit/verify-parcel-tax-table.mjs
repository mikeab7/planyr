/* verify-parcel-tax-table — the county lot's TAX table (B2158065), driven against a live deploy.
 *
 * Throwaway site (cleaned up at the end, owner constraint 15) with HARRIS county lots whose HCAD accounts are
 * KNOWN: 0591420000105 (8203 John Martin Rd — the CAD's own page lists 8 units, total 1.970988) and
 * 0421030000123 (Silvestri SCHIEL). Also a DRAWN lot and a county lot with an account HCAD does not have.
 *   page   — county lot page shows "Tax rates": the eight CAD units, Total 1.970988, tax year in the caption
 *   hide   — a drawn lot and an unknown-account lot show NO table (complete or hidden, never a guess)
 *   combine— two county lots with different totals → "lots differ"; the same lot twice would say "all lots share it"
 * KNOWN-GOOD ARM: the run is VOID unless the page for 0591420000105 reports exactly the CAD's eight codes' names.
 * Usage: SIGNED_IN=1 BASE_URL=https://planyr.io node ui-audit/verify-parcel-tax-table.mjs
 */
import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const BASE = (process.env.BASE_URL || "http://localhost:4173").replace(/\/$/, "");
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EXPECT = ["GOOSE CREEK CISD", "HARRIS COUNTY", "HARRIS CO FLOOD CNTRL", "PORT OF HOUSTON AUTHY", "HARRIS CO HOSP DIST", "HARRIS CO EDUC DEPT", "LEE JR COLLEGE DIST", "HC EMERG SRV DIST 14"];

const sq = (x, y, id, extra = {}) => ({ id, points: [{ x, y }, { x: x + 400, y }, { x: x + 400, y: y + 400 }, { x, y: y + 400 }], ...extra });
const lot = (x, id, hcad, label) => sq(x, 0, id, { acct: hcad, addr: "1 County Rd", attrs: { HCAD_NUM: hcad, OWNER: "Test" }, gisKey: "k-" + id, label });
const SITE_ID = "zz-tax-" + Math.random().toString(36).slice(2, 7);
const site = {
  id: SITE_ID, groupId: SITE_ID, site: "ZZ Tax Table", name: "Plan 1", origin: { lat: 29.76, lon: -95.37 }, county: "harris",
  parcels: [lot(0, "p1", "0591420000105", "John Martin"), lot(400, "p2", "0421030000123", "Silvestri"), lot(800, "p3", "0000000000001", "Unknown Acct"), sq(1200, 0, "p4", { label: "Drawn Lot" })],
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
  await page.getByText("ZZ Tax Table", { exact: false }).first().click();
  await T("planner-canvas").waitFor({ timeout: 25000 });
  await sleep(1500);
  await assertMeasurable(page, "verify-parcel-tax-table");
  console.log("served build", await page.evaluate(async () => (await (await fetch("/version.json", { cache: "no-store" })).json()).build));

  await openLot("p1");
  await T("parcel-tax-table").waitFor({ timeout: 30000 }).catch(() => {});
  const txt = (await T("parcel-tax-table").innerText().catch(() => "")) || "";
  if (!EXPECT.every((n) => txt.includes(n))) throw new Error("VOID: the known account did not render the CAD's eight units — " + JSON.stringify(txt.slice(0, 300)));
  ok("known-good arm: John Martin lists the CAD's eight units", true);
  ok("Total reads 1.970988", /Total[\s\S]*1\.970988/.test(txt), JSON.stringify(txt.slice(-80)));
  ok("Goose Creek CISD shows 1.070000", /GOOSE CREEK CISD\s+1\.070000/.test(txt));
  ok("caption names the tax year", /2025/.test(txt) && /Appraisal District/.test(txt), JSON.stringify(txt.slice(-120)));

  await openLot("p2");
  await T("parcel-tax-table").waitFor({ timeout: 30000 });
  ok("Silvestri (0421030000123) shows a table with a Total", /Total[\s\S]*\d\.\d{6}/.test(await T("parcel-tax-table").innerText()), JSON.stringify((await T("parcel-tax-table").innerText()).slice(-60)));

  await openLot("p3"); await sleep(6000);
  ok("a county lot HCAD does not know shows NO table", (await T("parcel-tax-table").count()) === 0);
  await openLot("p4"); await sleep(1500);
  ok("a drawn lot shows NO table", (await T("parcel-tax-table").count()) === 0);

  await T("parcel-page-back").click(); await T("parcels-panel").waitFor({ timeout: 8000 });
  await T("parcel-row-check-p1").check(); await T("parcel-row-check-p2").check();
  await T("parcels-bar-combine").click(); await sleep(800);
  console.log("list after combine:", JSON.stringify((await page.locator('[data-testid^="parcel-table-row-"]').allInnerTexts()).map((t) => t.replace(/\s+/g, " ").slice(0, 80))));
  const combinedRow = page.locator('[data-testid^="parcel-table-row-"]').filter({ hasText: /Combined from 2 lots/ });
  await combinedRow.locator('[data-testid^="parcel-row-"]:not([data-testid*="check"]):not([data-testid*="eye"]):not([data-testid*="acres"])').first().click();
  await T("parcel-page").waitFor({ timeout: 8000 });
  await T("parcel-tax-table").waitFor({ timeout: 30000 });
  const ct = await T("parcel-tax-table").innerText();
  ok("combined parcel of two different totals says the lots differ", /lots differ/.test(ct) && /John Martin/.test(ct) && /Silvestri/.test(ct), JSON.stringify(ct.slice(0, 200)));
} catch (e) {
  failed = true; console.log("ERROR —", e.message);
} finally {
  // owner constraint 15: test artifacts are always cleared, and the clear is verified.
  if (SIGNED && UID) {
    try {
      await page.evaluate(([uid, id]) => { const k = "planarfit:sites:cloud:" + uid; const m = JSON.parse(localStorage.getItem(k) || "{}"); delete m[id]; localStorage.setItem(k, JSON.stringify(m)); }, [UID, SITE_ID]);
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
