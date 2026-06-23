import { describe, it, expect } from "vitest";
import {
  classifyGisError, gisErrorMessage, backoffMs, fetchArcgisJson, pLimit, GisFetchError,
} from "../src/workspaces/site-planner/lib/gisFetch.js";

const noSleep = async () => {};
const ok = (body) => ({ ok: true, status: 200, json: async () => body });

describe("classifyGisError — honest taxonomy, never a blind 'CORS' (B366)", () => {
  it("a raw 'Failed to fetch' is reported as couldn't-reach, NOT CORS, and is retryable", () => {
    const c = classifyGisError(new TypeError("Failed to fetch"));
    expect(c.kind).toBe("network");
    expect(c.retryable).toBe(true);
    expect(c.message).not.toMatch(/CORS/);
    expect(c.message).toMatch(/reach|temporarily/i);
  });
  it("an AbortError is a retryable timeout", () => {
    const e = new Error("aborted"); e.name = "AbortError";
    const c = classifyGisError(e);
    expect(c.kind).toBe("timeout");
    expect(c.retryable).toBe(true);
  });
  it("a typed http-5xx passes through with its honest message", () => {
    const e = new GisFetchError("http-5xx", "The GIS source returned HTTP 503 — temporarily unavailable.", { status: 503, retryable: true });
    const c = classifyGisError(e);
    expect(c.kind).toBe("http-5xx");
    expect(c.status).toBe(503);
    expect(c.message).toMatch(/503/);
  });
  it("gisErrorMessage gives the one-line honest text", () => {
    expect(gisErrorMessage(new TypeError("Failed to fetch"))).not.toMatch(/CORS/);
  });
});

describe("backoffMs — jittered exponential", () => {
  it("doubles per attempt; jitter stays within [base, 2*base) of the floor", () => {
    expect(backoffMs(0, 300, () => 0)).toBe(300);
    expect(backoffMs(1, 300, () => 0)).toBe(600);
    expect(backoffMs(2, 300, () => 0)).toBe(1200);
    const j = backoffMs(0, 300, () => 0.5);
    expect(j).toBeGreaterThanOrEqual(300);
    expect(j).toBeLessThan(600);
  });
});

describe("fetchArcgisJson — timeout + transient retry + GET→POST (B366)", () => {
  const url = "https://x/MapServer/0/query?f=json&where=1=1";

  it("returns parsed JSON on success", async () => {
    const j = await fetchArcgisJson(url, { fetchImpl: async () => ok({ features: [{ a: 1 }] }), sleepImpl: noSleep });
    expect(j.features[0].a).toBe(1);
  });

  it("retries a transient 503 and then succeeds", async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return calls < 3 ? { ok: false, status: 503 } : ok({ features: [] }); };
    const j = await fetchArcgisJson(url, { fetchImpl, sleepImpl: noSleep, retries: 2 });
    expect(calls).toBe(3); // two 503s, third OK
    expect(j.features).toEqual([]);
  });

  it("gives up after the retry budget on a persistent 503 — honest message, not CORS", async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return { ok: false, status: 503 }; };
    await expect(fetchArcgisJson(url, { fetchImpl, sleepImpl: noSleep, retries: 2 }))
      .rejects.toMatchObject({ kind: "http-5xx", status: 503 });
    expect(calls).toBe(3); // 1 + 2 retries
    try { await fetchArcgisJson(url, { fetchImpl, sleepImpl: noSleep, retries: 2 }); }
    catch (e) { expect(e.message).toMatch(/503.*unavailable/i); expect(e.message).not.toMatch(/CORS/); expect(e.diag.httpStatus).toBe(503); }
  });

  it("does NOT retry a 4xx (a real reject, not a blip)", async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return { ok: false, status: 400 }; };
    await expect(fetchArcgisJson(url, { fetchImpl, sleepImpl: noSleep, retries: 2 }))
      .rejects.toMatchObject({ kind: "http-4xx", status: 400 });
    expect(calls).toBe(1);
  });

  it("treats an HTTP-200 ArcGIS {error} body as a failure (not a silent success), no retry", async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return ok({ error: { code: 400, message: "Failed to execute query." } }); };
    await expect(fetchArcgisJson(url, { fetchImpl, sleepImpl: noSleep, retries: 2 }))
      .rejects.toMatchObject({ kind: "arcgis" });
    expect(calls).toBe(1);
  });

  it("retries a network TypeError then surfaces it honestly", async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; throw new TypeError("Failed to fetch"); };
    await expect(fetchArcgisJson(url, { fetchImpl, sleepImpl: noSleep, retries: 2 }))
      .rejects.toMatchObject({ kind: "network" });
    expect(calls).toBe(3);
  });

  it("POSTs when the GET URL is over-long (dodges server URL caps)", async () => {
    let seen = null;
    const fetchImpl = async (target, init) => { seen = { target, init }; return ok({ features: [] }); };
    const longUrl = "https://x/MapServer/0/query?f=json&geometry=" + "x".repeat(4000);
    await fetchArcgisJson(longUrl, { fetchImpl, sleepImpl: noSleep });
    expect(seen.init.method).toBe("POST");
    expect(seen.target).toBe("https://x/MapServer/0/query"); // querystring moved to the body
    expect(seen.init.body).toMatch(/f=json/);
    expect(seen.init.body).toMatch(/geometry=x+/);
  });

  it("POSTs when an explicit params body is passed", async () => {
    let seen = null;
    const fetchImpl = async (target, init) => { seen = { target, init }; return ok({ features: [] }); };
    await fetchArcgisJson("https://x/MapServer/0/query", { body: { f: "json", where: "1=1" }, fetchImpl, sleepImpl: noSleep });
    expect(seen.init.method).toBe("POST");
    expect(seen.init.body).toMatch(/where=1/);
  });
});

describe("pLimit — concurrency cap (the throttle that stops the burst, B366)", () => {
  it("runs at most N tasks at once and resolves every task in order", async () => {
    const lim = pLimit(2);
    let active = 0, max = 0;
    const waiters = [];
    const task = (i) => lim(async () => {
      active++; max = Math.max(max, active);
      await new Promise((res) => waiters.push(res));
      active--; return i;
    });
    const ps = [0, 1, 2, 3, 4].map(task);
    const tick = () => new Promise((r) => setTimeout(r, 0));
    await tick();
    expect(active).toBe(2);        // pool started exactly 2
    expect(waiters.length).toBe(2);
    // drain: resolve everything pending, tick, repeat until all five finish
    for (let i = 0; i < 30 && active > 0; i++) { while (waiters.length) waiters.shift()(); await tick(); }
    const out = await Promise.all(ps);
    expect(out).toEqual([0, 1, 2, 3, 4]);
    expect(max).toBe(2);           // never more than the cap in flight
  });

  it("a thrown task rejects its own promise without stalling the pool", async () => {
    const lim = pLimit(1);
    const a = lim(async () => { throw new Error("boom"); });
    const b = lim(async () => "ok");
    await expect(a).rejects.toThrow("boom");
    await expect(b).resolves.toBe("ok");
  });
});
