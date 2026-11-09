#!/usr/bin/env node
/* B329408 / V2115868 — LIVE, SIGNED-IN: after the plan editor, the vendor split and the sign-in panel became lazy chunks, planyr.io still opens a Site
 * plan, the Layers panel, Notes, the Spreadsheet and Food — nothing that was lazy-loaded fails to appear.
 *   E2E_LOGIN_KEY=… node ui-audit/verify-lazy-chunks-live.mjs [https://planyr.io] [expected-build-prefix]
 * The served build (/version.json) is read in the SAME call as the assertions (a stale tab would otherwise vouch for the wrong bundle). */
import { openSignedIn, FIXTURE_SITE_ID } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const base = process.argv[2] || "https://planyr.io";
const wantBuild = process.argv[3] || "";
const stem = (f) => f.replace(/^.*\//, "").replace(/-[A-Za-z0-9_-]{8}\.js$/, "").replace(/\.js$/, "");
const ok = [], fail = [];
const pass = (m) => ok.push(m), bad = (m) => fail.push(m);
const s = await openSignedIn({ base });
const { page, errors } = s;
try {
  await assertMeasurable(page, "verify-lazy-chunks-live");
  const live = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()));
  console.log("served build:", JSON.stringify(live), "| signed in as", s.proof.email);
  if (wantBuild && !String(live.build).startsWith(wantBuild)) bad(`served build ${live.build} is not the expected ${wantBuild} — the checks below would vouch for the wrong bundle`);
  const fetched = () => page.evaluate(() => performance.getEntriesByType("resource").map((e) => e.name).filter((n) => /\/assets\/.*\.js/.test(n)));
  const scripts = async () => [...new Set((await fetched()).map(stem))];

  /* 1 — a plan deep link, cold: modulepreload + canvas + no errors. Find the fixture's group id from the signed-in session. */
  const gid = await page.evaluate(async (id) => {
    const q = await window.pfSupabase.from("sites").select("id,group_id,data").eq("id", id).limit(1);
    const r = q.data && q.data[0]; return r ? ((r.data && r.data.groupId) || r.group_id || r.id) : null;
  }, FIXTURE_SITE_ID);
  if (!gid) bad("step 1: could not resolve the fixture site's group id");
  await page.goto(`${base}/#/project/${gid || FIXTURE_SITE_ID}/site`);
  await page.reload({ waitUntil: "load" });
  const pre = await page.evaluate(() => [...document.querySelectorAll('link[rel="modulepreload"]')].map((l) => l.href));
  /\/SitePlanner-/.test(pre.join(" ")) ? pass("1: the page head carries a modulepreload for SitePlanner-*.js on a plan deep link") : bad("1: no modulepreload for the plan editor chunk on a plan deep link");
  try { await page.locator('[data-mode="plan"][data-mode-active="true"] svg').first().waitFor({ state: "visible", timeout: 60_000 }); pass("1: the plan canvas is visible"); }
  catch (e) { bad("1: the plan canvas never appeared: " + String(e).split("\n")[0]); }

  /* 2 — Layers panel */
  try {
    await page.locator('[data-mode="plan"] [aria-label*="Layers"]').first().click({ timeout: 20_000 });
    await page.locator('[data-testid="layer-panel"]').first().waitFor({ state: "visible", timeout: 20_000 });
    pass("2: the Imagery & Layers panel opens inside the lazy editor");
    (await scripts()).includes("LayerPanel") ? pass("2: the LayerPanel chunk was fetched") : bad("2: LayerPanel chunk not seen in the resource log");
  } catch (e) { bad("2: Layers panel did not open: " + String(e).split("\n")[0]); }

  /* 4 — to the map and back into the plan */
  try {
    await page.goto(`${base}/#/site`);
    await page.waitForFunction(() => /\/site\/?$|#\/site/.test(location.hash) && !!document.querySelector('[data-testid="map-sites-panel"], [data-testid="map-layers-panel"], .leaflet-container'), null, { timeout: 45_000 });
    pass("4: the Site map is showing");
  } catch (e) { bad("4: the Site map never showed: " + String(e).split("\n")[0]); }
  try {
    await page.goto(`${base}/#/project/${gid || FIXTURE_SITE_ID}/site`);
    await page.locator('[data-mode="plan"][data-mode-active="true"] svg').first().waitFor({ state: "visible", timeout: 45_000 });
    pass("4: back into the plan from the map mounts the editor");
  } catch (e) { bad("4: back into the plan failed: " + String(e).split("\n")[0]); }

  /* 5 — Notes */
  try {
    await page.goto(`${base}/#/notes`);
    await page.locator('[data-testid="notes-tree"], [data-notes-root], [aria-label*="Notes"]').first().waitFor({ state: "visible", timeout: 45_000 });
    pass("5: the Notes workspace renders");
  } catch (e) { bad("5: Notes did not render: " + String(e).split("\n")[0]); }

  /* 6 — Spreadsheet: a project's workbook, then the bare route (B2671203: it used to show the error card) */
  for (const [label, hash] of [["project", `#/project/${gid || FIXTURE_SITE_ID}/spreadsheet`], ["bare route", "#/spreadsheet"]]) {
    try {
      await page.goto(`${base}/${hash}`);
      await page.reload({ waitUntil: "load" });
      await page.waitForFunction(() => document.querySelectorAll("canvas").length > 0 || /couldn.t load/.test(document.body.innerText), null, { timeout: 90_000 });
      const crashed = await page.evaluate(() => /Spreadsheet hit an error/.test(document.body.innerText));
      crashed ? bad(`6 (${label}): the Spreadsheet shows its error card`) : pass(`6 (${label}): the Spreadsheet renders (no error card)`);
    } catch (e) { bad(`6 (${label}): Spreadsheet did not render: ` + String(e).split("\n")[0]); }
  }

  /* 7 — Food: no geo-vendor in a fresh Food-only load */
  {
    const food = await s.context.newPage();
    const seen = []; food.on("request", (r) => { if (/\/assets\/.*\.js/.test(r.url())) seen.push(stem(r.url())); });
    await food.goto(`${base}/#/food`, { waitUntil: "load" });
    try { await food.locator('input[type="search"], input[placeholder*="earch"], .leaflet-container').first().waitFor({ state: "visible", timeout: 45_000 }); pass("7: Food renders its map/search"); }
    catch (e) { bad("7: Food did not render: " + String(e).split("\n")[0]); }
    seen.includes("geo-vendor") ? bad("7: Food still fetched geo-vendor (clipper/esri-leaflet)") : pass("7: Food did not fetch geo-vendor");
    await food.close();
  }
  if (errors.length) bad("uncaught page errors: " + errors.slice(0, 4).join(" | ")); else pass("no uncaught page errors across the run");
} finally { await s.close(); }
console.log("\nB329408 live (signed in) — lazy chunk verification\n");
for (const o of ok) console.log("  ✓ " + o);
for (const f of fail) console.log("  ✗ " + f);
console.log(fail.length ? `\n✗ ${fail.length} failure(s)` : "\n✓ all checked assertions hold");
process.exit(fail.length ? 1 : 0);
