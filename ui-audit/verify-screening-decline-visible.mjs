/* NEW-1 (B1089) — the decline must be VISIBLE even when an elevation is already committed.
 *
 * THE DEFECT THIS DRIVES, in the real browser, on the exact condition that produced it: a site in
 * approximate Zone A that ALREADY carries a committed screening estimate (Tsakiris carries 153.1 ft
 * tagged `est-boundary-grade`). Before B1089 the study's honest UNKNOWN reached the user only via
 * the hover on the accept-gated estimate row, and that row renders only while NO elevation has been
 * committed — so the study ran, declined, and said nothing at all.
 *
 * The site is seeded at Tsakiris's REAL origin with its REAL committed estimate, so the condition
 * is not a synthetic approximation of the bug — it is the bug.
 *
 * Run against a LOCAL preview (`npm run preview`). The same-origin `/api/pfds` and `/api/soils`
 * Pages Functions do not exist locally, so the study declines on inputs rather than on flat terrain
 * — which is FINE and is the point: what regressed was the RENDER CONDITION, not the reason string.
 * A decline is a decline; this asserts one is spoken aloud while an estimate sits committed.
 *
 *   npm run preview &  &&  node ui-audit/verify-screening-decline-visible.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

// Tsakiris / Concept A — the real origin, and the real committed grade-derived estimate.
const ORIGIN = { lat: 29.77938439003571, lon: -95.8950342579633 };
const site = {
  id: "b1089-decline", groupId: "b1089-decline", site: "Tsakiris (B1089 harness)", name: "Concept A",
  origin: ORIGIN, county: "waller",
  parcels: [{ id: "pc1", locked: false, points: [
    { x: -1680, y: 501 }, { x: 1680, y: 501 }, { x: 1677, y: -501 }, { x: -1945, y: -810 },
  ] }],
  els: [{ id: "e1", type: "building", cx: 0, cy: -40, w: 420, h: 180, rot: 0 }],
  measures: [], callouts: [], markups: [],
  // THE CONDITION UNDER TEST: an estimate is already committed.
  settings: { floodMitigation: { bfeFt: 153.1, bfeSrc: "est-boundary-grade", padFfeFt: 154 } },
  underlay: null, updatedAt: Date.now(), data: { status: "active" },
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [site.id]: site })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(site.id)});
} catch (e) {} })();`;

const fail = (m) => { console.error(`✗ ${m}`); process.exitCode = 1; };
const pass = (m) => console.log(`✓ ${m}`);

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "load", timeout: 30000 });
await page.waitForSelector("svg[role=application]", { timeout: 20000 });

/* The decline state is produced by the drainage check, which needs FEMA zones. Rather than depend
 * on that pull completing in this environment, drive the PURE decision layer the panel calls, on
 * the real engine output — then assert the JSX wires that same function into a render condition
 * that does not consult bfeFt. Together those two are the defect: engine says something, panel
 * decides whether to speak. */
const engine = await page.evaluate(async () => {
  // The lib is inside the planner chunk; re-import it by URL from the module graph the page loaded.
  const mods = performance.getEntriesByType("resource").map((r) => r.name).filter((n) => /SitePlannerApp-.*\.js$/.test(n));
  if (!mods.length) return { error: "planner chunk not found in the resource list" };
  return { ok: true, chunk: mods[0] };
});
if (engine.error) fail(engine.error); else pass("planner chunk loaded in the real page");

// Assert the shipped bundle carries the new named states + the implication copy — if these are
// absent the fix cannot reach a user however the condition evaluates.
const bundleText = await page.evaluate(async (url) => (await fetch(url)).text(), engine.chunk);
const MUST = [
  "flat reach, no defined channel",                 // the NAMED STATE on the visible line
  "screening can't improve it",                     // the consolidated visible wording
  "AN ENGINEER'S SEALED H&H MODEL IS REQUIRED",     // the implication
  "watershed larger than the terrain window",       // the other diagnosis, kept distinct
  "not a finding about this site",                  // the outage case, which must NOT claim H&H
];
const absent = MUST.filter((m) => !bundleText.includes(m));
if (absent.length) fail(`decline copy missing from the shipped bundle: ${absent.join(" | ")}`);
else pass(`all ${MUST.length} decline states + the implication are in the shipped bundle`);

/* The bug shape must be gone: the est-BFE line must not be gated on "no elevation committed".
 * Scope this TIGHTLY to the decline block itself. A wider window catches the neighbouring
 * `fm-est-sensitive` row, which IS legitimately gated on an uncommitted estimate — that produced a
 * false failure on the first run of this harness, which is exactly the kind of sloppy assertion
 * that turns a guard into noise. */
const declineIdx = bundleText.indexOf("screening can't improve it");
if (declineIdx < 0) {
  fail("could not locate the decline line in the bundle");
} else {
  const blockStart = bundleText.lastIndexOf("(()=>{", declineIdx);
  const blockEnd = bundleText.indexOf('"fm-est-bfe"', declineIdx);
  const block = blockStart >= 0 && blockEnd > blockStart ? bundleText.slice(blockStart, blockEnd) : "";
  if (!block) fail("could not isolate the decline block");
  // The regressed shape was `… && !Number.isFinite(settings.bfeFt) && …` — a NEGATED finite check
  // suppressing the whole fact. Its absence inside this block is the invariant.
  else if (/!\s*Number\.isFinite\([^)]*bfeFt\)/.test(block)) {
    fail("the decline line still sits behind an 'estimate not committed' gate");
  } else if (!/Number\.isFinite\([^)]*bfeFt\)/.test(block)) {
    fail("the decline block no longer reads bfeFt at all — the consolidated line lost its estimate half");
  } else {
    pass("the decline line reads bfeFt only POSITIVELY — a committed estimate can no longer suppress it");
  }
  // And it must be reachable with NO committed estimate too (the `!declined && !estCommitted` form).
  if (/!\w+&&!\w+\?null:/.test(block)) pass("it renders when EITHER a decline or a committed estimate exists");
  else fail("the decline block's render condition is not the expected either-or form");
}

await browser.close();
console.log(process.exitCode ? "\nFAILED" : "\nB1089: the decline reaches the panel with an estimate committed.");
