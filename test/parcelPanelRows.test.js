/* NEW-5 — the PLANNER's parcel details panel (double-click a lot).
 *
 * Owner report 2026-07-30, Weld County CO: "if I double click on the parcel, it shows the owner as
 * Forestar USA, and then the next line is just the owner as Forestar USA again. And then the legal
 * description is probably too much information — there should probably just be a dot dot dot and a
 * dropdown so that we can see the rest of the information."
 *
 * Two defects, both pinned here:
 *   (a) the owner was printed TWICE — once as the panel's headline, once as the first curated row.
 *   (b) the curated list dumped everything, including the unbounded metes-and-bounds Legal blob.
 *
 * This is a DIFFERENT surface from the map-search parcel card trimmed in B1166, and the two now
 * share `splitCuratedRows` (the row split) on top of the `apprRows` field resolution they already
 * shared — same rows, same order, same formatting, different host. That sharing is itself pinned
 * below, so the two can't drift apart again.
 */
import { describe, it, expect } from "vitest";
import {
  apprRows, parcelPanelRows, parcelCardRows, splitCuratedRows, ownerName,
  PARCEL_PANEL_PRIMARY_LABELS, PARCEL_CARD_PRIMARY_LABELS, APPR_FIELDS,
} from "../src/workspaces/site-planner/lib/appraisal.js";

/* A Weld County-shaped record: several owner-ish columns (the schema pattern the report names),
 * the owner's Arlington head office in ADDRESS1 ahead of the situs, and a long legal description.
 * Values are synthetic — no real county record rides into the repo. */
const LEGAL = "LOT 1 BLK 2 HIGHLAND MEADOWS FILING NO 3 BEING A REPLAT OF TRACT A, TOGETHER WITH "
  + "THAT PORTION OF THE NE1/4 OF SECTION 14, T3N, R67W OF THE 6TH P.M., COUNTY OF WELD, STATE OF "
  + "COLORADO, MORE PARTICULARLY DESCRIBED AS BEGINNING AT THE NORTHEAST CORNER THEREOF…";

const weldish = () => ({
  OBJECTID: 41,
  OWNER_NAME: "FORESTAR USA REAL ESTATE GROUP INC",
  NAME_CARE: "FORESTAR USA REAL ESTATE GROUP INC",
  ADDRESS1: "2221 E LAMAR BLVD STE 790",
  SITUS: "1234 COUNTY ROAD 17",
  PARCEL_ID: "R8901234",
  ACRES: 62.66,
  LAND_VALUE: 0,
  IMP_VALUE: 0,
  MARKET_VALUE: 0,
  LAND_USE: "VACANT LAND",
  LEGAL: LEGAL,
});

describe("(a) the owner is printed exactly once", () => {
  it("the headline owner never repeats as a row", () => {
    const attrs = weldish();
    const who = ownerName(attrs);
    expect(who).toBe("FORESTAR USA REAL ESTATE GROUP INC");
    const { primary, more } = parcelPanelRows(attrs);
    const all = [...primary, ...more];
    expect(all.filter((r) => r.value === who)).toHaveLength(0);
    expect(all.some((r) => r.label === "Owner")).toBe(false);
  });

  it("a second owner-ish COLUMN never becomes a second owner row", () => {
    // OWNER_NAME and NAME_CARE carry the same name; the curated view is one row per FIELD, first
    // matching column wins, so only one of them can ever claim the Owner row.
    const rows = apprRows(weldish());
    expect(rows.filter((r) => r.label === "Owner")).toHaveLength(1);
  });

  it("ONE row per logical field — for every field, not just Owner", () => {
    const rows = apprRows(weldish());
    const labels = rows.map((r) => r.label);
    expect(new Set(labels).size).toBe(labels.length);
    // …and that holds for a record that offers several candidate columns per field.
    const greedy = { ...weldish(), OWNER1: "SOMEONE ELSE", ACREAGE: 61, GIS_ACRES: 62, LEGAL_DESC: "OTHER" };
    const greedyLabels = apprRows(greedy).map((r) => r.label);
    expect(new Set(greedyLabels).size).toBe(greedyLabels.length);
  });

  it("only an EXACT repeat of the headline is dropped — three $0 money rows all survive", () => {
    const { more } = parcelPanelRows(weldish());
    const money = more.filter((r) => /value/i.test(r.label));
    expect(money.map((r) => r.label)).toEqual(["Land value", "Improvement value", "Total value"]);
    expect(money.every((r) => r.value === "$0")).toBe(true);
  });
});

