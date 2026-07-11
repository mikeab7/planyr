import { describe, it, expect } from "vitest";
import {
  CHUNK_SIZE, DRIVE_CHUNK_GRANULE, contentRangeFor, chunkPlan, backoffMs,
  uploadFileInChunks, QUOTA_MESSAGE,
} from "../src/shared/files/chunkedUpload.js";

/* Chunked uploads (B409 rework) — the pure chunk math and the browser upload loop against
 * a scripted /api/uploads/* server. No real network, no sleeps (both injected). */

describe("chunk math", () => {
  it("CHUNK_SIZE is 16 MiB and a multiple of Google's 256 KiB granule", () => {
    expect(CHUNK_SIZE).toBe(16777216);
    expect(CHUNK_SIZE % DRIVE_CHUNK_GRANULE).toBe(0); // Drive rejects non-multiples
  });

  it("contentRangeFor renders RFC-7233 inclusive ranges", () => {
    expect(contentRangeFor(0, 16777216, 125176019)).toBe("bytes 0-16777215/125176019");
    expect(contentRangeFor(117440512, 125176019, 125176019)).toBe("bytes 117440512-125176018/125176019"); // the final short chunk
  });

  it("plans a final short chunk", () => {
    const plan = chunkPlan(1000, 512 * 1024); // 1000 B in 512 KiB chunks → one short chunk
    expect(plan).toEqual([{ start: 0, end: 1000, last: true }]);
    const plan2 = chunkPlan(512 * 1024 + 10, 512 * 1024);
    expect(plan2).toEqual([
      { start: 0, end: 512 * 1024, last: false },
      { start: 512 * 1024, end: 512 * 1024 + 10, last: true },
    ]);
  });

  it("plans an exact-multiple boundary with no empty trailing chunk", () => {
    const plan = chunkPlan(2 * CHUNK_SIZE, CHUNK_SIZE);
    expect(plan.length).toBe(2);
    expect(plan[1]).toEqual({ start: CHUNK_SIZE, end: 2 * CHUNK_SIZE, last: true });
  });

  it("every non-final chunk is a multiple of 256 KiB (by construction) and bad sizes fail loudly", () => {
    const plan = chunkPlan(125176019); // the real GPL civil set size
    for (const c of plan.slice(0, -1)) expect((c.end - c.start) % DRIVE_CHUNK_GRANULE).toBe(0);
    expect(plan[plan.length - 1].end).toBe(125176019);
    expect(() => chunkPlan(100, 1000)).toThrow(/multiple/);
    expect(() => chunkPlan(100, 0)).toThrow(/multiple/);
  });

  it("backoff is exponential and capped", () => {
    expect([1, 2, 3, 4, 5, 9].map(backoffMs)).toEqual([1000, 2000, 4000, 8000, 16000, 16000]);
  });
});

/* A scripted same-origin server: routes /api/uploads/* by URL+method and records every
 * request. `script.chunk` may be a function (called per chunk PUT) for failure injection. */
function fakeServer(script) {
  const calls = [];
  const res = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const fetchImpl = async (url, opts = {}) => {
    const u = String(url);
    const call = { url: u, method: opts.method || "GET", headers: opts.headers || {}, body: opts.body };
    calls.push(call);
    if (u === "/api/uploads/start") return res(script.start);
    if (/\/api\/uploads\/[^/]+\/chunk$/.test(u)) return typeof script.chunk === "function" ? script.chunk(call, calls) : res(script.chunk);
    if (/\/api\/uploads\/[^/]+\/status$/.test(u)) return typeof script.status === "function" ? script.status(call) : res(script.status);
    if (/\/api\/uploads\/[^/]+\/complete$/.test(u)) return res(script.complete || { ok: true, planyrKey: "k" });
    throw new Error("unexpected fetch: " + u);
  };
  return { calls, fetchImpl };
}

const noSleep = async () => {};
const K = 1024;

