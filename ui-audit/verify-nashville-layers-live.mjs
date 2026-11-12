/* verify-nashville-layers-live — Metro Nashville water-quality buffers + pending / preliminary flood maps (B2671266, B2671267), LIVE on planyr.io, signed in as the test account.
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-nashville-layers-live.mjs [https://planyr.io] [--expect-sha <sha>] [--shots <dir>]
 *
 * Proves, against the DEPLOYED build (read from /version.json in the same call as the assertions):
 *   A. A LOCATED PLAN at Antioch (inside Davidson County, where the sweep measured 72 stream-buffer polygons in one small box) lists BOTH merged Flood & Drainage rows; turning
 *      "Metro water-quality buffers" ON draws — real features come back from the Metro service for the stream (and wetland) layers, the row reads 'drawing' (not dormant / too detailed /
 *      failed), buffer-coloured polygons are on the map, and a click on one opens the clean card. "Pending / preliminary" ON asks BOTH layers and answers 200 with ZERO features — the honest
 *      state today (Metro's layers are empty) — and says so in its note, never a failure.
 *   B. NOTHING LEAKS — a Murfreesboro plan (Rutherford County, still Tennessee: it keeps the state rows) and a Houston plan (KNOWN-GOOD arm: it lists its own Texas rows) offer NEITHER Metro row and
 *      send ZERO requests to Metro's ArcGIS org (HdTo6HJqh92wn4D8) with their own flood rows switched ON.
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
let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };

const METRO = /HdTo6HJqh92wn4D8/;
const ANTIOCH = { lat: 36.03, lng: -86.63 };           // inside Davidson County; the sweep's 72-polygon stream box is -86.64,36.03,-86.62,36.045
const MURFREESBORO = { lat: 35.8456, lng: -86.3903 };  // Rutherford County, Tennessee — NOT Davidson
const HOUSTON = { lat: 29.80, lng: -95.54 };
const STREAM_INK = "#b45309";

let s = null;
for (let attempt = 1; attempt <= 6 && !s; attempt++) {
  try { s = await openSignedIn({ base: BASE, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] }); }
  catch (e) { if (!/answered 50\d/.test(String(e.message)) || attempt === 6) throw e; await new Promise((r) => setTimeout(r, 20000)); }
}
const page = s.page;
await assertMeasurable(page, "verify-nashville-layers-live");
await page.setViewportSize({ width: 1400, height: 900 });
const served = await page.evaluate(async () => (await fetch("/version.json", { cache: "no-store" }).then((r) => r.json())).build);
console.log(`signed in as ${s.proof.email} · served build ${served}`);
if (EXPECT_SHA) check("served build is the merge commit", String(served).startsWith(EXPECT_SHA.slice(0, 7)), `${served} vs ${EXPECT_SHA}`);
const sleep = (ms) => page.waitForTimeout(ms);

let log = [];
page.on("response", async (res) => {
  const u = res.url();
  if (!METRO.test(u)) return;
  const e = { url: u, status: res.status(), features: null, count: null };
  if (/\/query/.test(u)) { try { const j = await res.json(); e.features = Array.isArray(j.features) ? j.features.length : null; e.count = j.count ?? null; } catch (_) { /* not json */ } }
  log.push(e);
});
page.on("request", (r) => { if (METRO.test(r.url())) log.push({ url: r.url(), status: "sent", req: true }); });
const answered = (re) => log.filter((e) => !e.req && re.test(e.url) && e.status === 200 && /\/query/.test(e.url));
const featuresFrom = (re) => answered(re).reduce((n, e) => n + (e.features || 0), 0);

const cleanupIds = [];
const mk = (id, p, label) => ({ ...throwawayPlan(id), origin: { lat: p.lat, lon: p.lng }, site: `ZZ Live Check — ${label}` });
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
  await sleep(900);
  return panel;
};
const rowsIn = async (panel, group) => {
  await panel.getByTestId("layer-group-nav").waitFor({ timeout: 20000 }).catch(() => {});
  const btn = panel.getByTestId(`layer-group-${group}`);
  if (await btn.count()) await btn.click(); else await panel.getByTestId("layer-group-select").selectOption(group);
  await sleep(300);
  return panel.evaluate((root) => [...root.querySelectorAll('[data-testid^="layer-row-"]')].filter((r) => !r.getAttribute("data-testid").endsWith("-menu")).map((r) => r.getAttribute("data-testid").replace("layer-row-", "")));
};
const stateOf = (panel, id) => panel.locator(`[data-testid="layer-row-${id}"]`).first().getAttribute("data-layer-state").catch(() => null);
const rowText = async (panel, id) => {
  const row = panel.locator(`[data-testid="layer-row-${id}"]`).first();
  if (!(await row.locator(`[data-testid="layer-row-${id}-menu"]`).count())) await panel.locator(`[data-testid="layer-caret-${id}"]`).first().click().catch(() => {});
  await sleep(500);
  return row.innerText().catch(() => "");
};
const turnOn = async (panel, id) => { const cb = panel.locator(`[data-testid="layer-row-${id}"] input[type="checkbox"]`).first(); if (await cb.count() && !(await cb.isChecked())) await cb.check(); return cb.count(); };

