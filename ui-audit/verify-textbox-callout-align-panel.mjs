#!/usr/bin/env node
/* verify-textbox-callout-align-panel — NEW-1/NEW-2/NEW-3 (B1765728/B1765729/B1765730).
 *
 *   node ui-audit/verify-textbox-callout-align-panel.mjs [--assert]
 *
 * Drives the REAL app in a headless browser (real pointer clicks/keyboard input, never a
 * synthetic-event dispatch against React state — SYNTHETIC-KEYS-DONT-EDIT's sibling caution).
 * Three unrelated fixes land in one run because they all live on the same callout/text-box
 * Properties panel and share one seeded scene:
 *
 *   NEW-1 (B1765728) — the font-size field's floor moved from 6 to 1: both the direct-entry
 *     field (type a value, blur/Enter) and the ArrowUp/ArrowDown stepper must honor it.
 *   NEW-2 (B1765729) — text boxes/callouts can now source AND receive an "Align rotation…",
 *     the same alignFor/alignToElement/alignToParcelEdge mechanism a building's own right-click
 *     menu already used. Three directions are driven for real: a text box aligning to a
 *     building, a leadered callout aligning to another text box, and a building aligning to a
 *     text box (the genuinely new capability — a building could not target a callout before).
 *   NEW-3 (B1765730) — the bold/italic/underline + align-left/center/right controls collapsed
 *     from two full-width flex:1 rows (six large boxes) into one row of small fixed-size icon
 *     buttons; checked structurally (one row, not two) and geometrically (each button is small).
 */
import { chromium } from "playwright";
import { readFixture } from "./lib/fixtureSeeding.mjs";
import { fixtureSeed } from "./lib/planFixture.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { waitForSelectorReleased } from "./lib/waitRelease.mjs";

const BASE = process.env.PLANYR_BASE || "http://127.0.0.1:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
const SITE_ID = "smverifalignp1";
const ASSERT = process.argv.includes("--assert");
let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ✓ ${m}`); pass++; };
const bad = (m) => { console.error(`  ✗ ${m}`); fail++; };

// A dedicated cluster, well clear of the rest of the richfield fixture's ~106 elements.
const BLDG = { id: "zzAlignBldg", cx: 6200, cy: -4200, w: 220, h: 120, rot: 40 };
const BOX1 = { id: "zzAlignBox", x: 6600, y: -4200 };      // source in test A (→ building)
const BOX2 = { id: "zzAlignBox2", x: 6600, y: -3900, rot: 70 }; // fixed-angle target, used in B and C
const CALLOUT = { id: "zzAlignCallout", x: 6900, y: -4200, tip: { x: 6960, y: -4160 } }; // leadered, source in test B

// Click a point on the building's own filled shape, away from its centred area-SF label overlay
// (a separate sibling <g> painted on top — a plain single click landing on it does not bubble to
// the shape's own onPointerDown, unlike the double-click resolver's chrome forwarding). The
// building is rotated, so its bounding box is not the shape — a fixed corner-ish offset can land
// outside the rotated polygon entirely. Scan a small grid inside the bounding box for a point
// whose real elementFromPoint hit is the shape's own <path>, not the label group.
async function clickBuildingBody(page, opts = {}) {
  const pt = await page.evaluate((id) => {
    const host = document.querySelector(`[data-feature="el:${id}"]`);
    const bb = host.getBoundingClientRect();
    for (let fx = 0.1; fx <= 0.9; fx += 0.05) {
      for (let fy = 0.1; fy <= 0.9; fy += 0.05) {
        const x = bb.x + bb.width * fx, y = bb.y + bb.height * fy;
        const hit = document.elementFromPoint(x, y);
        if (!hit) continue;
        // The label overlay is a SEPARATE sibling <g> that also carries this same data-feature
        // attribute, so closest() alone can't tell them apart — compare the resolved ancestor
        // node identity to `host` (the FIRST such node in DOM order, i.e. the shape itself).
        if (hit.closest(`[data-feature="el:${id}"]`) === host) return { x, y };
      }
    }
    return null;
  }, BLDG.id);
  if (!pt) throw new Error(`clickBuildingBody: could not find a screen point that hits ${BLDG.id}'s own shape`);
  await page.mouse.click(pt.x, pt.y, opts.button ? { button: opts.button } : undefined);
}

