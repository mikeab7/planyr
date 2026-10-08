#!/usr/bin/env node
/* verify-food-phone — B2046224 (Food on a phone: search duplicates, map follow, search-bar layout).
 *
 * ENGINE: Playwright **WebKit** with the iPhone 15 device descriptor (touch, isMobile, DPR 3), against
 * a build pointed at a MOCKED Supabase origin (ui-audit/lib/foodFixture.mjs). Nothing here touches the
 * owner's data: every request is answered from the in-memory fixture and every write is recorded, not sent.
 * Labels: this is WebKit-emulated-iPhone, NOT Mobile Safari. The on-screen keyboard cannot be raised in
 * headless WebKit — "keyboard up" is EMULATED by shrinking window.visualViewport only (a stub — see KEYBOARD_STUB).
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
import { listsLayoutProbe } from "./lib/foodListsKit.mjs";

const BASE = process.argv.find((a, i) => i > 1 && a.startsWith("http")) || "http://localhost:4180";
const results = [];
// `pending` marks a failure that belongs to ANOTHER open PR (named in `pending`): it is printed as PENDING-<pr>, counted
// separately, never as a pass, and does not fail THIS run — the owner's V# live check carries the step. Used only for the
// visit-form keyboard-up position rows (#1941's keyboard-aware sheet); every other failure is a hard FAIL.
const row = (arm, ok, detail, pending = null) => {
  const status = ok ? "PASS" : pending ? `PENDING-${pending}` : "FAIL";
  results.push({ arm, ok, pending: !ok && !!pending, detail });
  console.log(`${status}  ${arm} — ${detail}`);
};

async function open(browser, { variant = "plain", device = "iPhone 15", viewport, kbStub = false } = {}) {
  const ctx = await browser.newContext({ ...(device ? devices[device] : {}), ...(viewport ? { viewport } : {}), ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.__touch = !!device;
  const state = makeFixture({ variant });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await installFixture(page, state);
  if (kbStub) await page.addInitScript(KEYBOARD_STUB);
  await page.goto(`${BASE}/#/food`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="food-map"]', { timeout: 20000 });
  await assertMeasurable(page, "verify-food-phone");
  await page.waitForFunction(() => !!window.__foodMap, null, { timeout: 10000 });
  await page.waitForTimeout(600); // initial bounds fetch + visits load
  return { ctx, page, state, errors };
}


/* iOS Safari does NOT resize the layout viewport when the keyboard opens: window.innerHeight stays put and only
 * window.visualViewport shrinks. Shrinking the whole window (setViewportSize) is therefore the WRONG emulation for any
 * code that reads visualViewport (the Food bottom sheet does) — it never sees a keyboard. This stub keeps the layout
 * viewport at full height and makes visualViewport.height shrink by the keyboard's height, firing its 'resize'
 * event, exactly as WebKit on a phone does. Call window.__setKeyboard(px) to raise it, 0 to drop it. (Still an
 * EMULATION: the real keyboard, its predictive bar and iOS's native scroll-to-focus are not reproduced.) */
const KEYBOARD_STUB = `(() => {
  const ls = { resize: new Set(), scroll: new Set() }; let kb = 0;
  const stub = {
    get width() { return innerWidth; }, get height() { return innerHeight - kb; },
    offsetLeft: 0, offsetTop: 0, pageLeft: 0, pageTop: 0, scale: 1,
    addEventListener(t, f) { if (ls[t]) ls[t].add(f); }, removeEventListener(t, f) { if (ls[t]) ls[t].delete(f); },
  };
  Object.defineProperty(window, "visualViewport", { get: () => stub, configurable: true });
  window.__setKeyboard = (h) => { kb = h; ls.resize.forEach((f) => f(new Event("resize"))); };
})();`;

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
  const { ctx, page } = await open(browser, { viewport, device, kbStub: !!device });
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
    await page.evaluate((h) => window.__setKeyboard(h), Math.round(vp.height * 0.45)); // EMULATED keyboard-up (visual viewport only)
    await page.waitForTimeout(500);
    const kb = await measure();
    row(`3 LAYOUT (${label}): keyboard-up (emulated), toggle + field still on screen & hittable`, allOk(kb), JSON.stringify(kb));
  }
  await ctx.close();
}

