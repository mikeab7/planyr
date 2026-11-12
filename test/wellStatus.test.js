/* Oil & gas well status classification + proximity summary (PHASE 4) — pure tests. */
import { describe, it, expect } from "vitest";
import { classifyWell, summarizeWells, STORAGE_WELL_CAVEAT } from "../src/workspaces/site-planner/lib/wellStatus.js";

describe("classifyWell — RRC SYMNUM / GIS_SYMBOL_DESCRIPTION → category", () => {
  it("maps the common live well statuses (description-first)", () => {
    expect(classifyWell({ GIS_SYMBOL_DESCRIPTION: "Oil Well", SYMNUM: 4 })).toBe("producing");
    expect(classifyWell({ GIS_SYMBOL_DESCRIPTION: "Gas Well", SYMNUM: 5 })).toBe("producing");
    expect(classifyWell({ GIS_SYMBOL_DESCRIPTION: "Plugged Oil Well", SYMNUM: 7 })).toBe("plugged");
    expect(classifyWell({ GIS_SYMBOL_DESCRIPTION: "Plugged Oil / Gas", SYMNUM: 10 })).toBe("plugged");
    expect(classifyWell({ GIS_SYMBOL_DESCRIPTION: "Dry Hole", SYMNUM: 3 })).toBe("dry");
    expect(classifyWell({ GIS_SYMBOL_DESCRIPTION: "Canceled / Abandoned Location", SYMNUM: 9 })).toBe("abandoned");
    expect(classifyWell({ GIS_SYMBOL_DESCRIPTION: "Shut-In Oil", SYMNUM: 19 })).toBe("shutin");
    expect(classifyWell({ GIS_SYMBOL_DESCRIPTION: "Injection / Disposal", SYMNUM: 11 })).toBe("injection");
    expect(classifyWell({ GIS_SYMBOL_DESCRIPTION: "Permitted Location", SYMNUM: 2 })).toBe("other");
  });
  it("RRC 'Storage Well' (salt-dome cavern, SYMNUM 88) is its own category — never 'other' (NEW-1 Mont Belvieu)", () => {
    expect(classifyWell({ GIS_SYMBOL_DESCRIPTION: "Storage Well", SYMNUM: 88 })).toBe("storage");
    expect(classifyWell({ SYMNUM: 88 })).toBe("storage");                                   // description missing → SYMNUM
    expect(classifyWell({ GIS_SYMBOL_DESCRIPTION: "Gas Storage", SYMNUM: 5 })).toBe("storage"); // not read as a producer
    expect(classifyWell({ GIS_SYMBOL_DESCRIPTION: "Plugged Storage Well", SYMNUM: 7 })).toBe("plugged"); // a plugged hole stays plugged
  });
  it("falls back to SYMNUM when the description is missing; never throws", () => {
    expect(classifyWell({ SYMNUM: 8 })).toBe("plugged");
    expect(classifyWell({ SYMNUM: 6 })).toBe("producing");
    expect(classifyWell({})).toBe("other");
    expect(classifyWell()).toBe("other");
  });
});

describe("summarizeWells — status breakdown + on-site replug/offset flag", () => {
  it("empty → absent (caller supplies the 'none within N mi' label)", () => {
    const r = summarizeWells({ ranked: [] }, { total: 0 });
    expect(r.status).toBe("absent");
    expect(r.summary).toBe(null);
  });
  it("breaks down producing vs plugged and flags an on-site well as a replug/offset risk", () => {
    const scr = { ranked: [
      { attrs: { API: "42-1", GIS_SYMBOL_DESCRIPTION: "Plugged Oil Well", SYMNUM: 7 }, distFt: 0 },   // ON the site
      { attrs: { API: "42-2", GIS_SYMBOL_DESCRIPTION: "Oil Well", SYMNUM: 4 }, distFt: 600 },
    ] };
    const r = summarizeWells(scr, { total: 2, bufferMi: 0.25 });
    expect(r.status).toBe("present");
    expect(r.summary).toMatch(/2 wells within 0.25 mi/);
    expect(r.summary).toMatch(/1 plugged\/abandoned/);
    expect(r.summary).toMatch(/1 producing/);
    expect(r.summary).toMatch(/1 on the site — offset\/replug risk/);
    expect(r.detail[0]).toMatch(/API 42-1 — Plugged Oil Well · on\/under the site/);
  });
  it("wells nearby but none on the footprint → no risk flag", () => {
    const scr = { ranked: [{ attrs: { API: "9", GIS_SYMBOL_DESCRIPTION: "Gas Well", SYMNUM: 5 }, distFt: 800 }] };
    const r = summarizeWells(scr, { total: 1 });
    expect(r.summary).toMatch(/1 well within/);
    expect(r.summary).not.toMatch(/on the site/);
  });
  it("notes when the breakdown is from a capped sample", () => {
    const ranked = Array.from({ length: 5 }, (_, i) => ({ attrs: { API: String(i), GIS_SYMBOL_DESCRIPTION: "Oil Well", SYMNUM: 4 }, distFt: 500 }));
    const r = summarizeWells({ ranked }, { total: 40 });
    expect(r.summary).toMatch(/breakdown from the nearest 5/);
  });
});

describe("summarizeWells — salt-dome storage wells (NEW-1, Mont Belvieu)", () => {
  const storage = (api, distFt) => ({ attrs: { API: api, GIS_SYMBOL_DESCRIPTION: "Storage Well", SYMNUM: 88 }, distFt });
  it("counts them as 'storage (cavern)' and flags a cavern wellhead on the pad", () => {
    const r = summarizeWells({ ranked: [storage("S1", 0), storage("S2", 400), { attrs: { API: "O1", GIS_SYMBOL_DESCRIPTION: "Oil Well", SYMNUM: 4 }, distFt: 900 }] }, { total: 3 });
    expect(r.summary).toMatch(/2 storage \(cavern\)/);
    expect(r.summary).toMatch(/1 on the site — offset\/replug risk/);
    expect(r.summary).toMatch(/1 salt-dome storage — active operations/);
  });
  it("a storage well off the pad is counted but not flagged as on the site", () => {
    const r = summarizeWells({ ranked: [storage("S2", 400)] }, { total: 1 });
    expect(r.summary).toMatch(/1 storage \(cavern\)/);
    expect(r.summary).not.toMatch(/on the site/);
  });
  it("the legacy well card's caveat names salt-dome storage as an active-operations matter", () => {
    expect(STORAGE_WELL_CAVEAT).toMatch(/Mont Belvieu, Stratton Ridge, Markham/);
    expect(STORAGE_WELL_CAVEAT).toMatch(/operations setback/);
  });
});
