import { describe, it, expect } from "vitest";
import {
  OAUTH_REDIRECT_PATH, googleRedirectUri,
  PRODUCTION_REDIRECT_URI, DEV_REDIRECT_URI, REGISTERED_REDIRECT_URIS,
} from "../server/oauth/config.js";

describe("oauth config — pinned redirect URI (B207 Drive wiring)", () => {
  it("builds the exact production + dev callback URIs Google must have registered", () => {
    expect(PRODUCTION_REDIRECT_URI).toBe("https://planyr.io/api/auth/google/callback");
    expect(DEV_REDIRECT_URI).toBe("http://localhost:8788/api/auth/google/callback");
    expect(REGISTERED_REDIRECT_URIS[0]).toBe(PRODUCTION_REDIRECT_URI);
  });
  it("is trailing-slash safe so it can't drift from the registered value", () => {
    expect(googleRedirectUri("https://planyr.io/")).toBe(PRODUCTION_REDIRECT_URI);
    expect(googleRedirectUri("https://planyr.io")).toBe(PRODUCTION_REDIRECT_URI);
  });
  it("keeps the path constant in one place", () => {
    expect(OAUTH_REDIRECT_PATH).toBe("/api/auth/google/callback");
    expect(PRODUCTION_REDIRECT_URI.endsWith(OAUTH_REDIRECT_PATH)).toBe(true);
  });
});
