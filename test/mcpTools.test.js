/* MCP tool-registry tests (B671) — stubbed-fetch router pattern (see driveShare.test.js).
 * The one that matters most: the OWNER-SCOPING INVARIANT — every main-Supabase request
 * a tool makes must be a GET carrying user_id=eq.<owner>. */
import { describe, it, expect, vi, afterEach } from "vitest";
import { callTool, InvalidParams } from "../functions/api/mcp/_tools.js";

const ENV = { SUPABASE_URL: "https://main.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc-key", PLANYR_MCP_OWNER_ID: "OWNER-123" };

const SITES_LIGHT = [
  { id: "s1", group_id: "g1", site: "Goose Creek", name: "Pad A", county: "Harris", updated_at: "2026-07-01T00:00:00Z", status: "active", lat: "29.7", lon: "-95.3", sched_id: "3", sched_name: "Goose Creek" },
  { id: "s2", group_id: "g1", site: "Goose Creek", name: "Pad B", county: "Chambers", updated_at: "2026-06-01T00:00:00Z", status: "active", lat: null, lon: null, sched_id: null, sched_name: null },
  { id: "s3", group_id: null, site: "Grandport", name: "Grandport", county: "Harris", updated_at: "2026-05-01T00:00:00Z", status: "pursuit", lat: null, lon: null, sched_id: null, sched_name: null },
];
const SITE_FULL = { id: "s1", site: "Goose Creek", name: "Pad A", county: "Harris", updated_at: "2026-07-01T00:00:00Z", data: { status: "active", parcels: [{ points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] }], els: [{ type: "building", w: 50, h: 40 }] } };
const FACTS = [
  { id: "f1", project_id: "g1", needs_filing: false, state: "filed", category: "Drawings", discipline: "Civil", sheet_number: "C-2.01", sheet_title: "Detention Pond Plan", revision: "B", doc_date: "2026-06-20", source_file: "gc-civil.pdf" },
  { id: "f2", project_id: "g1", needs_filing: false, state: "superseded", category: "Drawings", discipline: "Civil", sheet_number: "C-2.01", sheet_title: "Detention Pond Plan", revision: "A", doc_date: "2026-05-20", source_file: "gc-civil-old.pdf" },
  { id: "f3", project_id: null, needs_filing: true, state: "needs_filing", category: null, discipline: null, sheet_number: null, sheet_title: "Mystery plat", revision: null, doc_date: null, source_file: "unknown.pdf" },
];
const SCHED = [{ value: { __rev: 4, projects: {
  3: { id: 3, name: "Goose Creek", tasks: [
    { id: 1, name: "Grading", start: "2026-05-01", end: "2026-06-01", duration: 31, health: "green", percentComplete: 100, parentId: null, predecessors: [] },
    { id: 2, name: "Utilities", start: "2026-06-02", end: "2026-06-25", duration: 23, health: "red", percentComplete: 40, parentId: 1, predecessors: [1] },
    { id: 3, name: "Paving", start: "2026-08-01", end: "2026-09-01", duration: 31, health: "gray", percentComplete: 0, parentId: null, predecessors: [{ id: 2, type: "FS", lag: 0 }] },
  ] },
  9: { id: 9, name: "Kilgore", tasks: [] },
} } }];

/** URL-substring router that also RECORDS every (url, method) for the invariant test. */
function makeFetch(overrides = {}) {
  const calls = [];
  const fn = vi.fn(async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET" });
    for (const [substr, resp] of Object.entries(overrides)) {
      if (String(url).includes(substr)) return resp();
    }
    const u = String(url);
    const ok = (body) => new Response(JSON.stringify(body), { status: 200 });
    if (u.includes("planar_data")) return ok(SCHED);
    if (u.includes("/rest/v1/sites")) {
      // NB: match ?id= / &id= / group_id= precisely — a bare "id=eq." also hits "user_id=eq."
      if (/[?&](group_)?id=eq\./.test(u)) return ok([SITE_FULL]);
      return ok(SITES_LIGHT);
    }
    if (u.includes("/rest/v1/file_facts")) return ok(FACTS.filter((f) => !u.includes("project_id=eq.g1") || f.project_id === "g1"));
    if (u.includes("/rest/v1/doc_reviews")) return ok([{ id: "r1", title: "Goose Creek Civil Set", kind: "stitch", project_id: "g1", discipline: "Civil", item: "Construction set", revision: "B", doc_date: "2026-06-20", updated_at: "2026-06-21T00:00:00Z" }]);
    if (u.includes("/rest/v1/drive_files")) return ok([{ planyr_key: "g1/civil.pdf", name: "gc-civil.pdf", updated_at: "2026-06-20T00:00:00Z" }]);
    return new Response("no route", { status: 500 });
  });
  fn.calls_ = calls;
  return fn;
}

