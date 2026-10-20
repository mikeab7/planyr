#!/usr/bin/env node
/* verify-food-restaurant-panel — the redesigned restaurant panel + dish sheet (NEW-1 / NEW-2, owner-approved mockup 2026-10-20),
 * on an emulated iPhone in WebKit, at TWO sizes (iPhone 15, iPhone SE) in BOTH orientations (upright = bottom sheet, sideways =
 * side dock). Built on PR #2366's sheet (its own drag harness, verify-food-sheet-drag, is run separately and unchanged).
 *
 * What it proves (the block's acceptance list, each a named check):
 *  · header: name + plain close ✕ on ONE line; "<cuisine> · <city> · $…" with the word Restaurant dropped; the address in grey ending
 *    "· Directions"; · score pills "8.25 Food" / "8.0 Ambiance" + "+ List" on the same row; no VISITS / COST tile;
 *  · the dish list IS the order: WHAT TO ORDER (yes, by score) · MAYBE (maybe / unanswered) · "Skip · N dishes ▾" collapsed until tapped;
 *    a twice-rated dish with no note shows "Was 4.5 · up from last time"; no "THE ORDER" card, Copy, Best dish, Sort or ⋮ anywhere;
 *  · the SAME Food score reads identically at the top and in the visit rows (one formatter); visits are one line each, two shown + "Show N more";
 *  · "Log a visit" stays visible while the sheet scrolls (elementFromPoint at its centre is the button, top and bottom of the scroll);
 *  · the dish sheet: no history for a once-rated dish, history for a twice-rated one; changing Yes → No moves the dish after Done;
 *  · price level: tapping $$ sets it, a cache-busted reload shows $$, tapping $$ again clears it (database checked both ways).
 *
 * LIVE ONLY (real food_place_prefs / food_dishes + RLS, test account; every row deleted in `finally` and PROVEN gone — owner rule 15).
 * Default: the fixture build at :4180 (layout-only arms, no database). ENGINE: WebKit + iPhone descriptors — reported as "WebKit", never
 * "iPhone"; a real finger on Mobile Safari is not claimed. KNOWN-ANSWER ARMS: the throwaway place starts with no price level and no dishes.
 *
 * Usage: node ui-audit/verify-food-restaurant-panel.mjs --live [https://planyr.io | a *.planyr.pages.dev preview] [--phones=...] [--shots=<dir>]
 */
