/* Self-verification for B542 + B543 — the Selected · Building massing panel.
 *
 * Seeds the EXACT reported case: a single-load building with footprint w=328 × h=1159
 * (so h>w → docks ride the left/right walls → depth = the horizontal span = 328, length
 * = the vertical span = 1159), rotated 359° to prove rotation independence. Boots the
 * planner logged-out, selects the building, and reads the property panel:
 *
 *   B542 — the two plan dimensions read **Length 1159 / Depth 328** (dock-relative), never
 *          the old transposed "Width 328 / Depth 1159"; the word "Width" is gone for a
 *          building; rotation (359°) does not alter Length/Depth.
 *   B543 — the panel is grouped Footprint → Loading → Structure → Placement (in that order),
 *          every original control still present (Docks, Dock zones, Car parking, Bump-outs,
 *          Clear height, Slab, Rotation), Rotation last.
 *
 * Logged-out / this-device mode (no auth needed).
 * Run:  node ui-audit/verify-b542-b543-building-panel.mjs   (preview server on :4173)
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const DEMO_ID = "verify-b542";
// The reported building: 328 (w) × 1159 (h), single-load, dock on the right (a long wall),
// rotated 359°. Expect the panel to read Length 1159 / Depth 328 regardless of the rotation.
const els = [{ id: "b1", type: "building", cx: 0, cy: 0, w: 328, h: 1159, rot: 359, dock: "single", dockSide: "right" }];
const parcel = { id: "pc1", locked: false, points: [{ x: -340, y: -700 }, { x: 340, y: -700 }, { x: 340, y: 700 }, { x: -340, y: 700 }] };
const demoSite = {
  id: DEMO_ID, groupId: DEMO_ID, site: "Verify B542", name: "Plan 1",
  origin: null, county: null, parcels: [parcel], els, measures: [], callouts: [],
  markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [DEMO_ID]: demoSite })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(DEMO_ID)});
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1400);
try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (e) { console.warn("fit warn", e.message); }
await page.waitForTimeout(500);

// Find the building footprint rect (fill #f3ece1) and click it OFF-centre — the parcel
// acreage chip sits at the centroid (= the building centre here), so a dead-centre click
// grabs the chip instead. Clicking ~30% down the footprint clears it and selects the
// building; the select effect auto-opens the "props" left panel (SitePlanner.jsx ~L1800).
const bb = await page.evaluate(() => {
  const rects = [...document.querySelectorAll("svg rect")].filter((r) => (r.getAttribute("fill") || "").toLowerCase() === "#f3ece1");
  let best = null, area = 0;
  for (const r of rects) { const b = r.getBoundingClientRect(); if (b.width * b.height > area) { area = b.width * b.height; best = { x: b.x, y: b.y, w: b.width, h: b.height }; } }
  return best;
});
if (!bb) { console.log("✗ could not locate the building footprint on the canvas"); await browser.close(); process.exit(1); }
await page.mouse.click(bb.x + bb.w / 2, bb.y + bb.h * 0.78);
await page.waitForTimeout(400);

// Read the Selected · Building panel: every Field label + its input value, the group
// headers (in DOM order), and the section title.
const panel = await page.evaluate(() => {
  // The selected-element section is the props panel; find it by its title text.
  const titleEl = [...document.querySelectorAll("div,span,h1,h2,h3,h4")].find((e) => /^Selected · /.test((e.textContent || "").trim()) && e.children.length <= 2);
  const root = (() => {
    // climb to the panel container (the scrolling left menu)
    let n = titleEl;
    for (let i = 0; i < 6 && n; i++) n = n.parentElement;
    return n || document.body;
  })();
  // Field rows render <div ...><span>{label}</span>{control}</div>. Capture label→input value.
  const fields = {};
  for (const span of root.querySelectorAll("span")) {
    const t = (span.textContent || "").trim();
    if (!/\(ft\)|\(in\)|\(°\)|^Docks$/.test(t)) continue;
    const row = span.parentElement;
    const input = row && row.querySelector("input");
    const sel = row && row.querySelector("select");
    fields[t] = input ? input.value : sel ? sel.value : "(present)";
  }
  // Group headers: our grpHdr divs are uppercased single words.
  const headerTexts = [...root.querySelectorAll("div")]
    .map((d) => (d.children.length === 0 ? (d.textContent || "").trim() : ""))
    .filter((t) => ["Footprint", "Loading", "Structure", "Placement"].includes(t));
  // Feature rows (Dock zones / Car parking / Bump-outs) present as plain spans.
  const featLabels = [...root.querySelectorAll("span")].map((s) => (s.textContent || "").trim());
  const has = (t) => featLabels.includes(t);
  // Any stray "Width" label for this building?
  const hasWidth = [...root.querySelectorAll("span")].some((s) => /^Width \(ft\)$/.test((s.textContent || "").trim()));
  const title = (titleEl && titleEl.textContent || "").trim();
  return {
    title, fields, headerOrder: headerTexts, hasWidth,
    feats: { dockZones: has("Dock zones"), carParking: has("Car parking"), bumpOuts: has("Bump-outs") },
  };
});

await page.screenshot({ path: OUT + "b542-b543-building-panel.png" });

console.log("== Selected · Building panel ==");
console.log("  title:", panel.title);
console.log("  fields:", JSON.stringify(panel.fields));
console.log("  group order:", panel.headerOrder.join(" → "));
console.log("  feature rows:", JSON.stringify(panel.feats));
console.log("  has a 'Width (ft)' label:", panel.hasWidth);

let fail = 0;
const check = (cond, msg) => { console.log((cond ? "  ✓ " : "  ✗ ") + msg); if (!cond) fail++; };

// ---- B542: dock-relative Length/Depth, rotation-independent, no "Width" ----
check(/Selected · Building/.test(panel.title), "panel is the Selected · Building inspector");
check(panel.fields["Length (ft)"] === "1159", `Length reads 1159 (got ${panel.fields["Length (ft)"]})`);
check(panel.fields["Depth (ft)"] === "328", `Depth reads 328 — not the old transposed 1159 (got ${panel.fields["Depth (ft)"]})`);
check(!panel.hasWidth, "the word 'Width' is retired for a building");
check(!("Width (ft)" in panel.fields), "no Width field present");

// ---- B543: four concept groups in order, Rotation last, all controls present ----
check(JSON.stringify(panel.headerOrder) === JSON.stringify(["Footprint", "Loading", "Structure", "Placement"]),
  `groups are Footprint → Loading → Structure → Placement (got ${panel.headerOrder.join(", ")})`);
check(panel.fields["Docks"] === "single", "Docks control present (single-load)");
check(panel.feats.dockZones && panel.feats.carParking && panel.feats.bumpOuts, "Dock zones / Car parking / Bump-outs all present");
check("Clear height (ft)" in panel.fields, "Clear height present (Structure)");
check("Slab (in)" in panel.fields, "Slab present (Structure)");
check("Rotation (°)" in panel.fields, "Rotation present (Placement)");

console.log(fail === 0 ? "\n✓ ALL B542+B543 CHECKS PASSED" : `\n✗ ${fail} CHECK(S) FAILED`);
await ctx.close();
await browser.close();
process.exit(fail === 0 ? 0 : 1);
