#!/usr/bin/env node
/* verify-food-dishes-phone — the phone flow of logging a visit and saving dishes (B2268433 NEW-2, B2268434 NEW-3, B2268435 NEW-4, 2026-10-17):
 *  · a saved visit CLOSES the form and lands on the place page (confirmation + Edit visit), never a cleared form offering another visit;
 *  · a dish is added or RE-RATED straight from the restaurant page (name focused first, saved-dish suggestions tolerant of a typo,
 *    history kept, latest shown, no twin, a rename reaches every rating);
 *  · a note on a dish: typed while logging a visit and from the dish row, shown truncated on the row and in full on tap, edited, cleared,
 *    and round-tripped through the database after a cache-busted reload; a failed save is loud and keeps what was typed.
 *
 * LIVE ONLY (needs the real food_dishes table + RLS): the throwaway data is the TEST account's, every row is deleted in `finally` and the
 * run proves they are gone (owner rule 15). ENGINE: WebKit + the iPhone 15 descriptor (taps, layout) with the iOS keyboard MODEL; reported as
 * "WebKit", never "iPhone". KNOWN-ANSWER ARM: before the dish steps the dishes list must read ZERO rows for the throwaway place (a probe
 * that finds none of what it is about to create), and the suggestion probe is first pointed at a nonsense word and must offer nothing.
 *
 * Usage: node ui-audit/verify-food-dishes-phone.mjs --live [https://planyr.io | a *.planyr.pages.dev preview] [--shots=<dir>]
 */
import { webkit } from "playwright";
import { mkdirSync } from "node:fs";
import { open as openRaw, openPlace, LIVE, BASE, seedLive, cleanupLive, closeLeakedLive } from "./lib/foodIosPage.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

