import { describe, it, expect, beforeEach, vi } from "vitest";

/* NEW-2 (B848832, owner report 2026-09-04) — "a soft-deleted project stays fully open and
 * writable, and its breadcrumb degrades to the placeholder word Project."
 *
 * The route-level fix (Shell.jsx swapping in DeletedProjectNotice instead of mounting the
 * workspace) can only be proven live, signed in, against a real soft-deleted row — this sandbox
 * cannot sign in to Supabase (Blocker: auth), and confirming it needs the exact owner-reported
 * project, not a synthetic one (Blocker: real-data). Both are filed as V### live-verify steps.
 *
 * What IS fully provable here, headless and Node-only: the GROUP-level deletion check the whole
 * gate is built on (`cloudCheckDeleted`) answers every shape of a project's rows correctly, and
 * the `checkProjectDeletionStatus` wrapper Shell.jsx actually calls fails OPEN whenever the answer
 * is inconclusive (signed out, a thrown error, a pre-migration DB) — the property STANDING RULE
 * demands: never block a route on an absence of information, only on a proven fact.
 *
 * Mock the supabase client (same pattern as test/cloudListIdIntegrity.test.js) so this runs with
 * no network/config. Hoisted holder — a vi.mock factory can't close over a normal top-level var.
 * `h.rows` is the in-memory `sites` table: `cloudCheckDeleted` (B1164192) asks it TWICE — once by
 * `id`, once by `group_id` — since a project is every row sharing a group, not the single row
 * whose id happens to equal it (see that function's own header).
 */
const h = vi.hoisted(() => ({
  rows: [], error: null,
  // NEW-1 (B2671231) — what the mocked Supabase CLIENT is doing: its session ("valid" | "expired" | "none" |
  // "other-user"), whether the next `anonFor` row queries are answered AS THE ANONYMOUS ROLE (row-level
  // security gives zero rows and NO error — the false "missing"), a late-resolving read, and a query counter.
  session: "valid", anonFor: 0, anonAlways: false, delay: 0, queries: 0,
}));
vi.mock("../src/workspaces/site-planner/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => {
        const now = Math.floor(Date.now() / 1000);
        const mk = (uid, exp) => ({ data: { session: { user: { id: uid }, expires_at: exp } }, error: null });
        if (h.session === "valid") return mk("u1", now + 3600);
        if (h.session === "expired") return mk("u1", now - 60);
        if (h.session === "other-user") return mk("someone-else", now + 3600);
        return { data: { session: null }, error: null };
      },
    },
    from: () => ({
      select: () => ({
        // cloudCheckDeleted awaits this directly (Promise.all of two `.eq()` calls, no
        // `.maybeSingle()`) — PostgREST-array style: every row matching `field === val`.
        eq: (field, val) => {
          h.queries++;
          const anon = h.anonAlways || h.anonFor > 0;
          if (h.anonFor > 0) h.anonFor--;
          const out = { data: h.error ? null : (anon ? [] : h.rows.filter((r) => r && r[field] === val)), error: h.error };
          return h.delay ? new Promise((res) => setTimeout(() => res(out), h.delay)) : Promise.resolve(out);
        },
        // cloudDeletedRows: `.not("deleted_at", "is", null).order(...)` — every soft-deleted row,
        // most-recently-deleted first (listDeletedProjects's own input).
        not: (field) => ({
          order: () => Promise.resolve({
            data: h.error ? null : h.rows.filter((r) => r && r[field] != null)
              .sort((a, b) => new Date(b.deleted_at) - new Date(a.deleted_at)),
            error: h.error,
          }),
        }),
      }),
      // ensureProjectRow's cloud push (cloudUpsert → casUpsert) INSERTs a brand-new row — the
      // mock records it and makes it visible to the SAME select().eq() lookups above, so a later
      // checkProjectDeletionStatus() call for the same id sees it, exactly as a real reload's
      // fresh gate check would against the real database.
      insert: (v) => ({
        select: async () => {
          const row = { id: v.id, group_id: v.group_id ?? null, site: v.site ?? null, name: v.name ?? null, deleted_at: null };
          h.rows = [...h.rows.filter((r) => r.id !== row.id), row];
          return { data: [{ version: 1 }], error: null };
        },
      }),
    }),
  },
  supabaseRest: () => ({ url: "", anon: "" }),
  currentAccessToken: () => null,
}));
vi.mock("../src/shared/telemetry/clientErrors.js", () => ({ reportClientEvent: () => {} }));

import { cloudCheckDeleted } from "../src/workspaces/site-planner/lib/cloudSync.js";
import { checkProjectDeletionStatus, setActiveUser, ensureProjectRow, listDeletedProjects } from "../src/workspaces/site-planner/lib/storage.js";
import { projectGateStatus, markProjectFreshlyMinted, wasProjectFreshlyMinted } from "../src/shared/projects/projectModel.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

// storage.js's saveSite/readSites (and projectModel.js's persisted freshly-minted list) persist
// through the browser's localStorage; this suite runs in vitest's Node environment (no DOM), so
// it needs the same minimal in-memory shim test/saveFallbackCloud.test.js already uses.
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