/* NEW-1 / B2088288 — a list made and selected through the real UI must not break the frame (lib/foodListsKit.mjs). */
async function armLists(browser, { label, viewport, device }) {
  const { ctx, page } = await open(browser, { viewport, device, kbStub: !!device });
  try { await listsLayoutProbe(page, (name, ok, detail) => row(name, ok, detail), label); }
  catch (e) { row(`lists layout (${label})`, false, `probe error: ${String(e.message).split("\n")[0]}`); }
  await ctx.close();
}

async function armChain(browser) {
  const { ctx, page } = await open(browser);
  await typeInSearch(page, "torchy");
  const names = (await resultNames(page)).filter((n) => /torchy.*fixture way/i.test(n));
  row("CONTROL chain: two genuinely different branches stay two rows", names.length === 2, JSON.stringify(names));
  await ctx.close();
}


/* ───────────────────────────── ARM 4 — EVERY TEXT FIELD, KEYBOARD UP ─────────────────────────────
 * (B2046224 amendment, owner report on his iPhone: typing "Mizuki Nigiri" in the Food search box, the field
 * showed the START of the text while the keyboard's predictive bar showed the next word — the field ran off the
 * right edge, so new characters landed out of sight; iOS also offered an "AutoFill Contact" bar.)
 *
 * For EVERY text field in the module, on a phone, with the keyboard-up EMULATED (visual viewport shrunk, layout viewport kept —
 * headless WebKit cannot raise the real keyboard; labelled, not "iOS"): type a long entry and assert
 *   (a) the field sits inside the visible viewport AND inside every scrolling ancestor's visible box (a field under
 *       the sheet's own clip, or under the "keyboard", is not on screen),
 *   (b) nothing is covering it (elementFromPoint at its centre is the field),
 *   (c) the CARET is in view: the text before the caret, measured with the field's own font, ends inside the field's
 *       visible width (scrollLeft follows the caret) — for a textarea, the caret line is inside the visible height,
 *   (d) no contact-AutoFill hooks: autocomplete is a non-standard `x-food-*` token (iOS overrides "off") and `name` is not a contact word.
 * The driver's own actionability scroll would hide a failure (DRIVER-SCROLL-IS-NOT-APP-SCROLL), so the field is brought
 * into reach the way a finger would (an in-page scrollIntoView on the SHEET before the tap), then focused with
 * preventScroll — the browser may not do the app's job for it. KNOWN-GOOD ARM: the Map/List toggle button, a
 * non-text control placed through the same probe, must read in-view at the same viewport — if it does not the probe
 * itself is void.
 */
const LONG = "Mizuki Nigiri omakase with extra wasabi pickled ginger and a long second sentence about the miso soup";
const CONTACT_NAMES = /^(name|fname|lname|first|last|email|e-mail|tel|phone|address|street|zip|postal|city|organization|username)$/i;

