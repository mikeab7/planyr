/* Self-verification for B1805808 — a "paving" (truck court / drive aisle) element's properties
 * panel: Width (ft) stays an editable input, Depth (ft) becomes a read-only display. Checks BOTH
 * a freestanding Paving/Drive element and an auto-generated split-parking drive aisle (attachedTo
 * a building, sideParkSide set) — the two cases the bug named. */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const DEMO_ID = "verify-paving-depth";
const els = [
  { id: "b1", type: "building", cx: -900, cy: 0, w: 300, h: 150, rot: 0, dock: "cross" },
  // freestanding Paving/Drive element, untouched by any host
  { id: "pav1", type: "paving", cx: 400, cy: 0, w: 60, h: 200, rot: 0 },
  // auto-generated drive-aisle shape: attached, sideParkSide set, no truckCourt/forCourt/forTrailer
  { id: "pav2", type: "paving", cx: -900, cy: 220, w: 300, h: 26, rot: 0, attachedTo: "b1", sideParkSide: "bottom", sideParkPiece: 0 },
];
const parcel = { id: "pc1", locked: false, points: [{ x: -1400, y: -700 }, { x: 900, y: -700 }, { x: 900, y: 700 }, { x: -1400, y: 700 }] };
const demoSite = {
  id: DEMO_ID, groupId: DEMO_ID, site: "Verify Paving Depth", name: "Plan 1",
  origin: null, county: null, parcels: [parcel], els, measures: [], callouts: [],
  markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [DEMO_ID]: demoSite })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(DEMO_ID)});
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.25, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
await assertMeasurable(page, "verify-paving-depth-readonly");
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
// Resource-load noise (ERR_TUNNEL_CONNECTION_FAILED etc.) comes from this sandbox's egress
// policy blocking Supabase/GIS hosts — unrelated to this UI check; only real JS errors matter here.
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1000);
await page.evaluate((g) => { window.location.hash = `#/project/${g}/site`; }, DEMO_ID);
await page.waitForTimeout(1400);
try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (e) { console.warn("fit warn", e.message); }
await page.waitForTimeout(500);

// select an element by id via the app's own model — click its rendered node on canvas.
const clickElementById = async (id) => {
  const box = await page.evaluate((elId) => {
    const node = document.querySelector(`[data-feature="el:${elId}"]`) || document.querySelector(`[data-el-id="${elId}"]`);
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
  }, id);
  if (!box) return false;
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(300);
  try { await page.getByText("Properties", { exact: true }).click({ timeout: 3000 }); } catch (e) { /* already open */ }
  await page.waitForTimeout(300);
  return true;
};

const readFields = async () => page.evaluate(() => {
  const out = {};
  for (const g of document.querySelectorAll('[data-field-group="1"]')) {
    const label = g.children[0]?.textContent?.trim();
    if (!label) continue;
    const valueHost = g.children[1];
    const input = valueHost?.querySelector("input");
    out[label] = input
      ? { kind: "input", value: input.value, disabled: input.disabled, readOnly: input.readOnly }
      : { kind: "span", text: valueHost?.textContent?.trim() };
  }
  return out;
});

const ALL_IDS = ["pav1", "pav2"];
const results = {};
for (const id of ALL_IDS) {
  const sel = await clickElementById(id);
  if (!sel) { results[id] = { error: "could not select element" }; continue; }
  const fields = await readFields();
  results[id] = { width: fields["Width (ft)"], depth: fields["Depth (ft)"] };
}

console.log(JSON.stringify({ results, errors }, null, 2));

let pass = true;
// pav1/pav2 (paving): Depth becomes read-only, Width stays editable.
for (const id of ["pav1", "pav2"]) {
  const r = results[id];
  if (!r || r.error) { console.error(`✗ ${id}: ${r?.error || "no result"}`); pass = false; continue; }
  const widthOk = r.width?.kind === "input" && !r.width.disabled && !r.width.readOnly;
  const depthOk = r.depth?.kind === "span";
  console.log(`${id}: Width ${widthOk ? "✓ editable input" : "✗ NOT editable input"} · Depth ${depthOk ? "✓ read-only span" : "✗ NOT read-only"}`);
  if (!widthOk || !depthOk) pass = false;
}
if (errors.length) { console.error("Console/page errors:", errors); pass = false; }

await browser.close();
if (!pass) { console.error("FAIL"); process.exit(1); }
console.log("PASS");
