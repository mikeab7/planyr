/* V1861056 / B2428112 — a county with no parcel data says why and offers "Email Michael to request it", on the real deploy, signed in
 * as the throwaway test account.
 *   E2E_LOGIN_KEY=… node ui-audit/verify-parcel-gap-request-live.mjs [https://planyr.io] [expectedBuildPrefix] [sd]
 * Reads /version.json IN THE SAME CALL as every assertion (merged ≠ live). Click-only: nothing is created, so there is nothing to clean up.
 * Known-good arm: Pike KY (paywall) must show its exact sentence — if it does not, the run is VOID, not scored. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const base = process.argv[2] || "https://planyr.io";
const wantBuild = process.argv[3] || null;
const CASES_B2428112 = [
  ["Pike County", "KY", 37.4791, -82.5188, /Pike County keeps its parcel map behind a paid subscription/, true],
  ["Bath County", "KY", 38.1456, -83.7646, /Bath County keeps its parcel map behind a paid subscription/],
  ["Breckinridge County", "KY", 37.7798, -86.4605, /Breckinridge County has a parcel map, but it isn't open to the public/],
  ["Boyle County", "KY", 37.6456, -84.7694, /Boyle County's parcel map server isn't reachable from Planyr right now/],
  ["Alcona County", "MI", 44.6852, -83.6154, /Alcona County keeps its parcel map behind a paid subscription/], // was the generic "none" sentence until B2528400 (owner Chrome measurement 2026-10-29)
];
/* B2486192 / B2486193 (V1936416): the South Dakota gaps + a Schneider county. Run with a 4th argument: `… https://planyr.io <build> sd`.
 * Pike KY stays as the known-good arm — if it does not show its exact sentence the run is VOID. */
