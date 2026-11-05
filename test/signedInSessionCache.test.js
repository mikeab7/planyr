import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cacheUsable, readSessionCache, writeSessionCache, routeFailure, TEST_ACCOUNT_EMAIL } from "../ui-audit/lib/signedInSession.mjs";

describe("signedInSession cache + route failure text (B2154049)", () => {
  const p = join(mkdtempSync(join(tmpdir(), "sis-")), "c.json");
  it("round-trips tokens, file is 0600, and only the test account is accepted", () => {
    writeSessionCache({ access_token: "A", refresh_token: "R" }, p);
    expect(statSync(p).mode & 0o777).toBe(0o600);
    expect(readSessionCache(p)).toMatchObject({ access_token: "A", refresh_token: "R", user_email: TEST_ACCOUNT_EMAIL });
  });
  it("rejects wrong shape, other accounts, ancient records, missing file", () => {
    expect(cacheUsable(null)).toBe(false);
    expect(cacheUsable({ access_token: "a", refresh_token: "r", user_email: "x@y.z" })).toBe(false);
    expect(cacheUsable({ access_token: "a", user_email: TEST_ACCOUNT_EMAIL })).toBe(false);
    expect(cacheUsable({ access_token: "a", refresh_token: "r", user_email: TEST_ACCOUNT_EMAIL, saved_at: 1 }, 1e9)).toBe(false);
    expect(readSessionCache(join(tmpdir(), "nope-" + Date.now()))).toBeNull();
  });
  it("routeFailure surfaces the stage and upstream reason of a 502", () => {
    expect(routeFailure(502, { error: "could not issue link", stage: "generate_link", upstream_status: 429, upstream_error: "rate limit" }))
      .toBe("e2e-session route answered 502 — could not issue link, stage generate_link, upstream 429, rate limit");
    expect(routeFailure(200, { access_token: "a", refresh_token: "r" })).toBeNull();
  });
});
