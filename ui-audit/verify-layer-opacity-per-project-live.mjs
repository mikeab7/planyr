/* verify-layer-opacity-per-project-live — V1929392 (B2448033), LIVE, signed in as the test account.
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-layer-opacity-per-project-live.mjs https://planyr.io [--expect-sha <merge commit>]
 *
 * A layer's opacity belongs to the PROJECT. On a THROWAWAY project with two located plans (A, B) plus a plan in a DIFFERENT project (C), written to the
 * test account and deleted + verified gone at the end (owner rule 15):
 *   1. set FEMA to 60% on plan A → the SERVER row (get_project_layer_opacity) holds {fema: 0.6} — read through the real RPC;
 *   2. the device copy is WIPED and the page reloaded → plan A still reads 60% (the value came from the server, not this browser);
 *   3. open sibling plan B of the same project, device copy wiped → 60% (and its own on/off is untouched: FEMA is not switched on by A);
 *   4. open plan C of another project → the layer's default;
 *   5. change it on B → plan A (device copy wiped, reloaded) sees B's value: one value per project.
 * The served build (/version.json) is read IN THE SAME CALL as the assertions. FOREGROUND-OR-VOID asserted first. */
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:/.test(a)) || "https://planyr.io").replace(/\/$/, "");
const expectSha = args.includes("--expect-sha") ? args[args.indexOf("--expect-sha") + 1] : null;
let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };

const T = "zz-opacity-" + Math.random().toString(36).slice(2, 8);
const G1 = T + "-proj1", G2 = T + "-proj2";
const mk = (id, group, name) => ({
  schemaVersion: 12, id, groupId: group, site: group === G1 ? "zz Opacity project one" : "zz Opacity project two", name,
  origin: { lat: 29.77938, lon: -95.89503 }, county: null, status: "active",
  parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: 1320, y: 0 }, { x: 1320, y: 1320 }, { x: 0, y: 1320 }], active: true, z: 0 }],
  underlay: null, sheetOverlays: [], parcelDrawings: [], settings: {}, els: [], measures: [], markups: [], callouts: [],
  updatedAt: Date.now(), data: { status: "active" },
});
const PLANS = { A: mk(T + "-a", G1, "Concept A"), B: mk(T + "-b", G1, "Concept B"), C: mk(T + "-c", G2, "Elsewhere") };
const panelSel = '[data-testid="layer-panel"][data-surface="planner"]';

