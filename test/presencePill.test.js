import { describe, it, expect } from "vitest";
import { presenceSummary } from "../src/workspaces/site-planner/lib/presencePill.js";

// B674 — the "N here" pill summary: distinct PEOPLE (presence keys = uids), quiet when alone,
// self first as "You", window-count nuance when one account has several sessions.

describe("presenceSummary", () => {
  it("alone (or empty) → null, no pill", () => {
    expect(presenceSummary({}, "me")).toBeNull();
    expect(presenceSummary({ me: [{ uid: "me", name: "Michael" }] }, "me")).toBeNull();
    expect(presenceSummary(null, "me")).toBeNull();
  });

  it("two people → '2 here' with You first, then the teammate by name", () => {
    const s = presenceSummary({
      me: [{ uid: "me", name: "Michael" }],
      u2: [{ uid: "u2", name: "Sam Alvarez" }],
    }, "me");
    expect(s.count).toBe(2);
    expect(s.label).toBe("2 here");
    expect(s.names).toEqual(["You", "Sam Alvarez"]);
  });

  it("two windows of the SAME account collapse to one person, labeled with the window count", () => {
    const s = presenceSummary({
      me: [{ uid: "me", name: "Michael" }, { uid: "me", name: "Michael" }],
      u2: [{ uid: "u2", name: "Sam" }],
    }, "me");
    expect(s.count).toBe(2); // people, not sessions
    expect(s.names[0]).toBe("You (2 windows)");
  });

  it("three people sort teammates alphabetically after You; a missing name reads 'Someone'", () => {
    const s = presenceSummary({
      me: [{ name: "Michael" }],
      u2: [{ name: "Zoe" }],
      u3: [{}],
    }, "me");
    expect(s.count).toBe(3);
    expect(s.names).toEqual(["You", "Someone", "Zoe"]);
  });
});
