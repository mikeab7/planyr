#!/usr/bin/env node
/* verify-food-lists — NEW-1 / B2088288 (named restaurant lists). Chromium, desktop width, against a build pointed at
 * the MOCKED Supabase origin (ui-audit/lib/foodFixture.mjs; build with
 *   VITE_SUPABASE_URL=https://plnrtestfood123456.supabase.co VITE_SUPABASE_ANON_KEY=fixture-anon).
 * Nothing touches real data. The fixture's list/wishlist tables are stateful and model the migration's unique name,
 * composite-owner FK and cascade-on-list_id.
 *
 * KNOWN-GOOD ARM (clause 6 of DRIVER-SCROLL-IS-NOT-APP-SCROLL): with "All" selected the map's emphasis probe must read ""
 * (the map is exactly what it was) — the run is VOID if that arm does not report its known value.
 *
 * Flow: create "Lunch @ Work" · add a visited place (picker), a search-found place and flag it want-to-try (row toggle),
 * and a second search-found place · the map emphasises EXACTLY those three · duplicate/blank names refused · a second
 * list from the place card · remove · rename · recolour · reload persists · delete a list leaves visits/wishlist ·
 * visit on a want place keeps membership · empty list selected · deleting the selected list falls back to All.
 * Usage: node ui-audit/verify-food-lists.mjs [baseUrl]
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { makeFixture, installFixture } from "./lib/foodFixture.mjs";

const BASE = process.argv.find((a, i) => i > 1 && a.startsWith("http")) || "http://localhost:4180";
let failed = 0;
const row = (name, ok, detail = "") => { if (!ok) failed += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`); };

const T = (id) => `[data-testid="${id}"]`;
const emphasis = (page) => page.locator(T("food-map")).getAttribute("data-list-emphasis");
async function settle(page, ms = 500) { await page.waitForTimeout(ms); }

async function newList(page, name) {
  await page.locator(T("food-list-new")).click();
  await page.locator(T("food-list-new-input")).fill(name);
  await page.keyboard.press("Enter");
  await settle(page);
}
async function searchPick(page, text, nth = 0) {
  const box = page.locator(T("food-search-box"));
  await box.fill("");
  await box.click();
  await page.keyboard.type(text, { delay: 25 });
  await page.waitForSelector(`${T("food-search-results")} button`, { timeout: 8000 });
  await page.locator(`${T("food-search-results")} button`).nth(nth).click();
  await settle(page, 700);
}
const memberNames = (page) => page.locator(`${T("food-list-panel")} ${T("food-list-row")} button[title="Open on the map"]`).allInnerTexts();

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] } : {});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
const state = makeFixture();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await installFixture(page, state);
await page.goto(`${BASE}/#/food`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(T("food-map"), { timeout: 20000 });
await assertMeasurable(page, "verify-food-lists");
await page.waitForFunction(() => !!window.__foodMap, null, { timeout: 10000 });
await settle(page, 800);

// ── known-good arm: All selected → nothing emphasised, no panel
const allProbe = await emphasis(page);
row("KNOWN-GOOD: with All selected the map is unchanged (emphasis probe empty, no panel)", allProbe === "" && (await page.locator(T("food-list-panel")).count()) === 0, `probe=${JSON.stringify(allProbe)}`);
if (allProbe !== "") { console.log("RUN VOID — the known-good arm did not report its known value"); await browser.close(); process.exit(1); }

// ── create the list; blank + duplicate refused
await newList(page, "Lunch @ Work");
row("create 'Lunch @ Work' — one chip, selected, saved", state.lists.length === 1 && state.lists[0].name === "Lunch @ Work" && (await page.locator(T("food-list-chip")).count()) === 1);
await page.locator(T("food-list-new")).click();
await page.locator(T("food-list-new-input")).fill("  lunch @ WORK ");
await page.keyboard.press("Enter");
await settle(page, 300);
row("a second 'lunch @ work' (any case) is refused with a message", state.lists.length === 1 && (await page.locator(T("food-list-error")).count()) === 1, await page.locator(T("food-list-error")).innerText().catch(() => ""));
await page.keyboard.press("Escape");
await page.locator(T("food-list-new-input")).fill("   ").catch(() => {});
await page.keyboard.press("Enter");
row("a blank name is refused (nothing created)", state.lists.length === 1);
await page.keyboard.press("Escape");
await settle(page, 200);
row("empty list: nothing emphasised and the panel says so", (await emphasis(page)) === "" && (await page.locator(T("food-list-empty")).count()) > 0);

// ── picker: the visited place (Been tag is read-only)
await page.locator(T("food-list-add-open")).click();
const beenRows = page.locator(`${T("food-list-row")}[data-status="been"]`);
row("picker lists the visited place with a READ-ONLY 'Been' tag (no toggle)", (await beenRows.count()) === 1 && (await beenRows.first().locator(T("food-list-want")).count()) === 0);
await beenRows.first().locator(T("food-list-add")).click();
await settle(page);
// ── unmarked places found through the toolbar search while the picker is open
await searchPick(page, "torchy", 0);
await searchPick(page, "fadi", 0);
await page.locator(T("food-list-done")).click();
const names = await memberNames(page);
row("three members: DAO'N, a Torchy's, Fadi's", names.length === 3 && names.some((n) => /DAO/i.test(n)) && names.some((n) => /Torchy/.test(n)) && names.some((n) => /Fadi/.test(n)), JSON.stringify(names));
row("searching while the picker is open ADDED the place (it did not open its card)", (await page.locator(T("food-visit-panel")).count()) === 0);
// want-to-try toggle on the Torchy's row
const torchy = page.locator(`${T("food-list-row")}`, { hasText: "Torchy" });
await torchy.locator(T("food-list-want")).click();
await settle(page);
row("'Want to try' toggled from the list row writes a wishlist row", state.wishlist.length === 1 && (await torchy.getAttribute("data-status")) === "want");
const em = (await emphasis(page)).split("\n").filter(Boolean);
row("the map emphasises EXACTLY the three members, nothing else", em.length === 3, em.join(" ; "));

// ── a second list from the place card; the same place is on both
await page.locator(`${T("food-list-row")}`, { hasText: "DAO" }).locator('button[title="Open on the map"]').click();
await page.waitForSelector(T("food-visit-panel"));
await page.locator(T("food-add-to-list-btn")).click();
await page.locator(T("food-add-to-list-new")).click();
await page.locator(T("food-add-to-list-new-input")).fill("Dinner After Work");
await page.keyboard.press("Enter");
await settle(page, 700);
row("'New list…' on the place card makes the list AND puts this place on it", state.lists.length === 2 && state.listItems.filter((i) => i.list_id === state.lists[1].id).length === 1);
const rowsChecked = await page.locator(`${T("food-add-to-list-row")}[aria-checked="true"]`).count();
row("the place card checks every list the place is on (Lunch AND Dinner)", rowsChecked === 2);
row("the same place is on BOTH lists (two membership rows, one restaurant)", state.listItems.filter((i) => i.custom_name === state.manualName).length === 2);
// tapping a checked list in the card removes only that membership
await page.locator(`${T("food-add-to-list-row")}[data-list-id="${state.lists[0].id}"]`).click();
await settle(page);
row("tapping a checked list un-checks it (Lunch only); Dinner keeps the place", state.listItems.filter((i) => i.custom_name === state.manualName).length === 1);
await page.locator(`${T("food-add-to-list-row")}[data-list-id="${state.lists[0].id}"]`).click();
await settle(page);
row("…and tapping it again puts it back on Lunch", state.listItems.filter((i) => i.custom_name === state.manualName).length === 2);
await page.locator(T("food-panel-close")).click();

// ── remove / rename / recolour
await page.locator(T("food-list-chip")).first().click();
await settle(page, 300);
await page.locator(T("food-list-toggle")).click();
await page.locator(`${T("food-list-row")}`, { hasText: "Fadi" }).locator(T("food-list-remove")).click();
await settle(page);
const lunchCount = state.listItems.filter((i) => i.list_id === state.lists[0].id).length;
row("remove one: Lunch now has 2, Dinner still has its 1", lunchCount === 2 && state.listItems.filter((i) => i.list_id === state.lists[1].id).length === 1);
await page.locator(T("food-list-rename")).click();
await page.locator(T("food-list-rename-input")).fill("Lunch at Work");
await page.keyboard.press("Enter");
await settle(page);
await page.locator(`${T("food-list-color")}[data-color="#7A4FD6"]`).click();
await settle(page);
row("rename + recolour persist to the row", state.lists[0].name === "Lunch at Work" && state.lists[0].color === "#7A4FD6");

// ── reload persists
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(T("food-map"));
await page.waitForFunction(() => !!window.__foodMap, null, { timeout: 10000 });
await settle(page, 1200);
const chips = await page.locator(T("food-list-chip")).allInnerTexts();
row("after reload both lists are there", chips.length === 2 && chips[0].includes("Lunch at Work") && chips[1].includes("Dinner After Work"), JSON.stringify(chips));
await page.locator(T("food-list-chip")).first().click();
await settle(page, 400);
row("after reload the membership persisted (2 members, emphasis 2)", (await page.locator(T("food-list-count")).innerText()).startsWith("2") && (await emphasis(page)).split("\n").filter(Boolean).length === 2);

// ── a want-to-try place on a list then gets a visit: flag clears, membership stays
await page.locator(T("food-list-toggle")).click().catch(() => {});
const tRow = page.locator(`${T("food-list-row")}`, { hasText: "Torchy" });
await tRow.locator('button[title="Open on the map"]').click();
await page.waitForSelector(T("food-visit-panel"));
await page.locator(T("food-log-visit-btn")).click();
await page.locator('form button[type="submit"]').first().click();
await settle(page, 1200);
row("visit logged on the want place → the want flag cleared", state.wishlist.length === 0);
row("…and its list membership stayed", state.listItems.some((i) => i.place_id === "fx-torchys-a" || i.place_id === "fx-torchys-b"));
await page.locator(T("food-panel-close")).click().catch(() => {});

// ── delete Dinner (not selected): the places, their visits and the wishlist are untouched
const visitsBefore = state.visits.length;
await page.locator(T("food-list-chip")).nth(1).click();
await settle(page, 300);
await page.locator(T("food-list-toggle")).click();
await page.locator(T("food-list-delete")).click();
await page.locator(T("food-list-delete-yes")).click();
await settle(page, 700);
row("deleting the SELECTED list falls back to All (no blank map, no panel)", (await page.locator(T("food-list-panel")).count()) === 0 && (await emphasis(page)) === "" && (await page.locator(T("food-list-chip-all")).getAttribute("aria-pressed")) !== "false");
row("delete removed only that list's rows; visits intact", state.lists.length === 1 && state.visits.length === visitsBefore && state.listItems.every((i) => i.list_id === state.lists[0].id));

// ── apostrophe names + an empty list selected
await newList(page, "Fadi's & Little Jimmy's");
row("a list name with apostrophes saves and shows", (await page.locator(T("food-list-chip")).allInnerTexts()).some((t) => t.includes("Fadi's & Little Jimmy's")));
row("a list with zero members: nothing emphasised, panel says so", (await emphasis(page)) === "" && (await page.locator(T("food-list-empty")).count()) > 0);

row("no page errors", errors.length === 0, errors.join(" | "));
await page.screenshot({ path: process.env.SHOT || "/tmp/claude-0/food-lists-desktop.png" });
await browser.close();
console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
process.exit(failed ? 1 : 0);
