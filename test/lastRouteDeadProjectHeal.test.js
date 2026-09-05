/* B1202176 (extended, 2026-09-05, owner-measured on production build 89b5c3f which already
 * contains merged #1454) — THE STICKY DEAD END.
 *
 * Owner repro: set `planyr:lastRoute:v1` to a project id that names no row at all
 * (`zzzznotarealid`) and load bare https://planyr.io/. The app seeds the URL from that pointer,
 * Shell.jsx's route gate confirms the id is "missing", and `DeletedProjectNotice` renders "This
 * project doesn't exist" with only a "Go to Dashboard" button. Two more facts, measured live:
 *   1. The notice does NOT touch `lastRoute` — it is untouched by rendering the blocked state at
 *      all — so every subsequent reload restores the SAME dead id and dead-ends again. Sticky
 *      until the user happens to click "Go to Dashboard".
 *   2. Clicking "Go to Dashboard" DOES recover: the hash goes to "#/" and `lastRoute` is
 *      rewritten to `projectId: null` (Shell.jsx's own `navigate` → `writeLastRoute(route)`
 *      effect, unchanged).
 *
 * The fix (Shell.jsx's gate-resolution effect): the MOMENT the gate confirms a project id is
 * genuinely "missing" (never merely "unknown" while the check is in flight, and never "deleted"
 * — a soft-deleted project still offers Restore, so it is deliberately NOT auto-healed here),
 * overwrite `lastRoute` with the neutral route itself — the same correction "Go to Dashboard"
 * already performs, just no longer gated on the user finding and clicking that button. This is
 * exactly what `lastRoute.js`'s own header already claims happens ("a dead id resolves to the
 * map/dashboard and the URL self-heals") — before this fix, that claim was only true for a
 * project the USER manually escaped, never one the gate itself refused.
 *
 * Proven against the REAL `writeLastRoute`/`readLastRoute`/`pickBootRoute` (src/app/lastRoute.js)
 * and the REAL `projectGateStatus` (src/shared/projects/projectModel.js) — never a re-derived
 * mock of either — plus a source guard (same shape as newProjectGateWiring.test.js) proving
 * Shell.jsx actually wires the one into the other, since standing up the full signed-in Supabase
 * + routed-project sequence to observe the effect firing is a live-verify concern this sandbox
 * cannot exercise (Blocker: auth).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeLastRoute, readLastRoute, pickBootRoute } from "../src/app/lastRoute.js";
import { projectGateStatus } from "../src/shared/projects/projectModel.js";

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

// The exact decision Shell.jsx's gate-resolution effect makes, replayed here so the CONSEQUENCE
// (a corrected lastRoute, and what a later boot then does with it) is proven against the real
// lastRoute.js functions rather than asserted about in the abstract.
function healLastRouteIfMissing(g) {
  if (g.status === "missing") writeLastRoute({ module: "site-planner", projectId: null, cross: false, org: false });
}

describe("B1202176 (extended) — a confirmed-missing project id no longer wedges lastRoute forever", () => {
  beforeEach(() => { mockLocalStorage(); });

  it("THE CORE REPRO: without the fix, a dead pointer keeps restoring itself on every boot", () => {
    writeLastRoute({ module: "site-planner", projectId: "zzzznotarealid", cross: false, org: false });
    const boot = pickBootRoute({ initialHashEmpty: true, stored: readLastRoute() });
    expect(boot.projectId).toBe("zzzznotarealid"); // the sticky dead end the owner measured
  });

  it("WITH THE FIX: the moment the gate confirms 'missing', the next boot no longer restores the dead id", () => {
    writeLastRoute({ module: "site-planner", projectId: "zzzznotarealid", cross: false, org: false });
    const g = projectGateStatus({ res: { ok: true, exists: false, deleted: false }, freshlyCreated: false });
    expect(g.status).toBe("missing");

    healLastRouteIfMissing(g);

    const healed = readLastRoute();
    expect(healed.projectId).toBe(null);
    const boot = pickBootRoute({ initialHashEmpty: true, stored: healed });
    expect(boot).toBe(null); // no project to restore — lands on the plain dashboard, not the dead id
  });

  it("a genuinely soft-deleted project's pointer is left ALONE — Restore is still a live option", () => {
    writeLastRoute({ module: "site-planner", projectId: "smtjb0lrexb3", cross: false, org: false });
    const g = projectGateStatus({
      res: { ok: true, exists: true, deleted: true, name: "Concept A", deletedAt: "2026-09-03T20:13:59+00:00" },
      freshlyCreated: false,
    });
    expect(g.status).toBe("deleted");

    healLastRouteIfMissing(g);

    // Untouched: the next boot correctly shows the SAME restore-offering notice again, rather
    // than one this tab silently threw away.
    const stillThere = readLastRoute();
    expect(stillThere.projectId).toBe("smtjb0lrexb3");
    const boot = pickBootRoute({ initialHashEmpty: true, stored: stillThere });
    expect(boot.projectId).toBe("smtjb0lrexb3");
  });

  it("a live (or freshly-minted) project's pointer is left alone too", () => {
    writeLastRoute({ module: "site-planner", projectId: "s1", cross: false, org: false });
    const g = projectGateStatus({ res: { ok: true, exists: true, deleted: false }, freshlyCreated: false });
    expect(g.status).toBe("live");
    healLastRouteIfMissing(g);
    expect(readLastRoute().projectId).toBe("s1");
  });

  it("an inconclusive (fail-open) answer never touches lastRoute either", () => {
    writeLastRoute({ module: "site-planner", projectId: "s1", cross: false, org: false });
    const g = projectGateStatus({ res: { ok: false }, freshlyCreated: false });
    expect(g.status).toBe("live"); // fail OPEN
    healLastRouteIfMissing(g);
    expect(readLastRoute().projectId).toBe("s1");
  });
});

describe("Shell.jsx wiring — the gate effect actually heals lastRoute on a confirmed-missing id", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const SHELL = readFileSync(join(here, "../src/app/Shell.jsx"), "utf8");

  it("calls writeLastRoute with the neutral route immediately after resolving 'missing', inside the gate effect", () => {
    const effectStart = SHELL.indexOf("checkProjectDeletionStatus(projectId).then((res) => {");
    const setGateIdx = SHELL.indexOf("setProjectGate({ id: projectId, ...g });", effectStart);
    const healIdx = SHELL.indexOf('if (g.status === "missing") writeLastRoute({ module: "site-planner", projectId: null, cross: false, org: false });', effectStart);
    expect(effectStart).toBeGreaterThan(-1);
    expect(setGateIdx).toBeGreaterThan(effectStart);
    expect(healIdx).toBeGreaterThan(setGateIdx); // heals AFTER the UI state is set, never before
  });

  it("never fires the heal for a 'deleted' status by construction (the guard names 'missing' only)", () => {
    // A source guard, not a behavioural one (that's the pure-logic suite above): pin the exact
    // condition so a future edit can't quietly widen it to 'deleted' or drop the check entirely.
    expect(SHELL.includes('if (g.status === "missing") writeLastRoute(')).toBe(true);
    expect(SHELL.includes('if (g.status === "deleted") writeLastRoute(')).toBe(false);
  });
});
