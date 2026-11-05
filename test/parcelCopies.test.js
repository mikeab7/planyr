/* NEW-1 (2026-10-29) — a parcel that came from a COPY of the county's data says so, with the date, and offers the request.
 * Owner: "use the copy, but then just state that it's a copy and state the date that it came from. And then maybe we say
 * something about, like, please contact X if you'd like Y."
 *
 * Holds: (1) the sweep is a RULE — every county-verification row the provenance record calls third-party / unverified is a copy
 * row or an explained exemption, so a newly wired copy cannot ship without its line; (2) the five rows the owner named read
 * right; (3) the card renders the line + the request button for a copy and NOTHING for an official county / statewide row. */
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { COUNTY_VERIFICATION } from "../src/workspaces/site-planner/lib/countiesProvenance.js";
import { COUNTIES } from "../src/workspaces/site-planner/lib/counties.js";
import {
  PARCEL_COPIES, PARCEL_COPY_EXEMPT, parcelCopyNotice, parcelCopyLine, formatCopyAsOf, PARCEL_COPY_ASK,
} from "../src/workspaces/site-planner/lib/parcelCopies.js";
import { PARCEL_REQUEST_LABEL } from "../src/workspaces/site-planner/lib/parcelGaps.js";
import ParcelInfoCard from "../src/workspaces/site-planner/components/ParcelInfoCard.jsx";

const copyRows = Object.entries(COUNTY_VERIFICATION).filter(([, v]) => v.publisher === "third-party" || v.publisher === "unverified").map(([k]) => k);

describe("the sweep is a rule (no copy row without its line)", () => {
  it("every third-party / unverified row is a copy row or an explained state-agency exemption", () => {
    const missing = copyRows.filter((k) => !(k in PARCEL_COPIES) && !(k in PARCEL_COPY_EXEMPT));
    expect(missing).toEqual([]);
  });
  it("no row is both, every key names a real county row, and every exemption is a recorded third-party row", () => {
    for (const k of Object.keys(PARCEL_COPIES)) { expect(COUNTIES[k], k).toBeTruthy(); expect(k in PARCEL_COPY_EXEMPT, k).toBe(false); }
    for (const k of Object.keys(PARCEL_COPY_EXEMPT)) { expect(copyRows, k).toContain(k); expect(String(PARCEL_COPY_EXEMPT[k]).length, k).toBeGreaterThan(10); }
  });
  it("official rows (own / statewide) are never copy rows — except Fulton, which the owner named", () => {
    for (const [k, v] of Object.entries(COUNTY_VERIFICATION)) {
      if (v.publisher === "own" || v.publisher === "statewide") expect(k in PARCEL_COPIES && k !== "ny_fulton", k).toBe(false);
    }
  });
  it("every entry is [publisher|null, YYYY-MM|YYYY|null] and a dated one reads as a real month", () => {
    for (const [k, [pub, asOf]] of Object.entries(PARCEL_COPIES)) {
      expect(pub === null || (typeof pub === "string" && pub.length > 2), k).toBe(true);
      expect(asOf === null || /^\d{4}(-(0[1-9]|1[0-2]))?$/.test(asOf), k).toBe(true);
    }
  });
});

describe("the rows the owner named", () => {
  const line = (k) => parcelCopyNotice(k).line;
  it("Chenango — LaBella, June 2026", () => expect(line("ny_chenango")).toBe("Copy of Chenango County parcel data published by LaBella Associates, as of June 2026 — not the county’s own."));
  it("Herkimer — Byer Planning, September 2025", () => expect(line("ny_herkimer")).toContain("published by Byer Planning LLC, as of September 2025"));
  it("Nassau — Peconic Land Trust, the 2020 roll", () => expect(line("ny_nassau")).toContain("published by Peconic Land Trust, as of 2020"));
  it("Dutchess — an account Planyr could not tie to the county, September 2025, only 'may not be' the county's", () => {
    expect(line("ny_dutchess")).toBe("Copy of Dutchess County parcel data from an ArcGIS account Planyr couldn’t tie to the county, as of September 2025 — may not be the county’s own.");
  });
  it("Fulton — NYS Dept. of State, January 2023", () => expect(line("ny_fulton")).toContain("NYS Department of State (Mohawk River watershed layer), as of January 2023"));
  it("a copy with no published date says so instead of guessing one", () => {
    const l = parcelCopyLine({ name: "Adair County", publisher: "Schneider Geospatial", asOf: null });
    expect(l).toBe("Copy of Adair County parcel data published by Schneider Geospatial (date not published) — not the county’s own.");
  });
  it("the request is addressed to Michael with the county in the subject and the line in the body", () => {
    const n = parcelCopyNotice("ny_chenango", { lat: 42.53, lng: -75.52 });
    expect(n.href.startsWith("mailto:michael@planyr.io?subject=")).toBe(true);
    expect(decodeURIComponent(n.href)).toContain("subject=Parcel data request: Chenango County, NY");
    expect(decodeURIComponent(n.href)).toContain("Data shown: Copy of Chenango County parcel data published by LaBella Associates");
    expect(decodeURIComponent(n.href)).toContain("Point I clicked: 42.53000, -75.52000");
    expect(n.ask).toBe(PARCEL_COPY_ASK);
  });
  it("formatCopyAsOf reads month, year, and refuses nonsense", () => {
    expect(formatCopyAsOf("2026-06")).toBe("June 2026");
    expect(formatCopyAsOf("2020")).toBe("2020");
    expect(formatCopyAsOf("2026-13")).toBeNull();
    expect(formatCopyAsOf(null)).toBeNull();
  });
});

describe("official rows show nothing", () => {
  it.each(["ny_saratoga", "ny_statewide", "harris", "co_denver", "", undefined, "no_such_county"])("%s → no notice", (k) => {
    expect(parcelCopyNotice(k)).toBeNull();
  });
});

describe("the parcel card", () => {
  const found = (county) => ({ status: "found", addr: "1 Main St", acct: "1.1-1-1", acres: 2.1, attrs: { owner_name: "ACME" }, county });
  const render = (info) => renderToStaticMarkup(createElement(ParcelInfoCard, { info, onDismiss: () => {}, onPlan: () => {} }));
  it("a Chenango (copy) lot carries the line with publisher + date, the ask, and the request button", () => {
    const html = render(found("ny_chenango"));
    expect(html).toContain('data-testid="parcel-card-copy-line"');
    expect(html).toContain("LaBella Associates");
    expect(html).toContain("June 2026");
    expect(html).toContain("not the county’s own");
    expect(html).toContain(PARCEL_COPY_ASK);
    expect(html).toContain('data-testid="parcel-card-copy-request"');
    expect(html).toContain(PARCEL_REQUEST_LABEL);
    expect(html).toContain("mailto:michael@planyr.io");
  });
  it("a Herkimer (copy) lot carries it too", () => {
    expect(render(found("ny_herkimer"))).toContain("Byer Planning LLC");
  });
  it("an official county (Saratoga) renders neither the line nor the button", () => {
    const html = render(found("ny_saratoga"));
    expect(html).not.toContain("parcel-card-copy");
    expect(html).not.toContain(PARCEL_REQUEST_LABEL);
    expect(html).not.toContain("Copy of");
  });
  it("a statewide-layer lot and a lot with no county key render nothing extra", () => {
    expect(render(found("ny_statewide"))).not.toContain("parcel-card-copy");
    expect(render(found(undefined))).not.toContain("parcel-card-copy");
  });
});
