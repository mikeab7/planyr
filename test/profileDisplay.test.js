import { describe, it, expect } from "vitest";
import { displayNameFor, firstNameFor, initialFor, orgFor } from "../src/shared/profile/useProfile.js";

// NEW-2 display rule: "First Last" → first alone → last alone → metadata → email,
// never blank. The profiles table wins over signup metadata; metadata is the
// fallback for the moment right after signup (before the row is readable) and any
// backfill miss.
describe("profile display name (B297/B298) — never-blank fallback chain", () => {
  const user = (email, meta) => ({ email, user_metadata: meta || {} });

  it("uses First + Last from the profile row when both present", () => {
    expect(displayNameFor({ first_name: "Mike", last_name: "Abbott" }, user("m@x.com"))).toBe("Mike Abbott");
  });

  it("falls back to first name alone, then last name alone", () => {
    expect(displayNameFor({ first_name: "Mike" }, user("m@x.com"))).toBe("Mike");
    expect(displayNameFor({ last_name: "Abbott" }, user("m@x.com"))).toBe("Abbott");
  });

  it("falls back to signup metadata when the profile row is missing/empty", () => {
    expect(displayNameFor(null, user("m@x.com", { first_name: "Mike", last_name: "Abbott" }))).toBe("Mike Abbott");
    expect(displayNameFor({}, user("m@x.com", { first_name: "Mike" }))).toBe("Mike");
  });

  it("the profile row wins over signup metadata", () => {
    expect(displayNameFor({ first_name: "Michael", last_name: "Abbott" }, user("m@x.com", { first_name: "Mike" })))
      .toBe("Michael Abbott");
  });

  it("falls back to the email when there is no name anywhere", () => {
    expect(displayNameFor(null, user("m@x.com"))).toBe("m@x.com");
    expect(displayNameFor({ first_name: "  " }, user("m@x.com"))).toBe("m@x.com");
  });

  it("trims whitespace-only fields rather than rendering blank", () => {
    expect(displayNameFor({ first_name: "  ", last_name: "  " }, user("m@x.com"))).toBe("m@x.com");
    expect(displayNameFor({ first_name: " Mike ", last_name: " Abbott " }, user("m@x.com"))).toBe("Mike Abbott");
  });

  it("returns empty string only when there is no user at all (pill shows 'Sign in' then)", () => {
    expect(displayNameFor(null, null)).toBe("");
  });

  it("firstNameFor prefers the profile row, then metadata", () => {
    expect(firstNameFor({ first_name: "Mike" }, user("m@x.com", { first_name: "M" }))).toBe("Mike");
    expect(firstNameFor(null, user("m@x.com", { first_name: "M" }))).toBe("M");
    expect(firstNameFor(null, user("m@x.com"))).toBe("");
  });

  it("initialFor is the uppercased first letter, with a dot placeholder", () => {
    expect(initialFor("Mike Abbott")).toBe("M");
    expect(initialFor("abbott@x.com")).toBe("A");
    expect(initialFor("")).toBe("•");
  });

  it("orgFor prefers the profile row, then metadata, else empty", () => {
    expect(orgFor({ org: "Acme RE" }, user("m@x.com", { org: "Old Co" }))).toBe("Acme RE");
    expect(orgFor(null, user("m@x.com", { org: "Old Co" }))).toBe("Old Co");
    expect(orgFor(null, user("m@x.com"))).toBe("");
  });
});
