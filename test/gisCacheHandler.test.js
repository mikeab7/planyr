import { describe, it, expect } from "vitest";
import { handleGisCache, originOk } from "../functions/api/gis-cache/_handler.js";
import { proxyServiceUrl, b64urlEncode, parseUpstream, cacheKey } from "../src/shared/gis/gisProxyCore.js";

const SERVICE = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer";
const SEGS = ["svc", b64urlEncode(SERVICE), "export"];
const SEARCH = "?bbox=1,2,3,4&size=256,256&f=image";

// Reconstruct the upstream URL + cache key exactly as the handler does (it re-encodes the
// query through URLSearchParams), so a seeded copy matches what a request will look up.
function reconstruct(segs, search) {
  const sp = new URLSearchParams(search);
  sp.delete("meta");
  return parseUpstream(segs, sp.toString()).url;
}
const keyFor = (segs, search) => `${cacheKey(reconstruct(segs, search))}.bin`;

// A minimal in-memory Drive client matching the methods the handler uses. Files carry a
// modifiedTime so freshness can be exercised with an injected clock.
function fakeDrive(now = () => Date.now()) {
  let seq = 0;
  const files = []; // { id, name, modifiedTime, bytes, contentType }
  return {
    _files: files,
    calls: { create: 0, del: 0, media: 0, find: 0 },
    async findFile(name) {
      this.calls.find++;
      const matches = files.filter((f) => f.name === name).sort((a, b) => Date.parse(b.modifiedTime) - Date.parse(a.modifiedTime));
      return matches[0] || null;
    },
    async media(id) {
      this.calls.media++;
      const f = files.find((x) => x.id === id);
      return { bytes: f.bytes, contentType: f.contentType, name: f.name };
    },
    async create({ bytes, contentType, name }) {
      this.calls.create++;
      const f = { id: `f${++seq}`, name, modifiedTime: new Date(now()).toISOString(), bytes, contentType };
      files.push(f);
      return { id: f.id };
    },
    async list() { return files.map((f) => ({ id: f.id, name: f.name })); },
    async del(id) { this.calls.del++; const i = files.findIndex((f) => f.id === id); if (i >= 0) files.splice(i, 1); },
  };
}
const folderIdFor = async () => "folder1";
const okFetch = (body = "IMG", ct = "image/png") => async () => new Response(body, { status: 200, headers: { "content-type": ct } });
const downFetch = () => async () => new Response("err", { status: 503 });
const throwFetch = () => async () => { throw new Error("network"); };
// Collect deferred background work so the test can await it deterministically.
function deferBag() { const jobs = []; return { defer: (p) => jobs.push(p), settle: () => Promise.all(jobs) }; }

describe("handleGisCache — cache miss", () => {
  it("fetches the agency, serves the bytes, and stores a copy in the background", async () => {
    const client = fakeDrive();
    const bag = deferBag();
    const res = await handleGisCache({ client, segs: SEGS, search: SEARCH, fetchImpl: okFetch("HELLO"), folderIdFor, defer: bag.defer });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(await res.text()).toBe("HELLO");
    await bag.settle();
    expect(client.calls.create).toBe(1);
    expect(client._files.length).toBe(1);
  });
});

