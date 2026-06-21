// Round 3 — a different angle: the DATA LOAD / deserialization path. This is where
// untrusted data actually enters the app: a corrupt Supabase `data` jsonb row, a
// hand-edited <script id="planar-data"> block, or schema drift from an old build.
// index.html composes: ensureContacts(normalizeIds(ensureHolidays(normalizeToV6(d)))).
// A throw here means the schedule won't load (the catch re-runs normalizeToV6 on the
// seed, so a malformed seed hangs the app on its loader).
//
//   node ui-audit/stress/stress-scheduler3.mjs
//
import * as E from "./scheduler-engine.mjs";

const log = (s = "") => process.stdout.write(s + "\n");
const findings = [];
const probe = (label, fn) => {
  try { fn(); log(`  ok    ${label}`); return true; }
  catch (e) { findings.push({ label, detail: e.message }); log(`  CRASH ${label}\n          → ${e.message}`); return false; }
};

const goodTask = { id: 1, name: "T", start: "2026-06-22", end: "2026-06-22", duration: 1, predecessors: [], parentId: null };
const goodProj = (tasks) => ({ id: 1, name: "P", tasks });
const wrap = (projects, extra = {}) => ({ projects, ...extra });

log("\n=== full load pipeline on malformed top-level shapes ===");
probe("projects missing entirely", () => E.loadPipeline({}));
probe("projects = null", () => E.loadPipeline({ projects: null }));
probe("projects = array (not object)", () => E.loadPipeline({ projects: [goodProj([goodTask])] }));
probe("d = null", () => E.loadPipeline(null));
probe("d = {} with nothing", () => E.loadPipeline({}));

log("\n=== malformed project entries ===");
probe("a project is null", () => E.loadPipeline({ projects: { 1: null } }));
probe("a project is a string", () => E.loadPipeline({ projects: { 1: "oops" } }));
probe("project.tasks missing", () => E.loadPipeline({ projects: { 1: { id: 1, name: "P" } } }));
probe("project.tasks = null", () => E.loadPipeline({ projects: { 1: { id: 1, name: "P", tasks: null } } }));
probe("project.tasks = object (not array)", () => E.loadPipeline({ projects: { 1: { id: 1, name: "P", tasks: { 0: goodTask } } } }));
probe("project.tasks = number", () => E.loadPipeline({ projects: { 1: { id: 1, name: "P", tasks: 5 } } }));

log("\n=== malformed task entries ===");
probe("a task is null", () => E.loadPipeline(wrap({ 1: goodProj([null]) })));
probe("a task is a string", () => E.loadPipeline(wrap({ 1: goodProj(["x"]) })));
probe("task missing all fields ({} )", () => E.loadPipeline(wrap({ 1: goodProj([{}]) })));
probe("task.predecessors not array", () => E.loadPipeline(wrap({ 1: goodProj([{ ...goodTask, predecessors: "2FS" }]) })));
probe("task.parentId points nowhere", () => E.loadPipeline(wrap({ 1: goodProj([{ ...goodTask, parentId: 999 }]) })));
probe("parentId cycle (A↔B)", () => E.loadPipeline(wrap({ 1: goodProj([
  { ...goodTask, id: 1, parentId: 2 }, { ...goodTask, id: 2, parentId: 1 }]) })));
probe("duplicate task ids", () => E.loadPipeline(wrap({ 1: goodProj([
  { ...goodTask, id: 1 }, { ...goodTask, id: 1, name: "dup" }]) })));
probe("task.start malformed string", () => E.loadPipeline(wrap({ 1: goodProj([{ ...goodTask, start: "garbage", end: "garbage" }]) })));

log("\n=== malformed settings / contacts ===");
probe("settings.contacts has null name", () => E.loadPipeline(wrap({ 1: goodProj([goodTask]) }, { settings: { contacts: [{ id: 1, name: null }] } })));
probe("settings.holidays not object", () => E.loadPipeline(wrap({ 1: goodProj([goodTask]) }, { settings: { holidays: "nope" } })));
probe("task.responsibleParty is a number", () => E.loadPipeline(wrap({ 1: goodProj([{ ...goodTask, responsibleParty: 42 }]) })));

log("\n=== sanity: a well-formed doc loads cleanly ===");
probe("normal doc", () => E.loadPipeline(wrap({ 1: goodProj([goodTask, { ...goodTask, id: 2, parentId: 1 }]) })));

log("\n========================================================");
log(`Findings (${findings.length}):`);
for (const f of findings) log(`  [CRASH] ${f.label}\n          ${f.detail}`);
log("");