async function measureField(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-probe="1"]');
    if (!el) return { missing: true };
    const vv = window.visualViewport;
    const vx = vv ? vv.offsetLeft : 0, vy = vv ? vv.offsetTop : 0;
    const vw = vv ? vv.width : innerWidth, vh = vv ? vv.height : innerHeight;
    let box = { l: vx, t: vy, r: vx + vw, b: vy + vh };
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (/(auto|scroll|hidden|clip)/.test(cs.overflowX + cs.overflowY)) {
        const r = a.getBoundingClientRect();
        box = { l: Math.max(box.l, r.left), t: Math.max(box.t, r.top), r: Math.min(box.r, r.right), b: Math.min(box.b, r.bottom) };
      }
    }
    const r = el.getBoundingClientRect();
    const inView = r.left >= box.l - 0.5 && r.right <= box.r + 0.5 && r.top >= box.t - 0.5 && r.bottom <= box.b + 0.5;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const top = document.elementFromPoint(Math.min(Math.max(cx, 0), innerWidth - 1), Math.min(Math.max(cy, 0), innerHeight - 1));
    const uncovered = !!top && (top === el || el.contains(top));
    // caret in view
    const cs = getComputedStyle(el);
    const caretPos = el.selectionStart ?? (el.value || "").length;
    let caretInView = null, caretDetail = "";
    if (el.tagName === "TEXTAREA") {
      // Same rule as the single-line fields: the caret is at the END of what was just typed (the last Enter included),
      // so it is in view iff the textarea is scrolled to the end of its content (scrollTop follows the caret).
      // The content ends where the bottom PADDING begins: a caret on the last line is fully visible once the box is
      // scrolled to (end − padding), so the padding below it is allowed to stay out of view.
      const padB = parseFloat(getComputedStyle(el).paddingBottom || 0);
      const maxScrollY = el.scrollHeight - el.clientHeight - padB;
      caretInView = maxScrollY <= 1 || el.scrollTop >= maxScrollY - 2;
      caretDetail = `scrollTop=${Math.round(el.scrollTop)} maxScrollTop=${Math.round(maxScrollY)} scrollH=${el.scrollHeight} clientH=${el.clientHeight} (caret at end: in view iff scrolled to end)`;
    } else if (/^(text|search|number)$/.test(el.type)) {
      // The caret is at the END of what was just typed, so it is in view iff the field is scrolled to its end
      // (scrollLeft follows the caret). Measured from the field's own scroll geometry — no font maths to get wrong.
      const maxScroll = el.scrollWidth - el.clientWidth;
      caretInView = maxScroll <= 1 || el.scrollLeft >= maxScroll - 2;
      caretDetail = `scrollLeft=${Math.round(el.scrollLeft)} maxScroll=${Math.round(maxScroll)} (caret at end: in view iff scrolled to end)`;
    }
    return {
      inView, uncovered, caretInView, caretDetail,
      rect: { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom) },
      box: { l: Math.round(box.l), r: Math.round(box.r), t: Math.round(box.t), b: Math.round(box.b) },
      autocomplete: el.getAttribute("autocomplete"), name: el.getAttribute("name"), type: el.type || el.tagName,
      inputmode: el.getAttribute("inputmode"), enterkeyhint: el.getAttribute("enterkeyhint"),
      wide: r.right > innerWidth + 0.5,
    };
  });
}

