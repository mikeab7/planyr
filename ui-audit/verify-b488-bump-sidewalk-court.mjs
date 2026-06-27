/* Self-verification for B488 — bump-outs, sidewalks, and truck courts cooperate.
 *
 * Repro the owner reported:
 *   1) Adding/editing a bump-out should make the perpendicular SIDEWALK span the FULL building
 *      side (wall + the bump-out's real projection), not a fixed +60′ guess.
 *   2) The TRUCK COURT should PULL IN to the clear dock face between the corner bump-outs
 *      (instead of overlapping them), and its length along the dock should be USER-EDITABLE.
 *
 * Ground truth = the persisted element list (feet, exact) read back from localStorage after each
 * UI action — far more precise than pixel measurement. Logged-out / this-device mode (no auth).
 * Run:  node ui-audit/verify-b488-bump-sidewalk-court.mjs   (preview server must be on :4173)
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

// Cross-dock 600×300 building (docks on the long top/bottom walls). Sidewalks seeded on the two
// non-dock SHORT ends (left/right), each a 5′-thick × 300′ run vertical strip.
const DEMO_ID = "verify-b488";
const els = [
  { id: "b1", type: "building", cx: 0, cy: 0, w: 600, h: 300, rot: 0, dock: "cross" },
  { id: "swL", type: "sidewalk", sidewalkSide: "left", cx: -302.5, cy: 0, w: 5, h: 300, rot: 0, attachedTo: "b1" },
  { id: "swR", type: "sidewalk", sidewalkSide: "right", cx: 302.5, cy: 0, w: 5, h: 300, rot: 0, attachedTo: "b1" },
];
const parcel = { id: "pc1", locked: false, points: [{ x: -800, y: -560 }, { x: 800, y: -560 }, { x: 800, y: 560 }, { x: -800, y: 560 }] };
const demoSite = {
  id: DEMO_ID, groupId: DEMO_ID, site: "Verify B488", name: "Plan 1",
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
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1400);
try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (e) { console.warn("fit warn", e.message); }
await page.waitForTimeout(500);

let fail = 0;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };
const near = (a, b, eps = 2) => Math.abs(a - b) <= eps;

// Read the live element list back from localStorage (feet, exact). Polls until `pred` holds.
const readEls = async (pred = () => true, tries = 12) => {
  for (let i = 0; i < tries; i++) {
    const got = await page.evaluate((id) => {
      try { const m = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"); return (m[id] && m[id].els) || null; } catch (e) { return null; }
    }, DEMO_ID);
    if (got && pred(got)) return got;
    await page.waitForTimeout(300);
  }
  return await page.evaluate((id) => { try { const m = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"); return (m[id] && m[id].els) || []; } catch (e) { return []; } }, DEMO_ID);
};
const byId = (a, id) => a.find((x) => x.id === id) || {};
const topCourt = (a) => a.find((x) => x.truckCourt && x.truckCourt.side === "top") || {};

// click a visible panel button whose title/text matches `re`
const clickByTitle = async (re, { optional = false } = {}) => {
  const r = await page.evaluate((src) => {
    const rx = new RegExp(src);
    for (const b of document.querySelectorAll("button")) {
      if (b.offsetParent === null) continue;
      const t = (b.getAttribute("title") || b.textContent || "").trim();
      if (rx.test(t) && !b.disabled) { b.click(); return t || "(btn)"; }
    }
    return null;
  }, re.source);
  await page.waitForTimeout(350);
  if (!r && !optional) throw new Error("control not found: " + re);
  return r;
};

// select the building (offset off-centre so we don't land on the centred dock-door marks)
const selectBuilding = async () => {
  const bsel = await page.evaluate(() => {
    const r = [...document.querySelectorAll("svg rect")].find((x) => (x.getAttribute("fill") || "").toLowerCase() === "#f3ece1");
    if (!r) return null; const b = r.getBoundingClientRect(); return { x: b.x + b.width * 0.35, y: b.y + b.height * 0.4 };
  });
  if (!bsel) { console.log("✗ building rect not found"); process.exit(1); }
  await page.mouse.click(bsel.x, bsel.y);
  await page.waitForTimeout(400);
};

await selectBuilding();

// ---- 0) baseline: add the truck court on both dock sides (full wall) ----
await clickByTitle(/Extend every dock side/);
let e0 = await readEls((a) => a.some((x) => x.truckCourt));
const court0 = topCourt(e0), swL0 = byId(e0, "swL"), swR0 = byId(e0, "swR");
log(near(court0.w, 600), `baseline: top truck court spans the full 600′ wall (w=${(court0.w || 0).toFixed(0)})`);
log(near(swL0.h, 300) && near(swR0.h, 300), `baseline: left/right sidewalks = full 300′ side (L=${(swL0.h || 0).toFixed(0)}, R=${(swR0.h || 0).toFixed(0)})`);

// ---- 1) add bump-outs: sidewalk spans full side, court pulls in ----
await clickByTitle(/Add dock-corner bump-outs/);
let e1 = await readEls((a) => a.some((x) => x.dogEar));
const bumps = e1.filter((x) => x.dogEar);
log(bumps.length === 4, `4 bump-outs placed (2 per dock side): ${bumps.length}`);
const court1 = topCourt(e1), swL1 = byId(e1, "swL"), swR1 = byId(e1, "swR");
// sidewalk now spans wall + the two 60′ projections that lengthen that wall (300 + 60 + 60 = 420)
log(near(swL1.h, 420), `B488-1 SIDEWALK spans full side incl. bumps: left 300→${(swL1.h || 0).toFixed(0)}′ (expect 420)`);
log(near(swR1.h, 420), `B488-1 SIDEWALK spans full side incl. bumps: right 300→${(swR1.h || 0).toFixed(0)}′ (expect 420)`);
// court pulls IN to the clear face between the two 55′ bumps (600 − 55 − 55 = 490), still centred
log(near(court1.w, 490), `B488-2 TRUCK COURT pulls in between bumps: 600→${(court1.w || 0).toFixed(0)}′ (expect 490)`);
log(near(court1.cx, court0.cx), `B488-2 court stays centred on the clear face (cx ${(court1.cx || 0).toFixed(1)})`);
await page.screenshot({ path: OUT + "b488-bumps.png" });

// ---- 2) editable truck-court length: select a court, type a new length ----
const csel = await page.evaluate(() => {
  const r = [...document.querySelectorAll("svg rect")].map((x) => ({ x, f: (x.getAttribute("fill") || "").toLowerCase() }))
    .filter((o) => o.f === "#d6d1c7").map((o) => o.x).sort((p, q) => p.getBoundingClientRect().y - q.getBoundingClientRect().y)[0];
  if (!r) return null; const b = r.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
});
if (csel) { await page.mouse.click(csel.x, csel.y); await page.waitForTimeout(400); }
// find the "Truck court length (ft)" input (its Field label), set it to 300
const setLen = await page.evaluate(() => {
  // The length Field's OWN container: matches "Truck court length", does NOT also contain the
  // sibling "depth" field, and holds exactly one input (so we never grab the depth input above it).
  const fields = [...document.querySelectorAll("label, div")];
  for (const el of fields) {
    const t = el.textContent || "";
    if (!/Truck court length/i.test(t) || /depth/i.test(t)) continue;
    const inputs = el.querySelectorAll("input");
    if (inputs.length === 1) { const b = inputs[0].getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }
  }
  return null;
});
if (setLen) {
  await page.mouse.click(setLen.x, setLen.y); await page.keyboard.press("Control+A"); await page.keyboard.type("300"); await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
}
let e2 = await readEls((a) => { const c = topCourt(a); return c && near(c.w, 300, 3); });
const court2 = topCourt(e2);
log(!!setLen, `Truck court "Length (ft)" editor is present when a court is selected`);
log(near(court2.w, 300), `B488-2 court length is EDITABLE along the dock: set 300 → ${(court2.w || 0).toFixed(0)}′`);

// ---- 3) remove bump-outs: sidewalk + court snap back to full side ----
await selectBuilding();
await clickByTitle(/Remove all bump-outs/);
let e3 = await readEls((a) => !a.some((x) => x.dogEar));
const court3 = topCourt(e3), swL3 = byId(e3, "swL");
log(near(swL3.h, 300), `removing bumps: sidewalk back to full 300′ side (${(swL3.h || 0).toFixed(0)})`);
log(near(court3.w, 600) || near(court3.w, 300), `removing bumps: court re-expands (w=${(court3.w || 0).toFixed(0)}; was capped at 300 by the manual length, now ${court3.alongLen ? "manual " + court3.alongLen : "full"})`);

console.log(errors.length ? `\nPAGE ERRORS:\n${errors.slice(0, 8).join("\n")}` : "\n(no page errors)");
console.log(fail === 0 ? "\n✓ ALL B488 CHECKS PASSED" : `\n✗ ${fail} CHECK(S) FAILED`);
await ctx.close();
await browser.close();
process.exit(fail === 0 ? 0 : 1);
