#!/usr/bin/env node
/* diagnose-hide-ink — hide EVERY content group on the owner's own plan and ask what is still painted.
 *
 * The report the owner asked for, verbatim: "Check EVERY group in that list, not just Roads — report
 * which ones honour the toggle and which do not." Two instruments per group, deliberately, because
 * the first one is the one that lied:
 *
 *   FEATURE census — distinct `data-feature` / `data-el-id` keys (what verify-content-visibility uses)
 *   INK census     — every painted node in the drawing, attributed to the feature it draws for
 *                    (ui-audit/lib/inkCensus.mjs), which is the only one that can see a dissolved
 *                    region drawn on behalf of several features at once.
 *
 *   node ui-audit/diagnose-hide-ink.mjs [--url http://localhost:4319/] [--shots]
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { readFixture, buildFixtureState } from "./lib/fixtureSeeding.mjs";
import { inkCensus, leakedInk } from "./lib/inkCensus.mjs";

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg("--url", "http://localhost:4319/");
const SHOTS = process.argv.includes("--shots");
const OUT = "ui-audit/out/hide-ink";
const CACHE = "ui-audit/.cache/hide-ink";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome";
const SITE_ID = "hisite1";

/* el-tier: this census is the CONTROL, not the subject — it is the [data-feature]/[data-el-id]
 * registration reading that certified Roads green while four grey ribbons were on the drawing, and
 * it is kept here deliberately so the ink census beside it can be compared against what the existing
 * instrument saw. Both are printed on every row. */
const featureCensus = (page) => page.evaluate(() => {
  const seen = new Set();
  for (const n of document.querySelectorAll("[data-feature]")) {
    const k = n.getAttribute("data-feature");
    if (k) seen.add(k);
  }
  // el-tier: the element tier IS the subject of a per-TYPE row, and this reading is the control.
  for (const n of document.querySelectorAll("[data-el-id]")) seen.add(`el:${n.getAttribute("data-el-id")}`);
  return [...seen];
});

