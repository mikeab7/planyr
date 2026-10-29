/* Team settings — NEW-4 (2026-10-29): switching teams quickly could leave the previous team's members
 * under the new team's name (and Remove / Change role then paired B's team id with A's user id). */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { createRosterLoader } from "../src/workspaces/site-planner/lib/teamRoster.js";

const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

function setup() {
  const pending = {}; // `${kind}:${team}` -> deferred
  const get = (k) => (pending[k] ||= deferred());
  const shown = { team: null, members: [], invites: [], errors: 0 };
  let selected = null;
  const loader = createRosterLoader({
    fetchMembers: (t) => get(`m:${t}`).promise, fetchInvites: (t) => get(`i:${t}`).promise,
    getSelected: () => selected,
    onApply: (t, m, i) => { shown.team = t; shown.members = m; shown.invites = i; },
    onError: () => { shown.errors += 1; },
  });
  return { loader, shown, get, select: (t) => { selected = t; shown.members = []; shown.invites = []; } };
}

describe("createRosterLoader", () => {
  it("A answers AFTER B: B's roster stays, A's is dropped", async () => {
    const w = setup();
    w.select("A"); const a = w.loader.load("A");
    w.select("B"); const b = w.loader.load("B");
    w.get("m:B").resolve([{ userId: "b1" }]); w.get("i:B").resolve([]);
    await b;
    w.get("m:A").resolve([{ userId: "a1" }]); w.get("i:A").resolve([{ id: "ia" }]);
    await a;
    expect(w.shown.team).toBe("B");
    expect(w.shown.members).toEqual([{ userId: "b1" }]);
    expect(w.shown.invites).toEqual([]);
  });
  it("A's members arrive but A's invites are still out when B is chosen: nothing of A is shown", async () => {
    const w = setup();
    w.select("A"); const a = w.loader.load("A");
    w.get("m:A").resolve([{ userId: "a1" }]);
    w.select("B"); const b = w.loader.load("B");
    w.get("i:A").resolve([{ id: "ia" }]);
    await a;
    expect(w.shown.members).toEqual([]); // cleared at the switch, A's late pair not applied
    w.get("m:B").resolve([{ userId: "b1" }]); w.get("i:B").resolve([{ id: "ib" }]);
    await b;
    expect(w.shown).toMatchObject({ team: "B", members: [{ userId: "b1" }], invites: [{ id: "ib" }] });
  });
  it("a reload for a team that is no longer selected (a Remove that finished late) is dropped", async () => {
    const w = setup();
    w.select("B");
    const p = w.loader.load("A"); // doRemove's `loadRoster(sel)` closed over the old selection
    w.get("m:A").resolve([{ userId: "a1" }]); w.get("i:A").resolve([]);
    await p;
    expect(w.shown.team).toBeNull();
  });
  it("members and invites land together, and a failure is reported, not swallowed into a stale list", async () => {
    const w = setup();
    w.select("A"); const a = w.loader.load("A");
    w.get("m:A").resolve([{ userId: "a1" }]);
    expect(w.shown.members).toEqual([]);              // invites not back yet: nothing half-applied
    w.get("i:A").resolve([]); await a;
    expect(w.shown.members).toEqual([{ userId: "a1" }]);
    w.select("B"); const b = w.loader.load("B");
    w.get("m:B").promise.catch(() => {}); w.get("i:B").resolve([]);
    // reject members for B
    const d = w.get("m:B"); d.resolve(Promise.reject(new Error("net")));
    await b;
    expect(w.shown.errors).toBe(1);
    expect(w.shown.members).toEqual([]);
  });
  it("null team clears", async () => {
    const w = setup(); await w.loader.load(null);
    expect(w.shown).toMatchObject({ team: null, members: [], invites: [] });
  });
});

describe("wiring (source guards)", () => {
  const src = fs.readFileSync("src/workspaces/site-planner/components/TeamPanel.jsx", "utf8");
  it("TeamPanel loads the roster only through the guarded loader and clears on switch", () => {
    expect(src).toContain("createRosterLoader(");
    expect(src).not.toMatch(/setMembers\(await/);
    expect(src).toMatch(/setMembers\(\[\]\);\s*setInvites\(\[\]\);/);
  });
});
