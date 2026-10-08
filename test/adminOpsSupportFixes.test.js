// B2159504–B2159507: Ops digest auto-refresh, Support test-report filter + cleanup, user-detail deploy reloads, sweep hook.
import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isTestReport, filterTickets } from "../src/workspaces/admin/lib/adminSupport.js";
import { shapeTickets, shapeOps, digestStamp } from "../src/workspaces/admin/lib/adminPanels.js";
import { splitDeployReloads } from "../src/workspaces/admin/lib/adminIssues.js";
import { isInternalEmail } from "../src/workspaces/admin/lib/adminUsers.js";
import { normalizeSweep, recordSweepFromRun, installSweepHook } from "../src/workspaces/admin/lib/sweepHook.js";
import { buildSnapshots, buildIngestRequest, validateSnapshots, runPush } from "../scripts/ops-snapshot.mjs";
import { missingReportCleanup } from "../ui-audit/lib/reportCleanup.mjs";

const row = (o) => ({ id: Math.random().toString(36).slice(2), at: "2026-10-07T00:00:00Z", user_id: null, user_email: null, category: "problem", description: "", status: "open", ...o });
const internal = (e) => isInternalEmail(e, { selfEmail: "owner@example.com" });

describe("Support hides test reports (B2159505)", () => {
  const rows = [
    row({ description: "test — please ignore (zz-sweep-V464176)" }),                       // signed-out marked test
    row({ description: "test — please ignore (zz-sweep-V464176)", user_id: "u", user_email: "e2e@planyr.test" }),
    row({ category: "slow", user_id: "u", user_email: "e2e@planyr.test" }),
    row({ description: "Test diagnostic check", user_id: "o", user_email: "owner@example.com" }),
    row({ category: "slow", user_id: "o", user_email: "owner@example.com" }),
    row({ description: "the map will not load", user_id: "c", user_email: "ann@acme.com" }), // real customer
    row({ description: "I tried to test the export and it broke" }),                       // signed-out, real (no marker)
    row({ description: "test the thing please ignore nothing", user_id: "c", user_email: "ann@acme.com" }), // signed-in customer: marker never applies
  ];
  const tickets = shapeTickets(rows);
  it("hides internal accounts and signed-out marked tests, keeps real customers", () => {
    const f = filterTickets(tickets, { hideInternal: true, isInternal: internal });
    expect(f.open.map((t) => t.description)).toEqual(expect.arrayContaining(["the map will not load", "I tried to test the export and it broke"]));
    expect(f.open.length).toBe(3);
    expect(f.hiddenOpen).toBe(5);
  });
  it("switch off shows everything and hides nothing", () => {
    const f = filterTickets(tickets, { hideInternal: false, isInternal: internal });
    expect(f.open.length).toBe(8); expect(f.hiddenOpen).toBe(0);
  });
  it("the text marker is applied to signed-out reports only", () => {
    const t = shapeTickets([row({ description: "zz-sweep", user_id: "c", user_email: "ann@acme.com" })]).open[0];
    expect(isTestReport(t, internal)).toBe(false);
  });
});

describe("User detail drops deploy reloads (B2159506)", () => {
  const rows = [
    { id: 1, message: "Cannot read properties of undefined", source: "react" },
    { id: 2, message: "Failed to fetch dynamically imported module: https://planyr.io/assets/Notes-abc123XY.js", source: "unhandledrejection" },
    { id: 3, message: "anything", source: "vite:preloadError" },
    { id: 4, message: "Boom", source: "react" },
  ];
  it("excludes them and counts them", () => {
    const r = splitDeployReloads(rows, 8);
    expect(r.errors.map((e) => e.id)).toEqual([1, 4]);
    expect(r.deployReloads).toBe(2);
  });
  it("limit applies to real errors only; empty/garbage input is safe", () => {
    expect(splitDeployReloads(rows, 1).errors.length).toBe(1);
    expect(splitDeployReloads(null)).toEqual({ errors: [], deployReloads: 0 });
  });
});

