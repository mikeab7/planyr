/**
 * NEW-8 (pond-roles branch) headless self-check (sandbox, logged-out, NO GIS): seeds a
 * remembered drainage check (slim + detSplit facts + a mitigation summary) so the whole
 * ledger renders without a live fetch, plus a big anchored pond sitting almost entirely
 * below the flood WSE. Verifies:
 *   (a) the pond ROLE chips render on the pond inspector, with the elevation
 *       auto-suggestion ("Auto (Mitigation)") active by default;
 *   (b) the Floodplain-mitigation group gains Required / Provided (credited pond cut) /
 *       Balance rows; the over-dug state is LOUD ("~N ac-ft of cut buys nothing") and
 *       the group verdict reads "+N ac-ft over-dug";
 *   (c) an owner role override to Detention un-credits the cut: Provided shows
 *       "no credited ponds" and the uncredited remainder note renders;
 *   (d) the B833 footprint-floor caveat renders (fill priced at footprints — a floor).
 *
 * Run: npm run build && npx vite preview --port 4189, then
 *      BASE_URL=http://localhost:4189/ node ui-audit/verify-pond-roles-ledger.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4189/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const H = 660;
const PARCEL = [{ x: -H, y: -H }, { x: H, y: -H }, { x: H, y: H }, { x: -H, y: H }];
const POND = [{ x: -500, y: -500 }, { x: 100, y: -500 }, { x: 100, y: 100 }, { x: -500, y: 100 }];
const MIT_SUMMARY = {
  trigger: "1pct", ratio: 1,
  perClass: { "1pct": { acres: 0.5, volumeCf: 5000, unknown: null }, floodway: { acres: 0, volumeCf: null, unknown: null } },
  intersectAcres: 0.5, triggerAcres: 0.5, floodwayAcres: 0,
  volumeCf: 5000, volumeAcFt: 5000 / 43560, cutCy: 5000 / 27,
  unknownReason: null, expertBypass: false, flags: [],
  providers: { padElev: "auto (code min)", existGrade: "3dep", wse1pct: "static-bfe", wse02pct: null, expert: null },
};
const slimBase = () => ({
  authority: { primaryReviewerId: "fortbend", channelAuthority: null, overlays: [], ambiguous: [], flags: [], mudState: null, jurisdiction: { city: [], county: ["Fort Bend"], etj: [] } },
  flood: { zones: [{ zone: "AE", subtype: "", staticBfeFt: 95, vdatum: "NAVD88" }], state: "loaded", ageMs: 0 },
  channel: null, watershed: null, groundElevFt: 90, groundDatum: "NAVD88",
});
// The pond: TOB 94 < WSE 95 → fully inundated → the whole ~53 ac-ft column is
// below-WSE candidate cut, dwarfing the 0.11 ac-ft requirement → over-dug.
const siteWith = (id, name, role) => ({
  id, groupId: id, site: name, name: "Plan 1", status: "active",
  origin: { lat: 29.55, lon: -95.80 }, county: "fortbend",
  parcels: [{ id: "pA", points: PARCEL, locked: true }],
  els: [
    { id: "b1", type: "building", cx: 300, cy: 300, w: 300, h: 200, rot: 0 },
    { id: "p1", type: "pond", points: POND.map((p) => ({ ...p })), det: { depth: 8, freeboard: 1, slope: 3, tobElev: 94, ...(role ? { role } : {}) } },
  ],
  measures: [], callouts: [], markups: [], deletedIds: [],
  // B832: autoFacts off — these cases assert the deterministic remembered view.
  settings: { showSetback: false, drainage: { autoFacts: false, lastCheck: {
    ...slimBase(), sig: "seed-sig", checkedAt: Date.now() - 86400000,
    mitigation: { screened: true, summary: MIT_SUMMARY },
    detSplit: { screened: true, fmZonesSig: "seed:1", byId: { p1: { wseFt: 95, inTrigger: true, estPoolDepthFt: null } } },
  } } },
  underlay: null, updatedAt: Date.now(),
});

let failures = 0;
const expect = (label, cond, extra = "") => { if (!cond) failures++; console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${extra ? ` — ${extra}` : ""}`); };

async function openYield(page) {
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(2600);
  await page.locator('svg[aria-label="Site plan canvas"]').waitFor({ timeout: 12000 }).catch(() => {});
  await page.getByRole("button", { name: /Yield/ }).first().click().catch(() => {});
  await page.waitForTimeout(500);
  for (const g of ["▸ Detention", "▸ Floodplain mitigation"]) {
    await page.locator(`button:has-text("${g}")`).first().click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(300);
  return (await page.locator("body").innerText()).replace(/\s+/g, " ");
}

// Click the pond's on-screen centroid (the deed-align idiom, adapted): a points-pond
// renders as closed <path> elements; the pond is SQUARE (600×600 ft) while the parcel
// square is ~2.2× larger and the building is 3:2 — so pick the SMALLEST square-ish
// closed path above a size floor and click its bbox centre.
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
    // The left (Yield) panel can overlap part of the pond — probe candidate points and
    // keep the first whose actual hit-test lands inside the pond's <g>.
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
  // Single click selects; the PROPERTIES panel (where the det card + role chips live)
  // opens on the double-tap (startMoveEl reconstructs it from two quick pointerdowns).
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(120);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(600);
  return true;
}

async function run() {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

  // ── Case A: auto role (suggests Mitigation) → credited → over-dug ─────────────
  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctxA.addInitScript(`(() => { try {
    localStorage.setItem('planarfit:sites:v1', JSON.stringify({ s_roles: ${JSON.stringify(siteWith("s_roles", "Pond Roles Site", null))} }));
    localStorage.setItem('planarfit:currentSite:v1', 's_roles');
  } catch (e) {} })();`);
  const pageA = await ctxA.newPage();
  pageA.on("pageerror", (e) => { failures++; console.log(`  [FAIL] pageerror(A) — ${e.message}`); });
  const tA = await openYield(pageA);

  console.log("Case A — auto role (Mitigation) credits the below-WSE cut:");
  expect("(b) Required row renders from the remembered summary", /Required compensating storage/.test(tA));
  expect("(b) Provided (credited pond cut) row renders with a credited volume", /Provided \(credited pond cut\)/.test(tA) && /5[0-9]\.\d\d ac-ft/.test(tA), tA.match(/Provided \(credited pond cut\)[^A-Z]{0,30}/)?.[0]);
  expect("(b) Balance row renders the LOUD over-dug state", /Balance \+5[0-9]\.\d\d ac-ft over/.test(tA));
  expect("(b) over-dug one-liner: '~N ac-ft of cut buys nothing'", /ac-ft of cut buys nothing/.test(tA));
  expect("(b) group verdict reads over-dug", /ac-ft over-dug/.test(tA));
  expect("(b) engineer-confirm caveat rides the Provided row (one line)", /engineer confirms\./.test(tA) || /engineer confirms/.test(tA));
  expect("(d) B833 footprint-floor caveat renders", /treat as a floor/.test(tA));
  const clicked = await clickPond(pageA);
  const tA2 = clicked ? (await pageA.locator("body").innerText()).replace(/\s+/g, " ") : "";
  expect("(a) pond inspector shows the role chips with the Auto suggestion", clicked && /Pond role/.test(tA2) && /Auto \(Mitigation\)/.test(tA2), clicked ? tA2.match(/Pond role[^A-Z]{0,40}/)?.[0] : "pond click missed");
  await pageA.screenshot({ path: "ui-audit/verify-pond-roles-ledger.png" }).catch(() => {});
  await ctxA.close();

  // ── Case B: owner override to Detention → uncredited ──────────────────────────
  const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctxB.addInitScript(`(() => { try {
    localStorage.setItem('planarfit:sites:v1', JSON.stringify({ s_det: ${JSON.stringify(siteWith("s_det", "Detention Override Site", "detention"))} }));
    localStorage.setItem('planarfit:currentSite:v1', 's_det');
  } catch (e) {} })();`);
  const pageB = await ctxB.newPage();
  pageB.on("pageerror", (e) => { failures++; console.log(`  [FAIL] pageerror(B) — ${e.message}`); });
  const tB = await openYield(pageB);

  console.log("Case B — owner role override to Detention un-credits the cut:");
  expect("(c) Provided shows 0.00 with 'no credited ponds'", /Provided \(credited pond cut\)[^0-9]{0,4}0\.00 ac-ft · no credited ponds/.test(tB), tB.match(/Provided \(credited pond cut\)[^A-Z]{0,40}/)?.[0]);
  expect("(c) the uncredited remainder note renders (never silently vanished)", /detention-role ponds: 5[0-9]\.\d\d ac-ft — uncredited/.test(tB));
  expect("(c) Balance shows SHORT (0 provided vs 0.11 required)", /Balance −0\.11 ac-ft SHORT/.test(tB));
  await ctxB.close();

  // ── Case E: NEW-10/B830 balancer + the NEW-13 one-click berm ──────────────────
  // An upland pond (no WSE at it) leaves the site SHORT → the balancer ranks a berm
  // move with an Apply button; applying raises the TOB with provenance and improves
  // the detention verdict. Zone carries NO static BFE so the regime stays unknown →
  // the pond reads gross (deterministic numbers for the screen).
  const siteE = siteWith("s_bal", "Balancer Site", null);
  siteE.els = [
    { id: "b1", type: "building", cx: 300, cy: 300, w: 300, h: 200, rot: 0 },
    { id: "p1", type: "pond", points: [{ x: 100, y: -500 }, { x: 500, y: -500 }, { x: 500, y: -100 }, { x: 100, y: -100 }], det: { depth: 8, freeboard: 1, slope: 3, tobElev: 100 } },
  ];
  siteE.settings.drainage.lastCheck.flood = { zones: [{ zone: "AE", subtype: "", staticBfeFt: null, vdatum: "NAVD88" }], state: "loaded", ageMs: 0 };
  siteE.settings.drainage.lastCheck.detSplit = { screened: true, fmZonesSig: "seed:1", byId: { p1: { wseFt: null, inTrigger: false, estPoolDepthFt: null } } };
  const ctxE2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctxE2.addInitScript(`(() => { try {
    localStorage.setItem('planarfit:sites:v1', JSON.stringify({ s_bal: ${JSON.stringify(siteE)} }));
    localStorage.setItem('planarfit:currentSite:v1', 's_bal');
  } catch (e) {} })();`);
  const pageE = await ctxE2.newPage();
  pageE.on("pageerror", (e) => { failures++; console.log(`  [FAIL] pageerror(E) — ${e.message}`); });
  let tE = await openYield(pageE);
  await pageE.locator('button:has-text("▸ Ledger balancer")').first().click({ timeout: 4000 }).catch(() => {});
  await pageE.waitForTimeout(250);
  tE = (await pageE.locator("body").innerText()).replace(/\s+/g, " ");

  console.log("Case E — balancer card + one-click berm (NEW-10/NEW-13):");
  const preVerdict = tE.match(/−(\d+\.\d\d) ac-ft SHORT/);
  expect("(e) detention reads SHORT before the berm", !!preVerdict, tE.match(/Detention[^A-Z]{0,40}/)?.[0]);
  expect("(e) the Ledger balancer group renders with moves screened", /Ledger balancer/.test(tE) && /move(s)? screened/.test(tE));
  expect("(e) the berm move renders with the solved height", /⛰ Berm \+\d(\.\d)?′/.test(tE), tE.match(/⛰ Berm[^A-Z]{0,60}/)?.[0]);
  expect("(e) proposals-only caveat renders", /Proposals only — nothing changes without your click/.test(tE));
  const applyBtn = pageE.getByRole("button", { name: "Apply" }).first();
  const applyVisible = await applyBtn.isVisible().catch(() => false);
  expect("(e) the berm move carries an Apply chip", applyVisible);
  if (applyVisible) {
    await applyBtn.click();
    await pageE.waitForTimeout(800);
    const tE2 = (await pageE.locator("body").innerText()).replace(/\s+/g, " ");
    expect("(e) applying announces the provenance-stamped berm", /Berm applied: \+\d(\.\d)?′/.test(tE2));
    const postShort = tE2.match(/−(\d+\.\d\d) ac-ft SHORT/);
    const improved = !postShort || (preVerdict && parseFloat(postShort[1]) < parseFloat(preVerdict[1]) - 0.05);
    expect("(e) the detention verdict improves after the berm (surplus or a smaller SHORT)", improved, postShort ? `still SHORT ${postShort[1]} (was ${preVerdict?.[1]})` : "now non-SHORT");
    const clickedE = await clickPond(pageE);
    const tE3 = clickedE ? (await pageE.locator("body").innerText()).replace(/\s+/g, " ") : "";
    expect("(e) the pond carries the 'berm — auto-solved' provenance note (× restores auto)", clickedE && /Berm — auto-solved/.test(tE3), clickedE ? "" : "pond click missed");
  }
  await pageE.screenshot({ path: "ui-audit/verify-ledger-balancer.png" }).catch(() => {});
  await ctxE2.close();

  // ── Case F: NEW-11/B831 — a drawn easement over the pond flags it (no network:
  // the corridor layer stays OFF; drawn easements always screen) ────────────────
  const siteF = siteWith("s_enc", "Encumbered Pond Site", null);
  siteF.markups = [{ id: "es1", kind: "easement", mode: "boundary", easeType: "pipeline", status: "existing", restrictsBuildings: true, restrictsPaving: false, pts: [{ x: -550, y: -350 }, { x: 150, y: -350 }, { x: 150, y: -250 }, { x: -550, y: -250 }] }];
  const ctxF = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctxF.addInitScript(`(() => { try {
    localStorage.setItem('planarfit:sites:v1', JSON.stringify({ s_enc: ${JSON.stringify(siteF)} }));
    localStorage.setItem('planarfit:currentSite:v1', 's_enc');
  } catch (e) {} })();`);
  const pageF = await ctxF.newPage();
  pageF.on("pageerror", (e) => { failures++; console.log(`  [FAIL] pageerror(F) — ${e.message}`); });
  const tF = await openYield(pageF);

  console.log("Case F — pond ∩ drawn easement flags with acreage (NEW-11):");
  // The 700×100 strip crosses the 600-ft pond → 600×100 = 60 000 sf ≈ 1.38 ac.
  expect("(f) the Yield detention group carries the one-line corridor flag with acreage", /1 pond in pipeline\/easement corridors \(~1\.3\d ac\) — operator approval risk/.test(tF), tF.match(/pond in pipeline[^A-Z]{0,60}/)?.[0]);
  const clickedF = await clickPond(pageF);
  const tF2 = clickedF ? (await pageF.locator("body").innerText()).replace(/\s+/g, " ") : "";
  expect("(f) the pond inspector shows the overlap warnLine + the assumed-band caveat", clickedF && /Pond overlaps a pipeline\/easement corridor by ~1\.3\d ac — operator approval \/ relocation risk/.test(tF2) && /ASSUMED screening band/.test(tF2), clickedF ? tF2.match(/Pond overlaps[^.]{0,60}/)?.[0] : "pond click missed");
  await ctxF.close();

  // A clear site shows nothing: Case A/B/E had no easement and never rendered the flag.
  expect("(f) no corridor flag on the easement-free sites (A/B/E)", !/pipeline\/easement corridors/.test(tA) && !/pipeline\/easement corridors/.test(tB) && !/pipeline\/easement corridors/.test(tE));

  await browser.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}
run().catch((e) => { console.error("harness error:", e); process.exit(1); });
