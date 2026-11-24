/* NEW-3/4 (Meriwether GA, 2026-11-24) — WHERE the Assessor link and the copy line appear: the planner's parcel PAGE (Land › Parcels › open a lot), source section. */
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ParcelPage from "../src/workspaces/site-planner/components/ParcelPage.jsx";
import ParcelCopyNote from "../src/workspaces/site-planner/components/ParcelCopyNote.jsx";
import { COUNTIES } from "../src/workspaces/site-planner/lib/counties.js";

const attrs = { Parcel_No: "069A   009", house_no: 27092, street_nam: "ROOSEVELT", sttype: "HWY", zip: "30222", qPub_Link: "https://qpublic.schneidercorp.com/Application.aspx?App=meriwetherCountyGA&Layer=Parcels&PageType=Report&KeyValue=069A%20%20%20009" };
const handlers = new Proxy({}, { get: () => () => {} });
const page = (extra = {}) => renderToStaticMarkup(createElement(ParcelPage, {
  parcel: { id: "p1", attrs, acct: "069A   009" }, name: "Parcel 1", unnamed: true, acres: 4.36, included: true, origin: { kind: "county", chip: "County" },
  ownerText: () => "BASWELL CHRISTOPHER SHANE", cadName: "Meriwether County (Greenville, GA)", drawnAcresOf: () => 4.36, handlers,
  idField: "Parcel_No", addrParts: COUNTIES.ga_meriwether.addrParts, countyState: "GA", county: "ga_meriwether", ...extra,
}));

describe("the planner's parcel page for a Meriwether lot", () => {
  it("shows the address and a short Assessor link (never the raw URL as its text)", () => {
    const html = page();
    expect(html).toContain("27092 ROOSEVELT HWY");
    expect(html).toMatch(/data-testid="parcel-assessor-link"[^>]*>Open record/);
    expect(html).toContain('href="https://qpublic.schneidercorp.com/');
    expect(html.replace(/href="[^"]*"/g, "")).not.toContain("qpublic.schneidercorp.com");
  });
  it("has no Assessor row for a lot whose layer carries no link", () => {
    const { qPub_Link, ...rest } = attrs; // eslint-disable-line no-unused-vars
    expect(renderToStaticMarkup(createElement(ParcelPage, { parcel: { id: "p2", attrs: rest, acct: "x" }, name: "P", unnamed: true, acres: 1, included: true, origin: { kind: "county" }, ownerText: () => "", drawnAcresOf: () => 1, handlers, idField: "Parcel_No", countyState: "GA", county: "ga_meriwether" }))).not.toContain("parcel-assessor-link");
  });
  it("the copy line the page mounts (lazily) for ga_meriwether says it is a copy, dated 2023-06, with the Email Michael request", () => {
    const html = renderToStaticMarkup(createElement(ParcelCopyNote, { county: "ga_meriwether", testId: "parcel-copy" }));
    expect(html).toContain('data-testid="parcel-copy-line"');
    expect(html).toMatch(/2023/);
    expect(html).toContain('data-testid="parcel-copy-request"');
  });
});