const textOf = (r) => r.content[0].text;
const parse = (r) => JSON.parse(textOf(r));

afterEach(() => vi.unstubAllGlobals());

describe("list_projects", () => {
  it("groups sites into projects with drawing counts and scheduler-only projects", async () => {
    vi.stubGlobal("fetch", makeFetch());
    const out = parse(await callTool(ENV, { name: "list_projects", arguments: {} }));
    expect(out.projects).toHaveLength(2);
    const gc = out.projects.find((p) => p.id === "g1");
    expect(gc).toMatchObject({ name: "Goose Creek", status: "active", siteCount: 2, drawingCount: 1, schedule: { id: 3, name: "Goose Creek" } });
    expect(gc.counties.sort()).toEqual(["Chambers", "Harris"]);
    expect(out.projects.find((p) => p.id === "s3")).toMatchObject({ name: "Grandport", status: "pursuit", siteCount: 1 });
    expect(out.schedulerOnlyProjects).toEqual([{ scheduleId: 9, name: "Kilgore", taskCount: 0 }]);
    expect(out.unfiledDrawings).toBe(1);
  });

  it("surfaces a scheduler outage loudly instead of failing the whole tool", async () => {
    vi.stubGlobal("fetch", makeFetch({ planar_data: () => new Response("boom", { status: 500 }) }));
    const out = parse(await callTool(ENV, { name: "list_projects", arguments: {} }));
    expect(out.projects).toHaveLength(2);
    expect(out.scheduleBackendError).toMatch(/500/);
    expect(out.schedulerOnlyProjects).toBeNull();
  });
});

describe("get_project", () => {
  it("resolves by name fragment and returns site summaries + grouped drawings + schedule", async () => {
    vi.stubGlobal("fetch", makeFetch());
    const out = parse(await callTool(ENV, { name: "get_project", arguments: { project: "goose" } }));
    expect(out.id).toBe("g1");
    expect(out.sites[0].buildings.totalSqft).toBe(2000);
    const civil = out.drawings.Drawings.Civil;
    expect(civil).toHaveLength(2);
    expect(civil[0]).toMatchObject({ revision: "B", latest: true });
    expect(civil[1]).toMatchObject({ revision: "A", latest: false });
    expect(out.reviews).toHaveLength(1);
    expect(out.schedule.taskCount).toBe(3);
  });

  it("returns candidates when nothing matches", async () => {
    vi.stubGlobal("fetch", makeFetch());
    const out = parse(await callTool(ENV, { name: "get_project", arguments: { project: "zzz" } }));
    expect(out.error).toMatch(/No project matched/);
    expect(out.availableProjects.length).toBe(2);
  });
});

