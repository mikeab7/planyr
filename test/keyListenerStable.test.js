/* B-Q-FIRST-PRESS — the planner's window keydown listener must never be torn down and re-added from a
 * passive effect. React flushes pending passive effects at the start of the next discrete event, i.e. in the
 * middle of that very keypress's dispatch: the old listener is removed after the event was queued to it and
 * the new one is added too late, so the key is silently dropped (owner: "Q sometimes needs a double tap").
 * Contract: ONE stable listener registered in an effect with `[]` deps, forwarding to a ref that a
 * LAYOUT effect keeps current. */
import { describe, it, expect } from "vitest";
import { plannerSource } from "./helpers/plannerSource.js";

describe("planner keyboard listener is registered once", () => {
  const src = plannerSource();
  it("a stable forwarder is registered from a [] effect", () => {
    expect(src).toMatch(/const plannerKeyRef = useRef\(null\);/);
    expect(src).toMatch(/const down = \(e\) => plannerKeyRef\.current\?\.onKey\(e\);[\s\S]{0,400}\}, \[\]\);/);
  });
  it("the changing handler is published from a layout effect, not a passive one", () => {
    expect(src).toMatch(/useLayoutEffect\(\(\) => \{\s*const onKey = \(e\) => \{/);
    expect(src).toMatch(/plannerKeyRef\.current = \{ onKey, onKeyUp \};/);
  });
  it("the handler itself is never added to window directly", () => {
    expect(src).not.toMatch(/window\.addEventListener\("keydown", onKey\)/);
  });
});
