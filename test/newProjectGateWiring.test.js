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

/* B1202176 (amendment ×2, 2026-09-06) — `SitePlanner.jsx`'s `persistOrDrop` fires the moment a
 * workspace tab switch makes the Site Planner canvas inactive, and for a still-blank draft it
 * drops the site rather than saving it. Two shipped shapes, in order:
 *   (1) unconditional `deleteSite(id)` — tombstoned every drop, poisoning any LATER module's
 *       `ensureProjectRow` for the same id.
 *   (2) `deleteSite(id, { tombstone: !!stored })` gated on `!stored?.origin` — closed (1), but
 *       STILL deleted a project the instant a record existed with no origin, which is exactly what
 *       `ensureProjectRow` always writes. Reproduced independently on production TWICE (the owner,
 *       and a separate live measurement) on the SAME repro: New project → Notes → "+ New page"
 *       writes a real row (origin still null) → hard reload remounts Site Planner inactive on the
 *       Notes route → this effect re-fires, sees that now-real record, and (2)'s gate still called
 *       `deleteSite(id, {tombstone:true})` on it — a row written at 00:18:56 was soft-deleted at
 *       00:19:30, 34 seconds later, no delete action ever taken.
 * The fix is gating on `!stored` ALONE — a local record existing at all, however it got there,
 * means something considered this project worth keeping, and only an id that has NEVER been saved
 * anywhere on this device (which can therefore never carry an origin either) may be dropped. This
 * is the wiring proof that `persistOrDrop` makes exactly that check, in that order, and that
 * neither of the two superseded shapes is still reachable. */
describe("SitePlanner.jsx's persistOrDrop only drops an id that has NEVER had a local record", () => {
  it("reads the local record BEFORE deciding whether to drop it", () => {
    const fnStart = PLANNER.indexOf("const persistOrDrop = () => {");
    expect(fnStart).toBeGreaterThan(-1);
    const storedIdx = PLANNER.indexOf("const stored = loadSite(siteId);", fnStart);
    const blankCheckIdx = PLANNER.indexOf("if (isBlankSite(s) && !stored) {", fnStart);
    expect(storedIdx).toBeGreaterThan(fnStart);
    expect(blankCheckIdx).toBeGreaterThan(storedIdx);
  });

  it("passes tombstone: false to deleteSite, and neither superseded call shape is reachable", () => {
    const fnStart = PLANNER.indexOf("const persistOrDrop = () => {");
    const callIdx = PLANNER.indexOf("deleteSite(siteId, { tombstone: false });", fnStart);
    expect(callIdx).toBeGreaterThan(fnStart);
    // Neither the original unconditional call NOR the first amendment's `!stored?.origin` /
    // `!!stored` shape may still be reachable — otherwise a superseded fix could be dead code
    // sitting next to a still-broken one.
    const fnEnd = PLANNER.indexOf("\n  };", fnStart);
    const body = PLANNER.slice(fnStart, fnEnd);
    expect(body.includes("deleteSite(siteId);")).toBe(false);
    expect(body.includes("!stored?.origin")).toBe(false);
    expect(body.includes("tombstone: !!stored")).toBe(false);
  });
});
