/* Planyr MCP — tool registry + data access (B671).
 *
 * Five read-only tools that give an LLM cross-project context: list_projects,
 * get_project, get_site_layout, get_schedule, search_project_files. Results are
 * pretty-printed JSON inside a text content block (MCP tools/call shape).
 *
 * ── SECURITY INVARIANT (read-only MCP) ──────────────────────────────────────
 * `pgGet` below is the ONLY function that touches the main Supabase project.
 * It issues GETs exclusively — nothing in this module can write — and it appends
 * the `user_id=eq.<PLANYR_MCP_OWNER_ID>` filter ITSELF, so no tool can forget
 * owner scoping. The service-role key lives only in the Cloudflare Pages env
 * (context.env), never in the browser bundle. Do not add a second query path.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * B408 consolidation (2026-07-11): the scheduler's planar_* tables now live in the SAME
 * (main) Supabase project as everything else — the old dedicated project is retired.
 * These constants keep using the ANON key on purpose (read path is anon-readable, same
 * as the shipped scheduler HTML, so baking it here as a fallback leaks nothing).
 * PLANYR_SEQ_URL / PLANYR_SEQ_ANON_KEY env vars still override for future rotation.
 */
import { summarizeSite } from "./_metrics.js";

const SEQ_URL = "https://lyeqzkuiwngunutlkkmi.supabase.co";
const SEQ_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx5ZXF6a3Vpd25ndW51dGxra21pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzNjc0NjMsImV4cCI6MjA5Njk0MzQ2M30.1jyFWeEPWDR4-YYu5azWbWQN8P48cgyZCBqfOwrAnlk";
const SEQ_KEY = "hs-v1"; // the one planar_data row the scheduler reads/writes

/** JSON-RPC "invalid params" — the transport surfaces this as -32602, not a tool error. */
export class InvalidParams extends Error {
  constructor(message) { super(message); this.rpcCode = -32602; }
}

function requireEnv(env, names) {
  for (const n of names) {
    if (!env || !env[n]) throw new Error(`not configured: set ${n} in the Cloudflare Pages environment`);
  }
}

/* THE single main-Supabase access point — GET-only, always owner-scoped (see header). */
async function pgGet(env, table, params) {
  requireEnv(env, ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "PLANYR_MCP_OWNER_ID"]);
  const qs = new URLSearchParams(params);
  qs.append("user_id", `eq.${env.PLANYR_MCP_OWNER_ID}`);
  const r = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/${table}?${qs}`, {
    method: "GET",
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
  });
  if (!r.ok) throw new Error(`Supabase ${table} query failed: ${r.status} ${await r.text().catch(() => "")}`);
  return r.json();
}

/* Scheduler backend read (second Supabase project) → { <pid>: {id,name,tasks:[...]} }. */
async function fetchScheduleData(env) {
  const url = (env && env.PLANYR_SEQ_URL) || SEQ_URL;
  const key = (env && env.PLANYR_SEQ_ANON_KEY) || SEQ_ANON;
  const r = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/planar_data?key=eq.${SEQ_KEY}&select=value`, {
    method: "GET",
    headers: { apikey: key, authorization: `Bearer ${key}` },
  });
  if (!r.ok) throw new Error(`Scheduler backend query failed: ${r.status} ${await r.text().catch(() => "")}`);
  const rows = await r.json();
  return (rows && rows[0] && rows[0].value && rows[0].value.projects) || {};
}

/* Light sites listing — JSON-extracted columns only, never the full data blob. */
const SITES_LIGHT_SELECT =
  "id,group_id,site,name,county,updated_at," +
  "status:data->>status,lat:data->origin->>lat,lon:data->origin->>lon," +
  "sched_id:data->>scheduleProjectId,sched_name:data->>scheduleProjectName";

const fetchSitesLight = (env) => pgGet(env, "sites", [["select", SITES_LIGHT_SELECT]]);

/* Group site rows into projects by group_id (a groupless site is its own project).
 * Semantics mirror src/shared/projects: name/status come from the newest row. */
function groupSitesIntoProjects(rows) {
  const byGroup = new Map();
  for (const row of rows || []) {
    const gid = row.group_id || row.id;
    if (!byGroup.has(gid)) byGroup.set(gid, []);
    byGroup.get(gid).push(row);
  }
  const projects = [];
  for (const [gid, members] of byGroup) {
    members.sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
    const newest = members[0];
    const withSched = members.find((m) => m.sched_id != null);
    const withOrigin = members.find((m) => m.lat != null && m.lon != null);
    projects.push({
      id: gid,
      name: newest.site || newest.name || gid,
      status: newest.status || null,
      counties: [...new Set(members.map((m) => m.county).filter(Boolean))],
      siteCount: members.length,
      origin: withOrigin ? { lat: Number(withOrigin.lat), lon: Number(withOrigin.lon) } : null,
      schedule: withSched ? { id: Number(withSched.sched_id), name: withSched.sched_name || null } : null,
      updatedAt: newest.updated_at || null,
      sites: members,
    });
  }
  projects.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  return projects;
}

