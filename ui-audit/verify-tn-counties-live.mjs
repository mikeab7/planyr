/* NEW-1/NEW-2 (Tennessee, all 95 counties; V-id on the ledger) — the LIVE half of the 95-county sweep, on the DEPLOYED bundle, signed in as the test account, through the real Map's Select parcels.
 * The Node half (ui-audit/sweep-tn-counties.mjs) runs the app's own routing against the live county servers; this drives the real browser app for the same recorded lots
 * (test/fixtures/tnSweepPoints.json): for every county it opens the Map over the lot at the zoom Select parcels draws from, arms Select parcels and asserts
 *   B  the neighbours' OUTLINES draw (`__mapParcelDisplay().held` >= 3 from the county's expected source),
 *   A  a click selects the lot: the expected source key, the same parcel id the sweep recorded, an owner where the source carries one, and never "No parcel at this point",
 *   C  typing that id into the Site search box lands on and selects the same lot (`--search`; default ON).
 * Knox must show the honest "no parcel data wired here yet" sentence. Controls: Harris TX and Dougherty GA must still draw outlines (the run is VOID otherwise). Every row records /version.json IN THE SAME CALL
 * (merged ≠ live). Creates no plan, so nothing to clean up.
 * Run: E2E_LOGIN_KEY=… node ui-audit/verify-tn-counties-live.mjs [https://planyr.io] [--counties=Sullivan,Dyer] [--shard=1/3] [--dense] [--no-search] [--out f.json]
 * Exit 0 = every row passed; 1 = a row failed; 2 = VOID (a control failed or the map never came up). */
import { writeFileSync, readFileSync } from "node:fs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const args = process.argv.slice(2);
const flag = (n, d = null) => { const a = args.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : args.includes(`--${n}`) ? true : d; };
const BASE = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const OUT = flag("out", "tn-counties-live.json");
const ONLY = flag("counties") ? new Set(String(flag("counties")).split(",").map((s) => s.trim().toLowerCase())) : null;
const [SHARD_I, SHARD_N] = String(flag("shard", "1/1")).split("/").map(Number);
const DENSE = !!flag("dense");
const SEARCH = !args.includes("--no-search");
const FX = JSON.parse(readFileSync(new URL("../test/fixtures/tnSweepPoints.json", import.meta.url), "utf8"));
const norm = (v) => String(v == null ? "" : v).toUpperCase().replace(/[^A-Z0-9]/g, "");

let s = null;
for (let attempt = 1; attempt <= 6 && !s; attempt++) {
  try { s = await openSignedIn({ base: BASE, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] }); }
  catch (e) { if (!/answered 50\d/.test(String(e.message)) || attempt === 6) throw e; console.log(`  sign-in attempt ${attempt} → ${e.message.slice(0, 80)}; retrying in 20 s`); await new Promise((r) => setTimeout(r, 20000)); }
}
const page = s.page;
await assertMeasurable(page, "verify-tn-counties-live");
console.log(`signed in as ${s.proof.email} · build ${JSON.stringify(s.build)} · base ${BASE} · shard ${SHARD_I}/${SHARD_N}`);

const sleep = (ms) => page.waitForTimeout(ms);
const waitFor = async (fn, ms = 12000) => { const t = Date.now(); let v; while (Date.now() - t < ms) { v = await fn(); if (v) return v; await sleep(250); } return v; };
const stamp = () => page.evaluate(async () => { const v = await fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null); return v && v.build; });
const bodyText = () => page.evaluate(() => document.body.innerText);
const held = () => page.evaluate(() => (window.__mapSelectedParcels ? window.__mapSelectedParcels() : null)).catch(() => null);
const display = () => page.evaluate(() => (window.__mapParcelDisplay ? window.__mapParcelDisplay() : null)).catch(() => null);
const pick = (a, re) => { if (!a) return null; const k = Object.keys(a).find((x) => re.test(x.split(".").pop()) && String(a[x] ?? "").trim()); return k ? String(a[k]).trim() : null; };
const OWNER_RE = /^(owner|owner1|owner_1|ownername1|gpdata__ow|owner_all)$/i;
const rows = [];
const record = async (r) => { const build = await stamp(); rows.push({ ...r, build }); console.log(`  [${r.pass ? "PASS" : "FAIL"}] ${r.name} · ${r.detail}  (build ${build})`); };

async function freshMap() {
  if (page.url().startsWith(BASE + "/?planyrDiag=1#/site")) await page.reload({ waitUntil: "domcontentloaded" });
  else await page.goto(BASE + "/?planyrDiag=1#/site", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__mapFinderMap && !!document.querySelector('[data-testid="map-toolbar-select-parcels"]'), null, { timeout: 60000 });
  await sleep(1200);
}
const toContainer = (lat, lng) => page.evaluate(([a, b]) => { const m = window.__mapFinderMap, p = m.latLngToContainerPoint([a, b]), r = m.getContainer().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; }, [lat, lng]);

