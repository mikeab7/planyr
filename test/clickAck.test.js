/* NEW-1 — the click acknowledgement must never outlive its answer. Node env (no jsdom): a tiny fake
 * document is enough to exercise the lifecycle. The real-browser red-proof is e2e/click-ack.spec.js. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

function fakeEl() {
  const el = { children: [], style: {}, attrs: {}, className: "", textContent: "", parentNode: null };
  el.setAttribute = (k, v) => { el.attrs[k] = v; };
  el.appendChild = (c) => { c.parentNode = el; el.children.push(c); return c; };
  el.removeChild = (c) => { el.children = el.children.filter((x) => x !== c); c.parentNode = null; return c; };
  return el;
}

let startClickAck, pendingClickAcks, body, cls;
beforeEach(async () => {
  vi.useFakeTimers();
  body = fakeEl();
  cls = new Set();
  globalThis.document = {
    body,
    createElement: () => fakeEl(),
    documentElement: { classList: { toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)) } },
  };
  vi.resetModules();
  ({ startClickAck, pendingClickAcks } = await import("../src/shared/ui/clickAck.js"));
});
afterEach(() => { vi.useRealTimers(); delete globalThis.document; });

describe("clickAck", () => {
  it("appears synchronously at the cursor and marks the page busy", () => {
    startClickAck(120, 340);
    expect(body.children).toHaveLength(1);
    expect(body.children[0].style.left).toBe("120px");
    expect(body.children[0].style.top).toBe("340px");
    expect(body.children[0].attrs["data-state"]).toBe("pending");
    expect(cls.has("click-ack-busy")).toBe(true);
  });
  it("done() and cancel() clear it and the busy cursor", () => {
    const a = startClickAck(1, 1); a.done();
    const b = startClickAck(2, 2); b.cancel();
    expect(body.children).toHaveLength(0);
    expect(cls.has("click-ack-busy")).toBe(false);
    expect(pendingClickAcks()).toBe(0);
  });
  it("empty() swaps in a 'no lot' tag, stops the busy cursor, then removes itself", () => {
    const a = startClickAck(1, 1); a.empty("No lot here");
    expect(body.children[0].attrs["data-state"]).toBe("empty");
    expect(body.children[0].children[0].textContent).toBe("No lot here");
    expect(cls.has("click-ack-busy")).toBe(false);
    vi.advanceTimersByTime(3000);
    expect(body.children).toHaveLength(0);
  });
  it("a wedged county host cannot leave a ring spinning forever (watchdog)", () => {
    startClickAck(1, 1);
    vi.advanceTimersByTime(12001);
    expect(body.children[0].attrs["data-state"]).toBe("empty");
    vi.advanceTimersByTime(3000);
    expect(body.children).toHaveLength(0);
    expect(pendingClickAcks()).toBe(0);
  });
  it("is idempotent: done() after empty() does not resurrect or throw", () => {
    const a = startClickAck(1, 1); a.empty("x"); a.done(); a.cancel();
    expect(body.children).toHaveLength(1); // the tag stays until its own timer
    vi.advanceTimersByTime(3000);
    expect(body.children).toHaveLength(0);
  });
});
