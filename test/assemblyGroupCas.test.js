import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assemblyDigest, compareIds, digestsByAssembly, memberToken } from "../src/workspaces/site-planner/lib/assemblyDigest.js";
import { groupCasEnabled, GROUP_CAS_KEY } from "../src/workspaces/site-planner/lib/groupCas.js";
import { createElementSync } from "../src/workspaces/site-planner/lib/elementSync.js";
import { commitElements } from "../src/workspaces/site-planner/lib/elementApi.js";
import { sqlAssemblyDigest, sqlConflictMembers } from "./helpers/sqlDigestParity.js";

/* B1341 STAGE 2 — GROUP CAS: one revision for a bonded assembly.
 *
 * WHAT STAGE 2 IS FOR, in one sentence, because it is easy to mistake for B1117. B1117 made a CALL
 * atomic: a batch lands whole or not at all. Two calls can each be internally atomic and still
 * disagree with each other — writer A commits the host while writer B commits the children, both
 * succeed, and the assembly is torn with nothing anywhere having failed, because every per-row rev
 * guard passed. Stage 2 asks the question neither guard asks: *is this ASSEMBLY still in the state
 * I based my edit on?*
 *
 * The server half is proven against a REAL Postgres by `db/test/commit_elements_group_cas.test.sql`
 * (all nine checks, self-rolling-back, and mutation-proven: disabling the digest comparison accepts
 * the stale call and moves the row). This file is the client half.
 */

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const SQL = read("../src/workspaces/site-planner/db/commit_elements_group_cas.sql");
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("the group revision is DERIVED, and identical on both sides", () => {
  it("is id:rev pairs, sorted by id, comma-joined", () => {
    expect(assemblyDigest([{ id: "b", rev: 2 }, { id: "a", rev: 1 }])).toBe("a:1,b:2");
    expect(memberToken("x", 7)).toBe("x:7");
  });

  it("is order-independent — the client cannot disagree with the server over row order", () => {
    const a = [{ id: "h", rev: 3 }, { id: "k1", rev: 9 }, { id: "k2", rev: 1 }];
    expect(assemblyDigest(a)).toBe(assemblyDigest([...a].reverse()));
  });

  it("an empty group is the empty string — a legitimate value, not a missing one", () => {
    expect(assemblyDigest([])).toBe("");
    expect(assemblyDigest(null)).toBe("");
  });

  it("changes when ANY member's rev moves — including one nobody is writing", () => {
    const before = assemblyDigest([{ id: "h", rev: 1 }, { id: "k", rev: 1 }]);
    expect(assemblyDigest([{ id: "h", rev: 1 }, { id: "k", rev: 2 }])).not.toBe(before);
  });

  it("digestsByAssembly buckets by root and ignores non-element kinds", () => {
    const rootOf = (e) => (e.el && e.el.attachedTo != null ? e.el.attachedTo : e.id);
    const out = digestsByAssembly([
      { kind: "el", id: "h", rev: 1, el: {} },
      { kind: "el", id: "k", rev: 2, el: { attachedTo: "h" } },
      { kind: "markup", id: "m", rev: 5, el: {} },   // a markup has no host — never in an assembly
    ], rootOf);
    expect([...out.keys()]).toEqual(["h"]);
    expect(out.get("h")).toBe("h:1,k:2");
  });
});

