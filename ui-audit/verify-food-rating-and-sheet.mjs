#!/usr/bin/env node
/* verify-food-rating-and-sheet — Food on an iPhone: the rating slider (NEW-1), what sits at the
 * bottom of an open form (NEW-2) and how the bottom sheet follows a finger (NEW-3). Rendered as
 * pictures and asserted, so Michael does not have to prove it on his phone.
 *
 * ENGINES, stated because a harness that cannot say what it models cannot be trusted:
 *  · WebKit + the iPhone 15 / SE descriptors drives the TAP flows and takes the pictures (the
 *    rating slider on every entry point, the form-open states at every sheet height).
 *  · Chromium + the same descriptor + CDP touch events drives the DRAGS. Playwright's WebKit has
 *    no touch-drag primitive (page.touchscreen only taps), and a mouse drag sends mouse events, not
 *    a finger. Chromium's touch pipeline honours touch-action / scroll chaining / touch slop the
 *    way a finger does, but it is NOT Safari's: real iOS finger behaviour is on the owner's
 *    checklist in the PR, not claimed here.
 *  · The iOS keyboard is the same MODEL verify-food-ios-screens uses (ui-audit/lib/foodIosPage.mjs).
 *
 * KNOWN-ANSWER ARM (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6): a planted sheet that ignores the finger
 * must read as "does not follow", else the run is VOID.
 *
 * Usage: build with the fixture env (see ui-audit/lib/foodFixture.mjs), `npx vite preview --port 4180`, then
 *   PW_CHROME=<chromium binary> node ui-audit/verify-food-rating-and-sheet.mjs [baseUrl] [--shots=<dir>] [--only=<regex>]
 */
