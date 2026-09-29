import { readFileSync, writeFileSync } from "node:fs";
const html = readFileSync("public/sequence/index.html", "utf8");
const b = html.indexOf("/* @shared-engine:begin");
const e = html.indexOf("/* @shared-engine:end */");
const block = html.slice(b, e + "/* @shared-engine:end */".length);
const head = `// src/shared/schedule/healthEngine.js
//
// B1953795 (S2/S4/S5) — the Scheduler's task-health rule engine + the ONE "is it complete / what %"
// answer, as a real ES module the Dashboard can import. The embedded Scheduler
// (public/sequence/index.html, compiled in-browser, cannot import from src/) holds the SAME text
// between its \`@shared-engine:begin/end\` markers; test/scheduleHealthEngineParity.test.js fails if
// the two ever differ, so there is ONE definition kept in two places by a machine check, not two
// hand-maintained heuristics (the Dashboard's old "simplified independent heuristic" is retired).
//
// Everything between the markers below is copied VERBATIM from index.html. Edit index.html first,
// then re-copy (node scripts/sync-health-engine.mjs writes this file from it).
//
// WHAT THIS DOES NOT COVER (said loudly, not hidden): the meeting-bound / deadline-row risk blocks of
// the grid's computeDisplayHealth need business-day math + cascade-derived fields (meetingInfeasible,
// deadlineInfeasible) that live only in the embedded app, so \`displayHealth\` here is the rule engine
// + the completion answer + the stored-status fallback, i.e. exactly the grid's answer for every task
// that is not meeting-bound / a deadline row.

const pd = s => new Date(s + "T12:00:00");
const dif  = (a, b) => Math.round((pd(b) - pd(a)) / 86400000);
const ownerListOf = t => {
  const rp = t && t.responsibleParty;
  const raw = Array.isArray(rp) ? rp : (rp ? [rp] : []);
  const seen = new Set(); const out = [];
  raw.forEach(name => {
    const s = String(name == null ? "" : name).trim();
    if (!s) return;
    const k = s.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k); out.push(s);
  });
  return out;
};

`;
const tail = `

export {
  isCompleteTask, leafPercent, rolledPercentMap, effectivePercentComplete, completionDelta, cascadeDelta,
  RULE_FIELDS, RULE_FIELD_BY_K, RULE_OPS, evalFieldCondition, evalConditionGroup, evalRule,
  migrateRule, migrateCfRulesToHealthRules, DEFAULT_HEALTH_RULES, getHealthRules, evalHealthRules,
  opsForField, HEALTH_CONDITIONS, HEALTH_CONDITION_BY_KEY, evalHealthCondition, LEGACY_RULE_FIELD_MAP, RULE_COMPLETE_PAUSED_GUARD,
};

/** The grid's display health for a LEAF task (no meeting/deadline blocks — see header). \`now\` = "YYYY-MM-DD". */
export function displayHealth(task, settings, now, taskById) {
  if (!task) return undefined;
  const ruleResult = evalHealthRules(task, settings, now, taskById);
  if (ruleResult) return ruleResult;
  return isCompleteTask(task) ? "green" : task.health;
}
`;
writeFileSync("src/shared/schedule/healthEngine.js", head + block + tail);
console.log("wrote", block.length);
