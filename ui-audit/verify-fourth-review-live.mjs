/* verify-fourth-review-live — NEW-1 (fourth adversarial review follow-up, 2026-10-30), in a REAL browser on the map finder, signed in as the test account.
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-fourth-review-live.mjs https://planyr.io --expect-sha <merge sha>     (creates nothing, so nothing to clean up)
 *
 *  A · Oklahoma tribal card at the real site (36.90, -95.85): the per-area card still opens (Name / Type / Courts / counsel sentence) — the unchanged-behaviour arm.
 *  B · Oklahoma tribal card at a Chickasaw point (Ada OK): the Courts line cites Bosse v. State, 2021 OK CR 30 (the standing opinion), never the withdrawn March opinion's docket-only cite
 *      "No. PCD-2019-124", and the card carries the counsel sentence.
 * KNOWN-GOOD ARM: the site card must open first — a run in which the Courts card never opened proves nothing about Ada and is VOID.
 * FOREGROUND-OR-VOID asserted first. Live mode reads /version.json in the same call as the assertions. */
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
async function freshFinder() {
  await page.goto(`${base}/#/site-planner`, { waitUntil: "load" });
  await page.reload({ waitUntil: "load" });
  await sleep(2500);
  await page.waitForFunction(() => !!window.__mapFinderMap, null, { timeout: 30000 });
}
async function openFinderPanel() {
  const chip = page.getByTestId("finder-layers-expand").filter({ visible: true });
  if (await chip.count()) await chip.first().click();
  const fp = page.locator('[data-testid="layer-panel"][data-surface="finder"]').first();
  await fp.waitFor({ state: "visible", timeout: 20000 });
  return fp;
}
async function findRow(panel, id) {
  const row = panel.locator(`[data-testid="layer-row-${id}"]`).first();
  if (await row.count()) return row;
  const groups = await panel.locator('[data-testid^="layer-group-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")).filter((t) => t !== "layer-group-select"));
  for (const g of groups) { await panel.getByTestId(g).click(); await sleep(350); if (await row.count()) return row; }
  return null;
}
async function turnOn(panel, id) {
  const row = await findRow(panel, id);
  if (!row) return false;
  const cb = row.locator('input[type="checkbox"]').first();
  if (!(await cb.isChecked())) await cb.check();
  return true;
}
/* Click OFF the centre: the test account's own site pin can sit at the real-site coordinate, and a click on it opens the plan instead of the layer's card. */
async function clickOffsetForCard(re, offsets = [[250, 150], [-100, 220], [300, -120], [0, 0], [-250, -100]], tries = 3) {
  for (let i = 0; i < tries; i++) {
    await sleep(6000);
    for (const [dx, dy] of offsets) {
      const c = await page.evaluate(() => { const r = window.__mapFinderMap.getContainer().getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      await page.mouse.click(c.x + dx, c.y + dy);
      await sleep(2500);
      const t = await page.locator(".leaflet-popup-content").allInnerTexts().then((a) => a.join("\n")).catch(() => "");
      if (re.test(t)) return t;
    }
  }
  return await page.locator(".leaflet-popup-content").allInnerTexts().then((a) => a.join("\n")).catch(() => "");
}

try {
  await assertMeasurable(page, "verify-fourth-review-live");
  await freshFinder();
  const v = await page.evaluate(async () => (await fetch("/version.json", { cache: "no-store" })).json());
  console.log("served build:", v.build);
  if (expectSha) check("served build matches the merge commit", String(v.build).startsWith(expectSha.slice(0, 7)), `${v.build} vs ${expectSha}`);

  const NO_CLAIM = /\b(is|are) (in|within|under|subject to) (the )?(tribal|Indian country)/i;
  // A — the real site: the known-good arm
  await goTo(36.9, -95.85, 12);
  let panel = await openFinderPanel();
  check("A · KNOWN-GOOD: the Tribal Areas row is offered at the Oklahoma site", await turnOn(panel, "ok_tribal"));
  let card = await clickOffsetForCard(/Courts/);
  console.log("--- Oklahoma site card ---\n" + card + "\n---");
  check("A · a card opened with Name / Type / Courts", /Name/.test(card) && /Type/.test(card) && /Courts/.test(card));
  check("A · counsel sentence present, no site-level claim", /unsettled and fact-specific/.test(card) && !NO_CLAIM.test(card));
  const siteOk = /Courts/.test(card);

  // B — a Chickasaw point (Ada)
  await goTo(34.7745, -96.6783, 11);
  panel = await openFinderPanel();
  await turnOn(panel, "ok_tribal");
  card = await clickOffsetForCard(/Chickasaw/);
  console.log("--- Ada (Chickasaw) card ---\n" + card + "\n---");
  check("B · the Chickasaw card opened (known-good arm held: " + siteOk + ")", siteOk && /Chickasaw/.test(card));
  check("B · its Courts line cites Bosse v. State, 2021 OK CR 30", /Bosse v\. State, 2021 OK CR 30/.test(card));
  check("B · the withdrawn opinion's docket-only cite is gone", !/PCD-2019-124/.test(card));
  check("B · the counsel sentence is present and there is no site-level claim", /unsettled and fact-specific/.test(card) && !NO_CLAIM.test(card));
} catch (e) { check("harness ran to completion", false, String(e && e.message || e)); }
await close();
console.log(failed ? `\n${failed} check(s) FAILED` : "\nALL CHECKS PASSED");
process.exit(failed ? 1 : 0);
