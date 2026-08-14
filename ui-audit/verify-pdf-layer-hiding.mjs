#!/usr/bin/env node
/* verify-pdf-layer-hiding — DOES DOC REVIEW'S ONE HIDE MECHANISM ACTUALLY HIDE, IN EVERY RENDER?
 *
 * ⛔ WHAT THIS WORKSPACE'S "HIDDEN" ACTUALLY IS, established from the code before anything was built.
 *
 * The site planner's audit (B3296 / B494048–B494051) asked: which reads of a collection WE own forget
 * to ask the visibility predicate. **That question is degenerate here, and the reason matters.**
 * Doc Review's markups carry no visibility flag at all — the shared markup engine has no `hidden`,
 * no per-object filter and no layer assignment — so there is no predicate for a read to forget.
 *
 * Its ONE hide is the PDF optional-content ("layer") toggle (B490), and it is a different shape:
 *   · it hides part of the immutable PDF BACKDROP, never anything in our model;
 *   · the hiding happens INSIDE pdf.js, through the `OptionalContentConfig` handed to `page.render`;
 *   · it is ephemeral — the group ids are per-load refs, so nothing is persisted.
 *
 * So the only way our code can get it wrong is to render a page WITHOUT passing that config. There
 * are exactly TWO renders in the mode where the control exists — the whole-page BACKDROP and the
 * viewport-clipped sharp DETAIL tile — and they are separate code paths, which is precisely the
 * shape where one silently falls back to the default config and a hidden layer reappears on zoom.
 * This harness drives both.
 *
 *   npm run verify:pdflayers      (node ui-audit/verify-pdf-layer-hiding.mjs [--url …])
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { layeredPdfBytes } from "./lib/layeredPdf.mjs";

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg("--url", "http://localhost:4319/");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome";

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };

/* Count the strongly-coloured pixels of each layer in a canvas. Counting rather than sampling one
 * point: a single probe can miss by a pixel after a re-raster at a different density, and "how much
 * red is on the canvas" is the question anyway. */
const inkCounts = (page, which) => page.evaluate((sel) => {
  const c = document.querySelector(sel);
  if (!c || !c.width || !c.height) return null;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  let red = 0, blue = 0, black = 0, painted = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a < 128) continue;
    painted++;
    if (r > 180 && g < 80 && b < 80) red++;
    else if (b > 180 && r < 80 && g < 80) blue++;
    else if (r < 60 && g < 60 && b < 60) black++;
  }
  return { red, blue, black, painted, w: c.width, h: c.height };
}, which);

