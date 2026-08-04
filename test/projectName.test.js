/* NEW-1 / NEW-2 / NEW-3 — a project's name has ONE authority, and a rename cannot half-land.
 *
 * LIVE EVIDENCE these tests are written against (queried from planyr_production while writing them,
 * verbatim — one project, five plans, TWO names, split for four days):
 *
 *   group smrp1wrgg6u5
 *     smrv5wu7ftsj  site="Silvestri"  Concept C - Full 275' Frontage      2026-07-31 19:23:15.256
 *     smrp1wrgg6u5  site="Silvestri"  Concept A                           2026-07-31 19:23:15.307
 *     smrv22098jqz  site="Silvestri"  Concept B                           2026-07-31 19:23:15.358
 *     sms9c5oc7jnt  site="Silvestri"  Concept D - Silvestri Retail PRINT  2026-07-31 20:04:19.928
 *     sms4zs8unbkg  site="Sylvestri"  Concept D - Sylvestri Retail        2026-07-31 19:40:59.082
 *
 * The .256/.307/.358 writes are ONE `loadPlansOfGroup` loop — the rename. `sms4zs8unbkg` was saved
 * SEVENTEEN MINUTES LATER, after the rename, and still says "Sylvestri": it was not in the local
 * set when the rename ran, so it kept the old spelling and wrote it back to the cloud.
 *
 * THE TRAP THIS FIXTURE ENCODES, and why `siteRenamedAt` had to be added rather than inferring the
 * winner from timestamps: the STALE plan is NOT the oldest one here, and in the general case it can
 * easily be the NEWEST — `sms9c5oc7jnt` (Silvestri, 20:04) happens to be later than the straggler,
 * but nothing makes that true. "Most recently updated wins" is therefore not a rule, it is a coin
 * flip. Do not "simplify" the authority back onto `updatedAt`.
 */
import { describe, it, expect } from "vitest";
import {
  nameAuthority, reconcileGroupNames, resolveNameFor, byGroup, groupKeyOf,
} from "../src/workspaces/site-planner/lib/projectName.js";
import { createSiteModel } from "../src/workspaces/site-planner/lib/siteModel.js";

const ms = (s) => Date.parse(s);

// The owner's real group, as stored (no rename stamps anywhere — this is the legacy shape).
const SILVESTRI = () => [
  { id: "smrv5wu7ftsj", groupId: "smrp1wrgg6u5", site: "Silvestri", name: "Concept C - Full 275' Frontage", updatedAt: ms("2026-07-31T19:23:15.256Z") },
  { id: "smrp1wrgg6u5", groupId: "smrp1wrgg6u5", site: "Silvestri", name: "Concept A", updatedAt: ms("2026-07-31T19:23:15.307Z") },
  { id: "smrv22098jqz", groupId: "smrp1wrgg6u5", site: "Silvestri", name: "Concept B", updatedAt: ms("2026-07-31T19:23:15.358Z") },
  { id: "sms4zs8unbkg", groupId: "smrp1wrgg6u5", site: "Sylvestri", name: "Concept D - Sylvestri Retail", updatedAt: ms("2026-07-31T19:40:59.082Z") },
  { id: "sms9c5oc7jnt", groupId: "smrp1wrgg6u5", site: "Silvestri", name: "Concept D - Silvestri Retail PRINT", updatedAt: ms("2026-07-31T20:04:19.928Z") },
];