function withScene(fx) {
  const f = JSON.parse(JSON.stringify(fx));
  f.els = (f.els || []).concat([
    { id: BLDG.id, type: "building", cx: BLDG.cx, cy: BLDG.cy, w: BLDG.w, h: BLDG.h, rot: BLDG.rot, z: 900000, dock: "none" },
  ]);
  f.callouts = (f.callouts || []).concat([
    { id: BOX1.id, z: 900000, box: { x: BOX1.x, y: BOX1.y }, text: "Align source", noLeader: true, rot: 0 },
    { id: BOX2.id, z: 900000, box: { x: BOX2.x, y: BOX2.y }, text: "Fixed target", noLeader: true, rot: BOX2.rot, size: 13 },
    { id: CALLOUT.id, z: 900000, box: { x: CALLOUT.x, y: CALLOUT.y }, tip: CALLOUT.tip, text: "Leadered source", rot: 0 },
  ]);
  return f;
}

// mod-90 congruence with a small tolerance — "parallel", regardless of which of the four
// 90°-equivalent orientations snapParallel picked (that tie-break is not what this checks).
const parallelTo = (a, b, tolDeg = 1.0) => {
  const d = (((a - b) % 90) + 90) % 90;
  return Math.min(d, 90 - d) <= tolDeg;
};

async function readModel(page) {
  return page.evaluate(() => {
    const site = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const s = Object.values(site)[0] || {};
    return { els: s.els || [], callouts: s.callouts || [] };
  });
}

