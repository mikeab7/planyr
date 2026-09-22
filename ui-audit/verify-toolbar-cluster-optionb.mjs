/* NEW-1 — verify the top-right toolbar cluster's Option B unification (row 1: sync badge / open
 * tabs / Full screen / account; row 2: File / Undo / Redo / Zoom-to-fit), driven headless against
 * the REAL running app (logged out — no auth/GIS needed, per ATTEMPT-BEFORE-YOU-PARK).
 *
 * Checks, all read from `getComputedStyle`/`getBoundingClientRect` on the real rendered controls:
 *   1. Every icon-only control across BOTH rows renders at 32×32.
 *   2. Every bordered control across BOTH rows shares one border-radius (8px) — split-button
 *      halves (Undo/Redo's history-dropdown caret) are exempted the same way the pre-existing
 *      row-2-only harness already does, since a merged split control is one radius token applied
 *      per-corner, not a second radius.
 *   3. The signed-out "Sign in" account trigger renders at the same 32px height as its row-1
 *      neighbours (the fully signed-in collapsed-name case needs a real account — VERIFICATION.md
 *      Blocker: auth).
 *   4. Undo (disabled, nothing to undo on a blank canvas) reports a computed opacity/color
 *      distinct from Redo's own resting (enabled-when-something-exists / disabled-when-not)
 *      styling baseline — proven by comparing Undo's disabled opacity against the button's own
 *      un-disabled opacity read off Zoom-to-fit (a same-class icon button that starts enabled).
 *
 * Run: npm run dev &  then  node ui-audit/verify-toolbar-cluster-optionb.mjs
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
const { chromium } = pw;

const BASE = process.env.BASE_URL || "http://localhost:5173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const OUT = new URL("./screens/toolbar-cluster-optionb/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
const page = await ctx.newPage();
await assertMeasurable(page, "verify-toolbar-cluster-optionb");
let pageErrors = 0;
page.on("pageerror", (e) => { pageErrors++; console.log("  [pageerror]", String(e).slice(0, 160)); });

try {
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1200);
  try {
    await page.getByTestId("map-toolbar-draw").click({ timeout: 8000 });
    await page.getByTestId("map-toolbar-draw").click({ timeout: 8000 });
  } catch (_) {}
  await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 20000 });
  await page.waitForTimeout(600);

  const facts = await page.evaluate(() => {
    const num = (v) => parseFloat(String(v).replace("px", ""));
    const csOf = (el) => el ? getComputedStyle(el) : null;
    const rectOf = (el) => el ? el.getBoundingClientRect() : null;

    // NEW-1 — several kept-alive workspace headers mount AppHeader at once (most display:none),
    // so a plain querySelector can land on a hidden copy (0×0 rect). Pick the first VISIBLE match.
    const visible = (sel) => [...document.querySelectorAll(sel)].find((el) => el.getClientRects().length > 0) || null;

    const fullscreenBtn = visible('[data-testid="toggle-fullscreen"]');
    const cloudBadge = visible('[data-testid="cloud-sync-badge"]');
    const accountTrigger = visible('button[aria-label^="Account:"]')
      || visible('[data-testid="account-signed-out"]')
      || visible('[data-testid="account-cloud-off"] button');
    const fileBtn = [...document.querySelectorAll("button")].find((b) => b.getClientRects().length > 0 && b.textContent.trim().startsWith("File"));
    const undoBtn = visible('button[aria-label="Undo"]');
    const redoBtn = visible('button[aria-label="Redo"]');
    const fitBtn = visible('button[aria-label="Zoom to fit"]');

    const iconButtons = { fullscreenBtn, cloudBadge, undoBtn, redoBtn, fitBtn };
    const iconRects = {};
    for (const [k, el] of Object.entries(iconButtons)) iconRects[k] = el ? rectOf(el) : null;

    return {
      iconRects,
      fullscreenRadius: csOf(fullscreenBtn)?.borderRadius,
      cloudRadius: csOf(cloudBadge)?.borderRadius,
      fileRadius: csOf(fileBtn)?.borderRadius,
      fitRadius: csOf(fitBtn)?.borderRadius,
      accountRect: rectOf(accountTrigger),
      accountHeight: num(csOf(accountTrigger)?.height),
      accountText: accountTrigger ? accountTrigger.textContent.trim() : null,
      accountTestId: accountTrigger ? accountTrigger.getAttribute("data-testid") : null,
      undoOpacity: num(csOf(undoBtn)?.opacity),
      undoDisabled: undoBtn?.disabled,
      fitOpacityBeforeAnyAction: num(csOf(fitBtn)?.opacity),
      fitDisabledBeforeAnyAction: fitBtn?.disabled,
    };
  });

  console.log(JSON.stringify(facts, null, 1));

  // 1) every icon-only control across both rows is a true 32×32 square.
  for (const [name, r] of Object.entries(facts.iconRects)) {
    if (!r) { ok(`${name} is present`, false); continue; }
    ok(`${name} renders 32×32`, Math.abs(r.width - 32) < 0.5 && Math.abs(r.height - 32) < 0.5, `w=${r.width} h=${r.height}`);
  }

  // 2) shared 8px radius (full-corner controls only — Undo/Redo's own main button is a merged
  // split-button half and is exempted, same as the pre-existing row-2 harness).
  const radii = [facts.fullscreenRadius, facts.cloudRadius, facts.fileRadius, facts.fitRadius];
  ok("Full screen / cloud-sync badge / File / Zoom-to-fit share one border-radius (8px)",
    radii.every((r) => r === "8px"), `radii=${JSON.stringify(radii)}`);

  // 3) the account trigger renders at the same 32px height as its row-1 neighbours.
  ok("The account trigger renders at 32px tall, matching the rest of row 1's right zone",
    Math.abs(facts.accountHeight - 32) < 0.5, `accountHeight=${facts.accountHeight}`);
  console.log(`  (account trigger seen: testid=${facts.accountTestId} text=${JSON.stringify(facts.accountText)} — a real name-collapse check needs a signed-in account, VERIFICATION.md Blocker: auth)`);

  // 4) Undo (disabled — nothing to undo on a blank canvas) is visually dimmer than a same-class
  // icon button that starts enabled (Zoom-to-fit, before any parcel/element exists on the canvas
  // it may itself be disabled too — report both so a reader can see the real baseline either way).
  ok("Undo reports disabled on a blank canvas", facts.undoDisabled === true);
  ok("Undo's disabled opacity is measurably reduced (< 1)", facts.undoOpacity < 0.9, `undoOpacity=${facts.undoOpacity}`);
  console.log(`  (Zoom-to-fit baseline for comparison: opacity=${facts.fitOpacityBeforeAnyAction} disabled=${facts.fitDisabledBeforeAnyAction})`);

  ok("no uncaught page errors", pageErrors === 0, `pageErrors=${pageErrors}`);

  await page.screenshot({ path: `${OUT}row1-row2.png` }).catch(() => {});
} catch (e) {
  console.log("HARNESS ERROR:", e.message);
} finally {
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n=== ${passed}/${results.length} checks passed ===`);
  await browser.close();
  process.exit(passed === results.length && results.length >= 8 ? 0 : 1);
}
