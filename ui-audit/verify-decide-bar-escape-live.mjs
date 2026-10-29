/* B2451472 / V1894976 — Escape clears the Map's decide bar like its ✕, driven SIGNED IN as the test account on a real deploy.
 *   E2E_LOGIN_KEY=… node ui-audit/verify-decide-bar-escape-live.mjs [base-url] [--expect <commit-sha-prefix>]
 * The county parcel service is STUBBED (two adjoining lots) so the run does not depend on a live GIS host; everything else —
 * the signed-in app, the Map, the bar, the keyboard — is the deployed bundle. Read-only: selections live in memory only.
 * KNOWN-GOOD ARM: the bar's ✕ clears the same selection (a run where it does not is VOID, not a score).
 * Build is read from /version.json (cache: no-store) in the SAME call as the first assertion. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const args = process.argv.slice(2);
const base = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const expectAt = args.indexOf("--expect");
const expect = expectAt >= 0 ? args[expectAt + 1] : null;

const ring = (s, w, n, e) => [[[w, s], [e, s], [e, n], [w, n], [w, s]]];
const LOT_A = { attributes: { OBJECTID: 1, PARCELID: "073088  00221", OWNER: "ALPHA LLC", PAR_ADDR1: "0 ARNOLD RD" }, geometry: { rings: ring(35.027, -89.953, 35.033, -89.947) } };
const LOT_B = { attributes: { OBJECTID: 2, PARCELID: "073088  00222", OWNER: "BRAVO LLC", PAR_ADDR1: "0 ARNOLD RD" }, geometry: { rings: ring(35.027, -89.947, 35.033, -89.941) } };
const inRing = (f, lng, lat) => { const r = f.geometry.rings[0]; return lng > r[0][0] && lng < r[1][0] && lat > r[0][1] && lat < r[2][1]; };

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };

const s = await openSignedIn({ base, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
const page = s.page;
try {
  await assertMeasurable(page, "verify-decide-bar-escape-live");
  const ver = await page.evaluate(async () => (await fetch("/version.json", { cache: "no-store" })).json());
  const verStr = JSON.stringify(ver);
  console.log("build:", verStr, "| signed in as", s.proof.email);
  if (expect && !verStr.includes(expect)) throw new Error(`served build does not match --expect ${expect}`);

  await page.route(/\/(MapServer|FeatureServer)(\/|\?|$)/i, (route) => {
    const req = route.request();
    const u = decodeURIComponent(req.url() + " " + (req.postData() || ""));
    if (!/\/query/.test(u) || !/esriGeometryPoint/.test(u)) return route.continue();
    const m = u.match(/"x":\s*(-?[\d.]+),\s*"y":\s*(-?[\d.]+)/);
    const lng = m ? +m[1] : NaN, lat = m ? +m[2] : NaN;
    const features = /scgis\.shelbycountytn\.gov/.test(u) ? [LOT_A, LOT_B].filter((f) => inRing(f, lng, lat)) : [];
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ spatialReference: { wkid: 4326 }, fields: [], features }) });
  });

  const summary = () => page.evaluate(() => (document.querySelector('[data-testid="map-decide-summary"]') || {}).textContent || "");
  const count = () => page.evaluate(() => (window.__mapSelectedParcels ? window.__mapSelectedParcels().length : -1));
  const barGone = async () => { for (let i = 0; i < 40; i++) { if (!(await summary())) return true; await page.waitForTimeout(100); } return false; };
  const waitSummary = async (re) => { for (let i = 0; i < 200; i++) { if (re.test(await summary())) return true; await page.waitForTimeout(100); } return false; };
  const clickLot = async (lat, lng) => {
    const pt = await page.evaluate(([a, b]) => { const m = window.__mapFinderMap, p = m.latLngToContainerPoint([a, b]), r = m.getContainer().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; }, [lat, lng]);
    await page.mouse.click(pt.x, pt.y);
  };
  const selectOne = async () => { await clickLot(35.03, -89.95); return waitSummary(/^1 parcel/); };

  await page.evaluate(() => { location.hash = "#/site"; });
  await page.getByTestId("map-toolbar-select-parcels").waitFor({ state: "visible", timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__mapFinderMap.setView([35.03, -89.947], 17, { animate: false }));
  await page.waitForTimeout(400);
  await page.getByTestId("map-toolbar-select-parcels").click();
  await page.waitForTimeout(300);

  // KNOWN-GOOD ARM — the ✕
  check("setup: one lot selects (bar says 1 parcel)", await selectOne());
  await page.getByTestId("map-decide-clear").click();
  check("known-good: the ✕ clears bar + selection", (await barGone()) && (await count()) === 0);

  // 1 — Escape, one parcel
  await selectOne();
  await page.keyboard.press("Escape");
  check("1. Escape clears one parcel (bar gone, selection empty)", (await barGone()) && (await count()) === 0);

  // 2 — Escape, two parcels
  await selectOne();
  await clickLot(35.03, -89.944);
  check("2a. two lots selected", await waitSummary(/^2 parcels/));
  await page.keyboard.press("Escape");
  check("2b. Escape clears BOTH", (await barGone()) && (await count()) === 0);

  // 3 — layered with Record info
  await selectOne();
  await page.getByTestId("map-decide-record-info").click();
  // wait for the menu to MOUNT — an immediate isVisible() races the click and reads "not open" (seen once on the first live run)
  const menuOpen = await page.getByTestId("map-decide-verb-note").waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  const menuClosed = !(await page.getByTestId("map-decide-verb-note").isVisible().catch(() => false));
  const afterCount = await count(), afterBar = await summary();
  check("3a. first Escape closes ONLY the Record info menu", menuOpen && menuClosed && afterCount === 1 && !!afterBar, `menuOpenedBefore=${menuOpen} menuClosedAfter=${menuClosed} selected=${afterCount} bar=${JSON.stringify(afterBar)}`);
  await page.keyboard.press("Escape");
  check("3b. second Escape clears the selection", (await barGone()) && (await count()) === 0);

  // 4 — focus in a text field keeps Escape's meaning
  await selectOne();
  await page.evaluate(() => { const d = document.createElement("div"); d.id = "esc-host"; d.innerHTML = '<input id="esc-field" type="text" />'; document.body.appendChild(d); document.getElementById("esc-field").focus(); });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  check("4a. Escape in a focused text field leaves the selection", (await count()) === 1 && !!(await summary()));
  await page.evaluate(() => { document.getElementById("esc-field").blur(); document.getElementById("esc-host").remove(); });
  await page.keyboard.press("Escape");
  check("4b. after leaving the field Escape clears", (await barGone()) && (await count()) === 0);

  // 5 — nothing selected
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check("5. Escape with nothing selected: no-op, no page error", (await count()) === 0 && errs.length === 0, errs.join("; "));

  // 6 — the Map is hidden behind another workspace: its Escape must not act
  await selectOne();
  await page.evaluate(() => { location.hash = "#/library"; });
  await page.waitForTimeout(1500);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  const stillSelected = (await count()) === 1;
  await page.evaluate(() => { location.hash = "#/site"; });
  await page.waitForTimeout(1500);
  check("6. Escape pressed while another workspace is shown does not clear the hidden Map's selection", stillSelected && (await count()) === 1, `selected=${await count()}`);
  await page.keyboard.press("Escape");
  check("6b. back on the Map, Escape clears", (await barGone()) && (await count()) === 0);
} catch (e) {
  check("harness completed", false, e.message);
} finally {
  await s.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
