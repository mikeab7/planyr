/* B853264 (×3) / B908944 (×2) — dedupe follow-up, 2026-08-31: Michael asked whether a THIRD render
 * site of the "checking flood data" defect class exists, found by search rather than by report.
 * It does: `pondLedger.usableCf` (Detention's provided figure) and `pondLedger.creditedMitCf`
 * (Mitigation's provided figure) are BOTH nulled by the SAME rule — a pond whose split facts didn't
 * survive into a restored session (`factsKnown:false`, `SitePlanner.jsx`'s `pondSplitFor`, reachable
 * when a check ran, the plan was reloaded, and a pond has no persisted split record, e.g. one drawn
 * after the last check). This drives the REAL app logged out on a seeded, georeferenced site with a
 * REAL detention authority ("coh" — City of Houston, via the settings.drainage.authorityId override,
 * so no jurisdiction GIS is needed) and a pond whose detSplit record is deliberately ABSENT from an
 * otherwise-screened remembered check — no live GIS, no auth.
 *
 * Run: node ui-audit/verify-yield-strip-pond-facts-unknown.mjs   (preview on :4173)
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";

const H = 660; // (2*660)^2 sqft ≈ 40 ac — plenty for a real "coh" rate-based requirement
const PARCEL = [{ x: -H, y: -H }, { x: H, y: -H }, { x: H, y: H }, { x: -H, y: H }];
const POND = [{ x: -300, y: -300 }, { x: -100, y: -300 }, { x: -100, y: -100 }, { x: -300, y: -100 }];
const site = {
  id: "s_pondunk", groupId: "s_pondunk", site: "Pond Facts Unknown Fixture", name: "Concept A", status: "active",
  origin: { lat: 29.7604, lon: -95.3698 }, county: "harris",
  parcels: [{ id: "pA", points: PARCEL, locked: true }],
  els: [
    // A real impervious building, so `impPct` (metrics) is nonzero and COH's rate-based
    // detention rule actually prices a positive requirement rather than "not required".
    { id: "b1", type: "building", cx: 300, cy: 300, w: 400, h: 300, rot: 0 },
    { id: "p1", type: "pond", points: POND.map((p) => ({ ...p })), det: { depth: 8, freeboard: 1, slope: 3, tobElev: 94, daAcres: 20, daImpPct: 55, releaseRateCfs: 12, designStorm: 100, outlet: { stages: [{ kind: "orifice", invertElevFt: 86, diameterIn: 12, count: 1 }] } } },
  ],
  measures: [], callouts: [], markups: [], deletedIds: [],
  settings: {
    showSetback: false,
    drainage: {
      autoFacts: false,
      // B750 override: a real, known authority with no jurisdiction GIS needed.
      authorityId: "coh",
      lastCheck: {
        checkedAt: Date.now() - 5 * 60000,
        // Deliberately minimal — no `sig`, no `fetch` — reads as a genuinely CHECKED, non-stale
        // restored view without a hand-reproduced signature string (see the sibling harnesses).
        // `detSplit.screened: true` with an EMPTY `byId` is the exact reported shape: the check
        // ran and screened detention, but this pond (p1) has no persisted split record.
        detSplit: { screened: true, fmZonesSig: "seed:1", byId: {} },
        // A resolved mitigation requirement too (real intersectAcres/volumeCf), so its PROVIDED
        // figure (mitProvided.creditedCf, fed by the SAME pondLedger.creditedMitCf) is ALSO
        // nulled by this pond's missing split record — proving the shared root cause in one pass.
        mitigation: { screened: true, summary: { intersectAcres: 2.1, triggerAcres: 2.1, floodwayAcres: 0, volumeCf: 20 * 43560, volumeAcFt: 20, cutCy: 20 * 43560 / 27, perClass: { "1pct": { acres: 2.1, volumeCf: 20 * 43560, unknown: null } }, ratio: 1, trigger: "1pct", flags: [], offsetBasis: { required: "1pct", used: "1pct", matched: true, label: "1% (100-yr) flood elevation" }, providers: { padElev: "manual", existGrade: "manual", wse1pct: "manual", wse02pct: null, expert: null } } },
      },
    },
  },
  underlay: null, updatedAt: Date.now(),
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify({ s_pondunk: ${JSON.stringify(site)} }));
  localStorage.setItem('planarfit:currentSite:v1', 's_pondunk');
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 980 }, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
await assertMeasurable(page, "verify-yield-strip-pond-facts-unknown");
const errors = [];
const NOISE = /ERR_TUNNEL|ERR_CONNECTION|ERR_CERT|Failed to load resource|net::/i;
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error" && !NOISE.test(m.text())) errors.push(m.text()); });
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(2600);

let fail = 0;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };

await page.getByRole("button", { name: /Yield/ }).first().click().catch(() => {});
await page.waitForTimeout(700);

const dot = page.locator("[data-drain-freshness]").first();
const dotState = await dot.getAttribute("data-drain-freshness").catch(() => null);
log(dotState === "fresh", `header freshness dot reads FRESH (the check completed) :: got "${dotState}"`);

const detSentence = page.locator('[data-testid="yield-verdict-sentence-det"]').first();
const detText = (await detSentence.innerText().catch(() => "")) || "";
log(detText.length > 0, `Detention row is present in the strip :: "${detText}"`);
log(!/checking flood data/i.test(detText), `Detention NEVER claims "checking flood data" while nothing is fetching :: "${detText}"`);
log(/pond details unknown/i.test(detText), `Detention reads the honest "pond details unknown" state :: "${detText}"`);

const mitSentence = page.locator('[data-testid="yield-verdict-sentence-mit"]').first();
const mitText = (await mitSentence.innerText().catch(() => "")) || "";
log(mitText.length > 0, `Mitigation row is present in the strip :: "${mitText}"`);
log(!/checking flood data/i.test(mitText), `Mitigation NEVER claims "checking flood data" while nothing is fetching :: "${mitText}"`);
log(/pond details unknown/i.test(mitText), `Mitigation reads the honest "pond details unknown" state (same root cause as Detention above) :: "${mitText}"`);

log(errors.length === 0, `no console/page errors (${errors.length})` + (errors.length ? ` :: ${errors.slice(0, 2).join(" | ")}` : ""));
console.log(fail === 0 ? "\nALL PASS" : `\n${fail} CHECK(S) FAILED`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
