/* verify-rule-text-notes-live — NEW-1 (rule text read 2026-10-30): the Colorado oil-and-gas setback note and the Georgia Protected Rivers card/legend carry the RULE's exact wording, in a REAL browser on the map finder.
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-rule-text-notes-live.mjs https://planyr.io --expect-sha <merge sha>      (signed in as the test account; creates nothing, so nothing to clean up)
 *
 *  A · Commerce City CO: Oil & Gas Wells' ⓘ names Rule 604.b's four routes and the 604.a.(3) school / child-care flat 2,000 ft, and keeps "NEW pad, not building near an existing well".
 *  B · Etowah River, Cartersville GA: the Protected Rivers legend says the true corridor starts at the top of the bank; clicking the line opens a card that cites Rule 391-3-16-.04, says "measured horizontally
 *      from the uppermost part of the river bank", and says the drawn band understates it. No card or note says "ordinance".
 * FOREGROUND-OR-VOID asserted first. Live mode reads /version.json in the same call as the assertions. KNOWN-GOOD arm: the pre-change wording ("not a closed list") must be ABSENT and the row must be present. */
import { assertMeasurable } from "./lib/tabTiming.mjs";

const args = process.argv.slice(2);
const base = args.find((a) => /^https?:/.test(a)) || "http://localhost:5199";
const prod = /^https:\/\/(www\.)?planyr\.io/.test(base);
const expectSha = args.includes("--expect-sha") ? args[args.indexOf("--expect-sha") + 1] : null;
let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let page, close;
if (prod) {
  const { openSignedIn } = await import("./lib/signedInSession.mjs");
  const s = await openSignedIn({ base, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
  page = s.page; close = () => s.close();
  console.log("signed in as", s.proof.email);
} else {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.PW_CHROME || undefined });
  page = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
  close = () => browser.close();
}

const goTo = (la, lo, z) => page.evaluate(([a, b, c]) => window.__mapFinderMap.setView([a, b], c, { animate: false }), [la, lo, z]);
async function openFinderPanel() {
  const chip = page.getByTestId("finder-layers-expand").filter({ visible: true });
  if (await chip.count()) await chip.first().click();
  const fp = page.locator('[data-testid="layer-panel"][data-surface="finder"]').first();
  await fp.waitFor({ state: "visible", timeout: 20000 });
  return fp;
}
async function pickGroup(panel, g) {
  const btn = panel.getByTestId(`layer-group-${g}`);
  if (await btn.count()) await btn.click(); else await panel.getByTestId("layer-group-select").selectOption(g);
  await sleep(400);
}
/* Open a row's ▾ and its ⓘ; return the info text (all paragraphs). */
async function infoText(panel, id) {
  const row = panel.locator(`[data-testid="layer-row-${id}"]`).first();
  await row.waitFor({ state: "visible", timeout: 20000 });
  const caret = panel.getByTestId(`layer-caret-${id}`);
  if (await caret.count()) { if ((await caret.getAttribute("aria-expanded")) !== "true") await caret.click(); }
  await sleep(300);
  const menu = panel.getByTestId(`layer-row-${id}-menu`);
  const btn = menu.locator('[data-part="info"] button').first();
  if (await btn.count()) await btn.click();
  await sleep(300);
  return menu.locator('[data-testid="layer-info-text"]').allInnerTexts().then((a) => a.join("\n"));
}
async function legendText(panel, id) {
  const menu = panel.getByTestId(`layer-row-${id}-menu`);
  return menu.locator('[data-part="legend"]').allInnerTexts().then((a) => a.join("\n"));
}

