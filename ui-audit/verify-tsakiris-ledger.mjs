/**
 * Tsakiris / Concept A stormwater-panel self-check (sandbox, logged-out, NO GIS) — B1032–B1036.
 *
 * Seeds the REAL saved pond (ring, det, berm, top of bank) plus the check record the site actually
 * carries — the persisted per-pond flood split (WSE 153.1, est-boundary-grade, in trigger) and the
 * mitigation summary (0.16 ac-ft, entirely the berm-as-fill term) — so the whole readout renders
 * without a live fetch. Then drives the real page and asserts, on the rendered DOM:
 *
 *   (B1032) the two ledgers no longer claim the same acre-foot: storage RECONCILES, and neither
 *           storage verdict carries the "counted twice" clause;
 *   (B1033) the verdict headline is not clipped — the rendered sentence element is no wider than
 *           its container, at the panel's normal AND narrow widths, and carries its full text in a
 *           title. This is the check a unit test cannot make: the bug was a layout overflow;
 *   (B1034) no five-digit percentage renders against the 0.2 ac-ft mitigation requirement;
 *   (B1035) the reconciliation sentence appears at most once, and no pond is called "Pond 1"
 *           while the map calls it "Detention Pond";
 *   (B1036) the pond-berm contribution states WHICH case it is, never a bare silent zero.
 *
 * Run: npm run build && npx vite preview --port 4191, then
 *      BASE_URL=http://localhost:4191/ node ui-audit/verify-tsakiris-ledger.mjs
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4191/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

// The saved pond, verbatim (site smrjdgmlinea / element e1454684splyoj).
const POND_RING = [
  { x: 503.72, y: -421.41 }, { x: 502.54, y: 412.42 }, { x: 365.47, y: 415.41 },
  { x: 290.22, y: 285.88 }, { x: 211.36, y: 240.72 }, { x: 108.25, y: -10.5 },
  { x: 74.88, y: -82.45 }, { x: 60.32, y: -187.32 }, { x: 116.51, y: -327.18 },
  { x: 194.52, y: -423.79 },
];
const POND_DET = {
  role: "detention", depth: 16.2, slope: 3, freeboard: 1, tobElev: 161.3, poolElev: null,
  tobBerm: { h: 1, applied: 161.3 },
  outlet: { stages: [
    { kind: "orifice", role: "primary", coeff: 0.6, count: 1, diameterIn: 35.68, invertElevFt: 145.1 },
    { kind: "weir", role: "spillway", coeff: 3.33, lengthFt: 720.8, crestElevFt: 160.3 },
  ] },
};
const H = 1700;
const PARCEL = [{ x: -H, y: -600 }, { x: H, y: -600 }, { x: H, y: 600 }, { x: -H, y: 600 }];

// The check record's own mitigation summary — 0.16 ac-ft, ALL of it the berm-as-fill term.
const MIT_SUMMARY = {
  trigger: "1pct_plus_02pct", ratio: 1,
  perClass: { "1pct": { acres: 0.678, volumeCf: 0 }, "02pct": { acres: 0 }, floodway: { acres: 0 } },
  intersectAcres: 1.1177503913935616, triggerAcres: 0.6781549649313172, floodwayAcres: 0,
  volumeCf: 6972.810732143457, volumeAcFt: 0.16007370826775613, cutCy: 258.25224933864655,
  bermAcFt: 0.16007370826775613, bermAcres: 0.4395954264622445, wedgeAcFt: 0, wedgePriced: true,
  gradeBasis: "grid", padBasis: "surface", pricedCells: 771, voidCells: 0, wedgeUnknownSf: 0,
  volumeFlatCf: 2322.76941368061, expertBypass: false, flags: ["unstudied_a"],
  providers: { padElev: "manual", existGrade: "3dep-grid", wse1pct: "est-boundary-grade" },
};

const site = (id, name) => ({
  id, groupId: id, site: name, name: "Concept A", status: "active",
  origin: { lat: 29.7794, lon: -95.895 }, county: "waller",
  parcels: [{ id: "pA", points: PARCEL, locked: true }],
  els: [
    { id: "b1", type: "building", cx: -900, cy: 0, w: 1400, h: 320, rot: 0 },
    { id: "e1454684splyoj", type: "pond", points: POND_RING.map((p) => ({ ...p })), det: POND_DET },
  ],
  measures: [], callouts: [], markups: [], deletedIds: [],
  settings: {
    showSetback: false,
    floodMitigation: { dockDropFt: 4 },
    drainage: {
      autoFacts: false,
      lastCheck: {
        authority: {
          primaryReviewerId: "waller", channelAuthority: null, ambiguous: [], flags: ["mud-district-present", "bkdd-district-present"],
          mudState: "loaded", overlays: [{ kind: "drainage-district", id: "bkdd", name: "Brookshire–Katy Drainage District" }],
          jurisdiction: { city: ["Katy"], county: ["Waller"], etj: [], cityCentroid: [] },
        },
        flood: { zones: [{ zone: "X", subtype: "AREA OF MINIMAL FLOOD HAZARD" }, { zone: "A" }], state: "loaded", ageMs: 0 },
        channel: { state: "not-applicable" }, groundElevFt: 152.8603582845775, groundDatum: "NAVD88",
        sig: "seed-sig", checkedAt: Date.now() - 3600000,
        mitigation: { screened: true, summary: MIT_SUMMARY },
        detSplit: {
          screened: true, fmZonesSig: "seed:1",
          byId: { e1454684splyoj: { wseFt: 153.1, wseSrc: "est-boundary-grade", inTrigger: true } },
        },
      },
    },
  },
  underlay: null, updatedAt: Date.now(),
});

let failures = 0;
const expect = (label, cond, extra = "") => { if (!cond) failures++; console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${extra ? ` — ${String(extra).slice(0, 200)}` : ""}`); };

async function openYield(page) {
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(2600);
  await page.locator('svg[aria-label="Site plan canvas"]').waitFor({ timeout: 12000 }).catch(() => {});
  await page.getByRole("button", { name: /Yield/ }).first().click().catch(() => {});
  await page.waitForTimeout(700);
  for (const g of ["Detention detail", "Mitigation detail", "Floodplain mitigation"]) {
    await page.locator(`button:has-text("${g}")`).first().click({ timeout: 3500 }).catch(() => {});
    await page.waitForTimeout(180);
  }
  await page.waitForTimeout(400);
  return (await page.locator("body").innerText()).replace(/\s+/g, " ");
}

/* B1033 — the LAYOUT check. Measure every verdict sentence against its own container: a clipped
 * headline is exactly a scrollWidth that exceeds clientWidth, which no unit test can see. */
