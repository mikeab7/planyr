import { describe, it, expect } from "vitest";
import {
  UPLOAD_CHUNK_SIZE, parseContentRange, parseDriveReceived, relayChunk, probeSession,
} from "../server/uploads/resumableProxy.js";

/* The Drive resumable RELAY protocol (B409 rework) — pure, no Worker, no Google. The one
 * trap this file guards hardest: Drive's 308 "Resume Incomplete" is a SUCCESS ("send the
 * next chunk") even though res.ok is false for a 308. */

const mkRes = (status, { headers = {}, body = null } = {}) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: (k) => headers[String(k).toLowerCase()] ?? null },
  json: async () => { if (body == null) throw new Error("no body"); return body; },
});

describe("parseContentRange — the client's chunk header", () => {
  it("parses a normal chunk and the final short chunk", () => {
    expect(parseContentRange("bytes 0-16777215/125176019")).toEqual({ start: 0, end: 16777215, total: 125176019 });
    expect(parseContentRange("bytes 117440512-125176018/125176019")).toEqual({ start: 117440512, end: 125176018, total: 125176019 });
  });
  it("rejects malformed / out-of-bounds ranges", () => {
    for (const bad of [null, "", "bytes */100", "bytes 5-4/100", "bytes 0-100/100", "bytes 0-9", "0-9/100", "bytes -1-9/100"])
      expect(parseContentRange(bad)).toBeNull();
  });
});

describe("parseDriveReceived — Drive's 308 progress header", () => {
  it("turns 'bytes=0-lastByte' into a byte count", () => {
    expect(parseDriveReceived("bytes=0-16777215")).toBe(16777216);
  });
  it("no header (nothing stored yet) → 0", () => {
    expect(parseDriveReceived(null)).toBe(0);
    expect(parseDriveReceived("")).toBe(0);
  });
});

describe("relayChunk — 308 is progress, 200/201 is completion, everything else is loud", () => {
  it("treats 308 Resume Incomplete as SUCCESS (never as an error)", async () => {
    const fetchImpl = async () => mkRes(308, { headers: { range: "bytes=0-999" } });
    const r = await relayChunk({ sessionUri: "https://u", bytes: new ArrayBuffer(1000), contentRange: "bytes 0-999/2000", fetchImpl });
    expect(r).toEqual({ kind: "progress", received: 1000 });
  });
  it("forwards the Content-Range verbatim and returns the file id on the final 200", async () => {
    let seen = null;
    const fetchImpl = async (url, opts) => { seen = opts.headers["content-range"]; return mkRes(200, { body: { id: "drive-file-9" } }); };
    const r = await relayChunk({ sessionUri: "https://u", bytes: new ArrayBuffer(10), contentRange: "bytes 1990-1999/2000", fetchImpl });
    expect(seen).toBe("bytes 1990-1999/2000");
    expect(r).toEqual({ kind: "complete", fileId: "drive-file-9" });
  });
  it("a 2xx with no file id is an error, not a silent success", async () => {
    const fetchImpl = async () => mkRes(200, { body: {} });
    const r = await relayChunk({ sessionUri: "https://u", bytes: new ArrayBuffer(1), contentRange: "bytes 0-0/1", fetchImpl });
    expect(r.kind).toBe("error");
    expect(r.error).toMatch(/no file id/i);
  });
  it("surfaces Google's reason code (storageQuotaExceeded) in the error text", async () => {
    const fetchImpl = async () => mkRes(403, { body: { error: { message: "Quota exceeded.", errors: [{ reason: "storageQuotaExceeded" }] } } });
    const r = await relayChunk({ sessionUri: "https://u", bytes: new ArrayBuffer(1), contentRange: "bytes 0-0/1", fetchImpl });
    expect(r.kind).toBe("error");
    expect(r.error).toMatch(/storageQuotaExceeded/);
  });
  it("a dead session (Drive 404/410) is a distinct restartable condition", async () => {
    const fetchImpl = async () => mkRes(404, {});
    const r = await relayChunk({ sessionUri: "https://u", bytes: new ArrayBuffer(1), contentRange: "bytes 0-0/1", fetchImpl });
    expect(r).toMatchObject({ kind: "error", status: 410, sessionLost: true });
  });
  it("a thrown fetch is a visible error, never a throw", async () => {
    const fetchImpl = async () => { throw new Error("socket hangup"); };
    const r = await relayChunk({ sessionUri: "https://u", bytes: new ArrayBuffer(1), contentRange: "bytes 0-0/1", fetchImpl });
    expect(r.kind).toBe("error");
    expect(r.error).toMatch(/socket hangup/);
  });
});

describe("probeSession — the resume probe", () => {
  it("sends the zero-byte bytes */total probe and maps 308 progress", async () => {
    let seen = null;
    const fetchImpl = async (url, opts) => { seen = opts; return mkRes(308, { headers: { range: "bytes=0-499" } }); };
    const r = await probeSession({ sessionUri: "https://u", totalBytes: 2000, fetchImpl });
    expect(seen.method).toBe("PUT");
    expect(seen.headers["content-range"]).toBe("bytes */2000");
    expect(seen.body).toBeUndefined();
    expect(r).toEqual({ kind: "progress", received: 500 });
  });
  it("maps an already-finished session to complete (repairs a missed final-chunk write)", async () => {
    const fetchImpl = async () => mkRes(200, { body: { id: "f1" } });
    const r = await probeSession({ sessionUri: "https://u", totalBytes: 2000, fetchImpl });
    expect(r).toEqual({ kind: "complete", fileId: "f1" });
  });
});

describe("chunk-size contract", () => {
  it("the server's chunk size is 16 MiB (a 256 KiB multiple, well under the 100 MB body cap)", () => {
    expect(UPLOAD_CHUNK_SIZE).toBe(16 * 1024 * 1024);
    expect(UPLOAD_CHUNK_SIZE % (256 * 1024)).toBe(0);
  });
});
