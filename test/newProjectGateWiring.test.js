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
const PLANNER = readFileSync(join(here, "../src/workspaces/site-planner/SitePlanner.jsx"), "utf8");

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

  /* B1202176 (extended) — a restored `lastRoute` pointer to a project id that was minted LOCALLY
   * but never saved anywhere reads "missing" too, once the mint happened in an earlier tab/mount:
   * `locallyMintedGroupsRef` is in-memory only and does not survive the reload. Both mint sites
   * must ALSO write the cross-reload twin (`markProjectFreshlyMinted`, a small capped localStorage
   * list in projectModel.js), or this exact case regresses silently. */
  it("both mint sites also call the persisted, cross-reload-surviving twin", () => {
    expect(SP.includes('import { markProjectFreshlyMinted } from "../../shared/projects/projectModel.js";')).toBe(true);
    const newSiteStart = SP.indexOf("const newSiteFromMap = async (payload) => {");
    const newBlankStart = SP.indexOf("const newBlankSite = async (opts) => {");
    expect(newSiteStart).toBeGreaterThan(-1);
    expect(newBlankStart).toBeGreaterThan(-1);
    const persistIdxA = SP.indexOf("markProjectFreshlyMinted(id);", newSiteStart);
    const persistIdxB = SP.indexOf("markProjectFreshlyMinted(id);", newBlankStart);
    expect(persistIdxA).toBeGreaterThan(newSiteStart);
    expect(persistIdxA).toBeLessThan(SP.indexOf("saveSite(", newSiteStart));
    expect(persistIdxB).toBeGreaterThan(newBlankStart);
    expect(persistIdxB).toBeLessThan(SP.indexOf("if (o) {", newBlankStart));
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
    expect(SHELL.includes("import { checkProjectDeletionStatus, listDeletedProjects, restoreDeletedProject, projectGateStatus, wasProjectFreshlyMinted }")).toBe(true);
    expect(SHELL.includes("const freshlyCreated = freshProjectIdsRef.current.has(projectId) || wasProjectFreshlyMinted(projectId);")).toBe(true);
    expect(SHELL.includes("const g = projectGateStatus({ res, freshlyCreated });")).toBe(true);
    expect(SHELL.includes("setProjectGate({ id: projectId, ...g });")).toBe(true);
    // The old inline "!res.exists → missing" branch must be GONE from the gate effect, not merely
    // duplicated beside the new call — otherwise the fix could be dead code sitting next to the
    // still-broken original.
    expect(SHELL.includes('setProjectGate({ id: projectId, status: "missing", name: null, deletedAt: null }); return; }')).toBe(false);
  });

  /* B1202176 (extended, THE CORE REPRO OF THE RELOAD CASE) — the in-memory ref alone is exactly
   * the bug: it is scoped to ONE mount, so a genuinely fresh Shell mount (a bare-domain reload,
   * or a brand-new tab) always starts this ref empty regardless of what an earlier tab minted.
   * The gate must consult the persisted twin TOO, not only the ref — this is the wiring proof
   * that a future edit can't quietly drop the OR and still pass every other test here (the ref
   * alone would still make the SAME-SESSION tests above pass). */
  it("the freshlyCreated computation ORs the reload-surviving persisted check in, not the ref alone", () => {
    const idx = SHELL.indexOf("const freshlyCreated = freshProjectIdsRef.current.has(projectId) || wasProjectFreshlyMinted(projectId);");
    expect(idx).toBeGreaterThan(-1);
  });
});

/* B1202176 (amendment, 2026-09-05) — `SitePlanner.jsx`'s `persistOrDrop` fires the moment a
 * workspace tab switch makes the Site Planner canvas inactive, and for a still-blank, still-
 * unlocated draft (exactly what "New project" mints and leaves behind the instant you switch to
 * another workspace tab without drawing anything) it drops the site rather than saving it. Before
 * this fix it always called the general `deleteSite(id)`, which tombstones unconditionally — and a
 * project id that never had a local record has nothing for that tombstone to protect, so it only
 * ever poisoned `saveSite`'s own resurrection guard against a LATER module's `ensureProjectRow`
 * (proven end-to-end in `test/siteSoftDelete.test.js`'s B1202176-amendment describe block). The
 * fix is checking whether a local record already existed BEFORE deciding whether to tombstone —
 * this is the wiring proof that `persistOrDrop` actually makes that check and actually threads it
 * through, not merely that `deleteSite` supports the option somewhere unused. */
describe("SitePlanner.jsx's persistOrDrop only tombstones a drop that had a real local record to protect", () => {
  it("reads the local record BEFORE deciding whether to drop it", () => {
    const fnStart = PLANNER.indexOf("const persistOrDrop = () => {");
    expect(fnStart).toBeGreaterThan(-1);
    const storedIdx = PLANNER.indexOf("const stored = loadSite(siteId);", fnStart);
    const blankCheckIdx = PLANNER.indexOf("if (isBlankSite(s) && !stored?.origin) {", fnStart);
    expect(storedIdx).toBeGreaterThan(fnStart);
    expect(blankCheckIdx).toBeGreaterThan(storedIdx);
  });

  it("passes tombstone: !!stored to deleteSite, never an unconditional call", () => {
    const fnStart = PLANNER.indexOf("const persistOrDrop = () => {");
    const callIdx = PLANNER.indexOf("deleteSite(siteId, { tombstone: !!stored });", fnStart);
    expect(callIdx).toBeGreaterThan(fnStart);
    // The old unconditional call shape must be GONE from this function, not merely duplicated
    // beside the fix — otherwise the fix could be dead code sitting next to the still-broken original.
    const fnEnd = PLANNER.indexOf("\n  };", fnStart);
    const body = PLANNER.slice(fnStart, fnEnd);
    expect(body.includes("deleteSite(siteId);")).toBe(false);
  });
});
