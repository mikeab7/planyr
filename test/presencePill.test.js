import { describe, it, expect } from "vitest";
import { presenceParties, presenceInitials, presenceDisplayName, presenceChipContent, PRESENCE_INITIALS_CAP } from "../src/workspaces/site-planner/lib/presencePill.js";

// NEW-1 (presence chip rebuild) — owner report, verbatim: he saw "4 people here" (and separately
// "2 here") with only his own account open across several tabs. `presenceChipContent` is what
// FULLY determines the chip's rendered output (icon family, visible initials badges, the overflow
// badge, the self-tabs segment) — PresenceChip.jsx is a thin, deterministic map from that object to
// JSX, so asserting on this pure function's output is asserting the chip's rendering without
// mounting a component. See PresenceChip.jsx's own header for that equivalence.
//
// ⛔ THE BUG THIS REPLACES, proved here rather than just asserted away: the PRE-FIX pill
// (`presenceSummary`, same presence payload, this file's own git history) folded every connected
// session into one people-shaped count — `preFixLabel` below replays that exact reduction so the
// regression is visible in the same run, not just described in a comment.
function preFixLabel(state, selfUid) {
  const entries = Object.entries(state || {});
  const total = entries.reduce((n, [, metas]) => n + Math.max(1, (metas || []).length), 0);
  if (total <= 1) return null;
  return `${total} here`;
}

describe("presenceParties — own tabs split from other real people", () => {
  it("alone, single tab → null (nothing to report)", () => {
    expect(presenceParties({}, "me")).toBeNull();
    expect(presenceParties({ me: [{ name: "Michael" }] }, "me")).toBeNull();
    expect(presenceParties(null, "me")).toBeNull();
  });

  it("alone, two tabs → selfWindows:2, no others (the reported '2 here' case)", () => {
    const preFix = preFixLabel({ me: [{ name: "Michael" }, { name: "Michael" }] }, "me");
    expect(preFix).toBe("2 here"); // the old pill: indistinguishable from two real people
    const p = presenceParties({ me: [{ name: "Michael" }, { name: "Michael" }] }, "me");
    expect(p).toEqual({ selfWindows: 2, others: [], totalSessions: 2 });
  });

  it("alone, MANY tabs → selfWindows:4, no others (the reported '4 people here' case)", () => {
    const state = { me: [{ name: "M" }, { name: "M" }, { name: "M" }, { name: "M" }] };
    const preFix = preFixLabel(state, "me");
    expect(preFix).toBe("4 here"); // this is the exact defect: reads as "4 people"
    const p = presenceParties(state, "me");
    expect(p.selfWindows).toBe(4);
    expect(p.others).toEqual([]); // never presented as other people
    expect(p.totalSessions).toBe(4);
  });

  it("him plus one other person, both single-tab", () => {
    const p = presenceParties({
      me: [{ name: "Michael" }],
      u2: [{ name: "Sam Alvarez", email: "sam@example.com" }],
    }, "me");
    expect(p.selfWindows).toBe(1);
    expect(p.others).toEqual([{ uid: "u2", name: "Sam Alvarez", email: "sam@example.com", windows: 1 }]);
  });

  it("him (3 tabs) plus one teammate — both facts survive, never merged", () => {
    const p = presenceParties({
      me: [{ name: "Michael" }, { name: "Michael" }, { name: "Michael" }],
      u2: [{ name: "Sam" }],
    }, "me");
    expect(p.selfWindows).toBe(3);
    expect(p.others).toEqual([{ uid: "u2", name: "Sam", email: null, windows: 1 }]);
    expect(p.totalSessions).toBe(4);
  });

  it("him plus SEVERAL others, sorted by name", () => {
    const p = presenceParties({
      me: [{ name: "Michael" }],
      u2: [{ name: "Zoe" }],
      u3: [{ name: "Amir" }],
    }, "me");
    expect(p.others.map((o) => o.name)).toEqual(["Amir", "Zoe"]);
  });

  it("a teammate with two windows keeps that windows count", () => {
    const p = presenceParties({
      me: [{ name: "Michael" }],
      u2: [{ name: "Zoe" }, { name: "Zoe" }],
    }, "me");
    expect(p.others).toEqual([{ uid: "u2", name: "Zoe", email: null, windows: 2 }]);
  });

  it("a teammate with no display name set → name null, email preserved for the initials fallback", () => {
    const p = presenceParties({
      me: [{ name: "Michael" }],
      u2: [{ name: "", email: "jordan@example.com" }],
    }, "me");
    expect(p.others[0]).toEqual({ uid: "u2", name: null, email: "jordan@example.com", windows: 1 });
  });

  it("no name and no email at all → both null, never an empty string", () => {
    const p = presenceParties({ me: [{ name: "Michael" }], u2: [{}] }, "me");
    expect(p.others[0]).toEqual({ uid: "u2", name: null, email: null, windows: 1 });
  });

  it("someone leaving drops out of the NEXT sync's state entirely (no ghost accumulation)", () => {
    // Presence is re-derived from the live roster on every 'sync' — a departed peer simply isn't
    // in the next call's `state` any more. This asserts the pure function has no memory of its own.
    const withThem = presenceParties({ me: [{ name: "Michael" }], u2: [{ name: "Sam" }] }, "me");
    expect(withThem.others).toHaveLength(1);
    const afterTheyLeave = presenceParties({ me: [{ name: "Michael" }] }, "me");
    expect(afterTheyLeave).toBeNull();
  });
});

