/* verify-layer-review-fixes-live — NEW-1 (adversarial review of the TN / MS / CO / GA due-diligence layers, 2026-10-30), checked in a REAL browser on the map finder.
 *
 *   node ui-audit/verify-layer-review-fixes-live.mjs <preview-or-prod url> [--expect-sha <sha>]
 *   E2E_LOGIN_KEY=… node ui-audit/verify-layer-review-fixes-live.mjs https://planyr.io --expect-sha <merge sha>     (signed in as the test account; nothing is created, so nothing to clean up)
 *
 *  A · the Tennessee county lines are requested only where they can draw: asked at Nashville and at Olive Branch MS (the Tennessee line — KNOWN-GOOD arms; a run whose known-good arms
 *      ask nothing is VOID), never at Jackson MS, Vidalia LA, Fulton KY or Bristol VA. Vidalia LA is offered no Mississippi row, Fulton KY / Bristol VA no Tennessee row.
 *  B · Georgia Stream Buffers: the 100-ft protected-river tier (ink #0369a1) is drawn on a non-MRPA protected river (Etowah, Cartersville; Savannah River above the tide — KNOWN-GOOD) and is NOT
 *      drawn on the Chattahoochee inside the Metropolitan River Protection Act corridor (Roswell Rd, Atlanta) nor on the tidal Savannah River (Port Wentworth).
 * FOREGROUND-OR-VOID asserted first. Live mode reads /version.json in the same call as the assertions. */
import { assertMeasurable } from "./lib/tabTiming.mjs";

const args = process.argv.slice(2);
const base = args.find((a) => /^https?:/.test(a)) || "http://localhost:5199";
const prod = /^https:\/\/(www\.)?planyr\.io/.test(base);
const expectSha = args.includes("--expect-sha") ? args[args.indexOf("--expect-sha") + 1] : null;
let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let page, close;
if (prod) {
  const { openSignedIn } = await import("./lib/signedInSession.mjs");
  const s = await openSignedIn({ base, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
  page = s.page; close = () => s.close();
  console.log("signed in as", s.proof.email);
} else {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.PW_CHROME || undefined });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  page = await ctx.newPage();
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
  close = () => browser.close();
}

const TN_COUNTIES = /TN_Counties_view/;
async function sessionFor() {
  if (prod) { const { openSignedIn } = await import("./lib/signedInSession.mjs"); return openSignedIn({ base, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] }); }
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.PW_CHROME || undefined });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const pg = await ctx.newPage();
  await pg.addInitScript(() => { window.__PLANYR_E2E = true; });
  return { page: pg, close: () => browser.close() };
}

const POINTS = {
  nashville: { lat: 36.1627, lon: -86.7816, z: 10, label: "Nashville TN" },
  oliveBranch: { lat: 34.9618, lon: -89.8295, z: 10, label: "Olive Branch MS (on the Tennessee line)" },
  jackson: { lat: 32.2988, lon: -90.1848, z: 10, label: "Jackson MS" },
  vidalia: { lat: 31.565, lon: -91.44, z: 10, label: "Vidalia LA" },
  fulton: { lat: 36.51, lon: -88.88, z: 10, label: "Fulton KY" },
  bristol: { lat: 36.598, lon: -82.18, z: 10, label: "Bristol VA" },
};
const GA = {
  etowah: { lat: 34.17, lon: -84.8, z: 15, label: "Etowah River, Cartersville (not MRPA)", want: "river" },
  augusta: { lat: 32.9376, lon: -81.5036, z: 15, label: "Savannah River above the tide (a DCA vertex)", want: "river" },
  mrpa: { lat: 33.9982, lon: -84.3348, z: 15, label: "Chattahoochee, Atlanta (MRPA corridor)", want: "none" },
  tidal: { lat: 32.1202, lon: -81.1188, z: 15, label: "Savannah River, Port Wentworth (tidal)", want: "none" },
};

