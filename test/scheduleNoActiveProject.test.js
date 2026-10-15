/* B2285440 — signed in as the test account the Schedule showed "This view failed to load": the account
 * has ZERO live schedule rows (all soft-deleted) but a still-"authoritative" index row whose view flags
 * carry a stale aPid (911625), so the loaded document is { projects: {}, aPid: <dangling> } and ~8
 * render paths read `data.projects[data.aPid]` bare. These tests extract the REAL accessor + load
 * resolver from public/sequence/index.html (same pattern as schedulerViewState.test.js).
 * The browser half (the real render, red on main) is ui-audit/verify-schedule-no-active-project.mjs. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");
const block = SRC.slice(SRC.indexOf("const VIEW_TAB_KEYS"), SRC.indexOf("function App() {"));
const store = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
const mod = new Function("sessionStorage", "localStorage", `${block}\nreturn { pickActivePid, activeProjectOf, resolveViewState };`)(store(), store());

const TEST_ACCOUNT_DOC = { nPid: 970235, nTid: {}, settings: {}, projects: {}, aPid: 911625, view: "grid", section: "projects" };

describe("B2285440 — no active schedule never throws", () => {
  it("activeProjectOf is null (not a throw) for the test account's document shape", () => {
    expect(mod.activeProjectOf(TEST_ACCOUNT_DOC)).toBeNull();
    expect(mod.activeProjectOf({ ...TEST_ACCOUNT_DOC, aPid: null })).toBeNull();
    expect(mod.activeProjectOf(null)).toBeNull();
    expect(mod.activeProjectOf({ aPid: 1 })).toBeNull();
  });
  it("resolveViewState on an empty document yields aPid null, never the dangling id", () => {
    expect(mod.resolveViewState(TEST_ACCOUNT_DOC).aPid).toBeNull();
  });
  it("a dangling aPid with real schedules falls to the first real one; a valid one is kept", () => {
    const projects = { 2: { id: 2, name: "A", tasks: [] }, 3: { id: 3, name: "B", tasks: [] } };
    expect(mod.pickActivePid(projects, 911625)).toBe(2);
    expect(mod.pickActivePid(projects, 3)).toBe(3);
    expect(mod.pickActivePid({}, 3)).toBeNull();
    expect(mod.activeProjectOf({ projects, aPid: 3 }).name).toBe("B");
  });
});

describe("B2285440 — structure: no bare reads of the active project remain", () => {
  it("every reader goes through activeProjectOf", () => {
    expect(SRC).not.toMatch(/data\.projects\[data\.aPid\]/);
    expect(SRC).not.toMatch(/data\?\.projects\[data\?\.aPid\]/);
  });
  it("the App renders a visible empty state when there is no active schedule", () => {
    expect(SRC).toMatch(/if \(!proj\) return \(\s*<div data-schedule-empty/);
  });
});
