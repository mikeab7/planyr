/* NEW-1 (owner report 2026-10-16) — "Paste comps" must read a real broker lease-comp spreadsheet.
 * "Train it on data", in the owner's words: the parser is rule-based, so the training is these
 * fixtures — real broker LAYOUTS (header wording, value styles, title rows) with INVENTED values.
 * None of the owner's own comps is committed here.
 *
 *  - nHoustonShape.tsv  — the exact header row of the owner's "N Houston Lease Comps.xlsx", with a
 *                         sheet title row above it, "Jun-26" dates, "$0.665" monthly rates,
 *                         prose free-rent cells, "-" blanks, and x = longitude / y = latitude.
 *  - costarExport.tsv   — CoStar-style lease export (annual $/SF/Yr, NNN and Modified Gross,
 *                         Latitude/Longitude columns, "5 Years" terms).
 *  - brokerageTable.tsv — a CBRE/JLL/Colliers-style survey table (Tenant / Landlord / RSF /
 *                         Rate ($/SF/Yr) / Term / Commencement / Address), no coordinates — the
 *                         address is handed to the geocoder.
 *  - latLongCell.tsv    — one "lat, lon" cell per row, monthly AND annual rates, NNN and gross.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parsePaste, parsePasteBlock, matchHeaderCell, parseLatLonPair, parseSingleRecord, rowHasBlockingFlags } from "../src/shared/comps/lib/compParse.js";
import { draftToComp, validateComp, emptyDraft } from "../src/shared/comps/lib/comps.js";
import { SHEET_COLUMNS, NOTES_COLUMN } from "../src/shared/comps/lib/compSheetColumns.js";
import { parseKmlPlacemarks } from "../src/shared/comps/lib/kmlImport.js";

const fixture = (name) => fs.readFileSync(path.join(__dirname, "fixtures", "brokerLeaseComps", name), "utf8");

// The owner's header row, verbatim (2026-10-16).
const OWNER_HEADER = "Lease Executed\tLease Commencement\tLease Expiration\tSubmarket\tProperty Name\tAddress\tCity\tTenant\tLandlord\tLeased SF\tTotal Building SF\tLease Transaction Type\tLease Term (months)\tFree Rent (months)\tRent per SF/Month\tBase Rent Increases %\tTI Allowance $/SF\tClear Height Min (ft)\tYear Built\tLoad Type\tx\ty";

describe("NEW-1 red-proof — the owner's exact header row", () => {
  // On main before this fix: Location, Executed, Commence, Term, Rate period, Escal, Free, TI,
  // Clear Ht and Yr Built were all blank, every row read "Type wasn't a column — guessed", and x/y
  // were ignored (so the row had no Location at all).
  it("fills every comp field from one row, and pins x/y at exactly that point", () => {
    const row = "Jun-26\tAug-26\tJan-37\tNorth Fwy\tExample Park Bldg 2\t1200 Example Pkwy\tHouston\tAcme Widgets LLC\tSample REIT\t100,043\t412,500\tNew Lease\t126\t6\t$0.665\t3.75%\t$10.00\t32'\t2026\tFront Load\t-95.442043\t29.927004";
    const [{ draft, cellFlags }] = parsePasteBlock(`${OWNER_HEADER}\n${row}`);
    expect(draft.compType).toBe("lease");
    expect(cellFlags.compType).toBeUndefined(); // the sheet said lease — no "guessed" warning
    expect(draft.compDate).toBe("2026-06-01");
    expect(draft.leaseCommencementDate).toBe("2026-08-01");
    expect(draft.leaseTerm).toBe("126 mo");
    expect(draft.leaseRate).toBe("0.665");
    expect(draft.leaseRatePeriod).toBe("monthly");
    expect(draft.leaseRateExpense).toBe("nnn");
    expect(draft.leaseEscalationPct).toBe("3.75");
    expect(draft.leaseFreeRentMonths).toBe("6");
    expect(draft.leaseTi).toBe("10");
    expect(draft.clearHeightFt).toBe("32");
    expect(draft.yearBuilt).toBe("2026");
    expect(draft.leaseSizeSf).toBe("100043");
    expect(draft.partyProvider).toBe("Sample REIT");
    expect(draft.partyAcquirer).toBe("Acme Widgets LLC");
    expect(draft.title).toBe("Example Park Bldg 2 - Acme Widgets LLC");
    expect(draft.anchor).toMatchObject({ kind: "pin", lat: 29.927004, lon: -95.442043 });
    expect(rowHasBlockingFlags(cellFlags)).toBe(false);
    expect(Object.keys(cellFlags)).toEqual([]);
    // Columns with no comp field ride into Notes, nothing dropped.
    for (const bit of ["Expires Jan-37", "Submarket: North Fwy", "City: Houston", "Total Building SF: 412,500", "Lease Transaction Type: New Lease", "Load Type: Front Load", "Address: 1200 Example Pkwy"]) {
      expect(draft.notes).toContain(bit);
    }
  });

  it("x is LONGITUDE and y is LATITUDE (never swapped), and a swapped sheet is caught by range", () => {
    const hdr = "Tenant\tLandlord\tRate ($/SF/Yr)\tx\ty";
    const [a] = parsePasteBlock(`${hdr}\nT\tL\t8\t-95.4\t29.9`);
    expect(a.draft.anchor).toMatchObject({ lat: 29.9, lon: -95.4 });
    const [b] = parsePasteBlock(`${hdr}\nT\tL\t8\t29.9\t-95.4`);
    expect(b.draft.anchor).toMatchObject({ lat: 29.9, lon: -95.4 });
  });
});

describe("NEW-1 — the owner's sheet shape end to end (invented values)", () => {
  const { mode, rows } = parsePaste(fixture("nHoustonShape.tsv"));
  it("skips the title row and reads every data row", () => {
    expect(mode).toBe("spreadsheet");
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.draft.compType === "lease")).toBe(true);
  });
  it("is ready to save with no warnings at all — every row has a Location and a period", () => {
    for (const r of rows) {
      expect(Object.keys(r.cellFlags)).toEqual([]);
      expect(validateComp(draftToComp({ ...emptyDraft(null), ...r.draft }))).toEqual([]);
    }
  });
  it("keeps the rate's real precision ($0.665 / $0.645 / $0.595 / $0.575 / $0.535 per SF per month)", () => {
    expect(rows.map((r) => r.draft.leaseRate)).toEqual(["0.665", "0.645", "0.595", "0.575", "0.535"]);
    expect(draftToComp({ ...emptyDraft(null), ...rows[0].draft }).leaseRate).toBe(0.665);
  });
  it("prose free rent: the leading number is the months, the full text goes to Notes", () => {
    expect(rows[1].draft.leaseFreeRentMonths).toBe("6");
    expect(rows[1].draft.notes).toContain("Free rent: 6 mo $0.37 NNN");
    expect(rows[2].draft.leaseFreeRentMonths).toBe("9");
    expect(rows[2].draft.notes).toContain("Free rent: 9 (2 mo gross/ 7 mo net)");
    expect(rows[3].draft.leaseFreeRentMonths).toBe("4");
    expect(rows[4].draft.leaseFreeRentMonths).toBe(""); // "-" is blank, not zero
  });
  it("a '-' TI is blank, and a property name that just repeats the address titles by address", () => {
    expect(rows[1].draft.leaseTi).toBe("");
    expect(rows[1].draft.title).toBe("4400 Sample Rd - Fictional Freight Co");
    expect(rows[1].draft.notes).not.toContain("Address:");
  });
});

describe("NEW-1 — other common broker layouts", () => {
  it("CoStar-style export: annual NNN and Modified Gross, Latitude/Longitude, '5 Years' terms", () => {
    const rows = parsePasteBlock(fixture("costarExport.tsv"));
    expect(rows).toHaveLength(2);
    const [a, b] = rows.map((r) => r.draft);
    expect(a).toMatchObject({ compType: "lease", leaseRate: "8.4", leaseRatePeriod: "annual", leaseRateExpense: "nnn", leaseSizeSf: "45000", compDate: "2026-03-15", leaseCommencementDate: "2026-05-01", leaseFreeRentMonths: "3", leaseEscalationPct: "3.5", clearHeightFt: "32", yearBuilt: "2019" });
    expect(a.anchor).toMatchObject({ lat: 29.951, lon: -95.355 });
    expect(a.title).toBe("500 Sample St - Example Tenant Inc");
    expect(a.notes).toContain("Effective Rent: $7.95"); // effective rent is not the face rate
    expect(a.notes).toContain("Building SF: 120,000"); // building size is context when leased SF exists
    expect(b).toMatchObject({ leaseRateExpense: "gross", leaseTerm: "36 mo", clearHeightFt: "24" });
    expect(rows.every((r) => Object.keys(r.cellFlags).length === 0)).toBe(true);
  });
  it("brokerage survey table: RSF, $/SF/Yr, gross vs NNN, address-only rows go to the geocoder", () => {
    const rows = parsePasteBlock(fixture("brokerageTable.tsv"));
    expect(rows).toHaveLength(2); // the survey title row above the header is skipped
    expect(rows[0].draft).toMatchObject({ compType: "lease", leaseRate: "7.2", leaseRatePeriod: "annual", leaseRateExpense: "nnn", leaseSizeSf: "75000", leaseTerm: "62 mo", leaseTi: "5", clearHeightFt: "32", partyAcquirer: "Mock Parts Co", partyProvider: "Sample Dev" });
    expect(rows[0].draft.anchor).toBeNull();
    expect(rows[0].geocodeQuery).toBe("1500 Example Dr, Houston, TX");
    expect(rows[0].cellFlags.leaseCommencementDate?.level).toBe("soft"); // "Q3 2026" IS approximate
    expect(rows[1].draft).toMatchObject({ leaseRateExpense: "gross", leaseRate: "13.5", leaseTerm: "10 yrs" });
    expect(rows[1].draft.notes).toContain("TI: Turnkey");
  });
  it("one 'lat, lon' cell per row; a Monthly period column and a '/SF/yr' cell both read", () => {
    const rows = parsePasteBlock(fixture("latLongCell.tsv"));
    expect(rows[0].draft).toMatchObject({ leaseRate: "0.89", leaseRatePeriod: "monthly", leaseRateExpense: "nnn", title: "Example Business Park B" });
    expect(rows[0].draft.anchor).toMatchObject({ lat: 29.7701, lon: -95.4012 });
    expect(rows[1].draft).toMatchObject({ leaseRate: "10.8", leaseRatePeriod: "annual", leaseRateExpense: "gross" });
  });
});

describe("NEW-1 — the grid's OWN column names paste back into the same fields (round trip)", () => {
  it("every editable sheet column header maps to its own field", () => {
    const header = ["Type", "Location", "Title / Address", "Size", "Unit", "Clear Ht (ft)", "Yr Built", "Executed (ISO)", "Commence (ISO)", "Term (mo)", "Rate", "Per", "Basis", "Escal (%)", "Free (mo)", "TI ($/SF)", "Landlord/Seller", "Tenant/Buyer", "Notes"];
    const row = ["Lease", "29.927004, -95.442043", "1200 Example Pkwy", "100043", "SF", "32", "2026", "2026-06-01", "2026-08-01", "126", "0.665", "monthly", "NNN", "3.75", "6", "10", "Sample REIT", "Acme Widgets", "corner"];
    const [{ draft, cellFlags }] = parsePasteBlock(`${header.join("\t")}\n${row.join("\t")}`);
    expect(draft).toMatchObject({
      compType: "lease", title: "1200 Example Pkwy", leaseSizeSf: "100043", clearHeightFt: "32", yearBuilt: "2026",
      compDate: "2026-06-01", leaseCommencementDate: "2026-08-01", leaseTerm: "126 mo", leaseRate: "0.665",
      leaseRatePeriod: "monthly", leaseRateExpense: "nnn", leaseEscalationPct: "3.75", leaseFreeRentMonths: "6",
      leaseTi: "10", partyProvider: "Sample REIT", partyAcquirer: "Acme Widgets", notes: "corner",
    });
    expect(draft.anchor).toMatchObject({ lat: 29.927004, lon: -95.442043 });
    expect(cellFlags.leaseRatePeriod).toBeUndefined(); // no "Rate has no period"
  });
  it("every label the sheet actually renders is claimed by a real rule (none falls through to Notes)", () => {
    const skip = new Set(["Location", "$/SF or $/AC", "$/SF/yr"]); // Location tested above; derived columns aren't inputs
    for (const col of [...SHEET_COLUMNS, NOTES_COLUMN]) {
      if (skip.has(col.label) || col.kind === "derived") continue;
      const m = matchHeaderCell(col.label);
      expect(m && m.key, `${col.label}`).not.toBe("extra");
    }
  });
});

describe("NEW-1 — header matching is case- and punctuation-insensitive and priority-ordered", () => {
  it.each([
    ["LEASE EXECUTED", "compDate"], ["lease_commencement", "commencementDate"], ["Base Rent Increases %", "escalationPct"],
    ["TI Allowance $/SF", "ti"], ["Tenant Improvement Allowance", "ti"], ["Rent per SF/Month", "rate"], ["Lease Transaction Type", "extra"],
    ["Load Type", "extra"], ["Longitude", "lon"], ["LAT", "lat"], ["Lat/Long", "latlon"], ["Clear Height Min (ft)", "clearHeightFt"],
    ["Free Rent (months)", "freeRentMonths"], ["Lease Term (months)", "term"], ["Landlord", "partyProvider"], ["Tenant", "partyAcquirer"],
  ])("%s → %s", (h, key) => { expect(matchHeaderCell(h).key).toBe(key); });
  it("a rate header names its period", () => {
    expect(matchHeaderCell("Rent per SF/Month").period).toBe("monthly");
    expect(matchHeaderCell("Rate ($/SF/Yr)").period).toBe("annual");
    expect(matchHeaderCell("Rate").period).toBeNull();
  });
  it("lat/lon pairs read in order, with a lon-first pair caught by range", () => {
    expect(parseLatLonPair("29.927004, -95.442043")).toEqual({ lat: 29.927004, lon: -95.442043 });
    expect(parseLatLonPair("-95.442043, 29.927004")).toEqual({ lat: 29.927004, lon: -95.442043 });
    expect(parseLatLonPair("not a place")).toBeNull();
  });
  it("a plain 'Rate' column with no period anywhere still blocks (unchanged)", () => {
    const [r] = parsePasteBlock("Type\tDate\tRate\nLease\t2026-08-01\t0.68");
    expect(r.cellFlags.leaseRatePeriod?.level).toBe("blocking");
  });
});

describe("NEW-1 — text paths: rate precision, clear height, year built", () => {
  it("a labelled abstract keeps $0.665 (it used to round to 0.67)", () => {
    const r = parseSingleRecord("Tenant: Acme\nLandlord: Sample\nRate: $0.665/SF/mo NNN\nTerm: 126 months");
    expect(r.draft.leaseRate).toBe("0.665");
  });
  it("reads clear height and year built from text", () => {
    const r = parseSingleRecord("Tenant: Acme\n$0.65/SF/mo NNN\n32' clear\nbuilt 2019");
    expect(r.draft.clearHeightFt).toBe("32");
    expect(r.draft.yearBuilt).toBe("2019");
    const l = parseSingleRecord("Tenant: Acme\nRate: $0.65/SF/mo\nClear Height: 36 ft\nYear Built: 2024");
    expect(l.draft.clearHeightFt).toBe("36");
    expect(l.draft.yearBuilt).toBe("2024");
  });
});

describe("NEW-1 — KML placemark names decode HTML entities", () => {
  it("'Dircks Moving &amp; Logistics' is saved as 'Dircks Moving & Logistics'", () => {
    const kml = "<kml><Placemark><name>Dircks Moving &amp; Logistics</name><Point><coordinates>-95.4,29.9,0</coordinates></Point></Placemark>" +
      "<Placemark><name>A &#38; B</name></Placemark></kml>";
    const [a, b] = parseKmlPlacemarks(kml);
    expect(a.name).toBe("Dircks Moving & Logistics");
    expect(b.name).toBe("A & B");
  });
});
