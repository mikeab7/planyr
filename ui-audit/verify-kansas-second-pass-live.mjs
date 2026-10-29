/* V1948064 / B2497840 — Kansas second pass, on the DEPLOYED bundle at planyr.io, signed in as the throwaway test account
 * (ui-audit/lib/signedInSession.mjs; a session's own signed-in check counts, owner decision 2026-10-04).
 *   · Mitchell, Lincoln (a copy of Saline County GIS's layer, scoped to county 053) and Chase (a copy) are now WIRED: Select parcels
 *     over each county's centre selects ONE real lot, the sources line names the county, and a second click toggles it off.
 *   · Barton, Kiowa and Allen are still gaps and now read the `locked` sentence with the "Email Michael to request it" link.
 *   · Pike KY (paywall) is the known-good arm — if it does not show its exact sentence the whole run is VOID, not scored.
 * Click-only: nothing is created or saved, so there is nothing to clean up.
 * Run: E2E_LOGIN_KEY=… node ui-audit/verify-kansas-second-pass-live.mjs [https://planyr.io] [expectedBuildPrefix] */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const base = process.argv[2] || "https://planyr.io";
const wantBuild = process.argv[3] || null;
let failures = 0;
const expect = (label, cond, extra = "") => { if (!cond) failures++; console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${extra ? ` — ${extra}` : ""}`); };

const s = await openSignedIn({ base, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] }); // the read-only map handle is E2E-gated
try {
  const page = s.page;
  await assertMeasurable(page, "verify-kansas-second-pass-live");
  console.log("signed in as", s.proof.email, "| build", JSON.stringify(s.build));
  if (wantBuild && !String(s.build && s.build.build).startsWith(wantBuild)) throw new Error(`served build ${s.build && s.build.build} is not ${wantBuild} — merged ≠ live, aborting`);
  await page.goto(base + "/#/site", { waitUntil: "domcontentloaded" });
  await page.getByTestId("map-toolbar-select-parcels").waitFor({ timeout: 45000 });
  await page.waitForTimeout(3000);
  const waitFor = async (fn, ms = 8000) => { const t = Date.now(); let v; while (Date.now() - t < ms) { v = await fn(); if (v) return v; await page.waitForTimeout(200); } return v; };
  const stamp = () => page.evaluate(async () => { const v = await fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null); const chunk = performance.getEntriesByType("resource").map((r) => r.name.split("/").pop()).filter((n) => /^SitePlannerApp-.*\.js$/.test(n))[0] || null; return { build: v && v.build, chunk }; });
  const summary = () => page.evaluate(() => { const el = document.querySelector('[data-testid="map-decide-summary"]'); return el ? el.textContent.trim() : ""; });
  const held = () => page.evaluate(() => { const d = window.__mapParcelDisplay && window.__mapParcelDisplay(); return d ? { held: d.held, drawn: d.drawn, sources: d.sources } : { held: 0, drawn: 0, sources: [] }; });
  const screenOf = ([la, ln]) => page.evaluate(([a, b]) => { const m = window.__mapFinderMap, p = m.latLngToContainerPoint([a, b]), r = m.getContainer().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; }, [la, ln]);
  const setView = async (la, ln, z) => {
    const holds = () => page.evaluate(([a, b, c]) => { const m = window.__mapFinderMap, k = m.getCenter(); return Math.abs(k.lat - a) < 0.01 && Math.abs(k.lng - b) < 0.01 && m.getZoom() === c; }, [la, ln, z]);
    for (let i = 0; i < 8; i++) { await page.evaluate(([a, b, c]) => window.__mapFinderMap.setView([a, b], c, { animate: false }), [la, ln, z]); await page.waitForTimeout(2500); if (await holds()) { await page.waitForTimeout(2500); if (await holds()) return; } }
    throw new Error(`the map would not hold ${la},${ln} z${z}`);
  };
  const freshMap = async () => { await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => !!window.__mapFinderMap, null, { timeout: 30000 }); await page.getByTestId("map-toolbar-select-parcels").waitFor({ timeout: 30000 }); await page.waitForTimeout(1500); };

  // ── gap arms (a click in Select parcels toasts the reason) ──────────────────────────────────────────────────────────────
  const GAPS = [
    ["Pike County", "KY", 37.4791, -82.5188, /Pike County keeps its parcel map behind a paid subscription/, true],
    ["Barton County", "KS", 38.4705, -98.696, /Barton County has a parcel map, but it isn't open to the public/],
    ["Kiowa County", "KS", 37.5535, -99.375, /Kiowa County has a parcel map, but it isn't open to the public/],
    ["Allen County", "KS", 37.883, -95.359, /Allen County has a parcel map, but it isn't open to the public/],
  ];
  await freshMap();
  let armed = false;
  for (const [name, st, lat, lng, sentence, knownGood] of GAPS) {
    await page.evaluate(([a, b]) => window.__mapFinderMap.setView([a, b], 17, { animate: false }), [lat, lng]);
    await page.waitForTimeout(500);
    if (!armed) { await page.getByTestId("map-toolbar-select-parcels").click(); armed = true; await page.waitForTimeout(400); }
    const pt = await screenOf([lat, lng]);
    await page.mouse.click(pt.x, pt.y);
    const toast = page.getByTestId("map-status-toast");
    const ok = await toast.filter({ hasText: sentence }).waitFor({ timeout: 25000 }).then(() => true, () => false);
    const text = ok ? await toast.innerText() : await toast.innerText().catch(() => "(no toast)");
    if (!ok && knownGood) throw new Error(`VOID — the known-good arm (${name}) did not show its sentence: ${text}`);
    const href = ok ? await page.getByTestId("map-gap-request").getAttribute("href").catch(() => null) : null;
    const subjectOk = !!href && new URL(href).searchParams.get("subject") === `Parcel data request: ${name}, ${st}`;
    expect(`${name}, ${st}: reason sentence + request link`, ok && subjectOk && !/wired here yet/.test(text), ok ? `"${text.replace(/\n/g, " | ").slice(0, 120)}"` : `got: ${text.slice(0, 160)}`);
  }

  // ── wired arms (Select parcels over the county centre selects ONE lot from that county's source) ───────────────────────
  const WIRED = [["Mitchell", 39.3865, -98.098], ["Lincoln", 39.038, -98.105], ["Chase", 38.3, -96.6005]];
  const offs = [[0, 0], [30, 20], [-30, 20], [30, -20], [-30, -20], [70, 0], [-70, 0], [0, 60], [0, -60], [110, 50], [-110, -50]];
  for (const [county, lat, lng] of WIRED) {
    console.log(`\n== ${county} County, KS (${lat}, ${lng})`);
    await freshMap();
    await setView(lat, lng, 16);
    await page.getByTestId("map-toolbar-select-parcels").click();
    const h = await waitFor(async () => { const d = await held(); return d.held > 0 ? d : null; }, 40000);
    await page.waitForTimeout(2500);
    const d = await held(), st = await stamp();
    console.log(`  build ${st.build} · chunk ${st.chunk} · sources ${JSON.stringify(d.sources)} · held ${d.held} · drawn ${d.drawn}`);
    expect(`${county}: outlines held and drawn`, !!h && d.held > 0 && d.drawn > 0, `${d.held} held / ${d.drawn} drawn`);
    expect(`${county}: the sources line names ${county} County`, d.sources.some((x) => new RegExp(county, "i").test(x)), JSON.stringify(d.sources));
    const c = await screenOf([lat, lng]);
    let got = "";
    for (const [dx, dy] of offs) {
      await page.mouse.click(c.x + dx, c.y + dy);
      got = await waitFor(async () => { const t = await summary(); return /^1 parcel/.test(t) ? t : ""; }, 9000);
      if (got) { await page.mouse.click(c.x + dx, c.y + dy); const off = await waitFor(async () => !/^1 parcel/.test(await summary()), 6000); expect(`${county}: a second click toggles the lot off`, !!off); break; }
    }
    expect(`${county}: a click selects ONE real lot`, !!got, got || "(no selection)");
  }
  await page.screenshot({ path: process.env.KS_SHOT || "/tmp/kansas-second-pass-live.png" });
  console.log(failures ? `\nFAIL ${failures}` : "\nPASS", "| build", s.build && s.build.build);
  await s.close();
  process.exit(failures ? 1 : 0);
} catch (e) { console.error("FAIL", e.message); await s.close().catch(() => {}); process.exit(1); }
