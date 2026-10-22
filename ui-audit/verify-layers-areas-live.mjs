/* verify-layers-areas-live — B2436066 (Imagery & Layers NEW-3): a Houston-area source is listed only where it serves, and the planner
 * and the map finder give the SAME Flood & Drainage rows for the same point.
 *
 *   node ui-audit/verify-layers-areas-live.mjs [http://localhost:5199]                local dev/preview, seeded located plans
 *   E2E_LOGIN_KEY=… node ui-audit/verify-layers-areas-live.mjs https://planyr.io --expect-sha <sha>
 *                                                         LIVE, signed in as the test account, on throwaway LOCATED plans it deletes (and verifies gone)
 *
 * For each point (Grand Port · Houston downtown · Baytown, Harris side · Katy inside BKDD · Sugar Land · Texas City) it makes a throwaway plan
 * AT that point with NO county stored (the state of a plan whose identify has not resolved — the state the bug lives in), opens the planner's
 * Flood & Drainage pane, then points the finder's map at the same coordinates and reads its pane. Asserts the expected rows per point and
 * planner === finder. Known-good arm: downtown Houston must list the Houston rows (an empty answer there would mean the instrument, not the
 * rule, is dead). Live mode reads /version.json in the SAME call as the assertions. FOREGROUND-OR-VOID asserted first. */
import { assertMeasurable } from "./lib/tabTiming.mjs";

const args = process.argv.slice(2);
const base = args.find((a) => /^https?:/.test(a)) || "http://localhost:5199";
const live = !/localhost|127\.0\.0\.1/.test(base);
const expectSha = args.includes("--expect-sha") ? args[args.indexOf("--expect-sha") + 1] : null;
let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };

const POINTS = [
  { key: "grandPort", label: "Grand Port (Chambers · Baytown ETJ)", lat: 29.807276, lon: -94.877079, want: { hcfcd: false, bkdd: false, coh: false } },
  { key: "downtown", label: "Houston downtown (known-good arm)", lat: 29.7604, lon: -95.3698, want: { hcfcd: true, bkdd: false, coh: true } },
  { key: "baytown", label: "Baytown, Harris side (outside Houston)", lat: 29.74, lon: -94.97, want: { hcfcd: true, bkdd: false, coh: false } },
  { key: "katy", label: "Katy (inside BKDD)", lat: 29.779, lon: -95.895, want: { hcfcd: false, bkdd: true, coh: false } },
  { key: "sugarLand", label: "Sugar Land (Fort Bend)", lat: 29.5994, lon: -95.6349, want: { hcfcd: false, bkdd: false, coh: false } },
  { key: "texasCity", label: "Texas City (Galveston)", lat: 29.40, lon: -94.935, want: { hcfcd: false, bkdd: false, coh: false } },
];
const stamp = Math.random().toString(36).slice(2, 7);
const siteFor = (p) => ({
  schemaVersion: 12, id: `zz-areas-${p.key}-${stamp}`, groupId: `zz-areas-${p.key}-${stamp}`, site: `zz areas ${p.key}`, name: "Plan 1", origin: { lat: p.lat, lon: p.lon }, county: null, status: "active",
  parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: 1320, y: 0 }, { x: 1320, y: 1320 }, { x: 0, y: 1320 }], active: true, z: 0 }],
  underlay: null, sheetOverlays: [], parcelDrawings: [], settings: {}, els: [], measures: [], markups: [], callouts: [], updatedAt: Date.now(), data: { status: "active" },
});
const SITES = Object.fromEntries(POINTS.map((p) => [p.key, siteFor(p)]));

let page, close;
if (live) {
  const { openSignedIn } = await import("./lib/signedInSession.mjs");
  const s = await openSignedIn({ base, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
  page = s.page; close = () => s.close();
  console.log("signed in as", s.proof.email);
} else {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.PW_CHROME || undefined });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  page = await ctx.newPage();
  const seed = Object.fromEntries(Object.values(SITES).map((s) => [s.id, s]));
  await page.addInitScript((j) => { try { localStorage.setItem("planarfit:sites:v1", j); window.__PLANYR_E2E = true; } catch (_) {} }, JSON.stringify(seed));
  await page.route(/\.(jpg|jpeg|png|webp)(\?|$)/, (r) => r.abort());
  close = () => browser.close();
}

