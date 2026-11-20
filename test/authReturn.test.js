/* NEW-1 point 1 + 6 — the URL's answer about an e-mail link, read before anything erases it. */
import { describe, it, expect } from "vitest";
import { parseAuthReturn, stripAuthErrorParams, authReturnNotice } from "../src/shared/auth/authReturn.js";
import { authEventMeta } from "../src/shared/auth/sessionIntent.js";

describe("parseAuthReturn", () => {
  it("an expired reset link (hash form, exactly what Supabase sends)", () => {
    const r = parseAuthReturn("", "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
    expect(r.failure).toEqual({ code: "otp_expired", expired: true });
    expect(r.recovery).toBe(false);
  });
  it("the query-string form, and an error with no code that says expired", () => {
    expect(parseAuthReturn("?error=access_denied&error_code=otp_expired", "").failure.expired).toBe(true);
    expect(parseAuthReturn("", "#error=access_denied&error_description=Email+link+has+expired").failure.expired).toBe(true);
  });
  it("some other link error is still a failure, just not 'expired'", () => {
    expect(parseAuthReturn("", "#error=server_error&error_code=unexpected_failure&error_description=boom").failure).toEqual({ code: "unexpected_failure", expired: false });
  });
  it("a recovery link → recovery, no failure", () => {
    const r = parseAuthReturn("", "#access_token=abc&refresh_token=def&expires_in=3600&token_type=bearer&type=recovery");
    expect(r).toEqual({ recovery: true, failure: null });
  });
  it("ordinary routes and other link types are neither", () => {
    expect(parseAuthReturn("", "#/project/abc/site")).toEqual({ recovery: false, failure: null });
    expect(parseAuthReturn("?app", "")).toEqual({ recovery: false, failure: null });
    expect(parseAuthReturn("", "#access_token=abc&type=signup").recovery).toBe(false);
    expect(parseAuthReturn("", "#type=recovery").recovery).toBe(false);                 // a type with no token is not a link
    expect(parseAuthReturn("", "")).toEqual({ recovery: false, failure: null });
    expect(parseAuthReturn(undefined, undefined)).toEqual({ recovery: false, failure: null });
  });
  it("words", () => {
    expect(authReturnNotice({ expired: true })).toBe("That link has expired. Send yourself a new one.");
    expect(authReturnNotice({ expired: false })).toContain("didn't work");
    expect(authReturnNotice(null)).toBe("");
  });
});

describe("stripAuthErrorParams", () => {
  it("removes only the error parameters and leaves the rest of the URL alone", () => {
    expect(stripAuthErrorParams("?app", "#error=a&error_code=b&error_description=c")).toEqual({ search: "?app", hash: "" });
    expect(stripAuthErrorParams("?app&error=a&error_code=b", "#/site")).toEqual({ search: "?app", hash: "#/site" });
    expect(stripAuthErrorParams("?x=1", "#/project/p/site")).toEqual({ search: "?x=1", hash: "#/project/p/site" });
  });
});

describe("authEventMeta — signed out vs. session died vs. not known yet (points 4 + 5)", () => {
  const stored = { storedNow: true, bootHadStored: true };
  it("a boot with an empty answer while a session is still stored is PENDING, not signed out", () => {
    expect(authEventMeta("INITIAL_SESSION", null, stored)).toEqual({ deliberate: false, pending: true, lost: false });
  });
  it("a boot that found a session and has none now (the server refused it) was LOST", () => {
    expect(authEventMeta("INITIAL_SESSION", null, { storedNow: false, bootHadStored: true }).lost).toBe(true);
  });
  it("a plain signed-out boot is neither", () => {
    expect(authEventMeta("INITIAL_SESSION", null, {})).toEqual({ deliberate: false, pending: false, lost: false });
  });
  it("SIGNED_OUT nobody here asked for is lost; one the person asked for is not", () => {
    expect(authEventMeta("SIGNED_OUT", null, { deliberate: false }).lost).toBe(true);
    expect(authEventMeta("SIGNED_OUT", null, { deliberate: true })).toEqual({ deliberate: true, pending: false, lost: false });
  });
  it("any event with a user is never pending/lost", () => {
    expect(authEventMeta("TOKEN_REFRESHED", { id: "u" }, stored)).toEqual({ deliberate: false, pending: false, lost: false });
  });
});
