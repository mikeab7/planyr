import { describe, it, expect } from "vitest";
import {
  decideReport,
  buildErrorRow,
  errorSignature,
  extractMessage,
  extractStack,
  reportClientEvent,
  TAB_ID,
  DUP_MS,
  RATE_WINDOW_MS,
  RATE_MAX,
  SESSION_MAX,
  networkReportSuppression,
  SUPPRESSED_AUTOMATED,
} from "../src/shared/telemetry/clientErrors.js";

// B279 — error telemetry. The pure layer (decide-to-send + row shaping) is what carries
// the real logic; the network sink is a thin fire-and-forget insert verified headlessly.

describe("decideReport — storm guard (B279)", () => {
  const fresh = () => ({ seen: new Map(), windowStart: 0, sent: 0, total: 0 });

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

  it("enforces a hard per-session ceiling that the rolling window cannot re-arm past", () => {
    let s = fresh();
    let now = 1000;
    let allowed = 0;
    // Drip distinct signatures one per minute (dup window + per-minute burst cap never bite),
    // far past the session ceiling. Only SESSION_MAX should ever get through.
    for (let i = 0; i < SESSION_MAX + 25; i++) {
      const r = decideReport(`drip${i}`, now, s); s = r.state;
      if (r.report) allowed++;
      now += RATE_WINDOW_MS; // each in its own fresh window, so the burst cap resets every time
    }
    expect(allowed).toBe(SESSION_MAX);
    expect(s.total).toBe(SESSION_MAX);
    // Even much later, nothing more goes out — the ceiling is for the page's lifetime.
    const r = decideReport("way-later", now + 10 * RATE_WINDOW_MS, s);
    expect(r.report).toBe(false);
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

// B468/NEW-5 — structured NON-error events (read-only enter/leave, save suppressed, cloud
// conflict, zero-row delete) so a silent lockout is diagnosable from telemetry after the fact.
describe("reportClientEvent — structured events, fail-safe (B468/NEW-5)", () => {
  it("exposes a stable, short, non-empty tab id (so multi-tab contention is reconstructable)", () => {
    expect(typeof TAB_ID).toBe("string");
    expect(TAB_ID.length).toBeGreaterThan(0);
  });

  it("NEVER throws into the app, whatever it's handed (telemetry must be invisible on failure)", () => {
    const circular = {}; circular.self = circular; // unserializable extra → the JSON.stringify must be guarded
    expect(() => reportClientEvent("readonly-enter", "went read-only", { id: "s1" })).not.toThrow();
    expect(() => reportClientEvent("save-suppressed", "cloud push skipped", circular)).not.toThrow();
    expect(() => reportClientEvent(null, null)).not.toThrow();
    expect(() => reportClientEvent("delete-zero-rows")).not.toThrow();
  });
});

/* ⛔ B270912 — PRODUCTION TELEMETRY MUST NOT REPORT FROM AUTOMATED RUNS, and the pure decision is
 * pinned here because the browser half of the proof (`ui-audit/verify-capture-pipe.mjs`, the
 * `suppressed` arm) cannot run in this repo's CI. Measured cause: 679 rows in twenty-four hours,
 * 87 of 98 `event:perf` rows synthetic against 11 from the owner — his "that felt slow just now"
 * capture arriving as one row in several hundred, separable only by a read-side filter on his
 * display signature.
 *
 * The two properties that matter most are the ones a careless fix gets wrong:
 *   • the OPT-IN wins, because `verify-capture-pipe` — including its anti-rot arms, which prove a
 *     BROKEN delivery is loud — runs under automation and would otherwise be disabled by this very
 *     change, passing forever while observing nothing;
 *   • it FAILS OPEN, because silencing a real user over an unreadable property is strictly worse
 *     than one extra test row. */
describe("networkReportSuppression — automated runs do not write to production (B270912)", () => {
  it("does not suppress an ordinary browser session", () => {
    const r = networkReportSuppression({ navigator: {} });
    expect(r.suppress).toBe(false);
    expect(r.automated).toBe(false);
  });

  it("suppresses under navigator.webdriver — the detector that needs no per-spec discipline", () => {
    // ⛔ THIS, not the flag, is the primary gate, and the reason is measured: 62 of the 81 specs in
    // e2e/ never set `window.__PLANYR_E2E` — including assembly-tear-detector.spec.js, the top
    // producer of three of the five loudest sources in the table. A flag-only gate would have
    // silenced 19 specs, left every top row untouched, and reported success.
    const r = networkReportSuppression({ navigator: { webdriver: true } });
    expect(r.suppress).toBe(true);
    expect(r.via).toBe("webdriver");
  });

  it("suppresses under __PLANYR_E2E too — the second door, for a non-webdriver harness", () => {
    const r = networkReportSuppression({ __PLANYR_E2E: true, navigator: {} });
    expect(r.suppress).toBe(true);
    expect(r.via).toBe("flag");
  });

  it("names BOTH when both are present, so a reader can tell which gate caught it", () => {
    expect(networkReportSuppression({ __PLANYR_E2E: true, navigator: { webdriver: true } }).via).toBe("webdriver+flag");
  });

  it("the EXPLICIT opt-in wins — without it the pipe verification would be blinded by its own fix", () => {
    for (const win of [
      { navigator: { webdriver: true }, __PLANYR_TELEMETRY_NETWORK: true },
      { navigator: {}, __PLANYR_E2E: true, __PLANYR_TELEMETRY_NETWORK: true },
    ]) {
      const r = networkReportSuppression(win);
      expect(r.automated).toBe(true);
      expect(r.optIn).toBe(true);
      expect(r.suppress).toBe(false);   // …so verify-capture-pipe still delivers, and still fails loudly when delivery breaks
    }
  });

  it("only a strict `true` opts in — a truthy stray value must not re-open production reporting", () => {
    expect(networkReportSuppression({ navigator: { webdriver: true }, __PLANYR_TELEMETRY_NETWORK: 1 }).suppress).toBe(true);
    expect(networkReportSuppression({ navigator: { webdriver: true }, __PLANYR_TELEMETRY_NETWORK: "yes" }).suppress).toBe(true);
  });

  it("only a strict `true` suppresses — a truthy stray must not silence a real user either", () => {
    expect(networkReportSuppression({ navigator: { webdriver: "false" } }).suppress).toBe(false);
    expect(networkReportSuppression({ __PLANYR_E2E: 1, navigator: {} }).suppress).toBe(false);
  });

  it("FAILS OPEN on anything unreadable — a throwing property never silences telemetry", () => {
    const hostile = {};
    Object.defineProperty(hostile, "__PLANYR_E2E", { get() { throw new Error("nope"); } });
    Object.defineProperty(hostile, "navigator", { get() { throw new Error("nope"); } });
    Object.defineProperty(hostile, "__PLANYR_TELEMETRY_NETWORK", { get() { throw new Error("nope"); } });
    expect(() => networkReportSuppression(hostile)).not.toThrow();
    expect(networkReportSuppression(hostile).suppress).toBe(false);
    expect(networkReportSuppression(undefined).suppress).toBe(false);
    expect(networkReportSuppression(null).suppress).toBe(false);
  });

  it("exports a stable reason string — the recorder and the button both branch on it", () => {
    // A literal here on purpose: this string crosses three modules (the sink, the recorder's
    // suppressed/undelivered split, and the manual button's `local` state), so a silent rename
    // would quietly turn every suppressed send back into a "the server is unreachable" warning.
    expect(SUPPRESSED_AUTOMATED).toBe("automated-run");
  });
});
