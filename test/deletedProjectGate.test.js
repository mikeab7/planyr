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
    }),
  },
  supabaseRest: () => ({ url: "", anon: "" }),
  currentAccessToken: () => null,
}));
vi.mock("../src/shared/telemetry/clientErrors.js", () => ({ reportClientEvent: () => {} }));

import { cloudCheckDeleted } from "../src/workspaces/site-planner/lib/cloudSync.js";
import { checkProjectDeletionStatus, setActiveUser } from "../src/workspaces/site-planner/lib/storage.js";
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
