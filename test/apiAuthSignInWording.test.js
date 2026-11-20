import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

/* NEW-1 (2026-11-10), follow-up to B2671206 / PR #2899. #2899 made the shared /api helper refresh the sign-in and retry
 * once, and fixed the folder ORGANIZER banner. The Library's Drive footer ("Sync now") still printed the server's raw
 * string after the retry was refused too: "! Invalid or expired session (403). Retry". The server answers a refused token
 * with 401 and that text — the 403 is Supabase's status echoed inside our own sentence.
 *
 * RED ON MAIN: every case below fails on c106025 — the footer, the share link and auto-filing each showed
 * "Invalid or expired session (403)." and the team-invite email showed it as `error`. */

const h = vi.hoisted(() => ({
  session: null,
  refresh: async () => ({ data: { session: null }, error: { name: "AuthApiError", status: 400 } }),
  refreshCalls: 0,
}));

vi.mock("../src/workspaces/site-planner/lib/supabase.js", () => {
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

import { signInMessage, apiErrorText, isSignInAnswer, authedFetch, authedFetchResponse } from "../src/shared/auth/apiAuth.js";
import { syncFoldersToDrive, planFolderDelete, moveDriveFileToFolder, purgeProjectFolders } from "../src/workspaces/library/lib/folders.js";
import { runDriveSync } from "../src/workspaces/library/lib/driveSyncRun.js";
import { DriveBadge } from "../src/workspaces/library/components/FolderTree.jsx";
import { getShareLink } from "../src/workspaces/doc-review/lib/reviewStore.js";
import { interpretResponse } from "../src/workspaces/doc-review/lib/autofiling.js";
import { sendInviteEmail } from "../src/workspaces/site-planner/lib/teams.js";
import { resendInvitation } from "../src/app/teamInvites.js";
import { uploadFileInChunks } from "../src/shared/files/chunkedUpload.js";

const inSeconds = (n) => Math.floor(Date.now() / 1000) + n;
const goodSession = (token = "good") => ({ access_token: token, expires_at: inSeconds(3600), user: { id: "u1" } });
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const RAW = "Invalid or expired session (403).";
// Words a person must never read for a dead sign-in.
const LEAK = /\(\d{3}\)|HTTP|\b40[0-3]\b|Invalid or expired session|\bjwt\b|bearer/i;

beforeEach(() => {
  h.session = goodSession("stale");
  h.refreshCalls = 0;
  h.refresh = async () => { h.session = goodSession("fresh"); return { data: { session: h.session }, error: null }; };
  globalThis.fetch = vi.fn(async () => json(401, { ok: false, error: RAW })); // the server refuses EVERY token, renewed or not
});

describe("the shared words", () => {
  it("signInMessage is plain: no code, no HTTP, no server string", () => {
    expect(signInMessage("sync")).toBe("Your sign-in expired — sign in again to sync.");
    expect(signInMessage()).not.toMatch(LEAK);
    expect(apiErrorText(401, RAW, { action: "sync" })).toBe(signInMessage("sync"));
    expect(apiErrorText(200, RAW)).toBe(signInMessage()); // the server's refused-token text is recognised on any status
    expect(apiErrorText(500, "", {})).toBe("HTTP 500"); // an ordinary failure keeps its technical line (telemetry)
    expect(apiErrorText(409, "Plan is live.")).toBe("Plan is live.");
    expect(isSignInAnswer(401, "")).toBe(true);
    expect(isSignInAnswer(500, "boom")).toBe(false);
  });

  it("authedFetch says signIn:true for a 401 that survives the renewal, and for a refused renewal — and false for anything else", async () => {
    const twice = await authedFetch("/api/x", {});
    expect(twice).toMatchObject({ signIn: true, refreshed: true });
    expect(twice.resp.status).toBe(401);
    h.session = goodSession("stale");
    h.refresh = async () => ({ data: { session: null }, error: { name: "AuthApiError", status: 400 } });
    expect(await authedFetch("/api/x", {})).toMatchObject({ signIn: true, failure: "signed-out" });
    h.session = null;
    expect(await authedFetch("/api/x", {})).toMatchObject({ signIn: true, resp: null });
    h.session = goodSession("stale");
    h.refresh = async () => ({ data: { session: null }, error: { name: "AuthRetryableFetchError", status: 0 } });
    expect(await authedFetch("/api/x", {})).toMatchObject({ signIn: false, failure: "unreachable" });
    globalThis.fetch = vi.fn(async () => json(200, { ok: true }));
    h.session = goodSession("good");
    expect(await authedFetch("/api/x", {})).toMatchObject({ signIn: false, failure: null });
  });
});

describe("the Library folder tree's Drive footer (Sync now)", () => {
  async function footerAfter(setup) {
    setup?.();
    const seen = [];
    await runDriveSync({ projectId: "g1", isShown: () => true, setDrive: (d) => seen.push(d), sync: syncFoldersToDrive, remember: () => {} });
    const drive = seen[seen.length - 1];
    const html = renderToStaticMarkup(React.createElement(DriveBadge, { drive, onSync: () => {}, onSignIn: () => {} }));
    return { drive, html, text: html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() };
  }

  it("RED ON MAIN — two 401s (refused, refresh 200, refused again): the footer says the sign-in expired, with no code and no server string", async () => {
    const { drive, text, html } = await footerAfter();
    expect(h.refreshCalls).toBe(1);               // the renewal happened ONCE; the second refusal ends it
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(text).not.toMatch(LEAK);
    expect(text).toMatch(/Your sign-in expired — sign in again to sync\./);
    expect(drive).toMatchObject({ state: "error", signIn: true });
    expect(html).toMatch(/data-testid="library-drive-signin"/); // and offers the app's sign-in
    expect(text).toMatch(/Sign in$/);
  });

  it("the renewal itself refused: the SAME sentence — and not 'Google Drive isn't connected'", async () => {
    const { drive, text } = await footerAfter(() => { h.refresh = async () => ({ data: { session: null }, error: { name: "AuthApiError", status: 400 } }); });
    expect(text).toMatch(/Your sign-in expired — sign in again to sync\./);
    expect(text).not.toMatch(/isn't connected|LEAK/);
    expect(drive.signIn).toBe(true);
  });

  it("known-good arm — a working sign-in still reads 'Synced to Google Drive' (this check can see the success path)", async () => {
    globalThis.fetch = vi.fn(async () => json(200, { ok: true, summary: {}, total: 0, remaining: 0 }));
    h.session = goodSession("good");
    const { drive, text } = await footerAfter();
    expect(drive.state).toBe("ok");
    expect(text).toMatch(/Synced to Google Drive/);
    expect(text).not.toMatch(/Sign in/);
  });

  it("an ordinary server failure is not dressed up as a sign-in problem", async () => {
    globalThis.fetch = vi.fn(async () => json(500, { ok: false, error: "Drive exploded" }));
    h.session = goodSession("good");
    const { drive, text } = await footerAfter();
    expect(drive.signIn).toBeUndefined();
    expect(text).toMatch(/Drive exploded/);
    expect(text).toMatch(/Retry/);
  });

  it("the other /api/folders doors speak the same sentence (move, plan-delete, purge)", async () => {
    const mv = await moveDriveFileToFolder("g1", "k", "Design");
    h.session = goodSession("stale");
    const plan = await planFolderDelete("g1", "f1");
    h.session = goodSession("stale");
    const purge = await purgeProjectFolders("g1");
    for (const r of [mv, plan, purge]) expect(r.error).not.toMatch(LEAK);
    expect(mv.authExpired).toBe(true);
    expect(plan.authExpired).toBe(true);
    expect(purge.error).toMatch(/sign-in expired/);
  });
});

describe("every other surface fed by the apiAuth helper", () => {
  it("Review share link: two 401s → the sign-in sentence, flagged signIn (RED ON MAIN: 'Invalid or expired session (403).')", async () => {
    const r = await getShareLink("p/key.pdf");
    expect(r).toMatchObject({ ok: false, signIn: true });
    expect(r.error).toBe(signInMessage("share this file"));
    expect(r.error).not.toMatch(LEAK);
  });

  it("Review auto-filing: a 401 answer → the sign-in sentence (RED ON MAIN: the server's string)", () => {
    const r = interpretResponse(401, { ok: false, error: RAW });
    expect(r).toMatchObject({ ok: false, signIn: true, error: signInMessage("auto-file") });
    expect(interpretResponse(500, { error: "kaput" }).error).toBe("kaput");
    expect(interpretResponse(503, {}).skipped).toBe(true);
  });

  it("team invite email: two 401s → the sign-in sentence (RED ON MAIN: 'Invalid or expired session (403).')", async () => {
    const r = await sendInviteEmail("t1", "a@b.co");
    expect(r).toMatchObject({ ok: false, signIn: true });
    expect(r.error).not.toMatch(LEAK);
    expect(r.error).toMatch(/sign-in expired/);
  });

  it("team invite resend: two 401s → plain sign-in text", async () => {
    const r = await resendInvitation("u1", "a@b.co");
    expect(r.ok).toBe(false);
    expect(r.text).not.toMatch(LEAK);
    expect(r.text).toMatch(/sign-in expired/);
  });

  it("chunked upload: a 401 that survives the renewal stops at once (no backoff loop) with the sign-in sentence", async () => {
    const res = await uploadFileInChunks({
      fetchImpl: (u, i) => authedFetchResponse(u, i),
      file: new Blob([new Uint8Array(10)]), token: async () => "t", planyrKey: "k", name: "a.pdf", contentType: "application/pdf",
      sleep: async () => {},
    });
    expect(res.ok).toBe(false);
    expect(res.error).not.toMatch(LEAK);
    expect(res.error).toMatch(/sign-in expired/);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2); // the first 401 + the single retry, never the 5-attempt budget
  });
});
