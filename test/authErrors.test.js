/* NEW-1 (follow-up to B2619760) point 2 — raw server text never reaches the screen. One table, one
 * classifier; every error shape the brief names maps to words with a next step, and an unknown error
 * is a plain sentence plus support@planyr.io, never the raw string. */
import { describe, it, expect } from "vitest";
import { classifyAuthError, friendlyAuthError, AUTH_ERROR_KINDS, authErrorAction, validateAuthFields, recoveryErrorText, SUPPORT_EMAIL, FIELD_COPY } from "../src/shared/auth/authErrors.js";

const RAW_STRINGS = [
  "Failed to fetch", "Load failed", "NetworkError when attempting to fetch resource.", "Network request failed",
  "Request rate limit reached", "email rate limit exceeded", "User already registered", "A user with this email address has already been registered",
  "Invalid login credentials", "Password should be at least 6 characters.", "Password is known to be weak and easy to guess",
  "Auth session missing!", "Email not confirmed", "Unable to validate email address: invalid format", "New password should be different from the old password.",
  "Database error saving new user", "unexpected_failure", "captcha protection: request disallowed (no captcha_token found)",
  "Signups not allowed for this instance", "Email link is invalid or has expired",
];

describe("classifyAuthError — the shapes the brief names", () => {
  const cases = [
    [{ name: "AuthRetryableFetchError", message: "Failed to fetch", status: 0 }, "network"],
    [{ message: "Load failed" }, "network"],
    [new TypeError("Failed to fetch"), "network"],
    [{ status: 503, message: "x" }, "network"],
    [{ code: "over_request_rate_limit", status: 429, message: "Request rate limit reached" }, "rate_limit"],
    [{ status: 429, message: "x" }, "rate_limit"],
    [{ code: "over_email_send_rate_limit", status: 429, message: "email rate limit exceeded" }, "email_rate_limit"],
    [{ code: "user_already_exists", status: 422, message: "User already registered" }, "user_exists"],
    [{ message: "User already registered" }, "user_exists"],
    [{ code: "invalid_credentials", status: 400, message: "Invalid login credentials" }, "invalid_credentials"],
    [{ code: "weak_password", status: 422, message: "Password should be at least 6 characters." }, "weak_password"],
    [{ name: "AuthSessionMissingError", status: 400, message: "Auth session missing!" }, "session_missing"],
    [{ code: "session_not_found", status: 403, message: "Session from session_id claim in JWT does not exist" }, "session_missing"],
    [{ code: "captcha_failed", message: "captcha protection: request disallowed (no captcha_token found)" }, "captcha"],
    [{ code: "email_not_confirmed", message: "Email not confirmed" }, "email_not_confirmed"],
    [{ code: "same_password", message: "New password should be different from the old password." }, "same_password"],
    [{ code: "validation_failed", message: "Unable to validate email address: invalid format" }, "invalid_email"],
    [{ code: "otp_expired", message: "Email link is invalid or has expired" }, "link_expired"],
    [{ message: "Too many accounts have been created recently. Please try again later." }, "signup_rate_limit"],
    [{ code: "unexpected_failure", status: 500, message: "Database error saving new user" }, "unknown"],
    ["some string nobody planned for", "unknown"],
    [{ message: "" }, "unknown"],
  ];
  for (const [err, kind] of cases) it(`${JSON.stringify(err.message || err)} → ${kind}`, () => expect(classifyAuthError(err)).toBe(kind));
  it("no error → null", () => { expect(classifyAuthError(null)).toBeNull(); expect(friendlyAuthError(undefined)).toBeNull(); });
});

describe("no raw string can render", () => {
  it("every raw string in the list comes out as table copy, none of it the raw text", () => {
    const table = new Set(Object.values(AUTH_ERROR_KINDS).map((k) => k.text));
    for (const raw of RAW_STRINGS) {
      for (const shaped of [raw, { message: raw }, { message: raw, status: 400 }]) {
        const out = friendlyAuthError(shaped);
        expect(table.has(out), `${raw} → ${out}`).toBe(true);
        expect(out).not.toBe(raw);
      }
    }
  });
  it("the copy table itself contains none of the raw strings and every entry ends in a way forward", () => {
    for (const [kind, v] of Object.entries(AUTH_ERROR_KINDS)) {
      for (const raw of RAW_STRINGS) expect(v.text, kind).not.toContain(raw);
      expect(/[.!]$/.test(v.text), kind).toBe(true);
    }
  });
  it("the unknown default names support and never the raw string", () => {
    const out = friendlyAuthError({ code: "weird_new_code", message: "Some brand new server sentence" });
    expect(out).toContain(SUPPORT_EMAIL);
    expect(out).not.toContain("brand new");
  });
  it("kinds that need a one-tap step name it", () => {
    expect(authErrorAction("network")).toBe("retry");
    expect(authErrorAction("user_exists")).toBe("signin");
    expect(authErrorAction("invalid_credentials")).toBe("reset");
    expect(authErrorAction("link_expired")).toBe("newlink");
    expect(authErrorAction("rate_limit")).toBeNull();
  });
  it("in the reset flow a missing session is about the LINK", () => {
    expect(recoveryErrorText("session_missing")).toBe(AUTH_ERROR_KINDS.link_expired.text);
    expect(recoveryErrorText("same_password")).toBe(AUTH_ERROR_KINDS.same_password.text);
  });
});

describe("validateAuthFields — what is missing is said at submit, never by greying the button", () => {
  it("sign in", () => {
    expect(validateAuthFields({ mode: "signin", email: "", pw: "x" })).toBe(FIELD_COPY.email);
    expect(validateAuthFields({ mode: "signin", email: "   ", pw: "x" })).toBe(FIELD_COPY.email);
    expect(validateAuthFields({ mode: "signin", email: "nope", pw: "x" })).toBe(FIELD_COPY.emailShape);
    expect(validateAuthFields({ mode: "signin", email: "a@b.co", pw: "" })).toBe(FIELD_COPY.password);
    expect(validateAuthFields({ mode: "signin", email: "a@b.co", pw: "x" })).toBeNull();
  });
  it("sign up needs names and a long-enough password; reset needs only an email; recovery only a password", () => {
    expect(validateAuthFields({ mode: "signup", email: "a@b.co", pw: "123456", first: "", last: "L" })).toBe(FIELD_COPY.names);
    expect(validateAuthFields({ mode: "signup", email: "a@b.co", pw: "12345", first: "F", last: "L" })).toBe(FIELD_COPY.passwordShort);
    expect(validateAuthFields({ mode: "signup", email: "a@b.co", pw: "123456", first: "F", last: "L" })).toBeNull();
    expect(validateAuthFields({ mode: "reset", email: "a@b.co", pw: "" })).toBeNull();
    expect(validateAuthFields({ mode: "reset", email: "", pw: "" })).toBe(FIELD_COPY.email);
    expect(validateAuthFields({ mode: "recovery", pw: "" })).toBe(FIELD_COPY.newPassword);
    expect(validateAuthFields({ mode: "recovery", pw: "123" })).toBe(FIELD_COPY.passwordShort);
    expect(validateAuthFields({ mode: "recovery", pw: "1234567" })).toBeNull();
  });
});