async function armFields(browser) {
  const FIELDS = [
    { id: "search (Map view)", typed: true, open: async (page) => ({ sel: '[data-testid="food-search-box"]' }) },
    { id: "search / filter (List view)", typed: true, open: async (page) => { await page.getByRole("button", { name: "List", exact: true }).tap(); await page.waitForTimeout(300); return { sel: '[data-testid="food-search-box"]' }; } },
    { id: "pin name (drop a pin)", typed: true, open: async (page) => {
        await page.getByRole("button", { name: /^Pin$|drop a pin/i }).first().tap();
        await page.waitForTimeout(200);
        const m = await page.locator('[data-testid="food-map"]').boundingBox();
        await page.touchscreen.tap(m.x + m.width * 0.3, m.y + m.height * 0.3);
        await page.waitForTimeout(700);
        return { sel: '[data-testid="pin-label-input"]' };
      } },
    ...[
      ["visit form — date", 'input[type="date"]', false, "visit"],
      ["visit form — first dish name", '[data-testid="visit-dish-name"]', true, "visit"],
      ["visit form — what was good", 'input[placeholder="The hamachi, the agedashi…"]', true, "visit"],
      ["visit form — cost", 'input[placeholder="0.00"]', "num", "visit"],
      ["visit form — notes", "textarea", true, "visit"],
    ].map(([id, sel, typed, mode]) => ({ id, typed, sheet: true, open: async (page) => { await openExistingPanel(page); await page.locator('[data-testid="food-log-visit-btn"]').first().tap(); await page.waitForTimeout(500); return { sel, scrollSheet: true }; } })),
    ...[
      ["edit old visit — what was good", 'input[placeholder="The hamachi, the agedashi…"]', true],
      ["edit old visit — notes", "textarea", true],
    ].map(([id, sel, typed]) => ({ id, typed, sheet: true, open: async (page) => { await openExistingPanel(page); await page.locator('[data-testid="food-visit-card"]').first().tap(); await page.waitForTimeout(600); return { sel: `[data-testid="food-visit-card-editing"] ${sel}`, scrollSheet: true }; } })),
    ...[
      ["add a dish — name", '[data-testid="dish-name-input"]', true],
      ["add a dish — price", '[data-testid="dish-price-input"]', "num"],
      ["add a dish — note", '[data-testid="dish-note-input"]', true],
    ].map(([id, sel, typed]) => ({ id, typed, open: async (page) => { await openExistingPanel(page); await page.locator('[data-testid="food-add-dish-btn"]').first().tap(); await page.waitForTimeout(600); return { sel, scrollSheet: true }; } })),
  ];

  const only = (process.argv.find((x) => x.startsWith("--field=")) || "").slice(8);
  for (const phone of ["iPhone 15", "iPhone SE"]) {
    for (const f of FIELDS.filter((x) => !only || new RegExp(only, "i").test(x.id))) {
      const { ctx, page } = await open(browser, { device: phone, kbStub: true });
      let tag = `4 FIELD (${phone}) ${f.id}`;
      try {
        const { sel, scrollSheet } = await f.open(page);
        const loc = page.locator(sel).first();
        if (!(await loc.count())) { row(tag, false, `field not reachable by selector ${sel} — probe could not open it (instrument, not a pass)`); await ctx.close(); continue; }
        // bring it into reach like a finger would (in-page scroll of the sheet), NOT the driver's actionability scroll
        // bring it into reach the way the app itself does for a focused field: centred in its scroller (in-page scroll, NOT the driver's)
        await page.evaluate((s) => { const e = document.querySelector(s); if (e) e.scrollIntoView({ block: "center", inline: "nearest" }); }, sel);
        await page.evaluate((s) => { document.querySelectorAll('[data-probe]').forEach((x) => x.removeAttribute("data-probe")); document.querySelector(s).setAttribute("data-probe", "1"); }, sel);
        await page.waitForTimeout(500); // let the sheet's own scroll / layout settle, THEN read where the field is (a stale position taps the wrong thing)
        // a finger needs a point that IS the field: scan a few points; if none answers to the field it is covered at keyboard-down
        const pt = await page.evaluate(() => {
          const el = document.querySelector('[data-probe="1"]'); const r = el.getBoundingClientRect();
          for (const fy of [0.5, 0.3, 0.7, 0.15, 0.85]) {
            const x = r.left + Math.min(r.width / 2, 60), y = r.top + r.height * fy;
            if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
            const t = document.elementFromPoint(x, y);
            if (t === el || el.contains(t)) return { x, y };
          }
          return null;
        });
        if (!pt) { row(`${tag}: reachable by a finger at keyboard-down (some point on the field answers to the field)`, false, `no tappable point — the field is covered (e.g. by the sticky action bar) even after the sheet centres it`); await ctx.close(); continue; }
        await page.touchscreen.tap(pt.x, pt.y);
        await page.waitForTimeout(250);
        const vp = page.viewportSize();
        await page.evaluate((h) => window.__setKeyboard(h), Math.round(vp.height * 0.45)); // keyboard-up (EMULATED, visual viewport only)
        await page.waitForTimeout(900);
        const focused = await page.evaluate(() => document.activeElement?.getAttribute("data-probe") === "1");
        if (!focused) await page.evaluate(() => document.querySelector('[data-probe="1"]').focus({ preventScroll: true }));
        if (f.typed === "num") await page.keyboard.type("123456.78", { delay: 15 });
        else if (f.typed && /notes/.test(f.id)) { for (const part of [LONG, LONG, LONG]) { await page.keyboard.type(part, { delay: 4 }); await page.keyboard.press("Enter"); } }
        else if (f.typed) await page.keyboard.type(LONG, { delay: 8 });
        await page.waitForTimeout(400);
        const m = await measureField(page);
        if (m.missing) { row(tag, false, "probe target vanished while typing (instrument)"); await ctx.close(); continue; }
        const sheetField = !!f.sheet;
        row(`${tag}: inside the visible viewport / sheet clip`, m.inView, JSON.stringify({ rect: m.rect, box: m.box }), sheetField ? "#1941" : null);
        row(`${tag}: not covered by anything`, m.uncovered, `uncovered=${m.uncovered}`, sheetField ? "#1941" : null);
        row(`${tag}: does not extend past the screen edge`, !m.wide, `right=${m.rect.r} vs ${vp.width}`);
        if (f.typed) row(`${tag}: caret in view while typing`, m.caretInView === true, m.caretDetail || "n/a");
        const ac = m.autocomplete, nm = m.name || "";
        // B2046224 ×2: "off" is what iOS ignores — the token must be a non-standard x-food-* one.
        row(`${tag}: no contact-AutoFill hooks`, /^x-food-/.test(ac || "") && !CONTACT_NAMES.test(nm), `autocomplete=${ac} name=${nm || "—"} inputmode=${m.inputmode || "—"} enterkeyhint=${m.enterkeyhint || "—"}`);
      } catch (e) {
        row(tag, false, `probe error: ${String(e.message).split("\n")[0]}`);
      }
      await ctx.close();
    }
  }
}

