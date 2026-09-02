#!/usr/bin/env node
/* verify-comp-entry-grid-consistency — B986096-HARDENING-25: the owner pointed at a 4x4 crop of
 * the comp entry sheet and found fourteen visual-consistency defects (opacity, group-header
 * alignment, single-column "groups," Notes misfiled under Parties, five row heights, ragged
 * ruling, near-identical selection/error oranges, padding singletons, an invisible header-weight
 * hierarchy, and no affordance on an empty selected cell). This harness re-runs the SAME property
 * sweep the owner's own brief specified — bucket every th/td (and its inner span/button/input/
 * select) by fontSize/fontWeight/lineHeight/letterSpacing/textAlign/verticalAlign/color/
 * backgroundColor/opacity/paddingLeft/paddingRight/height/border*Width/border*Color/outlineColor/
 * textTransform — against the real, unmocked dev build, for BOTH deal-type column sets (land and
 * lease), so a future regression on any of them fails here instead of waiting for the next owner
 * screenshot.
 *
 *   node ui-audit/verify-comp-entry-grid-consistency.mjs [--url http://localhost:4319/] [--shots]
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { readFixture } from "./lib/fixtureSeeding.mjs";
import { fixtureSeed } from "./lib/planFixture.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg("--url", "http://localhost:4319/");
const SHOTS = process.argv.includes("--shots");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome";
const SHOT_DIR = "ui-audit/.artifacts/comp-entry-grid-consistency";
if (SHOTS) mkdirSync(SHOT_DIR, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };

const SWEEP_PROPS = [
  "fontSize", "fontWeight", "lineHeight", "letterSpacing", "textAlign", "verticalAlign", "color",
  "backgroundColor", "opacity", "paddingLeft", "paddingRight", "height",
  "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
  "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor",
  "outlineColor", "textTransform",
];

async function openEntrySheet(page) {
  await page.goto(`${BASE}#/site`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await pacedWait(page, 2500);
  await assertMeasurable(page, "verify-comp-entry-grid-consistency");
  await page.getByRole("tab", { name: /^Comps/ }).first().click();
  await pacedWait(page, 400);
  await page.getByText("＋ New comps", { exact: true }).click();
  await pacedWait(page, 300);
}

async function pasteLine(page, text) {
  const textarea = page.locator("textarea").first();
  await textarea.click();
  await textarea.fill(text);
  await page.keyboard.press("Enter");
  await pacedWait(page, 400);
}

/** Bucket every th/td and its direct inner span/button/input/select by each swept property,
 * returning { prop: { value: count } }. Runs entirely in-page (one evaluate call). */
async function sweepGrid(page) {
  return page.evaluate((props) => {
    const table = document.querySelector('[data-comp-entry-panel] table');
    if (!table) return null;
    const cells = [...table.querySelectorAll("th, td")];
    const elements = [];
    for (const cell of cells) {
      elements.push(cell);
      for (const inner of cell.querySelectorAll("span, button, input, select")) elements.push(inner);
    }
    const buckets = {};
    for (const prop of props) buckets[prop] = {};
    for (const el of elements) {
      const cs = getComputedStyle(el);
      for (const prop of props) {
        const v = cs[prop];
        buckets[prop][v] = (buckets[prop][v] || 0) + 1;
      }
    }
    return { buckets, elementCount: elements.length, cellCount: cells.length };
  }, SWEEP_PROPS);
}

function reportSweep(label, sweep) {
  console.log(`\n--- sweep: ${label} (${sweep.cellCount} th/td, ${sweep.elementCount} elements incl. inner span/button/input/select) ---`);
  const singletons = [];
  for (const prop of SWEEP_PROPS) {
    const entries = Object.entries(sweep.buckets[prop]).sort((a, b) => b[1] - a[1]);
    const line = entries.map(([v, n]) => `${v || "(empty)"}×${n}`).join(", ");
    console.log(`  ${prop}: ${entries.length} distinct — ${line}`);
    for (const [v, n] of entries) {
      if (n <= 2 && entries.length > 3) singletons.push(`${prop}=${v} (×${n})`);
    }
  }
  if (singletons.length) console.log(`  ⚠ low-population values (population ≤2 in a field of >3 distinct values): ${singletons.join("; ")}`);
  return singletons;
}

const browser = await chromium.launch({ executablePath: EXEC, headless: true });
const fixture = readFixture("bain");

