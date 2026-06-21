/* LIVE verify for B355 — new site plans default to lettered concepts (Concept A, B, … AA).
 * Drives the real Site Planner: seeds a saved site whose one plan is "Concept A", resumes
 * into the planner, clicks Plan ▾ → "＋ New plan", and reads the resulting plan label —
 * expecting "Concept B" (continues past the highest existing letter, per-site). Also checks
 * a gap case (only "Concept C" present → next is "Concept D", never reused A) and a legacy
 * case ("Plan 1" present → next concept is "Concept A"). Runs logged-out (sandbox proxy
 * blocks sign-in); the logged-out localStorage store is the same code path used signed-in. */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
const SITES_KEY = "planarfit:sites:v1";
const CURRENT_KEY = "planarfit:currentSite:v1";

const results = [];
const ok = (n, p, d) => { results.push(p); console.log(`${p ? "PASS ✅" : "FAIL ❌"}  ${n}  —  ${d}`); };

// A minimal saved site group: one located plan (a 3-point parcel so "New plan" has a parcel
// to keep), named per the case. groupId ties siblings together; the planner resumes into `cur`.
function seed(planName) {
  const id = "sSEED1";
  const parcels = [{ id: "p1", points: [[0, 0], [200, 0], [200, 200]], locked: true }];
  const site = { id, groupId: id, site: "Katy Test Site", name: planName, origin: { lat: 29.78, lon: -95.82 },
    county: "harris", parcels, els: [], measures: [], settings: {}, underlay: null, status: "active", updatedAt: Date.now() };
  return { sites: JSON.stringify({ [id]: site }), cur: id };
}

async function newPlanLabel(page, planName) {
  const { sites, cur } = seed(planName);
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.evaluate(([k, v, ck, cv]) => { localStorage.setItem(k, v); localStorage.setItem(ck, cv); }, [SITES_KEY, sites, CURRENT_KEY, cur]);
  await page.reload({ waitUntil: "networkidle" });
  // Resume lands in the planner. Open the Plan ▾ menu and create a new plan on the same parcel.
  await page.waitForSelector('[title="Switch or rename plan"]', { timeout: 15000 });
  await page.click('[title="Switch or rename plan"]');
  await page.waitForSelector('text=＋ New plan', { timeout: 8000 });
  await page.click('text=＋ New plan');
  await page.waitForTimeout(800); // let the new plan save + the header re-label
  // The Plan ▾ trigger shows the current plan's label.
  const label = await page.$eval('[title="Switch or rename plan"]', (el) => el.textContent.trim());
  return label;
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const page = await browser.newPage();
  const errs = [];
  // The synthetic seed parcel renders in a headless viewport with NO basemap (sandbox blocks
  // map tiles), so the projection degrades to NaN SVG geometry attributes — a known seed/headless
  // artifact, orthogonal to plan naming. Keep watching for genuine JS errors only.
  // Two well-known sandbox classes: (1) NaN SVG geometry from the basemap-less seed; (2) CORS /
  // network failures from the app probing external county/city GIS hosts (sandbox network policy).
  const isSeedNoise = (t) =>
    /attribute \w+: (Expected|.*NaN)/i.test(t) || /NaN/.test(t) ||
    /CORS|ERR_FAILED|Failed to load resource|Access to fetch/i.test(t);
  page.on("console", (m) => { if (m.type() === "error" && !isSeedNoise(m.text())) errs.push(m.text()); });
  page.on("pageerror", (e) => { if (!isSeedNoise(String(e))) errs.push(String(e)); });

  try {
    const fromA = await newPlanLabel(page, "Concept A");
    ok("next-after-A", /Concept B/.test(fromA), `existing "Concept A" → new plan labelled "${fromA}" (want Concept B)`);

    const fromGap = await newPlanLabel(page, "Concept C");
    ok("past-highest-not-gap", /Concept D/.test(fromGap), `existing "Concept C" (A/B deleted) → "${fromGap}" (want Concept D, never reuse A)`);

    const fromLegacy = await newPlanLabel(page, "Plan 1");
    ok("legacy-plan-n-ignored", /Concept A/.test(fromLegacy), `existing "Plan 1" → "${fromLegacy}" (want Concept A — legacy names ignored)`);

    ok("no-console-errors", errs.length === 0, errs.length ? `console errors: ${errs.slice(0, 3).join(" | ")}` : "clean boot, no console/page errors");
  } catch (e) {
    ok("harness", false, "threw: " + e.message);
  } finally {
    await browser.close();
  }

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
})();
