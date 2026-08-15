/* NEW-1 — the address-search parcel card's height guard.
 *
 * The bug: the card printed every curated appraisal field, and the LAST of them is the
 * Legal description — unbounded metes-and-bounds call text that wraps to ten-plus lines in
 * a fixed-width card, so the card grew taller than the map controls beside it. The fix is a
 * three-row default (Owner · Account / ID · Acreage) with everything else folded behind a
 * collapsed "More details" disclosure.
 *
 * These tests hold BOTH halves: the default view can't grow back (a monstrous Legal blob
 * changes the collapsed card by nothing at all), and the data can't be lost (expanding
 * reveals every remaining field, Legal included, inside a height-capped scroll block).
 * The card renders through react-dom/server — no DOM, no Leaflet, real component output. */
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ParcelInfoCard, { DETAILS_MAX_HEIGHT, LEGAL_MAX_HEIGHT } from "../src/workspaces/site-planner/components/ParcelInfoCard.jsx";
import { parcelCardRows, PARCEL_CARD_PRIMARY_LABELS } from "../src/workspaces/site-planner/lib/appraisal.js";

// The owner's screenshot: a real Colorado parcel whose Legal is a wall of survey calls.
const LEGAL_BLOB =
  "W2NW4 2-4-68 EXC PT LYING WITHIN COMM N4 SEC COR TH S06D25E 30.118 TPOB TH S89D42W 1320.55 " +
  "TH N00D18W 660.27 TH N89D42E 1320.55 TH S00D18E 660.27 TPOB EXC RD R/W AS DESC IN BK 1042 " +
  "PG 331 & EXC PT DESC IN BK 2211 PG 88 TOG WITH UNDIVIDED 1/2 INT IN & TO ALL OIL GAS & " +
  "OTHER MINERALS LYING IN & UNDER SAID PREMISES AS RESERVED IN DEED RECORDED BK 998 PG 12";

const ATTRS = {
  owner_name: "ACME INDUSTRIAL PARTNERS LP",
  situs_addr: "1234 INDUSTRIAL PKWY",
  prop_id: "R0041234",
  legal_area: 41.72,
  land_value: 250000,
  imp_value: 100000,
  mkt_value: 350000,
  stat_land_use: "F1 - COMMERCIAL",
  zoning: "I-2",
  year_built: 1998,
  legal_desc: LEGAL_BLOB,
};

const INFO = { status: "found", addr: "1234 Industrial Pkwy", acct: "R0041234", acres: 41.7239, attrs: ATTRS };

// (createElement rather than JSX: the suite lives in a .js file, and the point of the test
// is the card's rendered output, not its call syntax.)
const render = (props) => renderToStaticMarkup(
  createElement(ParcelInfoCard, { info: INFO, onDismiss: () => {}, onPlan: () => {}, ...props }),
);
// Every rendered label/value row, in DOM order (the card stamps data-parcel-row on each).
const rowLabels = (html) => [...html.matchAll(/data-parcel-row="([^"]*)"/g)].map((m) => m[1]);

describe("parcelCardRows — the three-row split (NEW-1)", () => {
  const { primary, more } = parcelCardRows(ATTRS, { acct: INFO.acct, acres: INFO.acres });

  it("returns exactly three primary rows, in the owner's order", () => {
    expect(primary).toHaveLength(3);
    expect(primary.map((r) => r.label.replace(/ \(measured\)$/, ""))).toEqual(PARCEL_CARD_PRIMARY_LABELS);
    expect(primary[0].value).toBe("ACME INDUSTRIAL PARTNERS LP");
    expect(primary[1].value).toBe("R0041234");
    expect(primary[2].value).toBe("41.72 AC");
  });

  it("never repeats the situs address — it is the card's title", () => {
    for (const r of [...primary, ...more]) expect(r.label).not.toMatch(/situs/i);
  });

  it("keeps every remaining curated field — Legal included — in the 'more' set", () => {
    expect(more.map((r) => r.label)).toEqual(
      ["Land value", "Improvement value", "Total value", "Land use", "Zoning", "Year built", "Legal"],
    );
    expect(more.find((r) => r.label === "Legal").value).toBe(LEGAL_BLOB);
    expect(more.find((r) => r.label === "Total value").value).toBe("$350,000");
  });

  it("falls back to the CAD's own account / acreage columns when the hit carries neither", () => {
    const { primary: p } = parcelCardRows(ATTRS, {});
    expect(p.map((r) => r.label)).toEqual(["Owner", "Account / ID", "Acreage"]);
    expect(p[1].value).toBe("R0041234");
    expect(p[2].value).toBe("41.72");
  });

  it("degrades to whatever exists rather than inventing rows", () => {
    expect(parcelCardRows(null, {}).primary).toEqual([]);
    expect(parcelCardRows({ owner: "SMITH J" }, {}).primary).toEqual([{ label: "Owner", value: "SMITH J" }]);
  });
});

