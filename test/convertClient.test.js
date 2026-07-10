import { describe, it, expect } from "vitest";
import { convertDwgToDxf, isDwgFile, convertConfigured } from "../src/workspaces/site-planner/lib/convertClient.js";

const dwg = { name: "site.dwg", size: 1234, type: "" };
const okResp = (buf) => ({ ok: true, status: 200, arrayBuffer: async () => buf });
const errResp = (status, error) => ({ ok: false, status, json: async () => (error ? { error } : {}), arrayBuffer: async () => new ArrayBuffer(0) });

describe("isDwgFile / convertConfigured (B748)", () => {
  it("sniffs .dwg by extension (MIME is unreliable for CAD)", () => {
    expect(isDwgFile({ name: "X.dwg" })).toBe(true);
    expect(isDwgFile({ name: "X.DWG" })).toBe(true);
    expect(isDwgFile({ name: "X.pdf" })).toBe(false);
    expect(isDwgFile({ name: "x", type: "image/vnd.dwg" })).toBe(true);
  });
  it("convertConfigured reflects whether a URL is set", () => {
    expect(convertConfigured("")).toBe(false);
    expect(convertConfigured("https://c.example")).toBe(true);
  });
});

describe("convertDwgToDxf — every failure path is a visible, distinct state (LOUD-FAILURE)", () => {
  it("unset URL → 'not set up yet', never a silent no-op", async () => {
    const r = await convertDwgToDxf(dwg, { url: "", fetchImpl: async () => okResp(new ArrayBuffer(8)) });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("unset");
    expect(r.error).toMatch(/isn't set up yet/);
    expect(r.error).toMatch(/export a DXF/i);
  });

  it("success → { ok, bytes }", async () => {
    const buf = new Uint8Array([48, 10, 83]).buffer; // "0\nS"
    const r = await convertDwgToDxf(dwg, { url: "https://c.example/", fetchImpl: async (u) => { expect(u).toBe("https://c.example/convert"); return okResp(buf); } });
    expect(r.ok).toBe(true);
    expect(r.bytes.byteLength).toBe(3);
  });

  it("413 → oversize state names the limit", async () => {
    const r = await convertDwgToDxf(dwg, { url: "https://c.example", fetchImpl: async () => errResp(413) });
    expect(r.code).toBe("toobig");
    expect(r.error).toMatch(/too large/i);
  });

  it("422 → surfaces the service's error text + the DXF-export suggestion", async () => {
    const r = await convertDwgToDxf(dwg, { url: "https://c.example", fetchImpl: async () => errResp(422, "Proxy objects only — no geometry.") });
    expect(r.code).toBe("unreadable");
    expect(r.error).toMatch(/Proxy objects only/);
    expect(r.error).toMatch(/export a DXF/i);
  });

  it("network throw → service unreachable", async () => {
    const r = await convertDwgToDxf(dwg, { url: "https://c.example", fetchImpl: async () => { throw new Error("ECONNREFUSED"); } });
    expect(r.code).toBe("network");
    expect(r.error).toMatch(/unreachable/i);
  });

  it("empty body → empty-DXF state (not a false success)", async () => {
    const r = await convertDwgToDxf(dwg, { url: "https://c.example", fetchImpl: async () => okResp(new ArrayBuffer(0)) });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("empty");
  });
});
