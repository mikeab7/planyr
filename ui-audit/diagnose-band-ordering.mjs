#!/usr/bin/env node
/* diagnose-band-ordering — WHAT ACTUALLY HAPPENS WHEN YOU REORDER ACROSS TWO DIFFERENT FAMILIES.
 *
 *   node ui-audit/diagnose-band-ordering.mjs [--fixture richfield]
 *
 * ⛔ WHY THIS EXISTS, and it is the whole lesson of the item. The owner has reported "send to back /
 * layers never work" SIX times. It has been fixed at least FOUR times — B421, B820, B671,
 * B293072/B293073 — and every one of those fixes was CORRECT. They all tested MARKUP AGAINST
 * MARKUP, which already worked. Nobody ever pointed a markup at a BUILDING and pressed the command
 * the owner would actually press. So this harness drives the PAIRS, not the family:
 *
 *     markup  vs markup       (the case that has always worked, kept as the CONTROL)
 *     markup  vs building     (his case)
 *     measure vs markup       (worse — reported as rendering behind with no way forward)
 *     callout vs markup       (the fourth family, never reported, measured here for parity)
 *
 * ⛔ AND IT MEASURES THREE THINGS PER PAIR, because they can disagree and the disagreement IS the
 * defect: what PAINTS on top (`elementsFromPoint`), what a right-click RESOLVES to, and what the
 * ordering commands the menu OFFERS actually DO. A command that reports success while changing
 * nothing the user can see is the LOUD-FAILURE violation at the centre of this item — so "the z
 * changed" is never accepted as evidence; the paint order has to move.
 *
 * ⚠ IT ASSERTS NOTHING ABOUT WHAT THE ORDER SHOULD BE. That is a product decision (the owner has an
 * open question about whether a measurement should always outrank decoration), and a harness that
 * baked in an answer would have to be rewritten when he answers. It reports the CONTRACT AS BUILT.
 */
import { chromium } from "playwright";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFixture, cachedRaster } from "./lib/fixtureSeeding.mjs";
import { fixtureSeed, rasterIdbPlan, idbPutInPage } from "./lib/planFixture.mjs";
import { pngDataUrl } from "./lib/synthRaster.mjs";
import { fakeTilePng, parseTileUrl } from "./lib/fakeTile.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { waitForSelectorReleased } from "./lib/waitRelease.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.PLANYR_BASE || "http://127.0.0.1:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const SITE_ID = "smsdrvzr9gzx";
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : d; };
const FIXTURE = arg("fixture", "richfield");

/* ---- the scene ---------------------------------------------------------------------------------
 * Built ON TOP of a real plan rather than in an empty one, because the whole failure is a markup
 * meeting a BUILDING and an empty canvas has none. `HOST` is a real Richfield building; the shapes
 * are placed over its footprint so every pair genuinely overlaps. */
const HOST_EL = "e1454883kaaymz";     // Richfield building: cx 1537.92, cy -284.68, 391 × 1139, rot 270
const rect = (cx, cy, w, h) => [
  { x: cx - w / 2, y: cy - h / 2 }, { x: cx + w / 2, y: cy - h / 2 },
  { x: cx + w / 2, y: cy + h / 2 }, { x: cx - w / 2, y: cy + h / 2 },
];
function withScene(fx) {
  const f = JSON.parse(JSON.stringify(fx));
  f.markups = (f.markups || []).concat([
    /* Opaque, so "did it go behind?" is answerable by looking rather than by inference. */
    { id: "zzM1", z: 900000, kind: "polygon", pts: rect(1537.92, -284.68, 520, 520), stroke: "#c02020", fill: "#c02020", fillOpacity: 1, weight: 2, dash: "solid" },
    { id: "zzM2", z: 901000, kind: "polygon", pts: rect(1637.92, -184.68, 520, 520), stroke: "#2020c0", fill: "#2020c0", fillOpacity: 1, weight: 2, dash: "solid" },
  ]);
  f.measures = (f.measures || []).concat([
    { id: "zzMEA", z: 900000, mode: "area", pts: rect(1537.92, -284.68, 300, 300) },
  ]);
  f.callouts = (f.callouts || []).concat([
    { id: "zzC1", z: 900000, box: { x: 1537.92, y: -284.68 }, tip: { x: 1637.92, y: -184.68 }, text: "zz" },
  ]);
  return f;
}

