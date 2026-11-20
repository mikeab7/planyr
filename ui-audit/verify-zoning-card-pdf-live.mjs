/* verify-zoning-card-pdf-live — V2038400 steps 6 and 8 (DeSoto zoning card names the place once, no suffix; the exported sheet carries the zone codes), LIVE on planyr.io, signed in.
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-zoning-card-pdf-live.mjs [https://planyr.io] [--expect-sha <sha>] [--shots <dir>]
 *
 * PART 1 (Map, nothing written): Zoning on at Olive Branch, a click on a polygon → the card's title reads "Zoning · <place>", its Zone row has no "(place)" suffix and there is no second place row.
 * PART 2 (a throwaway LOCATED plan, deleted and verified gone — owner rule 15): Zoning on, File ▾ → Download PDF; the SVG the export draws is captured BEFORE it rasterises and must carry zone-code
 * texts (known-good arm: the on-screen code labels), a printed code must be one that shows on screen, and the PDF's first page is rasterised to a PNG to LOOK at. FOREGROUND-OR-VOID first. */
import { mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { LIVE_PREFIX, throwawayPlan, cleanupLive } from "./lib/liveFixtures.mjs";

const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const BASE = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const EXPECT_SHA = flag("--expect-sha"), SHOTS = flag("--shots") || "/tmp";
mkdirSync(SHOTS, { recursive: true });
let failed = 0, voided = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };
const OB = { lat: 34.9618, lng: -89.8295 };

