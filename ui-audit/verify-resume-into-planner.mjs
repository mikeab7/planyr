/* V13 / V28 — deep-link + refresh resumes INTO the planner (does not bounce to the finder).
 *
 * The signed-in async-pull gap that ORIGINALLY stripped the route can't be reproduced in the
 * sandbox (no Supabase here → no gap; bootResolved starts true), so this is the LOGGED-OUT
 * NO-REGRESSION guard: it proves the common deep-link/refresh path still lands in the planner
 * with the route intact after the bootResume refactor (the fix must not break the working path).
 * The signed-in resume itself is owed as a VERIFICATION.md V### click-through.
 *
 * Run: npm run build && npx vite preview --port 4173, then  node ui-audit/verify-resume-into-planner.mjs */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const SITES_KEY = "planarfit:sites:v1";        // logged-out store
const CUR_KEY = "planarfit:currentSite:v1";
const GID = "grp-resume-test", SID = "site-resume-test";

const results = [];
const check = (n, p, d = "") => { results.push({ n, p }); console.log(`  ${p ? "✅ PASS" : "❌ FAIL"} — ${n}${d ? "  · " + d : ""}`); };

const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1380, height: 900 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
const errs = []; page.on("pageerror", (e) => errs.push(String(e)));

// Boot once (clean origin), then seed one local site + set it current.
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
await page.evaluate(({ sk, ck, gid, sid }) => {
  const site = { schemaVersion: 2, id: sid, groupId: gid, site: "Resume Test", name: "Concept A",
    origin: { lat: 29.78, lon: -95.8 }, county: "harris", parcels: [], els: [], markups: [], measures: [], callouts: [], settings: {} };
  localStorage.setItem(sk, JSON.stringify({ [sid]: site }));
  localStorage.setItem(ck, sid);
}, { sk: SITES_KEY, ck: CUR_KEY, gid: GID, sid: SID });

const inPlanner = async () => {
  // The MapFinder stays MOUNTED behind the planner (the basemap sits under the planner SVG),
  // so its "Find a site" input is in the DOM either way — use VISIBILITY, not presence. The
  // planner-only tool rail (Yield panel + the Building/Trailer/Detention tools) is the positive
  // signal; the breadcrumb names the project when one is open ("Resume Test"), else "Select a project".
  const finderVisible = await page.locator('input[placeholder^="Find a site"]').first().isVisible().catch(() => false);
  const planner = await page.evaluate(() => /Yield/.test(document.body.innerText) && /Building|Trailer|Detention/.test(document.body.innerText));
  const crumb = await page.evaluate(() => (document.body.innerText.match(/Select a project/) ? "select" : "named"));
  return { finderVisible, planner, crumb };
};

// 1) Deep-link straight into the project.
await page.goto(BASE + "#/project/" + GID + "/site", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
const hash1 = await page.evaluate(() => location.hash);
check("deep-link: route is NOT stripped to #/", hash1.includes("project/" + GID), `hash=${hash1}`);
const s1 = await inPlanner();
check("deep-link: landed in the PLANNER (tool rail present, finder search hidden)", s1.planner && !s1.finderVisible, `planner=${s1.planner} finderVis=${s1.finderVisible}`);
check("deep-link: breadcrumb names the project (not 'Select a project')", s1.crumb === "named", `crumb=${s1.crumb}`);

// 2) The real V13 repro — a hard reload at the project URL.
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
const hash2 = await page.evaluate(() => location.hash);
check("after reload: route STILL the project (not bounced to #/)", hash2.includes("project/" + GID), `hash=${hash2}`);
const s2 = await inPlanner();
check("after reload: STILL in the planner (tool rail present, finder search hidden)", s2.planner && !s2.finderVisible, `planner=${s2.planner} finderVis=${s2.finderVisible}`);
check("after reload: breadcrumb still names the project", s2.crumb === "named", `crumb=${s2.crumb}`);

// 3) currentSite pointer preserved (the cleanup must NOT have nulled it).
const cur = await page.evaluate((k) => localStorage.getItem(k), CUR_KEY);
check("currentSite pointer preserved across the deep-link + reload", cur === SID, `currentSite=${cur}`);

check("no uncaught page errors", errs.length === 0, errs.slice(0, 2).join(" | "));

await browser.close();
const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
