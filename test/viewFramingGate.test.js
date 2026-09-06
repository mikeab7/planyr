/* viewFramingGate — "the view belongs to whoever touched it last, and the app never takes it back."
 *
 * ⛔ EACH BLOCK NAMES THE MUTATION IT CATCHES, because this replaces a guard that was individually
 * correct and structurally unable to hold the invariant (a per-mount `useRef` consulted at one call
 * site). A replacement that is merely a different shape of the same hole would pass a lazy test.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createViewFramingGate } from "../src/workspaces/site-planner/lib/viewFramingGate.js";

let g;
beforeEach(() => { g = createViewFramingGate(); });

describe("the boot framing", () => {
  it("runs on a plan the user has not touched", () => {
    const ticket = g.framingTicket();
    expect(g.mayFrame(ticket).ok).toBe(true);
  });

  it("is CANCELLED by a gesture made after it was requested — however late it fires", () => {
    /* The reported bug, in one assertion. Mutation: checking the move count at REQUEST time rather
     * than at EXECUTION time makes this pass a framing that lands on top of a live gesture. */
    const ticket = g.framingTicket();
    g.noteUserViewMove();
    const v = g.mayFrame(ticket);
    expect(v.ok).toBe(false);
    expect(v.why).toBe("user-moved-since-request");
  });

  it("⛔ STAYS cancelled no matter how long ago the user moved", () => {
    /* "…no matter how long ago that was" is the owner's own clause. Mutation: any decay, timeout or
     * "it's been quiet for a while so it's fine to reframe" would pass this and reintroduce exactly
     * the idle-then-gesture trigger — the app forgetting he ever took the wheel. */
    g.noteUserViewMove();
    const ticketTakenMuchLater = g.framingTicket();
    for (let i = 0; i < 5000; i++) g.noteUserViewMove();
    expect(g.mayFrame(ticketTakenMuchLater).ok).toBe(false);
  });
});

describe("an immediate user action is never blocked", () => {
  it("lets 'Fit view' frame a plan the user has already panned around", () => {
    /* Mutation: a plain boolean ("has the user ever moved?") is the obvious cheap implementation and
     * it FAILS here — it would disable Fit view forever after the first pan, which is why this
     * module counts moves and compares against a ticket instead. */
    for (let i = 0; i < 12; i++) g.noteUserViewMove();
    expect(g.mayFrame(g.framingTicket()).ok).toBe(true);
  });
});

describe("a deferred, user-REQUESTED framing", () => {
  it("still frames when nothing intervened", () => {
    const ticket = g.framingTicket();           // e.g. a slow lookup starting
    expect(g.mayFrame(ticket).ok).toBe(true);           // …returning with the view untouched
  });
  it("is dropped when the user gestured while it was in flight", () => {
    const ticket = g.framingTicket();
    g.noteUserViewMove();                        // he pinched during the fetch
    expect(g.mayFrame(ticket).ok).toBe(false);
  });
});

describe("⛔ ownership is scoped to the VIEW SESSION, and that scope is a decision, not an oversight", () => {
  it("two planners (or one remounted) do not share ownership", () => {
    /* The tempting 'improvement' — module state keyed by plan, so ownership survives a remount —
     * was written, and it would have shipped a WORSE bug than the one being fixed. `view` is
     * component state with no persisted copy, so a remount RESETS THE VIEW; the automatic reframe
     * is the only thing that makes a re-opened plan look like anything. Suppressing it because the
     * user panned that plan before the remount lands him on a default view of nothing. */
    const a = createViewFramingGate(), b = createViewFramingGate();
    a.noteUserViewMove();
    expect(a.mayFrame(a.framingTicket()).at).toBeUndefined();      // shape check: tickets are plain
    expect(b.userMoveCount()).toBe(0);
    expect(b.mayFrame(b.framingTicket()).ok).toBe(true);           // a fresh view session frames
  });

  it("a fresh gate always permits its first framing — the re-opened-plan case", () => {
    const fresh = createViewFramingGate();
    expect(fresh.mayFrame(fresh.framingTicket()).ok).toBe(true);
  });
});

describe("a missing ticket is refused, not waved through", () => {
  it("answers no rather than defaulting to allow", () => {
    // LOUD-FAILURE: a gate that opens when it does not understand the question is not a gate.
    expect(g.mayFrame(null).ok).toBe(false);
    expect(g.mayFrame(undefined).why).toBe("no-ticket");
  });
});