async function run() {
  const fixture = withScene(readFixture("richfield"));
  const browser = await chromium.launch({ headless: true, executablePath: EXEC, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(fixtureSeed(fixture, { id: SITE_ID, pdfStorage: false }));
  await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
  await ctx.route(/^https?:\/\//, (route) => {
    const u = route.request().url();
    if (u.startsWith(BASE)) return route.continue();
    return route.abort();
  });

  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-textbox-callout-align-panel");
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE + `#/project/${SITE_ID}/site`, { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "load" });
  await waitForSelectorReleased(page, "svg[data-view-ppf]", { timeout: 30000 });
  await page.evaluate(([x, y]) => window.__plannerView?.centerOn(x, y, 0.55), [BOX1.x + 400, (BLDG.cy + CALLOUT.y) / 2]);
  await pacedWait(page, 1000);

  const before = await readModel(page);
  const bldgBefore = before.els.find((e) => e.id === BLDG.id);
  console.log(`  seeded: building rot=${bldgBefore?.rot}, box1 rot=${before.callouts.find((c) => c.id === BOX1.id)?.rot}, box2 rot=${before.callouts.find((c) => c.id === BOX2.id)?.rot}, callout rot=${before.callouts.find((c) => c.id === CALLOUT.id)?.rot}`);

  // ============================= NEW-2: align-rotation participation =============================

  // --- Test A: a TEXT BOX as align SOURCE, a BUILDING as the target. ---
  await page.locator(`[data-testid="callout-box-${BOX1.id}"]`).click({ button: "right" });
  await pacedWait(page, 250);
  const alignRowA = page.locator('.menu button', { hasText: "Align rotation…" });
  if (await alignRowA.count()) ok("callout right-click menu offers \"Align rotation…\" (NEW-2)");
  else { bad("callout right-click menu has NO \"Align rotation…\" row — aborting NEW-2 checks"); }
  if (await alignRowA.count()) {
    await alignRowA.click();
    await pacedWait(page, 200);
    // Click the building to supply the target angle.
    await clickBuildingBody(page);
    await pacedWait(page, 300);
    const m = await readModel(page);
    const box1 = m.callouts.find((c) => c.id === BOX1.id);
    const bldg = m.els.find((e) => e.id === BLDG.id);
    console.log(`  test A: box1.rot ${before.callouts.find((c) => c.id === BOX1.id)?.rot} -> ${box1?.rot} (building stayed at ${bldg?.rot})`);
    if (box1 && parallelTo(box1.rot || 0, BLDG.rot)) ok(`a text box aligned its rotation to a building (box1.rot=${box1.rot}, parallel to building's ${BLDG.rot}°)`);
    else bad(`text box did NOT align to the building (box1.rot=${box1?.rot}, expected parallel to ${BLDG.rot}°)`);
    if (bldg && bldg.rot === BLDG.rot) ok("the building (the target, not the source) kept its own rotation unchanged");
    else bad(`the building's rotation changed unexpectedly (${bldg?.rot}, was ${BLDG.rot}) — a target must never be rewritten`);
  }

  // --- Test B: a LEADERED CALLOUT as align SOURCE, another TEXT BOX as the target. ---
  await page.locator(`[data-testid="callout-box-${CALLOUT.id}"]`).click({ button: "right" });
  await pacedWait(page, 250);
  const alignRowB = page.locator('.menu button', { hasText: "Align rotation…" });
  if (await alignRowB.count()) {
    await alignRowB.click();
    await pacedWait(page, 200);
    await page.locator(`[data-testid="callout-box-${BOX2.id}"]`).click();
    await pacedWait(page, 300);
    const m = await readModel(page);
    const callout = m.callouts.find((c) => c.id === CALLOUT.id);
    const box2 = m.callouts.find((c) => c.id === BOX2.id);
    console.log(`  test B: callout.rot 0 -> ${callout?.rot} (target box2 stayed at ${box2?.rot})`);
    if (callout && parallelTo(callout.rot || 0, BOX2.rot)) ok(`a leadered callout aligned its rotation to another text box (callout.rot=${callout.rot}, parallel to ${BOX2.rot}°)`);
    else bad(`leadered callout did NOT align to the target text box (callout.rot=${callout?.rot}, expected parallel to ${BOX2.rot}°)`);
    if (box2 && box2.rot === BOX2.rot) ok("the target text box kept its own rotation unchanged");
    else bad(`the target text box's rotation changed unexpectedly (${box2?.rot}, was ${BOX2.rot})`);
  } else bad("leadered callout's right-click menu has NO \"Align rotation…\" row");

  // --- Test C: a BUILDING as align SOURCE, a TEXT BOX as the target — the genuinely new
  //     capability (a building previously could only target another element or a parcel edge). ---
  await clickBuildingBody(page, { button: "right" });
  await pacedWait(page, 250);
  const alignRowC = page.locator('.menu button', { hasText: "Align rotation…" });
  if (await alignRowC.count()) {
    await alignRowC.click();
    await pacedWait(page, 200);
    await page.locator(`[data-testid="callout-box-${BOX2.id}"]`).click();
    await pacedWait(page, 300);
    const m = await readModel(page);
    const bldg = m.els.find((e) => e.id === BLDG.id);
    const box2 = m.callouts.find((c) => c.id === BOX2.id);
    console.log(`  test C: building.rot ${BLDG.rot} -> ${bldg?.rot} (target box2 stayed at ${box2?.rot})`);
    if (bldg && parallelTo(bldg.rot || 0, BOX2.rot)) ok(`a building aligned its rotation to a text box (building.rot=${bldg.rot}, parallel to ${BOX2.rot}°) — the new target capability works`);
    else bad(`building did NOT align to the text-box target (building.rot=${bldg?.rot}, expected parallel to ${BOX2.rot}°)`);
    if (box2 && box2.rot === BOX2.rot) ok("the text-box target kept its own rotation unchanged (test C)");
    else bad(`the text-box target's rotation changed unexpectedly in test C (${box2?.rot}, was ${BOX2.rot})`);
  } else bad("building's right-click menu has NO \"Align rotation…\" row (regression check)");

  // ============================= NEW-1 / NEW-3: the Properties panel =============================

  // Open BOX1's Properties panel (its rotation is now whatever test A left it at — irrelevant here).
  await page.locator(`[data-testid="callout-box-${BOX1.id}"]`).click({ button: "right" });
  await pacedWait(page, 200);
  await page.locator('.menu button', { hasText: "Properties…" }).first().click();
  await pacedWait(page, 400);

  const panel = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-field-group="1"]')];
    const find = (label) => rows.find((r) => r.firstElementChild?.textContent?.trim() === label);
    const sizeRow = find("Size");
    const styleRow = find("Style");
    const alignRow = find("Align");
    const sizeInput = sizeRow ? sizeRow.querySelector("input") : null;
    const styleButtons = styleRow ? [...styleRow.querySelectorAll("button")] : [];
    const rects = styleButtons.map((b) => { const r = b.getBoundingClientRect(); return { w: r.width, h: r.height, title: b.getAttribute("title") }; });
    return {
      hasSizeInput: !!sizeInput,
      hasSeparateAlignRow: !!alignRow,
      styleButtonCount: styleButtons.length,
      styleButtonRects: rects,
    };
  });
  console.log(`  panel structure: ${JSON.stringify(panel)}`);

  // --- NEW-3 structural checks ---
  if (!panel.hasSeparateAlignRow) ok("Style and Align are ONE row now, not two separate Field rows (NEW-3)");
  else bad("a separate \"Align\" Field row still exists — Style/Align were not merged into one row");
  if (panel.styleButtonCount === 6) ok(`the merged row holds exactly 6 buttons (B/I/U + 3 align), found ${panel.styleButtonCount}`);
  else bad(`expected 6 buttons in the merged Style row, found ${panel.styleButtonCount}`);
  const oversized = panel.styleButtonRects.filter((r) => r.w > 40 || r.h > 40);
  if (panel.styleButtonRects.length && oversized.length === 0) ok(`every style/align button is small (≤40px either dimension) — was flex:1-stretched before; sizes: ${panel.styleButtonRects.map((r) => `${r.w.toFixed(0)}x${r.h.toFixed(0)}`).join(", ")}`);
  else bad(`some style/align buttons are still oversized: ${JSON.stringify(oversized)}`);

  // --- NEW-3 functional check: the compacted buttons still work. ---
  const beforeStyle = (await readModel(page)).callouts.find((c) => c.id === BOX1.id);
  await page.locator('button[title="Bold"]').first().click();
  await page.locator('button[title="Align right"]').first().click();
  await pacedWait(page, 250);
  const afterStyle = (await readModel(page)).callouts.find((c) => c.id === BOX1.id);
  if (afterStyle.bold === !(beforeStyle.bold || false)) ok(`the compacted Bold button still toggles the model (bold: ${beforeStyle.bold || false} -> ${afterStyle.bold})`);
  else bad(`Bold button click did not toggle the model (before=${beforeStyle.bold}, after=${afterStyle.bold})`);
  if (afterStyle.align === "right") ok("the compacted Align-right button still sets the model (align: right)");
  else bad(`Align-right click did not set align (got "${afterStyle.align}")`);

  // --- NEW-1: the font-size floor. Direct entry below 1 clamps UP to 1 (never rejects, never
  //     goes below it); the same field's ArrowDown stepper cannot push it any lower either. ---
  if (panel.hasSizeInput) {
    const sizeInput = page.locator('[data-field-group="1"]').filter({ hasText: "Size" }).locator("input");
    await sizeInput.click();
    await sizeInput.fill("0");
    await sizeInput.press("Enter");
    await pacedWait(page, 200);
    const afterZero = (await readModel(page)).callouts.find((c) => c.id === BOX1.id);
    console.log(`  size after typing "0" + Enter: ${afterZero.size}`);
    if (afterZero.size === 1) ok('typing "0" into Size clamps UP to the new floor of 1 (was floored at 6 before)');
    else bad(`typing "0" into Size committed ${afterZero.size}, expected the floor value 1`);

    // Stepper: already at the floor (1) — ArrowDown must not be able to go below it.
    await sizeInput.press("ArrowDown");
    await pacedWait(page, 200);
    const afterStepDown = (await readModel(page)).callouts.find((c) => c.id === BOX1.id);
    console.log(`  size after ArrowDown at the floor: ${afterStepDown.size}`);
    if (afterStepDown.size === 1) ok("the ArrowDown stepper honors the same floor — stays at 1, does not go negative/zero");
    else bad(`ArrowDown at the floor produced ${afterStepDown.size}, expected it to stay clamped at 1`);

    // Direct entry can reach exactly 1 as a typed value too (not just via clamping from below).
    await sizeInput.click();
    await sizeInput.fill("1");
    await sizeInput.press("Enter");
    await pacedWait(page, 200);
    const afterOne = (await readModel(page)).callouts.find((c) => c.id === BOX1.id);
    if (afterOne.size === 1) ok('typing "1" directly into Size is accepted (the field no longer floors at 6)');
    else bad(`typing "1" into Size committed ${afterOne.size}, expected 1`);
  } else bad("could not find the Size field's input — NEW-1 floor could not be checked");

  if (errors.length === 0) ok("no JS crash");
  else bad(`JS errors: ${errors.slice(0, 3).join("; ")}`);

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (ASSERT && fail) process.exit(1);
  process.exit(0);
}
run().catch((e) => { console.error(e); process.exit(1); });
