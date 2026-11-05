#!/usr/bin/env node
/* verify-comp-sheet-review-first — NEW-1 + NEW-2 (2026-10-05), round 3 (2026-10-19, NEW-1..NEW-11).
 *   NEW-1: the page-containment guard must not undo Safari's keyboard lift (focused field → scroll
 *          stays; blurred → still snaps back, drag protection intact).
 *   NEW-2: the review-first phone comp sheet, for lease / land / building sale, iPhone 13 descriptor.
 *
 *   node ui-audit/verify-comp-sheet-review-first.mjs --live https://planyr.io [--shots DIR]   (signed in as the test account)
 *   node ui-audit/verify-comp-sheet-review-first.mjs --url http://localhost:4319/              (signed out, fixture plan)
 * Nothing is saved: rows live only in the open sheet, which is cancelled at the end. Round 3 drives the
 * Save path, so every non-GET Supabase REST call is STUBBED for the whole run (installed once, never
 * removed — a tracked-site sync journalled by a save must not flush to the real cloud after the stub
 * comes off); a POST to /comps is counted, never persisted. The save-reaches-the-call checks are live-only
 * (a signed-out local run has no Supabase client to call). */
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
const compPosts = []; // every stubbed POST to /comps (live only)
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };

async function newPhone() {
  if (LIVE) {
    const s = await openSignedIn({ base: root, viewport: devices["iPhone 13"].viewport, contextOptions: { ...devices["iPhone 13"] } });
    console.log(`signed in as ${s.proof.email} · build ${JSON.stringify(s.build)}`);
    await s.page.context().route((u) => /\/rest\/v1\//.test(u.href), (route) => {
      const req = route.request();
      if (req.method() === "GET" || req.method() === "HEAD") return route.continue();
      if (req.method() === "POST" && /\/rest\/v1\/comps(\?|$)/.test(req.url())) compPosts.push(req.postData() || "");
      return route.fulfill({ status: 201, contentType: "application/json", body: "[]" });
    });
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
  { type: "land", line: "West Hardy tract, 42.5 AC, $9,250,000, closed 3/14/2026", footer: /42\.5 AC.*\$9,250,000.*\$5\.00\/SF/, unit: true, a: "Buyer", b: "Seller", date: "Closing date" },
  { type: "lease", line: "120,000 SF industrial lease, $6.25/SF/yr NNN, 64 month term", footer: /\$6\.25\/SF\/yr NNN.*120,000 SF.*64 mo/, unit: false, a: "Tenant", b: "Landlord", date: "Date signed" },
  { type: "building_sale", line: "Katy building sale, $9,250,000, 120,000 SF", footer: /120,000 SF.*\$9,250,000.*\$77\.08\/SF/, unit: false, a: "Buyer", b: "Seller", date: "Closing date" },
];

const { page, close } = await newPhone();
await page.addInitScript(() => {}); // (placeholder so the context is touched before navigation)

const seg = (g, v) => page.locator(`[aria-label="${g}"] [data-seg-value="${v}"]`);
const pill = (k) => page.locator(`[data-pill="${k}"]`);
const pillInfo = (k) => pill(k).evaluate((el) => ({ text: el.textContent, tone: el.getAttribute("data-pill-tone"), border: getComputedStyle(el).borderTopStyle })).catch(() => null);
const hint = (k) => page.locator(`[data-hint="${k}"]`);
const saveBtn = () => page.locator('[data-save-button="1"]');
// is the element fully inside the visible scroll area (above the sticky footer, below the top bar)?
const inView = (sel) => page.evaluate((q) => {
  const el = document.querySelector(`[data-comp-entry-mobile="1"] ${q}`);
  const foot = document.querySelector('[data-save-button="1"]').getBoundingClientRect().top;
  const bar = document.querySelector('[data-comp-entry-mobile="1"] button').getBoundingClientRect().bottom;
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.top >= bar - 1 && r.bottom <= foot + 1;
}, sel);
const scrollSheetToEnd = () => page.evaluate(() => { const sc = document.querySelector('[data-save-button="1"]').parentElement.previousElementSibling; sc.scrollTop = sc.scrollHeight; return sc.scrollHeight - sc.clientHeight; });
const placeOnMap = async (viaWarn = false) => {
  await (viaWarn ? hint("location-warn") : page.locator('[data-field-key="location"]')).click();
  await pacedWait(page, 400);
  const mb = await page.locator(".leaflet-container").first().boundingBox();
  if (mb) { await page.touchscreen.tap(mb.x + mb.width / 2, mb.y + mb.height / 3); await pacedWait(page, 4200); }
};
const leave = async () => {
  await page.getByRole("button", { name: "Cancel", exact: true }).first().click().catch(() => {});
  await pacedWait(page, 300);
  const dd = page.getByRole("button", { name: /discard/i }).first();
  if (await dd.count()) await dd.click();
  await pacedWait(page, 300);
};
const setRate = async (v) => {
  const rate = page.locator('[data-field-key="leaseRate"] input');
  await rate.tap(); await rate.fill(v); await rate.evaluate((el) => el.blur());
  await pacedWait(page, 450);
};

