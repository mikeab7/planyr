/* Minimal MCP server for the Scheduler connector (Streamable HTTP, tools-only).
 *
 * Implements just enough of the Model Context Protocol for Claude (claude.ai custom connector,
 * or Claude Desktop via `mcp-remote`) to: list tools, read the live schedule, and propose
 * changes. No SDK dependency — raw JSON-RPC, same "no framework, no bundle" spirit as
 * server/filing/server.js. The handler is pure (deps injected) so it unit-tests without a
 * network or a server.
 *
 *   handleMcp(message, { cfg, getSchedule, insertSuggestion, fetchImpl }) -> { status, body }
 *
 * Every tool result is text content; tool-level failures come back as isError content (the MCP
 * convention) rather than a transport error, so Claude can read and explain them.
 */
import { buildModifyTaskRow, buildNewTaskRow, MODIFY_PATCH_FIELDS, CREATE_PATCH_FIELDS, HEALTH_VALUES } from "./suggestions.js";

export const PROTOCOL_VERSION = "2025-06-18";

export function toolDefs() {
  return [
    {
      name: "get_schedule",
      description: "Read Michael's live construction schedule from Planyr's Scheduler. Returns every project and its tasks with their real ids, names, dates, durations, health (green/yellow/red/gray), percent complete, and owner. ALWAYS call this first so you reference real task ids before proposing any change.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "propose_task_change",
      description: "Propose a change to ONE existing task. This does NOT edit the schedule — it drops a pending suggestion into the Scheduler's Review panel for Michael to Approve or Dismiss. Use ids from get_schedule. Supply only the fields that should change.",
      inputSchema: {
        type: "object",
        required: ["project_id", "task_id"],
        properties: {
          project_id: { type: "number", description: "Project id (from get_schedule)." },
          task_id: { type: ["number", "string"], description: "Id of the task to change (from get_schedule)." },
          health: { type: "string", enum: HEALTH_VALUES, description: "New status color." },
          duration: { type: "number", description: "New duration in working days (the finish date recalculates)." },
          end: { type: "string", description: "New finish date, YYYY-MM-DD." },
          percentComplete: { type: "number", description: "0–100." },
          responsibleParty: { type: "string", description: "New owner / responsible party." },
          add_predecessors: { type: "array", items: { type: ["number", "string"] }, description: "Task ids (or names) to add as Finish-Start dependencies." },
          note: { type: "string", description: "Short reason, shown in the Review panel (e.g. why the date moved)." },
          email_subject: { type: "string", description: "Optional: subject of the email/message that prompted this." },
          email_date: { type: "string", description: "Optional: date of that message, YYYY-MM-DD." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "propose_new_task",
      description: "Propose adding a NEW task to a project. Drops a pending suggestion into the Review panel for Michael to Approve or Dismiss; it does not add the task directly. Use a project_id from get_schedule.",
      inputSchema: {
        type: "object",
        required: ["project_id", "name"],
        properties: {
          project_id: { type: "number", description: "Project id (from get_schedule)." },
          name: { type: "string", description: "Name of the new task." },
          parent_task_id: { type: ["number", "string"], description: "Optional: id of the task to nest this under." },
          start: { type: "string", description: "Optional start date, YYYY-MM-DD." },
          duration: { type: "number", description: "Optional duration in working days." },
          health: { type: "string", enum: HEALTH_VALUES, description: "Optional status color." },
          responsibleParty: { type: "string", description: "Optional owner." },
          note: { type: "string", description: "Short reason, shown in the Review panel." },
          email_subject: { type: "string" },
          email_date: { type: "string" },
        },
        additionalProperties: false,
      },
    },
  ];
}

const rpcResult = (id, result) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
const textContent = (text, isError = false) => ({ content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) });

async function callTool(name, args, deps) {
  const a = args || {};
  if (name === "get_schedule") {
    const r = await deps.getSchedule(deps.cfg, { fetchImpl: deps.fetchImpl });
    if (!r.ok) return textContent(`Couldn't read the schedule: ${r.error}`, true);
    return textContent(JSON.stringify(r.schedule, null, 2));
  }

  if (name === "propose_task_change") {
    const { project_id, task_id, add_predecessors, note, email_subject, email_date, ...rest } = a;
    const changes = {};
    for (const f of MODIFY_PATCH_FIELDS) if (rest[f] !== undefined) changes[f] = rest[f];
    const built = buildModifyTaskRow({ projectId: project_id, taskId: task_id, changes, addPredecessors: add_predecessors, note, emailSubject: email_subject, emailDate: email_date });
    if (!built.ok) return textContent(`Can't propose that: ${built.error}`, true);
    const ins = await deps.insertSuggestion(deps.cfg, built.row, { fetchImpl: deps.fetchImpl });
    if (!ins.ok) return textContent(`Couldn't file the suggestion: ${ins.error}`, true);
    return textContent("Proposed. It's now waiting in the Scheduler's Review panel for Michael to Approve or Dismiss — nothing changed in the live schedule yet.");
  }

  if (name === "propose_new_task") {
    const { project_id, parent_task_id, note, email_subject, email_date, ...rest } = a;
    const fields = {};
    for (const f of CREATE_PATCH_FIELDS) if (rest[f] !== undefined) fields[f] = rest[f];
    const built = buildNewTaskRow({ projectId: project_id, parentTaskId: parent_task_id, fields, note, emailSubject: email_subject, emailDate: email_date });
    if (!built.ok) return textContent(`Can't propose that: ${built.error}`, true);
    const ins = await deps.insertSuggestion(deps.cfg, built.row, { fetchImpl: deps.fetchImpl });
    if (!ins.ok) return textContent(`Couldn't file the suggestion: ${ins.error}`, true);
    return textContent("Proposed a new task. It's waiting in the Scheduler's Review panel for Michael to Approve or Dismiss.");
  }

  return null; // unknown tool → caller emits a proper JSON-RPC error
}

/* Handle one JSON-RPC message. Returns { status, body }. A notification (no id) → 202, no body. */
export async function handleMcp(message, deps) {
  if (!message || typeof message !== "object") return { status: 400, body: rpcError(null, -32700, "Parse error.") };
  const { id, method, params } = message;
  const isNotification = id === undefined || id === null;

  switch (method) {
    case "initialize":
      return { status: 200, body: rpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: (deps.cfg && deps.cfg.serverName) || "planyr-scheduler", version: "0.1.0" },
        instructions: "Tools to read Michael's construction schedule and propose changes. Proposals go to a Review panel for his one-click approval — they never edit the schedule directly. Call get_schedule before proposing so you use real task ids.",
      }) };

    case "notifications/initialized":
    case "notifications/cancelled":
      return { status: 202, body: null };

    case "ping":
      return { status: 200, body: rpcResult(id, {}) };

    case "tools/list":
      return { status: 200, body: rpcResult(id, { tools: toolDefs() }) };

    case "tools/call": {
      const name = params && params.name;
      const known = toolDefs().some((t) => t.name === name);
      if (!known) return { status: 200, body: rpcError(id, -32602, `Unknown tool "${name}".`) };
      const result = await callTool(name, params && params.arguments, deps);
      return { status: 200, body: rpcResult(id, result) };
    }

    default:
      if (isNotification) return { status: 202, body: null };
      return { status: 200, body: rpcError(id, -32601, `Method not found: ${method}`) };
  }
}
