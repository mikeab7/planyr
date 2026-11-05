/* verify-colorado-layers — B2528688: the Colorado due-diligence layers DRAW REAL FEATURES in the real app, and are offered only where they belong.
 *
 *   node ui-audit/verify-colorado-layers.mjs [http://localhost:5199] [--relay https://<branch>.planyr.pages.dev] [--shots dir]
 *        LOCAL: the built app on localhost, signed out, the Map finder; ArcGIS Online is reached directly, the /gis-proxy relay (a Cloudflare Function, not served by vite) is
 *        forwarded to a deployed preview with --relay (the build sandbox cannot reach state.co.us / city hosts at all).
 *   E2E_LOGIN_KEY=… node ui-audit/verify-colorado-layers.mjs https://planyr.io [--expect-sha <sha>]
 *        LIVE: signed in as the test account; the same finder arm PLUS throwaway LOCATED plans in Weld, Adams and Aurora counties (deleted and verified gone, owner rule 15).
 *
 * WHAT IT PROVES (each arm carries a known-good control, because a clean number from an instrument that cannot see the effect is not evidence — STANDING RULE #2):
 *   A. DRAWS — for each of the 27 Colorado rows: the view is moved to a REAL feature of that row's own service (found by a separate ground-truth query, never by the row's code),
 *      the row is switched on in the real Layers card, and the map's own layer reports N > 0 painted features (`window.__finderLayers().features`). Known-good control: the existing
 *      "City Limits (Colorado)" row must draw at Denver by the same flow, or the run is VOID.
 *   B. SCOPE — a Houston view lists none of the 27; a Fort Collins view lists none of the Weld/Adams/Aurora rows (and all the statewide ones); an Aurora view lists the Aurora rows, a Greeley view the
 *      Weld rows; and no request leaves for any Colorado host from a Houston view. Known-good: the Houston view DOES list the Texas "Oil & Gas Wells".
 *   C. NO FAILURES — no request to a Colorado source answered 4xx/5xx while rows were on.
 *   D. (LIVE only) CARDS — on a throwaway located plan the real click card for a pad / a Superfund site / a Buckley crash zone is built from the painted feature and names it in words.
 * FOREGROUND-OR-VOID is asserted first. Live mode reads /version.json in the same call as the assertions. */
import { writeFileSync, mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const base = args.find((a) => /^https?:/.test(a)) || "http://localhost:5199";
const live = !/localhost|127\.0\.0\.1/.test(base);
const relayBase = flag("--relay");
const SHOTS = flag("--shots");
const ONLY = (flag("--only") || "").split(",").filter(Boolean);
const expectSha = flag("--expect-sha");
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
let failed = 0, voided = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };

/* Ground-truth points: a vertex / point of a REAL feature of each row's own service, found 2026-10-29 by asking the service itself (not the app). zoom = how far in the
 * row draws (its minZoom, else 15). `group` is the panel group key. */
const ROWS = {
  co_ecmc_wells: { at: [40.4341, -104.97063], zoom: 15, group: "env" }, co_ecmc_flowlines: { at: [40.47769, -104.8417], zoom: 15, group: "env" },
  co_ecmc_locations: { at: [40.43264, -104.90157], zoom: 15, group: "env" }, co_ecmc_facilities: { at: [40.4742, -104.80441], zoom: 15, group: "env" },
  co_superfund: { at: [39.82289, -104.90344], zoom: 13, group: "env" }, co_rcra_ca: { at: [39.73193, -105.01235], zoom: 14, group: "env" },
  co_inst_controls: { at: [39.80929, -104.92685], zoom: 14, group: "env" }, co_closed_landfills: { at: [40.03096, -105.0326], zoom: 14, group: "env" },
  co_solid_waste: { at: [39.79843, -104.91471], zoom: 14, group: "env" }, co_undermined: { at: [40.10797, -104.9893], zoom: 13, group: "env" },
  co_prairie_dog: { at: [40.40713, -104.08477], zoom: 12, group: "env" }, co_eagle_nests: { at: [40.40464, -104.63532], zoom: 13, group: "env" },
  co_nrhp: { at: [39.73232, -105.01664], zoom: 15, group: "env" }, co_crit_habitat: { at: [39.20894, -108.9252], zoom: 12, group: "env" },
  co_enterprise_zones: { at: [39.86933, -104.86676], zoom: 12, group: "jur" },
  co_weld_zoning: { at: [40.30129, -104.82974], zoom: 13, group: "jur" }, co_weld_ugb: { at: [40.43451, -104.7396], zoom: 12, group: "jur" },
  co_weld_iga: { at: [40.53708, -104.76717], zoom: 12, group: "jur" }, co_weld_airport: { at: [40.39335, -104.65664], zoom: 12, group: "access" },
  co_weld_ogla: { at: [40.0128, -104.8046], zoom: 14, group: "env" }, co_weld_row: { at: [40.36296, -104.5642], zoom: 14, group: "access" },
  co_adams_zoning: { at: [39.80097, -104.97294], zoom: 13, group: "jur" }, co_adams_aviation: { at: [39.80357, -104.61756], zoom: 12, group: "access" },
  co_adams_landfills: { at: [39.8895, -104.9634], zoom: 13, group: "env" },
  co_aurora_noise: { at: [39.84799, -104.63456], zoom: 12, group: "access" }, co_aurora_apz: { at: [39.73628, -104.78261], zoom: 13, group: "access" },
  co_aurora_zoning: { at: [39.63108, -104.71093], zoom: 13, group: "jur" },
};
/* The least a row must paint in the finder's view at its ground-truth point. Dense rows must paint MANY: a layer that answers thousands and paints ONE is the esri-leaflet OBJECTID trap
 * (outFields without the object id → every feature shares one key and overwrites the last). Floors are well under the measured counts. */
