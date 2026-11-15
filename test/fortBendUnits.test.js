import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  parsePortalIndex, parsePortalRates, parseFbcadLegend, parseTaxUnitsField, reportedIn, assemble, lookupFortBend, unitName,
  FBCAD_LAYER, PORTAL, TIRZ_LAYER, FBCAD_RATES_URL,
} from "../functions/api/lib/fortBendUnits.js";

// NEW-1 (2026-11-12). Fixtures are REAL pages from taxrateinfo.fortbendcountytx.gov, trimmed to the table (test/fixtures/fortbend).
// The FBCAD legend fixture is SYNTHETIC — fbcad.org is not reachable from the build sandbox — shaped from the brief's description
// (Code · Description · Type · Contact Name · State Number · Total Rate …); the parser is header-driven and fails safe.
const FX = path.resolve(__dirname, "fixtures/fortbend");
const read = (f) => fs.readFileSync(path.join(FX, f), "utf8");
// The lookup refuses an index with under 50 units (a changed page shape must not read as "no units"), so the served page is the
// real fixture plus filler rows; `index` for the pure tests is the fixture alone.
const FILLER = Array.from({ length: 60 }, (_, i) => `<tr><td style="display:none">${i}</td><td>SPECIAL DISTRICT</td><td>Z${i}</td><td>FILLER ${i}</td></tr>`).join("");
const indexHtml = () => read("portal-index.html").replace("</tbody>", `${FILLER}</tbody>`);
const index = parsePortalIndex(read("portal-index.html"));
const hist = (c) => parsePortalRates(read(`unit-${c}.html`));
const H = (...cs) => Object.fromEntries(cs.map((c) => [c, hist(c)]));

const FBCAD_SYNTH = `<table><thead><tr><th>Code</th><th>Description</th><th>Type</th><th>Contact Name</th><th>State Number</th><th>Total Rate</th><th>I&amp;S</th><th>M&amp;O</th><th>Prev Rate</th></tr></thead><tbody>
<tr><td>M184</td><td>FORT BEND MUD 214</td><td>MUD</td><td>x</td><td>07937184</td><td>NA</td><td>NA</td><td>NA</td><td>NA</td></tr>
<tr><td>SM106</td><td>WEST FORT BEND MANAGEMENT DISTRICT</td><td>SPECIAL</td><td>x</td><td>07920106</td><td></td><td></td><td></td><td></td></tr>
<tr><td>S07</td><td>FORT BEND ISD</td><td>SCHOOL</td><td>x</td><td>07990702</td><td>0.9869000</td><td>0.27</td><td>0.7169</td><td>0.9892</td></tr></tbody></table>`;

describe("portal parsers (real pages)", () => {
  it("index: type + name keyed by the FBCAD code", () => {
    expect(index.S07).toEqual({ type: "SCHOOL DISTRICT", name: "FORT BEND ISD" });
    expect(index.C21.name).toBe("SUGAR LAND, CITY OF");
    expect(index.M244.name).toMatch(/IMPERIAL/);
  });
  it("unit page: adopted rate per year, newest first (S07 2025 = 1.056900 = M&O 0.786900 + debt 0.270000)", () => {
    const s07 = hist("S07");
    const y25 = s07.find((r) => r.year === 2025);
    expect(y25).toMatchObject({ rate: 1.0569, mo: 0.7869, debt: 0.27 });
    expect(s07[0].year).toBeGreaterThanOrEqual(2025);
    expect(s07.map((r) => r.year)).toEqual([...s07.map((r) => r.year)].sort((a, b) => b - a));
  });
  it("the county's general fund rate is 0.412 for 2025 — NOT the Comptroller's 0.824 county total (GF + R&B + FMFC)", () => {
    expect(hist("G01").find((r) => r.year === 2025).rate).toBe(0.412);
  });
  it("TAXUNITS field → distinct upper-case codes", () => {
    expect(parseTaxUnitsField("C21,D01, g01,S07,CAD,S07")).toEqual(["C21", "D01", "G01", "S07", "CAD"]);
    expect(parseTaxUnitsField(null)).toEqual([]);
  });
  it("FBCAD legend parser is header-driven and keeps NA / blank apart", () => {
    const l = parseFbcadLegend(FBCAD_SYNTH);
    expect(l.M184).toMatchObject({ total: "NA", stateNo: "07937184" });
    expect(l.SM106.total).toBeNull();
    expect(l.S07.total).toBe(0.9869);
    expect(parseFbcadLegend("<p>no table</p>")).toEqual({});
  });
  it("names read like names", () => {
    expect(unitName("SUGAR LAND, CITY OF")).toBe("City of Sugar Land");
    expect(unitName("FORT BEND MUD 134C")).toBe("Fort Bend MUD 134C");
    expect(unitName("HOUSTON CITY COLLEGE-STAFFORD")).toBe("Houston City College-Stafford");
  });
});

