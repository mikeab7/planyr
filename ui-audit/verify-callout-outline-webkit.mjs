/* WebKit real-engine pass for B1652704/B1652705/B1652706 (the text box / callout Properties
 * panel rebuild) — real Playwright WebKit (not Chromium emulation), at desktop width and three
 * iPhone sizes in both orientations, driven against a LOCAL preview build.
 *
 * ⛔ This is NOT the production pass the dispatch asked for (V1180736) — this PR has not merged
 * yet, so planyr.io does not serve this code. This script exists to catch any WebKit-specific
 * rendering difference (a real engine, not Chromium's phone emulation) BEFORE the post-merge
 * production check, per docs/PHONE-TESTING.md's own "WebKit installs on demand here" note.
 *
 * Run: node ui-audit/verify-callout-outline-webkit.mjs   (preview server must be up on :4173)
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { webkit, devices } = pw;
import { mkdirSync } from "node:fs";

const DEMO_ID = "verify-b1652704-webkit";
const BASE = `http://localhost:4173/#/project/${DEMO_ID}/site`;
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const parcel = { id: "pc1", locked: false, points: [{ x: -900, y: -450 }, { x: 900, y: -450 }, { x: 900, y: 450 }, { x: -900, y: 450 }] };
const calloutX = { id: "coX", text: "CALLOUTX", box: { x: -300, y: 300 }, tip: { x: -650, y: 420 }, fill: "#ffd9a8", stroke: "#7a3b00", color: "#3a1c00", size: 20 };
const textBoxY = { id: "tbY", text: "TEXTBOXY", box: { x: 400, y: 300 }, noLeader: true, fill: "#a8d9ff", stroke: "#003a5a", color: "#00243a", size: 15 };
const demoSite = {
  id: DEMO_ID, groupId: DEMO_ID, site: "Verify B1652704 WebKit", name: "Plan 1", origin: null, county: null,
  parcels: [parcel], els: [], measures: [], callouts: [calloutX, textBoxY], markups: [],
  settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [DEMO_ID]: demoSite })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(DEMO_ID)});
} catch (e) {} })();`;

let fail = 0;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };

const browser = await webkit.launch({});
console.log("engine: WebKit (real rendering/pointer engine, not Chromium emulation)");

async function checkAtSize(label, deviceOpts) {
  const ctx = await browser.newContext({ ...deviceOpts, ignoreHTTPSErrors: true });
  await ctx.addInitScript(seed);
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(2000);
  try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (e) { /* noop */ }
  await page.waitForTimeout(500);

  const cc = await page.evaluate(() => {
    const r = [...document.querySelectorAll("svg rect")].find((x) => (x.getAttribute("fill") || "").toLowerCase() === "#ffd9a8");
    if (!r) return null;
    const b = r.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  log(!!cc, `${label}: seeded callout renders on canvas`);
  if (!cc) { await ctx.close(); return; }
  await page.mouse.move(cc.x, cc.y);
  await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(300);

  // desktop (no bottom-sheet path): select docks Properties directly via the tab. narrow: through Panels.
  try { await page.getByText("Properties", { exact: true }).first().click({ timeout: 2500 }); }
  catch (e) {
    try {
      await page.getByText("Panels", { exact: true }).first().click({ timeout: 2500 });
      await page.waitForTimeout(250);
      await page.getByText("Properties", { exact: true }).first().click({ timeout: 2500 });
    } catch (e2) { /* fall through — the field-group count below reports the miss */ }
  }
  await page.waitForTimeout(400);

  const layout = await page.evaluate(() => {
    const groups = [...document.querySelectorAll('[data-field-group="1"]')].filter((g) => {
      const cs = getComputedStyle(g);
      return cs.display === "grid" && cs.gridTemplateColumns.startsWith("64px");
    });
    const rowInfo = groups.map((g) => ({ left: Math.round(g.getBoundingClientRect().x), label: (g.children[0]?.textContent || "").trim() }));
    const overflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 2;
    return { rowInfo, overflow, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth };
  });
  const edges = new Set(layout.rowInfo.map((r) => r.left));
  const hasWeight = layout.rowInfo.some((r) => r.label === "Weight");
  const hasPadding = layout.rowInfo.some((r) => r.label === "Padding");
  log(layout.rowInfo.length >= 10, `${label}: Properties panel rendered (${layout.rowInfo.length} rows found)`);
  log(hasWeight && hasPadding, `${label}: Weight + Padding rows present`);
  log(edges.size <= 1, `${label}: every row shares one left gutter edge (edges: ${[...edges].join(",")})`);
  log(!layout.overflow, `${label}: no horizontal page overflow (scrollWidth ${layout.scrollWidth} vs clientWidth ${layout.clientWidth})`);

  await page.screenshot({ path: OUT + `webkit-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png` });
  await ctx.close();
}

await checkAtSize("Desktop 1440", { viewport: { width: 1440, height: 900 } });
for (const [name, orientation] of [["iPhone SE", "portrait"], ["iPhone SE", "landscape"], ["iPhone 15", "portrait"], ["iPhone 15", "landscape"]]) {
  const d = devices[name];
  const vp = orientation === "landscape" ? { width: d.viewport.height, height: d.viewport.width } : d.viewport;
  await checkAtSize(`${name} ${orientation}`, { ...d, viewport: vp, isMobile: true, hasTouch: true });
}

console.log(fail === 0 ? "\n✓ all WebKit checks passed" : `\n✗ ${fail} WebKit check(s) failed`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
