#!/usr/bin/env node
/* verify-food-phone — B2046224 (Food on a phone: search duplicates, map follow, search-bar layout).
 *
 * ENGINE: Playwright **WebKit** with the iPhone 15 device descriptor (touch, isMobile, DPR 3), against
 * a build pointed at a MOCKED Supabase origin (ui-audit/lib/foodFixture.mjs). Nothing here touches the
 * owner's data: every request is answered from the in-memory fixture and every write is recorded, not sent.
 * Labels: this is WebKit-emulated-iPhone, NOT Mobile Safari. The on-screen keyboard cannot be raised in
 * headless WebKit — "keyboard up" is EMULATED by shrinking the visual viewport height (setViewportSize).
 *
 * Arms (each prints a row; exit 1 on any FAIL):
 *   1 DUPLICATE  — search "dao": exactly ONE row for the pair; picking it opens the EXISTING pin
 *                  (its past visit is on screen) and logging does NOT mint a second record.
 *   2 MAP-FOLLOW — picking a never-saved restaurant (9 km away) moves the camera so its pin sits in the
 *                  visible map area (above the bottom sheet), and the panel names it.
 *   3 LAYOUT     — focus + type in the search field: the Map/List toggle AND the field both stay
 *                  fully on screen, and each is the topmost thing at its own centre (not clipped / covered).
 * Controls: a chain ("torchy") keeps both genuinely-different branches; desktop width is unaffected.
 *
 * Usage: node ui-audit/verify-food-phone.mjs [baseUrl]   (build with the fixture env first — see foodFixture.mjs)
 */
import { webkit, chromium, devices } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { makeFixture, installFixture } from "./lib/foodFixture.mjs";

