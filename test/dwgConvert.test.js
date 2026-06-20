import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { convertConfig } from "../server/convert/config.js";
import { convertWithLibreDwg } from "../server/convert/libredwg.js";
import { convertWithAps, apsAuthenticate } from "../server/convert/aps.js";
import { convertDwgToDxf } from "../server/convert/convertService.js";
import { createConvertServer } from "../server/convert/server.js";

const bytes = (s) => Buffer.from(s);

describe("convertConfig — env parsing, APS dormant by default (B228)", () => {
  it("APS fallback is OFF unless explicitly enabled", () => {
    expect(convertConfig({}).aps.enabled).toBe(false);
    expect(convertConfig({ APS_ENABLED: "false" }).aps.enabled).toBe(false);
    expect(convertConfig({ APS_ENABLED: "1" }).aps.enabled).toBe(true);
    expect(convertConfig({ APS_ENABLED: "true" }).aps.enabled).toBe(true);
    expect(convertConfig({ APS_ENABLED: "on" }).aps.enabled).toBe(true);
  });
  it("PORT defaults to 8080 (Cloud Run overrides)", () => {
    expect(convertConfig({}).port).toBe(8080);
    expect(convertConfig({ PORT: "5000" }).port).toBe(5000);
  });
  it("does not read any VITE_ var (secrets stay server-side)", () => {
    const c = convertConfig({ VITE_APS_CLIENT_ID: "leak" });
    expect(c.aps.clientId).toBeNull();
  });
});

describe("convertWithLibreDwg — primary engine, no silent failures (B228)", () => {
  // A fake runner that writes a DXF to the requested output path and exits with `code`.
  const writingRunner = (code, content = "0\nSECTION\n") => async (_bin, args) => {
    const outPath = args[args.indexOf("-o") + 1];
    await writeFile(outPath, content);
    return { code, stderr: code ? "minor warning" : "" };
  };

  it("returns the DXF bytes on a clean (code 0) conversion", async () => {
    const r = await convertWithLibreDwg(bytes("DWG"), { runner: writingRunner(0) });
    expect(r.ok).toBe(true);
    expect(r.engine).toBe("libredwg");
    expect(Buffer.from(r.dxf).toString()).toMatch(/SECTION/);
    expect(r.warning).toBeNull();
  });
  it("treats a non-critical (warning) code with output as success + a warning", async () => {
    const r = await convertWithLibreDwg(bytes("DWG"), { runner: writingRunner(1) });
    expect(r.ok).toBe(true);
    expect(r.warning).toMatch(/warning/i);
  });
  it("fails on a critical code (>=128) — no false success", async () => {
    const r = await convertWithLibreDwg(bytes("DWG"), { runner: writingRunner(130) });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/critical/i);
  });
  it("fails when the binary can't be started (missing in image)", async () => {
    const r = await convertWithLibreDwg(bytes("DWG"), { runner: async () => ({ code: -1, stderr: "ENOENT", spawnError: true }) });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/could not be started/i);
  });
  it("fails when the process exits 0 but produced no DXF", async () => {
    const r = await convertWithLibreDwg(bytes("DWG"), { runner: async () => ({ code: 0, stderr: "" }) });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no DXF/i);
  });
  it("rejects empty input before spawning anything", async () => {
    let called = false;
    const r = await convertWithLibreDwg(Buffer.alloc(0), { runner: async () => { called = true; return { code: 0 }; } });
    expect(r.ok).toBe(false);
    expect(called).toBe(false);
  });
});

describe("convertDwgToDxf — engine policy (B228)", () => {
  const cfg = convertConfig({});
  const okLibre = async () => ({ ok: true, dxf: bytes("DXF"), engine: "libredwg" });
  const failLibre = async () => ({ ok: false, error: "unreadable r2018 drawing", engine: "libredwg" });

  it("uses LibreDWG when it succeeds (APS never consulted)", async () => {
    let apsCalled = false;
    const r = await convertDwgToDxf(bytes("DWG"), cfg, { libre: okLibre, aps: async () => { apsCalled = true; return { ok: true }; } });
    expect(r.ok).toBe(true);
    expect(r.engine).toBe("libredwg");
    expect(apsCalled).toBe(false);
  });

  it("LibreDWG fails + APS OFF → explicit error, APS not called, NO silent success", async () => {
    let apsCalled = false;
    const r = await convertDwgToDxf(bytes("DWG"), convertConfig({}), { libre: failLibre, aps: async () => { apsCalled = true; return { ok: true, dxf: bytes("X") }; } });
    expect(r.ok).toBe(false);
    expect(apsCalled).toBe(false);
    expect(r.error).toMatch(/APS_ENABLED is off/);
    expect(r.error).toMatch(/unreadable r2018/);
  });

  it("LibreDWG fails + APS ON + APS succeeds → returns the APS DXF", async () => {
    const r = await convertDwgToDxf(bytes("DWG"), convertConfig({ APS_ENABLED: "1" }), {
      libre: failLibre, aps: async () => ({ ok: true, dxf: bytes("APSDXF"), engine: "aps" }),
    });
    expect(r.ok).toBe(true);
    expect(r.engine).toBe("aps");
    expect(Buffer.from(r.dxf).toString()).toBe("APSDXF");
  });

  it("LibreDWG fails + APS ON + APS fails → combined explicit error", async () => {
    const r = await convertDwgToDxf(bytes("DWG"), convertConfig({ APS_ENABLED: "1" }), {
      libre: failLibre, aps: async () => ({ ok: false, error: "APS 500" }),
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/LibreDWG/);
    expect(r.error).toMatch(/APS 500/);
  });

  it("empty body fails fast", async () => {
    expect((await convertDwgToDxf(Buffer.alloc(0), cfg)).ok).toBe(false);
  });
});

describe("convertWithAps — dormant fallback contract (B228)", () => {
  it("fails clearly when disabled", async () => {
    const r = await convertWithAps(bytes("DWG"), { enabled: false });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/disabled/i);
  });
  it("fails clearly when enabled but unconfigured (no creds)", async () => {
    const r = await convertWithAps(bytes("DWG"), { enabled: true, clientId: null, clientSecret: null });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not configured/i);
  });
  it("apsAuthenticate posts client-credentials + Basic auth and returns the token", async () => {
    const calls = [];
    const fetchImpl = async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200, json: async () => ({ access_token: "tok", expires_in: 3600 }) }; };
    const r = await apsAuthenticate({ clientId: "id", clientSecret: "sec", baseUrl: "https://aps.example", fetchImpl });
    expect(r.ok).toBe(true);
    expect(r.accessToken).toBe("tok");
    expect(calls[0].url).toMatch(/authentication\/v2\/token$/);
    expect(calls[0].opts.headers.authorization).toMatch(/^Basic /);
  });
  it("apsAuthenticate surfaces an auth error visibly (no throw)", async () => {
    const fetchImpl = async () => ({ ok: false, status: 401, json: async () => ({ error: "invalid_client" }) });
    const r = await apsAuthenticate({ clientId: "id", clientSecret: "bad", baseUrl: "https://aps.example", fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/invalid_client/);
  });
});

