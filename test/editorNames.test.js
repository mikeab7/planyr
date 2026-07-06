import { describe, it, expect } from "vitest";
import { createNameResolver, describeElement } from "../src/workspaces/site-planner/lib/editorNames.js";
import { pushToastPure, visibleToasts, TOAST_CAP } from "../src/shared/ui/Toast.jsx";

// B673 — conflict-toast naming + the toast stack's pure helpers.

describe("createNameResolver", () => {
  it("self uid (another window of the same account) → 'you (another window)'", async () => {
    const resolve = createNameResolver({ selfUid: "me", teamIdOf: () => null, fetchRoster: async () => [] });
    expect(await resolve("me")).toBe("you (another window)");
  });

  it("a teammate resolves through the roster RPC, cached after the first fetch", async () => {
    let fetches = 0;
    const resolve = createNameResolver({
      selfUid: "me",
      teamIdOf: () => "team-1",
      fetchRoster: async () => { fetches += 1; return [{ userId: "u2", displayName: "Sam Alvarez" }]; },
    });
    expect(await resolve("u2")).toBe("Sam Alvarez");
    expect(await resolve("u2")).toBe("Sam Alvarez");
    expect(fetches).toBe(1); // cached — one roster fetch per site session
  });

  it("a roster miss (member left) or a private site falls back to 'a teammate', never blank", async () => {
    const resolve = createNameResolver({ selfUid: "me", teamIdOf: () => "team-1", fetchRoster: async () => [] });
    expect(await resolve("gone-uid")).toBe("a teammate");
    const privateResolve = createNameResolver({ selfUid: "me", teamIdOf: () => null, fetchRoster: async () => { throw new Error("no"); } });
    expect(await privateResolve("u9")).toBe("a teammate");
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
