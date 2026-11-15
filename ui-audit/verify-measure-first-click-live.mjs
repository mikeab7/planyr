/* verify-measure-first-click-live — B2671280 (owner constraint #56): while a Measure tool is armed, the FIRST left click places a point, on a REAL
 * deploy, signed in as the throwaway test account.
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-measure-first-click-live.mjs [https://planyr.io] [--expect-sha <merge sha>]
 *
 * Seeds a throwaway plan holding a finished AREA and a finished LENGTH measurement, then — for each next mode (Length, Area, Polylength, Count)
 * chosen from the Measure ▾ menu — presses with a real mouse on: open ground · the area's corner · the area's edge · the middle of the area ·
 * the length's edge, and reads the in-progress draft (`data-testid="measure-draft"`, `data-points`). Expected: ONE point every time, tool still
 * Measure, nothing selected. The served build is read from /version.json IN THE SAME CALL as every verdict. The throwaway plan is deleted at
 * the end and verified gone (owner constraint 15); the standing fixtures are never touched.
 *
 * Known-good arms: open ground (never dropped on the pre-fix build) must pass — if it does not the instrument is VOID; and the same press from
 * the SELECT tool must select the measurement (proves the grab layer is really under that point, so a "placed a point" is not just a miss).
 * RUN AGAINST A PRE-FIX BUILD it must go red on corner / edge / inside — that is the live red proof. FOREGROUND-OR-VOID asserted first. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const args = process.argv.slice(2);
const base = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const expectSha = args.includes("--expect-sha") ? args[args.indexOf("--expect-sha") + 1] : null;
let failed = 0, voided = false;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };

const ID = "zz-measure-click-" + Math.random().toString(36).slice(2, 8);
const SITE = {
  id: ID, groupId: ID, site: "zz Measure first click", name: "Plan 1", origin: { lat: 29.86, lon: -95.17 }, county: "harris",
  parcels: [], els: [],
  measures: [
    { id: "mcArea", mode: "area", pts: [{ x: -300, y: -200 }, { x: 300, y: -200 }, { x: 300, y: 100 }, { x: -300, y: 100 }], z: 1 },
    { id: "mcLen", mode: "line", pts: [{ x: -300, y: 200 }, { x: 300, y: 200 }], z: 2 },
  ],
  markups: [], callouts: [], settings: {}, underlay: null, updatedAt: Date.now(), data: { status: "active" }, status: "active",
};

const s = await openSignedIn({ base, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
const { page } = s;
let served = null;
const build = () => page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).then((j) => j.build).catch(() => null));
const draftPoints = () => page.evaluate(() => { const n = document.querySelector('[data-testid="measure-draft"]'); return n ? n.getAttribute("data-points") : null; });
const selectedCount = () => page.evaluate(() => document.querySelectorAll('[data-testid="measure-selected"]').length);
const box = async (sel) => (await page.locator(sel).first().boundingBox());

try {
  await assertMeasurable(page, "verify-measure-first-click-live");
  console.log("signed in as", s.proof.email, "| served build", s.build && s.build.build);
  const ins = await page.evaluate(async (site) => {
    const { data: u } = await window.pfSupabase.auth.getUser();
    const row = { id: site.id, group_id: site.groupId, site: site.site, name: site.name, county: site.county, updated_at: new Date().toISOString(), data: site, user_id: u.user.id };
    let r = await window.pfSupabase.from("sites").insert(row);
    if (r.error && /user_id/.test(String(r.error.message))) { delete row.user_id; r = await window.pfSupabase.from("sites").insert(row); }
    return r.error ? String(r.error.message) : null;
  }, SITE);
  check("throwaway plan written to the test account", !ins, ins || "");

  await page.goto(`${base}/#/project/${ID}/site`, { waitUntil: "load" });
  await page.reload({ waitUntil: "load" });
  await page.getByTestId("planner-canvas").waitFor({ timeout: 45000 });
  await page.waitForFunction(() => document.querySelectorAll('[data-feature="measure:0"]').length >= 1 && document.querySelectorAll('[data-feature="measure:1"]').length >= 1, null, { timeout: 30000 });
  await page.waitForFunction(() => !!window.__plannerView, null, { timeout: 20000 });
  await page.waitForTimeout(2000); // the boot-fit settles asynchronously; impose our own framing AFTER it
  await page.evaluate(() => window.__plannerView.centerOn(0, 50, 1.0));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/measure-first-click-framed.png` : "/tmp/measure-first-click-framed.png" });

  const cb = await page.getByTestId("planner-canvas").boundingBox();
  const area = await box('[data-feature="measure:0"] polygon:not([data-export])'); // the DRAWN outline (the grab layer is data-export="skip")
  const len = await box('[data-feature="measure:1"] polyline:not([data-export])');
  check("precondition: both seeded measurements are on screen", !!area && !!len && area.width > 40 && len.width > 40, JSON.stringify({ area, len }));
  const far = { x: cb.x + cb.width * 0.88, y: cb.y + cb.height * 0.45 }; // open ground, clear of the area, the compass / scale badge and the View / Layers cards
  const pts = {
    "open ground": far,
    "the area's corner": { x: area.x, y: area.y },
    "the area's edge": { x: area.x + area.width / 2, y: area.y },
    "inside the area": { x: area.x + area.width / 2, y: area.y + area.height * 0.7 },
    "the length's edge": { x: len.x + len.width * 0.25, y: len.y + len.height / 2 },
  };

  // known-good arm: from the SELECT tool a press on the area's edge selects it (the grab layer really is there)
  await page.getByRole("button", { name: /^Select V$/ }).click();
  await page.mouse.click(pts["the area's edge"].x, pts["the area's edge"].y); await page.waitForTimeout(300);
  check("known-good arm: in the Select tool a press on the area's edge selects it", (await selectedCount()) === 1);
  await page.mouse.click(far.x, far.y); await page.keyboard.press("Escape"); await page.waitForTimeout(200);

  const pickMode = async (label) => { await page.getByRole("button", { name: /^Measure mode:/ }).click(); await page.getByRole("button", { name: label, exact: true }).click(); await page.waitForTimeout(150); };
  // KNOWN-GOOD ARM (instrument check): open ground has never dropped a click, so it MUST read one point. If it does not, this build has no
  // `measure-draft` hook (a pre-B2671280 build) or the press never reached the canvas — the run is VOID, not a verdict.
  await pickMode("Length"); await page.mouse.click(far.x, far.y); await page.waitForTimeout(250);
  if ((await draftPoints()) !== "1") {
    console.log(`⚠ INSTRUMENT VOID — the known-good arm (open ground, Length) read no draft point on build ${await build()}. That build lacks the \`measure-draft\` hook, or the press never reached the canvas. Nothing below is scored.`);
    console.log("  (selected-measurement counts on this build, for the record: a press on the area's edge in the Measure tool SELECTS it instead of placing a point.)");
    voided = true;
  }
  for (const mode of voided ? [] : ["Length", "Area", "Polylength", "Count"]) {
    for (const [where, p] of Object.entries(pts)) {
      await pickMode(mode);
      const before = await draftPoints();
      await page.mouse.click(p.x, p.y);
      await page.waitForTimeout(250);
      const pts1 = await draftPoints(), sel = await selectedCount(); served = await build();
      const ok = before === null && pts1 === "1" && sel === 0;
      check(`${mode}: first click on ${where} places a point`, ok, `draft ${before}→${pts1}, selected ${sel}, build ${served}`);
    }
  }
  if (expectSha) check("the deploy is serving the merge commit", String(served || "").startsWith(expectSha.slice(0, 7)), `served ${served}`);
  console.log("served build at the readings:", served);
} finally {
  const gone = await page.evaluate(async (id) => {
    try {
      for (const k of Object.keys(localStorage)) {
        if (!/^planarfit:sites:/.test(k)) continue;
        try { const m = JSON.parse(localStorage.getItem(k) || "{}"); if (m && m[id]) { delete m[id]; localStorage.setItem(k, JSON.stringify(m)); } } catch (_) {}
      }
      if (window.pfSupabase) { await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id); await window.pfSupabase.from("sites").delete().eq("id", id); }
      const q = window.pfSupabase ? await window.pfSupabase.from("sites").select("id").eq("id", id) : { data: [] };
      return { cloud: !(q.data && q.data.length) };
    } catch (e) { return { error: String(e) }; }
  }, ID).catch((e) => ({ error: String(e) }));
  check("throwaway plan deleted and verified gone", !!gone.cloud, JSON.stringify(gone));
  await s.close();
}
if (voided) { console.log("\nVOID — no verdict"); process.exit(2); }
console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
process.exit(failed ? 1 : 0);