/* ⛔ B447472 — THE PARITY SUITE, AND THE TEST IT REPLACES.
 *
 * What used to stand here was
 *     expect(SQL).toMatch(/string_agg\(t\.id \|\| ':' \|\| t\.rev, ',' order by t\.id\)/)
 * — an assertion about the shape of the PROJECTION, which is structurally blind to the WHERE
 * clause beside it. Both sides can agree character-for-character on how to build a token and still
 * digest DIFFERENT MEMBER SETS, and that is what shipped: the SQL had no `kind` predicate, so it
 * folded in every live row sharing an `assembly_id`, while the client twin skips `kind !== "el"`.
 *
 * ⛔ THE ROOT CAUSE IS NOT "THE SERVER FORGOT A FILTER" — it is that `assembly_id` INHERITS THE ID
 * NAMESPACE'S NON-UNIQUENESS. The PK is (site_id, kind, id), so an id is unique only per KIND
 * (B420256), and stage 1 sets an unbonded element's `assembly_id` to its OWN id. Two unrelated
 * singleton assemblies of DIFFERENT kinds therefore collide on the assembly key: on the owner's
 * Katz plan (site `smqh3au6aeb4`), `el:e6327` is a building with 27 bonded children and
 * `markup:e6327` is an unrelated markup with no host — the markup is not a member of the
 * building's assembly, it is its own assembly that happens to share the NAME. Server digested 29
 * tokens, client 28, permanently. Read it as a namespace collision, or the next person
 * rediscovers it through a callout instead of a markup.
 *
 * ⛔ THE CLIENT IS RIGHT AND DOES NOT MOVE. A markup has no host, so it is a member of nothing but
 * itself. This is settled, not a live choice — do not "fix" a future recurrence by folding non-el
 * rows into `digestsByAssembly`.
 *
 * The fixture is drawn from that live assembly, verified read-only against production 2026-08-13
 * (28 el + 1 markup, all at rev 2 — and the ONLY such assembly in the whole table). LATENT ONLY:
 * group CAS ships OFF, so nothing is broken today; it bites the instant stage 2 is switched on.
 */
