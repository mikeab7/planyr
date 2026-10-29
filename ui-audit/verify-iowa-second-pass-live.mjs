/* V1949600 / B2499376 — the Iowa second pass on the real deploy, signed in as the throwaway test account.
 *   E2E_LOGIN_KEY=… node ui-audit/verify-iowa-second-pass-live.mjs [https://planyr.io] [expectedBuildPrefix]
 * Reads /version.json IN THE SAME CALL as every assertion (merged ≠ live). Click-only on the Map: nothing is created, so there is nothing to clean up.
 *   · KNOWN-GOOD ARM: Dallas County IA (a county layer wired on 2026-10-19) must select a lot — if it does not, the run is VOID, not scored.
 *   · county-own rows (Carroll, Monroe): a lot selects and NO "Copy of …" line shows.
 *   · copy rows (Appanoose, Plymouth, Des Moines, Madison, Tama, Washington, Henry) and Jackson (2019): a lot selects and the line "Copy of <County> County parcel data …" shows, with its date.
 *   · a county that stays a gap (Adams IA, locked): the reason sentence + "Email Michael to request it". */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const base = process.argv[2] || "https://planyr.io";
const wantBuild = process.argv[3] || null;
// [county, lat, lng, kind, copy-line regex | null]
const CASES = [
  ["Dallas County", 41.681, -94.072, "known-good", null],
  ["Carroll County", 42.03, -94.931, "own", null],
  ["Monroe County", 41.0305, -92.9705, "own", null],
  ["Jackson County", 42.1635, -90.769, "copy", /Copy of Jackson County parcel data .*as of July 2019/],
  ["Appanoose County", 40.7445, -92.941, "copy", /Copy of Appanoose County parcel data published by the Iowa Homeland Security & Emergency Management statewide compilation .*as of November 2017/],
  ["Plymouth County", 42.744, -96.3105, "copy", /Copy of Plymouth County parcel data .*as of November 2017/],
  ["Des Moines County", 40.9255, -91.2345, "copy", /Copy of Des Moines County parcel data .*as of November 2017/],
  ["Madison County", 41.3305, -94.0805, "copy", /Copy of Madison County parcel data .*as of November 2017/],
  ["Tama County", 42.08, -92.5595, "copy", /Copy of Tama County parcel data .*as of November 2017/],
  ["Washington County", 41.3305, -91.7765, "copy", /Copy of Washington County parcel data .*as of November 2017/],
  ["Henry County", 40.981, -91.5465, "copy", /Copy of Henry County parcel data .*as of November 2017/],
  ["Adams County", 41.0114, -94.7377, "gap", /Adams County has a parcel map, but it isn't open to the public/],
];
const rows = [];
const rec = (r) => { rows.push(r); console.log(`  [${r.pass ? "PASS" : "FAIL"}] ${r.name} — ${r.detail}`); };

const s = await openSignedIn({ base, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
try {
  await assertMeasurable(s.page, "verify-iowa-second-pass-live");
  console.log("signed in as", s.proof.email, "| build", JSON.stringify(s.build));
  if (wantBuild && !String(s.build && s.build.build).startsWith(wantBuild)) throw new Error(`served build ${s.build && s.build.build} is not ${wantBuild} — merged ≠ live, aborting`);
  const page = s.page;
  await page.goto(base + "/#/site", { waitUntil: "domcontentloaded" });
  await page.getByTestId("map-toolbar-select-parcels").waitFor({ timeout: 45000 });
  await page.waitForTimeout(3000);
  let armed = false;
  const clickAt = async (lat, lng) => {
    await page.evaluate(([a, b]) => window.__mapFinderMap.setView([a, b], 17, { animate: false }), [lat, lng]);
    await page.waitForTimeout(600);
    if (!armed) { await page.getByTestId("map-toolbar-select-parcels").click(); armed = true; await page.waitForTimeout(400); }
    const pt = await page.evaluate(([a, b]) => { const m = window.__mapFinderMap, p = m.latLngToContainerPoint([a, b]), r = m.getContainer().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; }, [lat, lng]);
    await page.mouse.click(pt.x, pt.y);
  };
  const clearSelection = async () => { const c = page.getByTestId("map-decide-clear"); if (await c.count()) await c.first().click().catch(() => {}); };
  for (const [name, lat, lng, kind, re] of CASES) {
    await clearSelection();
    await clickAt(lat, lng);
    if (kind === "gap") {
      const toast = page.getByTestId("map-status-toast");
      const ok = await toast.filter({ hasText: re }).waitFor({ timeout: 25000 }).then(() => true, () => false);
      const href = ok ? await page.getByTestId("map-gap-request").getAttribute("href").catch(() => null) : null;
      rec({ name, pass: ok && !!href && /^mailto:michael@planyr\.io/.test(href), detail: ok ? `reason sentence shown · request link ${href ? "✓" : "✗"}` : "reason sentence did not appear" });
      continue;
    }
    const summary = page.getByTestId("map-decide-summary");
    const sel = await summary.filter({ hasText: /^1 parcel/ }).waitFor({ timeout: 30000 }).then(() => true, () => false);
    const text = sel ? (await summary.innerText()).replace(/\n/g, " | ").slice(0, 80) : "(no lot selected)";
    if (kind === "known-good" && !sel) throw new Error(`VOID — the known-good arm (${name}) did not select a lot`);
    const line = page.getByTestId("parcel-card-copy-line");
    let copyText = "";
    if (kind === "copy") copyText = await line.first().waitFor({ timeout: 15000 }).then(() => line.first().innerText(), () => "");
    else await page.waitForTimeout(2500);
    const hasLine = kind === "copy" ? re.test(copyText) : (await line.count()) === 0;
    rec({ name, pass: sel && hasLine, detail: `${text} · ${kind === "copy" ? (copyText ? `"${copyText.slice(0, 110)}"` : "copy line MISSING") : "no copy line (as expected)"}` });
  }
  await page.screenshot({ path: process.env.IA_SHOT || "/tmp/iowa-second-pass-live.png" });
  const failed = rows.filter((r) => !r.pass);
  console.log(failed.length ? `FAIL ${failed.length}/${rows.length}` : `PASS ${rows.length}/${rows.length}`, "| build", s.build && s.build.build);
  await s.close();
  process.exit(failed.length ? 1 : 0);
} catch (e) { console.error("FAIL", e.message); await s.close().catch(() => {}); process.exit(1); }
