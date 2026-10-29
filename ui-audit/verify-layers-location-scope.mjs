/* verify-layers-location-scope — B2476064-class (NEW-1, owner 2026-10-29): a layer is offered ONLY where its source serves.
 *
 *   node ui-audit/verify-layers-location-scope.mjs [http://localhost:5199]          local dev/preview, seeded located plans
 *   E2E_LOGIN_KEY=… node ui-audit/verify-layers-location-scope.mjs https://planyr.io [--expect-sha <sha>]
 *                                                                                    LIVE, signed in as the test account, throwaway LOCATED plans (deleted, verified gone)
 *
 * For a point in Tennessee, Kentucky (a state the app has no region for) and Houston it opens the REAL Imagery & Layers card on BOTH
 * surfaces (the planner on a located plan, the map finder with the map moved there), reads every row in every group, and asserts:
 *   · Tennessee / Kentucky: NO Texas-only row (Oil & Gas Wells · Road Ownership · School Districts · Leaking Petroleum Tanks · Traffic Counts),
 *     and a Pipelines row IS offered (the approximate national one) — never nothing.
 *   · Houston (known-good arm): the Texas rows ARE listed, so an empty answer elsewhere is not an empty registry. A run whose Houston arm fails is VOID.
 *   · the planner and the finder list the SAME rows for the SAME point.
 * FOREGROUND-OR-VOID asserted first. Live mode reads /version.json in the same call as the assertions. */
import { assertMeasurable } from "./lib/tabTiming.mjs";

const args = process.argv.slice(2);
const base = args.find((a) => /^https?:/.test(a)) || "http://localhost:5199";
const live = !/localhost|127\.0\.0\.1/.test(base);
const expectSha = args.includes("--expect-sha") ? args[args.indexOf("--expect-sha") + 1] : null;
let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };

const POINTS = {
  nashville: { lat: 36.1627, lon: -86.7816, label: "Nashville, TN" },
  louisville: { lat: 38.2527, lon: -85.7585, label: "Louisville, KY" },
  houston: { lat: 29.7604, lon: -95.3698, label: "Houston, TX" },
};
const TAG = Math.random().toString(36).slice(2, 7);
const mkSite = (key, p) => ({
  schemaVersion: 12, id: `zz-scope-${key}-${TAG}`, groupId: `zz-scope-${key}-${TAG}`, site: `zz Layer scope ${p.label}`, name: "Plan 1",
  origin: { lat: p.lat, lon: p.lon }, county: null, status: "active",
  parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: 1320, y: 0 }, { x: 1320, y: 1320 }, { x: 0, y: 1320 }], active: true, z: 0 }],
  underlay: null, sheetOverlays: [], parcelDrawings: [], settings: {}, els: [], measures: [], markups: [], callouts: [],
  updatedAt: Date.now(), data: { status: "active" },
});
const SITES = Object.fromEntries(Object.entries(POINTS).map(([k, p]) => [k, mkSite(k, p)]));

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
  await page.addInitScript((j) => { try { localStorage.setItem("planarfit:sites:v1", j); window.__PLANYR_E2E = true; } catch (_) {} },
    JSON.stringify(Object.fromEntries(Object.values(SITES).map((s) => [s.id, s]))));
  await page.route(/\.(jpg|jpeg|png|webp)(\?|$)/, (r) => r.abort());
  close = () => browser.close();
}

const rowLabels = (scope) => scope.evaluate((root) => [...root.querySelectorAll('[data-testid^="layer-row-"]')]
  .filter((r) => !r.getAttribute("data-testid").endsWith("-menu"))
  .map((r) => (r.querySelector("label span[title]") || r.querySelector("label") || r).textContent.trim()));
const groupKeys = (scope) => scope.evaluate((root) => {
  const nav = root.querySelector('[data-testid="layer-group-nav"]');
  if (nav) return [...nav.querySelectorAll("[data-testid^='layer-group-']")].map((b) => b.getAttribute("data-testid").replace("layer-group-", "")).filter((k) => !k.startsWith("count-"));
  const sel = root.querySelector('[data-testid="layer-group-select"]');
  return sel ? [...sel.options].map((o) => o.value) : [];
});
async function allRows(panel) {
  const out = [];
  for (const k of await groupKeys(await panel.elementHandle())) {
    if (k === "base") continue;
    const btn = panel.getByTestId(`layer-group-${k}`);
    if (await btn.count()) await btn.click(); else await panel.getByTestId("layer-group-select").selectOption(k);
    await page.waitForTimeout(150);
    out.push(...(await rowLabels(await panel.elementHandle())));
  }
  return out.sort();
}

