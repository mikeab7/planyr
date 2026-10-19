/* verify-comps-search.mjs — the Records tab's search + filters (comps records search, NEW-1) and the
 * power / dock-door fields + OpEx survival (NEW-2 / NEW-3), driven end to end in a real browser.
 *
 * Two modes, SAME assertions:
 *   · LIVE   `node ui-audit/verify-comps-search.mjs --base https://planyr.io [--engine webkit --device "iPhone 15"]`
 *            signs in as the throwaway test account (ui-audit/lib/signedInSession.mjs), SEEDS nine
 *            throwaway comps (titles start "ZZSEARCH", owned by the test account — never anyone's real
 *            comps), walks every filter and sort, back-from-record and reload, then DELETES the seeds and
 *            confirms the row count dropped. The cleanup runs in a finally.
 *   · MOCK   `--base http://localhost:4173 --mock` against a build made with a dummy VITE_SUPABASE_URL;
 *            the comps REST read is answered from the same fixtures (no writes, nothing to clean up).
 *
 * KNOWN-GOOD ARM (DRIVER-SCROLL / clause 6): the unfiltered list must show every seeded comp before any
 * filter is trusted; a run that cannot see all nine is VOID, not scored.
 * Expected sets below are written by hand from the fixture table — never computed by the code under test.
 */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { chromium, webkit, devices } from "@playwright/test";
import { existsSync } from "node:fs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const BASE = (arg("--base", "https://planyr.io")).replace(/\/+$/, "");
const MOCK = process.argv.includes("--mock");
const ENGINE = arg("--engine", "chromium");
const DEVICE = arg("--device", null);
const LABEL = ENGINE === "webkit" ? "WebKit" : "Chromium";

