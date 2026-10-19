#!/usr/bin/env node
/* verify-comp-broker-paste — B2345504 / B2345505 live check (V1776032, V1776033).
 *
 *   node ui-audit/verify-comp-broker-paste.mjs --live https://planyr.io [--expect <sha>]
 *
 * Signed in as the TEST ACCOUNT only (ui-audit/lib/signedInSession.mjs). Two arms:
 *  PASTE — pastes test/fixtures/brokerLeaseComps/nHoustonShape.tsv (the owner's header row, invented
 *          values) into Map › Records › ＋ Paste comps, checks the footer, saves, then reads the saved
 *          rows back from the database (after a reload) and checks every field, the pin position, the
 *          county and the site link.
 *  KML   — imports a one-placemark KML, promotes it, and checks the saved comp's county + site link.
 * Everything it creates (comps, the import draft, tracked sites) is deleted at the end, pass or fail. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable, pacedWait } from "./lib/tabTiming.mjs";

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const BASE = (arg("--live", "https://planyr.io")).replace(/\/$/, "");
const EXPECT = arg("--expect", null);
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = fs.readFileSync(path.join(here, "..", "test", "fixtures", "brokerLeaseComps", "nHoustonShape.tsv"), "utf8");
const TITLES = [
  "Example Logistics Park Bldg 2 - Acme Widgets LLC", "4400 Sample Rd - Fictional Freight Co", "Demo Commerce Center - Test Pallet Supply",
  "Mock Distribution Ctr - Widget Holdings", "Example Gateway - Placeholder Foods",
];
const KML_NAME = "zz-V1776033 KML promote";

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };

const s = await openSignedIn({ base: BASE, viewport: { width: 1600, height: 1000 } });
const { page } = s;
const version = await page.evaluate(async (b) => (await fetch(`${b}/version.json`, { cache: "no-store" })).json().catch(() => null), BASE);
console.log(`signed in as ${s.proof.email} · served build ${JSON.stringify(version)}`);
if (EXPECT) check(`served build is ${EXPECT}`, JSON.stringify(version || {}).includes(EXPECT.slice(0, 7)));

const db = (fn, a) => page.evaluate(fn, a);
async function cleanup() {
  await db(async ({ titles, kmlName }) => {
    const sb = window.pfSupabase;
    const { data: u } = await sb.auth.getUser();
    const uid = u.user.id;
    const { data: rows } = await sb.from("comps").select("id,project_id,title,notes").eq("user_id", uid);
    const mine = (rows || []).filter((r) => titles.includes(r.title) || r.title === kmlName || (r.notes || "").includes("zz-V1776033"));
    const siteIds = [...new Set(mine.map((r) => r.project_id).filter(Boolean))];
    if (mine.length) await sb.from("comps").delete().in("id", mine.map((r) => r.id));
    for (const id of siteIds) {
      const { data: site } = await sb.from("sites").select("id,data").eq("id", id).maybeSingle();
      if (site && site.data && site.data.role === "tracked" && site.id !== "e2e-fixture-site") await sb.from("sites").delete().eq("id", id);
    }
    await sb.from("comp_import_drafts").delete().eq("raw_name", kmlName);
  }, { titles: TITLES, kmlName: KML_NAME });
}
const readSaved = () => db(async (titles) => {
  const sb = window.pfSupabase;
  const { data: u } = await sb.auth.getUser();
  const { data } = await sb.from("comps").select("*").eq("user_id", u.user.id).is("deleted_at", null).in("title", titles);
  return data || [];
}, TITLES);

async function openRecords() {
  await page.goto(`${BASE}/#/site`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("load").catch(() => {});
  await pacedWait(page, 5000);
  for (let i = 0; ; i++) {
    try { await assertMeasurable(page, "verify-comp-broker-paste"); break; } catch (e) { if (i >= 3 || !/context was destroyed|navigation/i.test(String(e))) throw e; await pacedWait(page, 2500); }
  }
  const tab = page.getByRole("tab", { name: /^Records/ }).first();
  if ((await tab.getAttribute("aria-selected")) !== "true") await tab.evaluate((el) => el.click());
  await pacedWait(page, 800);
}

try {
  await cleanup(); // a previous aborted run's leftovers never count
  // ---- PASTE arm ------------------------------------------------------------------------------
  console.log("\n=== PASTE (V1776032) ===");
  await openRecords();
  await page.getByText("＋ Paste comps", { exact: true }).click();
  await pacedWait(page, 600);
  const ta = page.locator("textarea").first();
  await ta.click();
  await ta.fill(FIXTURE.trim());
  await page.keyboard.press("Enter");
  await pacedWait(page, 1500);
  const dialogText = async () => (await page.locator('[role="grid"]').first().evaluate((el) => el.closest('[role="dialog"]')?.innerText || document.body.innerText));
  let txt = "";
  for (let i = 0; i < 20; i++) { txt = await dialogText(); if (/5 comps ready/.test(txt)) break; await pacedWait(page, 500); }
  check('footer reads "5 comps ready"', /5 comps ready/.test(txt), (txt.match(/\d+ comps?[^.\n]*/) || [""])[0]);
  check("no 'guessed' / 'has no period' warnings", !/guessed|no monthly\/annual period|Rate has no period/i.test(txt));
  // Give the county lookups a moment, then save.
  await pacedWait(page, 4000);
  await page.getByRole("button", { name: /^Save 5 comps$/ }).click();
  let saved = [];
  for (let i = 0; i < 40; i++) { saved = await readSaved(); if (saved.length >= 5 && saved.every((r) => r.project_id)) break; await pacedWait(page, 500); }
  await page.reload({ waitUntil: "domcontentloaded" });
  await pacedWait(page, 4000);
  saved = await readSaved();
  check("5 comps saved and still there after a reload", saved.length === 5, `${saved.length}`);
  const byTitle = Object.fromEntries(saved.map((r) => [r.title, r]));
  const a = byTitle[TITLES[0]] || {};
  check("row 1 fields", a.comp_type === "lease" && Number(a.lease_rate) === 0.665 && a.lease_rate_period === "monthly" && a.lease_rate_expense === "nnn" &&
    a.comp_date === "2026-06-01" && a.lease_commencement_date === "2026-08-01" && /126/.test(a.lease_term || "") && Number(a.lease_size_sf) === 100043 &&
    Number(a.lease_free_rent_months) === 6 && Number(a.lease_escalation_pct) === 3.75 && Number(a.lease_ti) === 10 && Number(a.clear_height_ft) === 32 &&
    Number(a.year_built) === 2026 && a.comp_party_provider === "Sample Industrial REIT" && a.comp_party_acquirer === "Acme Widgets LLC",
    JSON.stringify({ rate: a.lease_rate, per: a.lease_rate_period, date: a.comp_date, term: a.lease_term, ch: a.clear_height_ft, yb: a.year_built }));
  check("row 1 notes keep the non-field columns", ["Expires Jan-37", "Submarket:", "City: Houston", "Total Building SF: 412,500", "Lease Transaction Type: New Lease", "Load Type: Front Load"].every((b) => (a.notes || "").includes(b)), a.notes);
  check("row 1 pin at exactly x/y", Number(a.lat) === 29.927004 && Number(a.lon) === -95.442043, `${a.lat}, ${a.lon}`);
  check("all 5 rates kept their precision", JSON.stringify(TITLES.map((t) => Number(byTitle[t]?.lease_rate))) === JSON.stringify([0.665, 0.645, 0.595, 0.575, 0.535]));
  check("every saved comp has a county", saved.every((r) => r.county), saved.map((r) => r.county).join(","));
  check("every saved comp is linked to a site", saved.every((r) => r.project_id));
  check("prose free rent: months + text in Notes", Number(byTitle[TITLES[1]]?.lease_free_rent_months) === 6 && (byTitle[TITLES[1]]?.notes || "").includes("Free rent: 6 mo $0.37 NNN"));

  // ---- KML arm --------------------------------------------------------------------------------
  console.log("\n=== KML promote (V1776033) ===");
  await openRecords();
  const kml = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>${KML_NAME}</name>` +
    `<description>Lease, $0.70/SF/mo NNN, 20,000 SF; zz-V1776033</description><Point><coordinates>-95.4012,29.7701,0</coordinates></Point></Placemark></Document></kml>`;
  await page.locator('input[type="file"][accept=".kml,.kmz"]').setInputFiles({ name: "zz-v1776033.kml", mimeType: "application/vnd.google-earth.kml+xml", buffer: Buffer.from(kml) });
  await pacedWait(page, 3000);
  const promote = page.getByRole("button", { name: "Promote to comp" }).first();
  await promote.waitFor({ timeout: 15000 });
  await promote.click();
  let k = null;
  for (let i = 0; i < 40; i++) {
    k = await db(async () => {
      const sb = window.pfSupabase; const { data: u } = await sb.auth.getUser();
      const { data } = await sb.from("comps").select("id,county,project_id,lat,lon,notes").eq("user_id", u.user.id).ilike("notes", "%zz-V1776033%").maybeSingle();
      if (!data) return null;
      const { data: site } = data.project_id ? await sb.from("sites").select("id,site,data").eq("id", data.project_id).maybeSingle() : { data: null };
      return { ...data, siteRole: site?.data?.role || null, siteName: site?.site || null };
    });
    if (k) break;
    await pacedWait(page, 500);
  }
  check("promoted comp saved", !!k);
  check("promoted comp has a county", !!k?.county, k?.county);
  check("promoted comp is linked to a site", !!k?.project_id, `${k?.siteName} [${k?.siteRole}]`);
} finally {
  await cleanup().catch((e) => console.log("cleanup error", e));
  const left = await readSaved().catch(() => null);
  console.log(`\ncleanup: ${left ? left.length : "?"} test comps left`);
  await s.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
