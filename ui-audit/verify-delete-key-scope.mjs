#!/usr/bin/env node
/* verify-delete-key-scope — DELETE, ON A SELECTED OBJECT, FROM EVERY STATE THE INSPECTOR CAN LEAVE YOU IN.
 *
 * The owner, verbatim: "I was pressing delete on it, and it was not deleting." The measurement was
 * demonstrably selected — its inspector was open (MEASUREMENT · AREA, 98,501 sf) and its handles
 * were on the canvas — so "nothing is selected" cannot be the explanation.
 *
 * The hypothesis under test is that B464048's keyboard scope (shipped the same day) is refusing the
 * key: `focusScope` + `keyScopeVerdict` refuse a MUTATING shortcut while the keyboard latch says
 * FIELD, and the latch is set by a press on any `[data-field-group]` row — which is what an inspector
 * value row is. Having the inspector open is not the trigger; having TOUCHED it is.
 *
 * ⛔ THE CONTROL IS THE POINT. Narrowing a guard that exists to stop a Backspace destroying the
 * owner's building is only safe if the original defect is re-proven dead in the same run, so every
 * arm that expects a delete is paired with the arm that must NEVER delete.
 *
 * SYNTHETIC-KEYS-DONT-EDIT: every keystroke here is a real one (`page.keyboard.press`), and every
 * outcome is re-read until it settles rather than sampled once.
 *
 *   npm run verify:deletescope        (node ui-audit/verify-delete-key-scope.mjs [--url …])
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { readFixture, buildFixtureState } from "./lib/fixtureSeeding.mjs";

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg("--url", "http://localhost:4319/");
const CACHE = "ui-audit/.cache/delete-after-panel";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome";
const SITE_ID = "delsite1";

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };

const featureKeys = (page) => page.evaluate(() =>
  [...new Set([...document.querySelectorAll("[data-feature]")].map((n) => n.getAttribute("data-feature")))]);

const present = async (page, key) => (await featureKeys(page)).includes(key);

/** Re-read until the feature is genuinely gone, or the budget runs out. */
async function goneWithin(page, key, ms = 2500) {
  const t0 = Date.now();
  for (;;) {
    if (!(await present(page, key))) return true;
    if (Date.now() - t0 > ms) return false;
    await pacedWait(page, 120);
  }
}

/* The planner's one toast pill carries no testid, so the message is read by its WORDS — the three
 * scope-guard hints and the delete plan's own refusal copy. Reading the words is what the check is
 * about anyway: LOUD-FAILURE asks whether the user was TOLD, not whether a node exists. */
const warnText = (page) => page.evaluate(() => {
  const want = ["Click the plan", "belongs to the slider", "Nothing is selected", "keyboard is still on the panel",
    "went to the box", "already gone", "locked"];
  for (const n of document.querySelectorAll("span, div")) {
    const t = (n.textContent || "").trim();
    if (t.length < 200 && want.some((w) => t.includes(w))) return t.slice(0, 140);
  }
  return "";
});

