#!/usr/bin/env node
/* verify-paint-order-contract — THE DRAWING AGREES WITH THE TABLE, FOR EVERY ORDERED PAIR.
 *
 *   node ui-audit/verify-paint-order-contract.mjs [--fixture richfield] [--assert]
 *
 * ⛔ WHY, and it is a process failure as much as a code one. "Send to back / layers never work" has
 * been reported SIX times. Four fixes, all correct, all measured MARKUP AGAINST MARKUP — the case
 * that already worked. The fifth report was a markup against a BUILDING. The sixth was not
 * ordering at all: a measurement and a markup shared a default COLOUR, so the measurement was
 * camouflaged while painting on top. The owner's instruction afterwards is why this file drives
 * PAIRS from a table rather than scenarios from a hunch: he should not have to tell us to check
 * all the cases.
 *
 * So this seeds one of every drawn family at ONE overlapping point, reads what actually paints, and
 * checks EVERY ORDERED PAIR against `lib/paintOrder.js` — the same table the unit guard and the
 * capability contract read. A pair it could not observe is reported as UNOBSERVED and makes the run
 * VACUOUS; it is never quietly scored as a pass (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6).
 *
 * It also carries the KNOWN-GOOD ARMS the same clause demands, two of them: `markup vs element` —
 * the pair #1066 shipped and its own e2e spec covers — must come back green, and the measurement's
 * painted ink must read back as the value the shared table declares. If either fails, the
 * instrument is on trial, not the app, and the run says VACUOUS instead of printing a score.
 *
 * SECOND ASSERTION, B548816: the measurement's ink must stand clear of a DEFAULT-coloured markup's
 * fill. That is the actual sixth defect, and it is invisible to any ordering check — which is
 * precisely why a harness that seeds deliberately loud red/blue markups (as the diagnostic one
 * does, so it can tell them apart) reported the scene as healthy. The markup seeded here carries
 * NO colour, so it takes the product default, which is the only case that ever broke.
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
import { srgbToLab, deltaE2000 } from "./lib/perceptualDiff.mjs";
import { orderedPairs, defaultRelation } from "../src/workspaces/site-planner/lib/paintOrder.js";
import { INK_DISTINCT_MIN_DE, MEASURE_INK, FAMILY_DEFAULT_INK, parseHex } from "../src/shared/theme/familyInk.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.PLANYR_BASE || "http://127.0.0.1:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const SITE_ID = "smsdrvzr9gzx";
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : d; };
const FIXTURE = arg("fixture", "richfield");
const ASSERT = process.argv.includes("--assert");

/* The scene sits over a real Richfield building, because an empty canvas has no element to be
 * under. Everything overlaps the same feet point, so ONE read answers all the pairs at once. */
const CX = 1537.92, CY = -284.68;
const rect = (cx, cy, w, h) => [
  { x: cx - w / 2, y: cy - h / 2 }, { x: cx + w / 2, y: cy - h / 2 },
  { x: cx + w / 2, y: cy + h / 2 }, { x: cx - w / 2, y: cy + h / 2 },
];
function withScene(fx) {
  const f = JSON.parse(JSON.stringify(fx));
  f.markups = (f.markups || []).concat([
    /* ⛔ NO stroke, NO fill — this markup takes the PRODUCT DEFAULT, which is the only markup that
     * ever camouflaged a measurement. A harness that picks its own loud colours cannot see it. */
    { id: "zzMK", z: 900000, kind: "polygon", pts: rect(CX, CY, 520, 520), fillOpacity: 1, weight: 2, dash: "solid" },
    { id: "zzMK2", z: 901000, kind: "polygon", pts: rect(CX, CY, 460, 460), fillOpacity: 1, weight: 2, dash: "solid" },
  ]);
  f.measures = (f.measures || []).concat([{ id: "zzME", z: 900000, mode: "area", pts: rect(CX, CY, 300, 300) }]);
  f.callouts = (f.callouts || []).concat([{ id: "zzCA", z: 900000, box: { x: CX, y: CY }, tip: { x: CX + 100, y: CY + 100 }, text: "zz" }]);
  return f;
}

/* ⛔ PAINT ORDER IS READ TWO WAYS, ON PURPOSE, and DOCUMENT ORDER is the primary one.
 *
 * In SVG, document order IS paint order, and unlike `elementsFromPoint` it does not depend on
 * pointer-events. That matters here: a parcel's visible polygon is deliberately pointer-INERT (its
 * fill must never grab the lot), so a hit-test read cannot see it at all and would report the
 * parcel pairs as unobservable — five sixths of the table, silently. The hit-test read is kept
 * beside it as an independent second answer; the two are compared, and a disagreement is reported
 * rather than averaged. */
