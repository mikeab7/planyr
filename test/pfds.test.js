// B763 — NOAA Atlas-14 PFDS text parser + WSE(0.2%) provider notes.
// House style: no hooks, no vi.mock. The fixture is the documented english/depth NOAA
// response, built inline; honest-unknown → .toBeNull().
import { describe, it, expect } from "vitest";
import { parsePfdsText, pfdsDepthFor, WSE02_PROVIDER_NOTES } from "../src/workspaces/site-planner/lib/pfds.js";

// A faithful english/depth PFDS body: line 1 banner, ~11 preamble/metadata lines, the
// "PRECIPITATION FREQUENCY ESTIMATES" banner, the "by duration for ARI (years):" header
// with the 10 published return periods, then a few duration rows (decimal inches). The
// 24-hr row uses distinct, increasing values so column-by-VALUE reads are unambiguous:
//   periods:  1     2     5     10    25    50    100   200   500   1000
//   24-hr:   5.00  6.00  7.50  9.00  11.0  12.5  14.0  15.5  17.0  18.5
// so pfdsDepthFor("24-hr", 100) === 14.0 (col 7) and ("24-hr", 500) === 17.0 (col 9).
const FIXTURE = [
  "Point precipitation frequency estimates (inches)",
  "NOAA Atlas 14, Volume 11, Version 2",
  "Data type: Precipitation depth",
  "Time series type: Partial duration",
  "Project area: tx",
  "Location name: (user specified)",
  "Latitude: 29.7604 Degree",
  "Longitude: -95.3698 Degree",
  "Elevation: 40 ft**",
  "",
  "PRECIPITATION FREQUENCY ESTIMATES",
  "by duration for ARI (years):, 1,2,5,10,25,50,100,200,500,1000",
  "5-min:, 0.41, 0.49, 0.60, 0.69, 0.81, 0.90, 0.99, 1.08, 1.20, 1.29",
  "6-hr:, 2.90, 3.50, 4.40, 5.20, 6.30, 7.20, 8.10, 9.00, 10.2, 11.1",
  "24-hr:, 5.00, 6.00, 7.50, 9.00, 11.0, 12.5, 14.0, 15.5, 17.0, 18.5",
  "",
].join("\n");

describe("parsePfdsText — periods + duration rows", () => {
  it("returns the 10 return periods and each duration row keyed by its label", () => {
    const parsed = parsePfdsText(FIXTURE);
    expect(parsed).not.toBeNull();
    expect(parsed.periods).toEqual([1, 2, 5, 10, 25, 50, 100, 200, 500, 1000]);
    expect(Object.keys(parsed.rows).sort()).toEqual(["24-hr", "5-min", "6-hr"]);
    expect(parsed.rows["24-hr"]).toEqual([5, 6, 7.5, 9, 11, 12.5, 14, 15.5, 17, 18.5]);
    expect(parsed.rows["24-hr"]).toHaveLength(parsed.periods.length); // depths align to columns
  });

  it("strips the ~11 preamble lines (no stray 'preamble' key leaks into rows)", () => {
    const parsed = parsePfdsText(FIXTURE);
    // metadata lines like "Data type: Precipitation depth" sit BEFORE the header → never parsed
    expect(parsed.rows["Data type"]).toBeUndefined();
    expect(parsed.rows["Latitude"]).toBeUndefined();
  });
});

describe("pfdsDepthFor — read a depth by duration + return period BY VALUE", () => {
  const parsed = parsePfdsText(FIXTURE);
  it("reads the 100-yr and 500-yr 24-hr columns by value, not by position", () => {
    expect(pfdsDepthFor(parsed, "24-hr", 100)).toBe(14.0); // periods.indexOf(100) === 6
    expect(pfdsDepthFor(parsed, "24-hr", 500)).toBe(17.0); // periods.indexOf(500) === 8
    expect(pfdsDepthFor(parsed, "6-hr", 100)).toBe(8.1);
  });
  it("honest null when the duration, the return period, or the table is missing", () => {
    expect(pfdsDepthFor(parsed, "12-hr", 100)).toBeNull(); // no such duration row
    expect(pfdsDepthFor(parsed, "24-hr", 300)).toBeNull(); // 300-yr is not a published column
    expect(pfdsDepthFor(null, "24-hr", 100)).toBeNull(); // no table at all
  });
});

describe("parsePfdsText — LOUD-FAILURE on out-of-coverage / short body", () => {
  it("returns null when the 'by duration for ARI' header is absent (never zeros)", () => {
    expect(parsePfdsText("")).toBeNull();
    expect(parsePfdsText("Point precipitation frequency estimates (inches)\nData unavailable for this location.")).toBeNull();
    expect(parsePfdsText(null)).toBeNull();
  });
});

describe("WSE02_PROVIDER_NOTES — documented (not a live registry row)", () => {
  it("documents MAAPnext and M3 as pointers, and FBCDD as an UNCONFIRMED candidate", () => {
    expect(WSE02_PROVIDER_NOTES.maapnext.status).toMatch(/pointer/i);
    expect(WSE02_PROVIDER_NOTES.m3.status).toMatch(/pointer/i);
    expect(WSE02_PROVIDER_NOTES.fbcdd.status).toMatch(/candidate|unconfirmed/i);
    // FBCDD layer id / field stay honestly null until a live browser locks them.
    expect(WSE02_PROVIDER_NOTES.fbcdd.layerId).toBeNull();
    expect(WSE02_PROVIDER_NOTES.fbcdd.field).toBeNull();
    expect(WSE02_PROVIDER_NOTES.fbcdd.candidateFolders).toEqual(["Drainage_Base_Data", "FEMA", "FLOODZONE"]);
    expect(WSE02_PROVIDER_NOTES.fbcdd.portalItem).toBe("b1882e732fa042aeaa6e2fc7447f0377");
    // NOAA endpoint carried for the production same-origin proxy (no browser fetch).
    expect(WSE02_PROVIDER_NOTES.noaaPfds.endpoint).toContain("fe_text_mean.csv");
  });
});
