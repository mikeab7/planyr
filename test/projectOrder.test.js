import { describe, it, expect, beforeEach, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  normalizeProjectOrder, orderProjects, orderedIds, moveProject, buildSavedOrder, ORDER_EPOCH_MS, planProjectMove, byNameToday,
} from "../src/shared/projects/projectOrder.js";
import { pursuitsTable } from "../src/workspaces/dashboard/lib/pursuitsList.js";
import { groupProjectsByGroupId } from "../src/workspaces/dashboard/lib/dashboardPipeline.js";
import { PursuitsCard } from "../src/workspaces/dashboard/components/PursuitsCard.jsx";

/* NEW-1 (2026-10-08) — owner-controlled project order. The complaint: the Pursuits card sorted
 * alphabetically, so "Eight South" sat above "Goose Creek" and "Grand Port". */

const OLD = Date.parse("2026-01-01T00:00:00Z");
const mk = (groupId, name, createdAt = OLD) => ({ groupId, siteId: `s-${groupId}`, name, county: null, status: "pursuit", role: "pursuit", createdAt });
const P = [mk("eight", "Eight South"), mk("goose", "Goose Creek"), mk("grand", "Grand Port"), mk("papa", "Papadopoulos")];
const names = (rows) => rows.map((r) => r.name);

describe("fallback — no saved order is exactly the old alphabetical list", () => {
  it("pursuitsTable without an order is alphabetical", () => {
    expect(names(pursuitsTable([P[3], P[2], P[0], P[1]], {}))).toEqual(["Eight South", "Goose Creek", "Grand Port", "Papadopoulos"]);
  });
  it("a null / junk saved order changes nothing", () => {
    for (const bad of [null, undefined, {}, { ids: "x" }, 5]) {
      expect(names(pursuitsTable(P, {}, bad))).toEqual(names(pursuitsTable(P, {})));
    }
  });
});

describe("the order he sets is the order that shows", () => {
  it("Grand Port and Goose Creek above Eight South", () => {
    const saved = buildSavedOrder(["grand", "goose", "eight", "papa"], Date.now());
    expect(names(pursuitsTable(P, {}, saved))).toEqual(["Grand Port", "Goose Creek", "Eight South", "Papadopoulos"]);
  });
  it("renaming a project does not reshuffle (order is keyed by group id, not name)", () => {
    const saved = buildSavedOrder(["grand", "goose", "eight", "papa"], Date.now());
    const renamed = P.map((p) => (p.groupId === "eight" ? { ...p, name: "Aardvark Park" } : p));
    expect(names(pursuitsTable(renamed, {}, saved))).toEqual(["Grand Port", "Goose Creek", "Aardvark Park", "Papadopoulos"]);
  });
  it("editing / opening a project (updated_at moves) does not reshuffle", () => {
    const saved = buildSavedOrder(["grand", "goose", "eight", "papa"], Date.now());
    expect(orderedIds(P.map((p) => ({ ...p, updatedAt: "2099-01-01" })), saved)).toEqual(["grand", "goose", "eight", "papa"]);
  });
});

describe("new, legacy and stale", () => {
  const at = Date.parse("2026-10-09T00:00:00Z");
  const saved = { ids: ["grand", "goose"], at };
  it("a project created AFTER the save lands on top, newest first", () => {
    const ps = [...P, mk("n1", "New One", at + 1000), mk("n2", "New Two", at + 5000)];
    expect(orderedIds(ps, saved).slice(0, 4)).toEqual(["n2", "n1", "grand", "goose"]);
  });
  it("older projects the list doesn't mention keep today's order BENEATH the positioned ones", () => {
    expect(orderedIds(P, saved)).toEqual(["grand", "goose", "eight", "papa"]);
  });
  it("with no saved order, only projects created after the ship date jump to the top", () => {
    const ps = [...P, mk("fresh", "Fresh", ORDER_EPOCH_MS + 60000)];
    expect(orderedIds(ps, null)).toEqual(["fresh", "eight", "goose", "grand", "papa"]);
  });
  it("a stale id (deleted / unshared) is skipped and never blanks the list", () => {
    const stale = { ids: ["ghost", "grand", "ghost2", "goose"], at };
    expect(orderedIds(P, stale)).toEqual(["grand", "goose", "eight", "papa"]);
    expect(orderedIds([], stale)).toEqual([]);
  });
  it("deleting a project leaves the rest in their saved order", () => {
    const s = { ids: ["grand", "goose", "eight", "papa"], at };
    expect(orderedIds(P.filter((p) => p.groupId !== "goose"), s)).toEqual(["grand", "eight", "papa"]);
  });
  it("normalize drops non-strings and duplicates", () => {
    expect(normalizeProjectOrder({ ids: ["a", 3, "a", "", null, "b"], at }).ids).toEqual(["a", "b"]);
  });
});

describe("moveProject", () => {
  const full = ["a", "b", "c", "d", "e"];
  it("to top / to bottom act on the whole list", () => {
    expect(moveProject(full, full, "d", { to: "top" })).toEqual(["d", "a", "b", "c", "e"]);
    expect(moveProject(full, full, "b", { to: "bottom" })).toEqual(["a", "c", "d", "e", "b"]);
  });
  it("drag index is among the VISIBLE rows; hidden projects keep their slots", () => {
    // visible subset b,d,e (a and c belong to other statuses)
    expect(moveProject(full, ["b", "d", "e"], "e", { index: 0 })).toEqual(["a", "e", "c", "b", "d"]);
    expect(moveProject(full, ["b", "d", "e"], "b", { index: 2 })).toEqual(["a", "d", "c", "e", "b"]);
  });
  it("unknown id / no-op / bad dest leave the list alone", () => {
    expect(moveProject(full, full, "zz", { to: "top" })).toEqual(full);
    expect(moveProject(full, full, "c", { index: 2 })).toEqual(full);
    expect(moveProject(full, full, "c", {})).toEqual(full);
  });
});

