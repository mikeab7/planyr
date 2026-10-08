#!/usr/bin/env node
/* verify-comp-sheet-review-first — NEW-1 + NEW-2 (2026-10-05).
 *   NEW-1: the page-containment guard must not undo Safari's keyboard lift (focused field → scroll
 *          stays; blurred → still snaps back, drag protection intact).
 *   NEW-2: the review-first phone comp sheet, for lease / land / building sale, iPhone 13 descriptor.
 *
 *   node ui-audit/verify-comp-sheet-review-first.mjs --live https://planyr.io [--shots DIR]   (signed in as the test account)
 *   node ui-audit/verify-comp-sheet-review-first.mjs --url http://localhost:4319/              (signed out, fixture plan)
 * Nothing is saved: rows live only in the open sheet, which is cancelled at the end. */
import { chromium, devices } from "playwright";
import { readFixture } from "./lib/fixtureSeeding.mjs";
import { fixtureSeed } from "./lib/planFixture.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const LIVE = arg("--live", null);
const BASE = LIVE || arg("--url", "http://localhost:4319/");
const SHOTS = arg("--shots", null);
const root = BASE.replace(/\/$/, "");
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };

async function newPhone() {
  if (LIVE) {
    const s = await openSignedIn({ base: root, viewport: devices["iPhone 13"].viewport, contextOptions: { ...devices["iPhone 13"] } });
    console.log(`signed in as ${s.proof.email} · build ${JSON.stringify(s.build)}`);
    return { page: s.page, close: s.close, build: s.build };
  }
  const exe = process.env.PW_CHROME || "/opt/pw-browsers/chromium";
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  await ctx.addInitScript(fixtureSeed(readFixture("bain"), { id: "review-first" }));
  await ctx.route("**/*", (route) => (route.request().url().startsWith(root) ? route.continue() : route.abort()));
  return { page: await ctx.newPage(), close: () => browser.close() };
}

async function openSheet(page) {
  await page.goto(`${root}/#/site`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForLoadState("load").catch(() => {});
  await pacedWait(page, 5000);
  for (let i = 0; ; i++) { // a signed-in boot can reload once; retry the precondition across it
    try { await assertMeasurable(page, "verify-comp-sheet-review-first"); break; } catch (e) { if (i >= 3 || !/context was destroyed|navigation/i.test(String(e))) throw e; await pacedWait(page, 2500); }
  }
  const tab = page.getByRole("tab", { name: /^Records/ }).first();
  if ((await tab.getAttribute("aria-selected")) !== "true") await tab.evaluate((el) => el.click()); // in-page click: a map-layers chip overlaps the tab at phone width
  await pacedWait(page, 500);
  await page.getByText("＋ Paste comps", { exact: true }).click();
  await pacedWait(page, 500);
}
async function paste(page, line) {
  const ta = page.locator("textarea").first();
  await ta.click();
  await ta.fill(line);
  await page.keyboard.press("Enter");
  await pacedWait(page, 700);
}
const footer = (page) => page.locator('[data-footer-readback="1"]').innerText();
const mobile = (page) => page.locator('[data-comp-entry-mobile="1"]').count();

const CASES = [
  { type: "land", line: "West Hardy tract, 42.5 AC, $9,250,000, closed 3/14/2026", footer: /42\.5 AC.*\$9,250,000.*\$5\.00\/SF/, unit: true },
  { type: "lease", line: "120,000 SF industrial lease, $6.25/SF/yr NNN, 64 month term", footer: /\$6\.25\/SF\/yr NNN.*120,000 SF.*64 mo/, unit: false },
  { type: "building_sale", line: "Katy building sale, $9,250,000, 120,000 SF", footer: /120,000 SF.*\$9,250,000.*\$77\.08\/SF/, unit: false },
];

const { page, close } = await newPhone();
await page.addInitScript(() => {}); // (placeholder so the context is touched before navigation)

for (const c of CASES) {
  console.log(`\n=== ${c.type} ===`);
  await openSheet(page);
  await paste(page, c.line);
  check(`${c.type}: phone sheet rendered, paste panel closed after the paste`, (await mobile(page)) === 1 && (await page.locator('[data-paste-panel="1"]').count()) === 0);
  const body = await page.locator('[data-comp-entry-mobile="1"]').innerText();
  check(`${c.type}: no "Needed to save" anywhere`, !/needed to save|before you save/i.test(body));
  check(`${c.type}: no separate Unit row`, (await page.locator('[data-field-key="landSizeUnit"]').count()) === 0);
  const toggle = await page.locator('[aria-label="Size unit"]').count();
  check(`${c.type}: AC|SF toggle ${c.unit ? "present" : "absent"}`, c.unit ? toggle === 1 : toggle === 0);
  if (c.type === "lease") {
    check("lease: Monthly|Yearly, NNN|Gross and months|years toggles present",
      (await page.locator('[aria-label="Rate period"]').count()) === 1 && (await page.locator('[aria-label="Rate basis"]').count()) === 1 && (await page.locator('[aria-label="Term unit"]').count()) === 1);
  }
  check(`${c.type}: "Place on map" before arming`, /Place on map/.test(await page.locator('[data-field-key="location"]').innerText()));
  const fb = await footer(page);
  check(`${c.type}: footer read-back matches pasted values`, c.footer.test(fb), fb);
  const saveTxt = await page.locator('[data-save-button="1"]').innerText();
  check(`${c.type}: Save copy while unplaced`, /Place it on the map to save|Pick mo or yr/.test(saveTxt), saveTxt);

  // (e) an empty "Clear height" chip mounts a focused input (building_sale + lease only)
  if (c.type !== "land") {
    const chip = page.locator('[data-add-chip="clearHeightFt"]');
    check(`${c.type}: Clear height chip present`, (await chip.count()) === 1);
    if (await chip.count()) {
      await chip.click();
      await pacedWait(page, 250);
      const focusedLabel = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
      check(`${c.type}: tapping the chip mounts a FOCUSED input`, focusedLabel === "Clear height", String(focusedLabel));
      await page.keyboard.press("Escape");
    }
  }
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${c.type}-rest.png` });

  // (c) pick on the map → "Place on map" ABSENT afterwards
  await page.locator('[data-field-key="location"]').click();
  await pacedWait(page, 400);
  check(`${c.type}: arming minimises the sheet to the banner`, (await mobile(page)) === 0);
  const mapBox = await page.locator(".leaflet-container").first().boundingBox();
  if (mapBox) {
    await page.touchscreen.tap(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 3);
    await pacedWait(page, 4200);
  }
  check(`${c.type}: sheet restored after the pick`, (await mobile(page)) === 1);
  if ((await mobile(page)) === 1) {
    const loc = await page.locator('[data-field-key="location"]').innerText();
    check(`${c.type}: "Place on map" ABSENT after the pick`, !/Place on map/.test(loc), loc.replace(/\n/g, " | "));
    const s2 = await page.locator('[data-save-button="1"]').innerText();
    if (c.type !== "lease") check(`${c.type}: Save enabled after placement`, /^Save \d+ comp/.test(s2), s2);
  }
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${c.type}-placed.png` });
  // leave: Cancel (discard prompt may appear — keep it test-artifact clean)
  await page.getByRole("button", { name: "Cancel", exact: true }).first().click().catch(() => {});
  await pacedWait(page, 300);
  const discard = page.getByRole("button", { name: /discard/i }).first();
  if (await discard.count()) await discard.click();
  await pacedWait(page, 300);
}

