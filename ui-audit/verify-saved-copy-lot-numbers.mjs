/* V1475200 step 8 (B2057040 Q2, PR #1996) — the SAVED COPY numbers its lots with the real CAD account, checked on
 * PRODUCTION, signed in as the throwaway test account (ui-audit/lib/signedInSession.mjs).
 *
 *   node ui-audit/verify-saved-copy-lot-numbers.mjs [https://planyr.io]
 *
 * What is REAL: the deploy, the sign-in, /api/parcel-cache/svc/chambers (the deployed Drive snapshot), Chambers' own
 * CAD host (whatever it does from this network — recorded below, never forced). What is MOCKED, and only this: the
 * address geocoder, used solely to fly the map to lot 15835 (-94.8695, 29.8222). Nothing is saved: Map view's
 * bare #/site, no project created, selection cleared at the end.
 * KNOWN-GOOD ARM (clause 6 of DRIVER-SCROLL-IS-NOT-APP-SCROLL): the snapshot is fetched independently here and must
 * contain lot 15835 with GEO_ID 00321-02000-00100-100001, or the run is VOID rather than scored. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { mkdirSync } from "node:fs";

const BASE = process.argv[2] || "https://planyr.io";
const LOT = { lat: 29.8222, lng: -94.8695 };
const ACCT = "00321-02000-00100-100001";
const SHOTS = process.env.SHOTS || "/tmp/claude-0/shots"; mkdirSync(SHOTS, { recursive: true });
let failures = 0;
const expect = (label, cond, extra = "") => { if (!cond) failures++; console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${extra ? " — " + extra : ""}`); };

const s = await openSignedIn({ base: BASE });
const { page } = s;
const cacheReqs = []; page.on("request", (r) => { if (/api\/parcel-cache/.test(r.url())) cacheReqs.push(r.url()); });
try {
  await assertMeasurable(page, "verify-saved-copy-lot-numbers");
  // Build provenance, in the SAME call as the assertions below.
  const served = await page.evaluate(async () => ({
    version: await fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
    scripts: [...document.querySelectorAll("script[src]")].map((x) => x.getAttribute("src")).filter((x) => /assets\//.test(x)).slice(0, 3),
  }));
  console.log("signed in as", s.proof.email, "| fixture visible:", s.proof.fixtureVisible, "| served build:", JSON.stringify(served.version), "| entry chunks:", served.scripts.join(", "));

  // KNOWN-GOOD ARM: the deployed snapshot really carries the account on lot 15835.
  const known = await page.evaluate(async () => {
    const r = await fetch("/api/parcel-cache/svc/chambers"); const fc = await r.json();
    const f = fc.features.find((x) => String((x.properties.PROP_ID ?? x.properties.prop_id)) === "15835");
    return { status: r.status, n: fc.features.length, props: f ? f.properties : null };
  });
  console.log("snapshot:", known.status, known.n, "lots; lot 15835 =", JSON.stringify(known.props && { PROP_ID: known.props.PROP_ID, GEO_ID: known.props.GEO_ID, OWNER_NAME: known.props.OWNER_NAME }));
  if (!known.props || known.props.GEO_ID !== ACCT) { console.log("VOID — the known-good arm did not report its known value; nothing below is scored."); process.exit(2); }

  // What Chambers' own CAD does from this network (recorded, not forced).
  const live = await page.evaluate(async () => {
    try { const r = await fetch("https://gisdata.pandai.com/arcgis/rest/services/ChambersCADPublic/MapServer/0/query?f=json&where=1%3D1&returnCountOnly=true"); return { status: r.status, text: (await r.text()).slice(0, 120) }; }
    catch (e) { return { error: String(e).slice(0, 120) }; }
  });
  console.log("Chambers live CAD from this network:", JSON.stringify(live));

  await page.route("**/geocode.arcgis.com/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ candidates: [{ location: { y: LOT.lat, x: LOT.lng }, address: "Lot 15835, Mont Belvieu, TX" }] }) }));
  await page.goto(BASE + "/#/site", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".leaflet-container", { timeout: 40000 });
  await page.waitForTimeout(2500);
  const input = page.locator('input[placeholder*="Type an address"]').first();
  await input.click(); await input.fill("Lot 15835, Mont Belvieu, TX"); await page.waitForTimeout(600); await input.press("Enter");
  await page.waitForTimeout(5000);
  const clear = page.getByTestId("map-decide-clear");
  if (await clear.count()) { await clear.click(); await page.waitForTimeout(400); }
  // The saved copies are warmed only while Select parcels is armed, for the counties in view (B2092656 ×3) — so arm it,
  // then wait for the real download of the Drive snapshot, the display hang-guard (~8 s) and the repaint.
  await page.locator("text=/^Select parcels/").first().click(); await page.waitForTimeout(500);
  const readNumbers = () => page.evaluate(() => [...document.querySelectorAll("[data-lot-no]")].map((e) => e.getAttribute("data-lot-no")));
  let nums = [];
  for (let i = 0; i < 24; i++) {            // up to ~72 s
    nums = await readNumbers();
    if (nums.includes(ACCT)) break;
    await page.waitForTimeout(3000);
  }
  const scale = await page.evaluate(() => (document.querySelector(".leaflet-control-scale-line") || {}).textContent);
  console.log("map scale bar:", scale, "| snapshot requests seen:", cacheReqs.length);
  await page.screenshot({ path: `${SHOTS}/saved-copy-numbers.png` });
  console.log("numbers on screen:", JSON.stringify(nums));
  expect("saved-copy outlines drew (vector paths in the map)", (await page.locator(".leaflet-container path").count()) > 0);
  expect(`lot 15835 reads ${ACCT} (the CAD account)`, nums.includes(ACCT));
  expect("no lot reads the county parcel number 15835 instead", !nums.includes("15835"));
  expect("every number on screen is unique (no pile-up of duplicates)", new Set(nums).size === nums.length);

  // Click the lot in Select-parcels mode: the saved-copy notice must say owner names / values may lag.
  const box = await page.locator(".leaflet-container").boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await page.waitForTimeout(4000);
  // Which notice the click raised depends on which source answered the RECORD: the saved copy's own notice when the
  // statewide layer is down too, the statewide-backup notice when only the county is (what this network does).
  const cachedN = page.locator('[data-testid="parcel-cached-notice"]');
  const cachedText = (await cachedN.count()) && (await cachedN.isVisible().catch(() => false)) ? await cachedN.innerText() : "";
  const bodyText = await page.evaluate(() => document.body.innerText);
  const backup = /Statewide backup source\.[^\n]*(\n[^\n]*)?/.exec(bodyText);
  console.log("saved-copy notice:", cachedText || "(not raised)", "| statewide-backup notice:", backup ? backup[0].replace(/\n/g, " ") : "(not raised)");
  expect("the click raised a provenance notice (saved copy or statewide backup) — never a bare live-looking record", !!cachedText || !!backup);
  if (cachedText) expect("the saved-copy notice says owner names and values may lag", /owner names and values may lag/.test(cachedText));
  else expect("the statewide-backup notice says it may lag county updates", /may lag recent county updates/.test(backup[0].replace(/\n/g, " ")));
  // The acreage chip is on the lot now: no number may sit under it (found live 2026-10-08, fixed by this PR).
  await page.waitForTimeout(1500);
  const geo = await page.evaluate(() => {
    const chip = document.querySelector('[data-testid="map-acreage-chip"]');
    const c = chip && chip.getBoundingClientRect();
    const nums = [...document.querySelectorAll("[data-lot-no]")].map((e) => { const r = e.getBoundingClientRect(); return { t: e.getAttribute("data-lot-no"), l: r.left, t0: r.top, r: r.right, b: r.bottom }; });
    return { chip: c ? { l: c.left, t: c.top, r: c.right, b: c.bottom } : null, nums };
  });
  await page.screenshot({ path: `${SHOTS}/saved-copy-notice.png` });
  expect("the acreage chip is on screen (the precondition for the overlap check)", !!geo.chip);
  const under = geo.chip ? geo.nums.filter((n) => !(n.r <= geo.chip.l || n.l >= geo.chip.r || n.b <= geo.chip.t || n.t0 >= geo.chip.b)) : [];
  expect("no lot number sits under the acreage chip", under.length === 0, under.map((n) => n.t).join(","));
  const cl = page.getByTestId("map-decide-clear"); if (await cl.count()) await cl.click();
  expect("no uncaught page errors", s.errors.length === 0, s.errors.join(" | ").slice(0, 200));
} finally { await s.close(); }
console.log(failures ? `❌ ${failures} FAILED` : "✅ PASS — saved-copy lot numbers (V1475200 step 8)");
process.exit(failures ? 1 : 0);
