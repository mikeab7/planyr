/* NEW-1 (B2217648) — the map-captured aerial snapshot must NOT show as an "Aerial backdrop" row in the Overlays panel
 * or the View ▾ Overlays list on a located plan, while staying in the data (print fallback, calibration).
 *   node ui-audit/verify-map-snapshot-row.mjs <base>                       local, signed out (vite preview URL)
 *   E2E_LOGIN_KEY=… node ui-audit/verify-map-snapshot-row.mjs https://planyr.io [<commit prefix>] --signed-in
 * Throwaway plans zz-snap-*, deleted at the end (local: storage cleared; signed-in: rows deleted).
 * KNOWN-GOOD ARM (declared VOID if it fails): a fromMap snapshot on a plan with NO origin must still show its row —
 * proves the probe can see a row at all. */
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const base = process.argv[2] || "http://localhost:4173";
const signedIn = process.argv.includes("--signed-in");
const want = process.argv.find((a, i) => i >= 3 && !a.startsWith("--")) || "";
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const ring = [{ x: 0, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 600 }, { x: 0, y: 600 }];
const snap = { id: "legacy-aerial", name: "Aerial backdrop", fromMap: true, src: PNG, x: -200, y: -200, ftPerPx: 600, imgW: 1, imgH: 1, opacity: 1, visible: true, rotation: 0 };
const shot = { id: "zz-shot", name: "dropped screenshot.png", src: PNG, x: 100, y: 100, ftPerPx: 200, imgW: 1, imgH: 1, opacity: 1, visible: true, rotation: 0 };
const G = "zz-snap-g";
const origin = { lat: 29.78, lon: -95.82 };
const mk = (id, name, o) => ({ id, groupId: G, site: "ZZ snapshot row verify", name, origin: o, county: "harris", parcels: [{ id: "p", active: true, points: ring }],
  els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(), ...o && {} });
const PLANS = [
  { ...mk("zz-snap-map", "Map plan", origin), sheetOverlays: [snap] },                       // A: map-created, snapshot only → empty state
  { ...mk("zz-snap-both", "Snapshot plus screenshot", origin), sheetOverlays: [snap, shot] }, // B: snapshot + real overlay → ONE row
  { ...mk("zz-snap-noorigin", "No origin (known-good)", null), sheetOverlays: [snap] },      // C: known-good arm → row visible
];
let failed = false, void_ = false;
const check = (ok, msg) => { console.log((ok ? "PASS " : "FAIL ") + msg); if (!ok) failed = true; };

