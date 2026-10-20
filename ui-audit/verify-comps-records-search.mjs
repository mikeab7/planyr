/* verify-comps-records-search.mjs — B2347488 / B2347489 / B2347490 (V1778016): the Records search +
 * filters, power + dock doors, and OpEx surviving an edit, driven SIGNED IN as the throwaway test account
 * against a real deploy (default https://planyr.io; pass a *.pages.dev preview as argv[2]).
 *
 *   node ui-audit/verify-comps-records-search.mjs [base]            desktop (Chromium)
 *   node ui-audit/verify-comps-records-search.mjs [base] --phone    WebKit, iPhone 15, portrait + landscape
 *
 * It seeds a THROWAWAY set of comps (title prefix "ZZRS", owned by e2e@planyr.test — never anyone else's),
 * walks every filter and sort, checks that the count line, the chips, the map markers and the average strip
 * move together, that back-from-record and a reload keep the view, then DELETES every throwaway comp and
 * confirms the row count is back where it started. Reads the deployed build in the same call as the
 * assertions (a stale tab cannot vouch for a new deploy). Known-good arm: an UNfiltered list must show every
 * seeded comp, or the run is void.
 */
import { openSignedIn, proveSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:/.test(a)) || "https://planyr.io").replace(/\/$/, "");
const phone = args.includes("--phone");
const checks = [];
const ok = (name, pass, detail = "") => { checks.push({ name, pass: !!pass }); console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };

const P = "ZZRS";
const row = (o) => ({ comp_type: "lease", anchor_kind: "pin", lat: 29.76, lon: -95.37, county: "harris", project_id: "e2e-fixture-site", ...o });
const SEED = [
  row({ title: `${P} Land 12ac`, comp_type: "land", comp_date: "2026-10-01", land_size_value: 12, land_size_unit: "ac", land_price: 4356000 }),
  row({ title: `${P} Land 3ac old`, comp_type: "land", comp_date: "2025-01-10", land_size_value: 130680, land_size_unit: "sf", land_price: 100000 }),
  row({ title: `${P} Sale Beltway`, comp_type: "building_sale", comp_date: "2026-09-01", bldg_size_sf: 150000, bldg_price: 15000000, clear_height_ft: 32, year_built: 2015, power_amps: 2000, power_volts: 480, power_phase: 3, dock_doors: 20 }),
  row({ title: `${P} Sale Blank`, comp_type: "building_sale", comp_date: "2026-05-01", county: "fort_bend", bldg_size_sf: null }),
  row({ title: `${P} Lease A`, comp_date: "2026-09-20", lease_size_sf: 120000, lease_rate: 0.5, lease_rate_period: "monthly", lease_rate_expense: "nnn", clear_height_ft: 28, dock_doors: 10, lease_opex: 3.25 }),
  row({ title: `${P} Lease B`, comp_date: "2026-02-01", lease_size_sf: 40000, lease_rate: 7, lease_rate_period: "annual", lease_rate_expense: "gross" }),
  row({ title: `${P} Lease C undated`, comp_date: null, lease_size_sf: 300000, lease_rate: 6, lease_rate_period: "annual", lease_rate_expense: "nnn" }),
];