try {
  await assertMeasurable(page, "verify-rule-text-notes-live");
  await page.goto(`${base}/#/site-planner`, { waitUntil: "load" });
  await page.reload({ waitUntil: "load" });
  await sleep(2500);
  await page.waitForFunction(() => !!window.__mapFinderMap, null, { timeout: 30000 });
  const v = await page.evaluate(async () => (await fetch("/version.json", { cache: "no-store" })).json());
  console.log("served build:", v.build);
  if (expectSha) check("served build matches the merge commit", String(v.build).startsWith(expectSha.slice(0, 7)), `${v.build} vs ${expectSha}`);

  // ── A · Colorado wells note, Commerce City ──
  await goTo(39.8083, -104.9339, 14);
  await sleep(1500);
  let panel = await openFinderPanel();
  await pickGroup(panel, "env");
  const wells = await infoText(panel, "co_ecmc_wells");
  console.log("--- Oil & Gas Wells ⓘ ---\n" + wells + "\n---");
  check("A · KNOWN-GOOD: the Oil & Gas Wells row is offered at Commerce City and its ⓘ opened", wells.length > 100, `${wells.length} chars`);
  for (const [name, re] of [
    ["cites 2 CCR 404-1-604 and 604.b", /2 CCR 404-1-604[\s\S]*604\.b/],
    ["more than 500 ft and less than 2,000 ft … ONLY by one of four routes", /more than 500 ft and less than 2,000 ft[\s\S]*ONLY by one of four routes/],
    ["(1) informed consent of all owners and tenants within 2,000 ft", /\(1\) informed consent of all owners and tenants within 2,000 ft/],
    ["(2) Comprehensive Area Plan with preliminary siting approval (Rule 314.b.(4)) or Comprehensive Drilling Plan", /\(2\) an approved Comprehensive Area Plan with preliminary siting approval \(Rule 314\.b\.\(4\)\) or an approved Comprehensive Drilling Plan/],
    ["(3) all wells, tanks, separation equipment and compressors more than 2,000 ft away", /\(3\) all wells, tanks, separation equipment and compressors more than 2,000 ft away/],
    ["(4) Commission finding after a Rule 510 hearing; stricter in a Disproportionately Impacted Community, 604.b.(4).B", /\(4\) a Commission finding, after a Rule 510 hearing[\s\S]*Disproportionately Impacted Community, 604\.b\.\(4\)\.B/],
    ["school / child care center 604.a.(3): flat 2,000 ft, NO exceptions", /604\.a\.\(3\)[^.]*flat 2,000 ft[^.]*NO exceptions/],
    ["governs NEW pads, not building near an existing well", /NEW oil-and-gas working pad surface[\s\S]*does not stop anyone building near an existing well/],
  ]) check(`A · ${name}`, re.test(wells));
  check("A · the old hedge ('not a closed list' / 'usual routes' / 'alternative-location analysis') is gone", !/not a closed list|usual routes|alternative-location analysis/.test(wells));

  // ── B · Georgia Protected Rivers, the Etowah ──
  await page.goto(`${base}/#/site-planner`, { waitUntil: "load" });
  await page.reload({ waitUntil: "load" });
  await sleep(2500);
  await page.waitForFunction(() => !!window.__mapFinderMap, null, { timeout: 30000 });
  await goTo(34.15, -84.8, 15);
  await sleep(1500);
  panel = await openFinderPanel();
  await pickGroup(panel, "env");
  const cb = panel.locator('[data-testid="layer-row-ga_protected_rivers"] input[type="checkbox"]').first();
  check("B · KNOWN-GOOD: the Protected Rivers row is offered at the Etowah", (await cb.count()) > 0);
  if (await cb.count()) await cb.check();
  const legend = await legendText(panel, "ga_protected_rivers").catch(() => "");
  const caret = panel.getByTestId("layer-caret-ga_protected_rivers");
  if (await caret.count() && (await caret.getAttribute("aria-expanded")) !== "true") await caret.click();
  await sleep(400);
  const lg = await legendText(panel, "ga_protected_rivers");
  console.log("--- Protected Rivers legend ---\n" + lg + "\n---");
  check("B · the legend says the true corridor starts at the top of the bank and the drawn band understates it", /starts at the top of the bank/.test(lg) && /understates/.test(lg));
  const note = await infoText(panel, "ga_protected_rivers");
  check("B · the layer ⓘ cites Rule 391-3-16-.04, the top of the river bank, and never says 'ordinance'", /391-3-16-\.04/.test(note) && /uppermost part of the river bank/.test(note) && !/ordinance/i.test(note), note.slice(0, 160));

  // click the river: a popup card opens. Find the PAINTED river path (ink #0369a1, a real `d`) and click ON it, at several points along its length.
  await goTo(34.17, -84.8, 15);
  let pts = [];
  for (let t = 0; t < 8 && !pts.length; t++) {
    await sleep(5000);
    // centre the view ON a real vertex of the loaded line (the longest piece, its middle vertex), so the line passes through the view
    const v = await page.evaluate(() => {
      let best = null;
      window.__mapFinderMap.eachLayer((l) => {
        if (!(l && l.options && String(l.options.color || "").toLowerCase() === "#0369a1" && l._latlngs)) return;
        const ring = Array.isArray(l._latlngs[0]) ? l._latlngs[0] : l._latlngs;
        if (!best || ring.length > best.length) best = ring;
      });
      return best ? best[Math.floor(best.length / 2)] : null;
    });
    if (!v) continue;
    await goTo(v.lat, v.lng, 15);
    await sleep(3000);
    pts = await page.evaluate(() => {
      const m = window.__mapFinderMap, box = m.getContainer().getBoundingClientRect(), out = [];
      m.eachLayer((l) => {
        if (!(l && l.options && String(l.options.color || "").toLowerCase() === "#0369a1" && l._latlngs)) return;
        const ring = Array.isArray(l._latlngs[0]) ? l._latlngs[0] : l._latlngs;
        for (let i = 0; i + 1 < ring.length; i++) {   // sample ALONG each segment: any point ON the line inside the view
          const a = m.latLngToContainerPoint(ring[i]), b = m.latLngToContainerPoint(ring[i + 1]);
          for (let f = 0; f <= 1; f += 0.02) {
            const x = box.left + a.x + (b.x - a.x) * f, y = box.top + a.y + (b.y - a.y) * f;
            if (x > box.left + 60 && x < box.right - 60 && y > box.top + 60 && y < box.bottom - 60) out.push([x, y]);
          }
        }
      });
      return out.filter((_, i) => i % 5 === 0).slice(0, 40);
    });
  }
  console.log("row checked:", await cb.isChecked().catch(() => "?"), "| river layers on the map:", await page.evaluate(() => { let n = 0; window.__mapFinderMap.eachLayer((l) => { if (l && l.options && String(l.options.color || "").toLowerCase() === "#0369a1") n++; }); return n; }));
  console.log(`painted river path points to try: ${pts.length}`);
  let card = "";
  for (const [x, y] of pts) {
    await page.mouse.click(x, y);
    await sleep(600);
    const t = await page.locator(".leaflet-popup-content").allInnerTexts().then((a) => a.join("\n")).catch(() => "");
    if (/391-3-16-\.04/.test(t)) { card = t; break; }
  }
  console.log("--- Protected Rivers card ---\n" + card + "\n---");
  check("B · clicking the Etowah line opens the Protected Rivers card", card.length > 0);
  check("B · card cites Rule 391-3-16-.04 and O.C.G.A. 12-2-8", /Rule 391-3-16-\.04/.test(card) && /12-2-8/.test(card));
  check("B · card: 'measured horizontally from the uppermost part of the river bank'", /measured horizontally from the uppermost part of the river bank/.test(card));
  check("B · card: the one plain line that the drawn band understates it", /true corridor starts at the top of the river bank, so the band drawn here \(from DCA's centreline\) understates it\./.test(card));
  check("B · card does not cite an ordinance", !/ordinance/i.test(card));
} finally {
  await close();
}
console.log(failed ? `FAIL (${failed})` : "PASS");
process.exit(failed ? 1 : 0);
