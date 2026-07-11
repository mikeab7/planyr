import { describe, it, expect, vi, afterEach } from "vitest";
import { onRequestPost as startPost } from "../functions/api/uploads/start.js";
import { onRequestPut as chunkPut } from "../functions/api/uploads/[id]/chunk.js";
import { onRequestGet as statusGet } from "../functions/api/uploads/[id]/status.js";
import { onRequestPost as completePost } from "../functions/api/uploads/[id]/complete.js";

/* /api/uploads/* — the chunked-upload proxy (B409 rework), driven end-to-end against a
 * stateful fake of Supabase REST + Google Drive (same stub-global-fetch idiom as
 * driveShare.test.js). Covers the security contract (ownership via RLS ⇒ foreign uploadId
 * = 404 before Drive is ever touched; the session URI never appears in a response), the
 * relay protocol (Content-Range forwarded verbatim, 308 = progress), resume, and the
 * COMPLETE mapping write + rollback. */

const ENV = {
  SUPABASE_URL: "https://p.supabase.co", SUPABASE_ANON_KEY: "anon", PLANYR_STORAGE_BACKEND: "drive",
  GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "sec", GOOGLE_REFRESH_TOKEN: "ref",
};
const SESSION_URI = "https://upload.google.test/sess/1";

const hres = (body, status = 200, headers = {}) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: (k) => headers[String(k).toLowerCase()] ?? null },
  json: async () => body, text: async () => JSON.stringify(body),
});

/* One fake world: `state.sessions` = the upload_sessions table (RLS emulated: reads filter
 * by the CALLER the auth stub reports); `state.drive(call)` scripts the resumable session
 * endpoint; drive_files inserts land in state.mappings (scriptable failure). */
function world({ uid = "u1", sessions = {}, drive = null, driveFilesFail = false } = {}) {
  const state = {
    // Copy each ROW too — the fake PATCH mutates rows in place, and a shared literal
    // (SESSION_ROW) leaking mutations across tests is exactly the flake this avoids.
    uid, sessions: Object.fromEntries(Object.entries(sessions).map(([k, v]) => [k, { ...v }])),
    mappings: [], driveCalls: [], patches: [], deleted: [],
    drive: drive || (() => hres({ id: "drive-file-1" }, 200)),
    driveFilesFail, driveDeletes: [],
  };
  const fetchStub = async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || "GET").toUpperCase();
    // Supabase auth — the caller is whoever the state says (token → uid)
    if (u.includes("/auth/v1/user")) return hres({ id: state.uid, email: "a@b.c" });
    // Google OAuth
    if (u.includes("oauth2.googleapis.com/token")) return hres({ access_token: "gtok", expires_in: 3600 });
    // Drive folder ensure (find succeeds at every level)
    if (u.startsWith("https://www.googleapis.com/drive/v3/files?q=")) return hres({ files: [{ id: "fld" }] });
    // Drive resumable INIT → session URI in the Location header
    if (u.startsWith("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable"))
      return hres({}, 200, { location: SESSION_URI });
    // Drive file delete (the COMPLETE rollback)
    if (method === "DELETE" && u.startsWith("https://www.googleapis.com/drive/v3/files/")) {
      state.driveDeletes.push(u); return hres({}, 204);
    }
    // The resumable session itself (chunk relay + probe)
    if (u.startsWith(SESSION_URI)) { const call = { url: u, method, headers: opts.headers || {}, body: opts.body }; state.driveCalls.push(call); return state.drive(call); }
    // Supabase REST: upload_sessions
    if (u.includes("/rest/v1/upload_sessions")) {
      if (method === "POST") {
        const row = JSON.parse(opts.body);
        const id = "sess-new";
        state.sessions[id] = { id, user_id: state.uid, status: "in_progress", bytes_received: 0, drive_file_id: null, ...row };
        return hres([{ id }], 201);
      }
      const idMatch = /id=eq\.([^&]+)/.exec(u);
      const id = idMatch && decodeURIComponent(idMatch[1]);
      if (method === "GET") {
        const row = state.sessions[id];
        return hres(row && row.user_id === state.uid ? [row] : []); // RLS: only the owner's rows
      }
      if (method === "PATCH") {
        const patch = JSON.parse(opts.body);
        state.patches.push({ id, patch });
        if (state.sessions[id]) Object.assign(state.sessions[id], patch);
        return hres(null, 204);
      }
      if (method === "DELETE") { state.deleted.push(u); if (id) delete state.sessions[id]; return hres(null, 204); }
    }
    // Supabase REST: drive_files (the COMPLETE mapping write)
    if (u.includes("/rest/v1/drive_files")) {
      if (state.driveFilesFail) return hres({ message: "boom" }, 500);
      state.mappings.push(JSON.parse(opts.body));
      return hres(null, 201);
    }
    throw new Error(`unexpected fetch: ${method} ${u}`);
  };
  vi.stubGlobal("fetch", fetchStub);
  return state;
}

