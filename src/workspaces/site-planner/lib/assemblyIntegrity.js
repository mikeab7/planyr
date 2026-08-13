/* Bonded-assembly integrity — the INVARIANT and the DETECTOR (NEW-1 / NEW-2).
 *
 * WHY THIS MODULE EXISTS (read this before changing anything here).
 *
 * A bonded assembly — a building plus every element `attachedTo` it (truck court, trailer
 * parking, sidewalks, side-parking rows, corner bump-outs) — is ONE object to the user and
 * N+1 INDEPENDENT ROWS in `site_elements`. Each row carries its own `rev`, is accepted or
 * refused on its own rev guard, echoes on its own realtime event, journals on its own entry,
 * and is folded back on its own key. Those two facts are incompatible: as long as a child row
 * can land at a different moment from its host row, SOME interleaving lands one without the
 * other. Eight merged PRs each closed one specific interleaving (#847, #849, #850, #851, #852,
 * #853, #854, #857) and the tear kept coming back, because closing interleavings is downstream
 * of the cause — it makes the bad state harder to REACH, never impossible to REPRESENT.
 *
 * The structural observation this module is built on: a bonded child's world position is
 * REDUNDANT. It is derivable from its host, and the derivation already exists — it is the
 * load-time heal, `siteModel.normalizeBondedChildren`. So the geometry stored on the child row
 * is not a second source of truth; it is a CACHE of the host's frame, and the tear is that
 * cache going stale. Remove the redundancy at every seam — re-derive instead of trusting the
 * stored child geometry — and a partial apply stops being observable and stops being
 * committable, whatever race produced it.
 *
 * Three things live here, and they are deliberately ONE function so they can never drift:
 *   • the INVARIANT   — `assemblyIntegrity(els).els` is the healed list (identity when clean).
 *                       Covers a child's FULL geometry: where it sits AND how long it is.
 *   • the DETECTOR    — `.tears` names every child that disagreed with its host by more than
 *                       `ASSEMBLY_TEAR_TOL_FT`, with ids and the delta, for telemetry.
 *   • the LOUD HEAL   — `.repairs` names EVERY element the heal rewrote, tear or drift.
 * The detector is the healer's own diff, so a state the detector calls torn is by construction
 * exactly a state the healer repairs. A separate re-implementation of "where should this child
 * be" would be a second derivation, i.e. the next bug in this family.
 *
 * WHAT IS AND IS NOT DERIVABLE (honest scope — do not overstate this in copy or comments):
 *   • ACROSS the wall (the outward normal) a bonded child's offset is fully determined by the
 *     host box and the depths inboard of it. There is NO user freedom on that axis, so any
 *     disagreement past tolerance is a tear.
 *   • ALONG the wall there IS user freedom (sliding or shortening a parking field to line up a
 *     curb return — B1039) — but as of NEW-2 that freedom must be RECORDED to count. An unstamped
 *     along-wall run or centre that disagrees with the span is staleness, not intent, and is
 *     re-derived; a `sideParkFit` stamp (written only by a gesture aimed at that field) is honoured
 *     and re-clamped to the host's current wall on every host change. The removed clause —
 *     "preserve once touched", which read any geometric difference as intent forever — is what
 *     survived B1340 and put a 205 ft field on a 260 ft wall.
 *   • A wall strip and a corner bump-out are fully derived on BOTH axes.
 * So the invariant is "every bonded child sits at its host-derived anchor across the wall, spans
 * the wall its host currently has unless an explicit override says otherwise, and stays within
 * overlap along it" — complete for impossible states, silent about legal ones.
 *
 * Pure: no DOM, no clock, no I/O. Safe in a worker and in a Node test.
 */
import { normalizeBondedChildren, orphanWallPads, missingBondSiblings, impossibleStacks } from "./siteModel.js";

