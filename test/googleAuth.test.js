import { describe, it, expect } from "vitest";
import {
  buildConsentUrl, exchangeCodeForTokens, accessTokenFromRefresh, makeTokenProvider, DRIVE_FILE_SCOPE,
} from "../server/oauth/googleAuth.js";

// A fake fetch that returns a canned JSON response and records the last call.
const fakeFetch = (status, json) => {
  const calls = [];
  const fn = async (url, opts) => { calls.push({ url, opts }); return { ok: status >= 200 && status < 300, status, json: async () => json }; };
  fn.calls = calls;
  return fn;
};

describe("googleAuth — consent URL (B207)", () => {
  it("requests offline access + forced consent with the drive.file scope and pinned redirect", () => {
    const u = new URL(buildConsentUrl({ clientId: "cid", origin: "https://planyr.io" }));
    expect(u.searchParams.get("client_id")).toBe("cid");
    expect(u.searchParams.get("redirect_uri")).toBe("https://planyr.io/api/auth/google/callback");
    expect(u.searchParams.get("scope")).toBe(DRIVE_FILE_SCOPE);
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("prompt")).toBe("consent");
  });
});

describe("googleAuth — token exchange (B207)", () => {
  it("returns the refresh token from a successful code exchange", async () => {
    const f = fakeFetch(200, { refresh_token: "rt", access_token: "at", expires_in: 3600 });
    const r = await exchangeCodeForTokens({ code: "c", clientId: "id", clientSecret: "s", origin: "https://planyr.io", fetchImpl: f });
    expect(r.ok).toBe(true);
    expect(r.refreshToken).toBe("rt");
    expect(f.calls[0].url).toBe("https://oauth2.googleapis.com/token");
  });
  it("surfaces a token error visibly (no throw)", async () => {
    const f = fakeFetch(400, { error: "invalid_grant", error_description: "bad code" });
    const r = await exchangeCodeForTokens({ code: "c", clientId: "id", clientSecret: "s", origin: "https://planyr.io", fetchImpl: f });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/bad code/);
  });
  it("missing code fails before any network call", async () => {
    const f = fakeFetch(200, {});
    expect((await exchangeCodeForTokens({ fetchImpl: f })).ok).toBe(false);
    expect(f.calls).toHaveLength(0);
  });
});

describe("googleAuth — access token from refresh + caching (B207)", () => {
  it("swaps a refresh token for an access token", async () => {
    const f = fakeFetch(200, { access_token: "at", expires_in: 3600 });
    const r = await accessTokenFromRefresh({ refreshToken: "rt", clientId: "id", clientSecret: "s", fetchImpl: f });
    expect(r.ok).toBe(true);
    expect(r.accessToken).toBe("at");
  });
  it("makeTokenProvider caches until near expiry, then refreshes", async () => {
    let n = 0;
    const f = fakeFetch(200, { access_token: "at", expires_in: 3600 });
    const get = makeTokenProvider({ refreshToken: "rt", clientId: "id", clientSecret: "s", fetchImpl: f, now: () => n });
    expect(await get()).toBe("at");
    expect(await get()).toBe("at");        // cached — no second call
    expect(f.calls).toHaveLength(1);
    n += 3600 * 1000;                        // jump past expiry
    await get();
    expect(f.calls).toHaveLength(2);         // refreshed
  });
  it("a failed refresh throws (so the adapter turns it into a visible op failure)", async () => {
    const f = fakeFetch(400, { error: "invalid_grant" });
    const get = makeTokenProvider({ refreshToken: "rt", clientId: "id", clientSecret: "s", fetchImpl: f });
    await expect(get()).rejects.toThrow(/invalid_grant/);
  });
});