afterEach(() => { vi.unstubAllGlobals(); });

const startReq = (body) => new Request("https://planyr.io/api/uploads/start", {
  method: "POST", headers: { authorization: "Bearer tok", "content-type": "application/json" }, body: JSON.stringify(body),
});
const chunkReq = (contentRange, bytes) => new Request("https://planyr.io/api/uploads/sess-1/chunk", {
  method: "PUT", headers: { authorization: "Bearer tok", ...(contentRange ? { "content-range": contentRange } : {}) }, body: bytes,
});
const idReq = (path, method = "GET") => new Request(`https://planyr.io/api/uploads/sess-1/${path}`, {
  method, headers: { authorization: "Bearer tok" },
});
const SESSION_ROW = {
  id: "sess-1", user_id: "u1", planyr_key: "project-x/civil/GPL.pdf", drive_session_uri: SESSION_URI,
  file_name: "GPL.pdf", mime_type: "application/pdf", total_bytes: 2000, bytes_received: 0,
  drive_file_id: null, status: "in_progress",
};

describe("POST /api/uploads/start", () => {
  it("401 on an invalid session; 503 when Drive isn't the backend", async () => {
    vi.stubGlobal("fetch", async (u) => (String(u).includes("/auth/v1/user") ? hres({}, 401) : hres({})));
    expect((await startPost({ env: ENV, request: startReq({}) })).status).toBe(401);
    vi.unstubAllGlobals();
    world({});
    expect((await startPost({ env: { ...ENV, PLANYR_STORAGE_BACKEND: "memory" }, request: startReq({}) })).status).toBe(503);
  });

  it("mints a Drive session, persists it, and returns ONLY { uploadId, chunkSize } — never the session URI", async () => {
    const state = world({});
    const resp = await startPost({ env: ENV, request: startReq({ fileName: "GPL.pdf", mimeType: "application/pdf", totalBytes: 125176019, planyrKey: "project-x/civil/GPL.pdf" }) });
    expect(resp.status).toBe(200);
    const text = await resp.text();
    const jr = JSON.parse(text);
    expect(jr).toEqual({ ok: true, uploadId: "sess-new", chunkSize: 16 * 1024 * 1024 });
    expect(text).not.toContain(SESSION_URI); // the capability URL stays server-side
    expect(state.sessions["sess-new"].drive_session_uri).toBe(SESSION_URI);
    expect(state.sessions["sess-new"].total_bytes).toBe(125176019);
    expect(state.deleted.some((u) => u.includes("expires_at=lt."))).toBe(true); // stale-session purge ran
  });

  it("rejects a missing planyrKey / non-positive totalBytes", async () => {
    world({});
    expect((await startPost({ env: ENV, request: startReq({ totalBytes: 10 }) })).status).toBe(400);
    world({});
    expect((await startPost({ env: ENV, request: startReq({ planyrKey: "k", totalBytes: 0 }) })).status).toBe(400);
  });
});

