#!/usr/bin/env node
/* verify-food-address-search — V1607024 (B2051665): typing a CITY or a full STREET ADDRESS in the Food search finds
 * places. Runs SIGNED IN as the test account on a real deploy (shared helper, never a second sign-in), Chromium
 * desktop, labelled as such. READ-ONLY: it only types into the search box and moves the map; it writes nothing, so
 * there is nothing to clean up (owner rule 15 still applies — verified by there being no write call in this file).
 *
 * FOREGROUND-OR-VOID: assertMeasurable runs before anything is read. KNOWN-ANSWER ARM (DRIVER-SCROLL §6): the plain
 * NAME query "Taco" must still return taco-named rows, and a nonsense query must return the no-match state — if either
 * is wrong the run is VOID, so the address rows can never be "found" by a probe that finds anything.
 *
 * Usage: node ui-audit/verify-food-address-search.mjs [https://planyr.io | https://<branch>.planyr.pages.dev]
 *        (needs E2E_LOGIN_KEY; see CLAUDE.md "SESSIONS SIGN IN AND VERIFY THEIR OWN WORK") */
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const BASE = (process.argv.find((a, i) => i > 1 && a.startsWith("http")) || "https://planyr.io").replace(/\/$/, "");
const KATY = [29.7858, -95.8245], DALLAS = [32.7767, -96.797];
const results = [];
const row = (id, ok, detail = "") => { results.push({ id, ok: !!ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${id}${detail ? "  — " + detail : ""}`); };

const s = await openSignedIn({ base: BASE, viewport: { width: 1440, height: 900 }, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
let exit = 0;
try {
  const page = s.page;
  page.setDefaultTimeout(10000);
  await page.goto(BASE + "/#/food", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="food-search-box"]', { timeout: 45000 });
  await page.waitForFunction(() => !!window.__foodMap, null, { timeout: 30000 });
  await assertMeasurable(page, "verify-food-address-search");
  const ver = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null));
  const chunks = await page.evaluate(() => [...document.querySelectorAll("script[src]")].map((x) => x.src.split("/").pop()).filter((n) => /^index-/.test(n)));
  console.log(`BUILD  ${BASE}  version.json=${JSON.stringify(ver)}  entry=${chunks.join(",")}`);
  row("0 PRECONDITION: signed in as the test account", s.proof.email === "e2e@planyr.test" && s.proof.fixtureVisible, JSON.stringify(s.proof));

  const moveTo = async ([lat, lon]) => {
    await page.evaluate(([la, lo]) => { window.__foodMap.setView([la, lo], 14, { animate: false }); }, [lat, lon]);
    await page.waitForTimeout(1500);
  };
  const box = page.locator('[data-testid="food-search-box"]');
  const search = async (q) => {
    await box.fill(""); await page.waitForTimeout(300);
    await box.fill(q);
    await page.waitForFunction(() => {
      const r = document.querySelector('[data-testid="food-search-results"]');
      return r && !/Searching/.test(r.innerText);
    }, null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1200);
    return page.$$eval('[data-testid="food-search-results"] button:not([data-testid])', (bs) => bs.map((b) => b.innerText.replace(/\s+/g, " ").trim()));
  };
  const noMatch = () => page.locator('[data-testid="food-search-drop-pin"]').count();
  const bannerErr = () => page.evaluate(() => /Couldn.t load/.test(document.body.innerText));

  // known-good arms first
  await moveTo(KATY);
  const taco = await search("Taco");
  row("A KNOWN ANSWER: a plain NAME query still returns taco-named rows", taco.length >= 3 && taco.slice(0, 3).every((t) => /taco/i.test(t)), taco.slice(0, 3).join(" ‖ "));
  const junk = await search("zzzqxjv");
  row("B KNOWN ANSWER: a nonsense query shows the no-match state, no rows", junk.length === 0 && (await noMatch()) > 0, `rows=${junk.length}`);
  if (!results.slice(-3).every((r) => r.ok)) { console.log("RUN VOID: a known-answer arm failed"); exit = 2; throw new Error("void"); }

  // 1 — far full street address while the map is on Katy
  const sk = await search("7170 Skillman St Dallas");
  const skRows = sk.filter((t) => /7170 Skillman St, Dallas/i.test(t));
  row("1a a far full street address lists its restaurants (3 tenants at that address)", skRows.length >= 3, `${skRows.length} of ${sk.length}: ${sk.slice(0, 4).join(" ‖ ")}`);
  await page.locator('[data-testid="food-search-results"] button:not([data-testid])').first().click();
  await page.waitForTimeout(3000);
  const c = await page.evaluate(() => { const m = window.__foodMap.getCenter(); return [m.lat, m.lng]; });
  row("1b picking it flies the map to Dallas", Math.abs(c[0] - 32.87) < 0.3 && Math.abs(c[1] + 96.75) < 0.3, `centre ${c.map((x) => x.toFixed(3))}`);

  // 2 — a city word with the map on Katy
  await moveTo(KATY);
  const katy = await search("Katy");
  row("2 'Katy' with the map on Katy lists Katy-address places (top rows)", katy.length >= 5 && katy.slice(0, 5).every((t) => /Katy/i.test(t)), katy.slice(0, 3).join(" ‖ "));

  // 3 — same word, map on Dallas: a bias, not a filter
  await moveTo(DALLAS);
  const katyFar = await search("Katy");
  row("3 'Katy' with the map on Dallas still lists Katy places (bias, not filter)", katyFar.length >= 3 && katyFar.some((t) => /Katy/i.test(t)), `${katyFar.length} rows: ${katyFar.slice(0, 2).join(" ‖ ")}`);

  // 4 — name behaviour unchanged (also the A arm); 5 — junk inputs
  const t2 = await search("Taco");
  row("4 'Taco' (a name) unchanged: taco-named rows", t2.length >= 3 && t2.slice(0, 3).every((t) => /taco/i.test(t)), t2.slice(0, 2).join(" ‖ "));
  const pct = await search("%%%");
  row("5a '%%%' shows the no-match state, no rows", pct.length === 0 && (await noMatch()) > 0, `rows=${pct.length}`);
  const ab = await search("ab");
  // "ab" is a legitimate NAME query (Abuelo's, Abe's…): the NAME search answers it. What must hold is that the address half
  // (which refuses words under 3 letters) adds nothing odd — every row's NAME carries "ab" — and no error banner shows.
  row("5b 'ab' (2 letters): rows, if any, are name matches, and no error banner", ab.every((t) => /ab/i.test(t.split(/\s\d/)[0])) && !(await bannerErr()), `rows=${ab.length}: ${ab.slice(0, 3).join(" ‖ ")}`);
  row("5c no console/page errors from the search path", s.errors.filter((e) => /search_by_address|food_places/.test(String(e))).length === 0, `${s.errors.length} total page errors`);
} catch (e) {
  if (String(e.message) !== "void") { console.log("ERROR " + (e && e.stack || e)); exit = exit || 1; }
} finally { await s.close(); }
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} pass${failed ? ", " + failed + " FAIL" : ""}`);
process.exit(exit || (failed ? 1 : 0));