/* The reporting floor, in feet. The heal's own passes re-derive to ~1e-6 ft, so a coherent plan
 * read off disk routinely gets sub-inch corrections (stored rounding, a legacy record's drift) —
 * those are `repairs`, not `tears`, and paging on them would be noise. A real displacement in
 * this family is measured in HUNDREDS of feet (the reported case: every child of one building
 * translated ~267 ft east / ~4 ft north with the host left behind), so one foot sits orders of
 * magnitude clear of both. Distinct from `siteModel.ANCHOR_TOL_FT`, which is how far the HEALER
 * lets a child sit before it re-fits it; this is only how far it may sit before we TELL SOMEONE. */
export const ASSEMBLY_TEAR_TOL_FT = 1;

const num = (v) => (Number.isFinite(v) ? v : 0);
const r3 = (v) => Math.round(v * 1000) / 1000;
// Signed angle difference in (−180, 180], so a 359° → 1° correction reads as +2, not −358.
const angDelta = (a, b) => {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return ((((a - b) % 360) + 540) % 360) - 180;
};

/* Run the invariant over a collection of elements.
 *
 * Returns:
 *   els      — the healed list. IDENTICAL BY REFERENCE when nothing needed repair (every pass in
 *              `normalizeBondedChildren` is identity-on-no-op), so a caller can use `changed` as a
 *              cheap "do I need to write state" test and there is no re-render / re-diff loop.
 *   changed  — whether anything was rewritten at all.
 *   repairs  — one record per rewritten element { id, host, type, dx, dy, dist, drot }.
 *   tears    — the subset of `repairs` displaced further than `tol`. This is what pages us.
 *
 * `kinds` on each repair records WHICH pass moved it (dog-ear / wall-strip / side-parking /
 * dock-zone / zone-along-len / host-run / cross-host-bond), because "what kind of bond broke" is
 * the first question asked of any recurrence. A pass that reports no kind (the B363 rotation
 * re-anchor) still shows up as a repair via the geometry diff — the diff is the source of truth
 * here, the callbacks are annotation.
 */
export function assemblyIntegrity(els, { tol = ASSEMBLY_TEAR_TOL_FT, mintId = null } = {}) {
  const list = Array.isArray(els) ? els : [];
  /* NEW-4 — the ROLE invariant, measured on the INPUT before anything is healed. A non-stack pad
   * bonded to a building host must resolve to a wall AND carry the role tag for that wall. This is
   * the check that was missing: three untagged pads bonded to a building, sitting exactly where
   * side parking belongs, are geometrically indistinguishable from correct — the geometry diff
   * below can never see them, because nothing was in the wrong PLACE. What was wrong was that they
   * had no IDENTITY, so every lookup keyed on the role tag stopped seeing them, one of those
   * lookups gated a destructive rung, and the defect ran five days across six sites before the
   * owner noticed missing sidewalks. A bonded child with no role is now a reported defect in its
   * own right, whatever its coordinates say. */
  const orphans = orphanWallPads(list);
  /* ⛔ NEW-3 — WHAT THE HEAL CANNOT DO, measured on the INPUT and reported whether or not anything
   * was rewritten. A heal that meets a state it cannot repair has exactly two honest options:
   * repair it, or say so. It had a third — quietly produce *a* layout and report success — and it
   * took it, leaving a trailer row hard against a building with the truck court trucks reach it
   * through deleted, and a `changed: true` that read like the tear had been fixed.
   *
   * These two are NOT tears in the `repairs` sense (nothing moved, and nothing should): they are
   * assemblies with a piece missing. `unhealable` is deliberately separate from `tears` so a
   * caller cannot accidentally treat "we fixed it" and "we cannot fix it" as one number. */
  const unhealable = [
    ...missingBondSiblings(list).map((r) => ({ ...r, kind: "missing-sibling" })),
    ...impossibleStacks(list).map((r) => ({ ...r, kind: "impossible-stack" })),
  ];
  const notes = new Map(); // id -> Set(kind)
  const healed = normalizeBondedChildren(list, (h) => {
    if (!h || h.id == null) return;
    let s = notes.get(h.id);
    if (!s) { s = new Set(); notes.set(h.id, s); }
    if (h.kind) s.add(h.kind);
  }, { mintId });
  if (healed === list) return { els: list, changed: false, repairs: [], tears: [], orphans, unhealable };
  const before = new Map();
  for (const e of list) if (e && e.id != null) before.set(e.id, e);
  const repairs = [];
  for (const e of healed) {
    if (!e || e.id == null) continue;
    const prev = before.get(e.id);
    if (!prev) continue;                               // minted BY the heal (a restored wall strip)
    if (prev === e) continue;                          // untouched objects are returned by identity
    const dx = num(e.cx) - num(prev.cx);
    const dy = num(e.cy) - num(prev.cy);
    const dist = Math.hypot(dx, dy);
    const drot = angDelta(e.rot, prev.rot);
    /* NEW-2 — SPAN, not just position. B1340 made a child's POSITION derived and stopped the plan
     * being written torn, and the owner confirmed both held. It did not make the child's SIZE
     * derived, so a side-parking field's along-wall RUN survived a host resize as an invisible
     * sticky value: on `sms4zs8unbkg` a 205 ft field hugged a 260 ft wall and an 80 ft field hugged
     * a 259 ft one, with perfect perpendicular offsets. A child that is the wrong LENGTH for its
     * host is exactly as wrong as one in the wrong PLACE, so the same detector must see both. */
    const dw = num(e.w) - num(prev.w);
    const dh = num(e.h) - num(prev.h);
    const span = Math.max(Math.abs(dw), Math.abs(dh));
    repairs.push({
      id: e.id,
      host: e.attachedTo != null ? e.attachedTo : null,
      type: e.type || null,
      kinds: [...(notes.get(e.id) || [])],
      dx: r3(dx), dy: r3(dy), dist: r3(dist), drot: r3(drot),
      dw: r3(dw), dh: r3(dh), span: r3(span),
    });
  }
  // A tear is a disagreement with the host past tolerance on EITHER axis of the child's geometry.
  return { els: healed, changed: true, repairs, tears: repairs.filter((r) => r.dist > tol || r.span > tol), orphans, unhealable };
}

