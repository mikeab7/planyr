import { describe, it, expect } from "vitest";
import { presenceSummary } from "../src/workspaces/site-planner/lib/presencePill.js";

// B674 recurrence (V231 #13) — the "N here" pill counts SESSIONS (connected windows/tabs/devices),
// not people: two windows of one account are two concurrent editors and must show "2 here" (the
// original people-count showed NOTHING for that case, hiding multi-writer exactly when it starts).
// Names still group by person — self first as "You", "(k windows)" on multi-session entries.

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

  it("two windows of the SAME account → '2 here' (the V231 #13 case: sessions, not people)", () => {
    const s = presenceSummary({
      me: [{ uid: "me", name: "Michael" }, { uid: "me", name: "Michael" }],
    }, "me");
    expect(s).not.toBeNull(); // the people-count regression returned null here
    expect(s.count).toBe(2);
    expect(s.label).toBe("2 here");
    expect(s.names).toEqual(["You (2 windows)"]);
  });

  it("two windows of one account + a teammate → '3 here', window count on the multi-session entry", () => {
    const s = presenceSummary({
      me: [{ uid: "me", name: "Michael" }, { uid: "me", name: "Michael" }],
      u2: [{ uid: "u2", name: "Sam" }],
    }, "me");
    expect(s.count).toBe(3); // sessions: my two windows + Sam's one
    expect(s.label).toBe("3 here");
    expect(s.names).toEqual(["You (2 windows)", "Sam"]);
  });

  it("a teammate with two windows gets the window suffix too", () => {
    const s = presenceSummary({
      me: [{ name: "Michael" }],
      u2: [{ name: "Zoe" }, { name: "Zoe" }],
    }, "me");
    expect(s.count).toBe(3);
    expect(s.names).toEqual(["You", "Zoe (2 windows)"]);
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
