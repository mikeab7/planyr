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
      if (options.steal) { held.delete(name); return grant(); } // preempt the current holder (B466/NEW-3)
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

// A shared in-memory BroadcastChannel bus: every channel() shares one peer list, and a
// postMessage is delivered to every OTHER channel's onmessage (synchronously) — enough to
// exercise the takeover yield protocol without a real browser.
function makeBus() {
  const peers = [];
  return () => {
    const ch = { onmessage: null, postMessage(data) { for (const p of peers) if (p !== ch && p.onmessage) p.onmessage({ data }); }, close() {} };
    peers.push(ch);
    return ch;
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

// B466/NEW-3 — "Take over editing here": a read-only tab can become the active editor.
describe("createEditorLock.takeOver — steal the lock + hand off the prior holder (B466)", () => {
  const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

  it("a read-only tab that takes over becomes the active editor (the steal guarantee)", async () => {
    const locks = makeLocks();
    const a = createEditorLock({ locks, channel: null });
    const b = createEditorLock({ locks, channel: null });
    a.setProject("p1"); await tick();
    b.setProject("p1"); await tick();
    expect(b.readOnly()).toBe(true);
    expect(b.takeOver()).toBe(true);
    await tick();
    expect(b.active()).toBe(true); // b stole the lock → now the active editor
  });

  it("broadcasting a takeover makes the prior holder step down to read-only (the bus hand-off)", async () => {
    const locks = makeLocks();
    const bus = makeBus();
    const a = createEditorLock({ locks, channel: bus() });
    const b = createEditorLock({ locks, channel: bus() });
    a.setProject("p1"); await tick();
    b.setProject("p1"); await tick();
    expect(a.active()).toBe(true);
    expect(b.readOnly()).toBe(true);
    b.takeOver(); await tick();
    expect(b.active()).toBe(true);    // b is now the active editor…
    expect(a.readOnly()).toBe(true);  // …and a stepped down via the yield broadcast
  });

  it("take-over is a no-op-but-active when Web Locks is unavailable (already the sole editor)", () => {
    const a = createEditorLock({ locks: null, channel: null });
    a.setProject("p1");
    expect(a.takeOver()).toBe(false); // nothing to steal — degraded open
    expect(a.active()).toBe(true);
  });
});