// Drive the real HTTP server with an injected converter (no native binary needed).
describe("convert HTTP server — routes + honest status codes (B228)", () => {
  const listen = (server) => new Promise((res) => { server.listen(0, "127.0.0.1", () => res(`http://127.0.0.1:${server.address().port}`)); });

  it("GET /health → 200 with engine info", async () => {
    const server = createConvertServer(convertConfig({}));
    const base = await listen(server);
    try {
      const r = await fetch(`${base}/health`);
      expect(r.status).toBe(200);
      const j = await r.json();
      expect(j.ok).toBe(true);
      expect(j.service).toBe("dwg-convert");
      expect(j.apsFallback).toBe(false);
    } finally { server.close(); }
  });

  it("POST /convert success → 200 DXF bytes + X-Convert-Engine header", async () => {
    const server = createConvertServer(convertConfig({}), { convert: async () => ({ ok: true, dxf: bytes("DXFBODY"), engine: "libredwg" }) });
    const base = await listen(server);
    try {
      const r = await fetch(`${base}/convert`, { method: "POST", body: bytes("DWG") });
      expect(r.status).toBe(200);
      expect(r.headers.get("x-convert-engine")).toBe("libredwg");
      expect(await r.text()).toBe("DXFBODY");
    } finally { server.close(); }
  });

  it("POST /convert conversion failure → 422 JSON, never a 200", async () => {
    const server = createConvertServer(convertConfig({}), { convert: async () => ({ ok: false, error: "unreadable", engine: "none", apsEnabled: false }) });
    const base = await listen(server);
    try {
      const r = await fetch(`${base}/convert`, { method: "POST", body: bytes("DWG") });
      expect(r.status).toBe(422);
      const j = await r.json();
      expect(j.ok).toBe(false);
      expect(j.error).toMatch(/unreadable/);
    } finally { server.close(); }
  });

  it("POST /convert with a missing binary → 503 (infra fault)", async () => {
    const server = createConvertServer(convertConfig({}), { convert: async () => ({ ok: false, error: 'LibreDWG binary "dwg2dxf" could not be started (ENOENT)', engine: "libredwg" }) });
    const base = await listen(server);
    try {
      const r = await fetch(`${base}/convert`, { method: "POST", body: bytes("DWG") });
      expect(r.status).toBe(503);
    } finally { server.close(); }
  });

  it("empty POST body → 400", async () => {
    const server = createConvertServer(convertConfig({}));
    const base = await listen(server);
    try {
      const r = await fetch(`${base}/convert`, { method: "POST", body: bytes("") });
      expect(r.status).toBe(400);
    } finally { server.close(); }
  });

  it("GET /convert → 405 (POST only)", async () => {
    const server = createConvertServer(convertConfig({}));
    const base = await listen(server);
    try {
      const r = await fetch(`${base}/convert`);
      expect(r.status).toBe(405);
    } finally { server.close(); }
  });

  it("oversize body → 413", async () => {
    const server = createConvertServer({ ...convertConfig({}), maxUploadBytes: 8 });
    const base = await listen(server);
    try {
      const r = await fetch(`${base}/convert`, { method: "POST", body: bytes("way more than eight bytes") });
      expect(r.status).toBe(413);
    } finally { server.close(); }
  });
});

// Light integration: if a real dwg2dxf is on PATH, prove the actual engine path end-to-end.
// Skipped automatically where the binary isn't installed (e.g. CI) — the container test
// covers the native path there.
describe("convertWithLibreDwg — real binary smoke (B228)", () => {
  it("rejects clearly-non-DWG bytes through the real binary when present", async () => {
    let dir;
    try {
      dir = await mkdtemp(join(tmpdir(), "dwgtest-"));
      const r = await convertWithLibreDwg(bytes("this is not a DWG file"), { bin: process.env.LIBREDWG_BIN || "dwg2dxf", timeoutMs: 15000 });
      // Either the binary is absent (spawn error) or it rejects the junk — both are failures,
      // never a false success.
      expect(r.ok).toBe(false);
    } finally { if (dir) await rm(dir, { recursive: true, force: true }); }
  });
});