/* Resolve one project from an id / exact name / case-insensitive substring.
 * Returns { project } or { candidates } when ambiguous / not found. */
function resolveProject(projects, wanted) {
  const q = String(wanted || "").trim().toLowerCase();
  const exact = projects.filter((p) => p.id.toLowerCase() === q || String(p.name).toLowerCase() === q);
  if (exact.length === 1) return { project: exact[0] };
  const partial = projects.filter((p) => String(p.name).toLowerCase().includes(q));
  if (partial.length === 1) return { project: partial[0] };
  const pool = exact.length ? exact : partial;
  return {
    candidates: (pool.length ? pool : projects).map((p) => ({ id: p.id, name: p.name, status: p.status })),
    matched: pool.length,
  };
}

/* ── Schedule summarization ─────────────────────────────────────────────── */

const isDone = (t) => Number(t?.percentComplete) >= 100;

function summarizeScheduleProject(proj, todayIso) {
  const tasks = Array.isArray(proj?.tasks) ? proj.tasks.filter((t) => t && typeof t === "object") : [];
  const healthTally = {};
  let minStart = null, maxEnd = null;
  for (const t of tasks) {
    const h = t.health || "gray";
    healthTally[h] = (healthTally[h] || 0) + 1;
    if (t.start && (!minStart || t.start < minStart)) minStart = t.start;
    if (t.end && (!maxEnd || t.end > maxEnd)) maxEnd = t.end;
  }
  const trim = (t) => ({
    id: t.id, name: t.name || null, start: t.start || null, end: t.end || null,
    durationDays: Number.isFinite(Number(t.duration)) ? Number(t.duration) : null,
    health: t.health || null, percentComplete: Number(t.percentComplete) || 0,
    parentId: t.parentId ?? null,
    predecessorCount: Array.isArray(t.predecessors) ? t.predecessors.length : 0,
  });
  return {
    id: proj.id ?? null,
    name: proj.name ?? null,
    taskCount: tasks.length,
    span: { start: minStart, end: maxEnd },
    healthTally,
    phases: tasks.filter((t) => t.parentId == null).map(trim),
    overdue: tasks.filter((t) => !isDone(t) && t.end && t.end < todayIso).map(trim),
    upcoming: tasks.filter((t) => !isDone(t) && t.start && t.start >= todayIso)
      .sort((a, b) => String(a.start).localeCompare(String(b.start))).slice(0, 10).map(trim),
    tasks: tasks.map(trim),
  };
}

function resolveScheduleProject(projects, wanted) {
  const q = String(wanted ?? "").trim().toLowerCase();
  const list = Object.values(projects || {});
  return list.find((p) => String(p?.id) === q) ||
    list.find((p) => String(p?.name || "").toLowerCase() === q) ||
    list.find((p) => String(p?.name || "").toLowerCase().includes(q)) || null;
}

/* ── file_facts helpers ─────────────────────────────────────────────────── */

const FACT_SELECT = "id,review_id,category,discipline,item,sheet_number,sheet_title,revision,doc_date,source_file,match_confidence,needs_filing,state,updated_at";

/* Group drawing-index rows category → discipline; flag the newest row per sheet_number.
 * Rows must arrive doc_date-descending (the query orders them). */
function groupFacts(rows) {
  const grouped = {};
  const newestBySheet = new Set();
  for (const f of rows || []) {
    const sheetKey = f.sheet_number || f.id;
    const isLatest = !newestBySheet.has(sheetKey);
    newestBySheet.add(sheetKey);
    const cat = f.category || "Uncategorized";
    const disc = f.discipline || "General";
    grouped[cat] = grouped[cat] || {};
    grouped[cat][disc] = grouped[cat][disc] || [];
    grouped[cat][disc].push({
      sheetNumber: f.sheet_number || null, sheetTitle: f.sheet_title || null,
      item: f.item || null, revision: f.revision || null, docDate: f.doc_date || null,
      sourceFile: f.source_file || null, state: f.state || null,
      latest: isLatest && f.state !== "superseded",
    });
  }
  return grouped;
}

/* PostgREST `or=(a.ilike.*q*,...)` grammar breaks on , ( ) % * — strip them. */
const sanitizeQuery = (q) => String(q || "").replace(/[,()%*]/g, " ").replace(/\s+/g, " ").trim();

/* ── The tool registry ──────────────────────────────────────────────────── */

