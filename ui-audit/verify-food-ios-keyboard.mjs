#!/usr/bin/env node
/* verify-food-ios-keyboard — B2046224 recurrence (×2): every Food text field on a phone must stay
 * visible above the keyboard, and none may look like a contact field to iOS AutoFill.
 *
 * ⛔ WHY THIS EXISTS WHEN verify-food-phone + verify-food-visit-phone ALREADY PASSED (136/136):
 * both stubbed `window.visualViewport` but left `window.innerHeight` at the full LAYOUT height.
 * Real iOS Safari does not do that. WebKit's `LocalDOMWindow::innerHeight()` returns
 * `unobscuredContentRectIncludingScrollbars().height()` — the VISIBLE (unobscured) rect, the same
 * rect `visualViewport` is built from — so with the keyboard up innerHeight shrinks WITH the visual
 * viewport, while position:fixed elements stay attached to the LAYOUT viewport (the classic "fixed
 * footer hides under the iOS keyboard"). The shipped `keyboardInset = innerHeight − vv.height −
 * vv.offsetTop` therefore read ≈ 0 on a real iPhone, and the sheet never lifted — while every stub
 * that kept innerHeight at full height saw a perfect lift. Those harnesses tested their own model.
 * ⚠ CORRECTED (B2046224 ×3): "innerHeight shrinks WITH the visual viewport" is not always true either —
 * production telemetry from the owner's iPhone (iOS 18.7, 21:12 UTC) shows innerHeight standing >120
 * above visualViewport.height with the keyboard up. innerHeight moves BOTH ways; the sheet no longer
 * reads it at all (it pins to the visual viewport's own box). The full-app, picture-taking harness
 * that models both readings is verify-food-ios-screens.mjs; this one stays as the fixture-page check.
 *
 * THE MODEL HERE (stated, because a harness that cannot say what it models cannot be trusted):
 *  · the LAYOUT viewport (the fixed-position containing block) is the Playwright viewport and never
 *    changes — exactly like iOS;
 *  · focusing a text-entry control OPENS the keyboard (it is not a separate step the harness calls,
 *    so an autoFocus field is exercised the way a tap exercises it); blurring closes it;
 *  · `visualViewport.height` = layout height − keyboard; `window.innerHeight` returns that SAME
 *    number (mode "ios"), or stays at the layout height (mode "legacy" — the old stub's
 *    assumption, kept so the fix is proven under both readings);
 *  · iOS may PAN the visual viewport up into the keyboard-covered strip to reveal the field
 *    (`offsetTop` > 0) — mode "ios+pan" models that; the visible band is
 *    [offsetTop, offsetTop + vv.height] in layout coordinates.
 * A field passes only if its box lies inside that band AND `elementFromPoint` at its centre answers
 * the field itself (so a sticky header or sticky Save bar painted over it is a FAIL), before and
 * after typing long text.
 *
 * KNOWN-ANSWER ARM (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6): before any field is scored, the harness
 * proves its own visibility test can say NO — with the keyboard forced open and the sheet frozen at
 * the screen bottom, the reported field MUST read as hidden. If it does not, the run is VOID.
 *
 * Still EMULATED: no real keyboard, no real AutoFill bar. The on-device half is the V# in
 * VERIFICATION.md. AutoFill is scored on the attributes iOS's heuristics read: the autocomplete
 * token, name, id, placeholder, aria-label and the label text around the field.
 *
 * Drives ui-audit/fixtures/food-panel.html (the REAL VisitPanel) on a local vite dev server.
 * Usage: npx vite --port 5199 & ; node ui-audit/verify-food-ios-keyboard.mjs [baseUrl]  (exit 1 on FAIL)
 */
