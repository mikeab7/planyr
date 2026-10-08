/* V1516224 steps 5 + 6 — Select parcels on the DEPLOYED bundle at planyr.io, signed in as the throwaway test account
 * (ui-audit/lib/signedInSession.mjs; owner decision 2026-10-04: a session's own signed-in check counts).
 *
 *   KATY (Harris / Waller saved copy) and a FORT BEND view — against the REAL county servers (HCAD, FBCAD FeatureServer).
 *     Each: outlines held and drawn, lot numbers where the county has a number field, a click selects ONE lot under the
 *     cursor and a second click toggles it off, no page errors. The long-animation-frame blocking time is PRINTED (a
 *     headless box has no GPU — it is evidence of a stall, never a pass for Michael's Chrome).
 *   GEORGIA (Bartow) — the Bartow host is unreachable from this sandbox (live-GIS), so ONLY that host is answered by the
 *     synthetic service (lib/bartowParcelMock.mjs, bartowOnly) while the production bundle runs: a click at z16 and z14
 *     selects the lot under the cursor, a second click toggles it off, and a click made before outlines arrive still adds
 *     the lot. Synthetic data on the real bundle — said so in every line it prints.
 *
 * The build under test is read from /version.json (cache: no-store) together with the served SitePlannerApp chunk, in the
 * SAME evaluate as each region's assertions (CLAUDE.md: a live check is only valid with the chunk hash in the same call).
 * Nothing is persisted: Select-parcels selections are transient (no Plan is created); every click is undone.
 * Run: E2E_LOGIN_KEY=… node ui-audit/verify-parcel-live-signed-in.mjs [https://planyr.io] */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { BARTOW, routeBartowGis, lotAt, cellOf } from "./lib/bartowParcelMock.mjs";