try {
  const stamp = Date.now().toString(36);
  const plans = {
    antioch: mk(`${LIVE_PREFIX}nash-${stamp}`, ANTIOCH, "Antioch Nashville"),
    mur: mk(`${LIVE_PREFIX}nash-mur-${stamp}`, MURFREESBORO, "Murfreesboro"),
    tx: mk(`${LIVE_PREFIX}nash-tx-${stamp}`, HOUSTON, "Houston"),
  };
  for (const p of Object.values(plans)) await insert(p);

  /* ── A. Antioch ─────────────────────────────────────────────────────────────────────────────────────────────────── */
  log = [];
  const panel = await openPanel(plans.antioch.id);
  const flood = await rowsIn(panel, "flood");
  console.log("Antioch plan · Flood & Drainage rows:", JSON.stringify(flood));
  check("A · the located Antioch plan lists 'Metro water-quality buffers' as ONE row", flood.includes("metro_wq_buffers"));
  check("A · …and 'Metro floodplain — pending / preliminary maps' as ONE row", flood.includes("metro_pending_flood"));
  check("A · the four buffers are NOT listed as four rows (one merged row)", !flood.some((id) => /^nash_(stream|pond|wetland|floodway)_buffer$/.test(id)));
  check("A · the state's own 30 ft Stream Buffers row is still there", flood.includes("tn_stream_buffers"));
  const label = await panel.locator('[data-testid="layer-row-metro_wq_buffers"]').first().innerText().catch(() => "");
  check("A · the row's name reads 'Metro water-quality buffers'", /Metro water-quality buffers/.test(label), JSON.stringify(label.slice(0, 80)));

  log = [];
  check("A · the buffers row has a checkbox", (await turnOn(panel, "metro_wq_buffers")) > 0);
  await sleep(14000);
  const stream = featuresFrom(/Stormwater_Regulation_Buffers_view\/FeatureServer\/2\/query/), wet = featuresFrom(/Stormwater_Regulation_Buffers_view\/FeatureServer\/3\/query/);
  const pond = featuresFrom(/Stormwater_Regulation_Buffers_view\/FeatureServer\/1\/query/), fw = featuresFrom(/Stormwater_Regulation_Buffers_view\/FeatureServer\/0\/query/);
  console.log(`   features received — stream ${stream} · wetland ${wet} · pond ${pond} · floodway ${fw}`);
  check("A · stream buffers: real polygons came back from Metro's service", stream > 0, `${stream}`);
  check("A · wetland buffers: real polygons came back", wet > 0, `${wet}`);
  const bad = log.filter((e) => !e.req && typeof e.status === "number" && e.status >= 400);
  check("A · no Metro request failed", bad.length === 0, bad.slice(0, 3).map((e) => `${e.status} ${e.url.slice(-80)}`).join(" | "));
  const st = await stateOf(panel, "metro_wq_buffers"), txt = await rowText(panel, "metro_wq_buffers");
  check("A · the row reads 'drawing' (not dormant-blank / failed)", st === "drawing", `state=${st}`);
  check("A · not refused as too detailed", !/too detailed/i.test(txt));
  check("A · the status line is not a failure", !/not responding|couldn't load|hiccup/i.test(txt), JSON.stringify(txt.slice(0, 160)));
  const inkCount = await page.evaluate((ink) => [...document.querySelectorAll(".leaflet-pane path")].filter((p) => (p.getAttribute("stroke") || "").toLowerCase() === ink).length, STREAM_INK);
  check("A · stream-buffer polygons are painted on the map", inkCount > 0, `${inkCount} paths`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/A-antioch-buffers.png` });

  // the click card: aim at the middle of a painted stream ribbon and press the canvas there
  const target = await page.evaluate((ink) => {
    const p = [...document.querySelectorAll(".leaflet-pane path")].find((x) => (x.getAttribute("stroke") || "").toLowerCase() === ink && x.getTotalLength && x.getTotalLength() > 40);
    if (!p) return null;
    const m = p.getScreenCTM(), pt = p.getPointAtLength(p.getTotalLength() / 2);
    return m ? { x: m.a * pt.x + m.c * pt.y + m.e, y: m.b * pt.x + m.d * pt.y + m.f } : null;
  }, STREAM_INK);
  if (!target) check("A · a stream ribbon to click was found", false);
  else {
    await page.mouse.click(target.x, target.y);
    await sleep(2500);
    const card = await page.getByTestId("gis-identify").first().innerText().catch(() => "");
    console.log("   click card:", JSON.stringify(card.slice(0, 260)));
    check("A · clicking a stream buffer opens the Metro card", /Stream buffer/i.test(card), JSON.stringify(card.slice(0, 120)));
    check("A · the card never prints a single width for the stream", /30, 50 or 75 ft/.test(card) && !/\b(width|buffer)\b[^\n]{0,20}\b(30|50|75) ft\b(?! or)/i.test(card.replace(/30, 50 or 75 ft/, "")));
    check("A · the card has no raw field names or nulls", !/(OBJECTID|GlobalID|Shape__|BufferDistance|\bnull\b|undefined|NaN)/.test(card));
  }

  // pending / preliminary: asked, answered, EMPTY today — and the row says so
  log = [];
  await rowsIn(panel, "flood");
  check("A · the pending / preliminary row has a checkbox", (await turnOn(panel, "metro_pending_flood")) > 0);
  await sleep(10000);
  const pend = answered(/FEMA_Floodplains_and_Floodways_view\/FeatureServer\/2\/query/), prel = answered(/FEMA_Floodplains_and_Floodways_view\/FeatureServer\/3\/query/);
  const appr = log.filter((e) => /FeatureServer\/1\/query/.test(e.url) && FEMA_APPROVED(e.url));
  console.log(`   pending queries ${pend.length} (features ${pend.reduce((n, e) => n + (e.features || 0), 0)}) · preliminary queries ${prel.length} (features ${prel.reduce((n, e) => n + (e.features || 0), 0)})`);
  check("A · BOTH the pending and preliminary layers were asked and answered 200", pend.length > 0 && prel.length > 0, `pending ${pend.length} · preliminary ${prel.length}`);
  check("A · the Approved layer was NEVER asked (FEMA's flood-zone row is the effective map — no duplicate)", appr.length === 0, `${appr.length}`);
  const ptxt = await rowText(panel, "metro_pending_flood");
  check("A · the pending row is not a failure state", !/not responding|couldn't load|hiccup|too detailed/i.test(ptxt), JSON.stringify(ptxt.slice(0, 200)));
  check("A · it says it is EMPTY today (the honest state, with the date) — drawing nothing is not an all-clear", /EMPTY as of 2026-11-12|As of 2026-11-12/i.test(ptxt), JSON.stringify(ptxt.slice(0, 260)));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/A-antioch-pending.png` });

  /* ── B. nothing leaks ──────────────────────────────────────────────────────────────────────────────────────────── */
  for (const [name, plan] of [["Murfreesboro", plans.mur], ["Houston", plans.tx]]) {
    log = [];
    const p2 = await openPanel(plan.id);
    const rows = {};
    for (const g of ["jur", "flood", "util", "env"]) rows[g] = await rowsIn(p2, g);
    const all = Object.values(rows).flat();
    console.log(`${name} plan · rows:`, JSON.stringify(rows));
    check(`B · KNOWN-GOOD arm: ${name} lists its own rows (so an empty answer is not an empty registry)`, name === "Houston" ? all.includes("water_sewer") && all.includes("counties_cities") : all.includes("tn_stream_buffers") && all.includes("counties_cities"), `${all.length} rows`);
    check(`B · ${name} offers NEITHER Metro row`, !all.includes("metro_wq_buffers") && !all.includes("metro_pending_flood"));
    await rowsIn(p2, "flood");
    for (const id of rows.flood.slice(0, 6)) await turnOn(p2, id).catch(() => {});
    await sleep(9000);
    const sent = log.filter((e) => e.req);
    check(`B · ${name} plan (own flood rows ON) issues ZERO requests to Metro's ArcGIS org`, sent.length === 0, `${sent.length}: ${sent.slice(0, 2).map((e) => e.url.slice(0, 90)).join(" | ")}`);
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

/* the Approved layer is layer 1 of the FEMA view — never asked by these rows */
function FEMA_APPROVED(u) { return /FEMA_Floodplains_and_Floodways_view\/FeatureServer\/1\//.test(u); }
