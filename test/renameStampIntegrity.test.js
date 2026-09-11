import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* NEW-1 — THE RENAME MARKER MAY NEVER BE WRITTEN EMPTY.
 *
 * THE BUG THIS PINS, measured on `planyr_production` 2026-09-10 (not reasoned about):
 *
 *     marker state on public.sites.data->'siteRenamedAt'   rows
 *     ---------------------------------------------------------
 *     JSON null   (the key IS present, and it is EMPTY)      64
 *     number      (a real epoch-ms stamp)                    34
 *     key absent  (legacy — never written by a v13 client)   18
 *
 * A key that is PRESENT and null is a WRITE. Nothing absent-by-default produces it. It came from
 * the ordinary document push: `createSiteModel` normalizes a missing marker to an explicit
 * `siteRenamedAt: null`, `slimForCloud` passed that straight through, and `siteRowFor` sends the
 * whole model as `data`, which REPLACES the row's jsonb. So any device whose cached copy predated
 * a rename overwrote the rename's own stamp with an empty one.
 *
 * It is not theoretical. Group `smrp1wrgg6u5` — the Silvestri group this entire invariant was
 * built for — was renamed 2026-07-31T19:23:15.307Z; four of its five plans still carry that exact
 * stamp, and plan `sms9c5oc7jnt` carries JSON null with `updated_at` 2026-08-05, five days AFTER
 * the rename. A client document write erased a real timestamp, so `nameAuthority` lost the only
 * fact that lets a rename win a conflict and fell back to the legacy majority rule.
 *
 * THE PROPERTY: no rename path, and no ordinary write, may put a non-numeric marker on the wire.
 * "Missing or empty" is UNKNOWN and must be OMITTED, never asserted — an assertion of `null` is a
 * client claiming "this project has never been renamed", which is exactly the claim it cannot make.
 *
 * ⛔ TEETH. Every assertion below was run against the UNTOUCHED pre-fix source first and REQUIRED
 * to go red there (the preferred proof shape — NO-ONE-OWNS-A-COMPOSITE's own closing clause: point
 * the check at code you have not changed and make it fail BEFORE writing the fix). The
 * "the checker has teeth" cases in the last describe block keep that proof permanent: they feed the
 * real predicate the real pre-fix payload shape and require it to REJECT it, so a future edit that
 * softens the predicate into a rubber stamp fails here instead of passing everywhere.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "..", "src");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");

const memoryStorage = () => {
  const store = {};
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    key: (i) => Object.keys(store)[i] ?? null,
    get length() { return Object.keys(store).length; },
  };
};

/* ------------------------------------------------------------------ *
 * 1. The ONE parse. Every reader of the marker must ask the same
 *    question, or "unknown" and "never renamed" drift apart again.
 * ------------------------------------------------------------------ */
