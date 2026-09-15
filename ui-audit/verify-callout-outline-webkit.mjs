/* WebKit real-engine pass for B1652704/B1652705/B1652706 (the text box / callout Properties
 * panel rebuild) — real Playwright WebKit (not Chromium emulation), at desktop width and three
 * iPhone sizes in both orientations. Defaults to a LOCAL preview build; pass `BASE_URL` to point
 * it at a real deployment instead (e.g. this PR's own Cloudflare Pages branch preview — see
 * V1180736 in VERIFICATION.md for the run against real deployed bytes).
 *
 * ⛔ Even against a branch preview, this is NOT the production pass the dispatch asked for — a
 * branch preview is a real deploy of this PR's own commit, but `planyr.io` itself only serves
 * `main`, so it still won't reflect this code until the PR merges. This script exists to catch
 * any WebKit-specific rendering difference (a real engine, not Chromium's phone emulation)
 * BEFORE the post-merge production check, per docs/PHONE-TESTING.md's own "WebKit installs on
 * demand here" note.
 *
 * NEW-2 (the phone-width task filed alongside the NEW-1 header-alignment bug, both found on a
 * production live-verify pass of B1652704/705/706): the ORIGINAL version of this harness only ever
 * selected the CALLOUT (the leader/arrow object). It never drove the plain TEXT BOX (`noLeader`),
 * so "the rebuilt panel is proven at phone width" was true of one of the two object kinds the panel
 * renders for. `checkAtSize` now drives BOTH fills at every device/orientation and asserts, per
 * object: the paired FILL/LINE columns stay side by side (never wrap onto their own line — a
 * `1fr 1fr` grid track CAN wrap its content at a narrow enough column, this only proves it doesn't
 * at real iPhone widths), no row's own content overflows its box, the panel's outer edge never runs
 * past the viewport (the phone bottom-sheet case), and the NEW-1 left-gutter fix — now read via
 * `data-row-align="1"`, which is the header row's own marker, not `data-field-group` (the
 * keyboard-latch marker a plain header never carries) — holds at every width, not just 1440.
 *
 * Run: node ui-audit/verify-callout-outline-webkit.mjs   (preview server must be up on :4173)
 *   or: BASE_URL="https://<preview>.pages.dev/#/project/<id>/site" node ui-audit/verify-callout-outline-webkit.mjs
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { webkit, devices } = pw;
import { mkdirSync } from "node:fs";

const DEMO_ID = "verify-b1652704-webkit";
const BASE = process.env.BASE_URL || `http://localhost:4173/#/project/${DEMO_ID}/site`;
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const parcel = { id: "pc1", locked: false, points: [{ x: -900, y: -450 }, { x: 900, y: -450 }, { x: 900, y: 450 }, { x: -900, y: 450 }] };
const calloutX = { id: "coX", text: "CALLOUTX", box: { x: -300, y: 300 }, tip: { x: -650, y: 420 }, fill: "#ffd9a8", stroke: "#7a3b00", color: "#3a1c00", size: 20 };
const textBoxY = { id: "tbY", text: "TEXTBOXY", box: { x: 400, y: 300 }, noLeader: true, fill: "#a8d9ff", stroke: "#003a5a", color: "#00243a", size: 15 };
const demoSite = {
  id: DEMO_ID, groupId: DEMO_ID, site: "Verify B1652704 WebKit", name: "Plan 1", origin: null, county: null,
  parcels: [parcel], els: [], measures: [], callouts: [calloutX, textBoxY], markups: [],
  settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [DEMO_ID]: demoSite })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(DEMO_ID)});
} catch (e) {} })();`;

let fail = 0;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };

const browser = await webkit.launch({});
console.log("engine: WebKit (real rendering/pointer engine, not Chromium emulation)");

const TARGETS = [
  { fill: "#ffd9a8", kind: "callout (with leader)" },
  { fill: "#a8d9ff", kind: "text box (no leader)" },
];

async function checkObjectAtSize(page, label, fill, kind) {
  const cc = await page.evaluate((f) => {
    const r = [...document.querySelectorAll("svg rect")].find((x) => (x.getAttribute("fill") || "").toLowerCase() === f);
    if (!r) return null;
    const b = r.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, fill);
  log(!!cc, `${label} / ${kind}: seeded object renders on canvas`);
  if (!cc) return;
  await page.mouse.move(cc.x, cc.y);
  await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(300);

  // desktop (no bottom-sheet path): select docks Properties directly via the tab. narrow: through Panels.
  // ⛔ the dock tab is a TOGGLE (`setLeftPanel((p) => p === id ? null : id)`) — clicking "Properties"
  // while it is ALREADY the docked tab (true for the second object checked at a given size) CLOSES
  // it instead of leaving it open for the new selection, which silently zeroed every row count for
  // the second target until this check was added. Selecting a new object while Properties is already
  // docked updates its contents on its own; only click the tab when the panel isn't open yet.
  const alreadyDocked = await page.evaluate(() => !!document.querySelector('[data-testid="property-panel"]'));
  if (!alreadyDocked) {
    try { await page.getByText("Properties", { exact: true }).first().click({ timeout: 2500 }); }
    catch (e) {
      try {
        await page.getByText("Panels", { exact: true }).first().click({ timeout: 2500 });
        await page.waitForTimeout(250);
        await page.getByText("Properties", { exact: true }).first().click({ timeout: 2500 });
      } catch (e2) { /* fall through — the field-group count below reports the miss */ }
    }
  }
  await page.waitForTimeout(400);

  const layout = await page.evaluate(() => {
    // NEW-1 fix verification: `data-row-align="1"` marks EVERY row kind (single Field, paired
    // PairedField, AND the PairedFieldHead column-header row) — the header carries no
    // `data-field-group`, which is what let it ship 2px off every row it labels unnoticed.
    const rows = [...document.querySelectorAll('[data-row-align="1"]')].filter((g) => {
      const cs = getComputedStyle(g);
      return cs.display === "grid" && cs.gridTemplateColumns.startsWith("64px");
    });
    const rowInfo = rows.map((g) => {
      const b = g.getBoundingClientRect();
      const gcs = getComputedStyle(g);
      // per-row overflow: a paired 1fr/1fr track that has no room can push its own content wider
      // than the row box rather than visibly wrapping — catch that as scrollWidth > clientWidth
      // on the row itself, not just the page.
      const rowOverflow = g.scrollWidth > g.clientWidth + 1;
      // "paired columns wrap" would show up as the row's rendered HEIGHT roughly doubling+ against
      // an ordinary single-line row's height (a 1fr/1fr grid track stacking to two lines instead
      // of staying side by side) — carried per-row so it can be compared against SINGLE rows only
      // (the column-header row is a much shorter text-only line and is not a fair baseline).
      const height = Math.round(b.height);
      return { left: Math.round(b.x), width: b.width, cols: gcs.gridTemplateColumns, label: (g.children[0]?.textContent || "").trim(), isHead: !g.hasAttribute("data-field-group"), rowOverflow, height };
    });
    const panel = document.querySelector('[data-testid="property-panel"]');
    const panelRight = panel ? panel.getBoundingClientRect().right : null;
    const overflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 2;
    return {
      rowInfo, panelRight,
      overflow, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
    };
  });
  const edges = new Set(layout.rowInfo.map((r) => r.left));
  const headRows = layout.rowInfo.filter((r) => r.isHead);
  const singleRows = layout.rowInfo.filter((r) => !r.isHead && r.cols.split(" ").length === 2);
  const pairedRows = layout.rowInfo.filter((r) => !r.isHead && r.cols.split(" ").length === 3);
  const hasWeight = layout.rowInfo.some((r) => r.label === "Weight");
  const hasPadding = layout.rowInfo.some((r) => r.label === "Padding");
  const anyRowOverflow = layout.rowInfo.some((r) => r.rowOverflow);
  // a wrapped paired row renders roughly 2x (or more) as tall as an ordinary single-line row —
  // compare each paired row's height against the shortest SINGLE row on the panel.
  const singleShortest = Math.min(...singleRows.map((r) => r.height).filter((h) => h > 0));
  const anyRowWrapped = pairedRows.some((r) => r.height > singleShortest * 1.8);
  log(layout.rowInfo.length >= 10, `${label} / ${kind}: Properties panel rendered (${layout.rowInfo.length} rows found)`);
  log(hasWeight && hasPadding, `${label} / ${kind}: Weight + Padding rows present`);
  log(headRows.length >= 1, `${label} / ${kind}: the column-header row is present in the measured set (${headRows.length})`);
  log(edges.size <= 1, `${label} / ${kind}: every row — single, paired, AND the column-header — shares one left gutter edge (edges: ${[...edges].join(",")})`);
  log(singleRows.length >= 1 && pairedRows.length >= 1, `${label} / ${kind}: both single (${singleRows.length}) and paired (${pairedRows.length}) row shapes render`);
  log(!anyRowOverflow, `${label} / ${kind}: no row's own content overflows its box`);
  log(!anyRowWrapped, `${label} / ${kind}: the paired FILL/LINE (and X/Y) columns stay side by side — no row wrapped onto its own line`);
  log(layout.panelRight == null || layout.panelRight <= layout.clientWidth + 1, `${label} / ${kind}: the panel's own right edge stays inside the viewport (fits the phone bottom sheet)`);
  log(!layout.overflow, `${label} / ${kind}: no horizontal page overflow (scrollWidth ${layout.scrollWidth} vs clientWidth ${layout.clientWidth})`);

  await page.screenshot({ path: OUT + `webkit-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${kind.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png` });
}

async function checkAtSize(label, deviceOpts) {
  const ctx = await browser.newContext({ ...deviceOpts, ignoreHTTPSErrors: true });
  await ctx.addInitScript(seed);
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(2000);
  try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (e) { /* noop */ }
  await page.waitForTimeout(500);

  for (const { fill, kind } of TARGETS) {
    await checkObjectAtSize(page, label, fill, kind);
  }
  await ctx.close();
}

await checkAtSize("Desktop 1440", { viewport: { width: 1440, height: 900 } });
for (const [name, orientation] of [["iPhone SE", "portrait"], ["iPhone SE", "landscape"], ["iPhone 15", "portrait"], ["iPhone 15", "landscape"]]) {
  const d = devices[name];
  const vp = orientation === "landscape" ? { width: d.viewport.height, height: d.viewport.width } : d.viewport;
  await checkAtSize(`${name} ${orientation}`, { ...d, viewport: vp, isMobile: true, hasTouch: true });
}

console.log(fail === 0 ? "\n✓ all WebKit checks passed" : `\n✗ ${fail} WebKit check(s) failed`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
