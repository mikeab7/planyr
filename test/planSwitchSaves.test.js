/* B2233521 — what a plan switch, a page hide and a sign-out may WRITE.
 *
 * The browser half — real edits on two plans through the real UI, every cloud and device write recorded, the plan you left watched while
 * it is off screen, a reload and a sign-out — is the ui-audit harness verify-plan-switch-writes (FAIL on the build before this change: the
 * sign-out copied the open plan into the signed-out device store; FAIL again with the account gate removed). This is the CI-runnable half. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { sameSaveRecord, writeIsRedundant, mayWriteForAccount, SAVE_RECORD_KEYS } from "../src/workspaces/site-planner/lib/saveDedupe.js";

const sp = readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");

describe("saveDedupe — a flush of exactly the last write is skipped, and only then", () => {
  const rec = { id: "a", site: "S", name: "P", groupId: "g", county: "harris", origin: { lat: 1, lon: 2 }, parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, sheetOverlays: [], deletedIds: [], layerOverrides: {}, layerAbove: {} };
  it("same values (collections by identity) → same record", () => {
    expect(sameSaveRecord(rec, { ...rec })).toBe(true);
  });
  it("any one field different → a real write", () => {
    for (const k of SAVE_RECORD_KEYS) expect(sameSaveRecord(rec, { ...rec, [k]: k === "name" || k === "site" || k === "id" ? "other" : Array.isArray(rec[k]) ? [] : {} })).toBe(false);
  });
  it("redundant only while the store still holds that write", () => {
    const last = { rec, stamp: "s1" };
    expect(writeIsRedundant(last, { ...rec }, (s) => s === "s1")).toBe(true);
    expect(writeIsRedundant(last, { ...rec }, () => false)).toBe(false);          // another writer touched the store
    expect(writeIsRedundant(null, rec, () => true)).toBe(false);
  });
});

describe("mayWriteForAccount — a plan opened under an account is never written into another store", () => {
  it("same account → write; signed out / another account → refuse", () => {
    expect(mayWriteForAccount("u1", "u1")).toBe(true);
    expect(mayWriteForAccount("u1", null)).toBe(false);     // the measured leak: sign-out, then persist-on-leave
    expect(mayWriteForAccount("u1", "u2")).toBe(false);
  });
  it("a planner opened with NO account (signed out, or before sign-in resolves at boot) is not gated", () => {
    expect(mayWriteForAccount(null, null)).toBe(true);
    expect(mayWriteForAccount(null, "u1")).toBe(true);
  });
});

describe("source guard — every planner save goes through the gate", () => {
  it("saveLive and the autosave (mirror + settle tick) ask mayWriteForAccount before writing", () => {
    expect(sp).toMatch(/const saveLive = \(rec\) => \{\s*\n\s*if \(!mayWriteForAccount\(openedUidRef\.current, activeUid\(\)\)\)/);
    expect(sp).toMatch(/const writeMirror = \(\) => \{\s*\n\s*if \(!mayWriteForAccount\(openedUidRef\.current, activeUid\(\)\)\)/);
    expect(sp).toMatch(/if \(!mayWriteForAccount\(openedUidRef\.current, activeUid\(\)\)\) return; \/\/ B2233521 — never into another account's store\s*\n\s*const mirrorHeld/);
  });
  it("the switch flush, persist-on-leave and the page-hide flush all use saveLive, never a bare saveSite", () => {
    for (const flush of ["const flushSite = () =>", "const flush = () => { if (deletedSelfRef.current) return;", "const persistOrDrop = () => {"]) {
      const at = sp.indexOf(flush); expect(at, flush).toBeGreaterThan(0);
      const body = sp.slice(at, sp.indexOf("\n  };", at) > 0 && flush.startsWith("const persistOrDrop") ? sp.indexOf("\n  };", at) : at + 260);
      expect(body, flush).toMatch(/saveLive\(/);
      expect(body, flush).not.toMatch(/[^.]saveSite\(\{ id: siteId/);
    }
  });
  it("the opening account is captured once, at mount", () => {
    expect(sp).toMatch(/const openedUidRef = useRef\(undefined\); if \(openedUidRef\.current === undefined\) openedUidRef\.current = activeUid\(\) \|\| null;/);
  });
});
