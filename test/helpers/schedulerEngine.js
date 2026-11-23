// The Schedule engine as the tests see it: every real export of src/shared/schedule/engine (the same code the
// page runs, via the generated public/sequence/page.js) plus a few small helpers that are NOT module-level
// in the page. Those helpers (below) are labelled copies of logic that lives inside React components and
// so can't be imported; they are exactly what ui-audit/stress/scheduler-engine.mjs used to carry for them.
import { computeDisplayHealth } from "../../src/shared/schedule/engine/health.js";
import { setHolidaySet } from "../../src/shared/schedule/engine/calendar.js";
import { normalizeToV6, normalizeToV7, ensureHolidays, normalizeIds, ensureContacts, normalizeMeetingCadence } from "../../src/shared/schedule/engine/normalize.js";
import { normalizeOwnerLists } from "../../src/shared/schedule/engine/owners.js";
import { cascadeDelta } from "../../src/shared/schedule/healthEngine.js";

export * from "../../src/shared/schedule/engine/index.js";

export const setHOLIDAY_SET = setHolidaySet;

// ── copies of in-component logic (page: flatTasks' rolledStatus, the grid's status-recolour callback) ──
export const leafFocusStatus = h => h === "green" ? "done" : h === "gray" ? "upcoming" : h === "paused" ? "paused" : "active";
export const rolledStatusLeaf = (task, settings) => leafFocusStatus(computeDisplayHealth(task, settings));
export const hideStatusOf = status => status === "active" ? null : status;
export const getDescIds = (id, all) => {
  const kids = all.filter(t => t.parentId === id);
  return [...kids.map(k => k.id), ...kids.flatMap(k => getDescIds(k.id, all))];
};
export const recolorBranch = (tasks, taskId, health) => {
  const descIds = new Set(getDescIds(taskId, tasks));
  if (descIds.size === 0) return tasks;
  return tasks.map(t => descIds.has(t.id) ? { ...t, health, ...cascadeDelta(t, health) } : t);
};
export const _legacySid = (pid, id) => `legacy:${pid}:${id}`;
// The load pipeline WITHOUT the v8 stamp / ownership step (what the stress tests have always composed).
export const loadPipeline = d => ensureContacts(normalizeOwnerLists(normalizeIds(ensureHolidays(normalizeToV7(normalizeToV6(normalizeMeetingCadence(d)))))));
// Status-colour maps as rebuildHEALTH computes them (the page mutates globals; this returns them).
const BASE_HEALTH = { gray:{label:"Not Started"}, yellow:{label:"In Progress"}, red:{label:"Needs Attn."}, green:{label:"Complete"}, paused:{label:"Paused"} };
const BASE_HK = ["gray","yellow","red","green","paused"];
const BASE_HDARK = {gray:"#6b7280",yellow:"#92400e",red:"#991b1b",green:"#166534",paused:"#4b5563"};
export const rebuildHealthMaps = (custom = [], labelOverrides = {}) => {
  const HEALTH = {...BASE_HEALTH}, HK = [...BASE_HK], HDARK = {...BASE_HDARK};
  if (labelOverrides && typeof labelOverrides === "object") {
    Object.entries(labelOverrides).forEach(([k, label]) => { if (HEALTH[k]) HEALTH[k] = {...HEALTH[k], label}; });
  }
  (Array.isArray(custom) ? custom : []).forEach(ch => {
    if (!ch || typeof ch !== "object" || ch.k == null) return;
    HEALTH[ch.k] = {label:ch.label, dot:ch.dot, border:"none", bar:ch.bar, ganttBar:ch.dot, ganttStyle:"solid"};
    HDARK[ch.k]  = ch.dark || ch.dot;
    if (!HK.includes(ch.k)) HK.push(ch.k);
  });
  return { HEALTH, HK, HDARK };
};
