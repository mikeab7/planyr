/* V1861056 / B2428112 — a county with no parcel data says why and offers "Email Michael to request it", on the real deploy, signed in
 * as the throwaway test account.
 *   E2E_LOGIN_KEY=… node ui-audit/verify-parcel-gap-request-live.mjs [https://planyr.io] [expectedBuildPrefix]
 * Reads /version.json IN THE SAME CALL as every assertion (merged ≠ live). Click-only: nothing is created, so there is nothing to clean up.
 * Known-good arm: Pike KY (paywall) must show its exact sentence — if it does not, the run is VOID, not scored. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const base = process.argv[2] || "https://planyr.io";
const wantBuild = process.argv[3] || null;
const CASES = [
  ["Pike County", "KY", 37.4791, -82.5188, /Pike County keeps its parcel map behind a paid subscription/, true],
  ["Bath County", "KY", 38.1456, -83.7646, /Bath County keeps its parcel map behind a paid subscription/],
  ["Breckinridge County", "KY", 37.7798, -86.4605, /Breckinridge County has a parcel map, but it isn't open to the public/],
  ["Boyle County", "KY", 37.6456, -84.7694, /Boyle County's parcel map server isn't reachable from Planyr right now/],
  ["Alcona County", "MI", 44.6852, -83.6154, /Planyr hasn't found a public parcel map it can use for Alcona County/],
];
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
  await page.screenshot({ path: process.env.GAP_SHOT || "/tmp/parcel-gap-live.png" });
  const failed = rows.filter((r) => !r.pass);
  console.log(failed.length ? `FAIL ${failed.length}/${rows.length}` : `PASS ${rows.length}/${rows.length}`, "| build", s.build && s.build.build);
  await s.close();
  process.exit(failed.length ? 1 : 0);
} catch (e) { console.error("FAIL", e.message); await s.close().catch(() => {}); process.exit(1); }
