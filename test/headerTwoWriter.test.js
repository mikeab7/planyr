import { describe, it, expect, beforeEach, vi } from "vitest";

/* B1953797 (H1) — TWO WRITERS, ONE PLAN HEADER.
 *
 * The RED-PROOF harness (DANGEROUS-MEANS-UNOBSERVABLE): before this item nothing could OBSERVE that
 * a plan's `settings` are pushed as a whole object, last write wins. This drives the REAL cloud-push
 * path (`cloudUpsert` → `casUpsert` → the conflict self-heal) for TWO tabs — two independent module
 * instances of cloudSync.js (its version token / baselines are per-tab module state) — against one
 * shared in-memory `sites` table that implements the real compare-and-swap semantics.
 *
 *   tab A sets Flood-mitigation jurisdiction = Waller           → server v2
 *   tab B (older copy) changes the setback; its CAS conflicts    → refetch + re-push
 *   BEFORE: B re-pushes ITS whole, older settings → jurKey back to Harris. A's change silently lost.
 *   AFTER : B re-applies ONLY what B changed onto the fresh server copy → both edits survive.
 */
const h = vi.hoisted(() => ({ rows: {}, reported: [], writes: [] }));

vi.mock("../src/workspaces/site-planner/lib/supabase.js", () => {
  // A minimal PostgREST-shaped fake of the ONE table this path touches, with real CAS semantics.
  const from = (table) => {
    if (table !== "sites") throw new Error("unexpected table " + table);
    return {
      insert: (row) => ({
        select: async () => {
          if (h.rows[row.id]) return { data: null, error: { code: "23505", message: "duplicate" } };
          h.rows[row.id] = { id: row.id, data: row.data, version: 1 };
          h.writes.push({ id: row.id, data: row.data, version: 1 });
          return { data: [{ version: 1 }], error: null };
        },
      }),
      update: (payload) => {
        const f = {};
        const q = {
          eq: (c, v) => { f[c] = v; return q; },
          select: async () => {
            const r = h.rows[f.id];
            if (!r || r.version !== f.version) return { data: [], error: null };
            r.data = payload.data; r.version = payload.version;
            h.writes.push({ id: r.id, data: payload.data, version: payload.version });
            return { data: [{ version: r.version }], error: null };
          },
        };
        return q;
      },
      select: () => {
        const f = {};
        const q = {
          eq: (c, v) => { f[c] = v; return q; },
          maybeSingle: async () => {
            const r = h.rows[f.id];
            return { data: r ? { data: JSON.parse(JSON.stringify(r.data)), version: r.version } : null, error: null };
          },
          is: () => ({ order: async () => ({ data: Object.values(h.rows).map((r) => ({ id: r.id, data: JSON.parse(JSON.stringify(r.data)), version: r.version, team_id: null, user_id: "u1", share_locked: false })), error: null }) }),
        };
        return q;
      },
    };
  };
  return { supabase: { from }, supabaseRest: () => ({ url: "", anon: "" }), currentAccessToken: () => null };
});
vi.mock("../src/shared/telemetry/clientErrors.js", () => ({
  reportClientEvent: (...args) => { h.reported.push(args); },
}));

const SITE = "s1";
const seedHeader = () => ({
  id: SITE, name: "Plan 1", site: "Goose Creek", updatedAt: 1000,
  els: [], markups: [], measures: [], callouts: [], parcels: [], elementsInRows: true,
  settings: { setback: 25, stalls: 9, floodMitigation: { jurKey: "harris", mode: "auto" }, drainage: { lastCheck: 100 } },
  origin: { lat: 29.7, lon: -95.4 },
});

async function openTab() {
  vi.resetModules();
  const cs = await import("../src/workspaces/site-planner/lib/cloudSync.js");
  const sm = await import("../src/workspaces/site-planner/lib/siteModel.js");
  await cs.cloudList("u1"); // the tab's load: learns the server version (and, post-fix, its merge BASE)
  return { cs, sm };
}
const edit = (sm, header, mut) => sm.createSiteModel({ ...header, ...mut(header), updatedAt: header.updatedAt + 1 });