/* Read the painted stack, top-most FIRST, as `kind:id` keys.
 * ⛔ The point comes from `centerOn`, not from an f2p the hook does not expose: `centerOn(fx,fy,ppf)`
 * parks that world point at the viewport centre by construction, so the centre of the canvas IS the
 * feet-point — no projection call to get wrong, and no dependence on a probe API that may move. */
const STACK_AT = () => {
  const svg = document.querySelector("svg[data-view-ppf]");
  if (!svg) return null;
  const r = svg.getBoundingClientRect();
  const p = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  const els = document.elementsFromPoint(p.x, p.y);
  const keys = [];
  for (const n of els) {
    const owner = n.closest && n.closest("[data-feature]");
    if (!owner) continue;
    const k = owner.getAttribute("data-feature");
    if (k && !keys.includes(k)) keys.push(k);
  }
  return { point: p, stack: keys };
};

async function run() {
  const fixture = withScene(readFixture(FIXTURE));
  const browser = await chromium.launch({ headless: false, executablePath: EXEC, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(fixtureSeed(fixture, { id: SITE_ID, pdfStorage: false }));
  await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
  await ctx.route(/^https?:\/\//, (route) => {
    const u = route.request().url();
    if (u.startsWith(BASE)) return route.continue();
    const t = parseTileUrl(u);
    if (t) return route.fulfill({ status: 200, headers: { "content-type": "image/png", "access-control-allow-origin": "*" }, body: fakeTilePng(t.z, t.x, t.y) });
    return route.abort();
  });

  const page = await ctx.newPage();
  await assertMeasurable(page, "diagnose-band-ordering");
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  for (const { key, spec } of rasterIdbPlan(fixture, SITE_ID)) {
    const r = cachedRaster(spec, join(HERE, ".raster-cache"));
    await page.evaluate(idbPutInPage, { key, value: pngDataUrl(r.png) });
  }
  await page.reload({ waitUntil: "load" });
  await waitForSelectorReleased(page, "svg[data-view-ppf]", { timeout: 30000 });
  await page.evaluate(() => window.__plannerView?.centerOn(1537.92, -284.68, 0.35));
  await pacedWait(page, 1500);

  const out = { fixture: FIXTURE, host: HOST_EL, paint: {}, notes: [] };

  /* 1 — WHAT PAINTS ON TOP, per pair. The point is inside every shape, so one read answers all. */
  const at = await page.evaluate(STACK_AT);
  out.paint.overlapPoint = at;

  /* 2 — the DOM order of the four families, which is what the paint order actually is. */
  out.paint.domOrder = await page.evaluate(() => {
    const svg = document.querySelector("svg[data-view-ppf]");
    const seen = [];
    svg.querySelectorAll("[data-feature]").forEach((n) => {
      const k = n.getAttribute("data-feature") || "";
      const fam = k.split(":")[0];
      if (/^(zz|e1454883)/.test(k.split(":")[1] || "") || !seen.some((s) => s.fam === fam)) {
        seen.push({ fam, key: k });
      }
    });
    // first appearance of each family = painted earliest = furthest back
    const order = [];
    for (const s of seen) if (!order.includes(s.fam)) order.push(s.fam);
    return { familyPaintOrderBackToFront: order, scened: seen.filter((s) => /^zz/.test(s.key.split(":")[1] || "")).map((s) => s.key) };
  });

  /* ⛔ THE STACK SAYS THE MEASURE NODE IS ON TOP; THE OWNER SAYS THE MEASUREMENT VANISHED. Those
   * are not contradictory until you check whether the node on top carries any INK. An area
   * measurement's interior is a transparent hit surface — it can win `elementsFromPoint` and paint
   * nothing — so the DOM order alone cannot settle it. Read the computed paint of each scened node,
   * and take the picture. */
  out.paint.ink = await page.evaluate(() => {
    const rows = [];
    for (const key of ["measure:2", "markup:zzM1", "markup:zzM2", "callout:zzC1"]) {
      const owner = document.querySelector(`[data-feature="${key}"]`);
      if (!owner) { rows.push({ key, present: false }); continue; }
      const painted = [];
      owner.querySelectorAll("*").forEach((n) => {
        const cs = getComputedStyle(n);
        const f = cs.fill, st = cs.stroke, fo = +cs.fillOpacity, so = +cs.strokeOpacity;
        const hasFill = f && f !== "none" && !/rgba\(0, 0, 0, 0\)/.test(f) && fo > 0.01;
        const hasStroke = st && st !== "none" && !/rgba\(0, 0, 0, 0\)/.test(st) && so > 0.01 && parseFloat(cs.strokeWidth) > 0;
        if (hasFill || hasStroke) painted.push({ tag: n.tagName, fill: hasFill ? f : null, fillOpacity: hasFill ? fo : null, stroke: hasStroke ? st : null });
      });
      const txt = (owner.textContent || "").trim().slice(0, 40);
      rows.push({ key, present: true, paintedNodes: painted.length, sample: painted.slice(0, 3), text: txt });
    }
    return rows;
  });
  /* ---- NEW-1: drive the command the owner presses, on the pair he presses it on -------------
   * A point inside markup zzM1 ONLY (outside zzM2, outside the measurement) so the right-click
   * cannot land on something else and the read afterwards is unambiguous. */
  const CTR = await page.evaluate(() => { const r = document.querySelector("svg[data-view-ppf]").getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; });
  /* ⛔ BELOW the measurement's LABEL CHIP as well as outside its square. The chip is far wider than
   * the measurement it belongs to and it answers presses, so the first pass here right-clicked the
   * MEASUREMENT while aiming at the markup — CHROME-NEVER-EATS-A-PRESS, met in the wild. */
  const PPF = 0.35, MX = CTR.x + Math.round((1300 - 1537.92) * PPF), MY = CTR.y + 70;
  const stackAtPx = (x, y) => page.evaluate(([px, py]) => {
    const keys = [];
    for (const n of document.elementsFromPoint(px, py)) {
      const o = n.closest && n.closest("[data-feature]");
      const k = o && o.getAttribute("data-feature");
      if (k && !keys.includes(k)) keys.push(k);
    }
    return keys;
  }, [x, y]);
  const menuRows = () => page.evaluate(() => [...document.querySelectorAll("button, [role=menuitem]")]
    .filter((b) => b.offsetParent && /Front|Forward|Backward|Back|behind|above/i.test(b.textContent || ""))
    .map((b) => ({ text: (b.textContent || "").trim().slice(0, 40), disabled: !!(b.disabled || b.getAttribute("aria-disabled") === "true") })));

  out.new1 = { point: { x: MX, y: MY } };
  out.new1.stackBefore = await stackAtPx(MX, MY);
  await page.mouse.click(MX, MY, { button: "right" });
  await pacedWait(page, 500);
  out.new1.menuBefore = await menuRows();
  const clicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button, [role=menuitem]")].find((x) => x.offsetParent && /^Send to Back/i.test((x.textContent || "").trim()));
    if (!b || b.disabled) return { ok: false, disabled: !!(b && b.disabled) };
    b.click(); return { ok: true };
  });
  out.new1.sendToBackClicked = clicked;
  await pacedWait(page, 700);
  out.new1.stackAfter = await stackAtPx(MX, MY);
  await page.keyboard.press("Escape"); await pacedWait(page, 200);
  await page.mouse.click(MX, MY, { button: "right" });
  await pacedWait(page, 500);
  out.new1.menuAfter = await menuRows();
  await page.keyboard.press("Escape"); await pacedWait(page, 300);

  const svgBox = await page.evaluate(() => { const r = document.querySelector("svg[data-view-ppf]").getBoundingClientRect(); return { x: r.left + r.width / 2 - 260, y: r.top + r.height / 2 - 200, width: 520, height: 400 }; });
  await page.screenshot({ path: "ui-audit/.perfshots/band-overlap.png", clip: svgBox });
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
}
run().catch((e) => { console.error(e); process.exit(1); });
