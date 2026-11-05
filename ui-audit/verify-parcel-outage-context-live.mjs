/* V1720176 / B2288560 — live, signed in: the parcel "slow" banner never shows with Select parcels off.
 * Usage: node ui-audit/verify-parcel-outage-context-live.mjs https://planyr.io
 * The deploy build and served chunk hash are read in the SAME call as each verdict (house rule). Parcel hosts are held
 * open (a hung server) by request routing; the real county servers' latency is not what is under test. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable, pacedWait } from "./lib/tabTiming.mjs";

const base = process.argv[2] || "https://planyr.io";
const OUTAGE = /parcel server is slow|Statewide parcel outlines are slow|live parcel server is unavailable/i;
const STATUS = '[data-testid="map-status-toast"]';
const s = await openSignedIn({ base, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
const { page } = s;
const results = [];
const rec = (name, ok, extra = "") => { results.push(ok); console.log(`${ok ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`); };
try {
  await assertMeasurable(page, "verify-parcel-outage-context-live");
  await page.route(/\/(MapServer|FeatureServer)(\/|\?|$)/i, () => {});
  await page.route(/\.(jpg|jpeg|png|webp)(\?|$)/, (r) => r.abort());
  await page.goto(base + "/#/site", { waitUntil: "load" });
  await page.getByTestId("map-toolbar-select-parcels").waitFor({ timeout: 40000 });
  await pacedWait(page, 2500);
  const ident = async () => page.evaluate(async () => ({ build: (await (await fetch("/version.json", { cache: "no-store" })).json()).build, chunks: [...document.querySelectorAll("script[src]")].map((x) => x.src.split("/").pop()).filter((x) => /MapFinder|SitePlannerApp|index/.test(x)).slice(0, 3) }));
  const id = await ident();
  console.log("build", id.build, "chunks", id.chunks.join(","));
  const text = () => page.evaluate((sel) => { const e = document.querySelector(sel); return e ? e.textContent : ""; }, STATUS);
  const lots = () => page.evaluate(() => window.__mapFinderMap && window.__mapFinderMap.setView([29.7604, -95.3698], 16, { animate: false }));
  // step 1: metro, nothing armed
  await page.evaluate(() => window.__mapFinderMap && window.__mapFinderMap.setView([29.8, -95.1], 9, { animate: false }));
  await pacedWait(page, 15000);
  rec("1 metro zoom, tool never used: no banner", !OUTAGE.test(await text()));
  // step 2: on then Cancel quickly
  await lots();
  await page.getByTestId("map-toolbar-select-parcels").click();
  await pacedWait(page, 1200);
  await page.getByRole("button", { name: /^Cancel$/ }).first().click();
  await pacedWait(page, 14000);
  rec("2 Select on, Cancel within 2s, wait past the 8s guard: no banner", !OUTAGE.test(await text()), JSON.stringify(await text()).slice(0, 80));
  // step 3: on at lot zoom (hung server) warns, Cancel retracts
  await page.getByTestId("map-toolbar-select-parcels").click();
  let seen = false;
  for (let i = 0; i < 30 && !seen; i++) { await pacedWait(page, 1000); seen = OUTAGE.test(await text()); }
  rec("3a tool on at lot zoom with a hung server: banner appears (useful case intact)", seen);
  await page.getByRole("button", { name: /^Cancel$/ }).first().click();
  await pacedWait(page, 1500);
  rec("3b Cancel retracts it immediately", !OUTAGE.test(await text()));
  // step 4: Drop a pin
  await page.getByTestId("map-toolbar-drop-pin").click();
  await pacedWait(page, 13000);
  rec("4 Drop a pin armed: no banner", !OUTAGE.test(await text()));
  const id2 = await ident();
  rec("build unchanged through the run (same chunks)", id2.build === id.build && id2.chunks.join() === id.chunks.join(), `build ${id2.build}`);
} finally { await s.close(); }
process.exit(results.every(Boolean) ? 0 : 1);