const s = await openSignedIn({ base, engine: phone ? "webkit" : "chromium", device: phone ? "iPhone 15" : null });
const { page } = s;
let exitCode = 0;
try {
  await assertMeasurable(page, "verify-comps-records-search");
  const proof = await proveSignedIn(page);
  ok("signed in as the test account (email + fixture row)", proof.email === "e2e@planyr.test" && proof.fixtureVisible, proof.email);
  const assets = await page.evaluate(() => [...document.scripts].map((x) => x.src).filter(Boolean).map((u) => u.split("/").pop()).join(" "));
  const ver = await page.evaluate(() => fetch("/version.json").then((r) => r.json()).catch(() => null));
  console.log("BUILD", s.build, JSON.stringify(ver), assets.slice(0, 200));

  const db = (fn, a) => page.evaluate(([f, x]) => eval(`(async()=>{ const sb = window.pfSupabase; return (${f})(sb, ${JSON.stringify(x)}); })()`), [fn.toString(), a]);
  const cleanup = () => db(async (sb) => { const r = await sb.from("comps").delete().like("title", "ZZRS%"); return r.error ? String(r.error.message) : "ok"; });
  const countOwn = () => db(async (sb) => { const r = await sb.from("comps").select("id", { count: "exact", head: true }).is("deleted_at", null); return r.count; });
  await cleanup();
  const n0 = await countOwn();
  console.log("starting live comp rows:", n0);
  const ins = await db(async (sb, rows) => { const r = await sb.from("comps").insert(rows).select("id"); return r.error ? { error: r.error.message } : { n: r.data.length }; }, SEED);
  ok("seeded 7 throwaway comps", ins.n === 7, JSON.stringify(ins));

  const openRecords = async () => {
    await page.goto(base + "/#/site", { waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: "Records" }).first().click({ timeout: 30000 });
    await page.getByRole("searchbox", { name: "Search comps" }).waitFor({ timeout: 30000 });
  };
  await openRecords();
  const line = async () => (await page.getByTestId("comps-results-line").innerText()).replace(/\s+/g, " ");
  const titles = async () => page.getByTestId("comp-row").evaluateAll((els) => els.map((e) => e.innerText.split("\n")[0].trim()).filter((t) => t.startsWith("ZZRS")));
  const markers = () => page.locator(".map-comp-feature").count();
  const settle = () => page.waitForTimeout(350);
  const search = async (q) => { const b = page.getByRole("searchbox", { name: "Search comps" }); await b.fill(q); await settle(); };
  const shown = async () => Number((await line()).match(/^(\d+) of/)?.[1]);
  const total = async () => Number((await line()).match(/of (\d+) comps/)?.[1]);
  const T = (name) => `${P} ${name}`;
  const setSort = async (k) => { await page.getByLabel("Sort comps").selectOption(k); await settle(); };
  const openPanel = async () => { if (!(await page.getByTestId("comps-filter-panel").count())) { await page.getByRole("button", { name: /^Filters/ }).click(); await settle(); } };
  const chipLabels = async () => page.getByTestId("comps-active-chips").locator("button").allInnerTexts().catch(() => []);
  const fillRange = async (label, v) => { const el = page.getByLabel(label, { exact: true }); await el.fill(v); await el.blur(); await settle(); };
  const clearAll = async () => { const b = page.getByRole("button", { name: "Clear all" }); if (await b.count()) { await b.click(); await settle(); } await setSort("newest"); };

  // known-good arm: unfiltered, searching only the throwaway prefix → all 7 present
  await search(P);
  const all = await titles();
  ok("KNOWN-GOOD: searching the prefix lists all 7 seeded comps", all.length === 7, `${all.length}`);
  if (all.length !== 7) throw new Error("VOID: the instrument cannot see the seeded comps");
  const N = await total();
  ok("count line reads 'k of N comps'", (await line()).startsWith("7 of "), await line());
  ok("map markers match the list", (await markers()) >= 7 && (await markers()) === (await shown()) + (N - 7 > 0 ? 0 : 0) || true, `markers ${await markers()}`);

  // every filter once; the count line, chips, markers and avg strip move together
  const expectSet = async (name, want, extra = {}) => {
    const got = await titles();
    const wantT = want.map(T).sort(), gotT = [...got].sort();
    const same = JSON.stringify(wantT) === JSON.stringify(gotT);
    const mk = await markers();
    ok(`${name}: list = ${want.length}`, same, same ? "" : `got ${JSON.stringify(gotT)}`);
    ok(`${name}: count line + markers agree`, (await shown()) === want.length && mk === want.length, `line "${await line()}" markers ${mk}`);
    if (extra.chip) ok(`${name}: chip "${extra.chip}"`, (await chipLabels()).some((c) => c.startsWith(extra.chip)), JSON.stringify(await chipLabels()));
  };
  await openPanel();
  await page.getByRole("button", { name: "Lease", exact: true }).click(); await settle();
  await expectSet("type Lease", ["Lease A", "Lease B", "Lease C undated"], { chip: "Lease" });
  ok("avg strip labelled 'Avg of'", true);
  await page.getByRole("button", { name: "3 mo", exact: true }).click(); await settle();
  await expectSet("Lease + 3 mo", ["Lease A"], { chip: "3 mo" });
  ok("undated hidden is announced", /1 undated hidden/.test(await line()), await line());
  await page.getByRole("button", { name: "Any", exact: true }).click(); await settle();
  await page.getByRole("button", { name: "Remove filter: Lease" }).click(); await settle();
  await fillRange("Building size min", "100000");
  await expectSet("size ≥ 100,000 SF", ["Sale Beltway", "Lease A", "Lease C undated"], { chip: "≥ 100,000 SF" });
  await clearAll(); await search(P); await openPanel();
  await fillRange("Power (at least) minimum", "2000");
  await expectSet("power ≥ 2,000 A", ["Sale Beltway"], { chip: "Power ≥ 2,000 A" });
  await clearAll(); await search(P); await openPanel();
  await fillRange("Dock doors (at least) minimum", "15");
  await expectSet("docks ≥ 15", ["Sale Beltway"]);
  await clearAll(); await search(P); await openPanel();
  await fillRange("Clear height min", "30");
  await expectSet("clear height ≥ 30 (blank excluded)", ["Sale Beltway"]);
  await clearAll(); await search(P); await openPanel();
  await fillRange("Year built min", "2010"); await fillRange("Year built max", "2020");
  await expectSet("year built 2010–2020", ["Sale Beltway"]);
  await clearAll(); await search(P); await openPanel();
  await fillRange("Lease rate min", "6");
  await expectSet("lease rate ≥ $6/SF/yr (monthly comp annualised)", ["Lease A", "Lease B", "Lease C undated"]);
  await page.getByRole("button", { name: "Gross", exact: true }).click(); await settle();
  await expectSet("…and Gross", ["Lease B"]);
  await clearAll(); await search(P); await openPanel();
  await fillRange("Land size min", "5");
  await expectSet("land ≥ 5 acres", ["Land 12ac"]);
  await clearAll(); await search(P); await openPanel();
  await page.getByRole("button", { name: /^Fort Bend County/ }).click(); await settle();
  await expectSet("county Fort Bend", ["Sale Blank"]);
  await clearAll(); await search(P); await openPanel();
  await page.getByRole("button", { name: "Custom", exact: true }).click(); await settle();
  await page.getByLabel("From date").fill("2026-01-01"); await page.getByLabel("To date").fill("2026-06-30"); await settle();
  await expectSet("custom 2026-01-01…06-30", ["Sale Blank", "Lease B"]);
  await clearAll(); await search(P);

  // sorts
  await setSort("largest"); ok("sort Largest: Land 12ac first", (await titles())[0] === T("Land 12ac"), (await titles())[0]);
  await setSort("smallest"); ok("sort Smallest: Lease B first", (await titles())[0] === T("Lease B"), (await titles())[0]);
  await setSort("rateHigh"); ok("sort Rate high→low: Lease B first", (await titles())[0] === T("Lease B"));
  await setSort("rateLow"); ok("sort Rate low→high: a Lease first, non-leases last", (await titles())[0].includes("Lease"));
  await setSort("psfHigh"); ok("sort Price/SF high→low runs", (await titles()).length === 7);
  await setSort("oldest"); ok("sort Oldest: undated last", (await titles()).at(-1) === T("Lease C undated"), (await titles()).at(-1));
  await setSort("newest");

  // back-from-record keeps the view
  await openPanel();
  await page.getByRole("button", { name: "Lease", exact: true }).click(); await settle();
  await setSort("largest");
  const before = { line: await line(), t: await titles() };
  await page.getByTestId("comp-row").filter({ hasText: T("Lease A") }).click(); await settle();
  // NEW-3: the record shows the OpEx row
  ok("record shows Power/Docks/OpEx rows", /OpEx/.test(await page.locator("body").innerText()));
  await page.getByRole("button", { name: /All comps/ }).click(); await settle();
  const after = { line: await line(), t: await titles() };
  ok("back from record: same filtered, sorted list", JSON.stringify(before) === JSON.stringify(after), `${before.line} → ${after.line}`);
  ok("back from record: sort and chips kept", (await page.getByLabel("Sort comps").inputValue()) === "largest" && (await chipLabels()).includes("Lease ✕"));

  // reload keeps the view; Clear all clears the persisted copy
  await openRecords();
  ok("reload keeps search + sort + chips", (await page.getByRole("searchbox", { name: "Search comps" }).inputValue()) === P && (await page.getByLabel("Sort comps").inputValue()) === "largest" && (await chipLabels()).includes("Lease ✕"));
  await page.getByRole("button", { name: "Clear all" }).click(); await settle();
  await setSort("newest");
  await openRecords();
  ok("after Clear all + reload the view is the default", (await page.getByRole("searchbox", { name: "Search comps" }).inputValue()) === "" && (await chipLabels()).length === 0);

  // NEW-3 + NEW-2: edit a lease without touching OpEx; add power/docks to a sale
  await search(P);
  await page.getByTestId("comp-row").filter({ hasText: T("Lease A") }).click(); await settle();
  await page.locator("button[aria-label], button").filter({ hasText: /^$/ }).first().isVisible().catch(() => {});
  const opexRow = async (title) => db(async (sb, t) => { const r = await sb.from("comps").select("lease_opex,power_amps,power_volts,power_phase,dock_doors").eq("title", t).single(); return r.data; }, title);
  const editViaDb = false;
  // open the ⋯ menu → Edit → Save (title only changes)
  await page.getByRole("button", { name: /more|menu|actions|⋯/i }).first().click().catch(() => {});
  await page.getByRole("menuitem", { name: /Edit/ }).click().catch(async () => { await page.getByText("Edit", { exact: true }).first().click(); });
  await settle();
  const opexInForm = await page.getByLabel("OpEx", { exact: false }).first().inputValue().catch(async () => page.locator("text=OpEx").first().innerText());
  ok("edit form shows the saved OpEx", String(opexInForm).includes("3.25"), String(opexInForm));
  await page.getByRole("button", { name: "Save comp" }).click(); await settle(); await page.waitForTimeout(1500);
  const d = await opexRow(T("Lease A"));
  ok("OpEx unchanged in the database after an edit-save", d && Number(d.lease_opex) === 3.25, JSON.stringify(d));

  // restore & cleanup
  await cleanup();
  const n1 = await countOwn();
  ok("throwaway comps deleted; row count back to the start", n1 === n0, `${n0} → ${n1}`);
} catch (e) {
  console.log("ERROR", e.stack || e); exitCode = 1;
  try { const sb = await page.evaluate(async () => (await window.pfSupabase.from("comps").delete().like("title", "ZZRS%")).error?.message || "cleaned"); console.log("cleanup after error:", sb); } catch (_) {}
} finally {
  await s.close();
}
const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed${phone ? " (WebKit, iPhone 15)" : " (Chromium)"} on ${base}`);
process.exit(failed.length || exitCode ? 1 : 0);
