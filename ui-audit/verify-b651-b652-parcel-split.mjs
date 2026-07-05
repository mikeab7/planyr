/* B651 + B652 — parcel split is a REPLACEMENT (superseded parent, lineage-named children,
 * correct non-double-counted acreage), and the Yield overlap warning fires when two ACTIVE
 * parcels cover the same ground.
 *
 * Logged-out against the built app (vite preview on :4173). No network needed — parcels are
 * seeded into localStorage; the external GIS hosts are CORS-blocked in the sandbox (filtered).
 *
 * Scenario A (B651): one 10.00-ac square parcel → Split → assert:
 *   • header reads "Parcels · 2" (the superseded parent isn't a counted lot),
 *   • the panel shows a greyed "· split" parent with lineage-named children (1A / 1B),
 *   • the Yield "Site" acreage stays ~10 ac (children sum), NOT 20/30 (no double-count),
 *   • no overlap banner (the active set — the two children — doesn't overlap),
 *   • activating the superseded parent auto-deactivates the children (mutual-exclusion) →
 *     STILL no overlap banner (the guard held).
 * Scenario B (B652): two overlapping ACTIVE parcels → the Yield overlap banner appears.
 */
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

// Auto-detect the sandbox Chromium (version dir varies).
const CANDIDATES = [
  process.env.PW_CHROME,
  "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome",
  "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
].filter(Boolean);
const EXEC = CANDIDATES.find((p) => existsSync(p));
if (!EXEC) { console.log("No Chromium binary found under /opt/pw-browsers — skipping (logged as pending)."); process.exit(0); }

// 10.00-ac square (435,600 sf): side 660 ft → points at ±330.
const S = 330;
const oneParcelSite = {
  id: "uiaudit-b651", groupId: "uiaudit-b651", site: "Split Demo", name: "Plan 1",
  origin: { lat: 29.786, lon: -95.83 }, county: "harris",
  parcels: [{ id: "pc1", locked: false, points: [{ x: -S, y: -S }, { x: S, y: -S }, { x: S, y: S }, { x: -S, y: S }] }],
  els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null,
  updatedAt: Date.now(), data: { status: "active" },
};
// Two 5-ac squares (side ~466.7) offset so they OVERLAP by ~half → the B652 banner must fire.
const T = 233;
const overlapSite = {
  id: "uiaudit-b652", groupId: "uiaudit-b652", site: "Overlap Demo", name: "Plan 1",
  origin: { lat: 29.786, lon: -95.83 }, county: "harris",
  parcels: [
    { id: "ov1", locked: false, points: [{ x: -T, y: -T }, { x: T, y: -T }, { x: T, y: T }, { x: -T, y: T }] },
    { id: "ov2", locked: false, points: [{ x: 0, y: 0 }, { x: 2 * T, y: 0 }, { x: 2 * T, y: 2 * T }, { x: 0, y: 2 * T }] },
  ],
  els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null,
  updatedAt: Date.now(), data: { status: "active" },
};
const seedFor = (s) => `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify({ '${s.id}': ${JSON.stringify(s)} }));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(s.id)});
} catch (e) {} })();`;

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass++; console.log("  ✅", label); } else { fail++; console.log("  ❌", label); } };
const appErrors = (errs) => errs.filter((e) => !/CORS policy|Failed to load resource|net::ERR|ERR_FAILED|f=json|arcgis|hctx|houstontx|fema|usgs|esri|geogims/i.test(e));

async function open(site) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 940 }, deviceScaleFactor: 1.25, ignoreHTTPSErrors: true });
  await ctx.addInitScript(seedFor(site));
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1700);
  return { ctx, page, errors };
}
const headerCount = (page) => page.evaluate(() => {
  const el = [...document.querySelectorAll("*")].find((n) => /^Parcels · \d+$/.test((n.textContent || "").trim()) && n.children.length === 0);
  return el ? parseInt(el.textContent.replace(/\D/g, ""), 10) : null;
});
async function openParcelPanel(page) {
  const marker = page.getByText(/^Parcels · \d+$/);
  if (!(await marker.first().isVisible().catch(() => false))) {
    try { await page.locator('button[title="Parcel"]').first().click({ timeout: 5000 }); } catch {}
    await page.waitForTimeout(400);
  }
}
async function openYield(page) {
  try { await page.locator('button[title="Yield"]').first().click({ timeout: 6000 }); } catch {}
  await page.waitForTimeout(500);
}
const bodyText = (page) => page.evaluate(() => document.body.innerText);
const siteAcres = async (page) => {
  const t = await bodyText(page);
  const m = t.match(/Site[\s\S]{0,12}?([\d,]+\.\d{2})\s*ac/i);
  return m ? parseFloat(m[1].replace(/,/g, "")) : null;
};

