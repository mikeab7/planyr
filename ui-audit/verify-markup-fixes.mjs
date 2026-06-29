/* Self-verification for the three owner-reported markup fixes:
 *   NEW-1 / B155 (open-path tranche): a Line markup grabs within ~6px of its body (fat hit-stroke),
 *                                     instead of forcing a pixel-perfect landing on the 2px stroke.
 *   NEW-2 / B564: a callout/text box has more generous horizontal padding by default.
 *   NEW-3 / B565: a native color picker applies LIVE (onInput) — the selected object recolors the
 *                 instant you click a swatch, not only when the dialog closes; one undo reverts it.
 *
 * All DOM/geometry-based, logged-out (no auth). Run with the preview server on :4173:
 *   npm run build && npx vite preview --port 4173 &   then   node ui-audit/verify-markup-fixes.mjs
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const DEMO_ID = "verify-markup-fixes";
// One horizontal line markup (NEW-1 grab + NEW-3 stroke color), two identical text boxes for the
// NEW-2 A/B: co_new takes the new default padX (14), co_old pins the OLD padX (8).
// Line placed OFF the parcel centroid (0,0) — the acreage chip renders above markups and sits on
// the centroid, so a centroid line would be unclickable in the test (a harness artifact, not a bug).
const markups = [
  { id: "ml1", kind: "line", a: { x: -250, y: -250 }, b: { x: 250, y: -250 }, stroke: "#c2410c", weight: 2, dash: "solid", fill: "#c2410c", fillOpacity: 0 },
];
const callouts = [
  { id: "co_new", box: { x: -300, y: 350 }, noLeader: true, text: "PADDING", size: 16 },
  { id: "co_old", box: { x: 300, y: 350 }, noLeader: true, text: "PADDING", size: 16, padX: 8 },
];
const parcel = { id: "pc1", locked: false, points: [{ x: -700, y: -600 }, { x: 700, y: -600 }, { x: 700, y: 600 }, { x: -700, y: 600 }] };
const demoSite = {
  id: DEMO_ID, groupId: DEMO_ID, site: "Verify Markup Fixes", name: "Plan 1",
  origin: null, county: null, parcels: [parcel], els: [], measures: [], callouts, markups,
  settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [DEMO_ID]: demoSite })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(DEMO_ID)});
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1500);
try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (e) { console.warn("fit warn", e.message); }
await page.waitForTimeout(600);

let fail = 0;
const ok = (label, cond) => { console.log(`  ${cond ? "✓" : "✗"} ${label}`); if (!cond) fail++; };
const panelText = () => page.evaluate(() => { const p = document.querySelector('[data-testid="property-panel"]'); return p ? p.textContent : ""; });

/* ---------------- NEW-1: Line grabs ~5px off its stroke ---------------- */
console.log("\n== NEW-1 (B155): a Line markup grabs within ~6px of its body ==");
const lineGeom = await page.evaluate(() => {
  const l = document.querySelector('line[stroke="#c2410c"]');
  if (!l) return null;
  const b = l.getBoundingClientRect();
  return { midX: b.x + b.width / 2, midY: b.y + b.height / 2, w: b.width };
});
ok("visible line markup rendered in the SVG", !!lineGeom && lineGeom.w > 50);
if (lineGeom) {
  // 5px BELOW the horizontal line: outside the 2px visible stroke, inside the 6px hit-stroke.
  await page.mouse.click(lineGeom.midX, lineGeom.midY + 5);
  await page.waitForTimeout(300);
  ok("click ~5px off the line selects it (panel shows 'Markup · Line')", /Markup · Line/.test(await panelText()));
  await page.screenshot({ path: OUT + "markup-line-selected.png" });

  // Bound the hit area: deselect, then a click 40px away must NOT select it.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  await page.mouse.click(lineGeom.midX, lineGeom.midY + 40);
  await page.waitForTimeout(250);
  ok("click ~40px away does NOT select it (hit area is bounded, not infinite)", !/Markup · Line/.test(await panelText()));
}

