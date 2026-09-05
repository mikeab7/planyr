/* B1202176 — WIRING guard for the "New project creates nothing and dead-ends on 'This project
 * doesn't exist'" fix. `deletedProjectGate.test.js`'s `projectGateStatus` suite proves the pure
 * decision is correct; this file proves the two places that FEED it (SitePlannerApp.jsx marking
 * an id as locally-minted, Shell.jsx recording and consulting that flag) are actually wired
 * together, so a future edit can't silently stop calling `projectGateStatus` with the real flag
 * and pass this repo's other tests anyway.
 *
 * A SOURCE guard (same shape as routeMissingCloudRetry.test.js / handleLayerOrder.test.js):
 * standing up the full signed-in Supabase + "New project" click sequence is a live-verify concern
 * (this sandbox can't sign in — Blocker: auth), but the WIRING itself — that the fresh-creation
 * signal is captured at both mint sites and actually reaches the gate — is a real, checkable
 * property of the source, and it is exactly what a "does the card render" test would miss: that
 * test passes whether or not the gate ever gets told a project is brand new.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SP = readFileSync(join(here, "../src/workspaces/site-planner/SitePlannerApp.jsx"), "utf8");
const SHELL = readFileSync(join(here, "../src/app/Shell.jsx"), "utf8");

describe("SitePlannerApp.jsx marks every freshly-minted project id before it can reach the URL", () => {
  it("declares the tracking ref", () => {
    expect(SP.includes("const locallyMintedGroupsRef = useRef(new Set());")).toBe(true);
  });

  it("newSiteFromMap marks its id BEFORE saveSite/pushLoud/goPlan run", () => {
    const fnStart = SP.indexOf("const newSiteFromMap = async (payload) => {");
    const markIdx = SP.indexOf("locallyMintedGroupsRef.current.add(id);", fnStart);
    const saveIdx = SP.indexOf("saveSite(", fnStart);
    const goPlanIdx = SP.indexOf("goPlan(id);", fnStart);
    expect(fnStart).toBeGreaterThan(-1);
    expect(markIdx).toBeGreaterThan(fnStart);
    expect(markIdx).toBeLessThan(saveIdx);
    expect(markIdx).toBeLessThan(goPlanIdx);
  });

  it("newBlankSite marks its id BEFORE branching on whether an origin was given", () => {
    // The whole point of this fix: the NO-ORIGIN branch never calls saveSite at all (documented
    // above it as deliberate — "a blank site that's never edited should never be saved"), so the
    // mark must happen unconditionally, ahead of the `if (o) {` split, not inside either branch.
    const fnStart = SP.indexOf("const newBlankSite = async (opts) => {");
    const markIdx = SP.indexOf("locallyMintedGroupsRef.current.add(id);", fnStart);
    const branchIdx = SP.indexOf("if (o) {", fnStart);
    expect(fnStart).toBeGreaterThan(-1);
    expect(markIdx).toBeGreaterThan(fnStart);
    expect(markIdx).toBeLessThan(branchIdx);
  });

  it("the URL-sync effect reports freshlyCreated straight off that same ref", () => {
    expect(SP.includes('onProjectChange?.(effGroup, { freshlyCreated: locallyMintedGroupsRef.current.has(effGroup) });')).toBe(true);
  });
});

describe("Shell.jsx records the fresh-creation signal and folds it into the gate's verdict", () => {
  it("declares the session-lifetime tracking ref", () => {
    expect(SHELL.includes("const freshProjectIdsRef = useRef(new Set());")).toBe(true);
  });

  it("onProjectChange adds the id to that ref ONLY when SitePlannerApp reported it as fresh", () => {
    const idx = SHELL.indexOf("onProjectChange={(gid, meta) => {");
    expect(idx).toBeGreaterThan(-1);
    const body = SHELL.slice(idx, SHELL.indexOf("navigate({ projectId: gid || null", idx));
    expect(body.includes("if (gid && meta && meta.freshlyCreated) freshProjectIdsRef.current.add(gid);")).toBe(true);
  });

  it("the deletion-check response is resolved through projectGateStatus, not decided inline", () => {
    expect(SHELL.includes("import { checkProjectDeletionStatus, listDeletedProjects, restoreDeletedProject, projectGateStatus }")).toBe(true);
    expect(SHELL.includes("const g = projectGateStatus({ res, freshlyCreated: freshProjectIdsRef.current.has(projectId) });")).toBe(true);
    expect(SHELL.includes("setProjectGate({ id: projectId, ...g });")).toBe(true);
    // The old inline "!res.exists → missing" branch must be GONE from the gate effect, not merely
    // duplicated beside the new call — otherwise the fix could be dead code sitting next to the
    // still-broken original.
    expect(SHELL.includes('setProjectGate({ id: projectId, status: "missing", name: null, deletedAt: null }); return; }')).toBe(false);
  });
});
