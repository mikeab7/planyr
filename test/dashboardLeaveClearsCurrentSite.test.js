/* NEW-2 — Dashboard clears the URL but a cold boot silently resumes the project you just left.
 *
 * Owner's report: pressing Dashboard from inside a project goes to "weird places". His hypothesis
 * (that `userLeftProjectRef` is wrong) was partly wrong — that flag is required to keep the URL in
 * sync with the screen (see SitePlannerApp.jsx's NEW-5 header) and must NOT be removed.
 *
 * THE ACTUAL BUG: `leaveProject`/`goMap` never cleared the SEPARATE persisted `currentSite`
 * pointer (`localStorage["planarfit:currentSite:v1"]`, storage.js's `CURRENT_KEY`), and that
 * pointer is exactly what a fresh project-less cold boot resumes from via `bootActiveId` →
 * `pickResumeTarget`. So Dashboard correctly clears THIS TAB's URL, but a brand-new tab — or the
 * same tab reloaded on the bare domain — silently resumes the project just left and lands
 * straight in its heavy canvas.
 *
 * THE FIX: `leaveProject` and `goMap` also call `setCurrentSiteId(null)`.
 *
 * Four cases, proven against the REAL `pickResumeTarget` + the real `getCurrentSiteId`/
 * `setCurrentSiteId` (storage.js) — never a re-derived mock of either:
 *   1. BEFORE the fix (pointer left standing) — a stale pointer gets resumed. Proves the bug.
 *   2. AFTER the fix (pointer cleared, mirroring what leaveProject/goMap now do) — no resume.
 *   3. A real routed deep-link boot is completely unaffected by the pointer being cleared.
 *   4. A source guard that the real component functions actually call the fix.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { getCurrentSiteId, setCurrentSiteId } from "../src/workspaces/site-planner/lib/storage.js";
import { pickResumeTarget } from "../src/workspaces/site-planner/lib/bootResume.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function mockLocalStorage() {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    key: (i) => Object.keys(store)[i] ?? null,
    get length() { return Object.keys(store).length; },
  };
}

describe("NEW-2 — leaving a project must clear the persisted currentSite pointer too", () => {
  beforeEach(() => { mockLocalStorage(); });

  const plansOfGroup = () => [];       // no route project — a bare cold boot
  const hasSite = (id) => id === "left-project-plan"; // the plan a user just left still exists on disk

  it("BEFORE the fix (pointer left standing after a deliberate exit) — a cold boot silently resumes the just-left project", () => {
    // Simulate the project having been open (currentSite pointer set)...
    setCurrentSiteId("left-project-plan");
    // ...then a Dashboard press that does NOT clear the pointer (the pre-fix behaviour: only
    // the tab's own route/mode state changes, nothing touches localStorage).
    const stillStale = getCurrentSiteId();
    expect(stillStale).toBe("left-project-plan");
    // A fresh cold boot (new tab, or this tab reloaded on the bare domain) reads that pointer
    // straight into pickResumeTarget — and resumes it. This is the reported "weird places".
    const resumed = pickResumeTarget({ routeProjectId: null, currentId: stillStale, plansOfGroup, hasSite });
    expect(resumed).toBe("left-project-plan");
  });

  it("AFTER the fix (leaveProject/goMap clear the pointer) — a cold boot resumes nothing", () => {
    setCurrentSiteId("left-project-plan");
    // What the fixed leaveProject/goMap now do:
    setCurrentSiteId(null);
    const cleared = getCurrentSiteId();
    expect(cleared).toBe(null);
    const resumed = pickResumeTarget({ routeProjectId: null, currentId: cleared, plansOfGroup, hasSite });
    expect(resumed).toBe(null);
  });

  it("a real routed deep-link boot is completely unaffected by the pointer being cleared", () => {
    // #/project/<id>/site — the route names a project outright; pickResumeTarget resolves from
    // that project's OWN plans regardless of what currentId says, so clearing the pointer on a
    // prior exit changes nothing about opening a deep link into a different project later.
    const plansOfRoutedGroup = (gid) => (gid === "g1" ? [{ id: "g1-newest" }, { id: "g1-older" }] : []);
    setCurrentSiteId("left-project-plan");
    setCurrentSiteId(null); // the fix having already run on a prior Dashboard press
    const opened = pickResumeTarget({
      routeProjectId: "g1",
      currentId: getCurrentSiteId(),
      plansOfGroup: plansOfRoutedGroup,
      hasSite: () => false,
    });
    expect(opened).toBe("g1-newest"); // falls back to the routed project's newest plan, as before
  });

  it("SOURCE GUARD — leaveProject and goMap in SitePlannerApp.jsx actually call setCurrentSiteId(null)", () => {
    const src = readFileSync(
      fileURLToPath(new URL("../src/workspaces/site-planner/SitePlannerApp.jsx", import.meta.url)),
      "utf8",
    );
    const leaveAt = src.indexOf("const leaveProject = () => {");
    const goMapAt = src.indexOf("const goMap = () => {");
    expect(leaveAt, "leaveProject not found").toBeGreaterThan(-1);
    expect(goMapAt, "goMap not found").toBeGreaterThan(-1);
    const leaveLine = src.slice(leaveAt, src.indexOf("\n", leaveAt));
    const goMapLine = src.slice(goMapAt, src.indexOf("\n", goMapAt));
    expect(leaveLine).toMatch(/setCurrentSiteId\(null\)/);
    expect(goMapLine).toMatch(/setCurrentSiteId\(null\)/);
    // userLeftProjectRef must still be set — that flag is unrelated and load-bearing for the URL
    // writer (mayWriteRouteProject); the fix must not have removed it in the same edit.
    expect(leaveLine).toMatch(/userLeftProjectRef\.current = true/);
    expect(goMapLine).toMatch(/userLeftProjectRef\.current = true/);
  });

  it("MUTATION CHECK — a version of the two functions with the fix stripped out fails the source guard", () => {
    const src = readFileSync(
      fileURLToPath(new URL("../src/workspaces/site-planner/SitePlannerApp.jsx", import.meta.url)),
      "utf8",
    );
    const preFix = src
      .replace('const leaveProject = () => { userLeftProjectRef.current = true; setActiveSiteId(null); setCurrentSiteId(null); setMode("map"); };',
        'const leaveProject = () => { userLeftProjectRef.current = true; setActiveSiteId(null); setMode("map"); };')
      .replace('const goMap = () => { userLeftProjectRef.current = true; setCurrentSiteId(null); setMode("map"); };',
        'const goMap = () => { userLeftProjectRef.current = true; setMode("map"); };');
    expect(preFix).not.toBe(src); // the replace actually matched something, or this check is vacuous
    const leaveLine = preFix.slice(preFix.indexOf("const leaveProject = () => {"), preFix.indexOf("\n", preFix.indexOf("const leaveProject = () => {")));
    const goMapLine = preFix.slice(preFix.indexOf("const goMap = () => {"), preFix.indexOf("\n", preFix.indexOf("const goMap = () => {")));
    expect(leaveLine).not.toMatch(/setCurrentSiteId\(null\)/);
    expect(goMapLine).not.toMatch(/setCurrentSiteId\(null\)/);
  });
});
