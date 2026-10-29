/* V1954608 / B2504800 — the second-pass parcel search (GA/LA/SD/KY/WA/OR/ID) on the real deploy, signed in as the throwaway test account.
 *   E2E_LOGIN_KEY=… node ui-audit/verify-second-pass-parcels-live.mjs [https://planyr.io] [expectedBuildPrefix]
 * WIRED ARM: for each newly wired county, Select parcels on at a known town → outlines are held from the county's source and a click
 * selects ONE lot. GAP ARM: re-filed / still-none counties show their exact reason sentence and the "Email Michael to request it" link.
 * KNOWN-GOOD ARMS: Katy TX (wired) must hold outlines and Pike KY (paywall) must show its sentence — if either does not, the run is VOID,
 * not scored. Reads /version.json IN THE SAME CALL as the assertions (merged ≠ live). Click-only: nothing is created. */

import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.argv[2] || "https://planyr.io";
const WANT_BUILD = process.argv[3] || null;
let failures = 0;
const expect = (label, cond, extra = "") => { if (!cond) failures++; console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${extra ? ` — ${extra}` : ""}`); };

const WIRED = [
  ["Early", "GA", "Blakely", 31.3774, -84.9344], ["Carroll", "GA", "Carrollton", 33.5801, -85.0766], ["Berrien", "GA", "Nashville", 31.2063, -83.2504],
  ["Macon", "GA", "Montezuma", 32.3046, -84.0241], ["Long", "GA", "Ludowici", 31.7077, -81.7435], ["Catoosa", "GA", "unincorporated (Graysville)", 34.9117, -85.2247],
  ["Iberia", "LA", "New Iberia", 30.0035, -91.8187], ["Vermilion", "LA", "Abbeville", 29.9744, -92.1343], ["Bienville", "LA", "Arcadia", 32.5496, -92.9226],
  ["Columbia", "WA", "Dayton", 46.3226, -117.9811], ["Garfield", "WA", "Pomeroy", 46.4749, -117.5983], ["Okanogan", "WA", "Omak", 48.4113, -119.5273], ["Pacific", "WA", "Raymond", 46.684, -123.7388],
  ["Wallowa", "OR", "Enterprise", 45.4262, -117.2788], ["Sherman", "OR", "Moro", 45.4854, -120.7312],
  ["Aurora", "SD", "Plankinton", 43.7119, -98.4903], ["Davison", "SD", "Mitchell", 43.7094, -98.0298], ["Tripp", "SD", "Winner", 43.367, -99.859], ["Todd", "SD", "Mission", 43.3082, -100.6573],
  ["Yankton", "SD", "Yankton", 42.8711, -97.3973], ["Lake", "SD", "Madison", 43.9994, -97.1148], ["Meade", "SD", "Sturgis", 44.4125, -103.5105],
];
const GAPS = [
  ["Pike County", "KY", 37.4791, -82.5188, /Pike County keeps its parcel map behind a paid subscription/, true],
  ["Walworth County", "SD", 45.5372, -100.4285, /Planyr hasn't found a public parcel map it can use for Walworth County/],
  ["Hyde County", "SD", 44.5231, -99.444, /Planyr hasn't found a public parcel map it can use for Hyde County/],
  ["Clark County", "ID", 44.1739, -112.2306, /Clark County has a parcel map, but it isn't open to the public/],
  ["Harding County", "SD", 45.5885, -103.5455, /Harding County keeps its parcel map behind a paid subscription/],
  ["Jones County", "GA", 33.0268, -83.5546, /Jones County's parcel map server isn't reachable from Planyr right now/],
];

const s = await openSignedIn({ base: BASE, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
const page = s.page;
try {
  await assertMeasurable(page, "verify-second-pass-parcels-live");
  console.log("signed in as", s.proof.email, "| build", JSON.stringify(s.build));
  if (WANT_BUILD && !String(s.build && s.build.build).startsWith(WANT_BUILD)) throw new Error(`served build ${s.build && s.build.build} is not ${WANT_BUILD} — merged ≠ live, aborting`);
  const fresh = async () => {
    await page.goto(BASE + "/?planyrDiag=1#/site", { waitUntil: "domcontentloaded" });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!window.__mapFinderMap, null, { timeout: 45000 });
    await page.getByTestId("map-toolbar-select-parcels").waitFor({ timeout: 45000 });
    await page.waitForTimeout(2500);
  };
  const waitFor = async (fn, ms = 8000) => { const t = Date.now(); let v; while (Date.now() - t < ms) { v = await fn(); if (v) return v; await page.waitForTimeout(250); } return v; };
  const setView = async (la, ln, z) => {
    for (let i = 0; i < 8; i++) {
      await page.evaluate(([a, b, c]) => window.__mapFinderMap.setView([a, b], c, { animate: false }), [la, ln, z]);
      await page.waitForTimeout(2500);
      const ok = await page.evaluate(([a, b, c]) => { const m = window.__mapFinderMap, k = m.getCenter(); return Math.abs(k.lat - a) < 0.01 && Math.abs(k.lng - b) < 0.01 && m.getZoom() === c; }, [la, ln, z]);
      if (ok) return;
    }
    throw new Error(`the map would not hold ${la},${ln}`);
  };
  const screenOf = (la, ln) => page.evaluate(([a, b]) => { const m = window.__mapFinderMap, p = m.latLngToContainerPoint([a, b]), r = m.getContainer().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; }, [la, ln]);
  const held = () => page.evaluate(() => { const d = window.__mapParcelDisplay && window.__mapParcelDisplay(); return d ? { held: d.held, drawn: d.drawn, sources: d.sources } : { held: 0, drawn: 0, sources: [] }; });
  const summary = () => page.evaluate(() => { const el = document.querySelector('[data-testid="map-decide-summary"]'); return el ? el.textContent.trim() : ""; });

  // ── WIRED ARM (+ the Texas known-good arm first) ───────────────────────────────────────────────
  const wiredArm = async (county, st, town, la, ln, knownGood) => {
    console.log(`\n== ${county} County, ${st} — ${town}`);
    await fresh();
    await setView(la, ln, 17);
    await page.getByTestId("map-toolbar-select-parcels").click();
    const h = await waitFor(async () => { const d = await held(); return d.held > 0 ? d : null; }, 45000);
    if (knownGood && !h) throw new Error(`VOID — the known-good arm (${county}) held no outlines`);
    expect(`${county}: outlines held after Select parcels on`, !!h, h ? `${h.held} lots from ${h.sources.join(", ")}` : "none held");
    const c = await screenOf(la, ln);
    let got = "";
    for (const [dx, dy] of [[0, 0], [30, 20], [-30, 20], [30, -20], [-30, -20], [70, 0], [-70, 0], [0, 60], [0, -60], [110, 50], [-110, -50]]) {
      await page.mouse.click(c.x + dx, c.y + dy);
      got = await waitFor(async () => { const t = await summary(); return /^1 parcel/.test(t) ? t : ""; }, 9000);
      if (got) { await page.mouse.click(c.x + dx, c.y + dy); break; }
    }
    if (knownGood && !got) throw new Error(`VOID — the known-good arm (${county}) selected no lot`);
    expect(`${county}: a click selects ONE lot`, !!got, got || (await summary()) || "(no selection)");
    const served = await page.evaluate(async () => { const v = await fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null); return v && v.build; });
    console.log(`  build ${served}`);
  };
  await wiredArm("Katy (Texas known-good)", "TX", "Katy", 29.786, -95.825, true);
  for (const [county, st, town, la, ln] of WIRED) await wiredArm(county, st, town, la, ln, false);

  // ── GAP ARM ────────────────────────────────────────────────────────────────────────────────────
  console.log("\n== gap counties");
  await fresh();
  let armed = false;
  for (const [name, st, la, ln, sentence, knownGood] of GAPS) {
    await page.evaluate(([a, b]) => window.__mapFinderMap.setView([a, b], 17, { animate: false }), [la, ln]);
    await page.waitForTimeout(500);
    if (!armed) { await page.getByTestId("map-toolbar-select-parcels").click(); armed = true; await page.waitForTimeout(500); }
    const c = await screenOf(la, ln);
    await page.mouse.click(c.x, c.y);
    const toast = page.getByTestId("map-status-toast");
    const ok = await toast.filter({ hasText: sentence }).waitFor({ timeout: 25000 }).then(() => true, () => false);
    if (!ok && knownGood) throw new Error(`VOID — the known-good arm (${name}, ${st}) did not show its sentence`);
    const href = ok ? await page.getByTestId("map-gap-request").getAttribute("href").catch(() => null) : null;
    const subjectOk = !!href && new URL(href).searchParams.get("subject") === `Parcel data request: ${name}, ${st}`;
    expect(`${name}, ${st}: exact reason sentence + request link`, ok && subjectOk, ok ? (await toast.innerText()).replace(/\n/g, " | ").slice(0, 140) : "(no matching toast)");
  }
  console.log(failures ? `\nFAIL ${failures}` : "\nPASS", "| build", s.build && s.build.build);
  await s.close();
  process.exit(failures ? 1 : 0);
} catch (e) { console.error("FAIL", e.message); await s.close().catch(() => {}); process.exit(1); }
