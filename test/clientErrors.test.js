import { describe, it, expect } from "vitest";
import {
  decideReport,
  buildErrorRow,
  errorSignature,
  extractMessage,
  extractStack,
  DUP_MS,
  RATE_WINDOW_MS,
  RATE_MAX,
} from "../src/shared/telemetry/clientErrors.js";

// B279 — error telemetry. The pure layer (decide-to-send + row shaping) is what carries
// the real logic; the network sink is a thin fire-and-forget insert verified headlessly.

describe("decideReport — storm guard (B279)", () => {
  const fresh = () => ({ seen: new Map(), windowStart: 0, sent: 0 });

  it("reports the first time a signature is seen", () => {
    const r = decideReport("sig-a", 1000, fresh());
    expect(r.report).toBe(true);
    expect(r.state.sent).toBe(1);
  });

  it("suppresses an exact-duplicate signature within the dup window, then re-allows it", () => {
    let s = fresh();
    let r = decideReport("dup", 1000, s); s = r.state;
    expect(r.report).toBe(true);
    // same signature 1ms later → suppressed
    r = decideReport("dup", 1001, s); s = r.state;
    expect(r.report).toBe(false);
    // still within the window → suppressed
    r = decideReport("dup", 1000 + DUP_MS - 1, s); s = r.state;
    expect(r.report).toBe(false);
    // past the dup window → allowed again
    r = decideReport("dup", 1000 + DUP_MS, s); s = r.state;
    expect(r.report).toBe(true);
  });

  it("a different signature is not suppressed by another's dup window", () => {
    let s = fresh();
    let r = decideReport("a", 1000, s); s = r.state;
    r = decideReport("b", 1001, s); s = r.state;
    expect(r.report).toBe(true);
  });

  it("caps total sends per window, then re-arms when the window rolls over", () => {
    let s = fresh();
    let now = 1000;
    // Fill the rate budget with DISTINCT signatures (dup-suppression wouldn't apply).
    for (let i = 0; i < RATE_MAX; i++) {
      const r = decideReport(`s${i}`, now, s); s = r.state;
      expect(r.report).toBe(true);
      now += 1;
    }
    // One more within the same window → over cap → suppressed.
    let r = decideReport("over", now, s); s = r.state;
    expect(r.report).toBe(false);
    // Once the per-minute window elapses, the budget resets.
    r = decideReport("after-window", 1000 + RATE_WINDOW_MS, s); s = r.state;
    expect(r.report).toBe(true);
    expect(r.state.sent).toBe(1);
  });

  it("honors custom opts and never throws on a bare/empty state", () => {
    const r = decideReport("x", 5, undefined, { dupMs: 100, windowMs: 1000, maxPerWindow: 1 });
    expect(r.report).toBe(true);
    const r2 = decideReport("y", 6, r.state, { dupMs: 100, windowMs: 1000, maxPerWindow: 1 });
    expect(r2.report).toBe(false); // cap of 1 already used this window
  });
});

describe("extractMessage / extractStack (B279)", () => {
  it("reads a message from Error, string, rejection reason, and arbitrary objects", () => {
    expect(extractMessage(new Error("boom"))).toBe("boom");
    expect(extractMessage("plain string error")).toBe("plain string error");
    expect(extractMessage({ reason: new Error("nested reason") })).toBe("nested reason");
    expect(extractMessage({ toString: () => "stringified" })).toBe("stringified");
  });

  it("is null/undefined-safe and never throws", () => {
    expect(extractMessage(null)).toBe("");
    expect(extractMessage(undefined)).toBe("");
    expect(() => extractMessage(Object.create(null))).not.toThrow();
  });

  it("appends the React component stack when present", () => {
    const s = extractStack(new Error("x"), { componentStack: "    in SitePlannerApp" });
    expect(s).toContain("Component stack:");
    expect(s).toContain("in SitePlannerApp");
  });
});

describe("buildErrorRow (B279)", () => {
  const meta = { build: "abc1234", url: "https://planyr.io/", userAgent: "test-UA" };

  it("shapes the row with source, module, message and metadata", () => {
    const row = buildErrorRow(new Error("kaboom"), { source: "window.onerror", module: "site-planner" }, meta);
    expect(row).toMatchObject({
      build: "abc1234",
      module: "site-planner",
      source: "window.onerror",
      message: "kaboom",
      url: "https://planyr.io/",
      user_agent: "test-UA",
    });
    expect(typeof row.stack).toBe("string");
  });

  it("defaults source to 'error' and module to null", () => {
    const row = buildErrorRow("oops", {}, meta);
    expect(row.source).toBe("error");
    expect(row.module).toBe(null);
    expect(row.message).toBe("oops");
  });

  it("truncates a very long message and stack so rows stay bounded", () => {
    const huge = "x".repeat(50_000);
    const err = new Error(huge);
    err.stack = "y".repeat(50_000);
    const row = buildErrorRow(err, { source: "react" }, meta);
    expect(row.message.length).toBe(2000);
    expect(row.stack.length).toBe(8000);
  });
});

describe("errorSignature (B279)", () => {
  it("combines source + message and is bounded in length", () => {
    expect(errorSignature("react", "Cannot read x")).toBe("react|Cannot read x");
    expect(errorSignature(undefined, undefined)).toBe("error|");
    expect(errorSignature("s", "m".repeat(1000)).length).toBe(300);
  });
});