/* ---------------- NEW-3: color picker applies live (onInput) ---------------- */
console.log("\n== NEW-3 (B565): a color picker recolors the selection live, one-step undo ==");
// Re-select the line so the 'Line color' picker is in the panel.
await page.mouse.click(lineGeom.midX, lineGeom.midY + 4);
await page.waitForTimeout(300);
const hasLineColor = /Line color/.test(await panelText());
ok("selecting the line shows its 'Line color' picker", hasLineColor);

const NEW_COLOR = "#1e90ff";
const liveResult = await page.evaluate((nc) => {
  const inp = document.querySelector('[data-testid="property-panel"] input[type="color"]');
  if (!inp) return { found: false };
  const before = (document.querySelector('g > line[pointer-events="none"]') || {}).getAttribute?.("stroke") || null;
  // React-compatible live event: set value via the native setter, then dispatch `input` (NOT change).
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(inp, nc);
  inp.dispatchEvent(new Event("input", { bubbles: true }));
  return { found: true, before };
}, NEW_COLOR);
ok("'Line color' picker present in panel", liveResult.found);
await page.waitForTimeout(250);
// Read the visible markup line's stroke AFTER the input event (no `change`/close fired yet).
const strokeAfter = await page.evaluate(() => {
  const vis = [...document.querySelectorAll("g line")].find((l) => l.getAttribute("pointer-events") === "none");
  return vis ? vis.getAttribute("stroke") : null;
});
const norm = (s) => (s || "").toLowerCase().replace(/\s+/g, "");
ok(`the selected line recolors LIVE on input (stroke now ${NEW_COLOR})`, norm(strokeAfter) === norm(NEW_COLOR));
await page.screenshot({ path: OUT + "markup-color-live.png" });

// One undo reverts the whole pick in a single step (not a frame per swatch).
await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
await page.waitForTimeout(300);
const strokeAfterUndo = await page.evaluate(() => {
  const vis = [...document.querySelectorAll("g line")].find((l) => l.getAttribute("pointer-events") === "none");
  return vis ? vis.getAttribute("stroke") : null;
});
ok("a single undo reverts the color to the original #c2410c", norm(strokeAfterUndo) === norm("#c2410c"));

/* ---------------- NEW-2: callout horizontal padding more generous ---------------- */
console.log("\n== NEW-2 (B564): callout/text box horizontal padding is more generous by default ==");
const pads = await page.evaluate(() => {
  // Each text box is <g><rect/><text>PADDING</text></g>. Measure left inset (text.left - rect.left)
  // for the new-default box vs the explicit padX:8 box; the new one must be wider-padded.
  const groups = [...document.querySelectorAll("svg g")];
  const found = [];
  for (const g of groups) {
    const rect = g.querySelector(":scope > rect");
    const txt = [...g.querySelectorAll(":scope > text")].find((t) => (t.textContent || "").trim() === "PADDING");
    if (rect && txt) {
      const rb = rect.getBoundingClientRect(), tb = txt.getBoundingClientRect();
      found.push({ left: tb.left - rb.left, right: rb.right - tb.right, top: tb.top - rb.top, rw: rb.width });
    }
  }
  // Sort by x so we know which is which is not reliable; return all, the test picks min/max.
  return found;
});
ok("both PADDING text boxes measured", pads.length >= 2);
if (pads.length >= 2) {
  const insets = pads.map((p) => (p.left + p.right) / 2).sort((a, b) => a - b);
  const oldInset = insets[0], newInset = insets[insets.length - 1];
  console.log(`    horizontal inset: old(padX:8)=${oldInset.toFixed(1)}px  new(default)=${newInset.toFixed(1)}px`);
  ok("new-default horizontal padding > old padX:8 padding (default was bumped)", newInset > oldInset + 2);
  await page.screenshot({ path: OUT + "callout-padding.png" });
}

console.log(`\n${fail === 0 ? "✅ ALL PASS" : `❌ ${fail} CHECK(S) FAILED`}`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
