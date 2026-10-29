/* verify-mississippi-live — the Mississippi due-diligence layers (NEW-1, 2026-10-29), LIVE, signed in as the test account.
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-mississippi-live.mjs [https://planyr.io | a *.planyr.pages.dev preview] [--expect-sha <sha>] [--shots <dir>]
 *
 * Against the DEPLOYED build (read from /version.json in the same call as the assertions), on the Map view over REAL Mississippi ground:
 *   A. EVERY ROW DRAWS REAL FEATURES — for each of the 22 statewide rows and 5 DeSoto rows: the map is moved to a point on a feature the registry's fixtures name, the
 *      row is switched on through the Layers panel, and the service answers 200 with at least one feature and no ArcGIS error body; the row's own status dot never reads
 *      "failed". (Known-good arm: Counties & Cities, a row that has always drawn.)
 *   B. THE CLICK CARDS — a click ON a feature opens the pinned card with the layer's own plain words (tank facility, contaminated site, dam) and no raw field names.
 *   C. NOTHING LEAKS — the Map moved over Houston offers none of the Mississippi rows and issues ZERO requests to the MDEQ / MARIS / DeSoto hosts; the DeSoto rows are
 *      absent over Jackson (statewide rows present); a throwaway LOCATED plan at Olive Branch lists both sets in the planner's own panel.
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
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
let failed = 0, voided = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };

const MS_HOSTS = /gis-proxy\/(gis\.deq\.ms\.gov|opcgis\.deq\.state\.ms\.us|gis\.mississippi\.edu|gis\.desotocountyms\.gov)/;
const FED_HOSTS = /services\.arcgis\.com\/cJ9YHowT8TU7DUyn|services2\.arcgis\.com\/FiaPA4ga0iQKduv3|services\.arcgis\.com\/QVENGdaPbd4LUkLV|carto\.nationalmap\.gov/;

/* [row id as the panel lists it, group, lat, lng (a point on a feature, from the registry's fixtures), zoom, URL fragment of the service it must ask] */
const ROWS = [
  ["counties_cities", "jur", 32.2902, -90.1785, 11, /SWAP_Mapping\/MapServer\/19\/query|Municipal_Boundaries_2025\/MapServer\/0\/query/],
  ["ms_tribal", "jur", 32.7505, -89.1806, 13, /BND___Bureau_of_Indian_Affairs.*FeatureServer\/4\/query/],
  ["ms_deq_gard", "env", 34.9672, -89.7906, 15, /MUSTER_Scaled_v15\/MapServer\/12\/query/],
  ["ms_deq_ust", "env", 34.959, -89.8306, 16, /MUSTER_Scaled_v15\/MapServer\/10\/query/],
  ["ms_epa_brownfields", "env", 32.3002, -90.1795, 15, /FRS_INTERESTS_ACRES\/FeatureServer\/0\/query/],
  ["ms_deq_landfills", "env", 34.9339, -89.7936, 14, /SWAP_Mapping\/MapServer\/7\/query/],
  ["ms_deq_mines", "env", 34.9424, -89.8738, 14, /MiningWeb\/MapServer\/1\/query/],
  ["ms_ogb_wells", "env", 32.3058, -90.1734, 15, /MS_Oil_n_Gas_Board_Wells_July_2025\/MapServer\/0\/query/],
  ["ms_deq_og_fields", "env", 32.2681, -90.1424, 12, /MSEnergyFields\/MapServer\/6\/query/],
  ["ms_deq_spa", "env", 34.9571, -89.8306, 14, /SWAP_Mapping\/MapServer\/14\/query/],
  ["ms_nrcs_easements", "env", 34.8851, -89.7942, 13, /MS_NRCS_Easements_2024\/MapServer\/0\/query/],
  ["ms_nrhp", "env", 32.2994, -90.1805, 15, /nrhp_points_v1\/FeatureServer\/0\/query/],
  ["ms_cemeteries", "env", 32.2037, -90.1523, 15, /structures\/MapServer\/37\/query/],
  ["ms_crit_habitat", "env", 32.2902, -90.1787, 12, /USFWS_Critical_Habitat\/FeatureServer\/0\/query/],
  ["ms_303d", "env", 34.2752, -88.6351, 14, /MS2024ImpairedWaters\/MapServer\/2\/query/],
  ["ms_dams", "flood", 34.9691, -89.8427, 15, /MSDamsApp\/MapServer\/0\/query/],
  ["ms_dam_inundation", "flood", 34.969, -89.8434, 14, /MSDamsApp\/MapServer\/5\/query/],
  // DeSoto County (the map must be INSIDE the county for these to be offered)
  ["ms_desoto_drainage", "flood", 34.9405, -89.8571, 14, /County_Web_Map\/MapServer\/37\/query/],
  ["ms_desoto_levee", "flood", 34.9477, -90.1397, 12, /County_Web_Map\/MapServer\/38\/query/],
  ["ms_desoto_lomr", "flood", 34.933, -89.8386, 15, /County_Web_Map\/MapServer\/99\/query/],
  ["ms_desoto_loma", "flood", 34.9635, -89.8422, 16, /County_Web_Map\/MapServer\/100\/query/],
  ["ms_desoto_cemeteries", "env", 34.9552, -89.8227, 15, /County_Web_Map\/MapServer\/7\/query/],
];
const DESOTO_ROWS = new Set(["ms_desoto_drainage", "ms_desoto_levee", "ms_desoto_lomr", "ms_desoto_loma", "ms_desoto_cemeteries"]);
const MS_ROW_IDS = ROWS.map((r) => r[0]).filter((id) => id !== "counties_cities");
const HOUSTON = { lat: 29.80, lng: -95.54 };

