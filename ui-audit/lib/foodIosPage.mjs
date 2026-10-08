/* foodIosPage — the full Food app on a mocked signed-in session, with a painted stand-in for
 * satellite tiles and the iOS keyboard MODEL (layout viewport unchanged, visualViewport shrinks).
 * The model + fixture plumbing are the SAME code as verify-food-ios-screens.mjs (copied, not
 * imported, so that harness — owned by the keyboard work — is left untouched). Used by
 * verify-food-rating-and-sheet.mjs. `engine` is a Playwright browser type (webkit for pictures,
 * chromium for real touch drags via CDP). */
import { devices } from "playwright";
import { deflateSync } from "node:zlib";
import { assertMeasurable } from "./tabTiming.mjs";
import { makeFixture, installFixture } from "./foodFixture.mjs";
import { openSignedIn } from "./signedInSession.mjs";

/* --live: score the DEPLOYED site signed in as the test account (real Supabase, real Overture places) through the
 * shared helper instead of the stubbed fixture. Everything it writes carries LIVE_MARK and is deleted by cleanupLive
 * (owner rule 15: test artifacts are always cleared). The seeded visit is the same shape the fixture has ("Aburi Sushi",
 * rated 8.75 food / 8 ambiance), on the REAL Aburi Sushi row. */
export const LIVE = process.argv.includes("--live");
export const LIVE_MARK = "ZZ-E2E-THROWAWAY";
export const LIVE_ABURI = "81f01ab6-64d4-46b1-bf67-d99c4eb98dd4";

export const BASE = process.argv.find((a, i) => i > 1 && a.startsWith("http")) || (LIVE ? "https://planyr.io" : "http://localhost:4180");
export const PHONES = { "iPhone 15": { kb: 380 }, "iPhone SE": { kb: 304 } };

