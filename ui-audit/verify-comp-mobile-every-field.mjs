#!/usr/bin/env node
/* verify-comp-mobile-every-field — NEW-1 (2026-10-01, owner report, iPhone Safari): "some of the
 * fields on the mobile comp sheet aren't editable". EVERY field row of the transposed sheet
 * (CompEntryMobileSheet.jsx) must open an editor from a real TOUCH TAP, empty or filled, for every
 * comp type. The tap lands at the CENTRE of the row — where a thumb lands — not on the value text,
 * because the reported defect is exactly that only the value text (a ~8px "—" when empty) was live.
 *
 * Per type (lease / building_sale / land) and per field row mobileSections()+neededToSave emit:
 *   1. touch-tap the row centre → an <input> or <select> opens (else the field is DEAD)
 *   2. enter a value, commit, page to the next comp and back, read the value back
 * Location is checked as "tap arms the map pick" only (its own existing flow); derived rows
 * (read-only by design, e.g. $/SF) are asserted to NOT open an editor.
 *
 * KNOWN-GOOD ARM (CLAUDE.md DRIVER-SCROLL §6): the Type row (a native select, which worked before the
 * fix) must report editable, or the run is VOID.
 *
 *   node ui-audit/verify-comp-mobile-every-field.mjs [--url http://localhost:4319/]
 */
import { chromium } from "playwright";
import { readFixture } from "./lib/fixtureSeeding.mjs";
import { fixtureSeed } from "./lib/planFixture.mjs";
import { assertMeasurable, pacedWait } from "./lib/tabTiming.mjs";
import { mobileSections, neededToSaveColumns, mobileLabel } from "../src/shared/comps/lib/compMobileLayout.js";

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg("--url", "http://localhost:4319/");
const EXEC = process.env.PW_CHROME || undefined;

const PASTES = {
  lease: "Lease, Houston TX 77032, 322,322 SF, $0.65/SF/mo NNN",
  building_sale: "Katy building sale, $4,200,000, 62,000 SF",
  land: "West Hardy tract, 3.2 AC, $850,000",
};
const DUMMY = "Dummy tract, 1.0 AC, $100,000";

// Typed value + what the row must read after commit (regex on the row's text).
const VALUES = {
  title: ["Fresh Deal 9", /Fresh Deal 9/],
  size: ["12345", /12,345/],
  clearHeightFt: ["32", /32/],
  yearBuilt: ["1999", /1999/],
  leaseRate: ["0.91", /0\.91/],
  leaseRateExpense: ["gross", /gross/i],
  leaseRatePeriod: ["monthly", /mo/i],
  leaseOpex: ["2.5", /2\.5/],
  leaseEscalationPct: ["3", /3/],
  leaseCommencementDate: ["6/1/26", /06\/01\/26|6\/1\/26/],
  leaseTerm: ["60", /60/],
  leaseFreeRentMonths: ["4", /4/],
  leaseTi: ["15", /15/],
  price: ["7777777", /7,777,777/],
  bldgNoi: ["300000", /300,000/],
  bldgCapRate: ["5", /5/],
  partyProvider: ["Acme Realty", /Acme Realty/],
  partyAcquirer: ["Zed Corp", /Zed Corp/],
  notes: ["note xyz", /note xyz/],
  landSizeUnit: ["sf", /SF/i],
};

const results = [];
const dead = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };

const browser = await chromium.launch({ ...(EXEC ? { executablePath: EXEC } : {}), headless: true });
const fixture = readFixture("bain");

