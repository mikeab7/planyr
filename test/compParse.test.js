import { describe, it, expect } from "vitest";
import {
  parseMagnitudeNumber, findDateToken, detectCompType, parseProseLine, parsePasteBlock,
  parsePaste, rowHasBlockingFlags, looksLikeSpreadsheetPaste, splitPasteLines,
  detectPasteShape, parseSingleRecord,
} from "../src/shared/comps/lib/compParse.js";
import { draftToComp, compToDraft, compToRow } from "../src/shared/comps/lib/comps.js";

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
  it("B986096 x9 — never defaults to land any more; a genuinely blank signal is null", () => {
    const r = detectCompType("some random line with no signal");
    expect(r).toEqual({ value: null, soft: true });
  });
  it("reads a bare TI mention as lease, confident — TI is lease-only vocabulary", () => {
    expect(detectCompType("TI: $13.00/sf from shell")).toEqual({ value: "lease", soft: false });
  });
  it("reads a bare $/SF figure as lease, confident, with no /mo or /yr required", () => {
    expect(detectCompType("$13.00/sf from shell")).toEqual({ value: "lease", soft: false });
  });
});

describe("compParse: the canonical blocking case — a lease rate with no period", () => {
  it("'$0.68 NNN' parses the rate but BLOCKS on the missing period — 12x either way", () => {
    const row = parseProseLine("$0.68 NNN");
    const { draft, cellFlags } = row;
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
  it("HARDENING-11 / B986096 x9 (owner amendment) — basis missing defaults to NNN, silently — no flag, no marker, industrial's own default", () => {
    const { draft, cellFlags } = parseProseLine("$8.50/SF/yr");
    expect(draft.leaseRateExpense).toBe("nnn");
    expect(cellFlags.leaseRateExpense).toBeUndefined();
    expect(rowHasBlockingFlags(cellFlags)).toBe(false);
  });
  it("HARDENING-11: a stated gross-family term still wins over the NNN default", () => {
    expect(parseProseLine("$8.50/SF/yr gross").draft.leaseRateExpense).toBe("gross");
    expect(parseProseLine("$8.50/SF/yr full service").draft.leaseRateExpense).toBe("gross");
    expect(parseProseLine("$8.50/SF/yr FS").draft.leaseRateExpense).toBe("gross");
    expect(parseProseLine("$8.50/SF/yr IG").draft.leaseRateExpense).toBe("gross");
    expect(parseProseLine("$8.50/SF/yr industrial gross").draft.leaseRateExpense).toBe("gross");
    expect(parseProseLine("$8.50/SF/yr MG").draft.leaseRateExpense).toBe("gross");
    expect(parseProseLine("$8.50/SF/yr modified gross").draft.leaseRateExpense).toBe("gross");
    expect(parseProseLine("$8.50/SF/yr base year").draft.leaseRateExpense).toBe("gross");
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

describe("compParse: shape detection — the bug this rewrite exists to fix", () => {
  it("a genuine one-per-line list (each line independently complete) is MULTI", () => {
    const text = [
      "3.2 AC land - $850k - Jan 2026",
      "Building sale, 25,000 SF, $3.1M, closed 3/14/2026",
      "12,500 SF lease at $0.72/SF/mo NNN, 5 yr term",
    ].join("\n");
    expect(detectPasteShape(text)).toBe("multi");
  });
  it("a label:value abstract is SINGLE even though it spans many lines", () => {
    const text = "TT: Acme\nLL: Beta\n613,208 SF\n$0.65/sf NNN";
    expect(detectPasteShape(text)).toBe("single");
  });
  it("an ambiguous block (no labels, not mostly complete lines) defaults to SINGLE — fail cheap", () => {
    const text = "Some notes\nabout a deal\nthat spans lines";
    expect(detectPasteShape(text)).toBe("single");
  });
  it("a tab-delimited block is SPREADSHEET regardless of label lines", () => {
    expect(detectPasteShape("Type\tDate\nLand\t2026-01-01")).toBe("spreadsheet");
  });
});

describe("compParse: Michael's exact repro — a single lease abstract must become ONE row, not ten", () => {
  const MICHAEL_PASTE = [
    "TT: Modular Power Solutions",
    "LL: Core5 Industrial Partners",
    "20320 West Hardy Road - Building A",
    "613,208 SF",
    "Commencement estimated to be June 1, 2027",
    "126 months",
    "6 months base free rent",
    "$0.65/sf NNN",
    "3.50% annual increases",
    "TI: $13.00/sf from shell",
  ].join("\n");

  it("parsePaste produces exactly ONE row, mode 'single'", () => {
    const { mode, rows } = parsePaste(MICHAEL_PASTE);
    expect(mode).toBe("single");
    expect(rows).toHaveLength(1);
  });

  it("the row has every field from the abstract, correctly typed as lease", () => {
    const { rows } = parsePaste(MICHAEL_PASTE);
    const { draft, cellFlags } = rows[0];
    expect(draft.compType).toBe("lease");
    expect(draft.partyAcquirer).toBe("Modular Power Solutions"); // TT
    expect(draft.partyProvider).toBe("Core5 Industrial Partners"); // LL
    expect(draft.title).toBe("20320 West Hardy Road - Building A");
    expect(draft.leaseSizeSf).toBe("613208"); // NOT 61320 — a real parse, not a display artifact
    expect(draft.leaseTerm).toBe("126 mo");
    expect(draft.leaseFreeRentMonths).toBe("6");
    expect(draft.leaseRate).toBe("0.65");
    expect(draft.leaseRateExpense).toBe("nnn");
    expect(draft.leaseTi).toBe("13");
    expect(draft.leaseEscalationPct).toBe("3.5");

    // The rate has no period — this is THE canonical blocking case, and it must still block
    // even inside a single-record parse.
    expect(draft.leaseRatePeriod).toBe("");
    expect(cellFlags.leaseRatePeriod?.level).toBe("blocking");

    // The commencement date is its OWN field (B986096-HARDENING-6 — execution and commencement
    // are different facts). ⛔ HARDENING-8 (owner correction, reversing the HARDENING-6 stand-in)
    // — compDate is NEVER backfilled from it any more: Michael's abstract states only a
    // commencement, no execution date anywhere, and the old stand-in fabricated a FUTURE
    // execution date that would have corrupted every recency filter/sort. Executed stays
    // genuinely empty; validateComp's existing message is what asks for it.
    expect(draft.leaseCommencementDate).toBe("2027-06-01");
    expect(cellFlags.leaseCommencementDate?.level).toBe("soft");
    expect(cellFlags.leaseCommencementDate?.reason).toMatch(/estimated/i);
    expect(draft.compDate).toBe("");
    expect(cellFlags.compDate).toBeUndefined();
    expect(draft.notes).toBe(""); // no longer duplicated into notes — it's a real field now
  });

  it("never produces an empty or bogus 'Land' row", () => {
    const { rows } = parsePaste(MICHAEL_PASTE);
    expect(rows.every((r) => r.draft.compType !== "land")).toBe(true);
  });
});

describe("compParse: parseSingleRecord — no label lines, still one record", () => {
  it("an unlabeled abstract with recognizable content still merges to one record", () => {
    const text = "20320 West Hardy Road\n613,208 SF\n$0.65/sf NNN\n126 months";
    const row = parseSingleRecord(text);
    expect(row.draft.title).toBe("20320 West Hardy Road");
    expect(row.draft.leaseSizeSf).toBe("613208");
    expect(row.draft.leaseTerm).toBe("126 mo");
  });
  it("returns null for a block that contributes nothing at all", () => {
    expect(parseSingleRecord("hello\nworld")).toBeNull();
  });
});

describe("compParse: multi-line prose paste -> multiple rows (the list shape, unchanged)", () => {
  it("one pasted line becomes one row when each line is independently complete", () => {
    const text = [
      "3.2 AC land - $850k - Jan 2026",
      "Building sale, 25,000 SF, $3.1M, closed 3/14/2026",
      "12,500 SF lease at $0.72/SF/mo NNN, 5 yr term",
    ].join("\n");
    const { mode, rows } = parsePaste(text);
    expect(mode).toBe("multi");
    expect(rows).toHaveLength(3);
    expect(rows[0].draft.compType).toBe("land");
    expect(rows[1].draft.compType).toBe("building_sale");
    expect(rows[2].draft.compType).toBe("lease");
    expect(rows[2].draft.leaseTerm).toBe("5 yrs");
  });
  it("a line with only TI/$-per-SF vocabulary still infers lease on its own, per-line", () => {
    // Distinct from the single-record whole-text join: this proves the SAME strengthened
    // detectCompType also protects the per-line list path, where each line is judged in
    // isolation (a stray TI/$-per-sf line with no NNN or lease word would otherwise default to
    // "land", exactly the class of misclassification the owner's third round flagged). Both
    // lines carry a date so each independently reads as a complete comp (the "multi" shape).
    const text = [
      "Shell space, TI $13.00/sf, closed 3/1/2026",
      "3.2 AC land - $850k - Jan 2026",
    ].join("\n");
    expect(detectPasteShape(text)).toBe("multi");
    const { rows } = parsePaste(text);
    expect(rows[0].draft.compType).toBe("lease");
    expect(rows[1].draft.compType).toBe("land");
  });
  it("blank lines are dropped, not turned into empty rows", () => {
    const text = [
      "3.2 AC land - $850k - Jan 2026",
      "",
      "Building sale, 25,000 SF, $3.1M, closed 3/14/2026",
      "12,500 SF lease at $0.72/SF/mo NNN, 5 yr term",
      "",
    ].join("\n");
    const { rows } = parsePaste(text);
    expect(rows).toHaveLength(3);
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

/* ============================================================================================
 * B986096 x9 (owner report, 2026-09-01) — THE SCAVENGER REWRITE.
 * "the one that started it" is the headline test: every other test below is one of the isolated
 * defects that combined to produce it. See compParse.js's file header for the two named defects
 * (A: one unrecognized token must never suppress a recognized one, and a row with no type signal
 * must never default to Land; B: every labelled field scans both directions; C: money doesn't
 * require a literal "$").
 * ============================================================================================ */

describe("compParse: THE HEADLINE TEST — Michael's exact repro that started this rewrite", () => {
  it("'.56/SF , 12 TI, 3% bumps' -> one row, Rate 0.56 / Unit SF / Basis NNN (defaulted) / TI 12 / Escal 3 / Type lease, Per BLANK (blocking, never guessed)", () => {
    const { mode, rows } = parsePaste(".56/SF , 12 TI, 3% bumps");
    expect(mode).toBe("single");
    expect(rows).toHaveLength(1);
    const { draft, cellFlags } = rows[0];
    expect(draft.compType).toBe("lease");
    expect(draft.leaseRate).toBe("0.56");
    expect(draft.leaseTi).toBe("12");
    expect(draft.leaseEscalationPct).toBe("3");
    // B986096 x9 (owner amendment) — no stated basis defaults to NNN, silently (no flag, no
    // marker) — industrial leases are overwhelmingly triple-net.
    expect(draft.leaseRateExpense).toBe("nnn");
    expect(cellFlags.leaseRateExpense).toBeUndefined();
    // The rate PERIOD has no stated value — this must still BLOCK, never be guessed away
    // (unlike basis, two common period answers are 12x apart), even though three other facts
    // on the same line were correctly captured (DEFECT A).
    expect(draft.leaseRatePeriod).toBe("");
    expect(cellFlags.leaseRatePeriod?.level).toBe("blocking");
    expect(rowHasBlockingFlags(cellFlags)).toBe(true);
  });
});

describe("compParse: B1063904 — MERGE SAFETY, DATA CORRUPTION on paste (5 AC silently became 5 SF)", () => {
  it("a) '5 AC land sale' + '.56/SF , 12 TI, 3% bumps' -> TWO rows, never a hybrid merge", () => {
    const text = "5 AC land sale\n.56/SF , 12 TI, 3% bumps";
    const { mode, rows, splitReason } = parsePaste(text);
    expect(mode).toBe("split");
    expect(rows).toHaveLength(2);
    expect(splitReason).toMatch(/disagreed on Type/i);
    expect(splitReason).toMatch(/split into 2 comps/i);

    const land = rows.find((r) => r.draft.compType === "land");
    const lease = rows.find((r) => r.draft.compType === "lease");
    expect(land).toBeDefined();
    expect(lease).toBeDefined();

    // The land row keeps its real unit — 5 ACRES, never reinterpreted as 5 SF.
    expect(land.draft.landSizeValue).toBe("5");
    expect(land.draft.landSizeUnit).toBe("ac");
    expect(land.draft.notes).toMatch(/land sale/);

    // The lease row keeps its own facts, untouched by line 1.
    expect(lease.draft.leaseRate).toBe("0.56");
    expect(lease.draft.leaseTi).toBe("12");
    expect(lease.draft.leaseEscalationPct).toBe("3");
    expect(lease.draft.leaseRateExpense).toBe("nnn");
    // Never a leftover 5 masquerading as square feet on the lease row.
    expect(lease.draft.leaseSizeSf).toBe("");
  });

  it("b) two lease lines that disagree on Rate -> two rows, never averaged or overwritten", () => {
    const text = "$0.65/SF NNN, 5 yr term\n$0.85/SF NNN, 5 yr term";
    const { mode, rows, splitReason } = parsePaste(text);
    expect(mode).toBe("split");
    expect(rows).toHaveLength(2);
    expect(splitReason).toMatch(/disagreed on Rate/i);
    const rates = rows.map((r) => r.draft.leaseRate).sort();
    expect(rates).toEqual(["0.65", "0.85"]);
  });

  it("c) complementary lines with NO field collision still merge into ONE row (do not over-correct)", () => {
    const text = "1115 E Main St\n.56/SF NNN";
    const { mode, rows } = parsePaste(text);
    expect(mode).toBe("single");
    expect(rows).toHaveLength(1);
    expect(rows[0].draft.title).toBe("1115 E Main St");
    expect(rows[0].draft.leaseRate).toBe("0.56");
    expect(rows[0].draft.leaseRateExpense).toBe("nnn");
  });

  it("d) a single line is unaffected — one row, unchanged", () => {
    const { mode, rows } = parsePaste(".56/SF , 12 TI, 3% bumps");
    expect(mode).toBe("single");
    expect(rows).toHaveLength(1);
  });

  it("e) 'Merge into one comp' is the stated inverse — parseSingleRecord still merges the SAME raw text on demand", () => {
    const text = "5 AC land sale\n.56/SF , 12 TI, 3% bumps";
    const merged = parseSingleRecord(text);
    expect(merged).not.toBeNull();
    expect(merged.draft.compType).toBe("lease"); // the pre-fix (corrupting) merge outcome, still reachable as an explicit override
  });

  it("Michael's 10-line lease abstract (MICHAEL_PASTE) still merges to ONE row — no false-positive split", () => {
    const text = [
      "TT: Modular Power Solutions",
      "LL: Core5 Industrial Partners",
      "20320 West Hardy Road - Building A",
      "613,208 SF",
      "Commencement estimated to be June 1, 2027",
      "126 months",
      "6 months base free rent",
      "$0.65/sf NNN",
      "3.50% annual increases",
      "TI: $13.00/sf from shell",
    ].join("\n");
    const { mode, rows } = parsePaste(text);
    expect(mode).toBe("single");
    expect(rows).toHaveLength(1);
  });

  it("a genuine per-line list (already 'multi') is unaffected by the collision check", () => {
    const text = [
      "3.2 AC land - $850k - Jan 2026",
      "Building sale, 25,000 SF, $3.1M, closed 3/14/2026",
    ].join("\n");
    const { mode, rows } = parsePaste(text);
    expect(mode).toBe("multi");
    expect(rows).toHaveLength(2);
  });

  it("a Unit collision alone (both lines agree on Type=land) still forces a split — rule 4", () => {
    const text = "Land parcel, 5 acres\nLand parcel, 200,000 SF";
    const { mode, rows, splitReason } = parsePaste(text);
    expect(mode).toBe("split");
    expect(rows).toHaveLength(2);
    expect(splitReason).toMatch(/disagreed on Unit/i);
    expect(splitReason).not.toMatch(/Type/i);
  });

  it("e) the split rows round-trip through the SAME conversion a real save/reload uses, unit intact", () => {
    // draftToComp/compToDraft/compToRow are the exact pipeline CompsPanel.jsx runs on every real
    // save (comp -> DB row) and every real load (DB row -> comp -> draft); this proves the split
    // rows survive it with their units intact, not just that the GRID displays them right.
    const { rows } = parsePaste("5 AC land sale\n.56/SF , 12 TI, 3% bumps");
    const land = rows.find((r) => r.draft.compType === "land");
    const lease = rows.find((r) => r.draft.compType === "lease");

    const landComp = draftToComp(land.draft);
    const landRow = compToRow(landComp);
    expect(landRow.land_size_value).toBe(5);
    expect(landRow.land_size_unit).toBe("ac"); // never "sf" — the exact corruption this item exists to fix
    const landRoundTrip = compToDraft(landComp);
    expect(landRoundTrip.landSizeValue).toBe("5");
    expect(landRoundTrip.landSizeUnit).toBe("ac");

    const leaseComp = draftToComp(lease.draft);
    const leaseRow = compToRow(leaseComp);
    expect(leaseRow.lease_rate).toBe(0.56);
    expect(leaseRow.lease_ti).toBe(12);
    const leaseRoundTrip = compToDraft(leaseComp);
    expect(leaseRoundTrip.leaseRate).toBe("0.56");
    expect(leaseRoundTrip.leaseTi).toBe("12");
    expect(leaseRoundTrip.leaseRateExpense).toBe("nnn");
  });
});

describe("compParse: DEFECT A — a wrong/blank type guess must never suppress a captured field", () => {
  it("a rate found via the magnitude fallback (zero lease wording, zero /SF marker) still keeps the rate, type inferred from what was captured", () => {
    const { draft, cellFlags } = parseProseLine(".72");
    expect(draft.compType).toBe("lease");
    expect(draft.leaseRate).toBe("0.72");
    expect(cellFlags.compType?.level).toBe("soft");
  });

  it("an input with genuinely no type signal and no captured field at all produces no row — never a bogus Land row", () => {
    expect(parseProseLine("Talked to the broker again, still no number")).toBeNull();
  });

  it("an unrecognized fragment on an otherwise-readable line is preserved in notes, never silently dropped", () => {
    const { draft } = parseProseLine("$0.65/SF NNN, mumbojumbo xyz123");
    expect(draft.leaseRate).toBe("0.65");
    expect(draft.notes).toMatch(/mumbojumbo xyz123/);
  });
});

describe("compParse: DEFECT B — every labelled field scans both directions", () => {
  it("TI: label-before-value AND value-before-label", () => {
    expect(parseSingleRecord("$0.65/SF NNN\nTI $12").draft.leaseTi).toBe("12");
    expect(parseSingleRecord("$0.65/SF NNN\nTI: 12").draft.leaseTi).toBe("12");
    expect(parseSingleRecord("$0.65/SF NNN\n12 TI").draft.leaseTi).toBe("12");
  });
  it("free rent: label-before-value AND value-before-label", () => {
    expect(parseSingleRecord("$0.65/SF NNN\n6 months free").draft.leaseFreeRentMonths).toBe("6");
    expect(parseSingleRecord("$0.65/SF NNN\nfree rent: 6 months").draft.leaseFreeRentMonths).toBe("6");
  });
  it("escalation: label-before-value AND value-before-label", () => {
    expect(parseSingleRecord("$0.65/SF NNN\n3% bumps").draft.leaseEscalationPct).toBe("3");
    expect(parseSingleRecord("$0.65/SF NNN\nbumps: 3%").draft.leaseEscalationPct).toBe("3");
  });
  it("cap: label-before-value AND value-before-label", () => {
    expect(parseSingleRecord("Building sold, NOI $2,600,000\n6.25% cap").draft.bldgCapRate).toBe("0.0625");
    expect(parseSingleRecord("Building sold, NOI $2,600,000\ncap: 6.25").draft.bldgCapRate).toBe("0.0625");
  });
  it("NOI: label-before-value AND value-before-label", () => {
    expect(parseSingleRecord("Building sold\nNOI $2,600,000").draft.bldgNoi).toBe("2600000");
    expect(parseSingleRecord("Building sold\n$2,600,000 NOI").draft.bldgNoi).toBe("2600000");
  });
  it("term: label-before-value AND value-before-label", () => {
    expect(parseSingleRecord("$0.65/SF NNN\n126 months").draft.leaseTerm).toBe("126 mo");
    expect(parseSingleRecord("$0.65/SF NNN\nterm: 126").draft.leaseTerm).toBe("126 mo");
  });
  it("price: label-before-value AND value-before-label (unit price, land)", () => {
    expect(parseSingleRecord("66 ac land\n$62,700/ac").draft.landPrice).toBe(String(62700 * 66));
  });
  it("size: unit-adjacent works regardless of surrounding word order", () => {
    expect(parseProseLine("Sold for $3.1M, 25,000 SF building, closed 3/14/2026").draft.bldgSizeSf).toBe("25000");
  });
});

describe("compParse: DEFECT C — money without a literal dollar sign", () => {
  it("a bare '.56/SF' (no $) reads as a rate", () => {
    expect(parseProseLine(".56/SF NNN").draft.leaseRate).toBe("0.56");
  });
  it("'0.65 mo' (no $) reads as a monthly rate", () => {
    const { draft } = parseProseLine("0.65 mo, NNN, 5 yr term");
    expect(draft.leaseRate).toBe("0.65");
  });
  it("'65 cents' / '65c' / '65¢' all read as $0.65", () => {
    expect(parseProseLine("65 cents NNN monthly").draft.leaseRate).toBe("0.65");
    expect(parseProseLine("65c NNN monthly").draft.leaseRate).toBe("0.65");
    expect(parseProseLine("65¢ NNN monthly").draft.leaseRate).toBe("0.65");
  });
  it("'7.80 nnn' (bare decimal, basis word for context) reads as a rate", () => {
    expect(parseProseLine("7.80 nnn").draft.leaseRate).toBe("7.8");
  });
  it("a bare decimal with NO context at all is read by MAGNITUDE (0.10-5.00 -> monthly rate)", () => {
    const { draft, cellFlags } = parseProseLine(".65");
    expect(draft.compType).toBe("lease");
    expect(draft.leaseRate).toBe("0.65");
    expect(cellFlags.leaseRate?.level).toBe("soft");
  });
  it("that same magnitude fallback never steals a number that's actually a SIZE", () => {
    const { draft } = parseProseLine("3.2 AC land - $850k - Jan 2026");
    expect(draft.compType).toBe("land");
    expect(draft.landSizeValue).toBe("3.2");
    expect(draft.landPrice).toBe("850000");
  });
  it("rate period is NEVER invented from magnitude alone — still blocks", () => {
    const { cellFlags } = parseProseLine(".65");
    expect(cellFlags.leaseRatePeriod?.level).toBe("blocking");
  });
});

/* ---- THE LAZY-INPUT ACCEPTANCE CORPUS ------------------------------------------------------
 * Every line below is drawn straight from the owner's report. Each must extract the field
 * named — a line that produces zero fields is a failure. */

describe("compParse corpus: RATE + BASIS", () => {
  const rate = (line) => parseProseLine(line)?.draft.leaseRate;
  it("explicit $/SF forms", () => {
    expect(rate("$0.65/sf/mo")).toBe("0.65");
    expect(rate("$0.65 psf")).toBe("0.65");
    expect(rate("$.65")).toBe("0.65");
    expect(rate("$7.80/sf/yr")).toBe("7.8");
    expect(rate("$7.80 annual")).toBe("7.8");
    expect(rate("6.72/sf")).toBe("6.72");
    expect(rate("$6.72 yr")).toBe("6.72");
    expect(rate(".56/SF")).toBe("0.56");
    expect(rate("$0.65 sf/mo")).toBe("0.65");
  });
  it("cents forms", () => {
    expect(rate("65 cents")).toBe("0.65");
    expect(rate("65c NNN")).toBe("0.65");
    expect(rate("65 cents nnn monthly")).toBe("0.65");
  });
  it("bare-decimal-plus-period forms", () => {
    expect(rate("0.65 mo")).toBe("0.65");
  });
  // B986096-HARDENING-23 (owner live-report) — RATE_SF_RE's "/\s*sf\b" alternative used to stop
  // matching right after "SF", so a compound "/SF/mo" unit only consumed "/SF" and left "/mo" as
  // an unrecognized fragment that fell through into Notes — a real value correctly captured
  // (leaseRate: "0.56") sitting next to a garbage leftover in the one field meant for genuinely
  // uncaptured text.
  it("a compound /SF/period unit never leaks its period suffix into Notes", () => {
    const draft = (line) => parseProseLine(line)?.draft;
    expect(draft(".56/SF/mo NNN , 12 TI, 3% bumps").notes).toBe("");
    expect(draft("$0.65/SF/mo NNN").notes).toBe("");
    expect(draft("$7.80/SF/yr NNN").notes).toBe("");
    expect(draft("$0.65/SF/month NNN").notes).toBe("");
    expect(draft("$7.80/SF/year NNN").notes).toBe("");
    // and the rate/period themselves are still read correctly, unchanged by the wider match
    expect(draft(".56/SF/mo NNN , 12 TI, 3% bumps").leaseRate).toBe("0.56");
    expect(draft(".56/SF/mo NNN , 12 TI, 3% bumps").leaseRatePeriod).toBe("monthly");
    expect(draft(".56/SF/mo NNN , 12 TI, 3% bumps").leaseTi).toBe("12");
  });
  it("basis words normalize to the two schema buckets (nnn/gross)", () => {
    const basis = (line) => parseProseLine(`$0.65/sf ${line}`)?.draft.leaseRateExpense;
    expect(basis("NNN")).toBe("nnn");
    expect(basis("nnn")).toBe("nnn");
    expect(basis("triple net")).toBe("nnn");
    expect(basis("tripple net")).toBe("nnn");
    expect(basis("NN")).toBe("nnn");
    expect(basis("abs net")).toBe("nnn");
    expect(basis("absolute net")).toBe("nnn");
    expect(basis("gross")).toBe("gross");
    expect(basis("full service")).toBe("gross");
    expect(basis("FS")).toBe("gross");
    expect(basis("IG")).toBe("gross");
    expect(basis("industrial gross")).toBe("gross");
    expect(basis("MG")).toBe("gross");
    expect(basis("modified gross")).toBe("gross");
    expect(basis("base year")).toBe("gross");
  });
  it("period words normalize to monthly/annual", () => {
    const period = (line) => parseProseLine(`$0.65/sf ${line}`)?.draft.leaseRatePeriod;
    expect(period("/mo")).toBe("monthly");
    expect(period("/month")).toBe("monthly");
    expect(period("monthly")).toBe("monthly");
    expect(period("per month")).toBe("monthly");
    expect(period("/yr")).toBe("annual");
    expect(period("/year")).toBe("annual");
    expect(period("annual")).toBe("annual");
    expect(period("annually")).toBe("annual");
    expect(period("pa")).toBe("annual");
    expect(period("per annum")).toBe("annual");
  });
});

describe("compParse corpus: SIZE", () => {
  const size = (line) => { const d = parseProseLine(line)?.draft; return d && [d.landSizeValue || d.bldgSizeSf, d.landSizeUnit]; };
  it("SF forms", () => {
    expect(parseProseLine("Building sale, 613,208 SF, $3.1M, closed 3/14/2026").draft.bldgSizeSf).toBe("613208");
    expect(parseProseLine("Building sale, 613208 sf, $3.1M, closed 3/14/2026").draft.bldgSizeSf).toBe("613208");
    expect(parseProseLine("Building sale, 613k sf, $3.1M, closed 3/14/2026").draft.bldgSizeSf).toBe("613000");
    expect(parseProseLine("Building sale, 613.2k SF, $3.1M, closed 3/14/2026").draft.bldgSizeSf).toBe("613200");
    expect(parseProseLine("Building sale, ~613k SF, $3.1M, closed 3/14/2026").draft.bldgSizeSf).toBe("613000");
    expect(parseProseLine("Building sale, +/- 613,208 SF, $3.1M, closed 3/14/2026").draft.bldgSizeSf).toBe("613208");
    expect(parseProseLine("Building sale, 2.88M SF, $3.1M, closed 3/14/2026").draft.bldgSizeSf).toBe("2880000");
  });
  it("acreage forms", () => {
    expect(parseProseLine("66.17 ac land, $850k, Jan 2026").draft.landSizeValue).toBe("66.17");
    expect(parseProseLine("66 acres land, $850k, Jan 2026").draft.landSizeValue).toBe("66");
    expect(parseProseLine("66.17 AC land, $850k, Jan 2026").draft.landSizeValue).toBe("66.17");
    expect(parseProseLine("66.17ac land, $850k, Jan 2026").draft.landSizeValue).toBe("66.17");
    expect(parseProseLine("+/- 66 ac land, $850k, Jan 2026").draft.landSizeValue).toBe("66");
  });
});

describe("compParse corpus: TERM", () => {
  const term = (line) => parseSingleRecord(`$0.65/sf NNN\n${line}`)?.draft.leaseTerm;
  it("month forms", () => {
    expect(term("126 months")).toBe("126 mo");
    expect(term("126 mo")).toBe("126 mo");
    expect(term("126 mos")).toBe("126 mo");
    expect(term("126mo")).toBe("126 mo");
    expect(term("126-month")).toBe("126 mo");
    expect(term("126 month term")).toBe("126 mo");
  });
  it("year forms", () => {
    expect(term("10.5 yr")).toBe("10.5 yrs");
    expect(term("10.5 years")).toBe("10.5 yrs");
    expect(term("10-year term")).toBe("10 yrs");
  });
  it("combined yr+mo normalizes to total months", () => {
    expect(term("10 yr 6 mo")).toBe("126 mo");
  });
  it("a labelled bare number defaults to months", () => {
    expect(term("term: 126")).toBe("126 mo");
  });
});

describe("compParse corpus: FREE RENT", () => {
  const freeRent = (line) => parseSingleRecord(`$0.65/sf NNN\n${line}`)?.draft.leaseFreeRentMonths;
  it("value-then-label forms", () => {
    expect(freeRent("6 months free")).toBe("6");
    expect(freeRent("6 mo free rent")).toBe("6");
    expect(freeRent("6 free")).toBe("6");
    expect(freeRent("6mo FR")).toBe("6");
    expect(freeRent("six months free")).toBe("6");
    expect(freeRent("6 months abated")).toBe("6");
    expect(freeRent("6 mo abatement")).toBe("6");
    expect(freeRent("6 months base free rent")).toBe("6");
  });
  it("label-then-value forms", () => {
    expect(freeRent("free rent: 6")).toBe("6");
    expect(freeRent("abatement of 6 months")).toBe("6");
  });
});

describe("compParse corpus: TI", () => {
  const ti = (line) => parseSingleRecord(`$0.65/sf NNN\n${line}`)?.draft.leaseTi;
  it("label-then-value forms", () => {
    expect(ti("TI: $13.00/sf")).toBe("13");
    expect(ti("TIA $13")).toBe("13");
    expect(ti("TI allowance of $13.00/SF")).toBe("13");
    expect(ti("TI/LL work $13")).toBe("13");
  });
  it("value-then-label forms", () => {
    expect(ti("$13 TI")).toBe("13");
    expect(ti("13 TI")).toBe("13");
    expect(ti("13 TIA")).toBe("13");
    expect(ti("$13.00 psf TI")).toBe("13");
    expect(ti("13.00/sf TI from shell")).toBe("13");
  });
  it("turnkey (a flag, no number) is preserved as a note, never a fabricated $ value", () => {
    const { draft } = parseSingleRecord("$0.65/sf NNN\nturnkey buildout");
    expect(draft.leaseTi).toBe("");
    expect(draft.notes).toMatch(/turnkey/i);
  });
});

describe("compParse corpus: ESCALATION", () => {
  const escal = (line) => parseSingleRecord(`$0.65/sf NNN\n${line}`)?.draft.leaseEscalationPct;
  it("value-then-label forms", () => {
    expect(escal("3.5% annual increases")).toBe("3.5");
    expect(escal("3% bumps")).toBe("3");
    expect(escal("3.5%/yr")).toBe("3.5");
    expect(escal("3.5% escalations")).toBe("3.5");
    expect(escal("3.5% per year")).toBe("3.5");
    expect(escal("3% ann")).toBe("3");
    expect(escal("fixed 3%")).toBe("3");
  });
  it("label-then-value forms", () => {
    expect(escal("annual escalations of 3.5%")).toBe("3.5");
    expect(escal("bumps: 3%")).toBe("3");
  });
  it("a DOLLAR escalation (not percent) is captured as a note, never miscoded as a percentage", () => {
    const { draft } = parseSingleRecord("$0.65/sf NNN\n$0.02/yr bumps");
    expect(draft.leaseEscalationPct).toBe("");
    expect(draft.notes).toMatch(/\$0\.02\/SF\/yr/);
  });
  it("CPI / CPI-based (a flag, no number) is captured as a note", () => {
    expect(parseSingleRecord("$0.65/sf NNN\nCPI").draft.notes).toMatch(/CPI/);
    expect(parseSingleRecord("$0.65/sf NNN\nCPI-based").draft.notes).toMatch(/CPI/);
  });
});

describe("compParse corpus: DATES", () => {
  it("standalone formats all resolve", () => {
    expect(findDateToken("6/1/27")).toEqual({ iso: "2027-06-01", soft: false });
    expect(findDateToken("06/01/2027")).toEqual({ iso: "2027-06-01", soft: false });
    expect(findDateToken("June 1, 2027")).toEqual({ iso: "2027-06-01", soft: false });
    expect(findDateToken("Jun-27")).toEqual({ iso: "2027-06-01", soft: true });
    expect(findDateToken("6/27")).toEqual({ iso: "2027-06-01", soft: true });
    expect(findDateToken("Q2 2027").iso).toBe("2027-04-01");
    expect(findDateToken("Q2 2027").soft).toBe(true);
    expect(findDateToken("mid-2027").iso).toBe("2027-07-01");
  });
  it("RCD/LCD are COMMENCEMENT, never Executed", () => {
    const rcd = parseSingleRecord("$0.65/sf NNN\nRCD 6/1/27").draft;
    expect(rcd.leaseCommencementDate).toBe("2027-06-01");
    expect(rcd.compDate).toBe("");
    const lcd = parseSingleRecord("$0.65/sf NNN\nLCD 6/1/27").draft;
    expect(lcd.leaseCommencementDate).toBe("2027-06-01");
    expect(lcd.compDate).toBe("");
    const commencing = parseSingleRecord("$0.65/sf NNN\ncommencing 6/1/27").draft;
    expect(commencing.leaseCommencementDate).toBe("2027-06-01");
    expect(commencing.compDate).toBe("");
  });
  it("a bare date with no qualifier is EXECUTED, never Commencement", () => {
    const executed = parseSingleRecord("$0.65/sf NNN\nexecuted 3/14/26").draft;
    expect(executed.compDate).toBe("2026-03-14");
    expect(executed.leaseCommencementDate).toBe("");
    const signed = parseSingleRecord("$0.65/sf NNN\nsigned March 2026").draft;
    expect(signed.compDate).toBe("2026-03-01");
    expect(signed.leaseCommencementDate).toBe("");
  });
});

describe("compParse corpus: PARTIES", () => {
  it("TT:/Tenant:/T:/'tenant is' all read as the acquirer", () => {
    expect(parseSingleRecord("TT: Acme\n$0.65/sf NNN").draft.partyAcquirer).toBe("Acme");
    expect(parseSingleRecord("Tenant: Acme\n$0.65/sf NNN").draft.partyAcquirer).toBe("Acme");
    expect(parseSingleRecord("T: Acme\n$0.65/sf NNN").draft.partyAcquirer).toBe("Acme");
    expect(parseSingleRecord("$0.65/sf NNN\ntenant is Acme").draft.partyAcquirer).toBe("Acme");
  });
  it("LL:/Landlord:/'LL -'/'landlord is' all read as the provider", () => {
    expect(parseSingleRecord("LL: Beta\n$0.65/sf NNN").draft.partyProvider).toBe("Beta");
    expect(parseSingleRecord("Landlord: Beta\n$0.65/sf NNN").draft.partyProvider).toBe("Beta");
    expect(parseSingleRecord("LL - Beta\n$0.65/sf NNN").draft.partyProvider).toBe("Beta");
    expect(parseSingleRecord("$0.65/sf NNN\nlandlord is Beta").draft.partyProvider).toBe("Beta");
  });
  it("Seller:/Buyer:/Purchaser:/Grantor/Grantee read as the sale pair", () => {
    expect(parseSingleRecord("Seller: Acme\nBuilding sold, $3.1M").draft.partyProvider).toBe("Acme");
    expect(parseSingleRecord("Buyer: Acme\nBuilding sold, $3.1M").draft.partyAcquirer).toBe("Acme");
    expect(parseSingleRecord("Purchaser: Acme\nBuilding sold, $3.1M").draft.partyAcquirer).toBe("Acme");
    expect(parseSingleRecord("Grantor: Acme\nBuilding sold, $3.1M").draft.partyProvider).toBe("Acme");
    expect(parseSingleRecord("Grantee: Acme\nBuilding sold, $3.1M").draft.partyAcquirer).toBe("Acme");
  });
  it("a slash between two proper nouns on a party line reads as landlord/tenant in order", () => {
    const { draft } = parseSingleRecord("Core5 / Modular Power\n$0.65/sf NNN");
    expect(draft.partyProvider).toBe("Core5");
    expect(draft.partyAcquirer).toBe("Modular Power");
  });
});

describe("compParse corpus: PRICE / SALE", () => {
  it("price forms", () => {
    expect(parseProseLine("Sold for $4,150,000, 25,000 SF, closed 3/14/2026").draft.bldgPrice).toBe("4150000");
    expect(parseProseLine("Sold for $4.15M, 25,000 SF, closed 3/14/2026").draft.bldgPrice).toBe("4150000");
    expect(parseProseLine("Sold for 4.15mm, 25,000 SF building, closed 3/14/2026").draft.bldgPrice).toBe("4150000");
    expect(parseProseLine("Sold for $4,150,000.00, 25,000 SF, closed 3/14/2026").draft.bldgPrice).toBe("4150000");
  });
  it("a unit price ($/AC) WITH a size computes and stores the total, flagged derived", () => {
    const { draft, cellFlags } = parseSingleRecord("66 ac land\n$62,700/ac");
    expect(draft.landPrice).toBe(String(round2Helper(62700 * 66)));
    expect(cellFlags.landPrice?.level).toBe("soft");
  });
  it("a unit price ($ psf) WITH NO size holds as a note, Price left blank", () => {
    const { draft } = parseSingleRecord("Building sold\n$92.40 psf");
    expect(draft.bldgPrice).toBe("");
    expect(draft.notes).toMatch(/\$92\.4\/SF/);
  });
  it("cap rate + NOI", () => {
    expect(parseSingleRecord("Building sold\n6.25% cap").draft.bldgCapRate).toBe("0.0625");
    expect(parseSingleRecord("Building sold\ncap: 6.25").draft.bldgCapRate).toBe("0.0625");
    expect(parseSingleRecord("Building sold\n6.25 cap").draft.bldgCapRate).toBe("0.0625");
    expect(parseSingleRecord("Building sold\ngoing-in cap of 6.25%").draft.bldgCapRate).toBe("0.0625");
    expect(parseSingleRecord("Building sold\nNOI $2,600,000").draft.bldgNoi).toBe("2600000");
    expect(parseSingleRecord("Building sold\nNOI: 2.6M").draft.bldgNoi).toBe("2600000");
  });
});
function round2Helper(n) { return Math.round(n * 100) / 100; }

describe("compParse corpus: TYPE INFERENCE (only when the text doesn't say outright)", () => {
  it("lease vocabulary -> lease", () => {
    for (const line of ["NNN lease", "gross lease", "TI $13/sf", "6 months free rent", "abatement of 6 months", "tenant: Acme", "landlord: Beta", "126 month term", "RCD 6/1/27"]) {
      expect(detectCompType(line).value).toBe("lease");
    }
  });
  it("land vocabulary -> land", () => {
    for (const line of ["66 acres", "66 AC", "per acre pricing", "raw land tract", "dirt for sale", "unimproved lot"]) {
      expect(detectCompType(line).value).toBe("land");
    }
  });
  it("cap / NOI / buyer / seller / (price + building size) -> building sale", () => {
    expect(detectCompType("6.25% cap").value).toBe("building_sale");
    expect(detectCompType("NOI $2,600,000").value).toBe("building_sale");
    expect(detectCompType("Buyer: Acme").value).toBe("building_sale");
    expect(detectCompType("Seller: Acme").value).toBe("building_sale");
    const { draft } = parseProseLine("$4,150,000, 25,000 SF building");
    expect(draft.compType).toBe("building_sale");
  });
  it("conflicting or no signals -> Type BLANK, never defaults to Land", () => {
    expect(detectCompType("nothing recognizable here at all").value).toBeNull();
  });
});
