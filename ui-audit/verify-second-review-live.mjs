/* verify-second-review-live — NEW-1 second adversarial review of main e370ff9 (2026-10-30), in a REAL browser on the map finder, signed in as the test account.
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-second-review-live.mjs https://planyr.io --expect-sha <merge sha>     (creates nothing, so nothing to clean up)
 *
 *  A · Oklahoma: at the real site (36.90, -95.85) the Tribal Areas card is the per-area-type card (Type + Courts + the counsel sentence), never "NOT legal boundaries" / "just statistical" / a site-level claim;
 *      at Pawhuska the Osage Reservation card is a LEGAL area in Census's classification and cites Osage Nation v. Irby with the Nation's dispute.
 *  B · Georgia, the Chattahoochee in Atlanta: no 75-ft (District) or 100-ft (protected-river) band covers the river's centreline inside ARC's MRPA corridor. KNOWN-GOOD arms: in-corridor vertices are in view, and
 *      other bands are painted. DCA's centreline and ARC's corridor are read here, outside the app, as the ground truth.
 *  C · Georgia, Buford Dam: a click on the Protected Rivers line just below the dam is the MRPA card (no 100-ft rule printed).
 *  D · Florida: Broward's wellfield ⓘ names Chapter 27, Article XIII, June 2013 and 250 / 500 / 1,320 ft; the OFW ⓘ says "Rule 62-302.700, F.A.C.".
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
/* Find a row in whichever group holds it (the panel scopes rows by location, so go to the place first). */
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
async function infoText(panel, id) {
  const row = await findRow(panel, id);
  if (!row) return "";
  const caret = panel.getByTestId(`layer-caret-${id}`);
  if (await caret.count() && (await caret.getAttribute("aria-expanded")) !== "true") await caret.click();
  await sleep(300);
  const menu = panel.getByTestId(`layer-row-${id}-menu`);
  const btn = menu.locator('[data-part="info"] button').first();
  if (await btn.count()) await btn.click();
  await sleep(300);
  return menu.locator('[data-testid="layer-info-text"]').allInnerTexts().then((a) => a.join("\n"));
}
/* Click OFF the centre: the test account's own site pin can sit at the real-site coordinate, and a click on it opens the plan instead of the layer's card. */
async function clickOffsetForCard(re, offsets = [[250, 150], [-100, 220], [300, -120]], tries = 3) {
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
const pip = (x, y, ring) => { let ins = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins; } return ins; };

