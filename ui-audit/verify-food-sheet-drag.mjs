#!/usr/bin/env node
/* verify-food-sheet-drag — Food's place card as a native-feeling bottom sheet (B2243588 ×2, NEW-1 of the 2026-10-17 owner block):
 * the sheet follows the finger 1:1, moves by a TRANSFORM (no per-move React render / height change), a flick drops or closes it, a
 * slow partial drag springs back, drag up goes to full, content still scrolls, a header grab works, the keyboard-up pull follows and
 * then puts the keyboard away, and past the top it rubber-bands.
 *
 * ENGINES, stated (docs/PHONE-TESTING.md): Chromium + iPhone descriptor + CDP touch = a REAL touch pipeline (touch-action, slop, chaining).
 * WebKit + iPhone descriptor can't send a native touch drag, so there the finger is a SYNTHETIC touch event stream into the page (it
 * exercises the page's JS and WebKit's layout, NOT Safari's native scroll arbitration) and the handle is driven by a mouse (pointer
 * events). Neither is Mobile Safari; the real-finger step stays on the V#.
 * KNOWN-ANSWER ARM: a sheet planted on a 5 s transition must read as "does not follow", else the run is VOID.
 *
 * Usage: fixture build + `npx vite preview --port 4180`, then `node ui-audit/verify-food-sheet-drag.mjs [baseUrl] [--shots=<dir>]`
 *        deployed build as the test account: `node ui-audit/verify-food-sheet-drag.mjs --live [https://planyr.io]`
 */
