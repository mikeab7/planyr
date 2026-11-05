/* NEW-1..NEW-3 (Tennessee pass 2, B2408834; V1841776–V1841778) — the LIVE check for the four counties wired in pass 2, signed in as the test account on the DEPLOYED
 * bundle, through the real Select-parcels tool. For each county: open the map at street level over a recorded lot, arm Select parcels, assert the county's OUTLINES draw,
 * click the lot and assert it is selected with its parcel ID and owner (no "No parcel at this point"). Controls: a Davidson lot (the pass-1 case) and a Texas lot, plus an
 * untouched Wilson County click still answered by the statewide layer. Every row records /version.json IN THE SAME CALL (merged ≠ live). Creates no plan, so nothing to clean up.
 * Run: E2E_LOGIN_KEY=… node ui-audit/verify-tn-pass2-live.mjs [https://planyr.io | https://<preview>.planyr.pages.dev] [--out f.json] [--anon]
 * Exit 0 = every row passed; 1 = a row failed; 2 = VOID (a control failed or the map never came up). */
import { writeFileSync } from "node:fs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const BASE = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const OUT = flag("--out") || "tn-pass2-live.json";
let s = null;
if (args.includes("--anon")) {
  const { chromium } = await import("@playwright/test");
  const { existsSync } = await import("node:fs");
  const browser = await chromium.launch({ executablePath: existsSync(chromium.executablePath()) ? undefined : "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
  s = { page: await ctx.newPage(), proof: { email: "(signed out)" }, build: null, close: () => browser.close() };
}
for (let attempt = 1; attempt <= 6 && !s; attempt++) {
  try { s = await openSignedIn({ base: BASE, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] }); }
  catch (e) { if (!/answered 50\d/.test(String(e.message)) || attempt === 6) throw e; console.log(`  sign-in attempt ${attempt} → ${e.message.slice(0, 80)}; retrying in 20 s`); await new Promise((r) => setTimeout(r, 20000)); }
}
const page = s.page;
await assertMeasurable(page, "verify-tn-pass2-live");
console.log(`signed in as ${s.proof.email} · build ${JSON.stringify(s.build)} · base ${BASE}`);

const sleep = (ms) => page.waitForTimeout(ms);
const waitFor = async (fn, ms = 12000) => { const t = Date.now(); let v; while (Date.now() - t < ms) { v = await fn(); if (v) return v; await sleep(250); } return v; };
const stamp = () => page.evaluate(async () => { const v = await fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null); return v && v.build; });
const bodyText = () => page.evaluate(() => document.body.innerText);
const held = () => page.evaluate(() => (window.__mapSelectedParcels ? window.__mapSelectedParcels() : null)).catch(() => null);
const pick = (a, re) => { if (!a) return null; const k = Object.keys(a).find((x) => re.test(x.split(".").pop()) && String(a[x] ?? "").trim()); return k ? String(a[k]).trim() : null; };
const rows = [];
const record = async (r) => { const build = await stamp(); rows.push({ ...r, build }); console.log(`  [${r.pass ? "PASS" : "FAIL"}] ${r.name} · ${r.detail}  (build ${build})`); };

async function freshMap() {
  if (page.url().startsWith(BASE + "/?planyrDiag=1#/site")) await page.reload({ waitUntil: "domcontentloaded" });
  else await page.goto(BASE + "/?planyrDiag=1#/site", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__mapFinderMap && !!document.querySelector('[data-testid="map-toolbar-select-parcels"]'), null, { timeout: 60000 });
  await sleep(1500);
}
const toContainer = (lat, lng) => page.evaluate(([a, b]) => { const m = window.__mapFinderMap, p = m.latLngToContainerPoint([a, b]), r = m.getContainer().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; }, [lat, lng]);

/** Open the map over a recorded lot, arm Select parcels, assert outlines draw and a click selects the lot. */
async function clickRow({ name, lat, lng, expectKey, idRe, ownerRe, control = false }) {
  await freshMap();
  await page.evaluate(([a, b]) => window.__mapFinderMap.setView([a, b], 18, { animate: false }), [lat, lng]);
  await sleep(900);
  await page.locator('[data-testid="map-toolbar-select-parcels"]').first().click({ timeout: 15000 });
  const drawn = await waitFor(async () => { const d = await page.evaluate(() => (window.__mapParcelDisplay ? window.__mapParcelDisplay() : null)); return d && d.drawn > 0 ? d : null; }, 30000);
  const c = await toContainer(lat, lng);
  await page.mouse.click(c.x, c.y);
  /* the outline paints the lot at once with the id; the county's point identify (which carries the owner and situs) answers a moment later — wait for the owner, like the pass-1 harness waits for the situs */
  const OWNER_RE = /^(owner|owner1|owner_1|ownername1)$/i;
  const got = await waitFor(async () => { const h = await held(); const x = h && h[h.length - 1]; return x && x.attrs && pick(x.attrs, OWNER_RE) ? h : null; }, 40000)
    || await waitFor(async () => { const h = await held(); return h && h.length ? h : null; }, 2000);
  const x = got && got[got.length - 1];
  const idVal = x ? [pick(x.attrs, idRe), x.acct].filter(Boolean)[0] : null;
  const owner = x ? pick(x.attrs, OWNER_RE) : null;
  const txt = await bodyText();
  const pass = !!(drawn && x && (!expectKey || String(x.county) === expectKey) && idVal && (!ownerRe || ownerRe.test(owner || "")) && !/No parcel at this point/i.test(txt));
  await record({ name, pass, control, detail: x ? `outlines ${drawn ? `${drawn.drawn} drawn (${drawn.sources.join(",")})` : "NONE"} · county key ${x.county} · id ${idVal} · owner ${owner}` : `nothing selected; outlines ${drawn ? "drawn" : "none"}; page says: ${(txt.match(/No parcel[^\n]*/) || [""])[0]}` });
  return pass;
}

