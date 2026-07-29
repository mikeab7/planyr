/* NEW-9 — "I'd like an option to put it on the center line… that's what I thought this would do, but
 * it's not putting it there" (owner, 2026-07-25).
 *
 * Renders the owner's labelled road through the REAL canvas once per placement — each in its own
 * freshly-seeded page, because the harness's init script re-seeds localStorage on every navigation
 * (a reload would silently revert the setting and every placement would measure identically) — and
 * compares each label's ANCHOR instance-by-instance. Reading the <text> x/y attributes is exact;
 * a rotated bounding box is perturbed by the halo stroke and baseline rounding. */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync, readFileSync } from "node:fs";
const OUT = new URL("./screens/road-junctions/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const fixture = JSON.parse(readFileSync(new URL("./fixtures/tsakiris-concept-a-live.json", import.meta.url), "utf8"));
const SITE_ID = "tsakiris-concept-a";
const CX = 1645, CY = 50, PPF = 0.6;                       // the straight, near-vertical east leg
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
const errs = [];

async function anchorsFor(place, shot) {
  const els = fixture.els.map((e) => (e.id === "e38duuwgj"
    ? { ...e, inlineLabel: "BAUER HOCKLEY", labelSpacing: 600, labelPlace: place, labelInside: place === "inside" } : e));
  const site = { id: SITE_ID, groupId: SITE_ID, site: "Tsakiris", name: "Concept A", origin: null, county: "waller",
    parcels: [], els, measures: [], callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now() };
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(`(() => { try {
    window.__PLANYR_E2E = true;
    localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [SITE_ID]: site })}));
    localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(SITE_ID)});
  } catch (e) {} })();`);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto("http://localhost:4173/", { waitUntil: "load" });
  await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 20000 });
  await page.waitForFunction(() => !!window.__plannerView, null, { timeout: 20000 });
  await page.evaluate(([x, y, p]) => window.__plannerView.centerOn(x, y, p), [CX, CY, PPF]);
  await page.waitForTimeout(500);
  const anchors = await page.evaluate(() => {
    const svg = document.querySelector('[data-testid="planner-canvas"]');
    return [...svg.querySelectorAll("text")].filter((t) => t.textContent === "BAUER HOCKLEY")
      .map((t) => ({ x: +t.getAttribute("x"), y: +t.getAttribute("y") }))
      .sort((a, b) => a.y - b.y || a.x - b.x);
  });
  if (shot) await page.locator('[data-testid="planner-canvas"]').screenshot({ path: `${OUT}${shot}` });
  await ctx.close();
  return anchors;
}

const center = await anchorsFor("center", "label-on-centerline.png");
const off = await anchorsFor("off");
const inside = await anchorsFor("inside");
for (const [k, v] of [["center", center], ["off", off], ["inside", inside]]) console.log(`${k.padEnd(7)} → ${v.length} labels`);

let ok = true;
if (!center.length || center.length !== off.length || center.length !== inside.length) {
  console.log("FAIL — the placements rendered different label counts, so they can't be compared instance-by-instance"); ok = false;
} else {
  const shift = (a, b) => a.map((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y));
  const minOff = Math.min(...shift(off, center)), minIn = Math.min(...shift(inside, center));
  console.log(`\n  "just beside" moves every label at least ${minOff.toFixed(1)}px away from the centred position`);
  console.log(`  "inside"      moves every label at least ${minIn.toFixed(1)}px away from the centred position`);
  const minBoth = Math.min(...shift(inside, off));
  console.log(`  "inside" vs "just beside": at least ${minBoth.toFixed(1)}px apart`);
  if (!(minOff > 3)) { console.log('FAIL — "just beside the line" lands exactly where "on the centre line" does, so centring changed nothing'); ok = false; }
  else console.log('✓ "on the centre line" is a REAL third position, not the old just-off-the-line one');
  // NOTE: which of "beside" and "inside" sits further out is ZOOM-DEPENDENT and always was — "beside"
  // is a font-height clearance (screen px) while "inside" is a quarter of the road's width (feet), so
  // on a wide road zoomed in "inside" is further, and zoomed out it is nearer. Asserting an order
  // between those two would be asserting a zoom. What must hold is that all three are DISTINCT.
  if (!(minIn > 3 && minBoth > 3)) { console.log('FAIL — the three positions are not all distinct'); ok = false; }
  else console.log('✓ all three positions are distinct places on the drawing');
}
if (errs.length) { console.log("PAGE ERRORS:\n" + errs.slice(0, 3).join("\n")); ok = false; }
console.log(ok ? "\nall checks passed" : "\nFAILED");
await browser.close();
process.exit(ok ? 0 : 1);