const BASE = process.argv[2] || "https://planyr.io";
let failures = 0;
const expect = (label, cond, extra = "") => { if (!cond) failures++; console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${extra ? ` — ${extra}` : ""}`); };

const s = await openSignedIn({
  base: BASE,
  initScripts: [[() => {
    window.__PLANYR_E2E = true; // read-only map handle (__mapFinderMap) + __mapParcelDisplay; arms nothing that mutates
    window.__loaf = [];
    try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__loaf.push({ t: e.startTime, d: Math.round(e.duration), b: Math.round(e.blockingDuration || 0) }))).observe({ type: "long-animation-frame", buffered: true }); } catch (_) { /* no LoAF in this engine */ }
  }, null]],
});
const page = s.page;
await assertMeasurable(page, "verify-parcel-live-signed-in");
const bartow = await routeBartowGis(page, { bartowOnly: true });
console.log(`signed in as ${s.proof.email} · /version.json build ${JSON.stringify(s.build)}`);

await page.goto(BASE + "/?planyrDiag=1#/site", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
// The dashboard Map is the default view of #/site — no site is opened, so no project row is touched.
await page.waitForFunction(() => !!window.__mapFinderMap, null, { timeout: 30000 });

// Build identity, read in the same call as whatever it vouches for.
const stamp = () => page.evaluate(async () => {
  const v = await fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null);
  const chunk = performance.getEntriesByType("resource").map((r) => r.name.split("/").pop()).filter((n) => /^SitePlannerApp-.*\.js$/.test(n))[0] || null;
  return { build: v && v.build, chunk };
});
const held = () => page.evaluate(() => { const d = window.__mapParcelDisplay && window.__mapParcelDisplay(); return d ? { held: d.held, drawn: d.drawn, sources: d.sources } : { held: 0, drawn: 0, sources: [] }; });
const numbers = () => page.evaluate(() => document.querySelectorAll(".planyr-lot-no").length);
const summary = () => page.evaluate(() => { const el = document.querySelector('[data-testid="map-decide-summary"]'); return el ? el.textContent.trim() : ""; });
const waitFor = async (fn, ms = 8000) => { const t = Date.now(); let v; while (Date.now() - t < ms) { v = await fn(); if (v) return v; await page.waitForTimeout(200); } return v; };
const setView = (la, ln, z) => page.evaluate(([a, b, c]) => { window.__mapFinderMap.setView([a, b], c, { animate: false }); }, [la, ln, z]);
const selectToggle = () => page.locator('[data-testid="map-toolbar-select-parcels"]').first();
const selectIsOn = () => selectToggle().evaluate((el) => el.getAttribute("aria-pressed") === "true" || /active|on|selected/.test(el.className + " " + (el.getAttribute("data-state") || ""))).catch(() => false);
const blockingSince = (t0) => page.evaluate((t) => { const w = window.__loaf.filter((e) => e.t >= t && e.d < 900 || e.t >= t && e.b > 100); return { max: Math.max(0, ...w.map((e) => e.b)), n: w.filter((e) => e.b > 0).length }; }, t0);
const nowMark = () => page.evaluate(() => performance.now());
const screenOf = ([la, ln]) => page.evaluate(([a, b]) => { const p = window.__mapFinderMap.latLngToContainerPoint([a, b]); const r = window.__mapFinderMap.getContainer().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; }, [la, ln]);
const highlightCovers = (pt) => page.evaluate(([x, y]) => [...document.querySelectorAll(".leaflet-overlay-pane path")].some((p) => { const b = p.getBoundingClientRect(); return b.width > 0 && x >= b.left - 1 && x <= b.right + 1 && y >= b.top - 1 && y <= b.bottom + 1; }), [pt.x, pt.y]);

async function turnSelectOn() {
  const t0 = await nowMark();
  await selectToggle().click();
  return t0;
}
async function turnSelectOff() {
  const vis = await selectToggle().isVisible().catch(() => false);
  if (!vis) { console.log("  (toolbar toggle not visible: " + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('[data-testid^="map-"]')].map((e) => e.getAttribute("data-testid") + ":" + (e.getAttribute("aria-pressed") || "") + ":" + e.className.slice(0, 40)))) + ")"); return; }
  await selectToggle().click(); await page.waitForTimeout(600);
}

/* Click around the centre until a click yields "1 parcel" (a road or a gap answers nothing), then prove it is the lot under the
 * cursor and that a second click toggles it off. Returns the summary text of the selection (it names the county). */
async function clickALot(center, label) {
  const c = await screenOf(center);
  const offs = [[0, 0], [30, 20], [-30, 20], [30, -20], [-30, -20], [70, 0], [-70, 0], [0, 60], [0, -60], [110, 50], [-110, -50]];
  for (const [dx, dy] of offs) {
    const pt = { x: c.x + dx, y: c.y + dy };
    const before = await highlightCovers(pt);
    await page.mouse.click(pt.x, pt.y);
    const got = await waitFor(async () => { const t = await summary(); return /^1 parcel/.test(t) ? t : ""; }, 9000);
    if (got) {
      const covered = await highlightCovers(pt);
      expect(`${label}: a click selects ONE lot`, true, got);
      expect(`${label}: …it is the lot under the cursor (a highlight covers the point after${before ? "; one already did before, so only the count is evidence" : ", none before"})`, covered);
      await page.mouse.click(pt.x, pt.y);
      const off = await waitFor(async () => !/^1 parcel/.test(await summary()), 6000);
      expect(`${label}: a second click on it toggles it off`, !!off, (await summary()) || "(no selection)");
      return got;
    }
  }
  expect(`${label}: a click selects ONE lot (tried ${offs.length} points around the centre)`, false, (await summary()) || "(no selection)");
  return "";
}

async function regionArm({ name, lat, lng, z, expectNumbers = false }) {
  console.log(`\n== ${name} (${lat}, ${lng}) z${z}`);
  await setView(lat, lng, z);
  await page.waitForTimeout(1500);
  if (await selectIsOn()) { await turnSelectOff(); await setView(lat, lng, z); await page.waitForTimeout(800); }
  const t0 = await turnSelectOn();
  const h = await waitFor(async () => { const d = await held(); return d.held > 0 ? d : null; }, 40000);
  await page.waitForTimeout(2500); // let the outlines + lot numbers settle
  const d = await held(), n = await numbers(), st = await stamp(), blk = await blockingSince(t0);
  console.log(`  build ${st.build} · chunk ${st.chunk} · sources ${JSON.stringify(d.sources)} · held ${d.held} · drawn ${d.drawn} · lot numbers ${n}`);
  console.log(`  long-animation-frame blocking since Select-on: max ${blk.max} ms in ${blk.n} frame(s) (no GPU here — INFORMATIONAL, not a pass for a real Chrome)`);
  expect(`${name}: outlines held after Select parcels on`, !!h && d.held > 0, `${d.held} lots from ${d.sources.join(", ")}`);
  expect(`${name}: outlines are drawn (not just held)`, d.drawn > 0, `${d.drawn} drawn`);
  if (expectNumbers) expect(`${name}: lot numbers draw`, n > 0, `${n} numbers`);
  await clickALot([lat, lng], name);
  await turnSelectOff();
}

// ── TEXAS, REAL SERVERS ────────────────────────────────────────────────────────────────────────
await regionArm({ name: "Katy (Harris + Waller saved copy)", lat: 29.786, lng: -95.825, z: 16 });
await regionArm({ name: "Fort Bend (Sugar Land)", lat: 29.5944, lng: -95.6143, z: 16 });

// ── GEORGIA, SYNTHETIC BARTOW ON THE REAL BUNDLE ──────────────────────────────────────────────
console.log("\n== Georgia (Bartow) — SYNTHETIC service answering only bartowgis.org; the bundle is the deployed one");
const c = cellOf(BARTOW.lng, BARTOW.lat);
const lotA = lotAt(c.i, c.j), lotB = lotAt(c.i + 3, c.j - 2);
const clickLot = async (lot) => { const pt = await screenOf([lot.lat, lot.lng]); pt.coveredBefore = await highlightCovers(pt); await page.mouse.click(pt.x, pt.y); return pt; };

await setView(BARTOW.lat, BARTOW.lng, 16); await page.waitForTimeout(1500);
if (await selectIsOn()) await turnSelectOff();
await turnSelectOn();
const h16 = await waitFor(async () => { const d = await held(); return d.held > 50 ? d.held : 0; }, 12000);
expect("KNOWN-GOOD ARM: z16 outlines are drawn before the click (the layer holds lots)", h16 > 50, `${h16} lots held · ${bartow.query} Bartow queries`);
const ptA = await clickLot(lotA);
const s1 = await waitFor(async () => (/^1 parcel/.test(await summary()) ? summary() : ""));
expect("Georgia z16: a click selects one lot", /^1 parcel/.test(s1 || ""), s1 || "(no selection)");
expect("Georgia z16: …the lot under the cursor (a highlight covers the point after, none before)", !ptA.coveredBefore && await highlightCovers(ptA));
await clickLot(lotA);
expect("Georgia z16: a second click on the same lot toggles it off", !!(await waitFor(async () => !/^1 parcel/.test(await summary()))), (await summary()) || "(no selection)");
await turnSelectOff();

await setView(BARTOW.lat, BARTOW.lng, 14); await page.waitForTimeout(1500);
await turnSelectOn(); await page.waitForTimeout(4500);
const d14 = await held();
expect("KNOWN-GOOD ARM: z14 outlines are drawn before the click", d14.held > 500, `${d14.held} lots held`);
const ptB = await clickLot(lotB);
const s3 = await waitFor(async () => (/^1 parcel/.test(await summary()) ? summary() : ""));
expect("Georgia z14: a click selects one lot", /^1 parcel/.test(s3 || ""), s3 || "(no selection)");
expect("Georgia z14: …the lot under the cursor (covered after, not before)", !ptB.coveredBefore && await highlightCovers(ptB));
await clickLot(lotB);
await waitFor(async () => !/^1 parcel/.test(await summary()));
await turnSelectOff();

await setView(BARTOW.lat, BARTOW.lng, 16); await page.waitForTimeout(1500);
const q0 = bartow.query;
await turnSelectOn();
const heldAtClick = (await held()).held;
const ptC = await clickLot(lotA);
const s4 = await waitFor(async () => (/^1 parcel/.test(await summary()) ? summary() : ""));
expect("Georgia, before outlines arrive: the click still adds the lot (answered by the live point query)", /^1 parcel/.test(s4 || ""), `${s4 || "(no selection)"} · lots held at click ${heldAtClick}`);
expect("…the lot under the cursor (covered after, not before)", !ptC.coveredBefore && await highlightCovers(ptC));
expect("the (synthetic) service was really asked", bartow.query > q0, `${bartow.query - q0} queries`);
await clickLot(lotA); await page.waitForTimeout(800);
await turnSelectOff();

expect("no uncaught page errors", s.errors.length === 0, s.errors.join(" | "));
await s.close();
console.log(`\n${failures ? `❌ ${failures} FAILED` : "✅ PASS"} — live signed-in parcel check (Katy · Fort Bend · Georgia lot click) on build ${JSON.stringify(s.build)}`);
process.exit(failures ? 1 : 0);
