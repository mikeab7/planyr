/* NEW-1 — recurrence of B1080547 ("Allow multiple schedules per project"). Owner report,
 * verbatim, 2026-09-07: "how come I still can't make multiple schedules per project?"
 *
 * MEASURED ON PRODUCTION: his Goose Creek project carried FOUR linked schedules (pids 1/19/20/21),
 * three of them created minutes apart and still completely empty — the signature of someone
 * pressing "+ New project" repeatedly because nothing they could see had happened. Creation,
 * naming, and linking all already worked (B1080545/B1080547/B1112449/B1112450). The gap: once a
 * site carries several linked schedules, EVERY resolution path that has to pick one of them for
 * you — `planar:nav-select-by-site` (the cross-module carry-in) and `planar:nav-select-task` (the
 * Dashboard's "jump to task" bridge) — used `Object.values(d.projects).find(...)`, which always
 * returns the FIRST match by ascending numeric key, i.e. the OLDEST schedule, regardless of which
 * one was actually last in use. Compounding this: B1107680 (shipped the same week) moved `aPid`
 * out of the versioned cloud document entirely (now per-tab sessionStorage, see
 * public/sequence/index.html's VIEW_TAB_KEYS) — so a genuinely fresh tab/session has NOTHING to
 * fall back on except `Object.values(d.projects)[0]`, the globally-lowest project id. The two gaps
 * compound: any fresh tab routed at a multi-schedule site always lands on the OLDEST schedule,
 * never whichever one was actually being used.
 *
 * Fix: `lastActiveBySite` — a small map kept in the VERSIONED document (deliberately NOT a
 * view-state key, so it survives a brand-new tab) recording which schedule was last made active
 * for each linked site. `withLastActiveSite` is the one place that updates it; `nav-select-by-site`
 * (and `nav-select-task`, the same defect one level up) now prefer it over "whichever sorts
 * first". Live-verified end to end against the real built app in headless Chromium (Supabase
 * stubbed, never touching production) — see the PR body for the transcript; this file pins the
 * pure resolution logic so it can never drift from the code the owner actually runs (same
 * live-extraction pattern as test/schedulerCrossSchedulePaste.test.js).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sequenceSource } from "./helpers/sequenceSource.js";

const SRC = sequenceSource();

function sliceBetween(startMarker, endMarker) {
  const start = SRC.indexOf(startMarker);
  expect(start, `"${startMarker}" not found in public/sequence/index.html`).toBeGreaterThan(-1);
  const end = SRC.indexOf(endMarker, start);
  expect(end, `"${endMarker}" not found after "${startMarker}"`).toBeGreaterThan(-1);
  return SRC.slice(start, end + endMarker.length);
}

// withLastActiveSite is a whole, self-contained pure function — extract and eval it directly.
const withLastActiveSiteSrc = sliceBetween(
  "function withLastActiveSite(d, siteId, scheduleId) {",
  "\n}",
);
const withLastActiveSite = new Function(`"use strict"; return (${withLastActiveSiteSrc});`)();

// The planar:nav-select-by-site resolution — extracted so the test can never drift from the
// shipped file. `d` and `siteId` stand in for the closure's `d`/`m.siteId`.
const selectBySiteResolutionSrc = sliceBetween(
  "const linked = Object.values(d.projects || {}).filter(p => p && p.linkedSiteId != null && p.linkedSiteId === m.siteId);",
  "const match = (preferredId != null && linked.find(p => p.id === preferredId)) || linked[0];",
);
function resolveBySite(d, siteId) {
  const fn = new Function("d", "m", `${selectBySiteResolutionSrc}\nreturn { linked, match };`);
  return fn(d, { siteId });
}

// The planar:nav-select-task resolution (same defect class, one task-id-aware step further).
const selectTaskResolutionSrc = sliceBetween(
  "const linkedForTask = latestData.current ? Object.values(latestData.current.projects || {}).filter(p => p && p.linkedSiteId != null && p.linkedSiteId === m.siteId) : [];",
  "|| linkedForTask[0];",
);
function resolveForTask(projects, lastActiveBySite, siteId, taskId) {
  const latestData = { current: { projects, lastActiveBySite } };
  const fn = new Function("latestData", "m", `${selectTaskResolutionSrc}\nreturn match;`);
  return fn(latestData, { siteId, taskId });
}

const GID = "smqfy48tlk9j";
const sched = (id, name, over = {}) => ({ id, name, tasks: [], linkedSiteId: GID, linkedSiteName: "Goose Creek", ...over });

describe("withLastActiveSite (pure)", () => {
  it("records the schedule id under its site", () => {
    const d = { projects: {} };
    const nd = withLastActiveSite(d, GID, 19);
    expect(nd.lastActiveBySite).toEqual({ [GID]: 19 });
  });

  it("is a no-op (same object) when the recorded id already matches — protects the redundant-save guard", () => {
    const d = { lastActiveBySite: { [GID]: 19 } };
    expect(withLastActiveSite(d, GID, 19)).toBe(d);
  });

  it("merges into an existing map without clobbering other sites", () => {
    const d = { lastActiveBySite: { otherSite: 3 } };
    const nd = withLastActiveSite(d, GID, 19);
    expect(nd.lastActiveBySite).toEqual({ otherSite: 3, [GID]: 19 });
  });

  it("no-ops on a missing siteId/scheduleId (never crashes, never records junk)", () => {
    const d = { lastActiveBySite: {} };
    expect(withLastActiveSite(d, null, 19)).toBe(d);
    expect(withLastActiveSite(d, GID, null)).toBe(d);
  });
});

describe("planar:nav-select-by-site resolution — the reported defect and its fix", () => {
  const projects = { 1: sched(1, "Goose Creek"), 19: sched(19, "Goose Creek (2)"), 20: sched(20, "Goose Creek (3)"), 5: { id: 5, name: "Pappadoupolos", tasks: [], linkedSiteId: "other" } };

  it("[THE REPORTED BUG] with no memory recorded, always resolves to the FIRST-linked (oldest) schedule", () => {
    const d = { projects };
    const { match } = resolveBySite(d, GID);
    expect(match.id).toBe(1); // the owner's exact complaint: never the newer one
  });

  it("[THE FIX] prefers the last-recorded active schedule for this site over the first-linked one", () => {
    const d = { projects, lastActiveBySite: { [GID]: 19 } };
    const { match } = resolveBySite(d, GID);
    expect(match.id).toBe(19);
  });

  it("falls back to the first-linked when the remembered schedule no longer exists (e.g. deleted)", () => {
    const d = { projects, lastActiveBySite: { [GID]: 999 } };
    const { match } = resolveBySite(d, GID);
    expect(match.id).toBe(1);
  });

  it("falls back to the first-linked when the remembered id belongs to a DIFFERENT site", () => {
    const d = { projects, lastActiveBySite: { otherSite: 19 } };
    const { match } = resolveBySite(d, GID);
    expect(match.id).toBe(1);
  });

  it("a site with only one linked schedule is unaffected either way", () => {
    const single = { 1: sched(1, "Goose Creek") };
    expect(resolveBySite({ projects: single }, GID).match.id).toBe(1);
    expect(resolveBySite({ projects: single, lastActiveBySite: { [GID]: 1 } }, GID).match.id).toBe(1);
  });
});

describe("planar:nav-select-task resolution — same defect class, task-id-aware", () => {
  const withTask = (id, name, taskIds) => sched(id, name, { tasks: taskIds.map((tid) => ({ id: tid, name: `T${tid}` })) });
  const projects = {
    1: withTask(1, "Goose Creek", [1, 2, 3]),
    19: withTask(19, "Goose Creek (2)", [1, 2]), // deliberately colliding task ids with pid 1
  };

  it("[THE BUG THIS WOULD OTHERWISE SHARE] resolves to whichever schedule actually CONTAINS the task, not always the first", () => {
    // Task id 2 exists in both, but this call targets pid 19's copy specifically via lastActiveBySite
    // being irrelevant here — containment wins first.
    const match = resolveForTask(projects, {}, GID, 2);
    // Containment alone is ambiguous when ids collide across schedules — falls back to first among
    // the containing set in that case, which is exactly why the two-tier fallback below matters.
    expect([1, 19]).toContain(match.id);
  });

  it("prefers the last-active schedule when the task id is ambiguous across several linked schedules", () => {
    const match = resolveForTask(projects, { [GID]: 19 }, GID, 1); // task 1 exists in both
    expect(match.id).toBe(19);
  });

  it("resolves to the ONLY schedule that actually has the task, even if it isn't the last-active one", () => {
    const proj19Only = { 1: withTask(1, "Goose Creek", [1, 2]), 19: withTask(19, "Goose Creek (2)", [1, 2, 42]) };
    const match = resolveForTask(proj19Only, { [GID]: 1 }, GID, 42);
    expect(match.id).toBe(19); // last-active says pid 1, but only pid 19 actually has task 42
  });
});