describe("nameAuthority — which name a project actually has", () => {
  it("a coherent group answers with its one name", () => {
    const a = nameAuthority(SILVESTRI().map((p) => ({ ...p, site: "Silvestri" })));
    expect(a.name).toBe("Silvestri");
    expect(a.ambiguous).toBe(false);
  });

  it("the owner's real split resolves to Silvestri on the legacy majority rule", () => {
    const a = nameAuthority(SILVESTRI());
    expect(a.name).toBe("Silvestri");
    expect(a.basis).toBe("majority");
    expect(a.ambiguous).toBe(false);
  });

  it("a stamp OUTRANKS the majority — a real rename beats four stale copies", () => {
    // The rename the owner just made: one plan hydrated, stamped; four not yet converged.
    const plans = SILVESTRI().map((p) => ({ ...p, site: "Silvestri" }));
    plans[1] = { ...plans[1], site: "Silvestri Retail", siteRenamedAt: ms("2026-08-04T10:00:00Z") };
    const a = nameAuthority(plans);
    expect(a.name).toBe("Silvestri Retail");
    expect(a.basis).toBe("stamp");
  });

  it("the NEWEST stamp wins, not the newest updatedAt", () => {
    const plans = [
      { id: "a", groupId: "g", site: "Old", siteRenamedAt: 1000, updatedAt: 9_000_000 }, // saved last…
      { id: "b", groupId: "g", site: "New", siteRenamedAt: 2000, updatedAt: 1 },          // …but renamed last
    ];
    expect(nameAuthority(plans).name).toBe("New");
  });

  it("an UNSTAMPED stale plan cannot outvote a stamped rename however recently it was saved", () => {
    // This is the exact re-publish move: sms4zs8unbkg saving 17 minutes after the rename.
    const plans = [
      { id: "a", groupId: "g", site: "Silvestri", siteRenamedAt: 5000, updatedAt: 5000 },
      { id: "b", groupId: "g", site: "Silvestri", siteRenamedAt: 5000, updatedAt: 5000 },
      { id: "stale", groupId: "g", site: "Sylvestri", updatedAt: 9_999_999 },
    ];
    expect(nameAuthority(plans).name).toBe("Silvestri");
  });

  it("REFUSES to guess when a legacy group has no majority — it reports instead", () => {
    const plans = [
      { id: "a", groupId: "g", site: "Alpha", updatedAt: 2 },
      { id: "b", groupId: "g", site: "Beta", updatedAt: 1 },
    ];
    const a = nameAuthority(plans);
    expect(a.ambiguous).toBe(true);
    expect(a.name).toBe(null);
    expect(a.names.sort()).toEqual(["Alpha", "Beta"]);
  });

  it("a single-plan project is never ambiguous", () => {
    expect(nameAuthority([{ id: "a", groupId: "a", site: "Solo", updatedAt: 1 }]).name).toBe("Solo");
  });

  it("once stamped, a group ALWAYS resolves — even on a same-instant two-name tie", () => {
    const plans = [
      { id: "a", groupId: "g", site: "Alpha", siteRenamedAt: 7, updatedAt: 1 },
      { id: "b", groupId: "g", site: "Alpha", siteRenamedAt: 7, updatedAt: 1 },
      { id: "c", groupId: "g", site: "Beta", siteRenamedAt: 7, updatedAt: 1 },
    ];
    const a = nameAuthority(plans);
    expect(a.ambiguous).toBe(false);
    expect(a.name).toBe("Alpha"); // count breaks the tie deterministically
  });

  it("never votes with the PLAN name — 'Concept A' must not become a project name", () => {
    const a = nameAuthority(SILVESTRI().map((p) => ({ ...p, site: "Silvestri" })));
    expect(a.name).toBe("Silvestri");
    expect(["Concept A", "Concept B"]).not.toContain(a.name);
  });
});

describe("reconcileGroupNames — the NEW-3 repair pass", () => {
  it("converges the owner's real split onto Silvestri and names the plan it fixed", () => {
    const { models, changes } = reconcileGroupNames(SILVESTRI());
    expect(models.every((m) => m.site === "Silvestri")).toBe(true);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ id: "sms4zs8unbkg", from: "Sylvestri", to: "Silvestri", groupId: "smrp1wrgg6u5" });
  });

  it("is IDEMPOTENT — a second pass changes nothing", () => {
    const once = reconcileGroupNames(SILVESTRI());
    const twice = reconcileGroupNames(once.models);
    expect(twice.changes).toHaveLength(0);
    expect(twice.ambiguous).toHaveLength(0);
    // and it does not churn object identity on an already-coherent store
    expect(twice.models.every((m, i) => m === once.models[i])).toBe(true);
  });

  it("preserves identity for every plan it does not need to touch", () => {
    const input = SILVESTRI();
    const { models } = reconcileGroupNames(input);
    const untouched = models.filter((m) => m.id !== "sms4zs8unbkg");
    expect(untouched.every((m) => input.includes(m))).toBe(true);
  });

  it("leaves an ambiguous group ALONE and reports it, rather than renaming half a project", () => {
    const plans = [
      { id: "a", groupId: "g", site: "Alpha", updatedAt: 2 },
      { id: "b", groupId: "g", site: "Beta", updatedAt: 1 },
    ];
    const { models, changes, ambiguous } = reconcileGroupNames(plans);
    expect(changes).toHaveLength(0);
    expect(models[0].site).toBe("Alpha");
    expect(models[1].site).toBe("Beta");
    expect(ambiguous).toEqual([{ groupId: "g", names: ["Alpha", "Beta"], plans: 2 }]);
  });

  it("does not leak one project's name into another", () => {
    const plans = [
      ...SILVESTRI(),
      { id: "x1", groupId: "other", site: "Tsakiris", updatedAt: 5 },
      { id: "x2", groupId: "other", site: "Tsakiris", updatedAt: 6 },
    ];
    const { models } = reconcileGroupNames(plans);
    expect(models.filter((m) => m.groupId === "other").every((m) => m.site === "Tsakiris")).toBe(true);
    expect(models.filter((m) => m.groupId === "smrp1wrgg6u5").every((m) => m.site === "Silvestri")).toBe(true);
  });

  it("mirrors the stamp across the group so the next read needs no majority guess", () => {
    const plans = [
      { id: "a", groupId: "g", site: "New", siteRenamedAt: 4242, updatedAt: 1 },
      { id: "b", groupId: "g", site: "Old", updatedAt: 2 },
    ];
    const { models } = reconcileGroupNames(plans);
    expect(models.map((m) => m.siteRenamedAt)).toEqual([4242, 4242]);
  });

  it("a group whose plans disagree AND whose ids differ from the group key still converges", () => {
    // groupKeyOf falls back to the record's own id for a pre-grouping record.
    expect(groupKeyOf({ id: "solo" })).toBe("solo");
    expect(byGroup([{ id: "solo" }, { id: "p", groupId: "g" }]).size).toBe(2);
  });
});