const MIN = { co_ecmc_wells: 20, co_ecmc_flowlines: 15, co_ecmc_locations: 10, co_ecmc_facilities: 5, co_nrhp: 5, co_weld_row: 10, co_aurora_zoning: 10, co_solid_waste: 5, co_eagle_nests: 3 };
const IDS = Object.keys(ROWS);
const WELD = IDS.filter((i) => /^co_weld_/.test(i)), ADAMS = IDS.filter((i) => /^co_adams_/.test(i)), AURORA = IDS.filter((i) => /^co_aurora_/.test(i));
const STATEWIDE = IDS.filter((i) => !WELD.includes(i) && !ADAMS.includes(i) && !AURORA.includes(i));
const HOSTS = /gisdnr\.state\.co\.us|ags\.auroragov\.org|66aUo8zsujfVXRIT|ZZPO1K5xRbz1PSYQ|ttNGmDvKQA7oeDQ3|ewjSqmSyHJnkfBLL|4PNQOtAivErR7nbT|DgjqnJA1rgO92Soi/;

let page, close, signedIn = false;
if (live) {
  const { openSignedIn } = await import("./lib/signedInSession.mjs");
  let s = null;
  for (let attempt = 1; attempt <= 6 && !s; attempt++) {
    try { s = await openSignedIn({ base, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] }); }
    catch (e) { if (!/answered 50\d/.test(String(e.message)) || attempt === 6) throw e; await new Promise((r) => setTimeout(r, 20000)); }
  }
  page = s.page; close = () => s.close(); signedIn = true;
  console.log("signed in as", s.proof.email, "· served build", s.build);
} else {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.PW_CHROME || undefined });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  page = await ctx.newPage();
  await page.addInitScript(() => { try { window.__PLANYR_E2E = true; } catch (_) { /* noop */ } });
  await page.route(/\.(jpg|jpeg|png|webp)(\?|$)/, (r) => r.abort());
  if (relayBase) {
    // the relay is a Cloudflare Function vite does not serve: hand it to the deployed preview, same path, and answer with the preview's body
    await page.route("**/gis-proxy/**", async (route) => {
      const u = new URL(route.request().url());
      try {
        const r = await route.fetch({ url: relayBase.replace(/\/$/, "") + u.pathname + u.search, headers: { ...route.request().headers(), host: new URL(relayBase).host } });
        await route.fulfill({ response: r });
      } catch (e) { await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: String(e.message) }) }); }
    });
  }
  close = () => browser.close();
}

const log = [];
page.on("response", async (res) => {
  const u = res.url();
  if (!HOSTS.test(u) && !/\/gis-proxy\/(gisdnr\.state\.co\.us|ags\.auroragov\.org)/.test(u)) return;
  log.push({ url: u, status: res.status() });
});
page.on("request", (r) => { const u = r.url(); if (HOSTS.test(u) || /\/gis-proxy\/(gisdnr\.state\.co\.us|ags\.auroragov\.org)/.test(u)) log.push({ url: u, status: "sent", req: true }); });
const sleep = (ms) => page.waitForTimeout(ms);

