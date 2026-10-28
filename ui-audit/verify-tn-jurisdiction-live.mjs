/* NEW-1 (Tennessee) — the header chip AND the Site Analysis "Who governs this site" section on Tennessee sites, SIGNED IN on the real
 * deploy as the throwaway test account.
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-tn-jurisdiction-live.mjs [https://planyr.io] [--expect-sha <merge sha>] [--shots <dir>]
 *
 * For each case it writes a THROWAWAY one-parcel site to the test account, opens it in the real planner, reads the header badge (the
 * untruncated `data-jurisdiction-full` and its hover) and — for the cases that matter — opens Analysis and reads the "Who governs" grid, then
 * DELETES every site it wrote (local + cloud) and verifies they are gone. Never touches a real plan (constraint #7 / #15).
 * Known-good arms: a Texas (Katy) site and a Georgia (Atlanta) site must still say exactly what they always did — if the instrument cannot
 * see a badge at all the run is VOID (exit 2), never green. Needs outbound HTTPS to the deploy and the three Tennessee services; the browser
 * must trust the egress proxy's CA (see ui-audit/lib/signedInSession.mjs). */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import fs from "node:fs";

const args = process.argv.slice(2);
const base = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const expectSha = args.includes("--expect-sha") ? args[args.indexOf("--expect-sha") + 1] : null;
const SHOTS = args.includes("--shots") ? args[args.indexOf("--shots") + 1] : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
let failed = 0, voided = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };
const note = (s) => console.log("   · " + s);

const RUN = Math.random().toString(36).slice(2, 6);
const H = 150; // parcel half-side, site-frame feet (a ~300 ft lot, so containment is clean at a city line)
const mk = (tag, lat, lon, county) => {
  const id = `zz-tnjur-${tag}-${RUN}`;
  return {
    id, groupId: id, site: `zz TN jurisdiction ${tag}`, name: "Plan 1", origin: { lat, lon }, county,
    parcels: [{ id: "pc1", active: true, locked: false, points: [{ x: -H, y: -H }, { x: H, y: -H }, { x: H, y: H }, { x: -H, y: H }] }],
    els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), data: { status: "active" }, status: "active",
  };
};
/* [tag, lat, lon, county key, expected header text, analysis?] */
const TN = [
  ["culvert", 36.137653, -86.75516, "tn_davidson", "Metro Nashville-Davidson County, TN", true],   // 20 Culvert St, Nashville
  ["bellemeade", 36.1, -86.85, "tn_davidson", "City of Belle Meade, TN · Metro Nashville-Davidson County", false],
  ["memphis", 35.1495, -90.049, "tn_shelby", "City of Memphis, TN · Shelby County", true],
  ["unincshelby", 35.19, -89.68, "tn_shelby", "Unincorporated Shelby County, TN", false],
  ["germantown", 35.0868, -89.8101, "tn_shelby", "City of Germantown, TN · Shelby County", false],
  ["collierville", 35.042, -89.6645, "tn_shelby", "City of Collierville, TN · Shelby County", false],
  ["murfreesboro", 35.8456, -86.3903, "tn_rutherford", "City of Murfreesboro, TN · Rutherford County", false],
  ["eppsmill", 35.7299, -86.3194, "tn_rutherford", "Unincorporated Rutherford County, TN", true],   // Epps Mill Rd / I-24
  ["chattanooga", 35.0456, -85.3097, "tn_hamilton", "City of Chattanooga, TN · Hamilton County", false],
  ["clarksville", 36.5298, -87.3595, "tn_montgomery", "City of Clarksville, TN · Montgomery County", false],
  ["knoxville", 35.9606, -83.9207, "tn_statewide", "City of Knoxville, TN · Knox County", false],
  ["unincknox", 35.99, -84.09, "tn_statewide", "Unincorporated Knox County, TN", false],
  ["goodlettsville", 36.345, -86.7, "tn_statewide", "City of Goodlettsville, TN · Sumner County", false],   // Sumner side of the county line
  ["lauderdale", 35.7, -89.6, "tn_statewide", "Unincorporated Lauderdale County, TN", false],           // rural, statewide-parcel county
  ["lynchburg", 35.2845, -86.3719, "tn_statewide", "Metro Lynchburg-Moore County, TN", false],
  ["hartsville", 36.3987, -86.1594, "tn_statewide", "Metro Hartsville-Trousdale County, TN", false],
];
const CASES = Object.fromEntries(TN.map(([tag, lat, lon, county]) => [tag, mk(tag, lat, lon, county)]));
CASES.katy = mk("katy", 29.78, -95.79, "fortbend");
CASES.atlanta = mk("atlanta", 33.749, -84.388, "ga_fulton");

