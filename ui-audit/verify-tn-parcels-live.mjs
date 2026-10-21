/* NEW-1 / NEW-2 (Tennessee non-state counties, B2408832 / B2408833; V1834272–V1834274) — the LIVE check, signed in as the test account, on the
 * DEPLOYED bundle (planyr.io or a *.planyr.pages.dev preview), through the real Site (Map) search box and the real Select-parcels tool:
 *
 *   1  "20 Culvert St, Nashville, TN"   → the 20 CULVERT ST lot is found AND selected (AKZO NOBEL, STANPAR 10508026600, ~9.5 ac), Davidson outlines
 *                                          draw under Select parcels, and a click on the neighbouring lot (10 Culvert St) selects it too
 *   2  a second Nashville address        → a lot with an owner
 *   3  "156-027.00-000"                 → the Rutherford lot, RHODES DEVELOPMENT COMPANY, selected
 *   4  "156 002.01 000"                 → the other Rhodes lot (spaces for dashes) — the selection now holds TWO lots; "Plan this site" builds ONE site from both
 *   5  "156-999.00-000"                 → a plain "No Tennessee parcel with ID …" message; nothing new selected
 *   6  Texas "1200 McKinney St, Houston" → a Harris lot, unchanged (the control address was picked by trying real ones on planyr.io: "1001 Texas Ave" geocodes into the road there too)
 *   7  Wilson / Sumner County clicks    → still a lot (the 86 composite counties are untouched)
 *   8  "Murfreesboro, TN"               → ordinary address behaviour: no ID row, no ID message
 *
 * Every row records /version.json IN THE SAME CALL as its assertion (merged ≠ live). The one plan this creates (step 4's "Plan this site") is trashed and
 * deleted at the end and the deletion is re-read (owner constraint 15); it never touches a real project.
 * Run: E2E_LOGIN_KEY=… node ui-audit/verify-tn-parcels-live.mjs [https://planyr.io | https://<preview>.planyr.pages.dev] [--out f.json]
 * Exit 0 = every row passed; 1 = a row failed; 2 = VOID (a Texas control arm failed, or the sign-in / map never came up). */
import { writeFileSync } from "node:fs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { cleanupLive } from "./lib/liveFixtures.mjs";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const BASE = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const OUT = flag("--out") || "tn-parcels-live.json";

const ANON = args.includes("--anon"); // a preview that has no E2E_LOGIN_KEY: signed OUT, so the plan-creation row (4b) is skipped; the search/selection rows are identical
let s = null;
if (ANON) {
  const { chromium } = await import("@playwright/test");
  const { existsSync } = await import("node:fs");
  const browser = await chromium.launch({ executablePath: existsSync(chromium.executablePath()) ? undefined : "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
  const pg = await ctx.newPage();
  s = { page: pg, proof: { email: "(signed out)" }, build: null, close: () => browser.close() };
}
for (let attempt = 1; attempt <= 6 && !s; attempt++) {
  try { s = await openSignedIn({ base: BASE, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] }); }
  catch (e) { if (!/answered 50\d/.test(String(e.message)) || attempt === 6) throw e; console.log(`  sign-in attempt ${attempt} → ${e.message.slice(0, 80)}; retrying in 20 s`); await new Promise((r) => setTimeout(r, 20000)); }
}
const page = s.page;
await assertMeasurable(page, "verify-tn-parcels-live");
console.log(`signed in as ${s.proof.email} · build ${JSON.stringify(s.build)} · base ${BASE}`);

const sleep = (ms) => page.waitForTimeout(ms);
const waitFor = async (fn, ms = 12000) => { const t = Date.now(); let v; while (Date.now() - t < ms) { v = await fn(); if (v) return v; await sleep(250); } return v; };
const stamp = () => page.evaluate(async () => { const v = await fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null); return v && v.build; });
const bodyText = () => page.evaluate(() => document.body.innerText);
const held = () => page.evaluate(() => (window.__mapSelectedParcels ? window.__mapSelectedParcels() : null)).catch(() => null);
const attrOf = (a, re) => { if (!a) return null; const k = Object.keys(a).find((x) => re.test(x.split(".").pop()) && String(a[x] ?? "").trim()); return k ? String(a[k]).trim() : null; };
const ownerOf = (a) => attrOf(a, /^(owner|owner1)$/i);
const rows = [];
const record = async (r) => { const build = await stamp(); const row = { ...r, build }; rows.push(row); console.log(`  [${r.pass ? "PASS" : "FAIL"}] ${r.name} · ${r.detail}  (build ${build})`); };

