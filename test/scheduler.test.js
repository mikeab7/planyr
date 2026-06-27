import { describe, it, expect } from "vitest";
import { schedulerConfig, schedulerConfigured } from "../server/scheduler/config.js";
import { buildModifyTaskRow, buildNewTaskRow } from "../server/scheduler/suggestions.js";
import { getSchedule, insertSuggestion } from "../server/scheduler/scheduleClient.js";
import { handleMcp, toolDefs, PROTOCOL_VERSION } from "../server/scheduler/mcpServer.js";

describe("schedulerConfig — env parsing, dormant by default", () => {
  it("is unconfigured with no env (honest, not open)", () => {
    const cfg = schedulerConfig({});
    expect(schedulerConfigured(cfg)).toBe(false);
    expect(cfg.scheduleKey).toBe("hs-v1");
    expect(cfg.connectorToken).toBeNull();
  });
  it("reads the scheduler Supabase + token from env (never a VITE_ var)", () => {
    const cfg = schedulerConfig({ SCHEDULER_SUPABASE_URL: "https://x.supabase.co", SCHEDULER_SUPABASE_ANON_KEY: "anon", SCHEDULER_CONNECTOR_TOKEN: "t" });
    expect(schedulerConfigured(cfg)).toBe(true);
    expect(cfg.connectorToken).toBe("t");
    expect(schedulerConfig({ VITE_SCHEDULER_SUPABASE_ANON_KEY: "leak" }).supabase.anonKey).toBeNull();
  });
});

describe("buildModifyTaskRow — pending, allow-listed, validated", () => {
  it("builds a pending modify_task row targeting the task", () => {
    const r = buildModifyTaskRow({ projectId: 3, taskId: 36, changes: { duration: 4, health: "yellow" }, note: "Permitting delay." });
    expect(r.ok).toBe(true);
    expect(r.row).toMatchObject({ status: "pending", kind: "modify_task", project_id: 3, task_path: [36], patch: { duration: 4, health: "yellow" }, note_text: "Permitting delay." });
  });
  it("rejects a field outside the allow-list (can't touch anything the Review panel won't apply)", () => {
    const r = buildModifyTaskRow({ projectId: 1, taskId: 2, changes: { name: "rename" } });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/can't be changed/i);
  });
  it("validates values (bad health, out-of-range percent, non-date end)", () => {
    expect(buildModifyTaskRow({ projectId: 1, taskId: 2, changes: { health: "blue" } }).ok).toBe(false);
    expect(buildModifyTaskRow({ projectId: 1, taskId: 2, changes: { percentComplete: 150 } }).ok).toBe(false);
    expect(buildModifyTaskRow({ projectId: 1, taskId: 2, changes: { end: "June 1" } }).ok).toBe(false);
    expect(buildModifyTaskRow({ projectId: 1, taskId: 2, changes: { end: "2026-06-01" } }).ok).toBe(true);
  });
  it("requires project_id, task_id, and at least one change", () => {
    expect(buildModifyTaskRow({ taskId: 2, changes: { duration: 1 } }).ok).toBe(false);
    expect(buildModifyTaskRow({ projectId: 1, changes: { duration: 1 } }).ok).toBe(false);
    expect(buildModifyTaskRow({ projectId: 1, taskId: 2, changes: {} }).ok).toBe(false);
  });
  it("carries add_predecessors into the patch and tolerates string ids", () => {
    const r = buildModifyTaskRow({ projectId: 1, taskId: "2", changes: {}, addPredecessors: [5, "Foundation"] });
    expect(r.ok).toBe(true);
    expect(r.row.task_path).toEqual([2]);
    expect(r.row.patch.add_predecessors).toEqual([5, "Foundation"]);
  });
  it("coerces numeric strings for duration/percent", () => {
    const r = buildModifyTaskRow({ projectId: "3", taskId: 4, changes: { duration: "4", percentComplete: "50" } });
    expect(r.ok).toBe(true);
    expect(r.row).toMatchObject({ project_id: 3, patch: { duration: 4, percentComplete: 50 } });
  });
});