describe("uploadFileInChunks — sequential chunks, resume, retry, quota", () => {
  it("uploads in order with correct Content-Range headers and reports progress", async () => {
    const file = new Blob([new Uint8Array(1000)]);
    let received = 0;
    const { calls, fetchImpl } = fakeServer({
      start: { ok: true, uploadId: "u1", chunkSize: 256 * K }, // server-chosen chunk size wins
      chunk: (call) => {
        const m = /^bytes (\d+)-(\d+)\/1000$/.exec(call.headers["content-range"]);
        received = Number(m[2]) + 1;
        const complete = received === 1000;
        return { ok: true, status: 200, json: async () => ({ ok: true, received, complete }) };
      },
    });
    const progress = [];
    const r = await uploadFileInChunks({
      file, token: "tok", planyrKey: "proj/a.pdf", name: "a.pdf", contentType: "application/pdf",
      fetchImpl, sleep: noSleep, onProgress: (n, t) => progress.push([n, t]),
    });
    expect(r).toEqual({ ok: true, driveKey: "proj/a.pdf" });
    // start + 1 chunk (1000 < 256 KiB → a single short chunk) + complete
    const chunks = calls.filter((c) => c.url.endsWith("/chunk"));
    expect(chunks.length).toBe(1);
    expect(chunks[0].headers["content-range"]).toBe("bytes 0-999/1000");
    expect(chunks[0].headers.authorization).toBe("Bearer tok");
    expect(progress[0]).toEqual([0, 1000]);
    expect(progress[progress.length - 1]).toEqual([1000, 1000]);
  });

  it("splits into multiple sequential chunks at the server-provided size", async () => {
    const total = 600 * K;
    const file = new Blob([new Uint8Array(total)]);
    const { calls, fetchImpl } = fakeServer({
      start: { ok: true, uploadId: "u1", chunkSize: 256 * K },
      chunk: (call) => {
        const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(call.headers["content-range"]);
        const received = Number(m[2]) + 1;
        return { ok: true, status: 200, json: async () => ({ ok: true, received, complete: received === total }) };
      },
    });
    const r = await uploadFileInChunks({ file, token: "t", planyrKey: "k", name: "n", contentType: "x", fetchImpl, sleep: noSleep });
    expect(r.ok).toBe(true);
    const ranges = calls.filter((c) => c.url.endsWith("/chunk")).map((c) => c.headers["content-range"]);
    expect(ranges).toEqual([
      `bytes 0-${256 * K - 1}/${total}`,
      `bytes ${256 * K}-${512 * K - 1}/${total}`,
      `bytes ${512 * K}-${total - 1}/${total}`, // final short chunk
    ]);
  });

  it("resumes from the server's byte count after a dropped chunk (never restarts)", async () => {
    const total = 512 * K;
    const file = new Blob([new Uint8Array(total)]);
    let chunkCalls = 0;
    const { calls, fetchImpl } = fakeServer({
      start: { ok: true, uploadId: "u1", chunkSize: 256 * K },
      chunk: (call) => {
        chunkCalls += 1;
        if (chunkCalls === 2) throw new Error("network dropped"); // second chunk dies mid-flight
        const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(call.headers["content-range"]);
        const received = Number(m[2]) + 1;
        return { ok: true, status: 200, json: async () => ({ ok: true, received, complete: received === total }) };
      },
      status: { ok: true, received: 256 * K }, // Drive kept chunk 1 — resume from there
    });
    const r = await uploadFileInChunks({ file, token: "t", planyrKey: "k", name: "n", contentType: "x", fetchImpl, sleep: noSleep });
    expect(r.ok).toBe(true);
    const ranges = calls.filter((c) => c.url.endsWith("/chunk")).map((c) => c.headers["content-range"]);
    // chunk 2 failed, the status probe said 256K, and the retry CONTINUED from 256K
    expect(ranges).toEqual([
      `bytes 0-${256 * K - 1}/${total}`,
      `bytes ${256 * K}-${total - 1}/${total}`,
      `bytes ${256 * K}-${total - 1}/${total}`,
    ]);
    expect(calls.some((c) => c.url.endsWith("/status"))).toBe(true);
  });

  it("gives up after maxAttempts consecutive failures with the real error", async () => {
    const file = new Blob([new Uint8Array(10)]);
    let tries = 0;
    const { fetchImpl } = fakeServer({
      start: { ok: true, uploadId: "u1", chunkSize: 256 * K },
      chunk: () => { tries += 1; return { ok: false, status: 502, json: async () => ({ ok: false, error: "Drive upload 502" }) }; },
      status: () => ({ ok: false, status: 502, json: async () => ({ ok: false, error: "probe down too" }) }),
    });
    const r = await uploadFileInChunks({ file, token: "t", planyrKey: "k", name: "n", contentType: "x", fetchImpl, sleep: noSleep, maxAttempts: 3 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Drive upload 502/);
    expect(tries).toBe(3);
  });

  it("a full Drive (storageQuotaExceeded) fails immediately in plain English — no futile retries", async () => {
    const file = new Blob([new Uint8Array(10)]);
    let tries = 0;
    const { fetchImpl } = fakeServer({
      start: { ok: true, uploadId: "u1", chunkSize: 256 * K },
      chunk: () => { tries += 1; return { ok: false, status: 502, json: async () => ({ ok: false, error: "The user's Drive storage quota has been exceeded. (storageQuotaExceeded)" }) }; },
    });
    const r = await uploadFileInChunks({ file, token: "t", planyrKey: "k", name: "n", contentType: "x", fetchImpl, sleep: noSleep });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(QUOTA_MESSAGE);
    expect(tries).toBe(1);
  });

  it("maps a 404/503 start (Drive not enabled) to skipped — the caller's 'not an error' path", async () => {
    const fetchImpl = async () => ({ ok: false, status: 503, json: async () => ({ ok: false }) });
    const r = await uploadFileInChunks({ file: new Blob([new Uint8Array(1)]), token: "t", planyrKey: "k", name: "n", contentType: "x", fetchImpl, sleep: noSleep });
    expect(r).toEqual({ ok: false, skipped: true, error: "Drive not enabled yet." });
  });

  it("a dead Drive session (sessionLost) short-circuits with the actionable message — no futile retry burn", async () => {
    const file = new Blob([new Uint8Array(10)]);
    let tries = 0;
    const { fetchImpl } = fakeServer({
      start: { ok: true, uploadId: "u1", chunkSize: 256 * K },
      chunk: () => { tries += 1; return { ok: false, status: 410, json: async () => ({ ok: false, error: "The upload session expired — start the upload again.", sessionLost: true }) }; },
    });
    const r = await uploadFileInChunks({ file, token: "t", planyrKey: "k", name: "n", contentType: "x", fetchImpl, sleep: noSleep });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/session expired/);
    expect(tries).toBe(1); // no retry loop against a condition the server declared unrecoverable
  });

  it("accepts a token GETTER and re-reads it per request (long uploads outlive one JWT)", async () => {
    const total = 512 * K;
    const file = new Blob([new Uint8Array(total)]);
    let n = 0;
    const { calls, fetchImpl } = fakeServer({
      start: { ok: true, uploadId: "u1", chunkSize: 256 * K },
      chunk: (call) => {
        const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(call.headers["content-range"]);
        const received = Number(m[2]) + 1;
        return { ok: true, status: 200, json: async () => ({ ok: true, received, complete: received === total }) };
      },
    });
    const r = await uploadFileInChunks({ file, token: async () => `tok-${++n}`, planyrKey: "k", name: "n", contentType: "x", fetchImpl, sleep: noSleep });
    expect(r.ok).toBe(true);
    const auths = calls.map((c) => c.headers.authorization);
    expect(new Set(auths).size).toBe(auths.length); // every request carried a FRESH token read
  });

  it("resets the retry budget when the /status resync shows progress (bodies land, responses drop)", async () => {
    // A network that delivers every 16 MiB PUT body but times out the responses: each chunk
    // "fails", yet the probe shows steady progress. That's a healthy upload — it must finish,
    // not die after maxAttempts chunks.
    const total = 5 * 256 * K; // 5 chunks > maxAttempts of 3
    const file = new Blob([new Uint8Array(total)]);
    let got = 0;
    const { fetchImpl } = fakeServer({
      start: { ok: true, uploadId: "u1", chunkSize: 256 * K },
      chunk: (call) => {
        const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(call.headers["content-range"]);
        got = Number(m[2]) + 1;
        throw new Error("response timed out"); // the body reached Drive; the reply is lost
      },
      status: () => ({ ok: true, status: 200, json: async () => ({ ok: true, received: got, complete: got >= total }) }),
    });
    const r = await uploadFileInChunks({ file, token: "t", planyrKey: "k", name: "n", contentType: "x", fetchImpl, sleep: noSleep, maxAttempts: 3 });
    expect(r).toEqual({ ok: true, driveKey: "k" });
  });

  it("falls back to the default chunk size when the server hands back a non-256 KiB-multiple", async () => {
    const file = new Blob([new Uint8Array(1000)]);
    const { calls, fetchImpl } = fakeServer({
      start: { ok: true, uploadId: "u1", chunkSize: 1_000_000 }, // NOT a 256 KiB multiple
      chunk: () => ({ ok: true, status: 200, json: async () => ({ ok: true, received: 1000, complete: true }) }),
    });
    const r = await uploadFileInChunks({ file, token: "t", planyrKey: "k", name: "n", contentType: "x", fetchImpl, sleep: noSleep });
    expect(r.ok).toBe(true);
    // One chunk covering the whole 1000-byte file at the safe default size.
    expect(calls.filter((c) => c.url.endsWith("/chunk")).map((c) => c.headers["content-range"])).toEqual(["bytes 0-999/1000"]);
  });

  it("a quota failure at session-mint time also maps to the plain-English message", async () => {
    const fetchImpl = async () => ({ ok: false, status: 502, json: async () => ({ ok: false, error: "The user's Drive storage quota has been exceeded. (storageQuotaExceeded)" }) });
    const r = await uploadFileInChunks({ file: new Blob([new Uint8Array(1)]), token: "t", planyrKey: "k", name: "n", contentType: "x", fetchImpl, sleep: noSleep });
    expect(r.error).toBe(QUOTA_MESSAGE);
  });

  it("an already-complete status during resume finishes cleanly (no chunk re-sent past the end)", async () => {
    const total = 256 * K;
    const file = new Blob([new Uint8Array(total)]);
    let chunkCalls = 0;
    const { calls, fetchImpl } = fakeServer({
      start: { ok: true, uploadId: "u1", chunkSize: 256 * K },
      chunk: () => { chunkCalls += 1; throw new Error("dropped after Drive got everything"); },
      status: { ok: true, received: total, complete: true }, // Drive actually finished
    });
    const r = await uploadFileInChunks({ file, token: "t", planyrKey: "k", name: "n", contentType: "x", fetchImpl, sleep: noSleep });
    expect(r.ok).toBe(true);
    expect(chunkCalls).toBe(1); // no retry of a finished upload
    expect(calls.filter((c) => c.url.endsWith("/complete")).length).toBe(1);
  });
});