import { webkit, chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { open as openRaw, openPlace, touchSession } from "./lib/foodIosPage.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

// FOREGROUND-OR-VOID: every page this harness measures is proven foreground + painting first.
const open = async (...a) => { const r = await openRaw(...a); await assertMeasurable(r.page, "verify-food-rating-and-sheet"); return r; };

const SHOTS = (process.argv.find((a) => a.startsWith("--shots=")) || "").slice(8);
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7);
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (id, ok, detail = "") => { results.push({ id, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${id}${detail ? "  — " + detail : ""}`); };
const section = async (name, fn) => { if (ONLY && !name.startsWith("0") && !new RegExp(ONLY).test(name)) return; try { await fn(); } catch (e) { check(`${name}: section aborted`, false, String(e.message).split("\n")[0]); } };
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const SHEET = '[data-testid="food-bottom-sheet"]';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── NEW-1: the rating slider ────────────────────────────────────────────────────────────────────
async function ratingChecks(page, tag, shotName, { expectLabels, formSel }) {
  for (const label of ["Food rating", "Ambiance rating"]) {
    const sl = page.locator(`${formSel} input[type="range"][aria-label="${label}"]`);
    const n = await sl.count();
    check(`${tag} · ${label}: exactly ONE slider`, n === 1, `found ${n}`);
    if (n !== 1) continue;
    const a = await sl.evaluate((el) => ({ min: el.min, max: el.max, step: el.step }));
    check(`${tag} · ${label}: range 1–10 in half steps`, a.min === "1" && a.max === "10" && a.step === "0.5", JSON.stringify(a));
    // the score region must not be tap buttons / a stepper (a dish row's own score is a different control)
    const box = sl.locator("xpath=ancestor::div[1]");
    const extra = await box.evaluate((el) => ({ tap: el.querySelectorAll('[data-testid^="score-tap"]').length, steppers: [...el.querySelectorAll("button")].filter((b) => /^[−+-]$/.test(b.textContent.trim())).length }));
    check(`${tag} · ${label}: no tap buttons or stepper beside it`, extra.tap === 0 && extra.steppers === 0, JSON.stringify(extra));
    if (expectLabels) {
      const txt = await box.innerText();
      check(`${tag} · ${label}: saved value shown as saved`, txt.includes(expectLabels[label]), `${JSON.stringify(txt.split("\n")[0])} wanted ${expectLabels[label]}`);
    } else {
      await sl.focus();
      await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowRight");
      const txt = (await box.innerText()).split("\n")[0];
      check(`${tag} · ${label}: two arrow presses reach a half point (6.5), not a whole number`, /6\.5 \/ 10/.test(txt), JSON.stringify(txt));
    }
  }
  await shot(page, shotName);
}

// ── NEW-3: sheet geometry through a finger ──────────────────────────────────────────────────────
const sheetState = (page) => page.evaluate((SHEET) => {
  const s = document.querySelector(SHEET); if (!s) return null;
  const c = s.children[1], r = s.getBoundingClientRect(), hb = s.children[0].getBoundingClientRect();
  return { h: Math.round(r.height), top: Math.round(r.top), snap: s.dataset.sheetSnap, scrollTop: Math.round(c.scrollTop), handleY: hb.top + hb.height / 2, x: r.left + r.width / 2, left: r.left };
}, SHEET);
const near = (a, b, tol = 3) => Math.abs(a - b) <= tol;

async function learnStops(page, ts) {
  const stops = {};
  const up = async () => { const s = await sheetState(page); await ts.drag(s.x, s.handleY, s.handleY - 420, { ms: 600 }); await sleep(600); return sheetState(page); };
  const down = async (d) => { const s = await sheetState(page); await ts.drag(s.x, s.handleY, s.handleY + d, { ms: 600 }); await sleep(600); return sheetState(page); };
  stops.full = (await up()).h;
  // from full, a slow drag to the middle of full and half lands on half; further down lands on peek
  const s0 = await sheetState(page);
  let st = await down(Math.round(s0.h * 0.25)); stops.half = st.h;
  st = await down(Math.round(st.h * 0.55)); stops.peek = st ? st.h : null;
  return stops;
}

async function sheetSection(engine, phone) {
  const tagp = `[${phone} · touch]`;
  const mk = async (query = "aburi", pick = /aburi/i) => {
    const { ctx, page } = await open(engine, phone, "ios");
    await openPlace(page, query, pick, false);
    const ts = await touchSession(page);
    return { ctx, page, ts };
  };
  const nm = (s) => `${phone.replace(/\s+/g, "")}-${s}`;

  await section(`${tagp} 3a`, async () => {
    const { ctx, page, ts } = await mk();
    const start = await sheetState(page);
    // FOLLOWS THE FINGER: hold mid-drag and compare the handle to the finger
    await ts.down(start.x, start.handleY);
    await ts.to(start.handleY - 110, { ms: 500, steps: 14 });
    await sleep(120); // a sheet that follows needs no catching up; one on a 220 ms transition is still behind
    const mid = await sheetState(page);
    check(`${tagp} 3a sheet follows the finger (handle under the finger mid-drag)`, near(mid.handleY, ts.y, 14), `handle ${Math.round(mid.handleY)} finger ${Math.round(ts.y)}`);
    await shot(page, nm("3a-mid-drag"));
    await ts.up(); await sleep(600);
    await ctx.close();
  });

  await section(`${tagp} 3b`, async () => {
    const { ctx, page, ts } = await mk();
    const stops = await learnStops(page, ts);
    check(`${tagp} 3b three distinct stops exist (peek < half < full)`, stops.peek < stops.half && stops.half < stops.full, JSON.stringify(stops));
    const settledOn = async (label) => { await sleep(650); const s = await sheetState(page); const ok = s && Object.values(stops).some((h) => near(s.h, h)); check(`${tagp} 3b ${label}: settles ON a stop, never between`, ok, s ? `h=${s.h} stops=${JSON.stringify(stops)}` : "sheet closed"); return s; };
    // back to half
    let s = await sheetState(page);
    await ts.drag(s.x, s.handleY, s.handleY - 70, { ms: 500 }); s = await settledOn("slow 70 up from peek");
    // the full stop is the content's own height however hard the finger over-pulled to reach it
    await ts.drag(s.x, s.handleY, s.handleY - (stops.full - s.h) + 12, { ms: 600 }); await sleep(650); s = await sheetState(page);
    check(`${tagp} 3b full is the same height whether reached by a gentle or an over-hard pull (no creep)`, near(s.h, stops.full), `gentle=${s.h} hard=${stops.full}`);
    await ts.drag(s.x, s.handleY, s.handleY + 300, { ms: 600 }); await sleep(650); s = await sheetState(page);
    // overshoot: drag well past full
    s = await sheetState(page);
    await ts.drag(s.x, s.handleY, s.handleY - 400, { ms: 500 }); await sleep(650); s = await sheetState(page);
    await ts.down(s.x, s.handleY); await ts.to(s.handleY - 150, { ms: 400 }); await sleep(100);
    const over = await sheetState(page);
    check(`${tagp} 3b dragging past full never opens empty space above the content`, over.h <= stops.full + 4, `h=${over.h} full=${stops.full}`);
    await ts.up(); await sleep(650);
    s = await sheetState(page);
    check(`${tagp} 3b …and after letting go the full stop is the same height as before (it does not creep taller)`, near(s.h, stops.full), `h=${s.h} full=${stops.full}`);
    // FLICKS: one stop per flick, in the flick's direction
    s = await sheetState(page);
    await ts.drag(s.x, s.handleY, s.handleY + 380, { ms: 600 }); await sleep(700); // down to peek (or closed -> reopen)
    s = await sheetState(page);
    if (!s) { check(`${tagp} 3b a slow full-height pull leaves the place open`, false, "sheet closed"); await ctx.close(); return; }
    await ts.drag(s.x, s.handleY, s.handleY - 60, { ms: 70, steps: 4 }); await sleep(700); s = await sheetState(page);
    check(`${tagp} 3c a short flick up from peek moves ONE stop (to half)`, near(s.h, stops.half), `h=${s.h} half=${stops.half}`);
    await ts.drag(s.x, s.handleY, s.handleY - 60, { ms: 70, steps: 4 }); await sleep(700); s = await sheetState(page);
    check(`${tagp} 3c a short flick up from half moves ONE stop (to full)`, near(s.h, stops.full), `h=${s.h} full=${stops.full}`);
    await ts.drag(s.x, s.handleY, s.handleY + 60, { ms: 70, steps: 4 }); await sleep(700); s = await sheetState(page);
    check(`${tagp} 3c a short flick down from full moves ONE stop (to half)`, near(s.h, stops.half), `h=${s.h} half=${stops.half}`);
    await ts.drag(s.x, s.handleY, s.handleY + 60, { ms: 70, steps: 4 }); await sleep(700); s = await sheetState(page);
    check(`${tagp} 3c a short flick down from half moves ONE stop (to peek), not closed`, s && near(s.h, stops.peek), s ? `h=${s.h} peek=${stops.peek}` : "sheet closed");
    // a tap on the handle is not a drag
    s = await sheetState(page);
    await ts.tap(s.x, s.handleY); await sleep(500); const t = await sheetState(page);
    check(`${tagp} 3c a tap on the handle changes nothing`, t && near(t.h, s.h), `h ${s.h} -> ${t?.h}`);
    await ctx.close();
  });

  await section(`${tagp} 3d`, async () => {
    const { ctx, page, ts } = await mk();
    const stops = await learnStops(page, ts);
    // park at half
    let s = await sheetState(page);
    await ts.drag(s.x, s.handleY, s.handleY - 70, { ms: 500 }); await sleep(650); s = await sheetState(page);
    const half = s.h;
    // DRAG ON CONTENT (not the handle): pull UP at half raises the sheet before it scrolls the list
    const grab = { x: s.left + 24, y: s.top + 150 };
    await ts.drag(grab.x, grab.y, grab.y - 120, { ms: 500 }); await sleep(650); s = await sheetState(page);
    check(`${tagp} 3d a pull up on the content raises the sheet (instead of only scrolling the list)`, s.h > half + 20, `half=${half} now=${s.h} scrollTop=${s.scrollTop}`);
    // …and the header is a grab area too
    await ts.drag(grab.x, s.top + 60, s.top + 200, { ms: 500 }); await sleep(650); const lowered = await sheetState(page);
    check(`${tagp} 3d a pull down on the header/content (list at top) lowers the sheet`, lowered && lowered.h < s.h - 20, `h ${s.h} -> ${lowered?.h}`);
    await shot(page, nm("3d-after-content-drag"));
    await ctx.close();
  });

  await section(`${tagp} 3d2`, async () => {
    // a form makes the content taller than the sheet at every stop: now scrolling is observable
    const { ctx, page, ts } = await mk();
    await page.locator('[data-testid="food-add-dish-btn"]').evaluate((b) => b.click()); await sleep(1200);
    await page.evaluate(() => document.activeElement?.blur?.()); await sleep(700);
    let s = await sheetState(page);
    await ts.drag(s.x, s.handleY, s.handleY - 500, { ms: 600 }); await sleep(700); s = await sheetState(page); // to full
    const full = s.h;
    const grab = { x: s.left + 24, y: s.top + 260 };
    await ts.drag(grab.x, grab.y, grab.y - 150, { ms: 500 }); await sleep(500); s = await sheetState(page);
    const scrolled = s.scrollTop;
    check(`${tagp} 3d2 at full height a pull up scrolls the list and keeps the sheet`, near(s.h, full) && scrolled > 20, `h=${s.h} full=${full} scrollTop=${scrolled}`);
    await ts.drag(grab.x, grab.y - 40, grab.y + 10, { ms: 400 }); await sleep(500); s = await sheetState(page);
    check(`${tagp} 3d2 a pull down while the list is scrolled scrolls it back, the sheet stays`, near(s.h, full) && s.scrollTop < scrolled, `h=${s.h} scrollTop ${scrolled} -> ${s.scrollTop}`);
    await page.evaluate(() => { document.querySelector('[data-testid="food-bottom-sheet"]').children[1].scrollTop = 0; }); await sleep(200);
    await ts.drag(grab.x, grab.y - 100, grab.y + 100, { ms: 500 }); await sleep(700); s = await sheetState(page);
    check(`${tagp} 3d2 with the list at its top a pull down lowers the sheet — and with a form open it never closes`, !!s && s.h < full - 20, s ? `h=${s.h} full=${full}` : "sheet closed");
    await ctx.close();
  });

  await section(`${tagp} 3e`, async () => {
    const { ctx, page, ts } = await mk();
    // dragging a rating slider must not move the sheet or scroll the list
    await page.locator('[data-testid="food-log-visit-btn"]').evaluate((b) => b.click()); await sleep(900);
    await page.evaluate(() => document.activeElement?.blur?.()); await sleep(500);
    const sl = page.locator('input[type="range"][aria-label="Food rating"]');
    if (await sl.count() !== 1) { check(`${tagp} 3e rating slider present to drag`, false, `count=${await sl.count()}`); await ctx.close(); return; }
    await sl.scrollIntoViewIfNeeded(); await sleep(300);
    const before = await sheetState(page);
    const b = await sl.boundingBox();
    await ts.down(b.x + b.width * 0.3, b.y + b.height / 2);
    await ts.to(b.y + b.height / 2 + 3, { ms: 300, steps: 10, x1: b.x + b.width * 0.7 }); // mostly sideways, a thumb's wobble
    await ts.up(); await sleep(400);
    const after = await sheetState(page);
    const val = await sl.inputValue();
    check(`${tagp} 3e a finger across the rating slider sets a half-step value`, Number(val) * 2 === Math.round(Number(val) * 2) && val !== "5.5", `value=${val}`);
    check(`${tagp} 3e …without moving the sheet or scrolling the list`, near(after.h, before.h) && near(after.scrollTop, before.scrollTop, 2), `h ${before.h}->${after.h} scrollTop ${before.scrollTop}->${after.scrollTop}`);
    await ctx.close();
  });

  await section(`${tagp} 3f`, async () => {
    const { ctx, page, ts } = await mk();
    // FORM OPEN + KEYBOARD UP: a pull down must not close the place or lose what was typed
    await page.locator('[data-testid="food-add-dish-btn"]').evaluate((b) => b.click()); await sleep(1200);
    await page.keyboard.type("Hamachi crudo"); await sleep(400);
    let s = await sheetState(page);
    const kbBefore = await page.evaluate(() => window.__kb.open);
    await shot(page, nm("3f-form-keyboard-up"));
    await ts.drag(s.x, s.handleY, s.handleY + 150, { ms: 500 }); await sleep(900);
    s = await sheetState(page);
    check(`${tagp} 3f keyboard up + pull down: the place sheet stays open`, !!s, s ? "open" : "sheet closed");
    if (s) {
      const typed = await page.locator('[data-testid="dish-name-input"]').inputValue().catch(() => null);
      check(`${tagp} 3f …and the dish being typed is still there`, typed === "Hamachi crudo", `value=${JSON.stringify(typed)}`);
      const kbAfter = await page.evaluate(() => window.__kb.open);
      check(`${tagp} 3f …and the pull puts the keyboard away`, kbBefore && !kbAfter, `keyboard ${kbBefore} -> ${kbAfter}`);
      await shot(page, nm("3f-form-after-pull"));
      // keyboard down, form open: drags still never close the place
      const s2 = await sheetState(page);
      await ts.drag(s2.x, s2.handleY, s2.handleY + 500, { ms: 500 }); await sleep(800);
      const s3 = await sheetState(page);
      check(`${tagp} 3f form open, keyboard down: even a long pull down leaves the place open`, !!s3, s3 ? `h=${s3.h}` : "sheet closed");
    }
    await ctx.close();
  });
}

// ── NEW-2: only the open form's actions are on screen, at every sheet height ───────────────────
async function formStackingSection(engine, phone) {
  const tagp = `[${phone}]`;
  const nm = (s) => `${phone.replace(/\s+/g, "")}-${s}`;
  const actions = (page) => page.evaluate(() => {
    const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden"; };
    const sheet = document.querySelector('[data-testid="food-bottom-sheet"]');
    const sr = sheet.getBoundingClientRect();
    const log = document.querySelector('[data-testid="food-actions-row"]');
    const save = document.querySelector('[data-testid="dish-edit-buttons"], [data-testid="visit-form-actions"]');
    const sb = save?.getBoundingClientRect();
    return { logShown: vis(log), saveShown: vis(save), saveInSheet: !!sb && sb.bottom <= sr.bottom + 1 && sb.top >= sr.top };
  });
  for (const height of ["peek", "half", "full"]) {
    await section(`${tagp} 2 ${height}`, async () => {
      const { ctx, page } = await open(engine, phone, "ios");
      await openPlace(page, "aburi", /aburi/i);
      const hb = await page.locator('[data-testid="food-sheet-drag-handle"]').boundingBox();
      const x = hb.x + hb.width / 2, y = hb.y + hb.height / 2;
      if (height !== "half") {
        await page.mouse.move(x, y); await page.mouse.down(); await sleep(500);
        await page.mouse.move(x, height === "full" ? 40 : y + 160, { steps: 12 }); await page.mouse.up(); await sleep(600);
      }
      const snap = await page.locator(SHEET).getAttribute("data-sheet-snap");
      check(`${tagp} 2 sheet at ${height}`, snap === height, `snap=${snap}`);
      const closed = await actions(page);
      check(`${tagp} 2 ${height}: "Log a visit" is there while no form is open`, closed.logShown, JSON.stringify(closed));
      // dish form
      await page.locator('[data-testid="food-add-dish-btn"]').evaluate((b) => b.click());
      await sleep(1200); await page.evaluate(() => document.activeElement?.blur?.()); await sleep(600);
      const dish = await actions(page);
      check(`${tagp} 2 ${height} · dish form: only the form's Save is shown, pinned at the bottom of the sheet — no "Log a visit" under it`, dish.saveShown && dish.saveInSheet && !dish.logShown, JSON.stringify(dish));
      await shot(page, nm(`2-${height}-dish-form`));
      // …and with the keyboard up (a field focused)
      await page.locator('[data-testid="dish-name-input"]').click(); await sleep(900);
      const dishKb = await actions(page);
      check(`${tagp} 2 ${height} · dish form, keyboard up: still no "Log a visit"`, !dishKb.logShown, JSON.stringify(dishKb));
      await shot(page, nm(`2-${height}-dish-form-keyboard`));
      await page.evaluate(() => document.activeElement?.blur?.()); await sleep(600);
      // close the form → the bar returns
      await page.locator('[data-testid="dish-edit-close"]').evaluate((b) => b.click()); await sleep(700);
      const back = await actions(page);
      check(`${tagp} 2 ${height}: closing the form brings "Log a visit" back`, back.logShown, JSON.stringify(back));
      // visit form
      await page.locator('[data-testid="food-log-visit-btn"]').evaluate((b) => b.click()); await sleep(900);
      await page.evaluate(() => document.activeElement?.blur?.()); await sleep(500);
      const visit = await actions(page);
      check(`${tagp} 2 ${height} · visit form: only the form's actions, pinned at the bottom — no "Log a visit"`, visit.saveShown && visit.saveInSheet && !visit.logShown, JSON.stringify(visit));
      await shot(page, nm(`2-${height}-visit-form`));
      await page.locator('[data-testid="visit-form-actions"] button').first().evaluate((b) => b.click()).catch(() => {}); await sleep(600);
      // edit an old visit
      await page.locator('[data-testid="food-visit-card"]').first().evaluate((b) => b.click()).catch(() => {}); await sleep(900);
      const editing = await page.locator('[data-testid="food-visit-card-editing"]').count();
      if (editing) {
        const ed = await actions(page);
        check(`${tagp} 2 ${height} · edit visit: no "Log a visit" under the edit form`, !ed.logShown, JSON.stringify(ed));
        await shot(page, nm(`2-${height}-edit-visit`));
      } else check(`${tagp} 2 ${height} · edit visit form opened`, false, "no editing card");
      await ctx.close();
    });
  }
}

