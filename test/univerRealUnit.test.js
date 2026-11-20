/* NEW-1 (B2607857) — the REAL workbook's unit is built before the click and adopted at mount. Pure halves + source pins; the behaviour itself runs in a
 * real browser (ui-audit/verify-univer-adopt-real-unit.mjs, verify-univer-parity with PARITY_PREWARM=1, verify-univer-load-live). */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createWorkbook, setRaw, canonicalJson, migrateWorkbook } from "../src/workspaces/model/lib/sheetModel.js";
import { prepareUnit } from "../src/workspaces/model/lib/univerUnitPrep.js";
import { deviceUserId } from "../src/workspaces/model/lib/deviceUser.js";
import { calcHash, collectValues } from "../src/workspaces/model/lib/univerCalcCache.js";

const wbWith = (cells) => { const wb = createWorkbook(); let sh = wb.sheets[0].sheet; for (const [r, c, raw] of cells) sh = setRaw(sh, r, c, raw); return { ...wb, sheets: [{ ...wb.sheets[0], sheet: sh }] }; };
const base = () => wbWith([[0, 0, "2"], [0, 1, "3"], [0, 2, "=A1*B1"], [1, 0, "10"], [1, 2, "=SUM(A1:A2)"]]);
const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("prepareUnit — the one way a workbook becomes a unit", () => {
  it("storedCanon is exactly the canonical text UniverSheet compares at mount (canonicalJson of the migrated workbook)", () => {
    const wb = base();
    expect(prepareUnit(wb).storedCanon).toBe(canonicalJson(migrateWorkbook(wb)));
  });
  it("is deterministic: the same stored workbook prepared twice has the same canon and hash (so a unit built at hover matches the one the mount would build)", () => {
    const a = prepareUnit(base()), b = prepareUnit(base());
    expect(a.storedCanon).toBe(b.storedCanon);
    expect(a.hash).toBe(b.hash);
  });
  it("any edit changes the canon (an edited workbook can never be mistaken for the waiting unit)", () => {
    const a = prepareUnit(base()).storedCanon;
    const edited = wbWith([[0, 0, "3"], [0, 1, "3"], [0, 2, "=A1*B1"], [1, 0, "10"], [1, 2, "=SUM(A1:A2)"]]);
    expect(prepareUnit(edited).storedCanon).not.toBe(a);
  });
  it("seeds the formula cells from a remembered entry made for exactly this workbook — and nothing for any other", () => {
    const first = prepareUnit(base());
    const snap = { sheets: {} };
    const sheetId = Object.keys(first.data.sheets)[0];
    snap.sheets[sheetId] = { cellData: JSON.parse(JSON.stringify(first.data.sheets[sheetId].cellData)) };
    for (const row of Object.values(snap.sheets[sheetId].cellData)) for (const cell of Object.values(row)) if (cell.f !== undefined) cell.v = 99;
    const values = collectValues({ sheets: snap.sheets, resources: [] });
    const entry = { h: first.hash, v: values };
    expect(prepareUnit(base(), { entry }).seeded).toBe(2);
    const other = wbWith([[0, 0, "7"], [0, 2, "=A1*2"]]);
    expect(prepareUnit(other, { entry }).seeded).toBe(0);
    expect(calcHash(prepareUnit(other).storedCanon)).not.toBe(entry.h);
  });
  it("merges project names into the defined-names resource, and still reports the same canon (names are not part of the stored workbook)", () => {
    const defs = { "planyr-name-site-acres": { id: "planyr-name-site-acres", name: "Site.Acres", formulaOrRefString: "12.5" } };
    const p = prepareUnit(base(), { defs });
    const res = p.data.resources.find((r) => r.name === "SHEET_DEFINED_NAME_PLUGIN");
    expect(JSON.parse(res.data)["planyr-name-site-acres"].name).toBe("Site.Acres");
    expect(p.storedCanon).toBe(prepareUnit(base()).storedCanon);
  });
});

describe("deviceUserId — who is signed in, read synchronously from the stored session", () => {
  const store = (entries) => ({ get length() { return Object.keys(entries).length; }, key: (i) => Object.keys(entries)[i], getItem: (k) => entries[k] ?? null });
  const jwt = (sub) => `h.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.s`;
  it("reads user.id from the supabase session entry", () => {
    expect(deviceUserId(store({ "sb-abc-auth-token": JSON.stringify({ access_token: "x", user: { id: "u-1" } }) }))).toBe("u-1");
    expect(deviceUserId(store({ "sb-abc-auth-token": JSON.stringify({ currentSession: { user: { id: "u-2" } } }) }))).toBe("u-2");
  });
  it("falls back to the token's subject, skips a corrupt entry, and is null when signed out", () => {
    expect(deviceUserId(store({ "sb-abc-auth-token": JSON.stringify({ access_token: jwt("u-3") }) }))).toBe("u-3");
    expect(deviceUserId(store({ "sb-bad-auth-token": "{not json", "sb-ok-auth-token": JSON.stringify({ user: { id: "u-4" } }) }))).toBe("u-4");
    expect(deviceUserId(store({ other: "x" }))).toBeNull();
    expect(deviceUserId(null)).toBeNull();
  });
});

describe("the adoption rule is in the code, and a wrong guess falls back to a normal load", () => {
  const sheet = src("src/workspaces/model/components/UniverSheet.jsx");
  const fw = src("src/workspaces/model/components/univerFramework.js");
  it("UniverSheet adopts only when the waiting unit was built for this scope AND this exact workbook", () => {
    expect(sheet).toMatch(/const adoptable = !!\(pre && pre\.prep && pre\.viewKey === L\.viewKey && pre\.prep\.storedCanon && pre\.prep\.storedCanon === incoming\);/);
    expect(sheet).toMatch(/if \(adoptable\) adopt\(\); else load\(workbook\);/);
  });
  it("load() builds through prepareUnit (one way a workbook becomes a unit) and still drops a waiting unit it does not adopt", () => {
    expect(sheet).toMatch(/prepareUnit\(wb, \{ entry: peekCalc\(L\.viewKey\), defs \}\)/);
    expect(sheet).toMatch(/if \(L\.unitId\) \{ try \{ univerAPI\.disposeUnit\(L\.unitId\)/);
  });
  it("the pre-build reads the device copy for the hovered project and keeps what its first calculation said", () => {
    expect(fw).toMatch(/readLocalSheet\(userId, projectId\)/);
    expect(fw).toMatch(/entry\.found = q\.circularReferences/);
    expect(fw).toMatch(/if \(projectId && !calcCacheSettled\(projectId\)\)/);
  });
});