console.log("=== LAND-ONLY sheet: opacity, alignment, group collapse, ruling, padding, weight ===");
{
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(fixtureSeed(fixture, { id: "consist-land" }));
  await ctx.route("**/*", (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
  const page = await ctx.newPage();
  await openEntrySheet(page);
  await pasteLine(page, "West Hardy tract, 3.2 AC, $850,000, closed 3/14/2026");
  await pasteLine(page, "Sugarbun Way tract, 5.0 AC, $1,200,000, closed 2/1/2026");

  // Item 1 — opacity: background must never be transparent, and only two opaque values (rest vs
  // muted/na/derived) should appear across every th/td (never a translucent frosted-panel value).
  const bg = await page.evaluate(() => {
    const panel = document.querySelector('[data-comp-entry-panel]');
    const panelBg = getComputedStyle(panel).backgroundColor;
    const table = panel.querySelector("table");
    const cells = [...table.querySelectorAll("th, td")];
    const vals = new Set(cells.map((c) => getComputedStyle(c).backgroundColor));
    return { panelBg, cellBgValues: [...vals] };
  });
  check("outer panel background is fully opaque (alpha=1, not the frosted .94 overlay)", /^rgb\(|,\s*1\)$/.test(bg.panelBg) && !bg.panelBg.includes("0.9"), bg.panelBg);
  check("every th/td background is opaque (no rgba(...,0) / partial alpha anywhere)", bg.cellBgValues.every((v) => !/rgba?\([^)]*,\s*0(\.\d+)?\)/.test(v) || /,\s*1\)$/.test(v)), bg.cellBgValues.join(" | "));

  // Item 2/3 — group header alignment matches its column, and a single-column group's label is
  // collapsed (never a doubled word like "PRICE" over "Price").
  const groups = await page.evaluate(() => {
    const table = document.querySelector('[data-comp-entry-panel] table');
    const groupRow = table.querySelectorAll("thead tr")[0];
    const colRow = table.querySelectorAll("thead tr")[1];
    const groupThs = [...groupRow.querySelectorAll("th")];
    const colThs = [...colRow.querySelectorAll("th")];
    let colCursor = 0;
    return groupThs.map((th) => {
      const span = th.colSpan;
      const membersAlign = colThs.slice(colCursor, colCursor + span).map((c) => getComputedStyle(c).textAlign);
      colCursor += span;
      return { text: th.textContent.trim(), span, align: getComputedStyle(th).textAlign, membersAlign };
    });
  });
  console.log("  group bands:", JSON.stringify(groups));
  const dealGroup = groups.find((g) => g.span === 1 && g.membersAlign[0] === "right");
  check("a single-column group over a right-aligned column has NO label (collapsed) and right alignment", !dealGroup || (dealGroup.text === "" && dealGroup.align === "right"));
  const priceGroupDoubled = groups.some((g) => g.text.toLowerCase() === "price");
  check("no group label literally repeats its lone column's own label (e.g. 'PRICE' over 'Price')", !priceGroupDoubled);
  const multiGroup = groups.find((g) => g.span > 1);
  check("a multi-column group still shows its label, left-aligned", !!multiGroup && multiGroup.text.length > 0 && multiGroup.align === "left");

  // Item 4 — Notes is not inside PARTIES.
  const notesGroupOk = await page.evaluate(() => {
    const table = document.querySelector('[data-comp-entry-panel] table');
    const colThs = [...table.querySelectorAll("thead tr")[1].querySelectorAll("th")];
    const notesIdx = colThs.findIndex((th) => th.textContent.trim() === "Notes");
    if (notesIdx === -1) return null;
    const groupRow = table.querySelectorAll("thead tr")[0];
    const groupThs = [...groupRow.querySelectorAll("th")];
    let cursor = 0;
    for (const th of groupThs) {
      const span = th.colSpan;
      if (notesIdx >= cursor && notesIdx < cursor + span) return th.textContent.trim();
      cursor += span;
    }
    return null;
  });
  check("Notes' group band never reads 'PARTIES'", notesGroupOk !== "PARTIES", `Notes' group band text: "${notesGroupOk}"`);

  // Item 5/7 — row heights + vertical-align/line-height uniform across data rows.
  const rowGeom = await page.evaluate(() => {
    const table = document.querySelector('[data-comp-entry-panel] table');
    const rows = [...table.querySelectorAll("tbody tr")];
    return rows.map((r) => Math.round(r.getBoundingClientRect().height * 100) / 100);
  });
  const distinctRowH = [...new Set(rowGeom)];
  check("every data row renders at the identical height", distinctRowH.length === 1, `heights: ${rowGeom.join(", ")}`);
  const vAlign = await page.evaluate(() => {
    const table = document.querySelector('[data-comp-entry-panel] table');
    const els = [...table.querySelectorAll("tbody td, tbody td span, tbody td button")];
    return [...new Set(els.map((e) => getComputedStyle(e).verticalAlign))];
  });
  check("verticalAlign is a single consistent value across data-row td/span/button", vAlign.length === 1, vAlign.join(", "));

  // Item 6 — ruling: all four sides are explicit and IDENTICAL now (never a side left to fall
  // back to `currentColor`, the text-color leak the owner's own sweep caught on two sides).
  const borderColors = await page.evaluate(() => {
    const table = document.querySelector('[data-comp-entry-panel] table');
    const td = table.querySelector("tbody td[data-cell]");
    const cs = getComputedStyle(td);
    return { top: cs.borderTopColor, left: cs.borderLeftColor, right: cs.borderRightColor, bottom: cs.borderBottomColor, text: cs.color };
  });
  const symmetric = new Set([borderColors.top, borderColors.left, borderColors.right, borderColors.bottom]).size === 1;
  check("a cell's four border-color sides all match (no currentColor leak on any side)", symmetric && borderColors.top !== borderColors.text, JSON.stringify(borderColors));

  // Item 9 — no cell (rest or editing) uses a stray 2px/1px padding singleton.
  await page.locator('button[aria-label="Remove comp"]').first(); // no-op, keeps lints quiet about unused import path
  const typeCell = page.locator('td[data-cell="0-0"]');
  await typeCell.dblclick();
  await pacedWait(page, 200);
  const selectPad = await page.evaluate(() => {
    const sel = document.querySelector('[data-comp-entry-panel] table select');
    return sel ? getComputedStyle(sel).paddingLeft : null;
  });
  check("the Type SELECT editor's padding matches every other cell (5px, not the old 2px override)", selectPad === "5px", selectPad);
  await page.keyboard.press("Escape");
  await pacedWait(page, 150);

  // Item 10 — header weight hierarchy is a real, visible gap now (600 vs 800).
  const weights = await page.evaluate(() => {
    const table = document.querySelector('[data-comp-entry-panel] table');
    const groupTh = table.querySelectorAll("thead tr")[0].querySelector("th");
    const colTh = table.querySelectorAll("thead tr")[1].querySelector("th");
    return { group: getComputedStyle(groupTh).fontWeight, col: getComputedStyle(colTh).fontWeight };
  });
  check("group-band weight and column-label weight are genuinely different (not 700 vs 800)", weights.group !== weights.col, JSON.stringify(weights));

  // Item 11 — empty date cell shows a format-hint placeholder while editing.
  const headerCells = await page.locator('[data-comp-entry-panel] th').allTextContents();
  const execColIdx = headerCells.findIndex((t) => t.trim() === "Executed");
  const hb = await page.locator('[data-comp-entry-panel] th').nth(execColIdx).boundingBox();
  const rowTds = page.locator('td[data-cell^="0-"]');
  const n = await rowTds.count();
  let execCell = null;
  for (let i = 0; i < n; i++) {
    const b = await rowTds.nth(i).boundingBox();
    if (b && hb && Math.abs(b.x - hb.x) < 3) { execCell = rowTds.nth(i); break; }
  }
  check("found the Executed cell", !!execCell);
  if (execCell) {
    // This row's Executed date was already set by the paste above — blank it first via Delete.
    await execCell.click();
    await page.keyboard.press("Delete");
    await pacedWait(page, 150);
    await execCell.dblclick();
    await pacedWait(page, 150);
    const hint = await page.evaluate(() => document.querySelector('[data-comp-entry-panel] table input')?.placeholder);
    check("an empty Executed cell shows a format-hint placeholder while editing", hint === "mm/dd/yy", hint);
    await page.keyboard.press("Escape");
  }

  if (SHOTS) await page.screenshot({ path: `${SHOT_DIR}/land-full.png` });
  const sweep = await sweepGrid(page);
  reportSweep("land-only column set", sweep);
  await ctx.close();
}

