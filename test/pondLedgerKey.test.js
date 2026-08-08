/* NEW-2 (B221763) — THE GUARD THAT MAKES MEMOISING THE POND LEDGER SAFE.
 *
 * ⛔ THE HAZARD THIS FILE EXISTS FOR, in B221763's own words: hoisting the ledger pass out of the
 * render body means keying it on ELEVEN inputs, and *"a hand-maintained dependency list that
 * misses one is a stale engineering LEDGER — a wrong detention volume presented as current."*
 * That is worse than the slow render it replaces, and it is why the item stayed open after
 * B236592 had already made the cost small.
 *
 * So the key is not asserted to be complete, it is PROVEN input by input: every entry in
 * `POND_LEDGER_INPUTS` has a fixture and a planted mutation here, the test is GENERATED from that
 * list, and adding an input to the list without teaching this file about it fails immediately.
 * A missed dependency is therefore a red build rather than a wrong number on a live plan.
 *
 * The second half holds the precondition the memo rests on: `accumulatePondLedger` must keep
 * folding over COPIES, because the render body now shares one entries array across renders.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { pondLedgerSignature, createIdentityToken, POND_LEDGER_INPUTS } from "../src/workspaces/site-planner/lib/pondLedgerKey.js";
import { accumulatePondLedger } from "../src/workspaces/site-planner/lib/pondLedger.js";

const src = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)), "utf8");

/* A complete, realistic input set. Deliberately every field populated: a planted change against a
 * null baseline can pass for the wrong reason (null → value moves any key). */
const baseInputs = () => ({
  ponds: [
    { id: "p1", type: "pond", points: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }], det: { depth: 8, freeboard: 1, slope: 3, tobElev: 100 }, name: "North Basin" },
    { id: "p2", type: "pond", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], det: { depth: 6, freeboard: 1, slope: 4, tobElev: 98 }, name: "South Basin" },
  ],
  pondAuto: { freeboard: { value: 1 }, slope: { value: 3 }, tobElev: { value: 99.5 } },
  fmElev: {
    existGradeFt: 97.2, bfeFt: 101.4, bfeSrc: "manual", derivedBfeFt: 101.1,
    derivedXsWselFt: 100.8, derivedWse1pctFt: 101.6, derivedWse1pctSrc: "atlas14",
    gradeAt: () => 97.2,           // a FUNCTION: fresh every render, and never in the key
    gradeAtKey: "grid-7",
  },
  fmZonesSig: "1722900000:3",
  fmZonesLen: 3,
  fmRule: { id: "fbcdd", freeboardFt: 1 },
  detRegime: { regime: "B", elevations: { bfeFt: 101.4, groundFt: 97.2 } },
  drainDetSplitRec: { byId: { p1: { wseFt: 100.2, inTrigger: true } } },
  drainIsRestored: true,
  drainCtxZones: 3,
  coincidentStorm: false,
});

/* One planted change per input. Each returns a MODIFIED copy of the base set — and each mutation
 * is the smallest one a real edit could produce, so the key is tested at its most sensitive. */
const PLANT = {
  ponds: (i) => ({ ...i, ponds: [{ ...i.ponds[0], det: { ...i.ponds[0].det, depth: 9 } }, i.ponds[1]] }),
  pondAuto: (i) => ({ ...i, pondAuto: { ...i.pondAuto, slope: { value: 4 } } }),
  fmElev: (i) => ({ ...i, fmElev: { ...i.fmElev, derivedWse1pctFt: 101.7 } }),
  fmZonesSig: (i) => ({ ...i, fmZonesSig: "1722900001:3" }),
  fmZonesLen: (i) => ({ ...i, fmZonesLen: 4 }),
  fmRule: (i) => ({ ...i, fmRule: { id: "hcfcd", freeboardFt: 1 } }),
  detRegime: (i) => ({ ...i, detRegime: { regime: "A", elevations: { bfeFt: 101.4, groundFt: 97.2 } } }),
  drainDetSplitRec: (i) => ({ ...i, drainDetSplitRec: { byId: { p1: { wseFt: 100.9, inTrigger: true } } } }),
  drainIsRestored: (i) => ({ ...i, drainIsRestored: false }),
  drainCtxZones: (i) => ({ ...i, drainCtxZones: 0 }),
  coincidentStorm: (i) => ({ ...i, coincidentStorm: true }),
};