let s, browser, page, ctx;
try {
  if (signedIn) { s = await openSignedIn({ base, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] }); page = s.page; console.log("served build:", JSON.stringify(s.build)); if (want && !JSON.stringify(s.build).includes(want)) throw new Error(`deployed build lacks ${want}`); }
  else { browser = await chromium.launch({ executablePath: existsSync(chromium.executablePath()) ? undefined : "/opt/pw-browsers/chromium", args: ["--no-sandbox"] }); ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); await ctx.addInitScript(() => { window.__PLANYR_E2E = true; window.__PLANYR_LEGACY_MIRROR = undefined; }); page = await ctx.newPage(); await page.goto(base, { waitUntil: "domcontentloaded" }); }
  await page.evaluate(async ([plans, signed]) => {
    const all = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    for (const r of plans) {
      all[r.id] = r;
      if (signed) { const e = await window.pfSupabase.from("sites").upsert({ id: r.id, group_id: r.groupId, site: r.site, name: r.name, county: "harris", updated_at: new Date().toISOString(), data: r }); if (e.error) throw new Error("seed " + r.id + ": " + e.error.message); }
    }
    localStorage.setItem("planarfit:sites:v1", JSON.stringify(all));
  }, [PLANS, signedIn]);

  const rowsFor = async (id) => {
    await page.evaluate((i) => localStorage.setItem("planarfit:currentSite:v1", i), id);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("module-tab-site-planner").filter({ visible: true }).click().catch(() => {});
    await page.evaluate(([g]) => { window.location.hash = `#/project/${g}/site`; }, [G]);
    await page.getByTestId("planner-canvas").first().waitFor({ state: "visible", timeout: 30000 });
    await pacedWait(page, 1500);
    await assertMeasurable(page, "verify-map-snapshot-row");
    // the project opens its newest plan — switch through the real plan crumb if needed
    const label = PLANS.find((p) => p.id === id).name;
    const here = await page.evaluate(() => (window.__plannerView && 1) || 0);
    void here;
    const crumb = page.getByTestId("plan-crumb").first();
    if (!(await crumb.innerText().catch(() => "")).includes(label)) { await crumb.click(); await page.getByText(label, { exact: true }).last().click(); await pacedWait(page, 2000); }
    await page.locator('[data-rail-tab="references"]').first().click();
    await pacedWait(page, 800);
    const rows = await page.locator('[data-testid^="reference-row-"]').evaluateAll((n) => n.map((e) => ({ id: e.getAttribute("data-testid").replace("reference-row-", ""), name: e.innerText.split("\n")[0] })));
    // Saved state: signed in → the cloud row (the device copy is per-plan keys now, with the whole-library key a lazy mirror — B2165120); signed out → that mirror, which is `sync` under automation.
    const saved = await page.evaluate(async ([i, signed]) => {
      if (signed) { const r = await window.pfSupabase.from("sites").select("o:data->sheetOverlays").eq("id", i).maybeSingle(); return ((r.data && r.data.o) || []).map((o) => o.id); }
      const a = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"); return ((a[i] || {}).sheetOverlays || []).map((o) => o.id);
    }, [id, signedIn]);
    // View ▾ menu rows
    let viewRows = [];
    const vm = page.getByRole("button", { name: /^View/ }).first();
    if (await vm.count()) { await vm.click().catch(() => {}); await pacedWait(page, 300); viewRows = await page.locator('[data-testid^="view-overlay-"]').evaluateAll((n) => n.map((e) => e.getAttribute("data-testid").replace("view-overlay-", ""))); await page.keyboard.press("Escape"); }
    // The hook mounts with the planner and loads the export chunk lazily: retry until it answers (a null is "not ready", never "no aerial").
    let exp = null;
    for (let k = 0; k < 8 && !exp; k++) { exp = await page.evaluate(async () => (window.__plannerExportSvg ? window.__plannerExportSvg() : null)).catch(() => null); if (!exp) await pacedWait(page, 1500); }
    console.log(`  [export ${id}] sheet ${exp ? exp.length : "null"} chars, <image> ${exp ? (exp.match(/<image/g) || []).length : "-"} href ${exp ? ((exp.match(/<image[^>]+href="([^"]{0,28})/) || [])[1] || "?") : "-"}`);
    return { rows, saved, viewRows, exportHasImage: !!exp && /<image\b/.test(exp) }; // the aerial SLOT exists. Signed out the data: snapshot fills it; signed in on a located plan the hook passes no captured frame, so the live-basemap slot carries a placeholder href (logged above) and the real picture is stitched at print time — exportSheet.js is untouched by this change
  };

  const c = await rowsFor("zz-snap-noorigin");
  if (!c.rows.some((r) => r.id === "legacy-aerial")) { void_ = true; console.log("VOID known-good arm: a no-origin snapshot did not render its row — the probe cannot see rows"); }
  else console.log("PASS known-good: no-origin snapshot keeps its row (never orphaned)");

  const a = await rowsFor("zz-snap-map");
  check(a.rows.length === 0, `map-created plan: Overlays list is empty (got ${JSON.stringify(a.rows)})`);
  check(!a.viewRows.includes("legacy-aerial"), `map-created plan: View ▾ Overlays has no Aerial row (got ${JSON.stringify(a.viewRows)})`);
  check(a.saved.includes("legacy-aerial"), "map-created plan: the snapshot record is still SAVED (nothing deleted)");
  check(a.exportHasImage, "map-created plan: the built print sheet still has its aerial image slot (print path untouched)");

  const b = await rowsFor("zz-snap-both");
  check(b.rows.length === 1 && b.rows[0].id === "zz-shot", `snapshot + dropped screenshot: exactly one row, the screenshot (got ${JSON.stringify(b.rows)})`);
  check(b.saved.includes("legacy-aerial") && b.saved.includes("zz-shot"), "snapshot + screenshot: both records still saved");
} catch (e) { console.log("ERROR " + e.message); failed = true; }
finally {
  // Throwaway cleanup, VERIFIED (a delete that did not take is a failure, not a pass): the DB refuses to
  // delete a live row (sites_block_delete_live_group), so trash it first, then delete, then count what is left.
  try {
    if (page && signedIn) {
      const left = await page.evaluate(async (ids) => {
        await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).in("id", ids);
        await window.pfSupabase.from("sites").delete().in("id", ids);
        const a = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"); ids.forEach((i) => delete a[i]); localStorage.setItem("planarfit:sites:v1", JSON.stringify(a));
        const x = await window.pfSupabase.from("sites").select("id").in("id", ids);
        return (x.data || []).length;
      }, PLANS.map((p) => p.id));
      console.log(left === 0 ? "PASS cleanup: throwaway plans deleted and verified gone" : `FAIL cleanup: ${left} throwaway row(s) still present`);
      if (left) failed = true;
    }
  } catch (e) { console.log("FAIL cleanup: " + e.message); failed = true; }
  if (s && s.close) await s.close().catch(() => {}); if (browser) await browser.close();
}
if (void_) { console.log("RUN VOID — not scored"); process.exit(3); }
console.log(failed ? "FAILED" : "ALL PASS"); process.exit(failed ? 1 : 0);
