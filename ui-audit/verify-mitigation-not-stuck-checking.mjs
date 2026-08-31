/* NEW-6 (owner live pass 2026-08-31, V496866 follow-on) — the Mitigation line stuck on
 * "checking flood data" forever, even though the flood check demonstrably completed: the header
 * went green with a run date, Detention and Buildability both resolved to real verdicts off the
 * SAME data. Root cause: `mitigationVerdict` (lib/yieldVerdicts.js) had no branch for a
 * GENUINELY unresolved mitigation ledger (real geometry, real intersect acreage, but the volume
 * itself never priced — e.g. no published BFE on the reach) — it fell through to the generic
 * `loadingRow`, whose sentence is hardcoded to "checking flood data" no matter what.
 *
 * Drives the REAL app logged out on a seeded, georeferenced site carrying a REMEMBERED drainage
 * check whose mitigation SUMMARY is exactly the shape the real engine (floodplainMitigation.js,
 * UNTOUCHED by this fix) produces for that unresolved case — `intersectAcres > 0`, `volumeCf:
 * null`, `unknownReason` set. This harness is about the STRIP'S OWN SELECTION LOGIC (which text it
 * shows for an already-computed ledger), not the engine's math, so seeding the ledger directly —
 * rather than trying to reproduce a live FEMA fetch that resolves to no BFE — tests exactly the
 * code this fix changed, at the seam it actually renders through.
 *
 * Run: node ui-audit/verify-mitigation-not-stuck-checking.mjs   (preview on :4173)
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";

const H = 660;
const PARCEL = [{ x: -H, y: -H }, { x: H, y: -H }, { x: H, y: H }, { x: -H, y: H }];
const site = {
  id: "s_mitunk", groupId: "s_mitunk", site: "Mitigation Unknown Fixture", name: "Concept A", status: "active",
  origin: { lat: 29.7604, lon: -95.3698 }, county: "harris",
  parcels: [{ id: "pA", points: PARCEL, locked: true }],
  els: [
    { id: "pv1", type: "paving", cx: 0, cy: 0, w: 300, h: 200, rot: 0 },
  ],
  measures: [], callouts: [], markups: [], deletedIds: [],
  settings: {
    showSetback: false,
    drainage: {
      autoFacts: false,
      lastCheck: {
        checkedAt: Date.now() - 5 * 60000,
        // Deliberately minimal — no `sig`, no `fetch` — so this reads as a genuinely CHECKED,
        // non-stale restored view without depending on a hand-reproduced signature string.
        mitigation: {
          screened: true,
          summary: {
            intersectAcres: 2.1,
            triggerAcres: 2.1,
            floodwayAcres: 0,
            volumeCf: null,
            volumeAcFt: null,
            cutCy: null,
            unknownReason: "no published BFE on this reach — enter the BFE (the common case on AE polygons)",
            perClass: { "1pct": { acres: 2.1, volumeCf: null, unknown: "no published BFE on this reach — enter the BFE (the common case on AE polygons)" } },
            ratio: 1, trigger: "1pct", flags: [],
            offsetBasis: { required: "1pct", used: "1pct", matched: true, label: "1% (100-yr) flood elevation" },
            providers: { padElev: null, existGrade: null, wse1pct: null, wse02pct: null, expert: null },
          },
        },
      },
    },
  },
  underlay: null, updatedAt: Date.now(),
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify({ s_mitunk: ${JSON.stringify(site)} }));
  localStorage.setItem('planarfit:currentSite:v1', 's_mitunk');
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 980 }, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
await assertMeasurable(page, "verify-mitigation-not-stuck-checking");
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

const mitSentence = page.locator('[data-testid="yield-verdict-sentence-mit"]').first();
const mitText = (await mitSentence.innerText().catch(() => "")) || "";
log(mitText.length > 0, `Mitigation row is present in the strip :: "${mitText}"`);
log(!/checking flood data/i.test(mitText), `Mitigation NEVER claims "checking flood data" while nothing is fetching :: "${mitText}"`);
log(/volume unknown/i.test(mitText), `Mitigation reads the honest "volume unknown" state :: "${mitText}"`);
log(mitText.includes("no published BFE on this reach"), `Mitigation names WHY (the engine's own unknownReason) :: "${mitText}"`);

log(errors.length === 0, `no console/page errors (${errors.length})` + (errors.length ? ` :: ${errors.slice(0, 2).join(" | ")}` : ""));
console.log(fail === 0 ? "\nALL PASS" : `\n${fail} CHECK(S) FAILED`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