// ── a painted stand-in for satellite imagery (so a gap is visible in the screenshot) ─────────────
function crc32(buf) { let c, crc = 0xffffffff; for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function satelliteTile() {
  const W = 256, raw = Buffer.alloc((W * 3 + 1) * W);
  for (let y = 0; y < W; y++) {
    raw[y * (W * 3 + 1)] = 0;
    for (let x = 0; x < W; x++) {
      const n = (Math.sin(x * 0.11) + Math.cos(y * 0.07) + Math.sin((x + y) * 0.05)) * 18;
      const road = (x % 64 < 3 || y % 80 < 3) ? 60 : 0;
      const o = y * (W * 3 + 1) + 1 + x * 3;
      raw[o] = 70 + n + road; raw[o + 1] = 92 + n + road; raw[o + 2] = 58 + n * 0.6 + road;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(W, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const TILE = satelliteTile();

export const IOS_MODEL = ({ kbPx, late, latePan, loseLateEvent, tallInner }) => {
  const TALL_INNER = 64;
  const ihDesc = Object.getOwnPropertyDescriptor(window, "innerHeight") || Object.getOwnPropertyDescriptor(Window.prototype, "innerHeight");
  const layoutH = () => ihDesc.get.call(window);
  const vv = new EventTarget();
  let kb = 0, pan = 0, gen = 0;
  Object.defineProperties(vv, {
    width: { get: () => innerWidth }, height: { get: () => layoutH() - kb },
    offsetTop: { get: () => pan }, offsetLeft: { get: () => 0 }, scale: { get: () => 1 },
    pageTop: { get: () => pan }, pageLeft: { get: () => 0 },
  });
  Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
  Object.defineProperty(window, "innerHeight", { get: () => (tallInner ? layoutH() + TALL_INNER : layoutH() - kb), configurable: true });
  const fire = () => { vv.dispatchEvent(new Event("resize")); vv.dispatchEvent(new Event("scroll")); };
  const opensKeyboard = (el) => el && ((el.tagName === "INPUT" && !/^(range|button|submit|checkbox|radio|reset|file|color)$/i.test(el.type)) || el.tagName === "TEXTAREA" || el.tagName === "SELECT");
  window.__kb = { band: () => ({ top: pan, bottom: pan + layoutH() - kb }), get open() { return kb > 0; }, get px() { return kb; }, get pan() { return pan; } };
  window.__kb.set = (px) => {
    const g = ++gen;
    kb = px; pan = 0; fire();
    // iOS only slides the view to reveal a field the keyboard would cover — never one at the top.
    const a = document.activeElement;
    const needed = a && a.getBoundingClientRect().bottom > layoutH() - kb;
    if (px && late && needed) setTimeout(() => { if (g !== gen || !kb) return; pan = latePan; if (!loseLateEvent) vv.dispatchEvent(new Event("scroll")); }, 260);
  };
  document.addEventListener("focusin", (e) => { if (opensKeyboard(e.target)) setTimeout(() => { if (!window.__kb.open) window.__kb.set(kbPx); }, 60); });
  document.addEventListener("focusout", () => setTimeout(() => { if (!opensKeyboard(document.activeElement)) window.__kb.set(0); }, 60));
};

const LATE_PAN = 56;
const LOSE_LATE_EVENT = false;
/** LIVE: write the throwaway visit (a REAL place, so search finds it exactly as it would for the owner). */
export async function seedLive(base = BASE) {
  const s = await openSignedIn({ base });
  try {
    const r = await s.page.evaluate(async ([mark, placeId]) => {
      const { data: u } = await window.pfSupabase.auth.getUser();
      const del = await window.pfSupabase.from("food_visits").delete().like("notes", mark + "%"); // idempotent re-seed
      const ins = await window.pfSupabase.from("food_visits").insert({ user_id: u.user.id, place_id: placeId, visited_on: "2026-09-20", rating: 8.75, rating_ambiance: 8, cost: 64.2, what_was_good: "the aburi salmon", notes: mark + " seeded by ui-audit (deleted at the end of the run)" }).select("id");
      return { del: del.error && String(del.error.message), ins: ins.error ? String(ins.error.message) : ins.data };
    }, [LIVE_MARK, LIVE_ABURI]);
    if (r.del || typeof r.ins === "string") throw new Error("seedLive failed — " + JSON.stringify(r));
    return r.ins;
  } finally { await s.close(); }
}
/** LIVE: delete every row this run (or a crashed earlier one) created, then PROVE none is left (delete-must-verify). */
export async function cleanupLive(base = BASE) {
  const s = await openSignedIn({ base });
  try {
    return await s.page.evaluate(async (mark) => {
      const c = window.pfSupabase;
      // visits the harness SAVED have no marker in notes only if a form was submitted — none is, but sweep by owner anyway:
      // the test account owns no real visits, so "everything of this user's in food_visits" is the throwaway set.
      const { data: u } = await c.auth.getUser();
      const del = await c.from("food_visits").delete().eq("user_id", u.user.id);
      const left = await c.from("food_visits").select("id").eq("user_id", u.user.id);
      return { error: del.error && String(del.error.message), left: left.data ? left.data.length : "?" };
    }, LIVE_MARK);
  } finally { await s.close(); }
}

// Every live page owns a whole browser (openSignedIn launches one). A section that THROWS mid-way never reaches its
// ctx.close(), and each leaked WebKit/Chromium holds ~300 MB: measured 2026-10-06, 14 GB used / load 100 / a browser launch
// timing out after 180 s. So every open is tracked and the harness sweeps the stragglers after each section.
const liveOpen = new Set();
export async function closeLeakedLive() { const all = [...liveOpen]; liveOpen.clear(); await Promise.all(all.map((c) => c().catch(() => {}))); }

async function openLive(phone, mode) {
  const desktop = phone === "desktop";
  const initScripts = desktop ? [] : [[IOS_MODEL, { kbPx: (PHONES[phone] || { kb: 0 }).kb, late: mode === "ios-late", latePan: LATE_PAN, loseLateEvent: LOSE_LATE_EVENT, tallInner: mode === "ios-tallinner" }]];
  return { initScripts, desktop };
}

export async function open(browser, phone, mode) {
  if (LIVE) {
    const { initScripts, desktop } = await openLive(phone, mode);
    const s = await openSignedIn({ base: BASE, engine: browser.browserType().name() === "webkit" ? "webkit" : "chromium", device: desktop ? null : phone, viewport: { width: 1280, height: 800 }, initScripts });
    const page = s.page; page.setDefaultTimeout(30000); // live Supabase answers in seconds (a cold name search ~5-10 s), not the fixture's milliseconds
    const errs = []; page.on("pageerror", (e) => errs.push(e.message));
    await page.goto(`${BASE}/#/food`, { waitUntil: "domcontentloaded" });
    await page.reload({ waitUntil: "domcontentloaded" }); // fresh load: stored session + keyboard model installed
    await page.waitForSelector('[data-testid="food-map"]', { timeout: 30000 });
    await assertMeasurable(page, `verify-food-rating-and-sheet:live:${phone}:${mode}`);
    await page.waitForTimeout(1500);
    const closer = () => { liveOpen.delete(closer); return s.close(); };
    liveOpen.add(closer);
    return { ctx: { close: closer }, page, errs };
  }
  const desktop = phone === "desktop";
  const ctx = await browser.newContext(desktop ? { viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true } : { ...devices[phone], ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(5000);
  const state = makeFixture({ aburi: true });
  await installFixture(page, state);
  // satellite stand-in: any external image request (tile servers) gets the painted tile
  await page.route("**/*", (route) => {
    const req = route.request();
    let u; try { u = new URL(req.url()); } catch (_) { return route.fallback(); }
    if (req.resourceType() === "image" && !/localhost|127\.0\.0\.1|supabase/.test(u.hostname)) return route.fulfill({ status: 200, contentType: "image/png", body: TILE, headers: { "access-control-allow-origin": "*" } });
    return route.fallback();
  });
  if (!desktop) await page.addInitScript(IOS_MODEL, { kbPx: (PHONES[phone] || { kb: 0 }).kb, late: mode === "ios-late", latePan: LATE_PAN, loseLateEvent: LOSE_LATE_EVENT, tallInner: mode === "ios-tallinner" });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`${BASE}/#/food`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="food-map"]', { timeout: 20000 });
  await assertMeasurable(page, `verify-food-rating-and-sheet:${phone}:${mode}`);
  await page.waitForTimeout(1200);
  return { ctx, page, errs };
}

export const searchBox = (page) => page.locator('[data-testid="food-search-box"] input, input[aria-label="Search restaurants"]').first();
export async function openPlace(page, query, pick, tap = true) {
  const box = searchBox(page);
  await (tap ? box.tap() : box.click());
  await page.keyboard.type(query, { delay: 15 });
  await page.waitForTimeout(800);
  const r = page.locator('[data-testid="food-search-results"] button').filter({ hasText: pick }).first();
  await (tap ? r.tap() : r.click());
  await page.waitForTimeout(1200);
  await page.waitForSelector('[data-testid="food-bottom-sheet"], [data-testid="food-visit-panel"]');
  await page.evaluate(() => document.activeElement?.blur?.()); // start every flow from keyboard-down
  await page.waitForTimeout(500);
}

/** A REAL touch through Chromium's input pipeline (CDP Input.dispatchTouchEvent): it honours
 *  touch-action, scroll chaining, touch slop and pointer capture the way a finger does — which
 *  page.mouse (mouse events) and page.touchscreen (taps only) do not. Needs a CHROMIUM page (WebKit
 *  has no CDP); the run is therefore Chromium's touch pipeline, not Safari's. */
export async function touchSession(page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let x = 0, y = 0;
  const api = {
    /** put a finger down */
    async down(px, py) { x = px; y = py; await send("touchStart", [{ x, y, id: 1 }]); },
    /** slide the finger to y (and optionally x1) over `ms` in `steps` moves */
    async to(y1, { ms = 500, steps = 12, x1 = x } = {}) {
      const y0 = y, x0 = x;
      for (let i = 1; i <= steps; i++) { await sleep(ms / steps); y = y0 + ((y1 - y0) * i) / steps; x = x0 + ((x1 - x0) * i) / steps; await send("touchMove", [{ x, y, id: 1 }]); }
    },
    async up() { await send("touchEnd", []); },
    get y() { return y; },
    async drag(px, y0, y1, { ms = 500, steps = 12 } = {}) { await api.down(px, y0); await api.to(y1, { ms, steps }); await api.up(); },
    async tap(px, py) { await api.down(px, py); await sleep(40); await api.up(); },
    detach: () => cdp.detach(),
  };
  return api;
}