describe("reportedIn — a zero is real only for a unit that never showed a rate", () => {
  it("positive rate in the year", () => expect(reportedIn([{ year: 2025, rate: 0.5 }, { year: 2024, rate: 0.5 }], 2025)).toBe(true));
  it("zero after a positive year = NOT PROVIDED (the portal's own footnote), so the year is skipped", () => {
    expect(reportedIn([{ year: 2026, rate: 0 }, { year: 2025, rate: 0.5 }], 2026)).toBe(false);
    expect(reportedIn([{ year: 2026, rate: 0 }, { year: 2025, rate: 0.5 }], 2025)).toBe(true);
  });
  it("all-zero history (Stafford levies no property tax) is a genuine zero in every year", () => {
    expect(reportedIn(hist("C19"), 2026)).toBe(true);
    expect(reportedIn([], 2025)).toBe(false);
  });
  it("a year the unit has no row for is not reported", () => expect(reportedIn([{ year: 2025, rate: 0.5 }], 2026)).toBe(false));
});

describe("assemble — the five accounts the sweep named (rates pinned to 2025 = the brief's year)", () => {
  const base = { index, maxYear: 2025 };
  it("R33231 Sugar Land: C21 · D01 · G01 · S07, S07 = 1.056900", () => {
    const r = assemble({ ...base, codes: parseTaxUnitsField("C21,D01,G01,S07,CAD"), hist: H("C21", "D01", "G01", "S07") });
    expect(r.complete).toBe(true);
    expect(r.year).toBe(2025);
    expect(r.units.map((u) => u.code)).toEqual(["C21", "D01", "G01", "S07"]);
    expect(r.units.find((u) => u.code === "S07").rate).toBe(1.0569);
    expect(r.total).toBe(1.837727);
  });
  it("R130561 Stafford: C19 0.000000 · D01 · G01 · J03 · S11 · W03", () => {
    const r = assemble({ ...base, codes: parseTaxUnitsField("C19,D01,G01,J03,S11,W03,CAD"), hist: H("C19", "D01", "G01", "J03", "S11", "W03") });
    expect(r.complete).toBe(true);
    expect(r.units.find((u) => u.code === "C19")).toMatchObject({ rate: 0, note: "no adopted rate" });
    expect(r.units.find((u) => u.code === "S11").rate).toBe(1.002121);
    expect(r.total).toBe(1.735423);
  });
  it("R33233: M244 (Imperial Redevelopment District) levies; T203 (TIRZ) levies nothing", () => {
    const r = assemble({ ...base, codes: parseTaxUnitsField("C21,D01,G01,M244,S07,T203,CAD"), hist: H("C21", "D01", "G01", "M244", "S07"), tirz: { T203: "IMPERIAL REDEVELOPMENT ZONE" } });
    expect(r.complete).toBe(true);
    expect(r.units.find((u) => u.code === "T203")).toMatchObject({ rate: 0, type: "TIRZ", note: "TIRZ — levies no tax" });
    expect(r.units.find((u) => u.code === "M244").rate).toBe(0.97);
    expect(r.total).toBe(2.807727);
  });
  it("R126255: a dormant unit (FBCAD says NA) is 0 'no adopted rate'; without that evidence the table is HIDDEN", () => {
    const codes = parseTaxUnitsField("D01,G01,M184,R05,S01,CAD");
    const ok = assemble({ ...base, codes, hist: H("D01", "G01", "R05", "S01"), fbcad: parseFbcadLegend(FBCAD_SYNTH) });
    expect(ok.complete).toBe(true);
    expect(ok.units.find((u) => u.code === "M184")).toMatchObject({ rate: 0, note: "no adopted rate", name: "Fort Bend MUD 214" });
    const hidden = assemble({ ...base, codes, hist: H("D01", "G01", "R05", "S01"), fbcad: null });
    expect(hidden.complete).toBe(false);
    expect(hidden.reason).toMatch(/M184/);
  });
  it("R169774: M256 (absent everywhere) → INCOMPLETE with the reason; SM106 (blank FBCAD rate) too", () => {
    const r = assemble({ ...base, codes: ["D01", "G01", "M256", "R05", "S01"], hist: H("D01", "G01", "R05", "S01"), fbcad: parseFbcadLegend(FBCAD_SYNTH) });
    expect(r.complete).toBe(false);
    expect(r.reason).toMatch(/M256/);
    const s = assemble({ ...base, codes: ["D01", "SM106"], hist: H("D01"), fbcad: parseFbcadLegend(FBCAD_SYNTH) });
    expect(s.complete).toBe(false);
    expect(s.reason).toMatch(/SM106/);
  });
  it("newest year in which EVERY unit reported — a unit still on 2025 holds the whole table at 2025", () => {
    const h = { A: [{ year: 2026, rate: 0.4 }, { year: 2025, rate: 0.5 }], B: [{ year: 2025, rate: 0.2 }] };
    const idx = { A: { name: "A UNIT", type: "X" }, B: { name: "B UNIT", type: "X" } };
    const r = assemble({ codes: ["A", "B"], index: idx, hist: h, maxYear: 2026 });
    expect(r.year).toBe(2025);
    expect(r.total).toBe(0.7);
    const r2 = assemble({ codes: ["A", "B"], index: idx, hist: { ...h, B: [{ year: 2026, rate: 0.25 }, ...h.B] }, maxYear: 2026 });
    expect(r2.year).toBe(2026);
    expect(r2.total).toBe(0.65);
  });
  it("a unit whose 2026 rate reads 0 after a 2025 rate is NOT a zero — the whole table drops to 2025", () => {
    const idx = { A: { name: "A UNIT", type: "X" }, B: { name: "B UNIT", type: "X" } };
    const h = { A: [{ year: 2026, rate: 0.4 }, { year: 2025, rate: 0.5 }], B: [{ year: 2026, rate: 0 }, { year: 2025, rate: 0.2 }] };
    expect(assemble({ codes: ["A", "B"], index: idx, hist: h, maxYear: 2026 }).year).toBe(2025);
  });
  it("no history on the portal for a listed unit → incomplete, never a guess", () => {
    const idx = { A: { name: "A UNIT", type: "X" } };
    expect(assemble({ codes: ["A"], index: idx, hist: { A: [] }, maxYear: 2026 }).complete).toBe(false);
  });
});

