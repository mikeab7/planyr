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

// B409: large files (100 MB+ civil sets) can't ride the multipart-through-Worker path. These
// assert the resumable session is minted with the right upload headers (incl. Origin for the
// browser's cross-origin PUT) and that the server-side resumable create PUTs to the session URI.
describe("driveClient — resumable upload for large files (B409)", () => {
  // A fetch mock that returns a Location header on the resumable init and accepts the PUT.
  function resumableFetch({ uploadUri = "https://up.example/session?upload_id=abc", putJson = { id: "newfile" }, initOk = true } = {}) {
    const calls = [];
    const fn = async (url, opts = {}) => {
      const method = opts.method || "GET";
      calls.push({ url, method, headers: opts.headers || {}, body: opts.body });
      if (method === "POST" && url.includes("uploadType=resumable")) {
        return { ok: initOk, status: initOk ? 200 : 403,
          headers: { get: (k) => (String(k).toLowerCase() === "location" ? uploadUri : null) },
          json: async () => (initOk ? {} : { error: { message: "init blew up" } }) };
      }
      if (method === "PUT" && url === uploadUri) return { ok: true, status: 200, json: async () => putJson };
      return { ok: false, status: 404, json: async () => ({ error: { message: "no route: " + url } }) };
    };
    fn.calls = calls;
    return fn;
  }

  it("createResumableSession returns the session URI and sets the upload + Origin headers", async () => {
    const f = resumableFetch();
    const r = await client(f).createResumableSession({ name: "big.pdf", parentFolderId: "fid", contentType: "application/pdf", size: 123456789, origin: "https://planyr.io" });
    expect(r.uploadUri).toBe("https://up.example/session?upload_id=abc");
    const init = f.calls.find((c) => c.method === "POST");
    expect(init.url).toMatch(/uploadType=resumable/);
    expect(init.headers["X-Upload-Content-Type"]).toBe("application/pdf");
    expect(init.headers["X-Upload-Content-Length"]).toBe("123456789");
    expect(init.headers["Origin"]).toBe("https://planyr.io"); // binds the session for the cross-origin browser PUT
    expect(String(init.body)).toContain("big.pdf"); // metadata carries the name + parent
    expect(String(init.body)).toContain("fid");
  });

  it("omits Origin when none is given (server-side use)", async () => {
    const f = resumableFetch();
    await client(f).createResumableSession({ name: "x", parentFolderId: "fid" });
    expect(f.calls.find((c) => c.method === "POST").headers.Origin).toBeUndefined();
  });

  it("createViaResumable inits a session then PUTs the bytes straight to the session URI", async () => {
    const f = resumableFetch();
    const r = await client(f).createViaResumable({ bytes: new Uint8Array([1, 2, 3, 4]), contentType: "application/pdf", name: "big.pdf", parentFolderId: "fid" });
    expect(r.id).toBe("newfile");
    expect(f.calls.find((c) => c.method === "POST").headers["X-Upload-Content-Length"]).toBe("4"); // real byte length
    const put = f.calls.find((c) => c.method === "PUT");
    expect(put.url).toBe("https://up.example/session?upload_id=abc");
    expect(String(put.headers["content-type"])).toBe("application/pdf");
  });

  it("a failed resumable init throws a visible error", async () => {
    const f = resumableFetch({ initOk: false });
    await expect(client(f).createResumableSession({ name: "x", parentFolderId: "fid" })).rejects.toThrow(/init blew up/);
  });

  it("a session with no Location header throws rather than returning a bad URI", async () => {
    const f = async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) });
    await expect(client(f).createResumableSession({ name: "x" })).rejects.toThrow(/no upload URI/i);
  });
});

describe("driveClient — folder mirror ops (B645)", () => {
  it("createSubfolder POSTs a folder under the given parent and returns its new id", async () => {
    const f = scriptedFetch([{ method: "POST", match: "/files?fields=id", json: { id: "newfolder" } }]);
    const r = await client(f).createSubfolder({ name: "05. Civil", parentFolderId: "parent1" });
    expect(r.id).toBe("newfolder");
    const post = f.calls.find((c) => c.method === "POST");
    const body = JSON.parse(post.body);
    expect(body.name).toBe("05. Civil");
    expect(body.mimeType).toBe("application/vnd.google-apps.folder");
    expect(body.parents).toEqual(["parent1"]); // created under the known parent, not re-ensured by path
  });

  it("trash PATCHes trashed:true (recoverable delete, not a permanent del)", async () => {
    const f = scriptedFetch([{ method: "PATCH", match: "/files/fid", json: { id: "fid" } }]);
    await client(f).trash("fid");
    const patch = f.calls.find((c) => c.method === "PATCH");
    expect(patch).toBeTruthy();
    expect(JSON.parse(patch.body)).toEqual({ trashed: true });
    expect(f.calls.every((c) => c.method !== "DELETE")).toBe(true); // never a hard delete
  });
});