const BASE = process.argv[2] || "http://localhost:4180";
const results = [];
const row = (arm, ok, detail) => { results.push({ arm, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${arm} — ${detail}`); };

async function open(browser, { variant = "plain", device = "iPhone 15", viewport } = {}) {
  const ctx = await browser.newContext({ ...(device ? devices[device] : {}), ...(viewport ? { viewport } : {}), ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.__touch = !!device;
  const state = makeFixture({ variant });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await installFixture(page, state);
  await page.goto(`${BASE}/#/food`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="food-map"]', { timeout: 20000 });
  await assertMeasurable(page, "verify-food-phone");
  await page.waitForFunction(() => !!window.__foodMap, null, { timeout: 10000 });
  await page.waitForTimeout(600); // initial bounds fetch + visits load
  return { ctx, page, state, errors };
}

const searchBox = (page) => page.locator('[data-testid="food-search-box"]');
async function typeInSearch(page, text) {
  const box = searchBox(page);
  if (page.__touch) await box.tap(); else await box.click();
  await page.keyboard.type(text, { delay: 30 });
  await page.waitForTimeout(700); // debounce + RPC
}
const resultNames = (page) => page.locator('[data-testid="food-search-results"] button').evaluateAll((bs) => bs.map((b) => b.innerText.replace(/\s+/g, " ").trim()));

async function pinPoint(page, lat, lon) {
  return page.evaluate(([la, lo]) => {
    const m = window.__foodMap; const p = m.latLngToContainerPoint([la, lo]); const s = m.getSize();
    return { x: p.x, y: p.y, w: s.x, h: s.y, zoom: m.getZoom() };
  }, [lat, lon]);
}
const centre = (page) => page.evaluate(() => { const c = window.__foodMap.getCenter(); return { lat: c.lat, lon: c.lng }; });

async function armDuplicate(browser, variant) {
  const { ctx, page, state, errors } = await open(browser, { variant });
  await typeInSearch(page, "dao");
  const names = await resultNames(page);
  const daon = names.filter((n) => /dao.?n/i.test(n));
  row(`1 DUPLICATE (${variant}): one row for the pair`, daon.length === 1, `rows=${JSON.stringify(daon)}`);
  // Pick EVERY dao row in turn on a fresh page so a duplicate can't hide behind "the first one works".
  for (let i = 0; i < daon.length; i++) {
    const pg = i === 0 ? page : (await open(browser, { variant })).page;
    if (i > 0) await typeInSearch(pg, "dao");
    await pg.locator('[data-testid="food-search-results"] button').filter({ hasText: /dao.?n/i }).nth(i).tap();
    await pg.waitForTimeout(600);
    const panelText = await pg.locator("body").innerText();
    const hasPast = /noodles/i.test(panelText) || /8\.5/.test(panelText);
    row(`1 DUPLICATE (${variant}): row ${i + 1} opens the EXISTING restaurant (past visit shown)`, hasPast, `past-visit-visible=${hasPast}`);
  }
  // Save path: log a visit from the opened panel and count what was written.
  const openForm = page.locator('[data-testid="food-log-visit-btn"]').first();
  if (await openForm.count()) {
    await openForm.tap(); await page.waitForTimeout(400);
    await page.getByRole("button", { name: "Log this visit", exact: true }).last().tap();
    await page.waitForTimeout(900);
    const posts = state.writes.filter((w) => w.method === "POST");
    const b = posts[0]?.body;
    const reusesPin = !!b && b.place_id == null && b.custom_name === state.manualName && Math.abs(b.custom_lat - 29.7380) < 1e-9;
    row(`1 DUPLICATE (${variant}): logging reuses the existing pin, mints no second record`, posts.length === 1 && reusesPin, `posts=${posts.length} body=${JSON.stringify(b && { place_id: b.place_id, custom_name: b.custom_name, custom_lat: b.custom_lat })}`);
  } else row(`1 DUPLICATE (${variant}): save-path probe`, false, "no log-visit button found (instrument could not reach the save control)");
  if (errors.length) row(`1 DUPLICATE (${variant}): no page errors`, false, errors.join(" | "));
  await ctx.close();
}

/* Where the pin sits, as a fraction of the area the panel leaves visible. PHONE: the visible area is the
 * map minus the bottom sheet (full width). DESKTOP: the map minus the 340-wide right rail. The pin must land
 * near the middle of that area — "inside it" is too loose (a pin hugging the edge passes) so the bound is a
 * central band. */
async function visibleArea(page) {
  return page.evaluate(() => {
    const host = document.querySelector('[data-testid="food-map"]').getBoundingClientRect();
    const sheet = document.querySelector('[data-testid="food-bottom-sheet"]');
    const rail = document.querySelector('[data-testid="food-visit-panel"]');
    let right = host.width, bottom = host.height, mode = "none";
    if (sheet) { bottom = Math.max(0, sheet.getBoundingClientRect().top - host.top); mode = "sheet"; }
    else if (rail) { right = Math.max(0, rail.getBoundingClientRect().left - host.left); mode = "rail"; }
    return { right, bottom, w: host.width, h: host.height, mode };
  });
}

async function armMapFollow(browser, { label, device, viewport }) {
  const { ctx, page } = await open(browser, { device, viewport });
  const tapOrClick = (loc) => (device ? loc.tap() : loc.click());
  const fadis = { lat: 29.6800, lon: -95.4600 };
  const before = await centre(page);
  await searchBox(page).click();
  await page.keyboard.type("fadi", { delay: 30 });
  await page.waitForTimeout(700);
  const names = await resultNames(page);
  row(`2 MAP-FOLLOW (${label}): never-saved restaurant is in the results`, names.some((n) => /fadi/i.test(n)), JSON.stringify(names));
  await tapOrClick(page.locator('[data-testid="food-search-results"] button').filter({ hasText: /fadi/i }).first());
  await page.waitForTimeout(3200); // flyTo is capped at 1.5 s; + sheet settle
  const pt = await pinPoint(page, fadis.lat, fadis.lon);
  const area = await visibleArea(page);
  const cx = area.right / 2, cy = area.bottom / 2;
  const centred = Math.abs(pt.x - cx) <= area.right * 0.2 && Math.abs(pt.y - cy) <= area.bottom * 0.2;
  const after = await centre(page);
  const moved = Math.abs(after.lat - before.lat) > 0.01 || Math.abs(after.lon - before.lon) > 0.01;
  row(`2 MAP-FOLLOW (${label}): camera moved toward the pick`, moved, `centre ${before.lat.toFixed(3)},${before.lon.toFixed(3)} → ${after.lat.toFixed(3)},${after.lon.toFixed(3)}`);
  row(`2 MAP-FOLLOW (${label}): pin is near the middle of the visible area (${area.mode})`, area.mode !== "none" && centred, `pin=(${pt.x.toFixed(0)},${pt.y.toFixed(0)}) wanted≈(${cx.toFixed(0)},${cy.toFixed(0)}) visible=${area.right.toFixed(0)}x${area.bottom.toFixed(0)} map=${pt.w}x${pt.h} zoom=${pt.zoom}`);
  const marked = await page.locator('[data-testid="food-map"]').getAttribute("data-selected-pin");
  row(`2 MAP-FOLLOW (${label}): the pick is marked as the selected pin`, marked === "place:fx-fadis", `data-selected-pin=${JSON.stringify(marked)}`);
  await ctx.close();
}

async function armMapFollowFromList(browser) {
  const { ctx, page } = await open(browser, { variant: "plain" });
  await page.getByRole("button", { name: "List", exact: true }).tap();
  await page.waitForTimeout(500);
  await page.locator("text=/dao.?n/i").first().tap();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Map", exact: true }).tap();
  await page.waitForTimeout(2500);
  const pt = await pinPoint(page, 29.7380, -95.5300);
  const area = await visibleArea(page);
  const ok = area.mode !== "none" && Math.abs(pt.x - area.right / 2) <= area.right * 0.2 && Math.abs(pt.y - area.bottom / 2) <= area.bottom * 0.2;
  row("2 MAP-FOLLOW (from the list): pick centres the map on that pin", ok, `pin=(${pt.x.toFixed(0)},${pt.y.toFixed(0)}) wanted≈(${(area.right / 2).toFixed(0)},${(area.bottom / 2).toFixed(0)}) mode=${area.mode}`);
  await ctx.close();
}

async function armLayout(browser, { label, viewport, device }) {
  const { ctx, page } = await open(browser, { viewport, device });
  const measure = async () => page.evaluate(() => {
    const vv = window.visualViewport; const W = vv ? vv.width : innerWidth; const H = vv ? vv.height : innerHeight;
    const btn = (t) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === t);
    const input = document.querySelector('[data-testid="food-search-box"]');
    const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom) }; };
    const hit = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!e && (e === el || el.contains(e)); };
    const map = btn("Map"), list = btn("List");
    return { W, H, toggle: rect(map), list: rect(list), input: rect(input), hit: [hit(map), hit(list), hit(input)] };
  });
  const fits = (m, key) => m[key] && m[key].l >= 0 && m[key].r <= m.W + 0.5 && m[key].t >= 0 && m[key].b <= m.H + 0.5;
  const allOk = (m) => fits(m, "toggle") && fits(m, "list") && fits(m, "input") && m.hit.every(Boolean);
  const before = await measure();
  row(`3 LAYOUT (${label}): at rest, toggle + field fully on screen & hittable`, allOk(before), JSON.stringify(before));
  await typeInSearch(page, "dao");
  const typed = await measure();
  row(`3 LAYOUT (${label}): while typing, toggle + field stay fully on screen & hittable`, allOk(typed), JSON.stringify(typed));
  const scrollX = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  row(`3 LAYOUT (${label}): no sideways page scroll`, !scrollX, `scrollWidth>innerWidth=${scrollX}`);
  if (device) {
    const vp = page.viewportSize();
    await page.setViewportSize({ width: vp.width, height: Math.round(vp.height * 0.55) }); // EMULATED keyboard-up
    await page.waitForTimeout(500);
    const kb = await measure();
    row(`3 LAYOUT (${label}): keyboard-up (emulated), toggle + field still on screen & hittable`, allOk(kb), JSON.stringify(kb));
  }
  await ctx.close();
}

async function armChain(browser) {
  const { ctx, page } = await open(browser);
  await typeInSearch(page, "torchy");
  const names = (await resultNames(page)).filter((n) => /torchy.*fixture way/i.test(n));
  row("CONTROL chain: two genuinely different branches stay two rows", names.length === 2, JSON.stringify(names));
  await ctx.close();
}

const wk = await webkit.launch();
try {
  await armDuplicate(wk, "plain");
  await armDuplicate(wk, "case");
  await armDuplicate(wk, "curly");
  await armMapFollow(wk, { label: "WebKit iPhone 15", device: "iPhone 15" });
  await armMapFollowFromList(wk);
  await armLayout(wk, { label: "WebKit iPhone 15", device: "iPhone 15" });
  await armLayout(wk, { label: "WebKit iPhone SE", device: "iPhone SE" });
  await armChain(wk);
} finally { await wk.close(); }

const cr = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--ignore-certificate-errors"] });
try {
  await armLayout(cr, { label: "Chromium desktop 1440", viewport: { width: 1440, height: 900 }, device: null });
  await armMapFollow(cr, { label: "Chromium desktop 1440", viewport: { width: 1440, height: 900 }, device: null });
}
finally { await cr.close(); }

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length ? 1 : 0);
