/* NEW-1 (B2507136, Missouri second pass 2026-10-29) — the LIVE signed-in check: click real lots in the four counties the second pass wired
 * (Franklin, Cass, Clinton, Hickory) on planyr.io and require the app to select THE lot the county's own source holds there, then click a still-gap county (Carroll, Pike) and require the plain-words reason and the request link.
 *
 * GROUND TRUTH is independent of the app's code path: every expected parcel id below was read DIRECTLY from the source on 2026-10-29
 * (Franklin: the county's ArcGIS Online layer; Cass: MARC's layer; Clinton / Hickory: GIS Cloud's own public API, point decided by exact
 * point-in-polygon) at a point chosen to be inside a lot — not from the adapter or the app. KNOWN-GOOD CONTROL arm: a long-wired Missouri
 * county (Callaway) must select a lot; if it does not, the run is VOID (exit 2), never a score.
 * /version.json is read in the same call as every row.
 *
 * Run: E2E_LOGIN_KEY=… node ui-audit/verify-missouri-second-pass-live.mjs [https://planyr.io] [--out f.json] [--expect-build <sha>]
 * The Add-parcel arm (V1956944 step 7) uses ONE throwaway plan (zz-livechk-…), deleted at the end with the deletion re-read (owner rule 15). */
import { readFileSync, writeFileSync } from "node:fs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { LIVE_PREFIX, throwawayPlan, cleanupLive } from "./lib/liveFixtures.mjs";
import { COUNTIES } from "../src/workspaces/site-planner/lib/counties.js";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const BASE = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const OUT = flag("--out") || "missouri-second-pass-live.json";
const EXPECT_BUILD = flag("--expect-build");

const POINTS = [
  { name: "CONTROL Callaway (wired 2026-10-19)", key: "mo_callaway", lat: 38.8465, lng: -91.9487, control: true },
  { name: "Franklin — Union", key: "mo_franklin", lat: 38.45131213859222, lng: -91.0149807758061, expect: "17-8-27.0-1-015-313.000" },
  { name: "Franklin — Washington", key: "mo_franklin", lat: 38.5581, lng: -91.0123, expect: "10-5-22.0-1-050-205.000" },
  { name: "Franklin — Sullivan (rural)", key: "mo_franklin", lat: 38.2081, lng: -91.1605, expect: "35-5-16.0-2-000-004.000" },
  { name: "Cass — Harrisonville", key: "mo_cass", lat: 38.653, lng: -94.35, expect: "132141301000060000", copy: true },
  { name: "Cass — Raymore", key: "mo_cass", lat: 38.805, lng: -94.452, expect: "040515200003002055", copy: true },
  { name: "Cass — rural, near Archie", key: "mo_cass", lat: 38.49, lng: -94.35, expect: "180828000000011000", copy: true },
  { name: "Clinton — Plattsburg", key: "mo_clinton", lat: 39.5654, lng: -94.4505, expect: "11-06.0-24-002-039-007.000" },
  { name: "Clinton — Cameron", key: "mo_clinton", lat: 39.74146008632101, lng: -94.23695153526326, expect: "01-06.0-23-002-030-005.000" },
  { name: "Hickory — Hermitage", key: "mo_hickory", lat: 37.945307671896856, lng: -93.3234807222167, expect: "06-6.0-23-002-003-001.000" },
  { name: "Hickory — Wheatland", key: "mo_hickory", lat: 37.936070941421285, lng: -93.40689822721653, expect: "05-7.0-25-000-000-002.000" },
  { name: "GAP Carroll — Carrollton", key: null, lat: 39.3586, lng: -93.4994, gap: "Carroll" },
  { name: "GAP Pike — Bowling Green", key: null, lat: 39.3425, lng: -91.1953, gap: "Pike" },
];

let s = null;
for (let attempt = 1; attempt <= 8 && !s; attempt++) {
  try { s = await openSignedIn({ base: BASE, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] }); }
  catch (e) { if (!/answered 50\d/.test(String(e.message)) || attempt === 8) throw e; await new Promise((r) => setTimeout(r, 25000)); }
}
const page = s.page;
await assertMeasurable(page, "verify-missouri-second-pass-live");
console.log(`signed in as ${s.proof.email} · build ${JSON.stringify(s.build)} · ${POINTS.length} points`);
if (EXPECT_BUILD && s.build && !String(s.build.build || s.build).startsWith(EXPECT_BUILD)) console.log(`⚠ build ${JSON.stringify(s.build)} is not the expected ${EXPECT_BUILD}`);