describe("resolveNameFor — the write choke point", () => {
  it("corrects a stale record on its way into the store (the re-publish move)", () => {
    const stale = { id: "sms4zs8unbkg", groupId: "smrp1wrgg6u5", site: "Sylvestri", updatedAt: 9_999_999 };
    const siblings = SILVESTRI().filter((p) => p.id !== stale.id).map((p) => ({ ...p, site: "Silvestri", siteRenamedAt: 5000 }));
    expect(resolveNameFor(stale, siblings)).toEqual({ site: "Silvestri", siteRenamedAt: 5000 });
  });

  it("lets a GENUINE rename through — the record being written votes with the newest stamp", () => {
    const renaming = { id: "smrp1wrgg6u5", groupId: "smrp1wrgg6u5", site: "Silvestri Retail", siteRenamedAt: 9_000_000, updatedAt: 1 };
    const siblings = SILVESTRI().filter((p) => p.id !== renaming.id).map((p) => ({ ...p, siteRenamedAt: 5000, site: "Silvestri" }));
    expect(resolveNameFor(renaming, siblings)).toBe(null); // already authoritative → no correction
  });

  it("returns null (no write, no churn) when the record already agrees", () => {
    const rec = { id: "a", groupId: "g", site: "Same", siteRenamedAt: 10, updatedAt: 1 };
    expect(resolveNameFor(rec, [{ id: "b", groupId: "g", site: "Same", siteRenamedAt: 10, updatedAt: 2 }])).toBe(null);
  });

  it("returns null for an ambiguous group rather than picking a side", () => {
    const rec = { id: "a", groupId: "g", site: "Alpha", updatedAt: 2 };
    expect(resolveNameFor(rec, [{ id: "b", groupId: "g", site: "Beta", updatedAt: 1 }])).toBe(null);
  });

  it("a brand-new plan added to a renamed project adopts the project's name", () => {
    const fresh = { id: "new", groupId: "g", site: "Untitled site", updatedAt: 100 };
    const siblings = [{ id: "a", groupId: "g", site: "Silvestri", siteRenamedAt: 500, updatedAt: 1 }];
    expect(resolveNameFor(fresh, siblings)).toEqual({ site: "Silvestri", siteRenamedAt: 500 });
  });
});

describe("the model carries the stamp", () => {
  it("createSiteModel keeps a real siteRenamedAt and nulls anything else", () => {
    expect(createSiteModel({ id: "a", site: "S", siteRenamedAt: 1234 }).siteRenamedAt).toBe(1234);
    expect(createSiteModel({ id: "a", site: "S" }).siteRenamedAt).toBe(null);
    expect(createSiteModel({ id: "a", site: "S", siteRenamedAt: "nope" }).siteRenamedAt).toBe(null);
    expect(createSiteModel({ id: "a", site: "S", siteRenamedAt: -5 }).siteRenamedAt).toBe(null);
  });

  it("a round-trip through the model preserves the authority decision", () => {
    const plans = SILVESTRI().map((p) => createSiteModel(p));
    const { models, changes } = reconcileGroupNames(plans);
    expect(changes).toHaveLength(1);
    expect(models.every((m) => m.site === "Silvestri")).toBe(true);
  });
});