// ── run ─────────────────────────────────────────────────────────────────────────────────────────
const wk = await webkit.launch();
const cr = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined, args: ["--no-sandbox"] });
try {
  // 0. KNOWN-ANSWER ARM: a sheet that ignores the finger must read as "does not follow"
  await section("0", async () => {
    const { ctx, page } = await open(cr, "iPhone 15", "ios");
    await openPlace(page, "aburi", /aburi/i, false);
    const ts = await touchSession(page);
    await page.addStyleTag({ content: `${SHEET}{transition: height 5s linear !important}` }); // planted: a sheet far behind the finger
    const s = await sheetState(page);
    await ts.down(s.x, s.handleY); await ts.to(s.handleY - 110, { ms: 400, steps: 10 }); await sleep(100);
    const mid = await sheetState(page);
    check("0a KNOWN ANSWER: a sheet on a slow transition reads as NOT following the finger", !near(mid.handleY, ts.y, 14), `handle ${Math.round(mid.handleY)} finger ${Math.round(ts.y)}`);
    await ts.up(); await ctx.close();
  });

  // 1. RATINGS — every entry point, phone (WebKit) and desktop
  for (const phone of ["iPhone 15", "iPhone SE", "desktop"]) {
    const eng = phone === "desktop" ? cr : wk;
    const tap = phone !== "desktop";
    const nm = (s) => `${phone.replace(/\s+/g, "")}-${s}`;
    const logBtn = '[data-testid="food-log-visit-btn"]';
    await section(`1 ${phone} first visit`, async () => {
      const { ctx, page } = await open(eng, phone, "ios");
      await openPlace(page, "fadi", /fadi/i, tap);
      await page.locator(logBtn).evaluate((b) => b.click()); await sleep(900);
      await page.evaluate(() => document.activeElement?.blur?.()); await sleep(400);
      await ratingChecks(page, `[${phone}] first visit`, nm("1-rating-first-visit"), { formSel: "form" });
      await ctx.close();
    });
    await section(`1 ${phone} log another`, async () => {
      const { ctx, page } = await open(eng, phone, "ios");
      await openPlace(page, "aburi", /aburi/i, tap);
      await page.locator(logBtn).evaluate((b) => b.click()); await sleep(900);
      await page.evaluate(() => document.activeElement?.blur?.()); await sleep(400);
      await ratingChecks(page, `[${phone}] log another visit`, nm("1-rating-log-another"), { formSel: "form" });
      await ctx.close();
    });
    await section(`1 ${phone} edit old`, async () => {
      const { ctx, page } = await open(eng, phone, "ios");
      await openPlace(page, "aburi", /aburi/i, tap);
      await page.locator('[data-testid="food-visit-card"]').first().evaluate((b) => b.click()); await sleep(900);
      await page.evaluate(() => document.activeElement?.blur?.()); await sleep(400);
      await ratingChecks(page, `[${phone}] edit old visit (8.75 / 8 saved)`, nm("1-rating-edit-old"), {
        formSel: '[data-testid="food-visit-card-editing"]', expectLabels: { "Food rating": "8.75 / 10", "Ambiance rating": "8 / 10" },
      });
      await ctx.close();
    });
  }

  // 2. FORM-OPEN STACKING — tap flows, WebKit
  for (const phone of ["iPhone 15", "iPhone SE"]) await formStackingSection(wk, phone);

  // 3. SHEET DRAGS — real touch, Chromium
  for (const phone of ["iPhone 15", "iPhone SE"]) await sheetSection(cr, phone);
} finally {
  await wk.close(); await cr.close();
}
const failed = results.filter((r) => !r.ok);
const voided = results.some((r) => r.id.startsWith("0") && !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed (WebKit taps + Chromium CDP touch, iPhone descriptors, iOS keyboard MODEL — see header)${voided ? " — VOID" : ""}${SHOTS ? ` · screenshots in ${SHOTS}` : ""}`);
process.exit(failed.length || voided ? 1 : 0);