describe("renameStamp — the one parse for the rename marker", () => {
  it("reads a real epoch-ms stamp, however it arrived", async () => {
    const { renameStamp } = await import("../src/workspaces/site-planner/lib/projectName.js");
    expect(renameStamp(1785525795307)).toBe(1785525795307);
    // PostgREST hands `data->>'siteRenamedAt'` back as TEXT (dashboardSitesFetch selects exactly
    // that), so a numeric string is a KNOWN stamp, not an unknown one.
    expect(renameStamp("1785525795307")).toBe(1785525795307);
  });

  it("reads every empty shape as UNKNOWN — never as a number, never as zero", async () => {
    const { renameStamp } = await import("../src/workspaces/site-planner/lib/projectName.js");
    for (const empty of [null, undefined, "", "  ", "not-a-number", NaN, Infinity, -Infinity, 0, -1, {}, []])
      expect(renameStamp(empty)).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * 2. The wire. No payload leaving this client may carry an empty marker.
 * ------------------------------------------------------------------ */
describe("the wire payload can never carry an empty rename marker", () => {
  beforeEach(() => { globalThis.localStorage = memoryStorage(); });

  it("slimForCloud OMITS the marker when this device does not know one (it never asserts null)", async () => {
    const { slimForCloud } = await import("../src/workspaces/site-planner/lib/cloudSync.js");
    const { createSiteModel } = await import("../src/workspaces/site-planner/lib/siteModel.js");
    // createSiteModel normalizes an absent marker to an explicit null — that is the model's own
    // shape and is fine in memory. What must never happen is that null reaching the row.
    const model = createSiteModel({ id: "p1", groupId: "g1", site: "Woods Road" });
    expect(model.siteRenamedAt).toBeNull();
    const wire = slimForCloud(model);
    expect("siteRenamedAt" in wire).toBe(false);
  });

  it("slimForCloud KEEPS a real stamp untouched", async () => {
    const { slimForCloud } = await import("../src/workspaces/site-planner/lib/cloudSync.js");
    const { createSiteModel } = await import("../src/workspaces/site-planner/lib/siteModel.js");
    const wire = slimForCloud(createSiteModel({ id: "p1", groupId: "g1", site: "Woods Road", siteRenamedAt: 1785525795307 }));
    expect(wire.siteRenamedAt).toBe(1785525795307);
  });

  it("siteRowFor — the last gate before the column — carries no empty marker in `data`", async () => {
    const { siteRowFor, slimForCloud } = await import("../src/workspaces/site-planner/lib/cloudSync.js");
    const { createSiteModel } = await import("../src/workspaces/site-planner/lib/siteModel.js");
    const row = siteRowFor(slimForCloud(createSiteModel({ id: "p1", groupId: "g1", site: "Woods Road" })));
    expect("siteRenamedAt" in row.data).toBe(false);
  });

  it("a marker that arrived as TEXT is canonicalised to a number on the way out", async () => {
    const { slimForCloud } = await import("../src/workspaces/site-planner/lib/cloudSync.js");
    const wire = slimForCloud({ id: "p1", groupId: "g1", site: "Woods Road", siteRenamedAt: "1785525795307" });
    expect(wire.siteRenamedAt).toBe(1785525795307);
  });

  it("preserves object identity when there is nothing to normalise (headerSig must not churn)", async () => {
    const { normalizeRenameStampForWrite } = await import("../src/workspaces/site-planner/lib/projectName.js");
    const doc = { id: "p1", site: "Woods Road", siteRenamedAt: 1785525795307 };
    expect(normalizeRenameStampForWrite(doc)).toBe(doc);
    const none = { id: "p1", site: "Woods Road" };
    expect(normalizeRenameStampForWrite(none)).toBe(none);
  });
});

/* ------------------------------------------------------------------ *
 * 3. Every rename path stamps a real millisecond timestamp.
 * ------------------------------------------------------------------ */
describe("every rename path stamps a real millisecond timestamp", () => {
  beforeEach(() => { globalThis.localStorage = memoryStorage(); });

  it("renameSiteGroup stamps EVERY plan in the group with the same finite number", async () => {
    const { saveSite, loadSite, renameSiteGroup } = await import("../src/workspaces/site-planner/lib/storage.js");
    saveSite({ id: "g1", groupId: "g1", site: "Old", name: "Concept A" });
    saveSite({ id: "p2", groupId: "g1", site: "Old", name: "Concept B" });
    const res = await renameSiteGroup("g1", "Woods Road");
    expect(res.ok).toBe(true);
    expect(Number.isFinite(res.at)).toBe(true);
    expect(res.at).toBeGreaterThan(0);
    for (const id of ["g1", "p2"]) {
      const at = loadSite(id).siteRenamedAt;
      expect(typeof at).toBe("number");
      expect(Number.isFinite(at)).toBe(true);
      expect(at).toBe(res.at);
    }
  });

  it("a renamed plan's OWN push carries the stamp, so the group cannot be un-stamped by saving it", async () => {
    const { saveSite, loadSite, renameSiteGroup } = await import("../src/workspaces/site-planner/lib/storage.js");
    const { slimForCloud } = await import("../src/workspaces/site-planner/lib/cloudSync.js");
    saveSite({ id: "g1", groupId: "g1", site: "Old", name: "Concept A" });
    const res = await renameSiteGroup("g1", "Woods Road");
    saveSite({ id: "g1", els: [] });                    // an ordinary later edit
    expect(slimForCloud(loadSite("g1")).siteRenamedAt).toBe(res.at);
  });

  it("the RPC is called with a finite numeric p_renamed_at, and the fallback writes one too", async () => {
    const rpcCalls = [];
    const updates = [];
    vi.resetModules();
    vi.doMock("../src/workspaces/site-planner/lib/supabase.js", () => ({
      supabase: {
        rpc: (fn, args) => { rpcCalls.push({ fn, args }); return Promise.resolve({ data: [{ id: "g1", version: 2 }], error: null }); },
        from: () => ({
          select: () => Promise.resolve({ data: [{ id: "g1", data: { id: "g1", groupId: "g1", site: "Old" } }], error: null }),
          update: (body) => ({ eq: () => { updates.push(body); return Promise.resolve({ error: null }); } }),
        }),
      },
      supabaseRest: () => ({ url: "", anon: "" }),
      currentAccessToken: () => null,
      supabaseConfigured: () => true,
    }));
    const { cloudRenameGroup } = await import("../src/workspaces/site-planner/lib/cloudRename.js");

    const ok = await cloudRenameGroup("uid", "g1", "Woods Road", 1785525795307);
    expect(ok.ok).toBe(true);
    expect(rpcCalls[0].fn).toBe("rename_site_group");
    expect(Number.isFinite(rpcCalls[0].args.p_renamed_at)).toBe(true);
    expect(rpcCalls[0].args.p_renamed_at).toBeGreaterThan(0);

    // Even handed nothing, the RPC must never be asked to stamp an empty marker: a null
    // p_renamed_at makes jsonb_set (which is STRICT) return NULL and would blank the whole row.
    await cloudRenameGroup("uid", "g1", "Woods Road", null);
    await cloudRenameGroup("uid", "g1", "Woods Road", undefined);
    await cloudRenameGroup("uid", "g1", "Woods Road", "not-a-number");
    for (const c of rpcCalls) {
      expect(Number.isFinite(c.args.p_renamed_at)).toBe(true);
      expect(c.args.p_renamed_at).toBeGreaterThan(0);
    }
    vi.doUnmock("../src/workspaces/site-planner/lib/supabase.js");
    vi.resetModules();
  });
});

/* ------------------------------------------------------------------ *
 * 4. ONE implementation of the parse (DATA.md §3, one-answer functions).
 * ------------------------------------------------------------------ */
describe("the marker has exactly one parse in the client", () => {
  // Every file that reads the marker and turns it into a decision. Adding a reader means adding it
  // here AND routing it through renameStamp — a second hand-rolled `typeof … === "number"` test is
  // how "empty" and "never renamed" drifted apart in the first place.
  const READERS = [
    "workspaces/site-planner/lib/siteModel.js",
    "workspaces/site-planner/lib/siteListLight.js",
    "workspaces/site-planner/lib/cloudSync.js",
  ];

  it("no reader re-implements the numeric test inline", () => {
    const offenders = [];
    for (const rel of READERS) {
      const src = read(rel);
      // A hand-rolled shape test applied to the marker, anywhere on the same line.
      const lines = src.split("\n");
      lines.forEach((line, i) => {
        if (!line.includes("siteRenamedAt")) return;
        if (line.trim().startsWith("*") || line.trim().startsWith("//")) return; // prose
        if (/typeof\s+[\w.]*siteRenamedAt|isFinite\(|Number\(/.test(line) && !line.includes("renameStamp"))
          offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("projectName.js is the module that owns the parse", () => {
    const src = read("workspaces/site-planner/lib/projectName.js");
    expect(src).toMatch(/export function renameStamp/);
    expect(src).toMatch(/export function normalizeRenameStampForWrite/);
  });
});

/* ------------------------------------------------------------------ *
 * 5b. NEW-1 (2026-09-11) — a project renamed ONCE could never be renamed
 *     again: `saveSite`'s write choke point only ever compared an incoming
 *     write against this record's SIBLINGS in the same group, so a SOLO-PLAN
 *     project (no siblings to out-vote a stale write) had NO protection at
 *     all. Measured live against `planyr_production` (a throwaway row,
 *     rolled back, never a real project): a real `rename_site_group` RPC
 *     call followed by an "ordinary document save" carrying no stamp — the
 *     exact shape a planner autosave sends when its in-memory canvas never
 *     saw a rename made elsewhere — reverted the row's name and stamp via
 *     `sites_preserve_rename_stamp`, correctly, because that write really
 *     was indistinguishable from a stale save. The gap was never having sent
 *     it in the first place. Fixed by including the record's own EXISTING
 *     stored value as a candidate in `saveSite`'s authority check, not just
 *     its siblings — see storage.js's own header on this choke point for the
 *     algebraic argument that this can never skew a legacy majority repair.
 * ------------------------------------------------------------------ */
describe("saveSite's write choke point defends a SOLO-PLAN project too (NEW-1)", () => {
  beforeEach(() => { globalThis.localStorage = memoryStorage(); });

  it("an ordinary write with no stamp cannot regress an already-renamed single-plan project", async () => {
    const { saveSite, loadSite } = await import("../src/workspaces/site-planner/lib/storage.js");
    saveSite({ id: "solo1", groupId: "solo1", site: "First Name" });
    saveSite({ id: "solo1", site: "Second Name", siteRenamedAt: 1700000000000 }); // a genuine rename
    expect(loadSite("solo1").site).toBe("Second Name");

    // The reported mechanism: a stale in-memory model (an open planner canvas that never saw the
    // rename — it went straight to localStorage) performs an ordinary content save.
    saveSite({ id: "solo1", site: "First Name", els: [] });
    const after = loadSite("solo1");
    expect(after.site).toBe("Second Name");           // never regresses
    expect(after.siteRenamedAt).toBe(1700000000000);  // stamp preserved, not cleared
  });

  it("a stale write carrying an OLDER real stamp is corrected too — presence alone never wins", async () => {
    const { saveSite, loadSite } = await import("../src/workspaces/site-planner/lib/storage.js");
    saveSite({ id: "solo2", groupId: "solo2", site: "Old" });
    saveSite({ id: "solo2", site: "New", siteRenamedAt: 2000 });
    saveSite({ id: "solo2", site: "Stale Echo", siteRenamedAt: 1000 }); // real, but older
    const after = loadSite("solo2");
    expect(after.site).toBe("New");
    expect(after.siteRenamedAt).toBe(2000);
  });

  it("a genuinely NEWER rename still wins outright — the fix must never freeze a project's name", async () => {
    const { saveSite, loadSite } = await import("../src/workspaces/site-planner/lib/storage.js");
    saveSite({ id: "solo3", groupId: "solo3", site: "Old" });
    saveSite({ id: "solo3", site: "New", siteRenamedAt: 1000 });
    saveSite({ id: "solo3", site: "Newer Still", siteRenamedAt: 2000 });
    const after = loadSite("solo3");
    expect(after.site).toBe("Newer Still");
    expect(after.siteRenamedAt).toBe(2000);
  });

  it("renaming the SAME solo-plan project three times in a row sticks every time (the reported repro)", async () => {
    const { renameSiteGroup, loadSite, saveSite } = await import("../src/workspaces/site-planner/lib/storage.js");
    const id = "solo4";
    saveSite({ id, groupId: id, site: "Concept" });
    for (const name of ["First Rename", "Second Rename", "Third Rename"]) {
      const res = await renameSiteGroup(id, name);
      expect(res.ok).toBe(true);
      expect(loadSite(id).site).toBe(name);
      // A stale ordinary save fires right after, exactly as measured live, and must never win.
      saveSite({ id, site: "stale copy", els: [] });
      expect(loadSite(id).site).toBe(name);
    }
  });

  it("does not disturb a legacy, never-stamped multi-plan MAJORITY repair (repairSplitProjectNames)", async () => {
    const { saveSite, loadSite, repairSplitProjectNames } = await import("../src/workspaces/site-planner/lib/storage.js");
    saveSite({ id: "g1", groupId: "grpX", site: "New" });
    saveSite({ id: "g2", groupId: "grpX", site: "New" });
    saveSite({ id: "g3", groupId: "grpX", site: "Old" }); // the straggler
    const res = repairSplitProjectNames();
    expect(res.ok).toBe(true);
    expect(loadSite("g1").site).toBe("New");
    expect(loadSite("g2").site).toBe("New");
    expect(loadSite("g3").site).toBe("New");
  });

  it("reports a corrected write LOUDLY rather than silently accepting or rejecting it", async () => {
    vi.resetModules();
    const events = [];
    vi.doMock("../src/shared/telemetry/clientErrors.js", () => ({ reportClientEvent: (...args) => events.push(args) }));
    const { saveSite } = await import("../src/workspaces/site-planner/lib/storage.js");
    saveSite({ id: "solo5", groupId: "solo5", site: "Old" });
    saveSite({ id: "solo5", site: "New", siteRenamedAt: 5000 });
    saveSite({ id: "solo5", site: "Stale", els: [] });
    expect(events.some((e) => e[0] === "project-name-write-corrected")).toBe(true);
    vi.doUnmock("../src/shared/telemetry/clientErrors.js");
    vi.resetModules();
  });
});

/* ------------------------------------------------------------------ *
 * 5. The checker has teeth — it must REJECT the real pre-fix payload.
 * ------------------------------------------------------------------ */
describe("teeth — the predicate rejects the shape that actually shipped", () => {
  it("carriesEmptyRenameStamp flags the exact document the pre-fix client wrote", async () => {
    const { carriesEmptyRenameStamp } = await import("../src/workspaces/site-planner/lib/projectName.js");
    // Verbatim shape of the production row that lost its stamp (public.sites `sms9c5oc7jnt`).
    const preFix = { id: "sms9c5oc7jnt", groupId: "smrp1wrgg6u5", site: "Silvestri", siteRenamedAt: null, updatedAt: 1786000685350 };
    expect(carriesEmptyRenameStamp(preFix)).toBe(true);
    expect(carriesEmptyRenameStamp({ ...preFix, siteRenamedAt: 1785525795307 })).toBe(false);
    const { siteRenamedAt: _drop, ...omitted } = preFix;
    expect(carriesEmptyRenameStamp(omitted)).toBe(false); // omitted is UNKNOWN, not a claim
  });

  it("and the normaliser turns that document into one that is safe to send", async () => {
    const { normalizeRenameStampForWrite, carriesEmptyRenameStamp } = await import("../src/workspaces/site-planner/lib/projectName.js");
    const preFix = { id: "sms9c5oc7jnt", site: "Silvestri", siteRenamedAt: null };
    expect(carriesEmptyRenameStamp(normalizeRenameStampForWrite(preFix))).toBe(false);
    expect(normalizeRenameStampForWrite(preFix).site).toBe("Silvestri"); // nothing else is touched
  });
});
