/* NEW-1 (B2417216 / V1850160) — Select parcels, wide view, against the REAL county servers.
 *
 *   Live:   node ui-audit/verify-parcel-wide-live.mjs --live https://planyr.io   (signs in as the test account; reads /version.json; Map home only — no project is opened or edited)
 *   Local:  vite preview --port 4188 --strictPort, then node ui-audit/verify-parcel-wide-live.mjs   (no relay there: tiles fall back to the county directly)
 *
 * For each named county the page is flown to the county's point, Select parcels is turned on at the CLOSE stage and then walked out through MID and WIDE and back.
 * Every /query answer the page receives is read independently of the app: the LOTS INSIDE each answer are measured from their own outlines, so "house-size
 * lots are hidden" is proven from what the county SENT, not from the app's say-so —
 *   close  answers carry small lots (a known-good arm: if the close stage never receives a lot under 0.3 ac the run is VOID, the place has no house lots to hide)
 *   mid    every lot in every tile answer ≥ ~0.2 ac; wide every lot ≥ ~0.5 ac; the answers are not empty
 *   the requests carry the size where-clause and a maxAllowableOffset; none was sent while the view was moving
 *   the bottom hint says what is held back; zooming in brings the small lots (close answers) and the hint goes
 * and reports, per stage, the number of tile requests and the bytes received (wire size from content-length where present, else the body length). */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { geodesicAreaM2, wideStageForZoom } from "../src/workspaces/site-planner/lib/parcelWideRequest.js";

