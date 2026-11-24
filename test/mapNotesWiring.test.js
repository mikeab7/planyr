/* Map notes — the WIRING rules, asserted on the real source (NEW-1).
 *
 * These are the three properties that cannot be checked from the pure modules alone, and each one
 * is a defect this repo has already paid for once:
 *  1. ONE placement mechanism, not two. The brief's own words: "generalise the naming where you
 *     touch it rather than cloning a second parallel mechanism — a second copy of this is how the
 *     two comp-anchor paths got out of step before (HARDENING-12)."
 *  2. What is PAINTED is gated on its own layer checkbox and NOTHING else — B831778's decoupling
 *     rule ("If selecting the Comps tab hides site pins, the design has failed"), which the notes
 *     layer now has to obey too.
 *  3. DELETE IS SOFT. A hard delete of a note would be unrecoverable and silent.
 */
import { describe, it, expect } from "vitest";
import { mapFinderSource } from "./helpers/mapFinderSource.js";
import { readFileSync } from "node:fs";

const finder = mapFinderSource();
const store = readFileSync(new URL("../src/shared/mapNotes/lib/mapNotesStore.js", import.meta.url), "utf8");

describe("the note is a VERB on the decide bar — never a second placement mechanism", () => {
  /* The brief's requirement was "generalise the naming where you touch it rather than cloning a
   * second parallel mechanism — a second copy of this is how the two comp-anchor paths got out of
   * step before (HARDENING-12)". The ground-first toolbar that landed while this was being built
   * answers that requirement more completely than a rename could: the pin and the parcel selection
   * are pointed at FIRST, and one table of verbs decides what the ground becomes. A note is the
   * fourth row of that table, so it inherits every anchor path wholesale. */
  it("lives in the ONE decide-verb table, beside site / comp / siteplan", () => {
    expect(finder).toMatch(/key: "note"/);
    const table = finder.slice(finder.indexOf("const DECIDE_VERBS = ["), finder.indexOf("const verbsByKey"));
    for (const k of ["site", "comp", "siteplan", "note"]) expect(table, `${k} left the table`).toContain(`key: "${k}"`);
  });

  it("adds no second armed-pin mode of its own — the dropped pin is the app's, not the note's", () => {
    expect(finder).not.toMatch(/placeNotePinAt|placingNotePin|setPlacingNotePin|pinIntent/);
  });

  it("takes BOTH targets a verb can be given, through the shared derivations", () => {
    const run = finder.slice(finder.indexOf('key: "note"'), finder.indexOf('key: "note"') + 1400);
    expect(run, "parcel target").toMatch(/parcelAnchorFromSelection\(selected, asm\)/);
    expect(run, "pin target").toMatch(/beginNoteAtPoint/);
  });

  it("derives a pin's county through the SAME helper the comp pin uses, not a second lookup", () => {
    const helper = finder.slice(finder.indexOf("const beginNoteAtPoint"), finder.indexOf("const placeCompPinAt"));
    expect(helper).toMatch(/resolveCompCounty\(/);
  });

  it("the parcel derivation is the shared one, under its generalised name", () => {
    const anchorLib = readFileSync(new URL("../src/workspaces/site-planner/lib/compParcelAnchor.js", import.meta.url), "utf8");
    expect(anchorLib).toMatch(/export function parcelAnchorFromSelection/);
    // the old name stays exported, so the comp call site (and any in-flight branch) still resolves
    expect(anchorLib).toMatch(/export const compAnchorFromSelection = parcelAnchorFromSelection/);
  });

  it("⛔ never creates a site — the one place it must differ from the comp verb beside it", () => {
    const run = finder.slice(finder.indexOf('key: "note"'), finder.indexOf('key: "note"') + 1400);
    expect(run).not.toMatch(/resolveOrCreateTrackedSiteForComp|createTrackedSite|planSelected\(/);
  });
});

describe("delete is soft, keyed on (owner, id) the way comps are", () => {
  it("the delete the UI calls stamps deleted_at rather than deleting the row", () => {
    const del = store.slice(store.indexOf("export async function deleteMapNote"), store.indexOf("export async function restoreMapNote"));
    expect(del).toMatch(/update\(\{ deleted_at: new Date\(\)\.toISOString\(\) \}\)/);
    expect(del).not.toMatch(/\.delete\(/);
  });

  it("a soft delete that matched no row is reported, never treated as success (B209's class)", () => {
    for (const fn of ["deleteMapNote", "restoreMapNote", "updateMapNote"]) {
      const body = store.slice(store.indexOf(`export async function ${fn}`));
      expect(body.slice(0, 800), `${fn} must not report a write it did not get`).toMatch(/if \(!data|if \(!Array\.isArray\(data\)/);
    }
  });

  it("the live list excludes soft-deleted notes and a restore path exists", () => {
    expect(store).toMatch(/\.is\("deleted_at", null\)/);
    expect(store).toMatch(/export async function restoreMapNote/);
  });

  it("MapFinder only ever calls the SOFT delete — never the purge", () => {
    expect(finder).toMatch(/deleteMapNote/);
    expect(finder).not.toMatch(/permanentlyDeleteMapNote/);
  });
});
