/* verify-state-reaches-live — NEW-1 third review (B2550272, 2026-10-30): the Alabama | Florida | Georgia state-line reaches, on the REAL map finder.
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-state-reaches-live.mjs https://planyr.io [--expect-sha <sha>]    LIVE, signed in as the test account
 *   node ui-audit/verify-state-reaches-live.mjs https://<branch>.planyr.pages.dev --anon                  a PR preview (no test-account key there; the finder needs no sign-in)
 *
 * It moves the finder's map to a point, opens the real Imagery & Layers card and reads every row. The Florida rows (Water Management Districts, Hurricane Evacuation
 * Zones — both declared `states:["FL"]`) are offered ONLY where `siteState` says Florida, so they are the picture of the answer:
 *   · Ono Island AL, Bear Point AL, the Perdido Bay north shore AL, Phenix City AL, Lake Eufaula AL → NO Florida row (the review's regression: they read Florida);
 *   · Perdido Key FL (west end, where Natural Earth says Alabama), Pensacola FL (known-good arm) → the Florida rows ARE listed. A run whose known-good arm fails is VOID.
 * Then, in the same signed-in page, two relayed layers still answer through /gis-proxy with JSON features (Georgia: the Georgia EPD / DNR host; Oklahoma: the OCC host) —
 * the relay's `;` / tile / trailing-dot changes must not have broken a real query.
 * FOREGROUND-OR-VOID asserted first. Reads /version.json in the same call as the assertions. Creates nothing (the finder needs no plan). */
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const args = process.argv.slice(2);
const base = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const expectSha = args.includes("--expect-sha") ? args[args.indexOf("--expect-sha") + 1] : null;
let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };

const FL_ROWS = ["Water Management Districts", "Hurricane Evacuation Zones"];
const POINTS = [
  { key: "pensacola", lat: 30.4213, lon: -87.2169, label: "Pensacola, FL (known-good arm)", want: "FL" },
  { key: "key", lat: 30.292, lon: -87.4785, label: "Perdido Key FL, west end (Natural Earth says Alabama)", want: "FL" },
  { key: "gulf", lat: 30.23, lon: -87.5, label: "Gulf off Perdido Key, east of Alabama Point", want: "FL" },
  { key: "ono", lat: 30.2975, lon: -87.479, label: "Ono Island, AL", want: "AL" },
  { key: "bear", lat: 30.329, lon: -87.515, label: "Bear Point, AL", want: "AL" },
  { key: "bay", lat: 30.346, lon: -87.525, label: "Perdido Bay north shore, AL", want: "AL" },
  { key: "phenix", lat: 32.4709, lon: -85.0008, label: "Phenix City, AL", want: "AL" },
  { key: "eufaula", lat: 31.942, lon: -85.102, label: "Lake Eufaula shore, AL", want: "AL" },
];

const anon = args.includes("--anon");
let s;
if (anon) {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.PW_CHROME || undefined });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const pg = await ctx.newPage();
  await pg.addInitScript(() => { window.__PLANYR_E2E = true; });
  await pg.goto(base + "/", { waitUntil: "load" });
  s = { page: pg, close: () => browser.close(), proof: { email: "(anonymous preview run)" } };
} else s = await openSignedIn({ base, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
const page = s.page;
console.log("signed in as", s.proof.email);
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

try {
  await assertMeasurable(page, "verify-state-reaches-live");
  const v = await page.evaluate(async () => (await fetch("/version.json", { cache: "no-store" })).json());
  console.log("served build:", v.build);
  if (expectSha) check("served build matches the merge commit", String(v.build).startsWith(expectSha.slice(0, 7)), `${v.build} vs ${expectSha}`);
  await page.setViewportSize({ width: 1280, height: 860 });

  const seen = {};
  for (const p of POINTS) {
    await page.goto(`${base}/#/site-planner`, { waitUntil: "load" });
    await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(2200);
    await page.waitForFunction(() => !!window.__mapFinderMap, null, { timeout: 30000 });
    await page.evaluate(([la, lo]) => window.__mapFinderMap.setView([la, lo], 14, { animate: false }), [p.lat, p.lon]);
    await page.waitForTimeout(1200);
    const chip = page.getByTestId("finder-layers-expand").filter({ visible: true });
    if (await chip.count()) await chip.first().click();
    const panel = page.locator('[data-testid="layer-panel"][data-surface="finder"]').first();
    await panel.waitFor({ state: "visible", timeout: 20000 });
    await page.waitForTimeout(500);
    seen[p.key] = await allRows(panel);
    console.log(`${p.label}: ${seen[p.key].length} rows`);
  }

  // known-good arm FIRST: Pensacola must list the Florida rows, or an absence elsewhere proves nothing
  const flHas = (rows) => FL_ROWS.filter((n) => rows.some((x) => x.startsWith(n)));
  const pen = flHas(seen.pensacola);
  check("known-good arm — Pensacola FL lists the Florida rows", pen.length === FL_ROWS.length, JSON.stringify(pen));
  if (pen.length !== FL_ROWS.length) { console.log("VOID: the known-good arm failed — nothing below proves anything"); failed++; }
  for (const p of POINTS.filter((q) => q.key !== "pensacola")) {
    const got = flHas(seen[p.key]);
    if (p.want === "FL") check(`${p.label}: the Florida rows ARE offered`, got.length === FL_ROWS.length, JSON.stringify(got));
    else check(`${p.label}: NO Florida row is offered`, got.length === 0, got.join(", ") || `${seen[p.key].length} rows`);
  }

  // relayed layers still answer (a real query through /gis-proxy, JSON back, features counted)
  const relay = await page.evaluate(async () => {
    const q = async (path) => {
      try {
        const r = await fetch(path, { cache: "no-store" });
        const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (_) {}
        return { status: r.status, type: r.headers.get("content-type"), json: !!j, count: j && (typeof j.count === "number" ? j.count : null), err: j && j.error ? JSON.stringify(j.error).slice(0, 120) : null };
      } catch (e) { return { error: String(e) }; }
    };
    return {
      gaCount: await q("/gis-proxy/maps.itos.uga.edu/arcgis/rest/services/FrameWork/Conservation/MapServer/1/query?where=1%3D1&returnCountOnly=true&f=json"),
      okFolder: await q("/gis-proxy/gis.occ.ok.gov/server/rest/services/Hosted?f=json"),
      okSemicolon: await q("/gis-proxy/gis.occ.ok.gov/server/rest/services/Hosted?f=json;x=1&callback=alert"),
      admin: await q("/gis-proxy/gis.occ.ok.gov/server/admin./rest/services?f=json"),
    };
  });
  console.log("relay probes:", JSON.stringify(relay));
  check("relay · Georgia host (UGA ITOS) answers a feature COUNT through /gis-proxy", relay.gaCount.status === 200 && typeof relay.gaCount.count === "number", JSON.stringify(relay.gaCount));
  check("relay · Oklahoma host (OCC) answers its folder as JSON", relay.okFolder.status === 200 && relay.okFolder.json && !relay.okFolder.err, JSON.stringify(relay.okFolder));
  check("relay · a ';' query with a JSONP callback still answers JSON (callback dropped, not a refusal)", relay.okSemicolon.status === 200 && relay.okSemicolon.json, JSON.stringify(relay.okSemicolon));
  check("relay · a trailing-dot admin path is refused", relay.admin.status === 403, JSON.stringify(relay.admin));
} finally {
  await s.close();
}
console.log(failed ? `FAIL (${failed})` : "PASS");
process.exit(failed ? 1 : 0);