describe("buildNewTaskRow — pending create_task", () => {
  it("requires a name", () => {
    expect(buildNewTaskRow({ projectId: 1, fields: {} }).ok).toBe(false);
  });
  it("builds a create_task with parent path + optional fields", () => {
    const r = buildNewTaskRow({ projectId: 2, parentTaskId: 10, fields: { name: "City review", duration: 15, health: "yellow" }, note: "Added per email." });
    expect(r.ok).toBe(true);
    expect(r.row).toMatchObject({ status: "pending", kind: "create_task", project_id: 2, task_path: [10], patch: { name: "City review", duration: 15, health: "yellow" }, note_text: "Added per email." });
  });
  it("allows a top-level task (no parent)", () => {
    const r = buildNewTaskRow({ projectId: 2, fields: { name: "Kickoff" } });
    expect(r.ok).toBe(true);
    expect(r.row.task_path).toEqual([]);
  });
  it("rejects a non-creatable field", () => {
    expect(buildNewTaskRow({ projectId: 2, fields: { name: "x", percentComplete: 10 } }).ok).toBe(false);
  });
});

const cfg = schedulerConfig({ SCHEDULER_SUPABASE_URL: "https://sched.supabase.co", SCHEDULER_SUPABASE_ANON_KEY: "anon", SCHEDULER_CONNECTOR_TOKEN: "t" });

describe("getSchedule — reads planar_data, compacts to the fields Claude needs", () => {
  const value = { __rev: 7, projects: { 3: { id: 3, name: "Goose Creek", tasks: [
    { id: 36, name: "Lot line exhibit", start: "2026-04-24", end: "2026-04-29", duration: 3, health: "green", percentComplete: 100, responsibleParty: "Michael", parentId: null, isExpanded: true, notes: [{ id: 1, text: "x" }] },
  ] } } };

  it("projects down to id/name/dates/health and drops noise like notes/isExpanded", async () => {
    const fetchImpl = async (url, opts) => {
      expect(url).toMatch(/planar_data\?key=eq\.hs-v1/);
      expect(opts.headers.apikey).toBe("anon");
      return { ok: true, json: async () => [{ value }] };
    };
    const r = await getSchedule(cfg, { fetchImpl });
    expect(r.ok).toBe(true);
    expect(r.schedule.projects).toHaveLength(1);
    const t = r.schedule.projects[0].tasks[0];
    expect(t).toEqual({ id: 36, name: "Lot line exhibit", start: "2026-04-24", end: "2026-04-29", duration: 3, health: "green", percentComplete: 100, responsibleParty: "Michael", parentId: null });
  });
  it("is unconfigured-safe", async () => {
    const r = await getSchedule(schedulerConfig({}), { fetchImpl: async () => ({ ok: true, json: async () => [] }) });
    expect(r.ok).toBe(false);
    expect(r.configured).toBe(false);
  });
  it("reports an empty schedule honestly", async () => {
    const r = await getSchedule(cfg, { fetchImpl: async () => ({ ok: true, json: async () => [] }) });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/No schedule/);
  });
  it("surfaces an HTTP error rather than a fake read", async () => {
    const r = await getSchedule(cfg, { fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }) });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/500/);
  });
});

describe("insertSuggestion — posts the row, maps RLS rejection to actionable guidance", () => {
  it("POSTs to planar_suggestions and returns the stored row", async () => {
    let sent;
    const fetchImpl = async (url, opts) => { sent = { url, body: JSON.parse(opts.body), method: opts.method }; return { ok: true, json: async () => [{ id: "uuid-1", ...JSON.parse(opts.body) }] }; };
    const r = await insertSuggestion(cfg, { status: "pending", kind: "modify_task", project_id: 3 }, { fetchImpl });
    expect(sent.method).toBe("POST");
    expect(sent.url).toMatch(/\/rest\/v1\/planar_suggestions$/);
    expect(r.ok).toBe(true);
    expect(r.suggestion.id).toBe("uuid-1");
  });
  it("maps a 401/403 to a run-the-SQL hint", async () => {
    const r = await insertSuggestion(cfg, { status: "pending" }, { fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ message: "RLS" }) }) });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/suggestions_rls\.sql/);
  });
});