describe("(b) the long tail folds away", () => {
  it("the default view is three short rows — situs, account, acreage", () => {
    const { primary } = parcelPanelRows(weldish(), { acres: 62.6569553 });
    expect(primary.map((r) => r.label)).toEqual(["Situs address", "Account / ID", "Acreage (measured)"]);
    expect(primary.find((r) => r.label === "Situs address").value).toBe("1234 COUNTY ROAD 17");
    expect(primary.find((r) => r.label === "Acreage (measured)").value).toBe("62.66 ac");
    // The owner's mailing address never reaches the situs row (the B1196 ladder, still in force).
    expect(primary.some((r) => /LAMAR/.test(r.value))).toBe(false);
  });

  it("the Legal description is NEVER in the default view, and is last in the tail", () => {
    const { primary, more } = parcelPanelRows(weldish());
    expect(primary.some((r) => r.label === "Legal")).toBe(false);
    expect(more.some((r) => r.label === "Legal")).toBe(true);
    expect(more[more.length - 1].label).toBe("Legal");
    expect(more.find((r) => r.label === "Legal").value).toContain("HIGHLAND MEADOWS");
  });

  it("nothing curated is LOST — the tail carries everything the short list doesn't", () => {
    const attrs = weldish();
    const { primary, more } = parcelPanelRows(attrs);
    const shown = new Set([...primary, ...more].map((r) => r.label.replace(/ \(measured\)$/, "")));
    for (const r of apprRows(attrs)) {
      if (r.label === "Owner") continue;                 // the headline carries it
      expect(shown.has(r.label), `${r.label} must still be reachable`).toBe(true);
    }
  });

  it("a record with nothing but an owner yields no rows at all (the panel says so)", () => {
    const { primary, more } = parcelPanelRows({ OWNER_NAME: "ACME LP" });
    expect(primary).toHaveLength(0);
    expect(more).toHaveLength(0);
  });
});

describe("the planner panel and the map-search card share one derivation", () => {
  it("both are `splitCuratedRows` over the same curated fields, with different primaries", () => {
    const attrs = weldish();
    expect(parcelPanelRows(attrs)).toEqual(
      splitCuratedRows(attrs, { primary: PARCEL_PANEL_PRIMARY_LABELS, hero: ownerName(attrs) }),
    );
    expect(PARCEL_CARD_PRIMARY_LABELS[0]).toBe("Owner");        // the card has no owner headline
    expect(PARCEL_PANEL_PRIMARY_LABELS[0]).toBe("Situs address"); // the panel does
  });

  it("the card is unchanged by the shared split: owner, account, acreage, then the tail", () => {
    const attrs = weldish();
    const { primary, more } = parcelCardRows(attrs, { acct: "R8901234", acres: 62.6569553 });
    expect(primary.map((r) => r.label)).toEqual(["Owner", "Account / ID", "Acreage (measured)"]);
    expect(more.some((r) => r.label === "Situs address")).toBe(false); // it is the card's title
    expect(more[more.length - 1].label).toBe("Legal");
  });

  it("both keep APPR_FIELDS order in the tail", () => {
    const order = APPR_FIELDS.map(([, label]) => label);
    for (const { more } of [parcelPanelRows(weldish()), parcelCardRows(weldish())]) {
      const idx = more.map((r) => order.indexOf(r.label));
      expect(idx).toEqual([...idx].sort((a, b) => a - b));
    }
  });
});