describe("PARITY — both implementations, one member set", () => {
  const sqlDigest = sqlAssemblyDigest(SQL);
  const conflictMembers = sqlConflictMembers(SQL);
  const SITE = "smqh3au6aeb4";

  // A row as the DATABASE holds it: assembly_id is GENERATED as coalesce(data->>'attachedTo', id).
  const row = (kind, id, rev, attachedTo = null, deleted_at = null) => ({
    site_id: SITE, kind, id, rev, deleted_at,
    attachedTo,
    assembly_id: attachedTo == null ? id : attachedTo,
  });

  // The same rows as the ENGINE's shadow holds them, fed through the client twin.
  const rootOf = (e) => (e.el && e.el.attachedTo != null ? e.el.attachedTo : e.id);
  const clientDigest = (rows, assembly) => {
    const out = digestsByAssembly(
      rows.filter((r) => r.deleted_at == null).map((r) => ({ kind: r.kind, id: r.id, rev: r.rev, el: { attachedTo: r.attachedTo } })),
      rootOf,
    );
    return out.get(assembly) ?? "";
  };

  const serverDigest = (rows, assembly) => sqlDigest.digest(rows, { p_site: SITE, p_assembly: assembly });

  /** The owner's real Katz assembly: a building + 27 bonded children, and an unrelated markup
   *  that collides with the host's id across the kind namespace. */
  const katzRows = () => {
    const kids = ["e6328", "e6329", "e6330", "e6331", "e6332", "e6333",
      "e79361", "e79362", "e79363", "e79364", "e79365", "e79366", "e79367", "e79368", "e79369",
      "e79370", "e79371", "e79372", "e79373", "e79374", "e79375",
      "e8971", "e8972", "e8984", "e8985", "e8986", "e8987"];
    return [
      row("el", "e6327", 2),                              // the host
      ...kids.map((id) => row("el", id, 2, "e6327")),      // 27 bonded children
      row("markup", "e6327", 2),                           // ⛔ NOT a member — its own assembly
    ];
  };

  it("⛔ the KIND COLLISION — a markup sharing the host's id is not a member on either side", () => {
    const rows = katzRows();
    expect(rows.filter((r) => r.assembly_id === "e6327").length).toBe(29);   // the fixture really collides
    expect(serverDigest(rows, "e6327")).toBe(clientDigest(rows, "e6327"));
    expect(serverDigest(rows, "e6327").split(",")).toHaveLength(28);         // 28 el members, not 29
    expect(serverDigest(rows, "e6327")).not.toMatch(/markup/);
  });

  it("the markup is its OWN assembly, and the server says so too", () => {
    const rows = katzRows();
    // Asked as the markup's own assembly, the server must not answer with the building's members.
    expect(serverDigest(rows, "e6327").includes("e6328:2")).toBe(true);
    const markupOnly = sqlDigest.members(rows, { p_site: SITE, p_assembly: "e6327" })
      .filter((r) => r.kind !== "el");
    expect(markupOnly).toHaveLength(0);
  });

  it("an ordinary assembly agrees — the control, so the fix is not just a blanket empty answer", () => {
    const rows = [row("el", "h", 1), row("el", "k1", 2, "h"), row("el", "k2", 3, "h")];
    expect(serverDigest(rows, "h")).toBe("h:1,k1:2,k2:3");
    expect(serverDigest(rows, "h")).toBe(clientDigest(rows, "h"));
  });

  it("a tombstone is a member on NEITHER side", () => {
    const rows = [row("el", "h", 1), row("el", "k1", 2, "h"), row("el", "k2", 9, "h", "2026-08-13T00:00:00Z")];
    expect(serverDigest(rows, "h")).toBe("h:1,k1:2");
    expect(serverDigest(rows, "h")).toBe(clientDigest(rows, "h"));
  });

  it("rows of ANOTHER site never enter the digest", () => {
    const rows = [row("el", "h", 1), { ...row("el", "k1", 7, "h"), site_id: "other-site" }];
    expect(serverDigest(rows, "h")).toBe("h:1");
  });

  it("an empty group is '' on both sides — a legitimate value, never null", () => {
    expect(serverDigest([row("el", "h", 1)], "no-such-assembly")).toBe("");
    expect(clientDigest([row("el", "h", 1)], "no-such-assembly")).toBe("");
  });

  /* The conflict payload is a SECOND query with its own where clause, and the client ADOPTS every
   * member it names into the shadow. A membership disagreement here deadlocks the retry exactly as
   * one in the digest does, so it is checked separately rather than assumed to follow. */
  it("the conflict's MEMBERS list carries the same set the digest does", () => {
    const rows = katzRows();
    const named = conflictMembers.rows(rows, { p_site: SITE, v_asm: "e6327" });
    expect(named.map((r) => r.kind).every((k) => k === "el")).toBe(true);
    expect(named).toHaveLength(28);
    // ⛔ sorted by ID, not by the assembled token — the ordering NEW-1 found (see below).
    expect(named.sort((a, b) => compareIds(a.id, b.id)).map((r) => `${r.id}:${r.rev}`).join(","))
      .toBe(serverDigest(rows, "e6327"));
  });

  /* ⛔ NEW-1 — THE ORDERING DISAGREEMENT, which is a DIFFERENT defect from the kind collision above
   * and produces the identical symptom. The client sorted the finished `id:rev` token; the server
   * orders by the id. Those agree only while no member's id is a PREFIX of another's — because the
   * token comparison puts the separator `:` (0x3A) against the longer id's next character, and
   * every digit (0x30–0x39) and the hyphen (0x2D) sort below it.
   *
   * Found by driving an ordinary hour of editing through the real engine with the flag forced on
   * (`ui-audit/session-group-cas.mjs`) — 500 refusals, 45 of them spurious, none converging — and
   * confirmed against the production database, which answers `e6327:4,e63271:2` where the old
   * client answered `e63271:2,e6327:4`. A digest mismatch on an assembly nothing is wrong with is a
   * refusal no retry can clear: every save on that building lost, permanently.
   *
   * ⛔ THE FIXTURE HAS TO CONTAIN A PREFIX PAIR OR THE TEST IS VACUOUS. Katz's ids are prefix-free,
   * which is why 28 real members and the whole parity suite above passed on the broken build. */
  describe("⛔ NEW-1 — ORDERING, over ids that actually stress it", () => {
    const prefixRows = [
      row("el", "e6327", 4),
      row("el", "e63271", 2, "e6327"),      // 'e6327' ⊂ 'e63271' — the shape the token sort inverts
      row("el", "e6328", 1, "e6327"),
    ];

    it("a member whose id PREFIXES another's orders identically on both sides", () => {
      expect(serverDigest(prefixRows, "e6327")).toBe("e6327:4,e63271:2,e6328:1");
      expect(clientDigest(prefixRows, "e6327")).toBe(serverDigest(prefixRows, "e6327"));
    });

    it("the OLD client rule really did disagree — so this test could have failed", () => {
      const oldWay = prefixRows.map((r) => `${r.id}:${r.rev}`).sort().join(",");
      expect(oldWay).toBe("e63271:2,e6327:4,e6328:1");            // …and the server says otherwise
      expect(oldWay).not.toBe(serverDigest(prefixRows, "e6327"));
    });

    it("hyphenated ids too — the app's own e2e fixture already holds such a pair", () => {
      const rows = [row("el", "e2e-bldg-1", 3), row("el", "e2e-bldg-11", 5, "e2e-bldg-1")];
      expect(clientDigest(rows, "e2e-bldg-1")).toBe(serverDigest(rows, "e2e-bldg-1"));
      expect(serverDigest(rows, "e2e-bldg-1")).toBe("e2e-bldg-1:3,e2e-bldg-11:5");
    });

    it("compareIds is code-POINT order, matching UTF-8 byte order rather than UTF-16 units", () => {
      // U+1D400 is a surrogate pair; UTF-16 unit order would put it BELOW U+E000, byte order above.
      expect(compareIds("a\u{1D400}", "a")).toBe(1);
      expect(compareIds("e6327", "e63271")).toBe(-1);
      expect(compareIds("e6327", "e6327")).toBe(0);
    });

    it("⛔ the interpreter REFUSES a digest whose collation is not pinned", () => {
      // The ordering is part of the digest string, so an unstated collation is an unmodellable
      // dependency, not a detail — a linguistic collation may reorder on a Postgres upgrade.
      const loosened = SQL.replace(/order by t\.id collate "C"/g, "order by t.id");
      expect(() => sqlAssemblyDigest(loosened)).toThrow(/DATABASE DEFAULT collation/);
      expect(sqlDigest.collation).toBe("C");
    });
  });

  it("the interpreter really read the migration's own filters — including the kind predicate", () => {
    // Not a format assertion: these are the conditions the evaluator ABOVE ran. If the file stops
    // being readable by it, `sqlAssemblyDigest` throws rather than passing vacuously.
    expect(sqlDigest.conditions).toContain("t.deleted_at is null");
    expect(sqlDigest.conditions).toContain("t.kind = 'el'");
    expect(conflictMembers.conditions).toContain("t.kind = 'el'");
  });
});

