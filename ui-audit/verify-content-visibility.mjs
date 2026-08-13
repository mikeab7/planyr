#!/usr/bin/env node
/* NEW-1 — HIDE MEANS HIDE: the View menu's content groups, on the owner's own plan.
 *
 * ⛔ THE CLAIM UNDER TEST IS NOT "the checkbox works". It is the promise the owner extracted twice,
 * unprompted — "when I say remove, I don't mean remove, I just mean hide temporarily" — and that
 * promise has three parts, each of which fails differently and silently:
 *
 *   1. The content LEAVES THE CANVAS.                  (a feature census, per family)
 *   2. NOT ONE NUMBER MOVES.                           (the Yield panel's text, byte-identical)
 *   3. NOTHING IS WRITTEN about the elements.          (the saved record's collections, unchanged)
 *
 * Part 2 is the one worth building an instrument for. A filter applied one seam too early — at the
 * model instead of at the draw set — produces a canvas that looks EXACTLY RIGHT and a coverage
 * number that has quietly dropped by eleven buildings. There is no visual difference between the
 * correct implementation and that one; only the panel text can tell them apart, so it is compared
 * in full rather than field by field. Identical is the bar, not "close".
 *
 * ⛔ COUNT-EVERY-KIND applies here by construction: this harness hides FIVE families and a plan's
 * contents are exactly those five, so a census that reads `[data-el-id]` would report four of them
 * as "nothing happened". It counts DISTINCT `data-feature` keys via the shared census helper.
 *
 * The fixture is the owner's real Silvestri plan — the only one carrying all five families at once
 * (98 elements over 6 types, 3 parcels, 6 markups, 2 measurements, 16 callouts). A second short arm
 * runs Bain for the POND, the type he named first and which Silvestri does not have.
 *
 *   node ui-audit/verify-content-visibility.mjs [--url http://localhost:4319/] [--shots]
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { readFixture, buildFixtureState } from "./lib/fixtureSeeding.mjs";
import { inkCensus, leakedInk } from "./lib/inkCensus.mjs";

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg("--url", "http://localhost:4319/");
const SHOTS = process.argv.includes("--shots");
const OUT = "ui-audit/out/content-visibility";
const CACHE = "ui-audit/.cache/content-visibility";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome";
const SITE_ID = "cvsite1";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

/* Distinct feature keys by kind, read off the real render. `data-feature` is `<kind>:<id>` and
 * chrome carries its owner's key too, so DISTINCT KEYS is the only stable count (COUNT-EVERY-KIND). */
const census = (page) => page.evaluate(() => {
  const seen = new Set();
  const by = {};
  for (const n of document.querySelectorAll("[data-feature]")) {
    const k = n.getAttribute("data-feature");
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const kind = k.split(":")[0];
    by[kind] = (by[kind] || 0) + 1;
  }
  /* Element IDS, so a per-type row can be checked on its own. The type is resolved in Node from
   * the FIXTURE's own records rather than from a DOM attribute: nothing in the render carries the
   * type, and adding an attribute that exists only to be tested is a worse trade than reading data
   * we already have.
   *
   * el-tier: a PER-TYPE element row is genuinely the subject — "did hiding Buildings remove the
   * buildings" is a question about the element tier — and the five-family [data-feature] census
   * directly above answers the whole-plan question beside it. */
  const elIds = [...new Set([...document.querySelectorAll("[data-el-id]")].map((n) => n.getAttribute("data-el-id")))];
  return { by, total: seen.size, elIds };
});

/** How many of `ids` are elements of `type`, per the fixture. */
const drawnOfType = (censusResult, typeById, type) =>
  censusResult.elIds.filter((id) => typeById.get(id) === type).length;