for (const c of CASES) {
  console.log(`\n=== ${c.type} ===`);
  await openSheet(page);
  await paste(page, c.line);
  check(`${c.type}: phone sheet rendered, paste panel closed after the paste`, (await mobile(page)) === 1 && (await page.locator('[data-paste-panel="1"]').count()) === 0);
  const body = await page.locator('[data-comp-entry-mobile="1"]').innerText();
  check(`${c.type}: no "Needed to save" anywhere`, !/needed to save|before you save/i.test(body));
  check(`${c.type}: no Parties section`, !/^parties$/im.test(body));
  check(`${c.type}: no "Nothing entered yet" text`, !/nothing entered yet/i.test(body));
  check(`${c.type}: type control reads "Bldg Sale" (capital S)`, (await seg("Comp type", "building_sale").innerText()) === "Bldg Sale");
  check(`${c.type}: no separate Unit row`, (await page.locator('[data-field-key="landSizeUnit"]').count()) === 0);
  const toggle = await page.locator('[aria-label="Size unit"]').count();
  check(`${c.type}: AC|SF toggle ${c.unit ? "present" : "absent"}`, c.unit ? toggle === 1 : toggle === 0);
  // Deal group order: Location, Tenant/Buyer, Landlord/Seller, Size
  const ys = await page.evaluate(([a, b]) => ["location", "partyAcquirer", "partyProvider", "size"].map((k) => document.querySelector(`[data-field-key="${k}"]`)?.getBoundingClientRect().top ?? -1), [c.a, c.b]);
  const labels = await page.evaluate(() => ["partyAcquirer", "partyProvider"].map((k) => document.querySelector(`[data-field-key="${k}"] span`)?.textContent));
  check(`${c.type}: Deal order is Location → ${c.a} → ${c.b} → Size`, ys.every((y) => y >= 0) && ys[0] < ys[1] && ys[1] < ys[2] && ys[2] < ys[3] && labels[0] === c.a && labels[1] === c.b, `${labels} ${ys.map(Math.round)}`);
  if (c.type === "lease") {
    check("lease: no separate Monthly|Yearly / NNN|Gross toggle row or months|years toggle", (await page.locator('[role="group"][aria-label="Rate period"]').count()) === 0 && (await page.locator('[role="group"][aria-label="Rate basis"]').count()) === 0 && (await page.locator('[role="group"][aria-label="Term unit"]').count()) === 0);
    const pp = await pillInfo("period"), bp = await pillInfo("basis"), tp = await pillInfo("term-unit");
    check("lease: pasted explicit period shows a SOLID `/yr` pill (not a guess)", pp?.text === "/yr" && pp.tone === "solid" && pp.border === "solid", JSON.stringify(pp));
    check("lease: basis pill reads NNN, term pill reads mo", bp?.text === "NNN" && tp?.text === "mo", `${bp?.text}/${tp?.text}`);
    check("lease: no guess hint when the period was stated", (await hint("period-guess").count()) === 0 && (await hint("period-warn").count()) === 0);
  }
  check(`${c.type}: "Place on map" before arming`, /Place on map/.test(await page.locator('[data-field-key="location"]').innerText()));
  const fb = await footer(page);
  check(`${c.type}: footer read-back matches pasted values`, c.footer.test(fb), fb);
  const sv = await saveBtn();
  check(`${c.type}: Save is never disabled and reads "Save comp" with no pin`, !(await sv.isDisabled()) && (await sv.innerText()) === "Save comp", await sv.innerText());
  // (e) an empty chip mounts a focused input; the date chip carries the new label
  const dateLabel = (await page.locator('[data-add-chip="compDate"]').count()) ? await page.locator('[data-add-chip="compDate"]').innerText() : await page.locator('[data-field-key="compDate"] span').first().innerText();
  check(`${c.type}: date field (chip or row) reads "${c.date}"`, dateLabel.includes(c.date) && !/Lease signed|Closed\b/.test(dateLabel), dateLabel);
  if (c.type !== "land") {
    const chip = page.locator('[data-add-chip="clearHeightFt"]');
    check(`${c.type}: Clear height chip present under "Add more"`, (await chip.count()) === 1 && /add more/i.test(await page.locator('[data-comp-entry-mobile="1"]').innerText()));
    // "Details" is shown only when at least one extra holds a value (a pasted lease carries a note, so it has one)
    const extraRows = await page.evaluate(() => ["clearHeightFt", "yearBuilt", "leaseOpex", "leaseEscalationPct", "leaseCommencementDate", "leaseFreeRentMonths", "leaseTi", "bldgNoi", "bldgCapRate", "compDate", "notes"].filter((k) => document.querySelector(`[data-comp-entry-mobile="1"] label[data-field-key="${k}"]`)).length);
    check(`${c.type}: "Details" caption is shown only when an extra has a value (${extraRows} extra row(s))`, /^details$/im.test(await page.locator('[data-comp-entry-mobile="1"]').innerText()) === (extraRows > 0));
    await chip.click();
    await pacedWait(page, 250);
    const focusedLabel = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
    check(`${c.type}: tapping the chip mounts a FOCUSED input`, focusedLabel === "Clear height", String(focusedLabel));
    check(`${c.type}: the field moved up under a "Details" caption`, /^details$/im.test(await page.locator('[data-comp-entry-mobile="1"]').innerText()) && (await page.locator('[data-add-chip="clearHeightFt"]').count()) === 0);
    await page.keyboard.press("Escape");
  }
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${c.type}-rest.png` });

  // NEW-9: tap Save with no pin → no save; Location scrolled into view, flagged, inline line
  const range = await scrollSheetToEnd();
  await pacedWait(page, 200);
  const outBefore = range > 0 ? !(await inView('[data-field-key="location"]')) : null;
  const before = compPosts.length;
  await saveBtn().click();
  await pacedWait(page, 1000);
  if (outBefore === true) check(`${c.type}: Location row was OUT of view before the Save tap (precondition)`, true);
  else console.log(`   (note: ${c.type} sheet fits without scrolling — scroll-into-view is not separately observable here)`);
  check(`${c.type}: Save tap with no pin scrolls Location into view`, await inView('[data-field-key="location"]'));
  check(`${c.type}: inline "Place it on the map to save." under Location`, (await hint("location-warn").count()) === 1 && /Place it on the map to save\./.test(await hint("location-warn").innerText()));
  check(`${c.type}: that tap saved nothing`, compPosts.length === before);

  // (c) tapping the inline line arms the map pick like the row does
  await placeOnMap(true);
  check(`${c.type}: tapping the inline line armed the pick (sheet restored after)`, (await mobile(page)) === 1);
  if ((await mobile(page)) === 1) {
    const loc = await page.locator('[data-field-key="location"]').innerText();
    check(`${c.type}: "Place on map" ABSENT after the pick`, !/Place on map/.test(loc), loc.replace(/\n/g, " | "));
    check(`${c.type}: inline warn line gone once placed`, (await hint("location-warn").count()) === 0);
    const s2 = await saveBtn().innerText();
    check(`${c.type}: Save still reads "Save comp"`, s2 === "Save comp", s2);
  }
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${c.type}-placed.png` });
  await leave();
}

