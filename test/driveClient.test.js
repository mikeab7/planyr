import { describe, it, expect } from "vitest";
import { createDriveClient } from "../server/storage/backends/driveClient.js";

// A scripted fetch: matches requests by (method, url-substring) → canned JSON, and records
// every call so we can assert request shapes without hitting Google.
function scriptedFetch(routes) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || "GET", headers: opts.headers || {}, body: opts.body });
    for (const r of routes) {
      if ((r.method ? r.method === (opts.method || "GET") : true) && url.includes(r.match)) {
        return { ok: true, status: 200, json: async () => r.json, arrayBuffer: async () => r.bytes || new ArrayBuffer(0) };
      }
    }
    return { ok: false, status: 404, json: async () => ({ error: { message: "no route: " + url } }) };
  };
  fn.calls = calls;
  return fn;
}
const client = (fetchImpl) => createDriveClient({ getAccessToken: async () => "tok", fetchImpl });

describe("driveClient — folder ensure (app-created, drive.file) (B207)", () => {
  it("finds an existing folder instead of recreating it", async () => {
    const f = scriptedFetch([{ method: "GET", match: "/files?q=", json: { files: [{ id: "fid", name: "Planyr" }] } }]);
    const id = await client(f).folderId("");
    expect(id).toBe("fid");
    expect(f.calls.every((c) => c.method === "GET")).toBe(true); // no create needed
    expect(f.calls[0].headers.authorization).toBe("Bearer tok");
  });
  it("creates each missing path segment, returning the deepest id", async () => {
    let created = 0;
    const f = async (url, opts = {}) => {
      const method = opts.method || "GET";
      if (method === "GET" && url.includes("/files?q=")) return { ok: true, status: 200, json: async () => ({ files: [] }) };
      if (method === "POST" && url.includes("/files?fields=id")) { created++; return { ok: true, status: 200, json: async () => ({ id: "folder" + created }) }; }
      return { ok: false, status: 404, json: async () => ({ error: { message: url } }) };
    };
    const id = await client(f).folderId("project-1/Civil"); // Planyr + project-1 + Civil = 3 creates
    expect(created).toBe(3);
    expect(id).toBe("folder3");
  });
});

describe("driveClient — file ops (B207)", () => {
  it("create posts a multipart upload and returns the new id", async () => {
    const f = scriptedFetch([{ method: "POST", match: "/upload/drive/v3/files", json: { id: "newfile" } }]);
    const r = await client(f).create({ bytes: new Uint8Array([1, 2, 3]), contentType: "application/pdf", name: "a.pdf", parentFolderId: "fid" });
    expect(r.id).toBe("newfile");
    expect(f.calls[0].url).toMatch(/uploadType=multipart/);
    expect(String(f.calls[0].headers["content-type"])).toMatch(/multipart\/related; boundary=/);
  });
  it("list maps Drive fields straight through", async () => {
    const f = scriptedFetch([{ method: "GET", match: "/files?q=", json: { files: [{ id: "x", name: "a.pdf", size: "12", mimeType: "application/pdf", parents: ["fid"] }] } }]);
    const rows = await client(f).list({ parentFolderId: "fid" });
    expect(rows[0]).toMatchObject({ id: "x", name: "a.pdf", mimeType: "application/pdf" });
  });
  it("permitAnyoneReader grants reader then returns the webViewLink", async () => {
    const f = scriptedFetch([
      { method: "POST", match: "/permissions", json: { id: "perm" } },
      { method: "GET", match: "fields=webViewLink", json: { webViewLink: "https://drive.google.com/file/d/x/view" } },
    ]);
    const r = await client(f).permitAnyoneReader("x");
    expect(r.webViewLink).toMatch(/drive\.google\.com/);
    expect(f.calls.some((c) => c.method === "POST" && c.url.includes("/permissions"))).toBe(true);
  });
  it("a Drive error becomes a thrown error (adapter turns it into a visible failure)", async () => {
    const f = async () => ({ ok: false, status: 403, json: async () => ({ error: { message: "rateLimitExceeded" } }) });
    await expect(client(f).list({ parentFolderId: "fid" })).rejects.toThrow(/rateLimitExceeded/);
  });
});
