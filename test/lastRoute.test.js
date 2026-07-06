/* lastRoute — "open the app where I left off". The pointer must restore last module +
 * project on an empty-hash boot, lose to any explicit deep link, survive junk storage
 * (clear + boot clean), and never seed a pointless "#/" replace. */
import { describe, it, expect, beforeEach } from "vitest";
import { readLastRoute, writeLastRoute, pickBootRoute } from "../src/app/lastRoute.js";
import { DEFAULT_MODULE } from "../src/app/route.js";

const KEY = "planyr:lastRoute:v1";

function makeStore() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.delete(k); map.set(k, String(v)); },
    removeItem: (k) => map.delete(k),
    get length() { return map.size; },
    key: (i) => Array.from(map.keys())[i] ?? null,
  };
}

beforeEach(() => { globalThis.localStorage = makeStore(); });

describe("lastRoute — write/read round-trip", () => {
  it("round-trips module + project + cross", () => {
    writeLastRoute({ module: "doc-review", projectId: "grp-1", cross: false });
    expect(readLastRoute()).toEqual({ module: "doc-review", projectId: "grp-1", cross: false });
  });

  it("null project persists as null; cross mode persists", () => {
    writeLastRoute({ module: "library", projectId: null, cross: true });
    expect(readLastRoute()).toEqual({ module: "library", projectId: null, cross: true });
  });

  it("corrupt JSON reads null AND clears the key (one bad write can't wedge every boot)", () => {
    localStorage.setItem(KEY, "{nope");
    expect(readLastRoute()).toBe(null);
    expect(localStorage.getItem(KEY)).toBe(null);
  });

  it("non-object payload reads null and clears", () => {
    localStorage.setItem(KEY, JSON.stringify(["site-planner"]));
    expect(readLastRoute()).toBe(null);
    expect(localStorage.getItem(KEY)).toBe(null);
  });
});

describe("lastRoute — pickBootRoute (the boot decision)", () => {
  const stored = { module: "doc-review", projectId: "grp-9", cross: false };

  it("deep link wins: a non-empty initial hash suppresses the seed", () => {
    expect(pickBootRoute({ initialHashEmpty: false, stored })).toBe(null);
  });

  it("nothing stored → no seed", () => {
    expect(pickBootRoute({ initialHashEmpty: true, stored: null })).toBe(null);
  });

  it("empty hash + stored → seeds last module + project", () => {
    expect(pickBootRoute({ initialHashEmpty: true, stored }))
      .toEqual({ module: "doc-review", projectId: "grp-9", cross: false });
  });

  it("restoreLastModule=false keeps the project but boots the default module", () => {
    expect(pickBootRoute({ initialHashEmpty: true, stored, restoreLastModule: false }))
      .toEqual({ module: DEFAULT_MODULE, projectId: "grp-9", cross: false });
  });

  it("a stored plain dashboard resolves to null (seeding '#/' is a no-op)", () => {
    expect(pickBootRoute({ initialHashEmpty: true, stored: { module: DEFAULT_MODULE, projectId: null, cross: false } }))
      .toBe(null);
  });

  it("junk module in the pointer normalizes to the default module, project preserved", () => {
    const out = pickBootRoute({ initialHashEmpty: true, stored: { module: "bogus", projectId: "p1", cross: false } });
    expect(out).toEqual({ module: DEFAULT_MODULE, projectId: "p1", cross: false });
  });

  it("cross-mode round-trips through the hash grammar (#/all/<slug> has no project)", () => {
    const out = pickBootRoute({ initialHashEmpty: true, stored: { module: "library", projectId: "p1", cross: true } });
    expect(out).toEqual({ module: "library", projectId: null, cross: true });
  });

  it("a project id with slashes survives the encode/decode round-trip intact", () => {
    const out = pickBootRoute({ initialHashEmpty: true, stored: { module: "library", projectId: "a/b c", cross: false } });
    expect(out).toEqual({ module: "library", projectId: "a/b c", cross: false });
  });
});