const BACKDROP = '[data-testid="review-sheet"] canvas:nth-of-type(1)';
const DETAIL = '[data-testid="review-sheet"] canvas:nth-of-type(2)';

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
try {
  mkdirSync("ui-audit/.cache", { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
  await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  /* ⛔ ONE EXPECTED FAILURE, NAMED RATHER THAN BLANKET-IGNORED. The sheet-metadata OCR pass pulls
   * its worker from a CDN, which this sandbox's egress blocks; that is the environment, not the app,
   * and it touches nothing this harness measures (the PDF still parses and renders locally). Any
   * OTHER page error is still fatal — a blanket try/catch here would hide a real render crash. */
  const errs = [];
  const EXPECTED = /tesseract|cdn\.jsdelivr\.net/i;
  page.on("pageerror", (e) => { if (!EXPECTED.test(String(e))) errs.push(String(e)); });
  await assertMeasurable(page, "verify-pdf-layer-hiding");
  await page.goto(`${BASE}#/markup`, { waitUntil: "load" });
  await page.waitForSelector('[data-testid="doc-review-root"]', { timeout: 30000 });
  await pacedWait(page, 1500);

  await page.setInputFiles('input[type="file"][accept*="pdf"]', {
    name: "two-layers.pdf", mimeType: "application/pdf", buffer: Buffer.from(layeredPdfBytes()),
  });
  await page.waitForSelector('[data-testid="review-sheet"]', { timeout: 30000 });
  await pacedWait(page, 3000);
  if (errs.length) { console.log("⛔ render crashed:", errs[0].slice(0, 300)); process.exit(1); }

  console.log("\nA two-layer PDF, opened in Review\n");

  /* An app-header menu scrim (`data-menu-owner`) is left open by the boot flow and swallows the
   * first toolbar click. Dismiss it rather than clicking through it — a `force: true` click would
   * "work" while proving the control is unreachable to a real user. */
  const dismissScrim = async () => {
    for (let i = 0; i < 3; i++) {
      if (await page.locator("[data-menu-owner]").count() === 0) return;
      await page.keyboard.press("Escape");
      await pacedWait(page, 300);
    }
  };
  await dismissScrim();

  /* ── SETUP, and every one of these is a vacuity guard ───────────────────────────────────────── */
  const layersBtn = page.locator('button[title^="Layers"]');
  check("setup · the drawing is recognised as carrying layers", await layersBtn.count() > 0,
    await layersBtn.count() ? "the Layers control is offered" : "⛔ no Layers control — every arm below would be vacuous");
  if (!(await layersBtn.count())) process.exit(1);

  await dismissScrim();
  await layersBtn.click();
  await pacedWait(page, 500);
  const names = await page.locator('[data-testid="layers-menu"] label span').allInnerTexts();
  check("setup · both groups are listed by name", names.length === 2, names.join(" · "));

  const before = await inkCounts(page, BACKDROP);
  check("setup · BOTH layers are painted on the backdrop to begin with",
    !!before && before.red > 100 && before.blue > 100 && before.black > 10,
    before ? `red ${before.red} · blue ${before.blue} · black(control) ${before.black} on ${before.w}×${before.h}`
      : "⛔ no backdrop pixels — the arms below could not see a change");
  if (!before || !before.blue) process.exit(1);

  /* ── THE BACKDROP ──────────────────────────────────────────────────────────────────────────── */
  const boxes = page.locator('[data-testid="layers-menu"] input[type="checkbox"]');
  await boxes.nth(1).uncheck();          // Layer B — the blue square
  await pacedWait(page, 2500);
  const after = await inkCounts(page, BACKDROP);
  /* ⛔ THE ARM THAT MATTERS, AND IT IS AT REST — NOT AFTER A ZOOM. The sharp DETAIL tile is painted
   * ON TOP of the backdrop, so it is what the user actually sees. Measuring it here, at the same zoom
   * the toggle was made at, separates "the toggle is broken when you zoom" from "the toggle does not
   * take effect on screen at all". */
  const detailAtRest = await inkCounts(page, DETAIL);
  check("DETAIL TILE (at rest, no zoom) · the hidden layer's ink is gone",
    detailAtRest && detailAtRest.blue === 0,
    detailAtRest ? `blue ${detailAtRest.blue} of ${detailAtRest.painted} painted — this tile paints OVER the backdrop, so it is what is on screen` : "no tile");
  check("BACKDROP · the hidden layer's ink is gone", after && after.blue === 0,
    after ? `blue ${before.blue} → ${after.blue}` : "no canvas");
  check("BACKDROP · ⛔ the OTHER layer and the unlayered control are UNTOUCHED",
    after && after.red > before.red * 0.9 && after.black > 0,
    after ? `red ${before.red} → ${after.red} · black ${before.black} → ${after.black}` : "no canvas");

  /* ── THE DETAIL TILE — the second, separate render path ────────────────────────────────────── */
  /* Zoom in over where the blue square is so the sharp tile actually covers it. The tile only
   * renders the visible window, so an arm that measures it without getting the region right would
   * report "no blue" for the wrong reason — hence the control below. */
  const sheet = page.locator('[data-testid="review-sheet"]');
  const bb = await sheet.boundingBox();
  await page.mouse.move(bb.x + bb.width * 0.75, bb.y + bb.height * 0.25);
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -240); await pacedWait(page, 220); }
  await pacedWait(page, 3000);

  const detail = await inkCounts(page, DETAIL);
  const detailBack = await inkCounts(page, BACKDROP);
  check("setup · the sharp detail tile actually rendered something",
    !!detail && detail.painted > 1000,
    detail ? `${detail.painted} painted px on ${detail.w}×${detail.h}` : "⛔ no detail tile — the arm below would be vacuous");
  check("DETAIL TILE · the hidden layer stays hidden when you zoom in",
    detail && detail.blue === 0, detail ? `blue ${detail.blue}` : "no tile");
  check("DETAIL TILE · ⛔ and the backdrop did not quietly repaint it either",
    detailBack && detailBack.blue === 0, detailBack ? `blue ${detailBack.blue}` : "no canvas");

  /* ── PUT IT BACK — a view filter must be reversible ────────────────────────────────────────── */
  await dismissScrim();
  await layersBtn.click();
  await pacedWait(page, 400);
  await page.locator('[data-testid="layers-menu"] input[type="checkbox"]').nth(1).check();
  await pacedWait(page, 2500);
  const restored = await inkCounts(page, BACKDROP);
  check("the layer comes back when you tick it again", restored && restored.blue > 0,
    restored ? `blue ${restored.blue}` : "no canvas");

  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} checks pass.`);
  process.exitCode = bad.length ? 1 : 0;
} finally {
  await browser.close();
}