/* known-good arm for ARM 4: a non-text control placed through the same visibility rule must read in-view. */
async function armFieldsKnownGood(browser) {
  const { ctx, page } = await open(browser, { device: "iPhone 15", kbStub: true });
  const vp = page.viewportSize();
  await page.evaluate((h) => window.__setKeyboard(h), Math.round(vp.height * 0.45));
  await page.waitForTimeout(500);
  await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Map"); b.setAttribute("data-probe", "1"); });
  const m = await measureField(page);
  row("4 FIELD known-good arm: the Map toggle reads in-view at the keyboard-up viewport (else ARM 4 is VOID)", m.inView === true && m.uncovered === true, JSON.stringify({ rect: m.rect, box: m.box }));
  await ctx.close();
}

async function openExistingPanel(page) {
  // open DAO'N (his saved manual pin in the fixture) via search → the existing restaurant's panel (bottom sheet)
  await searchBox(page).tap();
  await page.keyboard.type("dao", { delay: 20 });
  await page.waitForTimeout(700);
  await page.locator('[data-testid="food-search-results"] button').filter({ hasText: /dao.?n/i }).first().tap();
  await page.waitForTimeout(900);
}

const wk = await webkit.launch();
const ONLY_FIELDS = process.argv.includes("--fields-only");
try {
 if (!ONLY_FIELDS) {
  await armDuplicate(wk, "plain");
  await armDuplicate(wk, "case");
  await armDuplicate(wk, "curly");
  await armMapFollow(wk, { label: "WebKit iPhone 15", device: "iPhone 15" });
  await armMapFollowFromList(wk);
  await armLayout(wk, { label: "WebKit iPhone 15", device: "iPhone 15" });
  await armLayout(wk, { label: "WebKit iPhone SE", device: "iPhone SE" });
  await armLists(wk, { label: "WebKit iPhone 15", device: "iPhone 15" });
  await armLists(wk, { label: "WebKit iPhone SE", device: "iPhone SE" });
  await armChain(wk);
 }
  await armFieldsKnownGood(wk);
  await armFields(wk);
} finally { await wk.close(); }

const cr = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium", args: ["--ignore-certificate-errors"] });
try {
  await armLayout(cr, { label: "Chromium desktop 1440", viewport: { width: 1440, height: 900 }, device: null });
  await armMapFollow(cr, { label: "Chromium desktop 1440", viewport: { width: 1440, height: 900 }, device: null });
  await armLists(cr, { label: "Chromium desktop 1440", viewport: { width: 1440, height: 900 }, device: null });
}
finally { await cr.close(); }

const failed = results.filter((r) => !r.ok && !r.pending);
const pendingRows = results.filter((r) => r.pending);
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed` + (pendingRows.length ? `, ${pendingRows.length} PENDING another PR (listed above, NOT passes)` : "") + ".");
process.exit(failed.length ? 1 : 0);