/** B then A (then C) for one recorded lot. */
async function checkLot(c, site, label) {
  const name = `${c.name} (${label})`;
  const z = Math.max(17, c.floor || 17);
  await freshMap();
  await page.evaluate(([a, b, zz]) => window.__mapFinderMap.setView([a, b], zz, { animate: false }), [site.lat, site.lng, z]);
  await sleep(900);
  await page.locator('[data-testid="map-toolbar-select-parcels"]').first().click({ timeout: 15000 });
  const d = await waitFor(async () => { const x = await display(); return x && x.held >= 3 ? x : null; }, 45000) || await display();
  const outlinesOk = !!(d && d.held >= 3 && (d.sources || []).includes(c.source));
  const p = await toContainer(site.lat, site.lng);
  await page.mouse.click(p.x, p.y);
  const got = await waitFor(async () => { const h = await held(); const x = h && h[h.length - 1]; return x && x.attrs && (pick(x.attrs, OWNER_RE) || c.source === "tn_shelby") ? h : null; }, 45000)
    || await waitFor(async () => { const h = await held(); return h && h.length ? h : null; }, 3000);
  const x = got && got[got.length - 1];
  const txt = await bodyText();
  const acct = x ? (x.acct || null) : null;
  const idShown = x ? (acct || pick(x.attrs, /^(parcelid|parcel_id|parcelno|tax_map_no|stanpar|l15parce_2)$/i)) : null;
  const keyOk = !!(x && String(x.county) === c.source);
  const idOk = !!(site.id && x && [acct, ...Object.values(x.attrs || {})].some((v) => norm(v) && norm(v) === norm(site.id)));
  const clickOk = !!(x && keyOk && idOk && !/No parcel at this point/i.test(txt));
  await record({ name: `${name} — outlines`, pass: outlinesOk, detail: d ? `held ${d.held} · drawn ${d.drawn} · sources ${(d.sources || []).join(",")}` : "no display state", county: c.name, check: "B" });
  await record({ name: `${name} — click selects the lot`, pass: clickOk, detail: x ? `source ${x.county} (want ${c.source}) · id ${idShown} (want ${String(site.id).trim()}) · owner ${pick(x.attrs, OWNER_RE) || "(none carried)"}` : `nothing selected; page says: ${(txt.match(/No parcel[^\n]*/) || [""])[0]}`, county: c.name, check: "A" });
  if (SEARCH && site.id) {
    await freshMap();
    const box = page.locator('input[role="combobox"]').first();
    await box.click(); await box.fill(String(site.id)); await sleep(600); await box.press("Enter");
    const f = await waitFor(async () => { const h = await held(); return h && h.length ? h : null; }, 60000);
    const y = f && f[f.length - 1];
    const okC = !!(y && String(y.county) === c.source && [y.acct, ...Object.values(y.attrs || {})].some((v) => norm(v) && norm(v) === norm(site.id)));
    await record({ name: `${name} — id search "${String(site.id).trim()}"`, pass: okC, detail: y ? `landed in ${y.county} · id ${y.acct}` : "nothing selected", county: c.name, check: "C" });
  }
}

let voided = false;
try {
  /* controls first: a known-good place for outlines. If these do not draw, nothing below can be trusted. */
  for (const [nm, lat, lng, need] of [["control Harris TX (Katy)", 29.813, -95.81, 40], ["control Dougherty GA (Albany)", 31.5785, -84.1557, 40]]) {
    await freshMap();
    await page.evaluate(([a, b]) => window.__mapFinderMap.setView([a, b], 17, { animate: false }), [lat, lng]);
    await sleep(800);
    await page.locator('[data-testid="map-toolbar-select-parcels"]').first().click({ timeout: 15000 });
    const d = await waitFor(async () => { const x = await display(); return x && x.held >= need ? x : null; }, 45000) || await display();
    const ok = !!(d && d.held >= need);
    if (!ok) voided = true;
    await record({ name: nm, pass: ok, control: true, detail: d ? `held ${d.held}` : "no display state" });
  }
  if (voided) { console.log("VOID — a control did not draw; skipping the counties."); }
  else {
    const list = FX.counties.filter((c) => !ONLY || ONLY.has(c.name.toLowerCase())).filter((_, i) => i % SHARD_N === SHARD_I - 1);
    for (const c of list) {
      if (c.source === "(none)") {
        await freshMap();
        await page.evaluate(([a, b]) => window.__mapFinderMap.setView([a, b], 17, { animate: false }), [c.lat, c.lng]);
        await sleep(800);
        await page.locator('[data-testid="map-toolbar-select-parcels"]').first().click({ timeout: 15000 });
        const p = await toContainer(c.lat, c.lng);
        await page.mouse.click(p.x, p.y);
        const said = await waitFor(async () => /no parcel data wired here yet/i.test(await bodyText()), 20000);
        await record({ name: `${c.name} — named gap`, pass: !!said, detail: said ? "shows 'Knox County — no parcel data wired here yet.'" : "the honest message is missing", county: c.name, check: "gap" });
        continue;
      }
      const floor = c.source === "tn_shelby" || c.source === "tn_hamilton" || c.source === "tn_davidson" ? 17 : 16;
      await checkLot({ ...c, floor }, { lat: c.lat, lng: c.lng, id: c.id }, "middle");
      if (DENSE && c.dense) await checkLot({ ...c, floor }, { lat: c.dense.lat, lng: c.dense.lng, id: c.dense.id }, c.dense.town);
    }
  }
} finally {
  await s.close();
}
writeFileSync(OUT, JSON.stringify({ base: BASE, signedInAs: s.proof.email, shard: `${SHARD_I}/${SHARD_N}`, rows }, null, 2));
const failed = rows.filter((r) => !r.pass);
console.log(`\n${rows.length - failed.length}/${rows.length} rows passed · results → ${OUT}`);
if (failed.length) console.log("failing: " + failed.map((r) => r.name).join(" | "));
if (voided) process.exit(2);
process.exit(failed.length ? 1 : 0);
