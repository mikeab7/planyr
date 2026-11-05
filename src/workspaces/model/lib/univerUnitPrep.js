/* Model workspace — turning a Planyr workbook into everything Univer needs to build its unit, WITHOUT touching Univer (NEW-1, B2607857 —
 * docs/SPREADSHEET-UNIVER-SPIKE.md "Load time, round 3").
 *
 * WHY IT IS ITS OWN FILE. The grid used to do this inline in `load()` at the moment the workbook arrived, so the cost sat between the click and the
 * first frame. Pulled out as a PURE function, the same work can be done earlier — when the pointer rests on the Spreadsheet tab, on the project's
 * stored workbook — and the unit built from it stands ready when the grid mounts (components/univerFramework.js). `load()` calls this too, so there
 * is ONE way a workbook becomes a unit, whichever moment it happens at. Imports nothing from Univer (the bridge is pure).
 *
 * `storedCanon` is the canonical text of the workbook AS STORED (what the next open will load): equal canon at mount ⇒ the waiting unit IS this
 * workbook, and is adopted instead of rebuilt. Anything else (an edit elsewhere, a cloud copy that won) differs and falls back to a normal load. */
import { migrateWorkbook, canonicalJson } from "./sheetModel.js";
import { workbookToUniver } from "./univerBridge.js";
import { migratePlanyrSyntaxInWorkbook } from "./planyrSyntax.js";
import { calcHash, entryFits, seedValues } from "./univerCalcCache.js";

/** @param wb a Planyr workbook (any version)  @param opts.entry the remembered calculation entry for this scope (or null)
 *  @param opts.defs the Site / Plan / Comp project names as Univer defined names (`projectNamesToDefinedNames`), or {}
 *  @returns { migrated, data, sidecar, rewritten, storedCanon, hash, seeded } */
export function prepareUnit(wb, { entry = null, defs = {} } = {}) {
  const migrated = migrateWorkbook(wb);
  // NEW-1 (one formula engine): [Column] names, interleaved XIRR/XNPV pairs and `=-Name` are rewritten to the spelling Univer's engine
  // calculates, with a visible note — and SAVED that way (the baseline stays the stored text, so the first flush after the load sees a
  // difference and commits the rewrite as one ordinary edit).
  const { workbook: forUniver, rewritten } = migratePlanyrSyntaxInWorkbook(migrated);
  const { data, sidecar } = workbookToUniver(forUniver);
  if (defs && Object.keys(defs).length) {
    const res = data.resources.find((r) => r.name === "SHEET_DEFINED_NAME_PLUGIN");
    if (res) res.data = JSON.stringify({ ...JSON.parse(res.data), ...defs });
    else data.resources.push({ name: "SHEET_DEFINED_NAME_PLUGIN", data: JSON.stringify(defs) });
  }
  // THE CALCULATION CACHE (lib/univerCalcCache.js): formula results remembered on this device. Used only when the hash of EXACTLY this
  // workbook matches, so a stale value cannot appear; with a value in a formula cell Univer (WHEN_EMPTY) does not wait to calculate it.
  let storedCanon = null, hash = null, seeded = 0;
  try {
    storedCanon = canonicalJson(migrated);                                    // the workbook as it is STORED — what the next open will load
    hash = calcHash(storedCanon);
    seeded = entryFits(entry, hash, migrated) ? seedValues(data, entry.v) : 0;
  } catch (_) { seeded = 0; }
  return { migrated, data, sidecar, rewritten, storedCanon, hash, seeded };
}
