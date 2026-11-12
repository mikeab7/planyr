/* verify-tx-city-zoning-live — Texas city zoning layers (B2671234 Richmond · Fulshear · Stafford; B2671235 Webster), LIVE on planyr.io, signed in as the test account.
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-tx-city-zoning-live.mjs [https://planyr.io] [--expect-sha <sha>] [--shots <dir>] [--cities richmond,fulshear,stafford,webster]
 *
 * Against the DEPLOYED build (read from /version.json in the same call as the assertions), per city, on a throwaway LOCATED plan at a point deep inside one of that city's zoning polygons:
 *   A. the Jurisdictions group offers that city's "<City> Zoning" row(s) — and not another city's;
 *   B. with the row on, the city's service ANSWERS (200 with features) and the layer PAINTS what it was sent (window.__plannerLayers().features — esri-leaflet drops features if a
 *      `fields` list omits the object-id field, which no unit test can see), a click card carries the city's own code and name at a point ON a known polygon, the legend is headed by the
 *      city with one code per row, and a real canvas click opens the card;
 *   C. NOTHING LEAKS — a throwaway plan in Sugar Land (the neighbour; a known-good arm: it offers Sugar Land's own zoning row) and one in Houston offer none of these rows and issue ZERO
 *      requests to any of these services.
 * FOREGROUND-OR-VOID first. Throwaway plans are deleted at the end and the deletion re-read (owner rule 15). */
import { mkdirSync } from "node:fs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { LIVE_PREFIX, throwawayPlan, cleanupLive } from "./lib/liveFixtures.mjs";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const BASE = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const EXPECT_SHA = flag("--expect-sha");
const SHOTS = flag("--shots");
const ONLY = (flag("--cities") || "richmond,fulshear,stafford,webster").split(",");
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };

const HOSTS = /riku34rn6C8cs2t5|k1ZyjVw1fpWcwy7h|Ga5PFntoooL0Dlwu|cityofwebster\.com/;
/* Points DEEP INSIDE one polygon of each city's own layer (≥ 60 m from any edge; found 2026-11-12 from the layers' own geometry) and what the card must read there. */
const CITIES = {
  richmond: { label: "Richmond", at: { lat: 29.57854, lng: -95.77439 }, ids: ["richmond_zoning"], code: "IN", name: "Industrial", legend: /IN · Industrial/ },
  fulshear: { label: "Fulshear", at: { lat: 29.68929, lng: -95.8798 }, ids: ["fulshear_zoning", "fulshear_zoning_newer"], code: "I", name: "Industrial", legend: /I · Industrial/ },
  stafford: { label: "Stafford", at: { lat: 29.61953, lng: -95.5548 }, ids: ["stafford_zoning"], code: "RCT", name: "Residential, Commercial, & Technology District", legend: /RCT · Residential, Commercial, & Technology District/ },
  webster: { label: "Webster", at: { lat: 29.5379, lng: -95.1183 }, ids: ["webster_zoning"], code: null, name: null, legend: null },
};
const SUGAR_LAND = { lat: 29.6122, lng: -95.6693 };
const HOUSTON = { lat: 29.80, lng: -95.54 };
const ALL_IDS = Object.values(CITIES).flatMap((c) => c.ids);

let s = null;
for (let attempt = 1; attempt <= 6 && !s; attempt++) {
  try { s = await openSignedIn({ base: BASE, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] }); }
  catch (e) { if (!/answered 50\d/.test(String(e.message)) || attempt === 6) throw e; await new Promise((r) => setTimeout(r, 20000)); }
}
const page = s.page;
await assertMeasurable(page, "verify-tx-city-zoning-live");
await page.setViewportSize({ width: 1500, height: 950 });
const served = await page.evaluate(async () => (await fetch("/version.json", { cache: "no-store" }).then((r) => r.json())).build);
console.log(`signed in as ${s.proof.email} · served build ${served}`);
if (EXPECT_SHA) check("served build is the merge commit", String(served).startsWith(EXPECT_SHA.slice(0, 7)), `${served} vs ${EXPECT_SHA}`);

