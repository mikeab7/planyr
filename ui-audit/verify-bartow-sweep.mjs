/* verify-bartow-sweep — NEW-1 / NEW-2 / NEW-3 (Bartow sweep, 2026-11-12): Bartow zoning district names + Ordinance link, the county water & sewer lines, and the USACE Allatoona Lake rows,
 * on the REAL map finder over real Bartow ground.
 *
 *   node ui-audit/verify-bartow-sweep.mjs [http://localhost:4173]                 local `vite preview` (the /gis-proxy relay is stood in with planyr.io's own)
 *   E2E_LOGIN_KEY=… node ui-audit/verify-bartow-sweep.mjs https://planyr.io --expect-sha <sha>     LIVE: signed in as the test account (nothing is written to the account)
 *
 * ARMS (each prints ✅/❌; the run is VOID — exit 2, never 0 — if the browser cannot reach a layer's host, or the tab is not foreground):
 *   LISTING  Allatoona rows are listed on the Cherokee shore and at Gerdau (Bartow) and NOT at Savannah, Griffin or Houston; Bartow zoning is listed at Gerdau and NOT on the Cherokee shore.
 *   CARD     for each case the row is turned on over a point INSIDE a known feature (found from the service itself, not guessed), the service answers 200, something draws, and a REAL map
 *            click opens a card carrying the expected plain words: the I-2 polygon (case RZ-342-89) reads "I-2 — Heavy Industrial District" with an Ordinance link to the county's PDF; the Allatoona
 *            Business Center polygon reads "I-1 — General Industrial District", the county code "I1 (wC) — with conditions" and its case ARZ-2450-21; a BPD polygon reads "BP — Business Park
 *            District"; a water main and a sewer main read "<size> <material> … main" with the county-department-only scope; a shoreline polygon reads "Federal project land (USACE Allatoona
 *            Lake)" with the Corps-permit rule; the lake reads "Allatoona Lake … normal pool".
 *   KNOWN-GOOD  the "Incorporated" arm: a Cartersville/Adairsville polygon still reads "Inside a city" with NO Ordinance link — the instrument can see a card that must NOT carry one.
 *   NO-FREEZE  the page keeps answering rAF and no task passes the budget while each row draws.
 * Live mode reads /version.json in the SAME call as the assertions. FOREGROUND-OR-VOID asserted first. */
import { assertMeasurable } from "./lib/tabTiming.mjs";

const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:/.test(a)) || "http://localhost:4173").replace(/\/$/, "");
const live = !/localhost|127\.0\.0\.1/.test(base);
const expectSha = args.includes("--expect-sha") ? args[args.indexOf("--expect-sha") + 1] : null;
const LONG_TASK_BUDGET_MS = Number(process.env.BARTOW_LONG_TASK_MS || 1500);
let failed = 0, voided = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };

const AGOL = "https://services2.arcgis.com/sdTb0lsRURdKFejG/arcgis/rest/services/SAD_Shoreline_Management_Web_Viewer/FeatureServer";
const COUNTY = "/gis-proxy/www.bartowgis.org/arcgis/rest/services";
/* One case = turn a row on over a feature found by `find` (a service + where), click inside/on it, read the card.
 *  row    the Layers-panel row id (a merged row is its mergeGroup id)    group  the panel group key    needle  a substring of the service URL the row must reach
 *  find   { url, where, kind: "polygon"|"line", pick? }                  zoom   the view the click is made at */