describe("Ops digest stamp (B2159504)", () => {
  const raw = (updated, commit) => ({ snapshots: { backlog: { updated_at: updated, payload: { commit, open: { count: 1, recent: [] }, verify: { count: 0, recent: [] } } } }, sweeps: [] });
  const now = Date.parse("2026-10-08T12:00:00Z");
  it("shows relative time and the short commit", () => {
    const s = digestStamp(shapeOps(raw("2026-10-08T10:00:00Z", "f1b3bcd8aaaa")), now);
    expect(s).toMatchObject({ ago: "2 hr ago", commit: "f1b3bcd", stale: false });
  });
  it("flags a digest older than 3 days as not updating, and a hand-loaded one has no commit", () => {
    const s = digestStamp(shapeOps(raw("2026-10-04T13:10:00Z", undefined)), now);
    expect(s.stale).toBe(true); expect(s.commit).toBeNull();
  });
  it("no digest → null", () => { expect(digestStamp(shapeOps({ snapshots: {}, sweeps: [] }))).toBeNull(); });
});

describe("ops-snapshot --push (B2159504)", () => {
  const stamp = { commit: "abcdef1234567890", committedAt: "2026-10-08T00:00:00Z" };
  const root = mkdtempSync(join(tmpdir(), "ops-"));
  for (const [d, id] of [["backlog/open", "B1"], ["backlog/verify", "B2"], ["verification/pending", "V3"]]) {
    mkdirSync(join(root, "ledger", d), { recursive: true });
    writeFileSync(join(root, "ledger", d, `${id}.md`), `### ${id} — Thing #ui\n`);
  }
  const env = { VITE_SUPABASE_URL: "https://x.supabase.co/", VITE_SUPABASE_ANON_KEY: "anon", OPS_INGEST_TOKEN: "t".repeat(40) };
  const log = vi.fn();
  it("payloads carry the commit and validate", () => {
    const s = buildSnapshots(root, stamp);
    expect(s.backlog.commit).toBe(stamp.commit); expect(s.verification.committedAt).toBe(stamp.committedAt);
    expect(validateSnapshots(s)).toEqual([]);
    expect(validateSnapshots({ backlog: {}, verification: {} }).length).toBeGreaterThan(0);
  });
  it("request goes to the RPC with the token in the body only", () => {
    const r = buildIngestRequest({ url: "https://x.supabase.co/", anonKey: "k", token: "tok", snapshots: {} });
    expect(r.url).toBe("https://x.supabase.co/rest/v1/rpc/ops_ingest_snapshots");
    expect(r.url).not.toContain("tok"); expect(JSON.parse(r.init.body).p_token).toBe("tok");
  });
  it("dry run sends nothing", async () => {
    const f = vi.fn();
    const r = await runPush({ env, dryRun: true, fetchImpl: f, stamp, root, log });
    expect(r).toMatchObject({ code: 0, sent: false }); expect(f).not.toHaveBeenCalled();
  });
  it("missing token: loud warning, exit 0, nothing sent", async () => {
    const f = vi.fn(); const lines = [];
    const r = await runPush({ env: { ...env, OPS_INGEST_TOKEN: "" }, fetchImpl: f, stamp, root, log: (l) => lines.push(l) });
    expect(r).toMatchObject({ code: 0, skipped: true }); expect(f).not.toHaveBeenCalled();
    expect(lines.join("\n")).toMatch(/::warning.*OPS_INGEST_TOKEN/);
  });
  it("sends on success", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{"applied":["backlog"]}' });
    const r = await runPush({ env, fetchImpl: f, stamp, root, log });
    expect(r).toMatchObject({ code: 0, sent: true }); expect(f).toHaveBeenCalledOnce();
  });
  it("a refusal fails (exit 1) and never prints the token", async () => {
    const lines = [];
    const f = vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => "bad " + env.OPS_INGEST_TOKEN });
    const r = await runPush({ env, fetchImpl: f, stamp, root, log: (l) => lines.push(l) });
    expect(r.code).toBe(1); expect(lines.join("\n")).not.toContain(env.OPS_INGEST_TOKEN);
  });
  it("a network error fails", async () => {
    const r = await runPush({ env, fetchImpl: async () => { throw new Error("down"); }, stamp, root, log });
    expect(r.code).toBe(1);
  });
});