describe("H1 — two tabs, one plan header (settings must merge per key, never last-write-wins)", () => {
  beforeEach(() => { h.rows = { [SITE]: { id: SITE, data: seedHeader(), version: 1 } }; h.reported.length = 0; h.writes.length = 0; });

  it("THE LOSS: tab B's stale-CAS heal must not revert tab A's jurisdiction change", async () => {
    const A = await openTab();
    const B = await openTab();
    const cur = () => h.rows[SITE].data;

    // A: jurisdiction Waller.
    const aModel = edit(A.sm, cur(), (d) => ({ settings: { ...d.settings, floodMitigation: { ...d.settings.floodMitigation, jurKey: "waller" } } }));
    expect((await A.cs.cloudUpsert("u1", aModel)).ok).toBe(true);
    expect(cur().settings.floodMitigation.jurKey).toBe("waller");

    // B (never saw A's write): setback 25 → 30 on ITS older copy. Its CAS is stale → conflict → heal.
    const bModel = edit(B.sm, seedHeader(), (d) => ({ settings: { ...d.settings, setback: 30 } }));
    const r = await B.cs.cloudUpsert("u1", bModel);
    expect(r.ok).toBe(true);

    expect(cur().settings.setback).toBe(30);                          // B's own edit landed
    expect(cur().settings.floodMitigation.jurKey).toBe("waller");     // A's edit was NOT undone
    expect(cur().settings.floodMitigation.mode).toBe("auto");         // untouched sibling leaf intact
    expect(cur().settings.stalls).toBe(9);
  });

  it("the healing tab is TOLD what it adopted (so its UI + local mirror can follow)", async () => {
    const A = await openTab();
    const B = await openTab();
    const aModel = edit(A.sm, h.rows[SITE].data, (d) => ({ settings: { ...d.settings, floodMitigation: { ...d.settings.floodMitigation, jurKey: "waller" } } }));
    await A.cs.cloudUpsert("u1", aModel);
    const bModel = edit(B.sm, seedHeader(), (d) => ({ settings: { ...d.settings, setback: 30 } }));
    const r = await B.cs.cloudUpsert("u1", bModel);
    expect(r.adopted).toBeTruthy();
    const { applyLeafPatches } = await import("../src/workspaces/site-planner/lib/headerMerge.js");
    const uiNow = applyLeafPatches({ settings: bModel.settings }, r.adopted);   // what the live UI applies
    expect(uiNow.settings.floodMitigation.jurKey).toBe("waller");
    expect(uiNow.settings.setback).toBe(30);                                    // and B's own edit is untouched
  });

  it("a true same-leaf clash keeps THIS tab's deliberate edit and reports it (never silent)", async () => {
    const A = await openTab();
    const B = await openTab();
    await A.cs.cloudUpsert("u1", edit(A.sm, h.rows[SITE].data, (d) => ({ settings: { ...d.settings, setback: 40 } })));
    const r = await B.cs.cloudUpsert("u1", edit(B.sm, seedHeader(), (d) => ({ settings: { ...d.settings, setback: 30 } })));
    expect(r.ok).toBe(true);
    expect(h.rows[SITE].data.settings.setback).toBe(30);
    expect(h.reported.some((e) => e[0] === "cloud-conflict-healed" && (e[2].conflicts || []).includes("settings.setback"))).toBe(true);
  });

  it("origin / layerOverrides merge per key too (A moves the origin, B toggles a layer)", async () => {
    const A = await openTab();
    const B = await openTab();
    await A.cs.cloudUpsert("u1", edit(A.sm, h.rows[SITE].data, () => ({ origin: { lat: 30.1, lon: -95.4 } })));
    await B.cs.cloudUpsert("u1", edit(B.sm, seedHeader(), () => ({ layerOverrides: { fema: false } })));
    expect(h.rows[SITE].data.origin).toEqual({ lat: 30.1, lon: -95.4 });
    expect(h.rows[SITE].data.layerOverrides).toEqual({ fema: false });
  });

  it("a tab whose copy is current pushes normally (no adoption, no telemetry noise)", async () => {
    const A = await openTab();
    const r = await A.cs.cloudUpsert("u1", edit(A.sm, h.rows[SITE].data, (d) => ({ settings: { ...d.settings, setback: 33 } })));
    expect(r.ok).toBe(true);
    expect(r.adopted).toBeUndefined();
    expect(h.reported.filter((e) => e[0] === "cloud-conflict-healed")).toHaveLength(0);
  });
});