try {
  await assertMeasurable(page, "verify-second-review-live");
  await freshFinder();
  const v = await page.evaluate(async () => (await fetch("/version.json", { cache: "no-store" })).json());
  console.log("served build:", v.build);
  if (expectSha) check("served build matches the merge commit", String(v.build).startsWith(expectSha.slice(0, 7)), `${v.build} vs ${expectSha}`);

  // ── A · Oklahoma tribal cards ──
  const BAD = /NOT legal boundar|not a legal boundary|just statistical/i;
  const NO_CLAIM = /\b(is|are) (in|within|under|subject to) (the )?(tribal|Indian country)/i;
  await goTo(36.9, -95.85, 12);
  let panel = await openFinderPanel();
  check("A · KNOWN-GOOD: the Tribal Areas row is offered at the Oklahoma site", await turnOn(panel, "ok_tribal"));
  let card = await clickOffsetForCard(/Courts/);
  console.log("--- Oklahoma site card ---\n" + card + "\n---");
  check("A · a card opened with Name / Type / Courts", /Name/.test(card) && /Type/.test(card) && /Courts/.test(card));
  check("A · it says the OTSA is the Census representation drawn with the tribe", /Tribal Statistical Area \(OTSA\)[^\n]*Census representation/.test(card));
  check("A · it names a ruling only for a nation one covers, or says none is cited", /McGirt|Court of Criminal Appeals|No court ruling is cited here for this area/.test(card));
  check("A · it carries the counsel sentence and no site-level claim", /unsettled and fact-specific/.test(card) && /does not say whether a site is or is not under tribal jurisdiction/.test(card) && !NO_CLAIM.test(card));
  check("A · the old blanket 'statistical, not a legal boundary' wording is gone", !BAD.test(card));
  await goTo(36.667, -96.337, 11);
  card = await clickOffsetForCard(/Osage Reservation/);
  console.log("--- Pawhuska card ---\n" + card + "\n---");
  check("A · Pawhuska: the Osage Reservation card opened", /Osage Reservation/.test(card));
  check("A · it is a legal area in Census's classification, not 'statistical'", /legal area in Census's classification/.test(card) && !/statistical/i.test(card));
  check("A · it cites Osage Nation v. Irby (2010) and that the Osage Nation disputes it after McGirt", /Osage Nation v\. Irby \(2010\)/.test(card) && /Osage Nation disputes/.test(card));
  check("A · no blanket wording, no site-level claim", !BAD.test(card) && !NO_CLAIM.test(card));

  // ── B · Georgia, the Chattahoochee in Atlanta ──
  const dca = await (await fetch("https://services2.arcgis.com/Gqyymy5JISeLzyNM/arcgis/rest/services/EnvironmentalPlanning/FeatureServer/6/query?" + new URLSearchParams({ where: "FENAME LIKE 'Chattahoochee%'", outFields: "FENAME", outSR: "4326", f: "geojson" }))).json();
  const arc = await (await fetch("https://services1.arcgis.com/Ug5xGQbHsD8zuZzM/arcgis/rest/services/Chattahoochee_River_Corridor_2000ft/FeatureServer/0/query?" + new URLSearchParams({ where: "1=1", outFields: "FEATURE", outSR: "4326", f: "geojson" }))).json();
  const corridor = arc.features[0].geometry.coordinates[0];
  const verts = [];
  for (const f of dca.features) for (const l of (f.geometry.type === "MultiLineString" ? f.geometry.coordinates : [f.geometry.coordinates])) for (const p of l) verts.push(p);
  const inReach = verts.filter(([x, y]) => pip(x, y, corridor));
  const centre = inReach.reduce((b, p) => (!b || Math.hypot(p[0] + 84.4, p[1] - 33.92) < Math.hypot(b[0] + 84.4, b[1] - 33.92) ? p : b), null);
  console.log("ground truth: DCA Chattahoochee vertices", verts.length, "| inside ARC's corridor", inReach.length, "| view centre", centre);
  await freshFinder();
  await goTo(centre[1], centre[0], 14);
  panel = await openFinderPanel();
  check("B · KNOWN-GOOD: the Stream Buffers row is offered in Atlanta", await turnOn(panel, "ga_stream_buffers"));
  let bands = { list: [], tiers: {} };
  for (let t = 0; t < 8; t++) {
    await sleep(5000);
    bands = await page.evaluate(() => {
      const out = [], tiers = {};
      window.__mapFinderMap.eachLayer((l) => {
        const c = String((l && l.options && l.options.color) || "").toLowerCase();
        if (!l._latlngs || !["#b91c1c", "#0369a1", "#b45309", "#0f766e"].includes(c)) return;
        const ring = (Array.isArray(l._latlngs[0]) ? l._latlngs[0] : l._latlngs).map((q) => [q.lng, q.lat]);
        out.push({ c, ring }); tiers[c] = (tiers[c] || 0) + 1;
      });
      return { list: out, tiers };
    });
    if (bands.list.length > 5) break;
  }
  console.log("painted bands by ink:", JSON.stringify(bands.tiers));
  check("B · KNOWN-GOOD: bands are painted in the view (state-waters bands for other streams)", (bands.tiers["#b45309"] || 0) + (bands.tiers["#b91c1c"] || 0) > 0);
  const box = await page.evaluate(() => { const b = window.__mapFinderMap.getBounds(); return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]; });
  const inView = inReach.filter(([x, y]) => x > box[0] && x < box[2] && y > box[1] && y < box[3]);
  check("B · KNOWN-GOOD: the river's in-corridor centreline is in view", inView.length >= 20, `${inView.length} vertices`);
  const wide = bands.list.filter((b) => b.c === "#b91c1c" || b.c === "#0369a1");
  const covered = inView.filter(([x, y]) => wide.some((b) => pip(x, y, b.ring)));
  check("B · no 75-ft (District) or 100-ft (protected-river) band covers the Chattahoochee's centreline inside the MRPA corridor", covered.length < 3, `${covered.length} of ${inView.length} vertices covered`);

  // ── C · Georgia, Buford Dam ──
  await freshFinder();
  await goTo(34.1613, -84.0733, 14);
  panel = await openFinderPanel();
  check("C · KNOWN-GOOD: the Protected Rivers row is offered at Buford Dam", await turnOn(panel, "ga_protected_rivers"));
  const near = verts.filter(([x, y]) => y > 34.14 && y < 34.165 && x > -84.1 && x < -84.07).sort((a, b) => b[1] - a[1]);
  const projected = (pts) => page.evaluate((ps) => { const m = window.__mapFinderMap, bx = m.getContainer().getBoundingClientRect(); return ps.map(([x, y]) => { const q = m.latLngToContainerPoint([y, x]); return [bx.left + q.x, bx.top + q.y]; }).filter(([x, y]) => x > bx.left + 40 && x < bx.right - 40 && y > bx.top + 40 && y < bx.bottom - 40); }, pts);
  let cardC = "";
  if (near.length) {
    await goTo(near[0][1], near[0][0], 17);
    for (let t = 0; t < 6 && !/Metropolitan River Protection Act/.test(cardC); t++) {
      await sleep(5000);
      for (const [x, y] of await projected(near.slice(0, 12))) { await page.mouse.click(x, y); await sleep(600); cardC = await page.locator(".leaflet-popup-content").allInnerTexts().then((a) => a.join("\n")).catch(() => ""); if (/Metropolitan River Protection Act/.test(cardC)) break; }
    }
  }
  console.log("--- Buford Dam card ---\n" + cardC + "\n---");
  check("C · the line just below the dam opens the MRPA card", /Metropolitan River Protection Act/.test(cardC));
  check("C · it prints no '100-ft river corridor' rule", !/100-ft river corridor/.test(cardC));
  // the lake side of the dam, inside the OLD bounding box but not on the reach: no line is there, so a click must not open an MRPA card
  await page.keyboard.press("Escape");
  await goTo(34.169, -84.079, 17);
  await sleep(4000);
  const lake = await page.evaluate(() => { const r = window.__mapFinderMap.getContainer().getBoundingClientRect(); return [r.left + r.width / 2 + 200, r.top + r.height / 2 + 120]; });
  await page.mouse.click(lake[0], lake[1]);
  await sleep(2500);
  const lakeCard = await page.locator(".leaflet-popup-content").allInnerTexts().then((a) => a.join("\n")).catch(() => "");
  check("C · the lake side of Buford Dam (inside the old box) opens no MRPA card", !/Metropolitan River Protection Act/.test(lakeCard));

  // ── D · Florida citations ──
  await freshFinder();
  await goTo(26.1666, -80.2554, 14);
  panel = await openFinderPanel();
  const wf = await infoText(panel, "fl_wellfield_broward");
  console.log("--- Broward wellfield ⓘ ---\n" + wf + "\n---");
  check("D · KNOWN-GOOD: the Broward wellfield row is offered at Sunrise and its ⓘ opened", wf.length > 100);
  check("D · it names Broward County Code, Chapter 27, Article XIII, the June 2013 revision and 250 / 500 / 1,320 ft", /Chapter 27, Article XIII/.test(wf) && /June 2013/.test(wf) && /250 ft/.test(wf) && /500 ft/.test(wf) && /1,320 ft/.test(wf));
  check("D · the unsupported 'tightest nearest the well' inference is gone", !/tightest nearest the well/.test(wf));
  const ofw = await infoText(panel, "fl_outstanding_florida_waters");
  console.log("--- OFW ⓘ ---\n" + ofw.slice(0, 400) + "\n---");
  check("D · the OFW ⓘ cites 'Rule 62-302.700, F.A.C.' and never 's. 62-302.700'", /Rule 62-302\.700, F\.A\.C\./.test(ofw) && !/\bs\. 62-/.test(ofw));
} finally {
  await close();
}
console.log(failed ? `FAIL (${failed})` : "PASS");
process.exit(failed ? 1 : 0);