const sleep = (ms) => page.waitForTimeout(ms);
const stamp = () => page.evaluate(async () => { const v = await fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null); return v && v.build; });
async function freshMap() {
  await page.goto(BASE + "/?planyrDiag=1#/site", { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__mapFinderMap && !!document.querySelector('[data-testid="map-toolbar-select-parcels"]'), null, { timeout: 45000 });
  await sleep(2500);
}
/* The Map re-centres itself shortly after it loads, so one setView can be undone — set it, then CHECK it held, and repeat (as the Illinois / Iowa harnesses do). */
const setView = async (la, ln, z) => {
  for (let i = 0; i < 8; i++) {
    await page.evaluate(([a, b, c]) => window.__mapFinderMap.setView([a, b], c, { animate: false }), [la, ln, z]);
    await sleep(2500);
    const ok = await page.evaluate(([a, b, c]) => { const m = window.__mapFinderMap, k = m.getCenter(); return Math.abs(k.lat - a) < 0.01 && Math.abs(k.lng - b) < 0.01 && m.getZoom() === c; }, [la, ln, z]);
    if (ok) return;
  }
  throw new Error(`the map would not hold ${la},${ln}`);
};
const screenOf = ([la, ln]) => page.evaluate(([a, b]) => { const m = window.__mapFinderMap, p = m.latLngToContainerPoint([a, b]), r = m.getContainer().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; }, [la, ln]);

/* Select parcels first LOADS the outlines in view (a county-wide envelope query), and only then does a click pick a held lot — so the harness waits for
 * the held outlines (the app's own read-only __mapParcelDisplay hook) before it clicks, exactly as the Illinois / Iowa live harnesses do. */
const waitFor = async (fn, ms = 8000) => { const t = Date.now(); let v; while (Date.now() - t < ms) { v = await fn(); if (v) return v; await sleep(250); } return v; };
const heldOutlines = () => page.evaluate(() => { const d = window.__mapParcelDisplay && window.__mapParcelDisplay(); return d ? d.held : 0; }).catch(() => 0);
const held = () => page.evaluate(() => (window.__mapSelectedParcels ? window.__mapSelectedParcels() : [])).catch(() => []);
const idOf = (attrs, field) => { if (!attrs) return null; const k = Object.keys(attrs).find((x) => x.split(".").pop().toLowerCase() === String(field).toLowerCase()); return k && String(attrs[k] ?? "").trim() ? String(attrs[k]).trim() : null; };

/* Add-parcel (the planner's Land › Add by address) geocodes through ArcGIS; the harness answers that one call with the exact point asked for so the lookup is on OUR coordinates. */
let geoTarget = null;
await page.route(/geocode\.arcgis\.com\/.*findAddressCandidates/, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ candidates: geoTarget ? [{ address: `${geoTarget.lat},${geoTarget.lng}`, location: { x: geoTarget.lng, y: geoTarget.lat }, score: 100 }] : [] }) }));
const PLAN_ID = `${LIVE_PREFIX}mo2-${Date.now().toString(36)}`;
let planMade = false;

const rows = [];
const record = (r) => { rows.push(r); console.log(`  [${r.pass ? "PASS" : "FAIL"}] ${r.name} · expect ${r.expect || r.gap || "a lot"} · got ${r.got || r.message || "nothing"}${r.note ? " · " + r.note : ""}`); };

async function clickPoint(pt) {
  await freshMap();
  await setView(pt.lat, pt.lng, 17);
  await page.locator('[data-testid="map-toolbar-select-parcels"]').first().click();
  const outlines = pt.gap ? 0 : await waitFor(async () => { const n = await heldOutlines(); return n > 0 ? n : 0; }, 45000);
  await sleep(800);
  const c = await screenOf([pt.lat, pt.lng]);
  await page.mouse.click(c.x, c.y);
  let sel = [];
  if (!pt.gap) sel = await waitFor(async () => { const h = await held(); return h.length ? h : null; }, 25000) || [];
  else await sleep(6000);
  const text = await page.evaluate(() => document.body.innerText);
  const x = sel[sel.length - 1];
  return { outlines, text, attrs: x ? x.attrs : null, acct: x ? String(x.acct || "").trim() : "", nSel: sel.length, keys: x ? Object.keys(x.attrs || {}).slice(0, 8).join(",") : "" };
}