describe("the kill switch — stage 2 ships OFF", () => {
  const store = {};
  beforeEach(() => {
    globalThis.localStorage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    };
    delete store[GROUP_CAS_KEY];
  });
  afterEach(() => { delete globalThis.localStorage; });

  it("is OFF by default", () => { expect(groupCasEnabled()).toBe(false); });

  it("a device can arm it without a deploy, and disarm it again", () => {
    globalThis.localStorage.setItem(GROUP_CAS_KEY, "1");
    expect(groupCasEnabled()).toBe(true);
    globalThis.localStorage.setItem(GROUP_CAS_KEY, "0");
    expect(groupCasEnabled()).toBe(false);       // an explicit OFF beats the build flag
  });

  it("is read at CALL time — a switch you must reload to use is not a kill switch", () => {
    expect(groupCasEnabled()).toBe(false);
    globalThis.localStorage.setItem(GROUP_CAS_KEY, "1");
    expect(groupCasEnabled()).toBe(true);        // same module instance, no reload
  });
});

// ---- the engine half -------------------------------------------------------------------------
function makeHarness({ groupCas = () => true } = {}) {
  const calls = [];
  const events = [];
  const reports = [];
  const timers = [];
  let clock = 1000;
  let responder = (ops) => ({ ok: true, results: ops.map((o) => ({ id: o.id, status: "ok", rev: (o.expected || 0) + 1 })) });
  const els = [
    { id: "h", type: "building", cx: 0, cy: 0, w: 100, h: 100 },
    { id: "k1", type: "paving", cx: 0, cy: 90, w: 100, h: 20, attachedTo: "h" },
    { id: "k2", type: "trailer", cx: 0, cy: 120, w: 100, h: 20, attachedTo: "h" },
  ];
  const sync = createElementSync({
    siteId: "s1",
    commit: async (ops, opts) => { calls.push({ ops, opts }); return responder(ops, opts); },
    now: () => clock,
    setTimer: (fn, ms) => { const id = timers.length + 1; timers.push({ fn, ms, id }); return id; },
    clearTimer: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    onEvent: (e) => events.push(e),
    report: (name, msg, payload) => reports.push({ name, msg, payload }),
    liveCollections: () => ({ els }),
    groupCas,
    backoff: [10, 10, 10, 10, 10],
  });
  sync.seed(els.map((e, i) => ({ kind: "el", id: e.id, data: e, rev: i + 1, z_index: i })));
  return {
    sync, calls, events, reports, els,
    setResponder: (r) => { responder = r; },
    runTimers: () => { const due = timers.splice(0); due.forEach((t) => t.fn()); },
  };
}

// Move the whole assembly, so the batch spans it and the atomic gate opens.
const moved = (els) => els.map((e) => ({ ...e, cx: e.cx + 50 }));