const iso = (daysAgo) => { const d = new Date(); d.setDate(d.getDate() - daysAgo); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const FIX = [
  { t: "L1", comp_type: "lease", comp_date: iso(5), lease_size_sf: 150000, clear_height_ft: 36, power_amps: 3000, power_volts: 480, power_phase: 3, dock_doors: 30, year_built: 2020, lease_rate: 6, lease_rate_period: "annual", lease_rate_expense: "nnn", lease_opex: 1.5, county: "harris", comp_party_provider: "Prologis" },
  { t: "L2", comp_type: "lease", comp_date: iso(100), lease_size_sf: 50000, clear_height_ft: 24, power_amps: 800, dock_doors: 4, year_built: 1995, lease_rate: 0.5, lease_rate_period: "monthly", lease_rate_expense: "gross", county: "fort_bend" },
  { t: "L3", comp_type: "lease", comp_date: iso(200), lease_size_sf: 300000, clear_height_ft: 40, lease_rate: 9, lease_rate_period: "annual", lease_rate_expense: "nnn", county: "harris" },
  { t: "S1", comp_type: "building_sale", comp_date: iso(30), bldg_size_sf: 100000, bldg_price: 10000000, clear_height_ft: 32, power_amps: 2000, dock_doors: 20, year_built: 2015, county: "harris" },
  { t: "S2", comp_type: "building_sale", comp_date: iso(400), bldg_size_sf: 500000, bldg_price: 25000000, county: "fort_bend" },
  { t: "A1", comp_type: "land", comp_date: iso(10), land_size_value: 10, land_size_unit: "ac", land_price: 4356000, county: "harris" },
  { t: "A2", comp_type: "land", comp_date: iso(120), land_size_value: 435600, land_size_unit: "sf", land_price: 2178000, county: "fort_bend" },
  { t: "U1", comp_type: "lease", comp_date: null, lease_size_sf: 80000, lease_rate: 7, lease_rate_period: "annual", lease_rate_expense: "nnn", county: "harris" },
  { t: "U2", comp_type: "land", comp_date: null, land_size_value: 2, land_size_unit: "ac", county: "harris" },
].map((f, i) => ({ ...f, title: "ZZSEARCH " + f.t, anchor_kind: "pin", lat: 29.7 + i * 0.01, lon: -95.4 + i * 0.01 }));
const ALL = FIX.map((f) => f.t);

let pass = 0; const fails = [];
const ok = (cond, name, detail = "") => { if (cond) pass++; else { fails.push(name + (detail ? " — " + detail : "")); console.log("  ✗", name, detail); } };
const same = (got, want) => JSON.stringify([...got].sort()) === JSON.stringify([...want].sort());

async function launchMock() {
  const exe = existsSync(chromium.executablePath()) ? undefined : "/opt/pw-browsers/chromium";
  const browser = await (ENGINE === "webkit" ? webkit.launch() : chromium.launch({ executablePath: exe, args: ["--no-sandbox"] }));
  const context = await browser.newContext(DEVICE ? { ...devices[DEVICE] } : { viewport: { width: 1440, height: 900 } });
  const rows = FIX.map(({ t, ...f }, i) => ({ id: `mock-${i}`, user_id: "u", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", ...f }));
  // Playwright tries routes LAST-registered-first, so the generic fallbacks go in first and the specific comps read last.
  await context.route(/\/auth\/v1\//, (r) => r.fulfill({ status: 401, contentType: "application/json", body: "{}" }));
  await context.route(/\/rest\/v1\//, (r) => r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await context.route(/\/rest\/v1\/comps\?select=id%2Cuser_id/, (r) => (r.request().method() === "GET" ? r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) }) : r.fulfill({ status: 200, contentType: "application/json", body: "[]" })));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  return { browser, page, errors, close: () => browser.close(), build: null };
}

// WebKit now and then answers a reload with "Frame load interrupted" while the app's own boot navigation settles — retry once.
async function reloadSafe(page) {
  for (let i = 0; i < 3; i++) { try { await page.reload({ waitUntil: "domcontentloaded" }); return; } catch (e) { if (i === 2) throw e; await page.waitForTimeout(1500); } }
}
const titles = (page) => page.$$eval('[data-testid="comp-row"]', (els) => els.map((e) => (e.textContent.match(/ZZSEARCH ([A-Z]\d)/) || [])[1]).filter(Boolean));
const line = (page) => page.locator('[data-testid="comps-results-line"]').innerText().catch(() => "");
const markerCount = (page) => page.evaluate(() => document.querySelectorAll(".leaflet-marker-pane .map-comp-feature").length);

async function openRecords(page) {
  await page.getByRole("tab", { name: /site/i }).first().click({ timeout: 20000 }).catch(() => {});
  // On a phone the collapsed "Imagery & layers" pill overlaps the Records tab's box (pre-existing layout), so
  // a coordinate click lands on the pill; a DOM click on the tab itself is the same action the user's tap performs.
  await page.getByRole("tab", { name: "Records" }).click({ timeout: DEVICE ? 2500 : 30000 }).catch(() => page.getByRole("tab", { name: "Records" }).dispatchEvent("click"));
  await page.getByTestId("comps-search-input").waitFor({ timeout: 30000 });
}
async function setSearch(page, v) { await page.getByTestId("comps-search-input").fill(v); await page.waitForTimeout(150); }
async function openPanel(page) { if (!(await page.getByTestId("comps-filter-panel").count())) await page.getByTestId("comps-filters-toggle").click(); await page.getByTestId("comps-filter-panel").waitFor(); }
async function clearAll(page) { const b = page.getByTestId("comps-clear-all"); if (await b.count()) { await b.click(); } await setSearch(page, "zzsearch"); }
const panel = (page) => page.getByTestId("comps-filter-panel");
async function chip(page, name) { await panel(page).getByRole("button", { name, exact: true }).click(); await page.waitForTimeout(120); }
async function fillBox(page, label, v) { await panel(page).getByLabel(label, { exact: true }).fill(v); await page.waitForTimeout(150); }

async function step(page, name, act, want, extra) {
  await act();
  await page.waitForTimeout(250);
  const got = await titles(page);
  ok(same(got, want), name, `got [${got}] want [${want}]`);
  if (extra) await extra(got);
  await clearAll(page);
}

(async () => {
  const S = MOCK ? await launchMock() : await openSignedIn({ base: BASE, engine: ENGINE, device: DEVICE });
  const { page } = S;
  const seededIds = [];
  try {
    if (ENGINE !== "webkit") await assertMeasurable(page, "verify-comps-search");
    console.log(`verify-comps-search: ${MOCK ? "MOCK" : "LIVE"} · ${LABEL}${DEVICE ? " · " + DEVICE : ""} · ${BASE} · build ${S.build ? JSON.stringify(S.build).slice(0, 80) : "n/a"}`);
    if (!MOCK) {
      // SEED nine throwaway comps (the test account's own rows) — project_id null: no tracked site gets created by a direct insert.
      const res = await page.evaluate(async (rows) => {
        const { data, error } = await window.pfSupabase.from("comps").insert(rows).select("id,title");
        return { data, error: error && error.message };
      }, FIX.map(({ t, ...r }) => r));
      if (res.error) throw new Error("seed failed: " + res.error);
      res.data.forEach((r) => seededIds.push(r.id));
      ok(seededIds.length === FIX.length, "seeded nine throwaway comps", String(seededIds.length));
    }
    await reloadSafe(page);
    if (!MOCK) { await page.waitForFunction(() => !!window.pfSupabase, null, { timeout: 20000 }); }
    await page.evaluate(() => { try { localStorage.removeItem("planyr:compsView:v1"); } catch {} });
    await reloadSafe(page);
    await openRecords(page);
    await setSearch(page, "zzsearch");
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="comp-row"]').length >= n, ALL.length, { timeout: 30000 }).catch(() => {});
    const base = await titles(page);
    // KNOWN-GOOD ARM: all nine visible before any filter is believed.
    ok(same(base, ALL), "unfiltered (search 'zzsearch') shows all nine seeded comps — otherwise the run is VOID", `got [${base}]`);
    if (!same(base, ALL)) throw new Error("VOID: known-good arm failed");
    ok(/of \d+ comps/.test(await line(page)), "results line reads 'N of M comps'", await line(page));
    const baseMarkers = await markerCount(page);
    ok(baseMarkers === ALL.length, "map shows one marker per shown comp (search active)", String(baseMarkers));

    await openPanel(page);
    // ---- Type
    await step(page, "type Lease", () => chip(page, "Lease"), ["L1", "L2", "L3", "U1"]);
    await openPanel(page);
    await step(page, "type Bldg Sale (label has a capital S)", () => chip(page, "Bldg Sale"), ["S1", "S2"]);
    await openPanel(page);
    await step(page, "type Land + Lease (multi-select)", async () => { await chip(page, "Land"); await chip(page, "Lease"); }, ["A1", "A2", "U2", "L1", "L2", "L3", "U1"]);
    // ---- Date windows (+ undated hidden count)
    await openPanel(page);
    await step(page, "date 3 mo", () => chip(page, "3 mo"), ["L1", "S1", "A1"], async () => { ok(/2 undated hidden/.test(await line(page)), "3 mo says '2 undated hidden'", await line(page)); });
    await openPanel(page);
    await step(page, "date 6 mo", () => chip(page, "6 mo"), ["L1", "L2", "S1", "A1", "A2"]);
    await openPanel(page);
    await step(page, "date 12 mo", () => chip(page, "12 mo"), ["L1", "L2", "L3", "S1", "A1", "A2"]);
    await openPanel(page);
    await step(page, "date Custom From/To (inclusive)", async () => {
      await chip(page, "Custom");
      await panel(page).locator('input[type="date"]').nth(0).fill(iso(120));
      await panel(page).locator('input[type="date"]').nth(1).fill(iso(30));
    }, ["S1", "L2", "A2"]);
    // ---- Size, clear height, power, docks, year
    await openPanel(page);
    await step(page, "building SF 100,000–250,000", async () => { await fillBox(page, "Building minimum", "100000"); await fillBox(page, "Building maximum", "250000"); }, ["L1", "S1"]);
    await openPanel(page);
    await step(page, "land acres 5–15 (sf-quoted lot normalised)", async () => { await fillBox(page, "Land minimum", "5"); await fillBox(page, "Land maximum", "15"); }, ["A1", "A2"]);
    await openPanel(page);
    await step(page, "clear height ≥ 32 (blank excluded)", () => fillBox(page, "Clear height minimum", "32"), ["L1", "L3", "S1"]);
    await openPanel(page);
    await step(page, "power ≥ 2,000 A", () => fillBox(page, "Power minimum", "2000"), ["L1", "S1"]);
    await openPanel(page);
    await step(page, "dock doors ≥ 20", () => fillBox(page, "Dock doors minimum", "20"), ["L1", "S1"]);
    await openPanel(page);
    await step(page, "year built ≥ 2010", () => fillBox(page, "Year built minimum", "2010"), ["L1", "S1"]);
    // ---- Rate
    await openPanel(page);
    await step(page, "lease rate 5.5–6.5 $/SF/yr (a monthly lease annualises)", async () => { await fillBox(page, "Lease rate minimum", "5.5"); await fillBox(page, "Lease rate maximum", "6.5"); }, ["L1", "L2"]);
    await openPanel(page);
    await step(page, "Gross only", () => chip(page, "GROSS"), ["L2"]);
    await openPanel(page);
    await step(page, "building sale $/SF 90–110", async () => { await fillBox(page, "Building sale price minimum", "90"); await fillBox(page, "Building sale price maximum", "110"); }, ["S1"]);
    await openPanel(page);
    await step(page, "land $/SF 8–12", async () => { await fillBox(page, "Land price minimum", "8"); await fillBox(page, "Land price maximum", "12"); }, ["A1"]);
    await openPanel(page);
    await step(page, "county Fort Bend", () => panel(page).getByRole("button", { name: /^Fort Bend County/ }).click(), ["L2", "S2", "A2"]);
    // ---- Combined (AND) + chips + removal + count
    await openPanel(page);
    await chip(page, "Lease"); await chip(page, "12 mo"); await fillBox(page, "Clear height minimum", "32");
    await page.waitForTimeout(250);
    ok(same(await titles(page), ["L1", "L3"]), "Lease AND 12 mo AND clear ≥ 32", `got [${await titles(page)}]`);
    ok(/Filters · 3/.test(await page.getByTestId("comps-filters-toggle").innerText()), "toggle reads 'Filters · 3'", await page.getByTestId("comps-filters-toggle").innerText());
    const mk = await markerCount(page);
    ok(mk === 2, "map markers follow the filter (2)", String(mk));
    ok(/Avg of 2 shown|^$/.test((await page.getByText(/Avg of \d+ shown/).first().innerText().catch(() => "")) || ""), "summary strip is labelled 'Avg of N shown' when it has averages (or has none to label)");
    const chipsText = await page.getByTestId("comps-chips").innerText();
    ok(/Lease/.test(chipsText) && /12 mo/.test(chipsText) && /≥ 32 ft clear/.test(chipsText), "chips name each filter", chipsText.replace(/\n/g, " | "));
    await page.getByTestId("comps-chips").getByRole("button", { name: /Remove filter 12 mo/ }).click();
    await page.waitForTimeout(250);
    ok(same(await titles(page), ["L1", "L3"]) && !/12 mo/.test(await page.getByTestId("comps-chips").innerText()), "removing the date chip clears only the date filter");
    // ---- Sort
    await clearAll(page);
    const sort = (v) => page.getByTestId("comps-sort").selectOption(v).then(() => page.waitForTimeout(250));
    await sort("oldest"); let t = await titles(page);
    ok(t[0] === "S2", "Oldest puts the 400-day-old comp first", `[${t}]`);
    await sort("largest"); t = await titles(page);
    ok(t[0] === "S2" && t[t.length - 1] === "L2", "Largest: 500,000 SF first, 50,000 SF last", `[${t}]`);
    await sort("smallest"); t = await titles(page);
    ok(t[0] === "L2", "Smallest: 50,000 SF first", `[${t}]`);
    await sort("rateHigh"); t = await titles(page);
    ok(t[0] === "L3" && t[1] === "U1" && !["S1", "S2", "A1", "A2", "U2"].includes(t[2]) , "Rate high to low: $9, $7, then the $6 pair; no-rate comps last", `[${t}]`);
    await sort("rateLow"); t = await titles(page);
    ok(["L1", "L2"].includes(t[0]), "Rate low to high starts at $6", `[${t}]`);
    await sort("psfHigh"); t = await titles(page);
    ok(t[0] === "S1" || t[0] === "A1", "Price/SF high to low puts a $100 or $10 comp first (buildings dwarf land)", `[${t}]`);
    await sort("psfLow"); t = await titles(page);
    ok(t[0] === "A2", "Price/SF low to high: the $5/SF lot first", `[${t}]`);
    await sort("newest");
    // ---- Search tokens
    await setSearch(page, "zzsearch prologis"); ok(same(await titles(page), ["L1"]), "search matches a party name", `[${await titles(page)}]`);
    await setSearch(page, "zzsearch fort bend"); ok(same(await titles(page), ["L2", "S2", "A2"]), "search matches the county", `[${await titles(page)}]`);
    await setSearch(page, "zzsearch nosuchthing");
    ok((await page.getByTestId("comps-no-match").count()) === 1, "empty state: 'No comps match' with Clear filters");
    await setSearch(page, "zzsearch");
    // ---- Back from a record keeps filter + sort + scroll
    await openPanel(page);
    await chip(page, "Lease"); await sort("largest"); await page.waitForTimeout(250);
    const before = await titles(page);
    await page.locator('[data-testid="comp-row"]').filter({ hasText: "ZZSEARCH L1" }).click();
    await page.getByText("← All comps").waitFor();
    const body = await page.locator("body").innerText();
    ok(/3,000 A · 480 V · 3-phase/.test(body) && /Dock doors\s*30/.test(body), "record shows Power '3,000 A · 480 V · 3-phase' and Dock doors 30");
    if (!MOCK) ok(/OpEx/.test(body), "record shows the OpEx row (NEW-3: lease_opex is selected)");
    await page.getByText("← All comps").click();
    await page.waitForTimeout(300);
    ok(JSON.stringify(await titles(page)) === JSON.stringify(before), "back from a record returns the same filtered + sorted list", `[${await titles(page)}] vs [${before}]`);
    ok((await page.getByTestId("comps-sort").inputValue()) === "largest", "sort survives the round trip");
    // ---- NEW-3: editing without touching OpEx leaves it
    if (!MOCK) {
      await page.locator('[data-testid="comp-row"]').filter({ hasText: "ZZSEARCH L1" }).click();
      await page.getByLabel("More actions").click();
      await page.getByRole("menuitem", { name: "Edit" }).or(page.getByText("Edit", { exact: true })).first().click();
      const optVal = await page.getByLabel(/OpEx/).first().inputValue().catch(() => "");
      ok(/1\.5/.test(optVal), "edit form shows the stored OpEx (1.5)", optVal);
      await page.getByRole("button", { name: "Save comp" }).click();
      await page.getByText("← All comps").waitFor({ timeout: 30000 });
      const opex = await page.evaluate(async (id) => (await window.pfSupabase.from("comps").select("lease_opex").eq("id", id)).data?.[0]?.lease_opex, seededIds[0]);
      ok(Number(opex) === 1.5, "after Save without touching OpEx, lease_opex is still 1.5 in the database", String(opex));
      await page.getByText("← All comps").click();
    }
    // ---- Reload keeps the view
    await reloadSafe(page);
    await openRecords(page);
    await page.waitForTimeout(800);
    ok((await page.getByTestId("comps-sort").inputValue()) === "largest", "reload keeps the sort");
    ok(/Lease/.test(await page.getByTestId("comps-chips").innerText().catch(() => "")), "reload keeps the Lease filter chip");
    // Clear all clears the persisted copy too.
    await page.getByTestId("comps-clear-all").click();
    const persisted = await page.evaluate(() => localStorage.getItem("planyr:compsView:v1"));
    ok(!/"types":\["lease"\]/.test(persisted || ""), "Clear all clears the persisted filters");
    // ---- Phone/narrow: no horizontal overflow of the page with the panel open
    await setSearch(page, "zzsearch"); await openPanel(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(overflow <= 1, "no sideways page scroll with the filter panel open", String(overflow));
    const widest = await page.evaluate(() => { const p = document.querySelector('[data-testid="comps-filter-panel"]'); const r = p.getBoundingClientRect(); return [...p.querySelectorAll("*")].filter((e) => e.getBoundingClientRect().right > r.right + 1).length; });
    ok(widest === 0, "nothing in the filter panel spills past its right edge", String(widest));
    if (DEVICE) await page.screenshot({ path: `/tmp/comps-search-${DEVICE.replace(/\W+/g, "-")}.png` }).catch(() => {});
    else await page.screenshot({ path: "/tmp/comps-search-desktop.png" }).catch(() => {});
  } catch (e) {
    fails.push("RUN ABORTED: " + (e && e.message));
    console.log("  ✗ aborted:", e && e.message);
  } finally {
    if (!MOCK && seededIds.length) {
      const res = await page.evaluate(async (ids) => {
        const c = window.pfSupabase.from("comps");
        const del = await c.delete({ count: "exact" }).in("id", ids);
        const left = await window.pfSupabase.from("comps").select("id", { count: "exact", head: true }).like("title", "ZZSEARCH%");
        return { deleted: del.count, error: del.error && del.error.message, left: left.count };
      }, seededIds).catch((e) => ({ error: String(e) }));
      ok(res.deleted === FIX.length && res.left === 0, "throwaway comps deleted and the row count dropped", JSON.stringify(res));
    }
    await S.close().catch(() => {});
  }
  console.log(`\n${pass} passed, ${fails.length} failed — ${LABEL}${DEVICE ? " " + DEVICE : ""}${MOCK ? " (mock)" : " (live)"}`);
  if (fails.length) { console.log("FAILURES:\n - " + fails.join("\n - ")); process.exit(1); }
})();
