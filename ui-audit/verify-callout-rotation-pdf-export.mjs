#!/usr/bin/env node
/* verify-callout-rotation-pdf-export — B1758593 (NEW-2) — DOES A ROTATED TEXT BOX/CALLOUT
 * ACTUALLY REACH THE PDF/PRINT EXPORT PATH, DRIVEN THROUGH THE REAL UI?
 *
 *   node ui-audit/verify-callout-rotation-pdf-export.mjs [--assert]
 *
 * PDF/export parity is one of this repo's mandatory LIVE-VERIFY classes (CLAUDE.md), so the
 * default posture for "does the export reflect this" is: park it, don't reason from code. But
 * ATTEMPT-BEFORE-YOU-PARK says a logged-out, no-external-GIS check that IS Claude-doable here
 * must be attempted before being filed as needing a live pass — and this one is doable: the real
 * "Download PDF" flow (File ▾ → "Download PDF / pick frame…" → Continue ➜ → "Download PDF") is
 * click-driven, needs no sign-in, and the composed sheet is built from `buildExportSvg`, which
 * hands its SVG payload to `URL.createObjectURL` before rasterizing it into the PDF's embedded
 * JPEG. Hooking that call (the SAME technique `verify-export-label-parity.mjs` already uses in
 * this repo, for the same reason: read the actual export payload rather than eyeball a raster)
 * captures the literal markup that gets printed — including whatever `<g transform="rotate(...)">`
 * this item's fix put on a rotated callout — with no JPEG decode needed and no file left on disk
 * (the hook also short-circuits the `<a download>` click, matching the existing harness's own
 * "must leave no file behind" rule).
 *
 * `buildComposedSheet` (the PDF path) and `buildExportSvg` (the Export PNG path) share the exact
 * same underlying `buildExportSvgRaw` — confirmed by reading exportSheet.js — so this is not a
 * proxy for the PDF path, it IS the PDF path's own composition step, captured before rasterization.
 */
import { chromium } from "playwright";
import { readFixture } from "./lib/fixtureSeeding.mjs";
import { fixtureSeed } from "./lib/planFixture.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { waitForSelectorReleased } from "./lib/waitRelease.mjs";

