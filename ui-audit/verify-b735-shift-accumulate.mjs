/**
 * B735 — Shift+click parcel selection must ACCUMULATE, not clear the prior parcel.
 *
 * Reported repro: plain-click parcel A (it selects), then Shift-click parcel B. The bug: A
 * dropped and only B was selected, so the 2-parcel set the Merge needs never formed. Root cause:
 * a plain click selects into `sel` (single store) but Shift-click accumulates into `combineSel`
 * (merge store) and reset `sel` to B — so A (only ever in `sel`) never joined the merge set.
 *
 * Fix: Shift-click SEEDS the merge set from the current single selection first (shiftPickParcel /
 * extendMergeSelection), then toggles the clicked parcel. Checks here:
 *   1. Plain-click A (boundary) selects it and shows NO merge banner (combineSel empty).
 *   2. THE FIX — plain-click A then Shift-click B → "2 parcels selected" (A kept + B added).
 *   3. Shift-click B again toggles it OFF → back to 1 (A retained).
 *   4. Plain-click empty canvas clears the merge selection (a pan would not).
 *   5. End-to-end: plain-select A, Shift-add B, Merge → the two adjacent lots fuse into one parcel.
 *
 * Run:  node ui-audit/verify-b735-shift-accumulate.mjs   (preview server up on :4173)
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/b735-shift-accumulate/", import.meta.url).pathname;
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
  s_b735: { id: "s_b735", groupId: "s_b735", site: "B735 Test", name: "Plan 1", status: "active",
    origin: { lat: 29.76, lon: -95.37 }, county: "harris",
    parcels, els: [], measures: [], callouts: [], markups: [], settings: { showSetback: false }, underlay: null, updatedAt: Date.now() },
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify(site)}));
  localStorage.setItem('planarfit:currentSite:v1', 's_b735');
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

  // Screen point INSIDE parcel `idx` (centroid biased toward its rightmost vertex, clear of the
  // area chip + left props panel). Recomputed each call — selecting a parcel resizes the canvas.
  const interiorPoint = (idx) => page.evaluate((i) => {
    const svgEl = document.querySelector('svg[aria-label="Site plan canvas"]');
    const polys = [...svgEl.querySelectorAll("polygon")].filter((p) => (p.getAttribute("stroke") || "").includes("0.001"));
    if (!polys[i]) return null;
    const m = svgEl.getScreenCTM();
    const v = polys[i].getAttribute("points").trim().split(/\s+/).map((s) => {
      const [x, y] = s.split(",").map(Number); const pt = svgEl.createSVGPoint(); pt.x = x; pt.y = y;
      const sp = pt.matrixTransform(m); return { x: sp.x, y: sp.y };
    });
    const cx = v.reduce((a, p) => a + p.x, 0) / v.length, cy = v.reduce((a, p) => a + p.y, 0) / v.length;
    const vr = v.reduce((a, p) => (p.x > a.x ? p : a), v[0]);
    return { x: cx + 0.45 * (vr.x - cx), y: cy + 0.45 * (vr.y - cy), n: polys.length };
  }, idx);

  // Screen point ON the first edge (v0→v1) of parcel `idx`, nudged ~3px toward the centroid so it
  // lands on the ~12px boundary hit-stroke — a plain click here selects the parcel (B420: only the
  // boundary grabs; the interior is click-through). For pA the first edge is an OUTER edge (unshared).
  const edgeMidPoint = (idx) => page.evaluate((i) => {
    const svgEl = document.querySelector('svg[aria-label="Site plan canvas"]');
    const polys = [...svgEl.querySelectorAll("polygon")].filter((p) => (p.getAttribute("stroke") || "").includes("0.001"));
    if (!polys[i]) return null;
    const m = svgEl.getScreenCTM();
    const v = polys[i].getAttribute("points").trim().split(/\s+/).map((s) => {
      const [x, y] = s.split(",").map(Number); const pt = svgEl.createSVGPoint(); pt.x = x; pt.y = y;
      const sp = pt.matrixTransform(m); return { x: sp.x, y: sp.y };
    });
    const cx = v.reduce((a, p) => a + p.x, 0) / v.length, cy = v.reduce((a, p) => a + p.y, 0) / v.length;
    const mx = (v[0].x + v[1].x) / 2, my = (v[0].y + v[1].y) / 2;
    const dx = cx - mx, dy = cy - my, len = Math.hypot(dx, dy) || 1;
    return { x: mx + 3 * (dx / len), y: my + 3 * (dy / len) };
  }, idx);

  // A guaranteed-empty canvas point: scan a grid over the svg box and return the first spot whose
  // topmost element is NOT a parcel hit-stroke polygon (the drafting background / a plain <g>).
  const emptyPoint = () => page.evaluate(() => {
    const svgEl = document.querySelector('svg[aria-label="Site plan canvas"]');
    const r = svgEl.getBoundingClientRect();
    for (let fx = 0.9; fx > 0.15; fx -= 0.06) {
      for (let fy = 0.85; fy > 0.2; fy -= 0.06) {
        const x = r.left + r.width * fx, y = r.top + r.height * fy;
        const el = document.elementFromPoint(x, y);
        if (!el) continue;
        const isParcel = el.tagName === "polygon" && (el.getAttribute("stroke") || "").includes("0.001");
        const inButton = el.closest("button");
        if (!isParcel && !inButton && svgEl.contains(el)) return { x, y };
      }
    }
    return null;
  });

  const selCount = async () => {
    const t = await page.locator("text=/selected/").first().innerText().catch(() => "");
    const m = t.match(/(\d+)\s+parcels? selected/) || t.match(/(\d+)\s+selected/);
    return m ? Number(m[1]) : 0;
  };
  const bannerShown = () => page.locator('text=/selected/').first().isVisible().catch(() => false);
  const svgBox = async () => svg.boundingBox();
  const clickAt = async (pt, mods = []) => { const b = await svgBox(); await svg.click({ modifiers: mods, position: { x: pt.x - b.x, y: pt.y - b.y }, force: true }); };

  const first = await interiorPoint(0);
  console.log(`  found ${first?.n} parcel hit-stroke polygons`);
  expect("4 parcels rendered", first?.n === 4);

  // ---- 1 + 2: plain-click A (boundary) then Shift-click B → accumulates to 2. ----
  // Wrapped in a retry that resets with Esc: a plain click that happens to pan (not select) just
  // re-runs, so the assertion only passes when A was genuinely selected AND then seeded by B.
  let plainOnly = null, afterShift = 0;
  for (let attempt = 0; attempt < 4 && afterShift !== 2; attempt++) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    await clickAt(await edgeMidPoint(0));           // plain-click A's boundary → selects A into `sel`
    await page.waitForTimeout(400);
    plainOnly = await bannerShown();                 // plain select must NOT raise the merge banner
    await clickAt(await interiorPoint(1), ["Shift"]); // Shift-click B → seed A + add B
    await page.waitForTimeout(400);
    afterShift = await selCount();
  }
  await page.screenshot({ path: OUT + "after-plain-then-shift.png" });
  expect("1: plain-click a parcel shows NO merge banner (combineSel empty)", plainOnly === false);
  expect("2: THE FIX — plain-click A then Shift-click B → \"2 parcels selected\" (A kept)", afterShift === 2);

  // ---- 3: Shift-click B again toggles it off → back to 1 (A retained). ----
  await clickAt(await interiorPoint(1), ["Shift"]);
  await page.waitForTimeout(400);
  expect("3: Shift-click an already-picked parcel toggles it OFF (2 → 1, A retained)", (await selCount()) === 1);

  // ---- 3b: RESURRECTION GUARD — removing the seeded parcel must not bring it back on the next
  //          Shift-click. Repro: plain-select A, Shift-add B (→[A,B]), Shift-click A to REMOVE it
  //          (→[B]), then Shift-add C → must be [B,C] (2), NOT [B,A,C] (3). The bug (sel left on the
  //          just-removed A) re-seeded A on the next Shift-click. ----
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  await clickAt(await edgeMidPoint(0));                 // plain-select A
  await page.waitForTimeout(350);
  await clickAt(await interiorPoint(1), ["Shift"]);     // Shift-add B → [A,B]
  await page.waitForTimeout(350);
  await clickAt(await interiorPoint(0), ["Shift"]);     // Shift-click A → REMOVE it → [B]
  await page.waitForTimeout(350);
  expect("3b-i: removing the seeded parcel drops the count to 1", (await selCount()) === 1);
  await clickAt(await interiorPoint(2), ["Shift"]);     // Shift-add C → must be [B,C], not [B,A,C]
  await page.waitForTimeout(350);
  expect("3b-ii: the removed parcel does NOT resurrect (\"2 parcels selected\", not 3)", (await selCount()) === 2);

  // ---- 4: plain-click empty canvas clears the merge selection (a pan would not). ----
  const empty = await emptyPoint();
  if (empty) {
    await clickAt(empty);
    await page.waitForTimeout(400);
    expect("4: plain-click empty canvas clears the merge selection", (await bannerShown()) === false);
  } else {
    console.log("  [SKIP] 4: could not locate a guaranteed-empty canvas point");
  }

  // ---- 5: end-to-end — plain-select A, Shift-add B (a full shared edge), Merge → the two lots
  //         fuse into one parcel (4 hit-strokes → 3). Proves the selection set drives Merge and is
  //         cleared on success. (Full 4-way greedy fusion depends on mergeRings partial-edge union,
  //         a separate concern from this selection fix, so the end-to-end check uses two lots.)
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  await clickAt(await edgeMidPoint(0));                 // plain-select A
  await page.waitForTimeout(350);
  await clickAt(await interiorPoint(1), ["Shift"]);     // Shift-add B (shares A's full right edge)
  await page.waitForTimeout(350);
  expect("5a: A + B picked via plain-then-Shift (\"2 parcels selected\")", (await selCount()) === 2);
  const mergeBtn = page.getByRole("button", { name: /Merge parcels/ }).first();
  await mergeBtn.click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(600);
  const remaining = await page.evaluate(() => {
    const svgEl = document.querySelector('svg[aria-label="Site plan canvas"]');
    return [...svgEl.querySelectorAll("polygon")].filter((p) => (p.getAttribute("stroke") || "").includes("0.001")).length;
  });
  console.log(`  parcel hit-strokes after merge: ${remaining}`);
  expect("5b: merge fused the two adjacent lots (4 → 3 parcels)", remaining === 3);
  expect("5c: merge banner cleared after a successful merge", (await bannerShown()) === false);
  await page.screenshot({ path: OUT + "after-merge.png" });

  await ctx.close();
  await browser.close();
  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
run().catch((e) => { console.error(e); process.exit(1); });
