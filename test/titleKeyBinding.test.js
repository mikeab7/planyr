/* B1123 bundle-budget offset — the title reader is now loaded on demand, and its stored-key helpers
 * live in a separate `titleKey.js` so the planner can read the key without pulling the reader's
 * multi-KB Claude schema + prompt onto the site route.
 *
 * THE TRAP THIS GUARDS, because it shipped once and lint caught it rather than a test: the split was
 * first written as a bare `export { getKey } from "./titleKey.js"`. That forwards the name to
 * CONSUMERS but does not bind it in the forwarding module's own scope — and `readTitlePDF` calls
 * `getKey()` itself, so the reader was broken at runtime while every consumer's import still
 * resolved. A re-export is not an import. The assertions below exercise both halves: the re-exported
 * surface consumers see, AND the internal call, via the no-key path that reaches `getKey()` before
 * any network work is attempted.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { KEY_LS, getKey, setKey } from "../src/workspaces/site-planner/lib/titleKey.js";
import * as reader from "../src/workspaces/site-planner/lib/titleReader.js";

const store = new Map();
beforeEach(() => {
  store.clear();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
});
afterEach(() => { delete globalThis.localStorage; });

describe("titleKey — the split-out stored-key helpers", () => {
  it("round-trips the key and clears it on an empty write", () => {
    expect(getKey()).toBe("");
    setKey("sk-test-123");
    expect(store.get(KEY_LS)).toBe("sk-test-123");
    expect(getKey()).toBe("sk-test-123");
    setKey("");
    expect(getKey()).toBe("");
    expect(store.has(KEY_LS)).toBe(false);
  });
  it("survives a hostile localStorage rather than throwing (unchanged behaviour)", () => {
    globalThis.localStorage = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    expect(() => getKey()).not.toThrow();
    expect(getKey()).toBe("");
    expect(() => setKey("x")).not.toThrow();
  });
  it("keeps the storage key byte-identical — renaming it would orphan every saved key", () => {
    expect(KEY_LS).toBe("planarfit:anthropicKey");
  });
});

describe("titleReader — the deferred module still resolves its own key binding", () => {
  it("re-exports the key helpers, so existing consumers are unchanged", () => {
    expect(reader.KEY_LS).toBe(KEY_LS);
    expect(reader.getKey).toBe(getKey);
    expect(reader.setKey).toBe(setKey);
  });
  it("readTitlePDF reaches getKey() INTERNALLY — a bare re-export would throw ReferenceError here", async () => {
    await expect(reader.readTitlePDF("Zm9v", {})).rejects.toThrow(/No API key/);
    // With a key in storage it gets PAST that guard (and on to the SDK import / network, which this
    // test does not exercise) — proving the internal lookup actually reads the store.
    setKey("sk-test-123");
    await expect(reader.readTitlePDF("Zm9v", {})).rejects.not.toThrow(/No API key/);
  });
});