console.log("\n=== NEW-1: keyboard lift is not undone by the page-containment guard ===");
await openSheet(page);
await paste(page, CASES[2].line);
const input = page.locator('[data-comp-entry-mobile="1"] input[data-sheet-input]').first();
// The literal reading (focus → scrollTo(0,280) → read scrollY) is VACUOUS here: html/body are
// position:fixed, so the document has no scrollable range in Chromium and scrollY can never leave 0
// whether or not the guard runs (real iOS scrolls a fixed document anyway — that is the bug). It is
// recorded for the V#, but the verdict is taken from the guard's own act: does it call
// window.scrollTo(0,0) for a scroll the browser reports while the keyboard is the reason?
const probe = (fakeY) => page.evaluate(async (y) => {
  const calls = [];
  const orig = window.scrollTo;
  window.scrollTo = (...a) => { calls.push(a.join(",")); };
  Object.defineProperty(window, "scrollY", { configurable: true, get: () => y });
  window.dispatchEvent(new Event("scroll"));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  delete window.scrollY;
  window.scrollTo = orig;
  return { calls, ae: document.activeElement?.tagName };
}, fakeY);
await input.focus();
await page.evaluate(() => window.scrollTo(0, 280));
await pacedWait(page, 300);
const literalFocused = await page.evaluate(() => ({ y: window.scrollY, range: document.documentElement.scrollHeight - innerHeight }));
const focusedProbe = await probe(280);
await input.evaluate((el) => el.blur());
await pacedWait(page, 150);
const blurredProbe = await probe(280);
console.log("   literal reading, focused: scrollY", literalFocused.y, "(scrollable range", literalFocused.range + ") — vacuous, fixed body");
console.log("   focused probe:", JSON.stringify(focusedProbe), " blurred probe:", JSON.stringify(blurredProbe));
check("focused input + browser-reported scroll 280: guard does NOT call scrollTo (no snap)", focusedProbe.ae === "INPUT" && focusedProbe.calls.length === 0, JSON.stringify(focusedProbe));
check("blurred + browser-reported scroll 280: guard snaps back with scrollTo(0,0) (drag protection intact)", blurredProbe.calls.includes("0,0"), JSON.stringify(blurredProbe));

await close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length) { console.log("FAILED:", failed.map((f) => f.name).join(" | ")); process.exit(1); }