const floodRows = async (panel) => {
  await panel.getByTestId("layer-group-flood").click();
  await panel.page().waitForTimeout(700);
  return panel.evaluate((p) => [...p.querySelectorAll('[data-testid="layer-pane"] [data-testid^="layer-row-"]')].filter((r) => !r.getAttribute("data-testid").endsWith("-menu")).map((r) => (r.querySelector("label span[title]") || r).textContent.trim()));
};
const classify = (rows) => ({ hcfcd: rows.includes("Channels & ROW"), bkdd: ["Watersheds & BFE", "Drainage Easements", "Master Plan Floodplains"].every((n) => rows.includes(n)), coh: rows.includes("Storm Sewer") });

try {
  await assertMeasurable(page, "verify-layers-areas-live");
  if (live) {
    const v = await page.evaluate(async () => (await fetch("/version.json", { cache: "no-store" })).json());
    console.log("served build:", v.build);
    if (expectSha) check("served build matches the merge commit", String(v.build).startsWith(expectSha.slice(0, 7)), `${v.build} vs ${expectSha}`);
    const ins = await page.evaluate(async (sites) => {
      const { data: u } = await window.pfSupabase.auth.getUser();
      const errs = [];
      for (const site of sites) {
        const row = { id: site.id, group_id: site.groupId, site: site.site, name: site.name, county: site.county, updated_at: new Date().toISOString(), data: site, user_id: u.user.id };
        let r = await window.pfSupabase.from("sites").insert(row);
        if (r.error && /user_id/.test(String(r.error.message))) { delete row.user_id; r = await window.pfSupabase.from("sites").insert(row); }
        if (r.error) errs.push(String(r.error.message));
      }
      return errs;
    }, Object.values(SITES));
    check("throwaway LOCATED plans written to the test account", ins.length === 0, ins.join(" | "));
  }
  await page.setViewportSize({ width: 1280, height: 860 });
  for (const p of POINTS) {
    const site = SITES[p.key];
    await page.goto(`${base}/#/project/${site.id}/site`, { waitUntil: "load" });
    if (live) await page.reload({ waitUntil: "load" });
    await page.getByTestId("planner-canvas").waitFor({ timeout: 45000 });
    await page.waitForTimeout(1800);
    const chip = page.getByTestId("layers-expand").filter({ visible: true });
    if (await chip.count()) await chip.first().click();
    const pp = page.locator('[data-testid="layer-panel"][data-surface="planner"]').first();
    await pp.waitFor({ state: "visible", timeout: 20000 });
    const plannerRows = await floodRows(pp);

    await page.goto(`${base}/#/site-planner`, { waitUntil: "load" });
    if (live) await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => !!window.__mapFinderMap, null, { timeout: 30000 });
    await page.evaluate(([lat, lon]) => window.__mapFinderMap.setView([lat, lon], 14, { animate: false }), [p.lat, p.lon]);
    await page.waitForTimeout(1200);
    const fchip = page.getByTestId("finder-layers-expand").filter({ visible: true });
    if (await fchip.count()) await fchip.first().click();
    const fp = page.locator('[data-testid="layer-panel"][data-surface="finder"]').first();
    await fp.waitFor({ state: "visible", timeout: 20000 });
    const finderRows = await floodRows(fp);

    const got = classify(plannerRows);
    check(`${p.label}: HCFCD ${p.want.hcfcd ? "shows" : "absent"} · BKDD ${p.want.bkdd ? "shows" : "absent"} · City of Houston storm ${p.want.coh ? "shows" : "absent"} (planner)`, JSON.stringify(got) === JSON.stringify(p.want), JSON.stringify(plannerRows));
    check(`${p.label}: the planner and the finder list the SAME Flood & Drainage rows`, JSON.stringify(plannerRows) === JSON.stringify(finderRows), JSON.stringify({ plannerRows, finderRows }));
  }
} finally {
  if (live) {
    const gone = await page.evaluate(async (ids) => {
      try {
        for (const k of Object.keys(localStorage)) {
          if (!/^planarfit:sites:/.test(k)) continue;
          try { const m = JSON.parse(localStorage.getItem(k) || "{}"); let ch = false; for (const id of ids) if (m && m[id]) { delete m[id]; ch = true; } if (ch) localStorage.setItem(k, JSON.stringify(m)); } catch (_) {}
        }
        for (const id of ids) { await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id); await window.pfSupabase.from("sites").delete().eq("id", id); }
        const q = await window.pfSupabase.from("sites").select("id").in("id", ids);
        return { cloud: !(q.data && q.data.length), left: (q.data || []).length };
      } catch (e) { return { error: String(e) }; }
    }, Object.values(SITES).map((s) => s.id)).catch((e) => ({ error: String(e) }));
    check("throwaway plans deleted and verified gone", !!gone.cloud, JSON.stringify(gone));
  }
  await close();
}
console.log(failed ? `FAIL (${failed})` : "PASS");
process.exit(failed ? 1 : 0);