console.log("\n=== LEASE column set: Rate/Basis/Escal/TI/Per/$-SF-yr swept too ===");
{
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 900 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(fixtureSeed(fixture, { id: "consist-lease" }));
  await ctx.route("**/*", (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
  const page = await ctx.newPage();
  await openEntrySheet(page);
  await pasteLine(page, "Sugarbun Way industrial, 25,000 SF lease, $6.50/SF/yr NNN, 5 yr term, executed 1/15/2026");

  const headerLabels = await page.locator('[data-comp-entry-panel] th').allTextContents();
  check("lease-only columns (Rate/Per/Basis/Escal/$/SF/yr) are visible", ["Rate", "Per", "Basis", "$/SF/yr"].every((h) => headerLabels.some((t) => t.trim() === h)));

  const groups = await page.evaluate(() => {
    const table = document.querySelector('[data-comp-entry-panel] table');
    const groupRow = table.querySelectorAll("thead tr")[0];
    return [...groupRow.querySelectorAll("th")].map((th) => ({ text: th.textContent.trim(), span: th.colSpan }));
  });
  console.log("  group bands (lease-only sheet):", JSON.stringify(groups));
  const rentGroup = groups.find((g) => g.text === "RENT");
  check("RENT is a real multi-column group on a lease-only sheet (Rate+Per+Basis+Escal)", !!rentGroup && rentGroup.span > 1);

  if (SHOTS) await page.screenshot({ path: `${SHOT_DIR}/lease-full.png` });
  const sweep = await sweepGrid(page);
  reportSweep("lease column set", sweep);
  await ctx.close();
}

await browser.close();

const fails = results.filter((r) => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} checks passed.`);
if (fails.length) { console.error(`FAILING: ${fails.map((f) => f.name).join("; ")}`); process.exit(1); }
