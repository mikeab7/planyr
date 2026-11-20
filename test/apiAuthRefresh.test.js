import { describe, it, expect, beforeEach, vi } from "vitest";

/* NEW-1 (2026-11-09) — the Library's one-time folder organizer printed "Grand Port: Invalid or expired session
 * (403)." on an unrelated project because every /api/* call sent whatever access token getSession() held, once,
 * with no refresh and no retry. These tests pin the shared helper (src/shared/auth/apiAuth.js) and the organizer
 * built on it. RED on main: the old folders.js never refreshed, so case "expired first token" ends in an error
 * and no done-marker. */

// ── a controllable sign-in ────────────────────────────────────────────────────────────────────────────────
const h = vi.hoisted(() => ({
  session: null, // { access_token, expires_at }
  refresh: async () => ({ data: { session: null }, error: { name: "AuthApiError", status: 400, message: "refused" } }),
  refreshCalls: 0,
}));

vi.mock("../src/workspaces/site-planner/lib/supabase.js", () => {
  // project_folders count query used by ensureSeeded: the project already has rows.
  const builder = () => { const b = { then(res) { res({ count: 3, data: null, error: null }); } }; for (const m of ["select", "eq"]) b[m] = () => b; return b; };
  return {
    supabase: {
      from: () => builder(),
      auth: {
        getSession: async () => ({ data: { session: h.session } }),
        refreshSession: async () => { h.refreshCalls += 1; return h.refresh(); },
      },
    },
  };
});

import { getApiToken, authedFetch, NEAR_EXPIRY_MS, FAIL_SIGNED_OUT, FAIL_UNREACHABLE } from "../src/shared/auth/apiAuth.js";
import { migrateAllProjects, migrateProjectFiles, moveDriveFileToFolder, planFolderDelete, ORGANIZER_SIGNIN_EXPIRED } from "../src/workspaces/library/lib/folders.js";
import { runOrganizer } from "../src/workspaces/library/lib/organizerRun.js";

const inSeconds = (n) => Math.floor(Date.now() / 1000) + n;
const goodSession = (token = "good") => ({ access_token: token, expires_at: inSeconds(3600) });
const refreshesTo = (token) => async () => {
  h.session = goodSession(token);
  return { data: { session: h.session }, error: null };
};
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

let calls; // { url, auth, action }
function installFetch(handler) {
  calls = [];
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const auth = (init.headers && (init.headers.authorization || init.headers.Authorization)) || "";
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, auth, action: body && body.action });
    return handler({ url, auth, body });
  });
}

beforeEach(() => {
  h.session = goodSession("good");
  h.refreshCalls = 0;
  h.refresh = refreshesTo("fresh");
});

describe("getApiToken", () => {
  it("a valid token is used as-is — NO refresh call", async () => {
    const t = await getApiToken();
    expect(t).toEqual({ token: "good", refreshed: false, failure: null });
    expect(h.refreshCalls).toBe(0);
  });

  it("a token at or near expiry is refreshed BEFORE use", async () => {
    h.session = { access_token: "old", expires_at: inSeconds(NEAR_EXPIRY_MS / 1000 - 5) };
    const t = await getApiToken();
    expect(t).toMatchObject({ token: "fresh", refreshed: true });
    expect(h.refreshCalls).toBe(1);
  });

  it("near expiry and the renewal can't be asked (offline): a token that still has life is used", async () => {
    h.session = { access_token: "old", expires_at: inSeconds(20) };
    h.refresh = async () => ({ data: { session: null }, error: { name: "AuthRetryableFetchError", status: 0 } });
    expect(await getApiToken()).toMatchObject({ token: "old", failure: null });
  });

  it("already expired and the renewal is refused: signed out, not a stale token", async () => {
    h.session = { access_token: "old", expires_at: inSeconds(-30) };
    h.refresh = async () => ({ data: { session: null }, error: { name: "AuthApiError", status: 400 } });
    expect(await getApiToken()).toEqual({ token: null, refreshed: false, failure: FAIL_SIGNED_OUT });
  });

  it("no session at all: signed out, no refresh attempted", async () => {
    h.session = null;
    expect(await getApiToken()).toMatchObject({ token: null, failure: FAIL_SIGNED_OUT });
    expect(h.refreshCalls).toBe(0);
  });

  it("concurrent renewals share ONE refreshSession call", async () => {
    h.session = { access_token: "old", expires_at: inSeconds(5) };
    const slow = refreshesTo("fresh");
    h.refresh = async () => { await new Promise((r) => setTimeout(r, 10)); return slow(); };
    const [a, b, c] = await Promise.all([getApiToken(), getApiToken(), getApiToken({ refresh: true })]);
    expect([a.token, b.token, c.token]).toEqual(["fresh", "fresh", "fresh"]);
    expect(h.refreshCalls).toBe(1);
  });
});

