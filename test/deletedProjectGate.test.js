import { describe, it, expect, beforeEach, vi } from "vitest";

/* NEW-2 (B848832, owner report 2026-09-04) — "a soft-deleted project stays fully open and
 * writable, and its breadcrumb degrades to the placeholder word Project."
 *
 * The route-level fix (Shell.jsx swapping in DeletedProjectNotice instead of mounting the
 * workspace) can only be proven live, signed in, against a real soft-deleted row — this sandbox
 * cannot sign in to Supabase (Blocker: auth), and confirming it needs the exact owner-reported
 * project, not a synthetic one (Blocker: real-data). Both are filed as V### live-verify steps.
 *
 * What IS fully provable here, headless and Node-only: the single-row deletion check the whole
 * gate is built on (`cloudCheckDeleted`) answers every shape of row correctly, and the
 * `checkProjectDeletionStatus` wrapper Shell.jsx actually calls fails OPEN whenever the answer
 * is inconclusive (signed out, a thrown error, a pre-migration DB) — the property STANDING RULE
 * demands: never block a route on an absence of information, only on a proven fact.
 *
 * Mock the supabase client (same pattern as test/cloudListIdIntegrity.test.js) so this runs with
 * no network/config. Hoisted holder — a vi.mock factory can't close over a normal top-level var.
 */
const h = vi.hoisted(() => ({ row: null, error: null }));
vi.mock("../src/workspaces/site-planner/lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: h.row, error: h.error }),
        }),
      }),
      // ensureSiteRow's cloud push (cloudUpsert → casUpsert) INSERTs a brand-new row — the
      // mock records it and makes it visible to the SAME select().eq().maybeSingle() chain
      // above, so a later checkProjectDeletionStatus() call for the same id sees it, exactly
      // as a real reload's fresh gate check would against the real database.
      insert: (v) => ({
        select: async () => {
          h.row = { id: v.id, group_id: v.group_id ?? null, site: v.site ?? null, name: v.name ?? null, deleted_at: null };
          return { data: [{ version: 1 }], error: null };
        },
      }),
    }),
  },
  supabaseRest: () => ({ url: "", anon: "" }),
  currentAccessToken: () => null,
}));
vi.mock("../src/shared/telemetry/clientErrors.js", () => ({ reportClientEvent: () => {} }));
// Isolate ensureSiteRow's team-sharing lookup — it's a real network round trip (profiles +
// teams) unrelated to this file's question. Private (teamId: null) is a safe, inert default.
vi.mock("../src/workspaces/site-planner/lib/newProjectSharing.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, defaultShareTeam: async () => ({ teamId: null, reason: "test", teamName: null }) };
});

import { cloudCheckDeleted } from "../src/workspaces/site-planner/lib/cloudSync.js";
import { checkProjectDeletionStatus, setActiveUser, ensureSiteRow } from "../src/workspaces/site-planner/lib/storage.js";
import { projectGateStatus } from "../src/shared/projects/projectModel.js";

describe("cloudCheckDeleted — the one question a routed project id must answer before a workspace mounts", () => {
  beforeEach(() => { h.row = null; h.error = null; });

  it("no signed-in uid → inconclusive, never a positive answer either way", async () => {
    const res = await cloudCheckDeleted(null, "s1");
    expect(res.ok).toBe(false);
    expect(res.deleted).toBe(false);
  });

  it("a row that doesn't exist for this user at all reads MISSING, not deleted", async () => {
    h.row = null;
    const res = await cloudCheckDeleted("u1", "nonexistent");
    expect(res.ok).toBe(true);
    expect(res.exists).toBe(false);
    expect(res.deleted).toBe(false);
  });

  it("a live row (deleted_at null) reads live", async () => {
    h.row = { id: "s1", group_id: "g1", site: "Concept A", name: null, deleted_at: null };
    const res = await cloudCheckDeleted("u1", "s1");
    expect(res.ok).toBe(true);
    expect(res.exists).toBe(true);
    expect(res.deleted).toBe(false);
  });

  it("THE CORE REPRO: a soft-deleted row (deleted_at set) reads deleted, with restore-ready facts", async () => {
    h.row = { id: "smtjb0lrexb3", group_id: "g1", site: "Concept A", name: null, deleted_at: "2026-09-03T20:13:59+00:00" };
    const res = await cloudCheckDeleted("u1", "smtjb0lrexb3");
    expect(res.ok).toBe(true);
    expect(res.exists).toBe(true);
    expect(res.deleted).toBe(true);
    expect(res.name).toBe("Concept A");
    expect(res.deletedAt).toBe("2026-09-03T20:13:59+00:00");
    expect(res.groupId).toBe("g1");
  });

  it("a genuine fetch error is inconclusive (fail OPEN — never blocks a route on a maybe)", async () => {
    h.error = { message: "network down" };
    const res = await cloudCheckDeleted("u1", "s1");
    expect(res.ok).toBe(false);
  });

  it("a pre-migration DB (no deleted_at column) reads live — nothing can be soft-deleted there", async () => {
    h.error = { message: 'column "deleted_at" does not exist', code: "42703" };
    const res = await cloudCheckDeleted("u1", "s1");
    expect(res.ok).toBe(true);
    expect(res.exists).toBe(true);
    expect(res.deleted).toBe(false);
  });
});