const s = await openSignedIn({ base, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
const { page } = s;
const ids = Object.values(CASES).map((c) => c.id);
try {
  await assertMeasurable(page, "verify-tn-jurisdiction-live");
  const served = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).then((j) => j.build).catch(() => null));
  console.log("signed in as", s.proof.email, "| served build", served, "| run", RUN);
  if (expectSha) check("the deploy is serving the build under test", String(served || "").startsWith(expectSha.slice(0, 7)), `served ${served}`);

  const ins = await page.evaluate(async (sites) => {
    const { data: u } = await window.pfSupabase.auth.getUser();
    const errs = [];
    for (const site of sites) {
      const row = { id: site.id, group_id: site.groupId, site: site.site, name: site.name, county: site.county, updated_at: new Date().toISOString(), data: site, user_id: u.user.id };
      let r = await window.pfSupabase.from("sites").insert(row);
      if (r.error && /user_id/.test(String(r.error.message))) { delete row.user_id; r = await window.pfSupabase.from("sites").insert(row); }
      if (r.error) errs.push(site.id + ": " + String(r.error.message));
    }
    return errs;
  }, Object.values(CASES));
  check(`${ids.length} throwaway sites written to the test account`, ins.length === 0, ins.join("; "));

  async function open(c) {
    await page.goto(`${base}/#/project/${c.id}/site`, { waitUntil: "load" });
    await page.reload({ waitUntil: "load" });
    await page.getByTestId("planner-canvas").waitFor({ timeout: 45000 });
    let badge = null;
    for (let i = 0; i < 45; i++) {
      badge = await page.evaluate(() => { const b = document.querySelector('[data-testid="jurisdiction-badge"]'); return b ? { full: b.getAttribute("data-jurisdiction-full"), title: b.getAttribute("title") } : null; });
      if (badge && badge.full && !/Couldn't check|^Unincorporated$/.test(badge.full)) break;
      await page.waitForTimeout(1000);
    }
    return badge;
  }
  const openAnalysis = async () => {
    if (!(await page.locator('[data-site-analysis="1"]').count())) await page.locator('button[title="Analysis"]').click();
    await page.waitForSelector('[data-site-analysis="1"]', { timeout: 30000 });
    await page.waitForFunction(() => !document.querySelector('[data-site-analysis="1"]')?.innerText.includes("Checking the maps"), null, { timeout: 120000 });
    await page.waitForTimeout(600);
    return page.evaluate(() => {
      const root = document.querySelector('[data-site-analysis="1"]');
      const g = root.querySelector('[data-section="governs"]');
      const facts = {};
      if (g) { const kids = [...g.querySelectorAll('[data-governs-grid="1"] > *')].map((e) => e.innerText.replace(/\s+/g, " ").trim()); for (let i = 0; i + 1 < kids.length; i += 2) facts[kids[i]] = kids[i + 1]; }
      return { governs: g ? g.innerText.replace(/\s+/g, " ").trim() : null, facts, all: root.innerText };
    });
  };

  // ── KNOWN-GOOD ARMS ──
  console.log("\n— Texas control (Katy) —");
  const katy = await open(CASES.katy);
  if (!katy || !katy.full) { console.log("VOID — no jurisdiction badge on the Texas control; the instrument cannot see a badge."); voided++; }
  else {
    note(`badge: ${katy.full}`);
    check("Katy: a Texas jurisdiction, nothing Tennessean", /County/.test(katy.full) && !/, TN|Metro /.test(katy.full), katy.full);
    check("Katy: the hover is the Texas one (no Tennessee note, no Tennessee source)", !/Tennessee|TDOT/.test(katy.title || ""));
  }
  console.log("\n— Georgia control (Atlanta) —");
  const atl = await open(CASES.atlanta);
  note(`badge: ${atl && atl.full}`);
  check("Atlanta: still 'City of Atlanta, GA', not Tennessee", /City of Atlanta, GA/.test(atl?.full || "") && !/TN/.test(atl?.full || ""), atl?.full || "");

  // ── THE TENNESSEE SITES ──
  console.log("\n— Tennessee sites: the header chip —");
  const analysisCases = [];
  for (const [tag, , , , want, withAnalysis] of TN) {
    const b = await open(CASES[tag]);
    note(`${tag}: ${b && b.full}`);
    check(`${tag}: header reads "${want}"`, (b && b.full) === want, b && b.full);
    check(`${tag}: no ETJ / Texas wording on the chip or its hover`, !!b && !/ETJ|extraterritorial|TxDOT|TxGIO/i.test((b.full || "") + " " + (b.title || "")));
    check(`${tag}: the hover carries the State of Tennessee source and the vintage`, !!b && /State of Tennessee/.test(b.title || "") && /last edited 2026-/.test(b.title || ""), (b?.title || "").slice(0, 160));
    if (tag === "memphis" || tag === "unincshelby") check(`${tag}: the hover says Memphis + unincorporated Shelby share one code`, /Unified Development Code/.test(b?.title || ""));
    if (tag === "germantown") check("germantown: no Unified Development Code sentence", !/Unified Development Code/.test(b?.title || ""));
    if (tag === "culvert" || tag === "bellemeade") check(`${tag}: the hover explains the Metro government`, /Metropolitan government/.test(b?.title || ""));
    if (withAnalysis) analysisCases.push(tag);
  }

  console.log("\n— Tennessee sites: Site Analysis, top section —");
  for (const tag of [...analysisCases, "katy"]) {
    await open(CASES[tag]);
    const a = await openAnalysis();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/tn-analysis-${tag}.png` });
    note(`${tag}: ${a.governs}`);
    if (tag === "katy") { check("katy: Analysis names a Texas road maintainer, never TDOT", !!a.governs && !/TDOT|Tennessee/.test(a.governs), (a.governs || "").slice(0, 200)); continue; }
    check(`${tag}: a "Who governs this site" section is the first thing`, !!a.governs && (await page.evaluate(() => document.querySelector('[data-site-analysis="1"] [data-section]')?.dataset.section)) === "governs");
    check(`${tag}: no ETJ wording anywhere in Analysis`, !/ETJ|extraterritorial/i.test(a.all), (a.all.match(/[^\n]*ETJ[^\n]*/i) || [""])[0]);
    check(`${tag}: school district is honestly 'Not screened in Tennessee'`, /Not screened in Tennessee/.test(a.governs || ""));
    check(`${tag}: roads are named with a Tennessee maintainer (TDOT / County / City), not Texas`, /State \(TDOT\)|County maintains|City maintains|Mixed ·/.test(a.governs || "") && !/TxDOT/.test(a.governs || ""), (a.facts.Roads || "").slice(0, 200));
    if (tag === "culvert") check("culvert: County is the Metro government and the city line says so", /Metro Nashville-Davidson County/.test(a.facts.County || "") && /Metro Nashville-Davidson County/.test(a.facts.City || ""), JSON.stringify(a.facts).slice(0, 300));
    if (tag === "memphis") check("memphis: County Shelby, City Memphis", /Shelby/.test(a.facts.County || "") && /Memphis/.test(a.facts.City || ""), JSON.stringify(a.facts).slice(0, 300));
    if (tag === "eppsmill") {
      check("eppsmill: Unincorporated Rutherford County, with I-24 / Manchester Hwy under State (TDOT)", /Rutherford/.test(a.facts.County || "") && /Unincorporated Rutherford County/.test(a.facts.City || ""), JSON.stringify(a.facts).slice(0, 300));
      check("eppsmill: the roads list includes a State (TDOT) road and a County road", /State \(TDOT\)/.test(a.governs || "") && /County/.test(a.governs || ""), (a.facts.Roads || "").slice(0, 300));
    }
  }
} finally {
  // Delete every throwaway site (cloud + local) and verify.
  const gone = await page.evaluate(async (ids) => {
    for (const id of ids) { try { await window.pfSupabase.from("sites").delete().eq("id", id); } catch (_) {} }
    try {
      const raw = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
      for (const id of ids) delete raw[id];
      localStorage.setItem("planarfit:sites:v1", JSON.stringify(raw));
    } catch (_) {}
    const { data } = await window.pfSupabase.from("sites").select("id").in("id", ids);
    return (data || []).length;
  }, ids).catch(() => -1);
  check("every throwaway site is gone from the test account", gone === 0, `${gone} remain`);
  await s.close();
}
if (voided) { console.log("\nVOID — the instrument could not see a badge on its known-good arm."); process.exit(2); }
console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
