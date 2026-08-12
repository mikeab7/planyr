import { describe, it, expect } from "vitest";
import { createNameResolver, describeElement, SELF_ACTOR } from "../src/workspaces/site-planner/lib/editorNames.js";
import { pushToastPure, visibleToasts, TOAST_CAP } from "../src/shared/ui/Toast.jsx";

// B673 — conflict-toast naming + the toast stack's pure helpers.

describe("createNameResolver", () => {
  it("self uid (another window of the same account) → 'you (another window)'", async () => {
    const resolve = createNameResolver({ selfUid: "me", teamIdOf: () => null, fetchRoster: async () => [] });
    expect(await resolve("me")).toEqual(SELF_ACTOR);
  });

  /* ⛔ NEW-4 — the phantom collaborator, both halves of the mechanism.
   * The owner opened his own plan in a second tab and got ~5 banners crediting a teammate who was
   * never there. The uid comparison was fine; `selfUid` was SNAPSHOTTED from `activeUid()` before
   * the auth session resolved, so it stayed null all session and every row fell to the "a
   * teammate" fallback. Both the staleness and the fallback are tested, because fixing either one
   * alone still leaves a way to invent a person. */
  it("selfUid may be a GETTER, so a sign-in that lands AFTER the resolver is built still counts as self", async () => {
    let uid = null;                                    // auth has not resolved yet
    const resolve = createNameResolver({ selfUid: () => uid, teamIdOf: () => null, fetchRoster: async () => [] });
    expect(await resolve("me")).toEqual(SELF_ACTOR);   // unknown self → never a person (below)
    uid = "me";
    expect(await resolve("me")).toEqual(SELF_ACTOR);   // and once it lands, the match is made
    expect((await resolve("me")).self).toBe(true);
  });

  it("with NO signed-in id there is no evidence of a second PERSON — never 'a teammate'", async () => {
    const resolve = createNameResolver({ selfUid: null, teamIdOf: () => "team-1", fetchRoster: async () => [{ userId: "u2", displayName: "Sam Alvarez" }] });
    const actor = await resolve("some-uid");
    expect(actor.self).toBe(true);
    expect(actor.name).not.toBe("a teammate");
    expect(actor.name).not.toBe("Sam Alvarez");
  });

  it("a snapshotted selfUid was the pre-fix shape — the regression it caused is asserted directly", async () => {
    // The exact pre-fix construction: the value read once, while it was still null.
    const preFix = createNameResolver({ selfUid: (() => null)(), teamIdOf: () => null, fetchRoster: async () => [] });
    expect((await preFix("b147d90d")).self).toBe(true);   // WOULD have been { name: "a teammate" }
  });

  it("a teammate resolves through the roster RPC, cached after the first fetch", async () => {
    let fetches = 0;
    const resolve = createNameResolver({
      selfUid: "me",
      teamIdOf: () => "team-1",
      fetchRoster: async () => { fetches += 1; return [{ userId: "u2", displayName: "Sam Alvarez" }]; },
    });
    expect(await resolve("u2")).toEqual({ name: "Sam Alvarez", self: false });
    expect(await resolve("u2")).toEqual({ name: "Sam Alvarez", self: false });
    expect(fetches).toBe(1); // cached — one roster fetch per site session
  });

  it("a roster miss (member left) or a private site falls back to 'a teammate', never blank", async () => {
    const resolve = createNameResolver({ selfUid: "me", teamIdOf: () => "team-1", fetchRoster: async () => [] });
    expect(await resolve("gone-uid")).toEqual({ name: "a teammate", self: false });
    const privateResolve = createNameResolver({ selfUid: "me", teamIdOf: () => null, fetchRoster: async () => { throw new Error("no"); } });
    expect(await privateResolve("u9")).toEqual({ name: "a teammate", self: false });
  });
});

describe("describeElement", () => {
  const els = [
    { id: "b1", type: "building" },
    { id: "r1", type: "road" },
    { id: "b2", type: "building" },
  ];
  it("buildings get their on-canvas display number", () => {
    expect(describeElement("el", els[0], els)).toBe("Building 1");
    expect(describeElement("el", els[2], els)).toBe("Building 2");
  });
  it("other element types label by type; markups by kind; the rest by collection", () => {
    expect(describeElement("el", els[1], els)).toBe("a road");
    expect(describeElement("markup", { id: "m", kind: "polyline" })).toBe("a polyline markup");
    expect(describeElement("measure", { id: "d" })).toBe("a measurement");
    expect(describeElement("callout", { id: "c" })).toBe("a callout");
    expect(describeElement("parcel", { id: "p" })).toBe("a parcel");
  });
  it("never blank on missing data", () => {
    expect(describeElement("el", null, [])).toBe("an element");
    expect(describeElement("weird", null, [])).toBe("an element");
  });
});

describe("Toast pure helpers", () => {
  it("pushToastPure appends with a fresh id; visibleToasts caps at TOAST_CAP with a +n more count", () => {
    let l = [];
    for (let i = 0; i < TOAST_CAP + 3; i++) l = pushToastPure(l, { text: "t" + i });
    expect(new Set(l.map((t) => t.id)).size).toBe(l.length); // ids unique
    const { shown, more } = visibleToasts(l);
    expect(shown).toHaveLength(TOAST_CAP);
    expect(more).toBe(3);
    expect(shown[0].text).toBe("t0"); // oldest first — they expire in order
  });
});
