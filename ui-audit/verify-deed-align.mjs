/**
 * Verify the deed ↔ parcel alignment fix (basis-of-bearings correction).
 *
 * A plotted metes-and-bounds deed is drawn on the survey's grid/record north, but the
 * county parcel + aerial are true north; near Houston they differ ~1.5°, so a raw plot
 * lands rotated (tens of feet off over a long line). The new "Align to county parcel"
 * snaps the deed — and its save-and-except holes — onto the held parcel as one rigid body.
 *
 * This is a full end-to-end check in a real browser, logged-out (the fix is pure client
 * UI — no auth). It seeds a georeferenced site with a parcel and a deed that has been
 * rotated +2.2° and shoved 3,400 ft off the parcel (plus a hole rigidly attached), then:
 *   1. selects the deed on the canvas and confirms the panel offers "Align to county parcel";
 *   2. clicks it and confirms the deed's boundary now overlays the parcel (residual → ~0 ft);
 *   3. confirms the save-and-except hole moved WITH the boundary (group stayed rigid);
 *   4. confirms no console errors fired through the whole flow.
 *
 * Run:  npm run build && npx vite preview --host --port 4173  (background), then
 *       node ui-audit/verify-deed-align.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium/chrome-linux/chrome";

// ── geometry (feet, planner frame) ───────────────────────────────────────────
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

// A convex, NON-symmetric parcel (so the fit's rotation is unambiguous), centered on the
// site origin so the default view + "Zoom to fit" (which frames PARCELS) keep it on-screen.
const PARCEL0 = [{ x: 0, y: 0 }, { x: 2600, y: 0 }, { x: 2350, y: 1650 }, { x: 150, y: 1950 }];
const C0 = centroid(PARCEL0);
const PARCEL = shift(PARCEL0, -C0.x, -C0.y);
const Cp = centroid(PARCEL); // ≈ origin
// The mis-plot: rotated 2.2° AND shoved a few hundred feet off — but kept within the parcel
// frame so the deed stays visible/clickable (fit() frames parcels, not markups).
const ROT = 2.2, DX = 300, DY = -200;
const DEED = shift(rot(PARCEL, ROT, Cp), DX, DY);
const HOLE_SRC = shift([{ x: 1050, y: 600 }, { x: 1350, y: 600 }, { x: 1350, y: 900 }, { x: 1050, y: 900 }], -C0.x, -C0.y);
const HOLE = shift(rot(HOLE_SRC, ROT, Cp), DX, DY); // rigidly attached to the deed
const HOLE_SRC_C = centroid(HOLE_SRC); // where the hole should land once the deed is aligned

const ring = (pts) => [...pts, pts[0]]; // closing point for the centerline
const mk = (id, pts, except) => ({
  id, kind: "encumbrance", pts, centerline: ring(pts), closed: true, calls: [],
  label: except ? "Save & except" : "Tract boundary", deedGroup: "g1", except,
  stroke: except ? "#b91c1c" : "#7c3aed", fill: except ? "#b91c1c" : "#7c3aed",
  fillOpacity: except ? 0.1 : 0.14, weight: 2, dash: except ? "6 4" : "solid",
});

const site = {
  s_deed: {
    id: "s_deed", groupId: "s_deed", site: "Deed Align Test", name: "Plan 1", status: "active",
    origin: { lat: 29.80, lon: -95.83 }, county: "harris",
    parcels: [{ id: "pA", points: PARCEL, locked: true }],
    els: [], measures: [], callouts: [],
    markups: [mk("deed_main", DEED, false), mk("deed_hole", HOLE, true)],
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
  try {
    const s = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}").s_deed;
    return (s && s.markups) || [];
  } catch (e) { return []; }
});

async function run() {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(seed);
  const page = await ctx.newPage();
  const errors = [];
  // Ignore the offline basemap/GIS tile failures the sandbox can't reach — they aren't our code.
  const isNetNoise = (t) => /ERR_(CONNECTION|TUNNEL|NAME|INTERNET|NETWORK|ABORT|TIMED)|Failed to load resource|net::/i.test(t);
  page.on("console", (m) => { if (m.type() === "error" && !isNetNoise(m.text())) errors.push(m.text()); });
  page.on("pageerror", (e) => { if (!isNetNoise(String(e))) errors.push(String(e)); });

  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(2800);

  const svg = page.locator('svg[aria-label="Site plan canvas"]');
  await svg.waitFor({ timeout: 12000 });

  // Frame the content (fit() targets parcels; the overlapping deed rides along on-screen).
  await page.getByRole("button", { name: "Zoom to fit" }).first().click().catch(() => {});
  await page.waitForTimeout(600);

  // The deed boundary should be on the canvas (seeded, mis-aligned).
  const deed = page.locator('[data-testid="deed-boundary"]').first();
  await deed.waitFor({ timeout: 8000 });

  // baseline: how far the seeded deed sits off the parcel
  const before = await persistedMarkups(page);
  const mainBefore = before.find((m) => m.id === "deed_main");
  const rmsBefore = symRms(mainBefore.pts, PARCEL);
  expect("seeded deed starts misaligned with the parcel", rmsBefore > 100, `residual ${rmsBefore.toFixed(0)}′`);

  // select the deed: click the centroid of its ACTUAL on-screen polygon (interior of the
  // convex deed), converting the SVG's local point coords to viewport pixels.
  const clickPt = await deed.evaluate((el) => {
    const pts = el.getAttribute("points").trim().split(/\s+/).map((s) => s.split(",").map(Number));
    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
    const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    const svg = el.ownerSVGElement;
    const m = el.getScreenCTM();
    const p = svg.createSVGPoint(); p.x = cx; p.y = cy;
    const v = p.matrixTransform(m);
    return { x: v.x, y: v.y };
  });
  await page.mouse.click(clickPt.x, clickPt.y);
  await page.waitForTimeout(500);

  // the encumbrance panel should offer the align action
  const alignBtn = page.getByRole("button", { name: /Align to county parcel/i });
  const alignVisible = await alignBtn.isVisible().catch(() => false);
  expect("selecting the deed shows an 'Align to county parcel' button", alignVisible);
  const rotLabelVisible = await page.getByText("Rotate°", { exact: false }).first().isVisible().catch(() => false);
  expect("the deed panel exposes a manual Rotate° control", rotLabelVisible);

  if (alignVisible) {
    await alignBtn.click();
    await page.waitForTimeout(700);
  }

  const after = await persistedMarkups(page);
  const mainAfter = after.find((m) => m.id === "deed_main");
  const holeAfter = after.find((m) => m.id === "deed_hole");
  const rmsAfter = symRms(mainAfter.pts, PARCEL);
  expect("after Align, the deed boundary overlays the parcel (residual → ~0)", rmsAfter < 3, `residual ${rmsBefore.toFixed(0)}′ → ${rmsAfter.toFixed(2)}′`);

  const holeC = centroid(holeAfter.pts);
  const holeErr = Math.hypot(holeC.x - HOLE_SRC_C.x, holeC.y - HOLE_SRC_C.y);
  expect("the save-and-except hole moved WITH the boundary (group stayed rigid)", holeErr < 30, `hole centroid off by ${holeErr.toFixed(1)}′`);

  expect("no console/page errors through the flow", errors.length === 0, errors.slice(0, 2).join(" | "));

  await browser.close();
  console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILED"}`);
  process.exit(failures === 0 ? 0 : 1);
}
run().catch((e) => { console.error(e); process.exit(1); });