// Every test starts with the mocked client SIGNED IN and answering as that user (NEW-1, B2671231).
beforeEach(() => { h.session = "valid"; h.anonFor = 0; h.anonAlways = false; h.delay = 0; h.queries = 0; });

describe("cloudCheckDeleted — the one question a routed project id must answer before a workspace mounts", () => {
  beforeEach(() => { h.rows = []; h.error = null; h.session = "valid"; h.anonFor = 0; h.anonAlways = false; h.delay = 0; h.queries = 0; });

  it("no signed-in uid → inconclusive, never a positive answer either way", async () => {
    const res = await cloudCheckDeleted(null, "s1");
    expect(res.ok).toBe(false);
    expect(res.deleted).toBe(false);
  });

  it("a row that doesn't exist for this user at all reads MISSING, not deleted", async () => {
    h.rows = [];
    const res = await cloudCheckDeleted("u1", "nonexistent");
    expect(res.ok).toBe(true);
    expect(res.exists).toBe(false);
    expect(res.deleted).toBe(false);
  });

  it("a live row (deleted_at null) reads live", async () => {
    h.rows = [{ id: "s1", group_id: "g1", site: "Concept A", name: null, deleted_at: null }];
    const res = await cloudCheckDeleted("u1", "s1");
    expect(res.ok).toBe(true);
    expect(res.exists).toBe(true);
    expect(res.deleted).toBe(false);
  });

  it("a single-plan project (its own row IS the whole group) with deleted_at set reads deleted, with restore-ready facts", async () => {
    h.rows = [{ id: "smtjb0lrexb3", group_id: "g1", site: "Concept A", name: null, deleted_at: "2026-09-03T20:13:59+00:00" }];
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

  /* B1164192 (owner report 2026-09-07, "Richfield reads as deleted") — a Planyr project is every
   * plan row sharing a group_id, not the single row whose id happens to equal it (that row is
   * merely the ANCHOR — the plan the project was originally created from). A "duplicate and
   * rename" then deleting the original anchor must NOT read as the whole project having been
   * deleted while its siblings (the duplicate, and any other plans) are still live. Measured live
   * on production against exactly this shape: group `smsdrvzr9gzx` ("Richfield", 3 live siblings)
   * and group `smsrpaiqu5sv` ("Woods Road", 6 live siblings, a shared team project). */
  describe("B1164192 — THE CORE REPRO: a project's ANCHOR row (id === group id) is soft-deleted but siblings in its group are live", () => {
    it("reads LIVE, never deleted, when at least one sibling plan is live", async () => {
      h.rows = [
        { id: "smsdrvzr9gzx", group_id: "smsdrvzr9gzx", site: "Richfield", name: "Concept A", deleted_at: "2026-08-29T20:49:12+00:00" },
        { id: "concept-b", group_id: "smsdrvzr9gzx", site: "Richfield", name: "Concept B", deleted_at: null },
        { id: "concept-a-bn", group_id: "smsdrvzr9gzx", site: "Richfield", name: "Concept A BN", deleted_at: null },
      ];
      const res = await cloudCheckDeleted("u1", "smsdrvzr9gzx");
      expect(res.ok).toBe(true);
      expect(res.exists).toBe(true);
      expect(res.deleted).toBe(false);
      expect(res.deletedAt).toBe(null);
    });

    it("still reads LIVE when the anchor row was HARD-deleted (no row named by the group id exists at all)", async () => {
      // The anchor itself is gone (purged, not merely binned) — only its siblings remain on file.
      h.rows = [
        { id: "concept-b", group_id: "smsrpaiqu5sv", site: "Woods Road", name: "Concept B", deleted_at: null },
        { id: "concept-c", group_id: "smsrpaiqu5sv", site: "Woods Road", name: "Concept C", deleted_at: null },
      ];
      const res = await cloudCheckDeleted("u1", "smsrpaiqu5sv");
      expect(res.ok).toBe(true);
      expect(res.exists).toBe(true);
      expect(res.deleted).toBe(false);
    });

    it("a shared TEAM project (rows carry no owning distinction this check reads) is unaffected — same group-liveness rule", async () => {
      h.rows = [
        { id: "team-anchor", group_id: "team-anchor", site: "Woods Road", name: "Concept A", deleted_at: "2026-08-13T21:21:18+00:00" },
        { id: "team-plan-2", group_id: "team-anchor", site: "Woods Road", name: "Concept C", deleted_at: null },
      ];
      const res = await cloudCheckDeleted("u1", "team-anchor");
      expect(res.exists).toBe(true);
      expect(res.deleted).toBe(false);
    });

    it("a project where EVERY plan in the group is deleted still reads DELETED — the fix never widens who counts as live", async () => {
      h.rows = [
        { id: "gone-anchor", group_id: "gone-anchor", site: "Old Deal", name: "Concept A", deleted_at: "2026-08-01T00:00:00+00:00" },
        { id: "gone-plan-2", group_id: "gone-anchor", site: "Old Deal (renamed)", name: "Concept B", deleted_at: "2026-08-02T00:00:00+00:00" },
      ];
      const res = await cloudCheckDeleted("u1", "gone-anchor");
      expect(res.ok).toBe(true);
      expect(res.exists).toBe(true);
      expect(res.deleted).toBe(true);
      // Reports the MOST RECENTLY deleted plan's facts — the one a "restore" offer would act on.
      expect(res.deletedAt).toBe("2026-08-02T00:00:00+00:00");
      expect(res.name).toBe("Old Deal (renamed)");
    });

    it("a project whose anchor row is alive (the common case) is untouched", async () => {
      h.rows = [
        { id: "healthy", group_id: "healthy", site: "Bain", name: null, deleted_at: null },
        { id: "healthy-copy", group_id: "healthy", site: "Bain", name: "Copy", deleted_at: null },
      ];
      const res = await cloudCheckDeleted("u1", "healthy");
      expect(res.exists).toBe(true);
      expect(res.deleted).toBe(false);
    });
  });

  // B1482000 (follow-on to B1469872, owner report 2026-09-10) — `name` stays the PROJECT's name
  // (site takes priority) so a genuine whole-project deletion is still announced correctly, but
  // the row's own PLAN name is now carried separately for a caller that needs to tell them apart.
  it("carries the plan's own name (`planName`) alongside the coalesced `name`, on a deleted row", async () => {
    h.rows = [{ id: "smshwnnijjfi", group_id: "smr9olizi5ue", site: "Bain", name: "Concept A - Quiddity V1", deleted_at: "2026-08-12T00:00:00+00:00" }];
    const res = await cloudCheckDeleted("u1", "smshwnnijjfi");
    expect(res.name).toBe("Bain");
    expect(res.planName).toBe("Concept A - Quiddity V1");
  });
});

/* ⛔ B1336576 — listDeletedProjects (the "Recently deleted" bin in the project switcher) is the
 * SECOND independent place that had to learn the B1164192 rule ("a project is deleted only when
 * EVERY plan in its group is deleted") and, until this fix, never did. It grouped soft-deleted
 * rows by group_id with no notion of live siblings, so it listed Richfield/Woods Road — both real,
 * live projects whose only soft-deleted row is a discarded duplicate-and-rename original — as
 * entries in "Recently deleted", offering a Restore that would resurrect a plan the owner
 * deliberately discarded and a "Delete forever" aimed at a project that was never actually binned. */
describe("listDeletedProjects — the project switcher's Recently-deleted bin, and the SAME group-liveness rule", () => {
  beforeEach(() => { h.rows = []; h.error = null; setActiveUser("u1"); });

  it("THE CORE REPRO (B1164192 family) — a group whose anchor is soft-deleted but has live siblings never appears in the bin", async () => {
    h.rows = [
      { id: "smsdrvzr9gzx", group_id: "smsdrvzr9gzx", site: "Richfield", name: "Concept A", county: null, updated_at: null, deleted_at: "2026-08-29T20:49:12+00:00" },
      // The two live siblings never appear in cloudDeletedRows' result (only rows with a set
      // deleted_at do) — h.rows here models the WHOLE table, and only the ones with deleted_at
      // set are what cloudDeletedRows' `.not(...)` mock actually returns; cloudCheckDeleted's
      // own `.eq("group_id", …)` lookup (inside groupStillHasLivePlans) reads all of them.
      { id: "concept-b", group_id: "smsdrvzr9gzx", site: "Richfield", name: "Concept B", deleted_at: null },
      { id: "concept-a-bn", group_id: "smsdrvzr9gzx", site: "Richfield", name: "Concept A BN", deleted_at: null },
    ];
    const bin = await listDeletedProjects();
    expect(bin.ok).toBe(true);
    expect(bin.supported).toBe(true);
    expect(bin.projects).toHaveLength(0);
  });

  it("a project where EVERY plan in the group is deleted still appears in the bin", async () => {
    h.rows = [
      { id: "gone-anchor", group_id: "gone-anchor", site: "Old Deal", name: "Concept A", deleted_at: "2026-08-01T00:00:00+00:00" },
      { id: "gone-plan-2", group_id: "gone-anchor", site: "Old Deal (renamed)", name: "Concept B", deleted_at: "2026-08-02T00:00:00+00:00" },
    ];
    const bin = await listDeletedProjects();
    expect(bin.projects).toHaveLength(1);
    expect(bin.projects[0].id).toBe("gone-anchor");
    expect(bin.projects[0].ids.sort()).toEqual(["gone-anchor", "gone-plan-2"]);
    expect(bin.projects[0].name).toBe("Old Deal (renamed)"); // most-recently-deleted row's facts
  });

  it("a single-plan project (its own row IS the whole group) still appears in the bin, unaffected", async () => {
    h.rows = [{ id: "smtjb0lrexb3", group_id: "smtjb0lrexb3", site: "Concept A", name: null, deleted_at: "2026-09-03T20:13:59+00:00" }];
    const bin = await listDeletedProjects();
    expect(bin.projects).toHaveLength(1);
    expect(bin.projects[0].id).toBe("smtjb0lrexb3");
  });

  it("an anchor HARD-deleted (no row named by the group id exists at all) with a soft-deleted sibling but a LIVE sibling elsewhere never appears in the bin", async () => {
    h.rows = [
      // The anchor row itself is gone entirely — never appears in h.rows.
      { id: "old-dup", group_id: "smsrpaiqu5sv", site: "Woods Road", name: "old duplicate", deleted_at: "2026-08-17T16:33:14+00:00" },
      { id: "concept-c", group_id: "smsrpaiqu5sv", site: "Woods Road", name: "Concept C", deleted_at: null },
    ];
    const bin = await listDeletedProjects();
    expect(bin.projects).toHaveLength(0);
  });

  it("a shared TEAM project with live siblings is unaffected — same rule, no ownership filter", async () => {
    h.rows = [
      { id: "team-anchor", group_id: "team-anchor", site: "Woods Road", name: "Concept A", deleted_at: "2026-08-13T21:21:18+00:00" },
      { id: "team-plan-2", group_id: "team-anchor", site: "Woods Road", name: "Concept C", deleted_at: null },
    ];
    const bin = await listDeletedProjects();
    expect(bin.projects).toHaveLength(0);
  });

  it("a project whose anchor row is alive (the common case) never even reaches this listing (no soft-deleted row at all)", async () => {
    h.rows = [
      { id: "healthy", group_id: "healthy", site: "Bain", name: null, deleted_at: null },
      { id: "healthy-copy", group_id: "healthy", site: "Bain", name: "Copy", deleted_at: null },
    ];
    const bin = await listDeletedProjects();
    expect(bin.projects).toHaveLength(0);
  });

  it("signed out reports unsupported (no cloud bin to read) rather than throwing", async () => {
    setActiveUser(null);
    const bin = await listDeletedProjects();
    expect(bin.ok).toBe(true);
    expect(bin.supported).toBe(false);
    expect(bin.projects).toEqual([]);
  });
});

describe("checkProjectDeletionStatus — the Shell.jsx route gate's own entry point", () => {
  beforeEach(() => { h.rows = []; h.error = null; setActiveUser(null); });

  it("signed out → fails open (no soft-delete concept for a local-only project)", async () => {
    const res = await checkProjectDeletionStatus("s1");
    expect(res.ok).toBe(false);
  });

  it("signed in, delegates straight through to the real check", async () => {
    setActiveUser("u1");
    h.rows = [{ id: "s1", group_id: "g1", site: "Live One", deleted_at: null }];
    const res = await checkProjectDeletionStatus("s1");
    expect(res.ok).toBe(true);
    expect(res.deleted).toBe(false);
    setActiveUser(null);
  });
});

/* B1482000 (follow-on to B1469872, owner report 2026-09-10) — "navigating directly to a soft-deleted
 * plan's URL shows a dialog headed 'This project was deleted' … named with the project name, for
 * the same reason [as the plan-menu bug]." That row is a PLAN inside a still-live project, not a
 * dead project. `cloudCheckDeleted(uid, id)`'s two-query shape (id=:id OR group_id=:id) only ever
 * sees a NON-anchor plan's own row — it can't see the plan's real siblings, because they carry a
 * DIFFERENT group_id than the id that was asked about. `checkProjectDeletionStatus` closes that
 * gap with a supplementary `groupStillHasLivePlans` check against the row's REAL group_id — the
 * same helper `listDeletedProjects` and the 30-day purge already trust for "is this project still
 * live". Live-verified against the real production schema in
 * `db/test/deleted_plan_naming.test.sql` (throwaway, self-rolling-back fixtures — see its header). */
describe("checkProjectDeletionStatus — NEW-1: a deep link to a non-anchor PLAN inside an otherwise-live project", () => {
  beforeEach(() => { h.rows = []; h.error = null; setActiveUser("u1"); });

  it("THE CORE REPRO (Bain): reports scope:'plan', named with the PLAN's own name — never the project's", async () => {
    h.rows = [
      { id: "smr9olizi5ue", group_id: "smr9olizi5ue", site: "Bain", name: "Concept C", deleted_at: null }, // live anchor plan
      { id: "smshwnnijjfi", group_id: "smr9olizi5ue", site: "Bain", name: "Concept A - Quiddity V1", deleted_at: "2026-08-12T00:00:00+00:00" }, // the deleted, non-anchor plan
    ];
    const res = await checkProjectDeletionStatus("smshwnnijjfi");
    expect(res.ok).toBe(true);
    expect(res.exists).toBe(true);
    expect(res.deleted).toBe(true);
    expect(res.scope).toBe("plan");
    expect(res.name).toBe("Concept A - Quiddity V1");
    expect(res.name).not.toBe("Bain");
  });

  it("a genuine whole-project deletion (id IS the group's anchor) is untouched — scope stays unset, named with the project", async () => {
    h.rows = [{ id: "gone-anchor", group_id: "gone-anchor", site: "Old Deal", name: "Concept A", deleted_at: "2026-08-01T00:00:00+00:00" }];
    const res = await checkProjectDeletionStatus("gone-anchor");
    expect(res.deleted).toBe(true);
    expect(res.scope).toBeUndefined();
    expect(res.name).toBe("Old Deal");
  });

  it("a non-anchor plan whose TRUE group has nothing live either still reports the whole project gone, not a false 'plan' scope", async () => {
    h.rows = [
      { id: "dead-anchor", group_id: "dead-anchor", site: "Dead Deal", name: "Concept A", deleted_at: "2026-08-01T00:00:00+00:00" },
      { id: "dead-plan2", group_id: "dead-anchor", site: "Dead Deal", name: "Concept B", deleted_at: "2026-08-02T00:00:00+00:00" },
    ];
    const res = await checkProjectDeletionStatus("dead-plan2");
    expect(res.deleted).toBe(true);
    expect(res.scope).toBeUndefined();
  });

  it("a project whose anchor row is alive is untouched by the supplementary check (never reaches it — deleted is false)", async () => {
    h.rows = [
      { id: "healthy-anchor", group_id: "healthy-anchor", site: "Bain", name: "Concept A", deleted_at: null },
      { id: "healthy-plan2", group_id: "healthy-anchor", site: "Bain", name: "Concept B", deleted_at: null },
    ];
    const res = await checkProjectDeletionStatus("healthy-plan2");
    expect(res.deleted).toBe(false);
    expect(res.scope).toBeUndefined();
  });
});

describe("projectGateStatus — NEW-1: the `scope` field reaches the notice screen", () => {
  it("defaults an unset scope to 'project' (a whole-project deletion, or a caller that predates this field)", () => {
    const res = { ok: true, exists: true, deleted: true, name: "Bain", deletedAt: "2026-09-03T20:13:59+00:00" };
    expect(projectGateStatus({ res }).scope).toBe("project");
  });

  it("passes a 'plan' scope straight through", () => {
    const res = { ok: true, exists: true, deleted: true, name: "Concept A - Quiddity V1", deletedAt: "2026-09-03T20:13:59+00:00", scope: "plan" };
    const g = projectGateStatus({ res });
    expect(g.status).toBe("deleted");
    expect(g.scope).toBe("plan");
    expect(g.name).toBe("Concept A - Quiddity V1");
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
 * Landed CONCURRENTLY with an independent session's B1160480 (same root cause, found via the
 * Library-upload angle), which shipped `storage.js`'s `ensureProjectRow` — the more complete
 * implementation (it also refuses a genuinely soft-deleted project rather than silently
 * resurrecting it) — with its own thorough suite in `test/ensureProjectRow.test.js`. This block
 * does not re-prove that function's own logic; it proves the ONE thing that suite cannot, because
 * it mocks `cloudSync.js` directly rather than the real `supabase.js` client: that `ensureProjectRow`'s
 * write is what a SUBSEQUENT, INDEPENDENT `checkProjectDeletionStatus` call — made with
 * `freshlyCreated: false`, the honest post-reload state with no session memory at all — needs to
 * resolve the project LIVE. A test that only checked the gate against a PRE-EXISTING row (seeded
 * by the mock, never actually written by this code) would pass on the broken behaviour; this one
 * writes the row through the real `ensureProjectRow` → `saveSite` → `pushSiteToCloud` →
 * `cloudUpsert` path and reads it back through the real `checkProjectDeletionStatus` →
 * `cloudCheckDeleted` path — the same two functions the app actually calls — via ONE stateful
 * mock of the Supabase client that an INSERT genuinely makes visible to a later SELECT.
 *
 * NOTE — this is a DIFFERENT, complementary mechanism from the sibling "B1202176 (extended)"
 * describe block below (`markProjectFreshlyMinted`/`wasProjectFreshlyMinted`): that one persists
 * the SESSION-MEMORY grace across a reload/new tab (still no real row, just a longer-lived flag);
 * this one makes the row genuinely EXIST, so neither mechanism needs to fire at all once a module
 * has actually saved something. Both are real fixes for different gaps and neither makes the
 * other redundant — a project that mints an id and is then abandoned with zero content anywhere
 * never gets an `ensureProjectRow` row (by design, per the lazy-creation model), so
 * `markProjectFreshlyMinted`'s grace is still what carries it across a reload for however long
 * its cap allows. */
describe("ensureProjectRow — B1202176 ×2: the reload case, proven end-to-end through the real transport", () => {
  beforeEach(() => { h.rows = []; h.error = null; mockLocalStorage(); setActiveUser(null); });

  it("THE CORE REPRO, closed for real: signed in, ensureProjectRow's write is what a POST-RELOAD gate check (freshlyCreated:false — no session memory) needs to read the project LIVE", async () => {
    setActiveUser("u1");
    const id = "s-newproj-signedin";
    // Before the fix: nothing ever wrote this row, so this is where the reported bug lived.
    expect((await checkProjectDeletionStatus(id)).exists).toBe(false);
    const ensured = await ensureProjectRow(id, { name: "Untitled project" });
    expect(ensured.ok).toBe(true);
    expect(ensured.created).toBe(true); // the row genuinely reached the mocked cloud
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

/* B1202176 (extended, 2026-09-05) — THE RELOAD REPRO. `freshProjectIdsRef`/`locallyMintedGroupsRef`
 * are plain in-memory Sets, scoped to one Shell/SitePlannerApp mount; they cannot answer for an id
 * minted in an EARLIER mount. Live repro on production (build 59d08b4, which already contains
 * #1451/#1457): loading bare https://planyr.io/ restored `planyr:lastRoute:v1` pointing at project
 * id `smtouazufbss`, which has NO row in `public.sites` at all — not present, not soft-deleted —
 * because "New project" mints an id and writes it into `lastRoute` on navigation, but (by design —
 * see SitePlannerApp.jsx's `newBlankSite`) saves NOTHING anywhere until the first draw. Closing the
 * tab before drawing anything and reopening the bare domain restores that id into a BRAND-NEW Shell
 * mount, whose `freshProjectIdsRef` is an empty Set — the exact same `{exists:false}` answer as the
 * original bug, now reading "missing" again.
 *
 * `markProjectFreshlyMinted`/`wasProjectFreshlyMinted` are the small, capped, localStorage-backed
 * twin of that in-memory Set — written at the same two mint sites, read regardless of which mount
 * (or tab) asks. This proves the actual cross-mount sequence the earlier tests in this file cannot:
 * mint in one "mount" (write only the persisted store, never touching the in-memory ref), then ask
 * in a SECOND, freshly-constructed in-memory Set (a fresh mount/reload) whether the combined
 * `freshlyCreated` signal — exactly what Shell.jsx now computes — still resolves the gate to "live".
 */
describe("B1202176 (extended) — a restored lastRoute pointer to a locally-minted, never-saved project survives a reload", () => {
  beforeEach(() => { mockLocalStorage(); });

  it("THE CORE REPRO: an id minted in an EARLIER mount (no in-memory ref left) still resolves live via the persisted twin", () => {
    // Mount 1: "New project" is clicked, the id is minted and persisted — but this mount's
    // in-memory ref is deliberately never consulted again below, simulating the tab having closed.
    const id = "smtouazufbss";
    markProjectFreshlyMinted(id);

    // Mount 2 (a bare-domain reload / brand-new tab): a FRESH in-memory Set, empty, exactly like
    // Shell.jsx's freshProjectIdsRef on a real fresh mount.
    const freshProjectIdsRefMount2 = new Set();
    const res = { ok: true, exists: false, deleted: false }; // the cloud's honest "no such row" answer
    const freshlyCreated = freshProjectIdsRefMount2.has(id) || wasProjectFreshlyMinted(id);
    const g = projectGateStatus({ res, freshlyCreated });

    expect(g.status).toBe("live"); // NOT "missing" — this is the exact dead-end the owner hit
  });

  it("an id this device never minted (a real bad/expired link) still reads missing after the same sequence", () => {
    markProjectFreshlyMinted("some-other-id-entirely");
    const res = { ok: true, exists: false, deleted: false };
    const freshProjectIdsRefMount2 = new Set();
    const freshlyCreated = freshProjectIdsRefMount2.has("bad-link-id") || wasProjectFreshlyMinted("bad-link-id");
    expect(projectGateStatus({ res, freshlyCreated }).status).toBe("missing");
  });

  it("a genuinely soft-deleted project is still caught even though this device once minted that same id", () => {
    const id = "smtouazufbss";
    markProjectFreshlyMinted(id);
    const res = { ok: true, exists: true, deleted: true, name: "Concept A", deletedAt: "2026-09-03T20:13:59+00:00" };
    const freshlyCreated = wasProjectFreshlyMinted(id);
    const g = projectGateStatus({ res, freshlyCreated });
    expect(g.status).toBe("deleted");
  });

  it("markProjectFreshlyMinted/wasProjectFreshlyMinted round-trip and are capped so the list can't grow unbounded", () => {
    for (let i = 0; i < 40; i++) markProjectFreshlyMinted(`id${i}`);
    // The most recent entries are kept; the earliest ones fall off the cap.
    expect(wasProjectFreshlyMinted("id39")).toBe(true);
    expect(wasProjectFreshlyMinted("id0")).toBe(false);
    const raw = JSON.parse(globalThis.localStorage.getItem("planyr:freshProjects:v1"));
    expect(raw.length).toBeLessThanOrEqual(25);
  });

  it("re-minting an already-tracked id doesn't duplicate it in the persisted list", () => {
    markProjectFreshlyMinted("dup-id");
    markProjectFreshlyMinted("dup-id");
    const raw = JSON.parse(globalThis.localStorage.getItem("planyr:freshProjects:v1"));
    expect(raw.filter((x) => x === "dup-id").length).toBe(1);
  });

  it("gracefully no-ops with no localStorage (SSR/Node) rather than throwing", () => {
    const saved = globalThis.localStorage;
    delete globalThis.localStorage;
    expect(() => markProjectFreshlyMinted("x")).not.toThrow();
    expect(wasProjectFreshlyMinted("x")).toBe(false);
    globalThis.localStorage = saved;
  });
});

/* The deleted-project screen's sentence — the owner reported it reading
 * "was moved to Recently deleted ." with a stray space before the period.
 *
 * ⛔ THE SPACE WAS A SYMPTOM, NOT THE BUG. It was an empty relative time: `relTime` could not parse
 * the ISO timestamp `cloudCheckDeleted` hands this screen and silently returned "". Fixed at the
 * source (see relTime's own header + test/projects.test.js's ISO block); this asserts the SENTENCE,
 * so the copy can never re-grow the space regardless of what a future timestamp value does. Source
 * assertion rather than a render: this component is lazy-loaded behind Suspense inside Shell.jsx
 * and the sentence is what was reported, not the DOM around it. */
describe("DeletedProjectNotice — no stray space before the period", () => {
  const NOTICE = readFileSync(resolve(HERE, "../src/shared/ui/DeletedProjectNotice.jsx"), "utf8");

  it("builds the whole fragment in ONE expression, not from JSX whitespace condensing", () => {
    expect(NOTICE).toMatch(/\{relTime\(deletedAt\)\s*\n\s*\? ` was moved to Recently deleted \$\{relTime\(deletedAt\)\}\. `/);
    expect(NOTICE).toMatch(/: " was moved to Recently deleted\. "/);
  });

  it("gates on the RENDERED time, never on `deletedAt` merely being truthy", () => {
    // `deletedAt ? ...` is the exact shape that produced the stray space: a truthy but unparseable
    // ISO string took the branch that appends a space and then an empty string.
    expect(NOTICE).not.toMatch(/\{deletedAt \? ` \$\{relTime\(deletedAt\)\}` : ""\}/);
  });

  it("leaves no ' .' anywhere in the copy", () => {
    expect(NOTICE).not.toMatch(/Recently deleted\{[^}]*\}\./);
  });
});

/* B1482000 (follow-on to B1469872, owner report 2026-09-10) — the deep-link dialog announced "This
 * project was deleted" for a soft-deleted PLAN inside a still-live project. `scope` (threaded from
 * `checkProjectDeletionStatus` through `projectGateStatus`/Shell.jsx) is what lets this screen say
 * the right thing. Source assertion, same reasoning as the sibling block above: this component is
 * lazy-loaded behind Suspense, and what's being checked is the copy itself. */
describe("DeletedProjectNotice — NEW-1: scope-aware copy (plan vs. project)", () => {
  const NOTICE = readFileSync(resolve(HERE, "../src/shared/ui/DeletedProjectNotice.jsx"), "utf8");

  it("defaults `scope` to \"project\" so every existing caller (pre-dating this prop) is unaffected", () => {
    expect(NOTICE).toMatch(/scope = "project"/);
  });

  it("carries both headline words — never hardcodes only the project one", () => {
    expect(NOTICE).toContain("This plan was deleted");
    expect(NOTICE).toContain("This project was deleted");
  });

  it("carries both restore-button labels", () => {
    expect(NOTICE).toContain("Restore plan");
    expect(NOTICE).toContain("Restore project");
  });

  it("publishes the resolved scope on the DOM for a live check to assert against", () => {
    expect(NOTICE).toContain("data-scope={scope}");
  });
});


/* ⛔ NEW-1 (B2671231, owner report 2026-11-12 ~1:14 PM) — "A real, live project briefly shows 'This project
 * doesn't exist'." Bain (group smr9olizi5ue) was fully intact in the database the whole time, so the card was a
 * FALSE "missing" verdict. The mechanism these tests pin: supabase-js sends the ANONYMOUS key whenever it cannot
 * hand back a usable session (a refresh that failed on a slow / dropped connection, a tab that just regained focus
 * with an expired token), and row-level security answers an anonymous read with ZERO rows and NO error — the very
 * answer a really-deleted project gives. Shell.jsx re-asks on every tab refocus, so the card appeared and, on the
 * next good read, went away "on its own".
 *
 * The rule: the card (status "missing") may only render for a verdict the app can PROVE — the client's session is
 * the signed-in user's, AND two reads, one after that proof, both came back empty. Anything else is inconclusive
 * (`ok:false`), which `projectGateStatus` turns into "live" (the workspace stays mounted; no card, ever).
 * Each "never" test below is RED on the pre-fix `cloudCheckDeleted` (it answered `exists:false` on the first
 * empty read) — verified by stashing the fix. */
describe("NEW-1 (B2671231) — a project that exists never reads as missing, at any point of the check", () => {
  const BAIN = [
    { id: "smr9olizi5ue", group_id: "smr9olizi5ue", site: "Bain", name: "Concept - Original", deleted_at: null },
    { id: "smwax0krth1h", group_id: "smr9olizi5ue", site: "Bain", name: "Concept B", deleted_at: null },
    { id: "smthnjl2cxyg", group_id: "smr9olizi5ue", site: "Bain", name: "Shared plan (another owner)", deleted_at: null },
  ];
  const gate = (res, freshlyCreated = false) => projectGateStatus({ res, freshlyCreated }).status;
  beforeEach(() => { h.rows = BAIN.map((r) => ({ ...r })); h.error = null; setActiveUser("u1"); });

  it("THE CORE REPRO: the client fell back to the anonymous role (no usable session) → empty rows, no error → NOT 'missing'", async () => {
    h.session = "none"; h.anonAlways = true;
    const res = await checkProjectDeletionStatus("smr9olizi5ue");
    expect(res.ok).toBe(false);
    expect(res.exists).toBe(false);
    expect(gate(res)).toBe("live");
    expect(gate(res)).not.toBe("missing");
  });

  it("a session that is ABOUT to lapse is not proof either — an empty answer under it is inconclusive", async () => {
    h.session = "expired"; h.anonAlways = true;
    const res = await checkProjectDeletionStatus("smr9olizi5ue");
    expect(res.ok).toBe(false);
    expect(gate(res)).toBe("live");
  });

  it("a session that belongs to a DIFFERENT user than the one the store thinks is active proves nothing", async () => {
    h.session = "other-user"; h.anonAlways = true;
    const res = await checkProjectDeletionStatus("smr9olizi5ue");
    expect(res.ok).toBe(false);
    expect(gate(res)).toBe("live");
  });

  it("the first read was anonymous (token not applied yet) but the session is good: the second read sees the project → LIVE", async () => {
    h.anonFor = 2; // the first read's two queries are answered as the anonymous role
    const res = await checkProjectDeletionStatus("smr9olizi5ue");
    expect(res.ok).toBe(true);
    expect(res.exists).toBe(true);
    expect(res.deleted).toBe(false);
    expect(gate(res)).toBe("live");
  });

  it("every phase of a LATE-resolving read (still pending, then answered) never produces a 'missing' verdict", async () => {
    h.delay = 25;
    const seen = [];
    const p = checkProjectDeletionStatus("smr9olizi5ue");
    seen.push("pending"); // while the read is in flight the gate has no verdict at all — the workspace stays mounted
    const res = await p;
    seen.push(gate(res));
    expect(seen).toEqual(["pending", "live"]);
    expect(res.exists).toBe(true);
  });

  it("a late read that resolves EMPTY first and good second (slow network) still ends LIVE, and never 'missing' on the way", async () => {
    h.delay = 15; h.anonFor = 2;
    const res = await checkProjectDeletionStatus("smwax0krth1h");
    expect(gate(res)).toBe("live");
  });

  it("an ERRORED read (5xx, timeout, 403, offline) is inconclusive → live, never the doesn't-exist wording", async () => {
    h.error = { message: "FetchError: network timeout", code: "" };
    const res = await checkProjectDeletionStatus("smr9olizi5ue");
    expect(res.ok).toBe(false);
    expect(gate(res)).toBe("live");
    h.error = { message: "permission denied", code: "42501", status: 403 };
    expect(gate(await checkProjectDeletionStatus("smr9olizi5ue"))).toBe("live");
  });

  it("a read that returns NO array at all (not an error, not a list) is not an answer", async () => {
    h.rows = null; // the mock's .filter would throw → the read is rejected → inconclusive
    const res = await checkProjectDeletionStatus("smr9olizi5ue");
    expect(res.ok).toBe(false);
    expect(gate(res)).toBe("live");
  });

  it("the URL id is a PLAN id (not the group id) of a live project, and a SHARED project's plan → live", async () => {
    expect(gate(await checkProjectDeletionStatus("smwax0krth1h"))).toBe("live");
    expect(gate(await checkProjectDeletionStatus("smthnjl2cxyg"))).toBe("live");
  });

  // ── the other half: the card is still shown when it is TRUE ──────────────────────────────────────────────
  it("a genuinely unknown id, with the session proven and both reads empty, STILL reads missing (the card is kept for a real dead link)", async () => {
    const res = await checkProjectDeletionStatus("never-existed");
    expect(res.ok).toBe(true);
    expect(res.exists).toBe(false);
    expect(gate(res)).toBe("missing");
    expect(h.queries).toBe(4); // two reads × (by id, by group) — the empty answer was confirmed, not trusted once
  });

  it("a genuinely hard-deleted project (no rows anywhere) still reads missing, and a locally-minted one still doesn't", async () => {
    h.rows = [];
    const res = await checkProjectDeletionStatus("smr9olizi5ue");
    expect(gate(res)).toBe("missing");
    expect(gate(res, true)).toBe("live");
  });

  it("a genuinely soft-deleted project still reads deleted (Restore), unaffected", async () => {
    h.rows = [{ id: "gone", group_id: "gone", site: "Old Deal", name: "Concept A", deleted_at: "2026-08-01T00:00:00+00:00" }];
    const res = await checkProjectDeletionStatus("gone");
    expect(gate(res)).toBe("deleted");
  });

  it("a positive answer needs NO extra round trips (the proof is only paid on an empty answer)", async () => {
    await checkProjectDeletionStatus("smr9olizi5ue");
    expect(h.queries).toBe(2);
  });

  it("signed out: no uid → inconclusive → live (no soft-delete concept), whatever the client is doing", async () => {
    setActiveUser(null);
    h.session = "none"; h.anonAlways = true;
    expect(gate(await checkProjectDeletionStatus("smr9olizi5ue"))).toBe("live");
  });
});

/* The Shell half: the gate is an effect that runs once per (project, recheck) — it must also re-run when the
 * session settles, or a check asked before sign-in (it fails open, no uid) is never asked again until the tab next
 * regains focus. Source assertion: Shell.jsx is a very large component and the dependency list IS the contract. */
describe("NEW-1 (B2671231) — Shell.jsx re-asks the gate once the session is known", () => {
  const SHELL = readFileSync(resolve(HERE, "../src/app/Shell.jsx"), "utf8");
  it("the gate effect depends on authKnown and the signed-in user id", () => {
    expect(SHELL).toMatch(/\[projectId, cross, org, gateRecheck, authKnown, user && user\.id\]/);
  });
  it("'missing' is the only verdict that swaps the workspace for the notice, and it still goes through projectGateStatus", () => {
    expect(SHELL).toMatch(/projectGateStatus\(\{ res, freshlyCreated \}\)/);
  });
});