import { webkit, devices } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.argv[2] || "http://localhost:5199";
const FIX = `${BASE}/ui-audit/fixtures/food-panel.html`;
const KEYBOARD_PX = 380; // iPhone keyboard + the QuickType / AutoFill bar above it
const results = [];
const check = (id, ok, detail = "") => { results.push({ id, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${id}${detail ? "  — " + detail : ""}`); };

const IOS_MODEL = ({ mode, kbPx }) => {
  const ihDesc = Object.getOwnPropertyDescriptor(window, "innerHeight") || Object.getOwnPropertyDescriptor(Window.prototype, "innerHeight");
  const layoutH = () => ihDesc.get.call(window);
  const vv = new EventTarget();
  let kb = 0, pan = 0;
  Object.defineProperties(vv, {
    width: { get: () => innerWidth }, height: { get: () => layoutH() - kb },
    offsetTop: { get: () => pan }, offsetLeft: { get: () => 0 }, scale: { get: () => 1 },
    pageTop: { get: () => pan + scrollY }, pageLeft: { get: () => 0 },
  });
  Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
  if (mode !== "legacy") Object.defineProperty(window, "innerHeight", { get: () => layoutH() - kb, configurable: true });
  const fire = () => { vv.dispatchEvent(new Event("resize")); vv.dispatchEvent(new Event("scroll")); };
  const isTextEntry = (el) => el && ((el.tagName === "INPUT" && !/^(range|button|submit|checkbox|radio|reset|file|color)$/i.test(el.type)) || el.tagName === "TEXTAREA");
  window.__kb = { band: () => ({ top: pan, bottom: pan + layoutH() - kb }), get open() { return kb > 0; }, freeze: false };
  window.__kb.set = (px, el) => {
    kb = px;
    pan = 0;
    if (px && mode === "ios+pan" && el) { // iOS slides the view up just enough to show the field, at most the keyboard height
      const r = el.getBoundingClientRect();
      pan = Math.max(0, Math.min(kb, Math.round(r.bottom + 12 - (layoutH() - kb))));
    }
    fire();
  };
  document.addEventListener("focusin", (e) => { if (isTextEntry(e.target)) setTimeout(() => window.__kb.set(kbPx, e.target), 60); });
  document.addEventListener("focusout", () => setTimeout(() => { if (!isTextEntry(document.activeElement)) window.__kb.set(0); }, 60));
};

async function open(browser, url, mode) {
  const ctx = await browser.newContext({ ...devices["iPhone 15"], ignoreHTTPSErrors: true });
  await ctx.addInitScript(IOS_MODEL, { mode, kbPx: KEYBOARD_PX });
  const page = await ctx.newPage();
  page.setDefaultTimeout(4000);
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="food-bottom-sheet"]', { timeout: 15000 });
  await assertMeasurable(page, `verify-food-ios-keyboard:${mode}`);
  await page.waitForTimeout(700);
  return { ctx, page, errs };
}

// Is the focused field inside the visible band and not painted over? Reads in layout coordinates.
const visibility = (loc) => loc.evaluate((el) => {
  const band = window.__kb.band();
  const r = el.getBoundingClientRect();
  const cx = r.left + Math.min(r.width / 2, 40), cy = (Math.max(r.top, band.top) + Math.min(r.bottom, band.bottom)) / 2;
  const hit = document.elementFromPoint(cx, cy);
  const inBand = r.top >= band.top - 1 && r.bottom <= band.bottom + 1;
  const onTop = !!hit && (hit === el || el.contains(hit));
  const sheet = document.querySelector('[data-testid="food-bottom-sheet"]')?.getBoundingClientRect();
  return { ok: inBand && onTop, inBand, onTop, kbOpen: window.__kb.open, focused: document.activeElement === el,
    detail: `field ${Math.round(r.top)}–${Math.round(r.bottom)} vs visible ${Math.round(band.top)}–${Math.round(band.bottom)}; sheet bottom ${sheet ? Math.round(sheet.bottom) : "?"}; on top=${onTop} (${hit?.tagName}${hit?.dataset?.testid ? "#" + hit.dataset.testid : ""})` };
});

async function scoreField(page, label, loc, { tapIt = true, longText = "Smoked brisket tacos with pickled onion, cotija and the extra-hot salsa verde", multiline = false } = {}) {
  if (tapIt) await loc.tap(); else await loc.focus();
  await page.waitForTimeout(800);
  const a = await visibility(loc);
  check(`${label} — keyboard up, field visible`, a.kbOpen && a.focused && a.ok, a.kbOpen ? a.detail : "keyboard never opened (field not focused?)");
  if (multiline) { for (let i = 0; i < 6; i++) await page.keyboard.type(`line ${i + 1} ${longText.slice(0, 30)}\n`); }
  else await page.keyboard.type(longText);
  await page.waitForTimeout(400);
  const b = await visibility(loc);
  check(`${label} — after typing long text, still visible`, b.ok, b.detail);
}

const blur = (page) => page.evaluate(() => document.activeElement?.blur?.()).then(() => page.waitForTimeout(500));
const section = async (name, fn) => { try { await fn(); } catch (e) { check(`${name}: section aborted`, false, String(e.message).split("\n")[0]); } };

const browser = await webkit.launch();
try {
  // ── 0. KNOWN-ANSWER ARM: the instrument must be able to say "hidden" ───────────────────────────
  await section("0", async () => {
    const { ctx, page } = await open(browser, `${FIX}?buffalo=1`, "ios");
    const sheet = page.locator('[data-testid="food-bottom-sheet"]');
    await page.locator('[data-testid="food-add-dish-btn"]').tap();
    await page.waitForTimeout(300);
    // Freeze the sheet against the screen bottom (what a sheet that ignores the keyboard does), open it.
    // (B2046224 ×3: the sheet now sits inside a fixed ROOT that follows the visual viewport — freeze
    // the root to the layout viewport too, or the planted defect is silently corrected.)
    await sheet.evaluate((el) => {
      const root = el.closest("[data-food-sheet-root]");
      if (root) { root.style.setProperty("top", "0px", "important"); root.style.setProperty("height", "auto", "important"); root.style.setProperty("bottom", "0px", "important"); }
      el.style.setProperty("bottom", "0px", "important"); el.style.setProperty("height", "45vh", "important"); el.style.setProperty("transition", "none", "important");
    });
    await page.evaluate(() => window.__kb.set(380));
    await page.waitForTimeout(200);
    const field = page.locator('[data-testid="dish-name-input"]');
    await field.evaluate((el) => el.closest('[data-testid="food-bottom-sheet"]').lastElementChild.scrollTo(0, 1e6));
    await page.waitForTimeout(100);
    const v = await visibility(page.locator('[data-testid="dish-note-input"]'));
    check("0 KNOWN ANSWER: a field in a sheet pinned under the keyboard reads as HIDDEN", !v.ok, v.detail);
    await ctx.close();
  });
  const instrumentOk = results.every((r) => r.ok);
  if (!instrumentOk) console.log("VOID — the visibility probe cannot detect a hidden field; no score below is evidence.");

  for (const mode of ["ios+pan", "ios", "legacy"]) {
    // ── 1. THE REPORTED FIELD: The Buffalo Grill → "+ Add a dish" → dish name (autoFocus) ────────
    await section(`${mode} 1`, async () => {
      const { ctx, page, errs } = await open(browser, `${FIX}?buffalo=1`, mode);
      check(`[${mode}] 1 sheet opens at half with the Dishes · Sort row`, (await page.locator('[data-testid="food-dishes-sort"]').count()) === 1
        && (await page.locator('[data-testid="food-bottom-sheet"]').getAttribute("data-sheet-snap")) === "half");
      await page.locator('[data-testid="food-add-dish-btn"]').tap();
      await page.waitForTimeout(900); // autoFocus → keyboard
      const name = page.locator('[data-testid="dish-name-input"]');
      const a = await visibility(name);
      check(`[${mode}] 1a REPORTED: Add a dish → dish name focused, keyboard up, field visible`, a.kbOpen && a.focused && a.ok, a.detail);
      const lift = await page.evaluate(() => { const s = document.querySelector('[data-testid="food-bottom-sheet"]').getBoundingClientRect(); const b = window.__kb.band(); return { ok: s.bottom <= b.bottom + 1 && s.top <= b.top + 80, d: `sheet ${Math.round(s.top)}–${Math.round(s.bottom)} vs visible ${Math.round(b.top)}–${Math.round(b.bottom)}` }; });
      check(`[${mode}] 1b the sheet lifts onto the keyboard and fills the space above it`, lift.ok, lift.d);
      await page.keyboard.type("Chicken fried steak with cream gravy and the jalapeño mashed potatoes");
      await page.waitForTimeout(400);
      const b = await visibility(name);
      check(`[${mode}] 1c dish name: after typing long text, still visible`, b.ok, b.detail);
      await scoreField(page, `[${mode}] 1d dish price`, page.locator('[data-testid="dish-price-input"]'), { longText: "18.50" });
      await scoreField(page, `[${mode}] 1e dish note`, page.locator('[data-testid="dish-note-input"]'));
      check(`[${mode}] 1f no page errors`, errs.length === 0, errs.join(" | "));
      await ctx.close();
    });

    // ── 2. LOG A VISIT on the same place: every field of the new-visit form ──────────────────────
    await section(`${mode} 2`, async () => {
      const { ctx, page } = await open(browser, `${FIX}?buffalo=1`, mode);
      await page.locator('[data-testid="food-log-visit-btn"]').tap();
      await page.waitForTimeout(500);
      await scoreField(page, `[${mode}] 2a visit: dish`, page.locator('[data-testid="visit-dish-name"]').first());
      await blur(page);
      await scoreField(page, `[${mode}] 2b visit: what was good`, page.locator('[data-testid="visit-highlights-input"]'));
      await blur(page);
      await scoreField(page, `[${mode}] 2c visit: cost`, page.locator('[data-testid="visit-cost-input"]'), { longText: "64.20" });
      await blur(page);
      await scoreField(page, `[${mode}] 2d visit: notes (multi-line)`, page.locator('[data-testid="visit-notes-input"]'), { multiline: true });
      await ctx.close();
    });

    // ── 3. EDIT a past visit + add a dish under it ───────────────────────────────────────────────
    await section(`${mode} 3`, async () => {
      const { ctx, page } = await open(browser, `${FIX}?buffalo=1`, mode);
      await page.locator('[data-testid="food-visit-card"]').tap();
      await page.waitForTimeout(500);
      const ed = page.locator('[data-testid="food-visit-card-editing"]');
      await scoreField(page, `[${mode}] 3a edit visit: what was good`, ed.locator('[data-testid="visit-highlights-input"]'));
      await blur(page);
      await scoreField(page, `[${mode}] 3b edit visit: notes`, ed.locator('[data-testid="visit-notes-input"]'), { multiline: true });
      await ctx.close();
    });

    // ── 4. NEW PIN name (autoFocus in the header) ────────────────────────────────────────────────
    await section(`${mode} 4`, async () => {
      const { ctx, page } = await open(browser, `${FIX}?newpin=1`, mode);
      await page.waitForTimeout(300);
      const pin = page.locator('[data-testid="pin-label-input"]');
      await scoreField(page, `[${mode}] 4a new pin: place label`, pin, { tapIt: true, longText: "Taco truck behind the Shell on Westheimer" });
      await ctx.close();
    });

    // ── 5. PEEK / FULL starting heights for the reported field ───────────────────────────────────
    for (const start of ["peek", "full"]) {
      await section(`${mode} 5 ${start}`, async () => {
        const { ctx, page } = await open(browser, `${FIX}?buffalo=1`, mode);
        const handle = page.locator('[data-testid="food-sheet-drag-handle"]');
        const hb = await handle.boundingBox();
        const x = hb.x + hb.width / 2, y = hb.y + hb.height / 2;
        await page.mouse.move(x, y); await page.mouse.down();
        await page.mouse.move(x, start === "full" ? 40 : y + 150, { steps: 8 }); await page.mouse.up();
        await page.waitForTimeout(500);
        const snap = await page.locator('[data-testid="food-bottom-sheet"]').getAttribute("data-sheet-snap");
        check(`[${mode}] 5 ${start}: sheet settled at ${start}`, snap === start, `snap=${snap}`);
        // At peek the button is below the fold; scroll it in the sheet the way a finger would.
        await page.locator('[data-testid="food-add-dish-btn"]').evaluate((el) => el.click());
        await page.waitForTimeout(900);
        const a = await visibility(page.locator('[data-testid="dish-name-input"]'));
        check(`[${mode}] 5 ${start}: dish name focused from ${start}, visible above the keyboard`, a.kbOpen && a.focused && a.ok, a.detail);
        await ctx.close();
      });
    }

    // ── 6. keyboard closes → sheet returns to the bottom of the screen ──────────────────────────
    await section(`${mode} 6`, async () => {
      const { ctx, page } = await open(browser, `${FIX}?buffalo=1`, mode);
      await page.locator('[data-testid="food-add-dish-btn"]').tap();
      await page.waitForTimeout(800);
      await blur(page);
      const s = await page.locator('[data-testid="food-bottom-sheet"]').evaluate((el) => el.getBoundingClientRect().bottom);
      const lh = await page.evaluate(() => document.documentElement.clientHeight);
      check(`[${mode}] 6 keyboard dismissed → sheet back on the screen bottom`, Math.abs(s - lh) <= 1, `sheet bottom ${Math.round(s)} vs ${lh}`);
      await ctx.close();
    });
  }

  // ── 7. AUTOFILL: no field may look like a contact field ────────────────────────────────────────
  await section("7", async () => {
    const CONTACT = /(^|[^a-z])(name|title|first|last|full|given|family|nick|e-?mail|phone|tel|mobile|address|street|city|state|zip|postal|org|organi[sz]ation|company|job|contact|country|birthday|bday)([^a-z]|$)/i;
    const STD_TOKENS = /^(on|name|honorific-prefix|given-name|additional-name|family-name|honorific-suffix|nickname|organization-title|username|organization|street-address|address-line\d|address-level\d|country|country-name|postal-code|email|tel(-.*)?|bday.*|sex|url|photo)$/i;
    const audit = async (url, open1) => {
      const { ctx, page } = await open(browser, url, "ios");
      await open1(page);
      await page.waitForTimeout(400);
      const fields = await page.locator('[data-testid="food-bottom-sheet"] input:not([type=range]), [data-testid="food-bottom-sheet"] textarea').evaluateAll((els) => els.map((e) => ({
        tid: e.dataset.testid || e.getAttribute("aria-label") || e.placeholder, ac: e.getAttribute("autocomplete") || "", nm: e.getAttribute("name") || "", id: e.id || "",
        ph: e.placeholder || "", al: e.getAttribute("aria-label") || "", lbl: (e.closest("label")?.innerText || "").replace(/\s+/g, " ").trim(),
      })));
      await ctx.close();
      return fields;
    };
    const all = [
      ...(await audit(`${FIX}?buffalo=1`, (p) => p.locator('[data-testid="food-add-dish-btn"]').tap())),
      ...(await audit(`${FIX}?buffalo=1`, (p) => p.locator('[data-testid="food-log-visit-btn"]').tap())),
      ...(await audit(`${FIX}?buffalo=1`, (p) => p.locator('[data-testid="food-visit-card"]').tap())),
      ...(await audit(`${FIX}?newpin=1`, async () => {})),
    ];
    check("7 fields found to audit", all.length >= 10, `${all.length}`);
    for (const f of all) {
      const words = [f.nm, f.id, f.ph, f.al, f.lbl].filter((w) => CONTACT.test(w));
      const tokenBad = !f.ac || f.ac === "off" || STD_TOKENS.test(f.ac);
      check(`7 AutoFill: ${f.tid}`, !words.length && !tokenBad, words.length ? `contact-looking words: ${JSON.stringify(words)}` : tokenBad ? `autocomplete="${f.ac}" (iOS ignores "off" / a standard token invites fill)` : `autocomplete="${f.ac}" name="${f.nm}"`);
    }
  });
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
const voided = !results.find((r) => r.id.startsWith("0 KNOWN"))?.ok;
console.log(`\n${results.length - failed.length}/${results.length} passed (WebKit, iPhone 15 descriptor, iOS keyboard MODEL — see header)${voided ? " — VOID: known-answer arm failed" : ""}`);
process.exit(failed.length || voided ? 1 : 0);