describe("checkProjectDeletionStatus — the Shell.jsx route gate's own entry point", () => {
  beforeEach(() => { h.row = null; h.error = null; setActiveUser(null); });

  it("signed out → fails open (no soft-delete concept for a local-only project)", async () => {
    const res = await checkProjectDeletionStatus("s1");
    expect(res.ok).toBe(false);
  });

  it("signed in, delegates straight through to the real check", async () => {
    setActiveUser("u1");
    h.row = { id: "s1", group_id: "g1", site: "Live One", deleted_at: null };
    const res = await checkProjectDeletionStatus("s1");
    expect(res.ok).toBe(true);
    expect(res.deleted).toBe(false);
    setActiveUser(null);
  });
});

/* B1202176 (owner chat, 2026-09-05, "NEW-1") — "New project creates nothing and dead-ends on
 * 'This project doesn't exist'." Reproduced 3-for-3 by the owner against real ids: clicking
 * "New project" routes to a brand-new, never-saved project id, and Shell.jsx's own deletion gate
 * (B848833) — proven correct above for a REAL bad link — cannot tell that apart from one, because
 * project creation is deliberately LAZY (a blank site is never saved until something is drawn in
 * it; even a located blank's cloud write is a fire-and-forget push). Both answer the identical
 * `checkProjectDeletionStatus` shape: `{ok:true, exists:false, deleted:false}`.
 *
 * `projectGateStatus` is the one place Shell.jsx now resolves that shape into a UI status, folding
 * in `freshlyCreated` — whether THIS id is one the Site Planner minted locally this session (see
 * SitePlannerApp.jsx's `locallyMintedGroupsRef` and Shell.jsx's `freshProjectIdsRef`). These are
 * the exact two cases the backlog item's own regression-test instruction names: a newly created
 * project must resolve LIVE, and a genuinely soft-deleted (or genuinely nonexistent, unrelated)
 * project must still be caught — proven together so neither guard can be satisfied by breaking
 * the other. */
describe("projectGateStatus — B1202176: a lazily-created project must not read as a bad deep link", () => {
  it("THE CORE REPRO: a project this session just created (no cloud row yet) resolves LIVE, not missing", () => {
    const res = { ok: true, exists: false, deleted: false };
    const g = projectGateStatus({ res, freshlyCreated: true });
    expect(g.status).toBe("live");
  });

  it("the SAME 'no row' answer for an id we did NOT mint still reads missing (a real bad/expired link)", () => {
    const res = { ok: true, exists: false, deleted: false };
    const g = projectGateStatus({ res, freshlyCreated: false });
    expect(g.status).toBe("missing");
  });

  it("freshlyCreated defaults to false when the caller omits it (never accidentally permissive)", () => {
    const res = { ok: true, exists: false, deleted: false };
    expect(projectGateStatus({ res }).status).toBe("missing");
  });

  it("a genuinely soft-deleted project is STILL caught even if (impossibly) flagged freshlyCreated — exists wins", () => {
    const res = { ok: true, exists: true, deleted: true, name: "Concept A", deletedAt: "2026-09-03T20:13:59+00:00" };
    const g = projectGateStatus({ res, freshlyCreated: true });
    expect(g.status).toBe("deleted");
    expect(g.name).toBe("Concept A");
    expect(g.deletedAt).toBe("2026-09-03T20:13:59+00:00");
  });

  it("a live, pre-existing project is unaffected by the freshlyCreated flag either way", () => {
    const res = { ok: true, exists: true, deleted: false };
    expect(projectGateStatus({ res, freshlyCreated: true }).status).toBe("live");
    expect(projectGateStatus({ res, freshlyCreated: false }).status).toBe("live");
  });

  it("an inconclusive answer still fails OPEN regardless of freshlyCreated", () => {
    expect(projectGateStatus({ res: { ok: false }, freshlyCreated: false }).status).toBe("live");
    expect(projectGateStatus({ res: null, freshlyCreated: false }).status).toBe("live");
  });
});