import { webkit } from "playwright";
import { mkdirSync } from "node:fs";
import { open as openRaw, openPlace, LIVE, LIVE_MARK, LIVE_ABURI, BASE, cleanupLive, closeLeakedLive } from "./lib/foodIosPage.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const SHOTS = (process.argv.find((a) => a.startsWith("--shots=")) || "").slice(8);
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const PHONES = ((process.argv.find((a) => a.startsWith("--phones=")) || "").slice(9) || "iPhone 15,iPhone SE").split(",").map((s) => s.trim()).filter(Boolean);
const results = [];
const check = (id, ok, detail = "") => { results.push({ id, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${id}${detail ? "  — " + detail : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (page, n) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${n}.png` }); };
const until = async (fn, ms = 12000) => { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await fn(); if (v) return v; await sleep(400); } return v; };
const texts = (page, sel) => page.locator(sel).allInnerTexts();
const T = (s) => s.replace(/\s+/g, " ").trim();

// ── LIVE seed: three visits (two dated, one undated; all Food 8.25 / Ambiance 8.0 so the mean equals every row) + dishes in all
//    three groups, one of them rated twice (older rating on the first visit) with no note.
const DISHES = { order: ["ZZ Salmon Nigiri", "ZZ Miso Soup"], maybe: ["ZZ Tempura", "ZZ Edamame"], skip: ["ZZ Udon"] };
async function seedPanel(base) {
  const s = await openSignedIn({ base });
  try {
    const r = await s.page.evaluate(async ([mark, placeId]) => {
      const c = window.pfSupabase;
      const { data: u } = await c.auth.getUser();
      await c.from("food_visits").delete().eq("user_id", u.user.id); // idempotent re-seed (dishes cascade)
      await c.from("food_place_prefs").delete().eq("user_id", u.user.id);
      const v = (visited_on) => ({ user_id: u.user.id, place_id: placeId, visited_on, rating: 8.25, rating_ambiance: 8, notes: mark + " seeded by verify-food-restaurant-panel (deleted at the end of the run)" });
      const ins = await c.from("food_visits").insert([v("2026-10-01"), v("2026-09-20"), v(null)]).select("id,visited_on");
      if (ins.error) return { error: String(ins.error.message) };
      const byDate = Object.fromEntries(ins.data.map((x) => [x.visited_on || "none", x.id]));
      const d = (visit_id, name, score, order_again, extra = {}) => ({ user_id: u.user.id, visit_id, name, score, order_again, ...extra });
      const dishes = await c.from("food_dishes").insert([
        d(byDate["2026-10-01"], "ZZ Salmon Nigiri", 9.5, "yes", { note: "ask for the aburi version" }),
        d(byDate["2026-10-01"], "ZZ Miso Soup", 7, "yes"),
        d(byDate["2026-10-01"], "ZZ Tempura", 6.5, "maybe"),
        d(byDate["2026-10-01"], "ZZ Edamame", 8, null),
        d(byDate["2026-09-20"], "ZZ Udon", 4.5, "maybe"),
        d(byDate["2026-10-01"], "ZZ Udon", 5, "no"),
      ]).select("id");
      if (dishes.error) return { error: String(dishes.error.message) };
      return { visits: ins.data.length, dishes: dishes.data.length };
    }, [LIVE_MARK, LIVE_ABURI]);
    if (r.error) throw new Error("seedPanel failed — " + r.error);
    return r;
  } finally { await s.close(); }
}
const db = (page, table, cols) => page.evaluate(async ([t, c]) => (await window.pfSupabase.from(t).select(c)).data || [], [table, cols]);

/** Where "Log a visit" sits and whether a finger at its centre would hit it (nothing drawn over it). */
const logVisible = (page) => page.evaluate(() => {
  const b = document.querySelector('[data-testid="food-log-visit-btn"]'); if (!b) return { present: false };
  const r = b.getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { present: true, onTop: el === b || b.contains(el), bottom: Math.round(r.bottom), vh: innerHeight };
});
const scroller = (page) => page.evaluate(() => {
  const s = document.querySelector('[data-testid="food-bottom-sheet"]'); const c = s ? s.children[1] : document.querySelector('[data-testid="food-side-scroll"], [data-testid="food-visit-panel"]');
  return c ? { top: c.scrollTop, max: c.scrollHeight - c.clientHeight } : null;
});
const scrollTo = (page, y) => page.evaluate((y) => {
  const s = document.querySelector('[data-testid="food-bottom-sheet"]'); const c = s ? s.children[1] : document.querySelector('[data-testid="food-side-scroll"], [data-testid="food-visit-panel"]');
  if (c) c.scrollTop = y;
}, y);

async function layoutArms(page, L) {
  // header
  const hdr = await page.evaluate(() => {
    const q = (s) => document.querySelector(s); const R = (e) => e && e.getBoundingClientRect();
    const xEl = q('[data-testid="food-panel-close"]');
    const title = R(q('[data-testid="food-panel-title"]')), x = R(xEl), handle = R(q('[data-testid="food-bottom-sheet"] > div'));
    const sub = q('[data-testid="food-panel-subline"]'); const addr = q('[data-testid="food-directions-link"]');
    const grey = getComputedStyle(document.documentElement).getPropertyValue("--text-secondary").trim();
    const probe = document.createElement("span"); probe.style.color = grey; document.body.appendChild(probe); const greyRgb = getComputedStyle(probe).color; probe.remove();
    return {
      sameLine: !!title && !!x && x.top < title.bottom && x.bottom > title.top, xRight: x && title ? x.left >= title.left : null,
      gap: title && handle ? Math.round(title.top - handle.bottom) : null,
      sub: sub ? sub.innerText.replace(/\s+/g, " ").trim() : null, price: !!q('[data-testid="food-price-level"]'), level: q('[data-testid="food-price-level"]')?.dataset.level ?? null,
      addr: addr ? addr.innerText.replace(/\s+/g, " ").trim() : null, addrGrey: addr ? getComputedStyle(addr).color === greyRgb : null,
      circle: xEl ? getComputedStyle(xEl).borderRadius : null,
    };
  });
  check(`${L} H1 name and the plain close ✕ sit on the SAME line, ✕ at the right, no circle`, hdr.sameLine && hdr.xRight && (!hdr.circle || hdr.circle === "0px"), JSON.stringify(hdr));
  check(`${L} H2 no dead space between the drag handle and the name`, hdr.gap == null || hdr.gap <= 12, `gap=${hdr.gap}`);
  check(`${L} H3 line 2 reads "<cuisine> · <city> · $…" with the word Restaurant dropped`, hdr.sub && !/Restaurant/.test(hdr.sub) && /·/.test(hdr.sub) && hdr.price && /(\$\s*){4}$/.test(hdr.sub), hdr.sub);
  check(`${L} H4 the address is GREY and reads "<street> · Directions"`, hdr.addr && /· Directions$/.test(hdr.addr) && hdr.addrGrey, `${hdr.addr} grey=${hdr.addrGrey}`);
  // pills
  const pills = await page.evaluate(() => {
    const R = (e) => e && e.getBoundingClientRect(); const f = document.querySelector('[data-testid="food-score-pill-food"]'), a = document.querySelector('[data-testid="food-score-pill-ambiance"]'), l = document.querySelector('[data-testid="food-add-to-list-btn"]');
    const row = f?.parentElement; const rowW = row ? Math.round(R(row).width) : null;
    return { food: f?.innerText.replace(/\s+/g, " ").trim(), amb: a?.innerText.replace(/\s+/g, " ").trim(), list: l?.innerText.replace(/\s+/g, " ").trim(), rowW, sameRow: f && l ? Math.abs(R(f).top + R(f).height / 2 - (R(l).top + R(l).height / 2)) < 10 && R(l).left > R(f).right : null };
  });
  // On the narrowest side dock (iPhone SE sideways, a card under ~300 wide) the "+ List" pill wraps under the two score pills — the row is allowed to wrap only there.
  check(`${L} P1 score pills "<n> Food" / "<n> Ambiance" with "+ List" on the same row${pills.rowW && pills.rowW < 300 ? " (narrow side card: wrapping allowed)" : ""}`, /^[\d.]+ Food$/.test(pills.food || "") && /^[\d.]+ Ambiance$/.test(pills.amb || "") && /List/.test(pills.list || "") && (pills.sameRow || (pills.rowW != null && pills.rowW < 300)), JSON.stringify(pills));
  const gone = await page.evaluate(() => ({
    order: !!document.querySelector('[data-testid="food-the-order"], [data-testid="food-the-order-copy"], [data-testid="food-score-strip"], [data-testid="food-dishes-sort"], [data-testid="dish-row-kebab"], [data-testid="food-visit-menu-btn"]'),
    text: /Best dish:|THE ORDER|Sort: |VISITS\s*\n|COST\s*\n/i.test(document.querySelector('[data-testid="food-bottom-sheet"], [data-testid="food-side-scroll"], [data-testid="food-visit-panel"]')?.innerText || ""),
  }));
  check(`${L} P2 no "THE ORDER" card, Copy, Best dish line, Visits/Cost tile, Sort control or ⋮ menu remains`, !gone.order && !gone.text, JSON.stringify(gone));
  // visits + log
  const visitRows = await texts(page, '[data-testid="food-visit-row-label"]');
  check(`${L} V1 each visit is one line "<date> · Food n · Ambiance n" (or "No date")`, visitRows.length > 0 && visitRows.every((t) => /^(No date|[A-Z][a-z]{2} \d{1,2}(, \d{4})?)( · Food [\d.]+)?( · Ambiance [\d.]+)?$/.test(T(t))), JSON.stringify(visitRows));
  const top = await logVisible(page);
  await scrollTo(page, 99999); await sleep(400);
  const sc = await scroller(page); const bottom = await logVisible(page);
  check(`${L} L1 "Log a visit" is pinned: a finger at its centre hits it at the top of the scroll AND after scrolling to the bottom`, top.present && top.onTop && bottom.onTop, JSON.stringify({ top, bottom, sc }));
  await scrollTo(page, 0); await sleep(300);
  return { pills, visitRows };
}

const wk = await webkit.launch();
let seeded = null;
try {
  if (LIVE) { seeded = await seedPanel(BASE); console.log("seeded:", JSON.stringify(seeded)); }
  for (const phone of PHONES) {
    for (const orient of ["portrait", "landscape"]) {
      const device = orient === "landscape" ? `${phone} landscape` : phone;
      const L = `[webkit ${device}]`;
      let ctx, page;
      try {
        ({ ctx, page } = await openRaw(wk, device, "ios"));
        await assertMeasurable(page, `verify-food-restaurant-panel:${device}`);
        await page.evaluate(() => { window.__PLANYR_E2E = true; });
        const build = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null));
        console.log(`## ${L} · ${BASE} · build ${build && build.build}`);
        await openPlace(page, "aburi", /aburi/i, true); await sleep(LIVE ? 2500 : 1200);
        const container = await page.evaluate(() => ({ sheet: !!document.querySelector('[data-testid="food-bottom-sheet"]'), dock: !!document.querySelector('[data-testid="food-side-scroll"]') }));
        check(`${L} C0 container: ${orient === "landscape" ? "side dock, no sheet" : "bottom sheet"}`, orient === "landscape" ? container.dock && !container.sheet : container.sheet, JSON.stringify(container));
        await shot(page, `${device.replace(/\s+/g, "-")}-panel`);
        const { pills, visitRows } = await layoutArms(page, L);

        if (!LIVE) continue; // the fixture has no dishes / prefs table — layout only
        const isFull = phone === PHONES[0] && orient === "portrait"; // the full acceptance flow once; every size/orientation gets the layout + sections

        // ── sections
        const order = (await texts(page, '[data-testid="food-dishes-order"] [data-testid="dish-row"]')).map((t) => T(t).split(/\s/).slice(1, 4).join(" "));
        const maybe = (await texts(page, '[data-testid="food-dishes-maybe"] [data-testid="dish-row"]')).map((t) => T(t).split(/\s/).slice(1, 3).join(" "));
        const skipToggle = T((await page.locator('[data-testid="food-dishes-skip-toggle"]').innerText().catch(() => "")));
        const skipRowsClosed = await page.locator('[data-testid="food-dishes-skip"] [data-testid="dish-row"]').count();
        check(`${L} S1 WHAT TO ORDER holds the "yes" dishes by score (Salmon 9.5 before Miso 7.0)`, order.join("|") === "ZZ Salmon Nigiri|ZZ Miso Soup", JSON.stringify(order));
        check(`${L} S2 MAYBE holds the "maybe" dish and the unanswered one`, maybe.join("|") === "ZZ Edamame|ZZ Tempura" || maybe.join("|") === "ZZ Tempura|ZZ Edamame", JSON.stringify(maybe));
        check(`${L} S3 "Skip · 1 dish ▾" is collapsed by default (no skip rows drawn)`, /^Skip · 1 dish/.test(skipToggle) && skipRowsClosed === 0, `${skipToggle} rows=${skipRowsClosed}`);
        await page.locator('[data-testid="food-dishes-skip-toggle"]').tap(); await sleep(400);
        const skipRows = await texts(page, '[data-testid="food-dishes-skip"] [data-testid="dish-row"]');
        check(`${L} S4 one tap expands Skip: the "no" dish appears`, skipRows.length === 1 && /ZZ Udon/.test(skipRows[0]), JSON.stringify(skipRows));
        check(`${L} S5 a twice-rated dish with no note shows its movement: "Was 4.5 · up from last time"`, /Was 4\.5 · up from last time/.test(skipRows[0] || ""), T(skipRows[0] || ""));
        const badges = await page.evaluate(() => [...document.querySelectorAll('[data-testid="dish-score-chip"]')].map((b) => [b.closest("[data-dish-section]").dataset.dishSection, b.dataset.badge, getComputedStyle(b).backgroundColor]));
        check(`${L} S6 badges: order rows DARK, maybe/skip rows LIGHT grey — never red`, badges.every(([s, k, bg]) => (s === "order" ? k === "dark" : k === "light" || k === "unset") && !/^rgb\(2[0-5]\d, (\d|[1-9]\d), (\d|[1-9]\d)\)$/.test(bg)), JSON.stringify(badges));
        check(`${L} N1 the SAME Food score reads identically at the top and in every visit row`, pills.food === "8.25 Food" && visitRows.every((t) => /Food 8\.25/.test(t)), `${pills.food} / ${JSON.stringify(visitRows)}`);
        check(`${L} V2 two visits shown, "Show 1 more" for the third; newest first; the undated one reads "No date" once shown`, visitRows.length === 2 && /^Oct 1/.test(T(visitRows[0])) && /^Sep 20/.test(T(visitRows[1])) && (await page.locator('[data-testid="food-visits-more"]').innerText()).trim() === "Show 1 more", JSON.stringify(visitRows));
        await page.locator('[data-testid="food-visits-more"]').tap(); await sleep(400);
        const allRows = await texts(page, '[data-testid="food-visit-row-label"]');
        check(`${L} V3 after "Show 1 more" the third row reads "No date · Food 8.25 · Ambiance 8.0"`, allRows.length === 3 && T(allRows[2]) === "No date · Food 8.25 · Ambiance 8.0", JSON.stringify(allRows));
        await shot(page, `${device.replace(/\s+/g, "-")}-sections`);

        if (!isFull) continue;

        // ── dish sheet: history rule, Yes → No moves the dish after Done
        await page.locator('[data-testid="dish-row"]').filter({ hasText: "ZZ Udon" }).tap(); await sleep(600);
        const sheetUdon = await page.evaluate(() => ({ sheet: !!document.querySelector('[data-testid="dish-sheet"]'), back: document.querySelector('[data-testid="dish-sheet-back"]')?.innerText.trim(), hist: document.querySelectorAll('[data-testid="dish-history-entry"]').length, log: !!document.querySelector('[data-testid="food-log-visit-btn"]') && document.querySelector('[data-testid="food-log-visit-btn"]').offsetParent !== null, yes: document.querySelector('[data-testid="dish-order-again-no"]')?.getAttribute("aria-pressed") }));
        check(`${L} D1 the dish sheet opens with "‹ Aburi…" back, shows the twice-rated dish's 2-entry history, and hides "Log a visit"`, sheetUdon.sheet && /Aburi/i.test(sheetUdon.back || "") && sheetUdon.hist === 2 && !sheetUdon.log && sheetUdon.yes === "true", JSON.stringify(sheetUdon));
        await shot(page, `${device.replace(/\s+/g, "-")}-dish-sheet`);
        await page.locator('[data-testid="dish-sheet-back"]').tap(); await sleep(500);
        await page.locator('[data-testid="dish-row"]').filter({ hasText: "ZZ Salmon Nigiri" }).tap(); await sleep(600);
        const sheetSalmon = await page.evaluate(() => ({ sheet: !!document.querySelector('[data-testid="dish-sheet"]'), hist: document.querySelectorAll('[data-testid="dish-sheet-history"]').length, note: document.querySelector('[data-testid="dish-sheet-note"]')?.value, ph: document.querySelector('[data-testid="dish-sheet-note"]')?.placeholder, score: document.querySelector('[data-testid="dish-score-numeral"]')?.innerText.trim() }));
        check(`${L} D2 a once-rated dish shows NO history; its note and score are in the sheet`, sheetSalmon.sheet && sheetSalmon.hist === 0 && sheetSalmon.note === "ask for the aburi version" && sheetSalmon.ph === "How to order it next time" && /^9\.5/.test(sheetSalmon.score || ""), JSON.stringify(sheetSalmon));
        await page.locator('[data-testid="dish-order-again-no"]').tap(); await sleep(200);
        await page.locator('[data-testid="dish-sheet-done"]').tap();
        await until(async () => (await db(page, "food_dishes", "name,order_again")).some((d) => d.name === "ZZ Salmon Nigiri" && d.order_again === "no")); await sleep(1200);
        const after = { order: (await texts(page, '[data-testid="food-dishes-order"] [data-testid="dish-row"]')).map(T), skipToggle: T(await page.locator('[data-testid="food-dishes-skip-toggle"]').innerText()), sheet: await page.locator('[data-testid="dish-sheet"]').count() };
        await page.locator('[data-testid="food-dishes-skip-toggle"]').tap(); await sleep(400);
        after.skip = (await texts(page, '[data-testid="food-dishes-skip"] [data-testid="dish-row"]')).map(T);
        check(`${L} D3 changing Yes → No and tapping Done moves the dish out of WHAT TO ORDER into Skip (now "Skip · 2 dishes") immediately`, after.sheet === 0 && !after.order.some((t) => /Salmon/.test(t)) && /^Skip · 2 dishes/.test(after.skipToggle) && after.skip.some((t) => /Salmon/.test(t)), JSON.stringify(after));

        // ── price level: set $$, reload (cache-busted), still $$; tap $$ again clears it
        check(`${L} arm: the throwaway place starts with NO price level (all four $ grey)`, (await page.locator('[data-testid="food-price-level"]').getAttribute("data-level")) === "" && (await db(page, "food_place_prefs", "price_level")).length === 0);
        await page.locator('[data-testid="food-price-level-2"]').tap(); await sleep(300);
        const lvl = await page.evaluate(() => ({ level: document.querySelector('[data-testid="food-price-level"]').dataset.level, filled: [...document.querySelectorAll('[data-testid^="food-price-level-"]')].map((b) => b.dataset.filled) }));
        const saved = await until(async () => { const r = await db(page, "food_place_prefs", "price_level,place_id"); return r.length === 1 && r[0].price_level === 2 ? r : null; });
        check(`${L} $1 tapping the second $ sets $$ at once (two dark, two grey) and saves it on the restaurant record`, lvl.level === "2" && lvl.filled.join("") === "truetruefalsefalse" && !!saved && saved[0].place_id === LIVE_ABURI, JSON.stringify({ lvl, saved }));
        await page.goto(`${BASE}/?cb=${Date.now()}#/food`, { waitUntil: "domcontentloaded" });
        await page.waitForSelector('[data-testid="food-map"]'); await sleep(2000);
        await openPlace(page, "aburi", /aburi/i, true); await sleep(2500);
        const lvl2 = await page.evaluate(() => ({ level: document.querySelector('[data-testid="food-price-level"]')?.dataset.level, sub: document.querySelector('[data-testid="food-panel-subline"]')?.innerText.replace(/\s+/g, " ").trim() }));
        check(`${L} $2 after a cache-busted reload the panel shows $$`, lvl2.level === "2" && /(\$\s*){4}$/.test(lvl2.sub || ""), JSON.stringify(lvl2));
        await page.locator('[data-testid="food-price-level-2"]').tap(); await sleep(300);
        const cleared = await until(async () => { const r = await db(page, "food_place_prefs", "price_level"); return r.length === 1 && r[0].price_level === null ? r : null; });
        check(`${L} $3 tapping the current level again clears it (all grey, null in the database)`, (await page.locator('[data-testid="food-price-level"]').getAttribute("data-level")) === "" && !!cleared, JSON.stringify(cleared));
        const noSideways = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth);
        check(`${L} X nothing pans sideways`, noSideways);
      } catch (e) {
        check(`${L} section aborted`, false, String(e.stack || e).split("\n").slice(0, 2).join(" | "));
      } finally {
        try { await ctx?.close(); } catch (_) { /* closed */ }
        await closeLeakedLive().catch(() => {});
      }
    }
  }
} finally {
  if (LIVE) {
    const c = await cleanupLive(BASE).catch((e) => ({ error: String(e) }));
    console.log("live cleanup:", JSON.stringify(c));
    if (c.error || c.left !== 0) { console.log("FAIL  live cleanup left rows behind"); process.exitCode = 1; }
  }
  await wk.close().catch(() => {});
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed (WebKit, ${PHONES.join(" + ")}, portrait + landscape, ${LIVE ? "live, test account" : "fixture"})`);
process.exit(failed.length || process.exitCode ? 1 : 0);
