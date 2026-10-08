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
  check(`${c.type}: Save copy while unplaced`, /Place it on the map to save|Pick monthly or yearly to save/.test(saveTxt), saveTxt);

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

/* ---- B2138081 follow-ups (2026-10-08): header name, segmented type, spacing, Save copy, land Price ---- */
console.log("\n=== follow-ups: header name · type control · lease spacing · land Save copy + Price ===");
const seg = (g, v) => page.locator(`[aria-label="${g}"] [data-seg-value="${v}"]`);
const box = (loc) => loc.first().boundingBox();
const placeOnMap = async () => {
  await page.locator('[data-field-key="location"]').click();
  await pacedWait(page, 400);
  const mb = await page.locator(".leaflet-container").first().boundingBox();
  if (mb) { await page.touchscreen.tap(mb.x + mb.width / 2, mb.y + mb.height / 3); await pacedWait(page, 4200); }
};
await openSheet(page);
await paste(page, "120,000 SF industrial lease, $6.25/SF NNN, 64 month term"); // no period → a blocking lease flag, on purpose
// (a) the header name is a text input; tapping it focuses it and opens no picker
check("(a) header has NO <select> anywhere in the sheet", (await page.locator('[data-comp-entry-mobile="1"] select').count()) === 0);
const nb = await box(page.locator('[data-deal-name="1"]'));
await page.touchscreen.tap(nb.x + 20, nb.y + nb.height / 2);
await pacedWait(page, 300);
const focusedName = await page.evaluate(() => { const a = document.activeElement; return a && a.tagName === "INPUT" && a.getAttribute("data-deal-name") === "1"; });
check("(a) tapping the header name focuses a text input", focusedName);
await page.keyboard.type("Cypress test deal");
await page.keyboard.press("Enter");
await pacedWait(page, 300);
check("(a) the typed name stays in the header input", (await page.locator('[data-deal-name="1"]').inputValue()) === "Cypress test deal");
check("(a) no `Name` row in the Deal group", (await page.locator('[data-field-key="title"][data-field-editor]').count()) === 0 && !(await page.locator('[data-comp-entry-mobile="1"] label span', { hasText: /^Name$/ }).count()));
check("(a) the header input sits above the Deal group's Location row", (await box(page.locator('[data-deal-name="1"]'))).y < (await box(page.locator('[data-field-key="location"]'))).y);
// (c) lease spacing (set a rate first)
const rate = page.locator('[data-field-key="leaseRate"] input');
await rate.tap(); await rate.fill("0.62"); await page.keyboard.press("Escape"); await rate.fill("0.62"); await rate.blur();
await pacedWait(page, 300);
const g = await page.evaluate(() => {
  const row = document.querySelector('[data-field-key="leaseRate"]');
  const spans = [...row.querySelectorAll("span")];
  const label = spans[0].getBoundingClientRect();
  const dollar = spans.find((e) => e.textContent === "$")?.getBoundingClientRect();
  const sf = spans.find((e) => e.textContent === "/SF")?.getBoundingClientRect();
  const input = row.querySelector("input").getBoundingClientRect();
  const per = document.querySelector('[aria-label="Rate period"]').getBoundingClientRect();
  const bas = document.querySelector('[aria-label="Rate basis"]').getBoundingClientRect();
  return { label: label.left, dollarRight: dollar?.right, inputLeft: input.left, sfRight: sf?.right, perLeft: per.left, perW: per.width, basRight: bas.right, basW: bas.width, gap: bas.left - per.right };
});
console.log("   lease geometry:", JSON.stringify(g));
check("(c) `$` hugs the rate number (right edge within 6px of the number's left edge)", g.dollarRight != null && Math.abs(g.inputLeft - g.dollarRight) <= 6, `gap ${(g.inputLeft - g.dollarRight).toFixed(1)}px`);
check("(c) Monthly|Yearly left edge lines up with the Rate label", Math.abs(g.perLeft - g.label) <= 1.5, `${g.perLeft} vs ${g.label}`);
check("(c) Yearly/Gross group right edge lines up with the value's right edge", Math.abs(g.basRight - g.sfRight) <= 2, `${g.basRight} vs ${g.sfRight}`);
check("(c) the two toggle groups are equal width with a 16px gap", Math.abs(g.perW - g.basW) <= 1.5 && Math.abs(g.gap - 16) <= 1.5, `${g.perW}/${g.basW} gap ${g.gap}`);
const hts = await page.evaluate(() => ["Comp type", "Rate period", "Rate basis", "Term unit"].map((n) => Math.round(document.querySelector(`[aria-label="${n}"]`).getBoundingClientRect().height)));
check("(c) Term's toggle has the same height as the rate toggles", new Set(hts).size === 1, hts.join("/"));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/followup-lease-rest.png` });
// (b) the segmented type control switches lease → land → bldg sale and the fields change
await seg("Comp type", "land").tap(); await pacedWait(page, 300);
check("(b) → Land: AC|SF toggle appears, Rate row gone", (await page.locator('[aria-label="Size unit"]').count()) === 1 && (await page.locator('[data-field-key="leaseRate"]').count()) === 0);
check("(b) the Land → AC default fired", (await page.locator('[aria-label="Size unit"] [aria-pressed="true"]').getAttribute("data-seg-value")) === "ac");
await seg("Comp type", "building_sale").tap(); await pacedWait(page, 300);
check("(b) → Bldg sale: Price + NOI rows, no AC|SF toggle", (await page.locator('[data-field-key="price"]').count()) === 1 && (await page.locator('[data-field-key="bldgNoi"]').count() + await page.locator('[data-add-chip="bldgNoi"]').count()) === 1 && (await page.locator('[aria-label="Size unit"]').count()) === 0);
await seg("Comp type", "lease").tap(); await pacedWait(page, 300);
check("(b) → Lease: Rate period toggle is back", (await page.locator('[aria-label="Rate period"]').count()) === 1);
check("(b) the name survived the type switches", (await page.locator('[data-deal-name="1"]').inputValue()) === "Cypress test deal");
// (d)+(e) land with location placed and size/price empty (the lease's stale period flag must not leak)
await seg("Comp type", "land").tap(); await pacedWait(page, 300);
const unplaced = await page.locator('[data-save-button="1"]').innerText();
check("(d) land, unplaced: Save copy names the map, not mo/yr", /Place it on the map to save/.test(unplaced), unplaced);
await placeOnMap();
if ((await mobile(page)) === 1) {
  const landSave = await page.locator('[data-save-button="1"]').innerText();
  check("(d) land, placed, size/price empty: Save copy never says mo/yr (it is saveable)", !/mo or yr|monthly or yearly/i.test(landSave) && /^Save 1 comp/.test(landSave), landSave);
  const price = page.locator('[data-field-key="price"]');
  const pin = price.locator("input");
  check("(e) land Price is a mounted input with the `Add` placeholder", (await pin.count()) === 1 && (await pin.getAttribute("placeholder")) === "Add" && (await price.getAttribute("data-field-editor")) === "text" && !/—/.test(await price.innerText()));
  const sizeG = await page.evaluate(() => { const r = document.querySelector('[data-field-key="size"]'); return { h: r.querySelector('[aria-label="Size unit"]').getBoundingClientRect().height, term: 0 }; });
  check("(e) land AC|SF toggle is the same height as the other toggles", sizeG.h === hts[0], `${sizeG.h} vs ${hts[0]}`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/followup-land-rest.png` });
} else check("(d) sheet restored after the pick", false);
await page.getByRole("button", { name: "Cancel", exact: true }).first().click().catch(() => {});
await pacedWait(page, 300);
{ const dd = page.getByRole("button", { name: /discard/i }).first(); if (await dd.count()) await dd.click(); }
await pacedWait(page, 300);

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
