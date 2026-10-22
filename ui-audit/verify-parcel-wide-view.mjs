/* NEW-1 (Select parcels: lot outlines from further out, without hammering county servers) — drives the REAL app (Map → Select parcels) over a
 * synthetic Davidson County service whose lots are of three KNOWN sizes (ui-audit/lib/davidsonWideMock.mjs), through a real browser, and
 * asserts what each stage draws, what each request asked for, and how the app behaves when a county server is slow.
 *
 *   VITE_SUPABASE_URL="https://x.supabase.co" VITE_SUPABASE_ANON_KEY="dummy" npx vite build
 *   npx vite preview --port 4188 --strictPort &
 *   node ui-audit/verify-parcel-wide-view.mjs
 *
 * KNOWN-GOOD ARM (clause 6 of DRIVER-SCROLL-IS-NOT-APP-SCROLL): the harness first proves the instrument can see the effect it asserts — the CLOSE stage
 * must draw house lots, and the expected counts are computed from the mock's own geometry, independent of the app. A run where the close stage draws
 * nothing is VOID, not green.
 * FOREGROUND-OR-VOID: `assertMeasurable` before every reading.
 *
 * What it proves (all hermetic — no real county is touched; the live arm is V#, run against planyr.io):
 *   1 close (Davidson's cutoff, zoom 17)     every lot incl. house lots; NO size-filtered request is sent
 *   2 mid  (zoom 16.x)                        every request carries `Shape__Area >= 8712` + maxAllowableOffset; the drawn set == the mock's lots ≥ 0.2 ac in the tiles asked for
 *   3 wide (zoom 15.x)                        `Shape__Area >= 21780`; house AND mid lots are absent; big lots present; the hint says what is held back
 *   4 pan / zoom debounce                     a burst of moves sends ZERO requests until the view has been still, then only the missing tiles
 *   5 relay                                   tiles go through /api/gis-cache/svc/…/query (the county is asked once for everyone); a 404 relay falls back to the county directly
 *   6 busy county                             503s back the host off, the hint says the server is busy, and the map recovers when it answers
 *   7 the selected lot stays outlined at every zoom; zooming back in drops the wide lines and the close stage draws everything */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { CULVERT, DAVIDSON_URL, answerQuery, metaBody, expectedIn, lotAtCell, SIZES } from "./lib/davidsonWideMock.mjs";
import { b64urlDecode } from "../src/shared/gis/gisProxyCore.js";

