/* verify-gis-relay-live — NEW-1 (B2555776): the GIS relay refuses what it must and still carries every layer, LIVE on planyr.io, signed in as the test account.
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-gis-relay-live.mjs [https://planyr.io | a *.planyr.pages.dev preview] [--expect-sha <sha>]
 *
 * Every request is made from INSIDE a signed-in planyr.io page (same-origin, exactly how the app calls the relay), and /version.json is read with cache:'no-store' IN THE SAME
 * page.evaluate as the assertions — a stale tab cannot vouch for a different build. It creates nothing (read-only queries), so there is nothing to clean up.
 *
 *   A. NOTHING IS BROKEN — for EVERY allow-listed host that a registry row reaches through the relay (the hosts are re-derived here from the code, never listed by hand): the first
 *      layer URL the app builds for that host is queried the way the app does (`/query`, f=json, one record) and must answer 200 as JSON — or, where the upstream is itself down,
 *      the SAME failure the upstream gave (reported, never green). Known-good arm: Colorado (gisdnr), Tennessee (tdec), Mississippi (MARIS), Georgia (itos), Oklahoma (occ),
 *      Florida (dep) and the three hosts that label JSON text/plain must all be 200 JSON, or the run is VOID. A MapServer `/export` still returns an image.
 *   B. THE ATTACKS ARE REFUSED — an ArcGIS directory page (was `200 text/html` under planyr.io), `f=html`, JSONP `callback`, POST applyEdits (and GET), `/admin`, token, path traversal
 *      (raw and %-encoded), a host not on the list: none reaches the upstream or comes back as anything but JSON; every answer carries nosniff + the sandbox CSP.
 * FOREGROUND-OR-VOID first. Exit 0 PASS · 1 FAIL · 2 VOID. */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const args = process.argv.slice(2);