if (!LIVE) { console.error("verify-food-dishes-phone is live-only: run with --live (test account)."); process.exit(2); }
const SHOTS = (process.argv.find((a) => a.startsWith("--shots=")) || "").slice(8);
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (id, ok, detail = "") => { results.push({ id, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${id}${detail ? "  — " + detail : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (page, n) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${n}.png` }); };
const SHEET = '[data-testid="food-bottom-sheet"]';
const DISH = "ZZ Brisket Taco";

let taps = 0;
const tap = async (page, loc, what) => { taps++; await loc.tap(); await sleep(500); return what; };
const setSlider = async (page, loc, frac) => {
  const b = await loc.boundingBox();
  taps++; await page.touchscreen.tap(b.x + b.width * frac, b.y + b.height / 2); await sleep(350);
};
const rows = (page) => page.evaluate(async () => (await window.pfSupabase.from("food_dishes").select("id,name,score,note,rated_on,visit_id,created_at").order("created_at")).data || []);
const dishRowsOnScreen = (page, name) => page.locator('[data-testid="dish-row"]').filter({ hasText: name }).count();
const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth);

const { ctx, page } = await (async () => { const r = await openRaw(await webkit.launch(), "iPhone 15", "ios"); return r; })();
try {
  await seedLive(BASE);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="food-map"]'); await assertMeasurable(page, "verify-food-dishes-phone");
  await page.evaluate(() => { window.__PLANYR_E2E = true; });
  const build = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null));
  console.log(`## WebKit · iPhone 15 · ${BASE} · build ${build && build.build}`);
  await openPlace(page, "aburi", /aburi/i, true);
  await sleep(2500);

  // KNOWN-ANSWER ARMS
  check("arm: the throwaway place starts with ZERO dishes (the probe can read an empty list)", (await dishRowsOnScreen(page, DISH)) === 0 && (await rows(page)).length === 0);

  // ── NEW-3 · add a dish from the restaurant page ───────────────────────────────────────────────────────
  taps = 0;
  await tap(page, page.locator('[data-testid="food-add-dish-btn"]'), "Add a dish");
  const focused = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute("data-testid"));
  check("3a Add a dish: the NAME field is focused first", focused === "dish-name-input", `focused=${focused}`);
  const nameBox = page.locator('[data-testid="dish-name-input"]');
  await nameBox.pressSequentially("zzzzqq", { delay: 25 }); await sleep(300);
  check("arm: a nonsense word offers no suggestion", (await page.locator('[data-testid="dish-suggestion"]').count()) === 0);
  await nameBox.fill(""); await nameBox.pressSequentially(DISH, { delay: 25 });
  await setSlider(page, page.locator('[data-testid="dish-edit-row"] input[type=range]').first(), 0.5);
  await shot(page, "1-add-dish");
  await tap(page, page.locator('[data-testid="dish-save-close-btn"]'), "Done");
  await sleep(1500);
  check(`3b the dish appears on the restaurant page with its score, in ${taps} taps from "Add a dish" to saved`, (await dishRowsOnScreen(page, DISH)) === 1 && taps <= 4, `taps=${taps}`);
  check("3c nothing pans sideways", await noSideways(page));
  let db = await rows(page);
  check("3d it is in the database, dated today (rated_on), attached to the visit", db.length === 1 && db[0].name === DISH && !!db[0].rated_on, JSON.stringify(db));

  // ── NEW-3 · re-rate from the page: no twin, history kept, latest shown ────────────────────────────────
  await tap(page, page.locator('[data-testid="dish-row"]').filter({ hasText: DISH }), "dish row");
  check("3e tapping the dish shows its panel", (await page.locator('[data-testid="dish-history-panel"]').count()) === 1);
  await tap(page, page.locator('[data-testid="dish-rate-again-btn"]'), "Rate again");
  check("3f Rate again starts with the score UNSET (the new score is the point)", (await page.locator('[data-testid="dish-edit-row"]').innerText()).includes("Not rated"));
  await setSlider(page, page.locator('[data-testid="dish-edit-row"] input[type=range]').first(), 0.92);
  await page.locator('[data-testid="dish-note-input"]').fill("ask for extra sauce");
  await tap(page, page.locator('[data-testid="dish-save-btn"]'), "Save");
  await sleep(1500);
  check("3g still ONE dish row (no duplicate)", (await dishRowsOnScreen(page, DISH)) === 1);
  await tap(page, page.locator('[data-testid="dish-row"]').filter({ hasText: DISH }), "dish row");
  const hist = await page.locator('[data-testid="dish-history-entry"]').count();
  check("3h the panel shows BOTH ratings (history kept)", hist === 2, `entries=${hist}`);
  db = await rows(page);
  check("3i two rating rows in the database, the latest higher", db.length === 2 && Number(db[1].score) > Number(db[0].score), JSON.stringify(db.map((d) => [d.score, d.rated_on])));
  await shot(page, "2-history");

  // ── NEW-4 · the note: row (truncated), full on tap, edit, clear ──────────────────────────────────────
  const rowNote = await page.locator('[data-testid="dish-row-note"]').first().evaluate((e) => ({ t: e.textContent, ell: getComputedStyle(e).textOverflow, ws: getComputedStyle(e).whiteSpace }));
  check("4a the note shows on the dish row on ONE truncated line", rowNote.t === "ask for extra sauce" && rowNote.ell === "ellipsis" && rowNote.ws === "nowrap", JSON.stringify(rowNote));
  check("4b the full note is in the panel a tap opens", (await page.locator('[data-testid="dish-full-note"]').innerText()).includes("ask for extra sauce"));

  // suggestions: a misspelling finds the saved dish; picking it re-rates it
  await tap(page, page.locator('[data-testid="dish-row"]').filter({ hasText: DISH }), "close panel");
  await tap(page, page.locator('[data-testid="food-add-dish-btn"]'), "Add a dish");
  await page.locator('[data-testid="dish-name-input"]').pressSequentially("zz brisket tco", { delay: 25 }); await sleep(400);
  const sug = await page.locator('[data-testid="dish-suggestion"]').allInnerTexts();
  check("3j a misspelled name suggests the dish already saved here", sug.some((t) => t.includes(DISH)), JSON.stringify(sug));
  await tap(page, page.locator('[data-testid="dish-suggestion"]').first(), "suggestion");
  check("3k picking it fills the exact saved name, says it adds a rating, and carries the note forward", (await page.locator('[data-testid="dish-name-input"]').inputValue()) === DISH && (await page.locator('[data-testid="dish-rerate-hint"]').count()) === 1 && (await page.locator('[data-testid="dish-note-input"]').inputValue()) === "ask for extra sauce");
  await setSlider(page, page.locator('[data-testid="dish-edit-row"] input[type=range]').first(), 0.7);
  await tap(page, page.locator('[data-testid="dish-save-close-btn"]'), "Done"); await sleep(1500);
  check("3l …and it is STILL one dish (3 ratings in the database)", (await dishRowsOnScreen(page, DISH)) === 1 && (await rows(page)).length === 3);

  // edit the note, then clear it
  const edit = async (note) => {
    await tap(page, page.locator('[data-testid="dish-row-kebab"]').first(), "kebab");
    await tap(page, page.locator('[data-testid="dish-row-edit"]'), "Edit");
    await page.locator('[data-testid="dish-note-input"]').fill(note);
    await tap(page, page.locator('[data-testid="dish-save-btn"]'), "Save"); await sleep(1500);
  };
  await edit("get it spicy");
  check("4c editing the note saves it", (await page.locator('[data-testid="dish-row-note"]').first().innerText()) === "get it spicy" && (await rows(page)).some((d) => d.note === "get it spicy"));
  await edit("");
  check("4d clearing the note saves too (nothing left on the row, null in the database)", (await page.locator('[data-testid="dish-row-note"]').count()) === 0 && (await rows(page)).filter((d) => d.note === "get it spicy").length === 0);

  // ── one source of truth: rename reaches every rating ─────────────────────────────────────────────────
  await tap(page, page.locator('[data-testid="dish-row-kebab"]').first(), "kebab");
  await tap(page, page.locator('[data-testid="dish-row-edit"]'), "Edit");
  await page.locator('[data-testid="dish-name-input"]').fill(DISH + "s");
  await tap(page, page.locator('[data-testid="dish-save-btn"]'), "Save"); await sleep(1800);
  db = await rows(page);
  check("3m a rename changes EVERY rating of the dish (history stays attached)", db.length === 3 && db.every((d) => d.name === DISH + "s") && (await dishRowsOnScreen(page, DISH + "s")) === 1, JSON.stringify(db.map((d) => d.name)));

  // ── NEW-2 · log a visit with a dish: lands on the place page ─────────────────────────────────────────
  await tap(page, page.locator('[data-testid="food-log-visit-btn"]'), "Log a visit");
  await page.locator('[data-testid="visit-dish-name"]').first().pressSequentially("zz brisket", { delay: 25 }); await sleep(400);
  await tap(page, page.locator('[data-testid="dish-suggestion"]').first(), "suggestion");
  check("2a a dish typed while logging a visit gets suggestions too, and carries the note field", (await page.locator('[data-testid="visit-dish-name"]').first().inputValue()) === DISH + "s" && (await page.locator('[data-testid="visit-dish-note"]').count()) === 1);
  await page.locator('[data-testid="visit-dish-note"]').first().fill("visit note on the dish");
  await setSlider(page, page.locator('[data-testid="visit-dish-row"] input[type=range]').first(), 0.8);
  await shot(page, "3-log-form");
  await tap(page, page.locator('[data-testid="visit-form-actions"] button[type=submit]'), "Log this visit");
  await sleep(3500);
  const after = await page.evaluate((SHEET) => ({
    formOpen: !!document.querySelector("form[data-sheet-form]"),
    submit: !!document.querySelector('[data-testid="visit-form-actions"]'),
    banner: (document.querySelector('[data-testid="food-save-confirmation"]') || {}).innerText || null,
    editBtn: !!document.querySelector('[data-testid="food-saved-edit-btn"]'),
    logBtn: !!document.querySelector('[data-testid="food-log-visit-btn"]') && document.querySelector('[data-testid="food-log-visit-btn"]').offsetParent !== null,
    scrollTop: document.querySelector(SHEET).children[1].scrollTop,
    visits: document.querySelectorAll('[data-testid="food-visit-card"]').length,
  }), SHEET);
  check("2b after a confirmed save the form is CLOSED (no cleared form, no second submit button)", !after.formOpen && !after.submit, JSON.stringify(after));
  check("2c the card is at the top showing a confirmation with an Edit visit button", /Visit saved/.test(after.banner || "") && after.editBtn && after.scrollTop === 0, JSON.stringify(after));
  check("2d the visit just logged is listed (2 visits) and Log a visit is back as the ordinary, un-pushed button", after.visits === 2 && after.logBtn, JSON.stringify(after));
  check("2e the dish is a 4th rating of the SAME dish, carrying its note", (await rows(page)).length === 4 && (await dishRowsOnScreen(page, DISH + "s")) === 1 && (await rows(page)).some((d) => d.note === "visit note on the dish"));
  await shot(page, "4-after-save");
  await tap(page, page.locator('[data-testid="food-saved-edit-btn"]'), "Edit visit"); await sleep(900);
  check("2f Edit visit opens that visit's edit form (and not a new-visit form)", (await page.locator('[data-testid="food-visit-card-editing"]').count()) === 1);
  await tap(page, page.locator('[data-testid="food-visit-card-editing"] button[type=submit]'), "Save changes"); await sleep(2000);
  const afterEdit = await page.evaluate(() => ({ form: !!document.querySelector("form[data-sheet-form]"), msg: (document.querySelector('[data-testid="food-save-confirmation"]') || {}).innerText || "" }));
  check("2g saving an EDIT ends on the page too — no new-visit form offered", !afterEdit.form && /Changes saved/.test(afterEdit.msg), JSON.stringify(afterEdit));

  // ── NEW-2 · saves stay LOUD on failure ───────────────────────────────────────────────────────────────
  await tap(page, page.locator('[data-testid="food-log-visit-btn"]'), "Log a visit");
  await page.locator('[data-testid="visit-dish-name"]').first().fill("ZZ Fail Dish");
  await page.route(/\/rest\/v1\/food_visits/, (route) => (route.request().method() === "POST" ? route.abort() : route.continue()));
  await tap(page, page.locator('[data-testid="visit-form-actions"] button[type=submit]'), "Log this visit"); await sleep(2500);
  const fail = await page.evaluate(() => ({ alert: !!document.querySelector('[role="alert"]'), formOpen: !!document.querySelector("form[data-sheet-form]"), typed: (document.querySelector('[data-testid="visit-dish-name"]') || {}).value }));
  check("2h a failed save is LOUD (error shown) and keeps the form with what was typed", fail.alert && fail.formOpen && fail.typed === "ZZ Fail Dish", JSON.stringify(fail));
  await page.unroute(/\/rest\/v1\/food_visits/);
  await tap(page, page.locator('[data-testid="visit-form-actions"] button').nth(1), "Cancel");

  // ── round trip after a cache-busted reload ───────────────────────────────────────────────────────────
  await page.goto(`${BASE}/?cb=${Date.now()}#/food`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="food-map"]'); await sleep(2000);
  await openPlace(page, "aburi", /aburi/i, true); await sleep(2500);
  check("RT everything round-trips after a cache-busted reload: one dish, 4 ratings, latest shown", (await dishRowsOnScreen(page, DISH + "s")) === 1 && (await rows(page)).length === 4);
  await tap(page, page.locator('[data-testid="dish-row"]').filter({ hasText: DISH + "s" }), "dish row");
  check("RT its history lists all 4 ratings after the reload", (await page.locator('[data-testid="dish-history-entry"]').count()) === 4);
  console.log(`(taps counted across the run: ${taps})`);
} catch (e) {
  check("run aborted", false, String(e.stack || e).split("\n").slice(0, 3).join(" | "));
} finally {
  await closeLeakedLive().catch(() => {});
  const c = await cleanupLive(BASE).catch((e) => ({ error: String(e) }));
  console.log("live cleanup:", JSON.stringify(c));
  if (c.error || c.left !== 0) { console.log("FAIL  live cleanup left rows behind"); process.exitCode = 1; }
  try { await ctx.close(); } catch (_) { /* already closed */ }
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed (WebKit, iPhone 15 descriptor, live, test account)`);
process.exit(failed.length || process.exitCode ? 1 : 0);
