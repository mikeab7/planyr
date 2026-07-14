/**
 * NEW-2 + NEW-4 headless self-check (sandbox, logged-out, NO GIS needed): seeds a
 * georeferenced Fort Bend site whose settings already carry a REMEMBERED drainage check
 * (settings.drainage.lastCheck) — exactly what B750 persists — and opens the planner
 * WITHOUT running a live check. Verifies:
 *   NEW-2  the remembered slim MITIGATION summary re-renders (the ledger no longer vanishes
 *          on a restored check); and a legacy check with no summary shows the explicit
 *          "not screened in this remembered view — re-check" row instead of nothing.
 *   NEW-4  outside Harris the tier's permanent "Channel adjacency unknown" noise is gone.
 *   NEW-1  the merged "As of <date> · ↻ Re-check" status line renders.
 *   NEW-9  (pond-roles branch) the remembered DETENTION split: (C) a remembered check
 *          whose slim record carries the per-pond facts (detSplit.byId) replays the live
 *          usable/dead split — a mostly-inundated pond stays SHORT on reload, never the
 *          gross-credited "surplus" flip; (D) a LEGACY snapshot (no detSplit) with a pond
 *          demotes to "usable unknown — ↻ re-check" + the gross-OVERSTATES warning, and
 *          fabricates NO verdict either way.
 *
 * Run: npm run build && npx vite preview --port 4188, then
 *      BASE_URL=http://localhost:4188/ node ui-audit/verify-remembered-drainage.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4188/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const H = 660; // 40-ac square
const PARCEL = [{ x: -H, y: -H }, { x: H, y: -H }, { x: H, y: H }, { x: -H, y: H }];
// A remembered mitigation summary — numbers/provenance/flags only, NO geometry (the slim
// shape NEW-2 persists in settings.drainage.lastCheck.mitigation).
const MIT_SUMMARY = {
  trigger: "1pct", ratio: 1,
  perClass: { "1pct": { acres: 0.5, volumeCf: 5000, unknown: null }, floodway: { acres: 0, volumeCf: null, unknown: null } },
  intersectAcres: 0.5, triggerAcres: 0.5, floodwayAcres: 0,
  volumeCf: 5000, volumeAcFt: 5000 / 43560, cutCy: 5000 / 27,
  unknownReason: null, expertBypass: false, flags: [],
  providers: { padElev: "auto (code min)", existGrade: "3dep", wse1pct: "static-bfe", wse02pct: null, expert: null },
};
// The slim drainage context B750 persists (Fort Bend — so HCFCD channel data is n/a).
const slimBase = () => ({
  authority: { primaryReviewerId: "fortbend", channelAuthority: null, overlays: [], ambiguous: [], flags: [], mudState: null, jurisdiction: { city: [], county: ["Fort Bend"], etj: [] } },
  flood: { zones: [{ zone: "AE", subtype: "", staticBfeFt: 95, vdatum: "NAVD88" }], state: "loaded", ageMs: 0 },
  channel: null, watershed: null, groundElevFt: 90, groundDatum: "NAVD88",
});

const siteWith = (id, mitigation, extra = {}) => ({
  id, groupId: id, site: extra.siteName || (id === "s_mit" ? "Remembered Mitigation Site" : "Legacy Remembered Site"),
  name: "Plan 1", status: "active", origin: { lat: 29.55, lon: -95.80 }, county: "fortbend",
  parcels: [{ id: "pA", points: PARCEL, locked: true }],
  els: extra.els || [{ id: "b1", type: "building", cx: 0, cy: 0, w: 300, h: 200, rot: 0 }],
  measures: [], callouts: [], markups: [], deletedIds: [],
  settings: { showSetback: false, drainage: { lastCheck: { ...slimBase(), sig: "seed-sig", checkedAt: Date.now() - 3 * 86400000, ...(mitigation ? { mitigation } : {}), ...(extra.detSplit ? { detSplit: extra.detSplit } : {}) } } },
  underlay: null, updatedAt: Date.now(),
});

// NEW-9 — a big anchored pond, mostly flood-occupied: gross ≈ 53 ac-ft (would read
// "surplus" if gross were credited), but the WSE (95′, the zone's static BFE) sits
// above its 94′ top of bank → fully inundated → usable 0 → the honest verdict is SHORT.
const POND = [{ x: -500, y: -500 }, { x: 100, y: -500 }, { x: 100, y: 100 }, { x: -500, y: 100 }];
const pondEls = () => [
  { id: "b1", type: "building", cx: 300, cy: 300, w: 300, h: 200, rot: 0 },
  { id: "p1", type: "pond", points: POND.map((p) => ({ ...p })), det: { depth: 8, freeboard: 1, slope: 3, tobElev: 94 } },
];

let failures = 0;
const expect = (label, cond, extra = "") => { if (!cond) failures++; console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${extra ? ` — ${extra}` : ""}`); };

async function openYield(page) {
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(2600);
  await page.locator('svg[aria-label="Site plan canvas"]').waitFor({ timeout: 12000 }).catch(() => {});
  await page.getByRole("button", { name: /Yield/ }).first().click().catch(() => {});
  await page.waitForTimeout(500);
  // B824 — the readout is grouped + COLLAPSED (verdict lines only); expand all three
  // groups so the remembered-view detail rows are in the DOM for the assertions below.
  for (const g of ["▸ Detention", "▸ Floodplain mitigation", "▸ Buildability / FFE"]) {
    await page.locator(`button:has-text("${g}")`).first().click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(300);
  return (await page.locator("body").innerText()).replace(/\s+/g, " ");
}

async function run() {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

  // ── Case A: a remembered check WITH a mitigation summary ──────────────────────
  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctxA.addInitScript(`(() => { try {
    localStorage.setItem('planarfit:sites:v1', JSON.stringify({ s_mit: ${JSON.stringify(siteWith("s_mit", { screened: true, summary: MIT_SUMMARY }))} }));
    localStorage.setItem('planarfit:currentSite:v1', 's_mit');
  } catch (e) {} })();`);
  const pageA = await ctxA.newPage();
  pageA.on("pageerror", (e) => { failures++; console.log(`  [FAIL] pageerror(A) — ${e.message}`); });
  const tA = await openYield(pageA);

  console.log("Case A — remembered check WITH a mitigation summary:");
  expect("NEW-2: remembered MITIGATION ledger re-renders (row present, not vanished)", /Floodplain mitigation/.test(tA));
  expect("NEW-2: remembered mitigation VOLUME shows (~0.11 ac-ft from the slim summary)", /\+?0\.1\d?\s*ac-ft/.test(tA), tA.match(/Floodplain mitigation[^A-Z]{0,40}/)?.[0]);
  expect("NEW-1(e): merged 'As of <date> · Re-check' status line renders", /As of \d/.test(tA) && await pageA.getByRole("button", { name: /Re-check/ }).count() > 0);
  expect("NEW-4: NO permanent 'Channel adjacency unknown' outside Harris (body)", !/Channel adjacency unknown/.test(tA));
  expect("NEW-4: NO 'Channel adjacency unknown' hidden in the tier ⓘ either", await pageA.locator('[title*="Channel adjacency unknown"]').count() === 0);
  expect("NEW-1(a): Analysis tier renders as a verdict line", /Analysis tier/.test(tA));
  await pageA.screenshot({ path: "ui-audit/verify-remembered-drainage.png" }).catch(() => {});
  await ctxA.close();

  // ── Case B: a LEGACY remembered check with NO mitigation summary ──────────────
  const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctxB.addInitScript(`(() => { try {
    localStorage.setItem('planarfit:sites:v1', JSON.stringify({ s_leg: ${JSON.stringify(siteWith("s_leg", null))} }));
    localStorage.setItem('planarfit:currentSite:v1', 's_leg');
  } catch (e) {} })();`);
  const pageB = await ctxB.newPage();
  pageB.on("pageerror", (e) => { failures++; console.log(`  [FAIL] pageerror(B) — ${e.message}`); });
  const tB = await openYield(pageB);

  console.log("Case B — LEGACY remembered check with NO mitigation summary:");
  expect("NEW-2(b): explicit 'not screened in this remembered view' row (never a silent gap)", /not screened in this remembered view/.test(tB));
  // B823 — the prompt is a one-liner; the "re-check drainage criteria" teaching copy rides its ⓘ.
  expect("NEW-2(b): the row prompts a re-check (one-liner + ⓘ)", /↻ re-check to screen it/i.test(tB)
    && await pageB.locator('[title*="Re-check drainage criteria"]').count() > 0);
  await ctxB.close();

  // ── Case C: remembered check WITH the per-pond detention-split facts (NEW-9) ──
  // The pond's gross (~53 ac-ft) exceeds the site requirement — crediting gross would
  // read "surplus". The persisted facts say WSE 95′ > TOB 94′ (fully inundated) →
  // usable 0 → the verdict must stay SHORT on reload, exactly as the live check read.
  const ctxC = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctxC.addInitScript(`(() => { try {
    localStorage.setItem('planarfit:sites:v1', JSON.stringify({ s_split: ${JSON.stringify(siteWith("s_split", { screened: true, summary: MIT_SUMMARY }, {
      siteName: "Remembered Split Site", els: pondEls(),
      detSplit: { screened: true, fmZonesSig: "seed:1", byId: { p1: { wseFt: 95, inTrigger: true, estPoolDepthFt: null } } },
    }))} }));
    localStorage.setItem('planarfit:currentSite:v1', 's_split');
  } catch (e) {} })();`);
  const pageC = await ctxC.newPage();
  pageC.on("pageerror", (e) => { failures++; console.log(`  [FAIL] pageerror(C) — ${e.message}`); });
  const tC = await openYield(pageC);

  console.log("Case C — remembered check WITH detSplit facts (NEW-9):");
  expect("NEW-9(C): the verdict stays SHORT on reload (usable replayed from the facts)", /ac-ft SHORT/.test(tC), tC.match(/Detention[^A-Z]{0,60}/)?.[0]);
  expect("NEW-9(C): NO gross-credited 'surplus' flip", !/ac-ft surplus/.test(tC));
  expect("NEW-9(C): the provided row splits usable off gross (usable 0.00 — fully inundated)", /usable 0\.00/.test(tC));
  await pageC.screenshot({ path: "ui-audit/verify-remembered-split.png" }).catch(() => {});
  await ctxC.close();

  // ── Case D: LEGACY remembered snapshot (no detSplit) + a pond (NEW-9) ─────────
  const ctxD = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctxD.addInitScript(`(() => { try {
    localStorage.setItem('planarfit:sites:v1', JSON.stringify({ s_legpond: ${JSON.stringify(siteWith("s_legpond", { screened: true, summary: MIT_SUMMARY }, { siteName: "Legacy Split Site", els: pondEls() }))} }));
    localStorage.setItem('planarfit:currentSite:v1', 's_legpond');
  } catch (e) {} })();`);
  const pageD = await ctxD.newPage();
  pageD.on("pageerror", (e) => { failures++; console.log(`  [FAIL] pageerror(D) — ${e.message}`); });
  const tD = await openYield(pageD);

  console.log("Case D — LEGACY snapshot without detSplit + a pond (NEW-9):");
  expect("NEW-9(D): verdict demotes to 'usable unknown — ↻ re-check'", /usable unknown — ↻ re-check/.test(tD), tD.match(/Detention[^A-Z]{0,60}/)?.[0]);
  expect("NEW-9(D): the gross-OVERSTATES warning renders", /gross OVERSTATES usable/.test(tD));
  expect("NEW-9(D): NO fabricated surplus verdict", !/ac-ft surplus/.test(tD));
  expect("NEW-9(D): NO fabricated SHORT verdict either (unknown is unknown)", !/ac-ft SHORT/.test(tD));
  expect("NEW-9(D): gross is labeled AS gross", /Detention provided \(gross\)/.test(tD));
  await ctxD.close();

  await browser.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}
run().catch((e) => { console.error("harness error:", e); process.exit(1); });