/* The Yield panel's rendered text — every number the app reports about this plan, in one string.
 *
 * ⛔ THE SELECTOR IS THE WHOLE INSTRUMENT, and the first version of it was wrong in the direction
 * that produces FALSE FAILURES rather than false passes (which is the lucky direction). It scoped
 * to `[data-surface="planner"]`'s nearest `div` ancestor, and that resolved to most of the page —
 * so the "numbers" being compared included the canvas's own element labels ("BAUER HOCKLEY",
 * "50′ Trailer Parking"), the parcel acreage badges, and the View menu's own chrome. Hiding
 * anything changes all three BY DESIGN, so six checks went red on a working implementation. Read
 * ONLY the metrics region. Returns null when it is not on screen, so "the panel was not open" can
 * never masquerade as "the numbers did not move" — two readings of null compare equal. */
const panelText = (page) => page.evaluate(() => {
  const root = document.querySelector('[data-testid="yield-metrics"]');
  if (!root) return null;
  const t = (root.innerText || "").replace(/\s+/g, " ").trim();
  return t || null;
});

/* What is actually PERSISTED for this plan — the collections and the view state, read apart. */
const saved = (page) => page.evaluate((siteId) => {
  const all = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const rec = all[siteId] || {};
  const collections = {
    els: rec.els || [], parcels: rec.parcels || [], markups: rec.markups || [],
    measures: rec.measures || [], callouts: rec.callouts || [],
  };
  return { collections: JSON.stringify(collections), hidden: (rec.settings || {}).hidden || null };
}, SITE_ID);

async function openViewMenu(page) {
  const btn = page.locator('[data-testid="view-menu-btn"]');
  const open = await btn.getAttribute("aria-expanded");
  if (open !== "true") { await btn.click(); await pacedWait(page, 350); }
}

async function toggleRow(page, testid) {
  await openViewMenu(page);
  const box = page.locator(`[data-testid="${testid}"]`);
  await box.click();
  await pacedWait(page, 500);
}

