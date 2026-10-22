/* NEW-1 (New Jersey + New York) — county lines + municipal limits DRAW, and the header badge NAMES the municipality, on a NJ and a NY site.
 *
 * The real built app, a local `vite preview`, no planyr.io. It opens a Fort Lee NJ site, a Pleasantville NY site and a Brooklyn (NYC) site, each
 * with its layers seeded ON through the site's own per-site layer memory (`layerOverrides`), and asserts:
 *   (a) every NJ / NY row requested ITS state agency's service and got 200 (not the Texas one, not a relay);
 *   (b) vector geometry is on the map (paths appear in the Leaflet panes), and no "layer failed" / "no vector source registered" toast;
 *   (c) the header badge (`data-jurisdiction-full`, the untruncated text) reads the municipality, in the form the owner asked for —
 *       "Borough of Fort Lee · Bergen County", "Village of Pleasantville · Town of Mount Pleasant · Westchester County",
 *       "New York City · Brooklyn (Kings County)" — with no ETJ and no "Unincorporated" wording.
 * KNOWN-GOOD ARM (an instrument that cannot see a drawn layer voids the run instead of scoring it): a Texas site's county lines are run the same
 * way and must draw, and its badge must not read like NJ / NY.
 *
 * Needs outbound HTTPS to services2.arcgis.com + services6.arcgis.com. From the build sandbox that goes through the agent proxy
 * ($HTTPS_PROXY, trusted via the NSS store the environment setup script fills — NEVER pass --ignore-certificate-errors). Exits 2 (VOID), not 0,
 * if the network is unreachable.
 *
 *   npm run build && npx vite preview --port 4173 --strictPort &      node ui-audit/verify-njny-lines.mjs        (BASE_URL defaults to :4173) */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const PROXY = process.env.PW_PROXY || process.env.HTTPS_PROXY || "";

const H = 535.5;
const parcel = { id: "pc1", locked: true, points: [{ x: -H, y: -H }, { x: H, y: -H }, { x: H, y: H }, { x: -H, y: H }] };
const mkSite = (id, lat, lon, county, layerOverrides) => ({
  id, groupId: id, site: `Site ${id}`, name: "Concept A",
  origin: { lat, lon }, county, layerOverrides,
  parcels: [parcel], els: [], measures: [], callouts: [], markups: [], settings: {},
  underlay: null, sheetOverlays: [], parcelDrawings: [], updatedAt: Date.now(),
});
const NJ_ON = { nj_county: true, nj_city: true };
const NY_ON = { ny_county: true, ny_city: true, ny_town: true, ny_village: true };
const SITES = {
  NJ1: mkSite("NJ1", 40.8509, -73.9701, "nj_statewide", NJ_ON),            // Fort Lee (Bergen)
  NY1: mkSite("NY1", 41.1329, -73.7926, "ny_statewide", NY_ON),            // Pleasantville (Mount Pleasant, Westchester)
  NYC1: mkSite("NYC1", 40.6782, -73.9442, "ny_statewide", NY_ON),          // Brooklyn (Kings)
  TX1: mkSite("TX1", 29.7836, -95.8244, "harris", { jur_county: true }),
};