describe("B221763 — the pond ledger key moves when ANY of its inputs moves", () => {
  it("every declared input has a planted change (the test is generated from the list)", () => {
    expect(Object.keys(PLANT).sort()).toEqual([...POND_LEDGER_INPUTS].sort());
  });

  for (const name of POND_LEDGER_INPUTS) {
    /* ⛔ THE BASE IS BUILT ONCE AND THE PLANT DERIVES FROM IT. A second `baseInputs()` call mints
     * fresh objects for the identity-keyed inputs, so every one of these would pass for the wrong
     * reason — the key would move because the ELEMENTS are new, not because the planted field is
     * in it. (Written after exactly that: with the base rebuilt per side, deleting an input from
     * the signature outright still left all eleven green.) */
    it(`a change to \`${name}\` changes the signature`, () => {
      const token = createIdentityToken();
      const base = baseInputs();
      const before = pondLedgerSignature(base, token);
      const after = pondLedgerSignature(PLANT[name](base), token);
      expect(after, `${name} is NOT in the key — the ledger would serve a stale number`).not.toBe(before);
    });
  }

  it("a pure re-render — same objects, nothing edited — produces the SAME signature", () => {
    const token = createIdentityToken();
    const i = baseInputs();
    expect(pondLedgerSignature(i, token)).toBe(pondLedgerSignature(i, token));
  });

  /* ⛔ THE CASE THE WHOLE FIX TURNS ON. A pan re-runs the render body, which rebuilds `fmElev`,
   * `pondAuto` and `detRegime` as FRESH OBJECTS holding identical values. `Object.is` calls that
   * "changed" — VIEW-INDEPENDENT-ONCE §1 — so a `useMemo` over them would never hit and the pass
   * would still run 127 times a gesture. A value signature is the only key that can tell those
   * apart from a real edit. */
  it("a PAN — fresh objects, identical values, same elements — produces the same signature", () => {
    const token = createIdentityToken();
    const first = baseInputs();
    const key1 = pondLedgerSignature(first, token);
    const nextRender = {
      ...baseInputs(),
      ponds: first.ponds,                     // state is untouched by a pan: same element objects
      fmRule: first.fmRule,                   // …and the rule record is a registry constant
      drainDetSplitRec: first.drainDetSplitRec,
      // fmElev / pondAuto / detRegime are rebuilt: new objects, same numbers.
    };
    expect(nextRender.fmElev).not.toBe(first.fmElev);
    expect(pondLedgerSignature(nextRender, token)).toBe(key1);
  });

  it("MOVING one pond's element object (an edit) changes the key; reordering is visible too", () => {
    const token = createIdentityToken();
    const i = baseInputs();
    const key = pondLedgerSignature(i, token);
    expect(pondLedgerSignature({ ...i, ponds: [i.ponds[1], i.ponds[0]] }, token)).not.toBe(key);
    expect(pondLedgerSignature({ ...i, ponds: [i.ponds[0]] }, token)).not.toBe(key);
    expect(pondLedgerSignature({ ...i, ponds: [] }, token)).not.toBe(key);
  });

  it("the function on fmElev is NOT in the key — a fresh closure must not invalidate the pass", () => {
    const token = createIdentityToken();
    const i = baseInputs();
    const key = pondLedgerSignature(i, token);
    expect(pondLedgerSignature({ ...i, fmElev: { ...i.fmElev, gradeAt: () => 97.2 } }, token)).toBe(key);
  });
});

describe("B221763 — the render body resolves the pass ONCE per model change", () => {
  it("the ledger build is gated on the signature, not run in the bare render body", () => {
    expect(src).toContain("const buildPondLedgerPass = () => {");
    expect(src).toContain("const pondLedgerSig = pondLedgerSignature({");
    expect(src).toContain("if (pondLedgerCache.current.key !== pondLedgerSig) {");
    expect(src).toContain("const pondLedgerEntries = pondLedgerCache.current.pass.entries;");
    // The old shape — an array pushed to straight from the render body — must not come back.
    expect(src.includes("\n  const pondLedgerEntries = [];")).toBe(false);
  });

  it("EVERY declared input is actually passed to the signature call", () => {
    const at = src.indexOf("const pondLedgerSig = pondLedgerSignature({");
    const call = src.slice(at, src.indexOf("}, pondLedgerToken.current);", at));
    for (const name of POND_LEDGER_INPUTS) {
      expect(call, `${name} is declared in POND_LEDGER_INPUTS but never passed`).toContain(`${name}`);
    }
  });

  it("the token and the cache are refs — one per component instance, not module-global", () => {
    expect(src).toContain("const pondLedgerToken = useRef(createIdentityToken());");
    expect(src).toContain("const pondLedgerCache = useRef({ key: null, pass: null });");
  });
});

describe("B221763 — the shared entries array is never written through", () => {
  const entries = () => ([
    { id: "p1", grossCf: 100000, usableCf: 80000, deadCf: 20000, excavationCf: 5000, mode: "anchored", role: "detention", factsKnown: true, bands: { mitigationCandidateCf: 0, elevations: { wseFt: 100 } } },
    { id: "p2", grossCf: 50000, usableCf: 40000, deadCf: 10000, excavationCf: 2500, mode: "flat", role: "detention", factsKnown: true, bands: null },
  ]);

  it("the fold stamps `duty` on a COPY — the caller's entries are untouched", () => {
    const e = entries();
    const out = accumulatePondLedger(e, { mitigationRequiredCf: 10000 });
    expect(out.perPond[0].duty).toBeTruthy();
    expect(e[0].duty).toBeUndefined();
    expect(out.perPond[0]).not.toBe(e[0]);
  });

  it("the fold is memoised on entries IDENTITY + the requirement by VALUE", () => {
    const e = entries();
    const a = accumulatePondLedger(e);
    expect(accumulatePondLedger(e)).toBe(a);                                  // same question, same answer object
    expect(accumulatePondLedger(e, { mitigationRequiredCf: 10000 })).not.toBe(a); // different requirement, recomputed
    expect(accumulatePondLedger(entries())).not.toBe(a);                      // a rebuilt array is a new question
  });

  it("the memo is TRANSPARENT — a cached fold equals a fresh one field for field", () => {
    const a = accumulatePondLedger(entries(), { mitigationRequiredCf: 25000 });
    const b = accumulatePondLedger(entries(), { mitigationRequiredCf: 25000 });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
