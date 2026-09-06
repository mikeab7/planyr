/* B1258752 (NEW-1) / B1258754 (NEW-3) / B1258755 (NEW-4) — live verification of the road
 * cross-section adversarial-review fixes. Logged-out, no external GIS, a throwaway seeded plan
 * (never one of the owner's real plans) — the ATTEMPT-BEFORE-YOU-PARK class, so it runs here.
 *
 * B1258752 (NEW-1) — the whole cross-section used to collapse to plain asphalt (every band fill AND
 * every lane-marking seam) the moment the section's single NARROWEST band (usually a 2' curb &
 * gutter) got sub-pixel, even while every other band (12' travel lanes, a 20' median) was still
 * perfectly resolvable. Fixed by gating each band's fill on ITS OWN width, and each lane-marking
 * seam on the narrower of its two adjacent bands, against two independent floors
 * (XSEC_BAND_FILL_MIN_PX / XSEC_STRIPE_MIN_PX in lib/roadCrossSection.js).
 *
 * B1258754 (NEW-3) — a designated right-of-way on a road with only the dialog's own single-band
 * wrapper (no REAL multi-band design) never drew on the canvas, even though the Properties panel's
 * own ROW field never required a real design. Fixed by pulling the ROW-line block out from under
 * `hasXSection(el)` in SitePlanner.jsx.
 *
 * B1258755 (NEW-4) — an asymmetric section (a sidewalk on one side only) could overrun the
 * designated ROW on that one side while the section's bare WIDTH SUM still read comfortably under
 * the ROW, so the old validity check (sum vs. designated) called it valid and painted bands outside
 * the ROW line. Fixed by judging validity against the section's actual per-side EXTENTS
 * (`rowMarginsBySide` in lib/roadCrossSection.js).
 *
 * Roads are seeded directly into a throwaway plan's `els` (the same technique
 * ui-audit/verify-b617-b619-fixes.mjs and diagnose-zoomdepth.mjs already use) rather than built
 * through ten dialog interactions each — this is a render-path fix, so seeding the exact `xsection`
 * object under test exercises SitePlanner.jsx's real production render code directly. NEW-4's
 * dialog-side wording (the per-side margin display, the "which side overran" warning) is checked
 * separately below by actually opening "Edit cross-section…" on the seeded roads.
 *
 * Run:  npm run build && npx vite preview --port 4173  (then)  node ui-audit/verify-road-xsection-review.mjs
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { roadStripBBox } from "../src/workspaces/site-planner/lib/siteModel.js";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/road-xsection-review/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const DEMO_ID = "verify-road-xsection-review";

// ---- NEW-1 — the owner's own measured repro: 5' sidewalk / 6' parkway / 2' curb & gutter / 12' /
// 12' / 20' median / 12' / 12' / 2' curb & gutter / 6' parkway / 5' sidewalk. Curb-to-curb 72',
// modeled total 94'.
const BOULEVARD_WITH_SIDEWALKS = [
  { type: "sidewalk", w: 5 }, { type: "parkway", w: 6 }, { type: "curbGutter", w: 2 },
  { type: "travel", w: 12 }, { type: "travel", w: 12 }, { type: "median", w: 20 },
  { type: "travel", w: 12 }, { type: "travel", w: 12 }, { type: "curbGutter", w: 2 },
  { type: "parkway", w: 6 }, { type: "sidewalk", w: 5 },
];
// ---- NEW-3 — a PLAIN single-band road (the dialog's own wrapper, never a real design) carrying a
// designated ROW. hasXSection() is false; the ROW must still draw.
const SINGLE_TRAVEL = [{ type: "travel", w: 24 }];
// ---- NEW-4 — a sidewalk on ONE side only. Modeled total 29' (5+12+12), curb-to-curb 24'.
const ASYM_SIDEWALK = [{ type: "sidewalk", w: 5 }, { type: "travel", w: 12 }, { type: "travel", w: 12 }];

const roadEl = (id, cy, bands, rowDesignFt, halfLen = 300) => {
  const pts = [{ x: -halfLen, y: cy }, { x: halfLen, y: cy }];
  const vtx = [{}, {}];
  const withinCurb = { travel: true, turnLane: true, median: true, shoulder: true, curbGutter: true, parking: true, bike: true, sidewalk: false, parkway: false, ditch: false };
  const travelW = bands.reduce((s, b) => s + (withinCurb[b.type] ? b.w : 0), 0);
  const xsection = { bands };
  if (rowDesignFt != null) xsection.rowDesignFt = rowDesignFt;
  const bbox = roadStripBBox(pts, vtx, travelW, 0.5, { defaultRadius: 120 });
  return { id, type: "road", pts, vtx, travelW, curb: 0.5, roadClass: "local", xsection, ...bbox };
};

const xsecRoad = roadEl("xsec-road", 0, BOULEVARD_WITH_SIDEWALKS, null, 300);
const singleBandRow = roadEl("single-band-row", 500, SINGLE_TRAVEL, 60, 150);
const asymInvalid = roadEl("asym-invalid", 900, ASYM_SIDEWALK, 30, 100); // overruns the sidewalk side by 2'
const asymValid = roadEl("asym-valid", 1200, ASYM_SIDEWALK, 40, 100); // valid — left 3' / right 8' margin

const parcel = { id: "pc1", locked: false, points: [{ x: -700, y: -200 }, { x: 700, y: -200 }, { x: 700, y: 1400 }, { x: -700, y: 1400 }] };
const demoSite = {
  id: DEMO_ID, groupId: DEMO_ID, site: "Verify road xsection review", name: "Plan 1", origin: null, county: null,
  parcels: [parcel], els: [xsecRoad, singleBandRow, asymInvalid, asymValid],
  measures: [], callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [DEMO_ID]: demoSite })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(DEMO_ID)});
} catch (e) {} })();`;

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox", "--ignore-certificate-errors"],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, ignoreHTTPSErrors: true });
await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
await assertMeasurable(page, "verify-road-xsection-review");
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));

const results = [];
const check = (ok, label, detail = "") => { results.push(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`); };
let reported = 0;
const flush = (label) => { console.log(`\n--- ${label} ---`); for (const l of results.slice(reported)) console.log(l); reported = results.length; };

await page.goto(BASE, { waitUntil: "load" });
// B1213312's Dashboard landing route means "/" no longer drops straight into a workspace even with
// a currentSite already seeded — switch to the Site Planner tab explicitly (e2e/helpers.js's own
// `openModule` pattern), then the pre-populated plan loads with no further "start blank" step.
await page.getByTestId("module-tab-site-planner").filter({ visible: true }).click({ timeout: 8000 }).catch(() => {});
await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 20000 });
await page.waitForTimeout(800);

const decorationOf = (id) => page.evaluate((elId) => {
  const g = document.querySelector(`[data-el-id="${elId}"]`);
  if (!g) return null;
  const clippedG = g.querySelector("g[clip-path]");
  const allPolys = [...g.querySelectorAll("polygon")];
  const clippedPolys = clippedG ? [...clippedG.querySelectorAll("polygon")] : [];
  return {
    polygons: allPolys.length,
    clippedPolygons: clippedPolys.length,
    unclippedPolygons: allPolys.length - clippedPolys.length,
    // Lane-marking seams use a fixed hardcoded stroke ("#e6b800" yellow / "#f2f2f2" near-white,
    // SitePlanner.jsx's drawSeam); the road's own two face-of-curb stripe lines (drawn regardless of
    // any xsection) use the theme stroke token instead, so filtering on color isolates the
    // xsection-specific seams from the road's ordinary curb-stripe polylines living in the same <g>.
    laneMarkPolylines: [...g.querySelectorAll("polyline")].filter((p) => {
      const s = p.getAttribute("stroke");
      return s === "#e6b800" || s === "#f2f2f2";
    }).length,
    dashedRowLines: [...g.querySelectorAll('polyline[stroke="var(--text-tertiary)"]')].filter((p) => p.getAttribute("stroke-dasharray")).length,
    rowLabel: [...g.querySelectorAll("text")].map((t) => t.textContent).find((t) => /R\.O\.W\./.test(t)) || null,
  };
}, id);

const getPpf = () => page.evaluate(() => {
  const svg = document.querySelector('[data-testid="planner-canvas"]');
  const v = svg && svg.getAttribute("data-render-ppf");
  return v == null ? null : parseFloat(v);
});

const centerOf = async (id) => page.evaluate((elId) => {
  const n = document.querySelector(`[data-el-id="${elId}"]`);
  if (!n) return null;
  const r = n.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}, id);

// Zoom (mouse-wheel, pivoting on the given screen point) until data-render-ppf is within 8% of
// `target` or the iteration budget runs out — negative deltaY zooms IN (raises ppf), matching this
// repo's existing convention (ui-audit/diagnose-zoomdepth.mjs). Each wheel notch changes ppf by a
// roughly constant FACTOR (exponential zoom), not a constant amount, so the step magnitude scales
// with the log-distance still to cover rather than a fixed 80 — a fixed step either crawls toward a
// far target or oscillates past a near one.
async function zoomToPpf(target, pivot) {
  for (let i = 0; i < 120; i++) {
    const ppf = await getPpf();
    if (ppf == null) return null;
    if (Math.abs(ppf - target) / target < 0.12) return ppf;
    const mag = Math.max(20, Math.min(240, Math.abs(Math.log(target / ppf)) * 180));
    await page.mouse.move(pivot.x, pivot.y);
    await page.mouse.wheel(0, ppf < target ? -mag : mag);
    await page.waitForTimeout(50);
  }
  return getPpf();
}

// ============================================================================================
// NEW-1 — per-band zoom gate. Zoom to three ppf levels on the seeded 11-band boulevard and check
// the decoration count at each — never an all-or-nothing collapse while any band is still
// resolvable (median @ 20' and both travel-lane pairs are resolvable down to a far lower ppf than
// the section's narrowest 2' curb & gutter band needs).
// ============================================================================================
{
  const pivot = await centerOf(xsecRoad.id);
  check(!!pivot, "NEW-1: the seeded boulevard-with-sidewalks road is found on the canvas");

  const at1_5 = await zoomToPpf(1.5, pivot);
  const d1_5 = await decorationOf(xsecRoad.id);
  check(Math.abs(at1_5 - 1.5) / 1.5 < 0.12, `reached ~1.5 px/ft (actual ${at1_5?.toFixed(3)})`);
  // at 1.5 px/ft every band (incl. the 2' curb & gutter, 2×1.5=3px) clears XSEC_BAND_FILL_MIN_PX.
  check(d1_5 && d1_5.clippedPolygons === 3, "at 1.5 px/ft: 3 clipped within-curb fills (median + 2 curb & gutter)", JSON.stringify(d1_5));
  check(d1_5 && d1_5.unclippedPolygons === 4, "at 1.5 px/ft: 4 unclipped outside-curb fills (2 sidewalks + 2 parkways)", JSON.stringify(d1_5));
  check(d1_5 && d1_5.laneMarkPolylines === 6, "at 1.5 px/ft: all 6 lane-marking seams render", JSON.stringify(d1_5));
  await page.screenshot({ path: OUT + "01-boulevard-1.5ppf.png" });

  const at1_0 = await zoomToPpf(1.0, pivot);
  const d1_0 = await decorationOf(xsecRoad.id);
  check(Math.abs(at1_0 - 1.0) / 1.0 < 0.12, `reached ~1.0 px/ft (actual ${at1_0?.toFixed(3)})`);
  // NEW-1 fix: at 1.0 px/ft the 2' curb & gutter (2px) drops below XSEC_BAND_FILL_MIN_PX (3px) and
  // correctly stops painting its OWN fill — but the median (20px) and both sidewalks/parkways
  // (5-6px) are still comfortably resolvable and MUST still paint. Pre-fix, the single
  // `minBandFt*ppf>=3` gate would have zeroed EVERY fill and EVERY seam here.
  check(d1_0 && d1_0.clippedPolygons === 1, "NEW-1 fix: at 1.0 px/ft, the median fill alone still paints (curb & gutter's own fill correctly drops)", JSON.stringify(d1_0));
  check(d1_0 && d1_0.unclippedPolygons === 4, "NEW-1 fix: at 1.0 px/ft, both sidewalks AND both parkways still paint (5-6ft bands, well clear of the floor)", JSON.stringify(d1_0));
  check(d1_0 && d1_0.laneMarkPolylines === 6, "NEW-1 fix: at 1.0 px/ft, every lane-marking seam still renders (XSEC_STRIPE_MIN_PX is far below the band-fill floor)", JSON.stringify(d1_0));
  await page.screenshot({ path: OUT + "02-boulevard-1.0ppf-no-collapse.png" });

  const at0_3 = await zoomToPpf(0.3, pivot);
  const d0_3 = await decorationOf(xsecRoad.id);
  // Deep zoom-out via mouse-wheel is imprecise (each notch's ppf multiplier isn't perfectly
  // constant this far from 1:1) — a wide band is enough here, since the point is "far zoomed out",
  // not a specific number; the decoration assertions below are what actually matter.
  check(at0_3 != null && at0_3 > 0.1 && at0_3 < 0.5, `reached a deep zoom-out, well under 1 px/ft (actual ${at0_3?.toFixed(3)})`);
  // Deep zoom-out: the sidewalks/parkways (5-6ft) and curb & gutter (2ft) all drop below the fill
  // floor now, but the 20' median (6px at 0.3 ppf) and the travel/median seams (12ft bands) are
  // STILL resolvable and still paint — the section never reverts to plain undifferentiated asphalt
  // while ANY band remains resolvable, which is the whole point of the fix.
  check(d0_3 && d0_3.clippedPolygons === 1, "NEW-1 fix: even zoomed far out (~0.3 px/ft), the 20' median fill is STILL resolvable and still paints", JSON.stringify(d0_3));
  check(d0_3 && d0_3.laneMarkPolylines >= 4, "NEW-1 fix: the travel/median seams (12' bands) are still drawn at this zoom — the road is not plain asphalt", JSON.stringify(d0_3));
  await page.screenshot({ path: OUT + "03-boulevard-0.3ppf-median-survives.png" });
  flush("NEW-1");
}

// ============================================================================================
// NEW-3 — a designated ROW on a PLAIN single-band road (hasXSection() false) must still draw.
// ============================================================================================
{
  await zoomToPpf(2.5, await centerOf(singleBandRow.id));
  const d = await decorationOf(singleBandRow.id);
  check(d && d.dashedRowLines === 2, "NEW-3 fix: a single-band road's designated 60' ROW draws both boundary lines on the canvas (hasXSection() is false here)", JSON.stringify(d));
  check(d && d.rowLabel === "60′ R.O.W.", "NEW-3 fix: the inline ROW label renders too", JSON.stringify(d && d.rowLabel));
  check(d && d.polygons === 0, "a single-band road paints no band-fill decoration (it has no real design) — only the ROW lines are new here", JSON.stringify(d));
  await page.screenshot({ path: OUT + "04-single-band-row.png" });
  flush("NEW-3");
}

// ============================================================================================
// NEW-4 — an asymmetric (sidewalk-one-side) section: INVALID overrun never draws a ROW boundary;
// a VALID (non-overrunning) asymmetric ROW draws normally and the dialog reports per-side margins.
// ============================================================================================
{
  await zoomToPpf(3, await centerOf(asymInvalid.id));
  const dInvalid = await decorationOf(asymInvalid.id);
  check(dInvalid && dInvalid.dashedRowLines === 0 && !dInvalid.rowLabel, "NEW-4 fix: the invalid asymmetric ROW (sidewalk side overruns by 2') draws NO boundary lines — never silently clamped", JSON.stringify(dInvalid));
  await page.screenshot({ path: OUT + "05-asym-invalid-no-row.png" });
  flush("NEW-4 (canvas, invalid)");

  await zoomToPpf(3, await centerOf(asymValid.id));
  const dValid = await decorationOf(asymValid.id);
  check(dValid && dValid.dashedRowLines === 2 && dValid.rowLabel === "40′ R.O.W.", "the valid asymmetric ROW (40') draws normally", JSON.stringify(dValid));
  await page.screenshot({ path: OUT + "06-asym-valid-row.png" });
  flush("NEW-4 (canvas, valid)");

  // Dialog-side check: reopen "Edit cross-section…" on each and confirm the wording.
  const openDialogOn = async (id) => {
    // The prior zoomToPpf calls left the view zoomed in tight around a DIFFERENT road (all four
    // seeded roads share one view scale/pan), so the target here can easily be off-screen — zoom to
    // fit the whole plan back into view before locating it.
    await page.getByRole("button", { name: "Zoom to fit" }).first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
    const c = await centerOf(id);
    await page.mouse.click(c.x, c.y);
    await page.waitForTimeout(250);
    const already = await page.getByTestId("edit-road-xsection").count();
    if (!already) await page.getByText("Properties", { exact: true }).click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(250);
    const btn = page.getByTestId("edit-road-xsection");
    if (!(await btn.count())) {
      console.log("edit-road-xsection not found for", id, "(selection likely missed) — body snippet:", (await page.locator("body").innerText()).slice(0, 400));
    }
    await btn.first().click({ timeout: 8000 });
    await page.waitForTimeout(300);
  };
  await openDialogOn(asymInvalid.id);
  const invalidText = await page.locator("body").innerText();
  check(/run past the designated 30′ right-of-way on the left side by 2/.test(invalidText.replace(/\s+/g, " ")), "NEW-4 fix: the dialog names the OVERRUNNING SIDE ('left') and the amount (2′), not just a bare total mismatch", invalidText.match(/⚠[^\n]*/)?.[0] || "warning line not found");
  await page.screenshot({ path: OUT + "07-dialog-asym-invalid-warning.png" });
  await page.getByRole("button", { name: /^Cancel$/ }).click();
  await page.waitForTimeout(200);
  flush("NEW-4 (dialog, invalid)");

  await openDialogOn(asymValid.id);
  const validText = await page.locator("body").innerText();
  check(/ROW margin\s*3′\s*left.*8′\s*right/s.test(validText.replace(/\s+/g, " ")), "NEW-4 fix: the dialog reports the two margins SEPARATELY for an asymmetric section (3′ left · 8′ right), not one misleading averaged 'each side' figure", validText.match(/ROW margin[^\n]*/)?.[0] || "margin line not found");
  check(!/⚠/.test(validText), "no overrun warning for the valid case");
  await page.screenshot({ path: OUT + "08-dialog-asym-valid-split-margins.png" });
  await page.getByRole("button", { name: /^Cancel$/ }).click();
  flush("NEW-4 (dialog, valid)");
}

check(errs.length === 0, "no page errors", errs.join(" | "));
flush("final");

const fails = results.filter((r) => r.startsWith("❌"));
console.log(`\n${fails.length ? "FAIL" : "PASS"} — ${results.length - fails.length} checks passed, ${fails.length} failed. Screens → ${OUT}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