async function openFinder() {
  await page.goto(`${base}/?planyrDiag=1#/site-planner`, { waitUntil: "load" });
  if (live) await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => !!window.__mapFinderMap, null, { timeout: 45000 });
  await sleep(1500);
  const chip = page.getByTestId("finder-layers-expand").filter({ visible: true });
  if (await chip.count()) await chip.first().click();
  const panel = page.locator('[data-testid="layer-panel"][data-surface="finder"]').first();
  await panel.waitFor({ state: "visible", timeout: 20000 });
  await sleep(700); // the service-area geometry arrives by a dynamic import
  return panel;
}
async function rowsAt(panel, [lat, lng], zoom = 14) {
  await page.evaluate(([a, b, z]) => window.__mapFinderMap.setView([a, b], z, { animate: false }), [lat, lng, zoom]);
  await sleep(1100);
  const out = new Set();
  for (const k of ["env", "jur", "util", "flood", "access"]) {
    const btn = panel.getByTestId(`layer-group-${k}`);
    if (await btn.count()) await btn.click(); else { const sel = panel.getByTestId("layer-group-select"); if (await sel.count()) await sel.selectOption(k); }
    await sleep(160);
    const ids = await panel.evaluate((root) => [...root.querySelectorAll('[data-testid^="layer-row-"]')].filter((r) => !r.getAttribute("data-testid").endsWith("-menu")).map((r) => r.getAttribute("data-testid").replace("layer-row-", "")));
    ids.forEach((i) => out.add(i));
  }
  return out;
}
const featuresOf = (id) => page.evaluate((i) => { const h = window.__finderLayers; return h ? (h().features || {})[i] ?? null : "nohook"; }, id);

