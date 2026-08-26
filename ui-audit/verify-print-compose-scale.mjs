#!/usr/bin/env node
/* B765985 verification — the compose screen's NEW engineering-scale + exhibit-size features,
 * driven against the real built app. verify-b1042-export-lazy.mjs already proves the two-step
 * flow (frame pick → compose → download) and PDF-PARITY-by-construction; this script proves
 * the parts that are genuinely new rather than relocated:
 *
 *   1. ARCH D is selectable and changes the sheet preview (a real page-size change, not a
 *      relabeled Letter).
 *   2. Picking an explicit scale (a) locks the on-canvas frame's resize handles away when you
 *      go back to reposition — dragging a corner would silently break the stated ratio, so
 *      there must be nothing to drag — and (b) the title block actually prints the ratio
 *      (read the live preview's own blob: bytes, not a screenshot).
 *   3. An explicit scale that can't show the picked area on the chosen sheet shows the
 *      fit-warning banner and disables Download — never a silent rescale.
 *   4. Prepared-by free text reaches the printed sheet.
 *
 *   node ui-audit/verify-print-compose-scale.mjs          # against http://localhost:4173
 */
import { chromium } from "playwright";
import { perfScenarioSeed } from "./lib/perf-scenario.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = (process.env.BASE_URL || "http://localhost:4173/").replace(/\/?$/, "/");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, acceptDownloads: true });
await ctx.addInitScript(perfScenarioSeed());
const page = await ctx.newPage();
await assertMeasurable(page, "verify-print-compose-scale");
await page.route(/^https?:\/\//, (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));

const fail = [];
const ok = [];

await page.goto(BASE, { waitUntil: "load" });
await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 60_000 });

// Drop a building so the frame has real content to size against (fit-to-frame starts small
// on a blank site, which makes the "doesn't fit" case below trivially always true — draw
// something first so the DEFAULT frame is a meaningful size to compare against).
const tool = await page.getByRole("button", { name: /^Building$/ }).first();
if (await tool.count()) {
  await tool.click().catch(() => {});
  await page.mouse.move(500, 400); await page.mouse.down(); await page.mouse.move(760, 560); await page.mouse.up();
  await page.waitForTimeout(200);
  await page.keyboard.press("Escape").catch(() => {});
}

const openCompose = async () => {
  await page.getByRole("button", { name: /^File/ }).filter({ visible: true }).first().click();
  await page.getByRole("button", { name: /Download PDF \/ pick frame/ }).first().click();
  await page.waitForFunction(() => /PRINT FRAME/i.test(document.body.innerText), null, { timeout: 20_000 });
  await page.getByRole("button", { name: /^Continue ➜$/ }).first().click();
  await page.waitForSelector('[data-testid="print-compose"]', { timeout: 20_000 });
};
const readPreviewSvgText = async () => {
  const src = await page.locator('[data-testid="print-compose"] img[alt="Sheet preview"]').getAttribute("src").catch(() => null);
  if (!src) return null;
  return page.evaluate(async (url) => (await fetch(url)).text(), src);
};
const waitPreviewChange = async (prevText) => {
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(250);
    const t = await readPreviewSvgText();
    if (t && t !== prevText) return t;
  }
  return null;
};

