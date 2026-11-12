/* verify-rutherford-zoning-live — Rutherford County TN zoning (NEW-1, 2026-11-12): county + Murfreesboro + Smyrna + La Vergne, ONE "Zoning" row, measured LIVE on planyr.io signed in as the test account.
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-rutherford-zoning-live.mjs [https://planyr.io] [--expect-sha <sha>] [--shots <dir>]
 *
 * READ-ONLY on every real project: it seeds THROWAWAY located plans (deleted and the deletion re-read, owner rule 15) and, for each of the five clusters,
 *   A. the Jurisdictions group offers ONE merged "Zoning" row (`layer-row-tn_rutherford_zoning`) — and a Nashville plan is offered NONE of it (a region-scoped row);
 *   B. KNOWN-GOOD ARM — the member service is asked SEPARATELY from the page (a point query) and says which code is under the click; the run is VOID if the service cannot be asked;
 *   C. with the row ON the four services answer with features (counted from the page's own network), and none fails;
 *   D. a click on the planner canvas answers with ONE card whose title names the GOVERNMENT the site falls in ("Zoning · Murfreesboro", "· Smyrna", "· La Vergne",
 *      "· Unincorporated Rutherford County") and whose zone is the code the service itself reported — never a field name, never two cards for one click;
 *   E. the Zoning row's dropdown legend is HEADED by the government with one code per row (no "(Smyrna)" suffix);
 *   F. THE ANNEXATION CASE — a point the county's older layer still zones but the State's city limits put inside Murfreesboro (and the city's own layer shows no district) answers with the
 *      CITY'S card, says the city's layer shows no district, and shows the county's district only under "County's older layer shows" — never as the city's zoning.
 * FOREGROUND-OR-VOID first. Run `verify-layer-no-freeze.mjs --ids tn_rutherford_zoning@12 --view 35.80,-86.40,12` for the stall budget (the 164-ac Capital Way polygon is 132 vertices). */
import { mkdirSync } from "node:fs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { LIVE_PREFIX, throwawayPlan, cleanupLive } from "./lib/liveFixtures.mjs";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const BASE = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const EXPECT_SHA = flag("--expect-sha");
const SHOTS = flag("--shots");
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
let failed = 0, voided = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };
const voidRun = (why) => { console.log(`⚠ VOID — ${why}`); voided++; };

const ORG = "https://services.arcgis.com/36I6IHIdr660pAyH/arcgis/rest/services";
const SERVICES = {
  county: { url: `${ORG}/Zoning_Hub_Data/FeatureServer/2`, field: "ZONEABBRV", where: "(ZONEABBRV IS NULL OR ZONEABBRV <> 'CITY') AND (ZONING IS NULL OR ZONING NOT IN ('CITY','ANNEXED'))" },
  murfreesboro: { url: "https://services5.arcgis.com/A5C0MR9xfkxVRwat/arcgis/rest/services/City_Zoning_inc_Historic_Zoning_WFL1/FeatureServer/45", field: "SubZoning", where: "ParcelType <> 'r' OR ParcelType IS NULL" },
  smyrna: { url: `${ORG}/Smyrna_Zoning/FeatureServer/0`, field: "ZONING_DIST", where: "1=1" },
  lavergne: { url: `${ORG}/LaVergne_Zoning/FeatureServer/0`, field: "Zoning_Typ", where: "1=1" },
};
/* Smyrna's integer → code, for the known-good comparison only (the page's own table is what is on trial, so the expected text below is written out by hand). */
const CLUSTERS = [
  { key: "capital", label: "Capital Way, Christiana", at: { lat: 35.7208, lng: -86.3254 }, svc: "county", title: /^Zoning · Unincorporated Rutherford County$/, zone: /EAC · Employment & Activity Center/ },
  { key: "joe", label: "1975 Joe B Jackson Pkwy, Murfreesboro", at: { lat: 35.78075, lng: -86.36112 }, svc: "murfreesboro", title: /^Zoning · Murfreesboro$/, zone: /L-I · Light Industrial/ },
  { key: "smyrna", label: "Smyrna (-86.52, 35.98)", at: { lat: 35.98, lng: -86.52 }, svc: "smyrna", title: /^Zoning · Smyrna$/, zone: /R-1 · Low Density Residential/ },
  { key: "lavergne", label: "La Vergne (I-1)", at: { lat: 36.02302, lng: -86.55807 }, svc: "lavergne", title: /^Zoning · La Vergne$/, zone: /I-1 · Light Industrial/ },
];
const ANNEXED = { label: "annexed ground inside Murfreesboro (county RM, no city district)", at: { lat: 35.80044, lng: -86.37264 } };
const NASHVILLE = { lat: 36.1627, lng: -86.7816 };

