/* verify-state-lines-live — B2550272 (state lines): each point on the map finder offers ITS OWN state's layer rows, and no neighbour's.
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-state-lines-live.mjs https://planyr.io [--expect-sha <sha>]
 *
 * Signed in as the test account (openSignedIn), finder only (no plan is written, so there is nothing to clean up). For each point it opens the
 * REAL Imagery & Layers card and reads every row of every group. State signatures are DERIVED, not typed: a state's signature is the set of rows
 * its own known-good city offers that none of the other known-good cities offer — so a renamed row cannot silently empty the check, and a
 * run whose signatures are empty is VOID (the known-good arm).
 *   Florala AL, (34.0,-85.42) AL    → none of the Florida / Georgia / Texas / Oklahoma signature rows
 *   Red River, Oklahoma side        → the Oklahoma signature, no Texas row
 *   Houston TX · Tallahassee FL · Atlanta GA → their own signature, none of the others'
 * FOREGROUND-OR-VOID asserted first; /version.json is read in the same call as the assertions. */
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const args = process.argv.slice(2);
const base = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const expectSha = args.includes("--expect-sha") ? args[args.indexOf("--expect-sha") + 1] : null;
let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };

const POINTS = {
  houston: { lat: 29.7604, lon: -95.3698, label: "Houston, TX", state: "TX" },
  tallahassee: { lat: 30.4383, lon: -84.2807, label: "Tallahassee, FL", state: "FL" },
  atlanta: { lat: 33.749, lon: -84.388, label: "Atlanta, GA", state: "GA" },
  tulsa: { lat: 36.154, lon: -95.9928, label: "Tulsa, OK", state: "OK" },
  redriver: { lat: 33.648, lon: -94.498, label: "Red River, Oklahoma side (33.648,-94.498)", state: "OK" },
  florala: { lat: 31.0046, lon: -86.3283, label: "Florala, AL", state: "AL" },
  alga: { lat: 34.0, lon: -85.42, label: "(34.0,-85.42), AL side of the AL|GA line", state: "AL" },
};

const { page, close, proof } = await openSignedIn({ base, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
console.log("signed in as", proof.email);
const rowLabels = (scope) => scope.evaluate((root) => [...root.querySelectorAll('[data-testid^="layer-row-"]')]
  .filter((r) => !r.getAttribute("data-testid").endsWith("-menu"))
  .map((r) => (r.querySelector("label span[title]") || r.querySelector("label") || r).textContent.trim()));
const groupKeys = (scope) => scope.evaluate((root) => {
  const nav = root.querySelector('[data-testid="layer-group-nav"]');
  if (nav) return [...nav.querySelectorAll("[data-testid^='layer-group-']")].map((b) => b.getAttribute("data-testid").replace("layer-group-", "")).filter((k) => !k.startsWith("count-"));
  const sel = root.querySelector('[data-testid="layer-group-select"]');
  return sel ? [...sel.options].map((o) => o.value) : [];
});
async function allRows(panel) {
  const out = [];
  for (const k of await groupKeys(await panel.elementHandle())) {
    if (k === "base") continue;
    const btn = panel.getByTestId(`layer-group-${k}`);
    if (await btn.count()) await btn.click(); else await panel.getByTestId("layer-group-select").selectOption(k);
    await page.waitForTimeout(150);
    out.push(...(await rowLabels(await panel.elementHandle())));
  }
  return [...new Set(out)].sort();
}

try {
  await assertMeasurable(page, "verify-state-lines-live");
  const v = await page.evaluate(async () => (await fetch("/version.json", { cache: "no-store" })).json());
  console.log("served build:", v.build);
  if (expectSha) check("served build matches the merge commit", String(v.build).startsWith(expectSha.slice(0, 7)), `${v.build} vs ${expectSha}`);
  await page.setViewportSize({ width: 1280, height: 860 });

  const rows = {};
  for (const [key, p] of Object.entries(POINTS)) {
    await page.goto(`${base}/?cb=${Date.now()}#/site-planner`, { waitUntil: "load" });
    await page.waitForTimeout(2200);
    await page.waitForFunction(() => !!window.__mapFinderMap, null, { timeout: 30000 });
    await page.evaluate(([la, lo]) => window.__mapFinderMap.setView([la, lo], 14, { animate: false }), [p.lat, p.lon]);
    await page.waitForTimeout(1500);
    const chip = page.getByTestId("finder-layers-expand").filter({ visible: true });
    if (await chip.count()) await chip.first().click();
    const fp = page.locator('[data-testid="layer-panel"][data-surface="finder"]').first();
    await fp.waitFor({ state: "visible", timeout: 20000 });
    await page.waitForTimeout(700);
    rows[key] = await allRows(fp);
    console.log(`${p.label}: ${rows[key].length} rows`);
  }

  // signatures: rows only that state's own city offers
  const known = { TX: "houston", FL: "tallahassee", GA: "atlanta", OK: "tulsa" };
  const sig = {};
  for (const [st, key] of Object.entries(known)) {
    const others = Object.entries(known).filter(([s]) => s !== st).flatMap(([, k]) => rows[k]);
    sig[st] = rows[key].filter((r) => !others.includes(r));
    // known-good arm: a state with no signature rows would make every "no leak" assertion vacuous
    check(`known-good arm · ${st} has signature rows (${POINTS[key].label})`, sig[st].length >= 3, `${sig[st].length}: ${sig[st].slice(0, 6).join(" | ")}`);
  }
  for (const [key, p] of Object.entries(POINTS)) {
    for (const st of Object.keys(sig)) {
      const hit = sig[st].filter((r) => rows[key].includes(r));
      if (p.state === st) check(`${p.label}: offers ALL ${st} rows`, hit.length === sig[st].length, `${hit.length}/${sig[st].length}`);
      else check(`${p.label}: offers NO ${st} row`, hit.length === 0, hit.slice(0, 6).join(" | ") || "none");
    }
  }
} finally {
  await close();
}
console.log(failed ? `FAIL (${failed})` : "PASS");
process.exit(failed ? 1 : 0);