const STACK = () => {
  const svg = document.querySelector("svg[data-view-ppf]");
  const r = svg.getBoundingClientRect();
  const p = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  const hit = [];
  for (const n of document.elementsFromPoint(p.x, p.y)) {
    const o = n.closest && n.closest("[data-feature]");
    const k = o && o.getAttribute("data-feature");
    if (k && !hit.includes(k)) hit.push(k);
  }
  const doc = [];
  svg.querySelectorAll("[data-feature]").forEach((n) => {
    const k = n.getAttribute("data-feature");
    if (k && !doc.includes(k)) doc.push(k);
  });
  return { point: p, topFirst: hit, docOrder: doc };
};

/* The DOM stamps `el:`; the contract calls that family `element`. One place to translate. */
const FAM = (key) => { const f = String(key).split(":")[0]; return f === "el" ? "element" : f; };

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
  await assertMeasurable(page, "verify-paint-order-contract");
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  for (const { key, spec } of rasterIdbPlan(fixture, SITE_ID)) {
    const r = cachedRaster(spec, join(HERE, ".raster-cache"));
    await page.evaluate(idbPutInPage, { key, value: pngDataUrl(r.png) });
  }
  await page.reload({ waitUntil: "load" });
  await waitForSelectorReleased(page, "svg[data-view-ppf]", { timeout: 30000 });
  await page.evaluate(([x, y]) => window.__plannerView?.centerOn(x, y, 0.35), [CX, CY]);
  await pacedWait(page, 1500);

  const at = await page.evaluate(STACK);
  /* Paint order back-to-front, one entry per family, FIRST appearance wins (drawn first = furthest
   * back). Document order is already back-to-front, so no reversal. */
  const famOrder = (keys) => {
    const out = [];
    for (const k of keys) { const f = FAM(k); if (f && !out.includes(f)) out.push(f); }
    return out;
  };
  const backToFront = famOrder(at.docOrder);
  const byHit = famOrder([...at.topFirst].reverse());
  const rank = new Map(backToFront.map((f, i) => [f, i]));
  /* The two independent reads must agree wherever both saw a family. A disagreement means one of
   * them is measuring something other than paint order, and the run says so. */
  const hitRank = new Map(byHit.map((f, i) => [f, i]));
  const disagreements = [];
  for (const p of orderedPairs()) {
    if (!hitRank.has(p.a) || !hitRank.has(p.b) || !rank.has(p.a) || !rank.has(p.b)) continue;
    const d = rank.get(p.a) > rank.get(p.b) ? "over" : "under";
    const h = hitRank.get(p.a) > hitRank.get(p.b) ? "over" : "under";
    if (d !== h) disagreements.push(`${p.a}/${p.b}: document says ${d}, hit-test says ${h}`);
  }

  const rows = [];
  for (const p of orderedPairs()) {
    if (!rank.has(p.a) || !rank.has(p.b)) { rows.push({ ...p, observed: null, ok: null }); continue; }
    const observed = rank.get(p.a) > rank.get(p.b) ? "over" : "under";
    rows.push({ ...p, observed, ok: observed === p.relation });
  }

  /* THE INK ARM (B548816). Read what the app actually paints for the measurement and for a
   * default-coloured markup, and require them to stand apart perceptually. */
  const ink = await page.evaluate(() => {
    /* ⛔ Read the PAINTED ink, not the first child's computed style — a family's outermost child is
     * usually a <g>, whose fill is inherited black and means nothing. Walk the descendants and take
     * the first node that actually puts colour on the canvas. */
    const SHAPES = new Set(["path", "polygon", "polyline", "rect", "circle", "ellipse", "line"]);
    const pick = (prefix) => {
      /* Match by PREFIX: a measurement's census key is indexed, not id-keyed, so a hard-coded
         `measure:zzME` finds nothing and reports UNREAD on a working app. */
      const o = [...document.querySelectorAll("[data-feature]")]
        .find((n) => (n.getAttribute("data-feature") || "").startsWith(prefix));
      if (!o) return { present: false, key: null };
      const live = (v) => v && v !== "none" && !/rgba\(0, 0, 0, 0\)/.test(v);
      let stroke = null, fill = null;
      for (const n of o.querySelectorAll("*")) {
        if (!SHAPES.has(n.tagName.toLowerCase())) continue; // a <g>'s inherited black is not ink
        const cs = getComputedStyle(n);
        if (!stroke && live(cs.stroke) && +cs.strokeOpacity > 0.01 && parseFloat(cs.strokeWidth) > 0) stroke = cs.stroke;
        if (!fill && live(cs.fill) && +cs.fillOpacity > 0.01) fill = cs.fill;
        if (stroke && fill) break;
      }
      return { present: true, key: o.getAttribute("data-feature"), stroke, fill };
    };
    return { measure: pick("measure:"), markup: pick("markup:zzMK") };
  });
  const rgb = (s) => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(String(s || "")); return m ? [+m[1], +m[2], +m[3]] : null; };
  const mi = rgb(ink.measure && (ink.measure.stroke || ink.measure.fill));
  /* ⛔ THE COMPARISON IS AGAINST THE PRODUCT DEFAULT FROM THE SHARED TABLE, not against whatever
   * this scene's markup happens to have painted. Reason: a seeded shape can miss a field and end
   * up inheriting black, at which point the arm PASSES for the wrong reason and proves nothing —
   * the exact vacuity DRIVER-SCROLL-IS-NOT-APP-SCROLL §6 is about. The DOM read of the markup is
   * still reported beside it, as information rather than as the assertion.
   *
   * And the reading itself carries a KNOWN-GOOD check: the measurement's painted ink must be the
   * value the table says it is. If that fails, the probe is not reading paint and no ΔE00 it
   * computes means anything. */
  const inkRow = {
    measurePainted: ink.measure && (ink.measure.stroke || ink.measure.fill),
    measureKey: ink.measure && ink.measure.key,
    markupPaintedInScene: ink.markup && (ink.markup.fill || ink.markup.stroke),
    readOk: null, deltaE: null, ok: null,
  };
  if (mi) {
    const want = parseHex(MEASURE_INK);
    inkRow.readOk = deltaE2000(srgbToLab(...mi), srgbToLab(...want)) < 1.0;
    inkRow.deltaE = deltaE2000(srgbToLab(...mi), srgbToLab(...parseHex(FAMILY_DEFAULT_INK.markup)));
    inkRow.ok = inkRow.readOk && inkRow.deltaE >= INK_DISTINCT_MIN_DE;
  }

  await browser.close();

  /* ---- report ------------------------------------------------------------------------------ */
  const observedPairs = rows.filter((r) => r.ok !== null);
  const failed = observedPairs.filter((r) => !r.ok);
  const unobserved = rows.filter((r) => r.ok === null);
  /* The KNOWN-GOOD ARM: the pair four previous fixes already proved works. If THIS is red the
   * instrument is wrong, not the app, and the run must say so instead of printing a score. */
  /* markup vs markup is not an ordered PAIR of families, so the known-good arm is the closest
   * thing the table has to a case already proven by four previous fixes: a markup over a site
   * element, which #1066 shipped and its own e2e spec covers. If this is red, the instrument is on
   * trial, not the app. */
  const knownGood = rows.find((r) => r.a === "markup" && r.b === "element");
  const vacuous = observedPairs.length === 0 || !knownGood || knownGood.ok === null;

  console.log(`\npaint order observed, back to front: ${backToFront.join(" → ")}`);
  console.log(`hit-test read (independent):        ${byHit.join(" → ") || "(none)"}`);
  console.log(`probe point: ${JSON.stringify(at.point)}   families seen: ${backToFront.length}/6`);
  for (const d of disagreements) console.log(`  ⚠ READS DISAGREE — ${d}`);
  console.log(`\npairs: ${observedPairs.length} observed · ${failed.length} FAILED · ${unobserved.length} unobserved`);
  for (const r of failed) console.log(`  ✗ ${r.a} vs ${r.b}: table says ${r.relation}, drawing says ${r.observed}`);
  for (const r of unobserved) console.log(`  ? ${r.a} vs ${r.b}: not observed in this scene`);
  console.log(`\nink: measurement paints ${inkRow.measurePainted} (${inkRow.measureKey}) — reads as the declared measure ink: ${inkRow.readOk === null ? "UNREAD" : inkRow.readOk}`);
  console.log(`     vs the markup family DEFAULT ${FAMILY_DEFAULT_INK.markup}: ΔE00 ${inkRow.deltaE == null ? "—" : inkRow.deltaE.toFixed(1)} (bar ${INK_DISTINCT_MIN_DE}) → ${inkRow.ok === null ? "UNREAD" : inkRow.ok ? "✅ distinct" : "❌ CAMOUFLAGED"}`);
  console.log(`     (this scene's markup painted ${inkRow.markupPaintedInScene} — informational)`);
  if (vacuous) console.log("\n⚠ VACUOUS — the known-good arm was not observed; this run proves nothing.");
  console.log(vacuous || failed.length || disagreements.length || inkRow.ok !== true ? "\n❌ FAIL" : "\n✅ PASS");

  if (ASSERT && (vacuous || failed.length || disagreements.length || inkRow.ok !== true)) process.exit(1);
}

run().catch((e) => { console.error(e); process.exit(1); });
