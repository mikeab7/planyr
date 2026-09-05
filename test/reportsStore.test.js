/* reportsStore — the global help/report control's submission model (B842866/B842864).
 * The pure context builder plus the queue/retry logic that guarantees LOUD-FAILURE: a report
 * that can't reach the server must survive on this device, never vanish.
 *
 * ⛔ Supabase is MOCKED unconfigured here, not merely absent — this file's premise is "the
 * signed-out/offline reporter path", and depending on the AMBIENT environment happening to lack
 * VITE_SUPABASE_* is not the same claim. CI's `build` job sets real production secrets as env vars
 * on the single shell step that runs the whole `npm run ci-parity` pipeline (build.yml), so THIS
 * gate's `npm test` subprocess inherits them too even though `ci-gates.yml` never declares the
 * Test gate as needing them — the first version of this file relied on that absence and, once it
 * ran under real secrets, made genuine writes into the PRODUCTION `problem_reports` table on every
 * CI run (caught live: PR #1425, 5 failing assertions all consistent with real inserts
 * succeeding instead of queuing). Mocking the module the same way `test/reconcileSite.test.js`
 * already does makes the "unconfigured" branch deterministic regardless of what secrets the
 * process happens to hold.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../src/workspaces/site-planner/lib/supabase.js", () => ({
  supabase: null,
  supabaseConfigured: () => false,
}));

import {
  buildReportContext, reportSessionId, submitReport, retryQueuedReports, queuedReportCount,
} from "../src/shared/reports/reportsStore.js";

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

describe("buildReportContext — never throws, even with no window/navigator (Node test env)", () => {
  it("returns an object carrying at least route and build", () => {
    const ctx = buildReportContext();
    expect(ctx).toBeTypeOf("object");
    expect(ctx).toHaveProperty("route");
    expect(ctx).toHaveProperty("build");
  });

  it("folds in a perf outcome when asked, without losing the base fields", () => {
    const ctx = buildReportContext({ perf: { captureTaken: true, captureDelivered: false } });
    expect(ctx.captureTaken).toBe(true);
    expect(ctx.captureDelivered).toBe(false);
    expect(ctx).toHaveProperty("build");
  });

  it("never carries a raw view object or anything outside its own named fields (privacy allowlist)", () => {
    const ctx = buildReportContext();
    const allowed = new Set(["route", "build", "viewportW", "viewportH", "dpr", "ua", "plan", "ppf", "layers", "captureTaken", "captureDelivered"]);
    for (const k of Object.keys(ctx)) expect(allowed.has(k), `unexpected context key: ${k}`).toBe(true);
  });
});

describe("reportSessionId — a stable per-browser id", () => {
  it("mints an id once and returns the same one on every later call", () => {
    const a = reportSessionId();
    const b = reportSessionId();
    expect(a).toBeTruthy();
    expect(a).toBe(b);
  });

  it("survives a storage read/write round trip under a fresh store", () => {
    const first = reportSessionId();
    globalThis.localStorage = makeStore(); // a fresh "browser" — the id must NOT carry over
    const second = reportSessionId();
    expect(second).not.toBe(first);
  });
});

describe("submitReport — LOUD-FAILURE: nothing is silently dropped when the network/backend is unavailable", () => {
  it("queues the report and says so, rather than reporting bare success or vanishing it", async () => {
    expect(queuedReportCount()).toBe(0);
    const r = await submitReport({ category: "problem", description: "it broke", context: buildReportContext() });
    expect(r.ok).toBe(false);
    expect(r.queued).toBe(true);
    expect(queuedReportCount()).toBe(1);
  });

  it("a bare 'slow' report (no description) still queues", async () => {
    const r = await submitReport({ category: "slow", context: buildReportContext({ perf: { captureTaken: true } }) });
    expect(r.queued).toBe(true);
    expect(queuedReportCount()).toBe(1);
  });

  it("an unknown category is coerced to the safe default rather than rejected or forwarded raw", async () => {
    await submitReport({ category: "not-a-real-category", description: "x" });
    expect(queuedReportCount()).toBe(1); // did not throw, did not silently drop
  });

  it("the outbox is bounded — it does not grow without limit", async () => {
    for (let i = 0; i < 30; i++) await submitReport({ category: "problem", description: `n${i}` });
    expect(queuedReportCount()).toBeLessThanOrEqual(20);
  });

  it("never attaches an email to an anonymous (signed-out) report", async () => {
    await submitReport({ category: "problem", description: "anon", userEmail: "someone@example.com" });
    const raw = JSON.parse(globalThis.localStorage.getItem("planyr:reports:queue:v1"));
    expect(raw[raw.length - 1].user_email).toBeNull();
    expect(raw[raw.length - 1].user_id).toBeNull();
  });
});

describe("retryQueuedReports — drains the outbox when possible, never clears it on failure", () => {
  it("with no backend configured, reports zero sent and keeps everything queued", async () => {
    await submitReport({ category: "problem", description: "one" });
    await submitReport({ category: "problem", description: "two" });
    const r = await retryQueuedReports();
    expect(r.sent).toBe(0);
    expect(r.remaining).toBe(2);
    expect(queuedReportCount()).toBe(2);
  });

  it("an empty outbox is a no-op", async () => {
    const r = await retryQueuedReports();
    expect(r).toEqual({ sent: 0, remaining: 0 });
  });
});
