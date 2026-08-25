#!/usr/bin/env node
/* NEW-MAPCTRL-1 — THE COMPS TOGGLE VS "IMAGERY & LAYERS", verified at every reported breakpoint.
 *
 * The leasing-comps work added a "Comps" pill at the SAME top-right corner mapChromeStack.js
 * already documents as belonging to the Layers panel, at a z-index that outranked it — a straight
 * layout collision, the exact B554 class (a control burying another control at a claimed corner).
 *
 * ⛔ A real HIT TEST, not a bounding-box comparison — `elementFromPoint` is the browser's own
 * answer to "what actually receives a press here", which a rect-overlap check can miss (B427408's
 * own lesson: covered controls can still pass a naive geometry comparison).
 *
 *   node ui-audit/verify-map-comps-overlap.mjs [--url http://localhost:4173/] [--shots]
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const URL = arg("--url", "http://localhost:4173/");
const SHOTS = process.argv.includes("--shots");
const OUT = "ui-audit/out/map-comps-overlap";

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };

// A real hit test at the element's own centre — same shape as verify-map-chrome.mjs's `hitAt`.
async function hitAt(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return { found: true, painted: false, rect: { x: Math.round(r.left), y: Math.round(r.top), w: 0, h: 0 } };
    const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
    const top = document.elementFromPoint(cx, cy);
    return {
      found: true, painted: true, rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      reachable: !!(top && (el === top || el.contains(top) || top.contains(el))),
      blockedBy: top ? `${top.tagName.toLowerCase()}${top.className && typeof top.className === "string" ? "." + top.className.split(" ").filter(Boolean).slice(0, 2).join(".") : ""}` : null,
    };
  }, sel);
}

// Does any pixel of A's box overlap any pixel of B's box? (A second, independent check besides
// the hit test — the hit test proves the CENTRE is reachable; this proves the two boxes don't
// even overlap at all, which is the stronger claim the owner actually asked for: "fully visible".)
const boxesOverlap = (a, b) => a && b && a.w > 0 && b.w > 0 && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome" });
try {
  if (SHOTS) mkdirSync(OUT, { recursive: true });

  const WIDTHS = [1400, 1200, 1024, 760, 390];
  for (const width of WIDTHS) {
    console.log(`\n${width}×1000`);
    const ctx = await browser.newContext({ viewport: { width, height: 1000 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await assertMeasurable(page, "verify-map-comps-overlap");
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".leaflet-container", { timeout: 20000 });
    await pacedWait(page, 1000);

    const comps = await hitAt(page, '[data-testid="map-comps-toggle"]');
    check(`${width}px · Comps toggle renders`, comps.found && comps.painted, comps.rect ? `${comps.rect.w}×${comps.rect.h} at ${comps.rect.x},${comps.rect.y}` : "");

    const layersSel = 'button[title="Imagery & layers"], button[title="Collapse layers"]';
    const layers = await hitAt(page, layersSel);
    check(`${width}px · Imagery & layers button renders`, layers.found && layers.painted, layers.rect ? `${layers.rect.w}×${layers.rect.h} at ${layers.rect.x},${layers.rect.y}` : "");

    if (comps.painted && layers.painted) {
      check(`${width}px · the two boxes don't overlap at all`, !boxesOverlap(comps.rect, layers.rect),
        boxesOverlap(comps.rect, layers.rect) ? "boxes overlap" : "");
      check(`${width}px · Comps toggle is fully clickable (not covered)`, comps.reachable, comps.reachable ? "" : `blocked by ${comps.blockedBy}`);
      check(`${width}px · Imagery & layers is fully clickable (not covered)`, layers.reachable, layers.reachable ? "" : `blocked by ${layers.blockedBy}`);
      // "IMAGERY" specifically must be un-obscured — the exact symptom reported.
      const imageryWordVisible = await page.evaluate((sel) => {
        const btn = document.querySelector(sel);
        if (!btn) return false;
        const label = [...btn.querySelectorAll("span")].find((s) => /Imagery/.test(s.textContent || ""));
        if (!label) return btn.textContent.includes("Imagery");
        const r = label.getBoundingClientRect();
        const cx = Math.round(r.left + Math.min(20, r.width / 2)), cy = Math.round(r.top + r.height / 2);
        const top = document.elementFromPoint(cx, cy);
        return !!(top && (label === top || label.contains(top) || top.contains(label) || btn.contains(top)));
      }, layersSel);
      check(`${width}px · the word "Imagery" itself is unobscured`, imageryWordVisible);
    }

    // Opening the full Comps drawer (a deliberately-opened FLOATING_PANEL, mapChromeStack.js's own
    // top tier — a right-side panel spanning nearly the map's full height) is EXPECTED to cover the
    // Layers control for as long as it's open, same as any other panel the user opens on top of it.
    // What must NOT happen is the toggle button itself sticking around fighting the open panel for
    // the same space — confirm it's gone instead.
    if (comps.painted && comps.reachable) {
      await page.locator('[data-testid="map-comps-toggle"]').click();
      await pacedWait(page, 400);
      const toggleGone = await page.locator('[data-testid="map-comps-toggle"]').count();
      check(`${width}px · Comps toggle itself disappears once its panel is open (no longer fighting Layers for the corner)`, toggleGone === 0);
      // Closing it again must restore the Layers control exactly as before, at this same width.
      const closedByClick = await page.evaluate(() => {
        const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "×");
        if (!btn) return false;
        btn.click();
        return true;
      });
      if (closedByClick) {
        await pacedWait(page, 300);
        const layersAfterClose = await hitAt(page, layersSel);
        check(`${width}px · Imagery & layers reachable again once Comps panel closes`, layersAfterClose.reachable === true, layersAfterClose.reachable ? "" : `blocked by ${layersAfterClose.blockedBy}`);
      }
    }

    if (SHOTS) await page.screenshot({ path: `${OUT}/w${width}.png` });
    await ctx.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length ? "✗" : "✓"} ${results.length - failed.length}/${results.length} checks passed`);
  if (SHOTS) { writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2)); console.log(`  screenshots + results → ${OUT}/`); }
  process.exitCode = failed.length ? 1 : 0;
} finally {
  await browser.close();
}