describe("the engine sends a group revision for an assembly batch", () => {
  it("names the assembly and digests EVERY live member — including ones it is not writing", async () => {
    const h = makeHarness();
    h.sync.reconcile({ els: moved(h.els) }, {});
    h.sync.flushGesture();
    await tick();
    const { opts } = h.calls[0];
    expect(opts.atomic).toBe(true);
    expect(opts.groups).toEqual([{ assembly: "h", expected: "h:1,k1:2,k2:3" }]);
  });

  /* ⛔ THE ASSERTION THAT ACTUALLY CARRIES THE ITEM, and it took a mutation check to get it right.
   *
   * The first version of this test moved the WHOLE assembly, so every member was also a written op
   * — and a digest built from the written subset produced the identical string. It passed on a
   * deliberately wrong implementation. A batch must therefore span the assembly (or the atomic gate
   * never opens) while leaving at least one member UNWRITTEN, which is the only shape that can tell
   * "the assembly's revision" from "the revisions of the rows I happen to be writing".
   *
   * That distinction is the whole item: the tear is a SIBLING moving underneath you, and a digest
   * over the written subset asks exactly the question the per-row rev guard already answers. */
  it("⛔ the digest covers a member the batch never writes — the tear is a SIBLING moving", async () => {
    const h = makeHarness();
    const els = h.els.map((e) => (e.id === "k2" ? e : { ...e, cx: e.cx + 50 }));  // k2 untouched
    h.sync.reconcile({ els }, {});
    h.sync.flushGesture();
    await tick();
    const { ops, opts } = h.calls[0];
    expect(ops.map((o) => o.id).sort()).toEqual(["h", "k1"]);          // k2 is NOT written…
    expect(opts.groups).toEqual([{ assembly: "h", expected: "h:1,k1:2,k2:3" }]); // …and IS in the bet
  });

  it("a batch that does not span an assembly stays on the per-row path — stage 2's honest boundary", async () => {
    const h = makeHarness();
    const els = [...h.els];
    els[0] = { ...els[0], cx: 999 };
    h.sync.reconcile({ els }, {});
    h.sync.flushGesture();
    await tick();
    expect(h.calls[0].opts.groups).toBeUndefined();
  });

  it("is INERT with the switch off — the call is byte-for-byte its pre-stage-2 self", async () => {
    const h = makeHarness({ groupCas: () => false });
    h.sync.reconcile({ els: moved(h.els) }, {});
    h.sync.flushGesture();
    await tick();
    expect(h.calls[0].opts).toEqual({ atomic: true });
    expect(h.calls[0].opts.groups).toBeUndefined();
  });
});

