#!/usr/bin/env node
/* verify-food-ios-screens — B2046224 (×3): what the owner SEES on an iPhone while typing in Food,
 * rendered as pictures and asserted, so he does not have to prove it on his phone.
 *
 * ⛔ WHY THIS EXISTS (owner, real iPhone, 2026-10-04 4:10 PM, Aburi Sushi → "+ Add a dish", after
 * #1976 passed 99/99 in verify-food-ios-keyboard): three things were visibly wrong that no row
 * there could see — (1) a band of satellite map between the sheet and the keyboard's accessory bar,
 * (2) the "Log a visit" bar covering the New Dish card's Course / Price, (3) the map's + / − zoom
 * control drawn over the sheet. That harness checked ONE point (the focused field's centre) on a
 * fixture page with NO MAP, and never produced a picture. This one drives the FULL Food app
 * (mocked signed-in Supabase, ui-audit/lib/foodFixture.mjs) with a painted stand-in for satellite
 * tiles, draws the iOS keyboard + accessory bar where iOS puts it, saves a screenshot of every
 * typing state, and asserts the three properties directly:
 *   GAP      — just above the keyboard's top edge, every sampled point belongs to the sheet; none
 *              is map. (Points are hit-tested, so a sheet-coloured element counts only if it IS the
 *              sheet's.)
 *   CARD     — the focused field's card (the dish editor, a visit-form row, a labelled field) is
 *              not covered: every sampled point of its visible part answers to the card, every
 *              control in it that is on screen answers to itself, and a card that fits above the
 *              keyboard is entirely above it.
 *   CONTROLS — wherever a map control's box overlaps the sheet, the sheet is what is drawn there.
 *              (The literal "no control box overlaps the sheet" cannot hold: the sheet at full height
 *              covers the corner the zoom control lives in. What the owner asked for is that a
 *              control never DRAWS over the sheet — that is what is asserted.)
 *   OVERLAY  — nothing else outside the sheet (a search-results list, a notice…) paints over its
 *              visible part, except while the search box itself is the field being typed in. Added
 *              after LOOKING at the pictures: the dish-from-full screenshots showed the search
 *              results list over the sheet, which no detector above was asking about.
 * plus the earlier FIELD row (the focused field inside the visible band and answering to itself).
 *
 * THE iOS MODEL (stated, because a harness that cannot say what it models cannot be trusted):
 *  · the layout viewport (position:fixed containing block) is the Playwright viewport, unchanged;
 *  · focusing a text field or a <select> opens the keyboard / picker (so autoFocus counts);
 *  · visualViewport.height = layout − keyboard; window.innerHeight returns that same number
 *    (WebKit's innerHeight is the unobscured rect — see lib/keyboardInset.js);
 *  · mode "ios": the visual viewport stays at the top (offsetTop 0);
 *  · mode "ios-tallinner": as "ios", but window.innerHeight stands ABOVE the layout viewport (by 64)
 *    and does not move with the keyboard. Grounded in production telemetry from the owner's iPhone
 *    two minutes after the reported test (client_errors 21:12:20 UTC, #/food, iOS 18.7): the
 *    page-containment guard's own check `innerHeight − visualViewport.height > 120` read TRUE with
 *    the keyboard up — so on his phone innerHeight did NOT shrink with the keyboard, contrary to the
 *    ×2 fix's assumption. Any code that takes the layout height as max(probe, innerHeight) then
 *    over-reads the keyboard by the excess and parks the sheet that far above it: the gap.
 *  · mode "ios-late": iOS then PANS the visual viewport (offsetTop > 0) a moment later. This is a
 *    HYPOTHESIS for the gap, grounded in production telemetry from the owner's own phone during the
 *    reported test (client_errors, 21:10:37 UTC, #/food, iOS 18.7): iOS scrolled the pinned page by
 *    347 — about a keyboard — and the app's page-containment guard pinned it back. Positions read in
 *    the middle of that tug-of-war go stale; a sheet placed from a stale reading sits above the
 *    keyboard with the map showing through. The model fires the vv 'scroll' event as iOS does —
 *    except under `--no-late-event`, which models the event being lost.
 * Keyboard heights (keys + QuickType row + the ^ v ✓ form-accessory bar): iPhone 15 380, SE 304.
 *
 * KNOWN-ANSWER ARMS (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6): each of the three detectors is first
 * pointed at a PLANTED defect and must report it; if any cannot, the run is VOID.
 *
 * Still not a phone: no real keyboard, no real AutoFill bar, no real finger, and the iOS model is a
 * model. What only the phone can show is V1497664 / the V# in VERIFICATION.md.
 *
 * Usage: build with the fixture env (see foodFixture.mjs), `npx vite preview --port 4180`, then
 *   node ui-audit/verify-food-ios-screens.mjs [baseUrl] [--shots=<dir>] [--no-late-event]
 */