describe("get_site_layout / get_schedule", () => {
  it("summarizes one site by id", async () => {
    vi.stubGlobal("fetch", makeFetch());
    const out = parse(await callTool(ENV, { name: "get_site_layout", arguments: { site_id: "s1" } }));
    expect(out.siteId).toBe("s1");
    expect(out.parcels.siteSqft).toBe(10000);
  });

  it("summarizes a schedule with overdue/upcoming and tolerates both predecessor shapes", async () => {
    vi.stubGlobal("fetch", makeFetch());
    const out = parse(await callTool(ENV, { name: "get_schedule", arguments: { project: "goose" } }));
    expect(out).toMatchObject({ id: 3, name: "Goose Creek", taskCount: 3 });
    expect(out.span).toEqual({ start: "2026-05-01", end: "2026-09-01" });
    expect(out.healthTally).toEqual({ green: 1, red: 1, gray: 1 });
    expect(out.phases.map((t) => t.name)).toEqual(["Grading", "Paving"]);
    expect(out.overdue.map((t) => t.name)).toEqual(["Utilities"]); // end 2026-06-25 < today, 40% done
    expect(out.tasks[2].predecessorCount).toBe(1); // object-shaped predecessor counted fine
    expect(out.tasks[2].notes).toBeUndefined();
  });

  it("lists available schedules when the name misses", async () => {
    vi.stubGlobal("fetch", makeFetch());
    const out = parse(await callTool(ENV, { name: "get_schedule", arguments: { project: "nope" } }));
    expect(out.availableSchedules).toContainEqual({ id: 9, name: "Kilgore" });
  });
});

describe("search_project_files", () => {
  it("merges the three sources with project attribution and sanitizes the query", async () => {
    const fetchStub = makeFetch();
    vi.stubGlobal("fetch", fetchStub);
    const out = parse(await callTool(ENV, { name: "search_project_files", arguments: { query: "detention,(%*)" } }));
    expect(out.query).toBe("detention");
    const sources = new Set(out.results.map((r) => r.source));
    expect(sources).toEqual(new Set(["drawing_index", "review", "drive_file"]));
    expect(out.results.find((r) => r.source === "drawing_index" && r.projectId === "g1").projectName).toBe("Goose Creek");
    for (const c of fetchStub.calls_) expect(c.url).not.toMatch(/[(),]ilike|%2C\(/); // no raw grammar breakage from the query
  });

  it("rejects a query that is empty after sanitizing", async () => {
    vi.stubGlobal("fetch", makeFetch());
    await expect(callTool(ENV, { name: "search_project_files", arguments: { query: ",,((%%**))" } })).rejects.toBeInstanceOf(InvalidParams);
  });
});

describe("guardrails", () => {
  it("INVARIANT: every main-Supabase call is a GET and owner-scoped with user_id filter", async () => {
    const fetchStub = makeFetch();
    vi.stubGlobal("fetch", fetchStub);
    await callTool(ENV, { name: "list_projects", arguments: {} });
    await callTool(ENV, { name: "get_project", arguments: { project: "goose" } });
    await callTool(ENV, { name: "get_site_layout", arguments: { site_id: "s1" } });
    await callTool(ENV, { name: "get_schedule", arguments: { project: "goose" } });
    await callTool(ENV, { name: "search_project_files", arguments: { query: "plat" } });
    const mainCalls = fetchStub.calls_.filter((c) => c.url.startsWith(ENV.SUPABASE_URL));
    expect(mainCalls.length).toBeGreaterThan(5);
    for (const c of mainCalls) {
      expect(c.method).toBe("GET");
      expect(c.url).toContain("user_id=eq.OWNER-123");
    }
  });

  it("an upstream 500 becomes an isError result carrying the real message — never a throw", async () => {
    vi.stubGlobal("fetch", makeFetch({ "/rest/v1/sites": () => new Response("permission denied", { status: 500 }) }));
    const out = await callTool(ENV, { name: "list_projects", arguments: {} });
    expect(out.isError).toBe(true);
    expect(textOf(out)).toMatch(/sites query failed: 500/);
    expect(textOf(out)).toMatch(/permission denied/);
  });

  it("missing env secrets produce a clear 'not configured' isError result", async () => {
    vi.stubGlobal("fetch", makeFetch());
    const out = await callTool({ SUPABASE_URL: "https://main.supabase.co" }, { name: "list_projects", arguments: {} });
    expect(out.isError).toBe(true);
    expect(textOf(out)).toMatch(/not configured: set SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("unknown tool and missing required args are protocol errors (InvalidParams)", async () => {
    vi.stubGlobal("fetch", makeFetch());
    await expect(callTool(ENV, { name: "drop_tables", arguments: {} })).rejects.toBeInstanceOf(InvalidParams);
    await expect(callTool(ENV, { name: "get_project", arguments: {} })).rejects.toBeInstanceOf(InvalidParams);
  });
});