export const TOOLS = [
  {
    name: "list_projects",
    description:
      "List ALL of the owner's Planyr projects (industrial real-estate deals) in one call: id, name, deal status (pursuit/active/onhold/complete/dead), counties, number of site plans, map origin (lat/lon), drawing counts from the document library, linked construction schedule, and last-updated time. Also lists scheduler-only projects that have no site plan yet. Start here.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async handler(env) {
      const [siteRows, factRows] = await Promise.all([
        fetchSitesLight(env),
        pgGet(env, "file_facts", [["select", "project_id,needs_filing,state"]]),
      ]);
      const projects = groupSitesIntoProjects(siteRows);
      let scheduleProjects = null, scheduleBackendError = null;
      try { scheduleProjects = await fetchScheduleData(env); }
      catch (e) { scheduleBackendError = e?.message || String(e); }

      const out = projects.map((p) => {
        const facts = (factRows || []).filter((f) => f.project_id === p.id);
        return {
          id: p.id, name: p.name, status: p.status, counties: p.counties,
          siteCount: p.siteCount, origin: p.origin,
          drawingCount: facts.filter((f) => f.state !== "superseded").length,
          needsFilingCount: facts.filter((f) => f.needs_filing || f.state === "needs_filing").length,
          schedule: p.schedule, updatedAt: p.updatedAt,
        };
      });
      const linkedIds = new Set(out.map((p) => p.schedule?.id).filter((v) => v != null));
      const schedulerOnlyProjects = scheduleProjects
        ? Object.values(scheduleProjects)
            .filter((sp) => sp && !linkedIds.has(Number(sp.id)))
            .map((sp) => ({ scheduleId: sp.id ?? null, name: sp.name ?? null, taskCount: Array.isArray(sp.tasks) ? sp.tasks.length : 0 }))
        : null;
      return {
        projects: out,
        schedulerOnlyProjects,
        ...(scheduleBackendError ? { scheduleBackendError } : {}),
        unfiledDrawings: (factRows || []).filter((f) => !f.project_id).length,
      };
    },
  },
  {
    name: "get_project",
    description:
      "Everything about ONE Planyr project by id or name (case-insensitive substring works, e.g. 'goose'): each site plan summarized (acreage, buildings + footprint SF, lot coverage, parking/pond/paving inventory), the drawing library grouped by category and discipline with the latest revision flagged, the document-review list, and the linked construction schedule summary. If the name is ambiguous, returns the candidate list instead.",
    inputSchema: {
      type: "object",
      properties: { project: { type: "string", description: "Project id, exact name, or name fragment" } },
      required: ["project"],
    },
    async handler(env, args) {
      const projects = groupSitesIntoProjects(await fetchSitesLight(env));
      const res = resolveProject(projects, args.project);
      if (!res.project) {
        return res.matched === 0
          ? { error: `No project matched "${args.project}".`, availableProjects: res.candidates }
          : { error: `"${args.project}" is ambiguous.`, candidates: res.candidates };
      }
      const p = res.project;
      const [fullRows, factRows, reviewRows] = await Promise.all([
        pgGet(env, "sites", [["select", "id,site,name,county,updated_at,data"], ["group_id", `eq.${p.id}`]]),
        pgGet(env, "file_facts", [["select", FACT_SELECT], ["project_id", `eq.${p.id}`], ["order", "doc_date.desc.nullslast"]]),
        pgGet(env, "doc_reviews", [["select", "id,title,kind,discipline,item,revision,doc_date,updated_at"], ["project_id", `eq.${p.id}`], ["order", "updated_at.desc"]]),
      ]);
      // A groupless site (project id = site id) has no group_id to match on.
      const rows = fullRows.length ? fullRows : await pgGet(env, "sites", [["select", "id,site,name,county,updated_at,data"], ["id", `eq.${p.id}`]]);

      let schedule = null, scheduleBackendError = null;
      if (p.schedule) {
        try {
          const sp = resolveScheduleProject(await fetchScheduleData(env), p.schedule.id);
          if (sp) schedule = summarizeScheduleProject(sp, new Date().toISOString().slice(0, 10));
        } catch (e) { scheduleBackendError = e?.message || String(e); }
      }
      return {
        id: p.id, name: p.name, status: p.status, counties: p.counties, updatedAt: p.updatedAt,
        sites: rows.map((r) => ({ siteId: r.id, updatedAt: r.updated_at, ...summarizeSite(r.data) })),
        drawings: groupFacts(factRows),
        drawingCount: factRows.length,
        reviews: reviewRows,
        schedule,
        ...(scheduleBackendError ? { scheduleBackendError } : {}),
      };
    },
  },
  {
    name: "get_site_layout",
    description:
      "Detailed layout summary of ONE site plan by its site id (from list_projects/get_project): acreage, full building inventory with dimensions and footprint SF, lot coverage, parking/trailer/pond/paving areas, element tallies, map origin. Numbers are footprint/area math from saved geometry; stall counts and detention volumes are intentionally not estimated.",
    inputSchema: {
      type: "object",
      properties: { site_id: { type: "string", description: "The site id (sites.id)" } },
      required: ["site_id"],
    },
    async handler(env, args) {
      const rows = await pgGet(env, "sites", [["select", "id,updated_at,data"], ["id", `eq.${args.site_id}`]]);
      if (!rows.length) return { error: `No site with id "${args.site_id}". Use list_projects / get_project to find site ids.` };
      return { siteId: rows[0].id, updatedAt: rows[0].updated_at, ...summarizeSite(rows[0].data) };
    },
  },
  {
    name: "get_schedule",
    description:
      "Construction schedule for one project from the Planyr scheduler, by schedule project id or name (substring works): task count, date span, health tally (green/yellow/red/gray), top-level phases, overdue tasks, the next 10 upcoming tasks, and the full trimmed task list with dates, duration, health, and percent complete.",
    inputSchema: {
      type: "object",
      properties: { project: { type: "string", description: "Schedule project id or name fragment" } },
      required: ["project"],
    },
    async handler(env, args) {
      const projects = await fetchScheduleData(env);
      const sp = resolveScheduleProject(projects, args.project);
      if (!sp) {
        return {
          error: `No schedule project matched "${args.project}".`,
          availableSchedules: Object.values(projects).map((x) => ({ id: x?.id ?? null, name: x?.name ?? null })),
        };
      }
      return summarizeScheduleProject(sp, new Date().toISOString().slice(0, 10));
    },
  },
  {
    name: "search_project_files",
    description:
      "Search ALL projects' files at once by keyword: the drawing index (sheet titles, sheet numbers, file names, item types), document reviews, and stored Drive file names. Returns matches with project attribution so cross-project lookups need no project switching.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keyword or phrase, e.g. 'detention', 'C-2.01', 'plat'" },
        limit: { type: "number", description: "Max results per source (default 40)" },
      },
      required: ["query"],
    },
    async handler(env, args) {
      const q = sanitizeQuery(args.query);
      if (!q) throw new InvalidParams("query is empty after removing PostgREST-reserved characters , ( ) % *");
      const limit = String(Math.min(Math.max(Number(args.limit) || 40, 1), 200));
      const like = `*${q}*`;
      const [facts, reviews, driveFiles, siteRows] = await Promise.all([
        pgGet(env, "file_facts", [
          ["select", FACT_SELECT],
          ["or", `(sheet_title.ilike.${like},source_file.ilike.${like},item.ilike.${like},sheet_number.ilike.${like})`],
          ["limit", limit],
        ]),
        pgGet(env, "doc_reviews", [
          ["select", "id,title,kind,project_id,discipline,item,revision,doc_date,updated_at"],
          ["title", `ilike.${like}`], ["limit", limit],
        ]),
        pgGet(env, "drive_files", [["select", "planyr_key,name,updated_at"], ["name", `ilike.${like}`], ["limit", limit]]),
        fetchSitesLight(env),
      ]);
      const nameOf = new Map(groupSitesIntoProjects(siteRows).map((p) => [p.id, p.name]));
      const proj = (pid) => (pid ? { projectId: pid, projectName: nameOf.get(pid) || null } : { projectId: null, projectName: null });
      return {
        query: q,
        results: [
          ...facts.map((f) => ({ source: "drawing_index", ...proj(f.project_id), sheetNumber: f.sheet_number, sheetTitle: f.sheet_title, item: f.item, revision: f.revision, docDate: f.doc_date, sourceFile: f.source_file, state: f.state })),
          ...reviews.map((r) => ({ source: "review", ...proj(r.project_id), title: r.title, kind: r.kind, discipline: r.discipline, item: r.item, revision: r.revision, docDate: r.doc_date, updatedAt: r.updated_at })),
          ...driveFiles.map((d) => ({ source: "drive_file", key: d.planyr_key, name: d.name, updatedAt: d.updated_at })),
        ],
      };
    },
  },
];

/** Run one tools/call. Unknown tool / bad args → InvalidParams (protocol -32602);
 *  a failing tool → { isError: true } result carrying the REAL upstream message
 *  (LOUD-FAILURE: never a silent empty result, never a masked 500). */
export async function callTool(env, params) {
  const tool = TOOLS.find((t) => t.name === params?.name);
  if (!tool) throw new InvalidParams(`unknown tool: ${params?.name}`);
  const args = params?.arguments || {};
  for (const k of tool.inputSchema.required || []) {
    if (args[k] == null || args[k] === "") throw new InvalidParams(`missing required argument: ${k}`);
  }
  try {
    const payload = await tool.handler(env, args);
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
  } catch (e) {
    if (e instanceof InvalidParams) throw e;
    return { content: [{ type: "text", text: `Error: ${e?.message || String(e)}` }], isError: true };
  }
}