const sleep = (ms) => page.waitForTimeout(ms);
let log = [];
page.on("response", async (res) => {
  const u = res.url();
  if (!HOSTS.test(u)) return;
  const e = { url: u, status: res.status(), features: null };
  if (/\/query/.test(u)) { try { const j = await res.json(); e.features = Array.isArray(j.features) ? j.features.length : (typeof j.count === "number" ? j.count : null); } catch (_) { /* not json */ } }
  log.push(e);
});
page.on("request", (r) => { if (HOSTS.test(r.url())) log.push({ url: r.url(), status: "sent", features: null, req: true }); });
const sent = () => log.filter((e) => e.req);
const queried = () => log.filter((e) => !e.req && /\/query/.test(e.url) && e.status === 200);

const cleanupIds = [];
const insert = async (id, p, label) => {
  const plan = { ...throwawayPlan(id), origin: { lat: p.lat, lon: p.lng }, site: `ZZ Live Check — ${label}` };
  const err = await page.evaluate(async ([pl]) => {
    const { data: u } = await window.pfSupabase.auth.getUser();
    const { error } = await window.pfSupabase.from("sites").insert({ id: pl.id, group_id: pl.groupId, site: pl.site, name: pl.name, county: null, user_id: u.user.id, version: 1, data: pl });
    return error ? String(error.message) : null;
  }, [plan]);
  cleanupIds.push(plan.id);
  if (err) throw new Error("throwaway plan insert failed — " + err);
  return plan;
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
  await sleep(1200); // service-area geometry arrives by a dynamic import
  return panel;
};
const rowsIn = async (panel, group) => {
  const btn = panel.getByTestId(`layer-group-${group}`);
  if (await btn.count()) await btn.click();
  else if (await panel.getByTestId("layer-group-select").count()) await panel.getByTestId("layer-group-select").selectOption(group).catch(() => {});
  else return [];
  await sleep(300);
  return panel.evaluate((root) => [...root.querySelectorAll('[data-testid^="layer-row-"]')].filter((r) => !r.getAttribute("data-testid").endsWith("-menu")).map((r) => r.getAttribute("data-testid").replace("layer-row-", "")));
};
const turnOn = async (panel, id) => {
  await panel.getByTestId("layer-group-jur").click(); await sleep(250);
  const cb = panel.locator(`[data-testid="layer-row-${id}"] input[type="checkbox"]`).first();
  if (!(await cb.count())) { check(`row "${id}" has a checkbox to switch on`, false, "row not in this group"); return; }
  if (!(await cb.isChecked())) await cb.check();
};
const layers = () => page.evaluate(() => (window.__plannerLayers ? window.__plannerLayers() : null)).then((h) => h && { features: h.features });
const identify = (id, at) => page.evaluate(([i, a]) => { const h = window.__plannerLayers && window.__plannerLayers(); const c = h && h.identify ? h.identify(i, a) : null; return c ? { title: c.title, rows: (c.rows || []).map((r) => ({ label: r.label, text: r.text, href: r.href })) } : null; }, [id, at]);

