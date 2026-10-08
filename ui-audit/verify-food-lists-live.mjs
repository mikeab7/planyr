#!/usr/bin/env node
/* verify-food-lists-live — V1513232 / B2088288. The REAL deploy, signed in as the throwaway test account
 * (ui-audit/lib/signedInSession.mjs — never Michael's data). Drives named restaurant lists end to end and DELETES every row
 * it created (lists, items, the visits it logs, the want-to-try flags) in `finally`, verifying they are gone.
 *   E2E_LOGIN_KEY=… node ui-audit/verify-food-lists-live.mjs [https://planyr.io | a *.planyr.pages.dev preview]
 * The served build (/version.json) is read in the SAME call as the final assertions. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = (process.argv.find((a, i) => i > 1 && a.startsWith("http")) || "https://planyr.io").replace(/\/$/, "");
let failed = 0;
const row = (name, ok, detail = "") => { if (!ok) failed += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`); };
const T = (id) => `[data-testid="${id}"]`;

const s = await openSignedIn({ base: BASE });
const page = s.page;
const settle = (ms = 700) => page.waitForTimeout(ms);
const q = (fn, arg) => page.evaluate(fn, arg);
const snapshot = () => q(async () => {
  const c = window.pfSupabase;
  const [l, i, v, w] = await Promise.all(["food_lists", "food_list_items", "food_visits", "food_wishlist"].map((t) => c.from(t).select("id,place_id,custom_name,list_id,name,color,rating")));
  return { lists: l.data || [], items: i.data || [], visits: v.data || [], wish: w.data || [], err: [l, i, v, w].map((r) => r.error && r.error.message).filter(Boolean) };
});
const emphasis = async () => ((await page.locator(T("food-map")).getAttribute("data-list-emphasis")) || "").split("\n").filter(Boolean);
async function searchPick(text, nth = 0) {
  const box = page.locator(T("food-search-box"));
  await box.fill(""); await box.click();
  await page.keyboard.type(text, { delay: 30 });
  await page.waitForSelector(`${T("food-search-results")} button`, { timeout: 15000 });
  await page.locator(`${T("food-search-results")} button`).nth(nth).click();
  await settle(1200);
}
const memberNames = () => page.locator(`${T("food-list-panel")} ${T("food-list-row")} button[title="Open on the map"]`).allInnerTexts();

let before = null;
try {
  await page.goto(`${BASE}/?cb=${Date.now()}#/food`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(T("food-map"), { timeout: 30000 });
  await assertMeasurable(page, "verify-food-lists-live");
  await settle(2500);
  before = await snapshot();
  row("PRECONDITION: the list tables answer (no schema error)", before.err.length === 0, before.err.join(" | "));
  if (before.err.length) throw new Error("tables not reachable — run is void");
  row("PRECONDITION: the test account starts with no lists", before.lists.length === 0, `${before.lists.length}`);

  // a visited place (through the real log-a-visit flow)
  await searchPick("chick-fil-a", 0);
  const visitedName = (await page.locator(T("food-visit-panel")).locator("h2, h3, strong").first().innerText().catch(() => "")).trim();
  await page.locator(T("food-log-visit-btn")).click();
  await page.locator('form button[type="submit"]').first().click();
  await settle(2000);
  await page.locator(T("food-panel-close")).click().catch(() => {});
  await settle(500);
  let snap = await snapshot();
  row("setup: a visit was logged on the test account (to be deleted)", snap.visits.length === before.visits.length + 1, `visits ${before.visits.length} → ${snap.visits.length}`);

  // 1. create the list
  await page.locator(T("food-list-new")).click();
  await page.locator(T("food-list-new-input")).fill("Lunch @ Work");
  await page.keyboard.press("Enter");
  await settle(1500);
  snap = await snapshot();
  row("1 create 'Lunch @ Work' → chip selected, row saved on the real table", snap.lists.length === 1 && snap.lists[0].name === "Lunch @ Work" && (await page.locator(T("food-list-panel")).count()) === 1);

  // 2. three places: visited (picker), want-to-try (search + row toggle), unmarked (search)
  await page.locator(T("food-list-add-open")).click();
  const been = page.locator(`${T("food-list-row")}[data-status="been"]`);
  row("2a the picker lists the visited place with a read-only Been tag", (await been.count()) >= 1 && (await been.first().locator(T("food-list-want")).count()) === 0);
  await been.first().locator(T("food-list-add")).click();
  await settle(1500);
  await searchPick("little jimmy", 0);
  await searchPick("fadi", 0);
  await page.locator(T("food-list-done")).click();
  await settle(800);
  const names = await memberNames();
  row("2b three members (visited, search-found, search-found)", names.length === 3, JSON.stringify(names));
  const jimmy = page.locator(T("food-list-row"), { hasText: /jimmy/i }).first();
  await jimmy.locator(T("food-list-want")).click();
  await settle(1500);
  snap = await snapshot();
  row("2c 'Want to try' from the picker row writes a wishlist row; status shows Want", snap.wish.length === before.wish.length + 1 && (await jimmy.getAttribute("data-status")) === "want");
  const em = await emphasis();
  row("2d the map emphasises EXACTLY those three, nothing else", em.length === 3, `${em.length} keys`);

  // 3. second list from the place card; place on both
  await page.locator(T("food-list-row"), { hasText: /fadi/i }).first().locator('button[title="Open on the map"]').click();
  await page.waitForSelector(T("food-visit-panel"), { timeout: 10000 });
  await page.locator(T("food-add-to-list-btn")).click();
  await page.locator(T("food-add-to-list-new")).click();
  await page.locator(T("food-add-to-list-new-input")).fill("Dinner After Work");
  await page.keyboard.press("Enter");
  await settle(2000);
  snap = await snapshot();
  const dinner = snap.lists.find((l) => l.name === "Dinner After Work");
  const fadisItems = snap.items.filter((i) => i.place_id && snap.items.filter((j) => j.place_id === i.place_id).length === 2);
  row("3 'New list…' on the place card makes Dinner and puts the place on BOTH lists", !!dinner && fadisItems.length === 2 && (await page.locator(`${T("food-add-to-list-row")}[aria-checked="true"]`).count()) === 2);
  await page.locator(T("food-panel-close")).click();
  await settle(500);

  // 4. remove one, rename, recolour; reload persists
  await page.locator(T("food-list-chip")).first().click();
  await settle(400);
  await page.locator(T("food-list-toggle")).click();
  await page.locator(T("food-list-row"), { hasText: /jimmy/i }).first().locator(T("food-list-remove")).click();
  await settle(1500);
  await page.locator(T("food-list-rename")).click();
  await page.locator(T("food-list-rename-input")).fill("Lunch at Work");
  await page.keyboard.press("Enter");
  await settle(1500);
  await page.locator(`${T("food-list-color")}[data-color="#7A4FD6"]`).click();
  await settle(1500);
  await page.goto(`${BASE}/?cb=${Date.now()}#/food`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(T("food-map"), { timeout: 30000 });
  await settle(3000);
  snap = await snapshot();
  const lunch = snap.lists.find((l) => l.name === "Lunch at Work");
  row("4 remove + rename + recolour all persisted after a cache-busting reload", !!lunch && lunch.color.toLowerCase() === "#7a4fd6" && snap.items.filter((i) => i.list_id === lunch.id).length === 2, JSON.stringify(lunch && { name: lunch.name, color: lunch.color }));
  const chips = await page.locator(T("food-list-chip")).allInnerTexts();
  row("4b both chips are back after reload", chips.length === 2, JSON.stringify(chips));

  // 5. a want place on a list then gets a visit: flag clears, membership stays
  await page.locator(T("food-list-chip")).first().click();
  await settle(400);
  const fadiRow = page.locator(T("food-list-row"), { hasText: /fadi/i }).first();
  if ((await page.locator(T("food-list-toggle")).innerText()) === "Manage") await page.locator(T("food-list-toggle")).click();
  await page.locator(T("food-list-row"), { hasText: /fadi/i }).first().locator(T("food-list-want")).click();
  await settle(1500);
  snap = await snapshot();
  const wishBefore = snap.wish.length;
  await page.locator(T("food-list-row"), { hasText: /fadi/i }).first().locator('button[title="Open on the map"]').click();
  await page.waitForSelector(T("food-visit-panel"), { timeout: 10000 });
  await page.locator(T("food-log-visit-btn")).click();
  await page.locator('form button[type="submit"]').first().click();
  await settle(2500);
  snap = await snapshot();
  row("5 want place + visit logged: flag cleared, list membership stayed", snap.wish.length === wishBefore - 1 && snap.items.filter((i) => i.list_id === lunch.id).length === 2);
  await page.locator(T("food-panel-close")).click().catch(() => {});

  // 6. delete Dinner (not selected) → places/visits/wishlist intact
  const visitsBefore = snap.visits.length, wishNow = snap.wish.length;
  await page.locator(T("food-list-chip"), { hasText: "Dinner After Work" }).click();
  await settle(400);
  if ((await page.locator(T("food-list-toggle")).innerText()) === "Manage") await page.locator(T("food-list-toggle")).click();
  await page.locator(T("food-list-delete")).click();
  await page.locator(T("food-list-delete-yes")).click();
  await settle(2000);
  snap = await snapshot();
  row("6a deleting the SELECTED list falls back to All (no panel, no blank map)", (await page.locator(T("food-list-panel")).count()) === 0 && (await emphasis()).length === 0);
  row("6b the list and ITS rows went; visits and the wishlist are untouched", !snap.lists.some((l) => l.name === "Dinner After Work") && snap.visits.length === visitsBefore && snap.wish.length === wishNow && snap.items.every((i) => i.list_id === lunch.id));

  // 7. apostrophe name + an empty list selected
  await page.locator(T("food-list-new")).click();
  await page.locator(T("food-list-new-input")).fill("Fadi's & Little Jimmy's");
  await page.keyboard.press("Enter");
  await settle(1800);
  snap = await snapshot();
  row("7a a list name with apostrophes saves", snap.lists.some((l) => l.name === "Fadi's & Little Jimmy's"));
  row("7b a list with zero members: nothing emphasised and the card says so", (await emphasis()).length === 0 && (await page.locator(T("food-list-empty")).count()) > 0);
  await page.locator(T("food-list-new")).click();
  await page.locator(T("food-list-new-input")).fill("lunch AT work");
  await page.keyboard.press("Enter");
  await settle(1500);
  snap = await snapshot();
  row("7c a duplicate name (any case) is refused with a message and nothing created", (await page.locator(T("food-list-error")).count()) === 1 && snap.lists.filter((l) => /^lunch at work$/i.test(l.name)).length === 1, await page.locator(T("food-list-error")).innerText().catch(() => ""));
  await page.keyboard.press("Escape");

  row("no uncaught page errors", s.errors.length === 0, s.errors.slice(0, 2).join(" | "));
  const build = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null));
  const chunks = await page.evaluate(() => [...document.querySelectorAll("script[src]")].map((e) => e.getAttribute("src")).filter((x) => /Food|index/.test(x)).slice(0, 3));
  console.log("served build:", JSON.stringify(build), "| scripts:", JSON.stringify(chunks));
} catch (e) {
  row("run aborted", false, String(e.message).split("\n")[0]);
} finally {
  // CLEANUP — delete everything this run created, then verify it is gone (owner constraint #15).
  const res = await page.evaluate(async (b) => {
    const c = window.pfSupabase;
    const keep = (rows) => new Set((rows || []).map((r) => r.id));
    const bl = keep(b && b.lists), bv = keep(b && b.visits), bw = keep(b && b.wish);
    const lists = (await c.from("food_lists").select("id")).data || [];
    for (const l of lists) if (!bl.has(l.id)) await c.from("food_lists").delete().eq("id", l.id); // cascades to its items
    const visits = (await c.from("food_visits").select("id")).data || [];
    for (const v of visits) if (!bv.has(v.id)) await c.from("food_visits").delete().eq("id", v.id);
    const wish = (await c.from("food_wishlist").select("id")).data || [];
    for (const w of wish) if (!bw.has(w.id)) await c.from("food_wishlist").delete().eq("id", w.id);
    const after = await Promise.all(["food_lists", "food_list_items", "food_visits", "food_wishlist"].map((t) => c.from(t).select("id")));
    return after.map((r) => (r.data || []).length);
  }, before).catch((e) => ["cleanup error: " + e.message]);
  const expect = before ? [before.lists.length, before.items.length, before.visits.length, before.wish.length] : null;
  row("CLEANUP: everything this run created is deleted (lists, items, visits, wishlist back to the starting counts)", !!expect && JSON.stringify(res) === JSON.stringify(expect), `now ${JSON.stringify(res)} vs start ${JSON.stringify(expect)}`);
  await s.close();
}
console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
process.exit(failed ? 1 : 0);
