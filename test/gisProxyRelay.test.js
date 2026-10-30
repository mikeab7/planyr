/* NEW-1 (B2555776, security review of main e370ff91) — what the GIS relay (functions/gis-proxy) will carry, and which hosts it may carry them for.
 *
 *  A. THE ALLOW-LIST IS THE REGISTRY, IN BOTH DIRECTIONS. The set of hosts read through the relay is derived from the app itself — every `/gis-proxy/<host>` literal in code (comments stripped),
 *     plus every `/gis-proxy/…` URL the importable registry modules build at load (county tables, layer rows, `relay: true` GIS_SOURCES rows). The old guard counted a host as "used" if its name
 *     appeared ANYWHERE in src/ — a county's DIRECT https row or a provenance sentence kept a relay entry alive — and grandfathered 76 unused hosts in KNOWN_UNUSED. Now:
 *       · a host on ALLOWED_HOSTS that no row reads through the relay fails (delete it — the PR that wires a row adds its host);
 *       · a host a row reads through the relay that is NOT allow-listed fails (it would be refused at runtime);
 *       · a host listed twice fails (www.bartowgis.org was).
 *     No baseline, no exceptions. Limit, stated: a relay URL that exists only inside a function that runs at click time, in a module that cannot be imported without a browser, is invisible here —
 *     give it a literal `/gis-proxy/<host>` or export the row.
 *  B. EVERY URL THE APP BUILDS STILL PASSES THE PATH FILTER (the corpus check) — so tightening the relay cannot silently break a live layer.
 *  C. THE ATTACKS: HTML, SVG, f=html, JSONP, POST applyEdits, admin paths, traversal (also %-encoded), redirect to a non-allowed host — each refused. Each refusal test is paired with the legitimate request
 *     it must not collaterally block, so a filter that refuses everything cannot pass.
 *  D. REDIRECTS are never followed blindly (#2705, kept). */
import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALLOWED_HOSTS, onRequest, redirectTarget, isRedirectStatus, MAX_REDIRECTS, classifyPath, cleanSegments, forceJsonFormat, classifyResponseType, resolveUpstream,
} from "../functions/gis-proxy/[[path]].js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const RELAY_FILE = path.join(ROOT, "functions/gis-proxy/[[path]].js");

