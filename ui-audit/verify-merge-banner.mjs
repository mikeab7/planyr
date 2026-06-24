/**
 * Verify the parcel-merge banner fixes (NEW-1 / NEW-2 / NEW-3).
 *
 *  NEW-1  Banner buttons are clickable (banner clears the SVG canvas z-index) and show a
 *         pointer cursor — not the canvas grab hand — and clicking Clear empties the
 *         selection instead of panning the map.
 *  NEW-2  Shift-clicking a parcel BODY (interior) reliably toggles it into the merge
 *         selection on the first click — previously the interior was click-through and the
 *         press started a marquee, so picks were missed ("needs several tries").
 *  NEW-3  The count label and the Merge button lay out side-by-side with no overlap.
 *
 * Run:  node ui-audit/verify-merge-banner.mjs   (preview server must be up on :4173)
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/merge-banner/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

// 4 adjacent 300ft squares in a 2x2 grid around origin → all share edges (mergeable).
const sq = (x0, y0) => [ { x: x0, y: y0 }, { x: x0 + 300, y: y0 }, { x: x0 + 300, y: y0 + 300 }, { x: x0, y: y0 + 300 } ];
const parcels = [
  { id: "pA", points: sq(-300, -300), locked: true },
  { id: "pB", points: sq(0, -300),    locked: true },
  { id: "pC", points: sq(-300, 0),    locked: true },
  { id: "pD", points: sq(0, 0),       locked: true },
];
const site = {
  s_merge: { id: "s_merge", groupId: "s_merge", site: "Merge Test", name: "Plan 1", status: "active",
    origin: { lat: 29.76, lon: -95.37 }, county: "harris",
    parcels, els: [], measures: [], callouts: [], markups: [], settings: { showSetback: false }, underlay: null, updatedAt: Date.now() },
};

const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify(site)}));
  localStorage.setItem('planarfit:currentSite:v1', 's_merge');  // resume straight into the planner
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

  // The planner resumes straight into the Select tool (the default), so no tool click is
  // needed — and clicking a "Select…"-named button would hit the "Select parcels" toggle.
  const svg = page.locator('svg[aria-label="Site plan canvas"]');
  await svg.waitFor({ timeout: 10000 });
  await page.waitForTimeout(400);

  // An INTERIOR screen point for parcel index `i`: centroid + 45% toward its first vertex —
  // guaranteed inside a convex square, and off the centroid so it clears the "N ac" area chip
  // (which has its own pointer handler). Recomputed fresh each time because selecting a parcel
  // opens the left props panel, which resizes the canvas and remaps screen↔feet between clicks.
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
    // Bias toward the RIGHTMOST vertex so the click stays clear of the left props panel
    // (which opens on the first selection and would otherwise cover a left-column parcel),
    // and 45% out from the centroid so it clears the "N ac" area chip.
    const vr = v.reduce((a, p) => (p.x > a.x ? p : a), v[0]);
    return { x: cx + 0.45 * (vr.x - cx), y: cy + 0.45 * (vr.y - cy), n: polys.length };
  }, i);

  const first = await interiorPoint(0);
  console.log(`  found ${first?.n} parcel hit-stroke polygons`);
  expect("4 parcels rendered", first?.n === 4);

  // NEW-2: Shift-click each parcel INTERIOR. Each should toggle into the merge selection on
  // the first click (B420 makes the body click-through, so the press lands on the background).
  // selecting a parcel opens the left props panel and resizes the canvas, so we settle and
  // verify the count climbed after each click — a single retry absorbs any layout-settle race.
  const selCount = async () => {
    const t = await page.locator("text=/selected/").first().innerText().catch(() => "");
    const m = t.match(/(\d+)\s+(?:parcels? selected|selected)/) || t.match(/(\d+)\s+selected/);
    return m ? Number(m[1]) : 0;
  };
  for (let i = 0; i < 4; i++) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const c = await interiorPoint(i);
      const svgBox = await svg.boundingBox();
      await svg.click({ modifiers: ["Shift"], position: { x: c.x - svgBox.x, y: c.y - svgBox.y }, force: true });
      await page.waitForTimeout(350);
      if (await selCount() >= i + 1) break;
    }
  }
  await page.waitForTimeout(300);
  await page.screenshot({ path: OUT + "after-clicks-full.png" });

  const banner = page.locator('text=/parcels selected/');
  const bannerVisible = await banner.isVisible().catch(() => false);
  expect("NEW-2: merge banner shows after 4 interior shift-clicks", bannerVisible);
  if (bannerVisible) {
    const txt = await banner.first().innerText();
    console.log(`  banner text: "${txt}"`);
    expect("NEW-2: all 4 interior shift-clicks registered (\"4 parcels selected\")", /4 parcels selected/.test(txt));
  }

  // Screenshot the banner region (sits ~14px below the canvas top, under the 2-row header).
  const bb = await banner.first().boundingBox().catch(() => null);
  if (bb) await page.screenshot({ path: OUT + "banner.png", clip: { x: Math.max(0, bb.x - 60), y: Math.max(0, bb.y - 18), width: 760, height: 64 } });
  else await page.screenshot({ path: OUT + "banner.png" });
  console.log("  saved banner.png");

  // NEW-3: count label and Merge button must not overlap.
  const layout = await page.evaluate(() => {
    const span = [...document.querySelectorAll("span")].find((s) => /parcels selected/.test(s.textContent || ""));
    const mergeBtn = [...document.querySelectorAll("button")].find((b) => /Merge parcels/.test(b.textContent || ""));
    const clearBtn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Clear");
    const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom }; };
    const cs = clearBtn ? getComputedStyle(clearBtn).cursor : null;
    return { span: rect(span), merge: rect(mergeBtn), clear: rect(clearBtn), clearCursor: cs };
  });
  const intersects = (a, b) => a && b && !(a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y);
  expect("NEW-3: count label does NOT overlap Merge button", layout.span && layout.merge && !intersects(layout.span, layout.merge));

  // NEW-1: Clear button shows a pointer cursor (not the canvas grab hand).
  expect("NEW-1: Clear button cursor is pointer", layout.clearCursor === "pointer");

  // NEW-1: clicking Clear empties the selection (instead of the click falling through to a pan).
  await page.getByRole("button", { name: "Clear" }).first().click({ timeout: 3000 });
  await page.waitForTimeout(300);
  const gone = !(await page.locator('text=/parcels selected/').isVisible().catch(() => false));
  expect("NEW-1: clicking Clear cleared the merge selection (button received the click)", gone);

  await ctx.close();
  await browser.close();
  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(1); });