const LIVE = process.argv.includes("--live") ? process.argv[process.argv.indexOf("--live") + 1] : null;
const BASE = (LIVE || process.env.BASE_URL || "http://localhost:4188/").replace(/\/$/, "");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const CASES = [
  { name: "Davidson TN — 20 Culvert St, Nashville", lat: 36.13760, lng: -86.75346, floor: 17 },
  { name: "Rutherford TN", lat: 35.7299, lng: -86.3194, floor: 16 },
  { name: "Harris TX — Katy", lat: 29.8130, lng: -95.8100, floor: 16 },
  { name: "Dougherty GA — Albany", lat: 31.5785, lng: -84.1557, floor: 14 },
];
let failures = 0;
const expect = (label, cond, extra = "") => { if (!cond) failures++; console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${extra ? ` — ${extra}` : ""}`); };
const M2_PER_AC = 4046.8564224;

let browser = null, closeSigned = null, page;
if (LIVE) {
  const { openSignedIn } = await import("./lib/signedInSession.mjs");
  const s = await openSignedIn({ base: BASE, initScripts: [[() => { window.__PLANYR_E2E = true; }, undefined]] });
  closeSigned = s.close; page = s.page; console.log("signed in:", s.proof, "build:", s.build);
} else {
  browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
  page = await (await browser.newContext({ viewport: { width: 1400, height: 880 } })).newPage();
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
}
await assertMeasurable(page, "verify-parcel-wide-live");
const ver = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null)).catch(() => null);
console.log("version.json:", JSON.stringify(ver));

/* every /query answer, classified */
let tag = "boot";
const seen = [];
page.on("response", async (resp) => {
  const url = resp.url();
  if (!/\/query\?/.test(url) && resp.request().method() !== "POST") return;
  if (!/\/query/.test(url)) return;
  let body = null;
  try { body = await resp.body(); } catch (_) { return; }
  let j = null; try { j = JSON.parse(body.toString("utf8")); } catch (_) { return; }
  const q = new URL(url);
  const where = q.searchParams.get("where") || "";
  const feats = (j && j.features) || [];
  const acres = feats.map((f) => {
    const rings = f.geometry && f.geometry.rings ? f.geometry.rings : f.geometry && f.geometry.type === "Polygon" ? f.geometry.coordinates : f.geometry && f.geometry.type === "MultiPolygon" ? f.geometry.coordinates.flat(1) : null;
    return rings ? geodesicAreaM2(rings) / M2_PER_AC : null;
  }).filter((a) => a != null);
  const sorted = [...acres].sort((a, b) => a - b);
  seen.push({ tag, p2Ac: sorted.length ? sorted[Math.floor(sorted.length * 0.02)] : null, url, via: /\/api\/gis-cache\//.test(url) ? "relay" : "direct", filtered: /Shape__Area|STArea/.test(where), where, offset: q.searchParams.get("maxAllowableOffset"), n: feats.length, minAc: acres.length ? Math.min(...acres) : null, bytes: Number(resp.headers()["content-length"]) || body.length, status: resp.status(), at: Date.now() });
});

const sleep = (ms) => page.waitForTimeout(ms);
const disp = () => page.evaluate(() => { const d = window.__mapParcelDisplay && window.__mapParcelDisplay(); return d ? d.layers.filter((l) => l.wide) : null; });
const tip = () => page.evaluate(() => document.querySelector('[data-testid="select-parcels-tip"]')?.textContent || "");
async function settle(ms = 25000) { // every wide layer idle
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const d = await disp(); if (d && d.length && d.every((l) => l.wide.loading === 0)) { await sleep(700); return true; } await sleep(300); }
  return false;
}
const stats = (t) => { const r = seen.filter((s) => s.tag === t && s.status === 200); return { n: r.length, kb: +(r.reduce((a, s) => a + s.bytes, 0) / 1024).toFixed(1), lots: r.reduce((a, s) => a + s.n, 0) }; };

const selBtn = page.locator('[data-testid="map-toolbar-select-parcels"]').first();

const ONLY = process.argv.find((a) => a.startsWith("--only="));
for (const c of CASES.filter((x) => !ONLY || x.name.startsWith(ONLY.slice(7)))) {
  console.log(`\n=== ${c.name} (cutoff zoom ${c.floor}) ===`);
  await page.goto("about:blank");
  await page.goto(BASE + "/#/map", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__mapFinderMap, null, { timeout: 60000 });
  await sleep(1500);
  const fly = (z) => page.evaluate(([la, ln, zz]) => window.__mapFinderMap.setView([la, ln], zz, { animate: false }), [c.lat, c.lng, z]);
  const key = c.name.split(" ")[0];
  await fly(c.floor + 0.4); await sleep(900);
  tag = `${key}:close`;
  await selBtn.click();
  const t0 = Date.now(); let held = 0;
  while (Date.now() - t0 < 30000) { const d = await page.evaluate(() => { const s = window.__mapParcelDisplay && window.__mapParcelDisplay(); return s ? s.held : 0; }); held = d; if (held >= 20) break; await sleep(500); }
  expect("CLOSE: the outline layer holds lots", held >= 20, `${held} held`);
  const closeAnswers = seen.filter((s) => s.tag === tag && !s.filtered && s.n > 0);
  const smallest = Math.min(...closeAnswers.map((s) => s.minAc ?? Infinity));
  expect("KNOWN-GOOD: the close answers include house-size lots (else nothing to hide — VOID)", smallest < 0.3, `smallest lot received ${smallest === Infinity ? "n/a" : smallest.toFixed(3)} ac`);
  expect("CLOSE sends no size-filtered request", !seen.some((s) => s.tag === tag && s.filtered));
  expect("CLOSE: no 'larger lots' hint", !/larger lots/i.test(await tip()));

  for (const [stage, dz, minAc] of [["mid", -0.5, 0.2], ["wide", -1.5, 0.5]]) {
    tag = `${key}:${stage}`;
    const z = c.floor + dz;
    if (wideStageForZoom(z, c.floor, true) !== stage) { console.log(`  (skip ${stage}: zoom ${z} is not in that stage for this cutoff)`); continue; }
    await fly(z);
    const moved = seen.filter((s) => s.tag === tag && s.filtered).length; // nothing yet: the view only just stopped, the debounce has not fired
    const ok = await settle();
    const rs = seen.filter((s) => s.tag === tag && s.filtered && s.status === 200);
    expect(`${stage.toUpperCase()}: tile requests were sent and answered`, ok && rs.length > 0, `${rs.length} tile answers`);
    expect(`${stage.toUpperCase()}: every request carries the size where-clause`, rs.every((s) => /(Shape__Area|STArea\(\))\s*>=\s*\d+/.test(s.where)), [...new Set(rs.map((s) => s.where))].slice(0, 3).join(" | "));
    expect(`${stage.toUpperCase()}: every request asks for generalised geometry`, rs.every((s) => Number(s.offset) > 0));
    const lots = rs.reduce((a, s) => a + s.n, 0);
    expect(`${stage.toUpperCase()}: the county sent larger lots`, lots > 0, `${lots} lots in ${rs.length} answers`);
    /* The outlines come back GENERALISED (half a pixel at the tile's zoom — up to ~8 m at the widest), which shaves the area of a lot only a few pixels
     * across; so the independent measure is the 2nd percentile of each answer against 0.55 × the stage's cutoff, not the single smallest outline. The
     * where-clause itself is exact on the county's own area column (proven ±3% by the probe and by the ungeneralised sample in B2417216). */
    const floorAc = minAc * 0.55;
    const small = rs.filter((s) => s.p2Ac != null && s.p2Ac < floorAc);
    expect(`${stage.toUpperCase()}: NO house-size lot was sent (98% of every answer's lots ≥ ${floorAc.toFixed(2)} ac, i.e. 0.55 × the ${minAc} ac cutoff)`, small.length === 0, small.length ? `OFFENDER ${small[0].url.slice(0, 300)} ; ${small.map((s) => `${s.p2Ac.toFixed(3)} ac`).slice(0, 4).join(", ")}` : `lowest 2nd-percentile ${Math.min(...rs.map((s) => s.p2Ac ?? Infinity)).toFixed(3)} ac`);
    expect(`${stage.toUpperCase()}: the hint says what is held back`, /Showing larger lots\. Zoom in for small lots and labels\./.test(await tip()), JSON.stringify((await tip()).slice(0, 80)));
    const st = stats(tag);
    console.log(`  ${stage}: ${st.n} requests · ${st.kb} KB · ${st.lots} lots · via ${[...new Set(rs.map((s) => s.via))].join("/")}`);
    void moved;
  }
  tag = `${key}:back`;
  await fly(c.floor + 0.4); await sleep(3000);
  const held2 = await page.evaluate(() => { const s = window.__mapParcelDisplay && window.__mapParcelDisplay(); return s ? s.held : 0; });
  expect("BACK IN: the full outlines return", held2 >= 20, `${held2} held`);
  expect("BACK IN: the 'larger lots' hint is gone", !/larger lots/i.test(await tip()));
  expect("BACK IN: the small lots are received again", seen.filter((s) => s.tag === tag || s.tag === `${key}:close`).some((s) => !s.filtered && s.minAc != null && s.minAc < 0.3));
}

console.log("\nsummary of tile traffic by stage:");
const tags = [...new Set(seen.map((s) => s.tag))];
for (const t of tags) { const s = stats(t); console.log(`  ${t.padEnd(22)} ${String(s.n).padStart(3)} answers · ${String(s.kb).padStart(8)} KB · ${String(s.lots).padStart(6)} lots`); }
if (closeSigned) await closeSigned(); else await browser.close();
console.log(failures ? `\n❌ ${failures} FAILED` : "\n✅ PASS");
process.exit(failures ? 1 : 0);
