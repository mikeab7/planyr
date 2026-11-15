/* verify-nashville-live — Metro Nashville zoning sweep (NEW-1 / NEW-2 / NEW-3, 2026-11-12), LIVE on planyr.io, signed in as the test account.
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-nashville-live.mjs [https://planyr.io] [--shots <dir>]
 *
 * Runs the steps of V2115889 (the relay + the NashvilleNext policy row) and V2115890 (zoning / overlays / Downtown Code / PUDs, the satellite city, the Davidson parcel card,
 * the county-line placeholder lot) against the DEPLOYED build (read from /version.json in the same call as the assertions), on throwaway LOCATED plans it deletes and re-reads.
 * Known-good arms: Memphis must list Texas/Tennessee rows but NONE of the Nashville ones (an empty answer there would mean the instrument, not the rule, is dead); the zoning
 * click must find a card at all before its wording is judged. FOREGROUND-OR-VOID first. */
import { mkdirSync } from "node:fs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { LIVE_PREFIX, throwawayPlan, cleanupLive } from "./lib/liveFixtures.mjs";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const BASE = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const SHOTS = flag("--shots");
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
let failed = 0, voided = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };

const HOSTS = /HdTo6HJqh92wn4D8|\/gis-proxy\/maps\.nashville\.gov/;
const ELM_HILL = { lat: 36.148911, lng: -86.715502 };
const BELLE_MEADE = { lat: 36.09902, lng: -86.85619 };
const MEMPHIS = { lat: 35.1495, lng: -90.049 };
const NASH_IDS = ["tn_nash_zoning", "tn_nash_overlays", "tn_nash_dtc", "tn_nash_pud", "tn_nash_ccm"];
const CCM = "/gis-proxy/maps.nashville.gov/arcgis/rest/services/Planning/CCM/MapServer/2";

let s = null;
for (let attempt = 1; attempt <= 6 && !s; attempt++) {
  try { s = await openSignedIn({ base: BASE, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] }); }
  catch (e) { if (!/answered 50\d/.test(String(e.message)) || attempt === 6) throw e; await new Promise((r) => setTimeout(r, 20000)); }
}
const page = s.page;
await assertMeasurable(page, "verify-nashville-live");
await page.setViewportSize({ width: 1400, height: 900 });
const served = await page.evaluate(async () => (await fetch("/version.json", { cache: "no-store" }).then((r) => r.json())).build);
console.log(`signed in as ${s.proof.email} · served build ${served}`);
const sleep = (ms) => page.waitForTimeout(ms);

/* network log: every request / response to Metro's org or the relay's Metro host */
let log = [];
page.on("response", async (res) => {
  const u = res.url();
  if (!HOSTS.test(u)) return;
  const e = { url: u, status: res.status(), features: null };
  if (/\/query/.test(u)) { try { const j = await res.json(); e.features = Array.isArray(j.features) ? j.features.length : (typeof j.count === "number" ? j.count : null); } catch (_) { /* not json */ } }
  log.push(e);
});
page.on("request", (r) => { if (HOSTS.test(r.url())) log.push({ url: r.url(), status: "sent", features: null, req: true }); });
const hit = (re) => log.filter((e) => !e.req && re.test(e.url));
const sent = (re) => log.filter((e) => e.req && re.test(e.url));
const feats = (re) => hit(re).filter((e) => e.status === 200).reduce((n, e) => n + (e.features || 0), 0);

const cleanupIds = [];
const mk = (id, p, label) => ({ ...throwawayPlan(id), origin: { lat: p.lat, lon: p.lng }, site: `ZZ Live Check — ${label}`,
  // a small lot and building, so a tap just beside it lands on open ground (a tap ON a parcel selects it; it does not identify)
  parcels: [{ id: "p1", points: [{ x: -25, y: -25 }, { x: 25, y: -25 }, { x: 25, y: 25 }, { x: -25, y: 25 }], active: true, z: 0 }], els: [] });
