/* Self-verification: trailer parking tracks the truck court across bump-out changes.
 *
 * The reported bug: after adding corner bump-outs the TRUCK COURT pulls in to the clear dock face
 * between them, but the TRAILER PARKING kept the full wall length and over-hung the court (visible in
 * the owner's screenshot — the striped trailer row stuck out past the end of the paving). The fix:
 * every zone stacked outward from the dock face (trailer parking, buffer, …) follows the court's
 * clear span + centre shift, so the trailer never over-hangs the court and "varies like the court"
 * as bump-outs are added or subtracted.
 *
 * Ground truth = the persisted element list (feet, exact) read back from localStorage after each UI
 * action. Logged-out / this-device mode (no auth). Preview server must be on :4173.
 * Run:  node ui-audit/verify-trailer-tracks-court.mjs
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

// Cross-dock 600×300 building (docks on the long top/bottom walls). No stack seeded — we walk it
// out through the real UI ("Extend every dock side": court, then trailer) so the geometry is the
// app's own, exactly as a user would build it.
const DEMO_ID = "verify-trailer-court";
const els = [{ id: "b1", type: "building", cx: 0, cy: 0, w: 600, h: 300, rot: 0, dock: "cross" }];
const parcel = { id: "pc1", locked: false, points: [{ x: -800, y: -560 }, { x: 800, y: -560 }, { x: 800, y: 560 }, { x: -800, y: 560 }] };
const demoSite = {
  id: DEMO_ID, groupId: DEMO_ID, site: "Verify trailer↔court", name: "Plan 1",
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
const near = (a, b, eps = 3) => Math.abs(a - b) <= eps;

const readEls = async (pred = () => true, tries = 14) => {
  for (let i = 0; i < tries; i++) {
    const got = await page.evaluate((id) => {
      try { const m = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"); return (m[id] && m[id].els) || null; } catch (e) { return null; }
    }, DEMO_ID);
    if (got && pred(got)) return got;
    await page.waitForTimeout(300);
  }
  return await page.evaluate((id) => { try { const m = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"); return (m[id] && m[id].els) || []; } catch (e) { return []; } }, DEMO_ID);
};
const topCourt = (a) => a.find((x) => x.truckCourt && x.truckCourt.side === "top") || {};
const topTrailer = (a) => { const c = topCourt(a); return a.find((x) => x.type === "trailer" && x.forCourt === c.id) || {}; };

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
  await page.waitForTimeout(380);
  if (!r && !optional) throw new Error("control not found: " + re);
  return r;
};

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

// ---- walk the stack outward: click "Extend every dock side" twice → court, then trailer ----
await clickByTitle(/Extend every dock side/);
await readEls((a) => a.some((x) => x.truckCourt));
await selectBuilding();
await clickByTitle(/Extend every dock side/);
let e0 = await readEls((a) => a.some((x) => x.type === "trailer" && x.forCourt));
const c0 = topCourt(e0), t0 = topTrailer(e0);
log(near(c0.w, 600), `baseline: top truck court spans the full 600′ wall (w=${(c0.w || 0).toFixed(0)})`);
log(near(t0.w, 600), `baseline: top trailer parking spans the full 600′ wall (w=${(t0.w || 0).toFixed(0)})`);
log(near(t0.w, c0.w) && near(t0.cx, c0.cx), `baseline: trailer is flush with the court (Δw=${Math.abs((t0.w||0)-(c0.w||0)).toFixed(1)}, Δcx=${Math.abs((t0.cx||0)-(c0.cx||0)).toFixed(1)})`);
await page.screenshot({ path: OUT + "trailer-court-0-baseline.png" });

// ---- add bump-outs: BOTH the court and the trailer pull in to the clear face ----
await selectBuilding();
await clickByTitle(/Add dock-corner bump-outs/);
let e1 = await readEls((a) => a.some((x) => x.dogEar) && near(topCourt(a).w, 490, 6));
const c1 = topCourt(e1), t1 = topTrailer(e1);
log(near(c1.w, 490), `THE FIX — court pulls in between the two 55′ bumps: 600→${(c1.w || 0).toFixed(0)}′ (expect 490)`);
log(near(t1.w, 490), `THE FIX — TRAILER pulls in to match the court: 600→${(t1.w || 0).toFixed(0)}′ (expect 490, was 600 = the bug)`);
log(near(t1.w, c1.w), `trailer width tracks the court (Δw=${Math.abs((t1.w||0)-(c1.w||0)).toFixed(1)}′, was 110′ over)`);
log(near(t1.cx, c1.cx), `trailer stays centred on the court's clear face (Δcx=${Math.abs((t1.cx||0)-(c1.cx||0)).toFixed(1)}′)`);
await page.screenshot({ path: OUT + "trailer-court-1-bumps.png" });

// ---- remove bump-outs: court AND trailer snap back together ----
await selectBuilding();
await clickByTitle(/Remove all bump-outs/);
let e2 = await readEls((a) => !a.some((x) => x.dogEar));
const c2 = topCourt(e2), t2 = topTrailer(e2);
log(near(c2.w, 600), `removing bumps: court re-expands to the full wall (${(c2.w || 0).toFixed(0)}′)`);
log(near(t2.w, 600) && near(t2.w, c2.w), `removing bumps: trailer re-expands WITH the court (${(t2.w || 0).toFixed(0)}′)`);
await page.screenshot({ path: OUT + "trailer-court-2-removed.png" });

console.log(errors.length ? `\nPAGE ERRORS:\n${errors.slice(0, 8).join("\n")}` : "\n(no page errors)");
console.log(fail === 0 ? "\n✓ ALL TRAILER↔COURT CHECKS PASSED" : `\n✗ ${fail} CHECK(S) FAILED`);
await ctx.close();
await browser.close();
process.exit(fail === 0 ? 0 : 1);
