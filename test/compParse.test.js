import { describe, it, expect } from "vitest";
import {
  parseMagnitudeNumber, findDateToken, detectCompType, parseProseLine, parsePasteBlock,
  parsePaste, rowHasBlockingFlags, looksLikeSpreadsheetPaste, splitPasteLines,
} from "../src/shared/comps/lib/compParse.js";

describe("compParse: magnitude numbers", () => {
  it("expands a k suffix and flags it soft — the guess is fully shown", () => {
    const r = parseMagnitudeNumber("180k");
    expect(r).toEqual({ value: 180000, soft: true });
  });
  it("expands an m suffix", () => {
    expect(parseMagnitudeNumber("3.1m")).toEqual({ value: 3100000, soft: true });
  });
  it("strips commas without flagging soft — that's not a guess", () => {
    expect(parseMagnitudeNumber("1,234,567")).toEqual({ value: 1234567, soft: false });
  });
  it("is null on garbage", () => {
    expect(parseMagnitudeNumber("abc")).toBeNull();
    expect(parseMagnitudeNumber("")).toBeNull();
    expect(parseMagnitudeNumber(null)).toBeNull();
  });
});

describe("compParse: dates", () => {
  it("parses ISO", () => {
    expect(findDateToken("closed 2026-08-28")).toEqual({ iso: "2026-08-28", soft: false });
  });
  it("parses M/D/YYYY and M/D/YY (US month-first), confident", () => {
    expect(findDateToken("sold 3/14/2026")).toEqual({ iso: "2026-03-14", soft: false });
    expect(findDateToken("sold 3/14/26")).toEqual({ iso: "2026-03-14", soft: false });
  });
  it("parses 'Month D, YYYY', confident", () => {
    expect(findDateToken("closed Jan 5, 2026")).toEqual({ iso: "2026-01-05", soft: false });
  });
  it("parses a bare 'Month YYYY' — day defaulted to the 1st, flagged soft", () => {
    expect(findDateToken("closing Jan 2026")).toEqual({ iso: "2026-01-01", soft: true });
  });
  it("is null with no date in the text", () => {
    expect(findDateToken("no date here")).toBeNull();
  });
});

describe("compParse: comp type detection", () => {
  it("reads lease words as lease, confident", () => {
    expect(detectCompType("12,500 SF lease at $0.72/SF/mo NNN")).toEqual({ value: "lease", soft: false });
  });
  it("reads sale + a building word as building_sale, confident", () => {
    expect(detectCompType("Warehouse sold for $3.1M")).toEqual({ value: "building_sale", soft: false });
  });
  it("reads acreage/land words as land, confident", () => {
    expect(detectCompType("3.2 AC land - $850k")).toEqual({ value: "land", soft: false });
  });
  it("falls back to land, flagged soft, when nothing signals a type", () => {
    const r = detectCompType("some random line with no signal");
    expect(r).toEqual({ value: "land", soft: true });
  });
});

describe("compParse: the canonical blocking case — a lease rate with no period", () => {
  it("'$0.68 NNN' parses the rate but BLOCKS on the missing period — 12x either way", () => {
    const { draft, cellFlags } = parseProseLine("$0.68 NNN");
    expect(draft.compType).toBe("lease");
    expect(draft.leaseRate).toBe("0.68");
    expect(draft.leaseRatePeriod).toBe(""); // never guessed
    expect(cellFlags.leaseRatePeriod?.level).toBe("blocking");
    expect(rowHasBlockingFlags(cellFlags)).toBe(true);
  });
  it("a stated period resolves it — no blocking flag at all", () => {
    const { draft, cellFlags } = parseProseLine("$0.68/SF/mo NNN");
    expect(draft.leaseRate).toBe("0.68");
    expect(draft.leaseRatePeriod).toBe("monthly");
    expect(draft.leaseRateExpense).toBe("nnn");
    expect(cellFlags.leaseRatePeriod).toBeUndefined();
    expect(rowHasBlockingFlags(cellFlags)).toBe(false);
  });
  it("basis (NNN vs gross) missing is SOFT, never blocking — it never scales the shown number", () => {
    const { cellFlags } = parseProseLine("$8.50/SF/yr");
    expect(cellFlags.leaseRateExpense?.level).toBe("soft");
    expect(rowHasBlockingFlags(cellFlags)).toBe(false);
  });
});

describe("compParse: the canonical soft case — a magnitude-suffixed size", () => {
  it("'180k SF' reads as 180,000, soft, correctable, never blocking", () => {
    const { draft, cellFlags } = parseProseLine("Building sale, 180k SF, $3.1M, closed 3/14/2026");
    expect(draft.compType).toBe("building_sale");
    expect(draft.bldgSizeSf).toBe("180000");
    expect(draft.bldgPrice).toBe("3100000");
    expect(draft.compDate).toBe("2026-03-14");
    expect(cellFlags.bldgSizeSf?.level).toBe("soft");
    expect(cellFlags.bldgPrice?.level).toBe("soft");
    expect(rowHasBlockingFlags(cellFlags)).toBe(false);
  });
});