const CASES_SD = [
  CASES_B2428112[0],
  ["Aurora County", "SD", 43.7164, -98.4872, /Aurora County's parcel map server isn't reachable from Planyr right now/],
  ["Hughes County", "SD", 44.3683, -100.351, /Hughes County keeps its parcel map behind a paid subscription/],
  ["Adams County", "IA", 41.0114, -94.7377, /Adams County has a parcel map, but it isn't open to the public/],
  ["Harding County", "SD", 45.5886, -103.5463, /Planyr hasn't found a public parcel map it can use for Harding County/],
];
/* B2507104 (V1956912): the Michigan second pass. `… https://planyr.io <build> mi`. Pike KY stays the known-good arm; Arenac (wired) is the control that must show NO gap notice. */
const CASES_MI = [
  CASES_B2428112[0],
  ["Chippewa County", "MI", 46.3158, -84.9095, /Chippewa County has a parcel map, but it isn't open to the public/],
  ["Washtenaw County", "MI", 42.2567, -83.9002, /Washtenaw County has a parcel map, but it isn't open to the public/],
  ["Clare County", "MI", 43.9923, -84.9152, /Clare County has a parcel map, but it isn't open to the public/],
  ["Alpena County", "MI", 45.0345, -83.6392, /Planyr hasn't found a public parcel map it can use for Alpena County/],
  /* B2528400: the three Schneider Beacon counties the owner measured in his Chrome on 2026-10-29. */
  ["Alcona County", "MI", 44.6852, -83.6154, /Alcona County keeps its parcel map behind a paid subscription/],
  ["Oscoda County", "MI", 44.6845, -84.1967, /Oscoda County has a parcel map, but it isn't open to the public/],
  ["Presque Isle County", "MI", 45.3522, -84.0922, /Presque Isle County has a parcel map, but it isn't open to the public/],
];
const MI_CONTROL = ["Arenac County", "MI", 44.0564, -83.9474]; // wired (mi_arenac): a click is a lot, never a gap notice
const CASES = process.argv[4] === "sd" ? CASES_SD : process.argv[4] === "mi" ? CASES_MI : CASES_B2428112;
const rows = [];
const rec = (r) => { rows.push(r); console.log(`  [${r.pass ? "PASS" : "FAIL"}] ${r.name} — ${r.detail}`); };

const s = await openSignedIn({ base, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] }); // the map handle the click driver reads is E2E-gated
try {
  await assertMeasurable(s.page, "verify-parcel-gap-request-live");
  console.log("signed in as", s.proof.email, "| build", JSON.stringify(s.build));
  if (wantBuild && !String(s.build && s.build.build).startsWith(wantBuild)) throw new Error(`served build ${s.build && s.build.build} is not ${wantBuild} — merged ≠ live, aborting`);
  const page = s.page;
  await page.goto(base + "/#/site", { waitUntil: "domcontentloaded" });
  await page.getByTestId("map-toolbar-select-parcels").waitFor({ timeout: 45000 });
  await page.waitForTimeout(3000);
  let armed = false;
  const clickAt = async (lat, lng) => {
    await page.evaluate(([a, b]) => window.__mapFinderMap.setView([a, b], 17, { animate: false }), [lat, lng]);
    await page.waitForTimeout(400);
    if (!armed) { await page.getByTestId("map-toolbar-select-parcels").click(); armed = true; await page.waitForTimeout(400); }
    const pt = await page.evaluate(([a, b]) => { const m = window.__mapFinderMap, p = m.latLngToContainerPoint([a, b]), r = m.getContainer().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; }, [lat, lng]);
    await page.mouse.click(pt.x, pt.y);
  };
  for (const [name, st, lat, lng, sentence, knownGood] of CASES) {
    await clickAt(lat, lng);
    const toast = page.getByTestId("map-status-toast");
    const ok = await toast.filter({ hasText: sentence }).waitFor({ timeout: 25000 }).then(() => true, () => false);
    const text = ok ? await toast.innerText() : (await toast.innerText().catch(() => "(no toast)"));
    if (!ok && knownGood) throw new Error(`VOID — the known-good arm (${name}) did not show its sentence: ${text}`);
    let href = null, subjectOk = false, bodyOk = false;
    if (ok) {
      href = await page.getByTestId("map-gap-request").getAttribute("href").catch(() => null);
      if (href) { const u = new URL(href); subjectOk = u.pathname === "michael@planyr.io" && u.searchParams.get("subject") === `Parcel data request: ${name}, ${st}`; const b = u.searchParams.get("body") || ""; bodyOk = b.includes(`County: ${name}, ${st}`) && /Point I clicked: -?\d+\.\d{5}, -?\d+\.\d{5}/.test(b); }
    }
    const linkText = ok ? await page.getByTestId("map-gap-request").innerText().catch(() => "") : "";
    rec({ name: `${name}, ${st}`, pass: ok && linkText === "Email Michael to request it" && subjectOk && bodyOk && !/wired here yet/.test(text), detail: ok ? `"${text.replace(/\n/g, " | ").slice(0, 150)}" · link ${linkText ? "✓" : "✗"} · mailto ${subjectOk && bodyOk ? "✓" : "✗"}` : `sentence missing — toast: ${text.slice(0, 160)}` });
  }
  if (CASES === CASES_MI) {
    const [name, st, lat, lng] = MI_CONTROL;
    await clickAt(lat, lng);
    await page.waitForTimeout(9000);
    const gapLinks = await page.getByTestId("map-gap-request").count();
    const toastText = await page.getByTestId("map-status-toast").innerText().catch(() => "");
    const gapWords = /isn't open to the public|hasn't found a public parcel map|keeps its parcel map behind|isn't reachable from Planyr/.test(toastText);
    rec({ name: `${name}, ${st} (wired control)`, pass: gapLinks === 0 && !gapWords, detail: `gap links ${gapLinks} · toast "${toastText.replace(/\n/g, " | ").slice(0, 120)}"` });
  }
  await page.screenshot({ path: process.env.GAP_SHOT || "/tmp/parcel-gap-live.png" });
  const failed = rows.filter((r) => !r.pass);
  console.log(failed.length ? `FAIL ${failed.length}/${rows.length}` : `PASS ${rows.length}/${rows.length}`, "| build", s.build && s.build.build);
  await s.close();
  process.exit(failed.length ? 1 : 0);
} catch (e) { console.error("FAIL", e.message); await s.close().catch(() => {}); process.exit(1); }