const launch = { executablePath: EXEC, args: ["--no-sandbox"] };
// Chromium flags, not Playwright's `proxy` option: the latter sent localhost through the relay too (the app never loaded).
if (PROXY) launch.args.push("--proxy-server=" + PROXY, "--proxy-bypass-list=localhost;127.0.0.1");
const browser = await chromium.launch(launch);
let fail = 0, voided = 0;
const check = (name, ok, extra = "") => { console.log(`  ${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) fail++; };

async function open(siteId, hosts, settleMs) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(`(()=>{try{if(!localStorage.getItem('planarfit:sites:v1')){localStorage.setItem('planarfit:sites:v1',JSON.stringify(${JSON.stringify(SITES)}));localStorage.setItem('planarfit:currentSite:v1','${siteId}');}}catch(e){}})()`);
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-njny-lines");
  const seen = {};
  page.on("response", (r) => { for (const h of hosts) if (r.url().includes(h)) (seen[h] = seen[h] || []).push(r.status()); });
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(2500);
  // The app opens on the Dashboard; the planner is the "Site" tab.
  try { await page.locator("button:visible", { hasText: /^Site$/ }).first().click({ timeout: 5000 }); } catch (_) {}
  await page.waitForTimeout(settleMs);
  const after = await page.evaluate(() => ({
    geom: document.querySelectorAll(".leaflet-pane svg path").length,
    canvases: document.querySelectorAll(".leaflet-pane canvas").length,
    badge: Array.from(document.querySelectorAll("[data-jurisdiction-full]")).map((n) => n.getAttribute("data-jurisdiction-full")).filter(Boolean),
    text: document.body.innerText,
  }));
  await ctx.close();
  return { after, seen };
}
const toast = (a) => (a.text.match(/[^\n]*(?:layer failed|no vector source)[^\n]*/i) || [""])[0];

console.log("— known-good arm: Texas county lines + badge on a Texas site —");
const tx = await open("TX1", ["Texas_County_Boundaries"], 14000);
if (!Object.keys(tx.seen).length) { console.log("  VOID — the browser could not reach the TxDOT service (network egress); this run measures nothing."); voided++; }
else {
  check("Texas county layer answered 200", (tx.seen.Texas_County_Boundaries || []).some((s) => s === 200));
  check("Texas county lines DRAW (the instrument can see a drawn layer)", tx.after.geom + tx.after.canvases > 0, `${tx.after.geom} paths + ${tx.after.canvases} canvases`);
  check("the Texas site's badge reads like Texas, not like NJ / NY", !tx.after.badge.some((t) => /Village of|Town of|Township of|Borough of|New York|New Jersey/i.test(t)), JSON.stringify(tx.after.badge));
}

const ARMS = [
  ["NJ1", "New Jersey · Fort Lee", ["NJ_Counties_3857", "NJ_Municipalities_3857"], [/^Borough of Fort Lee · Bergen County$/]],
  ["NY1", "New York · Pleasantville", ["NYS_Civil_Boundaries/FeatureServer/2", "NYS_Civil_Boundaries/FeatureServer/5", "NYS_Civil_Boundaries/FeatureServer/7"], [/^Village of Pleasantville · Town of Mount Pleasant · Westchester County$/]],
  ["NYC1", "New York City · Brooklyn", ["NYS_Civil_Boundaries/FeatureServer/2", "NYS_Civil_Boundaries/FeatureServer/4"], [/^New York City · Brooklyn \(Kings County\)$/]],
];
for (const [id, label, hosts, badgeRes] of ARMS) {
  console.log(`— ${label} —`);
  const r = await open(id, hosts, 15000);
  if (!Object.keys(r.seen).length) { console.log("  VOID — none of the NJ / NY services was reached from the browser (network egress); this run measures nothing."); voided++; continue; }
  for (const h of hosts) check(`requested ${h.replace("NYS_Civil_Boundaries/FeatureServer/", "NYS Civil Boundaries layer ")} and it answered 200`, (r.seen[h] || []).some((s) => s === 200), `statuses ${JSON.stringify(r.seen[h] || [])}`);
  check("vector geometry is on the map", r.after.geom + r.after.canvases > 0, `${r.after.geom} paths + ${r.after.canvases} canvases`);
  check("no 'layer failed' / 'no vector source registered' toast", !toast(r.after), toast(r.after));
  console.log("  badge:", JSON.stringify(r.after.badge));
  check("the badge names the municipality (and, in New York, the town and borough) exactly", r.after.badge.some((t) => badgeRes.some((re) => re.test(t))));
  check("the badge never says ETJ or Unincorporated", !r.after.badge.some((t) => /etj|unincorporated/i.test(t)));
}
await browser.close();
if (voided) { console.log("VOID"); process.exit(2); }
console.log(fail ? `FAIL (${fail})` : "PASS");
process.exit(fail ? 1 : 0);