describe("a refused call is re-committed against the assembly as it ACTUALLY is", () => {
  it("adopts the revs of members it never wrote, re-queues the batch, and says so", async () => {
    const h = makeHarness();
    h.setResponder(() => ({
      ok: true,
      applied: false,
      results: [],
      groupConflict: [{
        assembly: "h",
        expected: "h:1,k1:2,k2:3",
        actual: "h:1,k1:2,k2:9",
        members: [{ id: "h", kind: "el", rev: 1 }, { id: "k1", kind: "el", rev: 2 }, { id: "k2", kind: "el", rev: 9 }],
      }],
    }));
    h.sync.reconcile({ els: moved(h.els) }, {});
    h.sync.flushGesture();
    await tick();

    // k2 is the sibling that moved — this tab never wrote it, and adopting its rev is what makes
    // the retry agree with the server instead of losing the same race again.
    expect(h.sync.shadowSnapshot().get("el:k2").rev).toBe(9);
    expect(h.sync.shadowSnapshot().get("el:k2").stale).toBe(true);   // json and rev now disagree
    expect(h.sync.pendingCount()).toBeGreaterThan(0);                 // the WHOLE batch is re-queued
    expect(h.reports.some((r) => r.name === "element-group-conflict")).toBe(true);
    expect(h.events.some((e) => e.type === "assembly-split" && e.groupConflict)).toBe(true);
  });

  /* ⛔ THE DEADLOCK THIS FEATURE COULD HAVE SHIPPED WITH, found by asking "how could turning this
   * on go wrong?" rather than by a failing test.
   *
   * The server digests every LIVE row of the assembly; the client digests every row in its shadow.
   * If another writer CREATED a member and this tab's realtime has not delivered it, the two can
   * never agree — the omission is recomputed identically on every retry, and after
   * `maxRejectStreak` the tab declares itself stale and stops saving. Recoverable by a reload, but
   * reachable by exactly the two-writer case the feature exists for, which is the worst possible
   * place for a stuck state. The conflict payload carries id/kind/rev, which is enough to converge
   * without a refetch. */
  it("⛔ converges when the conflict names a member this tab has NEVER seen", async () => {
    const h = makeHarness();
    let call = 0;
    h.setResponder((ops, opts) => {
      call += 1;
      if (call === 1) {
        // The server knows a FOURTH member this tab has never heard of.
        expect(opts.groups[0].expected).toBe("h:1,k1:2,k2:3");
        return {
          ok: true, applied: false, results: [],
          groupConflict: [{
            assembly: "h", expected: opts.groups[0].expected, actual: "h:1,k1:2,k2:3,k3:4",
            members: [{ id: "h", kind: "el", rev: 1 }, { id: "k1", kind: "el", rev: 2 },
                      { id: "k2", kind: "el", rev: 3 }, { id: "k3", kind: "el", rev: 4 }],
          }],
        };
      }
      return { ok: true, applied: true, results: ops.map((o) => ({ id: o.id, status: "ok", rev: (o.expected || 0) + 1 })) };
    });
    h.sync.reconcile({ els: moved(h.els) }, {});
    h.sync.flushGesture();
    await tick();
    h.runTimers();                                    // the backoff retry
    await tick();

    // The retry's digest now INCLUDES the member it had never seen — so it can match, and does.
    expect(h.calls[1].opts.groups[0].expected).toBe("h:1,k1:2,k2:3,k3:4");
    expect(h.events.some((e) => e.type === "client-stale")).toBe(false);
    expect(h.reports.some((r) => r.name === "element-group-member-unknown")).toBe(true);
  });

  it("…and adopting that unknown member must NOT make the next diff invent a delete for it (B377888)", async () => {
    const h = makeHarness();
    let call = 0;
    h.setResponder((ops) => {
      call += 1;
      if (call === 1) return {
        ok: true, applied: false, results: [],
        groupConflict: [{ assembly: "h", expected: "x", actual: "y",
          members: [{ id: "k3", kind: "el", rev: 4 }] }],
      };
      return { ok: true, applied: true, results: ops.map((o) => ({ id: o.id, status: "ok", rev: (o.expected || 0) + 1 })) };
    });
    h.sync.reconcile({ els: moved(h.els) }, {});
    h.sync.flushGesture();
    await tick();
    h.runTimers(); await tick();
    // k3 is now in the shadow and has NEVER been on this canvas — the exact shape `reconcile` reads
    // as a deletion. The diff has to actually RUN for this to mean anything: without the reconcile
    // below the assertion passes on a build that would delete it (found by mutation check).
    h.sync.reconcile({ els: moved(h.els) }, {});
    h.runTimers(); await tick();
    const deletes = h.calls.flatMap((c) => c.ops).filter((o) => o.op === "delete");
    expect(deletes).toHaveLength(0);
    expect(h.sync.shadowSnapshot().has("el:k3")).toBe(true);   // …and it was really adopted
  });

  it("gives up LOUDLY rather than looping when the group will not settle", async () => {
    const h = makeHarness();
    h.setResponder(() => ({
      ok: true, applied: false, results: [],
      groupConflict: [{ assembly: "h", expected: "x", actual: "y", members: [] }],
    }));
    h.sync.reconcile({ els: moved(h.els) }, {});
    h.sync.flushGesture();
    await tick();
    for (let i = 0; i < 6; i += 1) { h.runTimers(); await tick(); }
    expect(h.events.some((e) => e.type === "client-stale" && e.reason === "group-conflict")).toBe(true);
    expect(h.sync.state).toBe("stale");
  });
});