const openViewMenu = async (page) => {
  const btn = page.locator('[data-testid="view-menu-btn"]');
  if (await btn.getAttribute("aria-expanded") !== "true") { await btn.click(); await pacedWait(page, 350); }
};
const toggleRow = async (page, testid) => {
  await openViewMenu(page);
  await page.locator(`[data-testid="${testid}"]`).click();
  await pacedWait(page, 700);
};

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
try {
  mkdirSync(CACHE, { recursive: true });
  if (SHOTS) mkdirSync(OUT, { recursive: true });

  const fixture = readFixture("woods");
  const built = await buildFixtureState(browser, { base: BASE, fixture, siteId: SITE_ID, cacheDir: CACHE });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, ignoreHTTPSErrors: true, storageState: built.state });
  await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
  await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await assertMeasurable(page, "diagnose-hide-ink");
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 30000 });
  await pacedWait(page, 3000);
  if (errs.length) { console.log("⛔ render crashed:", errs[0].slice(0, 300)); process.exit(1); }

  console.log(`\n${fixture.site} / ${fixture.name} — ${(fixture.els || []).length} elements, ` +
    `${(fixture.parcels || []).length} parcels, ${(fixture.measures || []).length} measures\n`);

  const els = fixture.els || [];
  const idsOfType = (t) => els.filter((e) => e.type === t && !e.dogEar).map((e) => `el:${e.id}`);
  /* A bump-out belongs to its building and hides WITH it, so the building row's expected set is
   * every building element including its dog-ears. */
  const allIdsOfType = (t) => els.filter((e) => e.type === t).map((e) => `el:${e.id}`);

  const GROUPS = [];
  for (const t of ["building", "parking", "trailer", "pond", "road", "paving", "sidewalk", "landscape"]) {
    if (!idsOfType(t).length) continue;
    GROUPS.push({ testid: `view-row-el:${t}`, label: t, keys: allIdsOfType(t) });
  }
  for (const [key, label, coll, kind] of [["parcels", "parcels", "parcels", "parcel"],
    ["markups", "markups", "markups", "markup"], ["measures", "measures", "measures", "measure"],
    ["callouts", "callouts", "callouts", "callout"]]) {
    const list = fixture[coll] || [];
    if (!list.length) continue;
    /* ⛔ A MEASUREMENT'S `data-feature` IS INDEX-KEYED (`measure:<i>`), not id-keyed like every other
     * family — SitePlanner stamps it from the array position. Keying this row on ids matches NOTHING,
     * so the row would score a clean ✓ with zero expected keys: a vacuous pass, which is the exact
     * shape of failure this whole file exists to catch. Caught by the baseline assertion below. */
    GROUPS.push({ testid: `view-row-${key}`, label,
      keys: kind === "measure" ? list.map((_, i) => `measure:${i}`) : list.map((x) => `${kind}:${x.id}`) });
  }

  const base = { feat: await featureCensus(page), ink: await inkCensus(page) };
  /* ⛔ EVERY ROW MUST HAVE INK TO LOSE BEFORE IT IS ASKED TO LOSE IT. A group whose expected keys
   * match nothing scores ✓ for free — the "clean number from an instrument that could not have seen
   * the effect" this repo has been burned by three times. */
  for (const g of GROUPS) {
    const drawn = g.keys.filter((k) => (base.ink.byOwner || {})[k]);
    if (!drawn.length) { console.log(`⛔ SETUP · "${g.label}" has no attributable ink at baseline — its result would be vacuous.`); process.exit(2); }
  }
  console.log(`baseline · ${base.feat.length} feature keys · ${base.ink.painted} painted nodes`);
  if (Object.keys(base.ink.unowned).length) {
    console.log("  unattributed ink (baseline, informational):");
    for (const [s, n] of Object.entries(base.ink.unowned).sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`    ${n}× ${s}`);
  }
  console.log("");

  const rows = [];
  for (const g of GROUPS) {
    await toggleRow(page, g.testid);
    const feat = new Set(await featureCensus(page));
    const ink = await inkCensus(page);
    const featLeft = g.keys.filter((k) => feat.has(k));
    const inkLeft = leakedInk(ink, g.keys);
    /* ⛔ UNATTRIBUTED INK IS REPORTED AS A DELTA, not as a total. Labels and dimension chips are
     * drawn in their own passes and some carry no feature key, so a leaked LABEL for a hidden group
     * shows up here and NOWHERE else — the owner asked specifically whether hiding a group hides its
     * labels and dimensions. A count that only ever went down is the honest signal; anything that
     * survives shows as a non-negative delta against the baseline for that selector. */
    const unownedDelta = {};
    for (const [s, n] of Object.entries(ink.unowned)) {
      const was = base.ink.unowned[s] || 0;
      if (n !== was) unownedDelta[s] = `${was}→${n}`;
    }
    for (const [s, was] of Object.entries(base.ink.unowned)) if (!(s in ink.unowned)) unownedDelta[s] = `${was}→0`;
    rows.push({ label: g.label, n: g.keys.length, featLeft: featLeft.length, inkLeft, unownedDelta, painted: ink.painted });
    const verdict = inkLeft.length ? "❌ STILL PAINTED" : featLeft.length ? "❌ still registered" : "✓ hidden";
    console.log(`${g.label.padEnd(10)} ${String(g.keys.length).padStart(3)} features · feature-census leftover ${String(featLeft.length).padStart(2)} · ` +
      `INK leftover ${String(inkLeft.reduce((a, b) => a + b.nodes, 0)).padStart(3)} nodes  ${verdict}`);
    if (inkLeft.length) console.log(`             ${inkLeft.slice(0, 5).map((x) => `${x.key}(${x.nodes})`).join(" ")}`);
    if (Object.keys(unownedDelta).length) {
      console.log(`             unattributed ink moved: ${Object.entries(unownedDelta).map(([s, d]) => `${s} ${d}`).join(" · ")}`);
    }
    if (SHOTS) await page.screenshot({ path: `${OUT}/hide-${g.label}.png`, clip: { x: 0, y: 0, width: 1600, height: 900 } });
    await toggleRow(page, g.testid);
  }

  const bad = rows.filter((r) => r.inkLeft.length || r.featLeft);
  console.log(`\n${rows.length - bad.length}/${rows.length} groups honour the toggle.`);
  if (bad.length) console.log(`⛔ ${bad.map((b) => b.label).join(", ")} still put ink on the drawing when hidden.`);
  process.exitCode = bad.length ? 1 : 0;
} finally {
  await browser.close();
}