/** Click the centre of a feature's rendered box on the canvas. */
async function clickFeature(page, key) {
  const box = await page.evaluate((k) => {
    const n = document.querySelector(`[data-feature="${k}"]`);
    if (!n) return null;
    const r = n.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, key);
  if (!box) throw new Error(`no rendered node for ${key}`);
  await page.mouse.click(box.x, box.y);
  await pacedWait(page, 450);
}

const scopeState = (page) => page.evaluate(() => {
  const a = document.activeElement;
  return { tag: a ? a.tagName : null, type: a ? a.type : null,
    inFieldGroup: !!(a && a.closest && a.closest("[data-field-group]")) };
});

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
try {
  mkdirSync(CACHE, { recursive: true });
  const fixture = readFixture("woods");
  const built = await buildFixtureState(browser, { base: BASE, fixture, siteId: SITE_ID, cacheDir: CACHE });

  /* The AREA measurement on the owner's plan — the exact object he could not delete. */
  /* ⛔ INDEX-KEYED: SitePlanner stamps a measurement `data-feature="measure:<i>"` from its array
   * position, unlike every other family, which is id-keyed. */
  const AREA_I = (fixture.measures || []).findIndex((m) => m.mode === "area");
  const KEY = `measure:${AREA_I}`;

  /* Each arm gets a FRESH page: a delete that succeeds removes the subject, so arms cannot share
   * one. `what` runs after the measurement is selected and before the key. */
  const ARMS = [
    { name: "Delete straight after selecting it on the canvas (inspector never opened)", expect: "deleted", needsPanel: false, what: async () => {} },
    { name: "Delete after OPENING the inspector but touching nothing in it", expect: "deleted", what: async () => {} },
    { name: "Delete after clicking a plain BUTTON in the inspector", expect: "deleted", what: async (page) => {
      await page.locator('[data-testid="measure-band-toggle"]').click(); await pacedWait(page, 350); } },
    { name: "Delete after touching the inspector's fill-opacity SLIDER", expect: "deleted", what: async (page) => {
      const s = page.locator('input[type=range]:visible').first();
      if (await s.count()) { await s.click(); await pacedWait(page, 350); } } },
    { name: "Delete after clicking the Line style DROPDOWN in the inspector", expect: "deleted", what: async (page) => {
      const sel = page.locator('select:visible').first();
      if (await sel.count()) { await sel.click(); await page.keyboard.press("Escape"); await pacedWait(page, 350); } } },
    /* ⛔ The inspector's value inputs are `type="text"`, not `type="number"` — the app renders its own
     * ▲▼ steppers (the UA chevrons are bigger than the digits on a pill this size) — and they carry NO
     * `type` attribute at all, so `input[type=text]` matches nothing either. An attribute selector that
     * matches nothing makes the arm silently measure the arm above it, so it is asserted, not assumed. */
    { name: "Delete while a VALUE ROW's text box holds focus (must be refused, and SAID)", expect: "refused-loudly", what: async (page) => {
      const f = page.locator('[data-field-group] input:not([type=range]):visible').first();
      if (await f.count() === 0) throw new Error("no value row on the measurement inspector — the arm would be vacuous");
      await f.click(); await pacedWait(page, 350); } },
    { name: "Delete pressed TWICE while refused — the second press must be explained too", expect: "refused-loudly", twice: true, what: async (page) => {
      const f = page.locator('[data-field-group] input:not([type=range]):visible').first();
      await f.click(); await pacedWait(page, 350); } },
  ];

  for (const arm of ARMS) {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, ignoreHTTPSErrors: true, storageState: built.state });
    await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
    await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
    const page = await ctx.newPage();
    await assertMeasurable(page, "verify-delete-key-scope");
    await page.goto(BASE, { waitUntil: "load" });
    await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 30000 });
    await pacedWait(page, 3000);

    await clickFeature(page, KEY);
    const selected = await page.evaluate(() => !!document.querySelector('[data-testid="measure-selected"]'));
    if (!selected) { check(`${arm.name} — SETUP`, false, "the measurement did not select"); await ctx.close(); continue; }
    /* ⛔ THE INSPECTOR MUST BE ON SCREEN — that is the state the owner reported from. The left dock
     * starts CLOSED, so an arm that "clicks a control in the inspector" without opening it first is
     * clicking nothing and measuring the arm above. Opening it re-selects nothing and is itself a
     * press on CHROME, which is exactly the state under test. */
    if (arm.needsPanel !== false) {
      await page.locator('[data-rail-tab="properties"]').click();
      await pacedWait(page, 700);
    }

    await arm.what(page);
    const focus = await scopeState(page);
    await page.keyboard.press("Delete");
    const gone = await goneWithin(page, KEY);
    /* ⛔ THE SECOND PRESS IS ITS OWN MEASUREMENT. A user whose Delete did nothing presses it again —
     * that repetition IS the signal that the first explanation did not land. The hint is keyed once
     * per EPISODE, so the second press can be silent while the first was not, and a check that reads
     * the toast after ONE press cannot see it. Clear the toast, press again, re-read. */
    let toast = await warnText(page);
    if (arm.twice) {
      await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
      await pacedWait(page, 6500);            // let the toast auto-clear, so the re-read is honest
      const cleared = await warnText(page);
      await page.keyboard.press("Delete");
      await pacedWait(page, 700);
      toast = await warnText(page);
      if (cleared) toast = `⚠ toast never cleared (${cleared})`;
    }

    /* Three expectations, not two. "refused-loudly" is a PASS only when the refusal was also
     * EXPLAINED — a silent refusal is the LOUD-FAILURE violation the owner named, and scoring it as
     * a pass because the object survived is how that violation stays invisible. */
    const ok = arm.expect === "deleted" ? gone : (!gone && !!toast);
    check(arm.name, ok,
      `focus=${focus.tag}${focus.type ? `[${focus.type}]` : ""}${focus.inFieldGroup ? " in-field-group" : ""} · ` +
      `${gone ? "DELETED" : "still there"}${toast ? ` · toast: "${toast}"` : " · NO MESSAGE"}`);
    await ctx.close();
  }

  /* ── THE CONTROLS — the data-loss bug this guard exists for MUST stay dead ───────────────────
   *
   * Narrowing a keyboard guard is only safe if the defect it was built for is re-proven dead in the
   * same run. B464048's measured table is the bar: after Enter / Escape / Tab / a stepper click /
   * a panel click, ONE Backspace deleted the owner's Building 1 and its eight bonded elements. Each
   * of those arms is re-run here, on a real building, through the real Depth (ft) row. */
  {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, ignoreHTTPSErrors: true, storageState: built.state });
    await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
    await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
    const page = await ctx.newPage();
    await assertMeasurable(page, "verify-delete-key-scope");
    await page.goto(BASE, { waitUntil: "load" });
    await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 30000 });
    await pacedWait(page, 3000);

    const BLD = (fixture.els || []).find((e) => e.type === "building" && !e.dogEar && !e.attachedTo);
    await clickFeature(page, `el:${BLD.id}`);
    await page.locator('[data-rail-tab="properties"]').click();
    await pacedWait(page, 800);

    /* The Depth (ft) row — the field the owner was actually editing. Located by its LABEL, because
     * the app renders its own steppers and its inputs carry no `type`, so any attribute-shaped
     * locator matches nothing and the control passes vacuously. */
    const depth = await page.evaluateHandle(() => {
      for (const row of document.querySelectorAll("[data-field-group]")) {
        const label = row.firstElementChild;
        if (label && (label.textContent || "").trim().startsWith("Depth")) return row.querySelector("input");
      }
      return null;
    });
    const field = depth.asElement();
    if (!field) { check("⛔ CONTROL setup · the building inspector has a Depth (ft) row", false, "not found — every control below would be vacuous"); }
    else {
      const ARMS = [
        ["Enter commits the Depth field, then Backspace", async () => { await field.press("Enter"); }],
        ["Escape leaves the Depth field, then Backspace", async () => { await field.press("Escape"); }],
        ["Tab out of the Depth field, then Backspace", async () => { await field.press("Tab"); }],
      ];
      for (const [name, leave] of ARMS) {
        await field.click();
        await pacedWait(page, 250);
        await leave();
        await pacedWait(page, 350);
        const before = await featureKeys(page);
        await page.keyboard.press("Backspace");
        await pacedWait(page, 900);
        const after = await featureKeys(page);
        check(`⛔ CONTROL · ${name} still cannot delete the building`,
          after.length === before.length && after.includes(`el:${BLD.id}`),
          `${before.length} → ${after.length} features`);
      }
    }
    await ctx.close();
  }

  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} arms behave.`);
  process.exitCode = bad.length ? 1 : 0;
} finally {
  await browser.close();
}