import { webkit, devices } from "playwright";
import { mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { makeFixture, installFixture } from "./lib/foodFixture.mjs";

const BASE = process.argv.find((a, i) => i > 1 && a.startsWith("http")) || "http://localhost:4180";
const SHOTS = (process.argv.find((a) => a.startsWith("--shots=")) || "").slice(8);
const LOSE_LATE_EVENT = process.argv.includes("--no-late-event");
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const PHONES = { "iPhone 15": { kb: 380 }, "iPhone SE": { kb: 304 } };
const LATE_PAN = 56;

const results = [];
const check = (id, ok, detail = "") => { results.push({ id, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${id}${detail ? "  — " + detail : ""}`); };

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

const IOS_MODEL = ({ kbPx, late, latePan, loseLateEvent, tallInner }) => {
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

async function open(browser, phone, mode) {
  const ctx = await browser.newContext({ ...devices[phone], ignoreHTTPSErrors: true });
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
  await page.addInitScript(IOS_MODEL, { kbPx: PHONES[phone].kb, late: mode === "ios-late", latePan: LATE_PAN, loseLateEvent: LOSE_LATE_EVENT, tallInner: mode === "ios-tallinner" });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`${BASE}/#/food`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="food-map"]', { timeout: 20000 });
  await assertMeasurable(page, `verify-food-ios-screens:${phone}:${mode}`);
  await page.waitForTimeout(1200);
  return { ctx, page, errs };
}

const searchBox = (page) => page.locator('[data-testid="food-search-box"] input, input[aria-label="Search restaurants"]').first();
async function openAburi(page) {
  await searchBox(page).tap();
  await page.keyboard.type("aburi", { delay: 15 });
  await page.waitForTimeout(800);
  await page.locator('[data-testid="food-search-results"] button').filter({ hasText: /aburi/i }).first().tap();
  await page.waitForTimeout(1200);
  await page.waitForSelector('[data-testid="food-bottom-sheet"]');
  await page.evaluate(() => document.activeElement?.blur?.()); // start every flow from keyboard-down
  await page.waitForTimeout(500);
}

// ── the three detectors (+ the field row), all in layout coordinates ────────────────────────────
const CARD_SEL = '[data-edit-card], [data-testid="dish-edit-row"], [data-testid="visit-dish-row"], label';
const probe = (page) => page.evaluate((CARD_SEL) => {
  const band = window.__kb.band();
  const el = document.activeElement;
  const sheetOf = (n) => n && n.closest && n.closest('[data-food-sheet-root], [data-testid="food-bottom-sheet"]');
  const sheet = document.querySelector('[data-testid="food-bottom-sheet"]');
  const W = innerWidth;
  const out = { kbOpen: window.__kb.open, band, active: el ? (el.dataset.testid || el.getAttribute("aria-label") || el.tagName) : null };
  // GAP
  if (sheet && window.__kb.open) {
    const bad = [];
    for (const dy of [2, 6, 12, 20, 30]) for (const fx of [0.05, 0.3, 0.5, 0.7, 0.95]) {
      const x = W * fx, y = band.bottom - dy;
      if (y < band.top) continue;
      const t = document.elementFromPoint(x, y);
      if (!sheetOf(t) && !(el && document.querySelector('[data-testid="food-search-box"]')?.contains(el))) bad.push(`${Math.round(x)},${Math.round(y)}→${t?.tagName}${t?.className && typeof t.className === "string" ? "." + t.className.split(" ")[0] : ""}`);
    }
    const sr = sheet.getBoundingClientRect();
    out.gap = { ok: bad.length === 0, detail: `sheet bottom ${Math.round(sr.bottom)} · keyboard top ${Math.round(band.bottom)}${bad.length ? " · map/other at " + bad.slice(0, 4).join(" ") : ""}` };
  }
  // CARD + FIELD
  if (el && el !== document.body) {
    const r = el.getBoundingClientRect();
    const cx = r.left + Math.min(r.width / 2, 40), cy = (Math.max(r.top, band.top) + Math.min(r.bottom, band.bottom)) / 2;
    const hit = document.elementFromPoint(cx, cy);
    out.field = { ok: r.top >= band.top - 1 && r.bottom <= band.bottom + 1 && !!hit && (hit === el || el.contains(hit)),
      detail: `field ${Math.round(r.top)}–${Math.round(r.bottom)} vs visible ${Math.round(band.top)}–${Math.round(band.bottom)}; on top: ${hit?.tagName}${hit?.dataset?.testid ? "#" + hit.dataset.testid : ""}` };
    const card = el.closest(CARD_SEL);
    if (card && sheetOf(card)) {
      const c = card.getBoundingClientRect();
      // the part of the card a person can see: inside the visible band AND inside the sheet's own
      // scrolling list (a card scrolled up under the drag handle is scrolled, not covered)
      let sc = card.parentElement;
      while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement;
      const sr = sc ? sc.getBoundingClientRect() : { top: -1e9, bottom: 1e9 };
      const top = Math.max(c.top, band.top, sr.top), bottom = Math.min(c.bottom, band.bottom, sr.bottom);
      const bad = [];
      if (bottom > top) {
        for (const fy of [0.02, 0.2, 0.4, 0.6, 0.8, 0.98]) for (const fx of [0.1, 0.5, 0.9]) {
          const x = c.left + c.width * fx, y = top + (bottom - top) * fy;
          const t = document.elementFromPoint(x, y);
          if (!t || !(t === card || card.contains(t))) bad.push(`${t?.dataset?.testid || t?.tagName}@${Math.round(y)}`);
        }
        for (const ctl of card.querySelectorAll("input:not([type=range]), select, textarea, button")) {
          const q = ctl.getBoundingClientRect();
          if (!q.height || q.bottom <= top || q.top >= bottom) continue;
          const yy = (Math.max(q.top, top) + Math.min(q.bottom, bottom)) / 2; // middle of its VISIBLE part
          const t = document.elementFromPoint(q.left + Math.min(q.width / 2, 30), Math.min(yy, band.bottom - 1));
          if (!t || !(t === ctl || ctl.contains(t))) bad.push(`${ctl.dataset.testid || ctl.getAttribute("aria-label") || ctl.tagName} covered by ${t?.dataset?.testid || t?.tagName}`);
        }
      }
      const fits = c.height <= band.bottom - band.top - 24; // the app keeps a small margin above and below
      const inside = c.top >= band.top - 1 && c.bottom <= band.bottom + 1;
      out.card = { ok: bad.length === 0 && (!fits || inside), detail: `card ${Math.round(c.top)}–${Math.round(c.bottom)} (${fits ? "fits" : "taller than"} visible ${Math.round(band.top)}–${Math.round(band.bottom)})${bad.length ? " · covered: " + [...new Set(bad)].slice(0, 5).join(", ") : ""}` };
    }
  }
  // CONTROLS
  if (sheet) {
    const s = sheet.getBoundingClientRect();
    const mapWrap = document.querySelector('[data-testid="food-map"]')?.parentElement;
    const ctrls = [...document.querySelectorAll(".leaflet-control")];
    if (mapWrap) for (const ch of mapWrap.children) if (ch.dataset.testid !== "food-map") ctrls.push(ch);
    const bad = [];
    for (const k of ctrls) {
      const b = k.getBoundingClientRect();
      const L = Math.max(b.left, s.left), R = Math.min(b.right, s.right), T = Math.max(b.top, s.top), B = Math.min(b.bottom, s.bottom, band.bottom);
      if (R - L < 2 || B - T < 2) continue;
      for (const fx of [0.25, 0.5, 0.75]) for (const fy of [0.25, 0.5, 0.75]) {
        const x = L + (R - L) * fx, y = T + (B - T) * fy;
        // the sheet's rounded top corners are not sheet: the map legitimately shows past the curve
        if (y < s.top + 18 && (x < s.left + 18 || x > s.right - 18)) continue;
        const t = document.elementFromPoint(x, y);
        if (t && !sheetOf(t) && (k === t || k.contains(t))) { bad.push((k.className || k.tagName).toString().split(" ").slice(0, 2).join(".")); break; }
      }
    }
    out.controls = { ok: bad.length === 0, detail: bad.length ? `drawn over the sheet: ${[...new Set(bad)].join(", ")}` : `${ctrls.length} map controls checked` };
    // OVERLAY — not just map controls: NOTHING outside the sheet may paint over its visible part
    // (a search-results list, a notice…), except while the search box itself is being typed in.
    const searching = el && document.querySelector('[data-testid="food-search-box"]')?.contains(el);
    if (!searching) {
      const over = [];
      const T = Math.max(s.top + 18, band.top), B = Math.min(s.bottom, band.bottom);
      for (const fy of [0.05, 0.25, 0.5, 0.75, 0.95]) for (const fx of [0.08, 0.3, 0.5, 0.7, 0.92]) {
        const x = s.left + (s.right - s.left) * fx, y = T + (B - T) * fy;
        if (B - T < 4) continue;
        const t = document.elementFromPoint(x, y);
        if (t && !sheetOf(t)) over.push(`${t.dataset?.testid || t.tagName}@${Math.round(x)},${Math.round(y)}`);
      }
      out.overlay = { ok: over.length === 0, detail: over.length ? `not the sheet: ${[...new Set(over)].slice(0, 5).join(", ")}` : "sheet owns every sampled point" };
    }
  }
  return out;
}, CARD_SEL);

// Draw the keyboard (+ accessory bar) where iOS puts it and save what the phone would show.
async function shoot(page, name) {
  if (!SHOTS) return;
  await page.evaluate(() => {
    const { px, pan } = window.__kb;
    const H = document.documentElement.clientHeight;
    document.body.style.transform = pan ? `translateY(${-pan}px)` : "";
    let kb = document.getElementById("__ioskb");
    if (!kb) { kb = document.createElement("div"); kb.id = "__ioskb"; document.documentElement.appendChild(kb); }
    kb.style.cssText = `position:fixed;left:0;right:0;top:${H - px}px;height:${px}px;z-index:2147483647;pointer-events:none;background:#d0d3d9;font:15px -apple-system,system-ui,sans-serif;display:${px ? "block" : "none"}`;
    const keys = (row) => `<div style="display:flex;gap:6px;justify-content:center;margin:0 4px 11px">${row.split("").map((c) => `<span style="flex:1;max-width:34px;height:42px;background:#fff;border-radius:5px;box-shadow:0 1px 0 #898a8d;display:flex;align-items:center;justify-content:center">${c}</span>`).join("")}</div>`;
    kb.innerHTML = `<div style="height:44px;background:#f6f6f7;border-top:1px solid #c4c6cb;display:flex;align-items:center;padding:0 14px;gap:22px;color:#2f7cf6;font-size:20px"><span>⌃</span><span>⌄</span><span style="margin-left:auto">✓</span></div>`
      + `<div style="height:40px;display:flex;align-items:center;justify-content:space-around;color:#333;font-size:14px;border-bottom:1px solid #c4c6cb"><span>"the"</span><span>I</span><span>and</span></div><div style="padding-top:10px">${keys("qwertyuiop")}${keys("asdfghjkl")}${keys("zxcvbnm")}</div>`;
  });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
  await page.evaluate(() => { document.body.style.transform = ""; const k = document.getElementById("__ioskb"); if (k) k.style.display = "none"; });
}

async function score(page, tag, shotName, { typeText, keyboardDown = false } = {}) {
  await page.waitForTimeout(900);
  if (typeText) { await page.keyboard.type(typeText); await page.waitForTimeout(350); }
  const p = await probe(page);
  if (keyboardDown) { // at rest: only "nothing drawn over the sheet" applies
    if (p.controls) check(`${tag} — CONTROLS never drawn over the sheet`, p.controls.ok, p.controls.detail);
    if (p.overlay) check(`${tag} — OVERLAY nothing else drawn over the sheet`, p.overlay.ok, p.overlay.detail);
    await shoot(page, shotName);
    return;
  }
  check(`${tag} — keyboard up`, p.kbOpen, p.active || "");
  if (p.field) check(`${tag} — FIELD visible, nothing over it`, p.field.ok, p.field.detail);
  if (p.gap) check(`${tag} — GAP: no map between sheet and keyboard`, p.gap.ok, p.gap.detail);
  if (p.card) check(`${tag} — CARD fully clear of any bar`, p.card.ok, p.card.detail);
  if (p.controls) check(`${tag} — CONTROLS never drawn over the sheet`, p.controls.ok, p.controls.detail);
  if (p.overlay) check(`${tag} — OVERLAY nothing else drawn over the sheet`, p.overlay.ok, p.overlay.detail);
  await shoot(page, shotName);
}
const blur = async (page) => { await page.evaluate(() => document.activeElement?.blur?.()); await page.waitForTimeout(450); };
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7);
const section = async (name, fn) => { if (ONLY && !name.startsWith("0") && !new RegExp(ONLY).test(name)) return; try { await fn(); } catch (e) { check(`${name}: section aborted`, false, String(e.message).split("\n")[0]); } };

const browser = await webkit.launch();
try {
  // ── 0. KNOWN-ANSWER ARMS: each detector must catch a planted defect ──────────────────────────
  await section("0", async () => {
    const { ctx, page } = await open(browser, "iPhone 15", "ios");
    await openAburi(page);
    await page.locator('[data-testid="food-add-dish-btn"]').tap();
    await page.waitForTimeout(1000);
    // plant all three: lift the sheet (and anything below it) off the keyboard, cover the card, raise a control
    await page.evaluate(() => {
      const root = document.querySelector("[data-food-sheet-root]") || document.querySelector('[data-testid="food-bottom-sheet"]');
      root.style.setProperty("transform", "translateY(-70px)", "important");
      document.querySelectorAll('[data-testid="food-sheet-skirt"]').forEach((s) => s.style.setProperty("display", "none", "important"));
      const c = document.activeElement.closest('[data-testid="dish-edit-row"]').getBoundingClientRect();
      const cover = document.createElement("div");
      cover.style.cssText = `position:fixed;left:0;right:0;top:${c.top + 40}px;height:40px;background:red;z-index:99999`;
      document.body.appendChild(cover);
      document.querySelector(".leaflet-control-container").style.cssText += ";position:relative;z-index:99999";
      document.querySelectorAll(".leaflet-top, .leaflet-control").forEach((n) => n.style.setProperty("z-index", "99999", "important"));
      const map = document.querySelector('[data-testid="food-map"]'); map.style.setProperty("isolation", "auto", "important"); map.style.setProperty("z-index", "auto", "important");
    });
    await page.waitForTimeout(200);
    const p = await probe(page);
    check("0a KNOWN ANSWER: a sheet lifted off the keyboard reads as a GAP", p.gap && !p.gap.ok, p.gap?.detail);
    check("0b KNOWN ANSWER: a bar over the card reads as CARD covered", p.card && !p.card.ok, p.card?.detail);
    // the zoom control only overlaps a sheet tall enough to reach it — at keyboard-up full height it does
    check("0c KNOWN ANSWER: a raised map control reads as drawn over the sheet", p.controls && !p.controls.ok, p.controls?.detail);
    check("0d KNOWN ANSWER: a foreign bar over the sheet reads as OVERLAY", p.overlay && !p.overlay.ok, p.overlay?.detail);
    await ctx.close();
  });
  const instrumentOk = results.every((r) => r.ok);

  for (const phone of Object.keys(PHONES)) {
    for (const mode of ["ios-tallinner", "ios-late", "ios"]) {
      const tagp = `[${phone} · ${mode}]`;
      const shot = (s) => `${phone.replace(/\s+/g, "")}-${mode}-${s}`;
      // 1. THE OWNER'S SCREEN: Aburi Sushi → + Add a dish → dish (autoFocus), course, price, note
      await section(`${tagp} 1`, async () => {
        const { ctx, page, errs } = await open(browser, phone, mode);
        await openAburi(page);
        await page.evaluate(() => document.activeElement?.blur?.()); await page.waitForTimeout(400);
        await score(page, `${tagp} sheet at half, keyboard down`, shot("0-sheet-half"), { keyboardDown: true });
        await page.locator('[data-testid="food-add-dish-btn"]').tap();
        await score(page, `${tagp} 1a REPORTED add a dish → dish`, shot("1a-add-dish-name"), { typeText: "Torched salmon nigiri with yuzu kosho" });
        await page.locator('[data-testid="dish-course-select"]').tap();
        await score(page, `${tagp} 1b add a dish → course (picker)`, shot("1b-add-dish-course"));
        await page.locator('[data-testid="dish-price-input"]').tap();
        await score(page, `${tagp} 1c add a dish → price`, shot("1c-add-dish-price"), { typeText: "18.50" });
        await page.locator('[data-testid="dish-note-input"]').tap();
        await score(page, `${tagp} 1d add a dish → note`, shot("1d-add-dish-note"), { typeText: "ask for extra torch" });
        check(`${tagp} 1 no page errors`, errs.length === 0, errs.join(" | "));
        await ctx.close();
      });
      // 2. LOG A VISIT
      await section(`${tagp} 2`, async () => {
        const { ctx, page } = await open(browser, phone, mode);
        await openAburi(page);
        await page.locator('[data-testid="food-log-visit-btn"]').tap();
        await page.waitForTimeout(500);
        for (const [id, sel, text] of [["dish", '[data-testid="visit-dish-name"]', "Omakase"], ["what was good", '[data-testid="visit-highlights-input"]', "the uni"], ["cost", '[data-testid="visit-cost-input"]', "120"], ["notes", '[data-testid="visit-notes-input"]', "Sat at the bar.\nAsk for Ken.\nBook ahead."]]) {
          await page.locator(sel).first().tap();
          await score(page, `${tagp} 2 log a visit → ${id}`, shot(`2-visit-${id.replace(/\s+/g, "-")}`), { typeText: text });
          await blur(page);
        }
        await ctx.close();
      });
      // 3. EDIT AN OLD VISIT
      await section(`${tagp} 3`, async () => {
        const { ctx, page } = await open(browser, phone, mode);
        await openAburi(page);
        await page.locator('[data-testid="food-visit-card"]').first().tap();
        await page.waitForTimeout(500);
        const ed = page.locator('[data-testid="food-visit-card-editing"]');
        for (const [id, sel, text] of [["what was good", '[data-testid="visit-highlights-input"]', " and the toro"], ["notes", '[data-testid="visit-notes-input"]', "Second line\nThird line"]]) {
          await ed.locator(sel).tap();
          await score(page, `${tagp} 3 edit old visit → ${id}`, shot(`3-edit-${id.replace(/\s+/g, "-")}`), { typeText: text });
          await blur(page);
        }
        await ctx.close();
      });
      // 4. DROP A PIN → name
      await section(`${tagp} 4`, async () => {
        const { ctx, page } = await open(browser, phone, mode);
        await page.getByRole("button", { name: /^Pin$|drop a pin/i }).first().tap();
        await page.waitForTimeout(250);
        const m = await page.locator('[data-testid="food-map"]').boundingBox();
        await page.touchscreen.tap(m.x + m.width * 0.4, m.y + m.height * 0.3);
        await page.waitForTimeout(500);
        await page.locator('[data-testid="pin-label-input"]').tap().catch(() => {});
        await score(page, `${tagp} 4 drop a pin → name`, shot("4-pin-name"), { typeText: "Taco truck behind the Shell" });
        await ctx.close();
      });
      // 5. SEARCH (toolbar, not the sheet)
      await section(`${tagp} 5`, async () => {
        const { ctx, page } = await open(browser, phone, mode);
        await searchBox(page).tap();
        await score(page, `${tagp} 5 search box`, shot("5-search"), { typeText: "aburi sushi southwest" });
        await ctx.close();
      });
      // 6. OTHER STARTING HEIGHTS for the reported field
      for (const start of ["full", "peek"]) {
        await section(`${tagp} 6 ${start}`, async () => {
          const { ctx, page } = await open(browser, phone, mode);
          await openAburi(page);
          const hb = await page.locator('[data-testid="food-sheet-drag-handle"]').boundingBox();
          const x = hb.x + hb.width / 2, y = hb.y + hb.height / 2;
          await page.mouse.move(x, y); await page.mouse.down();
          await page.waitForTimeout(600); // let the open animation settle before grabbing the handle
          await page.mouse.move(x, start === "full" ? 40 : y + 150, { steps: 12 }); await page.mouse.up();
          await page.waitForTimeout(500);
          const snap = await page.locator('[data-testid="food-bottom-sheet"]').getAttribute("data-sheet-snap");
          check(`${tagp} 6 sheet settled at ${start}`, snap === start, `snap=${snap}`);
          await score(page, `${tagp} 6 ${start}, keyboard down`, shot(`6-${start}-rest`), { keyboardDown: true });
          await page.locator('[data-testid="food-add-dish-btn"]').evaluate((b) => b.click());
          await score(page, `${tagp} 6 from ${start} → add a dish → dish`, shot(`6-${start}-add-dish`));
          await ctx.close();
        });
      }
    }
  }
  if (!instrumentOk) console.log("\nVOID — a known-answer arm failed: the detectors cannot see a planted defect, so no score below is evidence.");
} finally {
  await browser.close();
}
const scored = results;
const failed = scored.filter((r) => !r.ok);
const voided = results.some((r) => r.id.startsWith("0") && r.id.includes("KNOWN") && !r.ok);
console.log(`\n${scored.length - failed.length}/${scored.length} passed (WebKit, iPhone descriptors, iOS keyboard MODEL — see header)${voided ? " — VOID" : ""}${SHOTS ? ` · screenshots in ${SHOTS}` : ""}`);
process.exit(failed.length || voided ? 1 : 0);