const base = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const expectSha = args.includes("--expect-sha") ? args[args.indexOf("--expect-sha") + 1] : null;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/* the relay URLs the app builds — literals in code, comments stripped (the same scan test/gisProxyRelay.test.js starts from) */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\w"'`\\])\/\/[^\n]*/g, "$1");
const files = [];
(function walk(d) { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(js|jsx|mjs|json)$/.test(e.name)) files.push(p); } })(join(ROOT, "src"));
const firstLayerByHost = new Map();
for (const f of files) for (const m of strip(readFileSync(f, "utf8")).matchAll(/\/gis-proxy\/([A-Za-z0-9.-]+(?::\d+)?)((?:\/[^\s"'`),\\]*)?)/g)) {
  const p = m[2].split("?")[0].replace(/\/+$/, "");
  const last = p.split("/").pop();
  if (!(/^\d+$/.test(last) || /^(MapServer|FeatureServer)$/i.test(last) || last === "query")) continue;
  if (!firstLayerByHost.has(m[1])) firstLayerByHost.set(m[1], `/gis-proxy/${m[1]}${last === "query" ? p.slice(0, -6) : p}`);
}
/* hosts whose URLs the code builds through a helper (relayUrl / viaRelay / relayed) rather than a literal — one known layer each, measured 2026-10-29/30 */
const BUILT = {
  "gisdnr.state.co.us": "/gis-proxy/gisdnr.state.co.us/arcgis/rest/services/ECMC_Public/ECMC_Public/MapServer/0",
  "maps.tdec.tn.gov": "/gis-proxy/maps.tdec.tn.gov/hosting/rest/services/Permitted_Tennessee_Landfills/FeatureServer/0",
  "ca.dep.state.fl.us": "/gis-proxy/ca.dep.state.fl.us/arcgis/rest/services/OpenData/BROWNFIELD_AREAS/MapServer/0",
  "maps.itos.uga.edu": "/gis-proxy/maps.itos.uga.edu/arcgis/rest/services",
};
for (const [h, u] of Object.entries(BUILT)) if (!firstLayerByHost.has(h)) firstLayerByHost.set(h, u);
const KNOWN_GOOD = ["gisdnr.state.co.us", "maps.tdec.tn.gov", "gis.mississippi.edu", "ca.dep.state.fl.us", "greenecountyassessor.org", "maps.clintoncountypa.gov", "opcgis.deq.state.ms.us"].filter((h) => firstLayerByHost.has(h));
const TEXT_PLAIN_HOSTS = ["greenecountyassessor.org", "maps.clintoncountypa.gov", "opcgis.deq.state.ms.us"];

const s = await openSignedIn({ base });
let failed = 0, voided = 0;
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) failed++; };
try {
  await assertMeasurable(s.page, "verify-gis-relay-live");
  const out = await s.page.evaluate(async ({ layers, expectSha, known, textPlain }) => {
    const ver = await (await fetch("/version.json", { cache: "no-store" })).json();
    const hdr = (r) => ({ ct: r.headers.get("content-type") || "", nosniff: r.headers.get("x-content-type-options"), csp: r.headers.get("content-security-policy"), cd: r.headers.get("content-disposition") });
    const one = async (url, init) => {
      try {
        const r = await fetch(url, init); const t = await r.text();
        let json = null; try { json = JSON.parse(t); } catch (_e) { /* not JSON */ }
        return { status: r.status, h: hdr(r), body: t.slice(0, 300), len: t.length, isJson: !!json && typeof json === "object", json };
      } catch (e) { return { status: 0, err: String(e), h: {}, body: "", isJson: false }; }
    };
    const A = [];
    let next = 0;
    const entries = Object.entries(layers);
    await Promise.all(Array.from({ length: 8 }, async () => {
      while (next < entries.length) {
        const [host, url] = entries[next++];
        const isDir = /\/services$/.test(url);
        const r = await one(isDir ? `${url}?f=json` : `${url}/query?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=1&f=json`);
        A.push({ host, status: r.status, ct: r.h.ct, nosniff: r.h.nosniff, csp: r.h.csp, isJson: r.isJson, err: r.json && typeof r.json.error === "string" ? r.json.error : null, upstreamStatus: r.json ? r.json.upstreamStatus : undefined });
      }
    }));
    const H = "/gis-proxy/gisdnr.state.co.us";
    const LAYER = `${H}/arcgis/rest/services/ECMC_Public/ECMC_Public/MapServer/0`;
    const attacks = {
      directoryHtml: await one(`${H}/arcgis/rest/services`),
      directoryFhtml: await one(`${H}/arcgis/rest/services?f=html`),
      layerNoF: await one(`${LAYER}`),
      layerFhtml: await one(`${LAYER}?f=html`),
      jsonp: await one(`${LAYER}/query?where=1%3D1&resultRecordCount=1&f=json&callback=alert`),
      applyEditsPost: await one(`${LAYER}/applyEdits`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "f=json&adds=[]" }),
      applyEditsGet: await one(`${LAYER}/applyEdits?f=json`),
      deleteFeaturesPost: await one(`${LAYER}/deleteFeatures`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "f=json&where=1%3D1" }),
      admin: await one(`${H}/arcgis/admin?f=json`),
      adminServices: await one(`${H}/arcgis/admin/services?f=json`),
      token: await one(`${H}/arcgis/tokens/generateToken?f=json`),
      traversal: await one(`${H}/arcgis/rest/services/../../admin?f=json`),
      traversalEnc: await one(`${H}/arcgis/rest/services/%2e%2e/%2e%2e/admin?f=json`),
      traversalSlash: await one(`${H}/arcgis%2f..%2fadmin?f=json`),
      badHost: await one(`/gis-proxy/evil.example.com/arcgis/rest/services?f=json`),
      lookalike: await one(`/gis-proxy/gisdnr.state.co.us.evil.example.com/arcgis/rest/services?f=json`),
      postJson: await one(`${LAYER}/query`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
      control: await one(`${LAYER}/query?where=1%3D1&resultRecordCount=1&f=json`),
      controlPost: await one(`${LAYER}/query`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" }, body: "where=1%3D1&resultRecordCount=1&f=json" }),
    };
    for (const v of Object.values(attacks)) delete v.json;
    return { ver, A, attacks, expectSha, known, textPlain };
  }, { layers: Object.fromEntries(firstLayerByHost), expectSha, known: KNOWN_GOOD, textPlain: TEXT_PLAIN_HOSTS });

  console.log("served build:", out.ver.build, "| page origin:", base);
  if (expectSha) ok(String(out.ver.build).startsWith(expectSha.slice(0, 7)), `the served build ${out.ver.build} is the one under test (${expectSha.slice(0, 7)})`);

  // ---- A
  const byHost = Object.fromEntries(out.A.map((r) => [r.host, r]));
  const answered = (r) => r && r.status === 200 && r.isJson; // the instrument's own "this host works" — header-agnostic, so it holds on a build without the fix too
  const good = (r) => answered(r) && /json/i.test(r.ct) && r.nosniff === "nosniff";
  /* the relay's OWN refusals (a path / host / body-type / response-type refusal) — never an upstream's own failure: an upstream 403/404/5xx keeps its status, and a type refusal of an
   * upstream ERROR (status >= 400) is the upstream's. A type refusal of an upstream 2xx is the relay breaking a layer. */
  const relayRefusal = (r) => typeof r.err === "string" && (/read-only ArcGIS|not an ArcGIS read|host not allowed|invalid path|POST (bodies|is only)/.test(r.err) || (/does not serve/.test(r.err) && !(r.upstreamStatus >= 400)));
  for (const h of out.known) if (!answered(byHost[h])) { console.log(`VOID: known-good host ${h} did not answer 200 JSON (${JSON.stringify(byHost[h])})`); voided++; }
  const notGood = out.A.filter((r) => !good(r));
  console.log(`A. ${out.A.length} allow-listed hosts queried through the relay: ${out.A.length - notGood.length} answered 200 JSON with nosniff.`);
  for (const r of notGood) {
    if (relayRefusal(r)) { console.log(`   ❌ ${r.host}: ${r.status} — REFUSED BY THE RELAY: ${r.err}`); failed++; }
    else if (answered(r)) { console.log(`   ❌ ${r.host}: answered 200 JSON but without the relay's security headers (nosniff ${r.nosniff})`); failed++; }
    else console.log(`   · ${r.host}: ${r.status} ${r.ct} — the upstream's own failure, same as before the change (reported, not counted)`);
  }
  for (const h of out.textPlain) if (byHost[h]) ok(good(byHost[h]) && /^application\/json/i.test(byHost[h].ct), `${h} labels its JSON text/plain and still reaches the app as application/json (${byHost[h].status})`);

  // ---- B
  const a = out.attacks;
  const headersOk = (r) => r.h.nosniff === "nosniff" && r.h.csp === "default-src 'none'; sandbox";
  const isJsonCt = (r) => /^application\/json/i.test(r.h.ct);
  ok(good({ status: a.control.status, ct: a.control.h.ct, isJson: true, nosniff: a.control.h.nosniff }) && headersOk(a.control) && a.control.h.cd === "attachment", `CONTROL: a plain layer query is relayed (${a.control.status}, ${a.control.h.ct}) with nosniff + CSP + attachment`);
  ok(a.controlPost.status === 200 && isJsonCt(a.controlPost), `CONTROL: a urlencoded POST /query is relayed (${a.controlPost.status})`);
  ok(isJsonCt(a.directoryHtml) && !/<html/i.test(a.directoryHtml.body), `the services directory with no f= no longer comes back as HTML (${a.directoryHtml.status} ${a.directoryHtml.h.ct})`);
  ok(isJsonCt(a.directoryFhtml) && !/<html/i.test(a.directoryFhtml.body), `f=html on the directory is forced to JSON (${a.directoryFhtml.status} ${a.directoryFhtml.h.ct})`);
  ok(!/text\/html/i.test(a.layerNoF.h.ct) && !/<html/i.test(a.layerNoF.body), `a layer with no f= is not HTML (${a.layerNoF.status} ${a.layerNoF.h.ct})`);
  ok(!/text\/html/i.test(a.layerFhtml.h.ct) && !/<html/i.test(a.layerFhtml.body), `a layer with f=html is not HTML (${a.layerFhtml.status} ${a.layerFhtml.h.ct})`);
  ok(!/javascript/i.test(a.jsonp.h.ct) && !/^alert\(/.test(a.jsonp.body), `a JSONP callback is dropped, not answered as JavaScript (${a.jsonp.status} ${a.jsonp.h.ct})`);
  for (const k of ["applyEditsPost", "applyEditsGet", "deleteFeaturesPost", "admin", "adminServices", "token"]) ok(a[k].status === 403 && isJsonCt(a[k]), `${k} is refused by the relay with 403 JSON (${a[k].status})`);
  // (the browser itself folds a literal or %2e%2e dot segment into /arcgis/admin before sending, so the relay's own answer there is the admin refusal; the %2f form reaches the relay's segment check)
  for (const k of ["traversal", "traversalEnc", "traversalSlash"]) ok([400, 403, 404].includes(a[k].status) && !/currentVersion|"services"/.test(a[k].body) && !/<html/i.test(a[k].body), `${k} never reaches an admin page (${a[k].status} ${a[k].h.ct})`);
  ok(a.badHost.status === 403 && isJsonCt(a.badHost), `a host not on the list is refused (${a.badHost.status})`);
  ok(a.lookalike.status === 403, `a look-alike host (allowed-host.evil.example.com) is refused (${a.lookalike.status})`);
  ok(a.postJson.status === 415, `a non-urlencoded POST is refused (${a.postJson.status})`);
  for (const [k, r] of Object.entries(a)) if (k !== "control" && k !== "controlPost" && r.status !== 0) ok(headersOk(r), `${k}: nosniff + sandbox CSP on the answer`);
} catch (e) {
  console.error("VOID/ERROR:", e.message);
  voided++;
} finally {
  await s.close();
}
if (voided) { console.log("RESULT: VOID — an instrument precondition failed; this is not a pass."); process.exit(2); }
console.log(failed ? `RESULT: FAIL (${failed})` : "RESULT: PASS");
process.exit(failed ? 1 : 0);