describe("handleGisCache — cache hit", () => {
  it("serves the stored copy WITHOUT calling the agency when fresh", async () => {
    const client = fakeDrive(() => 1000);
    await client.create({ bytes: new Uint8Array([1]), contentType: "image/png", name: keyFor(SEGS, SEARCH) });
    let fetched = false;
    const res = await handleGisCache({
      client, segs: SEGS, search: SEARCH,
      fetchImpl: async () => { fetched = true; return new Response("X", { status: 200 }); },
      now: () => 2000, folderIdFor, defer: () => {},
    });
    expect(res.status).toBe(200);
    expect(fetched).toBe(false);
    expect(client.calls.media).toBe(1);
  });

  it("serves the stored copy AND refreshes in the background when stale", async () => {
    const t0 = 1000;
    const client = fakeDrive(() => t0);
    await client.create({ bytes: new Uint8Array([1]), contentType: "image/png", name: keyFor(SEGS, SEARCH) });
    client.calls.create = 0; // count only the background refresh
    const bag = deferBag();
    const farFuture = t0 + 5 * 24 * 60 * 60 * 1000; // well past the 1-day TTL
    const res = await handleGisCache({
      client, segs: SEGS, search: SEARCH, fetchImpl: okFetch("FRESH"),
      now: () => farFuture, folderIdFor, defer: bag.defer,
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBeDefined();
    await bag.settle();
    expect(client.calls.create).toBe(1); // a refresh wrote a new copy
  });
});

describe("handleGisCache — upstream fetch carries a browser User-Agent (gov hosts 403 a bare UA)", () => {
  it("sends a non-empty user-agent header when fetching the agency on a miss", async () => {
    let seenHeaders = null;
    const recordingFetch = async (_url, opts) => { seenHeaders = (opts && opts.headers) || {}; return new Response("IMG", { status: 200, headers: { "content-type": "image/png" } }); };
    const bag = deferBag();
    await handleGisCache({ client: fakeDrive(), segs: SEGS, search: SEARCH, fetchImpl: recordingFetch, folderIdFor, defer: bag.defer });
    expect(seenHeaders).toBeTruthy();
    expect(String(seenHeaders["user-agent"] || "")).toMatch(/Mozilla/);
  });
});

describe("handleGisCache — fail-open", () => {
  it("302-redirects to the real upstream when there are no Drive creds", async () => {
    const res = await handleGisCache({ client: null, segs: SEGS, search: SEARCH, folderIdFor });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(reconstruct(SEGS, SEARCH));
  });
  it("302-redirects when the agency errors on a cache miss", async () => {
    const res = await handleGisCache({ client: fakeDrive(), segs: SEGS, search: SEARCH, fetchImpl: downFetch(), folderIdFor, defer: () => {} });
    expect(res.status).toBe(302);
  });
  it("302-redirects when the agency is unreachable on a cache miss", async () => {
    const res = await handleGisCache({ client: fakeDrive(), segs: SEGS, search: SEARCH, fetchImpl: throwFetch(), folderIdFor, defer: () => {} });
    expect(res.status).toBe(302);
  });
});

describe("handleGisCache — bounded upstream timeout (NEW-1/B788)", () => {
  // A fetch that never settles on its own but rejects when its AbortSignal fires — models a
  // degraded agency (FEMA held/killed exports 20–30 s in the 2026-07-11 NFHL slowdown).
  const hangFetch = () => (url, init) => new Promise((_, reject) => {
    if (init && init.signal) init.signal.addEventListener("abort", () => reject(new Error("aborted")));
  });
  it("fails OPEN (302) instead of hanging when the agency never answers within the cap", async () => {
    const res = await handleGisCache({
      client: fakeDrive(), segs: SEGS, search: SEARCH, fetchImpl: hangFetch(),
      upstreamTimeoutMs: 10, folderIdFor, defer: () => {},
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(reconstruct(SEGS, SEARCH));
  });
  it("passes an AbortSignal on the upstream fetch (so the cap can actually abort it)", async () => {
    let sawSignal = false;
    const recFetch = async (_url, init) => { sawSignal = !!(init && init.signal); return new Response("IMG", { status: 200, headers: { "content-type": "image/png" } }); };
    await handleGisCache({ client: fakeDrive(), segs: SEGS, search: SEARCH, fetchImpl: recFetch, folderIdFor, defer: () => {} });
    expect(sawSignal).toBe(true);
  });
});

describe("handleGisCache — meta (age badge)", () => {
  it("reports cached:false with no upstream call when nothing is stored", async () => {
    let fetched = false;
    const res = await handleGisCache({
      client: fakeDrive(), segs: ["svc", b64urlEncode(SERVICE)], search: "?f=image&meta=1",
      fetchImpl: async () => { fetched = true; return new Response("x"); }, folderIdFor, defer: () => {},
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cached: false });
    expect(fetched).toBe(false);
  });
  it("reports cached:true with ts/age/stale for a stored copy", async () => {
    const client = fakeDrive(() => 1000);
    await client.create({ bytes: new Uint8Array([1]), contentType: "image/png", name: keyFor(["svc", b64urlEncode(SERVICE)], "?f=image&meta=1") });
    const res = await handleGisCache({
      client, segs: ["svc", b64urlEncode(SERVICE)], search: "?f=image&meta=1",
      now: () => 4000, folderIdFor, defer: () => {},
    });
    const body = await res.json();
    expect(body.cached).toBe(true);
    expect(body.ts).toBe(1000);
    expect(body.ageMs).toBe(3000);
    expect(body.stale).toBe(false);
  });
});

describe("handleGisCache — guards", () => {
  it("400s an unsupported / foreign-host request", async () => {
    const res = await handleGisCache({ client: fakeDrive(), segs: ["svc", b64urlEncode("https://evil.example.com/x/MapServer")], search: "?f=image", folderIdFor });
    expect(res.status).toBe(400);
  });
  it("403s a foreign Origin", async () => {
    const res = await handleGisCache({ client: fakeDrive(), segs: SEGS, search: SEARCH, origin: "https://evil.example.com", selfHost: "planyr.io", folderIdFor });
    expect(res.status).toBe(403);
  });
  it("originOk: same-origin (no Origin) and our hosts pass; foreign fails", () => {
    expect(originOk(null, "planyr.io")).toBe(true);
    expect(originOk("https://planyr.io", "planyr.io")).toBe(true);
    expect(originOk("https://abc.planyr.pages.dev", "planyr.io")).toBe(true);
    expect(originOk("https://evil.example.com", "planyr.io")).toBe(false);
  });
});

describe("proxyServiceUrl ↔ handler agree on the key seam", () => {
  it("the client's proxy URL decodes to the same service the handler reconstructs", () => {
    expect(proxyServiceUrl(SERVICE)).toBe(`/api/gis-cache/svc/${b64urlEncode(SERVICE)}`);
  });
});