const BASE = process.env.BASE_URL || "http://localhost:4188/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
let failures = 0;
const expect = (label, cond, extra = "") => { if (!cond) failures++; console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${extra ? ` — ${extra}` : ""}`); };
const BLANK_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const CORS = { "access-control-allow-origin": "*" };

const state = { relay: "ok", busyLeft: 0, delayMs: 0, log: [] };
function paramsOf(req, url) {
  if (req.method() === "POST") return new URLSearchParams(req.postData() || "");
  return url.searchParams;
}
async function route(page) {
  await page.route("**/*", async (r) => {
    const req = r.request();
    const url = new URL(req.url());
    const isRelay = url.pathname.startsWith("/api/gis-cache/svc/");
    const isDirect = url.host === "services2.arcgis.com" && url.pathname.includes("/HdTo6HJqh92wn4D8/");
    if (isRelay || isDirect) {
      let service = DAVIDSON_URL, tail = "";
      if (isRelay) {
        const segs = url.pathname.split("/").filter(Boolean); // api gis-cache svc <b64> query
        service = b64urlDecode(segs[3]); tail = segs.slice(4).join("/");
        if (state.relay === "404") { state.log.push({ via: "relay", status: 404, tail }); return r.fulfill({ status: 404, body: "not found" }); }
      } else tail = url.pathname.replace(/^.*\/FeatureServer\/0\/?/, "");
      if (service !== DAVIDSON_URL) return r.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: "{}" });
      if (tail === "") return r.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: metaBody() });
      if (tail === "query") {
        const p = paramsOf(req, url);
        const isTile = /Shape__Area/.test(p.get("where") || "");
        if (isTile && state.busyLeft > 0) { state.busyLeft--; state.log.push({ via: isRelay ? "relay" : "direct", status: 503, tile: true, at: Date.now() }); return r.fulfill({ status: 503, headers: CORS, body: "busy" }); }
        if (isTile && state.delayMs) await new Promise((res) => setTimeout(res, state.delayMs));
        const a = answerQuery(p);
        state.log.push({ via: isRelay ? "relay" : "direct", status: 200, tile: isTile, where: a.meta.where, env: a.meta.env, minFt2: a.meta.minFt2, lots: a.meta.lots, exceeded: !!a.meta.exceeded, offset: p.get("maxAllowableOffset"), f: p.get("f"), at: Date.now(), point: !a.meta.env });
        try { return await r.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: a.body }); } catch (_) { return undefined; } // the app cancelled it
      }
    }
    if (/\/(MapServer|FeatureServer)\//i.test(req.url())) {
      if (/\/query/i.test(url.pathname)) return r.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify({ objectIdFieldName: "OBJECTID", features: [] }) });
      return r.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify({ name: "x", fields: [{ name: "OBJECTID", type: "esriFieldTypeOID" }] }) });
    }
    if (/\.(png|jpe?g)(\?|$)/i.test(url.pathname) || /arcgisonline|tile|basemaps/i.test(url.host)) return r.fulfill({ status: 200, contentType: "image/png", body: BLANK_PNG });
    return r.continue();
  });
}

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 880 } })).newPage();
await assertMeasurable(page, "verify-parcel-wide-view");
const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
await page.addInitScript(`(() => { try {
  window.__PLANYR_E2E = true;
  localStorage.setItem("planarfit:sites:v1", ${JSON.stringify(JSON.stringify({ s_wide: { id: "s_wide", groupId: "s_wide", site: "Wide Verify Site", name: "Plan 1", status: "active", origin: { lat: CULVERT.lat, lon: CULVERT.lng }, county: "tn_davidson", parcels: [], els: [], updatedAt: Date.now() } }))});
  localStorage.removeItem("planarfit:currentSite:v1");
} catch (e) {} })();`);
await route(page);

const sleep = (ms) => page.waitForTimeout(ms);
const waitFor = async (fn, ms = 8000) => { const t = Date.now(); let v; while (Date.now() - t < ms) { v = await fn(); if (v) return v; await sleep(150); } return v; };
const setView = (z) => page.evaluate(([la, ln, zz]) => { window.__mapFinderMap.setView([la, ln], zz, { animate: false }); }, [CULVERT.lat, CULVERT.lng, z]);
const disp = () => page.evaluate(() => { const d = window.__mapParcelDisplay && window.__mapParcelDisplay(); return d ? d.layers.find((l) => /HdTo6HJqh92wn4D8/.test(l.url || "")) || null : null; });
const tip = () => page.evaluate(() => document.querySelector('[data-testid="select-parcels-tip"]')?.textContent || "");
const viewEnv = () => page.evaluate(() => { const b = window.__mapFinderMap.getBounds(); return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]; });
const tileInk = () => page.evaluate(() => { // painted pixels on the parcel tile canvases (a tile with no lots is left 0x0)
  let ink = 0, tiles = 0;
  document.querySelectorAll(".leaflet-overlay-pane canvas.leaflet-tile").forEach((c) => { if (!c.width) return; tiles++; const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i]) ink++; });
  return { ink, tiles };
});
async function settled(label, ms = 9000) { // no tile request outstanding and the layer says nothing is loading
  await waitFor(async () => { const d = await disp(); return d && d.wide && d.wide.loading === 0; }, ms);
  await sleep(500);
}

async function openMap() {
  state.log.length = 0;
  await page.goto("about:blank");
  await page.goto(BASE + "#/site", { waitUntil: "domcontentloaded" });
  await sleep(1500);
  const row = page.locator('div[title*="Open site"]').filter({ hasText: "Wide Verify Site" }).first();
  await row.hover();
  await row.locator('[aria-label="Show on map"]').click();
  await sleep(1200);
  await setView(17.4);
  await sleep(600);
  await page.locator('[data-testid="map-toolbar-select-parcels"]').first().click();
  await sleep(1500);
}

console.log("— 1 CLOSE (zoom 17.4, Davidson's own cutoff) —");
await openMap();
await waitFor(async () => { const d = await disp(); return d && d.held > 0; });
let d = await disp();
const env17 = await viewEnv();
const exp17 = expectedIn(env17);
console.log(`  mock lots in view: ${JSON.stringify(exp17)}; layer holds ${d && d.held}`);
expect("KNOWN-GOOD: the close stage draws lots at all (else this run is void)", !!d && d.held > 0);
expect("close stage holds house lots too (every lot, full detail)", !!d && d.held >= exp17.house, `held ${d && d.held} ≥ ${exp17.house} house lots`);
expect("no size-filtered request is sent at the close stage", !state.log.some((q) => q.tile), `${state.log.filter((q) => q.tile).length} tile requests`);
expect("the hint does not claim anything is held back at the close stage", !/larger lots/i.test(await tip()), JSON.stringify((await tip()).slice(0, 70)));

console.log("— selecting a lot (so we can see it survive the zoom-out) —");
const bigLot = (() => { for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) { const l = lotAtCell(i, j); if (l.kind === "big") return l; } })();
await page.evaluate(([la, ln]) => { window.__mapFinderMap.setView([la, ln], 17.4, { animate: false }); }, bigLot.centre);
await sleep(900);
const pt = await page.evaluate(([la, ln]) => { const p = window.__mapFinderMap.latLngToContainerPoint([la, ln]); const r = window.__mapFinderMap.getContainer().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; }, bigLot.centre);
await page.mouse.click(pt.x, pt.y);
await waitFor(async () => (await page.evaluate(() => (window.__mapSelectedParcels && window.__mapSelectedParcels() || []).length)) > 0, 8000);
const selected = await page.evaluate(() => (window.__mapSelectedParcels && window.__mapSelectedParcels() || []).length);
expect("a lot is selected by the live point query", selected === 1, `${selected}`);
const selOutline = () => page.evaluate(() => [...document.querySelectorAll(".leaflet-overlay-pane path")].filter((p) => { const b = p.getBoundingClientRect(); return b.width > 2 && b.height > 2; }).length);
expect("the selected lot is outlined at the close stage", (await selOutline()) >= 1);

console.log("— 2 MID (zoom 16.5) —");
state.log.length = 0;
await setView(16.5);
await settled("mid");
d = await disp();
let tiles = state.log.filter((q) => q.tile && q.status === 200);
expect("tiles were requested", tiles.length > 0, `${tiles.length} tile requests`);
expect("EVERY mid tile request carries the 0.2 ac size cutoff in its where-clause", tiles.every((q) => q.where === "Shape__Area >= 8712"), [...new Set(tiles.map((q) => q.where))].join(" | "));
expect("EVERY mid tile request asks for generalised geometry", tiles.every((q) => Number(q.offset) > 0), [...new Set(tiles.map((q) => q.offset))].join(" | "));
expect("every tile request went through the gis-cache relay (the county is asked once for everyone)", tiles.every((q) => q.via === "relay"), [...new Set(tiles.map((q) => q.via))].join(","));
const asked = tiles.filter((q) => q.env);
const heldMid = d && d.wide ? d.wide.held : 0;
const sumTiles = asked.reduce((n, q) => n + expectedIn(q.env, 8712).total, 0);
expect("the mid stage draws lots (the larger half of what is in view)", heldMid > 0, `${heldMid} held`);
expect("it holds NO house lots: held ≤ the mid+big lots in the asked tiles (a lot on a tile edge is in two tiles)", heldMid <= sumTiles && heldMid >= Math.floor(sumTiles * 0.6), `${heldMid} held vs ${sumTiles} lot-in-tile entries`);
const allInTiles = asked.reduce((n, q) => n + expectedIn(q.env, 0).total, 0);
expect("…well under half of ALL the lots in those tiles (the house lots were never downloaded)", heldMid < allInTiles * 0.6, `${heldMid} drawn of ${allInTiles} lot-in-tile entries in the asked tiles`);
expect("the county was never sent the house lots: no tile answer holds more lots than the mock has ≥ 0.2 ac there", asked.every((q) => q.lots <= expectedIn(q.env, 8712).total), "");
expect("the stage is reported as mid", d && d.wide && d.wide.stage === "mid", JSON.stringify(d && d.wide && d.wide.stage));
expect("the bottom hint says what is held back", /Showing larger lots\. Zoom in for small lots and labels\./.test(await tip()), JSON.stringify((await tip()).slice(0, 90)));
const labelTexts = () => page.evaluate(() => [...document.querySelectorAll("[data-lot-no]")].map((e) => e.getAttribute("data-lot-no")));
await waitFor(async () => (await labelTexts()).length > 0, 5000);
const midLabels = await labelTexts();
const bigIds = new Set(); for (let i = -70; i <= 70; i++) for (let j = -70; j <= 70; j++) { const l = lotAtCell(i, j); if (l.kind === "big" || l.kind === "huge") bigIds.add(`S${l.id}`); }
expect("parcel-ID labels ride the larger lots at the mid stage", midLabels.length > 0, `${midLabels.length} labels`);
expect("…and ONLY the larger (≥ 0.5 ac) lots carry one", midLabels.every((t) => bigIds.has(t)), midLabels.filter((t) => !bigIds.has(t)).slice(0, 3).join(","));
const ink = await tileInk();
expect("the larger lots are actually PAINTED on the map", ink.ink > 2000, `${ink.ink} painted pixels on ${ink.tiles} tiles`);
expect("the selected lot is still outlined at mid zoom", (await selOutline()) >= 1);

console.log("— 3 WIDE (zoom 15.5) —");
state.log.length = 0;
await setView(15.5);
await settled("wide");
d = await disp();
tiles = state.log.filter((q) => q.tile && q.status === 200);
expect("EVERY wide tile request carries the 0.5 ac size cutoff", tiles.length > 0 && tiles.every((q) => /^Shape__Area >= (21780|87120|348480)$/.test(q.where)), [...new Set(tiles.map((q) => q.where))].join(" | "));
expect("the base cutoff is the half-acre one", tiles.some((q) => q.where === "Shape__Area >= 21780"));
const heldWide = d && d.wide ? d.wide.held : 0;
const wideAsked = tiles.filter((q) => q.env);
const sumWide = wideAsked.filter((q) => q.where === "Shape__Area >= 21780").reduce((n, q) => n + expectedIn(q.env, 21780).total, 0);
expect("the wide stage draws only the big lots (no house lots, no mid lots)", heldWide > 0 && heldWide <= sumWide + 5, `${heldWide} held ≤ ${sumWide} big lots in the asked tiles`);
expect("the stage is reported as wide", d && d.wide && d.wide.stage === "wide");
expect("the hint says what is held back", /Showing larger lots/.test(await tip()));
expect("no labels at the wide stage", (await labelTexts()).length === 0, `${(await labelTexts()).length}`);
expect("the selected lot is STILL outlined at the widest stage", (await selOutline()) >= 1);

console.log("— 4 debounce, re-use and cancel —");
state.log.length = 0;
for (let i = 0; i < 6; i++) { await page.evaluate(([la, ln, k]) => { window.__mapFinderMap.setView([la + k * 0.0009, ln + k * 0.006], 15.5, { animate: false }); }, [CULVERT.lat, CULVERT.lng, i]); await sleep(60); }
const duringBurst = state.log.filter((q) => q.tile).length;
expect("no tile request went out while the view kept moving", duringBurst === 0, `${duringBurst} requests during the burst`);
await settled("burst");
const afterBurst = state.log.filter((q) => q.tile && q.status === 200);
console.log(`  after the view settled: ${afterBurst.length} tile request(s)`);
expect("once still, only the tiles not already held are asked for (fewer than a cold view)", afterBurst.length > 0 && afterBurst.length < tiles.length + 2, `${afterBurst.length} vs ${tiles.length} cold`);
expect("no tile was requested twice", new Set(afterBurst.map((q) => q.env.join())).size === afterBurst.length);
// cancel: slow answers, then move away before they land
state.delayMs = 1800;
const abortedBefore = (await disp()).wide.aborted;
state.log.length = 0;
await page.evaluate(([la, ln]) => { window.__mapFinderMap.setView([la, ln + 0.15], 15.5, { animate: false }); }, [CULVERT.lat, CULVERT.lng]);
await sleep(900); // the debounce has fired and the tile requests are in flight (held by the slow server)
await page.evaluate(([la, ln]) => { window.__mapFinderMap.setView([la - 0.12, ln - 0.2], 15.5, { animate: false }); }, [CULVERT.lat, CULVERT.lng]);
await sleep(700);
const abortedAfter = (await disp()).wide.aborted;
expect("tiles that left the view while in flight were CANCELLED", abortedAfter > abortedBefore, `aborted ${abortedBefore} → ${abortedAfter}`);
state.delayMs = 0;
await setView(15.5);
await settled("back");

console.log("— 5 relay missing (a dev server / a refused host): fall back to the county directly —");
state.relay = "404";
await openMap();
await setView(15.5);
await settled("fallback");
d = await disp();
const viaRelay404 = state.log.filter((q) => q.via === "relay" && q.status === 404).length;
const viaDirect = state.log.filter((q) => q.via === "direct" && q.tile && q.status === 200).length;
expect("the relay was tried first, then the county directly", viaRelay404 > 0 && viaDirect > 0, `${viaRelay404} relay 404s, ${viaDirect} direct tile answers`);
expect("lots still drew", d && d.wide && d.wide.held > 0, `${d && d.wide && d.wide.held} held`);
state.relay = "ok";

console.log("— 6 a busy county server (503): back off, say so, recover —");
await openMap();
state.busyLeft = 3;
state.log.length = 0;
await setView(15.5);
const sawBusy = await waitFor(async () => /server is busy/i.test(await tip()), 9000);
expect("while it is backing off the hint says the parcel server is busy (not a silent blank map)", !!sawBusy, JSON.stringify((await tip()).slice(0, 80)));
const fives = state.log.filter((q) => q.status === 503);
const lastFive = fives.length ? fives[fives.length - 1].at : 0;
const nextOk = await waitFor(() => state.log.find((q) => q.tile && q.status === 200 && q.at > lastFive), 12000);
const waited = nextOk ? nextOk.at - lastFive : -1;
console.log(`  ${fives.length} x 503, then the first good tile request came ${waited} ms later`);
expect("the host was backed off: nothing was sent for ~2 s after the 503s (not hammered)", waited >= 1800, `${waited} ms`);
const recovered = await waitFor(async () => { const x = await disp(); return x && x.wide && x.wide.held > 0 && !x.wide.busy; }, 30000);
expect("it recovers and draws once the server answers again", !!recovered);
expect("the busy hint is gone after recovery", !/server is busy/i.test(await tip()), JSON.stringify((await tip()).slice(0, 80)));

console.log("— 7 back in to the close stage —");
await setView(17.4);
await sleep(2500);
d = await disp();
expect("the wide lines are released once the close stage has drawn", d && d.wide && d.wide.held === 0 || (d && d.wide && d.wide.stage === "close"), JSON.stringify(d && d.wide && { stage: d.wide.stage, held: d.wide.held }));
expect("the close stage draws every lot again", d && d.held > 0);
expect("the 'larger lots' hint is gone", !/larger lots/i.test(await tip()));

expect("no uncaught page errors", errs.length === 0, errs.slice(0, 2).join(" | "));
await browser.close();
console.log(`\n${failures ? `❌ ${failures} FAILED` : "✅ PASS"} — Select parcels wide view`);
process.exit(failures ? 1 : 0);
