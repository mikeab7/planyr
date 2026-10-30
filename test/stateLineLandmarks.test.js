/* NEW-1 (B2539744 review, finding 4) — the Mississippi River state line is checked against RIVER-TOWN LANDMARKS, one on each bank, not against
 * a second copy of the same data. Natural Earth 1:10m puts the Mississippi–Louisiana line up to 3.8 km off the river (Vidalia's own centre reads
 * "MS"); `scripts/build-us-states.mjs` therefore splices Esri's USA_States_Generalized_Boundaries run for that one edge. Every landmark below is a
 * town whose state is not in doubt; red on the unspliced data for Vidalia. Also pins the two reviewer border points that came from TN's hand-drawn
 * outline (Fulton KY, Bristol VA) and the Tennessee side of each. */
import { describe, it, expect } from "vitest";
import { siteState } from "../src/workspaces/site-planner/lib/siteRegion.js";

const LANDMARKS = [
  ["Greenville MS", 33.4101, -91.0618, "MS"], ["Lake Village AR", 33.3329, -91.2819, "AR"], ["Lake Providence LA", 32.8049, -91.1715, "LA"],
  ["Rolling Fork MS", 32.9099, -90.8795, "MS"], ["Tallulah LA", 32.4087, -91.1868, "LA"], ["Vicksburg MS", 32.3526, -90.8779, "MS"],
  ["Port Gibson MS", 31.9574, -90.9834, "MS"], ["St. Joseph LA", 31.9168, -91.2362, "LA"], ["Vidalia LA", 31.5653, -91.4311, "LA"],
  ["Natchez MS", 31.5604, -91.4032, "MS"], ["Helena AR", 34.5295, -90.5896, "AR"], ["Rosedale MS", 33.8532, -91.0302, "MS"],
  ["Arkansas City AR", 33.6085, -91.2007, "AR"], ["Ferriday LA", 31.6302, -91.5543, "LA"], ["Clarksdale MS", 34.2001, -90.5709, "MS"],
  ["Tunica MS", 34.6851, -90.3843, "MS"], ["Woodville MS", 31.1046, -91.3002, "MS"], ["Bogalusa LA", 30.791, -89.8487, "LA"],
  ["Picayune MS", 30.5255, -89.6795, "MS"], ["Slidell LA", 30.2752, -89.7812, "LA"], ["Jackson MS", 32.2988, -90.1848, "MS"],
  ["Memphis TN", 35.1495, -90.049, "TN"], ["West Memphis AR", 35.1465, -90.1846, "AR"],
];

describe("river-town landmarks resolve to their own state", () => {
  for (const [name, lat, lng, want] of LANDMARKS) it(`${name} → ${want}`, () => expect(siteState({ lat, lng })).toBe(want));
});

describe("Tennessee's outline overrules only the lines it was drawn exactly to", () => {
  it("Fulton KY and Bristol VA are not Tennessee", () => {
    expect(siteState({ lat: 36.51, lng: -88.88 })).toBe("KY");
    expect(siteState({ lat: 36.598, lng: -82.18 })).toBe("VA");
    expect(siteState({ lat: 36.605, lng: -82.18 })).toBe("VA");
  });
  it("Chattanooga still reads Tennessee (the Georgia line it IS drawn to)", () => {
    expect(siteState({ lat: 35.0456, lng: -85.3097 })).toBe("TN");
    expect(siteState({ lat: 34.9484, lng: -85.2569 })).toBe("GA");
  });
});
