/* Georgia screening cards — the words and arithmetic (lib/georgiaScreens.js). */
import { describe, it, expect } from "vitest";
import { summarizeGaStreams, gopherSummary, critHabitatSummary, critHabitatDetail, hsiTag } from "../src/workspaces/site-planner/lib/georgiaScreens.js";

const feat = (attrs, distFt) => ({ attrs, distFt });

describe("streams card", () => {
  it("none within the radius is a verified absence that says what it did not count", () => {
    const r = summarizeGaStreams({ ranked: [] }, { bufferMi: 0.1 });
    expect(r.status).toBe("absent");
    expect(r.summary).toMatch(/528 ft/);
    expect(r.summary).toMatch(/ditches, canals and ephemeral/);
  });
  it("ditches and ephemeral reaches never count as a stream", () => {
    const r = summarizeGaStreams({ ranked: [feat({ ftype: 336, fcode: 33600 }, 0), feat({ ftype: 460, fcode: 46007 }, 0)] });
    expect(r.status).toBe("absent");
  });
  it("a stream on the site is a PRESENT constraint carrying all three buffer rules and the confirm-with-county line", () => {
    const r = summarizeGaStreams({ ranked: [feat({ ftype: 460, fcode: 46006, gnis_name: "Yellow River" }, 0)] });
    expect(r.status).toBe("present");
    expect(r.summary).toMatch(/crosses the site/);
    expect(r.summary).toMatch(/25 ft/); expect(r.summary).toMatch(/50 ft/); expect(r.summary).toMatch(/75 ft/);
    expect(r.summary).toMatch(/confirm with the county/);
    expect(r.detail[0]).toMatch(/Yellow River/);
  });
  it("a nearby stream is info, with its distance", () => {
    const r = summarizeGaStreams({ ranked: [feat({ ftype: 460, fcode: 46003, gnis_name: "Shoal Creek" }, 310)] });
    expect(r.status).toBe("info");
    expect(r.summary).toMatch(/~300 ft/); // fmtDistFt rounds to the nearest 50
    expect(r.summary).not.toMatch(/~~/);
  });
});

describe("gopher tortoise / habitat / HSI wording", () => {
  it("tortoise soils name the DNR tiers and say modeled-not-a-survey", () => {
    const s = gopherSummary([{ Tier: 3 }, { Tier: 1 }, { Tier: 1 }]);
    expect(s).toMatch(/tier 1, 3/);
    expect(s).toMatch(/modeled screen, not a survey/);
  });
  it("critical habitat lists species, capped", () => {
    const rows = ["A", "B", "C", "D", "E"].map((n) => ({ comname: n, sciname: n + " x" }));
    expect(critHabitatSummary(rows)).toMatch(/\+1 more/);
    expect(critHabitatDetail(rows).length).toBe(5);
  });
  it("the HSI Class is shown as EPD gives it and is blank when absent", () => {
    expect(hsiTag({ Class: 1 })).toBe("Class 1");
    expect(hsiTag({ Class: " " })).toBe("");
    expect(hsiTag({})).toBe("");
  });
});
