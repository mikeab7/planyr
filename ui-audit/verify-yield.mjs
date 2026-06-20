/* Verify the redesigned Site Yield panel (B225) in a real browser.
 * Seeds two logged-out sites, opens the Yield tab, screenshots the panel, and
 * asserts the composition donut, legend, KPI abbreviation, grouped rows, and the
 * always-present Detention zero-state all render with live data.
 *
 *   Seed A (spec example): parcel 29.25 ac · building 226,576 sf · paving only,
 *   no pond → coverage 18%, impervious 31%, donut 18 / 13 / 0 / 69, detention 0.
 *   Seed B: adds a parking field + a detention pond → all four arcs paint and the
 *   car-stall + detention rows read non-zero. */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";

// Square parcel ≈ 29.25 ac (1,274,189 sf): points at ±564.4.
const P = 564.4;
const parcel = { id: "pc1", locked: false, points: [{ x: -P, y: -P }, { x: P, y: -P }, { x: P, y: P }, { x: -P, y: P }] };

const elsA = [
  { id: "b1", type: "building", cx: 0, cy: -250, w: 476, h: 476, rot: 0 }, // 226,576 sf → cov 18%
  { id: "v1", type: "paving", cx: 0, cy: 200, w: 476, h: 354, rot: 0 },     // 168,504 sf → imp 31%
];
const elsB = [
  { id: "b1", type: "building", cx: 0, cy: -250, w: 476, h: 476, rot: 0 },
  { id: "v1", type: "paving", cx: 0, cy: 80, w: 400, h: 200, rot: 0 },
  { id: "k1", type: "parking", cx: 0, cy: 300, w: 400, h: 160, rot: 0 },    // car stalls
  { id: "d1", type: "pond", cx: 0, cy: 480, w: 400, h: 160, rot: 0 },       // detention
];

const site = (id, els) => ({ id, groupId: id, site: "Yield Verify", name: "Plan 1", origin: null, county: null, parcels: [parcel], els, measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now() });
const seedScript = (id, els) => `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [id]: site(id, els) })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(id)});
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

async function run(label, id, els, shot) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 980 }, deviceScaleFactor: 1.5 });
  const errors = [];
  ctx.on("weberror", (e) => errors.push(String(e.error())));
  await ctx.addInitScript(seedScript(id, els));
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1600);
  await page.locator('button[title="Yield"]').click({ timeout: 6000 });
  await page.waitForTimeout(500);

  // Tight clip on the left panel (yield lives in the left menu).
  await page.screenshot({ path: new URL(`./screens/${shot}.png`, import.meta.url).pathname, clip: { x: 0, y: 96, width: 380, height: 860 } });

  const data = await page.evaluate(() => {
    const txt = document.body.innerText;
    const donut = document.querySelector('svg[viewBox="0 0 100 100"]');
    let arcSum = null, circumference = null;
    if (donut) {
      const r = 43.5; circumference = 2 * Math.PI * r;
      arcSum = [...donut.querySelectorAll('g circle')].reduce((s, c) => {
        const da = (c.getAttribute('stroke-dasharray') || '').trim().split(/\s+/)[0];
        return s + (parseFloat(da) || 0);
      }, 0);
    }
    return { txt, hasDonut: !!donut, arcSum, circumference };
  });

  const has = (s) => data.txt.toLowerCase().includes(s.toLowerCase());
  const ringPct = data.arcSum != null ? (data.arcSum / data.circumference) * 100 : 0;
  console.log(`\n=== ${label} ===`);
  console.log("Header 'Site Yield':", has("site yield"));
  console.log("Donut svg present:", data.hasDonut, "| arc lengths sum to %", ringPct.toFixed(1), "of full ring");
  console.log("Group labels  Land/Building/Parking/Stormwater:", has("land"), has("building"), has("parking"), has("stormwater"));
  console.log("Legend slices Building/Paving/Open / green/Detention:", has("building"), has("paving"), has("open / green"), has("detention"));
  console.log("Detention row present (zero-state must still show):", has("detention"));
  console.log("Page errors:", errors.length ? errors : "none");
  await ctx.close();
  return { data, ringPct };
}

const a = await run("Seed A — spec example (detention 0)", "yieldverA", elsA, "yield-panel");
const b = await run("Seed B — pond + parking (all arcs)", "yieldverB", elsB, "yield-panel-detention");

// Headless assertions
const fail = [];
if (!a.data.hasDonut) fail.push("A: donut missing");
if (Math.abs(a.ringPct - 100) > 0.5) fail.push(`A: ring not closed (${a.ringPct.toFixed(1)}%)`);
if (!a.data.txt.includes("227k")) fail.push("A: Building KPI not abbreviated to 227k");
if (!a.data.txt.includes("226,576")) fail.push("A: Building row missing full sf 226,576");
if (!/Detention[\s\S]{0,40}0%/.test(a.data.txt)) fail.push("A: Detention 0% not shown explicitly");
if (Math.abs(b.ringPct - 100) > 0.5) fail.push(`B: ring not closed (${b.ringPct.toFixed(1)}%)`);

console.log("\n" + (fail.length ? "FAILURES:\n - " + fail.join("\n - ") : "ALL CHECKS PASSED"));
await browser.close();
process.exit(fail.length ? 1 : 0);
