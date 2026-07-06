/* pinStore — pinned folders/files behind the Library Home. Per-uid buckets, dedupe on
 * re-pin, corrupt storage boots clean, and change notification fires on every write. */
import { describe, it, expect, beforeEach } from "vitest";
import { listPins, addPin, removePin, togglePin, isPinned, subscribePins } from "../src/shared/pins/pinStore.js";

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

const F = { type: "folder", id: "fold-1", projectId: "pA", label: "Drawings" };
const D = { type: "file", id: "rv-1", projectId: "pA", label: "Site plan" };

describe("pinStore — add/remove/toggle", () => {
  it("adds newest-first and lists per uid", async () => {
    await addPin("u1", F);
    await addPin("u1", D);
    const pins = await listPins("u1");
    expect(pins.map((p) => p.id)).toEqual(["rv-1", "fold-1"]);
    expect(await listPins("u2")).toEqual([]);   // other account: empty
    expect(await listPins(null)).toEqual([]);   // signed-out bucket: separate
  });

  it("re-pinning the same target dedupes (moves to front, no duplicate)", async () => {
    await addPin("u1", F);
    await addPin("u1", D);
    await addPin("u1", { ...F, label: "Renamed" });
    const pins = await listPins("u1");
    expect(pins.length).toBe(2);
    expect(pins[0]).toEqual({ type: "folder", id: "fold-1", projectId: "pA", label: "Renamed" });
  });

  it("removePin drops only the matching type+id", async () => {
    await addPin("u1", F);
    await addPin("u1", { type: "file", id: "fold-1", projectId: "pA", label: "same id, other type" });
    await removePin("u1", { type: "folder", id: "fold-1" });
    const pins = await listPins("u1");
    expect(pins).toEqual([{ type: "file", id: "fold-1", projectId: "pA", label: "same id, other type" }]);
  });

  it("togglePin flips presence", async () => {
    await togglePin("u1", F);
    expect(isPinned(await listPins("u1"), F)).toBe(true);
    await togglePin("u1", F);
    expect(isPinned(await listPins("u1"), F)).toBe(false);
  });

  it("rejects junk pins (bad type / missing id) without touching the list", async () => {
    await addPin("u1", F);
    await addPin("u1", { type: "nope", id: "x" });
    await addPin("u1", { type: "file", id: "" });
    expect((await listPins("u1")).length).toBe(1);
  });
});

describe("pinStore — durability", () => {
  it("corrupt storage reads empty and clears the key", async () => {
    localStorage.setItem("planyr:pins:v1:u1", "{nope");
    expect(await listPins("u1")).toEqual([]);
    expect(localStorage.getItem("planyr:pins:v1:u1")).toBe(null);
  });

  it("malformed entries are filtered out, good ones kept", async () => {
    localStorage.setItem("planyr:pins:v1:u1", JSON.stringify([F, { type: "folder" }, 7, null]));
    const pins = await listPins("u1");
    expect(pins).toEqual([F]);
  });

  it("subscribers fire on add and remove", async () => {
    let calls = 0;
    const off = subscribePins(() => { calls++; });
    await addPin("u1", F);
    await removePin("u1", F);
    off();
    await addPin("u1", D);
    expect(calls).toBe(2); // not 3 — unsubscribed before the last add
  });
});
