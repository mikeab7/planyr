import { describe, it, expect } from "vitest";
import { friendlySaveError } from "../src/shared/sitePlans/lib/overlayErrors.js";

describe("overlayErrors — friendlySaveError", () => {
  it("never leaks raw Postgres constraint wording (the reported live bug)", () => {
    const raw = 'null value in column "review_user_id" of relation "site_plan_overlays" violates not-null constraint';
    const msg = friendlySaveError({ code: "23502", message: raw });
    expect(msg.toLowerCase()).not.toContain("relation");
    expect(msg.toLowerCase()).not.toContain("column");
    expect(msg.toLowerCase()).not.toContain("constraint");
    expect(msg).toMatch(/couldn't save/i);
  });

  it("translates a not-null violation by message text alone (no code)", () => {
    const msg = friendlySaveError({ message: 'null value in column "x" violates not-null constraint' });
    expect(msg).toMatch(/left blank/i);
  });

  it("translates a foreign key violation", () => {
    const msg = friendlySaveError({ code: "23503", message: "insert or update on table violates foreign key constraint" });
    expect(msg).toMatch(/removed/i);
  });

  it("translates a unique violation", () => {
    const msg = friendlySaveError({ code: "23505", message: "duplicate key value violates unique constraint" });
    expect(msg).toMatch(/already been added/i);
  });

  it("translates a check constraint violation", () => {
    const msg = friendlySaveError({ code: "23514", message: "new row violates check constraint" });
    expect(msg).toMatch(/isn't valid/i);
  });

  it("translates a row-level-security / permission denial", () => {
    const msg = friendlySaveError({ code: "42501", message: "new row violates row-level security policy" });
    expect(msg).toMatch(/permission/i);
  });

  it("translates a schema-cache miss", () => {
    const msg = friendlySaveError({ message: "Could not find the 'foo' column of 'bar' in the schema cache" });
    expect(msg).toMatch(/refresh|reload/i);
  });

  it("translates a network failure", () => {
    const msg = friendlySaveError({ message: "Failed to fetch" });
    expect(msg).toMatch(/connection/i);
  });

  it("falls back to a plain generic message for a technical-shaped error with no specific rule (has a real SQLSTATE code)", () => {
    const raw = "some obscure internal detail nobody should see";
    const msg = friendlySaveError({ code: "55000", message: raw });
    expect(msg).not.toBe(raw);
    expect(msg).toMatch(/try again/i);
  });

  it("passes through an already-hand-written, plain-English Error unchanged", () => {
    expect(friendlySaveError(new Error("Couldn't upload the brochure."))).toBe("Couldn't upload the brochure.");
    expect(friendlySaveError(new Error("Not saved — you can only edit site plans you uploaded"))).toBe(
      "Not saved — you can only edit site plans you uploaded"
    );
  });

  it("recognizes a real Postgres code case-insensitively (PGRST is uppercase on the wire)", () => {
    const msg = friendlySaveError({ code: "PGRST204", message: "Could not find the 'foo' column of 'bar' in the schema cache" });
    expect(msg).toMatch(/refresh|reload/i);
  });

  it("handles a null/undefined error without throwing", () => {
    expect(() => friendlySaveError(null)).not.toThrow();
    expect(() => friendlySaveError(undefined)).not.toThrow();
    expect(friendlySaveError(null)).toMatch(/went wrong/i);
  });
});
