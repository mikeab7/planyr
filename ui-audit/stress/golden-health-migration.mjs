// B# — golden test: proves the new configurable health-automation engine reproduces the OLD
// fixed 3-toggle cfRules EXACTLY for every task in the real production plan (Supabase `hs-v1`,
// snapshotted to a local JSON fixture — see fetchHsV1Snapshot in the PR description for how it
// was pulled). Requirement B ("defaults must reproduce today's behavior exactly") is a claim
// about REAL data, not synthetic fixtures — this script is that proof, and it's meant to be
// re-run any time a fresh snapshot is pulled, not just once.
//
// Usage: node ui-audit/stress/golden-health-migration.mjs [path-to-snapshot.json]
import { readFileSync, existsSync } from "node:fs";
import {
  computeDisplayHealth as NEW_computeDisplayHealth,
  buildHolidaySet, setHOLIDAY_SET, setNOW,
} from "./scheduler-engine.mjs";

const snapshotPath = process.argv[2] || new URL("../../.golden/hs-v1.json", import.meta.url).pathname;
if (!existsSync(snapshotPath)) {
  console.error(`No snapshot at ${snapshotPath}. Pass a path to a saved hs-v1 JSON export.`);
  process.exit(2);
}
const doc = JSON.parse(readFileSync(snapshotPath, "utf8"));

// ── OLD engine, verbatim from index.html before this change (the exact code this PR replaces) ──
const pd = s => new Date(s + "T12:00:00");
const fd = d => d.toISOString().slice(0,10);
let OLD_HOLIDAY_SET = new Set();
const OLD_addBD_difBD_MAX = 1_000_000;
const OLD_difBD = (a, b) => {
  const s = pd(a), e = pd(b);
  if (isNaN(s) || isNaN(e)) return 0;
  if (+s === +e) return 0;
  const dir = e > s ? 1 : -1;
  let count = 0, steps = OLD_addBD_difBD_MAX;
  const cur = new Date(s);
  while ((dir === 1 ? cur < e : cur > e) && steps-- > 0) { cur.setDate(cur.getDate() + dir); if (cur.getDay() !== 0 && cur.getDay() !== 6 && !OLD_HOLIDAY_SET.has(fd(cur))) count++; }
  return count * dir;
};
let OLD_NOW = "";
const OLD_computeDisplayHealth = (task, settings) => {
  const cf = settings?.cfRules || {};
  if (!task) return task?.health;
  if (cf.completeGreen && (task.percentComplete||0) >= 100) return "green";
  if (task.meetingBound && (task.percentComplete||0) < 100 && task.health !== "green" && task.health !== "paused") {
    if (task.meetingInfeasible) return "red";
    if (task.meetingDeadline && OLD_difBD(OLD_NOW, task.meetingDeadline) <= 2) return "yellow";
  }
  if (task.deadlineForTaskId != null && (task.percentComplete||0) < 100 && task.health !== "green" && task.health !== "paused") {
    if (task.deadlineInfeasible) return "red";
    if (task.end && OLD_difBD(OLD_NOW, task.end) >= 0 && OLD_difBD(OLD_NOW, task.end) <= 2) return "yellow";
  }
  if (cf.overdueRed && task.end && task.end < OLD_NOW && (task.percentComplete||0) < 100 && task.health !== "green" && task.health !== "paused" && task.health !== "red") return "red";
  if (cf.dueSoonYellow && task.end && task.end >= OLD_NOW && task.health === "gray") {
    const today = new Date(OLD_NOW + "T12:00:00");
    const end = new Date(task.end + "T12:00:00");
    const days = Math.ceil((end - today) / 86400000);
    if (days <= 7) return "yellow";
  }
  return task.health;
};

// ── Migration under test: the one-time normalizeToV9 seed, exactly as shipped in index.html ──
const migrateTask = t => t.healthOverride === undefined
  ? { ...t, healthOverride: t.health === "green" || t.health === "red" || t.health === "paused" }
  : t;

// ── Drive both engines over every project/task in the snapshot ──
const NOW = new Date().toISOString().slice(0, 10);
OLD_NOW = NOW;
setNOW(NOW);
const hset = buildHolidaySet(doc.settings?.holidays || {});
OLD_HOLIDAY_SET = hset;
setHOLIDAY_SET(hset);

let checked = 0, diffs = [];
for (const [projKey, proj] of Object.entries(doc.projects || {})) {
  const tasks = Array.isArray(proj.tasks) ? proj.tasks : [];
  const parentIds = new Set(tasks.filter(t => t.parentId != null).map(t => t.parentId));
  const migrated = tasks.map(migrateTask);
  const byId = {}; migrated.forEach(t => byId[t.id] = t);
  for (const t of migrated) {
    if (parentIds.has(t.id)) continue; // parents never run either engine — rolled health only
    checked++;
    const before = OLD_computeDisplayHealth(t, doc.settings);
    const after = NEW_computeDisplayHealth(t, doc.settings, byId);
    if (before !== after) {
      diffs.push({ project: proj.name || projKey, taskId: t.id, name: t.name, before, after,
        health: t.health, healthOverride: t.healthOverride, end: t.end, percentComplete: t.percentComplete });
    }
  }
}

console.log(`Checked ${checked} leaf tasks across ${Object.keys(doc.projects || {}).length} projects.`);
console.log(`Settings.cfRules: ${JSON.stringify(doc.settings?.cfRules)}`);
if (diffs.length) {
  console.log(`❌ ${diffs.length} DIFFERENCE(S) — defaults do NOT reproduce today's behavior exactly:`);
  console.log(JSON.stringify(diffs, null, 2));
  process.exit(1);
} else {
  console.log("✅ Zero differences — every leaf task's display health is byte-identical before/after.");
}
