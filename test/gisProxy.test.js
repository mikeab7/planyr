import { describe, it, expect, vi, afterEach } from "vitest";
import { onRequest, resolveUpstream, ALLOWED_HOSTS } from "../functions/gis-proxy/[[path]].js";

const SGRC_PATH = "www.sgrcmaps.com/alma/rest/services/Tift/Tift_Parcels/MapServer/0";

function req(path, { method = "GET", body = null, headers = {} } = {}) {
  return new Request(`https://planyr.io/gis-proxy/${path}`, { method, body, headers });
}
function segsFor(path) {
  const [pathOnly] = path.split("?");
  return pathOnly.split("/").filter(Boolean);
}
function call(path, opts) {
  return onRequest({ request: req(path, opts), params: { path: segsFor(path) } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("resolveUpstream — pure URL building + guards", () => {
  it("builds the https upstream URL from host + path segments, query intact", () => {
    const r = resolveUpstream(["www.sgrcmaps.com", "alma", "rest", "services", "Tift", "Tift_Parcels", "MapServer", "0"], "?f=json&where=1%3D1");
    expect(r.error).toBeUndefined();
    expect(r.url).toBe("https://www.sgrcmaps.com/alma/rest/services/Tift/Tift_Parcels/MapServer/0?f=json&where=1%3D1");
    expect(r.host).toBe("www.sgrcmaps.com");
  });

  it("no query string → no trailing '?'", () => {
    const r = resolveUpstream(["www.sgrcmaps.com", "x"], "");
    expect(r.url).toBe("https://www.sgrcmaps.com/x");
  });

  it("a host not on the allow-list is refused (403, JSON, named 'host not allowed')", async () => {
    const r = resolveUpstream(["example.com", "x"], "");
    expect(r.error).toBeInstanceOf(Response);
    expect(r.error.status).toBe(403);
    expect(await r.error.json()).toEqual({ error: "host not allowed" });
  });

  it("a '..' path segment is refused (400) — no path traversal", async () => {
    const r = resolveUpstream(["www.sgrcmaps.com", "..", "etc"], "");
    expect(r.error).toBeInstanceOf(Response);
    expect(r.error.status).toBe(400);
    expect(await r.error.json()).toEqual({ error: "invalid path" });
  });

  it("every host the dispatch named is allow-listed", () => {
    expect(ALLOWED_HOSTS.has("www.sgrcmaps.com")).toBe(true);
    expect(ALLOWED_HOSTS.has("mgrcmaps.org")).toBe(true);
    expect(ALLOWED_HOSTS.has("maps.crc.ga.gov")).toBe(true);
  });
});

describe("onRequest — GET", () => {
  it("forwards an allow-listed host's GET with the query string intact, and passes the body through", async () => {
    const fetchMock = vi.fn(async (url) => {
      expect(url).toBe(`https://${SGRC_PATH}?f=json`);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await call(`${SGRC_PATH}?f=json`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.method).toBe("GET");
    expect(opts.headers["user-agent"]).toBe("planyr-gis-proxy");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("a disallowed host never reaches fetch — 403", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await call("example.com/anything?f=json");
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("'..' in the path never reaches fetch — 400", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await call("www.sgrcmaps.com/../secret");
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("an unsupported method is refused before any fetch (405)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await call(SGRC_PATH, { method: "DELETE" });
    expect(res.status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("onRequest — POST", () => {
  it("forwards the POST body and its Content-Type to the upstream host", async () => {
    const fetchMock = vi.fn(async (url, opts) => {
      expect(url).toBe(`https://${SGRC_PATH}/query`);
      expect(opts.method).toBe("POST");
      expect(opts.headers["content-type"]).toBe("application/x-www-form-urlencoded");
      expect(new TextDecoder().decode(opts.body)).toBe("where=1%3D1&f=json");
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await call(`${SGRC_PATH}/query`, {
      method: "POST",
      body: "where=1%3D1&f=json",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("onRequest — upstream failure / timeout", () => {
  it("an upstream that never answers within the bound is aborted and reported as a named 502", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((url, opts) => new Promise((_resolve, reject) => {
      opts.signal.addEventListener("abort", () => {
        const e = new Error("aborted");
        e.name = "AbortError";
        reject(e);
      });
    }));
    vi.stubGlobal("fetch", fetchMock);
    const pending = call(`${SGRC_PATH}?f=json`);
    await vi.advanceTimersByTimeAsync(20000);
    const res = await pending;
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/www\.sgrcmaps\.com/);
    expect(body.host).toBe("www.sgrcmaps.com");
  });

  it("a synchronous upstream fetch failure (DNS/network) is also a named 502, not a crash", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    const res = await call(`${SGRC_PATH}?f=json`);
    expect(res.status).toBe(502);
    expect((await res.json()).host).toBe("www.sgrcmaps.com");
  });
});

describe("onRequest — response hygiene", () => {
  it("strips Set-Cookie (and every other upstream header) — only content-type + cache-control ride through", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json", "set-cookie": "sid=abc123; HttpOnly", "x-upstream-only": "1" },
    })));
    const res = await call(`${SGRC_PATH}?f=json`);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("x-upstream-only")).toBeNull();
    expect(res.headers.get("content-type")).toBe("application/json");
  });

  it("caches only a genuine 200 — an upstream error response is never cached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })));
    const ok = await call(`${SGRC_PATH}?f=json`);
    expect(ok.headers.get("cache-control")).toBe("public, max-age=300");

    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    const bad = await call(`${SGRC_PATH}?f=json`);
    expect(bad.status).toBe(500);
    expect(bad.headers.get("cache-control")).toBe("no-store");
  });

  it("never forwards the client's own cookie or Authorization header upstream", async () => {
    const fetchMock = vi.fn(async (_url, opts) => {
      expect(opts.headers.cookie).toBeUndefined();
      expect(opts.headers.authorization).toBeUndefined();
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    await call(`${SGRC_PATH}?f=json`, { headers: { cookie: "sid=mine", authorization: "Bearer x" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
