/* NEW-1 (email sign-in / reset link) — the pure rules shared by the /api/auth/email-link route and the
 * landing page: token shape, the carried route, the account hint, the landing page's state table. */
import { describe, it, expect } from "vitest";
import {
  isTokenShape, safeNextRoute, buildAuthLinkUrl, parseAuthLinkSearch, stripAuthLinkParams, accountHint,
  landingPlan, classifyVerifyFailure, LINK_VALID_MINUTES,
} from "../src/shared/auth/authLink.js";

describe("token shape", () => {
  it("accepts a GoTrue hashed_token (hex / url-safe) and nothing else", () => {
    expect(isTokenShape("a".repeat(56))).toBe(true);
    expect(isTokenShape("0123456789abcdef".repeat(4))).toBe(true);
    for (const bad of ["", null, undefined, "short", "a b".repeat(20), "a".repeat(200), "<script>alert(1)</script>".padEnd(40, "x"), "../".repeat(20)]) expect(isTokenShape(bad)).toBe(false);
  });
});

describe("safeNextRoute — only an in-app hash route is ever carried", () => {
  it("keeps plain app routes", () => {
    expect(safeNextRoute("#/library")).toBe("/library");
    expect(safeNextRoute("/markup")).toBe("/markup");
    expect(safeNextRoute("#/site/abc-123")).toBe("/site/abc-123");
  });
  it("refuses anything that could leave the app or carry script", () => {
    for (const bad of ["https://evil.example/", "//evil.example", "javascript:alert(1)", "#/a?b=c", "#/a b", "#/../x", "", null, undefined, "#", "#/" + "a".repeat(200), "#/a\\b", "#/%2e%2e/x"]) expect(safeNextRoute(bad)).toBe(null);
  });
});

describe("account hint — a short fingerprint that cannot name the address", () => {
  it("is stable, case-insensitive, 8 hex characters", async () => {
    const a = await accountHint("Michael@Example.com "), b = await accountHint("michael@example.com");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
    expect(await accountHint("someone@else.example")).not.toBe(a);
    expect(await accountHint("")).toBe(null);
  });
});