describe("authedFetch — refresh once, retry once", () => {
  it("token valid: ONE request, no refresh", async () => {
    installFetch(() => json(200, { ok: true }));
    const r = await authedFetch("/api/x", { method: "POST" });
    expect(r.resp.status).toBe(200);
    expect(calls.map((c) => c.auth)).toEqual(["Bearer good"]);
    expect(h.refreshCalls).toBe(0);
  });

  it("first call 401, succeeds after refresh: two requests, the second carries the NEW token", async () => {
    installFetch(({ auth }) => (auth === "Bearer good" ? json(401, { ok: false, error: "Invalid or expired session (403)." }) : json(200, { ok: true })));
    const r = await authedFetch("/api/x", { method: "POST" });
    expect(r.resp.status).toBe(200);
    expect(r.refreshed).toBe(true);
    expect(calls.map((c) => c.auth)).toEqual(["Bearer good", "Bearer fresh"]);
    expect(h.refreshCalls).toBe(1);
  });

  it("a SECOND 401 is returned as the answer — exactly one retry, no loop", async () => {
    installFetch(() => json(401, { ok: false, error: "nope" }));
    const r = await authedFetch("/api/x", {});
    expect(r.resp.status).toBe(401);
    expect(calls).toHaveLength(2);
    expect(h.refreshCalls).toBe(1);
  });

  it("the refresh itself is refused: signed-out failure, NO retry request, NO second refresh", async () => {
    h.refresh = async () => ({ data: { session: null }, error: { name: "AuthApiError", status: 400 } });
    installFetch(() => json(401, { ok: false, error: "expired" }));
    const r = await authedFetch("/api/x", {});
    expect(r.failure).toBe(FAIL_SIGNED_OUT);
    expect(r.resp.status).toBe(401); // the original answer stays readable
    expect(calls).toHaveLength(1);
    expect(h.refreshCalls).toBe(1);
  });

  it("the refresh can't be asked (offline): reported as unreachable, not as signed out", async () => {
    h.refresh = async () => ({ data: { session: null }, error: { name: "AuthRetryableFetchError", status: 0 } });
    installFetch(() => json(401, {}));
    expect((await authedFetch("/api/x", {})).failure).toBe(FAIL_UNREACHABLE);
  });

  it("no session: nothing is sent", async () => {
    h.session = null;
    installFetch(() => json(200, {}));
    const r = await authedFetch("/api/x", {});
    expect(r).toMatchObject({ resp: null, failure: FAIL_SIGNED_OUT });
    expect(calls).toHaveLength(0);
  });
});

// ── the organizer ──────────────────────────────────────────────────────────────────────────────────────
const PROJECTS = [{ id: "g1", name: "Grand Port" }, { id: "g2", name: "Georgia Test Site" }];
const okServer = ({ body }) => {
  if (body.action === "sync") return json(200, { ok: true, summary: { created: 0 }, total: 0, remaining: 0 });
  if (body.action === "migrate-files") return json(200, { ok: true, done: true, moved: 2, nextOffset: 1 });
  return json(200, { ok: true });
};
const expiringServer = (stale, then = okServer) => (req) => (req.auth === `Bearer ${stale}` ? json(401, { ok: false, error: "Invalid or expired session (403)." }) : then(req));

async function runLikeLibrary(projects = PROJECTS) {
  const marks = [];
  const out = await runOrganizer({ projects, uid: "u1", checkIdentity: async () => true, markDone: (u) => marks.push(u) });
  return { out, marks };
}