/* ---- round 3: lease rate pills, the period guess, term, deal name, Save routing ---- */
console.log("\n=== round 3 — lease: rate pills, guess, term, deal name ===");
await openSheet(page);
await paste(page, "120,000 SF industrial lease"); // no rate, no term, no period
check("blank-rate lease: no pills until a rate is typed", (await pill("period").count()) === 0 && (await pill("basis").count()) === 0 && (await pill("term-unit").count()) === 0);
check("blank-rate lease: no period hint while there is no rate", (await hint("period-warn").count()) === 0 && (await hint("period-guess").count()) === 0);
// header: deal name reads as a field
const nameInfo = await page.locator('[data-deal-name="1"]').evaluate((el) => ({ ph: el.placeholder, border: getComputedStyle(el).borderBottomWidth, bstyle: getComputedStyle(el).borderBottomStyle }));
check("deal name: placeholder `Add a deal name` with a thin underline", nameInfo.ph === "Add a deal name" && nameInfo.border === "1px" && nameInfo.bstyle === "solid", JSON.stringify(nameInfo));
check("deal name: no fallback hint with no tenant", (await hint("name-fallback").count()) === 0);
const ten = page.locator('[data-field-key="partyAcquirer"] input');
await ten.tap(); await ten.fill("Acme Logistics"); await ten.evaluate((el) => el.blur()); await pacedWait(page, 300);
check('deal name: blank + Tenant → `Will save as "Acme Logistics"`', /Will save as .Acme Logistics./.test(await hint("name-fallback").innerText().catch(() => "")));
check("deal name: the name field itself stays empty (fallback is applied at save, not typed in)", (await page.locator('[data-deal-name="1"]').inputValue()) === "");
const nm = page.locator('[data-deal-name="1"]');
await nm.tap(); await page.keyboard.type("Typed name"); await page.keyboard.press("Enter"); await pacedWait(page, 300);
check("deal name: typed name wins and the hint is gone", (await hint("name-fallback").count()) === 0 && (await nm.inputValue()) === "Typed name");
// 0.62 → guessed /mo, dashed
await setRate("0.62");
let pi = await pillInfo("period");
check("rate 0.62: dashed amber `/mo` guess pill", pi?.text === "/mo" && pi.tone === "guess" && pi.border === "dashed", JSON.stringify(pi));
check("rate 0.62: quiet hint `Guessed monthly from the rate. Tap /mo to change.`", /Guessed monthly from the rate\. Tap \/mo to change\./.test(await hint("period-guess").innerText().catch(() => "")));
const rowLine = await page.evaluate(() => { const r = document.querySelector('[data-field-key="leaseRate"]').textContent; return r; });
check("rate row: label Rate, `$0.62`, `/SF`, period + basis pills on ONE row", /Rate.*\$.*0\.62.*\/SF.*\/mo.*NNN/.test(rowLine.replace(/\s+/g, "")) || (/Rate/.test(rowLine) && /\/SF/.test(rowLine) && /\/mo/.test(rowLine) && /NNN/.test(rowLine)), rowLine);
const g = await page.evaluate(() => { const row = document.querySelector('[data-field-key="leaseRate"]'); const sp = [...row.querySelectorAll("span")]; const d = sp.find((e) => e.textContent === "$")?.getBoundingClientRect(); const i = row.querySelector("input").getBoundingClientRect(); return { gap: i.left - d.right }; });
check("rate row: `$` hugs the number", Math.abs(g.gap) <= 6, `${g.gap.toFixed(1)}px`);
if (SHOTS) await page.screenshot({ path: `${SHOTS}/lease-guess-rest.png` });
await pill("period").tap(); await pacedWait(page, 400);
pi = await pillInfo("period");
check("tap: `/mo` flips to `/yr`, SOLID, hint gone", pi?.text === "/yr" && pi.tone === "solid" && pi.border === "solid" && (await hint("period-guess").count()) === 0, JSON.stringify(pi));
await setRate("0.5");
check("locked: a further rate edit never re-guesses (still `/yr`)", (await pillInfo("period"))?.text === "/yr");
await pill("basis").tap(); await pacedWait(page, 300);
check("NNN pill flips to Gross (and back)", (await pillInfo("basis"))?.text === "Gross");
await pill("basis").tap(); await pacedWait(page, 300);
check("Gross flips back to NNN", (await pillInfo("basis"))?.text === "NNN");
await setRate("");
check("rate cleared: the pills disappear", (await pill("period").count()) === 0 && (await pill("basis").count()) === 0);
// Term pill
const term = page.locator('[data-field-key="leaseTerm"] input');
await term.tap(); await term.fill("5"); await term.evaluate((el) => el.blur()); await pacedWait(page, 400);
check("term: pill reads `mo` once a term is typed", (await pillInfo("term-unit"))?.text === "mo");
await pill("term-unit").tap(); await pacedWait(page, 300);
check("term: tapping flips `mo` → `yr`", (await pillInfo("term-unit"))?.text === "yr");
await pill("term-unit").tap(); await pacedWait(page, 300);
check("term: flips back to `mo`", (await pillInfo("term-unit"))?.text === "mo");
await leave();

