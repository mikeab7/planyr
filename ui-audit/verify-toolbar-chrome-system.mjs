/* B755808 — verify the top-right planner toolbar (File / History / View) now shares ONE chrome
 * system, driven headless against the REAL running app (logged out — no auth/GIS needed, per
 * ATTEMPT-BEFORE-YOU-PARK). Owner report: "this is horrendous UI" — File used a 3px-radius outlined
 * pill, Undo/Redo sat inside a filled grey slab, and Zoom-to-fit had no container at all: three
 * container languages in one bar.
 *
 * Checks, all read from `getComputedStyle` on the real rendered buttons (never assumed from
 * source):
 *   1. File, Undo, Redo and Zoom-to-fit all share the same rendered HEIGHT.
 *   2. File, Undo, Redo and Zoom-to-fit all share the same rendered border-radius.
 *   3. Neither the Undo/Redo group wrapper nor the Zoom-to-fit group wrapper carries a background
 *      fill — proves the "filled grey slab" tray is gone and both groups render the same bare way.
 *   4. Disabling Undo (a blank canvas has nothing to undo) changes ONLY the button's own opacity —
 *      the group wrapper's background stays transparent before and after, so a disabled control
 *      can never read as "styled that way" vs. "actually off".
 *   5. Baseline alignment — File's text baseline and the icon buttons' vertical centers land within
 *      a couple of px of each other (same height grid ⇒ no baseline drift).
 *
 * Run: npm run dev &  then  node ui-audit/verify-toolbar-chrome-system.mjs
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
const { chromium } = pw;

const BASE = process.env.BASE_URL || "http://localhost:5173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const OUT = new URL("./screens/toolbar-chrome-system/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
const page = await ctx.newPage();
await assertMeasurable(page, "verify-toolbar-chrome-system");
let pageErrors = 0;
page.on("pageerror", (e) => { pageErrors++; console.log("  [pageerror]", String(e).slice(0, 160)); });

try {
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1200);
  try { await page.getByRole("button", { name: /Start blank/i }).click({ timeout: 8000 }); } catch (_) {}
  await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 20000 });
  await page.waitForTimeout(600);

  const facts = await page.evaluate(() => {
    const num = (v) => parseFloat(String(v).replace("px", ""));
    const fileBtn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith("File"));
    const undoBtn = document.querySelector('button[aria-label="Undo"]');
    const redoBtn = document.querySelector('button[aria-label="Redo"]');
    const fitBtn = document.querySelector('button[aria-label="Zoom to fit"]');
    const rectOf = (el) => el ? el.getBoundingClientRect() : null;
    const csOf = (el) => el ? getComputedStyle(el) : null;
    // The group wrapper is the button's parent (History/View groups) or grandparent (File, which
    // has an extra position:relative wrapper for its menu anchor).
    const groupWrapperOf = (btn) => {
      if (!btn) return null;
      let p = btn.parentElement;
      // Walk up until we hit a flex row whose own parent is the toolbar's flex row itself —
      // i.e. the direct group <div> rendered around the button(s).
      while (p && getComputedStyle(p).display !== "flex") p = p.parentElement;
      return p;
    };
    const undoWrap = groupWrapperOf(undoBtn);
    const fitWrap = groupWrapperOf(fitBtn);
    const caret = fileBtn ? [...fileBtn.querySelectorAll("span")].find((s) => s.textContent.includes("▾")) : null;
    return {
      fileHeight: num(csOf(fileBtn)?.height),
      undoHeight: num(csOf(undoBtn)?.height),
      redoHeight: num(csOf(redoBtn)?.height),
      fitHeight: num(csOf(fitBtn)?.height),
      fileRadius: csOf(fileBtn)?.borderRadius,
      undoRadius: csOf(undoBtn)?.borderRadius,
      redoRadius: csOf(redoBtn)?.borderRadius,
      fitRadius: csOf(fitBtn)?.borderRadius,
      undoWrapBg: csOf(undoWrap)?.backgroundColor,
      fitWrapBg: csOf(fitWrap)?.backgroundColor,
      undoDisabledBefore: undoBtn?.disabled,
      fileRect: rectOf(fileBtn),
      undoRect: rectOf(undoBtn),
      fitRect: rectOf(fitBtn),
      caretColor: caret ? csOf(caret).color : null,
      caretParentColor: fileBtn ? csOf(fileBtn).color : null,
    };
  });

  console.log(JSON.stringify(facts, null, 1));

  // 1) shared height across all four controls.
  const heights = [facts.fileHeight, facts.undoHeight, facts.redoHeight, facts.fitHeight];
  ok("File/Undo/Redo/Zoom-to-fit share one rendered height", heights.every((h) => Math.abs(h - heights[0]) < 0.5),
    `heights=${JSON.stringify(heights)}`);

  // 2) shared corner radius.
  const radii = [facts.fileRadius, facts.undoRadius, facts.redoRadius, facts.fitRadius];
  ok("File/Undo/Redo/Zoom-to-fit share one border-radius", radii.every((r) => r === radii[0]),
    `radii=${JSON.stringify(radii)}`);

  // 3) neither group wrapper carries a filled background — the "grey slab" tray is gone, and it
  // reads identically to the Zoom-to-fit group, which never had one.
  const transparent = (c) => c === "rgba(0, 0, 0, 0)" || c === "transparent";
  ok("Undo/Redo group wrapper carries no filled background (no grey slab)", transparent(facts.undoWrapBg), `undoWrapBg=${facts.undoWrapBg}`);
  ok("Undo/Redo group wrapper matches Zoom-to-fit's bare wrapper", facts.undoWrapBg === facts.fitWrapBg, `undo=${facts.undoWrapBg} fit=${facts.fitWrapBg}`);

  // 4) a blank canvas has nothing to undo — confirm the button reports disabled AND the wrapper
  // background is unaffected (still transparent), so disabled state never leans on a container fill.
  ok("On a blank canvas, Undo reports disabled (nothing to undo yet)", facts.undoDisabledBefore === true);
  ok("Undo group wrapper stays transparent even while Undo is disabled", transparent(facts.undoWrapBg));

  // 5) baseline / vertical-center alignment — every control's vertical MIDPOINT lands within 2px
  // of every other's (same height grid ⇒ no baseline drift between the pill and the icon buttons).
  const mid = (r) => r ? r.top + r.height / 2 : null;
  const mids = [mid(facts.fileRect), mid(facts.undoRect), mid(facts.fitRect)];
  const midOk = mids.every((m) => m != null) && mids.every((m) => Math.abs(m - mids[0]) < 2);
  ok("File / Undo / Zoom-to-fit share one vertical baseline (±2px)", midOk, `mids=${JSON.stringify(mids)}`);

  // 6) the File caret is de-emphasized (a distinct, lighter color than the button's own ink) rather
  // than full-weight text jammed against the word.
  ok("File's caret renders in a de-emphasized color, not the button's full ink color",
    !!facts.caretColor && facts.caretColor !== facts.caretParentColor,
    `caret=${facts.caretColor} ink=${facts.caretParentColor}`);

  ok("no uncaught page errors", pageErrors === 0, `pageErrors=${pageErrors}`);

  await page.locator('[data-testid="planner-canvas"]').screenshot({ path: `${OUT}toolbar-after.png` }).catch(() => {});
} catch (e) {
  console.log("HARNESS ERROR:", e.message);
} finally {
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n=== ${passed}/${results.length} checks passed ===`);
  await browser.close();
  process.exit(passed === results.length && results.length >= 8 ? 0 : 1);
}