let voided = false;
try {
  /* the four counties wired in pass 2 */
  await clickRow({ name: "1 Williamson (Nolensville Rd) — outlines draw, lot selects with id + owner", lat: 35.952628, lng: -86.669169, expectKey: "tn_williamson", idRe: /^parcel_id$/i, ownerRe: /WILLIAMS/i });
  /* Franklin's Public Square is two OVERLAPPING Williamson lots (078 10900 UDC and 078 11000 CITY OF FRANKLIN both contain the point — the county's own data), so it is not a fixed expectation; Thompson's Station is a single lot. */
  await clickRow({ name: "1b Williamson (Thompson's Station town lot)", lat: 35.800089, lng: -86.909925, expectKey: "tn_williamson", idRe: /^parcel_id$/i, ownerRe: /THOMPSONS STATION/i });
  await clickRow({ name: "2 Hamilton (Soddy-Daisy, Dayton Pike) — outlines draw, lot selects with tax-map no + owner", lat: 35.258812, lng: -85.174379, expectKey: "tn_hamilton", idRe: /^tax_map_no$/i, ownerRe: /VANESSAS COTTAGE/i });
  await clickRow({ name: "2b Hamilton (Enterprise South / Volkswagen Dr)", lat: 35.081328, lng: -85.13771, expectKey: "tn_hamilton", idRe: /^tax_map_no$/i, ownerRe: /INDUSTRIAL DEV BOARD/i });
  await clickRow({ name: "3 Montgomery (Franklin St, Clarksville) — outlines draw, lot selects with parcel no + owner", lat: 36.528787, lng: -87.350438, expectKey: "tn_montgomery", idRe: /^parcelno$/i, ownerRe: /IMMACULATE CONCEPTION/i });
  await clickRow({ name: "3b Montgomery (Tobacco Rd)", lat: 36.601736, lng: -87.408069, expectKey: "tn_montgomery", idRe: /^parcelno$/i, ownerRe: /MAYNARD/i });
  await clickRow({ name: "4 Hickman (Centerville, Public Square) — outlines draw, lot selects with id + owner", lat: 35.778707, lng: -87.466815, expectKey: "tn_hickman", idRe: /^parcelid$/i, ownerRe: /HICKMAN COUNTY/i });
  /* controls */
  await clickRow({ name: "C1 Davidson (20 Culvert St) still selects the AKZO NOBEL lot", lat: 36.137653, lng: -86.75516, expectKey: "tn_davidson", idRe: /^stanpar$/i, ownerRe: /AKZO NOBEL/i, control: true });
  await clickRow({ name: "C2 Wilson County (statewide layer) still answers", lat: 36.2, lng: -86.52, expectKey: null, idRe: /./, ownerRe: null, control: true });
  /* C3 Rutherford by id + C4 Texas address, exactly as the pass-1 harness runs them */
  await freshMap();
  const b = page.locator('input[role="combobox"]').first();
  await b.click(); await b.fill("156-027.00-000"); await sleep(700); await b.press("Enter");
  const h3 = await waitFor(async () => { const h = await held(); return h && h.length && h[0].attrs && h[0].attrs.ParcelID ? h : null; }, 30000);
  await record({ name: "C3 Rutherford 156-027.00-000 still finds the Rhodes lot", pass: !!(h3 && h3[0].attrs.ParcelID === "156-027.00-000" && /RHODES/i.test(pick(h3[0].attrs, /^owner1$/i) || "")), control: true, detail: h3 ? `${h3[0].attrs.ParcelID} · ${pick(h3[0].attrs, /^owner1$/i)}` : "nothing selected" });
  await freshMap();
  const b2 = page.locator('input[role="combobox"]').first();
  await b2.click(); await b2.fill("1200 McKinney St, Houston, TX 77010"); await sleep(700); await b2.press("Enter");
  const h4 = await waitFor(async () => { const h = await held(); return h && h.length && h[0].attrs && Object.keys(h[0].attrs).length ? h : null; }, 30000);
  const ok4 = !!(h4 && /harris/i.test(String(h4[0].county)));
  await record({ name: "C4 Texas (1200 McKinney St, Houston) still selects a Harris lot", pass: ok4, control: true, detail: h4 ? `county ${h4[0].county} · acct ${h4[0].acct}` : "nothing selected" });
  if (!ok4) voided = true;
} finally {
  await s.close();
}
writeFileSync(OUT, JSON.stringify({ base: BASE, signedInAs: s.proof.email, rows }, null, 2));
const failed = rows.filter((r) => !r.pass);
console.log(`\n${rows.length - failed.length}/${rows.length} rows passed · results → ${OUT}`);
if (voided) { console.log("VOID — the Texas control arm failed; nothing above can be trusted."); process.exit(2); }
process.exit(failed.length ? 1 : 0);
