/* Self-verification for B472 — the parking-field "Split rows/aisles" control now
 * EXPLODES a field into its individual stall rows + drive aisles, not coarse
 * double-loaded modules (the regression the owner reported as "the split tool is gone").
 *
 * Seeds a single rectangular double-loaded parking field (no building, for a clean
 * element count), opens the planner logged-out, selects the field by clicking it,
 * clicks "Split rows/aisles" (data-testid="split-parking"), then reads the persisted
 * els back from the logged-out localStorage mirror and asserts the explode shape:
 *
 *   • a 60' field (n=2, one double-loaded module) → 3 elements: 2 stall rows
 *     (type "parking") + 1 drive aisle (type "paving"), depths summing to 60' — the
 *     owner's "must split into three elements, not a 2-element module" case.
 *   • a 180' field (n=6, three modules) → 9 elements: 6 rows + 3 aisles (count scales).
 *
 * Logged-out / this-device mode (no auth needed).
 * Run:  node ui-audit/verify-b472-explode-parking.mjs   (preview server must be on :4173)
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

// Seed JUST the parking field — no parcel. Parking has no on-canvas label chip
// (it's in NO_LABEL), so after zoom-to-fit a centre click lands cleanly on the
// field and selects it (a parcel's centred area chip would intercept the click).
const seedFor = (h, demoId) => {
  const field = { id: "park1", type: "parking", cx: 0, cy: 0, w: 240, h, rot: 0 };
  const site = {
    id: demoId, groupId: demoId, site: "Verify B472", name: "Plan 1",
    origin: null, county: null, parcels: [], els: [field], measures: [], callouts: [],
    markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
  };
  return `(() => { try {
    localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [demoId]: site })}));
    localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(demoId)});
  } catch (e) {} })();`;
};

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

const run = async (h, demoId, shot) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5, ignoreHTTPSErrors: true });
  await ctx.addInitScript(seedFor(h, demoId));
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1400);
  try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (e) { console.warn("fit warn", e.message); }
  await page.waitForTimeout(500);
  // Select the field: click the centre of the planner canvas (the largest SVG on the
  // page; the field sits at cx/cy 0,0 → zoom-to-fit centres it there).
  const cbox = await page.evaluate(() => {
    let best = null, area = -1;
    for (const s of document.querySelectorAll("svg")) {
      const r = s.getBoundingClientRect(); const a = r.width * r.height;
      if (a > area) { area = a; best = { x: r.x, y: r.y, width: r.width, height: r.height }; }
    }
    return best;
  });
  if (cbox) await page.mouse.click(cbox.x + cbox.width / 2, cbox.y + cbox.height / 2);
  await page.waitForTimeout(400);
  const btn = page.locator('[data-testid="split-parking"]');
  const hasBtn = await btn.count();
  if (hasBtn) { await btn.first().click(); await page.waitForTimeout(1500); }
  await page.screenshot({ path: OUT + shot });
  // After the explode the first piece (a bare stall row) is auto-selected — it must
  // NOT re-offer the control (no infinite re-split / no zero-depth aisle).
  const afterBtn = await page.locator('[data-testid="split-parking"]').count();
  const els = await page.evaluate((id) => {
    try {
      const all = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
      const site = all[id];
      return (site && site.els) || [];
    } catch (e) { return []; }
  }, demoId);
  await ctx.close();
  return { hasBtn, afterBtn, els };
};

let fail = 0;
const check = (cond, msg) => { console.log((cond ? "  ✓ " : "  ✗ ") + msg); if (!cond) fail++; };

// ---- Scenario 1: one double-loaded module (60') → 3 elements (row, aisle, row) ----
console.log("== B472: a double-loaded parking module explodes into 3 elements (row, aisle, row) ==");
const a = await run(60, "verify-b472-mod", "b472-explode-module.png");
check(a.hasBtn > 0, 'the "Split rows/aisles" control is offered on a 2-row field (was gated >= 3 rows)');
const aPark = a.els.filter((e) => e.type === "parking");
const aPave = a.els.filter((e) => e.type === "paving");
check(a.els.length === 3, `splits into 3 elements (got ${a.els.length})`);
check(aPark.length === 2, `2 stall-row (parking) elements (got ${aPark.length})`);
check(aPave.length === 1, `1 drive-aisle (paving) element (got ${aPave.length})`);
const aSum = a.els.reduce((s, e) => s + (e.h || 0), 0);
check(Math.abs(aSum - 60) < 0.05, `total depth preserved at 60' — no coordinate drift (got ${aSum.toFixed(2)})`);
check(a.afterBtn === 0, `a bare exploded row no longer offers re-split (no zero-depth aisle / infinite split) (got ${a.afterBtn})`);

// ---- Scenario 2: three modules (180', n=6) → 9 elements (6 rows + 3 aisles) ----
console.log("== B472: a 6-row field explodes into all 6 rows + 3 aisles (9 elements) ==");
const b = await run(180, "verify-b472-6row", "b472-explode-6row.png");
const bPark = b.els.filter((e) => e.type === "parking");
const bPave = b.els.filter((e) => e.type === "paving");
check(b.els.length === 9, `splits into 9 elements (got ${b.els.length})`);
check(bPark.length === 6, `6 stall-row elements (got ${bPark.length})`);
check(bPave.length === 3, `3 drive-aisle elements (got ${bPave.length})`);

console.log(fail === 0 ? "\n✓ ALL B472 CHECKS PASSED" : `\n✗ ${fail} CHECK(S) FAILED`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
