/**
 * Verify B596 — merging parcels tombstones the merged-away parcels.
 *
 * The bug: mergeParcels removed N parcels and added 1 (a net drop of N-1) but recorded NO
 * tombstone. For N≥3 that ≥2-item drop with nothing to explain it tripped the thin-clobber
 * guard (B459), which misread a legitimate active-tab merge as a stale-tab clobber and blocked
 * the save with a FALSE "changed in another session" conflict (the owner's report). Adding
 * parcels grows the count, so it never tripped — matching "only when I merge".
 *
 * The cloud-conflict path is auth-only (only a signed-in cloud write hits the guard), so the
 * full "no false conflict" confirmation is V186 (signed in). What IS verifiable logged-out, and
 * is the root cause, is the persisted model: after merging 3 adjacent parcels into 1, the saved
 * Site Model must (a) hold exactly 1 parcel and (b) list the 3 consumed parcel ids in deletedIds.
 * That tombstone is what both prevents resurrection on a cross-copy merge AND explains the drop
 * to the thin-clobber guard so no false conflict fires.
 *
 * Run:  npm run build && npx vite preview --host  (on :4173), then
 *       node ui-audit/verify-b596-merge-tombstone.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";

// 3 adjacent 300ft squares in a row → each shares an edge with the next (a mergeable chain).
const sq = (x0, y0) => [ { x: x0, y: y0 }, { x: x0 + 300, y: y0 }, { x: x0 + 300, y: y0 + 300 }, { x: x0, y: y0 + 300 } ];
const parcels = [
  { id: "pA", points: sq(-300, 0), locked: true },
  { id: "pB", points: sq(0, 0),    locked: true },
  { id: "pC", points: sq(300, 0),  locked: true },
];
const site = {
  s_b596: { id: "s_b596", groupId: "s_b596", site: "Merge Tombstone Test", name: "Plan 1", status: "active",
    origin: { lat: 29.76, lon: -95.37 }, county: "harris",
    parcels, els: [], measures: [], callouts: [], markups: [], deletedIds: [], settings: { showSetback: false }, underlay: null, updatedAt: Date.now() },
};

const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify(site)}));
  localStorage.setItem('planarfit:currentSite:v1', 's_b596');
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const ok = (b) => (b ? "PASS" : "FAIL");
let failures = 0;
const expect = (label, cond) => { if (!cond) failures++; console.log(`  [${ok(cond)}] ${label}`); };

async function run() {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(seed);
  const page = await ctx.newPage();

  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(2500);

  const svg = page.locator('svg[aria-label="Site plan canvas"]');
  await svg.waitFor({ timeout: 10000 });
  await page.waitForTimeout(400);

  // Interior screen point of parcel index `i` (centroid biased toward its rightmost vertex so the
  // click clears the area chip + the left props panel). Recomputed each call — selecting a parcel
  // opens the props panel and resizes the canvas. (Same approach as verify-merge-banner.mjs.)
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

  const first = await interiorPoint(0);
  console.log(`  found ${first?.n} parcel hit-stroke polygons`);
  expect("3 parcels rendered", first?.n === 3);

  // Shift-click each parcel interior into the merge selection.
  const selCount = async () => {
    const t = await page.locator("text=/selected/").first().innerText().catch(() => "");
    const m = t.match(/(\d+)\s+(?:parcels? selected|selected)/) || t.match(/(\d+)\s+selected/);
    return m ? Number(m[1]) : 0;
  };
  for (let i = 0; i < 3; i++) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const c = await interiorPoint(i);
      const svgBox = await svg.boundingBox();
      await svg.click({ modifiers: ["Shift"], position: { x: c.x - svgBox.x, y: c.y - svgBox.y }, force: true });
      await page.waitForTimeout(350);
      if (await selCount() >= i + 1) break;
    }
  }
  await page.waitForTimeout(300);
  expect("all 3 parcels selected for merge", (await selCount()) === 3);

  // Click "Merge parcels".
  const mergeBtn = page.getByRole("button", { name: /Merge parcels/ }).first();
  await mergeBtn.click({ timeout: 3000 });
  await page.waitForTimeout(800); // let the debounced save flush to the localStorage mirror

  // Read the persisted model back.
  const stored = await page.evaluate(() => {
    try {
      const all = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
      const s = all.s_b596;
      return s ? { parcels: (s.parcels || []).map((p) => p.id), deletedIds: s.deletedIds || [] } : null;
    } catch (e) { return null; }
  });
  console.log("  persisted:", JSON.stringify(stored));

  expect("merged to exactly 1 parcel", stored && stored.parcels.length === 1);
  expect("the merged-away parcel ids are tombstoned (pA,pB,pC ∈ deletedIds)",
    stored && ["pA", "pB", "pC"].every((id) => stored.deletedIds.includes(id)));
  // The new merged parcel must NOT itself be tombstoned (its fresh id is live).
  expect("the new merged parcel id is NOT tombstoned",
    stored && stored.parcels.length === 1 && !stored.deletedIds.includes(stored.parcels[0]));

  await ctx.close();
  await browser.close();
  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(1); });