/* `--anon`: no sign-in (a PR preview has no E2E key). Sections A–C need none; D (a throwaway located plan) is skipped and said so — the signed-in run on planyr.io is the one that counts. */
const ANON = args.includes("--anon");
let s = null;
if (ANON) {
  const { chromium } = await import("@playwright/test");
  const { existsSync } = await import("node:fs");
  const browser = await chromium.launch({ executablePath: existsSync(chromium.executablePath()) ? undefined : "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const ctx = await browser.newContext();
  const pg = await ctx.newPage();
  await pg.addInitScript(() => { window.__PLANYR_E2E = true; });
  await pg.goto(BASE + "/version.json", { waitUntil: "domcontentloaded" });
  s = { page: pg, proof: { email: "(anonymous)" }, close: async () => { await browser.close(); } };
}
for (let attempt = 1; attempt <= 6 && !s; attempt++) {
  try { s = await openSignedIn({ base: BASE, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] }); }
  catch (e) { if (!/answered 50\d/.test(String(e.message)) || attempt === 6) throw e; await new Promise((r) => setTimeout(r, 20000)); }
}
const page = s.page;
await assertMeasurable(page, "verify-mississippi-live");
await page.setViewportSize({ width: 1400, height: 900 });
const served = await page.evaluate(async () => (await fetch("/version.json", { cache: "no-store" }).then((r) => r.json())).build);
console.log(`signed in as ${s.proof.email} · served build ${served}`);
if (EXPECT_SHA) check("served build is the merge commit", String(served).startsWith(EXPECT_SHA.slice(0, 7)), `${served} vs ${EXPECT_SHA}`);

const sleep = (ms) => page.waitForTimeout(ms);
let log = [];
const oidWarnings = [];
page.on("console", (m) => { if (/esriFieldTypeOID|unique IDs/.test(m.text())) oidWarnings.push(m.text().slice(0, 140)); });
page.on("response", async (res) => {
  const u = res.url();
  if (!(MS_HOSTS.test(u) || FED_HOSTS.test(u))) return;
  const e = { url: u, status: res.status(), features: null, error: null };
  if (/\/query/.test(u)) { try { const j = await res.json(); e.features = Array.isArray(j.features) ? j.features.length : null; if (j.error) e.error = JSON.stringify(j.error).slice(0, 120); e.pts = (j.features || []).filter((f) => f.geometry && f.geometry.x != null).slice(0, 12).map((f) => ({ x: f.geometry.x, y: f.geometry.y })); } catch (_) { /* not json */ } }
  log.push(e);
});
page.on("request", (r) => { const u = r.url(); if (MS_HOSTS.test(u)) log.push({ url: u, status: "sent", req: true }); });
const sentMs = () => log.filter((e) => e.req && MS_HOSTS.test(e.url));

async function openFinderAt(lat, lng, zoom) {
  await page.goto(BASE + "/?planyrDiag=1#/site", { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__mapFinderMap && !!document.querySelector('[data-testid="layer-panel"][data-surface="finder"], [data-testid="finder-layers-expand"]'), null, { timeout: 45000 });
  await sleep(1200);
  await page.evaluate(([a, b, z]) => window.__mapFinderMap.setView([a, b], z, { animate: false }), [lat, lng, zoom]);
  await sleep(1200);
  const panel = page.locator('[data-testid="layer-panel"][data-surface="finder"]').first();
  if (!(await panel.isVisible().catch(() => false))) { await page.getByTestId("finder-layers-expand").click(); }
  await panel.waitFor({ state: "visible", timeout: 20000 });
  await sleep(900); // service-area geometry arrives by a dynamic import
  return panel;
}
const selectGroup = async (panel, g) => {
  if (!(await panel.isVisible().catch(() => false))) { await page.getByTestId("finder-layers-expand").click().catch(() => {}); await panel.waitFor({ state: "visible", timeout: 15000 }); await sleep(500); }
  const btn = panel.getByTestId(`layer-group-${g}`);
  if (await btn.count()) await btn.first().click(); else await panel.getByTestId("layer-group-select").selectOption(g);
  await sleep(300);
};
const rowIds = (panel) => panel.evaluate((root) => [...root.querySelectorAll('[data-testid^="layer-row-"]')].filter((r) => !r.getAttribute("data-testid").endsWith("-menu")).map((r) => r.getAttribute("data-testid").replace("layer-row-", "")));
const cleanupIds = [];

try {
  /* ── A. every row draws real features ─────────────────────────────────────────────────────── */
  let panel = await openFinderAt(32.2988, -90.1848, 11);
  for (const g of ["jur", "env", "flood"]) { await selectGroup(panel, g); }
  for (const [id, group, lat, lng, zoom, re] of ROWS) {
    await page.evaluate(([a, b, z]) => window.__mapFinderMap.setView([a, b], z, { animate: false }), [lat, lng, zoom]);
    await sleep(1400);
    await selectGroup(panel, group);
    const ids = await rowIds(panel);
    if (!ids.includes(id)) { check(`A · ${id}: offered at its own fixture point`, false, `rows: ${ids.join(",").slice(0, 160)}`); continue; }
    const cb = panel.locator(`[data-testid="layer-row-${id}"] input[type="checkbox"]`).first();
    log = [];
    if (!(await cb.isChecked())) await cb.check();
    let got = null;
    for (let i = 0; i < 40 && !got; i++) { await sleep(750); got = log.find((e) => !e.req && re.test(decodeURIComponent(e.url)) && e.status === 200 && e.features > 0); }
    const asked = log.filter((e) => !e.req && re.test(decodeURIComponent(e.url)));
    const bad = asked.filter((e) => e.status !== 200 || e.error);
    const state = await panel.locator(`[data-testid="layer-row-${id}"]`).first().getAttribute("data-layer-state").catch(() => null);
    check(`A · ${id}: the service answers with real features`, !!got, got ? `${got.features} features` : `asked ${asked.length}× — ${asked.map((e) => `${e.status}/${e.features}${e.error ? " " + e.error : ""}`).join(" ").slice(0, 160)}`);
    check(`A · ${id}: no failed request, status dot not "failed"`, bad.length === 0 && state !== "failed", `${bad.map((e) => e.status + " " + (e.error || "")).join(" | ")} state=${state}`);
    if (SHOTS && got) await page.screenshot({ path: `${SHOTS}/A-${id}.png` });
    await cb.uncheck().catch(() => {});
  }

  check("A · esri-leaflet raised no \"no unique-id field\" warning for any row (it would draw one marker of many)", oidWarnings.length === 0, oidWarnings[0] || "");

  /* ── B. click cards ────────────────────────────────────────────────────────────────────────── */
  /* Two DIFFERENT features of each point row, found from what the service really answered at this view, are clicked: both must open their own card (a layer that draws one marker of many fails here). */
  const CARD_ROWS = [["ms_deq_ust", "env", 34.959, -89.8306, 17, /MUSTER_Scaled_v15\/MapServer\/10\/query/, "Tank status"], ["ms_deq_gard", "env", 34.9672, -89.7906, 15, /MUSTER_Scaled_v15\/MapServer\/12\/query/, "State status|Federal status|Program|Main contaminant|Address"], ["ms_dams", "flood", 34.9691, -89.8427, 15, /MSDamsApp\/MapServer\/0\/query/, "Hazard class"]];
  for (const [id, group, lat, lng, zoom, re, rowLabel] of CARD_ROWS) {
    await page.evaluate(([a, b, z]) => window.__mapFinderMap.setView([a, b], z, { animate: false }), [lat, lng, zoom]);
    await sleep(1200);
    await selectGroup(panel, group);
    const cb = panel.locator(`[data-testid="layer-row-${id}"] input[type="checkbox"]`).first();
    log = [];
    if (!(await cb.isChecked())) await cb.check();
    await sleep(7000);
    const seen = new Map();
    for (const e of log) if (!e.req && re.test(decodeURIComponent(e.url))) for (const q of e.pts || []) seen.set(`${q.x.toFixed(5)},${q.y.toFixed(5)}`, q);
    // only points in the open middle of the map: the top toolbar and the right-hand Layers card cover the rest and would swallow the click
    const mid = await page.evaluate((pts) => { const m = window.__mapFinderMap, sz = m.getSize(); return pts.map((q) => { const p = m.latLngToContainerPoint([q.y, q.x]); return p.x > 330 && p.x < sz.x - 480 && p.y > 130 && p.y < sz.y - 120; }); }, [...seen.values()]);
    const inView = [...seen.values()].filter((_q, i) => mid[i]);
    const titles = [];
    for (const q of inView.slice(0, 2)) {
      const c = await page.evaluate(([a, b]) => { const m = window.__mapFinderMap, p = m.latLngToContainerPoint([a, b]), r = m.getContainer().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; }, [q.y, q.x]);
      let text = "";
      for (const [dx, dy] of [[0, 0], [2, 2], [-2, -2], [4, -3], [-4, 3], [0, -5], [5, 0], [0, 5], [-5, 0], [6, 6], [-6, -6]]) {
        await page.mouse.click(c.x + dx, c.y + dy);
        await sleep(1100);
        text = await page.locator(".leaflet-popup-content").first().innerText().catch(() => "");
        if (text) break;
      }
      titles.push(text);
      console.log(`card @ ${id} (${q.y.toFixed(5)}, ${q.x.toFixed(5)}):\n` + text.split("\n").map((l) => "   " + l).join("\n"));
      await page.keyboard.press("Escape").catch(() => {});
      await page.evaluate(() => document.querySelector(".leaflet-popup-close-button")?.click());
      await sleep(300);
    }
    check(`B · ${id}: at least two features are drawn in view (not one marker of many)`, inView.length >= 2, `${inView.length} answered in view`);
    check(`B · ${id}: a click ON each opens its own card`, titles.length >= 2 && titles.every((t) => !!t) && titles[0].split("\n")[0] !== titles[1].split("\n")[0], titles.map((t) => (t || "").split("\n")[0]).join(" | "));
    check(`B · ${id}: the card names its facts in plain words, not column names`, titles.length > 0 && titles.every((t) => new RegExp(rowLabel).test(t) && !/OBJECTID|FACILITY_NAME|STATESTATUS|HAZRDCLASS|RELEASE_STATUS|SITENAME/.test(t)), "");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/B-${id}-card.png` });
    await cb.uncheck().catch(() => {});
  }

  /* ── C. nothing leaks ───────────────────────────────────────────────────────────────────── */
  // Jackson: the DeSoto rows are absent, the statewide ones present
  await page.evaluate(([a, b, z]) => window.__mapFinderMap.setView([a, b], z, { animate: false }), [32.2988, -90.1848, 14]);
  await sleep(1500);
  let jid = [];
  for (const g of ["jur", "env", "flood"]) { await selectGroup(panel, g); jid = jid.concat(await rowIds(panel)); }
  check("C · over Jackson the statewide rows are offered (known-good arm)", ["ms_deq_ust", "ms_ogb_wells", "ms_dams", "ms_deq_spa"].every((id) => jid.includes(id)), jid.filter((i) => i.startsWith("ms_")).join(","));
  check("C · over Jackson none of the DeSoto County rows is offered", [...DESOTO_ROWS].every((id) => !jid.includes(id)), [...DESOTO_ROWS].filter((id) => jid.includes(id)).join(","));
  // Houston: none of them, and zero requests to their hosts
  log = [];
  panel = await openFinderAt(HOUSTON.lat, HOUSTON.lng, 14);
  let hid = [];
  for (const g of ["jur", "env", "flood", "util"]) { await selectGroup(panel, g); hid = hid.concat(await rowIds(panel)); }
  check("C · KNOWN-GOOD arm: over Houston the Texas rows are listed (so an empty answer is not an empty registry)", hid.includes("counties_cities") && hid.length > 8, `${hid.length} rows`);
  check("C · over Houston not one Mississippi row is offered", MS_ROW_IDS.every((id) => !hid.includes(id)), MS_ROW_IDS.filter((id) => hid.includes(id)).join(","));
  await sleep(3000);
  check("C · over Houston zero requests go to the MDEQ / MARIS / DeSoto hosts", sentMs().length === 0, `${sentMs().length} sent: ${sentMs().slice(0, 2).map((e) => e.url.slice(0, 100)).join(" | ")}`);

  /* ── D. a LOCATED plan at Olive Branch lists both sets in the planner's own panel ───────────── */
  if (ANON) throw Object.assign(new Error("skip-D"), { skipD: true });
  const obPlan = { ...throwawayPlan(`${LIVE_PREFIX}ms-ob-${Date.now().toString(36)}`), origin: { lat: 34.9618, lon: -89.8295 }, site: "ZZ Live Check — Olive Branch MS" };
  const err = await page.evaluate(async ([pl]) => {
    const { data: u } = await window.pfSupabase.auth.getUser();
    const { error } = await window.pfSupabase.from("sites").insert({ id: pl.id, group_id: pl.groupId, site: pl.site, name: pl.name, county: null, user_id: u.user.id, version: 1, data: pl });
    return error ? String(error.message) : null;
  }, [obPlan]);
  cleanupIds.push(obPlan.id);
  if (err) throw new Error("throwaway plan insert failed — " + err);
  await page.goto(`${BASE}/?planyrDiag=1#/project/${obPlan.id}/site`, { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("planner-canvas").waitFor({ timeout: 60000 });
  await sleep(2500);
  const chip = page.getByTestId("layers-expand").filter({ visible: true });
  if (await chip.count()) await chip.first().click();
  const pp = page.locator('[data-testid="layer-panel"][data-surface="planner"]').first();
  await pp.waitFor({ state: "visible", timeout: 20000 });
  await sleep(1200);
  let pid = [];
  for (const g of ["jur", "env", "flood"]) { await selectGroup(pp, g); pid = pid.concat(await rowIds(pp)); }
  check("D · the Olive Branch plan lists every Mississippi row (statewide and DeSoto)", MS_ROW_IDS.every((id) => pid.includes(id)), MS_ROW_IDS.filter((id) => !pid.includes(id)).join(",") || "all present");
  // switch a statewide and a DeSoto row on in the planner: the plan draws them (the planner's map is at its default close zoom)
  log = [];
  for (const [id, g] of [["ms_deq_ust", "env"], ["ms_desoto_lomr", "flood"], ["ms_deq_spa", "env"]]) {
    await selectGroup(pp, g);
    const cb = pp.locator(`[data-testid="layer-row-${id}"] input[type="checkbox"]`).first();
    if (!(await cb.isChecked())) await cb.check();
  }
  await sleep(8000);
  const bad = log.filter((e) => !e.req && (e.status !== 200 || e.error));
  check("D · switching three rows on in the planner issues requests and none fails", log.some((e) => !e.req && /\/query/.test(e.url)) && bad.length === 0, `${log.filter((e) => !e.req).length} answered, ${bad.length} failed`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/D-planner.png` });
} catch (e) {
  if (e && e.skipD) console.log("D · skipped (--anon): the located-plan arm needs the signed-in run on planyr.io"); else throw e;
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
