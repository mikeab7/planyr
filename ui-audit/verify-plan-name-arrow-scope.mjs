#!/usr/bin/env node
/* verify-plan-name-arrow-scope — B1012832 (recurrence of B464048, ×4): arrow keys typed into the
 * plan-switcher's PLAN NAME field must move the CARET, never a selected element on the canvas.
 *
 * The owner's report, corrected mid-triage: caret movement in the field is what's missing, not that
 * both surfaces act — typed CHARACTERS reach the box fine, but Left/Right/Home/End left the caret
 * where it was while the canvas visibly nudged the selected building.
 *
 * AUDIT-FIRST: exhaustive static + runtime instrumentation of the real handler found the plan-name
 * input's own `onKeyDown` never stops propagation, so the keydown reaches the planner's `window`
 * listener untouched and correctly resolves FIELD scope off `document.activeElement` — a real DOM
 * fact, unaffected by the input living inside an AnchoredMenu portal. This harness re-proves that
 * live, on every arrow-family key named in the report (Left/Right/Home/End/Shift+Arrow), by reading
 * BOTH halves independently: the input's own `selectionStart` (did the caret move) and the selected
 * building's rendered box (did it NOT move).
 *
 * It also exercises the class the report predicted in a DIFFERENT AnchoredMenu-hosted field: the
 * project switcher's "Search projects…" box, which carries `autoFocus`. That one WAS broken —
 * `AnchoredMenu.jsx` hid its unplaced panel with `visibility:hidden`, which is unfocusable per spec,
 * so React's one-shot commit-time `.focus()` silently landed on nothing and left real focus on the
 * trigger button; a `<button>` carries no field latch, so an Arrow key reached the canvas as CHROME
 * scope with `fieldEdit:false`. Fixed by hiding with `opacity` instead (see AnchoredMenu.jsx).
 *
 * Finally: closing the popover and clicking the canvas must still let arrow keys nudge the selected
 * element normally — the guard must not break the real shortcut (the report's own VERIFY step).
 *
 *   npm run verify:plannamearrow   (node ui-audit/verify-plan-name-arrow-scope.mjs [--url …])
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { readFixture, buildFixtureState } from "./lib/fixtureSeeding.mjs";

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg("--url", "http://localhost:4319/");
const CACHE = "ui-audit/.cache/plan-name-arrow-scope";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome";
const SITE_ID = "planarrow1";

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };

const boxOf = (page, key) => page.evaluate((k) => {
  const n = document.querySelector(`[data-feature="${k}"]`);
  if (!n) return null;
  const r = n.getBoundingClientRect();
  return { x: r.x, y: r.y };
}, key);

const clickCenter = async (page, key) => {
  const box = await page.evaluate((k) => {
    const n = document.querySelector(`[data-feature="${k}"]`);
    if (!n) return null;
    const r = n.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, key);
  if (!box) throw new Error(`no rendered node for ${key}`);
  await page.mouse.click(box.x, box.y);
};

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
try {
  mkdirSync(CACHE, { recursive: true });
  const fixture = readFixture("woods");
  const built = await buildFixtureState(browser, { base: BASE, fixture, siteId: SITE_ID, cacheDir: CACHE });
  const BLD = (fixture.els || []).find((e) => e.type === "building" && !e.dogEar && !e.attachedTo);
  const KEY = `el:${BLD.id}`;

  const newPage = async () => {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, ignoreHTTPSErrors: true, storageState: built.state });
    await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
    await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
    const page = await ctx.newPage();
    await assertMeasurable(page, "verify-plan-name-arrow-scope");
    await page.goto(BASE, { waitUntil: "load" });
    await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 30000 });
    await pacedWait(page, 3000);
    return { ctx, page };
  };

  /* ── ARM 1 — the literal reported field: PLAN NAME, every arrow-family key ────────────────── */
  {
    const { ctx, page } = await newPage();
    await clickCenter(page, KEY);
    await pacedWait(page, 400);
    const selected = await page.evaluate(() => !!document.querySelector('[data-testid="properties-rail-btn"], [data-rail-tab="properties"]'));
    if (!selected) check("ARM 1 SETUP — building selected", false, "properties tab never appeared");

    await page.locator('[data-testid="plan-crumb"]').click();
    await pacedWait(page, 400);
    const nameInput = page.locator('[data-testid="plan-name-input"]');
    await nameInput.click();
    await pacedWait(page, 300);
    await page.keyboard.press("End");
    await pacedWait(page, 150);
    const valueLen = await page.evaluate(() => document.activeElement.value.length);

    // Absolute expected caret positions, not relative to the prior arm — avoids compounding a
    // wrong assumption about where the caret already sits into a false pass.
    const ARROW_ARMS = [
      ["ArrowLeft", valueLen - 1],
      ["ArrowRight", valueLen],
      ["Home", 0],
      ["End", valueLen],
    ];
    for (const [key, wantCaret] of ARROW_ARMS) {
      const before = await page.evaluate(() => document.activeElement.selectionStart);
      const posBefore = await boxOf(page, KEY);
      await page.keyboard.press(key);
      await pacedWait(page, 200);
      const after = await page.evaluate(() => document.activeElement && document.activeElement.selectionStart);
      const posAfter = await boxOf(page, KEY);
      const elementStill = posBefore && posAfter && posBefore.x === posAfter.x && posBefore.y === posAfter.y;
      check(`PLAN NAME · ${key} moves the caret (not the element)`,
        after === wantCaret && elementStill,
        `caret ${before}→${after} (want ${wantCaret}) · element ${elementStill ? "unchanged" : "MOVED"}`);
    }

    // Shift+ArrowLeft — select-to, must extend the selection without nudging the element.
    await page.keyboard.press("End");
    await pacedWait(page, 150);
    const posBeforeShift = await boxOf(page, KEY);
    await page.keyboard.down("Shift");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.up("Shift");
    await pacedWait(page, 200);
    const shiftSel = await page.evaluate(() => { const a = document.activeElement; return { start: a.selectionStart, end: a.selectionEnd }; });
    const posAfterShift = await boxOf(page, KEY);
    check("PLAN NAME · Shift+ArrowLeft extends the text selection (not the element)",
      shiftSel.start !== shiftSel.end && posBeforeShift.x === posAfterShift.x && posBeforeShift.y === posAfterShift.y,
      `selection ${JSON.stringify(shiftSel)}`);

    await ctx.close();
  }

  /* ── ARM 2 — the OTHER portalled input the report asked to be exercised: the project switcher's
   *    autoFocus'd "Search projects…" box. Confirms the AnchoredMenu opacity fix: real DOM focus
   *    must land there (not the trigger button), and arrows there must not nudge either. ──────── */
  {
    const { ctx, page } = await newPage();
    await clickCenter(page, KEY);
    await pacedWait(page, 400);
    const posBefore = await boxOf(page, KEY);

    const crumbs = await page.locator('[data-testid="project-crumb"]').all();
    let opened = false;
    for (const c of crumbs) { if (await c.isVisible()) { await c.click(); opened = true; break; } }
    if (!opened) check("ARM 2 SETUP — a visible project-crumb button exists", false);
    await pacedWait(page, 500);

    const active = await page.evaluate(() => ({ tag: document.activeElement?.tagName, placeholder: document.activeElement?.placeholder }));
    check("PROJECT SEARCH · autoFocus lands real DOM focus in the field (AnchoredMenu opacity fix)",
      active.tag === "INPUT" && active.placeholder === "Search projects…", JSON.stringify(active));

    await page.keyboard.press("ArrowLeft");
    await pacedWait(page, 300);
    const posAfter = await boxOf(page, KEY);
    check("PROJECT SEARCH · ArrowLeft does not nudge the selected element",
      posBefore && posAfter && posBefore.x === posAfter.x && posBefore.y === posAfter.y,
      `${JSON.stringify(posBefore)} → ${JSON.stringify(posAfter)}`);

    await ctx.close();
  }

  /* ── CONTROL — the guard must not break the real shortcut once the popover is closed and the
   *    canvas genuinely owns the keyboard again. ───────────────────────────────────────────────── */
  {
    const { ctx, page } = await newPage();
    await clickCenter(page, KEY);
    await pacedWait(page, 400);
    const posBefore = await boxOf(page, KEY);
    await page.keyboard.press("ArrowRight");
    await pacedWait(page, 300);
    const posAfter = await boxOf(page, KEY);
    check("⛔ CONTROL · ArrowRight still nudges the selection from the canvas itself",
      posBefore && posAfter && (posBefore.x !== posAfter.x || posBefore.y !== posAfter.y),
      `${JSON.stringify(posBefore)} → ${JSON.stringify(posAfter)}`);
    await ctx.close();
  }

  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} arms behave.`);
  process.exitCode = bad.length ? 1 : 0;
} finally {
  await browser.close();
}