describe("workflow + SQL wiring", () => {
  const wf = readFileSync(".github/workflows/ops-digest.yml", "utf8");
  it("runs only after a SUCCESSFUL Build on a push to main, with the secret by reference, no schedule", () => {
    expect(wf).toMatch(/workflow_run:\n\s+workflows: \["Build"\]\n\s+types: \[completed\]\n\s+branches: \[main\]/);
    expect(wf).toMatch(/conclusion == 'success' && github\.event\.workflow_run\.event == 'push'/);
    expect(wf).toMatch(/OPS_INGEST_TOKEN: \$\{\{ secrets\.OPS_INGEST_TOKEN \}\}/);
    expect(wf).not.toMatch(/^\s*schedule:/m);
  });
  it("build.yml is untouched: still the single required `build` job", () => {
    expect(readFileSync(".github/workflows/build.yml", "utf8")).not.toMatch(/ops-digest/);
  });
  it("the CI gate dry-runs the push on every PR", () => {
    expect(readFileSync(".github/ci-gates.yml", "utf8")).toMatch(/ops-snapshot\.mjs --push --dry-run/);
  });
  it("the ingest door stores only a hash and is not admin-session based", () => {
    const sql = readFileSync("src/workspaces/admin/db/admin_ops_ingest.sql", "utf8");
    expect(sql).toMatch(/token_hash/); expect(sql).toMatch(/enable row level security/);
    expect(sql).toMatch(/length\(p_token\) < 32/);
  });
});

describe("sweep records itself (B2159507)", () => {
  it("normalises the sweep's payload", () => {
    expect(normalizeSweep({ archived: "12.7", stillOpen: [{ title: "A", waitingOn: "B" }, { title: "" }, "Plain"], note: "n" }))
      .toEqual({ archived: 12, stillOpen: [{ title: "A", waiting_on: "B" }, { title: "Plain", waiting_on: "" }], note: "n" });
    expect(normalizeSweep(null)).toEqual({ archived: 0, stillOpen: [], note: "" });
  });
  it("reports ok / the RPC error, never throws", async () => {
    expect(await recordSweepFromRun({ rpc: async () => ({ data: "id", error: null }) }, { archived: 1 })).toEqual({ ok: true, error: null });
    expect(await recordSweepFromRun({ rpc: async () => ({ data: null, error: { message: "not authorized" } }) }, {})).toEqual({ ok: false, error: "not authorized" });
    expect((await recordSweepFromRun(null, {})).ok).toBe(false);
  });
  it("hook installs on window and detaches", async () => {
    const win = {}; const off = installSweepHook(win, { rpc: vi.fn().mockResolvedValue({ data: "id", error: null }) });
    expect((await win.pfAdminRecordSweep({ archived: 2 })).ok).toBe(true);
    off(); expect(win.pfAdminRecordSweep).toBeUndefined();
  });
});

describe("harnesses that file reports clean up after themselves (B2159505)", () => {
  it("TEETH: flags a live harness that sends a slow tap with no cleanup, clears one that cleans up", () => {
    const bad = `import { openSignedIn } from "./lib/signedInSession.mjs";\nawait page.getByText("Something was slow just now").click();`;
    expect(missingReportCleanup(bad)).toMatch(/never calls cleanupReports/);
    expect(missingReportCleanup(bad + "\nawait cleanupReports(page);")).toBeNull();
    expect(missingReportCleanup(`await swallowReportWrites(ctx);\n` + bad)).toBeNull();
    expect(missingReportCleanup(`// unrelated harness\nawait page.goto("https://planyr.io")`)).toBeNull();
  });
  it("no ui-audit harness currently files a live report without cleanup", () => {
    const offenders = readdirSync("ui-audit").filter((f) => f.endsWith(".mjs")).filter((f) => missingReportCleanup(readFileSync(join("ui-audit", f), "utf8")));
    expect(offenders).toEqual([]);
  });
});
