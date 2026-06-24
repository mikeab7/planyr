import { describe, it, expect } from "vitest";
import { lockRole, createEditorLock } from "../src/shared/presence/editorLock.js";
import { canCloudSave } from "../src/workspaces/doc-review/lib/usePersistence.js";

// B455/NEW-7 — the cloud-save gate (used by both Site Planner and Doc Review): a conflict
// or a read-only background tab must NOT push (only the LOCAL mirror keeps running).
describe("canCloudSave — conflict + read-only gate (B455)", () => {
  it("allows a normal save", () => {
    expect(canCloudSave("saving", false)).toBe(true);
    expect(canCloudSave("saved", false)).toBe(true);
    expect(canCloudSave("unsaved", false)).toBe(true);
  });
  it("blocks while a conflict is unresolved (must reload to merge first)", () => {
    expect(canCloudSave("conflict", false)).toBe(false);
  });
  it("blocks from a read-only background tab (can't clobber the active one)", () => {
    expect(canCloudSave("saving", true)).toBe(false);
    expect(canCloudSave("saved", true)).toBe(false);
  });
});

// B455/NEW-7 — single-active-editor lockout (Web Locks). Only one tab holds the editor
// lock per project; others go read-only and can't save over the active one.
describe("lockRole — pure role mapping (B455)", () => {
  it("degrades OPEN (active) when Web Locks is unavailable", () => {
    expect(lockRole({ locksAvailable: false, hasProject: true, decided: false, granted: false }))
      .toEqual({ active: true, readOnly: false });
  });
  it("is neutral when no project is open", () => {
    expect(lockRole({ locksAvailable: true, hasProject: false, decided: false, granted: false }))
      .toEqual({ active: false, readOnly: false });
  });
  it("is optimistically active until the lock decides (no read-only flash on a sole tab)", () => {
    expect(lockRole({ locksAvailable: true, hasProject: true, decided: false, granted: false }))
      .toEqual({ active: true, readOnly: false });
  });
  it("active when we hold it, read-only when we don't", () => {
    expect(lockRole({ locksAvailable: true, hasProject: true, decided: true, granted: true }))
      .toEqual({ active: true, readOnly: false });
    expect(lockRole({ locksAvailable: true, hasProject: true, decided: true, granted: false }))
      .toEqual({ active: false, readOnly: true });
  });
});

// A minimal in-memory Web Locks mock: one exclusive holder per name; ifAvailable returns
// null when held; a blocking request is granted when the current holder releases.
function makeLocks() {
  const held = new Map();   // name -> release fn currently holding
  const waiters = new Map(); // name -> [grant fns]
  return {
    request(name, opts, cb) {
      const callback = typeof opts === "function" ? opts : cb;
      const options = typeof opts === "function" ? {} : (opts || {});
      const grant = () => {
        let resolveOuter;
        const outer = new Promise((r) => { resolveOuter = r; });
        const ret = callback({ name });
        if (ret && typeof ret.then === "function") {
          // holder: keep the lock until its promise resolves, then hand off to a waiter
          held.set(name, () => {});
          ret.then(() => {
            held.delete(name);
            const q = waiters.get(name);
            if (q && q.length) q.shift()();
            resolveOuter();
          });
        } else { resolveOuter(); }
        return outer;
      };
      if (options.ifAvailable && held.has(name)) {
        return Promise.resolve(callback(null)); // held elsewhere → null lock
      }
      if (held.has(name)) {
        return new Promise((res) => { (waiters.get(name) || waiters.set(name, []).get(name)).push(() => { grant(); res(); }); });
      }
      return grant();
    },
  };
}

describe("createEditorLock — orchestration against a Web Locks mock (B455)", () => {
  it("a sole tab becomes active", async () => {
    const locks = makeLocks();
    const a = createEditorLock({ locks });
    const seen = [];
    a.onChange((r) => seen.push(r));
    a.setProject("p1");
    await Promise.resolve(); await Promise.resolve();
    expect(a.role()).toEqual({ active: true, readOnly: false });
  });

  it("a second tab on the same project goes READ-ONLY", async () => {
    const locks = makeLocks();
    const a = createEditorLock({ locks });
    const b = createEditorLock({ locks });
    a.setProject("p1");
    await Promise.resolve(); await Promise.resolve();
    b.setProject("p1");
    await Promise.resolve(); await Promise.resolve();
    expect(a.role()).toEqual({ active: true, readOnly: false });
    expect(b.role()).toEqual({ active: false, readOnly: true });
  });

  it("hands off: when the active tab stops, the waiting tab becomes active", async () => {
    const locks = makeLocks();
    const a = createEditorLock({ locks });
    const b = createEditorLock({ locks });
    a.setProject("p1"); await Promise.resolve(); await Promise.resolve();
    b.setProject("p1"); await Promise.resolve(); await Promise.resolve();
    expect(b.readOnly()).toBe(true);
    a.stop(); // active tab closes → lock hands off
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(b.role()).toEqual({ active: true, readOnly: false });
  });

  it("degrades OPEN (active) when Web Locks is absent", () => {
    const a = createEditorLock({ locks: null });
    a.setProject("p1");
    expect(a.role()).toEqual({ active: true, readOnly: false });
  });
});