describe("link url", () => {
  it("is a Planyr page carrying the token and kind, never the address", async () => {
    const t = "a".repeat(56);
    const u = new URL(await buildAuthLinkUrl({ appUrl: "https://planyr.io/", kind: "signin", token: t, email: "me@x.example", next: "#/library" }));
    expect(u.origin).toBe("https://planyr.io");
    expect(u.pathname).toBe("/");
    expect(u.searchParams.has("app")).toBe(true);
    expect(u.searchParams.get("authlink")).toBe(t);
    expect(u.searchParams.get("kind")).toBe("signin");
    expect(u.searchParams.get("next")).toBe("/library");
    expect(u.searchParams.get("h")).toMatch(/^[0-9a-f]{8}$/);
    expect(u.href).not.toContain("me%40x");
    expect(u.href).not.toContain("me@x");
  });
  it("drops an unsafe next and refuses a malformed token", async () => {
    const u = new URL(await buildAuthLinkUrl({ appUrl: "https://planyr.io", kind: "reset", token: "b".repeat(56), email: "a@b.co", next: "https://evil.example" }));
    expect(u.searchParams.has("next")).toBe(false);
    await expect(buildAuthLinkUrl({ appUrl: "https://planyr.io", kind: "reset", token: "x", email: "a@b.co" })).rejects.toThrow();
    await expect(buildAuthLinkUrl({ appUrl: "https://planyr.io", kind: "nope", token: "b".repeat(56), email: "a@b.co" })).rejects.toThrow();
  });
  it("round-trips through parseAuthLinkSearch", async () => {
    const t = "c".repeat(56);
    const href = await buildAuthLinkUrl({ appUrl: "https://planyr.io", kind: "reset", token: t, email: "a@b.co" });
    const p = parseAuthLinkSearch(new URL(href).search);
    expect(p).toMatchObject({ present: true, kind: "reset", token: t, tokenOk: true, next: null });
    expect(p.hint).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("parseAuthLinkSearch — every malformed shape is reported, never thrown", () => {
  it("no param → not present", () => { expect(parseAuthLinkSearch("?app")).toMatchObject({ present: false }); expect(parseAuthLinkSearch("")).toMatchObject({ present: false }); });
  it("present but empty / bad token / bad kind → present with tokenOk false", () => {
    expect(parseAuthLinkSearch("?app&authlink=")).toMatchObject({ present: true, tokenOk: false });
    expect(parseAuthLinkSearch("?app&authlink=zz&kind=reset")).toMatchObject({ present: true, tokenOk: false });
    expect(parseAuthLinkSearch(`?authlink=${"a".repeat(56)}&kind=wat`)).toMatchObject({ present: true, tokenOk: false, kind: null });
  });
  it("strips only its own params", () => {
    expect(stripAuthLinkParams("?app&authlink=x&kind=reset&next=%2Flibrary&h=abcd1234&foo=1")).toBe("?app&foo=1");
    expect(stripAuthLinkParams("?app&authlink=x&kind=reset")).toBe("?app");
    expect(stripAuthLinkParams("?authlink=x&kind=signin")).toBe("");
  });
});

describe("classifyVerifyFailure — what the person is told, from what verifyOtp returned", () => {
  const e = (o) => ({ name: "AuthApiError", ...o });
  it("expired / used (GoTrue does not tell them apart)", () => {
    expect(classifyVerifyFailure(e({ status: 403, code: "otp_expired", message: "Email link is invalid or has expired" }))).toBe("expired");
    expect(classifyVerifyFailure(e({ status: 403, message: "Email link is invalid or has expired" }))).toBe("expired");
    expect(classifyVerifyFailure(e({ status: 400, message: "Token has expired or is invalid" }))).toBe("expired");
  });
  it("verify rate limit", () => {
    expect(classifyVerifyFailure(e({ status: 429, code: "over_request_rate_limit" }))).toBe("rate");
    expect(classifyVerifyFailure(e({ status: 429, message: "too many" }))).toBe("rate");
  });
  it("network", () => {
    expect(classifyVerifyFailure(e({ name: "AuthRetryableFetchError", status: 0, message: "Failed to fetch" }))).toBe("network");
    expect(classifyVerifyFailure(new TypeError("Failed to fetch"))).toBe("network");
    expect(classifyVerifyFailure({ status: 502, message: "bad gateway" })).toBe("network");
  });
  it("anything else is 'other' (still gets a next step)", () => { expect(classifyVerifyFailure(e({ status: 422, message: "weird" }))).toBe("other"); expect(classifyVerifyFailure(null)).toBe("other"); });
});

describe("landingPlan — every state of the page has a next step", () => {
  const base = { present: true, tokenOk: true, kind: "signin", hint: "abcd1234" };
  const ids = (p) => p.actions.map((a) => a.id);
  it("malformed → send a new one + back to sign in", () => {
    const p = landingPlan({ link: { present: true, tokenOk: false, kind: null }, phase: { name: "idle" }, user: null, userHint: null });
    expect(p.state).toBe("malformed"); expect(ids(p)).toEqual(expect.arrayContaining(["resend", "signin"])); expect(p.actions.some((a) => a.id === "continue")).toBe(false);
  });
  it("signed out → one button, named by kind", () => {
    const s = landingPlan({ link: base, phase: { name: "idle" }, user: null, userHint: null });
    expect(s.state).toBe("ready"); expect(s.actions.filter((a) => a.primary)).toHaveLength(1); expect(s.actions.find((a) => a.primary).label).toBe("Continue to Planyr");
    const r = landingPlan({ link: { ...base, kind: "reset" }, phase: { name: "idle" }, user: null, userHint: null });
    expect(r.actions.find((a) => a.primary).label).toBe("Set a new password");
  });
  it("signed in as the same account", () => {
    const p = landingPlan({ link: base, phase: { name: "idle" }, user: { email: "me@x.example" }, userHint: "abcd1234" });
    expect(p.state).toBe("same-account"); expect(p.actions.find((a) => a.primary)).toBeTruthy();
  });
  it("signed in as a DIFFERENT account → says so, offers switch AND stay, never a bare continue", () => {
    const p = landingPlan({ link: base, phase: { name: "idle" }, user: { email: "other@x.example" }, userHint: "99999999" });
    expect(p.state).toBe("different-account"); expect(p.message).toContain("other@x.example");
    expect(ids(p)).toEqual(expect.arrayContaining(["switch", "stay"])); expect(ids(p)).not.toContain("continue");
  });
  it("the hint is missing → treated as unknown, which is also confirmed before swapping", () => {
    const p = landingPlan({ link: { ...base, hint: null }, phase: { name: "idle" }, user: { email: "other@x.example" }, userHint: "99999999" });
    expect(p.state).toBe("different-account");
  });
  it("verifying → no actions that could double-spend", () => {
    const p = landingPlan({ link: base, phase: { name: "verifying" }, user: null, userHint: null });
    expect(p.state).toBe("verifying"); expect(p.actions.every((a) => a.disabled)).toBe(true);
  });
  it("expired → send a new one, pre-filled field when asked; network → try again; rate → try again later + new link", () => {
    const x = landingPlan({ link: base, phase: { name: "failed", kind: "expired" }, user: null, userHint: null });
    expect(x.state).toBe("expired"); expect(ids(x)).toEqual(expect.arrayContaining(["resend", "signin"]));
    const n = landingPlan({ link: base, phase: { name: "failed", kind: "network" }, user: null, userHint: null });
    expect(n.state).toBe("network"); expect(ids(n)).toContain("retry");
    const r = landingPlan({ link: base, phase: { name: "failed", kind: "rate" }, user: null, userHint: null });
    expect(r.state).toBe("rate"); expect(ids(r)).toEqual(expect.arrayContaining(["retry", "resend"]));
    const o = landingPlan({ link: base, phase: { name: "failed", kind: "other" }, user: null, userHint: null });
    expect(ids(o)).toEqual(expect.arrayContaining(["resend", "signin"]));
  });
  it("every state names support@planyr.io somewhere reachable", () => {
    for (const phase of [{ name: "idle" }, { name: "failed", kind: "expired" }, { name: "failed", kind: "network" }, { name: "failed", kind: "rate" }, { name: "failed", kind: "other" }]) {
      expect(landingPlan({ link: base, phase, user: null, userHint: null }).support).toBe("support@planyr.io");
    }
  });
  it("the validity period is one hour and the copy elsewhere reads it from here", () => { expect(LINK_VALID_MINUTES).toBe(60); });
});