describe("handleMcp — JSON-RPC surface (initialize, tools/list, tools/call, notifications)", () => {
  const okSchedule = { ok: true, schedule: { projects: [{ id: 3, name: "Goose Creek", tasks: [{ id: 36, name: "X" }] }] } };
  const deps = (over = {}) => ({ cfg, getSchedule: async () => okSchedule, insertSuggestion: async (_c, row) => ({ ok: true, suggestion: { id: "u1", ...row } }), fetchImpl: async () => ({}), ...over });

  it("initialize returns protocol version + tools capability", async () => {
    const { status, body } = await handleMcp({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, deps());
    expect(status).toBe(200);
    expect(body.result.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(body.result.capabilities.tools).toBeDefined();
    expect(body.result.serverInfo.name).toBe("planyr-scheduler");
  });
  it("tools/list returns the three tools with input schemas", async () => {
    const { body } = await handleMcp({ jsonrpc: "2.0", id: 2, method: "tools/list" }, deps());
    const names = body.result.tools.map((t) => t.name).sort();
    expect(names).toEqual(["get_schedule", "propose_new_task", "propose_task_change"]);
    expect(body.result.tools.every((t) => t.inputSchema && t.inputSchema.type === "object")).toBe(true);
  });
  it("tools/call get_schedule returns the schedule as text", async () => {
    const { body } = await handleMcp({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_schedule", arguments: {} } }, deps());
    expect(body.result.content[0].type).toBe("text");
    expect(body.result.content[0].text).toMatch(/Goose Creek/);
    expect(body.result.isError).toBeUndefined();
  });
  it("tools/call propose_task_change files a pending suggestion", async () => {
    let filed;
    const d = deps({ insertSuggestion: async (_c, row) => { filed = row; return { ok: true, suggestion: row }; } });
    const { body } = await handleMcp({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "propose_task_change", arguments: { project_id: 3, task_id: 36, duration: 4, note: "delay" } } }, d);
    expect(filed).toMatchObject({ status: "pending", kind: "modify_task", project_id: 3, task_path: [36], patch: { duration: 4 } });
    expect(body.result.content[0].text).toMatch(/Review panel/);
  });
  it("tools/call surfaces a build error as isError content, not a transport failure", async () => {
    const { body } = await handleMcp({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "propose_task_change", arguments: { project_id: 3, task_id: 36, health: "blue" } } }, deps());
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/health/);
  });
  it("tools/call propose_new_task files a create_task", async () => {
    let filed;
    const d = deps({ insertSuggestion: async (_c, row) => { filed = row; return { ok: true, suggestion: row }; } });
    await handleMcp({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "propose_new_task", arguments: { project_id: 3, name: "City review", parent_task_id: 36 } } }, d);
    expect(filed).toMatchObject({ kind: "create_task", project_id: 3, task_path: [36], patch: { name: "City review" } });
  });
  it("unknown tool → JSON-RPC error", async () => {
    const { body } = await handleMcp({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "nope" } }, deps());
    expect(body.error.code).toBe(-32602);
  });
  it("notifications/initialized → 202 with no body", async () => {
    const { status, body } = await handleMcp({ jsonrpc: "2.0", method: "notifications/initialized" }, deps());
    expect(status).toBe(202);
    expect(body).toBeNull();
  });
  it("unknown method with an id → method-not-found", async () => {
    const { body } = await handleMcp({ jsonrpc: "2.0", id: 8, method: "frobnicate" }, deps());
    expect(body.error.code).toBe(-32601);
  });
});

describe("toolDefs — proposal tools are explicit about being suggest-only", () => {
  it("describe themselves as Review-panel proposals, not direct edits", () => {
    const defs = toolDefs();
    const change = defs.find((t) => t.name === "propose_task_change");
    expect(change.description).toMatch(/does NOT edit|Review panel|Approve/i);
  });
});
