/* Headless verifier for B1075–B1080 — the Flood & drainage group.
 *
 * The report this answers: at the Tsakiris tract (Waller County, inside the Brookshire–Katy
 * Drainage District) the owner turned flood layers on beside an obvious drainage channel and
 * NOTHING painted and NOTHING was said. Every assertion below is a sentence that silence
 * should have been.
 *
 * Drives the real LayerPanel (ui-audit/layerpanel-harness.html) in Chromium over a `vite`
 * dev server and asserts the rendered DOM. Not part of the app build.
 *
 * NOTE ON SCOPE: this proves the PANEL — scoping, tiering, master toggle, the honest copy.
 * It cannot prove the BKDD endpoints themselves: gisclient.quiddity.com is policy-403 from
 * this sandbox's egress proxy (confirmed 2026-07-29), so the live on-map render of the BKDD
 * layers is owed a browser pass — see VERIFICATION.md.
 *
 * Run:  npm run dev -- --port 5199 --strictPort   (in the background)
 *       node ui-audit/flood-group-verify.mjs        (BASE defaults to :5199)
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:5199";
const URL = `${BASE}/ui-audit/layerpanel-harness.html`;

const results = [];
const ok = (name, cond, detail = "") => { results.push({ name, pass: !!cond, detail }); };

const browser = await chromium.launch({ args: ["--no-sandbox", "--ignore-certificate-errors"] });
try {
  const page = await browser.newPage({ ignoreHTTPSErrors: true });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__READY__ === true, { timeout: 15000 });
  await page.waitForSelector("#panel-bkdd", { timeout: 15000 });

  const text = async (sel) => (await page.locator(sel).innerText()).replace(/\s+/g, " ");
  const bkdd = await text("#panel-bkdd");
  const harris = await text("#panel-hcfcd");
  const outage = await text("#panel-flood-outage");
  const dmp = await text("#panel-dmp-empty");
  const nocontext = await text("#panel-flood-nocontext");
  const stale = await text("#panel-flood-stalecounty");

  ok("no page errors while rendering", errors.length === 0, errors.join(" | "));

  // ── NEW-2: ONE master toggle over the whole bundle ────────────────────────────
  ok("master toggle rendered", bkdd.includes("Show all flood & drainage"));
  const master = page.locator('#panel-bkdd input[aria-label="Show all flood and drainage layers"]');
  ok("master toggle is a real checkbox", (await master.count()) === 1);
  ok("master starts unchecked (nothing on by default)", (await master.isChecked()) === false);
  await master.check();
  await page.waitForTimeout(60);
  const afterOn = await text("#panel-bkdd");
  // 5 rows at Tsakiris: FEMA · 2 BKDD · NHD · the BKDD master plan. HCFCD and the City's
  // storm sewer are demoted (B1091), so the master switch never turns on a source that
  // cannot paint here — "show all" means all of what applies.
  ok("one click turns the whole bundle on", /\d+ on/i.test(afterOn) && afterOn.includes("5/5"), afterOn.slice(0, 200));
  ok("master reads checked once every child is on", (await master.isChecked()) === true);
  await master.uncheck();
  await page.waitForTimeout(60);
  ok("unchecking turns the bundle back off", (await master.isChecked()) === false);

  // ── NEW-2: four LABELLED tiers, in decision order, never one merged layer ─────
  const tiers = ["Regulatory", "Local drainage authority", "Physical hydrography", "Advisory models"];
  ok("all four tier headings present, in order", (() => {
    const u = bkdd.toUpperCase();
    const idxs = tiers.map((t) => u.indexOf(t.toUpperCase()));
    return idxs.every((i) => i >= 0) && idxs.every((i, k) => k === 0 || i > idxs[k - 1]);
  })(), bkdd.slice(0, 600));
  ok("the advisory tier is marked NOT REGULATORY on its face", /not regulatory/i.test(bkdd));

  // ── NEW-2: district auto-scoping — only the GOVERNING district renders ────────
  ok("inside BKDD: the district's own layers are listed", bkdd.includes("District streams, watersheds & BFE") && bkdd.includes("District drainage easements"));
  ok("inside BKDD: HCFCD's row is NOT rendered at all", !bkdd.includes("Drainage channels & ROW"), bkdd.slice(0, 600));
  ok("in Harris: HCFCD's row IS rendered", harris.includes("Drainage channels & ROW"));
  ok("in Harris: BKDD's rows are NOT rendered", !harris.includes("District drainage easements"));

  // ── B1091: the county alone scopes the group, with NO drainage check at all ───
  // The live failure: the drainage context hadn't resolved a district, the old scoping
  // fell fully open, and a Waller site listed a Harris-County channel layer and a
  // City-of-Houston storm sewer under LOCAL DRAINAGE AUTHORITY with nothing said.
  ok("B1091 — no flood context, Waller county: HCFCD is NOT in the list",
    !nocontext.includes("Drainage channels & ROW"), nocontext.slice(0, 700));
  ok("B1091 — no flood context, Waller county: City-of-Houston storm sewer is NOT in the list",
    !nocontext.includes("Storm sewer"), nocontext.slice(0, 700));
  ok("B1091 — BKDD's own rows (which DO reach Waller) still render with no context",
    nocontext.includes("District drainage easements"));
  ok("B1091 — the demoted sources are DISCLOSED, never silently dropped",
    /2 sources that don.t cover this site/i.test(nocontext), nocontext.slice(0, 700));

  // ── NEW-2: agency badges — whose data this is, at a glance ────────────────────
  ok("agency badges rendered (FEMA / BKDD / USGS)", bkdd.includes("FEMA") && bkdd.includes("BKDD") && bkdd.includes("USGS"));

  // ── NEW-3b / B1091: the off-district explanation, in the owner's own terms ────
  // It now rides the demoted row itself (one collapsed line in the default view), so the
  // reason sits WITH the source it explains instead of floating above the group.
  const offToggle = page.locator('#panel-bkdd button[aria-label*="don\'t cover this site"]');
  ok("the demoted sources sit behind ONE collapsed line", (await offToggle.count()) === 1);
  await offToggle.click();
  await page.waitForTimeout(60);
  const bkddOpen = await text("#panel-bkdd");
  ok("opening it names the source that doesn't cover here AND the one that does",
    bkddOpen.includes("Harris County Flood Control District doesn't cover Waller County — Brookshire–Katy Drainage District is shown instead."),
    bkddOpen.slice(0, 1200));
  ok("…and the city storm sewer names its own service area",
    bkddOpen.includes("City of Houston's system doesn't reach Waller County — it maps Harris County only."),
    bkddOpen.slice(0, 1400));
  ok("a demoted row is still THERE, toggle and all — demoted, never removed",
    bkddOpen.includes("Drainage channels & ROW") && bkddOpen.includes("Storm sewer"),
    bkddOpen.slice(0, 1400));
  await offToggle.click(); // leave the panel as we found it

  /* ── B1091(×2): THE INVERSION. B1091 shipped and the live panel at Tsakiris asserted the
   * exact reverse — every BKDD row carrying "Brookshire–Katy Drainage District doesn't
   * govern drainage at this site — Harris County Flood Control District does", with the
   * HCFCD row carrying none. Ground truth, re-checked live 2026-07-29: BKDD's own boundary
   * layer returns n=1 at this point; HCFCD returns n=0 (its jurisdiction ends at the Harris
   * County line). Root cause: a district-vs-district exclusion drawn from the COUNTY guess,
   * which says nothing about a district spanning three counties. ─────────────────────── */
  ok("B1091(×2) — no panel anywhere says BKDD doesn't govern a site inside BKDD",
    [bkdd, bkddOpen, nocontext, stale, outage, dmp].every((t) => !/Brookshire.{0,3}Katy Drainage District doesn.{0,3}t govern/i.test(t)),
    stale.slice(0, 900));
  ok("B1091(×2) — a STALE saved county can't flip the governing district",
    stale.includes("District streams, watersheds & BFE") && stale.includes("District drainage easements")
      && stale.includes("Master Plan floodplains & improvements"),
    stale.slice(0, 900));
  ok("B1091(×2) — …and HCFCD is the one demoted there, off the boundary fact",
    !/LOCAL DRAINAGE AUTHORITY[\s\S]*?Drainage channels & ROW[\s\S]*?PHYSICAL HYDROGRAPHY/i.test(stale),
    stale.slice(0, 900));
  ok("B1091(×2) — the MIRROR still holds: in Harris, BKDD is the demoted one",
    !harris.includes("District drainage easements") && harris.includes("Drainage channels & ROW"),
    harris.slice(0, 900));

  // ── NEW-3a: what FEMA actually reported — the answer that was missing ─────────
  ok("Zone X is stated as a FINDING, not left as silence",
    bkdd.includes("FEMA effective FIRM: Zone X, area of minimal flood hazard — no special flood hazard area mapped here."),
    bkdd.slice(0, 1200));
  ok("an SFHA site says so instead", /a special flood hazard area IS mapped here/.test(harris) && /including regulatory floodway/.test(harris));
  ok("a FEMA OUTAGE reads 'unknown, not clear' — never a clean all-clear", /unknown, not clear/.test(outage), outage.slice(0, 900));
  ok("no FEMA verdict is claimed with no context at all", !/FEMA effective FIRM/.test(nocontext));

  // ── NEW-3: the standing line — the root cause of the whole report ─────────────
  ok("states once that FEMA maps zones, not channels",
    /FEMA maps flood ZONES, not channels/.test(bkdd));
  ok("…and states it exactly ONCE per panel", (bkdd.match(/FEMA maps flood ZONES, not channels/g) || []).length === 1);

  // ── NEW-1/NEW-3: a study-area empty must never read as "no floodplain" ────────
  ok("an out-of-extent master-plan layer says 'outside this study area'", /Outside this study area/i.test(dmp), dmp.slice(0, 1400));
  ok("…and explicitly denies being a 'no floodplain' finding", /Not a finding of "no floodplain"/.test(dmp));

  // ── NEW-4: the universal fallback is always offered ───────────────────────────
  ok("NHD hydrography is listed on every site, district or not",
    bkdd.includes("Streams, canals & ditches") && harris.includes("Streams, canals & ditches") && nocontext.includes("Streams, canals & ditches"));

  // ── regressions: the rest of the panel still works ────────────────────────────
  ok("the six decision-first groups survive", (() => {
    const g = ["Base & terrain", "Flood & drainage", "Utilities serving the site", "Environmental & hazards", "Access & infrastructure", "Jurisdictions & authority"];
    const u = bkdd.toUpperCase();
    return g.every((x) => u.includes(x.toUpperCase()));
  })());
  ok("the one screening footer survives", bkdd.includes("Screening data — verify before relying on it."));
  ok("per-row ⓘ buttons survive in the flood group", (await page.locator('#panel-bkdd button[aria-label^="About "]').count()) > 5);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass || !r.detail ? "" : `\n      ${r.detail}`}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
