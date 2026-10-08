/* NEW-1 (SCHED-EMPTY-ON-SLOW-LOAD, 2026-10-06) — an UNLOADED schedule list is never an EMPTY one.
 * Pure rules (navState.js) + a source guard that the iframe's write path and shell gate stay wired. */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import {
  scheduleListState, parseLoadState, shouldShowLinkPanel, SCHEDULE_SLOW_MS, SCHEDULE_FAIL_MS,
} from "../src/workspaces/scheduler/lib/navState.js";

describe("scheduleListState — loading → slow → failed, loaded wins", () => {
  it("is loading right after boot, slow past the slow mark, failed past the fail mark", () => {
    expect(scheduleListState({ waitedMs: 0 })).toBe("loading");
    expect(scheduleListState({ waitedMs: SCHEDULE_SLOW_MS - 1 })).toBe("loading");
    expect(scheduleListState({ waitedMs: SCHEDULE_SLOW_MS })).toBe("slow");
    expect(scheduleListState({ waitedMs: SCHEDULE_FAIL_MS })).toBe("failed");
  });
  it("an embed-reported failure is failed immediately", () => {
    expect(scheduleListState({ reportedFailure: true, waitedMs: 10 })).toBe("failed");
  });
  it("a loaded list is loaded however long it took (a late success wins)", () => {
    expect(scheduleListState({ listLoaded: true, waitedMs: 10 * SCHEDULE_FAIL_MS, reportedFailure: true })).toBe("loaded");
  });
});

describe("only a LOADED list may claim 'No schedule' / offer Create", () => {
  const base = { ready: true, projectId: "g1", linkedSchedule: null, routedSiteName: "Goose Creek" };
  it("unloaded → no empty state, whatever the other inputs say", () => {
    expect(shouldShowLinkPanel({ ...base, listLoaded: false })).toBe(false);
    expect(shouldShowLinkPanel(base)).toBe(false); // the default is the safe one
  });
  it("loaded and genuinely zero → the empty state (Create) still shows", () => {
    expect(shouldShowLinkPanel({ ...base, listLoaded: true })).toBe(true);
  });
});

describe("parseLoadState", () => {
  it("accepts only the embed's own loading/failed reports", () => {
    expect(parseLoadState({ source: "planar-seq", type: "planar:load-state", state: "failed" })).toBe("failed");
    expect(parseLoadState({ source: "planar-seq", type: "planar:load-state", state: "loading" })).toBe("loading");
    expect(parseLoadState({ source: "planar-seq", type: "planar:load-state", state: "ok" })).toBe(null);
    expect(parseLoadState({ source: "other", type: "planar:load-state", state: "failed" })).toBe(null);
    expect(parseLoadState(null)).toBe(null);
  });
});

describe("source guards (the write path is refused while unread/failed)", () => {
  const html = fs.readFileSync(new URL("../public/sequence/index.html", import.meta.url), "utf8");
  it("_rawSet refuses an hs-v1 write unless the document was read", () => {
    const i = html.indexOf("_rawSet: async (k, v, opts = {}) => {");
    expect(i).toBeGreaterThan(0);
    const head = html.slice(i, i + 1600);
    expect(head).toMatch(/__planarHs1Read === "pending"/);
    expect(head).toMatch(/__planarHs1Read === "error"/);
    expect(head).toMatch(/return null;/);
  });
  it("a failed read in the shell keeps data null (no SEED fallback) and retries", () => {
    expect(html).toMatch(/postLoadState\("failed"\)/);
    expect(html).toMatch(/\}, \[loadTick\]\);/);
  });
  it("the shell never renders the empty state from an unloaded list", () => {
    const sch = fs.readFileSync(new URL("../src/workspaces/scheduler/Scheduler.jsx", import.meta.url), "utf8");
    expect(sch).toMatch(/shouldShowLinkPanel\(\{[^}]*listLoaded/);
  });
});