const CASES = [
  { name: "Bartow zoning · an I-2 parcel (RZ-342-89)", row: "ga_bartow_zoning", group: "jur", needle: "BartowZoning/MapServer/0", zoom: 17, find: { url: `${COUNTY}/AGOServices/BartowZoning/MapServer/0`, where: "REZONING='RZ-342-89'", kind: "polygon" },
    expect: [/I-2 — Heavy Industrial District/, /RZ-342-89/], link: /revize\.com\/revize\/bartowga\// },
  { name: "Bartow zoning · Allatoona Business Center I1 (wC)", row: "ga_bartow_zoning", group: "jur", needle: "BartowZoning/MapServer/0", zoom: 17, find: { url: `${COUNTY}/AGOServices/BartowZoning/MapServer/0`, where: "REZONING='ARZ-2450-21'", kind: "polygon" },
    expect: [/I-1 — General Industrial District/, /I1 \(wC\)/, /with conditions/, /ARZ-2450-21/], link: /revize\.com\/revize\/bartowga\// },
  { name: "Bartow zoning · BPD is Business Park", row: "ga_bartow_zoning", group: "jur", needle: "BartowZoning/MapServer/0", zoom: 17, find: { url: `${COUNTY}/AGOServices/BartowZoning/MapServer/0`, where: "STZONECODE='BPD' AND REZONING='ARZ-2065'", kind: "polygon" },
    expect: [/BP — Business Park District/, /BPD/], link: /revize\.com\/revize\/bartowga\// },
  { name: "KNOWN-GOOD · Bartow zoning · Incorporated is a city, no Ordinance link", row: "ga_bartow_zoning", group: "jur", needle: "BartowZoning/MapServer/0", zoom: 17, find: { url: `${COUNTY}/AGOServices/BartowZoning/MapServer/0`, where: "STZONECODE='Incorporated'", kind: "polygon", near: [34.37, -84.93] },
    expect: [/Inside a city/, /city zones this ground/], noLink: true },
  { name: "Bartow water mains", row: "water_sewer", group: "util", needle: "waterdepartmentapp/MapServer/21", zoom: 17, find: { url: `${COUNTY}/Water/waterdepartmentapp/MapServer/21`, where: "SIZE_D='16' AND MAT_D='DIP'", kind: "line", near: [34.24, -84.79] },
    expect: [/16" DIP water main/, /ductile iron/, /Cartersville and Adairsville/] },
  { name: "Bartow sanitary sewer", row: "water_sewer", group: "util", needle: "waterdepartmentapp/MapServer/7", zoom: 17, find: { url: `${COUNTY}/Water/waterdepartmentapp/MapServer/7`, where: "SIZE_D='8' AND FORCEMAIN='N'", kind: "line", near: [34.24, -84.79] },
    expect: [/Sanitary sewer main/, /Gravity main/, /Cartersville and Adairsville/] },
  { name: "Allatoona shoreline allocation", row: "ga_allatoona_shoreline", group: "jur", needle: "SAD_Shoreline_Management_Web_Viewer/FeatureServer/5", zoom: 16, find: { url: `${AGOL}/5`, where: "RPSUID=167791 AND ZONECLASSIFICATION='publicRecreation'", kind: "polygon", near: [34.12, -84.70] },
    expect: [/Federal project land \(USACE Allatoona Lake\)/, /Public recreation/, /Corps permit \(36 CFR 327/, /flowage easements are found on the title/] },
  { name: "Allatoona Lake normal pool", row: "ga_allatoona_lake", group: "jur", needle: "SAD_Shoreline_Management_Web_Viewer/FeatureServer/6", zoom: 13, find: { url: `${AGOL}/6`, where: "RPSUID=167791 AND FEATURENAME='Allatoona Lake'", kind: "polygon" },
    expect: [/Allatoona Lake/, /normal pool/, /Shoreline Allocation/] },
];
const POINTS = [
  { key: "cherokee-shore", label: "Allatoona, Cherokee shore (outside Bartow County)", lat: 34.185, lon: -84.545, expect: { shown: ["ga_allatoona_lake", "ga_allatoona_shoreline"], hidden: ["ga_bartow_zoning"] } },
  { key: "gerdau", label: "Cartersville / Gerdau (Bartow County)", lat: 34.24, lon: -84.79, expect: { shown: ["ga_bartow_zoning", "ga_allatoona_lake", "ga_allatoona_shoreline"], hidden: [] } },
  { key: "savannah", label: "Savannah (outside Bartow and Allatoona)", lat: 32.08, lon: -81.10, expect: { shown: [], hidden: ["ga_bartow_zoning", "ga_allatoona_lake", "ga_allatoona_shoreline"] } },
  { key: "griffin", label: "Griffin (Spalding County)", lat: 33.2468, lon: -84.2641, expect: { shown: [], hidden: ["ga_bartow_zoning", "ga_allatoona_lake", "ga_allatoona_shoreline"] } },
  { key: "houston", label: "Houston (known-good arm: Texas rows still listed)", lat: 29.7604, lon: -95.3698, expect: { shown: [], hidden: ["ga_bartow_zoning", "ga_allatoona_lake", "ga_allatoona_shoreline"] } },
];

let page, close, browser;
const seen = {};
if (live) {
  const { openSignedIn } = await import("./lib/signedInSession.mjs");
  const s = await openSignedIn({ base, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
  page = s.page; close = () => s.close();
  console.log("signed in as", s.proof.email);
} else {
  const { chromium } = await import("@playwright/test");
  const launch = { args: ["--no-sandbox"], executablePath: process.env.PW_CHROME || undefined };
  const proxy = process.env.PW_PROXY || process.env.HTTPS_PROXY || "";
  if (proxy) launch.proxy = { server: proxy, bypass: "localhost,127.0.0.1" };
  browser = await chromium.launch(launch);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await ctx.newPage();
  // `vite preview` has no Cloudflare Functions: stand the /gis-proxy relay in with planyr.io's own (what the app reaches in production)
  await page.route(/\/gis-proxy\//, async (route) => {
    const u = new URL(route.request().url());
    try { const r = await route.fetch({ url: "https://planyr.io" + u.pathname + u.search }); await route.fulfill({ response: r }); } catch (e) { await route.abort(); }
  });
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
  close = () => browser.close();
}
page.on("response", (r) => { const u = r.url(); (seen[u] = seen[u] || []).push(r.status()); });
const reached = (needle) => Object.entries(seen).filter(([u]) => u.includes(needle)).flatMap(([, s]) => s);
const longTaskInit = () => {
  window.__bwLong = { max: 0, n: 0 };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__bwLong.n++; if (e.duration > window.__bwLong.max) window.__bwLong.max = e.duration; } }).observe({ entryTypes: ["longtask"] }); } catch (_) {}
};
const rafAlive = () => page.evaluate(() => new Promise((res) => { const t = setTimeout(() => res(false), 4000); requestAnimationFrame(() => { clearTimeout(t); res(true); }); }));
const drawn = () => page.evaluate(() => ({ paths: document.querySelectorAll(".leaflet-pane svg path").length, canvases: document.querySelectorAll(".leaflet-pane canvas").length, text: document.body.innerText }));

const openFinder = async (lat, lon, zoom) => {
  await page.goto(`${base}/#/site-planner`, { waitUntil: "load" });
  if (live) await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => !!window.__mapFinderMap, null, { timeout: 45000 });
  await page.evaluate(longTaskInit);
  await page.evaluate(([la, lo, z]) => window.__mapFinderMap.setView([la, lo], z, { animate: false }), [lat, lon, zoom]);
  await page.waitForTimeout(1500);
  const chip = page.getByTestId("finder-layers-expand").filter({ visible: true });
  if (await chip.count()) await chip.first().click();
  const fp = page.locator('[data-testid="layer-panel"][data-surface="finder"]').first();
  await fp.waitFor({ state: "visible", timeout: 20000 });
  return fp;
};
const rowIds = async (fp, group) => {
  await fp.getByTestId(`layer-group-${group}`).click();
  await page.waitForTimeout(600);
  return fp.evaluate((p) => [...p.querySelectorAll('[data-testid="layer-pane"] [data-testid^="layer-row-"]')].map((r) => r.getAttribute("data-testid")).filter((t) => !t.endsWith("-menu")).map((t) => t.replace(/^layer-row-/, "")));
};

/* A point INSIDE (polygon) or ON (line) a feature the service itself names — never a guess. Runs in the page (its proxy / relay / CORS). */
const findPoint = (f) => page.evaluate(async ({ url, where, kind, near }) => {
  const qs = new URLSearchParams({ where, outFields: "OBJECTID", returnGeometry: "true", outSR: "4326", resultRecordCount: "40", f: "json" });
  if (near) { // prefer features near a point: an envelope ±0.03°
    qs.set("geometry", `${near[1] - 0.03},${near[0] - 0.03},${near[1] + 0.03},${near[0] + 0.03}`); qs.set("geometryType", "esriGeometryEnvelope"); qs.set("inSR", "4326"); qs.set("spatialRel", "esriSpatialRelIntersects");
  }
  const r = await fetch(`${url}/query?${qs}`); const j = await r.json();
  const feats = j.features || [];
  const inRing = (ring, x, y) => { let c = false; for (let i = 0, k = ring.length - 1; i < ring.length; k = i++) { const [xi, yi] = ring[i], [xk, yk] = ring[k]; if ((yi > y) !== (yk > y) && x < ((xk - xi) * (y - yi)) / (yk - yi) + xi) c = !c; } return c; };
  for (const f of feats) {
    const g = f.geometry; if (!g) continue;
    if (kind === "line") { const p = (g.paths || []).find((pp) => pp.length >= 2); if (!p) continue; const a = p[0], b = p[1]; return { lng: (a[0] + b[0]) / 2, lat: (a[1] + b[1]) / 2, n: feats.length }; }
    const rings = g.rings || []; if (!rings.length) continue;
    const outer = rings.reduce((m, ring) => (ring.length > m.length ? ring : m), rings[0]);
    const xs = outer.map((p) => p[0]), ys = outer.map((p) => p[1]), cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    let best = null;
    for (let i = 0; i <= 40; i++) for (let k = 0; k <= 40; k++) {
      const x = Math.min(...xs) + ((Math.max(...xs) - Math.min(...xs)) * i) / 40, y = Math.min(...ys) + ((Math.max(...ys) - Math.min(...ys)) * k) / 40;
      if (!rings.reduce((c, ring) => (inRing(ring, x, y) ? !c : c), false)) continue;
      const d = Math.hypot(x - cx, y - cy); if (!best || d < best.d) best = { lng: x, lat: y, d };
    }
    if (best) return { lng: best.lng, lat: best.lat, n: feats.length };
  }
  return { error: j.error ? JSON.stringify(j.error) : `no feature (${feats.length} returned)` };
}, f);

const readCard = () => page.evaluate(() => {
  const c = document.querySelector(".leaflet-popup-content");
  return c ? { text: c.innerText, links: [...c.querySelectorAll("a[href]")].map((a) => ({ href: a.href, text: a.textContent })) } : null;
});

try {
  await assertMeasurable(page, "verify-bartow-sweep");
  if (live) {
    const v = await page.evaluate(async () => (await fetch("/version.json", { cache: "no-store" })).json());
    console.log("served build:", v.build);
    if (expectSha) check("served build matches the merge commit", String(v.build).startsWith(expectSha.slice(0, 7)), `${v.build} vs ${expectSha}`);
  }

  /* ---------- LISTING ---------- */
  for (const p of POINTS) {
    console.log(`— LISTING: ${p.label} —`);
    const fp = await openFinder(p.lat, p.lon, 12);
    const all = new Set(await rowIds(fp, "jur"));
    check(`${p.key}: the panel opened and lists rows`, all.size > 0 || p.key === "houston", `${all.size}`);
    for (const id of p.expect.shown) check(`${p.key}: lists ${id}`, all.has(id));
    for (const id of p.expect.hidden) check(`${p.key}: does NOT list ${id}`, !all.has(id));
    if (p.key === "houston") check("known-good arm: Houston still lists Texas Jurisdictions rows (the instrument can see rows)", [...all].some((r) => /^jur_/.test(r)), [...all].slice(0, 6).join(","));
  }

  /* ---------- CARD (+ DRAWS, NO-FREEZE) ---------- */
  for (const C of CASES) {
    if (process.env.BARTOW_ONLY && !C.name.includes(process.env.BARTOW_ONLY)) continue;
    console.log(`— CARD: ${C.name} —`);
    const fp = await openFinder(34.2, -84.7, 11);
    const pt = await findPoint(C.find);
    if (!pt || pt.error) { console.log(`  VOID — could not find a feature to click: ${pt && pt.error}`); voided++; continue; }
    console.log(`  feature found at ${pt.lat.toFixed(5)}, ${pt.lng.toFixed(5)} (${pt.n} returned)`);
    await page.evaluate(([la, lo, z]) => window.__mapFinderMap.setView([la, lo], z, { animate: false }), [pt.lat, pt.lng, C.zoom]);
    await page.evaluate(longTaskInit);
    await page.waitForTimeout(1200);
    await rowIds(fp, C.group);
    const row = fp.getByTestId(`layer-row-${C.row}`);
    if (!(await row.count())) { check(`${C.name}: row ${C.row} present`, false); continue; }
    const before = await drawn();
    const box = row.locator('input[type="checkbox"]').first();
    if (!(await box.isChecked())) await box.check();
    await page.waitForTimeout(9000);
    const after = await drawn();
    const codes = reached(C.needle);
    if (!codes.length) { console.log(`  VOID — the browser never reached ${C.needle}`); voided++; await box.uncheck().catch(() => {}); continue; }
    check(`${C.name}: requested its service and got 200`, codes.some((c) => c === 200), JSON.stringify(codes.slice(0, 5)));
    check(`${C.name}: no failure / "too detailed" state`, !/failed|error/i.test(String(await row.getAttribute("data-layer-state"))) && !/too detailed|layer failed|couldn.t load/i.test(after.text), `state=${await row.getAttribute("data-layer-state")}`);
    check(`${C.name}: DRAWS`, after.paths + after.canvases > before.paths + before.canvases, `${before.paths}p/${before.canvases}c → ${after.paths}p/${after.canvases}c`);
    check(`${C.name}: page still answers and no task over ${LONG_TASK_BUDGET_MS} ms`, (await rafAlive()) && (await page.evaluate(() => window.__bwLong.max)) < LONG_TASK_BUDGET_MS, `longest ${Math.round(await page.evaluate(() => window.__bwLong.max))} ms`);
    // click the feature: the map centre is the point
    const xy = await page.evaluate(([la, lo]) => { const m = window.__mapFinderMap, p = m.latLngToContainerPoint([la, lo]), r = m.getContainer().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; }, [pt.lat, pt.lng]);
    let card = null;
    for (const [dx, dy] of [[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2], [4, 4], [-4, -4]]) {
      await page.mouse.click(xy.x + dx, xy.y + dy);
      await page.waitForTimeout(2500);
      card = await readCard();
      if (card && C.expect.every((re) => re.test(card.text))) break;
    }
    if (!card) { check(`${C.name}: a click opens a card`, false, "no popup"); }
    else {
      for (const re of C.expect) check(`${C.name}: card reads ${re}`, re.test(card.text), JSON.stringify(card.text.slice(0, 260)));
      check(`${C.name}: card shows no raw field names / null`, !/\b(STZONECODE|SIZE_D|MAT_D|FORCEMAIN|ZONECLASSIFICATION|FEATURENAME|RPSUID)\b|\bnull\b|undefined/.test(card.text));
      if (C.link) check(`${C.name}: card carries an Ordinance link to the county PDF`, card.links.some((l) => C.link.test(l.href) && /ordinance/i.test(l.text)), JSON.stringify(card.links));
      if (C.noLink) check(`${C.name}: card carries NO Ordinance link`, !card.links.some((l) => /ordinance/i.test(l.text)), JSON.stringify(card.links));
      if (live || process.env.BARTOW_SHOTS) await page.screenshot({ path: `${process.env.BARTOW_SHOTS || "/tmp"}/bartow-${C.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png` }).catch(() => {});
    }
    await box.uncheck().catch(() => {});
  }
} finally {
  await close();
}
if (voided) { console.log(`VOID (${voided} case(s) could not reach their host or find a feature)`); process.exit(2); }
console.log(failed ? `FAIL (${failed})` : "PASS");
process.exit(failed ? 1 : 0);