describe("presenceInitials", () => {
  it("first + last initial from a full display name", () => {
    expect(presenceInitials({ name: "Sam Alvarez" })).toBe("SA");
  });
  it("a single-word name takes its first two letters", () => {
    expect(presenceInitials({ name: "Zoe" })).toBe("ZO");
  });
  it("no display name → the account email's first letter", () => {
    expect(presenceInitials({ name: null, email: "jordan@example.com" })).toBe("J");
  });
  it("neither name nor email → '?', never blank", () => {
    expect(presenceInitials({ name: null, email: null })).toBe("?");
  });
  it("two different people can legitimately collide on the same initials", () => {
    const a = presenceInitials({ name: "Sam Alvarez" });
    const b = presenceInitials({ name: "Sally Adams" });
    expect(a).toBe(b); // both "SA" — disambiguated by the full name on hover, not the badge
  });
});

describe("presenceDisplayName", () => {
  it("prefers the display name, then email, then 'Someone'", () => {
    expect(presenceDisplayName({ name: "Sam", email: "s@x.com" })).toBe("Sam");
    expect(presenceDisplayName({ name: null, email: "s@x.com" })).toBe("s@x.com");
    expect(presenceDisplayName({ name: null, email: null })).toBe("Someone");
  });
});

describe("presenceChipContent — the pure derivation the chip renders from", () => {
  it("no parties → null (chip renders nothing)", () => {
    expect(presenceChipContent(null)).toBeNull();
  });

  it("alone, many tabs → kind:'self-tabs', no people glyph, no initials", () => {
    const c = presenceChipContent({ selfWindows: 4, others: [], totalSessions: 4 });
    expect(c.kind).toBe("self-tabs");
    expect(c.selfWindows).toBe(4);
    expect(c.visible).toEqual([]);
    expect(c.overflow).toBe(0);
  });

  it("him plus one other person → kind:'people', one visible initial, own tabs not shown (only one tab)", () => {
    const c = presenceChipContent({ selfWindows: 1, others: [{ uid: "u2", name: "Sam Alvarez", email: null, windows: 1 }], totalSessions: 2 });
    expect(c.kind).toBe("people");
    expect(c.selfWindows).toBe(1);
    expect(c.visible).toHaveLength(1);
    expect(c.overflow).toBe(0);
    expect(c.tooltip).toBe("Sam Alvarez");
  });

  it("him (3 tabs) plus others → both his tab count AND their initials are present, never merged", () => {
    const c = presenceChipContent({
      selfWindows: 3,
      others: [{ uid: "u2", name: "Sam", email: null, windows: 1 }],
      totalSessions: 4,
    });
    expect(c.selfWindows).toBe(3);
    expect(c.visible.map((o) => o.uid)).toEqual(["u2"]);
    expect(c.tooltip).toBe("You — 3 tabs · Sam");
  });

  it("more people than the initials cap → capped visible list + a '+N' overflow count", () => {
    const others = Array.from({ length: PRESENCE_INITIALS_CAP + 2 }, (_, i) => ({ uid: "u" + i, name: "Person " + i, email: null, windows: 1 }));
    const c = presenceChipContent({ selfWindows: 1, others, totalSessions: others.length + 1 });
    expect(c.visible).toHaveLength(PRESENCE_INITIALS_CAP);
    expect(c.overflow).toBe(2);
    // the overflowed people are still named in the full breakdown (tooltip), never dropped
    expect(c.tooltip).toContain("Person " + (PRESENCE_INITIALS_CAP + 1));
  });
});