const s = await openSignedIn({ base: BASE, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
const page = s.page;
await assertMeasurable(page, "verify-zoning-card-pdf-live");
await page.setViewportSize({ width: 1400, height: 900 });
const served = await page.evaluate(async () => (await fetch("/version.json", { cache: "no-store" }).then((r) => r.json())).build);
console.log(`signed in as ${s.proof.email} · served build ${served}`);
if (EXPECT_SHA) check("served build is the merge commit", String(served).startsWith(EXPECT_SHA.slice(0, 7)), `${served} vs ${EXPECT_SHA}`);
const sleep = (ms) => page.waitForTimeout(ms);

/* ── PART 1 — the click card on the Map ── */
await page.goto(BASE + "/?planyrDiag=1#/site", { waitUntil: "domcontentloaded" });
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !!window.__mapFinderMap && !!document.querySelector('[data-testid="layer-panel"][data-surface="finder"]'), null, { timeout: 60000 });
await sleep(1500);
await page.evaluate(([a, b]) => window.__mapFinderMap.setView([a, b], 16, { animate: false }), [OB.lat, OB.lng]);
const p = page.locator('[data-testid="layer-panel"][data-surface="finder"]').first();
await p.getByTestId("layer-group-jur").click();
await p.locator('[data-testid="layer-row-ms_desoto_zoning"] input[type="checkbox"]').first().check();
await sleep(10000);
let card = null;
for (const [dx, dy] of [[0, 0], [60, 40], [-80, 30], [120, -50], [-150, -60], [30, 120], [-40, -120], [200, 100]]) {
  const pt = await page.evaluate(([a, b, x, y]) => { const m = window.__mapFinderMap, q = m.latLngToContainerPoint([a, b]), r = m.getContainer().getBoundingClientRect(); return { x: r.left + q.x + x, y: r.top + q.y + y }; }, [OB.lat, OB.lng, dx, dy]);
  await page.mouse.click(pt.x, pt.y); await sleep(1800);
  const t = await page.evaluate(() => { const e = document.querySelector(".leaflet-popup-content, [data-testid='gis-identify-card']"); return e ? e.innerText : null; });
  if (t && /Zoning/.test(t)) { card = t; break; }
}
console.log("card:", JSON.stringify((card || "").replace(/\s+/g, " ").slice(0, 240)));
await page.screenshot({ path: `${SHOTS}/card.png` });
check("6 · a click on a zoning polygon opens a card", !!card);
if (card) {
  const title = card.split("\n")[0].trim();
  check('6 · the card TITLE names the place once ("Zoning · <place>")', /^Zoning · (Olive Branch|Southaven|Horn Lake|Hernando|Walls|Unincorporated DeSoto County)$/.test(title), title);
  const zoneRow = (card.match(/Zone\s*:?\s*([^\n]+)/) || [])[1] || "";
  check("6 · the Zone row carries no (place) suffix", zoneRow && !/\(/.test(zoneRow), zoneRow);
  check("6 · no second 'Jurisdiction' row", !/Jurisdiction/.test(card));
}

/* ── PART 2 — the PDF carries the zone codes ── */
const id = `${LIVE_PREFIX}zn-pdf-${Date.now().toString(36)}`;
try {
  const plan = { ...throwawayPlan(id), origin: { lat: OB.lat, lon: OB.lng }, site: "ZZ Live Check — Zoning PDF" };
  plan.parcels[0].points = [{ x: -2700, y: -1700 }, { x: -2300, y: -1700 }, { x: -2300, y: -1300 }, { x: -2700, y: -1300 }]; plan.els[0] = { ...plan.els[0], cx: -2500, cy: -1500, w: 200, h: 120 }; plan.els.push({ ...plan.els[0], id: "b2", cx: 2500, cy: 1500 });   // two small buildings far apart: the sheet's frame covers a wide stretch of open aerial and zoning, so the zone codes sit INSIDE it
  const err = await page.evaluate(async ([pl]) => {
    const { data: u } = await window.pfSupabase.auth.getUser();
    const { error } = await window.pfSupabase.from("sites").insert({ id: pl.id, group_id: pl.groupId, site: pl.site, name: pl.name, county: null, user_id: u.user.id, version: 1, data: pl });
    return error ? String(error.message) : null;
  }, [plan]);
  if (err) throw new Error("throwaway plan insert failed — " + err);
  await page.addInitScript(() => { window.__svgBlobs = []; const o = URL.createObjectURL.bind(URL); URL.createObjectURL = (b) => { try { if (b && /svg/.test(b.type || "")) window.__svgBlobs.push(b); } catch (_) { /* capture only */ } return o(b); }; });
  await page.goto(`${BASE}/?planyrDiag=1#/project/${id}/site`, { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("planner-canvas").waitFor({ timeout: 60000 }); await sleep(3000);
  const chip = page.getByTestId("layers-expand").filter({ visible: true }); if (await chip.count()) await chip.first().click();
  const pp = page.locator('[data-testid="layer-panel"][data-surface="planner"]').first();
  await pp.waitFor({ state: "visible", timeout: 20000 }); await sleep(1200);
  let on = false;
  for (let i = 0; i < 8 && !on; i++) { const b = pp.getByTestId("layer-group-jur"); if (await b.count()) { await b.click().catch(() => {}); await sleep(250); } if (await pp.locator('[data-testid="layer-row-ms_desoto_zoning"]').count()) on = true; else await sleep(1500); }
  check("8 · Zoning is offered on the Olive Branch plan", on);
  const cb = pp.locator('[data-testid="layer-row-ms_desoto_zoning"] input[type="checkbox"]').first(); if (!(await cb.isChecked())) await cb.check();
  await sleep(14000);
  const onScreen = await page.evaluate(() => [...new Set([...document.querySelectorAll(".leaflet-tooltip.pf-line-label")].map((e) => e.textContent.trim()).filter(Boolean))]);
  console.log("zone codes on screen:", onScreen.join(" | "));
  if (onScreen.length < 2) { console.log("VOID: known-good arm — fewer than two zone codes are on screen, so parity cannot be judged"); voided++; }
  await page.screenshot({ path: `${SHOTS}/plan-codes.png` });
  await page.locator('button:has-text("File ▾")').first().click({ timeout: 8000 });
  await page.locator('button:has-text("Download PDF / pick frame")').first().click({ timeout: 8000 }); await sleep(900);
  await page.locator('button:has-text("Continue ➜")').first().click({ timeout: 8000 }).catch(() => {});
  await page.waitForSelector('[data-testid="print-compose"]', { timeout: 20000 }); await sleep(4000);
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 90000 }), page.getByRole("button", { name: "Download PDF", exact: true }).click({ timeout: 8000 })]);
  const pdfPath = `${SHOTS}/zoning-export.pdf`;
  await dl.saveAs(pdfPath);
  const drawn = await page.evaluate(async () => { const out = []; for (const b of window.__svgBlobs || []) { const t = await b.text(); const d = new DOMParser().parseFromString(t, "image/svg+xml"); d.querySelectorAll("text").forEach((e) => out.push(e.textContent.trim())); } return out; });
  const codes = drawn.filter((t) => /^(A|A-R|R-\d+|RM-\d|C-\d|M-\d|PUD|PB|PBP|O|PO|RO|ER)( OVERLAY)?$/.test(t));
  console.log(`the export drew ${drawn.length} text items; zone codes: ${[...new Set(codes)].join(" | ") || "none"}`);
  check("8 · the export draws zone codes on the sheet (PDF-PARITY)", codes.length >= 2, `${codes.length}`);
  check("8 · every printed code is one that shows on screen", codes.length > 0 && codes.every((t) => onScreen.includes(t)), codes.filter((t) => !onScreen.includes(t)).join(", "));
  execFileSync("pdftoppm", ["-r", "110", "-png", "-f", "1", "-l", "1", pdfPath, pdfPath.replace(/\.pdf$/, "")]);
} finally {
  const r = await cleanupLive(page, { planId: id });
  check("throwaway plan deleted and verified gone", !r.errors.length && r.left.site === 0, JSON.stringify(r));
}
await s.browser.close().catch(() => {});
console.log(voided ? `VOID (${voided})` : failed ? `FAIL (${failed})` : "PASS");
process.exit(voided ? 2 : failed ? 1 : 0);
