/* NEW-1 — verify the top-right toolbar cluster's Option B unification (row 1: sync badge / open
 * tabs / Full screen / account; row 2: Undo / Redo / File), driven headless against
 * the REAL running app (logged out — no auth/GIS needed, per ATTEMPT-BEFORE-YOU-PARK).
 *
 * ⛔ NEW-1 (B1900672, 2026-09-24) — Row 2's order changed from File/Undo/Redo/Zoom-to-fit to
 * Undo/Redo/File, and Zoom-to-fit was removed from this row entirely (owner request; the same
 * `fit()` handler is still reachable from the canvas's own empty-space right-click menu and the
 * print-compose screen's own zoom-to-fit button). This harness no longer asserts anything about
 * a Row 2 Zoom-to-fit button, and asserts Undo/Redo render LEFT of File instead.
 *
 * Checks, all read from `getComputedStyle`/`getBoundingClientRect` on the real rendered controls:
 *   1. Every icon-only control across BOTH rows renders at 30×30 (CONTROL_H.lg/SIZE.md — the height already established across the rest of the app; a literal 32 was tried and reverted, see controls.jsx's SIZE header).
 *   2. Every bordered control across BOTH rows shares one border-radius (8px) — split-button
 *      halves (Undo/Redo's history-dropdown caret) are exempted the same way the pre-existing
 *      row-2-only harness already does, since a merged split control is one radius token applied
 *      per-corner, not a second radius.
 *   3. The signed-out "Sign in" account trigger renders at the same 30px height as its row-1
 *      neighbours (the fully signed-in collapsed-name case needs a real account — VERIFICATION.md
 *      Blocker: auth).
 *   4. Undo (disabled, nothing to undo on a blank canvas) reports a computed opacity/color
 *      distinct from its own un-disabled baseline — the box stays full-opacity while the glyph
 *      dims measurably.
 *   5. ⛔ B1807200 AMENDMENT (2026-09-23) — each 30×30 control has REAL clearance from its row's
 *      own edges (owner-reported "chips touch the header" after the box-treatment round above
 *      shipped controls flush against a same-height row). Row 1 is bordered-free so it centers
 *      exactly (5px/5px at the owner-approved HEADER_ROW_H=40); Row 2 carries a 1px divider
 *      border on its own top edge, so its clearance is asymmetric by that one pixel — both sides
 *      are asserted against the owner's own floor (>= ~4px), not against a bare zero.
 *   6. NEW-1 (B1900672) — Row 2's DOM order is Undo, then Redo, then File (left to right), and no
 *      element carrying aria-label="Zoom to fit" remains inside <header> (the canvas's own
 *      separate floating bottom-right zoom stack still carries that label and is untouched).
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
    // NEW-1 (B1900672) — Zoom-to-fit no longer lives in Row 2 (the <header>), but the canvas's own
    // separate floating bottom-right zoom stack (+/−/fit) still carries the same aria-label and is
    // untouched by this change — so the "gone" check is scoped to <header>, not the whole page.
    const zoomFitInHeader = visible('header button[aria-label="Zoom to fit"]');

    const iconButtons = { fullscreenBtn, cloudBadge, undoBtn, redoBtn };
    const iconRects = {};
    for (const [k, el] of Object.entries(iconButtons)) iconRects[k] = el ? rectOf(el) : null;

    // NEW-1 (B1900672) — Row 2's left-to-right DOM order, compared by horizontal position.
    const row2Order = [
      undoBtn && { name: "undoBtn", x: rectOf(undoBtn).left },
      redoBtn && { name: "redoBtn", x: rectOf(redoBtn).left },
      fileBtn && { name: "fileBtn", x: rectOf(fileBtn).left },
    ].filter(Boolean).sort((a, b) => a.x - b.x).map((e) => e.name);

    return {
      iconRects,
      fullscreenRadius: csOf(fullscreenBtn)?.borderRadius,
      cloudRadius: csOf(cloudBadge)?.borderRadius,
      fileRadius: csOf(fileBtn)?.borderRadius,
      accountRect: rectOf(accountTrigger),
      accountHeight: num(csOf(accountTrigger)?.height),
      accountText: accountTrigger ? accountTrigger.textContent.trim() : null,
      accountTestId: accountTrigger ? accountTrigger.getAttribute("data-testid") : null,
      // ⛔ B1807200 AMENDMENT (2026-09-23) — the disabled fade moved from the BUTTON (which would
      // now fade the new resting box too) to the button's direct-child glyph. So the button's own
      // opacity must stay 1 (box undimmed) and the glyph is what carries the dimming.
      undoBoxOpacity: num(csOf(undoBtn)?.opacity),
      undoGlyphOpacity: num(csOf(undoBtn?.querySelector("svg"))?.opacity),
      undoDisabled: undoBtn?.disabled,
      zoomFitPresentInHeader: !!zoomFitInHeader,
      row2Order,
      // ⛔ B1807200 AMENDMENT (2026-09-23) — clearance between each 30×30 control and its OWN row's
      // edges (walk up to the outermost flex+centered ancestor still inside <header>, since an
      // inner zone div is also flex+alignItems:center but sizes to its own content, not the row).
      clearance: (() => {
        function findRow(el) {
          let node = el, matches = [];
          while (node && node.tagName !== "HEADER" && node !== document.body) {
            const cs = getComputedStyle(node);
            if (cs.display === "flex" && cs.alignItems === "center") matches.push(node);
            node = node.parentElement;
          }
          return matches.length ? matches[matches.length - 1] : null;
        }
        function gaps(ctrl) {
          const row = findRow(ctrl);
          if (!ctrl || !row) return null;
          const cr = rectOf(ctrl), rr = rectOf(row);
          return { rowHeight: rr.height, gapTop: cr.top - rr.top, gapBottom: rr.bottom - cr.bottom };
        }
        return { row1: gaps(cloudBadge), row2: gaps(undoBtn) };
      })(),
    };
  });

  console.log(JSON.stringify(facts, null, 1));

  // 1) every icon-only control across both rows is a true 30×30 square.
  for (const [name, r] of Object.entries(facts.iconRects)) {
    if (!r) { ok(`${name} is present`, false); continue; }
    ok(`${name} renders 30×30`, Math.abs(r.width - 30) < 0.5 && Math.abs(r.height - 30) < 0.5, `w=${r.width} h=${r.height}`);
  }

  // 2) shared 8px radius (full-corner controls only — Undo/Redo's own main button is a merged
  // split-button half and is exempted, same as the pre-existing row-2 harness).
  const radii = [facts.fullscreenRadius, facts.cloudRadius, facts.fileRadius];
  ok("Full screen / cloud-sync badge / File share one border-radius (8px)",
    radii.every((r) => r === "8px"), `radii=${JSON.stringify(radii)}`);

  // 3) the account trigger renders at the same 30px height as its row-1 neighbours.
  ok("The account trigger renders at 30px tall, matching the rest of row 1's right zone",
    Math.abs(facts.accountHeight - 30) < 0.5, `accountHeight=${facts.accountHeight}`);
  console.log(`  (account trigger seen: testid=${facts.accountTestId} text=${JSON.stringify(facts.accountText)} — a real name-collapse check needs a signed-in account, VERIFICATION.md Blocker: auth)`);

  // 4) Undo (disabled — nothing to undo on a blank canvas) dims its GLYPH only; the box itself
  // (background/border) stays at full strength, per the approved Option B mockup's own disabled
  // state ("still a white box with a light-grey glyph, never an invisible one").
  ok("Undo reports disabled on a blank canvas", facts.undoDisabled === true);
  ok("Undo's own box stays at full opacity when disabled (only the glyph dims)",
    Math.abs(facts.undoBoxOpacity - 1) < 0.01, `undoBoxOpacity=${facts.undoBoxOpacity}`);
  ok("Undo's glyph opacity is measurably reduced (< 1)", facts.undoGlyphOpacity < 0.9, `undoGlyphOpacity=${facts.undoGlyphOpacity}`);

  // 5) B1807200 AMENDMENT — real clearance between each 30×30 control and its own row's edges.
  // Owner-set floor: >= ~4px, symmetric top/bottom on a border-free row (Row 1); Row 2 carries a
  // 1px divider border on its own top edge so its two sides differ by that one pixel, which is
  // expected, not a defect — both sides still individually clear the floor.
  const CLEARANCE_FLOOR_PX = 3.9; // owner: "don't go below ~4px" — a hair of slack for sub-pixel rounding
  for (const [label, g] of Object.entries(facts.clearance)) {
    if (!g) { ok(`${label} clearance is measurable`, false); continue; }
    ok(`${label} row renders at the owner-approved HEADER_ROW_H (40)`, Math.abs(g.rowHeight - 40) < 0.5, `rowHeight=${g.rowHeight}`);
    ok(`${label} control clears its row's TOP edge by >= ~4px (was 0px pre-fix)`, g.gapTop >= CLEARANCE_FLOOR_PX, `gapTop=${g.gapTop}`);
    ok(`${label} control clears its row's BOTTOM edge by >= ~4px (was 0px pre-fix)`, g.gapBottom >= CLEARANCE_FLOOR_PX, `gapBottom=${g.gapBottom}`);
  }
  if (facts.clearance.row1) {
    ok("Row 1 (no divider border) centers its control exactly symmetric top/bottom",
      Math.abs(facts.clearance.row1.gapTop - facts.clearance.row1.gapBottom) < 0.5,
      `gapTop=${facts.clearance.row1.gapTop} gapBottom=${facts.clearance.row1.gapBottom}`);
  }

  // 6) NEW-1 (B1900672) — Undo, then Redo, then File, left to right; no Zoom-to-fit button
  // anywhere in the default canvas view (it still exists via the empty-canvas right-click menu
  // and the print-compose screen, neither of which this harness drives).
  ok("Row 2 renders Undo, Redo, File in that left-to-right order",
    JSON.stringify(facts.row2Order) === JSON.stringify(["undoBtn", "redoBtn", "fileBtn"]),
    `row2Order=${JSON.stringify(facts.row2Order)}`);
  ok("No Zoom-to-fit button remains in the header (Row 2) — the canvas's own floating zoom stack is untouched",
    facts.zoomFitPresentInHeader === false);

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