const rowIds = (panel) => panel.evaluate((root) => [...root.querySelectorAll('[data-testid^="layer-row-"]')].filter((r) => !r.getAttribute("data-testid").endsWith("-menu")).map((r) => r.getAttribute("data-testid").replace("layer-row-", "")));
async function openFinderPanel() {
  const chip = page.getByTestId("finder-layers-expand").filter({ visible: true });
  if (await chip.count()) await chip.first().click();
  const fp = page.locator('[data-testid="layer-panel"][data-surface="finder"]').first();
  await fp.waitFor({ state: "visible", timeout: 20000 });
  return fp;
}
const groupRows = async (panel, g) => {
  const btn = panel.getByTestId(`layer-group-${g}`);
  if (await btn.count()) await btn.click(); else await panel.getByTestId("layer-group-select").selectOption(g);
  await sleep(300);
  return rowIds(panel);
};
const turnOn = async (panel, id) => {
  const cb = panel.locator(`[data-testid="layer-row-${id}"] input[type="checkbox"]`).first();
  if (await cb.count() && !(await cb.isChecked())) await cb.check();
  return cb.count();
};
const goTo = async (p) => { await page.evaluate(([la, lo, z]) => window.__mapFinderMap.setView([la, lo], z, { animate: false }), [p.lat, p.lon, p.z]); };

