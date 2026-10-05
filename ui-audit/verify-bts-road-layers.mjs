/* B2081249 — the two NATIONAL road-access layers (USDOT BTS National Network + HPMS 2022) in the REAL built app, against
 * the REAL services (services.arcgis.com is reachable from the build sandbox and CORS-open from planyr.io).
 *   LIST ARM      a Georgia site AND a Texas site both list both rows (national), the Texas count layer stays Texas-only;
 *   PAINT ARM     over Gwinnett Co. GA (the owner's probe box) each row requests its service, gets 200, draws lines;
 *   FILTER ARM    ⛔ the National Network request carries `NN = 1` (the layer also holds NN = 0 roads — drawing it
 *                 unfiltered prints a truck-route claim on roads that are not on the network);
 *   NO-MOVE ARM   switching either on and off leaves the map's view numbers identical.
 * KNOWN-GOOD: if a service never answers in this browser the arm is VOID (exit 2), never a pass.
 *   npm run build && npx vite preview --port 4173   (then)   node ui-audit/verify-bts-road-layers.mjs */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || undefined;
const PROXY = process.env.PW_PROXY || process.env.HTTPS_PROXY || "";
const H = 535.5;
const parcel = { id: "pc1", locked: true, points: [{ x: -H, y: -H }, { x: H, y: -H }, { x: H, y: H }, { x: -H, y: H }] };
const mkSite = (id, lat, lon, county) => ({ id, groupId: id, site: `Throwaway ${id}`, name: "Concept A", origin: { lat, lon }, county, parcels: [parcel], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, sheetOverlays: [], parcelDrawings: [], updatedAt: Date.now() });
const TRUCK = "Truck routes (STAA National Network)", HPMS = "Traffic volumes (HPMS 2022, highways)";
let fail = 0, voided = 0;
const check = (n, ok, x = "") => { console.log(`  ${ok ? "✓" : "✗"} ${n}${x ? ` — ${x}` : ""}`); if (!ok) fail++; };

async function open(site) {
  const launch = { ...(EXEC ? { executablePath: EXEC } : {}), args: ["--no-sandbox"] };
  if (PROXY) launch.args.push("--proxy-server=" + PROXY, "--proxy-bypass-list=localhost;127.0.0.1");
  const browser = await chromium.launch(launch);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(`(()=>{try{if(!localStorage.getItem('planarfit:sites:v1')){localStorage.setItem('planarfit:sites:v1',JSON.stringify(${JSON.stringify({ [site.id]: site })}));localStorage.setItem('planarfit:currentSite:v1','${site.id}');}}catch(e){}})()`);
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-bts-road-layers");
  const reqs = [];
  page.on("response", (r) => { const u = r.url(); if (u.includes("xOi1kZaI0eWDREZv")) reqs.push({ url: u, status: r.status() }); });
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(2500);
  try { await page.locator("button:visible", { hasText: /^Site$/ }).first().click({ timeout: 5000 }); } catch (_) {}
  await page.waitForTimeout(3500);
  try { await page.locator("button:visible", { hasText: "Layers" }).first().click({ timeout: 4000 }); } catch (_) {}
  await page.waitForTimeout(1000);
  return { browser, page, reqs };
}
const view = (page) => page.evaluate(() => { const e = document.querySelector("[data-view-ppf]"); return e ? [e.dataset.viewPpf, e.dataset.viewOffx, e.dataset.viewOffy].join("|") : null; });
const geom = (page) => page.evaluate(() => document.querySelectorAll(".leaflet-pane svg path").length + document.querySelectorAll(".leaflet-pane canvas").length);
const labels = (page) => page.evaluate(() => [...document.querySelectorAll("label")].filter((l) => l.offsetParent).map((l) => l.innerText.trim()));
async function expandAccess(page, name) {
  for (let k = 0; k < 3 && !(await page.getByText(name).count()); k++) {
    try { await page.getByText(/^(Access|Roads|Access & traffic)/i).first().click({ timeout: 2000 }); } catch (_) {}
    await page.waitForTimeout(800);
  }
}

/* Each layer is driven over a site placed ON a known feature of its own (a segment midpoint read from the live service,
 * 2026-10-05), so "it draws" is a statement about that feature and not about whatever happened to be in the viewport. */
const GA = [
  [TRUCK, "National_Network", 33.96417, -84.02137, "SR-316 (NN = 1)"],
  [HPMS, "HPMS_FULL_US_2022", 33.97594, -84.00206, "AADT 57,400"],
];
for (const [name, needle, lat, lon, where] of GA) {
  console.log(`— Georgia site on ${where} (Gwinnett Co.): ${name} —`);
  const { browser, page, reqs } = await open(mkSite("GA1", lat, lon, "ga_gwinnett"));
  await expandAccess(page, name);
  const ls = await labels(page);
  check("both national rows are listed on a Georgia site", ls.includes(TRUCK) && ls.includes(HPMS));
  check("the Texas-only TxDOT count row is NOT listed", !ls.some((l) => /^Traffic counts \(AADT\)$/.test(l)));
  const row = page.locator("label:visible", { hasText: name }).first();
  if (!(await row.isVisible().catch(() => false))) { check(`${name} row present`, false); await browser.close(); continue; }
  const v0 = await view(page), g0 = await geom(page), n0 = reqs.length;
  await row.locator('input[type="checkbox"]').first().check();
  await page.waitForTimeout(9000);
  const mine = reqs.slice(n0).filter((r) => r.url.includes(needle));
  if (!mine.length) { console.log(`  VOID — the browser never reached the service`); voided++; await browser.close(); continue; }
  check("requested its service and got 200", mine.some((r) => r.status === 200), JSON.stringify(mine.slice(0, 3).map((r) => r.status)));
  const g1 = await geom(page);
  check("DRAWS over its known feature", g1 > g0, `${g0} → ${g1} svg paths + canvases`);
  if (needle === "National_Network") {
    const q = mine.map((r) => decodeURIComponent(r.url)).find((u) => /\/query/.test(u)) || "";
    check("⛔ FILTER: the National Network query carries NN = 1", /NN\s*=\s*1/.test(q), q.slice(0, 170));
  }
  check("NO-MOVE — the map did not move", (await view(page)) === v0, `${v0} → ${await view(page)}`);
  await row.locator('input[type="checkbox"]').first().uncheck();
  await page.waitForTimeout(1500);
  check("…nor when switched off", (await view(page)) === v0);
  await browser.close();
}
console.log("— Texas site (Katy) —");
{
  const { browser, page } = await open(mkSite("TX1", 29.7836, -95.8244, "harris"));
  await expandAccess(page, TRUCK);
  const ls = await labels(page);
  check("both national rows are listed on a Texas site too", ls.includes(TRUCK) && ls.includes(HPMS), JSON.stringify(ls.filter((l) => /truck|traffic/i.test(l))));
  check("…and the Texas count layer is still there beside HPMS (not displaced)", ls.some((l) => /^Traffic counts \(AADT\)$/.test(l)));
  await browser.close();
}
if (voided) { console.log(`VOID (${voided} arm(s) could not reach their service)`); process.exit(2); }
console.log(fail ? `FAIL (${fail})` : "PASS");
process.exit(fail ? 1 : 0);