async function openSheet(page, text) {
  await page.goto(`${BASE}#/site`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await pacedWait(page, 2500);
  await assertMeasurable(page, "verify-comp-mobile-every-field");
  await page.getByRole("tab", { name: /^Records/ }).first().click();
  await pacedWait(page, 400);
  await page.getByText("＋ Paste comps", { exact: true }).click();
  await pacedWait(page, 300);
  const ta = page.locator("textarea").first();
  for (const t of [text, DUMMY]) {
    await ta.click(); await ta.fill(t); await page.keyboard.press("Enter"); await pacedWait(page, 350);
  }
}

const sheet = (page) => page.locator('[data-comp-entry-mobile="1"]');
// The row = the label span's parent flex container (the thing a thumb sees as "the row").
function rowOf(page, label, key) {
  // Scoped by the row's own data-field-key — a section CAPTION can carry the same text as a field
  // label ("Notes", "Price"), and tapping a caption proves nothing.
  if (key) return sheet(page).locator(`[data-field-key="${key}"]`).first();
  return sheet(page).locator("span", { hasText: new RegExp(`^${label.replace(/[()$/]/g, "\\$&")}$`) }).first().locator("xpath=..");
}
async function tapCentre(page, loc) {
  await loc.scrollIntoViewIfNeeded();
  const b = await loc.boundingBox();
  // mid-row, left-of-centre: over neither the label text nor the right-aligned value
  await page.touchscreen.tap(b.x + b.width * 0.5, b.y + b.height / 2);
  await pacedWait(page, 200);
}
async function paging(page) {
  await page.getByRole("button", { name: "Next comp" }).click(); await pacedWait(page, 150);
  await page.getByRole("button", { name: "Previous comp" }).click(); await pacedWait(page, 150);
}

for (const type of ["lease", "building_sale", "land"]) {
  console.log(`\n=== ${type} ===`);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, ignoreHTTPSErrors: true });
  await ctx.addInitScript(fixtureSeed(fixture, { id: `mobile-every-${type}` }));
  await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  await openSheet(page, PASTES[type]);
  const typeBadge = await sheet(page).innerText();
  check(`${type}: paste landed as the right type`, new RegExp(type === "building_sale" ? "bldg sale" : type, "i").test(typeBadge), "");

  const cols = [...neededToSaveColumns(type), ...mobileSections(type).flatMap((s) => s.cols)];
  // Triangle: fill Price + NOI first (Cap derives), clear NOI to free Cap, then Cap.
  const ordered = type === "building_sale"
    ? [...cols.filter((c) => c.key !== "bldgCapRate"), cols.find((c) => c.key === "bldgCapRate")]
    : cols;
  for (const col of ordered) {
    const label = mobileLabel(col);
    const tag = `${type}/${col.key} (${label})`;
    const row = rowOf(page, label, col.key);
    if (!(await row.count())) { check(`${tag}: row rendered`, false); continue; }
    if (col.kind === "action") {
      await tapCentre(page, row);
      const minimised = (await sheet(page).count()) === 0;
      check(`${tag}: tap arms the map pick`, minimised);
      if (minimised) { await page.getByRole("button", { name: "Cancel" }).last().click(); await pacedWait(page, 250); }
      continue;
    }
    if (col.kind === "derived") {
      await tapCentre(page, row);
      const opened = (await row.locator("input").count()) > 0;
      check(`${tag}: derived row stays read-only`, !opened);
      continue;
    }
    if (col.key === "bldgCapRate") {
      // free Cap by clearing NOI (price stays)
      const noiRow = rowOf(page, "NOI", "bldgBldgNoi".slice(0,0) + "bldgNoi");
      await tapCentre(page, noiRow);
      const inp = noiRow.locator("input");
      if (await inp.count()) { await inp.fill(""); await inp.press("Enter"); await pacedWait(page, 200); }
    }
    await tapCentre(page, row);
    const isSelect = col.kind === "select";
    const editor = row.locator(isSelect ? "select" : "input");
    const opened = (await editor.count()) > 0 && (isSelect || (await editor.first().isVisible()));
    if (!opened) { dead.push(tag); check(`${tag}: a tap opens an editor`, false, "DEAD"); continue; }
    check(`${tag}: a tap opens an editor`, true);
    const [val, re] = col.key === "compType" ? [type, /./] : (VALUES[col.key] || ["1", /1/]);
    if (isSelect) await editor.first().selectOption(val);
    else { await editor.first().fill(val); await editor.first().press("Enter"); }
    await pacedWait(page, 250);
    await paging(page);
    const text = await rowOf(page, label, col.key).innerText();
    check(`${tag}: value survives paging away and back`, re.test(text), JSON.stringify(text.replace(/\n/g, " | ")));
  }
  await ctx.close();
}

// Known-good arm: the Type row (a native <select>) was never broken — a run in which it did not
// report editable is VOID, not a score.
const typeArmOk = results.some((r) => /compType/.test(r.name) && r.ok && /opens an editor/.test(r.name));
if (!typeArmOk) { console.log("\nVOID: the known-good Type-select arm did not report editable — the instrument is not trustworthy."); process.exit(2); }

console.log(`\nDEAD before/at this build: ${dead.length ? dead.join("; ") : "none"}`);
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} checks passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
