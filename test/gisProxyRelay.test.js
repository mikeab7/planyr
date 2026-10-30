/* NEW-1 (B2521584 / B2535200 / B2528688 review, finding 3) — the GIS relay's allow-list and its redirect handling.
 *
 *  1. EVERY ALLOW-LISTED HOST IS READ BY SOMETHING. The file's own rule is "delete an entry whose host ends up unused"; three Tennessee / Georgia entries (tdeconline.tn.gov,
 *     egis.dot.ga.gov, and the bare bartowgis.org — the row reads www.bartowgis.org) were never read by any row and are gone. A host counts as used when it appears, as a whole
 *     hostname and OUTSIDE a comment, anywhere under src/ (registry rows, GIS_SOURCES, the county tables). The hosts below were already unused when this guard landed
 *     (Idaho / New Mexico / Oklahoma / South Dakota / … probes, owned by other work); the baseline may only SHRINK — wire one and it must leave the list (the test says so), and a NEW
 *     unused host fails the build.
 *  2. A REDIRECT IS NEVER FOLLOWED BLINDLY. `fetch` follows redirects by default, so an allow-listed host that answered 3xx to somewhere else was relayed onward to a host nobody had
 *     allow-listed. The relay now asks for `redirect: "manual"` and follows a Location only when it is https and its host is on the same list. */
import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ALLOWED_HOSTS, onRequest, redirectTarget, isRedirectStatus, MAX_REDIRECTS } from "../functions/gis-proxy/[[path]].js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/* hosts that were already unused on 2026-10-30 — shrink-only */
const KNOWN_UNUSED = new Set([
  "maps.memphistn.gov",
  "gis.shelbycountytn.gov",
  "maps.idahoparcels.us",
  "maps.terragis.net",
  "cloudgisapps.bonnercountyid.gov",
  "server.boundarycountyid.org",
  "maps.co.blaine.id.us",
  "maps.bannockcounty.us",
  "gis.co.nezperce.id.us",
  "insideidaho.org",
  "gis.idaho.gov",
  "giscenter.rdc.isu.edu",
  "gisu.rdc.isu.edu",
  "portal.kcgov.us",
  "gis.ose.state.nm.us",
  "rgis.unm.edu",
  "gstore.unm.edu",
  "maps.currycounty.org",
  "arcgisce2.co.valencia.nm.us",
  "sfcomaps.santafecountynm.gov",
  "gis.donaanacounty.org",
  "webmaps.sjcounty.net",
  "gis.losalamosnm.us",
  "web1.kcsgis.com",
  "web2.kcsgis.com",
  "gis.jccal.org",
  "autaugagis.autauga.com",
  "arcweb.houstoncountyal.gov",
  "www.alabamagis.com",
  "arcgis5.roktech.net",
  "www.mgrcmaps.org",
  "www.valorgis.com",
  "gis11.cama.io",
  "gis.okco14.org",
  "gis.clevelandcountyassessor.us",
  "map8.incog.org",
  "map9.incog.org",
  "okmaps.onenet.net",
  "mapview-online.com",
  "www.mapview-online.com",
  "mapview-adair.com",
  "property.spatialest.com",
  "app.datacrosspoint.com",
  "datacrosspoint.com",
  "www.datacrosspoint.com",
  "gis.datacrosspoint.com",
  "maps.datacrosspoint.com",
  "api.datacrosspoint.com",
  "maps.adaok.com",
  "maps.adaok.com:6443",
  "maps.adaok.com:6080",
  "www.okmaps.org",
  "gis.lincolncountysd.gov",
  "maps.lincolncountysd.org",
  "gis2.siouxfalls.org",
  "arcgis.sd.gov",
  "sdgis.sd.gov",
  "www.districtiii.org",
  "districtiii.org",
  "1stdistrict.org",
  "mapnet.1stdistrict.org",
  "gis.1stdistrict.org",
  "gis.rcgov.org",
  "davisonreports.com",
  "www.davisonreports.com",
  "sidbox.sidwellco.com",
  "brookingscountysd.gov",
  "www.brookingscountysd.gov",
  "codington.sdcounty.gov",
  "brown.sd.us",
  "gis.minnehahacounty.org",
  "ims.districtiii.org",
  "www.1stdistrictmapnet.com",
  "1stdistrictmapnet.com",
  "association.1stdistrict.org",
  "dakotaathome.sd.gov",
  "spatial.vhb.com",
  "gisservices.its.ny.gov",
  "maps.watertown-ny.gov",
  "gis2.erie.gov",
  "kygisserver.ky.gov",
  "kygeonet.ky.gov",
]);

function srcCorpus() {
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else if (/\.(js|jsx|mjs|json)$/.test(e.name)) files.push(p);
    }
  })(path.join(ROOT, "src"));
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\w"'`\\])\/\/[^\n]*/g, "$1");
  return files.map((f) => strip(fs.readFileSync(f, "utf8"))).join("\n");
}
const esc = (h) => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const used = (corpus, h) => new RegExp("(?<![\\w.-])" + esc(h) + "(?![\\w-]|\\.\\w)").test(corpus);