const BASE = process.env.PLANYR_BASE || "http://127.0.0.1:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
const SITE_ID = "smverifpdfrot1";
const ASSERT = process.argv.includes("--assert");
let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ✓ ${m}`); pass++; };
const bad = (m) => { console.error(`  ✗ ${m}`); fail++; };

function withScene(fx) {
  const f = JSON.parse(JSON.stringify(fx));
  f.callouts = (f.callouts || []).concat([
    { id: "zzExportUnrot", z: 900000, box: { x: 1000, y: -1000 }, text: "Unrotated control", noLeader: true },
    { id: "zzExportRot", z: 900001, box: { x: 1200, y: -1000 }, text: "Rotated 45", noLeader: true, rot: 45 },
  ]);
  return f;
}

// The SAME technique verify-export-label-parity.mjs uses: capture every SVG blob handed to
// URL.createObjectURL (this is what buildExportSvg/buildComposedSheet hand off before
// rasterizing), and never actually let a download-tagged <a> click do anything.
const HOOK = () => {
  window.__exportSvgs = [];
  const real = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (b) => {
    try {
      if (b && typeof b.type === "string" && b.type.indexOf("svg") >= 0) {
        b.text().then((t) => window.__exportSvgs.push(t)).catch(() => {});
      }
    } catch (_) {}
    return real(b);
  };
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (this.download) return; return click.call(this); };
};

async function run() {
  const fixture = withScene(readFixture("richfield"));
  const browser = await chromium.launch({ headless: true, executablePath: EXEC, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(fixtureSeed(fixture, { id: SITE_ID, pdfStorage: false }));
  await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
  await ctx.addInitScript(HOOK);
  await ctx.route(/^https?:\/\//, (route) => {
    const u = route.request().url();
    if (u.startsWith(BASE)) return route.continue();
    return route.abort();
  });

  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-callout-rotation-pdf-export");
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => { errors.push(`unexpected alert: ${d.message()}`); d.dismiss().catch(() => {}); });
  await page.goto(BASE + `#/project/${SITE_ID}/site`, { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "load" });
  await waitForSelectorReleased(page, "svg[data-view-ppf]", { timeout: 30000 });
  await pacedWait(page, 1000);

  // Drive the real "Download PDF" flow — no sign-in, no external network (routed off already).
  await page.getByRole("button", { name: "File ▾" }).click();
  const gotFileMenu = await page.getByRole("button", { name: "Download PDF / pick frame…" }).count();
  if (!gotFileMenu) { bad("File menu's \"Download PDF / pick frame…\" item not found — aborting"); await browser.close(); console.log(`\n${pass} passed, ${fail} failed`); if (ASSERT && fail) process.exit(1); return; }
  await page.getByRole("button", { name: "Download PDF / pick frame…" }).click();
  ok("File ▾ → \"Download PDF / pick frame…\" opened print-frame placement");
  await pacedWait(page, 500);

  const continueBtn = page.getByRole("button", { name: "Continue ➜" });
  if (!(await continueBtn.count())) { bad("\"Continue ➜\" button not found after entering print mode — aborting"); await browser.close(); console.log(`\n${pass} passed, ${fail} failed`); if (ASSERT && fail) process.exit(1); return; }
  await continueBtn.click();
  ok("\"Continue ➜\" opened the compose/print panel");
  await pacedWait(page, 900); // let recomputeCompose + the debounced sheet preview settle

  const dlBtn = page.getByRole("button", { name: /Download PDF/ });
  if (!(await dlBtn.count())) { bad("\"Download PDF\" button not found in the compose panel — aborting"); await browser.close(); console.log(`\n${pass} passed, ${fail} failed`); if (ASSERT && fail) process.exit(1); return; }
  const disabled = await dlBtn.first().isDisabled().catch(() => false);
  if (disabled) bad("\"Download PDF\" button is disabled (a fitWarning?) — the export could not be driven");
  else {
    await dlBtn.first().click();
    ok("clicked the real \"Download PDF\" button (exportPDF → buildComposedSheet → buildExportSvg)");
  }

  let svgs = [];
  for (let i = 0; i < 80; i++) {
    svgs = await page.evaluate(() => window.__exportSvgs);
    if (svgs.length) break;
    await page.waitForTimeout(250);
  }
  if (!svgs.length) { bad("no export SVG payload was captured within 20s"); }
  else {
    ok(`captured the real composed-sheet SVG payload (${svgs[0].length} bytes) — this is the exact markup buildExportSvg handed to the rasterizer`);
    const svg = svgs[svgs.length - 1]; // the last one captured is the PDF's own composed sheet
    // Take the substring from this callout's opening <g> to the NEXT sibling callout's own
    // <g data-feature="callout: — good enough for a presence/transform check, since callouts
    // render as flat siblings with no callout nested inside another.
    const groupFor = (id) => {
      const start = svg.indexOf(`data-feature="callout:${id}"`);
      if (start < 0) return null;
      const nextStart = svg.indexOf('data-feature="callout:', start + 10);
      return svg.slice(start, nextStart > 0 ? nextStart : start + 4000);
    };
    const rotSeg = groupFor("zzExportRot");
    const unrotSeg = groupFor("zzExportUnrot");
    if (!rotSeg) bad("the rotated callout (zzExportRot) is not present in the exported sheet at all");
    else if (/rotate\(45 /.test(rotSeg)) ok("the EXPORTED sheet's own SVG carries the rotated callout's rotate(45 …) transform — the real PDF export path reflects the angle");
    else bad(`the exported sheet's rotated-callout segment carries NO rotate(45…) transform: ${rotSeg.slice(0, 300)}`);
    if (!unrotSeg) bad("the unrotated control callout (zzExportUnrot) is not present in the exported sheet — can't confirm the control");
    else if (!/rotate\(/.test(unrotSeg)) ok("control: the UNROTATED callout carries no rotate(...) transform in the same export — the rotated one isn't a false positive from some ambient transform");
    else bad(`the unrotated control callout unexpectedly carries a rotate(...) transform: ${unrotSeg.slice(0, 300)}`);
  }

  if (errors.length === 0) ok("no JS crash / unexpected alert"); else bad(`errors: ${errors.slice(0, 3).join("; ")}`);

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (ASSERT && fail) process.exit(1);
  process.exit(0);
}
run().catch((e) => { console.error(e); process.exit(1); });