console.log("\n=== round 3 — lease: 6.25 guesses /yr; 2.5 stays unpicked ===");
await openSheet(page);
await paste(page, "120,000 SF industrial lease");
await setRate("6.25");
pi = await pillInfo("period");
check("rate 6.25: dashed `/yr` guess pill", pi?.text === "/yr" && pi.tone === "guess" && pi.border === "dashed", JSON.stringify(pi));
check("rate 6.25: hint says yearly", /Guessed yearly from the rate\. Tap \/yr to change\./.test(await hint("period-guess").innerText().catch(() => "")));
await setRate("");
check("rate cleared while still a guess: the guess clears too (no pills, no hint)", (await pill("period").count()) === 0 && (await hint("period-guess").count()) === 0);
await setRate("2.5");
pi = await pillInfo("period");
check("rate 2.5: unpicked — warn pill `/mo or /yr?`", pi?.text === "/mo or /yr?" && pi.tone === "warn", JSON.stringify(pi));
check("rate 2.5: warn hint `Monthly or yearly? They differ by 12x.`", /Monthly or yearly\? They differ by 12x\./.test(await hint("period-warn").innerText().catch(() => "")));
await placeOnMap();
check("rate 2.5, placed: Save still reads Save comp and is enabled", (await mobile(page)) === 1 && (await saveBtn().innerText()) === "Save comp" && !(await saveBtn().isDisabled()));
{
  const before = compPosts.length;
  const range = await scrollSheetToEnd(); await pacedWait(page, 200);
  const out = range > 0 ? !(await inView('[data-field-key="leaseRate"]')) : null;
  await saveBtn().click(); await pacedWait(page, 1000);
  console.log(`   (Rate row out of view before the tap: ${out})`);
  check("rate without a period, no guess: Save tap scrolls the Rate row into view", await inView('[data-field-key="leaseRate"]'));
  check("…and shows its warn hint, and saves nothing", (await hint("period-warn").count()) === 1 && compPosts.length === before);
}
await leave();

if (LIVE) {
  console.log("\n=== round 3 — blank lease WITH a pin reaches the save call (stubbed, nothing persisted) ===");
  await openSheet(page);
  await paste(page, "120,000 SF industrial lease");
  await placeOnMap();
  check("blank lease, placed: Save reads `Save comp`, enabled", (await mobile(page)) === 1 && (await saveBtn().innerText()) === "Save comp" && !(await saveBtn().isDisabled()));
  const before = compPosts.length;
  await saveBtn().click(); await pacedWait(page, 2500);
  check("blank lease with a pin: the tap reaches the save call (stubbed POST /comps)", compPosts.length === before + 1, `${compPosts.length - before} POST(s)`);
  if (compPosts.length > before) {
    let body = []; try { body = JSON.parse(compPosts[compPosts.length - 1]); } catch (_) {}
    const r0 = Array.isArray(body) ? body[0] : body;
    check("…with a null rate and a null period (nothing invented)", r0 && r0.lease_rate == null && r0.lease_rate_period == null, JSON.stringify({ r: r0?.lease_rate, p: r0?.lease_rate_period }));
  }
  await leave();
} else console.log("\n(note: the save-reaches-the-call checks need --live — a signed-out local run has no Supabase client)");

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