describe("the relay allow-list carries only hosts something reads", () => {
  const corpus = srcCorpus();
  it("the three reviewed entries are gone", () => {
    for (const h of ["tdeconline.tn.gov", "egis.dot.ga.gov", "bartowgis.org"]) expect(ALLOWED_HOSTS.has(h), h).toBe(false);
    expect(ALLOWED_HOSTS.has("www.bartowgis.org")).toBe(true); // the row's own host
  });
  it("no allow-listed host is unused, beyond the shrink-only baseline", () => {
    const fresh = [...ALLOWED_HOSTS].filter((h) => !used(corpus, h) && !KNOWN_UNUSED.has(h));
    expect(fresh, "allow-listed but read by no row — delete the entry, or wire a row to it in the same PR").toEqual([]);
  });
  it("the baseline only shrinks: a host that is now used, or no longer allow-listed, must leave KNOWN_UNUSED", () => {
    const stale = [...KNOWN_UNUSED].filter((h) => !ALLOWED_HOSTS.has(h) || used(corpus, h));
    expect(stale, "remove these from KNOWN_UNUSED").toEqual([]);
  });
  it("the matcher can tell hosts apart (a known-used host, a known-substring trap)", () => {
    expect(used(corpus, "gisdnr.state.co.us")).toBe(true);
    expect(used("https://www.bartowgis.org/x", "bartowgis.org")).toBe(false); // the bare host is not the www host
    expect(used("https://bartowgis.org/x", "bartowgis.org")).toBe(true);
  });
});

const res = (status, headers = {}, body = "{}") => new Response(body, { status, headers });
const run = async (url, init, upstream) => {
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (u, i) => { calls.push({ url: String(u), init: i }); return upstream(calls.length, String(u), i); }));
  const u = new URL(url);
  const segs = u.pathname.replace(/^\/gis-proxy\//, "").split("/");
  const out = await onRequest({ request: new Request(url, init), params: { path: segs } });
  return { out, calls };
};
afterEach(() => vi.unstubAllGlobals());

describe("redirects are re-checked against the allow-list", () => {
  it("asks fetch NOT to follow redirects itself", async () => {
    const { calls } = await run("https://planyr.io/gis-proxy/www.bartowgis.org/arcgis/rest/services?f=json", {}, () => res(200));
    expect(calls[0].init.redirect).toBe("manual");
  });
  it("a redirect to a host that is not allow-listed is refused (502), not relayed", async () => {
    const { out, calls } = await run("https://planyr.io/gis-proxy/www.bartowgis.org/a?f=json", {}, () => res(302, { location: "https://evil.example.com/steal" }));
    expect(out.status).toBe(502);
    expect(calls.length).toBe(1); // never even asked the second host
    expect((await out.json()).error).toMatch(/evil\.example\.com/);
  });
  it("a redirect to plain http is refused even for an allow-listed host", async () => {
    const { out } = await run("https://planyr.io/gis-proxy/www.bartowgis.org/a", {}, () => res(301, { location: "http://www.bartowgis.org/a" }));
    expect(out.status).toBe(502);
  });
  it("a redirect to another allow-listed host is followed and its answer returned", async () => {
    const { out, calls } = await run("https://planyr.io/gis-proxy/www.bartowgis.org/a?f=json", {}, (n) => (n === 1 ? res(301, { location: "https://maps.tdec.tn.gov/b?f=json" }) : res(200, { "content-type": "application/json" }, '{"ok":1}')));
    expect(out.status).toBe(200);
    expect(await out.json()).toEqual({ ok: 1 });
    expect(calls.map((c) => c.url)).toEqual(["https://www.bartowgis.org/a?f=json", "https://maps.tdec.tn.gov/b?f=json"]);
  });
  it("a relative Location stays on the same host", async () => {
    const { calls } = await run("https://planyr.io/gis-proxy/www.bartowgis.org/a", {}, (n) => (n === 1 ? res(302, { location: "/b" }) : res(200)));
    expect(calls[1].url).toBe("https://www.bartowgis.org/b");
  });
  it("gives up after MAX_REDIRECTS hops and when Location is missing", async () => {
    const loop = await run("https://planyr.io/gis-proxy/www.bartowgis.org/a", {}, () => res(302, { location: "https://www.bartowgis.org/a" }));
    expect(loop.out.status).toBe(502);
    expect(loop.calls.length).toBe(MAX_REDIRECTS + 1);
    const none = await run("https://planyr.io/gis-proxy/www.bartowgis.org/a", {}, () => res(302));
    expect(none.out.status).toBe(502);
  });
  it("a POST keeps its body across 307 and becomes a GET across 302", async () => {
    const post = (status) => run("https://planyr.io/gis-proxy/www.bartowgis.org/q", { method: "POST", body: "f=json", headers: { "content-type": "application/x-www-form-urlencoded" } },
      (n) => (n === 1 ? res(status, { location: "https://www.bartowgis.org/q2" }) : res(200)));
    const keep = await post(307);
    expect(keep.calls[1].init.method).toBe("POST");
    expect(keep.calls[1].init.body).toBeTruthy();
    const drop = await post(302);
    expect(drop.calls[1].init.method).toBe("GET");
    expect(drop.calls[1].init.body).toBeUndefined();
  });
  it("redirectTarget and isRedirectStatus are the pure halves", () => {
    for (const s of [301, 302, 303, 307, 308]) expect(isRedirectStatus(s)).toBe(true);
    for (const s of [200, 304, 404, 500]) expect(isRedirectStatus(s)).toBe(false);
    expect(redirectTarget(res(302, { location: "https://tnmap.tn.gov/x" }), "https://www.bartowgis.org/a", "GET").url).toBe("https://tnmap.tn.gov/x");
    expect(redirectTarget(res(302, { location: "https://nope.example/x" }), "https://www.bartowgis.org/a", "GET").error).toMatch(/allow-list/);
  });
});
