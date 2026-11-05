/* V1946528 / B2496304 — the Illinois second pass on the real deploy, signed in as the throwaway test account.
 *   E2E_LOGIN_KEY=… node ui-audit/verify-illinois-second-pass-live.mjs [https://planyr.io] [expectedBuildPrefix]
 * WIRED ARM: for each of the nine newly wired counties, Select parcels on at a known lot's town → outlines are held from the county's
 * source and a click selects ONE lot (a second click toggles it off). GAP ARM: Stephenson / Pike / Piatt / Scott show their exact reason
 * sentence and the "Email Michael to request it" link. KNOWN-GOOD ARM: Pike KY (paywall) must show its sentence, and Texas (Katy) must
 * hold outlines — if either does not, the run is VOID, not scored (a harness that cannot see the thing it measures proves nothing).
 * Reads /version.json IN THE SAME CALL as the assertions (merged ≠ live). Click-only: nothing is created, nothing to clean up. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.argv[2] || "https://planyr.io";
const WANT_BUILD = process.argv[3] || null;
let failures = 0;
const expect = (label, cond, extra = "") => { if (!cond) failures++; console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${extra ? ` — ${extra}` : ""}`); };

const WIRED = [
  ["Jersey", "Grafton", 38.9689, -90.4304], ["Warren", "Roseville", 40.7283, -90.5718], ["Wabash", "Allendale", 38.5253, -87.7247],
  ["Jasper", "Newton", 38.9806, -88.1626], ["Alexander", "Tamms", 37.2381, -89.2679], ["Cass", "Beardstown", 40.017, -90.4301],
  ["Champaign", "Urbana", 40.1106, -88.2073], ["Clark", "Marshall", 39.3914, -87.6931], ["Mason", "Havana", 40.2995, -90.0615],
];
const GAPS = [
  ["Pike County", "KY", 37.4791, -82.5188, /Pike County keeps its parcel map behind a paid subscription/, true],
  ["Stephenson County", "IL", 42.296, -89.62, /Stephenson County has a parcel map, but it isn't open to the public/],
  ["Pike County", "IL", 39.607, -90.8, /Pike County has a parcel map, but it isn't open to the public/],
  ["Piatt County", "IL", 40.0272, -88.5731, /Piatt County keeps its parcel map behind a paid subscription/],
  ["Scott County", "IL", 39.6264, -90.4, /Planyr hasn't found a public parcel map it can use for Scott County/],
];

const s = await openSignedIn({ base: BASE, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
const page = s.page;
try {
  await assertMeasurable(page, "verify-illinois-second-pass-live");
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
  const wiredArm = async (county, town, la, ln, knownGood) => {
    console.log(`\n== ${county} County, IL — ${town}`);
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
    const st = await page.evaluate(async () => { const v = await fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null); return v && v.build; });
    console.log(`  build ${st}`);
  };
  await wiredArm("Katy (Texas known-good)", "Katy", 29.786, -95.825, true);
  for (const [county, town, la, ln] of WIRED) await wiredArm(county, town, la, ln, false);

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
