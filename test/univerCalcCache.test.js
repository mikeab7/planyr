/* NEW-1 (B2604xxx) — the Spreadsheet's calculation cache (lib/univerCalcCache.js): correct by construction. An entry is used only for the
 * exact workbook + names it was made from, never for a volatile or spilling formula, and what it seeds is only ever a formula cell. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { calcHash, cacheUnsafe, collectValues, seedValues, entryFits, cyrb53, countValues } from "../src/workspaces/model/lib/univerCalcCache.js";
import { createWorkbook, setRaw, canonicalJson, migrateWorkbook } from "../src/workspaces/model/lib/sheetModel.js";
import { workbookToUniver } from "../src/workspaces/model/lib/univerBridge.js";

const wbWith = (cells) => { let wb = createWorkbook(); let sh = wb.sheets[0].sheet; for (const [r, c, raw] of cells) sh = setRaw(sh, r, c, raw); return { ...wb, sheets: [{ ...wb.sheets[0], sheet: sh }] }; };
const base = () => wbWith([[0, 0, "2"], [0, 1, "3"], [0, 2, "=A1*B1"], [1, 0, "10"], [1, 2, "=SUM(A1:A2)"]]);

describe("calcHash — equal inputs only", () => {
  it("is stable for the same workbook and names, and changes with any cell", () => {
    const a = canonicalJson(migrateWorkbook(base()));
    expect(calcHash(a)).toBe(calcHash(a));
    const edited = canonicalJson(migrateWorkbook(wbWith([[0, 0, "2"], [0, 1, "4"], [0, 2, "=A1*B1"], [1, 0, "10"], [1, 2, "=SUM(A1:A2)"]])));
    expect(calcHash(edited)).not.toBe(calcHash(a));
  });
  it("hashes differ for different strings (no trivial collision) and are deterministic", () => {
    expect(cyrb53("abc")).toBe(cyrb53("abc")); expect(cyrb53("abc")).not.toBe(cyrb53("abd")); expect(cyrb53("abc", 7)).not.toBe(cyrb53("abc", 0));
  });
});

describe("cacheUnsafe — volatile and spilling formulas are never cached", () => {
  it.each(["=TODAY()", "=NOW()+1", "=RAND()", "=OFFSET(A1,1,0)", "=INDIRECT(\"A1\")", "=SEQUENCE(3)", "=FILTER(A1:A3,A1:A3>1)", "=UNIQUE(A1:A9)", "=sort(A1:A3)", "=Site.Acres*2", "=SUM(A1:A2)+Plan.Building1.SF", "=Comp.Foo.RentPSF"])("%s", (f) => {
    expect(cacheUnsafe(wbWith([[0, 0, f]]))).toBe(true);
  });
  it("an ordinary workbook is safe; text that merely mentions a function is not a formula", () => {
    expect(cacheUnsafe(base())).toBe(false);
    expect(cacheUnsafe(wbWith([[0, 0, "TODAY() is a function"], [0, 1, "=SUM(A1:A1)"]]))).toBe(false);
    expect(cacheUnsafe(wbWith([[0, 0, "=MySite.Total+1"], [0, 1, "=Sheet2.A1"]]))).toBe(false);          // a user's own dotted name / sheet reference is not live project data
  });
});

describe("collectValues / seedValues — only formula cells, round trip through the bridge's data", () => {
  it("seeds exactly the formula cells it was given, and nothing else", () => {
    const { data } = workbookToUniver(base());
    const sheetId = Object.keys(data.sheets)[0];
    const snap = { sheets: { [sheetId]: { cellData: { 0: { 0: { v: 2, t: 2 }, 2: { f: "=A1*B1", v: 6, t: 2 } }, 1: { 2: { f: "=SUM(A1:A2)", v: 12, t: 2 } } } } }, resources: [] };
    const values = collectValues(snap);
    expect(values[sheetId]).toEqual({ "0:2": [6, 2], "1:2": [12, 2] });          // the literal 2 in A1 is NOT collected
    const n = seedValues(data, values);
    expect(n).toBe(2);
    expect(data.sheets[sheetId].cellData[0][2].v).toBe(6);
    expect(data.sheets[sheetId].cellData[0][0].v).toBe(2);                         // untouched literal
  });
  it("a snapshot holding a volatile, spilling or project-data formula caches nothing", () => {
    for (const f of ["=TODAY()", "=SEQUENCE(3)", "=Site.Acres*2"]) expect(collectValues({ sheets: { s: { cellData: { 0: { 0: { f, v: 1, t: 2 } } } } }, resources: [] })).toBeNull();
  });
  it("a snapshot carrying array-formula data caches nothing", () => {
    const snap = { sheets: { s: { cellData: { 0: { 0: { f: "=A2", v: 1, t: 2 } } } } }, resources: [{ name: "SHEET_ARRAY_FORMULA_PLUGIN", data: JSON.stringify({ s: { 0: { 0: { startRow: 0 } } } }) }] };
    expect(collectValues(snap)).toBeNull();
  });
  it("a seeded value never lands on a cell that is not a formula in the data being loaded", () => {
    const { data } = workbookToUniver(base());
    const sheetId = Object.keys(data.sheets)[0];
    expect(seedValues(data, { [sheetId]: { "0:0": [999, 2], "5:5": [1, 2] } })).toBe(0);
    expect(data.sheets[sheetId].cellData[0][0].v).toBe(2);
  });
});

describe("entryFits — the one rule", () => {
  const wb = base(); const h = calcHash(canonicalJson(migrateWorkbook(wb)));
  it("needs an equal hash, values, and a safe workbook", () => {
    expect(entryFits({ h, v: { s: {} } }, h, wb)).toBe(true);
    expect(entryFits({ h: h + "x", v: { s: {} } }, h, wb)).toBe(false);
    expect(entryFits(null, h, wb)).toBe(false);
    expect(entryFits({ h, v: { s: {} } }, h, wbWith([[0, 0, "=TODAY()"]]))).toBe(false);
  });
});

describe("wiring", () => {
  const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  it("ModelApp primes the read; UniverSheet seeds in load() and writes after a settled calculation, not while an edit is pending", () => {
    expect(read("src/workspaces/model/ModelApp.jsx")).toMatch(/primeCalcCache\(viewPrefsKey\)/);
    const g = read("src/workspaces/model/components/UniverSheet.jsx");
    expect(g).toMatch(/entryFits\(entry, h, migrated\)/);
    expect(g).toMatch(/seedValues\(data, entry\.v\)/);
    expect(g).toMatch(/L\.save\.hasPending\(\) && tries < 6/);
    expect(g).toMatch(/L\.storedCanon = canonicalJson\(migrateWorkbook\(next\)\)/);        // the hash is of what will be STORED, not of Univer's round-trip form
  });
  it("the cache lives in the large tier and is classified, not 'other'", () => {
    expect(read("src/shared/storage/storageCensus.js")).toMatch(/id: "calccache"[\s\S]{0,200}model:calc:/);
  });
  it("the saved workbook never carries the cache (a derived value beside its source would break sync)", () => {
    const m = read("src/workspaces/model/lib/sheetModel.js");
    expect(m).not.toMatch(/calcCache|\.calc\b/);
  });
});

describe("countValues — a fuller answer replaces a partial one", () => {
  it("counts every remembered formula cell across sheets, and nothing for no entry", () => {
    expect(countValues(null)).toBe(0);
    expect(countValues({})).toBe(0);
    expect(countValues({ s1: { "0:2": [5, null], "1:2": [12, null] }, s2: { "0:0": [1, null] } })).toBe(3);
  });
  it("UniverSheet writes on a NOT_EXECUTED end too, and again after a load (measured live: the first calculation does not always end SUCCESS)", () => {
    const src = readFileSync(new URL("../src/workspaces/model/components/UniverSheet.jsx", import.meta.url), "utf8");
    expect(src).toMatch(/state !== 3[^\n]*&& state !== 2/);
    expect(src).toMatch(/L\.scheduleCalcWrite\(\)/);
  });
});