describe("the server contract, read off the migration", () => {
  it("null or empty groups delegate to the 3-arg form — no client in the wild changes behaviour", () => {
    expect(SQL).toMatch(/if p_groups is null or jsonb_typeof\(p_groups\) <> 'array' or jsonb_array_length\(p_groups\) = 0 then/);
    expect(SQL).toMatch(/return public\.commit_elements\(p_site, p_ops, coalesce\(p_atomic, false\)\);/);
  });

  it("the check runs BEFORE anything is applied, and a mismatch writes nothing", () => {
    const body = SQL.slice(SQL.indexOf("create or replace function public.commit_elements(text, jsonb, boolean, jsonb)".replace(/\(.*/, "(p_site")));
    expect(SQL.indexOf("assembly_digest(p_site, v_asm)")).toBeLessThan(SQL.indexOf("return public.commit_elements(p_site, p_ops, true);"));
    expect(SQL).toMatch(/'applied', false, 'groupConflict', bad/);
    expect(body.length).toBeGreaterThan(0);
  });

  it("EVERY mismatching group is reported, not just the first", () => {
    // A client re-committing after a rejection needs to know about every group that moved, or it
    // is simply rejected again on the next one.
    expect(SQL).toMatch(/bad := bad \|\| jsonb_build_array/);
    expect(SQL).toMatch(/if jsonb_array_length\(bad\) > 0 then/);
  });

  it("a successful group check still goes through the ATOMIC form", () => {
    expect(SQL).toMatch(/return public\.commit_elements\(p_site, p_ops, true\);/);
  });
});

/* ⛔ THE REQUEST BODY, THROUGH THE REAL TRANSPORT — the B1120 lesson applied to stage 2.
 *
 * B1117 and B1116 were INERT in production for a whole release because the engine's `commit`
 * adapter had fixed arity and silently dropped `{ atomic }`, while every unit test passed through a
 * mock that accepted more parameters than the shipped adapter did. So the group half is asserted on
 * what `commitElements` actually puts on the wire, never on what a mock was handed.
 */
describe("what actually goes ON THE WIRE", () => {
  const fakeClient = (impl) => ({ rpc: async (fn, args) => impl(fn, args) });

  it("p_groups reaches the RPC, alongside p_atomic", async () => {
    let seen = null;
    const r = await commitElements(fakeClient((fn, args) => { seen = { fn, args }; return { data: { applied: true, results: [] } }; }),
      "s1", [{ op: "update", id: "h", kind: "el" }],
      { atomic: true, groups: [{ assembly: "h", expected: "h:1" }] });
    expect(seen.fn).toBe("commit_elements");
    expect(seen.args.p_atomic).toBe(true);
    expect(seen.args.p_groups).toEqual([{ assembly: "h", expected: "h:1" }]);
    expect(r.sentGroups).toBe(1);          // what went out, not what was asked for
  });

  it("groups NEVER ride on a non-atomic call — the two guarantees are one", async () => {
    let seen = null;
    await commitElements(fakeClient((fn, args) => { seen = args; return { data: [] }; }),
      "s1", [{ op: "update", id: "h", kind: "el" }],
      { atomic: false, groups: [{ assembly: "h", expected: "h:1" }] });
    expect(seen.p_groups).toBeUndefined();
    expect(seen.p_atomic).toBeUndefined();
  });

  it("a groupConflict reply is carried through verbatim — naming what moved is the point", async () => {
    const conflict = [{ assembly: "h", expected: "h:1", actual: "h:2", members: [{ id: "h", kind: "el", rev: 2 }] }];
    const r = await commitElements(fakeClient(() => ({ data: { applied: false, groupConflict: conflict, results: [] } })),
      "s1", [{ op: "update", id: "h", kind: "el" }], { atomic: true, groups: [{ assembly: "h", expected: "h:1" }] });
    expect(r.applied).toBe(false);
    expect(r.groupConflict).toEqual(conflict);
  });

  it("a project WITHOUT the migration degrades to the 3-arg atomic call, not to the per-row path", async () => {
    const seen = [];
    const client = fakeClient((fn, args) => {
      seen.push(args);
      if (args.p_groups) return { error: { code: "PGRST202", message: "Could not find the function" } };
      return { data: { applied: true, results: [] } };
    });
    const r = await commitElements(client, "s1", [{ op: "update", id: "h", kind: "el" }],
      { atomic: true, groups: [{ assembly: "h", expected: "h:1" }] });
    expect(seen[0].p_groups).toBeTruthy();
    expect(seen[1].p_groups).toBeUndefined();
    expect(seen[1].p_atomic).toBe(true);    // still ATOMIC — only the group check is given up
    expect(r.groupsFellBack).toBe(true);
    expect(r.ok).toBe(true);
  });
});