/* ───────────────────────── A + B: the registry ───────────────────────── */
const mods = import.meta.glob(["../src/shared/gis/*.js", "../src/workspaces/site-planner/lib/*.js", "../src/workspaces/site-planner/*.js"]);

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\w"'`\\])\/\/[^\n]*/g, "$1");
function srcFiles() {
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else if (/\.(js|jsx|mjs|json)$/.test(e.name)) files.push(p);
    }
  })(path.join(ROOT, "src"));
  return files;
}
/* every relay URL named by a literal in code (comments stripped): "/gis-proxy/<host>/<path>" */
function staticRelayUrls() {
  const out = new Set();
  for (const f of srcFiles()) for (const m of strip(fs.readFileSync(f, "utf8")).matchAll(/\/gis-proxy\/([A-Za-z0-9.-]+(?::\d+)?)((?:\/[^\s"'`),\\]*)?)/g)) out.add(`/gis-proxy/${m[1]}${m[2]}`);
  return out;
}
/* every relay URL the importable registry modules hold as DATA at load (rows built through relayUrl() / viaRelay() / relayed() included) */
async function dynamicRelayUrls() {
  const out = new Set();
  const seen = new WeakSet();
  const walk = (v, d = 0) => {
    if (typeof v === "string") { if (v.startsWith("/gis-proxy/")) out.add(v); return; }
    if (!v || typeof v !== "object" || d > 8 || seen.has(v)) return;
    seen.add(v);
    for (const k of Object.keys(v)) walk(v[k], d + 1);
  };
  let imported = 0;
  for (const load of Object.values(mods)) {
    let m;
    try { m = await load(); } catch (_e) { continue; } // a UI module that needs a browser (window / self) — covered by the literal scan
    imported++;
    for (const v of Object.values(m)) if (typeof v !== "function") walk(v);
  }
  const { GIS_SOURCES } = await import("../src/shared/gis/sources.js");
  for (const v of Object.values(GIS_SOURCES)) if (v && v.relay && v.serviceUrl) out.add("/gis-proxy/" + String(v.serviceUrl).replace(/^https:\/\//, ""));
  return { urls: out, imported };
}
const hostOf = (u) => /^\/gis-proxy\/([^/]+)/.exec(u)[1];

describe("A. the relay allow-list is exactly the hosts the registry reads through it", () => {
  let dyn, stat, read;
  const ready = (async () => {
    dyn = await dynamicRelayUrls();
    stat = staticRelayUrls();
    read = new Set([...dyn.urls, ...stat].map(hostOf));
  })();

  it("the two detection methods work (positive controls: a host only the registry builds, a host only a literal names)", async () => {
    await ready;
    expect(dyn.imported, "the glob imported the registry modules").toBeGreaterThan(60);
    expect([...dyn.urls].map(hostOf)).toContain("gisdnr.state.co.us"); // built by coloradoLayers' relayUrl() — no literal in code
    expect([...stat].map(hostOf)).toContain("www.laurenscountygis.org"); // a literal in scParcels.js
    expect(read.size).toBeGreaterThan(100);
  }, 120000);
  it("no allow-listed host is unused — an entry no row reads through the relay is deleted (no baseline)", async () => {
    await ready;
    const unused = [...ALLOWED_HOSTS].filter((h) => !read.has(h)).sort();
    expect(unused, "allow-listed but read by no row through /gis-proxy — delete the entry; the PR that wires a row adds its host").toEqual([]);
  }, 120000);
  it("no row reads a host the relay would refuse", async () => {
    await ready;
    const refused = [...read].filter((h) => !ALLOWED_HOSTS.has(h)).sort();
    expect(refused, "a row reads /gis-proxy/<host> but the host is not on ALLOWED_HOSTS").toEqual([]);
  }, 120000);
  it("no host is listed twice in the source (a Set hides it)", () => {
    const src = fs.readFileSync(RELAY_FILE, "utf8");
    const block = src.slice(src.indexOf("export const ALLOWED_HOSTS = new Set(["), src.indexOf("]);", src.indexOf("export const ALLOWED_HOSTS")));
    const hosts = [...strip(block).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    const dup = hosts.filter((h, i) => hosts.indexOf(h) !== i);
    expect(dup).toEqual([]);
    expect(hosts.length).toBe(ALLOWED_HOSTS.size);
  });
  it("the three reviewed entries stay gone, and the row's own www host stays", () => {
    for (const h of ["tdeconline.tn.gov", "egis.dot.ga.gov", "bartowgis.org"]) expect(ALLOWED_HOSTS.has(h), h).toBe(false);
    expect(ALLOWED_HOSTS.has("www.bartowgis.org")).toBe(true);
  });
});

describe("B. every relay URL the app builds still passes the path filter (the corpus check)", () => {
  it("each URL is GET-able as written, and a layer URL takes a POST /query", async () => {
    const { urls } = await dynamicRelayUrls();
    const all = new Set([...urls, ...staticRelayUrls()]);
    expect(all.size).toBeGreaterThan(300); // a corpus that shrank to nothing proves nothing
    const bad = [];
    for (const u of all) {
      const clean = u.split("?")[0].replace(/\/+$/, "");
      const segs = clean.replace(/^\/gis-proxy\//, "").split("/");
      const rest = segs.slice(1);
      const cs = cleanSegments(rest);
      if (cs.error) { bad.push(`${u}: cleanSegments`); continue; }
      const last = (rest[rest.length - 1] || "").toLowerCase();
      const isLayerish = /^\d+$/.test(last) || ["mapserver", "featureserver", "imageserver"].includes(last);
      const isOp = ["query", "identify", "export", "exportimage"].includes(last);
      const g = classifyPath(cs.segs, isOp ? "POST" : "GET");
      if (!g.ok) bad.push(`${u}: ${g.error}`);
      if (isLayerish) {
        const q = classifyPath([...cs.segs, "query"], "POST");
        if (!q.ok) bad.push(`${u}/query POST: ${q.error}`);
      }
    }
    expect(bad, "a URL the app builds would be refused by the relay's path filter").toEqual([]);
  }, 60000);
});

/* ───────────────────────── C: the filters, pure ───────────────────────── */
const LAYER = ["arcgis", "rest", "services", "Parcels", "MapServer", "0"];

describe("C1. classifyPath — only ArcGIS read shapes, never a write or admin path", () => {
  it("allows the shapes the app uses (and its control: they are not all refused)", () => {
    for (const rest of [
      [...LAYER, "query"], ["arcgis", "rest", "services", "X", "FeatureServer", "3", "query"], ["arcgis", "rest", "services", "X", "MapServer", "export"],
      ["arcgis", "rest", "services", "X", "MapServer", "identify"], ["arcgis", "rest", "services", "X", "ImageServer", "exportImage"], ["arcgis", "rest", "services", "X", "MapServer", "query"],
    ]) { expect(classifyPath(rest, "GET").ok, rest.join("/")).toBe(true); expect(classifyPath(rest, "POST").ok, "POST " + rest.join("/")).toBe(true); }
    for (const rest of [LAYER, ["arcgis", "rest", "services", "X", "MapServer"], ["arcgis", "rest", "services", "X", "MapServer", "layers"], ["arcgis", "rest", "services"],
      ["arcgis", "rest", "services", "Folder"], ["arcgis", "rest", "info"], ["arcgis", "rest", "services", "X", "MapServer", "tile", "5", "10", "12"], ["arcgis", "rest", "services", "X", "MapServer", "legend"]])
      expect(classifyPath(rest, "GET").ok, rest.join("/")).toBe(true);
  });
  it("refuses the ArcGIS write verbs, with GET and POST alike", () => {
    for (const op of ["applyEdits", "addFeatures", "updateFeatures", "deleteFeatures", "calculate", "addAttachment", "updateAttachment", "deleteAttachments", "uploads", "createReplica", "append", "truncate"]) {
      for (const m of ["GET", "POST"]) {
        const v = classifyPath(["arcgis", "rest", "services", "X", "FeatureServer", "0", op], m);
        expect(v.ok, `${m} ${op}`).toBeFalsy();
        expect(v.status).toBe(403);
      }
    }
  });
  it("refuses admin / token / sharing surfaces anywhere in the path — including the ones that END in an allowed word like `services`", () => {
    for (const rest of [["arcgis", "admin"], ["arcgis", "admin", "services"], ["arcgis", "admin", "services", "X", "MapServer"], ["arcgis", "manager"], ["sharing", "rest", "generateToken"], ["arcgis", "tokens", "generateToken"], ["portal", "sharing", "rest", "content"]])
      expect(classifyPath(rest, "GET").ok, rest.join("/")).toBeFalsy();
    expect(classifyPath(["arcgis", "ADMIN", "services"], "GET").ok, "case-insensitive").toBeFalsy();
  });
  it("POST goes only to query / identify / export / exportImage", () => {
    for (const rest of [LAYER, ["arcgis", "rest", "services"], ["arcgis", "rest", "services", "X", "MapServer", "layers"], ["arcgis", "rest", "info"]]) expect(classifyPath(rest, "POST").ok, rest.join("/")).toBeFalsy();
  });
  it("refuses a path that is not an ArcGIS read shape at all, and an operation at the wrong place", () => {
    for (const rest of [[], ["x"], ["index.html"], ["geoserver", "wms"], ["arcgis", "rest", "services", "A", "B", "C"], ["query"], ["arcgis", "rest", "services", "X", "MapServer", "foo", "query"], ["arcgis", "rest", "services", "X", "FeatureServer", "export"]])
      expect(classifyPath(rest, "GET").ok, rest.join("/") || "(empty)").toBeFalsy();
  });
  it("a service FOLDER named like a verb is legitimate (the filter is end-shape first, name list second)", () => {
    expect(classifyPath(["arcgis", "rest", "services", "Edit", "Parcels", "MapServer", "0", "query"], "POST").ok).toBe(true);
    expect(classifyPath(["arcgis", "rest", "services", "Start", "Stop", "MapServer", "2"], "GET").ok).toBe(true);
  });
});

describe("C2. cleanSegments — traversal, encoded slashes, control characters", () => {
  it("passes ordinary segments (decoded) and rejects the rest with 400", () => {
    expect(cleanSegments(["arcgis", "rest", "services", "My%20Folder", "MapServer"]).segs).toEqual(["arcgis", "rest", "services", "My Folder", "MapServer"]);
    for (const bad of [[".."], ["a", "..", "b"], ["%2e%2e"], ["%2E%2E"], [".%2e"], ["a%2Fb"], ["a%5Cb"], ["a\\b"], ["a%00b"], ["%"], ["a%25b"], ["a;jsessionid=1"], ["a%0d%0aSet-Cookie"], ["."], ["..%2f..%2fadmin"]]) {
      const r = cleanSegments(bad);
      expect(r.error, JSON.stringify(bad)).toBeInstanceOf(Response);
      expect(r.error.status).toBe(400);
    }
  });
});

describe("C2b. only paths under /rest/services (or /rest/info) are relayed — a numeric last segment alone is not an ArcGIS endpoint", () => {
  it("refuses non-ArcGIS paths that merely end like one", () => {
    for (const rest of [["wp-admin", "post.php", "delete", "5"], ["api", "users", "logout", "0"], ["x", "y", "MapServer"], ["x", "FeatureServer", "0", "addToDefinition", "0"], ["x", "FeatureServer", "0", "refresh", "0"], ["rest", "MapServer", "0"], ["arcgis", "rest", "info", "x"], ["services", "x", "MapServer", "0"]])
      expect(classifyPath(rest, "GET").ok, rest.join("/")).toBeFalsy();
    for (const rest of [["arcgis", "rest", "services", "X", "MapServer", "0"], ["Geocortex", "Essentials", "REST", "sites", "Adair County (MO)", "map", "mapservices", "5", "rest", "services", "x", "MapServer"], ["arcgis", "rest", "info"]])
      expect(classifyPath(rest, "GET").ok, rest.join("/")).toBe(true);
  });
});

describe("C3. forceJsonFormat — an ArcGIS request never asks for HTML", () => {
  it("rewrites f=html (any case), a missing f, an unknown f and a doubled f to json; drops callback", () => {
    expect(forceJsonFormat("?f=html&where=1").text).toBe("?where=1&f=json");
    expect(forceJsonFormat("?F=HTML").text).toBe("?f=json");
    expect(forceJsonFormat("?where=1").text).toBe("?where=1&f=json");
    expect(forceJsonFormat("").text).toBe("?f=json");
    expect(forceJsonFormat("?f=kmz").fmt).toBe("json");
    expect(forceJsonFormat("?f=jsapi&x=1").text).toBe("?x=1&f=json");
    expect(forceJsonFormat("?f=json&f=html").text).toBe("?f=json");
    expect(forceJsonFormat("?f=json&callback=alert(1)").text).toBe("?f=json");
    expect(forceJsonFormat("?f=json&CALLBACK=x").text).toBe("?f=json");
  });
  it("a non-canonical f is rewritten, never forwarded for the upstream to interpret (whitespace, control chars, `;` separators)", () => {
    expect(forceJsonFormat("?f=json%20&where=1").text).toBe("?where=1&f=json");
    expect(forceJsonFormat("?f=%20json").text).toBe("?f=json");
    expect(forceJsonFormat("?f=json%0a").text).toBe("?f=json");
    expect(forceJsonFormat("?F=JSON&where=1").text).toBe("?where=1&f=json");
    expect(forceJsonFormat("?where=1;f=html").text).toBe("?where=1&f=json");
    expect(forceJsonFormat("?f=json;f=html").text).toBe("?f=json");
    expect(forceJsonFormat("where=1;f=html", { isQuery: false, addMissing: false }).text).toBe("where=1&f=json");
  });
  it("leaves an already-safe request byte-for-byte (a clean request is never reordered or re-encoded)", () => {
    for (const q of ["?f=json&where=1%3D1&outFields=*", "?where=NAME+LIKE+%27A%25%27&f=pjson", "?f=image&bbox=1,2,3,4", "?f=pbf", "?f=geojson"]) expect(forceJsonFormat(q).text).toBe(q);
  });
  it("a POST body: f is vetted when present, a body with no f is left alone, urlencoded only", () => {
    expect(forceJsonFormat("f=html&where=1", { isQuery: false, addMissing: false }).text).toBe("where=1&f=json");
    expect(forceJsonFormat("where=1", { isQuery: false, addMissing: false }).text).toBe("where=1");
    expect(forceJsonFormat("where=1&f=json", { isQuery: false, addMissing: false }).text).toBe("where=1&f=json");
  });
});

describe("C4. classifyResponseType — only what the app consumes, never HTML or SVG", () => {
  it("passes JSON / geojson / protobuf / images", () => {
    for (const t of ["application/json", "application/json; charset=UTF-8", "application/geo+json", "application/vnd.geo+json", "text/json"]) expect(classifyResponseType(t, "json").refuse, t).toBeUndefined();
    for (const t of ["image/png", "image/jpeg", "image/gif", "image/webp", "image/tiff"]) expect(classifyResponseType(t, "image"), t).toEqual({ type: t, image: true });
    expect(classifyResponseType("application/x-protobuf", "pbf").refuse).toBeUndefined();
  });
  it("never echoes the upstream's raw value: parameters and comma lists are dropped", () => {
    for (const t of ["application/json; charset=x, text/html", "application/json;\ttext/html", 'application/json; x="<svg>"']) expect(classifyResponseType(t, "json").type, t).toBe("application/json; charset=utf-8");
    // a `+json` structured suffix is JSON, and is re-issued as plain application/json; json-seq / jsonp / svg+xml+json are not JSON types and are refused
    for (const t of ["application/json-seq", "application/jsonp", "image/svg+xml+json"]) expect(classifyResponseType(t, "json").refuse, t).toBeTruthy();
  });
  it("refuses HTML, SVG, XML, JavaScript, PDF and unknown types", () => {
    for (const t of ["text/html", "text/html; charset=utf-8", "image/svg+xml", "application/xhtml+xml", "application/xml", "text/xml", "application/javascript", "text/javascript", "application/pdf", "application/zip", "text/css", "image/x-icon"])
      expect(classifyResponseType(t, "json").refuse, t).toBeTruthy();
  });
  it("text/plain or no type is re-labelled JSON ONLY when JSON was asked for", () => {
    for (const t of ["text/plain", "text/plain; charset=utf-8", "", null, "application/octet-stream"]) {
      expect(classifyResponseType(t, "json").type, String(t)).toBe("application/json; charset=utf-8");
      expect(classifyResponseType(t, "image").refuse, String(t) + " asked image").toBeTruthy();
      expect(classifyResponseType(t, "pbf").refuse, String(t) + " asked pbf").toBeTruthy();
    }
  });
});

/* ───────────────────────── C5: the whole function against attacks ───────────────────────── */
const res = (status, headers = {}, body = "{}") => new Response(body, { status, headers });
const JSONCT = { "content-type": "application/json; charset=UTF-8" };
const run = async (url, init, upstream = () => res(200, JSONCT)) => {
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (u, i) => { calls.push({ url: String(u), init: i }); return upstream(calls.length, String(u), i); }));
  const u = new URL(url);
  const segs = u.pathname.replace(/^\/gis-proxy\//, "").split("/");
  const out = await onRequest({ request: new Request(url, init), params: { path: segs } });
  return { out, calls };
};
afterEach(() => vi.unstubAllGlobals());
const H = "https://planyr.io/gis-proxy/www.bartowgis.org";
const Q = `${H}/arcgis/rest/services/BartowZoning/MapServer/0/query`;
const FORM = { "content-type": "application/x-www-form-urlencoded" };
const RQ = "/arcgis/rest/services/B/MapServer/0/query";

describe("C5. the relay against the attacks in the review (each paired with the legitimate request it must not block)", () => {
  it("CONTROL: a plain layer query is relayed, as JSON, with the security headers", async () => {
    const { out, calls } = await run(`${Q}?where=1%3D1&f=json`);
    expect(out.status).toBe(200);
    expect(calls[0].url).toBe("https://www.bartowgis.org/arcgis/rest/services/BartowZoning/MapServer/0/query?where=1%3D1&f=json");
    expect(out.headers.get("content-type")).toMatch(/^application\/json/);
    expect(out.headers.get("x-content-type-options")).toBe("nosniff");
    expect(out.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(out.headers.get("content-disposition")).toBe("attachment");
  });
  it("HTML from an allow-listed host is refused with a JSON error, never served (and the status survives)", async () => {
    const html = "<html><script>fetch('/api/x')</script></html>";
    const { out } = await run(`${H}/arcgis/rest/services?f=json`, {}, () => res(200, { "content-type": "text/html; charset=utf-8" }, html));
    expect(out.status).toBe(502);
    expect(out.headers.get("content-type")).toMatch(/^application\/json/);
    const j = await out.json();
    expect(j.error).toMatch(/text\/html/);
    expect(JSON.stringify(j)).not.toContain("<script>");
    const e404 = await run(`${Q}?f=json`, {}, () => res(404, { "content-type": "text/html" }, "<h1>nope</h1>"));
    expect(e404.out.status).toBe(404);
  });
  it("SVG, XML and JavaScript are refused", async () => {
    for (const t of ["image/svg+xml", "application/xml", "text/xml", "application/javascript", "text/javascript"]) {
      const { out } = await run(`${Q}?f=json`, {}, () => res(200, { "content-type": t }, "<svg onload=alert(1)/>"));
      expect(out.status, t).toBe(502);
      expect((await out.json()).error, t).toMatch(/does not serve/);
    }
  });
  it("f=html is rewritten to f=json before it reaches the upstream, and so is a missing f; callback is dropped", async () => {
    for (const [qs, want] of [["?f=html&where=1", "?where=1&f=json"], ["?where=1", "?where=1&f=json"], ["?f=jsapi", "?f=json"], ["?f=json&callback=alert(1)", "?f=json"]]) {
      const { calls } = await run(`${Q}${qs}`);
      expect(calls[0].url, qs).toBe(`https://www.bartowgis.org/arcgis/rest/services/BartowZoning/MapServer/0/query${want}`);
    }
    const ctl = await run(`${Q}?f=pbf&where=1`);
    expect(ctl.calls[0].url).toMatch(/\?f=pbf&where=1$/); // a format the app consumes is not touched
  });
  it("a POST body's f=html is rewritten too; a non-urlencoded POST is refused (415)", async () => {
    const { calls } = await run(Q, { method: "POST", body: "where=1&f=html", headers: FORM });
    expect(String(calls[0].init.body)).toBe("where=1&f=json");
    const multi = await run(Q, { method: "POST", body: "--x\r\n", headers: { "content-type": "multipart/form-data; boundary=x" } });
    expect(multi.out.status).toBe(415);
    expect(multi.calls.length).toBe(0);
    const ok = await run(Q, { method: "POST", body: "where=1&f=json", headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" } });
    expect(ok.out.status).toBe(200);
  });
  it("POST applyEdits (and every write verb) never reaches the upstream — GET or POST", async () => {
    for (const op of ["applyEdits", "addFeatures", "updateFeatures", "deleteFeatures", "calculate"]) {
      for (const method of ["POST", "GET"]) {
        const { out, calls } = await run(`${H}/arcgis/rest/services/Edit/FeatureServer/0/${op}`, method === "POST" ? { method, body: "f=json&features=[]", headers: FORM } : {});
        expect(out.status, `${method} ${op}`).toBe(403);
        expect(calls.length, `${method} ${op}`).toBe(0);
      }
    }
    const ctl = await run(Q, { method: "POST", body: "f=json&where=1%3D1", headers: FORM });
    expect(ctl.calls.length).toBe(1); // the read POST goes through
  });
  it("admin and token paths are refused, not forwarded", async () => {
    for (const p of ["arcgis/admin?f=json", "arcgis/admin/services", "arcgis/tokens/generateToken", "sharing/rest/generateToken"]) {
      const { out, calls } = await run(`${H}/${p}`);
      expect(out.status, p).toBe(403);
      expect(calls.length, p).toBe(0);
    }
    expect((await run(`${H}/arcgis/rest/services?f=json`)).calls.length).toBe(1);
  });
  it("path traversal — raw, %-encoded, double-encoded and backslash — never builds an upstream URL", async () => {
    for (const p of ["arcgis/../admin", "arcgis/%2e%2e/admin", "arcgis/%2E%2E/admin", "arcgis/..%2fadmin", "arcgis%2f..%2fadmin", "arcgis/a%5c..%5cadmin", "arcgis/%252e%252e/admin", "arcgis/a%00/b"]) {
      const { out, calls } = await run(`${H}/${p}`);
      expect([400, 403], p).toContain(out.status);
      expect(calls.length, p).toBe(0);
    }
  });
  it("a host that is not allow-listed is refused (403), including look-alikes and userinfo tricks", async () => {
    for (const h of ["evil.example.com", "www.bartowgis.org.evil.com", "bartowgis.org", "www.bartowgis.org@evil.com", "localhost", "169.254.169.254"]) {
      const { out, calls } = await run(`https://planyr.io/gis-proxy/${h}/arcgis/rest/services/X/MapServer/0/query`);
      expect(out.status, h).toBe(403);
      expect(calls.length, h).toBe(0);
    }
  });
  it("text/plain-labelled JSON from ArcGIS is re-labelled JSON; a text/plain answer to an image request is refused", async () => {
    const a = await run(`${Q}?f=json`, {}, () => res(200, { "content-type": "text/plain" }, '{"features":[]}'));
    expect(a.out.headers.get("content-type")).toMatch(/^application\/json/);
    expect(await a.out.json()).toEqual({ features: [] });
    const b = await run(`${H}/arcgis/rest/services/X/MapServer/export?f=image`, {}, () => res(200, { "content-type": "text/plain" }, "<html>"));
    expect(b.out.status).toBe(502);
  });
  it("an image tile is passed as an image with no attachment disposition; every response carries nosniff + CSP, errors included", async () => {
    const { out } = await run(`${H}/arcgis/rest/services/X/MapServer/export?f=image&bbox=1,2,3,4`, {}, () => res(200, { "content-type": "image/png" }, "PNG"));
    expect(out.headers.get("content-type")).toBe("image/png");
    expect(out.headers.get("content-disposition")).toBeNull();
    expect(out.headers.get("x-content-type-options")).toBe("nosniff");
    for (const r of [await run(`https://planyr.io/gis-proxy/nope.example/x`), await run(`${H}/arcgis/admin`), await run(`${Q}?f=json`, {}, () => res(500, { "content-type": "text/html" }, "x"))]) {
      expect(r.out.headers.get("x-content-type-options")).toBe("nosniff");
      expect(r.out.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    }
  });
  it("nothing of the upstream's own headers rides through (no Set-Cookie, Location or Content-Disposition)", async () => {
    const { out } = await run(`${Q}?f=json`, {}, () => res(200, { ...JSONCT, "set-cookie": "sid=1", "content-disposition": "inline", "x-frame-options": "ALLOWALL" }));
    expect(out.headers.get("set-cookie")).toBeNull();
    expect(out.headers.get("content-disposition")).toBe("attachment");
    expect(out.headers.get("x-frame-options")).toBeNull();
  });
  it("resolveUpstream carries the vetted format and method into the URL it builds", () => {
    const r = resolveUpstream(["www.bartowgis.org", "arcgis", "rest", "services", "My Folder", "MapServer", "0", "query"], "?f=html", "POST");
    expect(r.url).toBe("https://www.bartowgis.org/arcgis/rest/services/My%20Folder/MapServer/0/query?f=json");
    expect(r.fmt).toBe("json");
  });
});

/* ───────────────────────── D: redirects (#2705, kept) ───────────────────────── */
describe("D. redirects are re-checked against the allow-list", () => {
  it("asks fetch NOT to follow redirects itself", async () => {
    const { calls } = await run(`${Q}?f=json`);
    expect(calls[0].init.redirect).toBe("manual");
  });
  it("a redirect to a host that is not allow-listed is refused (502), not relayed", async () => {
    const { out, calls } = await run(`${Q}?f=json`, {}, () => res(302, { location: "https://evil.example.com/steal" }));
    expect(out.status).toBe(502);
    expect(calls.length).toBe(1); // never even asked the second host
    expect((await out.json()).error).toMatch(/evil\.example\.com/);
  });
  it("a redirect to plain http is refused even for an allow-listed host", async () => {
    const { out } = await run(`${Q}?f=json`, {}, () => res(301, { location: "http://www.bartowgis.org/arcgis/rest/services/B/MapServer/0/query" }));
    expect(out.status).toBe(502);
  });
  it("a redirect to another allow-listed host is followed and its answer returned (and the second hop's TYPE is vetted too)", async () => {
    const { out, calls } = await run(`${Q}?f=json`, {}, (n) => (n === 1 ? res(301, { location: "https://maps.tdec.tn.gov/arcgis/rest/services/B/MapServer/0/query?f=json" }) : res(200, JSONCT, '{"ok":1}')));
    expect(out.status).toBe(200);
    expect(await out.json()).toEqual({ ok: 1 });
    expect(calls.map((c) => c.url)).toEqual([`https://www.bartowgis.org/arcgis/rest/services/BartowZoning/MapServer/0/query?f=json`, "https://maps.tdec.tn.gov/arcgis/rest/services/B/MapServer/0/query?f=json"]);
    const html = await run(`${Q}?f=json`, {}, (n) => (n === 1 ? res(301, { location: "https://maps.tdec.tn.gov/arcgis/rest/services/B/MapServer/0/query" }) : res(200, { "content-type": "text/html" }, "<html>")));
    expect(html.out.status).toBe(502);
  });
  it("a relative Location stays on the same host", async () => {
    const { calls } = await run(`${Q}?f=json`, {}, (n) => (n === 1 ? res(302, { location: "/arcgis/rest/services/B/MapServer/0/query" }) : res(200, JSONCT)));
    expect(calls[1].url).toBe("https://www.bartowgis.org/arcgis/rest/services/B/MapServer/0/query?f=json");
  });
  it("gives up after MAX_REDIRECTS hops and when Location is missing", async () => {
    const loop = await run(`${Q}?f=json`, {}, () => res(302, { location: "https://www.bartowgis.org/arcgis/rest/services/B/MapServer/0/query" }));
    expect(loop.out.status).toBe(502);
    expect(loop.calls.length).toBe(MAX_REDIRECTS + 1);
    const none = await run(`${Q}?f=json`, {}, () => res(302));
    expect(none.out.status).toBe(502);
  });
  it("a POST keeps its body across 307 and becomes a GET across 302", async () => {
    const post = (status) => run(Q, { method: "POST", body: "f=json", headers: FORM }, (n) => (n === 1 ? res(status, { location: "https://www.bartowgis.org/arcgis/rest/services/B/MapServer/0/query" }) : res(200, JSONCT)));
    const keep = await post(307);
    expect(keep.calls[1].init.method).toBe("POST");
    expect(keep.calls[1].init.body).toBeTruthy();
    const drop = await post(302);
    expect(drop.calls[1].init.method).toBe("GET");
    expect(drop.calls[1].init.body).toBeUndefined();
  });
  it("a redirect to an allow-listed host's ADMIN / WRITE path is refused, GET or POST — the next hop is held to the first hop's rules", async () => {
    for (const loc of ["https://www.bartowgis.org/arcgis/admin/services/x/delete", "https://www.bartowgis.org/arcgis/rest/services/x/FeatureServer/0/applyEdits?edits=%5B%5D&f=json", "https://www.bartowgis.org/wp-admin/post.php/delete/5", "https://www.bartowgis.org/arcgis/rest/services/x/../../admin"]) {
      const g = await run(`${Q}?f=json`, {}, () => res(302, { location: loc }));
      expect(g.out.status, loc).toBe(502);
      expect(g.calls.length, loc).toBe(1);
    }
    const p = await run(Q, { method: "POST", body: "adds=%5B%7B%7D%5D&f=json", headers: FORM }, () => res(307, { location: "https://www.bartowgis.org/arcgis/rest/services/x/FeatureServer/0/applyEdits" }));
    expect(p.out.status).toBe(502);
    expect(p.calls.length).toBe(1); // the POST body was never replayed at the write endpoint
    const html = await run(`${Q}?f=json`, {}, (n) => (n === 1 ? res(302, { location: `https://www.bartowgis.org${RQ}?f=html&callback=x` }) : res(200, JSONCT)));
    expect(html.calls[1].url).toBe(`https://www.bartowgis.org${RQ}?f=json`); // the redirect's own query is vetted too
  });
  it("redirectTarget and isRedirectStatus are the pure halves", () => {
    for (const s of [301, 302, 303, 307, 308]) expect(isRedirectStatus(s)).toBe(true);
    for (const s of [200, 304, 404, 500]) expect(isRedirectStatus(s)).toBe(false);
    expect(redirectTarget(res(302, { location: "https://tnmap.tn.gov/arcgis/rest/services/B/MapServer/0/query" }), "https://www.bartowgis.org/a", "GET").url).toBe("https://tnmap.tn.gov/arcgis/rest/services/B/MapServer/0/query?f=json");
    expect(redirectTarget(res(302, { location: "https://nope.example/arcgis/rest/services/B/MapServer/0/query" }), "https://www.bartowgis.org/a", "GET").error).toMatch(/allow-list/);
  });
});