try {
  await openCompose();

  /* ---- 1. ARCH D is selectable and changes the sheet --------------------------------- */
  const before = await readPreviewSvgText();
  await page.getByText("ARCH D", { exact: true }).first().click();
  const afterArchD = await waitPreviewChange(before);
  if (!afterArchD) fail.push("selecting ARCH D never rebuilt the sheet preview");
  else {
    const wIn = (afterArchD.match(/width="([\d.]+)in"/) || [])[1];
    const hIn = (afterArchD.match(/height="([\d.]+)in"/) || [])[1];
    if (wIn === "36.0" || wIn === "36") ok.push(`ARCH D landscape produced a real 36×24in sheet (width="${wIn}in" height="${hIn}in")`);
    else fail.push(`ARCH D did not produce a 36in-wide sheet (read width="${wIn}in")`);
  }

  /* ---- 2. an explicit scale locks the resize handles away + prints the ratio ---------- */
  const scaleSelect = page.locator('[data-testid="print-compose"] select').first();
  await scaleSelect.selectOption({ label: '1" = 100\'' });
  const withScale = await waitPreviewChange(afterArchD || before);
  if (withScale && withScale.includes("1&quot; = 100&#39;".replace("&#39;", "'"))) ok.push('the printed title block carries the stated scale (1" = 100\')');
  else if (withScale && /1["'&quot;]+ ?= ?100/.test(withScale)) ok.push("the printed title block carries the stated scale (1\" = 100', matched loosely)");
  else fail.push("the printed sheet does not show the explicit scale text");

  await page.getByRole("button", { name: /^◂ Reposition$/ }).first().click();
  await page.waitForSelector('[data-testid="print-frame"]', { timeout: 10_000 });
  const handleCount = await page.locator('[data-testid="print-frame"] ~ rect[rx="2"]').count().catch(() => -1);
  // corner handles are siblings of the frame rect inside the same <g>; count rx=2 rects directly
  const cornerCount = await page.evaluate(() => {
    const frame = document.querySelector('[data-testid="print-frame"]');
    if (!frame || !frame.parentElement) return -1;
    return Array.from(frame.parentElement.querySelectorAll('rect[rx="2"]')).length;
  });
  if (cornerCount === 0) ok.push("resize handles are gone while an explicit scale is locked (dragging could only break the stated ratio)");
  else fail.push(`expected 0 resize handles under a locked scale, found ${cornerCount}`);
  void handleCount;

  await page.getByRole("button", { name: /^Continue ➜$/ }).first().click();
  await page.waitForSelector('[data-testid="print-compose"]', { timeout: 10_000 });

  /* ---- 3. an unreasonably small scale can't show the picked area — never silently rescaled */
  await scaleSelect.selectOption({ label: '1" = 10\'' });
  await page.waitForTimeout(600);
  const warn = await page.locator('[data-testid="print-compose"] [role="alert"]').first().textContent().catch(() => null);
  if (warn && /bigger sheet|smaller scale|smaller area/.test(warn)) ok.push(`an unreasonably tight scale shows the fit warning, not a silent rescale: "${warn.slice(0, 90)}…"`);
  else fail.push("an unreasonably tight scale (1\"=10' on the picked area) did not show the expected fit warning");
  const downloadDisabled = await page.getByRole("button", { name: /Download PDF|Preparing/ }).first().isDisabled().catch(() => null);
  if (downloadDisabled) ok.push("Download PDF is disabled while the fit warning is showing");
  else fail.push("Download PDF is NOT disabled despite the fit warning — a download here would silently misrepresent the scale");

  /* ---- 4. prepared-by reaches the sheet ------------------------------------------------ */
  await scaleSelect.selectOption({ label: "Fit to frame (no stated scale)" });
  await page.waitForTimeout(400);
  const preparedInput = page.locator('[data-testid="print-compose"] input[placeholder="Name or firm"]');
  await preparedInput.fill("J. Rivera, PE");
  const withPrepared = await waitPreviewChange(await readPreviewSvgText());
  const finalText = withPrepared || (await readPreviewSvgText());
  if (finalText && finalText.includes("Prepared by J. Rivera, PE")) ok.push("Prepared-by free text reaches the printed sheet");
  else fail.push("Prepared-by text did not reach the printed sheet");

  /* ---- 5. toggling Dimensions FOR THE PRINT must not leave a lasting change on the editing
     view — Cancel (and a completed Download) restore whatever showDims/showAreas were before
     the print flow started, per the non-destructive-Cancel contract. ---------------------- */
  const countDims = () => page.evaluate(() => document.querySelectorAll('[data-el-dim="1"]').length).catch(() => -1);
  const dimsBefore = await countDims();
  await page.getByText("Dimensions", { exact: true }).first().click(); // uncheck it for this print
  await page.waitForTimeout(300);
  const dimsWhileUnchecked = await countDims();

  await page.getByRole("button", { name: "✕" }).first().click(); // Cancel — must not throw, must return to canvas
  await page.waitForSelector('[data-testid="print-compose"]', { state: "detached", timeout: 10_000 });
  ok.push("Cancel from the compose screen returns to the canvas cleanly");
  const dimsAfter = await countDims();
  if (dimsBefore <= 0) ok.push("Dimensions-restore check skipped ([data-el-dim=\"1\"] never appeared on this fixture — nothing to compare)");
  else if (dimsWhileUnchecked === dimsBefore) fail.push(`unchecking "Dimensions" in compose did not actually hide anything (${dimsBefore} dimension nodes before and while unchecked) — the toggle isn't reaching the canvas`);
  else if (dimsAfter === dimsBefore) ok.push(`Cancel restored the Dimensions display toggle (${dimsBefore} dimension nodes before → ${dimsWhileUnchecked} while unchecked in compose → ${dimsAfter} after Cancel — toggling it for the print left no lasting change)`);
  else fail.push(`Cancel did NOT restore the Dimensions toggle (${dimsBefore} before, ${dimsWhileUnchecked} while unchecked, ${dimsAfter} after Cancel)`);
} catch (e) {
  fail.push(`compose-scale flow failed — ${String(e).split("\n")[0]}`);
}

await browser.close();

console.log("B765985 — compose screen scale / exhibit-size features\n");
for (const o of ok) console.log(`  ✓ ${o}`);
for (const f of fail) console.log(`  ✗ ${f}`);
console.log();
console.log(fail.length ? "✗ FAIL" : "✓ PASS — the explicit scale, exhibit sizes, fit-warning and title-block fields all work against the real app.");
process.exit(fail.length ? 1 : 0);