describe("⛔ B1234400 — a framing must be MEASURABLE, not just unowned", () => {
  /* The captured production defect, in one assertion: a cold boot with nobody at the wheel — the
   * move-count check alone says yes — while the document is hidden. Mutation: a `mayFrame` that
   * ignores `readiness` (the shape before this fix) passes every case in this block. */
  it("refuses a framing while the document is hidden, even with nothing else in its way", () => {
    const ticket = g.framingTicket();
    const v = g.mayFrame(ticket, { visible: false, measured: true });
    expect(v.ok).toBe(false);
    expect(v.why).toBe("document-hidden");
  });

  it("refuses a framing while the container has never been genuinely measured", () => {
    const ticket = g.framingTicket();
    const v = g.mayFrame(ticket, { visible: true, measured: false });
    expect(v.ok).toBe(false);
    expect(v.why).toBe("container-unmeasured");
  });

  it("visibility is checked before measurement — a caller retrying wants the more fundamental reason first", () => {
    const ticket = g.framingTicket();
    expect(g.mayFrame(ticket, { visible: false, measured: false }).why).toBe("document-hidden");
  });

  it("readiness defaults to true for every existing caller — pure ownership behaviour is unchanged", () => {
    const ticket = g.framingTicket();
    expect(g.mayFrame(ticket).ok).toBe(true);
    expect(g.mayFrame(ticket, {}).ok).toBe(true);
  });

  it("a visible, measured framing still falls through to the ownership check", () => {
    const ticket = g.framingTicket();
    g.noteUserViewMove();
    const v = g.mayFrame(ticket, { visible: true, measured: true });
    expect(v.ok).toBe(false);
    expect(v.why).toBe("user-moved-since-request");
  });

  it("a genuinely ready, unowned framing still runs", () => {
    const ticket = g.framingTicket();
    expect(g.mayFrame(ticket, { visible: true, measured: true }).ok).toBe(true);
  });
});

describe("⛔ the STRUCTURAL guard — every framing path must go through the one door", () => {
  const SRC = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)), "utf8");

  it("the boot reframe takes its ticket at REQUEST time and hands it to requestFit", () => {
    /* This is the assertion that stops the fix rotting back into the shape it replaced. A future
     * edit that reverts to an unconditional `requestFit()` in the become-active effect fails here. */
    const effect = SRC.slice(SRC.indexOf("// Reframe when this view becomes active"), SRC.indexOf("// Reframe when this view becomes active") + 900);
    expect(effect).toMatch(/const ticket = framingGate\.current\.framingTicket\(\)/);
    expect(effect).toMatch(/requestFit\(ticket\)/);
  });

  it("requestFit takes a ticket, and defaults to one taken on the spot", () => {
    const fn = SRC.slice(SRC.indexOf("const requestFit = useCallback("), SRC.indexOf("const requestFit = useCallback(") + 320);
    expect(fn).toMatch(/framingGate\.current\.framingTicket\(\)/);
    expect(fn).toMatch(/setFitReq/);
  });

  it("⛔ THE VERDICT IS TAKEN AT EXECUTION, NOT AT REQUEST — the hole that reproduced the bug", () => {
    /* A framing runs an effect-tick after it is requested, and the main thread can stretch that gap
     * arbitrarily. Checking the gate inside `requestFit` grants permission while the user has not
     * moved and spends it after he has — measured live at 40x throttle: a wheel took the view to
     * 0.4594 px/ft and a fit then yanked it to 0.1064. The check must sit immediately before `fit()`.
     * Mutation: moving `mayFrame` back into `requestFit` fails this. */
    const eff = SRC.slice(SRC.indexOf("    if (!fitReq) return;"), SRC.indexOf("    if (!fitReq) return;") + 1600);
    expect(eff).toMatch(/framingGate\.current\.mayFrame\(fitReq\.ticket,/);
    expect(eff).toMatch(/frame:suppressed/);
    expect(eff.indexOf("mayFrame")).toBeLessThan(eff.indexOf("fit()"));
    const rfStart = SRC.indexOf("const requestFit = useCallback(");
    const rf = SRC.slice(rfStart, SRC.indexOf("}, []);", rfStart));
    expect(rf).not.toMatch(/mayFrame/);
  });

  it("the nonce indirection cannot be re-introduced without the ticket riding along", () => {
    // A bare counter loses the ticket, and with it the whole request-time/execution-time distinction.
    expect(SRC).not.toMatch(/setFitNonce/);
  });

  it("the per-call-site ref this replaced is gone from the CODE, not merely bypassed", () => {
    /* Two sources of truth for one fact is how the next session reintroduces the bug. The name may
     * still appear in prose — the comment that explains why B1448's guard lost this race is the
     * most valuable line in the file — so this asserts on code, not on the whole text. */
    const code = SRC.split("\n").filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l)).join("\n");
    expect(code).not.toMatch(/userMovedViewRef/);
  });

  it("all three view-moving gestures claim ownership", () => {
    // The wheel notch, the pinch move and the armed drag-pan. Miss one and the gate is blind to it.
    expect(SRC.match(/framingGate\.current\.noteUserViewMove\(\)/g)?.length).toBe(3);
  });

  it("⛔ requestFit is never passed straight to onClick (the event would arrive as the ticket)", () => {
    expect(SRC).not.toMatch(/onClick=\{requestFit\}/);
    expect(SRC).not.toMatch(/onPress=\{requestFit\}/);
  });
});