async function freshMap() {
  if (page.url().startsWith(BASE + "/?planyrDiag=1#/site")) await page.reload({ waitUntil: "domcontentloaded" });
  else await page.goto(BASE + "/?planyrDiag=1#/site", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__mapFinderMap && !!document.querySelector('[data-testid="map-toolbar-select-parcels"]'), null, { timeout: 60000 });
  await sleep(1500);
}
const box = () => page.locator('input[role="combobox"]').first();
async function search(text) {
  const b = box(); await b.click(); await b.fill(""); await b.fill(text);
  await sleep(700); // let the suggestion list render, so a leading row is on screen for the row assertions
  const rowsText = await page.evaluate(() => Array.from(document.querySelectorAll('[role="option"]')).map((o) => o.innerText.trim()));
  await b.press("Enter");
  return rowsText;
}
const waitHeld = (n, ms = 25000) => waitFor(async () => { const h = await held(); return h && h.length >= n && h.slice(0, n).every((x) => x.attrs && Object.keys(x.attrs).length) ? h : null; }, ms);
const center = () => page.evaluate(() => { const c = window.__mapFinderMap.getCenter(); return [c.lat, c.lng]; });

let voided = false;
let planId = null;
try {
  await freshMap();

  /* 1 ─ the reported case */
  const r1rows = await search("20 Culvert St, Nashville, TN");
  const h1 = await waitHeld(1);
  const a1 = h1 && h1[0] ? h1[0].attrs : null;
  const txt1 = await bodyText();
  await record({
    name: "1a 20 Culvert St, Nashville → the lot is found and selected", pass: !!(a1 && a1.STANPAR === "10508026600" && /AKZO NOBEL/i.test(ownerOf(a1) || "")) && !/No parcel at this point/i.test(txt1),
    detail: a1 ? `STANPAR ${a1.STANPAR} · ${ownerOf(a1)} · ${a1.Acres} ac · county key ${h1[0].county}` : `nothing selected; page says: ${(txt1.match(/No parcel[^\n]*/) || [""])[0]}`,
  });
  // Davidson outlines draw under Select parcels at street level
  // the found lot is selected, so the toolbar is in its "decide" state: clear it (the lot stays findable), then arm Select parcels
  const clr = page.locator('[data-testid="map-decide-clear"]').first();
  if (await clr.count()) await clr.click();
  await page.locator('[data-testid="map-toolbar-select-parcels"]').first().click({ timeout: 15000 });
  await sleep(500);
  await page.evaluate(() => window.__mapFinderMap.setZoom(18, { animate: false }));
  const drawn = await waitFor(async () => { const d = await page.evaluate(() => (window.__mapParcelDisplay ? window.__mapParcelDisplay() : null)); return d && d.drawn > 0 ? d : null; }, 25000);
  await record({ name: "1b Davidson outlines draw at street level", pass: !!drawn, detail: drawn ? `sources ${drawn.sources.join(",")} · ${drawn.drawn} lots drawn of ${drawn.held} held` : "no lots drawn" });
  // click the neighbouring lot, 10 Culvert St (interior point recorded from the layer)
  const nb = [36.138053, -86.757126];
  const px = await page.evaluate(([a, b]) => { const m = window.__mapFinderMap, p = m.latLngToContainerPoint([a, b]), r = m.getContainer().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; }, nb);
  await page.mouse.click(px.x, px.y);
  // the outline paints the lot at once; the county's point identify (which carries the situs) answers a moment later — wait for it
  const h1b = await waitFor(async () => { const h = await held(); const x = h && h[h.length - 1]; return x && x.attrs && x.attrs.PropAddr ? h : null; }, 25000);
  const second = h1b && h1b[h1b.length - 1] ? h1b[h1b.length - 1].attrs : null;
  await record({ name: "1c a click on the neighbouring lot (10 Culvert St) selects it", pass: !!(second && /CULVERT/i.test(second.PropAddr || "") && second.STANPAR !== "10508026600"), detail: second ? `${second.PropAddr} · ${ownerOf(second)}` : "no lot" });

  /* 2 ─ a second Nashville address */
  await freshMap();
  await search("501 Broadway, Nashville, TN");
  const h2 = await waitHeld(1, 25000);
  await record({ name: "2 a second Nashville address (501 Broadway) finds a lot with an owner", pass: !!(h2 && ownerOf(h2[0].attrs)), detail: h2 ? `${h2[0].attrs.PropAddr} · ${ownerOf(h2[0].attrs)}` : "nothing selected" });

  /* 3, 4 ─ Rutherford, by id */
  await freshMap();
  const r3rows = await search("156-027.00-000");
  const h3 = await waitHeld(1, 30000);
  const a3 = h3 && h3[0] ? h3[0].attrs : null;
  await record({
    name: "3 156-027.00-000 → Rutherford lot, Rhodes Development, selected", pass: !!(a3 && a3.ParcelID === "156-027.00-000" && /RHODES DEVELOPMENT/i.test(ownerOf(a3) || "")) && r3rows.some((t) => /Find parcel ID/i.test(t)),
    detail: a3 ? `${a3.ParcelID} · ${ownerOf(a3)} · ${a3.CALCACRES && a3.CALCACRES.toFixed ? a3.CALCACRES.toFixed(2) : a3.DEEDACRES} ac · rows: ${JSON.stringify(r3rows.slice(0, 2))}` : `nothing selected; rows ${JSON.stringify(r3rows)}`,
  });
  await search("156 002.01 000");
  const h4 = await waitHeld(2, 30000);
  const ids4 = (h4 || []).map((x) => x.attrs && x.attrs.ParcelID).sort();
  await record({ name: "4a 156 002.01 000 (spaces) → the other Rhodes lot; the selection now holds two", pass: !!(h4 && h4.length === 2 && ids4[0] === "156-002.01-000" && ids4[1] === "156-027.00-000" && h4.every((x) => /RHODES DEVELOPMENT/i.test(ownerOf(x.attrs) || ""))), detail: `held ${JSON.stringify(ids4)}` });
  // Plan this site → ONE site from both lots
  const verb = page.locator('[data-testid="map-decide-verb-site"]').first();
  const verbSeen = ANON ? false : await verb.waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
  if (verbSeen) {
    await verb.click();
    planId = await waitFor(async () => { const m = (page.url().match(/#\/project\/([^/]+)/) || [])[1]; return m || null; }, 45000);
  }
  let plan = null;
  if (planId) plan = await waitFor(async () => page.evaluate(async (id) => { const q = await window.pfSupabase.from("sites").select("id,site,data").eq("id", id).maybeSingle(); return q.data || null; }, planId), 30000);
  const pc = plan && plan.data && Array.isArray(plan.data.parcels) ? plan.data.parcels.length : null;
  if (ANON) console.log("  [skip] 4b Plan this site — needs a signed-in session");
  else await record({ name: "4b Plan this site → one site from the two lots", pass: !!(plan && pc === 2), detail: plan ? `plan ${planId} · "${plan.site}" · ${pc} parcels` : `no plan created (verb seen: ${verbSeen}, id: ${planId})` });

  /* 5 ─ an id that does not exist */
  await freshMap();
  await search("156-999.00-000");
  const msg = await waitFor(async () => { const t = await bodyText(); const m = t.match(/No Tennessee parcel with ID[^\n]*/); return m ? m[0] : null; }, 25000);
  const h5 = await held();
  await record({ name: "5 an id that does not exist says so, selects nothing", pass: !!msg && (!h5 || h5.length === 0), detail: msg || "no message appeared" });

  /* 8 ─ ordinary address text is untouched */
  await freshMap();
  const r8rows = await search("Murfreesboro, TN");
  await sleep(4000);
  const t8 = await bodyText();
  await record({ name: "8 'Murfreesboro, TN' is an ordinary place search (no id row, no id message)", pass: !r8rows.some((t) => /Find parcel ID/i.test(t)) && !/No Tennessee parcel with ID/.test(t8), detail: `rows ${JSON.stringify(r8rows.slice(0, 3))}` });

  /* 6 ─ Texas control */
  await freshMap();
  await search("1200 McKinney St, Houston, TX 77010");
  const h6 = await waitHeld(1, 30000);
  const ok6 = !!(h6 && /harris/i.test(String(h6[0].county)) && (h6[0].acct || ownerOf(h6[0].attrs)));
  await record({ name: "6 Texas (1200 McKinney St, Houston) still selects a Harris lot", pass: ok6, detail: h6 ? `county ${h6[0].county} · acct ${h6[0].acct} · owner ${ownerOf(h6[0].attrs)}` : "nothing selected", control: true });
  if (!ok6) voided = true;

  /* 7 ─ the composite counties around Nashville still answer */
  for (const [name, la, ln] of [["Wilson (Mt Juliet)", 36.2000, -86.5200], ["Sumner (Gallatin)", 36.3880, -86.4467], ["Cheatham (Ashland City)", 36.2740, -87.0640]]) {
    await freshMap();
    await page.evaluate(([a, b]) => window.__mapFinderMap.setView([a, b], 17, { animate: false }), [la, ln]);
    await sleep(900);
    await page.locator('[data-testid="map-toolbar-select-parcels"]').first().click();
    await sleep(1500);
    let got = null;
    for (const [dy, dx] of [[0, 0], [0.002, 0.002], [-0.002, -0.002], [0.004, -0.003], [-0.004, 0.003], [0.008, 0]]) {
      if (dy || dx) { await page.evaluate(([a, b]) => window.__mapFinderMap.setView([a, b], 17, { animate: false }), [la + dy, ln + dx]); await sleep(900); }
      const c = await page.evaluate(([a, b]) => { const m = window.__mapFinderMap, p = m.latLngToContainerPoint([a, b]), r = m.getContainer().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; }, [la + dy, ln + dx]);
      await page.mouse.click(c.x, c.y);
      got = await waitFor(async () => { const h = await held(); return h && h.length ? h : null; }, 12000);
      if (got) break;
    }
    await record({ name: `7 ${name} still answers from the statewide layer`, pass: !!got, detail: got ? `county ${got[0].county} · id ${got[0].acct} · owner ${ownerOf(got[0].attrs)}` : "no lot at six tries" });
  }
} finally {
  if (planId) {
    const left = await cleanupLive(page, { planId }).catch((e) => ({ error: String(e) }));
    console.log("cleanup of the throwaway plan:", JSON.stringify(left));
    rows.push({ name: "cleanup", pass: !!left && !left.error && (!left.errors || !left.errors.length) && left.site === 0, detail: JSON.stringify(left) });
  }
  await s.close();
}

writeFileSync(OUT, JSON.stringify({ base: BASE, signedInAs: s.proof.email, rows }, null, 2));
const failed = rows.filter((r) => !r.pass);
console.log(`\n${rows.length - failed.length}/${rows.length} rows passed · results → ${OUT}`);
if (voided) { console.log("VOID — the Texas control arm failed; nothing above can be trusted."); process.exit(2); }
process.exit(failed.length ? 1 : 0);