describe("H1 — the inbound path: an open tab with no local edits adopts the other writer's header change", () => {
  beforeEach(() => { h.rows = { [SITE]: { id: SITE, data: seedHeader(), version: 1 } }; h.reported.length = 0; h.writes.length = 0; });

  it("refreshHeaderFromCloud adopts A's jurisdiction into an idle tab B, without pushing anything", async () => {
    const A = await openTab();
    const B = await openTab();
    await A.cs.cloudUpsert("u1", edit(A.sm, h.rows[SITE].data, (d) => ({ settings: { ...d.settings, floodMitigation: { ...d.settings.floodMitigation, jurKey: "waller" } } })));
    const writesBefore = h.writes.length;
    const live = B.sm.createSiteModel(seedHeader()); // B's open canvas: still the old copy, no dirty edits
    const r = await B.cs.refreshHeaderFromCloud("u1", SITE, live);
    expect(r.ok).toBe(true);
    expect(r.changed).toBe(true);
    expect(r.merged.settings.floodMitigation.jurKey).toBe("waller");
    expect(h.writes.length).toBe(writesBefore);                       // adopting is NOT a write
    // and B's next real edit now pushes cleanly on top of A's, with nothing reverted:
    const bNow = B.sm.createSiteModel({ ...seedHeader(), ...r.merged, updatedAt: 2000, settings: { ...r.merged.settings, setback: 31 } });
    expect((await B.cs.cloudUpsert("u1", bNow)).ok).toBe(true);
    expect(h.rows[SITE].data.settings.floodMitigation.jurKey).toBe("waller");
    expect(h.rows[SITE].data.settings.setback).toBe(31);
    expect(h.reported.filter((e) => e[0] === "cloud-conflict-healed")).toHaveLength(0); // no conflict needed — token was refreshed
  });

  it("a tab with a LOCAL dirty edit keeps it while adopting the rest (and still owes a push)", async () => {
    const A = await openTab();
    const B = await openTab();
    await A.cs.cloudUpsert("u1", edit(A.sm, h.rows[SITE].data, (d) => ({ settings: { ...d.settings, floodMitigation: { ...d.settings.floodMitigation, jurKey: "waller" } } })));
    const live = B.sm.createSiteModel({ ...seedHeader(), settings: { ...seedHeader().settings, setback: 30 } }); // B typed a setback
    const r = await B.cs.refreshHeaderFromCloud("u1", SITE, live);
    expect(r.merged.settings.setback).toBe(30);
    expect(r.merged.settings.floodMitigation.jurKey).toBe("waller");
    expect(r.dirty).toBe(true);
  });

  it("a MID-SESSION PULL refreshes the token but must not hide the change: refresh still adopts it, and a push merges it", async () => {
    const A = await openTab();
    const B = await openTab();
    await A.cs.cloudUpsert("u1", edit(A.sm, h.rows[SITE].data, (d) => ({ settings: { ...d.settings, floodMitigation: { ...d.settings.floodMitigation, jurKey: "waller" } } })));
    await B.cs.cloudList("u1");   // e.g. SitePlannerApp's pullCloud: B's CAS token now reads the fresh version
    // (a) an idle B still adopts on refresh even though its token is already current
    const live = B.sm.createSiteModel(seedHeader());
    const r = await B.cs.refreshHeaderFromCloud("u1", SITE, live);
    expect(r.changed).toBe(true);
    expect(r.merged.settings.floodMitigation.jurKey).toBe("waller");
  });

  it("…and a B that pulled mid-session then PUSHES an unrelated edit does not overwrite what it never adopted", async () => {
    const A = await openTab();
    const B = await openTab();
    await A.cs.cloudUpsert("u1", edit(A.sm, h.rows[SITE].data, (d) => ({ settings: { ...d.settings, floodMitigation: { ...d.settings.floodMitigation, jurKey: "waller" } } })));
    await B.cs.cloudList("u1");
    const r = await B.cs.cloudUpsert("u1", edit(B.sm, seedHeader(), (d) => ({ settings: { ...d.settings, setback: 30 } })));
    expect(r.ok).toBe(true);
    expect(h.rows[SITE].data.settings.setback).toBe(30);
    expect(h.rows[SITE].data.settings.floodMitigation.jurKey).toBe("waller");
    expect(r.adopted).toBeTruthy();
  });

  it("nothing newer on the server → unchanged (the common focus-ping is free of side effects)", async () => {
    const B = await openTab();
    const r = await B.cs.refreshHeaderFromCloud("u1", SITE, B.sm.createSiteModel(seedHeader()));
    expect(r.ok).toBe(true);
    expect(r.changed).toBe(false);
    expect(r.unchanged).toBe(true);
  });
});
