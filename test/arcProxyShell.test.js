import { describe, it, expect, vi, afterEach } from "vitest";
import { makeArcProxy } from "../functions/api/lib/arcProxyShell.js";
import { json, bearer, serviceHeaders, safeEqual } from "../functions/api/lib/http.js";
import { onRequest as okproxy } from "../functions/okparcels/[[path]].js";
import { onRequest as gcproxy } from "../functions/gc/[[path]].js";
import { onRequest as mgproxy } from "../functions/mg/[[path]].js";

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

const arcError = (code, message) => ({ error: { code, message } });
const ctx = (path, { method = "GET", qs = "", body } = {}) => ({
  request: new Request(`https://x.test/p/${path}${qs}`, { method, body, headers: body ? { "content-type": "application/x-www-form-urlencoded" } : {} }),
  params: { path: path.split("/") },
});
const mk = (over = {}) => makeArcProxy({
  arcError, timeoutMs: 50,
  parsePath: (segs) => (segs[0] === "bad" ? { error: "nope" } : { op: segs[1] === "meta" ? "meta" : "query" }),
  metadata: () => ({ meta: true }),
  translate: (params) => { if (params.where === "evil") { const e = new Error("bad where"); e.mgBadRequest = true; throw e; } return { params: { a: "1" } }; },
  upstreamUrl: () => "https://up.test/x?a=1",
  toArc: (gj) => ({ features: gj.features }),
  messages: { status: (p, r) => `status ${r ? r.status : "none"}`, unreadable: () => "unreadable", unexpected: () => "unexpected", failed: () => "failed" },
  ...over,
});
const read = async (r) => ({ status: r.status, body: await r.json(), cache: r.headers.get("cache-control") });

describe("arcProxyShell — the one HTTP shell for /gc /mg /okparcels", () => {
  it("refuses non-GET/POST (405) and unknown paths (404)", async () => {
    const h = mk();
    expect((await read(await h(ctx("a/q", { method: "PUT" })))).status).toBe(405);
    const r = await read(await h(ctx("bad/q")));
    expect(r.status).toBe(404); expect(r.body.error.message).toBe("nope");
  });
  it("serves static metadata with a one-hour cache", async () => {
    const r = await read(await mk()(ctx("a/meta")));
    expect(r).toEqual({ status: 200, body: { meta: true }, cache: "public, max-age=3600" });
  });
  it("a bad query is ArcGIS-style HTTP 200 + {error}, never a throw", async () => {
    const r = await read(await mk()(ctx("a/q", { qs: "?where=evil" })));
    expect(r.status).toBe(200); expect(r.body.error.code).toBe(400);
  });
  it("success passes the answer through with a five-minute cache; POST bodies merge into params", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ features: [1] }), { status: 200 })));
    const seen = [];
    const h = mk({ translate: (p) => { seen.push(p); return { params: {} }; } });
    const r = await read(await h(ctx("a/q", { method: "POST", body: "where=1%3D1" })));
    expect(r).toEqual({ status: 200, body: { features: [1] }, cache: "public, max-age=300" });
    expect(seen[0].where).toBe("1=1");
  });
  it("upstream non-OK, unreadable and thrown answers are loud 502s with the proxy's own sentences", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 503 })));
    expect((await read(await mk()(ctx("a/q")))).body.error.message).toBe("status 503");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { status: 200 })));
    expect((await read(await mk()(ctx("a/q")))).body.error.message).toBe("unreadable");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("boom"); }));
    const r = await read(await mk()(ctx("a/q")));
    expect(r.status).toBe(502); expect(r.body.error.message).toBe("failed");
  });
  it("validate() failure is the 'unexpected' 502; retry earns exactly one more try on a 5xx", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ nope: 1 }), { status: 200 })));
    const h = mk({ validate: (g) => Array.isArray(g.features) });
    expect((await read(await h(ctx("a/q")))).body.error.message).toBe("unexpected");
    const f = vi.fn().mockResolvedValueOnce(new Response("x", { status: 502 })).mockResolvedValueOnce(new Response(JSON.stringify({ features: [] }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    const r = await read(await mk({ retry: { pauseMs: 1 } })(ctx("a/q")));
    expect(f).toHaveBeenCalledTimes(2); expect(r.status).toBe(200);
  });
});

describe("the three real proxies are wired through the shell", () => {
  it.each([["okparcels", okproxy, "FeatureServer/0/query"], ["gc", gcproxy, "x/FeatureServer/0/query"], ["mg", mgproxy, "x/Y/FeatureServer/0/query"]])("%s answers 405 for PUT and a 404 ArcGIS error for a bad path", async (_n, h) => {
    expect((await h(ctx("a", { method: "PUT" }))).status).toBe(405);
    const r = await read(await h(ctx("../zzz/nope")));
    expect([404, 200]).toContain(r.status);
    expect(r.body.error).toBeTruthy();
  });
});

describe("http.js helpers", () => {
  it("json merges extra headers after the content type", async () => {
    const r = json({ a: 1 }, 201, { "cache-control": "no-store" });
    expect(r.status).toBe(201);
    expect(r.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
  it("bearer strips the scheme, empty when absent; serviceHeaders carries both header forms", () => {
    expect(bearer(new Request("https://x", { headers: { authorization: "Bearer abc" } }))).toBe("abc");
    expect(bearer(new Request("https://x"))).toBe("");
    expect(serviceHeaders("k", { z: 1 })).toEqual({ apikey: "k", authorization: "Bearer k", z: 1 });
  });
  it("safeEqual is the one constant-time comparison", async () => {
    expect(await safeEqual("a", "a")).toBe(true);
    expect(await safeEqual("a", "b")).toBe(false);
  });
});

describe("no route re-declares the shared helpers (audit batch I7)", () => {
  it("no functions/ file other than http.js builds its own JSON Response helper or service-role headers", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : p.endsWith(".js") ? [p] : []; });
    const bad = [];
    for (const f of walk("functions")) {
      if (f.endsWith("drive/selftest.js") || f.endsWith("lib/http.js") || f.endsWith("lib/arcProxyShell.js") || f.includes("gis-proxy")) continue;
      const s = readFileSync(f, "utf8");
      if (/const json = \([^)]*\) =>\s*new Response\(JSON\.stringify/.test(s)) bad.push(`${f}: own json()`);
      if (/apikey: [^,}]+, authorization: `Bearer \$\{[^}]+\}`/.test(s)) bad.push(`${f}: hand-built service headers`);
    }
    expect(bad).toEqual([]);
  });
});