// ---------- Scenario A — split supersedes + lineage + correct acreage + guard ----------
console.log("A — split replaces the parent (supersede + lineage + no double-count):");
{
  const { ctx, page, errors } = await open(oneParcelSite);
  await openParcelPanel(page);
  ok((await headerCount(page)) === 1, "starts at Parcels · 1");

  // Arm split via the Parcel-panel control (present whenever the panel is open), then cut
  // horizontally across the parcel.
  // Arming is proven by the cut succeeding below (superseded parent + lineage children appear).
  await page.locator('button[title^="Split a parcel"]').first().click();
  await page.waitForTimeout(500);
  const rect = await page.evaluate(() => {
    const polys = [...document.querySelectorAll('svg[aria-label="Site plan canvas"] polygon')];
    let best = null, bestA = 0;
    for (const p of polys) { const r = p.getBoundingClientRect(); const a = r.width * r.height; if (a > bestA) { bestA = a; best = r; } }
    return best ? { x: best.x, y: best.y, w: best.width, h: best.height } : null;
  });
  ok(!!rect, "located the parcel polygon on the canvas");
  const midY = rect.y + rect.h / 2;
  await page.mouse.click(rect.x - 12, midY);
  await page.waitForTimeout(200);
  await page.mouse.dblclick(rect.x + rect.w + 12, midY);
  await page.waitForTimeout(700);

  ok((await headerCount(page)) === 2, "after split the header reads Parcels · 2 (superseded parent not counted)");
  const panel = await bodyText(page);
  ok(/·\s*split/i.test(panel), "the panel shows a superseded '· split' parent row");
  ok(panel.includes("Parcel 1A") && panel.includes("Parcel 1B"), "children are lineage-named Parcel 1A / 1B");
  await page.screenshot({ path: OUT + "b651-panel.png", clip: { x: 0, y: 96, width: 380, height: 520 } });

  await openYield(page);
  const acres = await siteAcres(page);
  ok(acres != null && Math.abs(acres - 10) < 0.2, `Yield Site area ~10 ac (got ${acres}) — NOT double-counted (would be 20/30)`);
  ok(!/Active parcels overlap/i.test(await bodyText(page)), "no overlap banner after a clean split (children don't overlap)");
  await page.screenshot({ path: OUT + "b651-yield.png", clip: { x: 0, y: 96, width: 380, height: 640 } });

  // Mutual-exclusion: activate the superseded parent → children auto-deactivate → still no overlap.
  await openParcelPanel(page);
  const clicked = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("div")].filter((d) => /·\s*split/i.test(d.textContent || "") && d.querySelector('input[type="checkbox"]'));
    // deepest matching row (the actual list row, not an ancestor container)
    const row = rows.sort((a, b) => (a.textContent.length - b.textContent.length))[0];
    const cb = row && row.querySelector('input[type="checkbox"]');
    if (cb) { cb.click(); return true; }
    return false;
  });
  ok(clicked, "clicked the superseded parent's Active checkbox");
  await page.waitForTimeout(400);
  await openYield(page);
  ok(!/Active parcels overlap/i.test(await bodyText(page)), "activating the parent deactivated the children (guard held) — still no overlap banner");

  const ae = appErrors(errors); ok(ae.length === 0, `no app console/page errors (saw ${ae.length}; ${errors.length - ae.length} env GIS lines ignored)`);
  if (ae.length) console.log("    app errors:", ae.slice(0, 5));
  await ctx.close();
}

// ---------- Scenario B — overlap warning fires for two overlapping active parcels ----------
console.log("B — Yield overlap banner fires for two overlapping ACTIVE parcels (B652):");
{
  const { ctx, page, errors } = await open(overlapSite);
  await openParcelPanel(page);
  ok((await headerCount(page)) === 2, "two parcels present");
  await openYield(page);
  const txt = await bodyText(page);
  ok(/Active parcels overlap/i.test(txt), "the overlap warning banner is shown");
  ok(/double-counted/i.test(txt), "banner explains the acreage may be double-counted");
  await page.screenshot({ path: OUT + "b652-overlap-banner.png", clip: { x: 0, y: 96, width: 380, height: 520 } });
  const ae = appErrors(errors); ok(ae.length === 0, `no app console/page errors (saw ${ae.length}; ${errors.length - ae.length} env GIS lines ignored)`);
  if (ae.length) console.log("    app errors:", ae.slice(0, 5));
  await ctx.close();
}

await browser.close();
console.log(`\nB651+B652 parcel-split verification: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