const cleanup = [];
try {
  await assertMeasurable(page, "verify-colorado-layers");
  if (live) {
    const v = await page.evaluate(async () => (await fetch("/version.json", { cache: "no-store" })).json());
    console.log("served build:", v.build);
    if (expectSha) check("served build matches the merge commit", String(v.build).startsWith(expectSha.slice(0, 7)), `${v.build} vs ${expectSha}`);
  }
  const panel = await openFinder();

  /* ── B. SCOPE first (cheap, and a failed known-good arm voids everything after it) ───────────────────────────────────────────── */
  log.length = 0;
  const houston = await rowsAt(panel, [29.7604, -95.3698], 14);
  check("B · Houston (known-good arm): the Texas 'Oil & Gas Wells' row IS listed", houston.has("txrrc_wells"), [...houston].slice(0, 8).join(","));
  if (!houston.has("txrrc_wells")) { console.log("VOID: the known-good scope arm failed — an empty answer elsewhere would prove nothing"); voided++; }
  const leaked = IDS.filter((i) => houston.has(i));
  check("B · a Houston view lists none of the 27 Colorado rows", leaked.length === 0, leaked.join(", "));
  await sleep(1500);
  check("B · a Houston view sends NO request to any Colorado source", log.filter((e) => e.req).length === 0, log.filter((e) => e.req).slice(0, 2).map((e) => e.url.slice(0, 90)).join(" | "));
  const fortCollins = await rowsAt(panel, [40.5853, -105.0844], 14);
  check("B · Fort Collins (Larimer): every statewide row, none of the Weld / Adams / Aurora rows", STATEWIDE.every((i) => fortCollins.has(i)) && ![...WELD, ...ADAMS, ...AURORA].some((i) => fortCollins.has(i)),
    `missing statewide: ${STATEWIDE.filter((i) => !fortCollins.has(i)).join(",")} · leaked: ${[...WELD, ...ADAMS, ...AURORA].filter((i) => fortCollins.has(i)).join(",")}`);
  const greeley = await rowsAt(panel, [40.4233, -104.7091], 14);
  check("B · Greeley (Weld): all the Weld rows, no Adams or Aurora row", WELD.every((i) => greeley.has(i)) && !ADAMS.some((i) => greeley.has(i)) && !AURORA.some((i) => greeley.has(i)),
    `missing weld: ${WELD.filter((i) => !greeley.has(i)).join(",")} · leaked: ${[...ADAMS, ...AURORA].filter((i) => greeley.has(i)).join(",")}`);
  const cc = await rowsAt(panel, [39.8083, -104.9339], 14);
  check("B · Commerce City (Adams): all the Adams rows, no Weld row", ADAMS.every((i) => cc.has(i)) && !WELD.some((i) => cc.has(i)), `missing: ${ADAMS.filter((i) => !cc.has(i)).join(",")} · leaked: ${WELD.filter((i) => cc.has(i)).join(",")}`);
  const aur = await rowsAt(panel, [39.7294, -104.7319], 14);
  check("B · Aurora: all the Aurora rows, no Weld row", AURORA.every((i) => aur.has(i)) && !WELD.some((i) => aur.has(i)), `missing: ${AURORA.filter((i) => !aur.has(i)).join(",")}`);
  const durango = await rowsAt(panel, [37.2753, -107.88], 14);
  check("B · Durango (a Colorado point nowhere near a Front Range county): every statewide row, none of the county / city rows", STATEWIDE.every((i) => durango.has(i)) && ![...WELD, ...ADAMS, ...AURORA].some((i) => durango.has(i)), `missing: ${STATEWIDE.filter((i) => !durango.has(i)).join(",")}`);

  /* ── A. DRAWS ──────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
  const turn = async (id, on) => {
    const g = ROWS[id] ? ROWS[id].group : "jur";
    const btn = panel.getByTestId(`layer-group-${g}`);
    if (await btn.count()) await btn.click(); else await panel.getByTestId("layer-group-select").selectOption(g);
    await sleep(200);
    const cb = panel.locator(`[data-testid="layer-row-${id}"] input[type="checkbox"]`).first();
    if (!(await cb.count())) return false;
    if (on && !(await cb.isChecked())) await cb.check();
    if (!on && (await cb.isChecked())) await cb.uncheck();
    return true;
  };
  // known-good control: the EXISTING Colorado traffic-counts row (an esriFeature row, like ours) draws at Denver by the same flow
  // (not "City Limits (Colorado)": that row is one of seven registered with no vector source and draws NOTHING on any Colorado site — see vectorLayerRegistered's KNOWN_UNREGISTERED)
  await rowsAt(panel, [39.7392, -104.9903], 12);
  ROWS.co_aadt = { at: [39.7392, -104.9903], zoom: 12, group: "access" };
  await turn("co_aadt", true);
  let ctl = null;
  for (let i = 0; i < 24 && !(ctl > 0); i++) { await sleep(700); ctl = await featuresOf("co_aadt"); }
  check("A · KNOWN-GOOD control: the existing 'Traffic Counts' (CDOT) row draws features at Denver by the same flow", ctl > 0 && ctl !== "nohook", `features=${ctl}`);
  if (!(ctl > 0)) { console.log("VOID: the draw control failed — every 'drew N features' below would prove nothing"); voided++; }
  await turn("co_aadt", false);
  delete ROWS.co_aadt;

  const result = {};
  for (const id of IDS.filter((x) => !ONLY.length || ONLY.includes(x))) {
    log.length = 0;
    const r = ROWS[id];
    let listed = await rowsAt(panel, r.at, r.zoom);
    if (!listed.has(id)) { await sleep(1500); listed = await rowsAt(panel, r.at, r.zoom); } // the card can be mid-render right after the previous row was switched off
    if (!listed.has(id)) { check(`A · ${id}: the row is listed at its own ground-truth point`, false, `not in the card (${[...listed].filter((x) => x.startsWith("co_")).join(",")})`); continue; }
    await turn(id, true);
    let n = null;
    for (let i = 0; i < 40 && !(n > 0); i++) { await sleep(750); n = await featuresOf(id); }
    if (n > 0) { await sleep(3500); const settled = await featuresOf(id); if (settled > n) n = settled; } // the first poll catches the first tile; read again once the rest has arrived
    result[id] = n;
    check(`A · ${id} draws real features at a real point`, n >= (MIN[id] || 1), `features=${n}${MIN[id] ? ` (floor ${MIN[id]})` : ""}`);
    const bad = log.filter((e) => !e.req && typeof e.status === "number" && e.status >= 400);
    check(`C · ${id}: no request to its source failed`, bad.length === 0, bad.slice(0, 2).map((e) => `${e.status} ${e.url.slice(0, 100)}`).join(" | "));
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${id}.png` });
    await turn(id, false);
  }
  console.log("features painted:", JSON.stringify(result));

  /* ── D. LIVE: throwaway located plans + the real click card ───────────────────────────────────────────────────────────────── */
  if (live && signedIn) {
    const { LIVE_PREFIX, throwawayPlan, cleanupLive } = await import("./lib/liveFixtures.mjs");
    const mk = (tag, at, label) => ({ ...throwawayPlan(`${LIVE_PREFIX}co-${tag}-${Date.now().toString(36)}`), origin: { lat: at[0], lon: at[1] }, site: `ZZ Live Check — ${label}` });
    const insert = async (plan) => {
      const err = await page.evaluate(async ([pl]) => {
        const { data: u } = await window.pfSupabase.auth.getUser();
        const { error } = await window.pfSupabase.from("sites").insert({ id: pl.id, group_id: pl.groupId, site: pl.site, name: pl.name, county: null, user_id: u.user.id, version: 1, data: pl });
        return error ? String(error.message) : null;
      }, [plan]);
      cleanup.push(plan.id);
      if (err) throw new Error("throwaway plan insert failed — " + err);
    };
    const CASES = [
      { tag: "pad", label: "Weld pad", at: ROWS.co_ecmc_locations.at, rows: ["co_ecmc_locations", "co_ecmc_wells"], card: "co_ecmc_locations", title: /^Oil & gas location/ },
      { tag: "rmarsenal", label: "Superfund Commerce City", at: ROWS.co_superfund.at, rows: ["co_superfund"], card: "co_superfund", title: /^Superfund site/ },
      { tag: "apz", label: "Buckley crash zone", at: ROWS.co_aurora_apz.at, rows: ["co_aurora_apz"], card: "co_aurora_apz", title: /^Buckley SFB/ },
    ];
    for (const c of CASES) {
      const plan = mk(c.tag, c.at, c.label);
      await insert(plan);
      await page.goto(`${base}/?planyrDiag=1#/project/${plan.id}/site`, { waitUntil: "domcontentloaded" });
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByTestId("planner-canvas").waitFor({ timeout: 60000 });
      await sleep(2500);
      const chip = page.getByTestId("layers-expand").filter({ visible: true });
      if (await chip.count()) await chip.first().click();
      const pp = page.locator('[data-testid="layer-panel"][data-surface="planner"]').first();
      await pp.waitFor({ state: "visible", timeout: 20000 });
      await sleep(900);
      for (const id of c.rows) {
        const g = ROWS[id].group;
        const btn = pp.getByTestId(`layer-group-${g}`);
        if (await btn.count()) await btn.click(); else await pp.getByTestId("layer-group-select").selectOption(g);
        await sleep(200);
        const cb = pp.locator(`[data-testid="layer-row-${id}"] input[type="checkbox"]`).first();
        check(`D · ${c.label}: the planner offers "${id}"`, (await cb.count()) > 0);
        if (await cb.count()) await cb.check();
      }
      let n = null;
      for (let i = 0; i < 40 && !(n > 0); i++) { await sleep(750); n = await page.evaluate((i2) => { const h = window.__plannerLayers; return h ? (h().features || {})[i2] ?? null : null; }, c.card); }
      check(`D · ${c.label}: "${c.card}" painted features on the planner`, n > 0, `features=${n}`);
      const card = await page.evaluate(([id, at]) => { const h = window.__plannerLayers; const x = h && h().identify ? h().identify(id, { lat: at[0], lng: at[1], tolDeg: 0.0003 }) : null; return x ? { title: x.title, rows: x.rows || [], sourceName: x.sourceName } : null; }, [c.card, c.at]);
      console.log(`   ${c.card} card:`, JSON.stringify(card));
      check(`D · ${c.label}: the click card names the feature in words`, !!card && c.title.test(card.title || ""), card ? card.title : "no card");
      check(`D · ${c.label}: the card has labelled rows, none empty, none a raw field name`, !!card && card.rows.every((r) => String(r.text || "").trim() && !/_|^[a-z]+$/.test(r.label)), card ? JSON.stringify(card.rows).slice(0, 160) : "");
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/D-${c.tag}.png` });
    }
  }
} finally {
  if (live && signedIn) {
    const { cleanupLive } = await import("./lib/liveFixtures.mjs");
    for (const id of cleanup) {
      const r = await cleanupLive(page, { planId: id }).catch((e) => ({ error: String(e) }));
      check(`throwaway plan ${id.slice(-8)} deleted and verified gone`, r && r.left && r.left.site === 0 && !(r.errors || []).length, JSON.stringify(r));
    }
  }
  await close();
}
if (voided) console.log(`VOID — ${voided} precondition(s) failed; the run proves nothing`);
console.log(failed ? `FAIL (${failed})` : voided ? "VOID" : "PASS");
process.exit(failed ? 1 : voided ? 2 : 0);