describe("compParse: land prose line", () => {
  it("parses price + acreage + date", () => {
    const { draft, cellFlags } = parseProseLine("3.2 AC land - $850k - Jan 2026");
    expect(draft.compType).toBe("land");
    expect(draft.landPrice).toBe("850000");
    expect(draft.landSizeValue).toBe("3.2");
    expect(draft.landSizeUnit).toBe("ac");
    expect(draft.compDate).toBe("2026-01-01");
    expect(cellFlags.compDate?.level).toBe("soft"); // day defaulted
    expect(rowHasBlockingFlags(cellFlags)).toBe(false);
  });
});

describe("compParse: multi-line prose paste -> multiple rows", () => {
  it("one pasted line becomes one row", () => {
    const text = [
      "3.2 AC land - $850k - Jan 2026",
      "Building sale, 25,000 SF, $3.1M, closed 3/14/2026",
      "12,500 SF lease at $0.72/SF/mo NNN, 5 yr term",
    ].join("\n");
    const { mode, rows } = parsePaste(text);
    expect(mode).toBe("prose");
    expect(rows).toHaveLength(3);
    expect(rows[0].draft.compType).toBe("land");
    expect(rows[1].draft.compType).toBe("building_sale");
    expect(rows[2].draft.compType).toBe("lease");
    expect(rows[2].draft.leaseTerm).toBe("5 yrs");
  });
  it("blank lines are dropped, not turned into empty rows", () => {
    const { rows } = parsePaste("line one\n\n\nline two\n");
    expect(rows).toHaveLength(2);
  });
});

describe("compParse: spreadsheet (tab-delimited) block paste — DIFFERENT from prose", () => {
  it("any pasted line with a tab is treated as spreadsheet-shaped", () => {
    expect(looksLikeSpreadsheetPaste("a\tb\nc\td")).toBe(true);
    expect(looksLikeSpreadsheetPaste("plain prose line")).toBe(false);
  });
  it("a header row with >=2 recognized columns is used to map by name, not position", () => {
    const text = [
      "Type\tDate\tPrice\tSF",
      "Land\t8/1/2026\t850000\t139392",
      "Building Sale\t3/14/2026\t3100000\t25000",
    ].join("\n");
    const rows = parsePasteBlock(text);
    expect(rows).toHaveLength(2);
    expect(rows[0].draft.compType).toBe("land");
    expect(rows[0].draft.landPrice).toBe("850000");
    expect(rows[1].draft.compType).toBe("building_sale");
    expect(rows[1].draft.bldgPrice).toBe("3100000");
    expect(rows[1].draft.bldgSizeSf).toBe("25000");
  });
  it("with no recognizable header, falls back to the default positional column order", () => {
    // DEFAULT_COLUMN_ORDER: compType, compDate, partyProvider, partyAcquirer, price, sizeValue, rate, ratePeriod, rateBasis, term, notes
    const text = "Land\t2026-08-01\tAcme Seller\tAcme Buyer\t850000\t3.2";
    const rows = parsePasteBlock(text);
    expect(rows).toHaveLength(1);
    const { draft, cellFlags } = rows[0];
    expect(draft.compType).toBe("land");
    expect(draft.compDate).toBe("2026-08-01");
    expect(draft.partyProvider).toBe("Acme Seller");
    expect(draft.partyAcquirer).toBe("Acme Buyer");
    expect(draft.landPrice).toBe("850000");
    expect(draft.landSizeValue).toBe("3.2");
    expect(rowHasBlockingFlags(cellFlags)).toBe(false);
  });
  it("a lease row in a spreadsheet block with no period column BLOCKS, same as prose", () => {
    const text = [
      "Type\tDate\tRate",
      "Lease\t2026-08-01\t0.68",
    ].join("\n");
    const rows = parsePasteBlock(text);
    expect(rows[0].draft.leaseRate).toBe("0.68");
    expect(rows[0].cellFlags.leaseRatePeriod?.level).toBe("blocking");
  });
  it("fills rows AND columns — a real multi-row, multi-column block", () => {
    const text = [
      "Type\tDate\tPrice\tSF\tRate\tPeriod\tBasis",
      "Land\t1/5/2026\t850000\t\t\t\t",
      "Lease\t2/1/2026\t\t12500\t0.72\tMO\tNNN",
      "Building Sale\t3/14/2026\t3100000\t25000\t\t\t",
    ].join("\n");
    const rows = parsePasteBlock(text);
    expect(rows).toHaveLength(3);
    expect(rows[0].draft.landPrice).toBe("850000");
    expect(rows[1].draft.leaseRate).toBe("0.72");
    expect(rows[1].draft.leaseRatePeriod).toBe("monthly");
    expect(rows[1].draft.leaseRateExpense).toBe("nnn");
    expect(rowHasBlockingFlags(rows[1].cellFlags)).toBe(false);
    expect(rows[2].draft.bldgSizeSf).toBe("25000");
  });
});

describe("compParse: splitPasteLines", () => {
  it("normalizes CRLF and drops blank lines", () => {
    expect(splitPasteLines("a\r\nb\r\n\r\nc")).toEqual(["a", "b", "c"]);
  });
});
