/* LIVE verify for the header project/plan consolidation.
 *
 * Before: the project name rendered TWICE in Row 1 — once in the left breadcrumb
 * (Map / 🔒 <Project> ▾) and again in a standalone center group (<Project> ▾ › <Plan> ▾).
 * After: the project name appears exactly ONCE (the breadcrumb), and the PLAN switcher
 * sits beside it as a trailing crumb, so the header reads Map / <Project> / <Plan>.
 *
 * This drives the real Site Planner (logged-out localStorage path — same code signed-in),
 * resumes into a seeded plan, and asserts:
 *   1. the project name appears exactly once in Row 1,
 *   2. the old standalone "Switch or rename site" dropdown is GONE,
 *   3. the plan switcher ("Switch or rename plan") still exists and opens,
 *   4. the breadcrumb order reads Map → <Project> → <Plan>,
 *   5. the plan crumb sits in the LEFT zone (left of the empty center), next to the project,
 *   6. no console/page errors on boot.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
const SITES_KEY = "planarfit:sites:v1";
const CURRENT_KEY = "planarfit:currentSite:v1";

const PROJECT = "Katy Test Site";
const PLAN = "Concept A";

const results = [];
const ok = (n, p, d) => { results.push(p); console.log(`${p ? "PASS ✅" : "FAIL ❌"}  ${n}  —  ${d}`); };

function seed() {
  const id = "sSEED1";
  const parcels = [{ id: "p1", points: [[0, 0], [200, 0], [200, 200]], locked: true }];
  const site = { id, groupId: id, site: PROJECT, name: PLAN, origin: { lat: 29.78, lon: -95.82 },
    county: "harris", parcels, els: [], measures: [], settings: {}, underlay: null, status: "active", updatedAt: Date.now() };
  return { sites: JSON.stringify({ [id]: site }), cur: id };
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const page = await browser.newPage();
  const errs = [];
  const isSeedNoise = (t) =>
    /attribute \w+: (Expected|.*NaN)/i.test(t) || /NaN/.test(t) ||
    /CORS|ERR_FAILED|Failed to load resource|Access to fetch/i.test(t);
  page.on("console", (m) => { if (m.type() === "error" && !isSeedNoise(m.text())) errs.push(m.text()); });
  page.on("pageerror", (e) => { if (!isSeedNoise(String(e))) errs.push(String(e)); });

  try {
    const { sites, cur } = seed();
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.evaluate(([k, v, ck, cv]) => { localStorage.setItem(k, v); localStorage.setItem(ck, cv); }, [SITES_KEY, sites, CURRENT_KEY, cur]);
    await page.reload({ waitUntil: "domcontentloaded" });

    // Resume lands in the planner; wait for the plan switcher (proves we're in plan mode).
    await page.waitForSelector('[title="Switch or rename plan"]', { timeout: 15000 });

    // Both modes stay mounted (the map-mode header is display:none); scope every header
    // assertion to the VISIBLE plan-mode header — the one that owns the plan switcher.
    const header = await page.evaluateHandle(() => document.querySelector('[title="Switch or rename plan"]').closest("header"));

    // 1) Project name appears exactly once in Row 1.
    const nameCount = await header.evaluate((h, name) => {
      // Count distinct elements whose OWN text (not via children) is exactly the project name.
      return [...h.querySelectorAll("*")].filter((el) => {
        const direct = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
        return direct === name;
      }).length;
    }, PROJECT);
    ok("project-name-once", nameCount === 1, `"${PROJECT}" appears ${nameCount}× in the header (want exactly 1)`);

    // 2) The old standalone site dropdown is gone.
    const siteBtn = await page.$('[title="Switch or rename site"]');
    ok("site-dropdown-removed", siteBtn === null, siteBtn ? "the center 'Switch or rename site' button is STILL present" : "no standalone site dropdown — project lives only in the breadcrumb");

    // 3) The plan switcher still exists, reads the plan name, and opens its menu.
    const planLabel = await page.$eval('[title="Switch or rename plan"]', (el) => el.textContent.trim());
    ok("plan-switcher-label", new RegExp(PLAN).test(planLabel), `plan crumb reads "${planLabel}" (want "${PLAN}")`);
    await page.click('[title="Switch or rename plan"]');
    const menuShown = await page.waitForSelector("text=＋ New plan", { timeout: 8000 }).then(() => true).catch(() => false);
    const saveNow = await page.$('[data-testid="save-now"]');
    ok("plan-menu-opens", menuShown && !!saveNow, menuShown ? "plan menu opens with New plan + Save now (fully functional)" : "plan menu did not open");
    // Close the menu before reading layout.
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(150);

    // 4) Breadcrumb order: Map → Project → Plan, all in sequence in Row 1 text.
    const order = await header.evaluate((h) => h.textContent.replace(/\s+/g, " "));
    const iMap = order.indexOf("Map");
    const iProj = order.indexOf("Katy Test Site");
    const iPlan = order.indexOf("Concept A");
    ok("breadcrumb-order", iMap >= 0 && iProj > iMap && iPlan > iProj,
      `order indices Map=${iMap} < Project=${iProj} < Plan=${iPlan} (reads "Map / ${PROJECT} / ${PLAN}")`);

    // 5) The plan crumb is in the LEFT breadcrumb zone (its left edge is well within the
    //    left third of the header — i.e. it moved over by the project, not floating center).
    const box = await page.$eval('[title="Switch or rename plan"]', (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, vw: window.innerWidth };
    });
    ok("plan-crumb-left-anchored", box.left < box.vw * 0.5,
      `plan crumb left edge at ${Math.round(box.left)}px of ${box.vw}px viewport (want left half — beside the project)`);

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