const insert = async (plan) => {
  const err = await page.evaluate(async ([pl]) => {
    const { data: u } = await window.pfSupabase.auth.getUser();
    const { error } = await window.pfSupabase.from("sites").insert({ id: pl.id, group_id: pl.groupId, site: pl.site, name: pl.name, county: null, user_id: u.user.id, version: 1, data: pl });
    return error ? String(error.message) : null;
  }, [plan]);
  cleanupIds.push(plan.id);
  if (err) throw new Error("throwaway plan insert failed — " + err);
};
const openPanel = async (id) => {
  await page.goto(`${BASE}/?planyrDiag=1#/project/${id}/site`, { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("planner-canvas").waitFor({ timeout: 60000 });
  await sleep(2500);
  const chip = page.getByTestId("layers-expand").filter({ visible: true });
  if (await chip.count()) await chip.first().click();
  const panel = page.locator('[data-testid="layer-panel"][data-surface="planner"]').first();
  await panel.waitFor({ state: "visible", timeout: 20000 });
  await sleep(900); // service-area geometry arrives by a dynamic import
  return panel;
};
const rowsIn = async (panel, group) => {
  const btn = panel.getByTestId(`layer-group-${group}`);
  if (await btn.count()) await btn.click(); else await panel.getByTestId("layer-group-select").selectOption(group);
  await sleep(300);
  return panel.evaluate((root) => [...root.querySelectorAll('[data-testid^="layer-row-"]')].filter((r) => !r.getAttribute("data-testid").endsWith("-menu")).map((r) => r.getAttribute("data-testid").replace("layer-row-", "")));
};
/* A row's legend lives inside its ▾ menu (`layer-caret-<id>`), not on the row: open it, read the panel, close it. */
const legendOf = async (panel, id) => {
  await panel.getByTestId("layer-group-jur").click(); await sleep(250);
  const caret = panel.getByTestId(`layer-caret-${id}`);
  await caret.click(); await sleep(1200);
  const text = await panel.innerText();
  await caret.click().catch(() => {}); await sleep(300);
  return text;
};
const tapForCard = async (re, offsets) => {
  const box = await page.getByTestId("planner-canvas").boundingBox();
  let card = "", tried = 0;
  for (const [dx, dy] of offsets) {
    await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
    await sleep(2500);
    card = await page.getByTestId("gis-identify").first().innerText().catch(() => "");
    tried++;
    if (re.test(card)) break;
  }
  return { card, tried };
};
const OFFSETS = [[220, 30], [-240, 50], [230, 190], [-230, 190], [280, -60], [0, 220], [-120, -150], [150, -170]];

try {
  /* ── V2115889 steps 1–3: the relay reaches Metro ─────────────────────────────────────────── */
  const rel = await page.evaluate(async (ccm) => {
    const out = {};
    try {
      const r = await fetch(ccm + "?f=json"); out.status = r.status; const j = await r.json();
      out.fields = (j.fields || []).map((f) => f.name); out.error = j.error ? JSON.stringify(j.error) : null;
    } catch (e) { out.threw = String(e); }
    const q = async (x, y) => { try { const u = `${ccm}/query?geometry=${x},${y}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=PolicyCode,PolicyDesc,Transect&returnGeometry=false&f=json`; const r = await fetch(u); const j = await r.json(); return { status: r.status, feats: (j.features || []).map((f) => f.attributes), error: j.error ? JSON.stringify(j.error) : null }; } catch (e) { return { threw: String(e) }; } };
    out.elm = await q(-86.715502, 36.148911); out.down = await q(-86.7816, 36.1627);
    try { const r = await fetch(`${ccm}/query?where=1%3D1&returnCountOnly=true&f=json`); out.total = (await r.json()).count; } catch (e) { out.totalErr = String(e); }
    return out;
  }, CCM);
  console.log("relay →", JSON.stringify(rel).slice(0, 700));
  check("V2115889·1 the relay answers for maps.nashville.gov (not 'host not allowed')", rel.status === 200 && !rel.error && !rel.threw, JSON.stringify({ status: rel.status, error: rel.error, threw: rel.threw }));
  check("V2115889·1 the layer carries PolicyCode / PolicyDesc / Transect / DateAdopted", ["PolicyCode", "PolicyDesc", "Transect", "DateAdopted"].every((f) => (rel.fields || []).includes(f)), (rel.fields || []).join(","));
  check("V2115889·2 a point query answers at Elm Hill Pike", rel.elm && rel.elm.status === 200 && rel.elm.feats.length >= 1, JSON.stringify(rel.elm && rel.elm.feats));
  check("V2115889·2 a point query answers downtown", rel.down && rel.down.status === 200 && rel.down.feats.length >= 1, JSON.stringify(rel.down && rel.down.feats));
  console.log(`V2115889·2/3 measured: Elm Hill → ${JSON.stringify(rel.elm && rel.elm.feats)} · downtown → ${(rel.down && rel.down.feats || []).length} polygon(s) · total ${rel.total}`);
  check("V2115889·3 the whole layer is about 33,105 polygons (the sweep's figure)", Number(rel.total) > 25000 && Number(rel.total) < 45000, String(rel.total));

  /* ── plans: Elm Hill (all rows), Belle Meade (satellite city), Memphis (control) ─────────── */
  const tag = Date.now().toString(36);
  const elm = mk(`${LIVE_PREFIX}nash-elm-${tag}`, ELM_HILL, "Elm Hill Pike");
  const bm = mk(`${LIVE_PREFIX}nash-bm-${tag}`, BELLE_MEADE, "Belle Meade");
  const mem = mk(`${LIVE_PREFIX}nash-mem-${tag}`, MEMPHIS, "Memphis");
  await insert(elm); await insert(bm); await insert(mem);

  /* ── V2115890 steps 1–2, 5: rows are Davidson-only, off by default, draw ────────────────── */
  log = [];
  let panel = await openPanel(elm.id);
  const jur = await rowsIn(panel, "jur");
  console.log("Elm Hill · Jurisdictions rows:", jur.join(", "));
  for (const id of NASH_IDS) check(`V2115890·1 Jurisdictions lists "${id}" at Elm Hill`, jur.includes(id));
  const offOnOpen = await panel.evaluate((root, ids) => ids.map((id) => { const cb = root.querySelector(`[data-testid="layer-row-${id}"] input[type="checkbox"]`); return [id, cb ? cb.checked : null]; }), NASH_IDS);
  check("V2115890·1 all five start OFF", offOnOpen.every(([, on]) => on === false), JSON.stringify(offOnOpen));
  check("V2115890·1 nothing is requested from Metro's org or relay before a layer is on", sent(HOSTS).length === 0, `${sent(HOSTS).length}: ${sent(HOSTS).slice(0, 2).map((e) => e.url.slice(0, 90)).join(" | ")}`);
  const turnOn = async (id) => {
    await panel.getByTestId("layer-group-jur").click(); await sleep(250);
    const cb = panel.locator(`[data-testid="layer-row-${id}"] input[type="checkbox"]`).first();
    if (!(await cb.count())) { check(`row "${id}" has a checkbox`, false); return; }
    if (!(await cb.isChecked())) await cb.check();
  };
  for (const id of ["tn_nash_zoning", "tn_nash_overlays", "tn_nash_ccm"]) await turnOn(id);
  await sleep(11000);
  check("V2115890·2 Zoning: Metro's org answered with polygons", feats(/Zoning_Vw\/FeatureServer\/0\/query/) > 0, `${feats(/Zoning_Vw\/FeatureServer\/0\/query/)} features`);
  check("V2115890·5 Overlays: Metro's org answered with polygons", feats(/Zoning_Overlay_Districts_Vw\/FeatureServer\/0\/query/) > 0, `${feats(/Zoning_Overlay_Districts_Vw\/FeatureServer\/0\/query/)} features`);
  check("V2115889·5 Policy: the RELAY answered with polygons (the browser never called Metro's server directly)", feats(/\/gis-proxy\/maps\.nashville\.gov\/.*MapServer\/2\/query/) > 0 && !log.some((e) => /^https:\/\/maps\.nashville\.gov/.test(e.url)), `${feats(/\/gis-proxy\/maps\.nashville\.gov\/.*MapServer\/2\/query/)} features`);
  const bad = log.filter((e) => !e.req && typeof e.status === "number" && e.status >= 400);
  check("no request to Metro's org or the relay failed", bad.length === 0, bad.slice(0, 3).map((e) => `${e.status} ${e.url.slice(-90)}`).join(" | "));
  const panelText = await panel.innerText();
  check("no row says it is too detailed to draw, and the tab stayed responsive", !/too detailed/i.test(panelText) && (await page.evaluate(() => 1 + 1)) === 2, (panelText.match(/too detailed[^\n]*/i) || [""])[0]);
  console.log("panel text (excerpt):", panelText.replace(/\n+/g, " | ").slice(0, 700));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/elm-hill-layers.png` });

  /* ── V2115890 steps 3–4: legend and the click card at Elm Hill ──────────────────────────── */
  const zLegend = await legendOf(panel, "tn_nash_zoning");
  const zLines = zLegend.split("\n").map((l) => l.trim()).filter(Boolean);
  const zHead = zLines.indexOf("Metro Nashville");
  console.log("zoning legend lines:", zLines.slice(Math.max(0, zHead), zHead + 10).join(" | "));
  check('V2115890·3 the Zoning legend is ONE heading "Metro Nashville" (no suffix on any row)', zHead >= 0 && zLines.filter((l) => l === "Metro Nashville").length === 1 && !/\((Metro|Nashville)\)/.test(zLegend), "");
  check('V2115890·3 the named code reads "IR · Industrial Restrictive"; no row carries a ZZ code', /IR · Industrial Restrictive/.test(zLegend) && !/\b\dZZ\b/.test(zLegend), "");
  const pLegend = await legendOf(panel, "tn_nash_ccm");
  check('V2115889·6 the policy legend is headed "NashvilleNext policy" with "CO · Conservation" in view', /NashvilleNext policy/.test(pLegend) && /CO · Conservation/.test(pLegend), (pLegend.match(/NashvilleNext policy[^\n]*\n?[^\n]*/) || [""])[0]);
  const oLegend = await legendOf(panel, "tn_nash_overlays");
  check('V2115890·5 the overlay legend is headed "Metro Nashville overlays" and lists Airport Impact', /Metro Nashville overlays/.test(oLegend) && /Airport Impact/.test(oLegend), "");
  const z = await tapForCard(/Zoning · /, OFFSETS);
  console.log(`(zoning card found after ${z.tried} tap(s))`);
  console.log("identify card:\n" + z.card.split("\n").map((l) => "   " + l).join("\n"));
  if (!/Zoning · /.test(z.card)) { console.log("VOID: no zoning card at any tap point — the click flow itself found nothing"); voided++; }
  check("V2115890·4 the card is titled for the government that zones the site: Zoning · Metro Nashville", /Zoning · Metro Nashville/.test(z.card), (z.card.match(/Zoning · [^\n]*/) || [""])[0]);
  check("V2115890·4 it has a Zone row and an Ordinance row, in plain words", /Zone\s*\n?\s*\S+/.test(z.card) && /Ordinance/.test(z.card) && !/ZONE_DESC|ORD_DATE|OBJECTID|null|undefined/.test(z.card), "");
  check("V2115890·4 no 'ZZ' placeholder code is ever printed", !/\b\dZZ\b/.test(z.card));
  const pol = /Community character policy/.test(z.card);
  console.log("policy card present in this click:", pol);
  if (pol) {
    check("V2115889·5 the policy card says it is a planning policy, not zoning, with a Policy row", /not zoning/i.test(z.card) && /Policy/.test(z.card), "");
  }
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/elm-hill-card.png` });

  /* ── V2115890 step 6: satellite city ─────────────────────────────────────────────────────── */
  log = [];
  panel = await openPanel(bm.id);
  await turnOn("tn_nash_zoning");
  await sleep(10000);
  const b = await tapForCard(/Zoning · /, OFFSETS);
  console.log("Belle Meade card:\n" + b.card.split("\n").map((l) => "   " + l).join("\n"));
  if (!/Zoning · /.test(b.card)) { console.log("VOID: no zoning card at Belle Meade"); voided++; }
  check("V2115890·6 Belle Meade reads: Zoning · City of Belle Meade", /Zoning · City of Belle Meade/.test(b.card), (b.card.match(/Zoning · [^\n]*/) || [""])[0]);
  check('V2115890·6 and says "Zoned by City of Belle Meade — not Metro"', /Zoned by City of Belle Meade — not Metro/.test(b.card), "");
  check("V2115890·6 no ZZ code and no Metro code is printed", !/\b\dZZ\b/.test(b.card) && !/\bZone\b\s*\n?\s*[A-Z]/.test(b.card), "");
  const bmPanel = await legendOf(panel, "tn_nash_zoning");
  check('V2115890·6 the legend has the one "Satellite cities — zoned by each city" row', (bmPanel.match(/Satellite cities — zoned by each city/g) || []).length === 1, "");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/belle-meade-card.png` });

  /* ── V2115890 step 1 (control): Memphis lists none and asks for none ─────────────────────── */
  log = [];
  const pm = await openPanel(mem.id);
  const jurMem = await rowsIn(pm, "jur");
  console.log("Memphis · Jurisdictions rows:", jurMem.join(", "));
  check("KNOWN-GOOD arm: Memphis lists its own Jurisdictions rows (so an empty answer is not an empty registry)", jurMem.length > 0 && jurMem.includes("counties_cities"), `${jurMem.length} rows`);
  if (!(jurMem.length > 0 && jurMem.includes("counties_cities"))) voided++;
  check("V2115890·1 Memphis offers none of the five Nashville rows", NASH_IDS.every((id) => !jurMem.includes(id)), NASH_IDS.filter((id) => jurMem.includes(id)).join(", "));
  await sleep(3000);
  check("V2115890·1 Memphis issues ZERO requests to Metro's org or the Metro relay", sent(HOSTS).length === 0, `${sent(HOSTS).length}: ${sent(HOSTS).slice(0, 2).map((e) => e.url.slice(0, 90)).join(" | ")}`);

  /* ── V2115890 steps 7–8: overlay at Vultee (own plan not needed: the Elm Hill point is inside Airport Impact), DTC and PUD cards by service, then the parcel card ── */
  // The Elm Hill click already sits inside the Airport Impact overlay (measured 2026-11-12). Read it from the card that click produced.
  check("V2115890·5 the overlay card at Elm Hill (Airport Impact) names the overlay and says it adds to the base zoning", /Overlay · Airport Impact/.test(z.card) && /both apply/i.test(z.card), (z.card.match(/Overlay · [^\n]*/) || ["(no overlay card in that click)"])[0]);

  /* ── V2115890 step 7: Downtown Code subdistrict and a PUD, each on a plan AT its own polygon (centroids measured 2026-11-12) ── */
  for (const [label, pt, rowId, titleRe, wantRe] of [
    ["Downtown (James Robertson / Core area)", { lat: 36.16742, lng: -86.78279 }, "tn_nash_dtc", /Downtown Code · /, /Subdistrict/],
    ["Bellevue-area PUD", { lat: 36.12486, lng: -86.80306 }, "tn_nash_pud", /Planned unit development/, /Type/],
  ]) {
    log = [];
    const pl = mk(`${LIVE_PREFIX}nash-${rowId.slice(-3)}-${tag}`, pt, label);
    await insert(pl);
    panel = await openPanel(pl.id);
    await turnOn(rowId);
    await sleep(9000);
    const r = await tapForCard(titleRe, OFFSETS);
    console.log(`${label} card:\n` + r.card.split("\n").map((l) => "   " + l).join("\n"));
    if (!titleRe.test(r.card)) { console.log(`VOID: no ${rowId} card at any tap point`); voided++; }
    check(`V2115890·7 ${label}: the click card is the ${rowId === "tn_nash_dtc" ? "Downtown Code" : "PUD"} card, in plain words`, titleRe.test(r.card) && wantRe.test(r.card) && !/ZONE_DESC|UseArea|OBJECTID|null|undefined/.test(r.card), (r.card.match(titleRe) || [""])[0]);
    check(`V2115890·7 ${label}: Metro's org answered with polygons`, feats(rowId === "tn_nash_dtc" ? /Downtown_Code_Subdistricts_and_Use_Areas_view\/FeatureServer\/0\/query/ : /Planned_Unit_Developments_Vw\/FeatureServer\/0\/query/) > 0, "");
  }

  /* ── V2115890 step 8: the Davidson parcel card, by address ───────────────────────────────── */
  log = [];
  await page.goto(BASE + "/?planyrDiag=1#/site", { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__mapFinderMap && !!document.querySelector('input[placeholder^="Type an address"]'), null, { timeout: 45000 });
  const inp = page.locator('input[placeholder^="Type an address"]').first();
  await inp.fill("20 Culvert St, Nashville, TN");
  await sleep(600);
  await inp.press("Enter");
  let ctext = "";
  for (let i = 0; i < 50; i++) { await sleep(1000); ctext = await page.evaluate(() => document.body.innerText); if (/AKZO/i.test(ctext)) break; }
  const more = page.getByText(/More details/i).first();
  if (await more.count()) { await more.click().catch(() => {}); await sleep(1200); ctext = await page.evaluate(() => document.body.innerText); }
  console.log("parcel card text (excerpt):", (ctext.match(/[^\n]*AKZO[^\n]*(\n[^\n]*){0,16}/i) || ["(none)"])[0].replace(/\n/g, " | ").slice(0, 600));
  if (!/AKZO/i.test(ctext)) { console.log("VOID: the address search did not find the Culvert St lot"); voided++; }
  check("V2115890·8 the card shows the owner (AKZO NOBEL) — the lot itself was found", /AKZO/i.test(ctext), "");
  check('V2115890·8 "Zoning (per assessor)" reads IR, IWD', /Zoning \(per assessor\)\s*\n?\s*IR, IWD/.test(ctext), (ctext.match(/Zoning \(per assessor\)[^\n]*\n?[^\n]*/) || [""])[0]);
  check('V2115890·8 "Tax district" reads USD', /Tax district\s*\n?\s*USD/.test(ctext), (ctext.match(/Tax district[^\n]*\n?[^\n]*/) || [""])[0]);
  check('V2115890·8 "Council district" reads 16', /Council district\s*\n?\s*16/.test(ctext), (ctext.match(/Council district[^\n]*\n?[^\n]*/) || [""])[0]);
  check('V2115890·8 "Land use" reads Heavy Manufacturing', /Land use\s*\n?\s*Heavy Manufacturing/i.test(ctext), "");
  const link = await page.evaluate(() => { const a = [...document.querySelectorAll("a")].find((x) => /padctn\.org/.test(x.href)); return a ? a.href : null; });
  check("V2115890·8 the Assessor portal link goes to https://portal.padctn.org/OFS/WP/Home", link === "https://portal.padctn.org/OFS/WP/Home", String(link));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/culvert-card.png` });

  /* ── V2115890 step 9: a lot across the county line never answers with a Metro card ───────── */
  const WILSON_LOT = { lat: 36.14772, lng: -86.55718 }; // FEATURETYPE 'Wilson', "ASSESSED IN WILSON COUNTY" (Metro's layer draws it; measured 2026-11-12)
  log = [];
  await page.goto(BASE + "/?planyrDiag=1#/site", { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__mapFinderMap && !!document.querySelector('[data-testid="map-toolbar-select-parcels"]'), null, { timeout: 45000 });
  await sleep(1200);
  await page.evaluate(([a, c]) => window.__mapFinderMap.setView([a, c], 17, { animate: false }), [WILSON_LOT.lat, WILSON_LOT.lng]);
  await sleep(900);
  await page.locator('[data-testid="map-toolbar-select-parcels"]').first().click();
  await sleep(1500);
  const cp = await page.evaluate(([a, c]) => { const m = window.__mapFinderMap, p = m.latLngToContainerPoint([a, c]), r = m.getContainer().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; }, [WILSON_LOT.lat, WILSON_LOT.lng]);
  await sleep(4000); // let the outline tiles settle, then judge only what the CLICK itself asks
  log = [];
  await page.mouse.click(cp.x, cp.y);
  await sleep(9000);
  const held = await page.evaluate(() => (window.__mapSelectedParcels ? window.__mapSelectedParcels() : [])).catch(() => []);
  const metroHeld = held.filter((h) => h && h.attrs && ("FEATURETYPE" in h.attrs || "STANPAR" in h.attrs));
  const clickQs = log.filter((e) => /Parcels_view\/FeatureServer\/0\/query/.test(e.url) && /geometryType=esriGeometryPoint/.test(decodeURIComponent(e.url)));
  const reqs = clickQs.filter((e) => e.req), ans = clickQs.filter((e) => !e.req);
  console.log("Wilson-line click: held", held.length, JSON.stringify(held.map((h) => h && { county: h.county, keys: Object.keys(h.attrs || {}).slice(0, 5) })), "· Metro point queries", reqs.length, "answers", ans.map((e) => `${e.status}:${e.features}`).join(","));
  check("V2115890·9 no Metro Nashville lot is selected for a lot assessed in Wilson County", metroHeld.length === 0, JSON.stringify(metroHeld.map((h) => h.attrs && h.attrs.FEATURETYPE)));
  check("V2115890·9 Metro's parcel server WAS asked for the click (so 'no lot' is its answer, not a skipped call)", reqs.length > 0, `${reqs.length} point request(s)`);
  check("V2115890·9 every click request carried the placeholder filter, and none returned a lot", reqs.length > 0 && reqs.every((e) => /FEATURETYPE/i.test(decodeURIComponent(e.url))) && ans.every((e) => e.status === 200 && !e.features), JSON.stringify(ans.map((e) => [e.status, e.features])));
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
