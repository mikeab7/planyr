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
  PARCEL_COPY_LIVE_DATE, asOfFromEditDate, readLiveCopyAsOf, _resetLiveCopyAsOf,
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

/* NEW-2 (2026-11-12) — Fort Bend's copy date was a typed "2026-10"; the hosted layer's own lastEditDate read 2026-08-14 on 2026-10-30, so the typed month overstated it. A live-date county
 * never carries a typed month: the date is READ from the service, or the line says "date not published". */
describe("a live-date copy county (Fort Bend) shows the date the service reports, never a typed one", () => {
  const FB_URL = COUNTIES.fortbend.layerUrl;
  const jsonOk = (body) => async () => ({ ok: true, json: async () => body });
  const EDIT = Date.UTC(2026, 7, 14, 12); // 2026-08-14 — what the sweep read on 2026-10-30
  it("Fort Bend is registered live-date and its static date is null (so the old '2026-10' can never come back)", () => {
    expect(PARCEL_COPY_LIVE_DATE).toContain("fortbend");
    expect(PARCEL_COPIES.fortbend[1]).toBeNull();
    for (const k of PARCEL_COPY_LIVE_DATE) expect(PARCEL_COPIES[k][1], k).toBeNull();
  });
  it("with no live reading the line says 'date not published' — it does NOT claim October 2026", () => {
    const n = parcelCopyNotice("fortbend");
    expect(n.line).toContain("(date not published)");
    expect(n.line).not.toContain("October 2026");
    expect(n.asOf).toBeNull();
  });
  it("with a live reading the line carries that month", () => {
    expect(parcelCopyNotice("fortbend", null, "2026-08").line).toContain("as of August 2026");
  });
  it("a typed-date county ignores a live reading passed to it", () => {
    expect(parcelCopyNotice("ny_chenango", null, "2030-01").line).toContain("June 2026");
  });
  it("asOfFromEditDate: a real epoch → YYYY-MM; zero, junk, a pre-2000 or a future value → null", () => {
    expect(asOfFromEditDate(EDIT, EDIT + 1000)).toBe("2026-08");
    expect(asOfFromEditDate(0)).toBeNull();
    expect(asOfFromEditDate("x")).toBeNull();
    expect(asOfFromEditDate(Date.UTC(1999, 0, 1))).toBeNull();
    expect(asOfFromEditDate(EDIT + 400 * 86400000, EDIT)).toBeNull();
  });
  it("readLiveCopyAsOf asks the county layer's own ?f=json and returns the edit month; the answer is cached (one request)", async () => {
    _resetLiveCopyAsOf();
    let calls = 0; const urls = [];
    const f = async (u) => { calls++; urls.push(u); return { ok: true, json: async () => ({ editingInfo: { lastEditDate: EDIT } }) }; };
    expect(await readLiveCopyAsOf("fortbend", { fetchImpl: f, now: EDIT + 1000 })).toBe("2026-08");
    expect(await readLiveCopyAsOf("fortbend", { fetchImpl: f, now: EDIT + 1000 })).toBe("2026-08");
    expect(calls).toBe(1);
    expect(urls[0]).toBe(`${FB_URL}?f=json`);
  });
  it("a service that errors, has no editingInfo, throws, or is not a live-date county reads null — never a guessed month — and a failure is retried next time", async () => {
    _resetLiveCopyAsOf();
    expect(await readLiveCopyAsOf("fortbend", { fetchImpl: jsonOk({ error: { code: 500 } }) })).toBeNull();
    expect(await readLiveCopyAsOf("fortbend", { fetchImpl: jsonOk({}) })).toBeNull();
    expect(await readLiveCopyAsOf("fortbend", { fetchImpl: async () => { throw new TypeError("Failed to fetch"); } })).toBeNull();
    expect(await readLiveCopyAsOf("fortbend", { fetchImpl: async () => ({ ok: false, status: 503 }) })).toBeNull();
    let calls = 0;
    const f = async () => { calls++; return { ok: true, json: async () => ({ editingInfo: { lastEditDate: EDIT } }) }; };
    expect(await readLiveCopyAsOf("fortbend", { fetchImpl: f, now: EDIT + 1000 })).toBe("2026-08"); // not poisoned by the failures above
    expect(calls).toBe(1);
    const never = async () => { throw new Error("must not be called"); };
    expect(await readLiveCopyAsOf("ny_chenango", { fetchImpl: never })).toBeNull();
    expect(await readLiveCopyAsOf(undefined, { fetchImpl: never })).toBeNull();
  });
  it("the layer's registry comment no longer says 'refreshed daily'", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/workspaces/site-planner/lib/counties.js", import.meta.url), "utf8");
    expect(src).not.toMatch(/is refreshed daily/);
  });
});
