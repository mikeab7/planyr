/* verify-raster-error-live — B2671263 / B2671264 on a REAL deploy, signed in as the throwaway test account (V2671259).
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-raster-error-live.mjs [https://planyr.io] [--expect-sha <merge sha>]
 *
 * Arms (browser-side route stubs only; nothing is written, nothing to clear):
 *  A  FEMA Flood Zones on, its /export held ~1.8 s then answered 500, the row switched OFF while held → no `removeLayer` page error.
 *  B  same failing image with the row LEFT ON (the proxy→direct swap removes the first layer under its pending image) → no page error.
 *  C  the zoom-tracker race: queue a state-outline frame, map.remove() (Leaflet deletes _mapPane), let the frame run → no `_leaflet_pos`.
 * VOID unless: the held /export was really requested (A and B), the outline layer drew on a live map (C), and the SERVED chunks carry the
 * guard (`__planyrRasterGuard`) — the build is read in the same call as each reading (AGENT-RULES). FOREGROUND-OR-VOID asserted first. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { setLayer } from "../e2e/lib/layersPanel.js";

const args = process.argv.slice(2);
const base = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const expectSha = args.includes("--expect-sha") ? args[args.indexOf("--expect-sha") + 1] : null;
let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };
const buildNow = (page) => page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).then((j) => j.build).catch(() => null));

const s = await openSignedIn({ base });
const { page } = s;
const errors = [];
page.on("pageerror", (e) => errors.push(String((e && e.message) || e)));
const held = { n: 0 };
try {
  await assertMeasurable(page, "verify-raster-error-live");
  console.log("signed in as", s.proof.email, "| fixture visible", s.proof.fixtureVisible);
  check("signed in as the test account", s.proof.email === "e2e@planyr.test" && s.proof.fixtureVisible);

  await page.addInitScript(() => { try { window.__PLANYR_E2E = true; } catch (_) {} });
  await page.route(/\/export\?/, async (r) => { held.n++; await new Promise((res) => setTimeout(res, 1800)); await r.fulfill({ status: 500, contentType: "text/plain", headers: { "access-control-allow-origin": "*" }, body: "boom" }).catch(() => {}); });
  const openFinder = async () => {
    await page.goto(`${base}/?cb=${Date.now()}#/site-planner`, { waitUntil: "load" });
    await page.waitForFunction(() => !!window.__mapFinderMap, null, { timeout: 45000 });
    await page.evaluate(() => window.__mapFinderMap.setView([29.76, -95.37], 15, { animate: false }));
    await page.waitForTimeout(1200);
    const chip = page.getByTestId("finder-layers-expand").filter({ visible: true });
    if (await chip.count()) await chip.first().click();
    await page.locator('[data-testid="layer-panel"][data-surface="finder"]').first().waitFor({ state: "visible", timeout: 25000 });
  };

  await openFinder();
  const served = await buildNow(page);
  // --expect-sha takes the SERVED build (or a prefix of it); ancestry of the merge commit in that build is `git merge-base --is-ancestor <merge> <served>`.
  if (expectSha) check("served build is the expected build (read in the same call)", String(served || "").startsWith(expectSha.slice(0, 7)), `served ${served} · expected ${expectSha.slice(0, 7)}`);
  // The guard is in the SERVED code (else the arms below prove nothing about this deploy).
  const guardServed = await page.evaluate(async () => {
    const urls = performance.getEntriesByType("resource").map((e) => e.name).filter((u) => /\.js(\?|$)/.test(u));
    for (const u of urls) { try { const t = await (await fetch(u)).text(); if (t.includes("__planyrRasterGuard")) return u.split("/").pop(); } catch (_) {} }
    return null;
  });
  check("the served chunks carry the raster error guard", !!guardServed, guardServed || "marker not found");

  // A — row switched off while the image is held
  await setLayer(page, "fema", true, { surface: "finder" });
  const t0 = Date.now(); while (held.n === 0 && Date.now() - t0 < 20000) await page.waitForTimeout(250);
  check("arm A: the layer's /export was in flight (else VOID)", held.n > 0, `held ${held.n}`);
  await setLayer(page, "fema", false, { surface: "finder" });
  await page.waitForTimeout(3500);
  check("arm A: no `removeLayer` page error after the late failure", errors.filter((m) => /removeLayer|of null/.test(m)).length === 0, errors.join(" | "));

  // B — row left on; the failed image swaps the layer under its pending image
  await openFinder(); const nB = held.n;
  await setLayer(page, "fema", true, { surface: "finder" });
  const t1 = Date.now(); while (held.n === nB && Date.now() - t1 < 20000) await page.waitForTimeout(250);
  check("arm B: the layer's /export was in flight (else VOID)", held.n > nB);
  await page.waitForTimeout(3500);
  check("arm B: no `removeLayer` page error", errors.filter((m) => /removeLayer|of null/.test(m)).length === 0, errors.join(" | "));

  // C — queued outline frame after map.remove()
  await openFinder();
  await page.evaluate(() => window.__mapFinderMap.setView([31, -97], 6, { animate: false }));
  await page.waitForFunction(() => { const p = document.querySelector(".leaflet-adminboundaries-pane"); return !!(p && p.__adminBoundaries); }, null, { timeout: 45000 });
  const drew = await page.evaluate(async () => { const p = document.querySelector(".leaflet-adminboundaries-pane"); await new Promise((r) => setTimeout(r, 1500)); p.__adminBoundaries.drawSync(performance.now()); return p.dataset.levels || ""; });
  check("arm C: the outline layer draws on a live map (else VOID)", drew !== "", drew);
  const pane = await page.evaluate(async () => { const m = window.__mapFinderMap, p = document.querySelector(".leaflet-adminboundaries-pane"); p.__adminBoundaries.sync(); m.remove(); await new Promise((r) => setTimeout(r, 500)); return typeof m._mapPane; });
  check("arm C: the map really lost its pane (precondition)", pane === "undefined");
  check("arm C: no `_leaflet_pos` page error from the queued frame", errors.filter((m) => /_leaflet_pos/.test(m)).length === 0, errors.join(" | "));
  console.log("final served build:", await buildNow(page).catch(() => "?"));
} catch (e) { failed++; console.log("❌ harness error:", e && e.message ? e.message : e); }
finally { await s.close(); }
console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