/* Detector-only: does this collection HOLD a tear right now? Same derivation, nothing written.
 * Used where we want to assert without adopting (e.g. straight after a commit result, to report
 * that the rows we just wrote are coherent). */
export function assemblyTears(els, opts) { return assemblyIntegrity(els, opts).tears; }

/* NEW-3 — bounded telemetry for the states the heal REFUSES to repair. Same shape rule as
 * `tearPayload`: the ids and the broken link are what turn a recurrence into a query. */
export function unhealablePayload(records, cap = 20) {
  const list = Array.isArray(records) ? records : [];
  return {
    count: list.length,
    kinds: [...new Set(list.map((r) => r && r.kind).filter(Boolean))],
    items: list.slice(0, cap).map((r) => ({ id: r.id, host: r.host, type: r.type, kind: r.kind, bond: r.bond, missing: r.missing, side: r.side })),
  };
}

/* NEW-4 — bounded telemetry for the role invariant. Same shape rule as `tearPayload`: the ids and
 * the wall are what turn a recurrence into a query. */
export function orphanPayload(records, cap = 20) {
  const list = Array.isArray(records) ? records : [];
  return { count: list.length, items: list.slice(0, cap).map((r) => ({ id: r.id, host: r.host, type: r.type, side: r.side })) };
}

/* Compact, bounded telemetry payload. A tear can span a dozen children; the ids and the delta
 * are what make a recurrence a query instead of an investigation, and the rest is noise. */
export function tearPayload(records, cap = 20) {
  const list = Array.isArray(records) ? records : [];
  return {
    count: list.length,
    worstFt: list.reduce((m, r) => Math.max(m, Number(r && r.dist) || 0, Number(r && r.span) || 0), 0),
    items: list.slice(0, cap).map((r) => ({
      id: r.id, host: r.host, type: r.type, kinds: r.kinds,
      dx: r.dx, dy: r.dy, dist: r.dist, drot: r.drot, dw: r.dw, dh: r.dh, span: r.span,
    })),
  };
}
