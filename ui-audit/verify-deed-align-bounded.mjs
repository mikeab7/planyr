/**
 * Verify the B625×2 recurrence fix end-to-end: "Align to county parcel" no longer swings a
 * plotted deed to a gross rotational alias.
 *
 * The original B625 fit searched the full ±180° for the lowest symmetric nearest-vertex RMS.
 * For a near-symmetric outline (a square/near-square county parcel) that objective has equally-
 * good minima at the 90/180/270° ALIASES, so the deed could snap tens of degrees off ("~45°")
 * instead of applying the real ~1.5° basis-of-bearings correction. The fix bounds the search to
 * MAX_ALIGN_ROT_DEG (20°), so only the small, physically-real rotation is reachable.
 *
 * This drives the real browser (logged-out — the fix is pure client UI) with a PERFECT-SQUARE
 * parcel (maximally aliased) and a deed that is that square rotated a small -6° and nudged off,
 * then clicks Align and asserts the APPLIED rotation stayed within the window (a wrong alias
 * would record ~±84/±96/±174°). Under the old ±180° sweep this reproduced the gross swing;
 * under the fix it lands on the small angle.
 *
 * Run:  npm run build && npx vite preview --host --port 4173  (background), then
 *       PW_CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
 *       BASE_URL=http://localhost:4173/ node ui-audit/verify-deed-align-bounded.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium/chrome-linux/chrome";
const MAX_ALIGN_ROT_DEG = 20; // must match deedAlign.js

const centroid = (pts) => { let x = 0, y = 0; for (const p of pts) { x += p.x; y += p.y; } return { x: x / pts.length, y: y / pts.length }; };
const rot = (pts, deg, piv) => { const t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t); return pts.map((p) => { const dx = p.x - piv.x, dy = p.y - piv.y; return { x: piv.x + c * dx - s * dy, y: piv.y + s * dx + c * dy }; }); };
const shift = (pts, dx, dy) => pts.map((p) => ({ x: p.x + dx, y: p.y + dy }));
const symRms = (A, B) => {
  const n2 = (p, S) => { let b = Infinity; for (const q of S) { const d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2; if (d < b) b = d; } return b; };
  let se = 0, n = 0;
  for (const p of A) { se += n2(p, B); n++; }
  for (const q of B) { se += n2(q, A); n++; }
  return Math.sqrt(se / n);
};
const foldDeg = (d) => ((d + 180) % 360 + 360) % 360 - 180; // → (−180, 180]

// A PERFECT SQUARE — the maximally-aliased outline (overlays itself at 0/90/180/270°), so the
// old full-sweep fit had no reason to prefer the true small angle over a gross alias.
const SQUARE0 = [{ x: 0, y: 0 }, { x: 2200, y: 0 }, { x: 2200, y: 2200 }, { x: 0, y: 2200 }];
const C0 = centroid(SQUARE0);
const PARCEL = shift(SQUARE0, -C0.x, -C0.y); // centered on the site origin
const Cp = centroid(PARCEL);
const ROT = -6, DX = 240, DY = -180; // small mis-rotation + nudge; deed stays overlapping/visible
const DEED = shift(rot(PARCEL, ROT, Cp), DX, DY);

const ringClose = (pts) => [...pts, pts[0]];
const mkDeed = { id: "deed_main", kind: "encumbrance", pts: DEED, centerline: ringClose(DEED), closed: true, calls: [],
  label: "Tract boundary", deedGroup: "g1", except: false,
  stroke: "#7c3aed", fill: "#7c3aed", fillOpacity: 0.14, weight: 2, dash: "solid" };

const site = {
  s_deed: {
    id: "s_deed", groupId: "s_deed", site: "Deed Align Bounded Test", name: "Plan 1", status: "active",
    origin: { lat: 29.80, lon: -95.83 }, county: "harris",
    parcels: [{ id: "pA", points: PARCEL, locked: true }],
    els: [], measures: [], callouts: [],
    markups: [mkDeed],
    deletedIds: [], settings: { showSetback: false }, underlay: null, updatedAt: Date.now(),
  },
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify(site)}));
  localStorage.setItem('planarfit:currentSite:v1', 's_deed');
} catch (e) {} })();`;

const ok = (b) => (b ? "PASS" : "FAIL");
let failures = 0;
const expect = (label, cond, extra = "") => { if (!cond) failures++; console.log(`  [${ok(cond)}] ${label}${extra ? ` — ${extra}` : ""}`); };
const persistedMarkups = (page) => page.evaluate(() => {
  try { const s = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}").s_deed; return (s && s.markups) || []; }
  catch (e) { return []; }
});

async function run() {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(seed);
  const page = await ctx.newPage();
  const errors = [];
  const isNetNoise = (t) => /ERR_(CONNECTION|TUNNEL|NAME|INTERNET|NETWORK|ABORT|TIMED)|Failed to load resource|net::/i.test(t);
  page.on("console", (m) => { if (m.type() === "error" && !isNetNoise(m.text())) errors.push(m.text()); });
  page.on("pageerror", (e) => { if (!isNetNoise(String(e))) errors.push(String(e)); });

  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(2800);
  const svg = page.locator('svg[aria-label="Site plan canvas"]');
  await svg.waitFor({ timeout: 12000 });
  await page.getByRole("button", { name: "Zoom to fit" }).first().click().catch(() => {});
  await page.waitForTimeout(600);

  const deed = page.locator('[data-testid="deed-boundary"]').first();
  await deed.waitFor({ timeout: 8000 });

  const before = await persistedMarkups(page);
  const rmsBefore = symRms(before.find((m) => m.id === "deed_main").pts, PARCEL);
  expect("seeded deed starts misaligned (small rotation + nudge) with the square parcel", rmsBefore > 100, `residual ${rmsBefore.toFixed(0)}′`);

  const clickPt = await deed.evaluate((el) => {
    const pts = el.getAttribute("points").trim().split(/\s+/).map((s) => s.split(",").map(Number));
    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    const m = el.getScreenCTM(); const p = el.ownerSVGElement.createSVGPoint(); p.x = cx; p.y = cy;
    const v = p.matrixTransform(m); return { x: v.x, y: v.y };
  });
  await page.mouse.click(clickPt.x, clickPt.y);
  await page.waitForTimeout(500);

  const alignBtn = page.getByRole("button", { name: /Align to county parcel/i });
  const alignVisible = await alignBtn.isVisible().catch(() => false);
  expect("selecting the deed shows an 'Align to county parcel' button", alignVisible);
  if (alignVisible) { await alignBtn.click(); await page.waitForTimeout(700); }

  const after = await persistedMarkups(page);
  const mainAfter = after.find((m) => m.id === "deed_main");
  const rmsAfter = symRms(mainAfter.pts, PARCEL);
  const applied = Math.abs(foldDeg(mainAfter.rotApplied || 0));
  // THE regression assertion: the applied rotation is the small real correction, NOT a gross
  // 90/180/270° alias. |ROT| = 6°, so it must land near 6° and well inside the ±20° window.
  expect("Align applies only a SMALL rotation, not a gross alias (≤ MAX_ALIGN_ROT_DEG)", applied <= MAX_ALIGN_ROT_DEG, `applied ${applied.toFixed(2)}°`);
  expect("the applied rotation is ~the seeded 6° (near-square did not flip 90/180°)", Math.abs(applied - 6) < 2, `applied ${applied.toFixed(2)}°`);
  expect("after Align, the deed overlays the parcel (residual → ~0)", rmsAfter < 3, `residual ${rmsBefore.toFixed(0)}′ → ${rmsAfter.toFixed(2)}′`);
  expect("no console/page errors through the flow", errors.length === 0, errors.slice(0, 2).join(" | "));

  await browser.close();
  console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILED"}`);
  process.exit(failures === 0 ? 0 : 1);
}
run().catch((e) => { console.error(e); process.exit(1); });