const TX_ONLY = ["Road Ownership", "School Districts", "Oil & Gas Wells", "Leaking Petroleum Tanks", "Traffic Counts", "Water & Sewer", "Active Surface Faults", "Channels & ROW"];
const cleanup = [];
try {
  await assertMeasurable(page, "verify-layers-location-scope");
  if (live) {
    const v = await page.evaluate(async () => (await fetch("/version.json", { cache: "no-store" })).json());
    console.log("served build:", v.build);
    if (expectSha) check("served build matches the merge commit", String(v.build).startsWith(expectSha.slice(0, 7)), `${v.build} vs ${expectSha}`);
    for (const site of Object.values(SITES)) {
      const ins = await page.evaluate(async (s) => {
        const { data: u } = await window.pfSupabase.auth.getUser();
        const row = { id: s.id, group_id: s.groupId, site: s.site, name: s.name, county: s.county, updated_at: new Date().toISOString(), data: s, user_id: u.user.id };
        let r = await window.pfSupabase.from("sites").insert(row);
        if (r.error && /user_id/.test(String(r.error.message))) { delete row.user_id; r = await window.pfSupabase.from("sites").insert(row); }
        return r.error ? String(r.error.message) : null;
      }, site);
      cleanup.push(site.id);
      check(`throwaway LOCATED plan written (${site.site})`, !ins, ins || "");
    }
  }
  await page.setViewportSize({ width: 1280, height: 860 });

  const seen = {};
  for (const [key, p] of Object.entries(POINTS)) {
    // ── planner ──
    await page.goto(`${base}/#/project/${SITES[key].id}/site`, { waitUntil: "load" });
    if (live) await page.reload({ waitUntil: "load" });
    await page.getByTestId("planner-canvas").waitFor({ timeout: 45000 });
    await page.waitForTimeout(2200);
    const chip = page.getByTestId("layers-expand").filter({ visible: true });
    if (await chip.count()) await chip.first().click();
    const pp = page.locator('[data-testid="layer-panel"][data-surface="planner"]').first();
    await pp.waitFor({ state: "visible", timeout: 20000 });
    await page.waitForTimeout(700); // the service-area geometry arrives by a dynamic import
    const planner = await allRows(pp);
    // ── finder ──
    await page.goto(`${base}/#/site-planner`, { waitUntil: "load" });
    if (live) await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(2200);
    await page.waitForFunction(() => !!window.__mapFinderMap, null, { timeout: 30000 });
    await page.evaluate(([la, lo]) => window.__mapFinderMap.setView([la, lo], 14, { animate: false }), [p.lat, p.lon]);
    await page.waitForTimeout(1200);
    const fchip = page.getByTestId("finder-layers-expand").filter({ visible: true });
    if (await fchip.count()) await fchip.first().click();
    const fp = page.locator('[data-testid="layer-panel"][data-surface="finder"]').first();
    await fp.waitFor({ state: "visible", timeout: 20000 });
    await page.waitForTimeout(500);
    const finder = await allRows(fp);
    seen[key] = { planner, finder };
    console.log(`${p.label}: ${planner.length} planner rows, ${finder.length} finder rows`);
  }

  // known-good arm: Houston lists the Texas rows, on both surfaces — otherwise the elsewhere-answers prove nothing
  for (const s of ["planner", "finder"]) {
    const h = seen.houston[s];
    check(`${s} · Houston (known-good arm): the Texas rows ARE listed`, ["Road Ownership", "Oil & Gas Wells", "Pipelines"].every((n) => h.includes(n)), JSON.stringify(h));
    if (!["Road Ownership", "Oil & Gas Wells", "Pipelines"].every((n) => h.includes(n))) { console.log("VOID: the known-good arm failed"); failed++; }
  }
  for (const key of ["nashville", "louisville"]) {
    for (const s of ["planner", "finder"]) {
      const rows = seen[key][s];
      const leaked = TX_ONLY.filter((n) => rows.some((x) => x.startsWith(n)));
      check(`${s} · ${POINTS[key].label}: no Texas-only row is offered`, leaked.length === 0, leaked.join(", ") || `${rows.length} rows`);
      check(`${s} · ${POINTS[key].label}: the national Pipelines row IS offered`, rows.includes("Pipelines"), JSON.stringify(rows.filter((x) => /Pipe/.test(x))));
    }
    check(`${POINTS[key].label}: planner and finder list the same rows`, JSON.stringify(seen[key].planner) === JSON.stringify(seen[key].finder),
      JSON.stringify({ plannerOnly: seen[key].planner.filter((x) => !seen[key].finder.includes(x)), finderOnly: seen[key].finder.filter((x) => !seen[key].planner.includes(x)) }));
  }
} finally {
  if (live && cleanup.length) {
    const gone = await page.evaluate(async (ids) => {
      try {
        for (const k of Object.keys(localStorage)) {
          if (!/^planarfit:sites:/.test(k)) continue;
          try { const m = JSON.parse(localStorage.getItem(k) || "{}"); let ch = false; for (const id of ids) if (m && m[id]) { delete m[id]; ch = true; } if (ch) localStorage.setItem(k, JSON.stringify(m)); } catch (_) {}
        }
        for (const id of ids) { await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id); await window.pfSupabase.from("sites").delete().eq("id", id); }
        const q = await window.pfSupabase.from("sites").select("id").in("id", ids);
        return { remaining: (q.data || []).length };
      } catch (e) { return { error: String(e) }; }
    }, cleanup).catch((e) => ({ error: String(e) }));
    check("throwaway plans deleted and verified gone", gone.remaining === 0, JSON.stringify(gone));
  }
  await close();
}
console.log(failed ? `FAIL (${failed})` : "PASS");
process.exit(failed ? 1 : 0);