async function overflowReport(page) {
  return page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('[data-testid^="yield-verdict-sentence-"]')) {
      const parent = el.parentElement;
      out.push({
        key: el.getAttribute("data-testid"),
        text: el.innerText.replace(/\s+/g, " "),
        title: el.getAttribute("title") || "",
        overflowPx: Math.round(el.scrollWidth - (parent ? parent.clientWidth : el.clientWidth)),
      });
    }
    return out;
  });
}

async function run() {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 980 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(`(() => { try {
    localStorage.setItem('planarfit:sites:v1', JSON.stringify({ s_tsak: ${JSON.stringify(site("s_tsak", "Tsakiris"))} }));
    localStorage.setItem('planarfit:currentSite:v1', 's_tsak');
  } catch (e) {} })();`);
  const page = await ctx.newPage();
  /* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — not its clock, and not its pixels. A hidden tab clamps
     setTimeout (a setTimeout-paced probe then times the clamp: 3,156 ms for a 138-182 ms gesture) AND
     suspends requestAnimationFrame, so after a view change the app's state attributes update while the
     drawing never repaints — every box, position, hit test and screenshot then agrees with every other
     and describes a view the app already left. One precondition covers both, rAF liveness probe
     included; see ui-audit/lib/tabTiming.mjs. Fails loudly rather than reporting either. */
  await assertMeasurable(page, "verify-tsakiris-ledger");
  page.on("pageerror", (e) => { failures++; console.log(`  [FAIL] pageerror — ${e.message}`); });
  let t = await openYield(page);

  console.log("Tsakiris stormwater panel — logged-out, no-GIS render check:");

  // ── B1032 — the double-count is gone.
  expect("(B1032) no verdict says storage is counted twice", !/counted twice/.test(t), t.match(/[^.]{0,80}counted twice[^.]{0,40}/)?.[0]);
  expect("(B1032) the Storage-reconciles row renders", /Storage reconciles/.test(t), t.match(/Storage reconciles[^A-Z]{0,60}/)?.[0]);
  {
    const m = t.match(/([\d.]+) claimed \/ ([\d.]+) exists/);
    expect("(B1032) claimed never exceeds what exists", !!m && parseFloat(m[1]) <= parseFloat(m[2]) + 0.05, m ? m[0] : "row missing");
  }
  expect("(B1032) the detention explainer no longer blames the flood level for berm-ring volume",
    !/ac-ft sits below the flood level and doesn't count/.test(t), t.match(/[^.]{0,90}sits below the flood level[^.]{0,40}/)?.[0]);

  // ── B1033 — the headline fits (normal width, then the narrow/docked width).
  for (const width of [1500, 1180, 980]) {
    await page.setViewportSize({ width, height: 980 });
    await page.waitForTimeout(500);
    const rows = await overflowReport(page);
    expect(`(B1033) verdict sentences render at ${width}-wide`, rows.length > 0, `${rows.length} row(s)`);
    for (const r of rows) {
      expect(`(B1033) ${r.key} is not clipped at ${width}-wide`, r.overflowPx <= 1, `overflow ${r.overflowPx} · "${r.text}"`);
      expect(`(B1033) ${r.key} carries its full text in a title`, r.title.length > 0, r.title);
    }
  }
  await page.setViewportSize({ width: 1500, height: 980 });
  await page.waitForTimeout(400);
  t = (await page.locator("body").innerText()).replace(/\s+/g, " ");

  // ── B1034 — no meaningless percentage against a 0.2 ac-ft requirement.
  {
    const pcts = [...t.matchAll(/Margin [^A-Z]*?\(([+−-]?)(\d+(?:\.\d+)?)%\)/g)].map((m) => parseFloat(m[2]));
    expect("(B1034) no absurd percentage margin renders", pcts.every((p) => p < 1000), pcts.join(", ") || "none");
    expect("(B1034) a sub-floor requirement states the absolute instead", /ac-ft over a [\d.]+ ac-ft requirement/.test(t) || !/Mitigation/.test(t),
      t.match(/Margin [^A-Z]{0,70}/)?.[0]);
  }

  // ── B1035 — stated once, and the pond is named the way the map names it.
  {
    const occurrences = (t.match(/is counted twice/g) || []).length;
    expect("(B1035) the reconciliation sentence renders at most once", occurrences <= 1, `${occurrences} occurrence(s)`);
    expect("(B1035) no pond is labelled the generic 'Pond 1' on a single-pond site", !/\bPond 1\b/.test(t), t.match(/[^.]{0,60}Pond 1[^.]{0,30}/)?.[0]);
    expect("(B1035) the pond reads by its real label", /Detention Pond/.test(t), t.match(/Detention Pond[^A-Z]{0,40}/)?.[0]);
  }

  // ── B1036 — the berm-as-fill contribution says which case it is.
  expect("(B1036) the pond-berm contribution is stated, not silently zero",
    /from pond berms whose fill sits in the mapped floodplain|sit outside the mapped floodplain|No pond berms|can't be priced|no flood elevation resolved|isn't bermed/.test(t),
    t.match(/[^.]{0,120}berm[^.]{0,60}/i)?.[0]);

  expect("the Yield panel still renders end to end", /Detention/.test(t) && /Mitigation/.test(t));
  if (process.env.DUMP) console.log("\n---- PAGE TEXT ----\n" + t + "\n-------------------\n");

  await page.screenshot({ path: "ui-audit/verify-tsakiris-ledger.png", fullPage: false }).catch(() => {});
  await ctx.close();
  await browser.close();
  console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