describe("ParcelInfoCard — the collapsed card cannot balloon (NEW-1)", () => {
  it("shows exactly the three rows by default, in order, with no Legal blob", () => {
    const html = render();
    expect(rowLabels(html)).toEqual(["Owner", "Account / ID", "Acreage (measured)"]);
    expect(html).not.toContain("TPOB");
    expect(html).not.toContain("Land value");
  });

  it("is no taller than the collapsed maximum however monstrous the Legal text is", () => {
    // The height a card can reach is set by what it RENDERS. Same parcel, one with a Legal
    // 40× longer: the collapsed card must be byte-identical — i.e. the blob contributes no
    // rows, no characters and therefore no height at all.
    const huge = { ...INFO, attrs: { ...ATTRS, legal_desc: LEGAL_BLOB.repeat(40) } };
    expect(render({ info: huge })).toBe(render());
    expect(rowLabels(render({ info: huge }))).toHaveLength(3);
  });

  it("offers the fold, closed, whenever there is more to see", () => {
    const html = render();
    expect(html).toContain("More details");
    expect(html).toContain('aria-expanded="false"'); // a real button — keyboard-reachable
  });

  it("has no fold at all when the county returned nothing beyond the three rows", () => {
    const bare = { ...INFO, attrs: { owner_name: "ACME INDUSTRIAL PARTNERS LP", prop_id: "R0041234" } };
    expect(render({ info: bare })).not.toContain("More details");
  });
});

describe("ParcelInfoCard — expanding reveals the rest, still bounded (NEW-1)", () => {
  const html = render({ detailsOpen: true });

  it("reveals every remaining field, Legal included", () => {
    expect(rowLabels(html)).toEqual([
      "Owner", "Account / ID", "Acreage (measured)",
      "Land value", "Improvement value", "Total value", "Land use", "Zoning", "Year built", "Legal",
    ]);
    expect(html).toContain("TPOB");
    expect(html).toContain('aria-expanded="true"');
  });

  it("caps the expanded body AND the Legal value so neither can push the card past a sane height", () => {
    expect(html).toContain(`max-height:${DETAILS_MAX_HEIGHT}px`);
    expect(html).toContain(`max-height:${LEGAL_MAX_HEIGHT}px`);
    expect(html.match(/overflow-y:auto/g)).toHaveLength(2); // the details body + the Legal cell
    expect(DETAILS_MAX_HEIGHT).toBeLessThanOrEqual(240);
  });
});

describe("ParcelInfoCard — everything the card already did, unchanged (NEW-1)", () => {
  it("keeps the Plan this site button and the narrow-viewport layout branch", () => {
    expect(render()).toContain("Plan this site");
    expect(render({ narrow: true })).toContain("z-index:1090");   // phone: full-width, under the search bar
    expect(render({ narrow: false })).toContain("z-index:1001");  // desktop: centered card
  });

  it("keeps the statewide-backup and cached-copy warning banners verbatim", () => {
    const backup = render({ info: { ...INFO, backup: "Fort Bend" } });
    expect(backup).toContain("Statewide backup — Fort Bend county’s server is unavailable");
    const cached = render({ info: { ...INFO, cached: { asOf: "2026-07-03" } }, cachedAsOfLabel: " · as of Jul 3, 2026" });
    expect(cached).toContain("Cached copy · as of Jul 3, 2026 — the county server is unavailable");
  });

  it("still reads differently for the no-parcel and service-unavailable states", () => {
    const none = render({ info: { status: "none" } });
    expect(none).toContain("No parcel at this point");
    expect(none).not.toContain("Plan this site");
    expect(render({ info: { status: "unavailable" } })).toContain("Parcel info unavailable");
  });
});
