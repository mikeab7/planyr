/* pondLedgerKey — the SIGNATURE that decides whether the pond ledger pass has to run again.
 *
 * ⛔ WHY THIS IS ITS OWN, UNIT-TESTED MODULE AND NOT AN INLINE `useMemo` DEPENDENCY ARRAY.
 * B221763's own note names the hazard precisely: hoisting the ledger means a memo over ELEVEN
 * inputs, and *"a hand-maintained dependency list that misses one is a stale engineering LEDGER —
 * a wrong detention volume presented as current."* That risk did not go away when B236592 (#947)
 * made the leaves cheap; it is the reason this item sat open with the cost already paid.
 *
 * So the key is a VALUE signature, built here, in the open, where three things can be true at once:
 *   1. it is a pure function, so `test/pondLedgerKey.test.js` can PLANT A CHANGE IN EVERY INPUT and
 *      assert the signature moved — a missed input is a red build, not a wrong number on a plan;
 *   2. `POND_LEDGER_INPUTS` names the complete input set in one place, so the planted-change test
 *      is generated FROM the list rather than hand-written against it (add an input without a
 *      fixture for it and the test fails on the spot);
 *   3. the render body reads it as one string compare.
 *
 * ⛔ AND WHY A VALUE SIGNATURE RATHER THAN A DEPENDENCY ARRAY, which is the more common shape here.
 * Most of these inputs are FRESH OBJECTS HOLDING IDENTICAL CONTENTS on every render — `fmElev` is
 * an object literal in the render body, `pondAuto` is a call, `detRegime` is a call. A `useMemo`
 * over them never hits, which is VIEW-INDEPENDENT-ONCE §1's whole point: `Object.is` reports
 * "changed" on 100% of this class. Only a structural read of the values they carry can tell a pan
 * from an edit.
 *
 * ⛔ THE ONE THING KEYED BY IDENTITY IS THE POND ELEMENT ITSELF, and that is deliberate rather than
 * lazy. An element carries `points`, `det` (dozens of fields), `name` and `role`; enumerating them
 * is exactly the enumeration hazard above. The planner replaces elements WHOLESALE on every edit —
 * it never mutates one in place, which is the precondition `pureCache.identityCache` already
 * documents and which every element memo in this tree (B1352) already depends on. So element
 * identity is a STRICTLY SAFER key than any field list: it changes on every edit, including edits
 * to fields nobody thought to enumerate.
 *
 * Everything else is a scalar the split actually reads. Where a shaped input already has a
 * purpose-built signature — `fmZonesSig`, which `pondFloodFacts` itself keys on — this reuses it
 * rather than inventing a second one that could disagree.
 */

/** The COMPLETE input set of the pond ledger pass. The planted-change test is generated from this
 *  list, so adding an input without teaching the test about it fails CI. */
export const POND_LEDGER_INPUTS = [
  "ponds",            // the pond ELEMENTS, by identity — covers points, det, name, role
  "pondAuto",         // auto freeboard / side slope / top-of-bank (detWithAuto fills from these)
  "fmElev",           // the flood elevation scalars pondSplitFor reads
  "fmZonesSig",       // the flood-zone geometry signature (the one pondFloodFacts keys on)
  "fmZonesLen",       // …and whether there are any zones at all, which selects the branch
  "fmRule",           // the jurisdiction's flood rule record (a module constant — identity)
  "detRegime",        // hydraulic regime + the elevations the pool estimate reads
  "drainDetSplitRec", // the persisted per-pond split a restored view replays (identity)
  "drainIsRestored",  // whether this IS a restored view
  "drainCtxZones",    // how many flood zones the drainage context holds (the evidence gate)
  "coincidentStorm",  // the coincident-storm design policy
];

/* A monotonic token per object, held weakly. Two calls with the same object give the same token;
 * a replaced object gives a new one. Nothing is kept alive — when the object is collected so is
 * its entry. `null`/`undefined` get a stable literal so an absent input is not confusable with a
 * present one. */
export function createIdentityToken() {
  const wm = new WeakMap();
  let n = 0;
  return (o) => {
    if (o == null) return "~";
    if (typeof o !== "object" && typeof o !== "function") return `#${String(o)}`;
    let t = wm.get(o);
    if (t === undefined) { t = `@${++n}`; wm.set(o, t); }
    return t;
  };
}

const s = (v) => (v == null ? "~" : String(v));

/** Build the signature. `token` is a `createIdentityToken()` instance owned by the caller (one per
 *  component instance), so tokens stay stable for that component's lifetime. Pure. */
export function pondLedgerSignature(i, token) {
  const tk = typeof token === "function" ? token : createIdentityToken();
  const e = i.fmElev || {};
  const dr = i.detRegime || null;
  const pa = i.pondAuto || {};
  return [
    // 1 — the model. Identity per pond, in order, plus the count.
    (i.ponds || []).map(tk).join(","),
    // 2 — the auto-engineering values detWithAuto folds in when a field is left blank.
    s(pa.freeboard && pa.freeboard.value), s(pa.slope && pa.slope.value), s(pa.tobElev && pa.tobElev.value),
    // 3 — every flood elevation scalar the split reads (never the whole object: it also carries a
    //     function, and a function's identity churns every render for no reason).
    s(e.existGradeFt), s(e.bfeFt), s(e.bfeSrc), s(e.derivedBfeFt), s(e.derivedXsWselFt),
    s(e.derivedWse1pctFt), s(e.derivedWse1pctSrc),
    // 4 — the flood geometry, by the signature the flood-facts helper itself uses.
    s(i.fmZonesSig), s(i.fmZonesLen),
    // 5 — the jurisdiction rule record (a constant out of the registry: identity is stable).
    tk(i.fmRule),
    // 6 — the hydraulic regime, and the two elevations the Regime-B pool estimate reads.
    dr ? `${s(dr.regime)}/${s(dr.elevations && dr.elevations.bfeFt)}/${s(dr.elevations && dr.elevations.groundFt)}` : "~",
    // 7 — the restored-view replay record, and the two flags that select the restored branches.
    tk(i.drainDetSplitRec), i.drainIsRestored ? "1" : "0", s(i.drainCtxZones),
    // 8 — the design policy.
    i.coincidentStorm ? "1" : "0",
  ].join("|");
}