describe("the folder organizer", () => {
  it("RED ON MAIN — an expired token whose first /api/folders call is 401 completes after the refresh and WRITES the done-marker", async () => {
    h.session = goodSession("stale");
    installFetch(expiringServer("stale"));
    const { out, marks } = await runLikeLibrary();
    expect(out.status).toBe("done");
    expect(out.result.errors).toEqual([]);
    expect(marks).toEqual(["u1"]);
    expect(h.refreshCalls).toBe(1); // refreshed once; the new token then served every later call
    expect(calls.filter((c) => c.auth === "Bearer stale")).toHaveLength(1);
  });

  it("a token that is fine is never refreshed", async () => {
    installFetch(okServer);
    const { out, marks } = await runLikeLibrary();
    expect(out.status).toBe("done");
    expect(marks).toEqual(["u1"]);
    expect(h.refreshCalls).toBe(0);
  });

  it("a GENUINE second failure (still 401 after the refresh) shows the plain sign-in message — no project name, no status code, no marker", async () => {
    installFetch(() => json(401, { ok: false, error: "Invalid or expired session (403)." }));
    const { out, marks } = await runLikeLibrary();
    expect(out.status).toBe("error");
    expect(out.signIn).toBe(true);
    expect(out.text).toBe(ORGANIZER_SIGNIN_EXPIRED);
    expect(out.text).not.toMatch(/Grand Port|Georgia|403|401|HTTP|\(\d{3}\)/);
    expect(marks).toEqual([]);
    expect(out.result.authExpired).toBe(true);
    // the walk STOPPED: the second project was never attempted (it would fail the same way)
    expect(calls.some((c) => c.action && out.result.errors.some((e) => /Georgia/.test(e)))).toBe(false);
    expect(calls).toHaveLength(2); // sync + the one retry, then nothing else
  });

  it("the refresh itself fails: signed-out message with the sign-in action, no retry loop", async () => {
    h.session = goodSession("stale");
    h.refresh = async () => ({ data: { session: null }, error: { name: "AuthApiError", status: 400 } });
    installFetch(expiringServer("stale"));
    const { out, marks } = await runLikeLibrary();
    expect(out).toMatchObject({ status: "error", signIn: true, text: ORGANIZER_SIGNIN_EXPIRED });
    expect(marks).toEqual([]);
    expect(h.refreshCalls).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it("a 401 on the FILE-MOVE phase (not just the mirror phase) is refreshed and retried too", async () => {
    // The mirror passes with the original token; the token is revoked by the time files are moved.
    h.session = goodSession("t1");
    installFetch((req) => {
      if (req.body.action === "sync") return okServer(req);
      return req.auth === "Bearer t1" ? json(401, { ok: false, error: "Invalid or expired session (403)." }) : okServer(req);
    });
    const { out, marks } = await runLikeLibrary();
    expect(out.status).toBe("done");
    expect(marks).toEqual(["u1"]);
    expect(h.refreshCalls).toBe(1);
    expect(calls.map((c) => c.action).slice(0, 3)).toEqual(["sync", "migrate-files", "migrate-files"]);
  });

  it("a 401 on the file-move phase that survives the refresh surfaces the plain sign-in message", async () => {
    installFetch((req) => (req.body.action === "sync" ? okServer(req) : json(401, { ok: false, error: "Invalid or expired session (403)." })));
    const { out } = await runLikeLibrary();
    expect(out).toMatchObject({ status: "error", signIn: true, text: ORGANIZER_SIGNIN_EXPIRED });
  });

  it("an ordinary server failure never prints a status code or names the project", async () => {
    installFetch((req) => (req.body.action === "sync" ? json(500, {}) : okServer(req)));
    const { out, marks } = await runLikeLibrary();
    expect(out.status).toBe("error");
    expect(out.signIn).toBe(false);
    expect(out.text).toMatch(/couldn't finish for 2 of 2 projects/i);
    expect(out.text).not.toMatch(/Grand Port|Georgia|500|HTTP/);
    expect(out.result.errors.join(" ")).toMatch(/HTTP 500/); // the technical line still exists for telemetry
    expect(marks).toEqual([]);
  });

  it("offline reads as 'couldn't reach Planyr', not as a sign-in problem", async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    const { out } = await runLikeLibrary();
    expect(out.signIn).toBe(false);
    expect(out.text).toMatch(/Couldn't reach Planyr/);
  });
});

describe("the other /api/folders callers share the same refresh-and-retry", () => {
  it("moveDriveFileToFolder and planFolderDelete recover from an expired first token; migrateProjectFiles reports authExpired only after the retry", async () => {
    h.session = goodSession("stale");
    installFetch(expiringServer("stale", () => json(200, { ok: true, folders: [], files: [] })));
    expect(await moveDriveFileToFolder("g1", "k", "Design")).toMatchObject({ ok: true });
    h.session = goodSession("stale");
    expect(await planFolderDelete("g1", "f1")).toMatchObject({ ok: true });
    installFetch(() => json(401, { ok: false, error: "expired" }));
    expect(await migrateProjectFiles("g1")).toMatchObject({ ok: false, authExpired: true });
  });
});

// ── source guard: nobody writes a second bare getSession → Bearer for our own /api/* ─────────────────────
import fs from "node:fs";
import path from "node:path";

function srcFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) srcFiles(p, out);
    else if (/\.(js|jsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe("no second bare token path (NEW-1)", () => {
  const files = srcFiles(path.resolve(__dirname, "../src"));
  const read = (f) => fs.readFileSync(f, "utf8");

  it("no src file both reads getSession() and builds a Bearer header — only shared/auth/apiAuth.js does the former for /api", () => {
    const HELPER = path.join("shared", "auth", "apiAuth.js");
    const offenders = files.filter((f) => !f.endsWith(HELPER)).filter((f) => { const t = read(f); return /getSession\s*\(/.test(t) && /Bearer\s*\$\{/.test(t); });
    expect(offenders.map((f) => path.relative(process.cwd(), f))).toEqual([]);
  });

  it("folders.js sends every /api/folders request through the shared helper", () => {
    const t = read(path.resolve(__dirname, "../src/workspaces/library/lib/folders.js"));
    expect(t).not.toMatch(/fetch\(\s*["']\/api\/folders/);
    expect(t).toMatch(/authedFetch\(\s*["']\/api\/folders/);
  });
});
