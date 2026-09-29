// B1953794 — verdict-A stale-copy fixes: one place per changeable value, derived at read time.
import { describe, it, expect, vi } from "vitest";
import { DEFAULT_FLOODPLAIN_RULES, ruleSignature } from "../src/workspaces/site-planner/lib/floodplainRules.js";
import { resolveEasementJur } from "../src/workspaces/site-planner/lib/easementRules.js";
import { buildingCountBySite, yieldBySite } from "../src/workspaces/dashboard/lib/buildingYield.js";
import { isBuilding } from "../src/workspaces/site-planner/lib/siteModel.js";
import { pickRepresentativePlan, planRecencyMs } from "../src/workspaces/site-planner/lib/siteRecency.js";
import { groupProjectsByGroupId } from "../src/workspaces/dashboard/lib/dashboardPipeline.js";
import { createThumbnailRefresher } from "../src/workspaces/site-planner/lib/siteThumbnail.js";

describe("A7 rule signature (memo key)", () => {
  it("the old hand-listed key could not tell Fort Bend from Waller; the signature can", () => {
    const old = (r) => `${r.trigger}|${r.ratio}|${r.verified}`;
    const fb = DEFAULT_FLOODPLAIN_RULES.fortbend, wl = DEFAULT_FLOODPLAIN_RULES.waller;
    expect(old(fb)).toBe(old(wl)); // the collision that served a stale memo
    expect(ruleSignature(fb)).not.toBe(ruleSignature(wl));
  });
  it("a field the compute reads (floodwayBufferFt) changes the signature", () => {
    const a = { trigger: "1pct", ratio: 1, verified: true };
    expect(ruleSignature(a)).not.toBe(ruleSignature({ ...a, floodwayBufferFt: 100 }));
    expect(ruleSignature({ b: 1, a: 2 })).toBe(ruleSignature({ a: 2, b: 1 })); // key-order independent
    expect(ruleSignature(null)).toBe("");
  });
});

describe("A8 easement jurisdiction is derived, override persists", () => {
  it("derives from the healed county when there is no override", () => {
    expect(resolveEasementJur(undefined, "fortbend")).toBe("fortbend");
    expect(resolveEasementJur(undefined, "waller")).toBe(null); // no record - never fabricated
  });
  it("a heal (county change) re-derives; an explicit override stays an override", () => {
    expect(resolveEasementJur(undefined, "harris")).toBe("coh");
    expect(resolveEasementJur("fortbend", "harris")).toBe("fortbend");
    expect(resolveEasementJur("gone", "harris", { coh: {} })).toBe("coh"); // dangling override ignored
  });
});

describe("A5 building count uses the planner's predicate", () => {
  const rows = [
    { site_id: "s", data: { type: "building", w: 100, h: 100 } },
    { site_id: "s", data: { type: "building", w: 100, h: 100 } },
    { site_id: "s", data: { type: "building", w: 55, h: 60, dogEar: { side: "top" } } },
    { site_id: "s", data: { type: "building", w: 55, h: 60, dogEar: { side: "left" } } },
    { site_id: "s", data: { type: "paving", w: 5, h: 5 } },
  ];
  it("excludes dog-ear bump-outs from the count but not from SF", () => {
    expect(buildingCountBySite(rows).s).toBe(rows.filter((r) => isBuilding(r.data)).length);
    expect(buildingCountBySite(rows).s).toBe(2);
    expect(yieldBySite(rows).s).toBe(100 * 100 * 2 + 55 * 60 * 2);
  });
});

describe("A4 one representative-plan chooser", () => {
  const sites = [
    { id: "A", group_id: "g", site: "P", updated_at: "2026-09-20T00:00:00Z" },
    { id: "B", group_id: "g", site: "P", updated_at: "2026-09-01T00:00:00Z" },
  ];
  const elem = { B: Date.parse("2026-09-28T00:00:00Z") }; // only B's buildings were edited
  it("dashboard picks the content-edited plan, like the map", () => {
    expect(groupProjectsByGroupId(sites)[0].siteId).toBe("A"); // no content data: header wins
    expect(groupProjectsByGroupId(sites, elem)[0].siteId).toBe("B");
    expect(pickRepresentativePlan(sites, elem).id).toBe("B");
  });
  it("reads local {updatedAt} and cloud {updated_at} identically; ties keep input order", () => {
    expect(planRecencyMs({ id: "x", updatedAt: 5 })).toBe(5);
    expect(planRecencyMs({ id: "x", updated_at: new Date(5).toISOString() })).toBe(5);
    expect(pickRepresentativePlan([{ id: "1" }, { id: "2" }], {}).id).toBe("1");
  });
});

describe("A6 thumbnail follows element-content saves", () => {
  const mk = (over = {}) => {
    const timers = [];
    const persist = vi.fn(async () => ({ ok: true }));
    const report = vi.fn();
    const r = createThumbnailRefresher({
      render: (m) => `svg:${m.els.length}`, persist, report,
      setTimer: (fn) => { timers.push(fn); return timers.length; }, clearTimer: () => {}, ...over,
    });
    return { r, persist, report, timers };
  };
  it("an element-only change (header unchanged) still rewrites; an identical picture does not", async () => {
    const { r, persist } = mk();
    r.schedule({ id: "p", els: [1] }); await r.flush("p");
    r.schedule({ id: "p", els: [1] }); await r.flush("p");
    expect(persist).toHaveBeenCalledTimes(1);
    r.schedule({ id: "p", els: [1, 2] }); await r.flush("p");
    expect(persist).toHaveBeenCalledTimes(2);
  });
  it("a burst debounces to the newest model", async () => {
    const { r, persist, timers } = mk();
    r.schedule({ id: "p", els: [1] }); r.schedule({ id: "p", els: [1, 2, 3] });
    await r.flush("p");
    expect(persist).toHaveBeenCalledWith("p", "svg:3");
    expect(timers.length).toBe(2);
  });
  it("a failed write is reported loudly and retried on the next save", async () => {
    const persist = vi.fn().mockResolvedValueOnce({ ok: false, error: "rls" }).mockResolvedValue({ ok: true });
    const { r, report } = mk({ persist });
    r.schedule({ id: "p", els: [1] }); await r.flush("p");
    expect(report).toHaveBeenCalledWith("thumbnail-refresh-failed", expect.any(String), expect.objectContaining({ id: "p", error: "rls" }));
    r.schedule({ id: "p", els: [1] }); await r.flush("p");
    expect(persist).toHaveBeenCalledTimes(2);
  });
});
