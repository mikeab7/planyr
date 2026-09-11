import { describe, it, expect } from "vitest";
import {
  MOBILE_BREAKPOINT_PX, mobileLabel, neededToSaveColumns, mobileSections,
  isRequiredColEmpty, neededToSaveRemaining, rowStatusText,
} from "../src/shared/comps/lib/compMobileLayout.js";
import { SHEET_COLUMNS, columnIndex } from "../src/shared/comps/lib/compSheetColumns.js";
import { emptyDraft } from "../src/shared/comps/lib/comps.js";

function draftOf(compType, overrides = {}) {
  return { ...emptyDraft(null), compType, ...overrides };
}
function rowOf(compType, overrides = {}, cellFlags = {}) {
  return { _id: "t1", draft: draftOf(compType, overrides), cellFlags };
}

describe("compMobileLayout: needed-to-save", () => {
  // NEW-5 (owner decision, 2026-09-02) relaxed the Executed-date requirement across the DB,
  // validateComp and every UI layer; `compDate` lost its `required: true` in compSheetColumns.js,
  // so Location is now the only column this pinned section names.
  it("is Location alone, sourced from SHEET_COLUMNS' own `required` flag", () => {
    const cols = neededToSaveColumns("lease");
    expect(cols.map((c) => c.key)).toEqual(["location"]);
  });
  it("every required column applies to every comp type (nothing to filter out today)", () => {
    for (const t of ["land", "building_sale", "lease"]) {
      expect(neededToSaveColumns(t).map((c) => c.key)).toEqual(["location"]);
    }
  });
  it("isRequiredColEmpty reads Location off the anchor, not a string value", () => {
    const locationCol = SHEET_COLUMNS[columnIndex("location")];
    expect(isRequiredColEmpty(locationCol, draftOf("land"))).toBe(true);
    expect(isRequiredColEmpty(locationCol, draftOf("land", { anchor: { kind: "pin", lat: 1, lon: 2 } }))).toBe(false);
  });
  it("neededToSaveRemaining counts down as fields fill in, never below 0", () => {
    const bare = rowOf("lease");
    expect(neededToSaveRemaining(bare)).toBe(1);
    const complete = rowOf("lease", { anchor: { kind: "pin", lat: 1, lon: 2 } });
    expect(neededToSaveRemaining(complete)).toBe(0);
  });
});

describe("compMobileLayout: sections swap by deal type, never a wall of greyed rows", () => {
  // B1519296/B1519297 (owner mockup pick, 2026-09-11) — "Property" split into "Location" and
  // "Building" (mirroring the desktop sheet's own LOCATION/BUILDING band split), and Notes moved
  // out of Parties into its own section at the end (mirroring Notes leaving the desktop sheet as
  // a column) — every comp type now carries a Notes section, since notes applies to every type.
  it("a LEASE sheet gets Rent/Term/Concessions, never Price", () => {
    const titles = mobileSections("lease").map((s) => s.title);
    expect(titles).toEqual(["Location", "Building", "Rent", "Term", "Concessions", "Parties", "Notes"]);
  });
  it("a LAND sheet gets Price instead, never Rent/Term/Concessions", () => {
    const titles = mobileSections("land").map((s) => s.title);
    expect(titles).toEqual(["Location", "Building", "Price", "Parties", "Notes"]);
  });
  it("a BUILDING SALE sheet also gets Price (with NOI/Cap), never a lease section", () => {
    const price = mobileSections("building_sale").find((s) => s.title === "Price");
    expect(price.cols.map((c) => c.key)).toEqual(["price", "bldgNoi", "bldgCapRate", "salePricePerArea"]);
  });
  it("Building drops clear height/year built on a LAND row (buildings-only facts)", () => {
    const building = mobileSections("land").find((s) => s.title === "Building");
    expect(building.cols.map((c) => c.key)).toEqual(["size", "landSizeUnit"]);
  });
  it("Notes is its own section for every comp type, sourced from NOTES_COLUMN (not SHEET_COLUMNS)", () => {
    for (const t of ["land", "building_sale", "lease"]) {
      const notes = mobileSections(t).find((s) => s.title === "Notes");
      expect(notes.cols.map((c) => c.key)).toEqual(["notes"]);
    }
  });
  it("no section is ever emitted with zero applicable columns", () => {
    for (const t of ["land", "building_sale", "lease"]) {
      for (const s of mobileSections(t)) expect(s.cols.length).toBeGreaterThan(0);
    }
  });
  it("Location the ACTION column never repeats inside a section — it lives only in Needed to save", () => {
    for (const t of ["land", "building_sale", "lease"]) {
      const keys = mobileSections(t).flatMap((s) => s.cols.map((c) => c.key));
      expect(keys).not.toContain("location");
      expect(keys).not.toContain("compDate");
    }
  });
});

describe("compMobileLayout: labels and status text", () => {
  it("Title reads as 'Deal name' on mobile, unlike desktop's 'Title / Address'", () => {
    const titleCol = SHEET_COLUMNS[columnIndex("title")];
    expect(titleCol.label).toBe("Title / Address");
    expect(mobileLabel(titleCol)).toBe("Deal name");
  });
  it("every other column keeps its desktop label", () => {
    const rateCol = SHEET_COLUMNS[columnIndex("leaseRate")];
    expect(mobileLabel(rateCol)).toBe(rateCol.label);
  });
  it("rowStatusText names a blocking rate/period flag ahead of a plain missing field", () => {
    const flagged = rowOf(
      "lease",
      { compDate: "2026-06-01", anchor: { kind: "pin", lat: 1, lon: 2 } },
      { leaseRatePeriod: { level: "blocking", reason: "12x ambiguity" } },
    );
    expect(rowStatusText(flagged)).toBe("rate needs a period");
  });
  it("rowStatusText names what's missing, and 'ready' once complete — a dateless-but-located row is genuinely ready (NEW-5 made Executed optional everywhere)", () => {
    expect(rowStatusText(rowOf("land"))).toBe("needs a location");
    expect(rowStatusText(rowOf("land", { anchor: { kind: "pin", lat: 1, lon: 2 } }))).toBe("ready");
  });
});

describe("compMobileLayout: breakpoint is a single named constant", () => {
  it("is a positive pixel width, not one hand-typed at each call site", () => {
    expect(typeof MOBILE_BREAKPOINT_PX).toBe("number");
    expect(MOBILE_BREAKPOINT_PX).toBeGreaterThan(768); // both 390px and 768px phones/tablets must land in the transposed layout
  });
});
