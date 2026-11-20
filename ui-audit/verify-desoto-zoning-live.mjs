/* verify-desoto-zoning-live — the zone-code PLACEMENT (B2563410, follow-up to B2589346): one code per polygon, centred inside it, none where the polygon is too small, never overlapping — on the map and in the
 * exported PDF — LIVE on planyr.io (or a branch preview), signed in as the test account.
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-desoto-zoning-live.mjs [https://planyr.io] [--shots <dir>] [--expect-sha <sha>] [--part labels|pdf|all]
 *
 * (The legend-by-government and no-false-"too detailed" checks are `verify-zoning-legend-live`.) Judge by the SCREENSHOTS it writes (the map with codes, the exported sheet) — the assertions are a net, not
 * the verdict. FOREGROUND-OR-VOID first; throwaway LOCATED plans are deleted and verified gone (owner rule 15). A run whose known-good arm fails is VOID, never a pass. */
import { mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { LIVE_PREFIX, throwawayPlan, cleanupLive } from "./lib/liveFixtures.mjs";

const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const BASE = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const SHOTS = flag("--shots", "/tmp/zoning-shots"), PART = flag("--part", "all"), EXPECT_SHA = flag("--expect-sha");
mkdirSync(SHOTS, { recursive: true });
let failed = 0, voided = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };
const voidRun = (why) => { console.log(`VOID: ${why}`); voided++; };
const want = (p) => PART === "all" || PART === p;