let s = null;
for (let attempt = 1; attempt <= 6 && !s; attempt++) {
  try { s = await openSignedIn({ base: BASE, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] }); }
  catch (e) { if (!/answered 50\d/.test(String(e.message)) || attempt === 6) throw e; await new Promise((r) => setTimeout(r, 20000)); }
}
const page = s.page;
await assertMeasurable(page, "verify-rutherford-zoning-live");
await page.setViewportSize({ width: 1500, height: 950 });
const served = await page.evaluate(async () => (await fetch("/version.json", { cache: "no-store" }).then((r) => r.json())).build);
console.log(`signed in as ${s.proof.email} · served build ${served}`);
if (EXPECT_SHA) check("served build is the merge commit", String(served).startsWith(EXPECT_SHA.slice(0, 7)), `${served} vs ${EXPECT_SHA}`);
const sleep = (ms) => page.waitForTimeout(ms);
const cleanupIds = [];

/* every zoning-service query the page makes: url → status and feature count (the page's own network, not a re-ask) */
const net = [];
page.on("response", async (r) => {
  const u = r.url();
  if (!/FeatureServer\/\d+\/query/.test(u) || !/Zoning_Hub_Data|City_Zoning_inc_Historic|Smyrna_Zoning|LaVergne_Zoning|TN_Cities_view/.test(u)) return;
  let features = null;
  try { const j = await r.json(); features = Array.isArray(j.features) ? j.features.length : null; } catch (_) { /* not json */ }
  net.push({ url: u, status: r.status(), features });
});
const netFor = (re) => net.filter((e) => re.test(e.url));
const featsFor = (re) => netFor(re).filter((e) => e.status === 200).reduce((n, e) => n + (e.features || 0), 0);