describe("group createdAt = the project's earliest plan", () => {
  it("is carried out of groupProjectsByGroupId", () => {
    const g = groupProjectsByGroupId([
      { id: "p1", group_id: "g", site: "X", created_at: "2026-03-02T00:00:00Z", updated_at: "2026-04-01T00:00:00Z" },
      { id: "p2", group_id: "g", site: "X", created_at: "2026-02-01T00:00:00Z", updated_at: "2026-05-01T00:00:00Z" },
    ], {});
    expect(g[0].createdAt).toBe(Date.parse("2026-02-01T00:00:00Z"));
  });
});

describe("PursuitsCard controls", () => {
  const rows = pursuitsTable(P, {});
  it("renders a grip and an order menu per row only when it can reorder", () => {
    const withMove = renderToStaticMarkup(createElement(PursuitsCard, { rows, onMove: () => {} }));
    expect((withMove.match(/data-project-grip=/g) || []).length).toBe(4);
    expect(withMove).toMatch(/Order options for Eight South/);
    const without = renderToStaticMarkup(createElement(PursuitsCard, { rows }));
    expect(without).not.toMatch(/data-project-grip/);
  });
  it("surfaces a failed save loudly, with Retry", () => {
    const html = renderToStaticMarkup(createElement(PursuitsCard, { rows, onMove: () => {}, orderError: "boom", onRetryOrder: () => {} }));
    expect(html).toMatch(/save your project order/);
    expect(html).toMatch(/Retry/);
    expect(renderToStaticMarkup(createElement(PursuitsCard, { rows, onMove: () => {} }))).not.toMatch(/Couldn.t save/);
  });
});

/* ── persistence ───────────────────────────────────────────────────────────────────────── */
const h = vi.hoisted(() => ({ row: null, upsertErr: null, upserts: [] }));
vi.mock("../src/workspaces/site-planner/lib/supabase.js", () => ({
  supabase: {
    from: (table) => {
      if (table !== "profiles") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: h.row, error: null }) }) }),
        upsert: (payload) => {
          h.upserts.push(payload);
          if (h.upsertErr) return Promise.resolve({ error: h.upsertErr });
          h.row = { id: payload.id, prefs: payload.prefs };
          return Promise.resolve({ error: null });
        },
      };
    },
  },
}));

describe("dashboardProjectOrderPrefs", () => {
  let prefs, cache;
  beforeEach(async () => {
    h.row = null; h.upsertErr = null; h.upserts = [];
    prefs = await import("../src/workspaces/dashboard/lib/dashboardProjectOrderPrefs.js");
    cache = await import("../src/shared/profile/profileRowCache.js");
    cache.invalidateProfileRow();
  });
  it("round-trips through the account row and leaves other prefs keys intact", async () => {
    h.row = { prefs: { dashboardLayout: [{ key: "x" }], sitesPanel: { pinned: ["a"] } } };
    const order = buildSavedOrder(["g", "a"], 123456);
    expect((await prefs.saveProjectOrder("u1", order)).ok).toBe(true);
    expect(h.row.prefs.sitesPanel).toEqual({ pinned: ["a"] });
    expect(h.row.prefs.dashboardLayout).toEqual([{ key: "x" }]);
    expect((await prefs.loadProjectOrder("u1")).order).toEqual({ ids: ["g", "a"], at: 123456 });
  });
  it("a different user's row is untouched by this user's order", async () => {
    h.row = { prefs: {} };
    await prefs.saveProjectOrder("u1", buildSavedOrder(["g"], 1));
    cache.invalidateProfileRow();
    h.row = { prefs: {} }; // the other user's own row
    expect((await prefs.loadProjectOrder("u2")).order).toBeNull();
  });
  it("a failed cloud write reports ok:false with the reason (LOUD-FAILURE)", async () => {
    h.row = { prefs: {} };
    h.upsertErr = { message: "rls says no" };
    const res = await prefs.saveProjectOrder("u1", buildSavedOrder(["g"], 1));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/rls says no/);
  });
});

describe("planProjectMove / byNameToday — the one move shared by the Dashboard card and the Task Report", () => {
  const P = [
    { groupId: "e", name: "8 South", createdAt: Date.parse("2026-01-01") },
    { groupId: "g", name: "Goose Creek", createdAt: Date.parse("2026-01-02") },
    { groupId: "p", name: "Grand Port", createdAt: Date.parse("2026-01-03") },
  ];
  it("today's order is alphabetical by name ('8 South' first)", () => {
    expect(byNameToday(P).map((p) => p.groupId)).toEqual(["e", "g", "p"]);
  });
  it("moving Grand Port to the top writes a full list with it first", () => {
    const next = planProjectMove(P, null, "p", { to: "top" }, ["e", "g", "p"], 123);
    expect(next).toEqual({ ids: ["p", "e", "g"], at: 123 });
  });
  it("index moves are relative to the visible ids; a no-op returns null", () => {
    expect(planProjectMove(P, null, "e", { index: 2 }, ["e", "g", "p"]).ids).toEqual(["g", "p", "e"]);
    expect(planProjectMove(P, null, "e", { to: "top" }, ["e", "g", "p"])).toBeNull();
  });
});