describe("lookupFortBend — network half with a fake relay", () => {
  const serve = (over = {}) => async (url) => {
    const mk = (body, ok = true) => ({ ok, json: async () => body, text: async () => body });
    for (const [k, v] of Object.entries(over)) if (url.startsWith(k)) return typeof v === "function" ? v(url) : v;
    if (url.startsWith(FBCAD_LAYER)) return mk({ features: [{ attributes: { QUICKREFID: "R33231", TAXUNITS: "C21,D01,G01,S07,CAD" } }] });
    if (url === `${PORTAL}/`) return mk(indexHtml());
    const m = /VarTaxUnitID=(\w+)/.exec(url);
    if (m) return mk(read(`unit-${m[1]}.html`));
    if (url.startsWith(TIRZ_LAYER)) return mk({ features: [] });
    if (url === FBCAD_RATES_URL) return mk(FBCAD_SYNTH);
    throw new Error(`unexpected ${url}`);
  };
  it("a complete account", async () => {
    const r = await lookupFortBend("R33231", serve());
    expect(r.complete).toBe(true);
    expect(r.units.map((u) => u.code)).toEqual(["C21", "D01", "G01", "S07"]);
    expect(r.source).toMatch(/Fort Bend County Tax Office/);
  });
  it("the FBCAD parcel layer unreachable → transient (the client retries; never cached, never 'incomplete')", async () => {
    const r = await lookupFortBend("R33231", serve({ [FBCAD_LAYER]: { ok: false } }));
    expect(r).toMatchObject({ complete: false, transient: true });
    const r2 = await lookupFortBend("R33231", serve({ [FBCAD_LAYER]: () => { throw new Error("net"); } }));
    expect(r2.transient).toBe(true);
  });
  it("a portal page that no longer parses as the index is transient, not 'no units'", async () => {
    expect((await lookupFortBend("R33231", serve({ [`${PORTAL}/`]: { ok: true, text: async () => "<html>maintenance</html>" } }))).transient).toBe(true);
  });
  it("the rate portal unreachable → transient", async () => {
    expect((await lookupFortBend("R33231", serve({ [`${PORTAL}/`]: { ok: false } }))).transient).toBe(true);
  });
  it("an account that is not on the layer", async () => {
    const r = await lookupFortBend("R1", serve({ [FBCAD_LAYER]: { ok: true, json: async () => ({ features: [] }) } }));
    expect(r).toMatchObject({ complete: false });
    expect(r.transient).toBeUndefined();
  });
  it("an unlisted T-code is a TIRZ only when the county's TIRZ layer lists it", async () => {
    const layer = { ok: true, json: async () => ({ features: [{ attributes: { QUICKREFID: "R33233", TAXUNITS: "C21,D01,G01,S07,T203,CAD" } }] }) };
    const none = await lookupFortBend("R33233", serve({ [FBCAD_LAYER]: layer }));
    expect(none.complete).toBe(false);
    const yes = await lookupFortBend("R33233", serve({ [FBCAD_LAYER]: layer, [TIRZ_LAYER]: { ok: true, json: async () => ({ features: [{ attributes: { ENTITYCODE: "T203", NAME: "Imperial Redevelopment Zone" } }] }) } }));
    expect(yes.complete).toBe(true);
    expect(yes.units.find((u) => u.code === "T203").rate).toBe(0);
  });
});
