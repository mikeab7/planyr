/**
 * NEW-1..NEW-4 headless self-check (sandbox, logged-out) — Waller rule records, the
 * suggested pad FFE (accept chip + provenance), the pond purpose (Hybrid) chips, and
 * the sizing assistant. Two mocked-GIS cases (the verify-b629 pattern):
 *
 *  Case A — a WALLER site with an UNSTUDIED Zone A + a shaded-X band:
 *   • the Waller rule auto-detects: "Waller County (unincorporated)", 1% + 0.2% trigger @ 1:1
 *   • unstudied-A honesty: volume UNKNOWN; NO estimate chip without the DEM grid
 *     (exportImage 404s here — an outage is never an estimate; the chip itself is
 *     live-verify, the engine is unit-tested)
 *   • typing a 0.2% WSE lights the suggested pad FFE ghost (code min = 500-yr + 2,
 *     the in-1% Waller basis), ✓ use commits it with "accepted suggestion" provenance
 *   • the ⛔ prohibited pathway copy renders (no-structural-fill, open foundations)
 *  Case B — a FORT BEND site (point detention rule) with an anchored pond mid-column
 *   on the flood WSE:
 *   • the inspector reads "Pond purpose" with the Auto (Hybrid) suggestion — the
 *     stored enum stays "dual", the label reads Hybrid
 *   • the NEW-4 sizing assistant renders its status line + band captions from the
 *     same banded split as the audit rows
 *
 * Run: npm run build && npx vite preview --port 4188, then
 *      BASE_URL=http://localhost:4188/ node ui-audit/verify-waller-floodplain.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4188/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const H = 660;
const PARCEL = [{ x: -H, y: -H }, { x: H, y: -H }, { x: H, y: H }, { x: -H, y: H }];
const POND = [{ x: -500, y: -500 }, { x: 100, y: -500 }, { x: 100, y: 100 }, { x: -500, y: 100 }];

const wallerSite = {
  s_waller: {
    id: "s_waller", groupId: "s_waller", site: "Waller Zone A Test", name: "Plan 1", status: "active",
    origin: { lat: 30.05, lon: -95.95 }, county: "waller",
    parcels: [{ id: "pA", points: PARCEL, locked: true }],
    els: [{ id: "b1", type: "building", cx: 0, cy: 0, w: 300, h: 200, rot: 0 }],
    measures: [], callouts: [], markups: [], deletedIds: [],
    settings: { showSetback: false, drainage: { autoFacts: false } }, underlay: null, updatedAt: Date.now(),
  },
};
const fbPondSite = {
  s_pond: {
    id: "s_pond", groupId: "s_pond", site: "Assistant Pond Test", name: "Plan 1", status: "active",
    origin: { lat: 29.55, lon: -95.80 }, county: "fortbend",
    parcels: [{ id: "pA", points: PARCEL, locked: true }],
    els: [
      { id: "b1", type: "building", cx: 300, cy: 300, w: 300, h: 200, rot: 0 },
      // TOB 100 vs WSE 95, floor 92: usable 95→99, candidate 92→95 → belowShare ≈ 0.43 → Hybrid.
      { id: "p1", type: "pond", points: POND.map((p) => ({ ...p })), det: { depth: 8, freeboard: 1, slope: 3, tobElev: 100 } },
    ],
    measures: [], callouts: [], markups: [], deletedIds: [],
    settings: { showSetback: false, drainage: { autoFacts: false } }, underlay: null, updatedAt: Date.now(),
  },
};

// Case A mocks: Waller county; ONE unstudied Zone A polygon (no static BFE) + ONE
// shaded-X 0.2% band, both blanketing the site; ground ≈ 98 ft.
const zoneRing = [[-95.96, 30.04], [-95.94, 30.04], [-95.94, 30.06], [-95.96, 30.06], [-95.96, 30.04]];
const MOCKS_A = [
  ["Texas_County_Boundaries", { features: [{ attributes: { CNTY_NM: "Waller", FIPS_ST_CNTY_CD: "48473" } }] }],
  ["Texas_City_Boundaries", { features: [] }],
  ["HGAC_City_ETJ", { features: [] }],
  ["TCEQ_Water_Districts", { features: [] }],
  ["NFHL", { features: [
    { attributes: { FLD_ZONE: "A", ZONE_SUBTY: "", SFHA_TF: "T", STATIC_BFE: -9999, V_DATUM: "" }, geometry: { rings: [zoneRing] } },
    { attributes: { FLD_ZONE: "X", ZONE_SUBTY: "0.2 PCT ANNUAL CHANCE FLOOD HAZARD", SFHA_TF: "F", STATIC_BFE: -9999, V_DATUM: "" }, geometry: { rings: [zoneRing] } },
  ] }],
  ["HCFCD/Watershed", { features: [] }],
  ["3DEPElevation/ImageServer/getSamples", { samples: Array.from({ length: 9 }, () => ({ value: "29.8704" })) }], // 98 ft
  ["500YR_WSE", { samples: [] }],
];
// Case B mocks: the verify-auto-ffe Fort Bend shape (AE, static BFE 95, ground 93 ft).
const MOCKS_B = [
  ["Texas_County_Boundaries", { features: [{ attributes: { CNTY_NM: "Fort Bend", FIPS_ST_CNTY_CD: "48157" } }] }],
  ["Texas_City_Boundaries", { features: [] }],
  ["HGAC_City_ETJ", { features: [] }],
  ["TCEQ_Water_Districts", { features: [] }],
  ["NFHL", { features: [{ attributes: { FLD_ZONE: "AE", ZONE_SUBTY: "", STATIC_BFE: 95, V_DATUM: "NAVD88" }, geometry: { rings: [[[-95.81, 29.54], [-95.79, 29.54], [-95.79, 29.56], [-95.81, 29.56], [-95.81, 29.54]]] } }] }],
  ["HCFCD/Watershed", { features: [] }],
  ["3DEPElevation/ImageServer/getSamples", { samples: Array.from({ length: 9 }, () => ({ value: "28.3464" })) }],
  ["500YR_WSE", { samples: [] }],
];

let failures = 0;
const expect = (label, cond, extra = "") => { if (!cond) failures++; console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${extra ? ` — ${extra}` : ""}`); };
const railText = async (page) => (await page.locator("body").innerText()).replace(/\s+/g, " ");

async function mkCtx(browser, siteObj, currentId, mocks) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(`(() => { try {
    localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify(siteObj)}));
    localStorage.setItem('planarfit:currentSite:v1', '${currentId}');
  } catch (e) {} })();`);
  for (const [needle, payload] of mocks) {
    await ctx.route(`**${needle}**`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(payload) }));
  }
  await ctx.route(`**HCFCD/Channels**`, (route) => route.fulfill({ status: 500, contentType: "text/plain", headers: { "access-control-allow-origin": "*" }, body: "n/a" }));
  // The DEM grid 404s: Case A asserts the estimator's HONEST absence (never an estimate
  // on an outage); the live chip itself is the V### live check.
  await ctx.route(`**exportImage**`, (route) => route.fulfill({ status: 404, contentType: "text/plain", body: "no dem in sandbox" }));
  return ctx;
}

async function runCheck(page) {
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(2600);
  await page.locator('svg[aria-label="Site plan canvas"]').waitFor({ timeout: 12000 }).catch(() => {});
  await page.getByRole("button", { name: /Yield/ }).first().click().catch(() => {});
  await page.waitForTimeout(400);
  const cb = page.getByRole("button", { name: /Check drainage criteria/ });
  await cb.waitFor({ timeout: 8000 }).catch(() => {});
  await cb.click();
  await page.locator('button:has-text("▸ Detention")').waitFor({ timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(900);
  for (const g of ["▸ Detention", "▸ Floodplain mitigation", "▸ Buildability / FFE"]) {
    await page.locator(`button:has-text("${g}")`).first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(300);
  return railText(page);
}

// The pond click helper (the verify-pond-roles-ledger idiom): smallest square-ish
// closed path, double-click to open the Properties inspector.
async function clickPond(page) {
  const pt = await page.evaluate(() => {
    const svg = document.querySelector('svg[aria-label="Site plan canvas"]');
    if (!svg) return null;
    let best = null;
    for (const el of svg.querySelectorAll("path[d]")) {
      const d = el.getAttribute("d") || "";
      if (!/Z\s*$/i.test(d)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 40) continue;
      const squareness = Math.abs(r.width - r.height) / Math.max(r.width, r.height);
      if (squareness > 0.15) continue;
      const area = r.width * r.height;
      if (!best || area < best.area) best = { area, el, r };
    }
    if (!best) return null;
    const g = best.el.closest("g");
    const { r } = best;
    const cands = [[0.5, 0.5], [0.75, 0.5], [0.85, 0.35], [0.6, 0.75], [0.9, 0.6]];
    for (const [fx, fy] of cands) {
      const x = r.x + r.width * fx, y = r.y + r.height * fy;
      const hit = document.elementFromPoint(x, y);
      if (hit && g && g.contains(hit)) return { x, y };
    }
    return null;
  });
  if (!pt) return false;
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(120);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(600);
  return true;
}

async function run() {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

  // ── Case A — the Waller record + the suggested FFE accept flow ────────────────
  const ctxA = await mkCtx(browser, wallerSite, "s_waller", MOCKS_A);
  const pageA = await ctxA.newPage();
  pageA.on("pageerror", (e) => { failures++; console.log(`  [FAIL] pageerror(A) — ${e.message}`); });
  const tA = await runCheck(pageA);

  console.log("Case A — Waller: rule record, unstudied-A honesty, suggested FFE:");
  expect("NEW-1: the Waller rule auto-detects (label renders)", /Waller County \(unincorporated\)/.test(tA));
  expect("NEW-1: 1% + 0.2% trigger @ 1:1 (the §A(8) 500-yr extension)", /1% \+ 0\.2% trigger @ 1:1/.test(tA), tA.match(/trigger @[^.]{0,20}/)?.[0]);
  expect("NEW-1: unstudied Zone A honesty note renders", /Unstudied Zone A/i.test(tA));
  expect("NEW-1: volume reads UNKNOWN (no BFE, no estimate committed)", /UNKNOWN/.test(tA));
  expect("NEW-2: NO estimate chip without the DEM grid (an outage is never an estimate)", !/Est\. 1% WSE ≈/.test(tA));
  expect("NEW-1: the ⛔ prohibited pathway copy renders (no-structural-fill)", /non-starter in unincorporated Waller/.test(tA));
  expect("NEW-1: open-foundations copy renders", /open foundations \(pier and beam\) only/i.test(tA));

  // Type the 0.2% WSE (100) — the Waller in-1% basis then suggests pad = 102.
  const row02 = pageA.locator("div", { has: pageA.locator('span:text-is("0.2% (500-yr) WSE")') }).last();
  await row02.locator("input").fill("100");
  await row02.locator("input").press("Enter");
  await pageA.waitForTimeout(700);
  const tA2 = await railText(pageA);
  expect("NEW-3: the suggested pad ghost renders '~102.0′ · code min = …'", /~102(\.0)?′ · code min =/.test(tA2), tA2.match(/Pad \/ finished floor[^A-Z]{0,80}/)?.[0]);
  expect("NEW-3: the governing basis names the Waller in-1% row", /500-yr WSE \(structure in the 1% floodplain\)/.test(tA2));
  const useChip = pageA.locator('button:has-text("✓ use")').first();
  expect("NEW-3: the ✓ use accept chip renders", (await useChip.count()) > 0);
  await useChip.click({ timeout: 5000 }).catch(() => {});
  await pageA.waitForTimeout(700);
  const tA3 = await railText(pageA);
  expect("NEW-3: accepting writes the pad with provenance ('pad = accepted suggestion')", /pad = accepted suggestion/.test(tA3));
  expect("NEW-3: the FFE verdict prices the committed 102′ pad", /Required FFE/.test(tA3) && /102(\.0+)?′/.test(tA3), tA3.match(/Required FFE[^A-Z]{0,40}/)?.[0]);
  await pageA.screenshot({ path: "ui-audit/verify-waller-floodplain.png" }).catch(() => {});
  await ctxA.close();

  // ── Case B — pond purpose (Hybrid) + the sizing assistant ─────────────────────
  const ctxB = await mkCtx(browser, fbPondSite, "s_pond", MOCKS_B);
  const pageB = await ctxB.newPage();
  pageB.on("pageerror", (e) => { failures++; console.log(`  [FAIL] pageerror(B) — ${e.message}`); });
  await runCheck(pageB);

  console.log("Case B — pond purpose chips + the sizing assistant:");
  const clicked = await clickPond(pageB);
  expect("pond inspector opened", clicked);
  const tB = await railText(pageB);
  expect("NEW-4: the chips read 'Pond purpose' (owner naming)", /Pond purpose/.test(tB));
  expect("NEW-4: the third purpose reads Hybrid (stored enum stays dual)", /Hybrid/.test(tB) && !/\bDual\b/.test(tB), tB.match(/Pond purpose[^A-Z]{0,60}/)?.[0]);
  expect("NEW-4: band captions render (candidate compensating storage)", /candidate compensating storage/.test(tB));
  expect("NEW-4: the sizing assistant renders", /Sizing assistant \(screening\)/i.test(tB)); // CSS uppercases the header — innerText returns the rendered case
  expect("NEW-4: the assistant status line reads the two bands", /mitigation (covered ✓|short)/.test(tB) && /detention (covered ✓|short)/.test(tB), tB.match(/mitigation (covered|short)[^A-Z]{0,40}/)?.[0]);
  expect("NEW-4: the assistant caveat names the same-bands source", /same banded split as the rows above/.test(tB));
  await pageB.screenshot({ path: "ui-audit/verify-pond-assistant.png" }).catch(() => {});
  await ctxB.close();

  await browser.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}
run().catch((e) => { console.error("harness error:", e); process.exit(1); });
