/* V2115886 / B2671245–B2671247 — one lot returned as several rows is ONE lot, on the real deploy, signed in as the throwaway test account.
 *   E2E_LOGIN_KEY=… node ui-audit/verify-stacked-rows-live.mjs [https://planyr.io | a *.planyr.pages.dev preview] [expectedBuildPrefix]
 * Reads /version.json IN THE SAME CALL as every assertion (merged ≠ live). Click/search-only on the Map: nothing is created, so there is nothing to clean up.
 *   · KNOWN-GOOD ARM: the Bartow lot that has ONE row (a row count read from the county's own server in the same run) must select as one lot — a run that cannot reproduce
 *     the stacking (Gerdau does not report >1 rows from the county server) is VOID, not scored.
 *   · Bartow (B2671245): Select parcels, click Gerdau (PARCELID 0080-0202-001, 170 rows) → "1 parcel"; click it again → the selection empties (never two overlapping copies).
 *   · Rutherford (B2671246): address-box id search 126-050.14-000 → the 74.6-acre lot, not the 0.12-acre sliver.
 *   · TRANSPORT: the app asks www.bartowgis.org DIRECTLY (a real browser reaches it); this sandbox's egress proxy refuses that host (ERR_TUNNEL_CONNECTION_FAILED), which
 *     once read as "Bartow's server didn't answer". The harness therefore carries ONLY those requests through planyr.io's own /gis-proxy relay (same upstream answer, CORS added);
 *     any other failure of that host is VOID, not scored. From a real browser/network the route is a no-op.
 *   · Chambers (B2671247) is NOT driven here: gisdata.pandai.com is off this sandbox's allow-list (V2115886 step 5). */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const base = process.argv[2] || "https://planyr.io";
const wantBuild = process.argv[3] || null;
const GERDAU = [34.24331493916855, -84.7969492457196];
const rows = [];
const rec = (name, pass, detail) => { rows.push({ name, pass }); console.log(`  [${pass ? "PASS" : "FAIL"}] ${name} — ${detail}`); };

const s = await openSignedIn({ base, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
let void_ = false;
try {
  await assertMeasurable(s.page, "verify-stacked-rows-live");
  console.log("signed in as", s.proof.email, "| build", JSON.stringify(s.build));
  if (wantBuild && !String(s.build && s.build.build).startsWith(wantBuild)) throw new Error(`served build ${s.build && s.build.build} is not ${wantBuild} — merged ≠ live, aborting`);
  const page = s.page;
  let relayed = 0, relayFailed = 0;
  await page.route(/^https:\/\/www\.bartowgis\.org\//, async (route) => {
    const u = new URL(route.request().url());
    try {
      const r = await route.fetch({ url: `${base}/gis-proxy/${u.host}${u.pathname}${u.search}` });
      relayed++;
      await route.fulfill({ response: r, headers: { ...r.headers(), "access-control-allow-origin": "*" } });
    } catch (e) { relayFailed++; await route.abort(); }
  });

  // the instrument must be able to see the stacking: ask the county server (through the relay) how many rows Gerdau has
  const count = await page.evaluate(async () => {
    const r = await fetch("/gis-proxy/www.bartowgis.org/arcgis/rest/services/AGOServices/BartowLand/FeatureServer/2/query?where=" + encodeURIComponent("PARCELID='0080-0202-001'") + "&returnCountOnly=true&f=json");
    return (await r.json()).count;
  });
  if (!(count > 1)) { void_ = true; console.log(`VOID: the county server reports ${count} row(s) for Gerdau — the stacking this check is about is not there`); }
  else console.log(`known-good arm: the county server holds ${count} rows for Gerdau`);

  // Rutherford FIRST: the address box is hidden while Select parcels is on. ParcelsCAMA1 is on *.arcgis.com — reachable directly.
  await page.goto(base + "/#/site", { waitUntil: "domcontentloaded" });
  await page.getByTestId("map-toolbar-select-parcels").waitFor({ timeout: 45000 });
  await page.waitForTimeout(3000);
  const addr = page.getByPlaceholder(/Type an address/);
  await addr.fill("126-050.14-000");
  await addr.press("Enter");
  /* The id search asks every Tennessee county's layer at once and waits for the slow ones (one answered in ~25 s from this sandbox), so the lot lands ~50 s in: wait 90 s. */
  const card = page.getByTestId("map-decide-summary").filter({ hasText: /^1 parcel/ });
  const found = await card.first().waitFor({ timeout: 90000 }).then(() => true, () => false);
  const summaryText = found ? (await card.first().innerText()).replace(/\s+/g, " ").trim() : "";
  const ac = (summaryText.match(/([\d,.]+)\s*AC/i) || [])[1];
  const acres = ac ? Number(ac.replace(/,/g, "")) : NaN;
  rec("Rutherford: id 126-050.14-000 finds ONE lot, the ~74.6-acre one, not the 0.12-acre sliver", found && acres > 70 && acres < 80, found ? `summary: ${JSON.stringify(summaryText)}` : "no '1 parcel' summary within 90 s");
  const clr = page.getByTestId("map-decide-clear"); if (await clr.count()) await clr.first().click().catch(() => {});

  await page.reload({ waitUntil: "domcontentloaded" }); // a clean map for the Bartow arm (the Rutherford search leaves a selection)
  await page.getByTestId("map-toolbar-select-parcels").waitFor({ timeout: 45000 });
  await page.waitForTimeout(3000);
  await page.evaluate(([a, b]) => window.__mapFinderMap.setView([a, b], 17, { animate: false }), GERDAU);
  await page.waitForTimeout(1500);
  await page.getByTestId("map-toolbar-select-parcels").click();
  await page.waitForTimeout(800);
  const pt = await page.evaluate(([a, b]) => { const m = window.__mapFinderMap, p = m.latLngToContainerPoint([a, b]), r = m.getContainer().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; }, GERDAU);
  const summary = page.getByTestId("map-decide-summary");

  await page.mouse.click(pt.x, pt.y);
  const one = await summary.filter({ hasText: /^1 parcel/ }).first().waitFor({ timeout: 40000 }).then(() => true, () => false);
  rec("Bartow: a click on Gerdau selects ONE parcel", one, one ? "summary reads 1 parcel" : "no '1 parcel' summary within 40 s");

  await page.waitForTimeout(1500);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(3000);
  const left = await summary.count() ? await summary.first().innerText().catch(() => "") : "";
  rec("Bartow: a second click on the same lot removes it (never two overlapping copies)", !/^[12] parcel/.test(left.trim()), `summary after the second click: ${JSON.stringify(left.trim().slice(0, 60))}`);

  const bs = relayFailed;
  if (relayFailed) { void_ = true; console.log(`VOID: ${relayFailed} Bartow request(s) failed even through the relay`); }
  console.log(`Bartow requests carried through the relay: ${relayed}`);
} finally {
  await s.close();
}
const failed = rows.filter((r) => !r.pass);
console.log(void_ ? "VERDICT: VOID (instrument could not see the stacking)" : failed.length ? `VERDICT: FAIL (${failed.length} of ${rows.length})` : `VERDICT: PASS (${rows.length} of ${rows.length})`);
process.exit(void_ ? 2 : failed.length ? 1 : 0);
