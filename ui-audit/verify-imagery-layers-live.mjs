/* verify-imagery-layers-live — V1819600 (B2391216): the two-pane Imagery & Layers panel on a real deploy, signed in as the
 * test account (ui-audit/lib/signedInSession.mjs — never a second sign-in).
 *   E2E_LOGIN_KEY=… node ui-audit/verify-imagery-layers-live.mjs [https://planyr.io]
 * Reads /version.json IN THE SAME CALL as the assertions. Read-only: it only toggles layers on the standing e2e fixture site
 * (layer choices are remembered per site; they are put back before it exits). Steps that need live GIS data on a located plan
 * (contour line count, pipeline corridor band) are reported as NOT RUN here — the fixture site has no location.
 */
import { openSignedIn, FIXTURE_SITE_ID } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const base = process.argv[2] || "https://planyr.io";
const out = [];
const check = (name, ok, detail = "") => { out.push({ name, ok: !!ok, detail }); console.log(`${ok ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`); };

const s = await openSignedIn({ base, initScripts: [[() => { window.__PLANYR_E2E = true; }, undefined]] });
const { page } = s;
try {
  await assertMeasurable(page, "verify-imagery-layers-live");
  const live = await page.evaluate(async () => (await fetch("/version.json", { cache: "no-store" })).json());
  console.log("served build:", live.build, "| helper-read build:", JSON.stringify(s.build), "| signed in as", s.proof.email);
  const scripts = await page.evaluate(() => [...document.querySelectorAll("script[src]")].map((e) => e.getAttribute("src")).filter((x) => /assets\//.test(x)).slice(0, 3));
  console.log("chunks:", scripts.join(", "));

  // 1. Map finder: collapsed chip → two-pane card.
  await page.goto(`${base}/#/site-planner`, { waitUntil: "load" });
  await page.waitForTimeout(2500);
  const chip = page.getByTestId("finder-layers-expand").filter({ visible: true });
  if (await chip.count()) await chip.first().click();
  const finder = page.locator('[data-testid="layer-panel"][data-surface="finder"]');
  await finder.waitFor({ state: "visible", timeout: 20000 });
  check("finder: two-pane card (group list + rows)", await finder.getByTestId("layer-group-nav").count() === 1 && await finder.getByTestId("layer-pane").count() === 1);
  check("finder: Map Base first, Sites / Comps / Notes inside it", (await finder.getByTestId("map-show-sites").count()) === 1 && (await finder.getByTestId("map-show-comps").count()) === 1 && (await finder.getByTestId("map-show-notes").count()) === 1);
  check("finder: header has Hide Layers and the ⋯ menu", (await finder.getByTestId("layers-hide-toggle").count()) === 1 && (await finder.getByTestId("layers-more").count()) === 1);
  await page.screenshot({ path: "/tmp/imagery-live-finder.png" });

  // 2. Planner on the fixture site.
  const fixName = await page.evaluate(async (id) => { const q = await window.pfSupabase.from("sites").select("data").eq("id", id).maybeSingle(); return q.data && q.data.data && (q.data.data.site || q.data.data.name); }, FIXTURE_SITE_ID);
  console.log("fixture plan:", fixName);
  await page.getByText(fixName, { exact: false }).first().click();
  await page.getByTestId("planner-canvas").waitFor({ state: "visible", timeout: 30000 });
  await page.waitForTimeout(2000);
  const expand = page.getByTestId("layers-expand").filter({ visible: true });
  if (await expand.count()) await expand.first().click();
  const panel = page.locator('[data-testid="layer-panel"][data-surface="planner"]').first();
  await panel.waitFor({ state: "visible", timeout: 20000 });
  check("planner: same two-pane card", await panel.getByTestId("layer-group-nav").count() === 1);
  const rows = panel.locator('[data-testid^="layer-row-"]');
  const n = await rows.count();
  const tall = await rows.evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height > 40 && !e.querySelector('[data-testid$="-menu"]')).length);
  check("planner: rows are one line (no text under a closed row)", n > 0 && tall === 0, `${n} rows, ${tall} taller than one line`);
  const first = rows.first();
  const id = (await first.getAttribute("data-testid")).replace("layer-row-", "");
  await panel.getByTestId(`layer-caret-${id}`).click();
  check("planner: ▾ opens one inline dropdown", (await panel.locator('[data-testid$="-menu"]').count()) === 1);
  await panel.getByTestId(`layer-caret-${id}`).click();

  // 3. Hide / Show round trip on a row turned on here.
  const before = await page.evaluate(() => window.__plannerLayers && window.__plannerLayers());
  const cb = panel.getByTestId("layer-row-fema").locator('input[type="checkbox"]').first().or(first.locator('input[type="checkbox"]').first());
  const wasOn = await cb.isChecked();
  if (!wasOn) await cb.check({ force: true });
  const hide = panel.getByTestId("layers-hide-toggle");
  await hide.click();
  const hidden = await page.evaluate(() => window.__plannerLayers && window.__plannerLayers());
  check("Hide Layers: nothing drawn, checkbox still checked", hidden && hidden.drawn.length === 0 && (await cb.isChecked()));
  await hide.click();
  const shown = await page.evaluate(() => window.__plannerLayers && window.__plannerLayers());
  check("Show Layers: the same set returns", shown && JSON.stringify([...shown.on].sort()) === JSON.stringify([...hidden.on].sort()) && shown.drawn.length === shown.on.length);
  if (!wasOn) await cb.uncheck({ force: true }); // put the fixture back
  await page.screenshot({ path: "/tmp/imagery-live-planner.png" });
  void before;

  // 6. Reload: the last-selected group is remembered.
  const nav = panel.getByTestId("layer-group-nav");
  const tab = nav.locator('button[role="tab"]').nth(2);
  const tabKey = (await tab.getAttribute("data-testid")).replace("layer-group-", "");
  await tab.click();
  await page.reload({ waitUntil: "load" });
  await page.getByTestId("planner-canvas").waitFor({ state: "visible", timeout: 30000 });
  await page.waitForTimeout(1500);
  const expand2 = page.getByTestId("layers-expand").filter({ visible: true });
  if (await expand2.count()) await expand2.first().click();
  const panel2 = page.locator('[data-testid="layer-panel"][data-surface="planner"]').first();
  await panel2.waitFor({ state: "visible", timeout: 20000 });
  check("reload: last-selected group remembered", (await panel2.getByTestId("layer-pane").getAttribute("data-group")) === tabKey, tabKey);
  console.log("NOT RUN (needs a located plan + live GIS): contour interval line count, pipeline corridor width, Georgia location scope.");
} catch (e) {
  check("run completed", false, e.message);
} finally {
  await s.close();
}
const bad = out.filter((r) => !r.ok);
console.log(bad.length ? `FAIL — ${bad.length} of ${out.length}` : `PASS — ${out.length} checks`);
process.exit(bad.length ? 1 : 0);