describe("PUT /api/uploads/<id>/chunk — ownership, relay, protocol", () => {
  it("IDOR: another user's uploadId is a 404 and Drive is never touched", async () => {
    const state = world({ uid: "attacker", sessions: { "sess-1": SESSION_ROW } }); // row owned by u1
    const resp = await chunkPut({ env: ENV, request: chunkReq("bytes 0-999/2000", new Uint8Array(1000)), params: { id: "sess-1" } });
    expect(resp.status).toBe(404);
    expect(state.driveCalls.length).toBe(0); // not a single byte forwarded
  });

  it("forwards the Content-Range verbatim, records 308 progress, and answers { received }", async () => {
    const state = world({
      sessions: { "sess-1": SESSION_ROW },
      drive: () => hres({}, 308, { range: "bytes=0-999" }),
    });
    const resp = await chunkPut({ env: ENV, request: chunkReq("bytes 0-999/2000", new Uint8Array(1000)), params: { id: "sess-1" } });
    expect(await resp.json()).toEqual({ ok: true, received: 1000 });
    expect(state.driveCalls[0].headers["content-range"]).toBe("bytes 0-999/2000");
    expect(state.patches).toContainEqual({ id: "sess-1", patch: { bytes_received: 1000 } });
  });

  it("the final chunk (Drive 200 + file id) marks the session complete", async () => {
    const state = world({
      sessions: { "sess-1": { ...SESSION_ROW, bytes_received: 1000 } },
      drive: () => hres({ id: "drive-file-7" }, 200),
    });
    const resp = await chunkPut({ env: ENV, request: chunkReq("bytes 1000-1999/2000", new Uint8Array(1000)), params: { id: "sess-1" } });
    expect(await resp.json()).toEqual({ ok: true, received: 2000, complete: true });
    expect(state.sessions["sess-1"]).toMatchObject({ status: "complete", drive_file_id: "drive-file-7" });
  });

  it("protocol violations are 400s: bad header, wrong total, body/range mismatch, out-of-order", async () => {
    const cases = [
      [chunkReq(null, new Uint8Array(10)), /Content-Range/],
      [chunkReq("bytes 0-9/999", new Uint8Array(10)), /doesn't match/],
      [chunkReq("bytes 0-9/2000", new Uint8Array(5)), /spans/],
      [chunkReq("bytes 500-509/2000", new Uint8Array(10)), /in order/],
    ];
    for (const [req, msg] of cases) {
      world({ sessions: { "sess-1": SESSION_ROW } });
      const resp = await chunkPut({ env: ENV, request: req, params: { id: "sess-1" } });
      expect(resp.status).toBe(400);
      expect((await resp.json()).error).toMatch(msg);
      vi.unstubAllGlobals();
    }
  });

  it("a Drive failure surfaces its reason loudly (LOUD-FAILURE), quota included", async () => {
    world({
      sessions: { "sess-1": SESSION_ROW },
      drive: () => hres({ error: { message: "Quota exceeded.", errors: [{ reason: "storageQuotaExceeded" }] } }, 403),
    });
    const resp = await chunkPut({ env: ENV, request: chunkReq("bytes 0-999/2000", new Uint8Array(1000)), params: { id: "sess-1" } });
    expect(resp.status).toBe(502);
    expect((await resp.json()).error).toMatch(/storageQuotaExceeded/);
  });
});

describe("GET /api/uploads/<id>/status — the resume point", () => {
  it("proxies Drive's byte count (probe with bytes */total) and re-syncs the row", async () => {
    const state = world({
      sessions: { "sess-1": { ...SESSION_ROW, bytes_received: 0 } },
      drive: () => hres({}, 308, { range: "bytes=0-1499" }),
    });
    const resp = await statusGet({ env: ENV, request: idReq("status"), params: { id: "sess-1" } });
    expect(await resp.json()).toEqual({ ok: true, received: 1500 });
    expect(state.driveCalls[0].headers["content-range"]).toBe("bytes */2000");
    expect(state.sessions["sess-1"].bytes_received).toBe(1500);
  });

  it("repairs a missed final-chunk write: Drive says finished → row marked complete", async () => {
    const state = world({ sessions: { "sess-1": SESSION_ROW }, drive: () => hres({ id: "f9" }, 200) });
    const resp = await statusGet({ env: ENV, request: idReq("status"), params: { id: "sess-1" } });
    expect(await resp.json()).toEqual({ ok: true, received: 2000, complete: true });
    expect(state.sessions["sess-1"]).toMatchObject({ status: "complete", drive_file_id: "f9" });
  });

  it("an already-complete row answers without a Drive round-trip; foreign id is 404", async () => {
    const state = world({ sessions: { "sess-1": { ...SESSION_ROW, status: "complete", drive_file_id: "f1" } } });
    const resp = await statusGet({ env: ENV, request: idReq("status"), params: { id: "sess-1" } });
    expect(await resp.json()).toEqual({ ok: true, received: 2000, complete: true });
    expect(state.driveCalls.length).toBe(0);
    vi.unstubAllGlobals();
    world({ uid: "attacker", sessions: { "sess-1": SESSION_ROW } });
    expect((await statusGet({ env: ENV, request: idReq("status"), params: { id: "sess-1" } })).status).toBe(404);
  });
});

describe("POST /api/uploads/<id>/complete — mapping + rollback", () => {
  it("refuses an unfinished upload (409)", async () => {
    world({ sessions: { "sess-1": SESSION_ROW } });
    const resp = await completePost({ env: ENV, request: idReq("complete", "POST"), params: { id: "sess-1" } });
    expect(resp.status).toBe(409);
  });

  it("records the uid-scoped drive_files mapping and retires the session", async () => {
    const state = world({ sessions: { "sess-1": { ...SESSION_ROW, status: "complete", drive_file_id: "f7", bytes_received: 2000 } } });
    const resp = await completePost({ env: ENV, request: idReq("complete", "POST"), params: { id: "sess-1" } });
    expect(await resp.json()).toEqual({ ok: true, planyrKey: "project-x/civil/GPL.pdf" });
    expect(state.mappings[0]).toMatchObject({ planyr_key: "u1/project-x/civil/GPL.pdf", drive_id: "f7", name: "GPL.pdf" });
    expect(state.sessions["sess-1"]).toBeUndefined(); // session row retired
  });

  it("NEW-4: a failed mapping write rolls the Drive file back and fails honestly", async () => {
    const state = world({
      sessions: { "sess-1": { ...SESSION_ROW, status: "complete", drive_file_id: "f7" } },
      driveFilesFail: true,
    });
    const resp = await completePost({ env: ENV, request: idReq("complete", "POST"), params: { id: "sess-1" } });
    expect(resp.status).toBe(502);
    expect((await resp.json()).error).toMatch(/rolled back/i);
    expect(state.driveDeletes.some((u) => u.includes("/files/f7"))).toBe(true); // bytes rolled back
    expect(state.sessions["sess-1"].status).toBe("aborted");
  });
});

describe("integration: init → several 308s → final 200 (mock Drive resumable)", () => {
  it("carries one upload through start → 3 chunks → complete against the same state", async () => {
    // A fake Drive that actually accumulates bytes for the session.
    let got = 0;
    const total = 2500;
    const state = world({
      drive: (call) => {
        const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(call.headers["content-range"]);
        got = Number(m[2]) + 1;
        return got >= total ? hres({ id: "drive-final" }, 200) : hres({}, 308, { range: `bytes=0-${got - 1}` });
      },
    });
    const start = await startPost({ env: ENV, request: startReq({ fileName: "a.pdf", mimeType: "application/pdf", totalBytes: total, planyrKey: "p/a.pdf" }) });
    const { uploadId } = await start.json();
    const send = (from, to) => chunkPut({
      env: ENV,
      request: new Request(`https://planyr.io/api/uploads/${uploadId}/chunk`, {
        method: "PUT", headers: { authorization: "Bearer tok", "content-range": `bytes ${from}-${to - 1}/${total}` }, body: new Uint8Array(to - from),
      }),
      params: { id: uploadId },
    });
    expect(await (await send(0, 1000)).json()).toEqual({ ok: true, received: 1000 });
    expect(await (await send(1000, 2000)).json()).toEqual({ ok: true, received: 2000 });
    expect(await (await send(2000, 2500)).json()).toEqual({ ok: true, received: 2500, complete: true });
    const done = await completePost({
      env: ENV,
      request: new Request(`https://planyr.io/api/uploads/${uploadId}/complete`, { method: "POST", headers: { authorization: "Bearer tok" } }),
      params: { id: uploadId },
    });
    expect(await done.json()).toEqual({ ok: true, planyrKey: "p/a.pdf" });
    expect(state.mappings[0]).toMatchObject({ planyr_key: "u1/p/a.pdf", drive_id: "drive-final" });
  });
});
