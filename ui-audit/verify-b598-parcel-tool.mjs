/**
 * Verify B598 — the Parcel tool's exit (owner ask), as amended by NEW-1 (2026-10-22).
 *
 * Owner: "on the add parcels tool … it's not intuitive how to exit it." So the Parcel tool shows a persistent
 * banner with an explicit Done exit, and stays active after a draw (so several lots draw in a row).
 * B598 also gave it a Remove (click-to-delete) sub-mode; that mode was RETIRED 2026-10-22 — every parcel delete is
 * now the one `deleteParcels` (parcel menu / Delete key / checked bar, each with an Undo toast), proven by
 * ui-audit/verify-parcel-delete-flow.mjs. This harness now proves the mode is GONE.
 *
 * Checks (logged-out, headless — this is pure client UI, no auth needed):
 *   1. Entering the Parcel tool shows the banner with a Done control and NO Remove control.
 *   2. Done exits back to Select (banner gone) — the discoverable exit.
 *   3. Clicking an existing parcel inside the tool deletes nothing (no click-to-delete).
 *
 * Run:  npm run build && npx vite preview --host  (on :4173), then
 *       node ui-audit/verify-b598-parcel-tool.mjs
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";

const sq = (x0, y0) => [ { x: x0, y: y0 }, { x: x0 + 300, y: y0 }, { x: x0 + 300, y: y0 + 300 }, { x: x0, y: y0 + 300 } ];
const parcels = [
  { id: "pA", points: sq(-350, 0), locked: true },
  { id: "pB", points: sq(50, 0),   locked: true },
];
const site = {
  s_b598: { id: "s_b598", groupId: "s_b598", site: "Parcel Tool Test", name: "Plan 1", status: "active",
    origin: { lat: 29.76, lon: -95.37 }, county: "harris",
    parcels, els: [], measures: [], callouts: [], markups: [], deletedIds: [], settings: { showSetback: false }, underlay: null, updatedAt: Date.now() },
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify(site)}));
  localStorage.setItem('planarfit:currentSite:v1', 's_b598');
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const ok = (b) => (b ? "PASS" : "FAIL");
let failures = 0;
const expect = (label, cond) => { if (!cond) failures++; console.log(`  [${ok(cond)}] ${label}`); };

const persisted = (page) => page.evaluate(() => {
  try {
    const s = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}").s_b598;
    return s ? { parcels: (s.parcels || []).map((p) => p.id), deletedIds: s.deletedIds || [] } : null;
  } catch (e) { return null; }
});

async function run() {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(seed);
  const page = await ctx.newPage();
  /* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — not its clock, and not its pixels. A hidden tab clamps
     setTimeout (a setTimeout-paced probe then times the clamp: 3,156 ms for a 138-182 ms gesture) AND
     suspends requestAnimationFrame, so after a view change the app's state attributes update while the
     drawing never repaints — every box, position, hit test and screenshot then agrees with every other
     and describes a view the app already left. One precondition covers both, rAF liveness probe
     included; see ui-audit/lib/tabTiming.mjs. Fails loudly rather than reporting either. */
  await assertMeasurable(page, "verify-b598-parcel-tool");
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(2500);

  const svg = page.locator('svg[aria-label="Site plan canvas"]');
  await svg.waitFor({ timeout: 10000 });
  await page.waitForTimeout(400);

  // Enter the Parcel tool via the right-rail Parcel ▾ menu → "Draw new parcel".
  const enterParcelTool = async () => {
    await page.locator('button[title="Draw, plot from a deed, or split a parcel"]').first().click();
    await page.waitForTimeout(250);
    await page.getByRole("button", { name: "Draw new parcel" }).click();
    await page.waitForTimeout(350);
  };
  await enterParcelTool();

  // 1. Banner with Draw / Remove / Done.
  const bannerControls = await page.evaluate(() => {
    const txt = (re) => [...document.querySelectorAll("button")].some((b) => re.test((b.textContent || "").trim()));
    return { remove: txt(/Remove/), done: txt(/^Done$/) };
  });
  expect("1. Parcel tool banner has NO Remove (click-to-delete) button", !bannerControls.remove);
  expect("1. Parcel tool banner shows a Done (exit) button", bannerControls.done);

  // 2. Done exits to Select — the banner disappears.
  await page.getByRole("button", { name: "Done" }).click();
  await page.waitForTimeout(300);
  const doneGone = !(await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => /^Done$/.test((b.textContent || "").trim()))));
  expect("2. Done exits the tool (banner gone)", doneGone);

  await enterParcelTool();

  // 5. Draw a parcel (4 clicks + Enter to close) → it's added AND the tool stays active (the
  // exit-behavior fix: previously closing auto-switched to Select). Clicks land as boundary points
  // regardless of what's underneath (parcels don't capture clicks in Draw mode).
  const box0 = await svg.boundingBox();
  const drawPts = [[300, 200], [520, 200], [520, 400], [300, 400]];
  for (const [x, y] of drawPts) { await page.mouse.click(box0.x + x, box0.y + y); await page.waitForTimeout(120); }
  await page.keyboard.press("Enter"); // finishActiveDrawing → closePoly
  await page.waitForTimeout(700);
  const drew = await persisted(page);
  console.log("  after draw:", JSON.stringify(drew));
  expect("5. drawing a parcel adds it (2 → 3)", drew && drew.parcels.length === 3);
  expect("5. the Parcel tool STAYS active after closing a parcel (banner present)",
    await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => /^Done$/.test((b.textContent || "").trim()))));

  // 3. Clicking an existing parcel inside the tool must NOT delete it (the Remove mode is retired).
  const before = await persisted(page);
  console.log("  before:", JSON.stringify(before));
  // Interior point of parcel index 0 (centroid biased toward its rightmost vertex), in screen px.
  const interiorPoint = (i) => page.evaluate((idx) => {
    const svgEl = document.querySelector('svg[aria-label="Site plan canvas"]');
    const polys = [...svgEl.querySelectorAll("polygon")].filter((p) => (p.getAttribute("stroke") || "").includes("0.001"));
    if (!polys[idx]) return null;
    const m = svgEl.getScreenCTM();
    const v = polys[idx].getAttribute("points").trim().split(/\s+/).map((s) => {
      const [x, y] = s.split(",").map(Number); const pt = svgEl.createSVGPoint(); pt.x = x; pt.y = y;
      const sp = pt.matrixTransform(m); return { x: sp.x, y: sp.y };
    });
    const cx = v.reduce((a, p) => a + p.x, 0) / v.length, cy = v.reduce((a, p) => a + p.y, 0) / v.length;
    const vr = v.reduce((a, p) => (p.x > a.x ? p : a), v[0]);
    return { x: cx + 0.45 * (vr.x - cx), y: cy + 0.45 * (vr.y - cy), n: polys.length };
  }, i);
  const c = await interiorPoint(0);
  const box = await svg.boundingBox();
  await svg.click({ position: { x: c.x - box.x, y: c.y - box.y }, force: true });
  await page.waitForTimeout(700); // let the debounced save flush to the mirror

  const after = await persisted(page);
  console.log("  after:", JSON.stringify(after));
  expect("3. a click on an existing parcel in the Parcel tool deletes nothing (3 stays 3)", after && before && after.parcels.length === before.parcels.length);
  expect("3. still in the Parcel tool after the click (banner present)",
    await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => /^Done$/.test((b.textContent || "").trim()))));

  await ctx.close();
  await browser.close();
  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
run().catch((e) => { console.error(e); process.exit(1); });
