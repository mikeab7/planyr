import { describe, it, expect, vi, afterEach } from "vitest";
import { onRequestGet } from "../functions/api/files.js";
import { memoryBackend } from "../server/storage/backends/memoryBackend.js";
import { createStorageAdapter } from "../server/storage/adapter.js";

/* GET /api/files — the STREAMING download path (B409 rework). What made "the big file
 * won't open": the old handler buffered the whole file in the Worker (128 MB memory), so a
 * 125 MB PDF could never come back. Now the Drive body streams through untouched and the
 * client's Range header is forwarded — pdf.js reads slices (206) and renders progressively.
 * Also the B491/V150 regression: file keys are scoped under the TOKEN-derived uid, so one
 * account can never read another's file. */

const ENV = {
  SUPABASE_URL: "https://p.supabase.co", SUPABASE_ANON_KEY: "anon", PLANYR_STORAGE_BACKEND: "drive",
  GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "sec", GOOGLE_REFRESH_TOKEN: "ref",
};
const PDF_BYTES = "%PDF-1.7 pretend-this-is-125MB-of-civil-drawings";

/* Fake world: `mappings` = drive_files rows keyed by full planyr_key ("uid/key" → driveId);
 * auth resolves every token to `uid`. RLS emulated: a drive_files query only matches a key
 * that both exists AND belongs to the caller (real RLS can't return another user's row). */
function world({ uid = "u1", mappings = {} } = {}) {
  const state = { mediaRequests: [] };
  vi.stubGlobal("fetch", async (url, opts = {}) => {
    const u = String(url);
    if (u.includes("/auth/v1/user")) return { ok: true, status: 200, json: async () => ({ id: uid, email: "a@b.c" }) };
    if (u.includes("oauth2.googleapis.com/token")) return { ok: true, status: 200, json: async () => ({ access_token: "gtok", expires_in: 3600 }) };
    if (u.includes("/rest/v1/drive_files")) {
      const m = /planyr_key=eq\.([^&]+)/.exec(u);
      const key = m && decodeURIComponent(m[1]);
      const owned = key && key.startsWith(`${uid}/`) && mappings[key]; // RLS: own rows only
      return { ok: true, status: 200, json: async () => (owned ? [{ drive_id: mappings[key] }] : []) };
    }
    if (/drive\/v3\/files\/[^?]+\?fields=name,mimeType,size/.test(u))
      return { ok: true, status: 200, json: async () => ({ name: "GPL - Civil IFP 2026.06.19.pdf", mimeType: "application/pdf", size: String(PDF_BYTES.length) }) };
    if (u.includes("alt=media")) {
      const range = (opts.headers || {}).range || null;
      state.mediaRequests.push({ url: u, range });
      if (range) {
        const m = /^bytes=(\d+)-(\d+)$/.exec(range);
        const part = PDF_BYTES.slice(Number(m[1]), Number(m[2]) + 1);
        return new Response(part, { status: 206, headers: { "content-length": String(part.length), "content-range": `bytes ${m[1]}-${m[2]}/${PDF_BYTES.length}`, "content-type": "application/pdf" } });
      }
      return new Response(PDF_BYTES, { status: 200, headers: { "content-length": String(PDF_BYTES.length), "content-type": "application/pdf" } });
    }
    throw new Error("unexpected fetch: " + u);
  });
  return state;
}

afterEach(() => { vi.unstubAllGlobals(); });

const req = (key, range) => new Request(`https://planyr.io/api/files?key=${encodeURIComponent(key)}`, {
  headers: { authorization: "Bearer tok", ...(range ? { range } : {}) },
});

describe("GET /api/files — streaming + Range", () => {
  it("streams the whole file with Content-Length + Accept-Ranges on a plain GET", async () => {
    world({ mappings: { "u1/project-x/civil/GPL.pdf": "f1" } });
    const resp = await onRequestGet({ env: ENV, request: req("project-x/civil/GPL.pdf") });
    expect(resp.status).toBe(200);
    expect(resp.headers.get("accept-ranges")).toBe("bytes");
    expect(resp.headers.get("content-length")).toBe(String(PDF_BYTES.length));
    expect(resp.headers.get("content-type")).toBe("application/pdf");
    expect(resp.headers.get("content-disposition")).toMatch(/^inline; filename="GPL - Civil IFP 2026\.06\.19\.pdf"$/);
    expect(resp.headers.get("cache-control")).toBe("private, no-store");
    expect(await resp.text()).toBe(PDF_BYTES);
  });

  it("forwards the client's Range to Drive and passes the 206 + Content-Range through", async () => {
    const state = world({ mappings: { "u1/project-x/civil/GPL.pdf": "f1" } });
    const resp = await onRequestGet({ env: ENV, request: req("project-x/civil/GPL.pdf", "bytes=5-14") });
    expect(state.mediaRequests[0].range).toBe("bytes=5-14"); // forwarded verbatim
    expect(resp.status).toBe(206);
    expect(resp.headers.get("content-range")).toBe(`bytes 5-14/${PDF_BYTES.length}`);
    expect(await resp.text()).toBe(PDF_BYTES.slice(5, 15));
  });

  it("IDOR (V150 regression): another account gets NO bytes from a victim's key", async () => {
    // The victim's file exists; the ATTACKER (uid u2) asks for it — both by the bare key
    // (uid-scoping resolves it under u2/, no match) and by pasting the victim's FULL key
    // (resolves under u2/u1/…, still no match). Either way: 404, zero media requests.
    for (const key of ["project-x/civil/GPL.pdf", "u1/project-x/civil/GPL.pdf"]) {
      const state = world({ uid: "u2", mappings: { "u1/project-x/civil/GPL.pdf": "f1" } });
      const resp = await onRequestGet({ env: ENV, request: req(key) });
      expect(resp.status).toBe(404);
      expect((await resp.text())).not.toContain("%PDF");
      expect(state.mediaRequests.length).toBe(0);
      vi.unstubAllGlobals();
    }
  });

  it("401 without a valid session; 503 when Drive isn't the backend", async () => {
    vi.stubGlobal("fetch", async (u) => (String(u).includes("/auth/v1/user") ? { ok: false, status: 401, json: async () => ({}) } : { ok: true, json: async () => ({}) }));
    expect((await onRequestGet({ env: ENV, request: req("k") })).status).toBe(401);
    vi.unstubAllGlobals();
    world({});
    expect((await onRequestGet({ env: { ...ENV, PLANYR_STORAGE_BACKEND: "memory" }, request: req("k") })).status).toBe(503);
  });
});

describe("adapter.fetchStream + memoryBackend.getStream — the seam under the handler", () => {
  it("serves a range slice (206 + Content-Range) and the full body without one", async () => {
    const backend = memoryBackend();
    const adapter = createStorageAdapter({ backend });
    await adapter.save({ planyrKey: "u1/a.bin", bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), name: "a.bin" });
    const full = await adapter.fetchStream("u1/a.bin", {});
    expect(full.ok).toBe(true);
    expect(full.status).toBe(200);
    expect(full.contentLength).toBe("10");
    const part = await adapter.fetchStream("u1/a.bin", { range: "bytes=2-5" });
    expect(part.status).toBe(206);
    expect(part.contentRange).toBe("bytes 2-5/10");
    expect([...part.body]).toEqual([3, 4, 5, 6]);
    const miss = await adapter.fetchStream("u1/missing.bin", {});
    expect(miss.ok).toBe(false);
  });
});
