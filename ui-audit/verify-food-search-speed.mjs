#!/usr/bin/env node
/* verify-food-search-speed — NEW-1 (Food search speed). Chromium, desktop width, against a build pointed at
 * the MOCKED Supabase origin (ui-audit/lib/foodFixture.mjs) — nothing here touches the owner's data; every
 * write would be recorded, not sent (this harness does none).
 *
 * The mocked search RPC answers after a FIXED delay (RPC_MS, default 600 — roughly the browser-measured
 * round trip), so this measures the CLIENT's share of "type → results": debounce, whether his saved places
 * wait for the server, cancellation, and the session cache. It says nothing about the server's own speed
 * (that is timed in-database; see the PR). Arms print a row each; the same harness runs against the pre- and
 * post-change builds for the before/after table.
 *   A SAVED   type "dao"  → ms until the first row (his saved DAO'N pin — local, needs no server)
 *   B SERVER  type "fadi" → ms until the first row (a snapshot-only place — needs the RPC)
 *   C REPEAT  clear + retype "fadi" → ms until the first row (the session cache / no second RPC)
 *   D STALE   type "fa" (slow answer, 1.5 s) then "fadi" quickly → the dropdown ends on the "fadi" answer,
 *             never the slow "fa" one; reports how many search requests were cancelled
 * Usage: node ui-audit/verify-food-search-speed.mjs [baseUrl] [--label before|after] */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { makeFixture, installFixture } from "./lib/foodFixture.mjs";

const BASE = process.argv.find((a) => a.startsWith("http")) || "http://localhost:4180";
const RPC_MS = Number(process.env.RPC_MS || 600);
const RUNS = 3;
const label = process.argv.includes("--label") ? process.argv[process.argv.indexOf("--label") + 1] : "run";

async function open(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const state = makeFixture({});
  const stats = { rpc: 0, aborted: 0 };
  page.on("requestfailed", (r) => { if (r.url().includes("food_places_search_by_name")) stats.aborted += 1; });
  await installFixture(page, state);
  // Later-registered routes run first: delay the search RPC, then hand it on to the fixture's own answer.
  await page.route("**/rest/v1/rpc/food_places_search_by_name", async (route) => {
    stats.rpc += 1;
    const q = JSON.parse(route.request().postData() || "{}").p_query || "";
    await new Promise((r) => setTimeout(r, q.length <= 2 ? 1500 : RPC_MS));
    try { await route.fallback(); } catch (_) { /* cancelled by the app: expected */ }
  });
  await page.goto(`${BASE}/#/food`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="food-map"]', { timeout: 20000 });
  await assertMeasurable(page, "verify-food-search-speed");
  await page.waitForFunction(() => !!window.__foodMap, null, { timeout: 10000 });
  await page.waitForTimeout(800);
  return { ctx, page, stats };
}

// Types text, then returns ms from the LAST keystroke until the first result row appears (in-page clock).
async function typeAndTime(page, text, re) {
  const box = page.locator('[data-testid="food-search-box"]');
  await box.click();
  await page.evaluate((src) => {
    const rx = new RegExp(src, "i");
    window.__t = { first: null, t0: null };
    const tick = () => {
      if (window.__t.first != null || window.__t.t0 == null) return;
      for (const b of document.querySelectorAll('[data-testid="food-search-results"] button')) if (rx.test(b.innerText)) { window.__t.first = performance.now(); return; }
    };
    window.__t.iv = setInterval(tick, 4);
  }, re);
  await page.keyboard.type(text.slice(0, -1), { delay: 40 });
  await page.evaluate(() => { window.__t.t0 = performance.now(); });
  await page.keyboard.type(text.slice(-1));
  await page.waitForFunction(() => window.__t.first != null, null, { timeout: 8000 }).catch(() => {});
  return page.evaluate(() => { clearInterval(window.__t.iv); return window.__t.first == null ? null : Math.max(0, Math.round(window.__t.first - window.__t.t0)); });
}
const clear = async (page) => { const b = page.locator('[data-testid="food-search-box"]'); await b.fill(""); await page.waitForTimeout(300); };
const rows = (page) => page.locator('[data-testid="food-search-results"] button').allInnerTexts();
const med = (a) => { const v = a.filter((x) => x != null).sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : null; };

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const out = { A: [], B: [], C: [] };
let stale = null;
for (let i = 0; i < RUNS; i++) {
  const { ctx, page } = await open(browser);
  out.A.push(await typeAndTime(page, "dao", "dao")); await clear(page);
  out.B.push(await typeAndTime(page, "fadi", "fadi")); await clear(page);
  out.C.push(await typeAndTime(page, "fadi", "fadi"));
  await ctx.close();
}
{ // D — stale / cancellation
  const { ctx, page, stats } = await open(browser);
  const box = page.locator('[data-testid="food-search-box"]');
  await box.click();
  await page.keyboard.type("fa", { delay: 40 });
  await page.waitForTimeout(250); // past the debounce: the slow "fa" request is now in flight
  await page.keyboard.type("di", { delay: 40 });
  await page.waitForTimeout(RPC_MS + 1800); // long enough for the slow "fa" answer to land if it were let in
  const shown = await rows(page);
  stale = { shown, aborted: stats.aborted, sent: stats.rpc };
  await ctx.close();
}
await browser.close();

console.log(`\n[${label}] RPC mocked at ${RPC_MS} ms; median of ${RUNS} runs, ms from last keystroke to first row`);
console.log(`A SAVED  (dao)         ${med(out.A)}   raw ${JSON.stringify(out.A)}`);
console.log(`B SERVER (fadi)        ${med(out.B)}   raw ${JSON.stringify(out.B)}`);
console.log(`C REPEAT (fadi again)  ${med(out.C)}   raw ${JSON.stringify(out.C)}`);
const fadiOnly = stale.shown.length > 0 && stale.shown.every((t) => /fadi/i.test(t));
console.log(`D STALE  rows=${JSON.stringify(stale.shown.map((t) => t.split("\n")[0]))} requests sent=${stale.sent} cancelled=${stale.aborted} → ${fadiOnly ? "PASS ends on the fadi answer" : "FAIL"}`);
process.exit(fadiOnly ? 0 : 1);
