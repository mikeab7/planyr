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

  ok("no page errors while rendering", errors.length === 0, errors.join(" | "));

  // ── NEW-2: ONE master toggle over the whole bundle ────────────────────────────
  ok("master toggle rendered", bkdd.includes("Show all flood & drainage"));
  const master = page.locator('#panel-bkdd input[aria-label="Show all flood and drainage layers"]');
  ok("master toggle is a real checkbox", (await master.count()) === 1);
  ok("master starts unchecked (nothing on by default)", (await master.isChecked()) === false);
  await master.check();
  await page.waitForTimeout(60);
  const afterOn = await text("#panel-bkdd");
  ok("one click turns the whole bundle on", /\d+ on/i.test(afterOn) && afterOn.includes("6/6"), afterOn.slice(0, 200));
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
  ok("no flood context → nothing suppressed (fail open, never hide the right one)",
    nocontext.includes("Drainage channels & ROW") && nocontext.includes("District drainage easements"));

  // ── NEW-2: agency badges — whose data this is, at a glance ────────────────────
  ok("agency badges rendered (FEMA / BKDD / USGS)", bkdd.includes("FEMA") && bkdd.includes("BKDD") && bkdd.includes("USGS"));

  // ── NEW-3b: the off-district explanation, in the owner's own terms ────────────
  ok("names the source that doesn't cover here AND the one that does",
    bkdd.includes("Harris County Flood Control District doesn't cover Waller County — showing Brookshire–Katy Drainage District instead."),
    bkdd.slice(0, 900));
  ok("no swap line where nothing was suppressed", !nocontext.includes("doesn't cover"));

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