/* B1202176 ×2 (recurrence, owner chat 2026-09-05) — "a new project persists its child data but
 * never itself, so a reload loses the lot." The first B1202176 fix only taught the gate to
 * TOLERATE a freshly-minted id for the life of the session (`freshlyCreated`, proven above) — it
 * never made the project's own `sites` row actually exist. So a project used from a NON-Site
 * module (Model/Notes/Review/Library) — never touching the Site Planner canvas — still had no
 * `sites` row, and the tolerance is wiped by a reload (a fresh page load has no session memory),
 * at which point `checkProjectDeletionStatus` finds nothing and the gate blocks the workspace
 * exactly as before, regardless of how much child data survived elsewhere.
 *
 * THE REGRESSION THIS PROVES, which the first fix's own tests could not: a gate check made with
 * `freshlyCreated: false` — i.e. AFTER a reload, with no session memory at all, the honest
 * post-reload case — for a project `ensureSiteRow` has already run against, resolves LIVE on the
 * strength of a REAL row, not a session flag. A test that only checked the gate with a
 * PRE-EXISTING row (seeded by the mock, never actually written by this code) would pass on the
 * broken behaviour — this one writes the row through the real `ensureSiteRow` → `saveSite` →
 * `pushSiteToCloud` → `cloudUpsert` path and reads it back through the real
 * `checkProjectDeletionStatus` → `cloudCheckDeleted` path, the same two functions the app
 * actually calls. */
// storage.js's saveSite/readSites persist through the browser's localStorage; this suite runs in
// vitest's Node environment (no DOM), so it needs the same minimal in-memory shim
// test/saveFallbackCloud.test.js already uses for the identical reason.
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

describe("ensureSiteRow — B1202176 ×2: closes the gap the session-memory fix left open", () => {
  beforeEach(() => { h.row = null; h.error = null; mockLocalStorage(); setActiveUser(null); });

  it("a brand-new id gets a real LOCAL row, signed out (no cloud call needed to keep local work safe)", async () => {
    const r = await ensureSiteRow("s-newproj-local");
    expect(r).toEqual({ ok: true, created: true, cloudPushed: false });
    expect(h.row).toBe(null); // signed out — never touches the cloud at all
  });

  it("is idempotent — a project that already has a row is left completely alone", async () => {
    await ensureSiteRow("s-newproj-idem");
    const r2 = await ensureSiteRow("s-newproj-idem");
    expect(r2).toEqual({ ok: true, created: false });
  });

  it("THE CORE REPRO, closed for real: signed in, ensureSiteRow's write is what a POST-RELOAD gate check (freshlyCreated:false — no session memory) needs to read the project LIVE", async () => {
    setActiveUser("u1");
    const id = "s-newproj-signedin";
    // Before the fix: nothing ever wrote this row, so this is where the reported bug lived.
    expect((await checkProjectDeletionStatus(id)).exists).toBe(false);
    const ensured = await ensureSiteRow(id, { name: "Untitled project" });
    expect(ensured.ok).toBe(true);
    expect(ensured.created).toBe(true);
    expect(ensured.cloudPushed).toBe(true); // the row genuinely reached the mocked cloud
    // The reload case: a fresh gate check with NO freshlyCreated memory (a real reload has none).
    const res = await checkProjectDeletionStatus(id);
    expect(res.ok).toBe(true);
    expect(res.exists).toBe(true);
    expect(res.deleted).toBe(false);
    const g = projectGateStatus({ res, freshlyCreated: false });
    expect(g.status).toBe("live"); // never "missing" — the OLD failure mode this reproduces
    setActiveUser(null);
  });
});
