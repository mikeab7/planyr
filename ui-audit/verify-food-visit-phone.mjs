#!/usr/bin/env node
/* verify-food-visit-phone — NEW-1 (Food on a phone: first visit, dish ratings, keyboard, AutoFill).
 *
 * ENGINE: Playwright WebKit with the iPhone 15 device descriptor (touch, DPR 3). EMULATED, not on
 * device: it cannot open the real iOS keyboard (so the keyboard case stubs window.visualViewport
 * the way iOS behaves — layout viewport unchanged, visual viewport shrinks), cannot show Safari's
 * AutoFill bar (so the AutoFill case asserts the attributes iOS keys off), and cannot do a real
 * finger scroll (so scroll-vs-tap safety is asserted structurally: buttons, not a drag surface).
 * The on-device half is V1476080 in VERIFICATION.md.
 *
 * Drives ui-audit/fixtures/food-panel.html (the REAL VisitPanel, in-memory handlers) on a local vite
 * dev server — logged out, no Supabase, no real data.
 * Usage: npx vite --port 5199 & ; node ui-audit/verify-food-visit-phone.mjs [baseUrl]   (exit 1 on any FAIL)
 */
import { webkit, devices } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.argv[2] || "http://localhost:5199";
const FIX = `${BASE}/ui-audit/fixtures/food-panel.html`;
const results = [];
const check = (id, ok, detail = "") => { results.push({ id, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${id}${detail ? "  — " + detail : ""}`); };

// iOS behaviour: the LAYOUT viewport stays put when the keyboard opens; only visualViewport shrinks.
const VV_STUB = () => {
  const target = new EventTarget();
  const vv = Object.assign(target, { width: innerWidth, height: innerHeight, offsetTop: 0, offsetLeft: 0, scale: 1, pageTop: 0, pageLeft: 0 });
  Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
  window.__setKeyboard = (px) => { vv.height = innerHeight - px; vv.dispatchEvent(new Event("resize")); vv.dispatchEvent(new Event("scroll")); };
};

async function open(browser, url, { desktop = false } = {}) {
  const ctx = await browser.newContext(desktop
    ? { viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true }
    : { ...devices["iPhone 15"], ignoreHTTPSErrors: true });
  await ctx.addInitScript(VV_STUB);
  const page = await ctx.newPage();
  page.setDefaultTimeout(3000);
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="food-actions-row"], [data-testid="food-visit-card"], [data-testid="food-bottom-sheet"]', { timeout: 15000 });
  await assertMeasurable(page, "verify-food-visit-phone");
  await page.waitForTimeout(600);
  return { ctx, page, errs };
}
const tap = (page, sel) => page.locator(sel).first().tap();
const rect = (page, sel) => page.locator(sel).first().evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom }; });

const section = async (fn) => { try { await fn(); } catch (e) { check("section aborted", false, String(e.message).split("\n")[0]); } };
const browser = await webkit.launch();
try {
  // ── 1. FIRST VISIT captures dishes + ratings; no "What I had" ─────────────────────────────────
  await section(async () => {
    const { ctx, page, errs } = await open(browser, FIX);
    await tap(page, '[data-testid="food-log-visit-btn"]');
    await page.waitForTimeout(400);
    const labels = await page.locator("form label").allInnerTexts();
    check("1a no 'What I had' field on a new visit", !labels.some((t) => /what i had/i.test(t)), JSON.stringify(labels.map((t) => t.split("\n")[0])));
    check("1b new visit has a Dishes block with a name field", (await page.locator('[data-testid="visit-dishes"] [data-testid="visit-dish-name"]').count()) >= 1);
    await page.locator('[data-testid="visit-dish-name"]').first().fill("Brisket plate");
    // the dish rating is the slider (2026-10-05: never tap buttons) — set it to 8
    const row = page.locator('[data-testid="visit-dish-row"]').first();
    await row.locator('[data-testid="dish-score-slider"]').fill("8");
    const numeral = await row.locator('[data-testid="dish-score-numeral"]').innerText().catch(() => "");
    check("1c the dish slider set to 8 shows a dish rating of 8", /^8\b/.test(numeral.trim()), JSON.stringify(numeral));
    // second dish
    await tap(page, '[data-testid="visit-dish-add"]').catch(() => {});
    const rows2 = await page.locator('[data-testid="visit-dish-row"]').count();
    check("1d 'add another dish' gives a second dish row", rows2 === 2, `rows=${rows2}`);
    if (rows2 === 2) {
      await page.locator('[data-testid="visit-dish-name"]').nth(1).fill("Queso");
      await page.locator('[data-testid="visit-dish-row"]').nth(1).locator('[data-testid="dish-score-slider"]').fill("6");
    }
    await page.locator('form button[type="submit"]').tap();
    await page.waitForTimeout(500);
    const call = await page.evaluate(() => window.__calls.visits[0]);
    const d = call?.dishes || [];
    check("1e submit carries both dishes with ratings", d.length === 2 && d[0].name === "Brisket plate" && d[0].score === 8 && d[1].name === "Queso" && d[1].score === 6, JSON.stringify(call?.dishes));
    check("1f no what_i_had text is written for a new visit", !call?.what_i_had, JSON.stringify(call?.what_i_had));
    check("1g no page errors", errs.length === 0, errs.join(" | "));
    await ctx.close();
  });

  // ── 2. RATING control is thumb-friendly ───────────────────────────────────────────────────────
  await section(async () => {
    const { ctx, page } = await open(browser, FIX);
    await tap(page, '[data-testid="food-log-visit-btn"]');
    await page.waitForTimeout(400);
    const tapButtons = await page.locator('[data-testid^="score-tap"]').count();
    check("2a no tap-button rating grid anywhere in the form", tapButtons === 0, `tap buttons=${tapButtons}`);
    const dishSliders = await page.locator('[data-testid="visit-dish-row"] input[type="range"]').count();
    check("2b each dish row's rating is one slider", dishSliders === 1, `sliders=${dishSliders}`);
    const rs = await page.locator('form input[type="range"][data-testid="rating-slider"]').evaluateAll((els) => els.map((e) => [e.min, e.max, e.step].join("/")));
    check("2c visit-level Food and Ambiance ratings are two half-step sliders", rs.length === 2 && rs.every((r) => r === "1/10/0.5"), JSON.stringify(rs));
    await ctx.close();
  });

  // ── 3. KEYBOARD must not cover the field or Save ──────────────────────────────────────────────
  await section(async () => {
    const { ctx, page } = await open(browser, FIX);
    await tap(page, '[data-testid="food-log-visit-btn"]');
    await page.waitForTimeout(500);
    const name = page.locator('[data-testid="visit-dish-name"], form input[type="text"]').first();
    await name.tap();
    await page.evaluate(() => window.__setKeyboard(336)); // a typical iPhone keyboard height
    await page.waitForTimeout(700);
    const vvH = await page.evaluate(() => window.visualViewport.height);
    const nr = await name.evaluate((el) => el.getBoundingClientRect().bottom);
    const save = page.locator('form button[type="submit"]');
    const sr = await save.evaluate((el) => el.getBoundingClientRect().bottom);
    const sheet = await rect(page, '[data-testid="food-bottom-sheet"]');
    check("3a focused field is above the keyboard", nr <= vvH, `field bottom ${nr.toFixed(0)} vs visible ${vvH.toFixed(0)}`);
    // B2046224 ×3 (owner: "while typing, the card being edited is fully visible"): Save TUCKS while a
    // field has focus — it flows at the end of the form instead of floating over the card — and is back
    // on screen the moment the keyboard closes (3e below).
    const savePos = await save.evaluate((el) => getComputedStyle(el.parentElement).position);
    check("3b while typing, the Save bar does not float over the form", savePos === "static", `Save bar position: ${savePos} (bottom ${sr.toFixed(0)} vs visible ${vvH.toFixed(0)})`);
    check("3c the sheet itself rides above the keyboard", sheet.bottom <= vvH + 1, `sheet bottom ${sheet.bottom.toFixed(0)} vs visible ${vvH.toFixed(0)}`);
    await page.evaluate(() => { document.activeElement?.blur?.(); window.__setKeyboard(0); }); // the keyboard's ✓
    await page.waitForTimeout(500);
    const saveBack = await save.evaluate((el) => { const r = el.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { pos: getComputedStyle(el.parentElement).position, onScreen: r.bottom <= innerHeight && r.top >= 0, hit: t === el || el.contains(t) }; });
    check("3e keyboard closed → Save is pinned and on screen again", saveBack.pos === "sticky" && saveBack.onScreen && saveBack.hit, JSON.stringify(saveBack));
    const sheet2 = await rect(page, '[data-testid="food-bottom-sheet"]');
    const ih = await page.evaluate(() => innerHeight);
    check("3d keyboard dismissed -> sheet returns to the screen bottom", Math.abs(sheet2.bottom - ih) <= 1, `sheet bottom ${sheet2.bottom.toFixed(0)} vs ${ih}`);
    await ctx.close();
  });

  // ── 4. AUTOFILL: nothing here may look like a contact field ───────────────────────────────────
  await section(async () => {
    const { ctx, page } = await open(browser, `${FIX}?newpin=1`);
    // the pin name opens focused; "Log a visit" is tucked while typing (B2046224 ×3) — close the keyboard first
    await page.evaluate(() => document.activeElement?.blur?.()); await page.waitForTimeout(300);
    await tap(page, '[data-testid="food-log-visit-btn"]');
    await page.waitForTimeout(400);
    const fields = await page.locator("form input:not([type=range]):not([type=date]):not([type=number]), form textarea, [data-testid='pin-label-input'], form input[type=number]").evaluateAll((els) =>
      els.map((e) => ({ ph: e.placeholder, ac: e.getAttribute("autocomplete"), nm: e.getAttribute("name"), id: e.id })));
    const contact = /(^|[^a-z])(name|first|last|full|email|phone|tel|address|street|city|zip|postal|org|company)([^a-z]|$)/i;
    const bad = fields.filter((f) => !/^x-food-/.test(f.ac || "") || contact.test(f.nm || "") || contact.test(f.id || ""));
    check("4a every text field opts out of AutoFill (non-standard x-food-* token — iOS overrides off) with a non-contact name", fields.length >= 3 && bad.length === 0, bad.length ? JSON.stringify(bad) : `${fields.length} fields clean`);
    await ctx.close();
  });

  // ── 5. ADJACENT: editing an existing visit; desktop unaffected ────────────────────────────────
  await section(async () => {
    const { ctx, page, errs } = await open(browser, `${FIX}?visits=1`);
    const hadShown = await page.locator('[data-testid="food-visit-card"]').innerText();
    check("5a old visit still shows its saved 'What I had' text", /Brisket plate, queso/.test(hadShown), JSON.stringify(hadShown.slice(0, 80)));
    await page.locator('[data-testid="food-visit-card"]').tap();
    await page.waitForTimeout(400);
    const editText = await page.locator('[data-testid="food-visit-card-editing"]').innerText();
    check("5b editing that visit keeps the saved text readable (not dropped)", /Brisket plate, queso/.test(editText), "");
    check("5c editing does not offer a second, editable 'What I had' box", (await page.locator('[data-testid="food-visit-card-editing"] form label', { hasText: /what i had/i }).count()) === 0);
    await page.locator('[data-testid="food-visit-card-editing"] form button[type="submit"]').tap();
    await page.waitForTimeout(400);
    const edit = await page.evaluate(() => window.__calls.edits[0]);
    check("5d saving the edit does not overwrite or null the old text", edit && !("what_i_had" in edit.fields), JSON.stringify(edit?.fields));
    check("5e no page errors editing", errs.length === 0, errs.join(" | "));
    await ctx.close();
  });
  await section(async () => {
    const { ctx, page } = await open(browser, FIX, { desktop: true });
    await page.locator('[data-testid="food-log-visit-btn"]').click();
    await page.waitForTimeout(300);
    const sheet = await page.locator('[data-testid="food-bottom-sheet"]').count();
    check("5f desktop still uses the side panel (no bottom sheet)", sheet === 0);
    const sliders = await page.locator('form input[type="range"]').count();
    check("5g desktop keeps the slider ratings", sliders >= 2, `range inputs=${sliders}`);
    check("5h desktop has the Dishes block and no 'What I had'", (await page.locator('[data-testid="visit-dishes"]').count()) === 1 && (await page.locator("form label", { hasText: /what i had/i }).count()) === 0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    check("5i desktop has no horizontal overflow", !overflow);
    await ctx.close();
  });
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed (WebKit, iPhone 15 descriptor — EMULATED, see header)`);
process.exit(failed.length ? 1 : 0);