try {
  for (const key of ONLY) {
    const C = CITIES[key];
    if (!C) continue;
    if (key === "webster" && !C.code) { console.log("(Webster: card expectations are filled in once the layer is measured — NEW-2)"); }
    log = [];
    const plan = await insert(`${LIVE_PREFIX}txz-${key}-${Date.now().toString(36)}`, C.at, C.label);
    const panel = await openPanel(plan.id);
    const jur = await rowsIn(panel, "jur");
    console.log(`${C.label} · Jurisdictions rows:`, jur.join(", "));
    for (const id of C.ids) check(`A · ${C.label} offers "${id}"`, jur.includes(id));
    const others = ALL_IDS.filter((id) => !C.ids.includes(id) && jur.includes(id));
    check(`A · ${C.label} offers no other city's zoning row`, others.length === 0, others.join(", "));
    check(`A · nothing from the city's service is requested before a layer is switched on`, sent().length === 0, `${sent().length} sent`);
    for (const id of C.ids) await turnOn(panel, id);
    await sleep(12000);
    const L = await layers(); const F = (L && L.features) || {};
    console.log(`${C.label} painted:`, JSON.stringify(Object.fromEntries(C.ids.map((id) => [id, F[id]]))));
    check(`B · ${C.label}: the city's service answered 200 with features`, queried().reduce((n, e) => n + (e.features || 0), 0) > 0, String(queried().reduce((n, e) => n + (e.features || 0), 0)));
    const bad = log.filter((e) => !e.req && typeof e.status === "number" && e.status >= 400);
    check(`B · ${C.label}: no request failed`, bad.length === 0, bad.slice(0, 3).map((e) => `${e.status} ${e.url.slice(-90)}`).join(" | "));
    for (const id of C.ids) check(`B · ${id}: painted ≥ 1 feature at the ${C.label} view`, (F[id] || 0) >= 1, String(F[id]));
    if (C.code) {
      for (const id of C.ids) {
        const c = await identify(id, C.at);
        console.log(`card ${id}:`, JSON.stringify(c && { title: c.title, rows: c.rows.map((r) => `${r.label}: ${r.text}`) }));
        check(`B · ${id}: a card opens at the known polygon, titled "Zoning · ${C.label}"`, !!(c && new RegExp(`^Zoning · ${C.label}`).test(c.title || "")), c ? c.title : "no card");
        const zone = c && c.rows.find((r) => r.label === "Zone");
        check(`B · ${id}: Zone reads "${C.code} · ${C.name}" — the city's own code and name`, !!zone && zone.text === `${C.code} · ${C.name}`, zone ? zone.text : "no Zone row");
        check(`B · ${id}: no blank row, no raw field name, no raw URL in the card`, !!c && c.rows.every((r) => String(r.text || "").trim() && !/^https?:/.test(r.text) && !/_/.test(r.label)), "");
      }
      await panel.getByTestId("layer-group-jur").click(); await sleep(300);
      await panel.getByTestId(`layer-caret-${C.ids[0]}`).click(); await sleep(1800);
      const lg = await panel.locator(`[data-testid="layer-row-${C.ids[0]}-menu"] [data-part="legend"]`).first().innerText().catch(() => "");
      console.log("legend:\n" + lg.split("\n").map((l) => "   " + l).join("\n"));
      check(`B · the legend is headed "${C.label}"`, new RegExp(`^${C.label}`).test(lg.trim()), lg.split("\n")[0]);
      check("B · and lists the district here with the city's name, one per row", C.legend.test(lg), "");
      check("B · no legend row carries the city as a suffix", !new RegExp(`\\(${C.label}\\)`).test(lg), "");
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${key}-legend.png` });
      const canvas = page.getByTestId("planner-canvas");
      const box = await canvas.boundingBox();
      let cardText = "";
      for (const [dx, dy] of [[0, 0], [60, 40], [-60, 40], [90, -50], [-90, -50], [0, 90]]) {
        await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
        await sleep(2500);
        cardText = await page.getByTestId("gis-identify").first().innerText().catch(() => "");
        if (/Zoning/.test(cardText)) break;
      }
      console.log("canvas card:\n" + cardText.split("\n").map((l) => "   " + l).join("\n"));
      check(`B · a canvas click opens the ${C.label} zoning card`, new RegExp(`Zoning · ${C.label}`).test(cardText), "");
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${key}-canvas-card.png` });
    }
  }

  /* ── C. neighbours and Houston: nothing is offered, nothing is asked ─────────────────────── */
  for (const [label, p, known] of [["Sugar Land", SUGAR_LAND, "sl_zoning"], ["Houston", HOUSTON, "counties_cities"]]) {
    log = [];
    const plan = await insert(`${LIVE_PREFIX}txz-${label.replace(/\s/g, "").toLowerCase()}-${Date.now().toString(36)}`, p, label);
    const panel = await openPanel(plan.id);
    const jur = await rowsIn(panel, "jur");
    console.log(`${label} · Jurisdictions rows:`, jur.join(", "));
    check(`C · KNOWN-GOOD arm: ${label} lists its own rows (so an empty answer is not an empty registry)`, jur.includes(known), `${jur.length} rows`);
    const leaked = ALL_IDS.filter((id) => jur.includes(id));
    check(`C · ${label} offers none of Richmond / Fulshear / Stafford / Webster`, leaked.length === 0, leaked.join(", "));
    await sleep(3000);
    check(`C · the ${label} plan issues ZERO requests to these services`, sent().length === 0, `${sent().length} sent: ${sent().slice(0, 2).map((e) => e.url.slice(0, 90)).join(" | ")}`);
  }
} finally {
  for (const id of cleanupIds) {
    const r = await cleanupLive(page, { planId: id }).catch((e) => ({ error: String(e) }));
    check(`throwaway plan ${id.slice(-8)} deleted and verified gone`, r && r.left && r.left.site === 0 && !(r.errors || []).length, JSON.stringify(r));
  }
  await s.close();
}
console.log(failed ? `FAIL (${failed})` : "PASS");
process.exit(failed ? 1 : 0);