try {
  await assertMeasurable(page, "verify-layer-review-fixes-live");
  await page.goto(`${base}/#/site-planner`, { waitUntil: "load" });
  await page.reload({ waitUntil: "load" });
  await sleep(2500);
  await page.waitForFunction(() => !!window.__mapFinderMap, null, { timeout: 30000 });
  const v = await page.evaluate(async () => (await fetch("/version.json", { cache: "no-store" })).json());
  console.log("served build:", v.build);
  if (expectSha) check("served build matches the merge commit", String(v.build).startsWith(expectSha.slice(0, 7)), `${v.build} vs ${expectSha}`);

  // ── A · Tennessee county lines ── the service answers for the WHOLE state in one request and the app caches it, so each point gets a FRESH signed-in browser (empty cache): the request is made, or not, at that point.
  const asked = {}, idsAt = {};
  for (const [k, p] of Object.entries(POINTS)) {
    const s2 = await sessionFor();
    const pg = s2.page;
    const seen = [];
    pg.on("request", (r) => { if (TN_COUNTIES.test(r.url())) seen.push(r.url()); });
    await pg.goto(`${base}/#/site-planner`, { waitUntil: "load" });
    await pg.reload({ waitUntil: "load" });
    await sleep(2500);
    await pg.waitForFunction(() => !!window.__mapFinderMap, null, { timeout: 30000 });
    await pg.evaluate(([la, lo, z]) => window.__mapFinderMap.setView([la, lo], z, { animate: false }), [p.lat, p.lon, p.z]);
    await sleep(1500);
    const chip = pg.getByTestId("finder-layers-expand").filter({ visible: true });
    if (await chip.count()) await chip.first().click();
    const pn = pg.locator('[data-testid="layer-panel"][data-surface="finder"]').first();
    await pn.waitFor({ state: "visible", timeout: 20000 });
    const btn = pn.getByTestId("layer-group-jur");
    const sel = pn.getByTestId("layer-group-select");
    if (await btn.count()) await btn.click(); else if (await sel.count()) await sel.selectOption("jur");   // no Jurisdictions group at all = no county/city row offered there
    await sleep(400);
    const cb = pn.locator('[data-testid="layer-row-counties_cities"] input[type="checkbox"]').first();
    if (await cb.count()) await cb.check();
    await sleep(8000);
    asked[k] = seen.length;
    idsAt[k] = await pn.evaluate((r) => [...r.querySelectorAll('[data-testid^="layer-row-"]')].filter((x) => !x.getAttribute("data-testid").endsWith("-menu")).map((x) => x.getAttribute("data-testid").replace("layer-row-", "")), null);
    console.log(`${p.label}: ${asked[k]} request(s) to the Tennessee county service; Counties & Cities row ${await cb.count() ? "present" : "ABSENT"}`);
    asked[k + ":row"] = await cb.count();
    await s2.close();
  }
  check("A · KNOWN-GOOD: Nashville asks the Tennessee county service", asked.nashville > 0, `${asked.nashville}`);
  check("A · KNOWN-GOOD: Olive Branch MS (the Tennessee line) asks it too", asked.oliveBranch > 0, `${asked.oliveBranch}`);
  if (!(asked.nashville > 0 && asked.oliveBranch > 0)) { console.log("VOID: the known-good arms asked nothing, so a zero elsewhere proves nothing"); failed++; }
  for (const k of ["jackson", "vidalia", "fulton", "bristol"]) {
    // Jackson has the Mississippi county/city rows (so the toggle was real); Vidalia / Fulton / Bristol may have no Jurisdictions row at all — both are fine, what matters is that Tennessee is never asked
    check(`A · ${POINTS[k].label}: the Tennessee county service is NOT asked`, asked[k] === 0, `${asked[k]} request(s), Counties & Cities row ${asked[k + ":row"] ? "present" : "absent"}`);
  }
  check("A · KNOWN-GOOD for the toggle: Jackson MS (Mississippi rows) has the Counties & Cities row to turn on", asked["jackson:row"] > 0, `${asked["jackson:row"]}`);
  check("A · Vidalia LA is offered no Mississippi row", !idsAt.vidalia.some((id) => /^ms_/.test(id)), idsAt.vidalia.filter((id) => /^ms_/.test(id)).join(", "));
  for (const k of ["fulton", "bristol"]) check(`A · ${POINTS[k].label} is offered no Tennessee row`, !idsAt[k].some((id) => /^tn_/.test(id)), idsAt[k].filter((id) => /^tn_/.test(id)).join(", "));

  // ── B · Georgia protected-river tier ──
  await page.goto(`${base}/#/site-planner`, { waitUntil: "load" });
  await page.reload({ waitUntil: "load" });
  await sleep(2500);
  await page.waitForFunction(() => !!window.__mapFinderMap, null, { timeout: 30000 });
  await goTo(GA.etowah);
  await sleep(1500);
  const panel = await openFinderPanel();
  const frows = await groupRows(panel, "flood");
  check("B · the Georgia Stream Buffers row is offered at an Atlanta-area view", frows.includes("ga_stream_buffers"), frows.join(","));
  await turnOn(panel, "ga_stream_buffers");
  const RIVER_INK = '#0369a1';
  /* Leaflet keeps an EMPTY path element for every band the viewport clips away entirely, so a node count reads bands that are not on screen: count only a path that paints (a real `d` and a box). */
  const riverPaths = () => page.evaluate((ink) => [...document.querySelectorAll(".leaflet-pane svg path")].filter((p) => {
    if ((p.getAttribute("stroke") || "").toLowerCase() !== ink) return false;
    const r = p.getBoundingClientRect();
    return (p.getAttribute("d") || "").length > 12 && r.width > 0 && r.height > 0;
  }).length, RIVER_INK);
  /* A band COVERS a point when the point is inside its polygon (the points below are DCA centreline vertices, so a drawn band always covers them). The tidal arm asks THIS, not "any band in view":
   * the refuge's diked freshwater impoundments hold short side-channel fragments the National Wetlands Inventory rightly calls non-tidal, and they paint a band beside the tidal river. */
  const covers = (lat, lng) => page.evaluate(([la, lo, ink]) => {
    const m = window.__mapFinderMap; let n = 0;
    const inside = (ring) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a.lat > la) !== (b.lat > la) && lo < ((b.lng - a.lng) * (la - a.lat)) / (b.lat - a.lat) + a.lng) c = !c; } return c; };
    m.eachLayer((l) => { if (l && l.options && String(l.options.color || "").toLowerCase() === ink && l._latlngs) { const rings = Array.isArray(l._latlngs[0]) ? l._latlngs : [l._latlngs]; if (rings.some((r) => inside(r))) n++; } });
    return n;
  }, [lat, lng, RIVER_INK]);
  const counts = {}, cover = {};
  for (const [k, p] of Object.entries(GA)) {
    await goTo(p);
    await sleep(14000);
    counts[k] = await riverPaths();
    cover[k] = await covers(p.lat, p.lon);
    console.log(`${p.label}: ${counts[k]} protected-river band(s) painted in view; ${cover[k]} cover the river point itself`);
  }
  check("B · KNOWN-GOOD: the Etowah (protected, not MRPA) carries the 100-ft band", counts.etowah > 0, `${counts.etowah}`);
  check("B · KNOWN-GOOD: the Savannah River above the tide (protected, not tidal) carries it, and the point test sees that band", counts.augusta > 0 && cover.augusta > 0, `${counts.augusta} painted, ${cover.augusta} cover the point`);
  if (!(counts.etowah > 0 && counts.augusta > 0 && cover.augusta > 0)) { console.log("VOID: the known-good arms drew no band (or the point test cannot see one), so a zero elsewhere proves nothing"); failed++; }
  check("B · the Chattahoochee INSIDE the MRPA corridor carries NO protected-river band", counts.mrpa === 0, `${counts.mrpa}`);
  check("B · the TIDAL Savannah River (Port Wentworth) carries NO protected-river band over the river itself", cover.tidal === 0, `${cover.tidal} cover the point (${counts.tidal} short side-channel fragments in the refuge's freshwater impoundments paint beside it)`);
} finally {
  await close();
}
console.log(failed ? `FAIL (${failed})` : "PASS");
process.exit(failed ? 1 : 0);