const s = await openSignedIn({ base, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
const page = s.page;
console.log("signed in as", s.proof.email);
try {
  await assertMeasurable(page, "verify-layer-opacity-per-project-live");
  const v = await page.evaluate(async () => (await fetch("/version.json", { cache: "no-store" })).json());
  console.log("served build:", v.build);
  if (expectSha) check("served build matches the merge commit", String(v.build).startsWith(expectSha.slice(0, 7)), `${v.build} vs ${expectSha}`);

  const ins = await page.evaluate(async (plans) => {
    const { data: u } = await window.pfSupabase.auth.getUser();
    const errs = [];
    for (const site of Object.values(plans)) {
      const row = { id: site.id, group_id: site.groupId, site: site.site, name: site.name, county: site.county, updated_at: new Date().toISOString(), data: site, user_id: u.user.id };
      let r = await window.pfSupabase.from("sites").insert(row);
      if (r.error && /user_id/.test(String(r.error.message))) { delete row.user_id; r = await window.pfSupabase.from("sites").insert(row); }
      if (r.error) errs.push(String(r.error.message));
    }
    return errs;
  }, PLANS);
  check("throwaway project (two plans) + a plan in another project written to the test account", !ins.length, ins.join("; "));

  const serverRow = (id) => page.evaluate(async (i) => { const r = await window.pfSupabase.rpc("get_project_layer_opacity", { p_site_id: i }); return r.error ? "ERR " + r.error.message : JSON.stringify(r.data); }, id);

  /* Open a plan: pick the plan through the remembered current plan, optionally wipe the device copy so the value MUST come from the server. */
  const open = async (key, { wipeMirror = true } = {}) => {
    const plan = PLANS[key];
    await page.goto(`${base}/#/project/${plan.groupId}/site`, { waitUntil: "load" });
    await page.evaluate(([id, wipe]) => { localStorage.setItem("planarfit:currentSite:v1", id); if (wipe) for (const k of Object.keys(localStorage)) if (k.startsWith("planyr:layerOpacity:")) localStorage.removeItem(k); }, [plan.id, wipeMirror]);
    await page.reload({ waitUntil: "load" });
    await page.getByTestId("planner-canvas").waitFor({ timeout: 45000 });
    await page.waitForTimeout(2500);
    const chip = page.getByTestId("layers-expand").filter({ visible: true });
    if (await chip.count()) await chip.first().click();
    await page.locator(panelSel).first().waitFor({ state: "visible", timeout: 30000 });
    await page.waitForTimeout(600);
  };
  const femaMenu = async () => {
    const panel = page.locator(panelSel).first();
    let row = panel.getByTestId("layer-row-fema");
    if (!(await row.count())) {
      const keys = await panel.locator('[data-testid="layer-group-nav"] button[role="tab"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid").replace("layer-group-", "")));
      for (const k of keys) { await panel.getByTestId(`layer-group-${k}`).click(); if (await row.count()) break; }
    }
    const menu = row.getByTestId("layer-row-fema-menu");
    if (!(await menu.count())) await row.getByTestId("layer-caret-fema").click();
    return { row, menu };
  };
  const pct = async () => (await femaMenu()).menu.locator('input[type="text"]').first().inputValue();
  const pctSettles = async (want, ms = 20000) => { const t0 = Date.now(); let p = ""; while (Date.now() - t0 < ms) { p = await pct(); if (p === want) return p; await page.waitForTimeout(700); } return p; };
  const femaOn = () => page.evaluate(() => (window.__plannerLayers?.().on || []).includes("fema"));

  // 1 — set 60% on plan A
  await open("A");
  const defaultPct = await pct();
  check("plan A: FEMA starts at its own default (not 60)", defaultPct !== "60", defaultPct);
  await (await femaMenu()).menu.locator('input[type="text"]').first().fill("60");
  await page.waitForTimeout(3000); // past the trailing write
  const row1 = await serverRow(PLANS.A.id);
  check("the SERVER's project row holds fema 0.6 (read through get_project_layer_opacity)", row1 === JSON.stringify({ fema: 0.6 }), row1);
  check("the sibling plan sees the same project row (B resolves to the same value)", (await serverRow(PLANS.B.id)) === row1);
  check("the other project's row is untouched (C reads empty)", (await serverRow(PLANS.C.id)) === "{}");

  // 2 — reload plan A with the device copy wiped: the value comes from the server
  await open("A");
  check("plan A after a reload with the device copy wiped → 60%", (await pctSettles("60")) === "60");

  // 3 — sibling plan B of the same project
  await open("B");
  check("sibling plan B (same project, device copy wiped) → 60%", (await pctSettles("60")) === "60");
  check("…and its on/off is its own: FEMA is not switched on by plan A's change", (await femaOn()) === false);

  // 4 — a plan in another project
  await open("C");
  const pc = await pctSettles(defaultPct, 8000);
  check("a plan in a DIFFERENT project stays at the default", pc === defaultPct, `${pc} vs ${defaultPct}`);

  // 5 — change on B → A sees it
  await open("B");
  await (await femaMenu()).menu.locator('input[type="text"]').first().fill("35");
  await page.waitForTimeout(3000);
  await open("A");
  check("a change made on plan B shows on plan A (one value per project)", (await pctSettles("35")) === "35");
} finally {
  const gone = await page.evaluate(async ([ids, id0]) => {
    try {
      // return the project rows to empty (the client has no delete door on the table), then delete the plans
      await window.pfSupabase.rpc("set_project_layer_opacity", { p_site_id: id0, p_patch: { fema: null } });
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith("planyr:layerOpacity:")) localStorage.removeItem(k);
        if (!/^planarfit:sites:/.test(k)) continue;
        try { const m = JSON.parse(localStorage.getItem(k) || "{}"); let ch = false; for (const i of ids) if (m && m[i]) { delete m[i]; ch = true; } if (ch) localStorage.setItem(k, JSON.stringify(m)); } catch (_) {}
      }
      for (const i of ids) { await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", i); await window.pfSupabase.from("sites").delete().eq("id", i); }
      const q = await window.pfSupabase.from("sites").select("id").in("id", ids);
      return { cloud: !(q.data && q.data.length) };
    } catch (e) { return { error: String(e) }; }
  }, [Object.values(PLANS).map((p) => p.id), PLANS.A.id]).catch((e) => ({ error: String(e) }));
  check("throwaway plans deleted and verified gone", !!gone.cloud, JSON.stringify(gone));
  await s.close();
}
console.log(failed ? `FAIL (${failed})` : "PASS");
process.exit(failed ? 1 : 0);
