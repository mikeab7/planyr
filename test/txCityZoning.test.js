/* Texas city zoning — Richmond, Fulshear, Stafford (NEW-1, 2026-11-12): the pure rules, over the REAL values each city's layer holds (measured 2026-11-12, every polygon). */
import { describe, it, expect } from "vitest";
import {
  normalizeCode, dateFromMs, docHref, withName, makeCityZoning, ZONE_COLORS, RICHMOND, FULSHEAR, FULSHEAR_NEWER, STAFFORD, WEBSTER, WEBSTER_PD, WEBSTER_ZONE_NAMES, TX_CITY_ZONING, KATY, KATY_FLU, KATY_FLU_CLASSES, KATY_TP, KATY_TP_CLASSES,
} from "../src/workspaces/site-planner/lib/txCityZoning.js";

const ms = (y, m, d) => Date.UTC(y, m - 1, d);
const ENC = "http://online.encodeplus.com/regs/richmond-tx/doc-viewer.aspx#secid-";
const rows = (card) => Object.fromEntries(card.rows.map((r) => [r.label, r]));

describe("shared readers", () => {
  it.each([["R- 4", "R-4"], [" dn ", "DN"], ["MU-2", "MU-2"], ["", ""], [null, ""]])("normalizeCode %j → %j", (a, b) => expect(normalizeCode(a)).toBe(b));
  it("dateFromMs: a real date reads in plain words; blank and the placeholder 1900-01-01 (six Fulshear polygons) read as nothing", () => {
    expect(dateFromMs(ms(2015, 9, 21))).toBe("Sep 21, 2015");
    expect(dateFromMs(1442793600000)).toBe("Sep 21, 2015"); // Richmond's real ZoneDate value
    expect(dateFromMs(-2209161600000)).toBeNull(); // Fulshear's Effect_Dat on six polygons = 1900-01-01
    for (const v of [null, undefined, "", "x", NaN]) expect(dateFromMs(v)).toBeNull();
  });
  it("docHref keeps a link on the city's own document host exactly as published, and refuses prose and other hosts", () => {
    expect(docHref(ENC + "653", /(^|\.)encodeplus\.com$/i)).toBe(ENC + "653");
    expect(docHref("SEE ORDINANCES #986, 1036, & 1037", /municode\.com$/i)).toBeNull(); // Stafford MU-2
    expect(docHref("https://evil.example.com/x", /municode\.com$/i)).toBeNull();
    expect(docHref("javascript:alert(1)", /municode\.com$/i)).toBeNull();
    expect(docHref(null, /municode\.com$/i)).toBeNull();
  });
  it("withName is 'code · name', or whichever the city gives", () => {
    expect(withName("SC", "Suburban Commercial")).toBe("SC · Suburban Commercial");
    expect(withName("SC", "")).toBe("SC");
    expect(withName(null, "Manufactured Homes")).toBe("Manufactured Homes");
    expect(withName(null, null)).toBe("");
  });
  it("the family colours exist and 'other' is the neutral grey", () => {
    for (const f of ["residential", "business", "industrial", "mixed", "pud", "institutional", "other"]) expect(ZONE_COLORS[f], f).toMatch(/^#[0-9a-f]{6}$/);
    expect(ZONE_COLORS.other).toBe("#6b7280");
  });
});

describe("Richmond — real values", () => {
  const SC = { Zone: "SC", ZoneDesc: "SC   SUBURBAN  COMMERCIAL", ECP_Zone: "SC", ECP_Zone_Description: "SUBURBAN  COMMERCIAL", ZOrdinance: "2016-10", ZoneChange: "Ordinance Change from GR to SC", ZoneDate: ms(2016, 3, 28),
    District_Purpose: ENC + "651", Land_Use_Allowance: ENC + "653", Density_Lot_and_Scale_Standard_1: null, Density_Lot_and_Scale_Standar_1: ENC + "669", Parking_Requirements: ENC + "702" };
  it("reads the code and the city's own name, doubled spaces collapsed", () => {
    expect(RICHMOND.codeOf(SC)).toBe("SC");
    expect(RICHMOND.nameOf(SC)).toBe("Suburban Commercial");
  });
  it("closes ' - ' in 'MIXED - USE' and keeps '/' words: Public / Institutional", () => {
    expect(RICHMOND.nameOf({ Zone: "MU", ECP_Zone_Description: "MIXED - USE" })).toBe("Mixed-Use");
    expect(RICHMOND.nameOf({ Zone: "PI", ECP_Zone_Description: "PUBLIC / INSTITUTIONAL" })).toBe("Public / Institutional");
    expect(RICHMOND.nameOf({ Zone: "OT", ECP_Zone_Description: "OLDE  TOWN" })).toBe("Olde Town");
  });
  it("falls back to ZoneDesc minus its leading code when the description field is blank", () => {
    expect(RICHMOND.nameOf({ Zone: "DN", ZoneDesc: "DN   DOWNTOWN" })).toBe("Downtown");
  });
  it("the click card: zone, ordinance, the last change, adoption date, and four short links — no raw field names, no blank rows, no raw URL text", () => {
    const c = RICHMOND.card(SC);
    expect(c.title).toBe("Zoning · Richmond");
    const r = rows(c);
    expect(r.Zone.text).toBe("SC · Suburban Commercial");
    expect(r.Ordinance.text).toBe("2016-10");
    expect(r["Last change"].text).toBe("Ordinance Change from GR to SC");
    expect(r.Adopted.text).toBe("Mar 28, 2016");
    expect(r["District purpose"]).toEqual({ label: "District purpose", text: "Open", href: ENC + "651" });
    expect(r["Allowed uses"].href).toBe(ENC + "653");
    expect(r["Lot and density standards"].href).toBe(ENC + "669");
    expect(r["Parking requirements"].href).toBe(ENC + "702");
    for (const row of c.rows) { expect(row.text, row.label).toBeTruthy(); expect(row.label, row.label).not.toMatch(/[_]|^[A-Z]+$/); expect(row.text, row.label).not.toMatch(/^https?:/); }
  });
  it("a link field that is empty (Downtown has no density link) simply has no row", () => {
    const c = RICHMOND.card({ Zone: "DN", ECP_Zone_Description: "DOWNTOWN", District_Purpose: ENC + "651", Density_Lot_and_Scale_Standar_1: null });
    expect(c.rows.map((x) => x.label)).toEqual(["Zone", "District purpose"]);
  });
  it("a link on another host is never offered", () => {
    expect(RICHMOND.card({ Zone: "GR", District_Purpose: "http://evil.example.com/x" }).rows.some((x) => x.href)).toBe(false);
  });
  it("classes every code the layer holds into a family (none unclassed); unknown stays neutral", () => {
    const fam = { SR: "residential", GR: "residential", SC: "business", GC: "business", DN: "mixed", OT: "mixed", MU: "mixed", IN: "industrial", PI: "institutional" };
    for (const [z, f] of Object.entries(fam)) expect(RICHMOND.familyOf({ Zone: z }), z).toBe(f);
    expect(RICHMOND.familyOf({ Zone: "ZZ" })).toBe("other");
  });
});

describe("Fulshear — real values, two overlapping layers", () => {
  const IND = { Zone_Distr: "I", OrdNo: " ", Zone_Prev: "INDUSTRIAL", Zone_Rev: "INDUSTRIAL", Effect_Dat: null, Comments: "I-1" };
  it("an INDUSTRIAL polygon: code I, the city's name, the city's note shown as a note (never read as the code)", () => {
    expect(FULSHEAR.codeOf(IND)).toBe("I");
    expect(FULSHEAR.nameOf(IND)).toBe("Industrial");
    expect(FULSHEAR.familyOf(IND)).toBe("industrial");
    const r = rows(FULSHEAR.card(IND));
    expect(r.Zone.text).toBe("I · Industrial");
    expect(r["City's note"].text).toBe("I-1");
    expect(r.Ordinance).toBeUndefined(); // OrdNo is a single space
    expect(r.Effective).toBeUndefined();
  });
  it("the 1900-01-01 placeholder date is never shown; a real one is", () => {
    expect(rows(FULSHEAR_NEWER.card({ ...IND, Effect_Dat: -2209161600000 })).Effective).toBeUndefined();
    expect(rows(FULSHEAR_NEWER.card({ ...IND, Effect_Dat: ms(2024, 5, 14) })).Effective.text).toBe("May 14, 2024");
  });
  it("a polygon with NO code (3 older ones) shows its name only and prints no on-map label", () => {
    const mh = { Zone_Distr: " ", Zone_Rev: "MANUFACTURED HOMES", Zone_Prev: "MANUFACTURED HOMES" };
    expect(FULSHEAR.codeOf(mh)).toBeNull();
    expect(rows(FULSHEAR.card(mh)).Zone.text).toBe("Manufactured Homes");
    expect(FULSHEAR.labelText(" ")).toBeNull();
    expect(FULSHEAR.labelText("dd")).toBe("DD");
    expect(FULSHEAR.familyOf(mh)).toBe("residential");
  });
  it("code and name that disagree (MU / COMMERCIAL on one older polygon) are both shown as the city's record carries them — never reconciled", () => {
    const mu = { Zone_Distr: "MU", Zone_Rev: "COMMERCIAL", Zone_Prev: "SEMI-URBAN RESIDENTIAL" };
    const r = rows(FULSHEAR.card(mu));
    expect(r.Zone.text).toBe("MU · Commercial");
    expect(r.Previously.text).toBe("Semi-Urban Residential");
  });
  it("'Previously' appears only when the earlier district differs", () => {
    expect(rows(FULSHEAR.card(IND)).Previously).toBeUndefined();
    expect(rows(FULSHEAR.card({ Zone_Distr: "DD", Zone_Rev: "DOWNTOWN DISTRICT", Zone_Prev: "ESTATE RESIDENTIAL" })).Previously.text).toBe("Estate Residential");
  });
  it("each layer's card says which layer it is from, in its title and its Layer row", () => {
    expect(FULSHEAR.card(IND).title).toBe("Zoning · Fulshear (earlier map)");
    expect(FULSHEAR_NEWER.card(IND).title).toBe("Zoning · Fulshear (newer map)");
    expect(rows(FULSHEAR.card(IND)).Layer.text).toMatch(/Earlier .*Sep 2023/);
    expect(rows(FULSHEAR_NEWER.card(IND)).Layer.text).toMatch(/Newer .*Oct 2026/);
  });
  it("classes every name the two layers hold", () => {
    const names = { "SEMI-URBAN RESIDENTIAL": "residential", "SUBURBAN RESIDENTIAL": "residential", "ESTATE RESIDENTIAL": "residential", "MANUFACTURED HOMES": "residential", COMMERCIAL: "business", "DOWNTOWN DISTRICT": "mixed", INDUSTRIAL: "industrial", "PLANNED UNIT DEVELOPMENT": "pud" };
    for (const [n, f] of Object.entries(names)) expect(FULSHEAR.familyOf({ Zone_Distr: "X", Zone_Rev: n }), n).toBe(f);
    expect(FULSHEAR.familyOf({ Zone_Distr: "X", Zone_Rev: "SOMETHING NEW" })).toBe("other");
  });
});

describe("Stafford — real values", () => {
  const RCT = { ZONE_CODE: "RCT", ZONE_DESCR: "RESIDENTIAL, COMMERCIAL, & TECHNOLOGY DISTRICT", CODE_LINK: "https://library.municode.com/tx/stafford/codes/code_of_ordinances?nodeId=PTIICOOR_CH102ZO_ARTIVZODI_S102-76RESCOTEDI" };
  it("R130561 Dalho reads RCT — Residential, Commercial, & Technology District", () => {
    expect(rows(STAFFORD.card(RCT)).Zone.text).toBe("RCT · Residential, Commercial, & Technology District");
    expect(STAFFORD.card(RCT).title).toBe("Zoning · Stafford");
  });
  it("the Municode link is a short labelled link", () => {
    expect(rows(STAFFORD.card(RCT))["Zoning code"]).toEqual({ label: "Zoning code", text: "Open", href: RCT.CODE_LINK });
  });
  it("MU-2's CODE_LINK is prose ('SEE ORDINANCES #986, 1036, & 1037'): shown as the city's note, never as a link", () => {
    const r = rows(STAFFORD.card({ ZONE_CODE: "MU-2", ZONE_DESCR: "MIXED USE (-2) DEVELOPMENT DISTRICT - STREETLEVEL", CODE_LINK: "SEE ORDINANCES #986, 1036, & 1037" }));
    expect(r["Zoning code"]).toBeUndefined();
    expect(r["City's note"].text).toBe("See Ordinances #986, 1036, & 1037");
    expect(r.Zone.text).toBe("MU-2 · Mixed Use (-2) Development District - Streetlevel");
  });
  it("names read as words, including the dotted and hyphenated ones", () => {
    expect(STAFFORD.nameOf({ ZONE_DESCR: "U.S. 90-A ISLAND DISTRICT" })).toBe("U.S. 90-A Island District");
    expect(STAFFORD.nameOf({ ZONE_DESCR: "ARTS & EDUCATION DISTRICT" })).toBe("Arts & Education District");
  });
  it("classes all eleven codes", () => {
    const fam = { AE: "institutional", PDD: "pud", IS: "other", "MU-2": "mixed", "MU-1": "mixed", MFR: "residential", RCLM: "business", RCT: "business", MU: "mixed", SFR: "residential", PC: "business" };
    for (const [z, f] of Object.entries(fam)) expect(STAFFORD.familyOf({ ZONE_CODE: z }), z).toBe(f);
  });
});

describe("Webster — real values, two layers of one map", () => {
  const MUNI = "https://library.municode.com/tx/webster/codes/code_of_ordinances?nodeId=PTIICOOR_CH98ZO_ARTIIIZODIRE_S98-47SECODI";
  const USE = "https://www.municode.com/library/tx/webster/codes/code_of_ordinances?nodeId=PTIICOOR_CH98ZO_ARTIVSCUS";
  const C2 = { ZONE_: "C2", ORDINANCE: " ", DATE_: null, Zone_Link: MUNI, Use_Link: USE, District_Summary: "https://www1.cityofwebster.com/Link/Zoning/C2.pdf" };
  it("a base polygon reads its code and the city's renderer name; a blank ordinance and a null date make no rows", () => {
    const c = WEBSTER.card(C2);
    expect(c.title).toBe("Zoning · Webster");
    const r = rows(c);
    expect(r.Zone.text).toBe("C2 · Second Commercial District");
    expect(r.Ordinance).toBeUndefined();
    expect(r.Adopted).toBeUndefined();
    expect(r["District section of the code"].href).toBe(MUNI);
    expect(r["Allowed uses"].href).toBe(USE);
    expect(r["District summary (PDF)"].href).toBe("https://www1.cityofwebster.com/Link/Zoning/C2.pdf");
  });
  it("names are the layer's own renderer labels for every code the layer draws (and M2, which it lists but draws none of)", () => {
    expect(WEBSTER_ZONE_NAMES).toEqual({
      NP: "NASA Parkway District", R1: "Single Family Residential", R1A: "Enhanced Single Family Residential", R2: "Multiple Family Residential", O: "Office District",
      C1: "First Commercial District", C2: "Second Commercial District", C3: "Third Commercial District", M1: "First Industrial District", M2: "Second Industrial District", PD: "Planned Development",
    });
    expect(rows(WEBSTER.card({ ZONE_: "M1" })).Zone.text).toBe("M1 · First Industrial District");
    expect(rows(WEBSTER.card({ ZONE_: "R1A" })).Zone.text).toBe("R1A · Enhanced Single Family Residential");
  });
  it("a code the city's legend has no name for shows bare — never a guess", () => {
    expect(rows(WEBSTER.card({ ZONE_: "Q9" })).Zone.text).toBe("Q9");
    expect(WEBSTER.familyOf({ ZONE_: "Q9" })).toBe("other");
  });
  it("classes every code", () => {
    const fam = { R1: "residential", R1A: "residential", R2: "residential", O: "business", C1: "business", C2: "business", C3: "business", NP: "mixed", M1: "industrial", M2: "industrial", PD: "pud" };
    for (const [z, f] of Object.entries(fam)) expect(WEBSTER.familyOf({ ZONE_: z }), z).toBe(f);
  });
  it("a real ordinance and date show; the layer's 1899-12-30 blank date does not", () => {
    expect(rows(WEBSTER.card({ ZONE_: "C1", ORDINANCE: "03-23", DATE_: Date.UTC(2003, 1, 4) })).Adopted.text).toBe("Feb 4, 2003");
    expect(rows(WEBSTER_PD.card({ ZONE_: "PD", DATE_: Date.UTC(1899, 11, 30) })).Adopted).toBeUndefined();
  });
  it("a planned development card: the named development, its location, the guide's ordinance, and links — backslashes mended, off-host links refused", () => {
    const pd = { ZONE_: "PD", ORDINANCE: "06-04", DATE_: Date.UTC(2006, 3, 4), PD_Guide_Name: "Egret Bay Center", PD_Guide_Location: "18401 Egret Bay Blvd, Webster, TX", PD_Guide_Ordinance: "21-09",
      PD_Guide_Hyperlink: "https://www1.cityofwebster.com\\Link\\Planned_Development\\Egret_Bay_Center_21_09.pdf", Ord_Link: "https://www1.cityofwebster.com/Link/Ordinance/Egret_Bay_Center_21_09.pdf", Zone_Link: MUNI };
    const c = WEBSTER_PD.card(pd);
    expect(c.title).toBe("Zoning · Webster (planned development)");
    const r = rows(c);
    expect(r.Zone.text).toBe("PD · Planned Development");
    expect(r["Planned development"].text).toBe("Egret Bay Center");
    expect(r.Location.text).toBe("18401 Egret Bay Blvd, Webster, TX");
    expect(r["Development guide ordinance"].text).toBe("21-09");
    expect(r["Development guide (PDF)"].href).toBe("https://www1.cityofwebster.com/Link/Planned_Development/Egret_Bay_Center_21_09.pdf");
    expect(r["Ordinance (PDF)"].href).toBe("https://www1.cityofwebster.com/Link/Ordinance/Egret_Bay_Center_21_09.pdf");
    expect(rows(WEBSTER_PD.card({ ZONE_: "PD", Ord_Link: "https://evil.example.com/x.pdf" }))["Ordinance (PDF)"]).toBeUndefined();
  });
  it("a PD polygon with no named guide (28 of 45) has only the rows it has", () => {
    expect(WEBSTER_PD.card({ ZONE_: "PD", ORDINANCE: "07-25" }).rows.map((x) => x.label)).toEqual(["Zone", "Ordinance"]);
  });
});

describe("style, legend and the owner's rules (#42 #45 #50)", () => {
  it("fill follows the opacity it is handed and never exceeds 0.45; the outline is the family colour", () => {
    const s = RICHMOND.style({ Zone: "IN" }, 1);
    expect(s.color).toBe(ZONE_COLORS.industrial);
    expect(s.fillColor).toBe(ZONE_COLORS.industrial);
    expect(s.fillOpacity).toBe(0.45);
    expect(s.opacity).toBe(1);
    expect(RICHMOND.style({ Zone: "IN" }, 0.5).fillOpacity).toBeCloseTo(0.3);
  });
  it("the legend is headed by the city, ONE code per row, family-sorted, duplicates folded (#50)", () => {
    const feats = ["GR", "SC", "GR", "IN", "PI", "SC"].map((z) => ({ properties: { Zone: z, ECP_Zone_Description: { GR: "GENERAL  RESIDENTIAL", SC: "SUBURBAN  COMMERCIAL", IN: "INDUSTRIAL", PI: "PUBLIC / INSTITUTIONAL" }[z] } }));
    const lg = RICHMOND.legend(RICHMOND.legendItemsOf(feats));
    expect(lg[0]).toEqual({ heading: true, label: "Richmond" });
    expect(lg.slice(1).map((x) => x.label)).toEqual(["GR · General Residential", "SC · Suburban Commercial", "IN · Industrial", "PI · Public / Institutional"]);
    expect(lg.slice(1).every((x) => x.row && x.color)).toBe(true);
    expect(lg.filter((x) => x.heading)).toHaveLength(1);
  });
  it("Fulshear's legend lists a code-less district by name and the same name under two codes as two rows", () => {
    const feats = [{ properties: { Zone_Distr: "DD", Zone_Rev: "DOWNTOWN DISTRICT" } }, { properties: { Zone_Distr: "D", Zone_Rev: "DOWNTOWN DISTRICT" } }, { properties: { Zone_Distr: " ", Zone_Rev: "MANUFACTURED HOMES" } }];
    const lg = FULSHEAR.legend(FULSHEAR.legendItemsOf(feats));
    expect(lg[0]).toEqual({ heading: true, label: "Fulshear" });
    expect(lg.slice(1).map((x) => x.label).sort()).toEqual(["D · Downtown District", "DD · Downtown District", "Manufactured Homes"]);
  });
  it("nothing in view → no legend at all (no orphan heading)", () => {
    expect(STAFFORD.legend([])).toEqual([]);
    expect(STAFFORD.legend(STAFFORD.legendItemsOf([{ properties: {} }]))).toEqual([]);
  });
  it("a card never lists a blank row even for an empty record", () => {
    for (const z of Object.values(TX_CITY_ZONING)) { const c = z.card({}); expect(c.rows.filter((r) => !String(r.text || "").trim())).toEqual([]); }
  });
  it("makeCityZoning is the one factory (no city re-implements the card shell)", () => {
    const z = makeCityZoning({ city: "Test", codeOf: (p) => p.c, nameOf: (p) => p.n, classOf: () => "other", extraRows: () => [], citation: "x", labelField: "c" });
    expect(z.card({ c: "a", n: "B" }).rows).toEqual([{ label: "Zone", text: "A · B" }]);
  });
});

describe("Katy — real values from the city's Planning_Map (measured 2026-11-24)", () => {
  const ECODE = "https://ecode360.com/38859247";
  it("a named district: code · the city's own name, the ordinance as a short link (never a raw URL, #45)", () => {
    const c = KATY.card({ ZONECODE: "M", ZONDESC: "Industrial District", LINK: ECODE });
    expect(c.title).toBe("Zoning · Katy");
    const r = rows(c);
    expect(r.Zone.text).toBe("M · Industrial District");
    expect(r.Ordinance).toEqual({ label: "Ordinance", text: "Open", href: ECODE });
    expect(c.rows.map((x) => x.label)).toEqual(["Zone", "Ordinance"]);
  });
  it("a planned district's 'code' is the development's name: shown once, as the name, with the code dropped", () => {
    const p = { ZONECODE: "Katy Boardwalk PDD", ZONDESC: "Katy Boardwalk Planned Development District" };
    expect(rows(KATY.card(p)).Zone.text).toBe("Katy Boardwalk Planned Development District");
    expect(KATY.familyOf(p)).toBe("pud");
    expect(KATY.labelText("Katy Boardwalk PDD")).toBe("Katy Boardwalk PDD"); // the city's own text, as written
    const lg = KATY.legend(KATY.legendItemsOf([{ properties: p }, { properties: { ZONECODE: "R-1", ZONDESC: "Single Family Residential" } }]));
    expect(lg[0]).toEqual({ heading: true, label: "Katy" });
    expect(lg.slice(1).map((r) => r.label)).toEqual(["R-1 · Single Family Residential", "Katy Boardwalk Planned Development District"]);
  });
  it("a code with no description shows bare (#46), a foreign link host is not offered, and a blank record draws no rows", () => {
    expect(rows(KATY.card({ ZONECODE: "C-9", ZONDESC: "  ", LINK: "https://example.com/x" })).Zone.text).toBe("C-9");
    expect(rows(KATY.card({ ZONECODE: "C-9", ZONDESC: "", LINK: "https://example.com/x" })).Ordinance).toBeUndefined();
    expect(KATY.card({}).rows).toEqual([]);
  });
  it("families: residential R-1/MH, business C-1/C-2, industrial M, mixed OKD, unknown neutral", () => {
    const fam = (c, d) => KATY.familyOf({ ZONECODE: c, ZONDESC: d });
    expect([fam("R-1", "x"), fam("MH", "x"), fam("C-1", "x"), fam("C-2", "x"), fam("M", "x"), fam("OKD", "Old Katy District"), fam("Z-9", "x")])
      .toEqual(["residential", "residential", "business", "business", "industrial", "mixed", "other"]);
  });
  it("future land use: names and colours are the city's own legend; ROW is bare; the jurisdiction is a row; owner and address are never read", () => {
    expect(Object.keys(KATY_FLU_CLASSES)).toHaveLength(15);
    const c = KATY_FLU.card({ FLU: "GC", Jurisdiction: "City of Katy", OWNERNAME: "SOMEONE", FULLADDR: "1 MAIN ST" });
    expect(c.title).toBe("Future land use · Katy");
    expect(c.rows).toEqual([{ label: "Zone", text: "GC · General Commercial" }, { label: "Jurisdiction", text: "City of Katy" }]);
    expect(KATY_FLU.style({ FLU: "I" }, 1)).toMatchObject({ color: "#7a81cc", fillColor: "#7a81cc" });
    expect(rows(KATY_FLU.card({ FLU: "ROW" })).Zone.text).toBe("ROW");
    expect(KATY_FLU.style({ FLU: "ROW" }, 1).color).toBe(ZONE_COLORS.other);
    expect(KATY_FLU.card({ FLU: "SR", Jurisdiction: "NOT IN" }).rows.map((r) => r.label)).toEqual(["Zone"]);
    expect(KATY_FLU.card({}).rows).toEqual([]);
  });
  it("thoroughfare plan: the city's five classes, proposed ones dashed, a card with the street and class only", () => {
    expect(Object.values(KATY_TP_CLASSES).map((c) => c.label)).toEqual(["Interstate Freeway", "Major Street", "Collector Street", "Proposed Major Street", "Proposed Collector Street"]);
    expect(KATY_TP.style({ ThoroClass: "Proposed Major" }, 1).dashArray).toBeTruthy();
    expect(KATY_TP.style({ ThoroClass: "Major" }, 1).dashArray).toBeUndefined();
    const c = KATY_TP.card({ FullStreet: "KATY FORT BEND RD", StreetName: "KATY FORT BEND", ThoroClass: "Major", Maintain: 1, RoadClass: "Major" });
    expect(c).toEqual({ title: "Katy Fort Bend Rd", rows: [{ label: "Class", text: "Major Street" }] });
    expect(KATY_TP.card({}).title).toBe("Thoroughfare");
    expect(KATY_TP.legend(KATY_TP.legendItemsOf([{ properties: { ThoroClass: "Collector" } }, { properties: { ThoroClass: "Collector" } }])).map((r) => r.label)).toEqual(["Katy", "Collector Street"]);
    expect(KATY_TP.legend([])).toEqual([]);
  });
});
