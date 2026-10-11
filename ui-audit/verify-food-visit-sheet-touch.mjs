#!/usr/bin/env node
/* verify-food-visit-sheet-touch — Food "Log a visit" sheet on a phone (NEW-1..5, 2026-10-11): the eat-again choice on a dish,
 * no "What was good" field, NOTHING pans sideways (portrait + landscape, a dish added, a field focused), the close X is a plain
 * glyph, and the sheet follows a finger (handle, header, content at scroll-top) without ever fighting a rating slider.
 *
 * ENGINE, stated: Chromium + the iPhone descriptor + CDP touch events (real touch pipeline: touch-action, scroll chaining, slop).
 * Playwright's WebKit cannot be installed in this sandbox (the download host is blocked) and has no touch-drag primitive anyway;
 * real iOS Safari is therefore NOT claimed — see docs/PHONE-TESTING.md. The iOS keyboard is the same MODEL verify-food-ios-screens uses.
 * KNOWN-ANSWER ARM (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6): a sheet planted on a slow transition must read as "does not follow".
 *
 * Usage: build with the fixture env (ui-audit/lib/foodFixture.mjs), `npx vite preview --port 4180`, then
 *   PW_CHROME=<chromium> node ui-audit/verify-food-visit-sheet-touch.mjs [baseUrl] [--shots=<dir>]
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { open, openPlace, touchSession } from "./lib/foodIosPage.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const SHOTS = (process.argv.find((a) => a.startsWith("--shots=")) || "").slice(8);
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (id, ok, detail = "") => { results.push({ id, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${id}${detail ? "  — " + detail : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHEET = '[data-testid="food-bottom-sheet"]';
const near = (a, b, tol = 3) => Math.abs(a - b) <= tol;
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const section = async (name, fn) => { try { await fn(); } catch (e) { check(`${name}: section aborted`, false, String(e.message).split("\n")[0]); } };

const sheetState = (page) => page.evaluate((SHEET) => {
  const s = document.querySelector(SHEET); if (!s) return null;
  const c = s.children[1], r = s.getBoundingClientRect(), hb = s.children[0].getBoundingClientRect();
  return { h: Math.round(r.height), top: Math.round(r.top), snap: s.dataset.sheetSnap, scrollTop: c.scrollTop, handleY: hb.top + hb.height / 2, x: r.left + r.width / 2 };
}, SHEET);

async function openForm(cr, { w, h }) {
  const { ctx, page } = await open(cr, "iPhone 15", "ios");
  await page.setViewportSize({ width: w, height: h }); await sleep(800);
  await assertMeasurable(page, "verify-food-visit-sheet-touch"); // FOREGROUND-OR-VOID: a background tab cannot be measured
  await openPlace(page, "aburi", /aburi/i, false);
  await page.locator('[data-testid="food-log-visit-btn"]').evaluate((b) => b.click()); await sleep(900);
  await page.evaluate(() => document.activeElement?.blur?.()); await sleep(400);
  return { ctx, page };
}

const MODES = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7);
const cr = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined, args: ["--no-sandbox"] });
try {
  // ── NEW-1 / NEW-2 / NEW-4: the form's content ───────────────────────────────────────────────────
  await section("form", async () => {
    const { ctx, page } = await openForm(cr, { w: 390, h: 844 });
    const row = page.locator('[data-testid="visit-dish-row"]').first();
    check("NEW-1 a dish row offers Yes / Maybe / No for eating it again", (await row.locator('[data-testid^="dish-order-again-"]').count()) === 3);
    check("NEW-2 no 'What was good' field anywhere in the form", (await page.locator('form').innerText()).indexOf("What was good") < 0 && (await page.locator('[data-testid="visit-highlights-input"]').count()) === 0);
    const x = await page.locator('[data-testid="food-panel-close"]').evaluate((b) => { const cs = getComputedStyle(b), r = b.getBoundingClientRect(); return { radius: cs.borderRadius, border: cs.borderTopWidth, bg: cs.backgroundColor, w: r.width, h: r.height }; });
    const y = await page.locator('[data-testid="visit-dish-remove"], [data-testid="visit-dish-add"]').count();
    check("NEW-4 the close X has no circle (no border, no fill) and a 44-square touch target", x.border === "0px" && x.bg === "rgba(0, 0, 0, 0)" && x.w >= 44 && x.h >= 44, JSON.stringify(x));
    await page.locator('[data-testid="visit-dish-add"]').evaluate((b) => b.click()); await sleep(300);
    const rm = await page.locator('[data-testid="visit-dish-remove"]').first().evaluate((b) => { const cs = getComputedStyle(b); return { border: cs.borderTopWidth, bg: cs.backgroundColor, color: cs.color, fs: cs.fontSize }; });
    const cx = await page.locator('[data-testid="food-panel-close"]').evaluate((b) => { const cs = getComputedStyle(b); return { border: cs.borderTopWidth, bg: cs.backgroundColor, color: cs.color, fs: cs.fontSize }; });
    check("NEW-4 the close X and the dish-row X are the SAME plain style", JSON.stringify(rm) === JSON.stringify(cx), `${JSON.stringify(cx)} vs ${JSON.stringify(rm)}`);
    await row.locator('[data-testid="dish-order-again-maybe"]').evaluate((b) => b.click());
    check("NEW-1 choosing Maybe presses it", (await row.locator('[data-testid="dish-order-again-maybe"]').getAttribute("aria-pressed")) === "true");
    await shot(page, "form-390");
    await ctx.close();
  });

  // ── NEW-3: nothing pans sideways ───────────────────────────────────────────────────────────────
  for (const [name, dims] of [["portrait 390", { w: 390, h: 844 }], ["landscape 844", { w: 844, h: 390 }]]) {
    await section(`pan ${name}`, async () => {
      const { ctx, page } = await openForm(cr, dims);
      await page.locator('[data-testid="visit-dish-add"]').evaluate((b) => b.click()); await sleep(300);
      await page.locator('[data-testid="visit-dish-name"]').first().focus(); await sleep(600);
      await page.locator('[data-testid="visit-date-input"]').evaluate((i) => { i.value = "2026-10-11"; i.dispatchEvent(new Event("input", { bubbles: true })); });
      const m = await page.evaluate(() => {
        const iw = innerWidth, wide = [];
        const root = document.querySelector('[data-testid="food-bottom-sheet"]') || document.querySelector('[data-testid="food-visit-panel"]') || document.querySelector("form")?.closest("[data-food-panel]") || document.body;
        for (const el of root.querySelectorAll("*")) { const b = el.getBoundingClientRect(); if (b.width && (b.right > iw + 0.5 || b.left < -0.5)) wide.push(`${el.tagName}[${el.dataset?.testid || ""}] ${Math.round(b.left)}..${Math.round(b.right)}`); }
        const scrollers = [...root.querySelectorAll("*")].filter((e) => e.scrollWidth > e.clientWidth + 1 && /auto|scroll|hidden/.test(getComputedStyle(e).overflowX) && getComputedStyle(e).display !== "inline").map((e) => `${e.tagName}[${e.dataset?.testid || ""}] ${e.scrollWidth}>${e.clientWidth}`);
        return { iw, docSW: document.documentElement.scrollWidth, bodySW: document.body.scrollWidth, wide: wide.slice(0, 6), scrollers: scrollers.slice(0, 6) };
      });
      check(`NEW-3 ${name}: document.scrollWidth <= innerWidth with a dish added, a field focused and a date set`, m.docSW <= m.iw && m.bodySW <= m.iw, JSON.stringify({ iw: m.iw, doc: m.docSW, body: m.bodySW }));
      check(`NEW-3 ${name}: nothing in the sheet is wider than the screen, nothing scrolls sideways`, m.wide.length === 0 && m.scrollers.length === 0, JSON.stringify({ wide: m.wide, scrollers: m.scrollers }));
      // horizontal finger drags across non-slider content must not move anything
      const ts = await touchSession(page);
      await page.evaluate(() => document.activeElement?.blur?.()); await sleep(300);
      const pts = await page.evaluate(() => { const sh = document.querySelector('[data-testid="food-bottom-sheet"], [data-testid="food-visit-panel"]'); const c = sh.querySelector('[data-testid="visit-dishes"]'); c.scrollIntoView({ block: "center" }); const f = c.querySelector('[data-testid="visit-dish-name"]').getBoundingClientRect(); const r = sh.getBoundingClientRect(); return { x: f.left + 20, y: Math.min(Math.max(f.top + f.height / 2, r.top + 80), r.bottom - 40) }; });
      const before = await page.evaluate(() => ({ sx: scrollX, vx: visualViewport.offsetLeft, left: document.querySelector('[data-testid="food-bottom-sheet"], [data-testid="food-visit-panel"]')?.getBoundingClientRect().left, cl: [...document.querySelectorAll("*")].filter((e) => e.scrollLeft).length }));
      await ts.down(pts.x, pts.y); await ts.to(pts.y + 2, { ms: 300, steps: 10, x1: pts.x + 250 }); await ts.up(); await sleep(300);
      const after = await page.evaluate(() => ({ sx: scrollX, vx: visualViewport.offsetLeft, left: document.querySelector('[data-testid="food-bottom-sheet"], [data-testid="food-visit-panel"]')?.getBoundingClientRect().left, cl: [...document.querySelectorAll("*")].filter((e) => e.scrollLeft).length }));
      check(`NEW-3 ${name}: a sideways finger drag moves nothing (page, viewport, sheet, scrollers)`, JSON.stringify(before) === JSON.stringify(after), `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
      await shot(page, `pan-${dims.w}`);
      await ctx.close();
    });
  }

  // ── NEW-5: the sheet follows a finger ──────────────────────────────────────────────────────────
  const mk = async () => { const r = await openForm(cr, { w: 390, h: 844 }); r.ts = await touchSession(r.page); return r; };
  await section("known-answer", async () => {
    const { ctx, page, ts } = await mk();
    await page.addStyleTag({ content: `${SHEET}{transition: height 5s linear !important}` });
    const s = await sheetState(page);
    await ts.down(s.x, s.handleY); await ts.to(s.handleY - 110, { ms: 400, steps: 10 }); await sleep(100);
    const mid = await sheetState(page);
    check("0 KNOWN ANSWER: a planted slow sheet reads as NOT following the finger", !near(mid.handleY, ts.y, 14), `handle ${Math.round(mid.handleY)} finger ${Math.round(ts.y)}`);
    await ts.up(); await ctx.close();
  });
  await section("handle", async () => {
    const { ctx, page, ts } = await mk();
    const s = await sheetState(page);
    // bring it down first so there is room to rise
    await ts.drag(s.x, s.handleY, s.handleY + 160, { ms: 500 }); await sleep(600);
    const a = await sheetState(page);
    await ts.down(a.x, a.handleY); await ts.to(a.handleY - 150, { ms: 450, steps: 12 }); await sleep(60);
    const mid = await sheetState(page);
    check("5a handle: the sheet's handle stays under the finger mid-drag (1:1)", near(mid.handleY, ts.y, 6) || mid.snap !== a.snap, `handle ${Math.round(mid.handleY)} finger ${Math.round(ts.y)}`);
    await ts.up(); await sleep(500);
    const b = await sheetState(page);
    check("5b handle: release lands on a stop taller than before", b.h > a.h, `${a.h} -> ${b.h}`);
    await ctx.close();
  });
  await section("handle zone", async () => {
    const { ctx, page, ts } = await mk();
    const s = await sheetState(page);
    const hz = await page.evaluate((SHEET) => { const h = document.querySelector(SHEET).children[0].getBoundingClientRect(); return h.height; }, SHEET);
    check("5c the grab zone at the top is a forgiving height (>= 48)", hz >= 48, `${hz}`);
    // a touch 20px BELOW the bar's centre (still in the zone) must drag the sheet
    await ts.drag(s.x, s.handleY + 20, s.handleY + 260, { ms: 400 }); await sleep(600);
    const a = await sheetState(page);
    check("5d a grab off-centre of the bar still moves the sheet", !a || a.h < s.h - 20, `${s.h} -> ${a && a.h}`);
    await ctx.close();
  });
  await section("content at top", async () => {
    const { ctx, page, ts } = await mk();
    await page.evaluate((SHEET) => { document.querySelector(SHEET).children[1].scrollTop = 0; }, SHEET); await sleep(200);
    const s = await sheetState(page);
    const y0 = s.top + 90;
    await ts.down(s.x, y0); await ts.to(y0 + 90, { ms: 350, steps: 12 }); await sleep(60);
    const mid = await sheetState(page);
    check("5e content/header at scroll-top: a pull down lowers the sheet with the finger", mid.h < s.h - 60, `${s.h} -> ${mid.h}`);
    await ts.up(); await ctx.close();
  });
  await section("content hair-scrolled", async () => {
    const { ctx, page, ts } = await mk();
    await page.evaluate((SHEET) => { document.querySelector(SHEET).children[1].scrollTop = 1; }, SHEET); await sleep(200);
    const s = await sheetState(page);
    const y0 = s.top + 90;
    await ts.down(y0 > 0 ? s.x : 0, y0); await ts.to(y0 + 90, { ms: 350, steps: 12 }); await sleep(60);
    const mid = await sheetState(page);
    check("5f content scrolled by a single hair: a pull down still lowers the sheet", mid.h < s.h - 60, `${s.h} -> ${mid.h}`);
    await ts.up(); await ctx.close();
  });
  await section("content scrolled", async () => {
    const { ctx, page, ts } = await mk();
    // full height first
    let s = await sheetState(page);
    await ts.drag(s.x, s.handleY, s.handleY - 400, { ms: 500 }); await sleep(600);
    await page.evaluate((SHEET) => { const c = document.querySelector(SHEET).children[1]; c.scrollTop = Math.min(120, c.scrollHeight - c.clientHeight); }, SHEET); await sleep(200);
    s = await sheetState(page);
    if (s.scrollTop < 20) { check("5g content scrolled: (form too short to scroll — skipped)", true); await ctx.close(); return; }
    const y0 = s.top + 160;
    await ts.down(s.x, y0); await ts.to(y0 + 60, { ms: 300, steps: 10 }); await ts.up(); await sleep(400);
    const a = await sheetState(page);
    check("5g content scrolled: a pull down scrolls the content and leaves the sheet where it was", a.scrollTop < s.scrollTop - 5 && near(a.h, s.h, 3), `scroll ${s.scrollTop}->${a.scrollTop}, h ${s.h}->${a.h}`);
    await ctx.close();
  });
  await section("flick", async () => {
    const { ctx, page, ts } = await mk();
    let s = await sheetState(page);
    await ts.drag(s.x, s.handleY, s.handleY + 300, { ms: 600 }); await sleep(600);
    s = await sheetState(page);
    await ts.drag(s.x, s.handleY, s.handleY - 70, { ms: 70, steps: 5 }); await sleep(600); // a short, fast flick
    const a = await sheetState(page);
    check("5h a short fast flick up moves to the next stop", a.h > s.h + 40, `${s.h} -> ${a.h}`);
    await ctx.close();
  });
  await section("grab mid-animation", async () => {
    const { ctx, page, ts } = await mk();
    let s = await sheetState(page);
    await ts.drag(s.x, s.handleY, s.handleY + 300, { ms: 500 }); await sleep(450);
    // the sheet is animating to its stop: grab it NOW and move 10px; it must not jump
    const live = await sheetState(page);
    await ts.down(live.x, live.handleY); await ts.to(live.handleY - 10, { ms: 100, steps: 4 }); await sleep(30);
    const mid = await sheetState(page);
    check("5i grabbing the sheet while it is still settling does not make it jump", Math.abs(mid.handleY - ts.y) <= 14, `handle ${Math.round(mid.handleY)} finger ${Math.round(ts.y)}`);
    await ts.up(); await ctx.close();
  });
  await section("slider", async () => {
    const { ctx, page, ts } = await mk();
    const sl = page.locator('input[type="range"][aria-label="Food rating"]');
    await sl.scrollIntoViewIfNeeded(); await sleep(300);
    const before = await sheetState(page);
    const b = await sl.boundingBox();
    await ts.down(b.x + b.width * 0.3, b.y + b.height / 2); await ts.to(b.y + b.height / 2 + 3, { ms: 300, steps: 10, x1: b.x + b.width * 0.7 }); await ts.up(); await sleep(400);
    const after = await sheetState(page);
    const val = Number(await sl.inputValue());
    check("5j a sideways drag on a rating slider moves the slider", val > 5, `value ${val}`);
    check("5k …and does not move the sheet", near(after.h, before.h, 2), `h ${before.h}->${after.h}`);
    await ctx.close();
  });
  await section("keyboard up", async () => {
    const { ctx, page, ts } = await mk();
    await page.locator('[data-testid="visit-dish-name"]').first().focus(); await sleep(900);
    const s = await sheetState(page);
    const kb = await page.evaluate(() => window.__kb?.open);
    // with the keyboard up a handle pull down puts the keyboard away rather than breaking the sheet
    await ts.drag(s.x, s.handleY, s.handleY + 120, { ms: 400 }); await sleep(700);
    const a = await sheetState(page);
    const focused = await page.evaluate(() => document.activeElement?.tagName);
    check("5l keyboard up: the sheet survives a handle pull (still open) and the keyboard goes away", !!a && kb && focused !== "INPUT", `kb=${kb} focused=${focused} sheet=${!!a}`);
    await ctx.close();
  });
} finally { await cr.close(); }
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} passed`);
process.exit(bad.length ? 1 : 0);