let voided = false;
try {
  for (const pt of POINTS.filter((p) => !flag("--only") || p.name.includes(flag("--only")))) {
    try {
      const r = await clickPoint(pt);
      const build = await stamp();
      if (pt.gap) {
        const said = /no parcel data wired here yet|hasn't found a public parcel map|couldn't find/i.test(r.text) || new RegExp(pt.gap + " County", "i").test(r.text);
        const link = /Email Michael to request it/i.test(r.text);
        const lot = r.attrs && Object.keys(r.attrs).length;
        record({ name: pt.name, gap: pt.gap, got: lot ? "A LOT (should be none)" : said ? "reason sentence" : "nothing", message: link ? "request link shown" : "NO request link", build, pass: !lot && said && link });
        continue;
      }
      /* the id the parcel card shows (the app's own `acct`), falling back to the county's configured id column */
      const got = r.acct || idOf(r.attrs, COUNTIES[pt.key].idField);
      let pass = !!got && (pt.control || got === pt.expect);
      let note = null;
      note = (note ? note + " · " : "") + `outlines ${r.outlines}, selected ${r.nSel}${r.keys ? ", fields " + r.keys : ""}`;
      record({ name: pt.name, expect: pt.expect, got, build, note, pass });
      if (pt.control && !pass) voided = true;
    } catch (e) {
      record({ name: pt.name, expect: pt.expect, message: "harness error: " + String(e.message).slice(0, 140), pass: false });
      if (pt.control) voided = true;
    }
  }
  /* The copy line lives on the ADDRESS-SEARCH card (and the planner's Add-parcel result) — a plain map click shows only the selection summary, as for every
   * copy county. So Cass's label is checked where it is shown: type a Cass address, read the card's own line; Callaway (the county's own file) is the control and
   * must show NO line. */
  for (const a of [
    { name: "Cass — address-search card carries the copy line", q: "100 E Wall St, Harrisonville, MO", at: { lat: 38.653, lng: -94.35 }, copy: true },
    { name: "CONTROL Callaway — address-search card carries NO copy line", q: "301 Court St, Fulton, MO", at: { lat: 38.8465, lng: -91.9487 }, copy: false },
  ]) {
    try {
      geoTarget = a.at; /* the ArcGIS geocoder call is answered with this exact point (deterministic) */
      let cardUp = a.copy;
      for (let attempt = 1; attempt <= 2; attempt++) { /* the address lookup is a live geocoder — one retry before calling the card absent */
      await freshMap();
      const inp = page.getByPlaceholder(/Type an address/);
      await inp.fill(a.q); await sleep(1500); await inp.press("Enter");
      if (a.copy) break;
      cardUp = await page.waitForFunction(() => /POSTAL SERVICE|301 COURT/i.test(document.body.innerText), null, { timeout: 40000 }).then(() => true, () => false);
      if (cardUp) break;
      }
      const line = page.getByTestId("parcel-card-copy-line");
      const card = page.getByTestId("parcel-card-copy");
      const text = a.copy ? await line.first().waitFor({ timeout: 40000 }).then(() => line.first().innerText(), () => "") : "";
      /* the control is only meaningful once the card for that address is really up (else "no line" is vacuous) */
      if (!a.copy) await sleep(3000);
      const n = await card.count();
      const pass = a.copy ? /Copy of Cass County parcel data published by Mid-America Regional Council/.test(text) && /September 2025/.test(text) && /not the county.s own/.test(text) : cardUp && n === 0;
      record({ name: a.name, expect: a.copy ? "copy line with publisher + date" : "no copy line", got: a.copy ? (text || "no line") : (!cardUp ? "the Callaway card never appeared (control void)" : n === 0 ? "no line" : "A LINE (should be none)"), build: await stamp(), pass });
    } catch (e) { record({ name: a.name, message: "harness error: " + String(e.message).slice(0, 140), pass: false }); }
  }
  /* V1956944 step 7 — Add-parcel inside a throwaway plan: one lot per newly wired county lands on the plan, and it is THE lot the source holds there. */
  try {
    const plan = { ...throwawayPlan(PLAN_ID), origin: { lat: 38.45, lon: -91.01 }, site: "ZZ Live Check — Missouri second pass" };
    const err = await page.evaluate(async ([pl]) => {
      const { data: u } = await window.pfSupabase.auth.getUser();
      const { error } = await window.pfSupabase.from("sites").insert({ id: pl.id, group_id: pl.groupId, site: pl.site, name: pl.name, county: null, user_id: u.user.id, version: 1, data: pl });
      return error ? String(error.message) : null;
    }, [plan]);
    if (err) throw new Error("throwaway plan insert failed — " + err);
    planMade = true;
    await page.goto(`${BASE}/?planyrDiag=1#/project/${PLAN_ID}/site`, { waitUntil: "domcontentloaded" });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="land-add-btn"]', { timeout: 60000 }).catch(async () => { await page.getByRole("button", { name: /^Land$/ }).first().click().catch(() => {}); await page.waitForSelector('[data-testid="land-add-btn"]', { timeout: 30000 }); });
    await sleep(2000);
    const addAt = async (p) => {
      geoTarget = { lat: p.lat, lng: p.lng };
      await page.locator('[data-testid="land-add-btn"]').first().click();
      const input = page.locator('input[placeholder="123 Main St, Katy TX"]').first();
      await input.waitFor({ timeout: 8000 });
      await input.fill(`${p.lat}, ${p.lng}`); await input.press("Enter"); await sleep(400);
      return (await waitFor(async () => page.evaluate(() => { const el = document.querySelector('[data-testid="identify-result"]'); if (!el) return null; const x = el.innerText.trim(); return /Finding address|Querying county GIS/.test(x) ? null : x; }), 30000)) || "";
    };
    for (const pt of POINTS.filter((q) => q.expect && !q.control && /Union|Harrisonville|Plattsburg|Hermitage/.test(q.name))) {
      let txt = await addAt(pt);
      if (/^Removed /.test(txt)) txt = await addAt(pt);
      const r = await page.evaluate(() => (window.__plannerIdentifyResult ? window.__plannerIdentifyResult() : null)).catch(() => null);
      const got = r && r.attrs ? (idOf(r.attrs, COUNTIES[pt.key].idField) || String(r.acct || "")) : null;
      record({ name: "Add-parcel in a plan — " + pt.name, expect: pt.expect, got, message: got ? null : txt.slice(0, 120), build: await stamp(), pass: /Added|already in this plan/.test(txt) && got === pt.expect });
    }
  } catch (e) { record({ name: "Add-parcel in a plan", message: "harness error: " + String(e.message).slice(0, 160), pass: false }); }
} finally {
  const wiredRows = rows.filter((r) => r.expect && !/^CONTROL|address-search|^Add-parcel/.test(String(r.name)));
  if (!voided && wiredRows.length < 10) rows.push({ name: "coverage", message: `only ${wiredRows.length} wired-county rows ran`, pass: false });
  if (planMade) {
    const cl = await cleanupLive(page, { planId: PLAN_ID }).catch((e) => ({ errors: [String(e)], left: {} }));
    console.log(`cleanup: throwaway plan ${PLAN_ID} → left ${JSON.stringify(cl.left)}${cl.errors && cl.errors.length ? " errors " + cl.errors.join("; ") : ""}`);
    if (cl.errors && cl.errors.length) rows.push({ name: "cleanup", message: cl.errors.join("; "), pass: false });
  }
  writeFileSync(OUT, JSON.stringify({ base: BASE, build: s.build, at: new Date().toISOString(), rows }, null, 1));
  const failed = rows.filter((r) => !r.pass);
  console.log(`\n${voided ? "⛔ VOID — the known-good control failed" : failed.length ? `❌ ${failed.length} of ${rows.length} rows FAILED` : `✅ PASS — ${rows.length} rows`} · results ${OUT}`);
  await s.close();
  process.exit(voided ? 2 : failed.length ? 1 : 0);
}