import { webkit, chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { open as openRaw, openPlace, touchSession, LIVE, seedLive, cleanupLive, closeLeakedLive } from "./lib/foodIosPage.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const SHOTS = (process.argv.find((a) => a.startsWith("--shots=")) || "").slice(8);
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (id, ok, detail = "") => { results.push({ id, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${id}${detail ? "  — " + detail : ""}`); };
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7);
const section = async (name, fn) => { if (ONLY && !new RegExp(ONLY).test(name)) return; try { await fn(); } catch (e) { check(`${name}: section aborted`, false, String(e.message).split("\n")[0]); } finally { await closeLeakedLive(); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHEET = '[data-testid="food-bottom-sheet"]';
const near = (a, b, tol = 3) => Math.abs(a - b) <= tol;
const frames = (page, n = 2) => page.evaluate((n) => new Promise((r) => { const go = (i) => (i ? requestAnimationFrame(() => go(i - 1)) : r()); go(n); }), n);

const state = (page) => page.evaluate((SHEET) => {
  const s = document.querySelector(SHEET); if (!s) return null;
  const c = s.children[1], r = s.getBoundingClientRect(), hb = s.children[0].getBoundingClientRect();
  return { h: Math.round(r.height), top: r.top, snap: s.dataset.sheetSnap, scrollTop: c.scrollTop, handleY: hb.top + hb.height / 2, x: r.left + r.width / 2,
    styleH: s.style.height, transform: s.style.transform, renders: window.__foodSheetRenders || 0, vh: innerHeight };
}, SHEET);

/** A finger on either engine. kind "pointer" (the handle) uses the mouse on WebKit; "touch" is a synthetic touch stream on WebKit. */
async function finger(page, engine, kind) {
  if (engine === "chromium") {
    const ts = await touchSession(page);
    return { down: (x, y) => ts.down(x, y), move: (y) => ts.to(y, { ms: 16, steps: 1 }), up: () => ts.up(), get y() { return ts.y; }, ts };
  }
  let x0 = 0, y0 = 0, y = 0;
  const send = (type, px, py) => page.evaluate(({ type, px, py }) => {
    const target = window.__fingerTarget && type !== "touchstart" ? window.__fingerTarget : document.elementFromPoint(px, py);
    if (type === "touchstart") window.__fingerTarget = target;
    const end = type === "touchend" || type === "touchcancel";
    const t = { identifier: 1, target, clientX: px, clientY: py, pageX: px, pageY: py, screenX: px, screenY: py };
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(e, { touches: { value: end ? [] : [t] }, targetTouches: { value: end ? [] : [t] }, changedTouches: { value: [t] } });
    target.dispatchEvent(e);
  }, { type, px, py });
  if (kind === "pointer") return {
    down: async (px, py) => { x0 = px; y = py; await page.mouse.move(px, py); await page.mouse.down(); },
    move: async (ny) => { y = ny; await page.mouse.move(x0, ny); }, up: async () => { await page.mouse.up(); }, get y() { return y; },
  };
  return {
    down: async (px, py) => { x0 = px; y0 = py; y = py; await send("touchstart", px, py); },
    move: async (ny) => { y = ny; await send("touchmove", x0, ny); }, up: async () => { await send("touchend", x0, y); }, get y() { return y; },
  };
}

/** Drag from y0 by dy in `steps` moves; sample (sheet top − finger) after every move. Returns the worst deviation from 1:1. */
async function drag(page, f, x, y0, dy, { steps = 10, release = true, skipFirst = false } = {}) {
  const s0 = await state(page);
  await f.down(x, y0);
  const samples = [];
  for (let i = 1; i <= steps; i++) {
    await f.move(y0 + (dy * i) / steps);
    await frames(page, 2);
    const s = await state(page);
    if (s) samples.push({ moved: s.top - s0.top, finger: (dy * i) / steps, styleH: s.styleH, transform: s.transform, renders: s.renders });
  }
  const mid = await state(page);
  if (release) await f.up();
  // skipFirst: Chromium swallows a touch's first move inside its slop region (the page never sees it), which is the driver, not the sheet.
  return { s0, mid, samples, worst: Math.max(...samples.slice(skipFirst ? 1 : 0).map((m) => Math.abs(m.moved - m.finger))) };
}

const open = async (browser, phone, kind) => { const r = await openRaw(browser, phone, kind); await assertMeasurable(r.page, "verify-food-sheet-drag"); await r.page.evaluate(() => { window.__PLANYR_E2E = true; }); return r; };
async function ready(browser, phone) {
  const r = await open(browser, phone, "ios");
  await openPlace(r.page, "aburi", /aburi/i, browser.browserType().name() === "webkit");
  await sleep(LIVE ? 2500 : 600);
  return r;
}

async function suite(browser, engine, phone) {
  const L = `[${engine} ${phone}]`;
  const touchKind = "touch";
  // 0. KNOWN-ANSWER ARM
  await section(`${L} 0`, async () => {
    const { ctx, page } = await ready(browser, phone);
    await page.addStyleTag({ content: `${SHEET}{transition: height 5s linear, transform 5s linear !important}` });
    await sleep(500);
    const s = await state(page);
    const f = await finger(page, engine, engine === "chromium" ? "touch" : "pointer");
    const r = await drag(page, f, s.x, s.handleY, -110, { steps: 6, release: false });
    check(`${L} 0 KNOWN ANSWER: a planted slow sheet reads as NOT following the finger`, r.worst > 14, `worst ${r.worst.toFixed(1)}`);
    await f.up(); await ctx.close();
  });
  // 1. handle: 1:1 down, via a transform, no per-move height write, no per-move React render
  await section(`${L} 1`, async () => {
    const { ctx, page } = await ready(browser, phone);
    const f = await finger(page, engine, "pointer");
    const s = await state(page);
    const r = await drag(page, f, s.x, s.handleY, 120, { steps: 12 });
    check(`${L} 1a handle drag down: the sheet follows the finger 1:1 (worst ${r.worst.toFixed(1)} off)`, r.worst <= 4, JSON.stringify({ first: r.samples[0], last: r.samples[r.samples.length - 1] }));
    const heights = new Set(r.samples.map((m) => m.styleH));
    check(`${L} 1b mid-drag the sheet is moved by transform: its height is NOT rewritten per move and a transform is set`, heights.size === 1 && r.samples.every((m) => /translate/.test(m.transform)), `heights ${[...heights].join(",")} transform ${r.samples[5]?.transform}`);
    const rendersDuring = r.samples[r.samples.length - 1].renders - (r.samples[0].renders);
    check(`${L} 1c no React render of the sheet per move (renders during 12 moves = ${rendersDuring})`, rendersDuring <= 1, `renders ${r.samples[0].renders}->${r.samples[r.samples.length - 1].renders}`);
    await sleep(700);
    const after = await state(page);
    check(`${L} 1d after release the transform is gone and the height is a plain settled value`, after && after.transform === "" && /px$/.test(after.styleH), JSON.stringify({ t: after?.transform, h: after?.styleH }));
    await ctx.close();
  });
  // 2. slow partial drag springs back; flick drops / closes; drag up goes to full
  await section(`${L} 2`, async () => {
    const { ctx, page } = await ready(browser, phone);
    const f = await finger(page, engine, "pointer");
    let s = await state(page);
    await drag(page, f, s.x, s.handleY, 30, { steps: 6 }); await sleep(700);
    let a = await state(page);
    check(`${L} 2a a slow 30px pull springs back to the same stop`, a && near(a.h, s.h, 3) && a.snap === s.snap, `${s.h}/${s.snap} -> ${a && a.h}/${a && a.snap}`);
    // flick down: few fast moves
    s = await state(page);
    await f.down(s.x, s.handleY); await f.move(s.handleY + 40); await f.move(s.handleY + 90); await f.up(); await sleep(800);
    a = await state(page);
    check(`${L} 2b a quick flick down drops the sheet to a lower stop (or closes it)`, !a || a.h < s.h - 20, `${s.h} -> ${a ? a.h : "closed"}`);
    await ctx.close();
  });
  await section(`${L} 3`, async () => {
    const { ctx, page } = await ready(browser, phone);
    const f = await finger(page, engine, "pointer");
    let s = await state(page);
    await drag(page, f, s.x, s.handleY, -260, { steps: 10 }); await sleep(800);
    const a = await state(page);
    check(`${L} 3a dragging up from half goes to full`, a && a.snap === "full" && a.h > s.h + 20, `${s.h}/${s.snap} -> ${a && a.h}/${a && a.snap}`);
    // rubber band: pulling far past the top never takes the sheet more than the overshoot cap above full
    const f2 = await finger(page, engine, "pointer");
    const top0 = (await state(page)).top;
    const r = await drag(page, f2, a.x, a.handleY, -400, { steps: 8, release: false });
    const over = top0 - r.mid.top;
    check(`${L} 3b past the top it rubber-bands (resists, never more than ~56 over)`, over > 0 && over <= 62, `over ${over.toFixed(1)} for a 400px pull`);
    await f2.up(); await ctx.close();
  });
  // 4. header + content grab, content scroll hand-off
  await section(`${L} 4`, async () => {
    const { ctx, page } = await ready(browser, phone);
    const f = await finger(page, engine, touchKind);
    let s = await state(page);
    await page.evaluate((SHEET) => { document.querySelector(SHEET).children[1].scrollTop = 0; }, SHEET);
    const hdr = await page.evaluate((SHEET) => { const g = document.querySelector(SHEET + " [data-sheet-grab]"); const r = g.getBoundingClientRect(); return { x: r.left + 30, y: r.top + r.height / 2, ta: getComputedStyle(g).touchAction }; }, SHEET);
    check(`${L} 4a the header is touch-action:none (a grab area like the handle)`, hdr.ta === "none", hdr.ta);
    const r = await drag(page, f, hdr.x, hdr.y, 90, { steps: 9, skipFirst: engine === "chromium" });
    check(`${L} 4b a header grab lowers the sheet with the finger (worst ${r.worst.toFixed(1)} off)`, r.worst <= 4, r.worst > 4 ? JSON.stringify(r.samples.map((m) => [Math.round(m.moved), Math.round(m.finger)])) : "");
    await sleep(700);
    // bring to full then scroll content
    s = await state(page);
    const f2 = await finger(page, engine, "pointer");
    await drag(page, f2, s.x, s.handleY, -400, { steps: 8 }); await sleep(800);
    s = await state(page);
    const sc = await page.evaluate((SHEET) => { const c = document.querySelector(SHEET).children[1]; return { can: c.scrollHeight - c.clientHeight, top: c.getBoundingClientRect().top }; }, SHEET);
    if (engine !== "chromium") check(`${L} 4c content scroll (native scrolling cannot be driven by synthetic touch events — Chromium CDP row covers it)`, true, "skipped on webkit");
    else if (sc.can > 30) {
      const f3 = await finger(page, engine, touchKind);
      await f3.down(s.x, sc.top + 200); for (let i = 1; i <= 8; i++) { await f3.move(sc.top + 200 - i * 12); await frames(page, 1); } await f3.up(); await sleep(400);
      const a = await state(page);
      check(`${L} 4c content scroll still works once the sheet is full (list moved, sheet did not)`, a.scrollTop > s.scrollTop + 10 && near(a.h, s.h, 3), `scroll ${s.scrollTop}->${a.scrollTop} h ${s.h}->${a.h}`);
    } else check(`${L} 4c content scroll (content shorter than the sheet — nothing to scroll)`, true, "skipped");
    await ctx.close();
  });
  // 5. page behind never moves; no sideways pan
  await section(`${L} 5`, async () => {
    const { ctx, page } = await ready(browser, phone);
    const before = await page.evaluate(() => ({ c: window.__foodMap?.getCenter?.(), sy: scrollY, sx: scrollX, dw: document.documentElement.scrollWidth, iw: innerWidth }));
    const f = await finger(page, engine, "pointer");
    const s = await state(page);
    await drag(page, f, s.x, s.handleY, 100, { steps: 8 }); await sleep(600);
    const after = await page.evaluate(() => ({ c: window.__foodMap?.getCenter?.(), sy: scrollY, sx: scrollX, dw: document.documentElement.scrollWidth, iw: innerWidth }));
    check(`${L} 5 the map and the page behind do not move, nothing pans sideways`, JSON.stringify(before.c) === JSON.stringify(after.c) && after.sy === 0 && after.sx === 0 && after.dw <= after.iw, JSON.stringify({ before, after }));
    await ctx.close();
  });
  // 6. keyboard up (Chromium has the iOS keyboard MODEL): the sheet follows a pull down, then the keyboard goes away
  if (engine === "chromium") await section(`${L} 6`, async () => {
    const { ctx, page } = await ready(browser, phone);
    await page.locator('[data-testid="food-log-visit-btn"]').evaluate((b) => b.click()); await sleep(900);
    await page.locator('[data-testid="visit-dish-name"]').first().focus(); await sleep(900);
    const s = await state(page);
    const kb = await page.evaluate(() => window.__kb?.open);
    const f = await finger(page, engine, "touch");
    const r = await drag(page, f, s.x, s.handleY, 80, { steps: 8, release: false, skipFirst: true });
    check(`${L} 6a keyboard up: the sheet follows a pull down with the finger (worst ${r.worst.toFixed(1)} off) instead of ignoring it`, kb && r.worst <= 4, `kb=${kb}`);
    await f.up(); await sleep(900);
    const a = await state(page);
    const focused = await page.evaluate(() => document.activeElement?.tagName);
    check(`${L} 6b …and on release the keyboard goes away and the sheet is still open`, !!a && focused !== "INPUT", `focused=${focused}`);
    await ctx.close();
  });
}

if (LIVE) { await seedLive(); console.log("live: throwaway Aburi visit seeded on the test account"); }
const wk = await webkit.launch();
const cr = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined, args: ["--no-sandbox"] });
try {
  const PH = (process.argv.find((a) => a.startsWith("--phones=")) || "--phones=iPhone 15,iPhone SE").slice(9).split(",");
  for (const phone of PH) { await suite(cr, "chromium", phone); await suite(wk, "webkit", phone); }
  // Landscape: the card is the side dock, not a sheet — nothing to drag, and nothing broken.
  await section("landscape", async () => {
    for (const phone of ["iPhone 15 landscape"]) {
      const { ctx, page } = await open(wk, phone, "ios").catch(() => ({}));
      if (!page) { check("landscape: could not open", false); continue; }
      await openPlace(page, "aburi", /aburi/i, true);
      const dock = await page.evaluate((SHEET) => ({ sheet: !!document.querySelector(SHEET), dock: !!document.querySelector('[data-testid="food-visit-panel"]') }), SHEET);
      check("[webkit iPhone 15 landscape] the card is the docked side panel (no bottom sheet)", dock.dock && !dock.sheet, JSON.stringify(dock));
      await ctx.close();
    }
  });
} finally {
  await wk.close(); await cr.close();
  if (LIVE) { const c = await cleanupLive(); console.log("live cleanup:", JSON.stringify(c)); if (c.error || c.left !== 0) { console.log("FAIL  live cleanup left rows behind"); process.exitCode = 1; } }
}
const failed = results.filter((r) => !r.ok);
const voided = results.some((r) => / 0 KNOWN/.test(r.id) && !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed${voided ? " — VOID" : ""}`);
process.exit(failed.length || voided ? 1 : 0);