async function boot(browser, fixtureName, label) {
  const fixture = readFixture(fixtureName);
  const built = await buildFixtureState(browser, { base: BASE, fixture, siteId: SITE_ID, cacheDir: CACHE });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, ignoreHTTPSErrors: true, storageState: built.state });
  await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
  /* No egress: a blocked live request would read as a rendering failure and this run would be
   * measuring the network instead of the feature. */
  await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  const pageErrors = [];
  const writes = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  /* Part 3's sharpest reading: a write about ELEMENTS would go out as an RPC. Nothing should. */
  page.on("request", (r) => {
    const u = r.url();
    if (/commit_elements|site_elements|\/rest\/v1\//.test(u)) writes.push(`${r.method()} ${u.slice(0, 120)}`);
  });
  await assertMeasurable(page, "verify-content-visibility");
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 30000 });
  await pacedWait(page, 2500);
  /* ⛔ OPEN THE YIELD PANEL, or there are no numbers to compare and every "unchanged" check is
   * `null === null`. The left dock starts CLOSED (`leftPanel` is null on first paint, deliberately
   * — see SitePlanner's header), and the first run of this harness passed 25 checks that way
   * before its own setup guard caught it. `data-rail-tab` is the stable hook the click-contract
   * guard already uses. */
  await page.locator('[data-rail-tab="yield"]').click();
  await pacedWait(page, 1500);
  if (pageErrors.length) {
    console.log(`\n⛔ ${label} CRASHED THE RENDER — every result below would be meaningless:`);
    pageErrors.slice(0, 3).forEach((e) => console.log("   " + e.slice(0, 220)));
    process.exit(1);
  }
  return { page, ctx, fixture, writes };
}

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
try {
  mkdirSync(CACHE, { recursive: true });
  if (SHOTS) mkdirSync(OUT, { recursive: true });

  // ══════════════════════════════════════ ARM 1 — every family, on the owner's Silvestri plan
  console.log("\nSILVESTRI — the one plan carrying all five families at once");
  const { page, fixture, writes } = await boot(browser, "sylvestri", "Silvestri");
  console.log(`  ${fixture.site} / ${fixture.name} · ${(fixture.els || []).length} elements · ` +
    `${(fixture.parcels || []).length} parcels · ${(fixture.markups || []).length} markups · ` +
    `${(fixture.measures || []).length} measures · ${(fixture.callouts || []).length} callouts`);

  const typeById = new Map((fixture.els || []).map((e) => [e.id, e.type]));
  const base = { census: await census(page), panel: await panelText(page), saved: await saved(page) };
  check("setup · the plan rendered with content in it", base.census.total > 20, `${base.census.total} features drawn`);
  check("setup · the Yield panel is open with numbers in it", !!base.panel && base.panel.length > 200,
    base.panel ? `${base.panel.length} chars of metrics` : "⛔ the metrics region is not on screen — every 'numbers unchanged' check below would be vacuous");
  if (SHOTS) await page.screenshot({ path: `${OUT}/before.png` });

  /* Each family, hidden on its own and put back — so one row's failure cannot be masked by another
   * row's success, and the panel is compared against the SAME baseline every time. */
  const FAMILIES = [
    { testid: "view-row-markups", kind: "markup", label: "Markups" },
    { testid: "view-row-measures", kind: "measure", label: "Measurements" },
    { testid: "view-row-callouts", kind: "callout", label: "Text & callouts" },
    { testid: "view-row-parcels", kind: "parcel", label: "Parcels" },
    { testid: "view-row-el:building", kind: null, elType: "building", label: "Buildings" },
    { testid: "view-row-el:road", kind: null, elType: "road", label: "Roads" },
  ];

  /* ⛔ NEW-1 — THE INK CHECK, AND THE REASON IT EXISTS BESIDE THE CENSUS RATHER THAN INSTEAD OF IT.
   *
   * This harness scored Roads ✓ on a build where the owner was looking at four unbroken grey ribbons.
   * The census is not wrong — every road's `[data-el-id]` node really did leave the canvas — it is
   * counting the wrong noun. A road's PAVEMENT is drawn once per connected cluster by the dissolved
   * network, from a `<path>` that carries no feature key, so a census of registrations cannot see it.
   * Any render path that draws on behalf of several features at once is invisible the same way, and
   * this codebase prefers exactly that kind of path. So the promise is asserted on INK from here on:
   * ui-audit/lib/inkCensus.mjs walks every painted node and attributes it, `data-road-cluster`
   * included. `expectedKeys` is what must have NO ink left. */
  const expectedKeys = (f) => (f.kind
    ? (fixture[{ markup: "markups", measure: "measures", callout: "callouts", parcel: "parcels" }[f.kind]] || [])
      .map((x, i) => (f.kind === "measure" ? `measure:${i}` : `${f.kind}:${x.id}`))
    : (fixture.els || []).filter((e) => e.type === f.elType).map((e) => `el:${e.id}`));

  const baseInk = await inkCensus(page);
  for (const f of FAMILIES) {
    /* ⛔ A ROW WITH NO INK TO LOSE PASSES FOR FREE. Assert the subject exists before asking it to go. */
    const keys = expectedKeys(f);
    const hadInk = keys.filter((k) => (baseInk.byOwner || {})[k]).length;
    check(`${f.label} · SETUP: it is actually painted at baseline`, hadInk > 0,
      hadInk ? `${hadInk} of ${keys.length} keys carry ink` : "⛔ nothing attributable — the ink check below would be vacuous");

    await toggleRow(page, f.testid);
    const now = { census: await census(page), panel: await panelText(page) };

    const wasDrawn = f.kind ? (base.census.by[f.kind] || 0) : drawnOfType(base.census, typeById, f.elType);
    const nowDrawn = f.kind ? (now.census.by[f.kind] || 0) : drawnOfType(now.census, typeById, f.elType);
    check(`${f.label} · leave the canvas when hidden`, wasDrawn > 0 && nowDrawn === 0, `${wasDrawn} drawn → ${nowDrawn}`);

    const leaked = leakedInk(await inkCensus(page), keys);
    check(`${f.label} · ⛔ put NO INK on the drawing when hidden`, leaked.length === 0,
      leaked.length ? `${leaked.reduce((a, b) => a + b.nodes, 0)} painted nodes remain: ${leaked.slice(0, 4).map((x) => `${x.key}(${x.nodes})`).join(" ")}`
        : "nothing attributable to this group is still painted");

    /* ⛔ THE ONE THAT MATTERS. */
    check(`${f.label} · every number is unchanged`, now.panel === base.panel,
      now.panel === base.panel ? "panel text byte-identical" : firstDiff(base.panel, now.panel));

    await toggleRow(page, f.testid);   // put it back before the next family
    const back = await census(page);
    check(`${f.label} · come back when shown again`, back.total === base.census.total,
      `${now.census.total} → ${back.total} (was ${base.census.total})`);
  }

  /* ⛔ PDF-PARITY — WHAT YOU SEE IS WHAT PRINTS, ASSERTED ON THE REAL BUILT SHEET.
   *
   * The owner asked the question directly: "PDF-PARITY: what you see is what prints." The answer is
   * meant to be free — `buildExportSvg` CLONES the live `<svg>`, so content that is not in the DOM
   * cannot reach the sheet — but "free by construction" is a claim about code, and this defect was
   * ink drawn by a pass nobody had enumerated. So it is measured on the artefact instead: hide
   * Roads, build the sheet the export path really builds, and look for road pavement in it.
   *
   * ⚠ The KMZ path is deliberately NOT covered here and is NOT a gap: a model-built export decides
   * its own contents and never inherits a canvas display toggle (that rule is `kmzExport.js`'s, and
   * `test/kmzExport.test.js` enforces it). The PDF/PNG sheet is the opposite case on purpose — it is
   * the drawing on paper, for the same reader, set while looking at the drawing being printed. */
  await toggleRow(page, "view-row-el:road");
  const sheetHidden = await page.evaluate(() => (window.__plannerExportSvg ? window.__plannerExportSvg() : null));
  await toggleRow(page, "view-row-el:road");
  const sheetShown = await page.evaluate(() => (window.__plannerExportSvg ? window.__plannerExportSvg() : null));
  const roadInk = (svg) => (String(svg || "").match(/data-export="road-network"/g) || []).length;
  check("PDF-PARITY · SETUP: the sheet builds, and prints road pavement when roads are shown",
    !!sheetShown && roadInk(sheetShown) > 0,
    sheetShown ? `${roadInk(sheetShown)} road-network paths on the sheet` : "⛔ no export sheet — the parity check below would be vacuous");
  check("PDF-PARITY · ⛔ a hidden road does not print", !!sheetHidden && roadInk(sheetHidden) === 0,
    `${roadInk(sheetHidden)} road-network paths on the sheet with Roads hidden`);

  // ── the master, and the glanceable state ────────────────────────────────────────────────────
  await openViewMenu(page);
  await page.locator('[data-testid="view-elements-master"]').click();
  await pacedWait(page, 700);
  const masterCensus = await census(page);
  const masterPanel = await panelText(page);
  check("Elements master · hides every element type at once",
    (masterCensus.by.el || 0) === 0 && (base.census.by.el || 0) > 0,
    `${base.census.by.el || 0} → ${masterCensus.by.el || 0}`);
  check("Elements master · every number is STILL unchanged", masterPanel === base.panel,
    masterPanel === base.panel ? "panel text byte-identical" : firstDiff(base.panel, masterPanel));
  if (SHOTS) await page.screenshot({ path: `${OUT}/elements-hidden.png` });

  /* Part 3 — nothing about the elements was written. Two independent readings. */
  const afterSaved = await saved(page);
  check("⛔ nothing was written about the elements (the saved collections are byte-identical)",
    afterSaved.collections === base.saved.collections,
    afterSaved.collections === base.saved.collections ? "els/parcels/markups/measures/callouts unchanged"
      : `${base.saved.collections.length} → ${afterSaved.collections.length} chars`);
  check("⛔ no element write left the browser", writes.length === 0,
    writes.length ? writes.slice(0, 2).join(" · ") : "no site_elements / commit_elements request");
  check("the hide IS persisted, as view state on the plan", !!afterSaved.hidden && Object.keys(afterSaved.hidden).length > 0,
    JSON.stringify(afterSaved.hidden));

  /* The owner's requirement: he must be able to tell he is looking at a filtered view. The chip
   * rides the COLLAPSED header — the state visible without opening anything — so close the card. */
  await page.locator('[data-testid="view-menu-btn"]').click();
  await pacedWait(page, 350);
  const chip = page.locator('[data-testid="view-hidden-chip"]');
  const chipSeen = await chip.count() > 0 && await chip.isVisible();
  check("a filtered view SAYS SO on the collapsed header", chipSeen,
    chipSeen ? (await chip.innerText()).replace(/\s+/g, " ") : "no chip");
  if (SHOTS) await page.screenshot({ path: `${OUT}/chip.png` });

  // ── it survives a reload ────────────────────────────────────────────────────────────────────
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 30000 });
  await pacedWait(page, 2500);
  await page.locator('[data-rail-tab="yield"]').click();   // the dock starts closed on every load
  await pacedWait(page, 1500);
  const reloaded = await census(page);
  check("the hide survives a reload", (reloaded.by.el || 0) === 0, `${reloaded.by.el || 0} elements drawn`);
  const reloadedPanel = await panelText(page);
  check("and the numbers are STILL the same after the reload", reloadedPanel === base.panel,
    reloadedPanel === base.panel ? "panel text byte-identical" : firstDiff(base.panel, reloadedPanel));

  // ── Show all puts everything back ───────────────────────────────────────────────────────────
  await openViewMenu(page);
  await page.locator('[data-testid="view-show-all"]').click();
  await pacedWait(page, 700);
  const restored = await census(page);
  check("Show all restores every group in one click", restored.total === base.census.total,
    `${reloaded.total} → ${restored.total} (was ${base.census.total})`);
  if (SHOTS) await page.screenshot({ path: `${OUT}/after.png` });

  // ══════════════════════════════════════ ARM 2 — the POND, the type the owner named first
  console.log("\nBAIN — the pond, which Silvestri does not have");
  const bain = await boot(browser, "bain", "Bain");
  const bType = new Map((bain.fixture.els || []).map((e) => [e.id, e.type]));
  const bBase = { census: await census(bain.page), panel: await panelText(bain.page) };
  const bPondBefore = drawnOfType(bBase.census, bType, "pond");
  check("setup · Bain drew its pond", bPondBefore > 0, `${bPondBefore} pond`);
  await toggleRow(bain.page, "view-row-el:pond");
  const bHidden = { census: await census(bain.page), panel: await panelText(bain.page) };
  const bPondAfter = drawnOfType(bHidden.census, bType, "pond");
  check("Ponds · leave the canvas when hidden", bPondAfter === 0, `${bPondBefore} → ${bPondAfter}`);
  check("Ponds · every number is unchanged (detention included)", bHidden.panel === bBase.panel,
    bHidden.panel === bBase.panel ? "panel text byte-identical" : firstDiff(bBase.panel, bHidden.panel));
  check("⛔ no element write left the browser (Bain)", bain.writes.length === 0,
    bain.writes.length ? bain.writes.slice(0, 2).join(" · ") : "none");

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length ? "✗" : "✓"} ${results.length - failed.length}/${results.length} checks passed`);
  if (SHOTS) { writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2)); console.log(`  → ${OUT}/`); }
  process.exitCode = failed.length ? 1 : 0;
} finally {
  await browser.close();
}

/* Where two panel readings first diverge — a diff a human can act on beats "not equal". */
function firstDiff(a, b) {
  /* Null means the metrics region was not on screen. Say so rather than throwing — a harness that
   * crashes on its own failure path reports nothing about the run it was in the middle of. */
  if (a == null || b == null) return `⛔ the metrics region was not readable (before=${a == null ? "null" : "ok"}, after=${b == null ? "null" : "ok"}) — this check proved nothing`;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return `⛔ NUMBERS MOVED at char ${i}: "${a.slice(Math.max(0, i - 40), i + 40)}" → "${b.slice(Math.max(0, i - 40), i + 40)}"`;
}
