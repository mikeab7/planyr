import { describe, it, expect } from "vitest";
import { handleParcelCache, snapshotFileName, SNAPSHOT_COUNTIES } from "../functions/api/parcel-cache/_handler.js";

// Minimal in-memory Drive client — the methods the read-through handler uses (findFile/media).
function fakeDrive(now = () => Date.now()) {
  let seq = 0;
  const files = []; // { id, name, modifiedTime, bytes }
  return {
    _files: files,
    calls: { media: 0, find: 0 },
    put(name, bytes, at = now()) { const f = { id: `f${++seq}`, name, modifiedTime: new Date(at).toISOString(), bytes }; files.push(f); return f; },
    async findFile(name) { this.calls.find++; return files.filter((f) => f.name === name).sort((a, b) => Date.parse(b.modifiedTime) - Date.parse(a.modifiedTime))[0] || null; },
    async media(id) { this.calls.media++; const f = files.find((x) => x.id === id); return { bytes: f.bytes, name: f.name }; },
  };
}
const folderIdFor = async () => "folder1";
const enc = (obj) => new TextEncoder().encode(JSON.stringify(obj));

describe("snapshotFileName — Drive filename shaping (path-traversal guard)", () => {
  it("whole-county → <county>.json.gz for an allow-listed county", () => {
    expect(snapshotFileName("chambers")).toBe("chambers.json.gz");
    expect(snapshotFileName("waller")).toBe("waller.json.gz");
    expect(snapshotFileName("fortbend")).toBe("fortbend.json.gz");
  });
  it("meta → <county>.meta.json", () => {
    expect(snapshotFileName("chambers", [], true)).toBe("chambers.meta.json");
  });
  it("tile → <county>_<z>_<x>_<y>.json.gz only for 3 integers", () => {
    expect(snapshotFileName("fortbend", ["12", "955", "1710"])).toBe("fortbend_12_955_1710.json.gz");
    expect(snapshotFileName("fortbend", ["12", "x", "1710"])).toBeNull();
    expect(snapshotFileName("fortbend", ["12", "955"])).toBeNull();
  });
  it("rejects any county not on the allowlist (can't address an arbitrary Drive file)", () => {
    expect(snapshotFileName("harris")).toBeNull(); // deliberately excluded
    expect(snapshotFileName("..%2fsecrets")).toBeNull();
    expect(snapshotFileName("")).toBeNull();
    expect(SNAPSHOT_COUNTIES.has("harris")).toBe(false);
  });
});

describe("handleParcelCache — serve a stored snapshot", () => {
  it("returns the gzipped GeoJSON bytes with content-encoding: gzip", async () => {
    const client = fakeDrive();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    client.put("chambers.json.gz", bytes);
    const res = await handleParcelCache({ client, segs: ["svc", "chambers"], folderIdFor });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(res.headers.get("content-type")).toMatch(/geo\+json/);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
    expect(client.calls.media).toBe(1);
  });

  it("serves a Fort Bend viewport tile", async () => {
    const client = fakeDrive();
    client.put("fortbend_12_955_1710.json.gz", new Uint8Array([9]));
    const res = await handleParcelCache({ client, segs: ["svc", "fortbend", "12", "955", "1710"], folderIdFor });
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([9]));
  });
});

describe("handleParcelCache — read-through (404 on miss, NEVER fetches an upstream)", () => {
  it("404s a county with no stored snapshot so the client falls back to live", async () => {
    const res = await handleParcelCache({ client: fakeDrive(), segs: ["svc", "chambers"], folderIdFor });
    expect(res.status).toBe(404);
  });
  it("404s an unknown / excluded county (harris)", async () => {
    const client = fakeDrive();
    client.put("harris.json.gz", new Uint8Array([1])); // even if a file existed, the county is off-list
    const res = await handleParcelCache({ client, segs: ["svc", "harris"], folderIdFor });
    expect(res.status).toBe(404);
    expect(client.calls.media).toBe(0); // never even looked it up
  });
  it("404s a malformed tile path", async () => {
    const res = await handleParcelCache({ client: fakeDrive(), segs: ["svc", "fortbend", "12", "abc"], folderIdFor });
    expect(res.status).toBe(404);
  });
  it("400s a request that isn't /svc/<county>", async () => {
    const res = await handleParcelCache({ client: fakeDrive(), segs: ["nope"], folderIdFor });
    expect(res.status).toBe(400);
  });
  it("404s when there are no Drive creds (client null)", async () => {
    const res = await handleParcelCache({ client: null, segs: ["svc", "chambers"], folderIdFor });
    expect(res.status).toBe(404);
  });
});

describe("handleParcelCache — ?meta=1 (vintage badge + version compare)", () => {
  it("cached:false when nothing is stored", async () => {
    const res = await handleParcelCache({ client: fakeDrive(), segs: ["svc", "chambers"], search: "?meta=1", folderIdFor });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cached: false });
  });
  it("cached:true with ts + the sidecar's generatedAt/count/source read through", async () => {
    const client = fakeDrive(() => 1000);
    client.put("chambers.meta.json", enc({ generatedAt: "2026-07-03T00:00:00Z", count: 28450, source: "tnris-stratmap" }), 1000);
    const res = await handleParcelCache({ client, segs: ["svc", "chambers"], search: "?meta=1", now: () => 4000, folderIdFor });
    const body = await res.json();
    expect(body.cached).toBe(true);
    expect(body.ts).toBe(1000);
    expect(body.ageMs).toBe(3000);
    expect(body.count).toBe(28450);
    expect(body.generatedAt).toBe("2026-07-03T00:00:00Z");
    expect(body.source).toBe("tnris-stratmap");
  });
  it("flags stale once past the 7-day snapshot TTL (builder stopped running)", async () => {
    const client = fakeDrive(() => 1000);
    client.put("waller.meta.json", enc({ generatedAt: "x", count: 5 }), 1000);
    const eightDays = 1000 + 8 * 24 * 60 * 60 * 1000;
    const res = await handleParcelCache({ client, segs: ["svc", "waller"], search: "?meta=1", now: () => eightDays, folderIdFor });
    expect((await res.json()).stale).toBe(true);
  });
});
