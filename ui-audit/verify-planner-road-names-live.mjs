/* B2249040 / V1676224 — live signed-in check that road names draw over the aerial on an open site.
 *   E2E_LOGIN_KEY=… node ui-audit/verify-planner-road-names-live.mjs [https://planyr.io] [expectedBuildPrefix]
 * Signs in as the test account (ui-audit/lib/signedInSession.mjs), reads /version.json IN THE SAME CALL as the
 * assertions, opens the e2e fixture site's plan, and checks: labels pane + canvas at street zoom, Road names row
 * + opacity slider in Layers, off/on, opacity, reload persistence, and label-map / aerial registration after a
 * wheel-zoom. Read-only on the fixture; only a device-level localStorage pref is touched (restored at the end). */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
const base = process.argv[2] || "https://planyr.io", want = process.argv[3] || "";
const PANE = "planyrVectorLabels";
const results = []; const ok = (n, c, x = "") => { results.push(!!c); console.log(`${c ? "PASS" : "FAIL"} — ${n}${x ? " :: " + x : ""}`); };
const s = await openSignedIn({ base, viewport: { width: 1440, height: 900 } });
const page = s.page;
console.log("signed in as", s.proof.email, "| build", JSON.stringify(s.build));
if (want) ok(`served build matches ${want}`, JSON.stringify(s.build).includes(want));
// The standing e2e fixture site has NO location (so no aerial). This check creates its own throwaway LOCATED plan the way a
// user does (Drop a pin -> Plan this site), logs its URL, and the session deletes it afterwards (owner rule 15). Fixture untouched.
let planUrl = null;
const openPlan = async () => {
  if (!planUrl) {
    await page.goto(base + "/#/site-planner", { waitUntil: "load" }); await page.waitForTimeout(4000);
    const plan = page.getByRole("button", { name: "Plan this site" });
    const alreadyInPlan = () => page.locator('[data-testid="planner-canvas"]').first().isVisible().catch(() => false);
    // the app reopens the last plan on load; a previous run's throwaway is exactly that, so reuse it
    for (let i = 0; i < 4 && !(await alreadyInPlan()) && !(await plan.isVisible().catch(() => false)); i++) {
      await page.getByRole("button", { name: "Drop a pin" }).click({ timeout: 30000 });
      await page.waitForTimeout(500); await page.mouse.click(720 + i * 40, 500); await page.waitForTimeout(2000);
    }
    if (!(await alreadyInPlan())) await plan.click({ timeout: 15000 });
  } else { await page.goto(planUrl, { waitUntil: "load" }); await page.reload({ waitUntil: "load" }); }
  await page.locator('[data-testid="planner-canvas"]').first().waitFor({ state: "visible", timeout: 45000 });
  if (!planUrl) {
    planUrl = page.url(); console.log("THROWAWAY PLAN URL", planUrl);
    await page.context().addInitScript(() => { window.__PLANYR_E2E = true; }); // read-only map handle; armed for the NEXT load
    await page.reload({ waitUntil: "load" });
    await page.locator('[data-testid="planner-canvas"]').first().waitFor({ state: "visible", timeout: 45000 });
  }
  await page.waitForFunction(() => !!window.__geoMap, null, { timeout: 30000 });
  await assertMeasurable(page, "verify-planner-road-names-live");
};
// Two honest modes: the vector layer (GL canvas in the pane) or, when the vector host is unreachable (the cloud sandbox denies
// tiles.openfreemap.org), the helper's own raster fallback (World_Transportation tiles in the same map, status "failed").
const LABELS_FN = (n) => { const m = window.__geoMap; if (!m) return false; const p = m.getPane(n); const gl = !!(p && p.querySelector("canvas") && m.__vectorLabelsGL);
  const fb = [...m.getContainer().querySelectorAll("img")].some((i) => /World_Transportation/.test(i.src)); return gl ? "vector" : fb ? "fallback-raster" : false; };
const hasLabels = () => page.evaluate(LABELS_FN, PANE);
const waitLabels = () => page.waitForFunction(LABELS_FN, PANE, { timeout: 45000 }).catch(() => {});
let mode = null;
const op = () => page.evaluate((n) => { const p = window.__geoMap.getPane(n); return p ? p.style.opacity : null; }, PANE);
await openPlan();
console.log("chunks", await page.evaluate(() => [...document.querySelectorAll("script[src]")].map((x) => x.src.split("/").pop()).slice(0, 3)));
// street scale: zoom in until the committed zoom reaches the road-name gate
const box = await page.locator('[data-testid="planner-canvas"]').first().boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
for (let i = 0; i < 12 && (await page.evaluate(() => window.__geoMap.getZoom())) < 15; i++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(400); }
await waitLabels();
mode = await hasLabels(); console.log("label mode:", mode);
ok("road names draw at street zoom", !!mode, "zoom " + (await page.evaluate(() => window.__geoMap.getZoom())).toFixed(2));
await page.getByRole("button", { name: /Layers/ }).first().click();
const row = page.getByLabel(/Road names/i).first(), slider = page.getByLabel("Road names opacity");
ok("Road names row + opacity slider in Layers", (await row.isVisible().catch(() => false)) && (await slider.isVisible().catch(() => false)));
await row.uncheck(); await page.waitForTimeout(1500); ok("off removes labels", !(await hasLabels()));
await row.check(); await waitLabels();
ok("on restores labels", await hasLabels());
await slider.fill("0.4"); await page.waitForTimeout(500); ok("slider sets pane opacity 0.4", (await op()) === "0.4", String(await op()));
const reg = () => page.evaluate(() => { const m = window.__geoMap, g = m.__vectorLabelsGL; if (!g) return null; const a = m.project(m.getCenter(), m.getZoom()), b = m.project(g.getCenter(), m.getZoom()); return { px: Math.hypot(a.x - b.x, a.y - b.y), zOff: m.getZoom() - g.getZoom() }; });
await page.mouse.wheel(0, -200); await page.waitForTimeout(1500);
const r = await reg();
if (mode === "vector") ok("labels registered to aerial after a wheel-zoom", r && r.px < 0.75 && Math.abs(r.zOff - 1) < 1e-3, JSON.stringify(r));
else console.log("SKIP — registration arm VOID: vector source unreachable from this sandbox, raster fallback is a plain Leaflet tile layer (registered by Leaflet itself); sandbox e2e covers the GL arm");
await openPlan();
for (let i = 0; i < 12 && (await page.evaluate(() => window.__geoMap.getZoom())) < 15; i++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(400); }
await waitLabels();
ok("after reload: labels back", !!(await hasLabels()));
ok("after reload: opacity pref still 0.4 (device pref)", await page.evaluate(() => JSON.parse(localStorage.getItem("planyr:roadNames") || "{}").opacity === 0.4), await page.evaluate(() => localStorage.getItem("planyr:roadNames")));
await page.evaluate(() => localStorage.removeItem("planyr:roadNames")); // test-device pref only
console.log("page errors:", JSON.stringify(s.errors.slice(0, 3)));
await s.close();
process.exit(results.every(Boolean) ? 0 : 1);