const seed = async (id, at, label) => {
  const plan = { ...throwawayPlan(id), origin: { lat: at.lat, lon: at.lng }, site: `ZZ Live Check — ${label}` };
  const err = await page.evaluate(async ([pl]) => { const { data: u } = await window.pfSupabase.auth.getUser(); const { error } = await window.pfSupabase.from("sites").insert({ id: pl.id, group_id: pl.groupId, site: pl.site, name: pl.name, county: null, user_id: u.user.id, version: 1, data: pl }); return error ? String(error.message) : null; }, [plan]);
  cleanupIds.push(id);
  if (err) throw new Error("throwaway plan insert failed — " + err);
};
const openPlan = async (id) => {
  await page.goto(`${BASE}/?planyrDiag=1#/project/${id}/site`, { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("planner-canvas").waitFor({ timeout: 60000 });
  await sleep(2500);
};
const openJurisdictions = async () => {
  const chip = page.getByTestId("layers-expand").filter({ visible: true });
  if (await chip.count()) await chip.first().click();
  const panel = page.locator('[data-testid="layer-panel"][data-surface="planner"]').first();
  await panel.waitFor({ state: "visible", timeout: 20000 });
  await panel.getByTestId("layer-group-jur").click(); await sleep(400);
  return panel;
};
const rowIds = (panel) => panel.evaluate((root) => [...root.querySelectorAll('[data-testid^="layer-row-"]')].map((r) => r.getAttribute("data-testid").replace("layer-row-", "")).filter((x) => !x.endsWith("-menu")));
/* the independent truth: ask the member service about the point from the PAGE (a different code path from the layer) */
const truthAt = (key, at) => page.evaluate(async ([svc, p]) => {
  const u = `${svc.url}/query?where=${encodeURIComponent(svc.where)}&geometry=${p.lng},${p.lat}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=${svc.field}&returnGeometry=false&f=json`;
  try { const j = await (await fetch(u)).json(); return (j.features || []).map((f) => f.attributes[svc.field]); } catch (e) { return null; }
}, [SERVICES[key], at]);
const clickForCard = async (titleRe) => {
  const box = await page.getByTestId("planner-canvas").boundingBox();
  let card = "", tried = 0;
  // a tap on a parcel selects it, it does not identify: try several EMPTY points so one gap in the data cannot decide it
  for (const [dx, dy] of [[260, 40], [-300, 60], [280, 200], [-280, 200], [320, -60], [0, 230], [-120, -150], [150, -200]]) {
    await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
    await sleep(2500);
    card = await page.getByTestId("gis-identify").first().innerText().catch(() => "");
    tried++;
    if (titleRe.test(card.split("\n")[0] || "") || /Zoning · /.test(card)) break;
  }
  return { card, tried };
};

try {
  for (const c of CLUSTERS) {
    console.log(`\n── ${c.label} ──`);
    const id = `${LIVE_PREFIX}rz-${c.key}-${Date.now().toString(36)}`;
    await seed(id, c.at, c.label);
    net.length = 0;
    await openPlan(id);
    const panel = await openJurisdictions();
    const ids = await rowIds(panel);
    check("A · the Jurisdictions group offers ONE merged Zoning row", ids.includes("tn_rutherford_zoning"), ids.join(", "));
    check("A · …and none of the four members as a row of its own", !ids.some((x) => /^tn_rz_/.test(x)));
    const cb = panel.locator('[data-testid="layer-row-tn_rutherford_zoning"] input[type="checkbox"]').first();
    if (!(await cb.count())) { check("A · the Zoning row has a checkbox", false); continue; }
    if (!(await cb.isChecked())) await cb.check();
    await sleep(9000);

    const truth = await truthAt(c.svc, c.at);
    if (!truth || !truth.length) voidRun(`${c.svc}'s own service could not be asked (or holds nothing) at ${c.at.lat},${c.at.lng} — the known-good arm has no ground truth`);
    else console.log(`B · the service itself says the code under the plan origin is ${JSON.stringify(truth)}`);

    check("C · the county service answered with zoning polygons", featsFor(/Zoning_Hub_Data/) > 0, `${featsFor(/Zoning_Hub_Data/)} features`);
    check("C · Murfreesboro's service answered", featsFor(/City_Zoning_inc_Historic/) > 0 || c.svc !== "murfreesboro", `${featsFor(/City_Zoning_inc_Historic/)} features`);
    check("C · Smyrna's service answered", featsFor(/Smyrna_Zoning/) > 0 || c.svc !== "smyrna", `${featsFor(/Smyrna_Zoning/)} features`);
    check("C · La Vergne's service answered", featsFor(/LaVergne_Zoning/) > 0 || c.svc !== "lavergne", `${featsFor(/LaVergne_Zoning/)} features`);
    check("C · the State's city limits (the government lookup) answered", featsFor(/TN_Cities_view/) > 0, `${featsFor(/TN_Cities_view/)} features`);
    const bad = net.filter((e) => e.status >= 400);
    check("C · no zoning request failed", bad.length === 0, bad.slice(0, 3).map((e) => `${e.status} ${e.url.slice(-70)}`).join(" | "));

    // D — the click card
    const { card, tried } = await clickForCard(c.title);
    console.log(`(card found after ${tried} tap(s))\n` + card.split("\n").map((l) => "     " + l).join("\n"));
    const title = (card.split("\n")[0] || "").trim();
    check("D · the card names the government the site falls in", c.title.test(title), title);
    check("D · …and the zone is the code the service itself reported, with its district name", c.zone.test(card), "");
    check("D · ONE zoning card for the click", (card.match(/Zoning · /g) || []).length === 1);
    check("D · no raw field name on the card", !/ZONEABBRV|ZONE_DIST|ZONING_DIST|SubZoning|Zoning_Typ|OBJECTID|ParcelType/.test(card));
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/D-${c.key}.png` });

    // E — the dropdown legend
    await panel.getByTestId("layer-caret-tn_rutherford_zoning").click().catch(() => {});
    await sleep(700);
    const legend = await panel.evaluate((root) => { const m = root.querySelector('[data-testid="layer-row-tn_rutherford_zoning-menu"] [data-part="legend"]'); return m ? { text: m.innerText, headings: [...m.querySelectorAll('[data-part="legend-heading"]')].map((h) => h.textContent.trim()) } : null; });
    console.log("E · legend headings:", legend ? JSON.stringify(legend.headings) : "(none)");
    check("E · the legend has a heading per government in view", !!legend && legend.headings.length >= 1);
    const want = { county: "Unincorporated Rutherford County", murfreesboro: "Murfreesboro", smyrna: "Smyrna", lavergne: "La Vergne" }[c.svc];
    check(`E · …including "${want}"`, !!legend && legend.headings.includes(want), legend ? legend.headings.join(" | ") : "");
    check("E · no row carries the government as a suffix", !!legend && !/\((Smyrna|Murfreesboro|La Vergne|Rutherford)[^)]*\)/.test(legend.text));
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/E-${c.key}-legend.png` });
  }

  // F — the annexation case
  console.log(`\n── F · ${ANNEXED.label} ──`);
  {
    const id = `${LIVE_PREFIX}rz-annex-${Date.now().toString(36)}`;
    await seed(id, ANNEXED.at, "annexed ground");
    await openPlan(id);
    const panel = await openJurisdictions();
    const cb = panel.locator('[data-testid="layer-row-tn_rutherford_zoning"] input[type="checkbox"]').first();
    if (!(await cb.isChecked())) await cb.check();
    await sleep(9000);
    const county = await truthAt("county", ANNEXED.at), city = await truthAt("murfreesboro", ANNEXED.at);
    if (!county || !county.length || !city || city.length) voidRun(`the annexation case is not in the state the check assumes (county ${JSON.stringify(county)}, city ${JSON.stringify(city)}) — the services have changed`);
    else {
      const { card } = await clickForCard(/Zoning · Murfreesboro/);
      console.log(card.split("\n").map((l) => "     " + l).join("\n"));
      check("F · the card is the CITY'S (Murfreesboro), not the county's", /Zoning · Murfreesboro/.test(card), card.split("\n")[0]);
      check("F · it says the city's own layer shows no district here", /own zoning layer shows no district at this point/.test(card));
      check("F · the county's district appears only under 'County's older layer shows'", /County's older layer shows/.test(card) && new RegExp(`County's older layer shows[\\s\\S]*${county[0]}`).test(card), `county says ${county[0]}`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/F-annexed.png` });
    }
  }

  // A (negative) — a Nashville plan is offered none of it
  console.log("\n── A · Nashville is offered none of it ──");
  {
    const id = `${LIVE_PREFIX}rz-nash-${Date.now().toString(36)}`;
    await seed(id, NASHVILLE, "Nashville");
    await openPlan(id);
    const panel = await openJurisdictions();
    const ids = await rowIds(panel);
    check("A · a Nashville plan is NOT offered the Rutherford Zoning row", !ids.includes("tn_rutherford_zoning") && !ids.some((x) => /^tn_rz_/.test(x)), ids.join(", "));
    check("A · …but is still offered Counties & Cities (the known-good arm for the row list)", ids.includes("counties_cities"), ids.join(", "));
  }
} finally {
  for (const id of cleanupIds) {
    const r = await cleanupLive(page, { planId: id }).catch((e) => ({ error: String(e) }));
    check(`throwaway plan ${id.slice(-8)} deleted and verified gone`, r && r.left && r.left.site === 0 && !(r.errors || []).length, JSON.stringify(r));
  }
  await s.close();
}
if (voided) console.log(`VOID — ${voided} precondition(s) failed; the run proves nothing`);
console.log(failed ? `FAIL (${failed})` : voided ? "VOID" : "PASS");
process.exit(failed ? 1 : voided ? 2 : 0);