const s = await openSignedIn({ base: BASE, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
const page = s.page;
await assertMeasurable(page, "verify-desoto-zoning-live");
await page.setViewportSize({ width: 1500, height: 950 });
const sleep = (ms) => page.waitForTimeout(ms);
const served = await page.evaluate(async () => (await fetch("/version.json", { cache: "no-store" }).then((r) => r.json())).build);
console.log(`signed in as ${s.proof.email} · served build ${served}`);
if (EXPECT_SHA) check("served build is the expected one", String(served).startsWith(EXPECT_SHA.slice(0, 7)), `${served} vs ${EXPECT_SHA}`);

const planIds = [];
const insert = async (plan) => {
  const err = await page.evaluate(async ([pl]) => {
    const { data: u } = await window.pfSupabase.auth.getUser();
    const { error } = await window.pfSupabase.from("sites").insert({ id: pl.id, group_id: pl.groupId, site: pl.site, name: pl.name, county: null, user_id: u.user.id, version: 1, data: pl });
    return error ? String(error.message) : null;
  }, [plan]);
  planIds.push(plan.id);
  if (err) throw new Error("throwaway plan insert failed — " + err);
};
const mk = (tag, lat, lng) => ({ ...throwawayPlan(`${LIVE_PREFIX}zn-${tag}-${Date.now().toString(36)}`), origin: { lat, lon: lng }, site: `ZZ Live Check — zoning ${tag}` });
const openPlan = async (plan) => {
  await page.goto(`${BASE}/?planyrDiag=1#/project/${plan.id}/site`, { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("planner-canvas").waitFor({ timeout: 60000 });
  await sleep(3000);
};
const plannerPanel = async () => {
  const chip = page.getByTestId("layers-expand").filter({ visible: true }); if (await chip.count()) await chip.first().click();
  const pp = page.locator('[data-testid="layer-panel"][data-surface="planner"]').first();
  await pp.waitFor({ state: "visible", timeout: 20000 }); await sleep(1000);
  return pp;
};
async function zoningOn(pp) {
  for (let i = 0; i < 8; i++) {
    await pp.getByTestId("layer-group-jur").click().catch(() => {}); await sleep(400);
    if (await pp.locator('[data-testid="layer-row-ms_desoto_zoning"]').count()) break;
    await sleep(1500);
  }
  const cb = pp.locator('[data-testid="layer-row-ms_desoto_zoning"] input[type="checkbox"]').first();
  if (!(await cb.count())) return false;
  if (!(await cb.isChecked())) await cb.check();
  await sleep(1500);
  await pp.locator('[data-testid="layer-row-ms_desoto_zoning-menu"], [data-testid="layer-row-ms_desoto_zoning"] button[aria-expanded]').first().click().catch(() => {});
  return true;
}
try {
  await page.goto(BASE + "/?planyrDiag=1#/site", { waitUntil: "domcontentloaded" }); // a page with the Supabase client before inserting
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.pfSupabase, null, { timeout: 60000 });

  if (want("labels") || want("pdf")) {
    console.log("── LABELS + PDF (planner, the owner's view)");
    const plan = mk("labels", 34.95, -89.83);
    plan.parcels[0].points = [{ x: -900, y: -900 }, { x: 900, y: -900 }, { x: 900, y: 900 }, { x: -900, y: 900 }]; plan.els[0] = { ...plan.els[0], w: 1600, h: 60 }; // a ~75-acre lot with a long thin building: the exported frame (fitted to the building) is ~1,600 ft wide, so it shows several zoning polygons above and below the strip
    await insert(plan);
    await page.addInitScript(() => { window.__svgBlobs = []; const o = URL.createObjectURL.bind(URL); URL.createObjectURL = (b) => { try { if (b && /svg/.test(b.type || "")) window.__svgBlobs.push(b); } catch (_) { /* capture only */ } return o(b); }; });
    await openPlan(plan);
    const pp = await plannerPanel();
    check("labels · Zoning is offered and turned on", await zoningOn(pp));
    await pp.locator('[data-testid="layer-row-ms_desoto_zoning-menu"], [data-testid="layer-row-ms_desoto_zoning"] button[aria-expanded]').first().click().catch(() => {}); // close the dropdown for a clean map picture
    await sleep(9000);
    const lab = await page.evaluate(() => [...document.querySelectorAll(".leaflet-tooltip.pf-zone-label")].map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent.trim(), x: r.left, y: r.top, w: r.width, h: r.height }; }));
    console.log(`  zone labels on screen: ${lab.length} (${[...new Set(lab.map((l) => l.t))].join(" | ")})`);
    if (lab.length < 2) voidRun("known-good arm: fewer than two zone-code labels on screen at the owner's view — nothing to judge");
    let overlaps = 0;
    for (let i = 0; i < lab.length; i++) for (let j = i + 1; j < lab.length; j++) { const a = lab[i], b = lab[j]; if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) overlaps++; }
    check("labels · no two zone codes overlap", overlaps === 0, `${overlaps} overlapping pairs of ${lab.length}`);
    await page.screenshot({ path: `${SHOTS}/5-map-labels-owner-view.png` });
    if (want("pdf")) {
      await page.locator('button:has-text("File ▾")').first().click({ timeout: 8000 });
      await page.locator('button:has-text("Download PDF / pick frame")').first().click({ timeout: 8000 }); await sleep(900);
      await page.locator('button:has-text("Continue ➜")').first().click({ timeout: 8000 }).catch(() => {});
      await page.waitForSelector('[data-testid="print-compose"]', { timeout: 20000 }); await sleep(4000);
      const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 90000 }), page.getByRole("button", { name: "Download PDF", exact: true }).click({ timeout: 8000 })]);
      const pdfPath = `${SHOTS}/6-export.pdf`; await dl.saveAs(pdfPath);
      const drawn = await page.evaluate(async () => { const out = []; for (const b of window.__svgBlobs || []) { const t = await b.text(); const d = new DOMParser().parseFromString(t, "image/svg+xml"); d.querySelectorAll("text").forEach((e) => out.push(e.textContent.trim())); } return out; });
      const onScreen = new Set(lab.map((l) => l.t));
      const codes = drawn.filter((t) => /^[A-Z][A-Z0-9\-]{0,5}$/.test(t) && onScreen.has(t));
      console.log(`  the export drew ${drawn.length} text items; zone codes: ${[...new Set(codes)].join(" | ") || "none"}`);
      check("pdf · the export draws the zone codes that show on screen (PDF-PARITY)", codes.length >= 1, `${codes.length}`);
      try { execFileSync("pdftoppm", ["-png", "-r", "110", "-f", "1", "-l", "1", pdfPath, `${SHOTS}/6-export-page`]); console.log(`  rendered the exported page to ${SHOTS}/6-export-page-1.png`); } catch (e) { console.log("  (pdftoppm unavailable — open", pdfPath, "to look at it)"); }
    }
  }
} finally {
  for (const id of planIds) { const r = await cleanupLive(page, { planId: id }); check(`throwaway plan ${id.slice(-8)} deleted and verified gone`, !r.errors.length && r.left.site === 0, JSON.stringify(r)); }
  await s.browser?.close?.();
}
console.log(voided ? `\nVOID (${voided} void note(s)) — not a pass.` : failed ? `\n${failed} check(s) FAILED.` : "\nAll checks passed.");
process.exit(voided || failed ? 1 : 0);
